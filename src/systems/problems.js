/**
 * "The right tool": obstacles that only the right sphere (or the right way
 * of firing one) gets you past.
 *
 * The spheres are one physical language - glass, ice, electricity and
 * gravity - and every level asks a new question in it:
 *
 *   The Foundry  glass     a drop forge's release valve, open only while the
 *                          hammer is held up: read the rhythm, throw on the beat
 *   The Labs     cryo      a fire wall across the corridor: freeze it
 *                charge    a jammed blast shutter: plain shots only dent it;
 *                          one full charged shot blows it out
 *   The Skyline  shock     a sealed security door that glass bounces off;
 *                          a laser grid's junction box - overload it
 *   The Roof     gravity   supplies stranded on the window-cleaner's cradle
 *                          off the ledge: pull them in; a black hole by an
 *                          open ledge drags patients over it
 *
 * Every problem is drawn in the colour of the sphere that solves it (cryo
 * cyan, shock violet, gravity indigo, glass white, the charge gold), carries
 * that sphere's mark, and says what it wants the first time you meet it.
 * The wrong sphere visibly fails and says what it needs. A mandatory one can
 * always be passed without the tool - at a real cost (a burn, a crash, a
 * hit) - so being out of the right spheres is never a soft-lock.
 *
 * This module is the shared part: the definitions, and a per-level log the
 * levels report to (first sightings, solves, wrong tools) and the host and
 * the HUD listen to (src/ui/problem-cue.js). The obstacles themselves live
 * with their levels.
 *
 *   const log = new ProblemLog();
 *   log.on("solved", ({ key, bonus }) => (score += bonus));
 *   log.sighted("firewall");                 // the first time: the hint
 *   log.wrong("firewall", "glass");          // a fizzle and "Needs cryo"
 *   log.solve("firewall");                   // +600, "Solved"
 */

/** The colours (CSS) and marks of the tools; the levels' 3D marks use the same. */
export const TOOLS = {
  glass: { name: "Glass", colour: "#e9f6ff", hex: 0xd9fbff },
  cryo: { name: "Cryo", colour: "#5ef0ff", hex: 0x5ef0ff },
  shock: { name: "Shock", colour: "#c77dff", hex: 0xc77dff },
  gravity: { name: "Gravity", colour: "#8f7cff", hex: 0x7a5cff },
  charge: { name: "Charged shot", colour: "#ffd23f", hex: 0xffd23f },
};

/**
 * Every problem: the level it belongs to, the tool that solves it, what the
 * first sighting says (keyboard words; key-names.js padText renames them for
 * a controller), what the wrong tool is told, and the bonus for solving it.
 * `mandatory`: it stands in the way (passable without the tool only at a cost).
 * `refund`: spheres back on a solve - the right tool's cost, so answering a
 * problem never leaves you poorer than walking into it (cryo and a charged
 * shot cost two, shock three; the Foundry's valve gives its sphere back as a
 * cell does, and the stranded crate bursts into spheres).
 */
