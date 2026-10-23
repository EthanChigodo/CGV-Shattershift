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
 *   GET  ?action=diag                          what this server offers the leaderboard (no secrets)
 *   GET  ?action=check&name=Neo                is the name free?
 *   POST ?action=register  {name}              take a name: {name, token}
 *   POST ?action=rename    {token, name}       change it
 *   POST ?action=submit    {token, scores: [{board, value, meta}]}
 *   GET  ?action=top&board=story_time&limit=50 the board (send X-Player-Token for your own place)
 *
 * Storage - whatever the server allows, in this order:
 *   MySQL     if api/config.php returns ['dsn' => 'mysql:host=...;dbname=...;charset=utf8mb4', 'user' => '...', 'pass' => '...']
 *   SQLite    if PHP has it, in the first folder it can write to:
 *               api/data/ (closed to the web by .htaccess, the file under a random name), else the server's temp folder
 *   JSON      the same, without SQLite - one file, locked while it's written
 * (config.php can also return ['store' => 'json'] to force the last.)
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

function config() {
    static $config = false;
    if ($config === false) $config = is_file(__DIR__ . '/config.php') ? include __DIR__ . '/config.php' : null;
    return is_array($config) ? $config : array();
}

/* ------------------------------------------------------------------ */
/* Where the data can live                                             */
/* ------------------------------------------------------------------ */

/** The folders it may write to, best first. */
function storage_candidates() {
    return array(
        __DIR__ . '/data',
        rtrim(sys_get_temp_dir(), '/\\') . '/fracture-run-leaderboard-' . substr(sha1(__DIR__), 0, 12),
    );
}

/** The first folder it can really write to (made if need be), or null. */
function storage_dir() {
    static $dir = false;
    if ($dir !== false) return $dir;
    foreach (storage_candidates() as $c) {
        if (!is_dir($c)) @mkdir($c, 0775, true);
        if (!is_dir($c) || !is_writable($c)) continue;
        // (is_writable can say yes and the write still fail: try one.)
        $probe = $c . '/.probe';
        if (@file_put_contents($probe, 'ok') === false) continue;
        @unlink($probe);
        // The data is never served: closed, no listing, and a name nobody can
        // guess - known only to name.php (PHP runs, it never shows).
        if (!is_file($c . '/.htaccess')) @file_put_contents($c . '/.htaccess', "Require all denied\nDeny from all\n");
        if (!is_file($c . '/index.html')) @file_put_contents($c . '/index.html', '');
        return $dir = $c;
    }
    return $dir = null;
}

/** This store's file name in the folder (random, made once). */
function storage_file($dir, $ext) {
    $names = $dir . '/name.php';
    $known = is_file($names) ? include $names : null;
    if (!is_array($known)) $known = array();
    if (empty($known[$ext])) {
        $known[$ext] = 'leaderboard-' . bin2hex(random_bytes(12)) . '.' . $ext;
        @file_put_contents($names, '<?php return ' . var_export($known, true) . ";\n");
    }
    return $dir . '/' . $known[$ext];
}

function sqlite_available() {
    return class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true);
}

/** "mysql" | "sqlite" | "json", or a failure saying why none. */
function backend() {
    static $kind = null;
    if ($kind) return $kind;
    $config = config();
    if (!empty($config['dsn'])) return $kind = 'mysql';
    if (!storage_dir()) fail('storage', 'The leaderboard has no folder it can write to on this server (api/data, or the temp folder).', 503);
    if (isset($config['store']) && $config['store'] === 'json') return $kind = 'json';
    return $kind = sqlite_available() ? 'sqlite' : 'json';
}

/* ------------------------------------------------------------------ */
/* SQL (MySQL or SQLite)                                               */
/* ------------------------------------------------------------------ */

