/**
 * The menu stage's camera: named shots, eased between, each with a slow
 * living drift.
 *
 * A shot is written as a place to stand and what must land where on the
 * screen - "Subject 07's head at 30% from the top, feet at 87%, centred at
 * 70% across" - and the camera's yaw, pitch and lens are solved from that
 * for the viewport's aspect (a few rounds of project-and-correct). So the
 * menu's text column on the left stays clear on any screen shape, and the
 * figure stands where the menu's "Subject 07" line expects it.
 *
 * Between shots: 2.6 s, ease-in-out; near the figure the camera swings
 * round it (it never cuts through the body), the view turning with it. With
 * reduced motion there is no flight: a short dip through dark, a cut.
 * In every shot the camera breathes: a few centimetres of hand-held drift,
 * a fraction of a degree of sway (much less with reduced motion).
 */

import * as THREE from "../three.js";

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The shots. `figure` framing: [centre x, head y, feet y] (0..1, from the top left). */
export const SHOTS = {
  // Establishing: low behind Subject 07, the tower burning beyond; the menu
  // text sits in the calm left 40% (sky and smoke).
  title: { from: [-1.55, 1.0, 4.3], figure: [0.7, 0.3, 0.875], attention: 0.35, drift: 1 },
  // Close on Subject 07, three-quarter front, lit by the fire: the controls
  // stand in a column on the right.
  appearance: { from: [-1.35, 1.2, 3.4], local: true, figure: [0.47, 0.13, 0.92], attention: 0.95, drift: 0.6 },
  // Low behind them, looking up at the burning floors.
  newgame: { from: [0.55, 0.32, -1.75], local: true, aim: "fire", screen: [0.6, 0.27], fov: 50, attention: 0.05, drift: 1 },
  // A long lens up the tower's burning top, the tower in the right half.
  chapters: { at: [-3.5, 1.6, -5.4], aim: "fireTilt", screen: [0.68, 0.48], fov: 21, attention: 0.2, drift: 0.8 },
  // Wide over the city from the corner of the roof.
  endless: { at: [-14.6, 3.6, -5.2], aim: "tower", screen: [0.7, 0.5], fov: 62, attention: 0.2, drift: 1, pan: 0.04 },
  // Dense pages (settings, manual, credits, a report): the title shot,
  // pulling slowly out, the picture dimmed behind the text.
  dim: { from: [-2.4, 1.5, 7.6], figure: [0.72, 0.42, 0.72], attention: 0.2, drift: 0.7, dim: 0.62, pull: 0.11 },
  // Versus (its lobby is its own overlay): along the parapet, the tower ahead.
  versus: { at: [11.2, 1.9, 1.5], aim: "tower", screen: [0.42, 0.45], fov: 44, attention: 0.15, drift: 0.8, dim: 0.25 },
};