export const PROBLEMS = {
  forge: {
    level: "foundry", tool: "glass", mandatory: true, bonus: 500,
    name: "Drop forge",
    hint: "Drop forge: break its valve while the hammer is up (CLICK) - or time your run under it",
    needs: "VALVE SHUT // THROW WHILE THE HAMMER IS UP",
    solved: "HAMMER JAMMED UP",
  },
  firewall: {
    level: "labs", tool: "cryo", mandatory: true, bonus: 600, refund: 2,
    name: "Fire wall",
    hint: "Fire wall: freeze it - cryo (Q/E)",
    needs: "NEEDS CRYO",
    solved: "FIRE WALL OUT",
  },
  shutter: {
    level: "labs", tool: "charge", mandatory: true, bonus: 700, refund: 2,
    name: "Jammed shutter",
    hint: "Jammed shutter: hold CLICK - a full charged shot blasts it",
    needs: "ONLY DENTS IT // HOLD FOR A CHARGED SHOT",
    solved: "SHUTTER BLASTED",
  },
  sealed: {
    level: "skyline", tool: "shock", mandatory: true, bonus: 600, refund: 3,
    name: "Sealed door",
    hint: "Sealed security door: glass bounces off - shock (Q/E)",
    needs: "NEEDS SHOCK",
    solved: "SEAL OVERLOADED",
  },
  junction: {
    level: "skyline", tool: "shock", mandatory: false, bonus: 450, refund: 3,
    name: "Junction box",
    hint: "Laser grid: overload its junction box - shock (Q/E). Or jump it",
    needs: "NEEDS SHOCK",
    solved: "GRID DOWN",
  },
  stranded: {
    level: "roof", tool: "gravity", mandatory: false, bonus: 500,
    name: "Stranded supplies",
    hint: "Supplies off the ledge: pull them in - gravity (Q/E)",
    needs: "OUT OF REACH // NEEDS GRAVITY",
    solved: "SUPPLIES PULLED IN",
  },
  ledge: {
    level: "roof", tool: "gravity", mandatory: false, bonus: 350,
    name: "Over the edge",
    hint: "Open ledge: a gravity well beside it drags them over",
    needs: "",
    solved: "CLEVER KILL // OVER THE EDGE",
  },
};

/** The problem keys of a level ("foundry" | "labs" | "skyline" | "roof"). */
export function problemsOf(level) {
  return Object.keys(PROBLEMS).filter((key) => PROBLEMS[key].level === level);
}

/** What the wrong-tool line says, by the sphere that was used. */
function wrongLine(def, used) {
  if (!def.needs) return "";
  if (def.tool === "charge") return def.needs;
  return used && used !== def.tool ? `${(used === "charge" ? "CHARGED" : used).toUpperCase()} // ${def.needs}` : def.needs;
}

/**
 * The problems met and solved in a level: the levels report, the host and
 * the HUD listen. One per level session (`reset()` when a level is built).
 */
export class ProblemLog {
  constructor() {
    this.handlers = new Map();
    this.reset();
  }

  reset() {
    this.seen = new Set();
    this.solved = {};
    this.wrongs = {};
    this.bonus = 0;
    this._wrongAt = new Map();
  }

  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name)?.delete(fn);
  }

  emit(name, payload) {
    for (const fn of this.handlers.get(name) ?? []) fn(payload);
  }

  /**
   * One came into view. The first of its kind this session gets the hint
   * (returns true); `lead` is how far ahead it is (metres), for the line.
   */
  sighted(key, { lead = null } = {}) {
    const def = PROBLEMS[key];
    if (!def || this.seen.has(key)) return false;
    this.seen.add(key);
    this.emit("hint", { key, def, lead });
    return true;
  }

  /** The wrong tool on it: says what it needs (not more than once a second and a half). */
  wrong(key, used = null) {
    const def = PROBLEMS[key];
    if (!def) return;
    this.wrongs[key] = (this.wrongs[key] ?? 0) + 1;
    const now = (globalThis.performance?.now() ?? Date.now()) / 1000;
    if (now - (this._wrongAt.get(key) ?? -Infinity) < 1.5) return;
    this._wrongAt.set(key, now);
    this.emit("wrong", { key, def, used, text: wrongLine(def, used) });
  }

  /** Solved: the bonus (returned) and the line. `bonus` overrides the problem's own. */
  solve(key, { bonus = null, label = null } = {}) {
    const def = PROBLEMS[key];
    if (!def) return 0;
    const points = bonus ?? def.bonus;
    this.solved[key] = (this.solved[key] ?? 0) + 1;
    this.bonus += points;
    this.emit("solved", { key, def, bonus: points, label: label ?? def.solved, count: this.count });
    return points;
  }

  /** Solved in this session, all kinds. */
  get count() {
    return Object.values(this.solved).reduce((a, b) => a + b, 0);
  }

  summary() {
    return { solved: { ...this.solved }, count: this.count, bonus: this.bonus, wrongs: { ...this.wrongs } };
  }
}
