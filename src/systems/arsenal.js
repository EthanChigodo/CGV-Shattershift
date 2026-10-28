/**
 * The player's tools: four sphere types and the serum power-ups.
 *
 * Spheres are Subject 07's resonance field, condensed and thrown. Each type
 * trades sphere cost for an effect, which keeps the Level 1 question - what is
 * worth breaking with limited ammunition? - interesting all the way through:
 *
 *   glass  1 sphere   the standard throw
 *   cryo   2 spheres  puts out fires and freezes falling debris in a radius
 *   shock  3 spheres  shatters every glass target in a radius, and breaks
 *                     reinforced glass in one hit
 *   gravity 2 spheres a black hole for a second: breaks nothing, drags in the
 *                     pickups (caches, sacks, serums) in reach, and pulls
 *                     people in and stuns them
 *
 * Serums are single-use experimental compounds found in the lab. Each one is a
 * visible transformation - a post-processing "look" and a gameplay rule.
 * Restoration is the one that works at once (`instant`): the host refills
 * the spheres and the integrity (onInstant); it shows for a moment, then
 * it's gone.
 */

export const BALLS = {
  glass: { key: "glass", name: "Glass", cost: 1, speed: 40, gravity: 3.2, radius: 0.17, colour: 0xd9fbff, glow: [1.6, 3.2, 3.6], text: "Standard throw. Breaks glass." },
  cryo: { key: "cryo", name: "Cryo", cost: 2, speed: 34, gravity: 4.5, radius: 0.21, colour: 0x7fe9ff, glow: [0.8, 3.6, 4.5], splash: 4.8, text: "Shatters everything within 4.8 m in ice, puts out fires and freezes falling debris." },
  gravity: { key: "gravity", name: "Gravity", cost: 2, speed: 32, gravity: 4, radius: 0.22, colour: 0x7a5cff, glow: [1.5, 1.1, 4.6], splash: 7, text: "Opens a black hole for a second: drags in every sphere cache, sack and serum within 7 m for you, and pulls people in and stuns them." },
  shock: { key: "shock", name: "Shock", cost: 3, speed: 32, gravity: 4, radius: 0.23, colour: 0xc77dff, glow: [3.2, 1.2, 4.6], splash: 5.2, text: "Shatters all glass within 5 m. One-hit reinforced glass." },
};
export const BALL_ORDER = ["glass", "cryo", "shock", "gravity"];

/**
 * Every serum has a colour of its own, and none of them is a sphere type's
 * (glass white, cryo ice blue, shock violet, gravity indigo): the capsule, the glow round
 * the screen and its card in the pause menu are all drawn in it.
 */
export const SERUMS = {
  prism: { key: "prism", name: "Prism split", duration: 10, colour: "#ffd23f", text: "Every throw splits into three spheres." },
  // Sight and skin: heat glows white, and fire can't burn you.
  thermal: { key: "thermal", name: "Thermal Aegis", duration: 12, colour: "#ff6a1a", text: "See through smoke and the dark - and fire can't burn you." },
  shield: { key: "shield", name: "Kinetic shield", duration: 25, charges: 2, colour: "#3dff7a", text: "Absorbs the next two impacts." },
  overdrive: { key: "overdrive", name: "Overdrive", duration: 8, colour: "#ff2f8e", text: "Free throws, faster running, heavier hits." },
  infinite: { key: "infinite", name: "Unlimited spheres", duration: 10, colour: "#4f7dff", text: "Every throw is free - cryo and shock too." },
  restore: { key: "restore", name: "Restoration", duration: 1.6, instant: true, spheres: 20, heal: true, colour: "#1fe0b0", text: "+20 spheres, and your integrity back to full - at once." },
};
export const SERUM_ORDER = ["prism", "thermal", "shield", "overdrive", "infinite", "restore"];

export class Arsenal {
  constructor() {
    this.reset();
  }

  /** The sphere a run starts with (the menus' pick); selects it now too. */
  prefer(key) {
    if (!BALLS[key]) return;
    this.preferred = key;
    if (this.has(key)) this.ball = key;
  }

  reset() {
    this.ball = this.preferred && this.has(this.preferred) ? this.preferred : "glass";
    this.active = new Map();
    this.shieldCharges = 0;
  }

  get current() { return BALLS[this.ball]; }

  /**
   * The sphere types there are to use (the story earns them a level at a
   * time: systems/progression.js); null, every one. The sphere in use moves
   * to glass if it isn't one of them.
   */
  allow(keys) {
    this.allowed = keys ? new Set(keys) : null;
    if (!this.has(this.ball)) this.ball = "glass";
  }

  has(key) {
    return !!BALLS[key] && (!this.allowed || this.allowed.has(key));
  }

  /** The types there are, in the wheel's order. */
  get available() {
    return BALL_ORDER.filter((k) => this.has(k));
  }

  cycle(step) {
    const list = this.available;
    const i = Math.max(0, list.indexOf(this.ball));
    this.ball = list[(i + step + list.length) % list.length];
    return this.current;
  }

  select(key) {
    if (this.has(key)) this.ball = key;
    return this.current;
  }

  /** Cost of the next throw, after serums. */
  cost() {
    return this.isActive("overdrive") || this.isActive("infinite") ? 0 : this.current.cost;
  }

  activate(type) {
    const def = SERUMS[type];
    if (!def) return;
    // Every injection gets its own number, so the screen announces a real
    // one - not a serum that simply carried over from the last level.
    this.serial = (this.serial ?? 0) + 1;
    this.active.set(type, { remaining: def.duration, duration: def.duration, serial: this.serial });
    if (type === "shield") this.shieldCharges = def.charges;
    // Works at once (the host adds the spheres).
    if (def.instant) this.onInstant?.(type, def);
    // The host shows it (src/ui/powerup-banner.js).
    this.onActivate?.(type);
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
    return [...this.active].map(([type, s]) => ({
      ...SERUMS[type], remaining: s.remaining, ratio: s.remaining / s.duration, serial: s.serial,
      ...(type === "shield" ? { charges: this.shieldCharges } : {}),
    }));
  }
}
