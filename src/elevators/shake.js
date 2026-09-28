/**
 * Camera shake driven by "trauma".
 *
 * Events add trauma (0..1) - a tremor a little, the brakes slamming on a
 * lot - and it drains away on its own. The shake is trauma squared, so small
 * knocks stay subtle and big ones are violent. It moves AND rotates the
 * camera (a real hand-held camera mostly rotates), using smooth noise rather
 * than Math.random(), so it reads as a heavy lift juddering rather than a
 * buzzing image.
 *
 * `kick()` is separate: a one-off jolt in a direction (the floor dropping
 * away, the brakes slamming) that springs back.
 *
 *   const shake = new CameraShake({ reduced });
 *   shake.add(0.4);                  // a tremor
 *   shake.kick(0, -0.25, 0);         // lurch down
 *   shake.update(dt);
 *   shake.apply(camera);             // after the camera is placed and aimed
 */

import * as THREE from "../three.js";

/** Smooth 1D noise from a few incommensurate sines (cheap, no tables). */
function wobble(t, seed) {
  return (Math.sin(t * 1.9 + seed) * 0.5 + Math.sin(t * 3.7 + seed * 2.3) * 0.3 + Math.sin(t * 7.3 + seed * 5.1) * 0.2);
}

export class CameraShake {
  /** @param {object} [o] @param {boolean} [o.reduced]  the Reduced motion setting */
  constructor({ reduced = false } = {}) {
    this.scale = reduced ? 0.3 : 1;
    this.trauma = 0;
    /** Continuous floor for trauma (a lift that keeps juddering). */
    this.floor = 0;
    this.time = 0;
    this.kickPos = new THREE.Vector3();
    this.kickVel = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._q = new THREE.Quaternion();
  }

  add(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A jolt in world metres, which springs back. */
  kick(x, y, z) {
    this.kickVel.x += x * 18;
    this.kickVel.y += y * 18;
    this.kickVel.z += z * 18;
  }

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(this.floor, this.trauma - dt * 0.9);
    // Damped spring back to rest.
    const k = 90;
    const c = 14;
    this.kickVel.addScaledVector(this.kickPos, -k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
    this.kickPos.addScaledVector(this.kickVel, dt);
  }

  /** Offset the camera. Call after it has been positioned and aimed. */
  apply(camera) {
    const s = this.trauma * this.trauma * this.scale;
    const t = this.time * 9;
    if (s > 1e-4) {
      camera.position.x += wobble(t, 1.1) * 0.12 * s;
      camera.position.y += wobble(t, 4.2) * 0.1 * s;
      camera.position.z += wobble(t, 7.7) * 0.05 * s;
      this._e.set(wobble(t, 2.9) * 0.05 * s, wobble(t, 5.3) * 0.05 * s, wobble(t, 8.8) * 0.07 * s, "YXZ");
      camera.quaternion.multiply(this._q.setFromEuler(this._e));
    }
    if (this.kickPos.lengthSq() > 1e-8) {
      camera.position.addScaledVector(this.kickPos, this.scale);
    }
  }
}
