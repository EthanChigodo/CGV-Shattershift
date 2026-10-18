/**
 * A police helicopter going down. A blast catches its tail and the tail
 * rotor goes; with nothing cancelling the main rotor's torque it spins,
 * faster and faster, trailing black smoke and flame as it drops - into the
 * side of a tower: a fireball, the wreck through the facade, and a hole
 * that burns on (DemolitionBuilding.punch). Helicopters only.
 *
 *   const craft = police.release(1);              // police-helicopters.js
 *   const crash = new HeliCrash({ fx, craft });
 *   crash.onEvent = (name, info) => {};           // "hit", "impact"
 *   crash.start({ stage, target, building });     // flies to `stage`, waits
 *   crash.hit();                                  // (or { hitAt } in start)
 *   crash.update(dt);                             // every frame
 *
 * It flies the craft's own holder (the police model, its strobes still
 * going) in its parent's frame, which is the scene's. The fire and smoke
 * are the DemolitionFX's particles: no lights, nothing new to compile.
 */

import * as THREE from "../three.js";

/** Seconds from the hit to the impact, and how fast the spin gets (rad/s). */
const SPIN_SECONDS = 3.4;
const SPIN_START = 2.2;
const SPIN_END = 9.5;
/** Where on the craft the fire is: the engines, behind the rotor (the model's frame: nose -Z). */
const ENGINE = new THREE.Vector3(0, 2.6, 1.6);
const TAIL = new THREE.Vector3(0, 2.2, 6.5);

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = THREE.MathUtils.smoothstep;

export class HeliCrash {
  /**
   * @param {object} o
   * @param {import("./demolition.js").DemolitionFX} o.fx
   * @param {{holder: THREE.Object3D, mainHub?: THREE.Object3D, tailHub?: THREE.Object3D}} o.craft
   */
  constructor({ fx, craft }) {
    this.fx = fx;
    this.craft = craft;
    this.phase = "idle";
    this.t = 0;
    this.onEvent = null;
    this._yaw = 0;
    this._trail = null;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");
  }

  get done() { return this.phase === "done"; }

  /**
   * @param {object} o
   * @param {THREE.Vector3} o.stage     where it holds before it's hit
   * @param {THREE.Vector3} o.target    the point on the facade it goes into
   * @param {import("./demolition.js").DemolitionBuilding} [o.building]  the tower it hits
   * @param {THREE.Vector3} [o.look]    what it faces while it holds (its searchlight's business)
   * @param {number} [o.approach]       seconds to get to `stage`
   * @param {number} [o.hitAt]          seconds after start it's hit (null: wait for hit())
   */
  start({ stage, target, building = null, look = null, approach = 3.2, hitAt = null }) {
    const h = this.craft.holder;
    this.stage = stage.clone();
    this.target = target.clone();
    this.building = building;
    this.look = look?.clone() ?? null;
    this.approach = approach;
    this.hitAt = hitAt;
    this._from.copy(h.position);
    // A swoop down into place: over a point above the stage, then in.
    this._mid.copy(this._from).lerp(this.stage, 0.6).setY(Math.max(this._from.y, this.stage.y) + 4);
    this._yaw = h.rotation.y;
    this.phase = "approach";
    this.t = 0;
    h.visible = true;
  }

  /** The blast catches it: the tail goes, the spin starts. */
  hit() {
    if (this.phase !== "approach" && this.phase !== "hold") return;
    const h = this.craft.holder;
    const fx = this.fx;
    this.phase = "spin";
    this.t = 0;
    this._spinFrom = h.position.clone();
    // The way it goes: toward the tower, swinging out wide first.
    const to = this._v.copy(this.target).sub(this._spinFrom);
    const side = new THREE.Vector3(-to.z, 0, to.x).normalize().multiplyScalar(to.length() * 0.35);
    this._spinMid = this._spinFrom.clone().lerp(this.target, 0.45).add(side).setY(this._spinFrom.y + 2);
    const tail = h.localToWorld(TAIL.clone());
    fx.flash(tail, 10, 3, 0.25);
    fx.fireball(tail, 8, { life: 1.3, intensity: 1.4 });
    fx.debris(tail, this._v.set(0, 0.4, 0).add(h.getWorldDirection(this._w)), 12, 8, { metal: 0.7, glass: 0.2, size: 0.45 });
    fx.embers(tail, 16, 7);
    // The tail rotor is gone.
    const tailHub = this.craft.tailHub ?? h.getObjectByName("TailHub");
    if (tailHub) tailHub.visible = false;
    this._trail = fx.trail(h, { offset: ENGINE });
    this._tailSmoke = fx.trail(h, { offset: TAIL, fire: 0.3, smoke: 0.7 });
    this.onEvent?.("hit", { position: tail.clone() });
  }

