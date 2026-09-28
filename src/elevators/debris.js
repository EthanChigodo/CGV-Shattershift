/**
 * Loose things in the cabin: a toolbox, a fire extinguisher, a clipboard
 * and two of Subject 07's spent resonance spheres.
 *
 * They live in the cabin's own frame and feel the cabin's gravity (`gEff`):
 * they sit on the floor while it climbs, hop in a tremor, drift up and
 * tumble when the cable snaps (a falling cabin is weightless inside), and
 * slam down when the brakes bite. Each is a point with a radius for the
 * walls, floor and ceiling, and a spin - enough to read as physical.
 *
 *   const debris = new CabinDebris(cabin.root);
 *   debris.jolt(1);          // the floor drops away / a quake
 *   debris.update(dt, gEff);
 */

import * as THREE from "../three.js";
import { CABIN } from "./kit.js";

export class CabinDebris {
  constructor(parent) {
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const orange = own(new THREE.MeshStandardMaterial({ color: 0xc8531c, metalness: 0.4, roughness: 0.5 }));
    const red = own(new THREE.MeshStandardMaterial({ color: 0xb01616, metalness: 0.3, roughness: 0.35 }));
    const steel = own(new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.8, roughness: 0.3 }));
    const paper = own(new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.9 }));
    const board = own(new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.8 }));
    const sphere = own(new THREE.MeshStandardMaterial({ color: 0x7ef4f1, emissive: 0x2fb8b4, emissiveIntensity: 1.2, roughness: 0.2 }));

    const toolbox = new THREE.Group();
    toolbox.add(new THREE.Mesh(own(new THREE.BoxGeometry(0.46, 0.2, 0.22)), orange));
    const handle = new THREE.Mesh(own(new THREE.BoxGeometry(0.3, 0.03, 0.03)), steel);
    handle.position.y = 0.13;
    toolbox.add(handle);

    const extinguisher = new THREE.Group();
    extinguisher.add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14)), red));
    const nozzle = new THREE.Mesh(own(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 8)), steel);
    nozzle.position.y = 0.25;
    extinguisher.add(nozzle);

    const clipboard = new THREE.Group();
    clipboard.add(new THREE.Mesh(own(new THREE.BoxGeometry(0.24, 0.012, 0.33)), board));
    const sheet = new THREE.Mesh(own(new THREE.BoxGeometry(0.21, 0.004, 0.28)), paper);
    sheet.position.y = 0.008;
    clipboard.add(sheet);

    const ballGeo = own(new THREE.SphereGeometry(0.1, 16, 12));
    const balls = [0, 1].map(() => new THREE.Mesh(ballGeo, sphere));

    // [object, radius (for the walls), rest height, start position]
    const B = CABIN.half;
    this.items = [
      [toolbox, 0.2, 0.1, [B - 0.45, 0, B - 0.5]],
      [extinguisher, 0.1, 0.21, [-(B - 0.2), 0, -(B - 0.35)]],
      [clipboard, 0.17, 0.01, [0.6, 0, -0.9]],
      [balls[0], 0.1, 0.1, [-1.1, 0, 1.2]],
      [balls[1], 0.1, 0.1, [1.3, 0, 0.1]],
    ].map(([object, radius, rest, [x, y, z]]) => {
      object.position.set(x, rest + y, z);
      object.rotation.y = Math.random() * Math.PI * 2;
      parent.add(object);
      return {
        object,
        radius,
        rest,
        v: new THREE.Vector3(),
        w: new THREE.Vector3(),
        restRotation: object.rotation.clone(),
      };
    });
  }

  /** A shove: `up` scales the upward kick (a quake ~0.5, the floor dropping ~1). */
  jolt(up = 1, side = 0.4) {
    for (const it of this.items) {
      it.v.y += up * (0.35 + Math.random() * 0.7);
      it.v.x += (Math.random() - 0.5) * side;
      it.v.z += (Math.random() - 0.5) * side;
      it.w.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5).multiplyScalar(up);
    }
  }

  update(dt, gEff) {
    const B = CABIN.half - 0.05;
    const H = CABIN.height - 0.05;
    for (const it of this.items) {
      const p = it.object.position;
      it.v.y -= gEff * dt;
      p.addScaledVector(it.v, dt);
      it.object.rotation.x += it.w.x * dt;
      it.object.rotation.y += it.w.y * dt;
      it.object.rotation.z += it.w.z * dt;
      for (const axis of ["x", "z"]) {
        const limit = B - it.radius;
        if (Math.abs(p[axis]) > limit) {
          p[axis] = Math.sign(p[axis]) * limit;
          it.v[axis] *= -0.45;
        }
      }
      if (p.y > H - it.radius) {
        p.y = H - it.radius;
        it.v.y = -Math.abs(it.v.y) * 0.4;
      }
      if (p.y < it.rest) {
        p.y = it.rest;
        if (it.v.y < 0) it.v.y = -it.v.y * 0.3;
        it.v.x *= 0.55;
        it.v.z *= 0.55;
        // Settle upright (or flat) once gravity has it pinned.
        if (gEff > 2) {
          it.w.multiplyScalar(0.3);
          const k = Math.min(1, dt * 10);
          it.object.rotation.x += (it.restRotation.x - it.object.rotation.x) * k;
          it.object.rotation.z += (it.restRotation.z - it.object.rotation.z) * k;
          if (Math.abs(it.v.y) < 0.3) it.v.y = 0;
        }
      }
    }
  }

  dispose() {
    for (const it of this.items) it.object.removeFromParent();
    for (const x of this.owned) x.dispose();
  }
}
