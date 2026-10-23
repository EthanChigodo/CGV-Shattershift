/**
 * Load-shedding: the grid goes down across the city, and then on the roof.
 *
 * Every South African knows the moment - the warning, the countdown, the
 * whole street going dark at once, the generators coughing on. Here it comes
 * in the middle of the fight:
 *
 *   warning  WARNING s   the notification (the host's card) and the pilot on
 *                        the radio
 *   wave                 district after district goes dark: a front rolling
 *                        out from far across the city toward the roof
 *   dark     about 15 s  the roof's floods die; a red strobe on its battery,
 *                        the helicopters' searchlights, the launcher's torch
 *                        and the spheres as flares are the light
 *   restore              power back in a second front, a flicker, and a
 *                        transformer going off in a fountain of sparks
 *
 * (A real slot is two to four hours; this is the moment, compressed.)
 *
 * The city's shaders all read one thing, `uniforms.uGrid` = (origin x,
 * origin z, how far the outage has reached, how far power is back): a light
 * the outage front has passed and the restore front hasn't is off - and it
 * stutters at the fronts. `power(x, z)` is the same in JavaScript, for the
 * lights that aren't shaders. No light is ever added or removed (that would
 * recompile shaders mid-fight): they're dimmed.
 *
 *   const shed = new LoadShedding({ stage: 6 });
 *   shed.start();                 // the warning; the rest follows
 *   shed.update(dt)               // -> events this frame
 *   shed.darkness                 // the roof's: 0 lit .. 1 dark
 *   shed.power(x, z)              // 0 off .. 1 on, anywhere in the city
 */

import * as THREE from "../../three.js";

export const WARNING = 20;
/** The front's speed across the city (m/s). */
const FRONT = 140;
/** Where the outage starts, far across the city from the roof (x, z). */
const ORIGIN = new THREE.Vector2(-420, -330);
const RESTORE_FLICKER = 1.6;

export class LoadShedding {
  /**
   * @param {object} [o]
   * @param {number} [o.stage]    the stage on the warning (2..8)
   * @param {number} [o.seconds]  how long the roof stays dark
   */
  constructor({ stage = 6, seconds = 15 } = {}) {
    this.stage = stage;
    this.seconds = seconds;
    this.phase = "idle";
    this.t = 0;
    this.darkness = 0;
    /** Shared by every shader that goes dark (city.js, cbd.js, ...). */
    this.uniforms = { uGrid: { value: new THREE.Vector4(ORIGIN.x, ORIGIN.y, -1, -1) }, uGridTime: { value: 0 } };
    // When the outage front reaches the roof (the origin of the world).
    this.reach = ORIGIN.length() / FRONT;
    this.count = 0;
  }

  get active() {
    return this.phase !== "idle";
  }

  /** Seconds until the roof goes dark (during the warning). */
  get countdown() {
    return this.phase === "warning" ? Math.max(0, WARNING - this.t) : 0;
  }

  /** The warning; the outage follows WARNING seconds later. */
  start({ stage = this.stage, seconds = this.seconds } = {}) {
    if (this.active) return false;
    this.stage = stage;
    this.seconds = seconds;
    this.phase = "warning";
    this.t = 0;
    this.count += 1;
    this._fired = new Set();
    return true;
  }

  /** 0 (off) .. 1 (on) at (x, z) in the city - the shaders' rule, for lights that aren't shaders. */
  power(x, z) {
    const g = this.uniforms.uGrid.value;
    if (g.z < 0) return 1;
    const d = Math.hypot(x - g.x, z - g.y);
    const off = d < g.z && !(g.w >= 0 && d < g.w);
    if (!off) return 1;
    // At a front, it stutters.
    const front = Math.min(Math.abs(d - g.z), g.w >= 0 ? Math.abs(d - g.w) : 1e9);
    if (front < 14) return Math.sin(this.uniforms.uGridTime.value * 40 + d) > 0.3 ? 1 : 0;
    return 0;
  }

  /** @returns {{kind:string}[]} what happened this frame: warning, wave, off, on, transformer, done */
  update(dt) {
    const out = [];
    const once = (kind, extra = {}) => {
      if (this._fired.has(kind)) return;
      this._fired.add(kind);
      out.push({ kind, ...extra });
    };
    this.uniforms.uGridTime.value += dt;
    if (!this.active) return out;
    this.t += dt;
    const t = this.t;
    const g = this.uniforms.uGrid.value;
    // The outage front sets out so it reaches the roof as the warning ends.
    const outAt = WARNING - this.reach;
    const offAt = WARNING;
    const onAt = offAt + this.seconds;
    once("warning", { stage: this.stage, seconds: WARNING });
    g.z = t > outAt ? (t - outAt) * FRONT : -1;
    if (t > outAt) once("wave");
    // Power back: a second front, from the same side, the roof last.
    const backAt = onAt - this.reach;
    g.w = t > backAt ? (t - backAt) * FRONT : -1;
    if (t >= offAt) once("off");
    // The roof: dark from offAt, stuttering back at onAt, on for good after.
    if (t < offAt) this.darkness = 0;
    else if (t < onAt) this.darkness = THREE.MathUtils.clamp((t - offAt) / 0.15, 0, 1);
    else if (t < onAt + RESTORE_FLICKER) {
      once("transformer");
      this.darkness = Math.sin((t - onAt) * 31) * Math.sin((t - onAt) * 13) > 0.15 ? 0 : 1;
    } else {
      once("on");
      this.darkness = 0;
    }
    // Everything back on, everywhere (the front past the far side of the
    // city, 300 m beyond the roof): done.
    if (t > onAt + RESTORE_FLICKER && g.w > ORIGIN.length() + 320) {
      g.z = -1;
      g.w = -1;
      this.phase = "idle";
      out.push({ kind: "done" });
    }
    if (t >= offAt && t < onAt + RESTORE_FLICKER) this.phase = "dark";
    else if (t > outAt && t < offAt) this.phase = "wave";
    return out;
  }
}

/**
 * The GLSL for a shader that goes dark: `gridPower(xz)` (0 off .. 1 on),
 * reading uGrid / uGridTime as LoadShedding.power() does. Declares them.
 */
export const GRID_GLSL = /* glsl */ `
  uniform vec4 uGrid;
  uniform float uGridTime;
  float gridPower(vec2 xz) {
    if (uGrid.z < 0.0) return 1.0;
    float d = distance(xz, uGrid.xy);
    float off = step(d, uGrid.z) * (1.0 - step(0.0, uGrid.w) * step(d, uGrid.w));
    float front = min(abs(d - uGrid.z), uGrid.w >= 0.0 ? abs(d - uGrid.w) : 1e9);
    float stutter = step(front, 14.0) * step(0.3, sin(uGridTime * 40.0 + d));
    return 1.0 - off * (1.0 - stutter);
  }
`;
