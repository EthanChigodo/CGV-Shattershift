<?php
/**
 * Fracture Run - the global leaderboards (src/systems/leaderboard.js talks to this).
 *
 * One file, beside the game on the LAMP server. Names are unique (ignoring
 * case, spaces and punctuation: "Neo", "neo" and "N.E.O" are one name); a
 * player proves who they are with the token they got when they took the name
 * (only its hash is kept here). Each board keeps every player's best.
 *
 *   GET  ?action=ping                          the server is there
 *   GET  ?action=check&name=Neo                is the name free?
 *   POST ?action=register  {name}              take a name: {name, token}
 *   POST ?action=rename    {token, name}       change it
 *   POST ?action=submit    {token, scores: [{board, value, meta}]}
 *   GET  ?action=top&board=story_time&limit=50 the board (send X-Player-Token for your own place)
 *
 * Storage: SQLite in api/data/ (made on the first call, closed to the web by
 * its .htaccess), or MySQL if api/config.php returns
 *   ['dsn' => 'mysql:host=...;dbname=...;charset=utf8mb4', 'user' => '...', 'pass' => '...']
 *
 * Written for PHP 7.0 and up (the department server's version isn't known).
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/** The boards: which way is better, and the values a real run can reach. */
$BOARDS = array(
    'story_time'      => array('order' => 'asc',  'min' => 60, 'max' => 86400),     // seconds, the whole story
    'story_score'     => array('order' => 'desc', 'min' => 1,  'max' => 50000000),  // points, a whole story run
    'endless_foundry' => array('order' => 'desc', 'min' => 1,  'max' => 1000000),   // metres
    'endless_labs'    => array('order' => 'desc', 'min' => 1,  'max' => 1000000),   // metres
    'endless_skyline' => array('order' => 'desc', 'min' => 1,  'max' => 1000000),   // metres
    'endless_roof'    => array('order' => 'desc', 'min' => 1,  'max' => 86400),     // seconds survived
    'trophies'        => array('order' => 'desc', 'min' => 1,  'max' => 500),       // trophies earned
);
/** Names nobody can take. */
$RESERVED = array('admin', 'administrator', 'moderator', 'lecturer', 'subject07', 'okoro', 'vale', 'anonymous', 'player', 'guest', 'null', 'undefined');

