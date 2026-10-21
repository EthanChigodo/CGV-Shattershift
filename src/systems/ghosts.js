/**
 * Ghost runs: your best run, recorded, runs beside you as a see-through
 * figure - race yourself.
 *
 * A track is one place at one difficulty: "story:foundry:normal",
 * "endless:labs:hard" ... Each run on it is recorded ten times a second -
 * time, distance along the route, how far across, how high, sliding - and
 * kept (in this browser) if it beats the ghost there:
 *   the story    the fastest time through the sector
 *   Endless      the furthest run
 *
 *   const rec = new GhostRecording(key, look);
 *   rec.add(t, distance, lateral, height, sliding);   // every frame
 *   saveGhostIfBetter(rec, { time } | { distance });
 *
 *   const ghost = new Ghost(loadGhost(key), template);   // a PlayerAvatar, see-through
 *   const s = ghost.at(t);   // { d, x, h, slide, done }
 *   ghost.place(position, heading, s, dt);
 */

import * as THREE from "../three.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";

const RATE = 10; // samples a second
const STRIDE = 5; // t, d, x, h, slide
const PREFIX = "fractureRun.ghost.";

export class GhostRecording {
  constructor(key, look = {}) {
    this.key = key;
    this.look = look;
    this.samples = [];
    this._next = 0;
    this.t = 0;
  }

  add(t, d, x, h, slide) {
    this.t = t;
    if (t < this._next) return;
    this._next = t + 1 / RATE;
    this.samples.push(+t.toFixed(2), +d.toFixed(2), +x.toFixed(2), +h.toFixed(2), slide ? 1 : 0);
  }

  get distance() {
    return this.samples.length ? this.samples[this.samples.length - STRIDE + 1] : 0;
  }
}

export function loadGhost(key) {
  try {
    const g = JSON.parse(localStorage.getItem(PREFIX + key) ?? "null");
    return g && Array.isArray(g.samples) && g.samples.length >= STRIDE * 2 ? g : null;
  } catch {
    return null;
  }
}

/** Keep this run if it beats the ghost: faster ({ time }) or further ({ distance }). True if kept. */
export function saveGhostIfBetter(rec, { time = null, distance = null }) {
  if (!rec || rec.samples.length < STRIDE * 20) return false;
  const old = loadGhost(rec.key);
  const better = !old || (time !== null ? time < (old.time ?? Infinity) : distance > (old.distance ?? 0));
  if (!better) return false;
  const data = { v: 1, key: rec.key, when: Date.now(), time: time ?? rec.t, distance: distance ?? rec.distance, look: rec.look, samples: rec.samples };
  try { localStorage.setItem(PREFIX + rec.key, JSON.stringify(data)); } catch { return false; }
  return true;
}

export function clearGhosts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {}
}

/** A recorded run, played back as a see-through figure. */
export class Ghost {
  constructor(data, template) {
    this.data = data;
    this.s = data.samples;
    this.n = this.s.length / STRIDE;
    this.duration = this.s[(this.n - 1) * STRIDE];
    this.avatar = new PlayerAvatar();
    this.avatar.hold = 0;
    this.avatar.idleStyle = false;
    const look = data.look ?? {};
    if (look.skin) this.avatar.setSkinTone(look.skin);
    this.avatar.setHairColour(look.hair ?? "natural");
    if (look.outfit) this.avatar.setOutfit(look.outfit);
    if (look.headwear) this.avatar.setHeadwear(look.headwear);
    if (look.shoes) this.avatar.setShoes(look.shoes);
    if (template) this.avatar.setModel(template);
    this.avatar.shadow.visible = false;
    // See-through and cold: a ghost, not a rival.
    this.avatar.root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.transparent = true;
        m.opacity = 0.34;
        m.depthWrite = false;
        if (m.emissive) { m.emissive = new THREE.Color(0x4fd8ff); m.emissiveIntensity = 0.55; }
        m.needsUpdate = true;
      }
      o.renderOrder = 3;
      o.castShadow = false;
    });
    this.root = this.avatar.root;
    this.root.name = "Ghost";
    this.root.visible = false;
    this._out = { d: 0, x: 0, h: 0, slide: false, done: false, speed: 0 };
    this._i = 0;
  }

  /** Where the ghost was `t` seconds in (interpolated); `done` once its run is over. */
  at(t) {
    const s = this.s;
    const o = this._out;
    if (t >= this.duration) {
      const k = (this.n - 1) * STRIDE;
      Object.assign(o, { d: s[k + 1], x: s[k + 2], h: s[k + 3], slide: s[k + 4] > 0, done: true, speed: 0 });
      return o;
    }
    // (Usually just after where it was last time.)
    if (this._i >= this.n - 1 || s[this._i * STRIDE] > t) this._i = 0;
    while (this._i < this.n - 2 && s[(this._i + 1) * STRIDE] <= t) this._i += 1;
    const a = this._i * STRIDE;
    const b = a + STRIDE;
    const k = Math.min(1, Math.max(0, (t - s[a]) / Math.max(1e-4, s[b] - s[a])));
    o.d = s[a + 1] + (s[b + 1] - s[a + 1]) * k;
    o.x = s[a + 2] + (s[b + 2] - s[a + 2]) * k;
    o.h = s[a + 3] + (s[b + 3] - s[a + 3]) * k;
    o.slide = (k < 0.5 ? s[a + 4] : s[b + 4]) > 0;
    o.speed = (s[b + 1] - s[a + 1]) / Math.max(1e-4, s[b] - s[a]);
    o.done = false;
    return o;
  }

  /** Put it in the world at `position` facing `heading`, running as the sample says. */
  place(position, heading, sample, dt) {
    this.root.position.copy(position);
    this.root.rotation.y = heading;
    this.avatar.update(dt, { speed: sample.speed, height: sample.h, sliding: sample.slide });
  }

  dispose() {
    this.root.removeFromParent();
  }
}