function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $config = config();
    try {
        if (backend() === 'mysql') {
            $pdo = new PDO($config['dsn'], isset($config['user']) ? $config['user'] : null, isset($config['pass']) ? $config['pass'] : null);
        } else {
            $pdo = new PDO('sqlite:' . storage_file(storage_dir(), 'sqlite'));
            $pdo->exec('PRAGMA busy_timeout = 3000');
        }
    } catch (Exception $e) {
        fail('storage', 'The leaderboard could not open its database (' . backend() . ').', 503);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $id = backend() === 'mysql' ? 'id INT AUTO_INCREMENT PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
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

/* ------------------------------------------------------------------ */
/* JSON (no SQLite): one file, locked for the whole request             */
/* ------------------------------------------------------------------ */

function &json_data() {
    static $data = null;
    static $handle = null;
    if ($data === null) {
        $handle = @fopen(storage_file(storage_dir(), 'json'), 'c+');
        if (!$handle || !flock($handle, LOCK_EX)) fail('storage', 'The leaderboard could not open its file.', 503);
        $raw = stream_get_contents($handle);
        $data = $raw ? json_decode($raw, true) : null;
        if (!is_array($data)) $data = array('next' => 1, 'players' => array(), 'scores' => array());
        // Written back (and let go) once the answer is out.
        register_shutdown_function(function () use (&$data, $handle) {
            if (!empty($GLOBALS['json_dirty'])) {
                ftruncate($handle, 0);
                rewind($handle);
                fwrite($handle, json_encode($data));
                fflush($handle);
            }
            flock($handle, LOCK_UN);
            fclose($handle);
        });
    }
    return $data;
}

function json_changed() {
    $GLOBALS['json_dirty'] = true;
}

/* ------------------------------------------------------------------ */
/* The store: the same few questions, whichever is behind it            */
/* ------------------------------------------------------------------ */

function st_name_taken($key, $except = 0) {
    if (backend() === 'json') {
        $d = &json_data();
        foreach ($d['players'] as $id => $p) if ($p['key'] === $key && (int) $id !== (int) $except) return true;
        return false;
    }
    $q = db()->prepare('SELECT id FROM players WHERE name_key = ? AND id <> ?');
    $q->execute(array($key, $except));
    return (bool) $q->fetch();
}

/** A new player; false if the name went meanwhile. */
function st_add_player($name, $key, $hash, $now) {
    if (backend() === 'json') {
        $d = &json_data();
        if (st_name_taken($key)) return false;
        $id = $d['next']++;
        $d['players'][(string) $id] = array('name' => $name, 'key' => $key, 'hash' => $hash, 'created' => $now, 'renamed' => $now);
        json_changed();
        return true;
    }
    try {
        db()->prepare('INSERT INTO players (name, name_key, token_hash, created, renamed) VALUES (?, ?, ?, ?, ?)')->execute(array($name, $key, $hash, $now, $now));
        return true;
    } catch (PDOException $e) {
        // (Two people asking for the same name at the same moment: the UNIQUE key decides.)
        return false;
    }
}

function st_player_by_hash($hash) {
    if (backend() === 'json') {
        $d = &json_data();
        foreach ($d['players'] as $id => $p) if ($p['hash'] === $hash) return array('id' => (int) $id, 'name' => $p['name']);
        return null;
    }
    $q = db()->prepare('SELECT id, name FROM players WHERE token_hash = ?');
    $q->execute(array($hash));
    $p = $q->fetch();
    return $p ?: null;
}

function st_rename($id, $name, $key, $now) {
    if (backend() === 'json') {
        $d = &json_data();
        if (st_name_taken($key, $id)) return false;
        $d['players'][(string) $id]['name'] = $name;
        $d['players'][(string) $id]['key'] = $key;
        $d['players'][(string) $id]['renamed'] = $now;
        json_changed();
        return true;
    }
    try {
        db()->prepare('UPDATE players SET name = ?, name_key = ?, renamed = ? WHERE id = ?')->execute(array($name, $key, $now, $id));
        return true;
    } catch (PDOException $e) {
        return false;
    }
}

/** A player's entry on a board: array(value, at), or null. */
function st_score($id, $board) {
    if (backend() === 'json') {
        $d = &json_data();
        $k = $id . '|' . $board;
        return isset($d['scores'][$k]) ? array('value' => (float) $d['scores'][$k]['value'], 'at' => (int) $d['scores'][$k]['at']) : null;
    }
    $q = db()->prepare('SELECT value, at FROM scores WHERE player_id = ? AND board = ?');
    $q->execute(array($id, $board));
    $row = $q->fetch();
    return $row ? array('value' => (float) $row['value'], 'at' => (int) $row['at']) : null;
}

function st_put_score($id, $board, $value, $meta, $at, $exists) {
    if (backend() === 'json') {
        $d = &json_data();
        $d['scores'][$id . '|' . $board] = array('player' => (int) $id, 'board' => $board, 'value' => $value, 'meta' => $meta, 'at' => $at);
        json_changed();
        return;
    }
    if ($exists) db()->prepare('UPDATE scores SET value = ?, meta = ?, at = ? WHERE player_id = ? AND board = ?')->execute(array($value, $meta, $at, $id, $board));
    else db()->prepare('INSERT INTO scores (player_id, board, value, meta, at) VALUES (?, ?, ?, ?, ?)')->execute(array($id, $board, $value, $meta, $at));
}

/** A board's entries, best first: array of array(name, value, meta, at). */
function st_entries($board, $limit = null) {
    global $BOARDS;
    $asc = $BOARDS[$board]['order'] === 'asc';
    if (backend() === 'json') {
        $d = &json_data();
        $rows = array();
        foreach ($d['scores'] as $s) {
            if ($s['board'] !== $board || !isset($d['players'][(string) $s['player']])) continue;
            $rows[] = array('name' => $d['players'][(string) $s['player']]['name'], 'value' => (float) $s['value'], 'meta' => $s['meta'], 'at' => (int) $s['at']);
        }
        usort($rows, function ($a, $b) use ($asc) {
            if ($a['value'] != $b['value']) return ($asc ? 1 : -1) * ($a['value'] < $b['value'] ? -1 : 1);
            return $a['at'] - $b['at'];
        });
        return $limit ? array_slice($rows, 0, $limit) : $rows;
    }
    $order = $asc ? 'ASC' : 'DESC';
    $sql = "SELECT p.name, s.value, s.meta, s.at FROM scores s JOIN players p ON p.id = s.player_id WHERE s.board = ? ORDER BY s.value $order, s.at ASC" . ($limit ? ' LIMIT ' . (int) $limit : '');
    $q = db()->prepare($sql);
    $q->execute(array($board));
    return $q->fetchAll();
}

function st_count($board) {
    if (backend() === 'json') return count(st_entries($board));
    $q = db()->prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ?');
    $q->execute(array($board));
    $row = $q->fetch();
    return (int) $row['n'];
}

/** A value's place on a board (1 = best; ties go to whoever got there first). */
function st_rank($board, $value, $at) {
    global $BOARDS;
    $asc = $BOARDS[$board]['order'] === 'asc';
    if (backend() === 'json') {
        $n = 0;
        foreach (st_entries($board) as $e) {
            if (($asc ? $e['value'] < $value : $e['value'] > $value) || ($e['value'] == $value && $e['at'] < $at)) $n += 1;
        }
        return 1 + $n;
    }
    $better = $asc ? '<' : '>';
    $q = db()->prepare("SELECT COUNT(*) AS n FROM scores WHERE board = ? AND (value $better ? OR (value = ? AND at < ?))");
    $q->execute(array($board, $value, $value, $at));
    $row = $q->fetch();
    return 1 + (int) $row['n'];
}

/* ------------------------------------------------------------------ */
/* Names and tokens                                                    */
/* ------------------------------------------------------------------ */

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
    return st_player_by_hash(hash('sha256', $token));
}

