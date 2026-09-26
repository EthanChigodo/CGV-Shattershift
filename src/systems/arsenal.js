/**
 * The player's tools: three sphere types and four serum power-ups.
 *
 * Spheres are Subject 07's resonance field, condensed and thrown. Each type
 * trades sphere cost for an effect, which keeps the Level 1 question - what is
 * worth breaking with limited ammunition? - interesting all the way through:
 *
 *   glass  1 sphere   the standard throw
 *   cryo   2 spheres  puts out fires and freezes falling debris in a radius
 *   shock  3 spheres  shatters every glass target in a radius, and breaks
 *                     reinforced glass in one hit
 *
 * Serums are single-use experimental compounds found in the lab. Each one is a
 * visible transformation - a post-processing "look" and a gameplay rule.
 */

export const BALLS = {
  glass: { key: "glass", name: "Glass", cost: 1, speed: 40, gravity: 3.2, radius: 0.17, colour: 0xd9fbff, glow: [1.6, 3.2, 3.6], text: "Standard throw. Breaks glass." },
  cryo: { key: "cryo", name: "Cryo", cost: 2, speed: 34, gravity: 4.5, radius: 0.21, colour: 0x7fe9ff, glow: [0.8, 3.6, 4.5], splash: 4.8, text: "Puts out fires within 4.8 m and freezes falling debris." },
  shock: { key: "shock", name: "Shock", cost: 3, speed: 32, gravity: 4, radius: 0.23, colour: 0xc77dff, glow: [3.2, 1.2, 4.6], splash: 5.2, text: "Shatters all glass within 5 m. One-hit reinforced glass." },
};
export const BALL_ORDER = ["glass", "cryo", "shock"];

export const SERUMS = {
  prism: { key: "prism", name: "Prism split", duration: 10, colour: "#b273ff", text: "Every throw splits into three spheres." },
  thermal: { key: "thermal", name: "Thermal sight", duration: 12, colour: "#ff8a2a", text: "See through smoke. Heat glows white." },
  shield: { key: "shield", name: "Kinetic shield", duration: 25, charges: 2, colour: "#4fe8ff", text: "Absorbs the next two impacts." },
  overdrive: { key: "overdrive", name: "Overdrive", duration: 8, colour: "#ff3d8b", text: "Free throws, faster running, heavier hits." },
};

export class Arsenal {
  constructor() {
    this.reset();
  }

  reset() {
    this.ball = "glass";
    this.active = new Map();
    this.shieldCharges = 0;
  }

  get current() { return BALLS[this.ball]; }

  cycle(step) {
    const i = BALL_ORDER.indexOf(this.ball);
    this.ball = BALL_ORDER[(i + step + BALL_ORDER.length) % BALL_ORDER.length];
    return this.current;
  }

  select(key) {
    if (BALLS[key]) this.ball = key;
    return this.current;
  }

  /** Cost of the next throw, after serums. */
  cost() {
    return this.isActive("overdrive") ? 0 : this.current.cost;
  }

  activate(type) {
    const def = SERUMS[type];
    if (!def) return;
    this.active.set(type, { remaining: def.duration, duration: def.duration });
    if (type === "shield") this.shieldCharges = def.charges;
  }

  isActive(type) { return this.active.has(type); }

  level(type) {
    const a = this.active.get(type);
    if (!a) return 0;
    // Ease in over the first half second and out over the last second.
    return Math.min(1, (a.duration - a.remaining) * 2, a.remaining);
  }

  /** Use a shield charge. Returns true if the hit was absorbed. */
  absorb() {
    if (!this.isActive("shield") || this.shieldCharges <= 0) return false;
    this.shieldCharges -= 1;
    if (this.shieldCharges <= 0) this.active.delete("shield");
    return true;
  }

  update(dt) {
    for (const [type, state] of this.active) {
      state.remaining -= dt;
      if (state.remaining <= 0) {
        this.active.delete(type);
        if (type === "shield") this.shieldCharges = 0;
      }
    }
  }

  list() {
    return [...this.active].map(([type, s]) => ({ ...SERUMS[type], remaining: s.remaining, ratio: s.remaining / s.duration }));
  }
}
