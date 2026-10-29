/**
 * The launcher's charged shot (the Labs on): the launcher fires when the
 * trigger comes up - a click is a plain shot; held, it charges first, and
 * let go the sphere goes out charged - the
 * longer the hold, the faster, flatter and bigger it flies, the harder and
 * wider it bursts where it lands (chargedShot(level); the levels' own code:
 * main.js detonate, meltdown/game.js _overcharge), and the stronger the air
 * stripes round it (fx/charge-trail.js, in the launcher design's colours).
 * Less than CHARGE.min of a charge is no charge. It costs CHARGE.cost times
 * the spheres.
 *
 *   const charge = new ChargeShot();
 *   charge.press(colour);                       // the trigger goes down (nothing fired yet)
 *   charge.update(dt, { allowed, affordable, reticle, need });
 *   if (charge.holding) {                       // the trigger comes up:
 *     const level = charge.release();           //   0 (a plain shot), or CHARGE.min..1
 *     level ? fireCharged(level) : fire();
 *   }
 *
 * On screen: a bar under the crosshair that fills, then - full - the picture
 * itself (a part charge: just the release's flash, smaller): drawn in toward the crosshair, its colours split, the edges
 * crackling in the sphere's colour and pulsing; on the release a flash and
 * a ring out from the middle. That part is the post-processing's (postfx.js
 * for the Skyline, meltdown/post.js for the Labs and the Roof): both take
 * CHARGE_GLSL and these same uniform objects, so one update drives both.
 */

import * as THREE from "../three.js";
import { effectsFor } from "../audio/output.js";

export const CHARGE = {
  /** Seconds held before it starts to charge (a click is a plain shot). */
  delay: 0.2,
  /** Seconds to fill. */
  fill: 1.0,
  /** Less than this much charge on the release: no charged shot. */
  min: 0.3,
  /** The spheres it costs, times the type's own. */
  cost: 2,
  /** Metres round where a full one lands that it breaks. */
  splash: 6.5,
};

/**
 * What a charge of `level` (CHARGE.min..1) does, against a plain shot: its
 * speed, its gravity (flatter), its size; the burst's reach (metres) and a
 * direct hit's power (a plain one is 1).
 */
export function chargedShot(level) {
  const l = Math.max(0, Math.min(1, level));
  return {
    speed: 1 + 0.5 * l,
    gravity: 1 - 0.65 * l,
    radius: 1 + 0.7 * l,
    splash: CHARGE.splash * (0.4 + 0.6 * l),
    power: Math.round(2 + 4 * l),
  };
}

/** Shared by every post-processing pass that draws the charge. */
export const CHARGE_UNIFORMS = {
  uCharge: { value: 0 },
  uChargeFull: { value: 0 },
  uChargeBurst: { value: 0 },
  uChargeColour: { value: new THREE.Color(0x9fefff) },
};

/**
 * For a full-screen pass: chargeWarp(uv) before the picture is sampled,
 * chargeSplit() added to its colour split, chargeColour(col, uv, time) on
 * the result (display space).
 */
export const CHARGE_GLSL = /* glsl */ `
uniform float uCharge;
uniform float uChargeFull;
uniform float uChargeBurst;
uniform vec3 uChargeColour;
float chargeRing(vec2 d) {
  float front = (1.0 - uChargeBurst) * 0.95;
  float x = (length(d) - front) * 13.0;
  return exp(-x * x) * uChargeBurst;
}
vec2 chargeWarp(vec2 uv) {
  vec2 d = uv - 0.5;
  // Drawn in toward the crosshair as it builds; a ring out on the release.
  uv -= d * (uCharge * 0.022 + uChargeFull * 0.014);
  uv -= normalize(d + 1e-5) * chargeRing(d) * 0.028;
  return uv;
}
float chargeSplit() {
  return uCharge * 0.004 + uChargeFull * 0.007 + uChargeBurst * 0.012;
}
vec3 chargeColour(vec3 col, vec2 uv, float time) {
  if (uCharge + uChargeBurst < 0.001) return col;
  vec2 d = uv - 0.5;
  float r = length(d * vec2(1.0, 0.78));
  float edge = smoothstep(0.42, 0.9, r);
  float pulse = 0.55 + 0.45 * sin(time * 16.0);
  // Crackle: thin bright filaments flickering round the edge.
  float a = atan(d.y, d.x);
  float fil = pow(abs(sin(a * 17.0 + sin(time * 29.0) * 2.2 + r * 12.0 - time * 9.0)), 90.0);
  col += uChargeColour * edge * (uCharge * 0.3 + uChargeFull * (0.4 * pulse + fil * 0.7));
  col = mix(col, col * (0.75 + 0.5 * uChargeColour), uChargeFull * 0.3);
  col += uChargeColour * (uChargeBurst * uChargeBurst * 0.45 + chargeRing(d) * 0.9);
  return col;
}
`;

