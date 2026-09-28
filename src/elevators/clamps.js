/**
 * The brake clamps: the brief's three stabilisers, and the ride's one piece
 * of gameplay.
 *
 * After the emergency stop the brakes are slipping. Three clamps on the
 * cabin frame - two gripping the front rails, one on the cable governor on
 * the roof - glow red and spark. Each one hit with a launcher ball locks
 * (it turns cyan). Balls fly straight from the launcher's muzzle; aim
 * assist picks the clamp nearest the crosshair on screen, so it works the
 * same through the perspective and the orthographic cameras.
 *
 *   const clamps = new BrakeClamps(cabin.root, scene);
 *   clamps.aim(camera, pointer);     // -> the clamp under the crosshair, or null
 *   clamps.fire(from, camera, pointer);
 *   clamps.update(dt, time);         // returns the index locked this frame, or -1
 */

import * as THREE from "../three.js";
import { CABIN } from "./kit.js";
import { MARK } from "./diagnostic.js";

/** Cabin-frame positions: front-left rail, front-right rail, the cable governor. */
const R = CABIN.half + 0.42;
export const CLAMP_POSITIONS = [
  new THREE.Vector3(-R, 1.2, -R),
  new THREE.Vector3(R, 1.2, -R),
  new THREE.Vector3(0, CABIN.height + 0.3, -(CABIN.half - 0.4)),
];
const HIT_RADIUS = 0.42;
const ASSIST = 0.14;
const BALL_SPEED = 38;

const _v = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export class BrakeClamps {
  constructor(parent, world) {
    this.parent = parent;
    this.world = world;
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const housing = own(new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.75, roughness: 0.4 }));
    const coreGeo = own(new THREE.SphereGeometry(0.13, 16, 12));
    // Wider than the jaws, so it shows from straight above too.
    const ringGeo = own(new THREE.TorusGeometry(0.3, 0.045, 8, 28));
    // Two jaws with the glowing core between them, so it reads from any
    // side - inside the cabin, outside it, and from straight above.
    const jawGeo = own(new THREE.BoxGeometry(0.4, 0.1, 0.4));
    this.clamps = CLAMP_POSITIONS.map((p, index) => {
      const root = new THREE.Group();
      root.name = `BrakeClamp${index}`;
      root.position.copy(p);
      const jaws = [0.19, -0.19].map((y) => {
        const jaw = new THREE.Mesh(jawGeo, housing);
        jaw.position.y = y;
        return jaw;
      });
      const coreMat = own(new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
      const core = new THREE.Mesh(coreGeo, coreMat);
      const ringMat = own(new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      root.add(...jaws, core, ring);
      root.visible = false;
      parent.add(root);
      return { root, core, ring, coreMat, ringMat, locked: false, lockT: 0, index };
    });

    const ballMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.4, 2.4) }));
    const ballGeo = own(new THREE.SphereGeometry(0.09, 12, 10));
    this.balls = [];
    this._ballMat = ballMat;
    this._ballGeo = ballGeo;
    this.active = false;
  }

  /** The clamps appear (and start glowing) when the brakes begin to slip. */
  show() {
    this.active = true;
    for (const c of this.clamps) c.root.visible = true;
  }

  get locked() {
    return this.clamps.filter((c) => c.locked).length;
  }

  /** World position of a clamp's core. */
  worldPosition(clamp, target = new THREE.Vector3()) {
    return clamp.core.getWorldPosition(target);
  }

  /** The unlocked clamp nearest the crosshair on screen, within the assist radius. */
  aim(camera, pointer) {
    let best = null;
    let bestD = ASSIST;
    for (const c of this.clamps) {
      if (c.locked) continue;
      this.worldPosition(c, _ndc).project(camera);
      if (_ndc.z > 1) continue;
      const d = Math.hypot(_ndc.x - pointer.x, _ndc.y - pointer.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Fire a ball from `from` (world) at the crosshair (or the assisted clamp). */
  fire(from, camera, pointer) {
    const target = this.aim(camera, pointer);
    const to = new THREE.Vector3();
    if (target) this.worldPosition(target, to);
    else {
      _ray.setFromCamera(pointer, camera);
      to.copy(_ray.ray.origin).addScaledVector(_ray.ray.direction, 14);
    }
    const mesh = new THREE.Mesh(this._ballGeo, this._ballMat);
    mesh.layers.enable(MARK);
    mesh.position.copy(from);
    this.world.add(mesh);
    const velocity = to.sub(from).normalize().multiplyScalar(BALL_SPEED);
    this.balls.push({ mesh, velocity, life: 1.2 });
    return target;
  }

  /** @returns {number} the index of a clamp locked this frame, or -1 */
  update(dt, time) {
    let lockedNow = -1;
    for (let i = this.balls.length - 1; i >= 0; i -= 1) {
      const b = this.balls[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.velocity, dt);
      let hit = null;
      for (const c of this.clamps) {
        if (c.locked) continue;
        if (this.worldPosition(c, _v).distanceTo(b.mesh.position) < HIT_RADIUS) hit = c;
      }
      if (hit) {
        this.lock(hit);
        lockedNow = hit.index;
        b.life = 0;
      }
      if (b.life <= 0) {
        b.mesh.removeFromParent();
        this.balls.splice(i, 1);
      }
    }
    // Unlocked: red, pulsing, the ring spinning loose. Locked: steady cyan.
    for (const c of this.clamps) {
      if (c.locked) {
        c.lockT += dt;
        const k = Math.min(1, c.lockT / 0.25);
        c.coreMat.color.setRGB(0.4 + 1.6 * (1 - k), 2.2, 2.2);
        c.ringMat.color.setRGB(0.3, 1.6, 1.6);
      } else if (this.active) {
        const pulse = 0.55 + 0.45 * Math.sin(time * 10 + c.index * 2);
        c.coreMat.color.setRGB(2.4 * pulse, 0.15 * pulse, 0.08);
        c.ringMat.color.setRGB(1.6 * pulse, 0.1, 0.05);
        c.ring.rotation.z += dt * 9;
        c.ring.rotation.y = Math.sin(time * 13 + c.index) * 0.25;
      }
    }
    return lockedNow;
  }

  lock(clamp) {
    if (clamp.locked) return;
    clamp.locked = true;
    clamp.lockT = 0;
  }

  dispose() {
    for (const b of this.balls) b.mesh.removeFromParent();
    for (const c of this.clamps) c.root.removeFromParent();
    for (const x of this.owned) x.dispose();
  }
}
