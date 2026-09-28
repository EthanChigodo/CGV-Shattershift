/**
 * The cabin's glass giving way: panes crack, then blow out in shards.
 *
 *   const glass = new CabinGlass(cabin, scene);
 *   glass.crack("left", [0.3, 0.6], 1.2);   // cracks spread from a point over 1.2 s
 *   glass.shatter("left", { outward: 0.75 }); // three quarters fly out, the rest fall in
 *   glass.update(dt, gEff, cabinVelocity);
 *
 * Cracks are a procedural texture per pane - radial fractures from the
 * impact point with rings of short cross-cracks between them, drawn once on
 * a canvas - revealed by a shader that grows a radius from the impact, so
 * you watch them spread. The shader also frosts the glass near the impact.
 *
 * (Pane planes face into the cabin, so outward is their local -Z; for the
 * roof that points down, into the cabin - a roof only ever falls in.)
 *
 * Shards are two InstancedMeshes sharing one thin triangle geometry: those
 * blown OUT are simulated in world space (real gravity, down the shaft),
 * those that fall IN live in the cabin's own frame and feel the cabin's
 * gravity (`gEff`): they rest on the floor while it climbs, float in free
 * fall, and slam down when the brakes bite.
 */

import * as THREE from "../three.js";
import { CABIN } from "./kit.js";

const MAX_OUT = 220;
const MAX_IN = 120;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fracture lines radiating from `impact` (0..1 UV), with ring cracks between them. */
function crackTexture(impact, seed) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const rand = seeded(seed);
  const cx = impact[0] * size;
  const cy = (1 - impact[1]) * size;
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  const rays = 11 + Math.floor(rand() * 6);
  const ends = [];
  for (let i = 0; i < rays; i += 1) {
    let angle = (i / rays) * Math.PI * 2 + rand() * 0.4;
    let x = cx;
    let y = cy;
    const path = [[x, y]];
    const steps = 9 + Math.floor(rand() * 8);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < steps; k += 1) {
      angle += (rand() - 0.5) * 0.5;
      const len = 14 + rand() * 30;
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      ctx.lineTo(x, y);
      path.push([x, y]);
      // Occasional branch.
      if (rand() < 0.18) {
        const b = angle + (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.5);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(b) * (20 + rand() * 40), y + Math.sin(b) * (20 + rand() * 40));
        ctx.moveTo(x, y);
      }
      ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.93);
    }
    ctx.stroke();
    ends.push(path);
  }
  // Ring cracks: short segments joining neighbouring rays at a few radii.
  ctx.lineWidth = 1.3;
  for (const r of [3, 6, 10]) {
    for (let i = 0; i < ends.length; i += 1) {
      if (rand() < 0.3) continue;
      const a = ends[i][Math.min(r, ends[i].length - 1)];
      const b = ends[(i + 1) % ends.length][Math.min(r, ends[(i + 1) % ends.length].length - 1)];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo((a[0] + b[0]) / 2 + (rand() - 0.5) * 20, (a[1] + b[1]) / 2 + (rand() - 0.5) * 20, b[0], b[1]);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function crackMaterial(texture, impact) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: texture },
      uImpact: { value: new THREE.Vector2(impact[0], impact[1]) },
      uReveal: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec2 uImpact;
      uniform float uReveal;
      varying vec2 vUv;
      void main() {
        float d = distance(vUv, uImpact);
        float radius = uReveal * 1.3;
        float shown = smoothstep(radius, radius - 0.06, d);
        float line = texture2D(uMap, vUv).r;
        // Crushed, frosted glass right around the impact.
        float frost = (1.0 - smoothstep(0.0, 0.16 * uReveal + 0.001, d)) * 0.35;
        float a = clamp(line * 0.95 + frost, 0.0, 1.0) * shown;
        gl_FragColor = vec4(vec3(0.85, 0.96, 1.0) * (1.1 + line * 0.6), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** A thin, slightly irregular triangle; instances scale it into shard shapes. */
function shardGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.5, 0, -0.43, -0.25, 0.02, 0.38, -0.3, -0.02], 3));
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