function reply($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function fail($error, $message, $status = 400) {
    reply(array('ok' => false, 'error' => $error, 'message' => $message), $status);
}

function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $config = is_file(__DIR__ . '/config.php') ? include __DIR__ . '/config.php' : null;
    try {
        if (is_array($config) && !empty($config['dsn'])) {
            $pdo = new PDO($config['dsn'], isset($config['user']) ? $config['user'] : null, isset($config['pass']) ? $config['pass'] : null);
        } else {
            $dir = __DIR__ . '/data';
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            // The database itself is never served: closed by .htaccess, no
            // listing, and - should the server ignore .htaccess - a name
            // nobody can guess, known only to name.php (PHP runs, never shows).
            if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
            if (!is_file($dir . '/index.html')) @file_put_contents($dir . '/index.html', '');
            if (!is_file($dir . '/name.php')) @file_put_contents($dir . '/name.php', "<?php return 'leaderboard-" . bin2hex(random_bytes(12)) . ".sqlite';\n");
            $file = include $dir . '/name.php';
            if (!is_string($file) || $file === '') throw new Exception('no name');
            $pdo = new PDO('sqlite:' . $dir . '/' . $file);
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 3000');
        }
    } catch (Exception $e) {
        fail('storage', 'The leaderboard could not open its storage.', 503);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $id = $mysql ? 'id INT AUTO_INCREMENT PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
    $pdo->exec("CREATE TABLE IF NOT EXISTS players (
        $id,
        name VARCHAR(32) NOT NULL,
        name_key VARCHAR(32) NOT NULL UNIQUE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        created INT NOT NULL,
        renamed INT NOT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS scores (
        player_id INT NOT NULL,
        board VARCHAR(32) NOT NULL,
        value DOUBLE NOT NULL,
        meta VARCHAR(255) NOT NULL DEFAULT '',
        at INT NOT NULL,
        PRIMARY KEY (player_id, board)
    )");
    return $pdo;
}

/** The name as shown (trimmed, single spaces), or null with why not. */
function clean_name($raw, &$why) {
    global $RESERVED;
    $name = preg_replace('/\s+/', ' ', trim((string) $raw));
    if (strlen($name) < 3 || strlen($name) > 16) { $why = 'Between 3 and 16 characters.'; return null; }
    if (!preg_match('/^[A-Za-z0-9 _.\-]+$/', $name)) { $why = 'Letters, numbers, spaces and _ . - only.'; return null; }
    if (!preg_match('/[A-Za-z0-9]/', $name)) { $why = 'Needs a letter or a number.'; return null; }
    if (in_array(name_key($name), $RESERVED, true)) { $why = 'That name is reserved.'; return null; }
    return $name;
}

/** What makes two names the same: case, spaces and punctuation ignored. */
function name_key($name) {
    return strtolower(preg_replace('/[^A-Za-z0-9]/', '', $name));
}

function body() {
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : array();
}

function player_by_token($token) {
    if (!is_string($token) || !preg_match('/^[a-f0-9]{48}$/', $token)) return null;
    $q = db()->prepare('SELECT id, name FROM players WHERE token_hash = ?');
    $q->execute(array(hash('sha256', $token)));
    $p = $q->fetch();
    return $p ?: null;
}

function name_taken($key, $except = 0) {
    $q = db()->prepare('SELECT id FROM players WHERE name_key = ? AND id <> ?');
    $q->execute(array($key, $except));
    return (bool) $q->fetch();
}

/** A value's place on a board (1 = best; ties go to whoever got there first). */
function rank_of($board, $value, $at) {
    global $BOARDS;
    $better = $BOARDS[$board]['order'] === 'asc' ? '<' : '>';
    $q = db()->prepare("SELECT COUNT(*) AS n FROM scores WHERE board = ? AND (value $better ? OR (value = ? AND at < ?))");
    $q->execute(array($board, $value, $value, $at));
    $row = $q->fetch();
    return 1 + (int) $row['n'];
}

$action = isset($_GET['action']) ? $_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($action === 'ping') {
        db();
        reply(array('ok' => true));
    }

    if ($action === 'check') {
        $why = '';
        $name = clean_name(isset($_GET['name']) ? $_GET['name'] : '', $why);
        if ($name === null) reply(array('ok' => true, 'available' => false, 'message' => $why));
        $taken = name_taken(name_key($name));
        reply(array('ok' => true, 'available' => !$taken, 'message' => $taken ? 'Someone already has that name.' : 'Free.'));
    }

    if ($action === 'register' && $method === 'POST') {
        $in = body();
        $why = '';
        $name = clean_name(isset($in['name']) ? $in['name'] : '', $why);
        if ($name === null) fail('name', $why);
        $key = name_key($name);
        if (name_taken($key)) fail('taken', 'Someone already has that name.', 409);
        $token = bin2hex(random_bytes(24));
        $now = time();
        try {
            $q = db()->prepare('INSERT INTO players (name, name_key, token_hash, created, renamed) VALUES (?, ?, ?, ?, ?)');
            $q->execute(array($name, $key, hash('sha256', $token), $now, $now));
        } catch (PDOException $e) {
            // (Two people asking for the same name at the same moment: the UNIQUE key decides.)
            fail('taken', 'Someone already has that name.', 409);
        }
        reply(array('ok' => true, 'name' => $name, 'token' => $token));
    }

    if ($action === 'rename' && $method === 'POST') {
        $in = body();
        $player = player_by_token(isset($in['token']) ? $in['token'] : '');
        if (!$player) fail('token', 'Unknown player.', 401);
        $why = '';
        $name = clean_name(isset($in['name']) ? $in['name'] : '', $why);
        if ($name === null) fail('name', $why);
        $key = name_key($name);
        if (name_taken($key, (int) $player['id'])) fail('taken', 'Someone already has that name.', 409);
        try {
            $q = db()->prepare('UPDATE players SET name = ?, name_key = ?, renamed = ? WHERE id = ?');
            $q->execute(array($name, $key, time(), $player['id']));
        } catch (PDOException $e) {
            fail('taken', 'Someone already has that name.', 409);
        }
        reply(array('ok' => true, 'name' => $name));
    }

    if ($action === 'submit' && $method === 'POST') {
        $in = body();
        $player = player_by_token(isset($in['token']) ? $in['token'] : '');
        if (!$player) fail('token', 'Unknown player.', 401);
        $scores = isset($in['scores']) && is_array($in['scores']) ? array_slice($in['scores'], 0, 20) : array();
        $results = array();
        $db = db();
        foreach ($scores as $s) {
            $board = isset($s['board']) ? (string) $s['board'] : '';
            if (!isset($BOARDS[$board]) || !isset($s['value']) || !is_numeric($s['value'])) continue;
            $value = round((float) $s['value'], 2);
            $def = $BOARDS[$board];
            if ($value < $def['min'] || $value > $def['max']) continue;
            $meta = isset($s['meta']) ? substr(json_encode($s['meta']), 0, 255) : '';
            $q = $db->prepare('SELECT value, at FROM scores WHERE player_id = ? AND board = ?');
            $q->execute(array($player['id'], $board));
            $old = $q->fetch();
            $now = time();
            $better = !$old || ($def['order'] === 'asc' ? $value < (float) $old['value'] : $value > (float) $old['value']);
            if (!$old) {
                $db->prepare('INSERT INTO scores (player_id, board, value, meta, at) VALUES (?, ?, ?, ?, ?)')->execute(array($player['id'], $board, $value, $meta, $now));
            } elseif ($better) {
                $db->prepare('UPDATE scores SET value = ?, meta = ?, at = ? WHERE player_id = ? AND board = ?')->execute(array($value, $meta, $now, $player['id'], $board));
            }
            $best = $better ? $value : (float) $old['value'];
            $at = $better ? $now : (int) $old['at'];
            $results[$board] = array('best' => $best, 'improved' => $better, 'rank' => rank_of($board, $best, $at));
        }
        reply(array('ok' => true, 'results' => $results));
    }

    if ($action === 'top') {
        $board = isset($_GET['board']) ? (string) $_GET['board'] : '';
        if (!isset($BOARDS[$board])) fail('board', 'No such board.');
        $limit = max(1, min(100, isset($_GET['limit']) ? (int) $_GET['limit'] : 50));
        $order = $BOARDS[$board]['order'] === 'asc' ? 'ASC' : 'DESC';
        $q = db()->prepare("SELECT p.name, s.value, s.meta, s.at FROM scores s JOIN players p ON p.id = s.player_id WHERE s.board = ? ORDER BY s.value $order, s.at ASC LIMIT $limit");
        $q->execute(array($board));
        $entries = array();
        $rank = 0;
        foreach ($q->fetchAll() as $row) {
            $rank += 1;
            $entries[] = array('rank' => $rank, 'name' => $row['name'], 'value' => (float) $row['value'], 'meta' => $row['meta'] !== '' ? json_decode($row['meta'], true) : null, 'at' => (int) $row['at']);
        }
        $count = db()->prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ?');
        $count->execute(array($board));
        $total = (int) $count->fetch()['n'];
        $you = null;
        $token = isset($_SERVER['HTTP_X_PLAYER_TOKEN']) ? $_SERVER['HTTP_X_PLAYER_TOKEN'] : '';
        $player = $token ? player_by_token($token) : null;
        if ($player) {
            $mine = db()->prepare('SELECT value, at FROM scores WHERE player_id = ? AND board = ?');
            $mine->execute(array($player['id'], $board));
            $row = $mine->fetch();
            $you = array('name' => $player['name'], 'value' => $row ? (float) $row['value'] : null, 'rank' => $row ? rank_of($board, (float) $row['value'], (int) $row['at']) : null);
        }
        reply(array('ok' => true, 'board' => $board, 'total' => $total, 'entries' => $entries, 'you' => $you));
    }

    fail('action', 'Unknown action.', 404);
} catch (Exception $e) {
    fail('server', 'The leaderboard had a problem.', 500);
}
