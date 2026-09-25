/**
 * Missions and saved progress - the replay loop.
 *
 * Every story run draws three missions from the pool. The draw rotates with
 * the number of runs played, so replays ask for different things. Completed
 * missions, recovered case files, best scores, and whether Level 1 has ever
 * been cleared (which unlocks Endless mode) persist in localStorage.
 *
 * `stats` is the run summary main.js builds each frame:
 *   { sprinklers, extinguished, panes, files[], serums, midair, tanks, vents,
 *     shots, hits, nearMisses, fireDamage, time, integrity, finished }
 */

const KEY = "fractureRunCauseway";

export const MISSION_POOL = [
  { id: "sprinklers3", text: "Open 3 sprinklers", goal: 3, value: (s) => s.sprinklers },
  { id: "extinguish6", text: "Put out 6 fires", goal: 6, value: (s) => s.extinguished },
  { id: "panes25", text: "Shatter 25 glass targets", goal: 25, value: (s) => s.panes },
  { id: "files5", text: "Recover all 5 case files", goal: 5, value: (s) => s.files.length },
  { id: "serums3", text: "Take 3 serums", goal: 3, value: (s) => s.serums },
  { id: "midair2", text: "Shatter 2 falling panels mid-air", goal: 2, value: (s) => s.midair },
  { id: "nearmiss6", text: "Near-miss 6 hazards", goal: 6, value: (s) => s.nearMisses },
  { id: "tanks6", text: "Release 6 specimens", goal: 6, value: (s) => s.tanks },
  { id: "vents4", text: "Clear 4 air vents", goal: 4, value: (s) => s.vents },
  { id: "accuracy70", text: "Reach the lift with 70% accuracy", goal: 1, end: true, value: (s) => (s.finished && s.shots > 0 && s.hits / s.shots >= 0.7 ? 1 : 0) },
  { id: "integrity60", text: "Reach the lift with 60+ integrity", goal: 1, end: true, value: (s) => (s.finished && s.integrity >= 60 ? 1 : 0) },
  { id: "fireproof", text: "Reach the lift without fire damage", goal: 1, end: true, value: (s) => (s.finished && s.fireDamage < 0.5 ? 1 : 0) },
  { id: "fast", text: "Reach the lift in under 100 s", goal: 1, end: true, value: (s) => (s.finished && s.time < 100 ? 1 : 0) },
];

export function loadProgress() {
  const fallback = { runs: 0, best: { story: 0, endless: 0 }, bestDistance: 0, completed: [], files: [], cleared: false };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) };
  } catch {
    return fallback;
  }
}

export function saveProgress(progress) {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* private mode */ }
}

export class MissionTracker {
  constructor(progress) {
    this.progress = progress;
    this.active = [];
  }

  /** Draw three missions for a new run. */
  start() {
    const n = MISSION_POOL.length;
    const offset = (this.progress.runs * 3) % n;
    // Prefer missions not yet completed, then fill in rotation order.
    const rotated = [...MISSION_POOL.slice(offset), ...MISSION_POOL.slice(0, offset)];
    const fresh = rotated.filter((m) => !this.progress.completed.includes(m.id));
    const picks = [...fresh, ...rotated.filter((m) => !fresh.includes(m))].slice(0, 3);
    this.active = picks.map((m) => ({ def: m, done: false, value: 0 }));
    return this.active;
  }

  /** Re-evaluate. Returns missions that completed on this call. */
  update(stats) {
    const newlyDone = [];
    for (const m of this.active) {
      m.value = Math.min(m.def.goal, m.def.value(stats) ?? 0);
      if (!m.done && m.value >= m.def.goal) {
        m.done = true;
        newlyDone.push(m);
      }
    }
    return newlyDone;
  }

  /** Commit a finished (or failed) run to saved progress. */
  commit({ mode, score, distance = 0, files = [], cleared = false }) {
    const p = this.progress;
    p.runs += 1;
    p.best[mode] = Math.max(p.best[mode] ?? 0, score);
    if (mode === "endless") p.bestDistance = Math.max(p.bestDistance ?? 0, Math.floor(distance));
    for (const m of this.active) if (m.done && !p.completed.includes(m.def.id)) p.completed.push(m.def.id);
    for (const f of files) if (!p.files.includes(f)) p.files.push(f);
    if (cleared) p.cleared = true;
    saveProgress(p);
    return p;
  }
}