class ShardPool {
  constructor(max, geometry, material, parent) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
    parent.add(this.mesh);
    this.items = [];
  }

  spawn(position, velocity, size) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      p: position.clone(),
      v: velocity.clone(),
      r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
      s: new THREE.Vector3(size * (0.6 + Math.random() * 0.8), size * (0.6 + Math.random() * 0.8), 1),
      life: 6,
      resting: false,
    });
  }

  write() {
    const n = this.items.length;
    for (let i = 0; i < n; i += 1) {
      const it = this.items[i];
      _q.setFromEuler(_e.set(it.r.x, it.r.y, it.r.z));
      this.mesh.setMatrixAt(i, _m.compose(it.p, _q, it.s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class CabinGlass {
  /**
   * @param {object} cabin  buildCabin() result (panes, root)
   * @param {THREE.Object3D} world  where blown-out shards live (the scene)
   */
  constructor(cabin, world) {
    this.cabin = cabin;
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const geometry = own(shardGeometry());
    const material = own(new THREE.MeshStandardMaterial({
      color: 0xcdefff, metalness: 0.35, roughness: 0.08, transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, emissive: 0x16363c, depthWrite: false,
    }));
    this.out = new ShardPool(MAX_OUT, geometry, material, world);
    this.in = new ShardPool(MAX_IN, geometry, material, cabin.root);
    this.panes = {};
    let seed = 7;
    for (const [name, mesh] of Object.entries(cabin.panes)) {
      this.panes[name] = { mesh, state: "whole", crack: null, reveal: 0, target: 0, speed: 1, seed: (seed += 13) };
    }
  }

  /** Cracks spread from `impact` (pane UV, 0..1) over `seconds`. Calling again grows them further. */
  crack(name, impact = [0.5, 0.5], seconds = 1, amount = 1) {
    const pane = this.panes[name];
    if (!pane || pane.state === "gone") return;
    if (!pane.crack) {
      const texture = crackTexture(impact, pane.seed);
      const material = crackMaterial(texture, impact);
      this.owned.push(texture, material);
      const overlay = new THREE.Mesh(pane.mesh.geometry, material);
      overlay.renderOrder = 4;
      // Sit a hair inside the pane so it never z-fights it.
      overlay.position.z = 0.004;
      pane.mesh.add(overlay);
      pane.crack = overlay;
    }
    pane.state = "cracked";
    pane.target = Math.max(pane.target, amount);
    pane.speed = (pane.target - pane.reveal) / Math.max(0.05, seconds);
  }

  /**
   * The pane gives way. `outward` is the share of shards blown out of the
   * cabin; the rest fall inside.
   * @param {object} [o]
   * @param {number} [o.outward]  0..1
   * @param {number} [o.force]  how hard (m/s)
   * @param {number} [o.cabinVelocity]  so outside shards start moving with the cabin
   */
  shatter(name, { outward = 0.75, force = 6, cabinVelocity = 0, count = 70 } = {}) {
    const pane = this.panes[name];
    if (!pane || pane.state === "gone") return;
    pane.state = "gone";
    pane.mesh.visible = false;
    const mesh = pane.mesh;
    mesh.updateMatrixWorld(true);
    // The pane's outward normal (its local +Z faces into the cabin for the
    // walls - see kit.js - so outward is -Z; the roof's +Z points down).
    const local = new THREE.Vector3();
    const outN = _n.set(0, 0, -1).transformDirection(mesh.matrix).normalize();
    for (let i = 0; i < count; i += 1) {
      local.set((Math.random() - 0.5) * 0.96, (Math.random() - 0.5) * 0.96, 0);
      const size = 0.08 + Math.random() * Math.random() * 0.32;
      if (Math.random() < outward) {
        _p.copy(local).applyMatrix4(mesh.matrixWorld);
        const v = outN.clone().transformDirection(this.cabin.root.matrixWorld).multiplyScalar(force * (0.5 + Math.random()));
        v.x += (Math.random() - 0.5) * 2.5;
        v.y += (Math.random() - 0.3) * 2.5 + cabinVelocity;
        v.z += (Math.random() - 0.5) * 2.5;
        this.out.spawn(_p, v, size);
      } else {
        _p.copy(local).applyMatrix4(mesh.matrix);
        const v = outN.clone().multiplyScalar(-(0.5 + Math.random() * 2));
        v.y += Math.random();
        this.in.spawn(_p, v, size * 0.8);
      }
    }
  }

  /** Give everything inside a shove (a quake, the floor dropping away). */
  jolt(up = 1, side = 0.3) {
    for (const it of this.in.items) {
      it.v.y += up * (0.4 + Math.random() * 0.8);
      it.v.x += (Math.random() - 0.5) * side * 2;
      it.v.z += (Math.random() - 0.5) * side * 2;
      it.resting = false;
      it.w.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }
  }

  /**
   * @param {number} dt
   * @param {number} gEff  gravity felt inside the cabin (9.8 at rest, 0 in free fall)
   */
  update(dt, gEff) {
    for (const pane of Object.values(this.panes)) {
      if (pane.crack && pane.reveal < pane.target) {
        pane.reveal = Math.min(pane.target, pane.reveal + pane.speed * dt);
        pane.crack.material.uniforms.uReveal.value = pane.reveal;
      }
    }

    // Blown out: world space, real gravity, gone after a few seconds.
    const out = this.out.items;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const it = out[i];
      it.life -= dt;
      if (it.life <= 0) {
        out.splice(i, 1);
        continue;
      }
      it.v.y -= 9.8 * dt;
      it.v.multiplyScalar(1 - 0.3 * dt);
      it.p.addScaledVector(it.v, dt);
      it.r.addScaledVector(it.w, dt);
    }
    this.out.write();

    // Fallen in: the cabin's frame and the cabin's felt gravity.
    const H = CABIN.height - 0.05;
    const B = CABIN.half - 0.05;
    for (const it of this.in.items) {
      if (it.resting && gEff > 2) continue;
      it.v.y -= gEff * dt;
      it.p.addScaledVector(it.v, dt);
      it.r.addScaledVector(it.w, dt);
      for (const axis of ["x", "z"]) {
        if (Math.abs(it.p[axis]) > B) {
          it.p[axis] = Math.sign(it.p[axis]) * B;
          it.v[axis] *= -0.4;
        }
      }
      if (it.p.y > H) {
        it.p.y = H;
        it.v.y = -Math.abs(it.v.y) * 0.3;
      }
      if (it.p.y < 0.012) {
        it.p.y = 0.012;
        if (it.v.y < 0) it.v.y = -it.v.y * 0.25;
        it.v.x *= 0.6;
        it.v.z *= 0.6;
        it.w.multiplyScalar(0.5);
        // Lie flat once it stops.
        if (gEff > 2 && Math.abs(it.v.y) < 0.4) {
          it.resting = true;
          it.v.set(0, 0, 0);
          it.r.x = -Math.PI / 2;
          it.r.y = 0;
        }
      }
    }
    this.in.write();
  }

  dispose() {
    this.out.mesh.removeFromParent();
    this.in.mesh.removeFromParent();
    for (const x of this.owned) x.dispose();
  }
}
