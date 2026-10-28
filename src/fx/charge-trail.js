/**
 * A charged sphere's air stripes (systems/charge.js): thin streaks of light
 * spiralling round it and trailing behind, as if it tears the air - more of
 * them, longer and brighter the longer the charge was held, in the launcher
 * design's two colours (figure/launcher-skins.js trailColours).
 *
 *   const trails = new ChargeTrails(scene);
 *   trails.add(mesh, velocity, level, ["#00f0ff", "#ff2fa0"], () => stillFlying);
 *   trails.update(dt);   // each frame
 *
 * Each streak is two crossed quads (so it reads from any side), additive,
 * fading toward its tail and flickering along it. When its sphere is gone
 * the trail lingers a moment where it was and fades.
 */

import * as THREE from "../three.js";

/** A streak: one unit long behind its origin (local -Z), two crossed quads. */
function streakGeometry() {
  const g = new THREE.BufferGeometry();
  const p = [
    -0.5, 0, 0, 0.5, 0, 0, -0.5, 0, -1, 0.5, 0, -1,
    0, -0.5, 0, 0, 0.5, 0, 0, -0.5, -1, 0, 0.5, -1,
  ];
  const uv = [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1];
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]);
  return g;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    float along = vUv.y;                       // 0 at the sphere, 1 at the tail
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float a = pow(1.0 - along, 1.6) * across * across;
    // Gusts running back along it.
    a *= 0.55 + 0.45 * sin(along * 22.0 - uTime * 46.0 + uSeed * 6.0);
    gl_FragColor = vec4(uColour * (2.0 + 1.5 * across), a * uOpacity);
  }
`;

const _dir = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

export class ChargeTrails {
  constructor(scene, { max = 6 } = {}) {
    this.scene = scene;
    this.max = max;
    this.geometry = streakGeometry();
    this.trails = [];
    this.time = 0;
  }

  _material(colour, seed) {
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uColour: { value: new THREE.Color(colour) }, uOpacity: { value: 0 }, uTime: { value: 0 }, uSeed: { value: seed } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
  }

  /**
   * Stripes round a sphere: `mesh` (its position, and its size), `velocity`
   * (read each frame - the sphere's own vector), `level` (0..1, the charge),
   * `colours` (two), `alive` (false once the sphere is gone).
   */
  add(mesh, velocity, level, colours, alive) {
    while (this.trails.length >= this.max) this._remove(this.trails[0]);
    const group = new THREE.Group();
    group.name = "ChargeTrail";
    group.frustumCulled = false;
    const count = Math.round(4 + 8 * level);
    const materials = [this._material(colours[0], 0), this._material(colours[1] ?? colours[0], 1)];
    const streaks = [];
    for (let i = 0; i < count; i += 1) {
      const s = new THREE.Mesh(this.geometry, materials[i % 2]);
      s.frustumCulled = false;
      s.renderOrder = 3;
      group.add(s);
      streaks.push({ mesh: s, angle: (i / count) * Math.PI * 2, ring: i % 3, phase: i * 1.7 });
    }
    group.position.copy(mesh.position);
    this.scene.add(group);
    this.trails.push({ group, mesh, velocity, level, alive, materials, streaks, age: 0, fade: 1, lastDir: new THREE.Vector3(0, 0, -1) });
  }

  update(dt) {
    if (!this.trails.length) return;
    this.time += dt;
    for (const t of [...this.trails]) {
      t.age += dt;
      const flying = t.alive();
      if (flying) {
        t.group.position.copy(t.mesh.position);
        if (t.velocity.lengthSq() > 1e-4) t.lastDir.copy(t.velocity).normalize();
      } else {
        t.fade -= dt * 4;
        if (t.fade <= 0) { this._remove(t); continue; }
      }
      // Pointing back along the flight: the group's +Z down the velocity.
      t.group.quaternion.setFromUnitVectors(_z, _dir.copy(t.lastDir));
      const size = t.mesh.scale.x;
      const grow = Math.min(1, t.age * 6);
      const l = t.level;
      for (const s of t.streaks) {
        // Spiralling round the sphere, three rings out.
        s.angle += dt * (5 + 7 * l) * (s.ring === 1 ? -1 : 1);
        const r = size * (1.25 + s.ring * 0.75);
        s.mesh.position.set(Math.cos(s.angle) * r, Math.sin(s.angle) * r, size * 0.6);
        const length = (1.2 + 3.6 * l) * (0.7 + 0.3 * Math.sin(this.time * 9 + s.phase)) * grow;
        s.mesh.scale.set(size * (0.4 + 0.35 * l), size * (0.4 + 0.35 * l), length);
        // Each streak's own plane faces out from the axis.
        s.mesh.rotation.z = s.angle;
      }
      for (const m of t.materials) {
        m.uniforms.uOpacity.value = (0.5 + 0.5 * l) * Math.max(0, t.fade);
        m.uniforms.uTime.value = this.time;
      }
    }
  }

  _remove(t) {
    t.group.removeFromParent();
    for (const m of t.materials) m.dispose();
    this.trails.splice(this.trails.indexOf(t), 1);
  }

  dispose() {
    for (const t of [...this.trails]) this._remove(t);
    this.geometry.dispose();
  }
}
