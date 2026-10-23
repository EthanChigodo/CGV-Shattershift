/**
 * The global leaderboards: the game's side of api/leaderboard.php (on the
 * same server as the game). Your name is unique there; the token the server
 * gave you when you took it stays in this browser and proves it's you.
 *
 *   const lb = new Leaderboard();
 *   lb.player                       // { name, token } or null; pendingName while offline
 *   await lb.check("Neo")           // { available, message }
 *   await lb.claim("Neo")           // take it (or, with a name already, change to it)
 *   lb.submit("story_time", 1312, { difficulty: "hard" });   // kept if it's your best, sent when it can be
 *   await lb.top("story_time")      // { entries, you, total }
 *
 * Offline (no server, or no PHP on it) nothing breaks: scores wait in this
 * browser (only the best of each) and go when the server answers; a name
 * chosen offline is taken when it can be - and if someone has it by then,
 * `onNameTaken` says so (pick another in Customise).
 */

const PLAYER_KEY = "fractureRun.player";
const PENDING_KEY = "fractureRun.leaderboardPending";

/** The boards, best first. `unit`: "time" (h:mm:ss), "m", "points", "count". */
export const BOARDS = [
  { key: "story_time", label: "Fastest escape", note: "The whole story, the ward to the roof", unit: "time", order: "asc" },
  { key: "story_score", label: "Story high score", note: "Points in one whole story run", unit: "points", order: "desc" },
  { key: "endless_foundry", label: "Endless: the Foundry", note: "Furthest run", unit: "m", order: "desc" },
  { key: "endless_labs", label: "Endless: the Labs", note: "Furthest run", unit: "m", order: "desc" },
  { key: "endless_skyline", label: "Endless: the Skyline", note: "Furthest run", unit: "m", order: "desc" },
  { key: "endless_roof", label: "Endless: the Roof", note: "Longest held", unit: "time", order: "desc" },
  { key: "trophies", label: "Most trophies", note: "Trophies earned", unit: "count", order: "desc" },
];
export const BOARD = Object.fromEntries(BOARDS.map((b) => [b.key, b]));

/** A value as its board shows it. */
export function formatValue(board, value) {
  const unit = BOARD[board]?.unit;
  if (value === null || value === undefined) return "-";
  if (unit === "time") {
    const t = Math.max(0, Math.floor(value));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (unit === "m") return `${Math.round(value).toLocaleString("en-US")} m`;
  return Math.round(value).toLocaleString("en-US");
}

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

export class Leaderboard {
  constructor({ endpoint = new URL("api/leaderboard.php", document.baseURI).href } = {}) {
    this.endpoint = endpoint;
    this.player = read(PLAYER_KEY, null);
    this.pending = read(PENDING_KEY, {});
    /** "unknown" | "online" | "offline" (the last answer from the server). */
    this.status = "unknown";
    this.onNameTaken = null;
    this.onResults = null;
  }

  /** The name on your scores (taken, or chosen and waiting to be). */
  get name() {
    return this.player?.name ?? this.player?.pendingName ?? null;
  }

  /** Whether you've been asked for a name yet (chosen, or skipped). */
  get asked() {
    return Boolean(this.player?.name || this.player?.pendingName || this.player?.skipped);
  }

  skip() {
    this.player = { ...(this.player ?? {}), skipped: true };
    write(PLAYER_KEY, this.player);
  }

  async _call(action, { method = "GET", body = null, query = {} } = {}) {
    const url = new URL(this.endpoint);
    url.searchParams.set("action", action);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (this.player?.token) headers["X-Player-Token"] = this.player.token;
    let res;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : null, signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
    } catch {
      this.status = "offline";
      return { ok: false, error: "offline", message: "The leaderboard server can't be reached." };
    }
    // No PHP there: the server hands back the file itself, or a 404 page.
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      this.status = "offline";
      return { ok: false, error: "offline", message: "The leaderboard isn't running on this server." };
    }
    this.status = "online";
    try {
      return await res.json();
    } catch {
      return { ok: false, error: "server", message: "The leaderboard sent something odd." };
    }
  }

  async check(name) {
    const r = await this._call("check", { query: { name } });
    if (!r.ok) return { available: null, message: r.message };
    return { available: r.available, message: r.message };
  }

  /**
   * Take a name, or change yours to it. Offline, it's kept to be taken later.
   * Returns { ok, name, offline?, message? }.
   */
  async claim(name) {
    const token = this.player?.token;
    const r = token
      ? await this._call("rename", { method: "POST", body: { token, name } })
      : await this._call("register", { method: "POST", body: { name } });
    if (r.ok) {
      this.player = { name: r.name, token: r.token ?? token };
      write(PLAYER_KEY, this.player);
      this.flush();
      return { ok: true, name: r.name };
    }
    if (r.error === "offline") {
      // Kept, and taken (with its scores) when the server answers.
      this.player = { ...(this.player ?? {}), pendingName: name.trim(), skipped: false };
      write(PLAYER_KEY, this.player);
      return { ok: true, name: name.trim(), offline: true, message: r.message };
    }
    return { ok: false, message: r.message, taken: r.error === "taken" };
  }

  /** A result for a board: kept if it's this browser's best, then sent when it can be. */
  submit(board, value, meta = null) {
    const def = BOARD[board];
    if (!def || !Number.isFinite(value) || value <= 0) return;
    const old = this.pending[board];
    const better = !old || (def.order === "asc" ? value < old.value : value > old.value);
    if (!better) return;
    this.pending[board] = { value, meta };
    write(PENDING_KEY, this.pending);
    this.flush();
  }

  /** Send what's waiting (and take a name chosen offline first). */
  async flush() {
    // (Already sending: once it's done, again - for what came in meanwhile.)
    if (this._flushing) { this._again = true; return this._flushing; }
    this._flushing = this._flush();
    try {
      await this._flushing;
    } finally {
      this._flushing = null;
    }
    if (this._again) {
      this._again = false;
      await this.flush();
    }
  }

  async _flush() {
    this.pending = read(PENDING_KEY, this.pending);
    {
      if (!this.player?.token && this.player?.pendingName) {
        const r = await this._call("register", { method: "POST", body: { name: this.player.pendingName } });
        if (r.ok) {
          this.player = { name: r.name, token: r.token };
          write(PLAYER_KEY, this.player);
        } else if (r.error === "taken" || r.error === "name") {
          const name = this.player.pendingName;
          this.player = { skipped: true };
          write(PLAYER_KEY, this.player);
          this.onNameTaken?.(name, r.message);
          return;
        } else return;
      }
      const token = this.player?.token;
      const scores = Object.entries(this.pending).map(([board, s]) => ({ board, value: s.value, meta: s.meta }));
      if (!token || !scores.length) return;
      const r = await this._call("submit", { method: "POST", body: { token, scores } });
      if (r.ok) {
        // Sent: what's still the same can go (a better one may have come in meanwhile).
        for (const s of scores) if (this.pending[s.board]?.value === s.value) delete this.pending[s.board];
        write(PENDING_KEY, this.pending);
        this.onResults?.(r.results ?? {});
      } else if (r.error === "token") {
        // The server doesn't know us (a reset database): take the name again.
        this.player = { pendingName: this.player.name };
        write(PLAYER_KEY, this.player);
      }
    }
  }

  async top(board, limit = 50) {
    const r = await this._call("top", { query: { board, limit } });
    if (!r.ok) return { ok: false, message: r.message, entries: [], you: null, total: 0 };
    return r;
  }
}