  _impact() {
    const h = this.craft.holder;
    const fx = this.fx;
    const at = this.target;
    this.phase = "done";
    h.visible = false;
    this._trail?.stop();
    this._tailSmoke?.stop();
    const out = this._v.copy(this._spinFrom).sub(at).setY(0).normalize();
    fx.flash(at, 34, 4, 0.35);
    for (let k = 0; k < fx.n(5, 3); k += 1) {
      const p = this._w.copy(at).addScaledVector(out, rand(1, 4)).add(new THREE.Vector3(rand(-4, 4), rand(-2, 4), rand(-4, 4)));
      fx.fireball(p.clone(), rand(12, 20), { velocity: out.clone().multiplyScalar(rand(2, 6)).setY(rand(1, 3)), life: rand(1.8, 2.6), intensity: 1.4 });
    }
    fx.debris(at, out.clone().setY(0.3), 36, 13, { metal: 0.45, glass: 0.3, size: 0.6, spread: 0.9, up: 3 });
    fx.glitter(at, out.clone().setY(0.2), 40, 12, { warm: 0.6, spread: 1 });
    fx.embers(at, 30, 10);
    for (let k = 0; k < fx.n(6, 3); k += 1) {
      fx.dust(at.clone().addScaledVector(out, 3), { velocity: out.clone().multiplyScalar(rand(2, 5)).setY(rand(0, 2)), size: [6, rand(18, 26)], life: rand(9, 12), drag: 0.5, rise: rand(2, 3.5), shade: rand(0.05, 0.15), warm: 1 });
    }
    this.building?.punch(at, { radius: 3, size: 1.3 });
    this.onEvent?.("impact", { position: at.clone() });
  }

  update(dt) {
    if (this.phase === "idle" || this.phase === "done") return;
    const h = this.craft.holder;
    this.t += dt;
    const t = this.t;
    const main = this.craft.mainHub ?? h.getObjectByName("MainHub");
    const tail = this.craft.tailHub ?? h.getObjectByName("TailHub");
    if (this.phase === "approach" || this.phase === "hold") {
      const k = smooth(t, 0, this.approach);
      // Along the swoop (a quadratic curve), then holding with a slow bob.
      const a = this._v.copy(this._from).lerp(this._mid, k);
      const b = this._w.copy(this._mid).lerp(this.stage, k);
      const prev = h.position.clone();
      h.position.copy(a.lerp(b, k));
      if (k >= 1) {
        this.phase = "hold";
        h.position.y += Math.sin(t * 1.3) * 0.4;
      }
      // Nose along the way it's going, then round toward what it watches.
      const move = prev.sub(h.position).negate();
      let want = this._yaw;
      if (move.lengthSq() > 1e-4 && k < 0.9) want = Math.atan2(-move.x, -move.z);
      else if (this.look) want = Math.atan2(-(this.look.x - h.position.x), -(this.look.z - h.position.z));
      let d = want - this._yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this._yaw += d * Math.min(1, dt * 2.5);
      this._euler.set(0.12 * (1 - k), this._yaw, Math.max(-0.25, Math.min(0.25, d * 0.6)));
      h.quaternion.setFromEuler(this._euler);
      if (main) main.rotation.y += dt * 38;
      if (tail) tail.rotation.x += dt * 70;
      if (this.hitAt !== null && t >= this.hitAt) this.hit();
      return;
    }
    // The spin: faster and faster, nose dropping, swinging out and down
    // into the tower.
    const u = Math.min(1, t / SPIN_SECONDS);
    const along = Math.pow(u, 1.5);
    const a = this._v.copy(this._spinFrom).lerp(this._spinMid, along);
    const b = this._w.copy(this._spinMid).lerp(this.target, along);
    h.position.copy(a.lerp(b, along));
    h.position.y -= Math.sin(along * Math.PI) * 3;
    this._yaw += dt * (SPIN_START + (SPIN_END - SPIN_START) * u);
    this._euler.set(0.15 + 0.4 * u, this._yaw, Math.sin(t * 4.5) * 0.25 * (0.4 + u));
    h.quaternion.setFromEuler(this._euler);
    if (main) main.rotation.y += dt * (38 - u * 12);
    if (u >= 1) this._impact();
  }

  dispose() {
    this._trail?.stop();
    this._tailSmoke?.stop();
    this.phase = "done";
  }
}