export class ShotRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} world  { subject: Vector3, facing: number (yaw), figureHeight, fire: Vector3, fireTop: Vector3, tower: Vector3 }
   */
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.name = "title";
    this.from = null;
    this.to = null;
    this.t = 1;
    this.duration = 2.6;
    this.reducedMotion = false;
    this.time = 0;
    this.dim = 0;
    this.attention = SHOTS.title.attention;
    this._probe = new THREE.PerspectiveCamera();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.current = this._solve("title");
    this._apply(this.current, 0);
  }

  /** A shot's camera state { position, yaw, pitch, fov }. */
  _solve(name, time = this.time) {
    const s = SHOTS[name] ?? SHOTS.title;
    const w = this.world;
    const position = new THREE.Vector3();
    if (s.at) position.fromArray(s.at);
    else {
      const offset = new THREE.Vector3().fromArray(s.from);
      if (s.local) offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), w.facing);
      position.copy(w.subject).add(offset);
    }
    if (s.pull) position.addScaledVector(position.clone().sub(w.subject).setY(0).normalize(), Math.min(4, time * s.pull));
    const cam = this._probe;
    cam.aspect = this.camera.aspect;
    cam.position.copy(position);
    cam.rotation.order = "YXZ";
    let fov = s.fov ?? 40;
    let yaw = 0;
    let pitch = 0;
    // Start looking at whatever is to be framed.
    const anchor = new THREE.Vector3();
    let sx = 0.5;
    let sy = 0.5;
    let top = null;
    let bottom = null;
    let ty = 0;
    let by = 0;
    if (s.figure) {
      top = w.subject.clone().setY(w.figureHeight + 0.04);
      bottom = w.subject.clone().setY(-0.02);
      anchor.copy(w.subject).setY(w.figureHeight * 0.5);
      [sx, ty, by] = s.figure;
      sy = (ty + by) / 2;
    } else {
      if (s.aim === "fire") anchor.copy(w.fire);
      else if (s.aim === "tower") anchor.copy(w.tower).setY(w.fire.y - 30);
      else if (s.aim === "fireTilt") {
        // Up the burning floors to the crown and back, very slowly.
        const k = 0.5 - 0.5 * Math.cos(time * 0.05);
        anchor.copy(w.fire).lerp(w.fireTop, k);
      }
      [sx, sy] = s.screen;
      if (s.pan) sx += Math.sin(time * s.pan) * 0.06;
    }
    const d = anchor.clone().sub(position);
    yaw = Math.atan2(-d.x, -d.z);
    pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const ndc = new THREE.Vector3();
    for (let i = 0; i < 24; i += 1) {
      cam.fov = fov;
      cam.rotation.set(pitch, yaw, 0);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      if (top) {
        // Lens from the figure's height on screen, pitch from where it sits.
        const a = ndc.copy(top).project(cam);
        const b = this._v.copy(bottom).project(cam);
        const span = (a.y - b.y) / 2;
        const want = by - ty;
        fov = THREE.MathUtils.clamp(fov * Math.pow(span / want, 0.9), 12, 80);
        const mid = (a.y + b.y) / 2;
        pitch += (mid - (1 - sy * 2)) * THREE.MathUtils.degToRad(fov) * 0.45;
        const c = this._v.copy(anchor).project(cam);
        yaw -= (c.x - (sx * 2 - 1)) * THREE.MathUtils.degToRad(fov) * cam.aspect * 0.45;
      } else {
        const c = ndc.copy(anchor).project(cam);
        yaw -= (c.x - (sx * 2 - 1)) * THREE.MathUtils.degToRad(fov) * cam.aspect * 0.45;
        pitch += (c.y - (1 - sy * 2)) * THREE.MathUtils.degToRad(fov) * 0.45;
      }
    }
    return { position, yaw, pitch, fov, name };
  }

  /** Ease to a shot (no-op if already there or on the way). */
  setShot(name) {
    if (!SHOTS[name]) name = "title";
    if (name === this.name && this.t < 1) return;
    if (name === this.name) return;
    this.name = name;
    this.from = this._snapshot();
    this.t = 0;
    this.duration = this.reducedMotion ? 0.9 : 2.6;
    this.shotTime = 0;
  }

  /** Jump straight to a shot (a cut). */
  cut(name) {
    this.name = SHOTS[name] ? name : "title";
    this.t = 1;
    this.shotTime = 0;
  }

  _snapshot() {
    const c = this.current;
    return { position: c.position.clone(), yaw: c.yaw, pitch: c.pitch, fov: c.fov };
  }

  /** 0..1, a dip to dark the host should apply (reduced motion's cut). */
  get dip() {
    if (!this.reducedMotion || this.t >= 1) return 0;
    return Math.sin(Math.PI * this.t);
  }

  update(dt, time) {
    this.time = time;
    this.shotTime = (this.shotTime ?? 0) + dt;
    const s = SHOTS[this.name] ?? SHOTS.title;
    const target = this._solve(this.name, this.shotTime);
    let state = target;
    if (this.t < 1 && this.from) {
      this.t = Math.min(1, this.t + dt / this.duration);
      if (this.reducedMotion) {
        // Through dark: hold the old shot, cut at the middle.
        state = this.t < 0.5 ? this.from : target;
      } else {
        const k = ease(this.t);
        const f = this.from;
        const w = this.world;
        const pivot = this._v.copy(w.subject);
        // Round the figure: interpolate angle and distance about it, so the
        // camera swings past rather than through them.
        const a0 = Math.atan2(f.position.x - pivot.x, f.position.z - pivot.z);
        const a1 = Math.atan2(target.position.x - pivot.x, target.position.z - pivot.z);
        let da = a1 - a0;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const r0 = Math.hypot(f.position.x - pivot.x, f.position.z - pivot.z);
        const r1 = Math.hypot(target.position.x - pivot.x, target.position.z - pivot.z);
        const near = Math.max(r0, r1) < 14;
        const position = new THREE.Vector3();
        if (near) {
          const a = a0 + da * k;
          const r = r0 + (r1 - r0) * k;
          // Lift a little mid-move (over the parapet's coping, never through it).
          const lift = Math.sin(Math.PI * k);
          const y = f.position.y + (target.position.y - f.position.y) * k;
          position.set(pivot.x + Math.sin(a) * r, Math.max(y + lift * 0.35, y * (1 - lift) + 1.4 * lift), pivot.z + Math.cos(a) * r);
        } else position.copy(f.position).lerp(target.position, k);
        let dy = target.yaw - f.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        state = { position, yaw: f.yaw + dy * k, pitch: f.pitch + (target.pitch - f.pitch) * k, fov: f.fov + (target.fov - f.fov) * k };
      }
    }
    this.current = state;
    // Dim and the figure's attention follow the shot.
    const k = 1 - Math.exp(-dt * 1.5);
    this.dim += ((s.dim ?? 0) - this.dim) * k;
    this.attention = s.attention ?? 0.3;
    this._apply(state, (s.drift ?? 1) * (this.reducedMotion ? 0.2 : 1), time);
  }

  _apply(state, drift = 0, time = 0) {
    const c = this.camera;
    c.rotation.order = "YXZ";
    // Hand-held: sums of slow sines at unrelated rates, never a loop you notice.
    const t = time;
    const dx = (Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.91 + 1.3) * 0.4) * 0.025 * drift;
    const dy = (Math.sin(t * 0.29 + 2.1) * 0.6 + Math.sin(t * 0.77) * 0.4) * 0.018 * drift;
    const dz = Math.sin(t * 0.21 + 0.7) * 0.03 * drift;
    const ry = (Math.sin(t * 0.33 + 0.4) * 0.7 + Math.sin(t * 1.13) * 0.3) * 0.0022 * drift;
    const rx = (Math.sin(t * 0.27 + 1.7) * 0.7 + Math.sin(t * 0.97 + 0.2) * 0.3) * 0.0016 * drift;
    const rz = Math.sin(t * 0.19 + 0.9) * 0.0012 * drift;
    c.position.copy(state.position);
    c.position.x += dx;
    c.position.y += dy;
    c.position.z += dz;
    c.rotation.set(state.pitch + rx, state.yaw + ry, rz);
    if (Math.abs(c.fov - state.fov) > 1e-3) {
      c.fov = state.fov;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld(true);
  }

  /** The viewport changed: the shots are solved for its aspect. */
  resize() {
    this.camera.updateProjectionMatrix();
  }
}