function ensureStyles() {
  if (document.querySelector("link[data-charge]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../ui/charge.css", import.meta.url).href;
  link.dataset.charge = "true";
  document.head.appendChild(link);
}

export class ChargeShot {
  constructor({ volume = () => 1, reducedMotion = false } = {}) {
    ensureStyles();
    this.volume = volume;
    this.reducedMotion = reducedMotion;
    this.root = document.createElement("div");
    this.root.className = "charge-meter";
    this.root.innerHTML = `<i class="cm-bar"><i class="cm-fill"></i></i><b class="cm-label"></b>`;
    document.body.appendChild(this.root);
    this.fill = this.root.querySelector(".cm-fill");
    this.label = this.root.querySelector(".cm-label");
    this.holding = false;
    this.held = 0;
    this.level = 0;
    this.burst = 0;
    this._shown = { on: false, full: false, short: false, text: "" };
  }

  get full() {
    return this.level >= 1;
  }

  /** The trigger went down: the shot waits for it to come up. */
  press(colour) {
    this.holding = true;
    this.held = 0;
    this.level = 0;
    if (colour !== undefined) CHARGE_UNIFORMS.uChargeColour.value.set(colour);
  }

  /** The trigger came up: the charge to fire (CHARGE.min..1), or 0 - a plain shot. */
  release() {
    const level = this.holding && this.level >= CHARGE.min ? this.level : 0;
    this.holding = false;
    this.level = 0;
    this._stopHum();
    if (level) {
      this.burst = level >= 1 ? 1 : level * 0.5;
      this._sound("release");
    }
    return level;
  }

  /** Let go of it without a shot (a pause, a cutscene, out of spheres). */
  cancel() {
    this.holding = false;
    this.level = 0;
    this._stopHum();
  }

  /**
   * Each frame. `allowed`: a charge can be had here and now; `affordable`:
   * there are the spheres for it (else the bar says so); `reticle`: the
   * crosshair element it sits under; `need`: the spheres it would cost.
   */
  update(dt, { allowed = false, affordable = true, reticle = null, need = 0 } = {}) {
    if (!allowed && this.holding) this.cancel();
    const wasFull = this.full;
    if (this.holding) {
      this.held += dt;
      if (this.held > CHARGE.delay && affordable) {
        if (this.level === 0) this._startHum();
        this.level = Math.min(1, this.level + dt / CHARGE.fill);
      }
      this._hum(this.level);
    }
    if (this.full && !wasFull) this._sound("full");
    this.burst = Math.max(0, this.burst - dt * 2.4);

    // The picture (post-processing): eased, so it swells and settles.
    const u = CHARGE_UNIFORMS;
    const k = Math.min(1, dt * 10);
    const scale = this.reducedMotion ? 0.35 : 1;
    u.uCharge.value += (this.level * scale - u.uCharge.value) * k;
    u.uChargeFull.value += ((this.full ? 1 : 0) * scale - u.uChargeFull.value) * k;
    u.uChargeBurst.value = this.burst * scale;

    // The bar, under the crosshair.
    const charging = this.holding && this.held > CHARGE.delay;
    const short = charging && !affordable;
    const on = charging && allowed;
    const text = short ? `NEEDS ${need}` : this.full ? "CHARGED - LET GO" : "CHARGING";
    const s = this._shown;
    if (on !== s.on) { s.on = on; this.root.classList.toggle("on", on); }
    if (this.full !== s.full) { s.full = this.full; this.root.classList.toggle("full", this.full); }
    if (short !== s.short) { s.short = short; this.root.classList.toggle("short", short); }
    if (text !== s.text) { s.text = text; this.label.textContent = text; }
    if (on) {
      this.fill.style.transform = `scaleX(${this.level.toFixed(3)})`;
      this.root.style.setProperty("--c", `#${u.uChargeColour.value.getHexString()}`);
      if (reticle) {
        this.root.style.left = reticle.style.left;
        this.root.style.top = reticle.style.top;
      }
    }
  }

  /* ---- sound: a rising hum, a ping when full, a thump on the release ---- */

  _ctx() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  _startHum() {
    const ctx = this._ctx();
    const level = 0.05 * Math.max(0, Math.min(1, this.volume()));
    if (!ctx || !level || this.humOsc) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = 90;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.15);
    o.connect(f).connect(g).connect(effectsFor(ctx));
    o.start();
    this.humOsc = o;
    this.humGain = g;
  }

  _hum(level) {
    if (!this.humOsc) return;
    this.humOsc.frequency.setTargetAtTime(90 + level * 260, this.ctx.currentTime, 0.05);
  }

  _stopHum() {
    if (!this.humOsc) return;
    const { ctx, humOsc: o, humGain: g } = this;
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    o.stop(ctx.currentTime + 0.2);
    this.humOsc = null;
    this.humGain = null;
  }

  _sound(kind) {
    const ctx = this._ctx();
    const level = 0.14 * Math.max(0, Math.min(1, this.volume()));
    if (!ctx || !level) return;
    const t = ctx.currentTime;
    const notes = kind === "full" ? [[880, 0], [1320, 0.07]] : [[160, 0], [80, 0]];
    for (const [freq, at] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === "full" ? "sine" : "triangle";
      o.frequency.setValueAtTime(freq, t + at);
      if (kind !== "full") o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(level, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + at + (kind === "full" ? 0.6 : 0.4));
      o.connect(g).connect(effectsFor(ctx));
      o.start(t + at);
      o.stop(t + at + 0.7);
    }
  }

  dispose() {
    this.cancel();
    this.root.remove();
  }
}
