/**
 * Trophies and the game's statistics - kept in this browser.
 *
 *   progress.earn("bank")            a trophy, once (the toast says so)
 *   progress.add("thrown")           a statistic goes up (and any trophy
 *   progress.max("files", 4)         counting it may be earned)
 *   progress.onEarn((trophy) => ...)
 *
 * Twenty trophies - thirteen for single player, seven for multiplayer (as
 * Player 1, the first controller in) - each bronze, silver or gold by how
 * hard it is; earn them all and the platinum is yours. Some are hidden until
 * earned. A trophy with a `stat` and a `goal` shows how far along it is.
 */

export const TIERS = {
  bronze: { key: "bronze", label: "Bronze", colour: "#e0915a" },
  silver: { key: "silver", label: "Silver", colour: "#d7e0e8" },
  gold: { key: "gold", label: "Gold", colour: "#ffcf4a" },
  platinum: { key: "platinum", label: "Platinum", colour: "#bdeeff" },
};

export const TROPHIES = [
  { id: "platinum", tier: "platinum", mode: "all", icon: "platinum", name: "Fracture Proof", text: "Earn every other trophy." },
  // ---- single player ----
  { id: "wake", tier: "bronze", mode: "single", icon: "gear", name: "Wake-Up Call", text: "Clear Sector 01, the Foundry, in the story." },
  { id: "fire", tier: "bronze", mode: "single", icon: "flame", name: "Trial by Fire", text: "Clear Sector 02, the Labs, in the story." },
  { id: "heights", tier: "bronze", mode: "single", icon: "bridge", name: "Head for Heights", text: "Clear Sector 03, the Skyline, in the story." },
  { id: "roof", tier: "silver", mode: "single", icon: "heli", name: "Get to the Roof", text: "Escape Ascension Tower: finish the story on any difficulty." },
  { id: "hard", tier: "gold", mode: "single", icon: "tower", name: "Ascension", text: "Finish the story on Hard." },
  { id: "scratch", tier: "gold", mode: "single", icon: "shield", name: "Not a Scratch", text: "Clear a whole sector of the story without taking a single hit." },
  { id: "bank", tier: "silver", mode: "single", icon: "ricochet", hidden: true, name: "Bank Shot", text: "Break something with a sphere that bounced off a wall or the ceiling first." },
  { id: "cold", tier: "bronze", mode: "single", icon: "snow", hidden: true, name: "Cold Shoulder", text: "Freeze three machines in the Foundry with one cryo sphere." },
  { id: "glazier", tier: "silver", mode: "single", icon: "shards", stat: "broken", goal: 500, name: "Glazier's Nightmare", text: "Break 500 things with spheres." },
  { id: "files", tier: "silver", mode: "single", icon: "file", stat: "files", goal: 5, name: "Paper Trail", text: "Find all five case files." },
  { id: "missions", tier: "gold", mode: "single", icon: "check", stat: "missions", goal: 13, name: "Overachiever", text: "Complete all 13 missions." },
  { id: "again", tier: "bronze", mode: "single", icon: "skull", stat: "deaths", goal: 25, hidden: true, name: "Try, Try Again", text: "Go down 25 times. It happens to everyone." },
  { id: "endless", tier: "bronze", mode: "single", icon: "infinity", name: "The Long Run", text: "Run 1,000 m in a single Endless run." },
  // ---- multiplayer (as Player 1) ----
  { id: "arena", tier: "bronze", mode: "multi", icon: "pad", name: "Welcome to the Roof", text: "Play a match in the Arena." },
  { id: "king", tier: "silver", mode: "multi", icon: "crown", name: "King of the Hill", text: "Win an Arena match." },
  { id: "ledge", tier: "silver", mode: "multi", icon: "ledge", name: "Mind the Gap", text: "Knock three players off the roof in one Arena match." },
  { id: "reign", tier: "gold", mode: "multi", icon: "reign", name: "Long Live the King", text: "Win an Arena match without going down once." },
  { id: "race", tier: "bronze", mode: "multi", icon: "flag", name: "First Past the Post", text: "Win a Race." },
  { id: "bare", tier: "silver", mode: "multi", icon: "hand", hidden: true, name: "Bare Hands", text: "Win a Race without carrying the launcher." },
  { id: "insane", tier: "gold", mode: "multi", icon: "bolt", name: "Madhouse", text: "Win a Race on Insane." },
];
export const TROPHY = Object.fromEntries(TROPHIES.map((t) => [t.id, t]));

const EARNED_KEY = "fractureRun.trophies";
const STATS_KEY = "fractureRun.stats";

function load(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

class Progress {
  constructor() {
    /** id -> when it was earned (ms). */
    this.earned = load(EARNED_KEY);
    /** name -> number. */
    this.stats = load(STATS_KEY);
    this.listeners = [];
    this._dirty = false;
    // Saved every few seconds (play time ticks every frame), and on the way out.
    setInterval(() => this.flush(), 4000);
    addEventListener("pagehide", () => this.flush());
  }

  onEarn(fn) {
    this.listeners.push(fn);
  }

  has(id) {
    return Boolean(this.earned[id]);
  }

  /** Earn a trophy (once). True if it's new. */
  earn(id) {
    const t = TROPHY[id];
    if (!t || this.earned[id]) return false;
    this.earned[id] = Date.now();
    this._save(EARNED_KEY, this.earned);
    for (const fn of this.listeners) fn(t);
    // The last of the twenty: the platinum, a moment later.
    if (id !== "platinum" && TROPHIES.every((x) => x.id === "platinum" || this.earned[x.id])) setTimeout(() => this.earn("platinum"), 1200);
    return true;
  }

  stat(name) {
    return this.stats[name] ?? 0;
  }

  /** A statistic goes up by n. */
  add(name, n = 1) {
    if (!n) return;
    this.stats[name] = (this.stats[name] ?? 0) + n;
    this._dirty = true;
    this._goals(name);
  }

  /** A statistic is at least v (a best, a count kept elsewhere). */
  max(name, v) {
    if (!(v > (this.stats[name] ?? 0))) return;
    this.stats[name] = v;
    this._dirty = true;
    this._goals(name);
  }

  _goals(name) {
    for (const t of TROPHIES) if (t.stat === name && this.stats[name] >= t.goal) this.earn(t.id);
  }

  /** How far along a counted trophy is: { value, goal } (null if it isn't counted). */
  progressOf(t) {
    return t.stat ? { value: Math.min(t.goal, Math.floor(this.stat(t.stat))), goal: t.goal } : null;
  }

  summary() {
    const counts = { bronze: [0, 0], silver: [0, 0], gold: [0, 0], platinum: [0, 0] };
    for (const t of TROPHIES) {
      counts[t.tier][1] += 1;
      if (this.earned[t.id]) counts[t.tier][0] += 1;
    }
    const earned = TROPHIES.filter((t) => this.earned[t.id]).length;
    return { earned, total: TROPHIES.length, percent: Math.round((earned / TROPHIES.length) * 100), counts };
  }

  /** The most recently earned trophy, or null. */
  latest() {
    let best = null;
    for (const t of TROPHIES) if (this.earned[t.id] && (!best || this.earned[t.id] > this.earned[best.id])) best = t;
    return best;
  }

  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    this._save(STATS_KEY, this.stats);
  }

  _save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
}

export const progress = new Progress();
