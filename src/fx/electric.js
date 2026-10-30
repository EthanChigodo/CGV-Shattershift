/**
 * Electricity: the Skyline drones' violet, drawn as glowing strands - a hot
 * core in a soft halo, both brighter than white so the bloom takes them.
 * Every strand in a frame is one instanced draw each (core, halo): the arcs
 * crawling over a shocked body, and the bolts of a charge jumping from one
 * to the next. The Roof's patients and winged ones (roof.js), the Arena's
 * players and the Race's runners.
 *
 *   const electric = new ElectricArcs(parent);
 *   // each frame:
 *   electric.begin();
 *   electric.body(feet, { power, scale });   // a shocked body's arcs, this frame
 *   electric.bolt(from, to, power);          // a jump - it lasts a moment
 *   electric.end(dt);
 *
 * `power` (0..1) is the charge it carries: more arcs, longer, and thicker
 * strands. Points are in `parent`'s space.
 */

import * as THREE from "../three.js";

/** The most strand segments (arcs and bolts) drawn in a frame. */
const STRANDS = 1200;
/** The arcs over a body: how many (more snap out when charged), and the steps in each. */
const ARCS = 7;
const ARC_STEPS = 5;
/** A bolt: two jagged strands of `BOLT_STEPS`, for `BOLT_SECONDS` (longer, charged). */
const BOLT_STEPS = 9;
const BOLT_SECONDS = 0.24;
const BOLTS = 10;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);

export class ElectricArcs {
  constructor(parent) {
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const material = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.core = new THREE.InstancedMesh(this.geometry, material(new THREE.Color(2.6, 1.9, 3.4), 1), STRANDS);
    this.halo = new THREE.InstancedMesh(this.geometry, material(new THREE.Color(0.9, 0.38, 1.5), 0.32), STRANDS);
    for (const mesh of [this.core, this.halo]) {
      mesh.name = "ElectricArcs";
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      parent.add(mesh);
    }
    this.n = 0;
    this.bolts = [];
    for (let i = 0; i < BOLTS; i += 1) this.bolts.push({ t: 0, power: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
  }

  /** A new frame: nothing drawn yet. */
  begin() {
    this.n = 0;
  }

  /** One glowing segment from `a` to `b` (`width` m: the core; the halo round it is wider). */
  strand(a, b, width) {
    if (this.n >= STRANDS) return;
    _d.subVectors(b, a);
    const length = _d.length();
    if (length < 1e-4) return;
    _q.setFromUnitVectors(_y, _d.divideScalar(length));
    _d.addVectors(a, b).multiplyScalar(0.5);
    _m.compose(_d, _q, _s.set(width, length, width));
    this.core.setMatrixAt(this.n, _m);
    _m.compose(_d, _q, _s.set(width * 4, length * 1.05, width * 4));
    this.halo.setMatrixAt(this.n, _m);
    this.n += 1;
  }

  /**
   * This frame's arcs over a standing body (its feet at `feet`, `scale` its
   * size): segments wandering over it and a few snapping out into the air -
   * more of those, longer and thicker, the more charge it carries.
   */
  body(feet, { power = 0, scale = 1 } = {}) {
    const out = 2 + Math.round(3 * power);
    const width = 0.016 * (1 + 1.4 * power);
    for (let i = 0; i < ARCS + out; i += 1) {
      const snapping = i >= ARCS;
      let theta = Math.random() * Math.PI * 2;
      let y = 0.25 + Math.random() * 1.5;
      let r = 0.3;
      _a.set(feet.x + Math.cos(theta) * r * scale, feet.y + y * scale, feet.z + Math.sin(theta) * r * scale);
      for (let j = 0; j < ARC_STEPS; j += 1) {
        theta += (Math.random() - 0.5) * 1.1;
        y += (Math.random() - 0.5) * 0.35;
        r = snapping ? r + 0.2 + 0.18 * power : 0.26 + Math.random() * 0.12;
        _b.set(feet.x + Math.cos(theta) * r * scale, feet.y + y * scale, feet.z + Math.sin(theta) * r * scale);
        this.strand(_a, _b, width * (snapping ? 1 - j / (ARC_STEPS + 1) : 1));
        _a.copy(_b);
      }
    }
  }

  /** A bolt from `from` to `to`: drawn every frame for a moment, thicker the more charge it carries. */
  bolt(from, to, power = 0) {
    const bolt = this.bolts.find((b) => b.t <= 0) ?? this.bolts.reduce((a, b) => (b.t < a.t ? b : a));
    bolt.from.copy(from);
    bolt.to.copy(to);
    bolt.power = power;
    bolt.t = BOLT_SECONDS * (1 + 0.5 * power);
  }

  /**
   * The frame's end: each bolt redrawn jagged - a main strand and a thinner
   * one wandering off the line between them, the main one thinning as it
   * fades - and every strand sent up.
   */
  end(dt) {
    for (const bolt of this.bolts) {
      if (bolt.t <= 0) continue;
      bolt.t -= dt;
      if (bolt.t <= 0) continue;
      const fade = Math.min(1, bolt.t / 0.1);
      const width = 0.045 * (1 + 1.5 * bolt.power) * (0.5 + 0.5 * fade);
      for (let strand = 0; strand < 2; strand += 1) {
        const wander = strand ? 0.75 : 0.45;
        _a.copy(bolt.from);
        for (let k = 1; k <= BOLT_STEPS; k += 1) {
          _b.lerpVectors(bolt.from, bolt.to, k / BOLT_STEPS);
          if (k < BOLT_STEPS) _b.set(_b.x + (Math.random() - 0.5) * wander, _b.y + (Math.random() - 0.5) * wander, _b.z + (Math.random() - 0.5) * wander);
          this.strand(_a, _b, strand ? width * 0.5 : width);
          _a.copy(_b);
        }
      }
    }
    this.core.count = this.halo.count = this.n;
    // Nothing shocked: not drawn at all (no state change, no call). The
    // roof's prewarm still compiles them (it shows what's hidden).
    this.core.visible = this.halo.visible = this.n > 0;
    if (!this.n) return;
    this.core.instanceMatrix.needsUpdate = this.halo.instanceMatrix.needsUpdate = true;
    this.halo.material.opacity = 0.24 + Math.random() * 0.16;
  }

  /** Nothing left in the air (a match or race over). */
  clear() {
    for (const bolt of this.bolts) bolt.t = 0;
    this.n = 0;
    this.core.count = this.halo.count = 0;
    this.core.visible = this.halo.visible = false;
  }

  dispose() {
    for (const mesh of [this.core, this.halo]) {
      mesh.removeFromParent();
      mesh.material.dispose();
      mesh.dispose?.();
    }
    this.geometry.dispose();
  }
}