/* ------------------------------------------------------------------ */
/* The actions                                                         */
/* ------------------------------------------------------------------ */

$action = isset($_GET['action']) ? $_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($action === 'diag') {
        // What the server offers (to find out why storage fails): no secrets.
        $chosen = storage_dir();
        $dirs = array();
        foreach (storage_candidates() as $i => $c) {
            $dirs[] = array('where' => $i === 0 ? 'api/data' : 'temp folder', 'exists' => is_dir($c), 'writable' => is_dir($c) && is_writable($c));
        }
        reply(array(
            'ok' => true,
            'php' => PHP_VERSION,
            'pdo' => class_exists('PDO') ? PDO::getAvailableDrivers() : array(),
            'mysql_config' => !empty(config()['dsn']),
            'folders' => $dirs,
            'using' => !empty(config()['dsn']) ? 'mysql' : ($chosen ? ((sqlite_available() && (config()['store'] ?? '') !== 'json' ? 'sqlite' : 'json') . ' in ' . ($chosen === storage_candidates()[0] ? 'api/data' : 'the temp folder')) : 'nothing - no folder it can write to'),
        ));
    }

    if ($action === 'ping') {
        if (backend() === 'json') json_data(); else db();
        reply(array('ok' => true, 'store' => backend()));
    }

    if ($action === 'check') {
        $why = '';
        $name = clean_name(isset($_GET['name']) ? $_GET['name'] : '', $why);
        if ($name === null) reply(array('ok' => true, 'available' => false, 'message' => $why));
        $taken = st_name_taken(name_key($name));
        reply(array('ok' => true, 'available' => !$taken, 'message' => $taken ? 'Someone already has that name.' : 'Free.'));
    }

    if ($action === 'register' && $method === 'POST') {
        $in = body();
        $why = '';
        $name = clean_name(isset($in['name']) ? $in['name'] : '', $why);
        if ($name === null) fail('name', $why);
        $key = name_key($name);
        if (st_name_taken($key)) fail('taken', 'Someone already has that name.', 409);
        $token = bin2hex(random_bytes(24));
        if (!st_add_player($name, $key, hash('sha256', $token), time())) fail('taken', 'Someone already has that name.', 409);
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
        if (st_name_taken($key, (int) $player['id']) || !st_rename((int) $player['id'], $name, $key, time())) fail('taken', 'Someone already has that name.', 409);
        reply(array('ok' => true, 'name' => $name));
    }

    if ($action === 'submit' && $method === 'POST') {
        $in = body();
        $player = player_by_token(isset($in['token']) ? $in['token'] : '');
        if (!$player) fail('token', 'Unknown player.', 401);
        $scores = isset($in['scores']) && is_array($in['scores']) ? array_slice($in['scores'], 0, 20) : array();
        $results = array();
        foreach ($scores as $s) {
            $board = isset($s['board']) ? (string) $s['board'] : '';
            if (!isset($BOARDS[$board]) || !isset($s['value']) || !is_numeric($s['value'])) continue;
            $value = round((float) $s['value'], 2);
            $def = $BOARDS[$board];
            if ($value < $def['min'] || $value > $def['max']) continue;
            $meta = isset($s['meta']) ? substr(json_encode($s['meta']), 0, 255) : '';
            $old = st_score((int) $player['id'], $board);
            $now = time();
            $better = !$old || ($def['order'] === 'asc' ? $value < $old['value'] : $value > $old['value']);
            if ($better) st_put_score((int) $player['id'], $board, $value, $meta, $now, (bool) $old);
            $best = $better ? $value : $old['value'];
            $at = $better ? $now : $old['at'];
            $results[$board] = array('best' => $best, 'improved' => $better, 'rank' => st_rank($board, $best, $at));
        }
        reply(array('ok' => true, 'results' => $results));
    }

    if ($action === 'top') {
        $board = isset($_GET['board']) ? (string) $_GET['board'] : '';
        if (!isset($BOARDS[$board])) fail('board', 'No such board.');
        $limit = max(1, min(100, isset($_GET['limit']) ? (int) $_GET['limit'] : 50));
        $entries = array();
        $rank = 0;
        foreach (st_entries($board, $limit) as $row) {
            $rank += 1;
            $entries[] = array('rank' => $rank, 'name' => $row['name'], 'value' => (float) $row['value'], 'meta' => $row['meta'] !== '' ? json_decode($row['meta'], true) : null, 'at' => (int) $row['at']);
        }
        $you = null;
        $token = isset($_SERVER['HTTP_X_PLAYER_TOKEN']) ? $_SERVER['HTTP_X_PLAYER_TOKEN'] : '';
        $player = $token ? player_by_token($token) : null;
        if ($player) {
            $mine = st_score((int) $player['id'], $board);
            $you = array('name' => $player['name'], 'value' => $mine ? $mine['value'] : null, 'rank' => $mine ? st_rank($board, $mine['value'], $mine['at']) : null);
        }
        reply(array('ok' => true, 'board' => $board, 'total' => st_count($board), 'entries' => $entries, 'you' => $you));
    }

    fail('action', 'Unknown action.', 404);
} catch (Exception $e) {
    fail('server', 'The leaderboard had a problem.', 500);
}
