/**
 * The city at war: fire you can see from the roof.
 *
 * The Labs are bringing down their own annexes - the buildings across the
 * city where they ran the experiments - and the city is going up round them.
 * This is the fire for all of it:
 *
 *   Fireballs   camera-facing billboards, one draw call for a pool of them:
 *               white-hot, orange, deep red, gone - or (hue 1) the green of
 *               whatever they were keeping in there
 *   Tracers     streaks climbing from the streets and arcing over
 *   CityWar     the escalation (roof.js's `chaos`, 0..1): at first a city
 *               at night; then a distant blast now and then, tracers, more
 *               and more of both - and the sky going orange (`glow`)
 *
 * No lights: everything is additive billboards and lines (a light added
 * mid-fight would recompile every shader).
 *
 *   const fire = new Fireballs(160);
 *   root.add(fire.mesh);
 *   fire.burst(x, y, z, { size: 30, life: 2, vy: 6, hue: 0 });
 *   fire.update(dt);
 */

import * as THREE from "../../three.js";
import { fogUniforms } from "./skyline-collapse.js";

const FIRE_VERTEX = /* glsl */ `
  attribute vec3 aCentre;
  attribute vec4 aLook;     // x: size (m), y: age 0..1 (above 1: off), z: seed, w: hue (0 fire, 1 chemical)
  varying vec2 vUv;
  varying float vK;
  varying float vSeed;
  varying float vHue;
  varying float vDepth;
  void main() {
    vUv = uv;
    vK = aLook.y;
    vSeed = aLook.z;
    vHue = aLook.w;
    vec4 mv = modelViewMatrix * vec4(aCentre, 1.0);
    mv.xy += position.xy * aLook.x * step(aLook.y, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FIRE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec2 vUv;
  varying float vK;
  varying float vSeed;
  varying float vHue;
  varying float vDepth;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec2 c = vUv - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0 || vK > 1.0) discard;
    // Churning: lobes that roll outward as it ages.
    float a = atan(c.y, c.x);
    float n = noise(vec2(a * 2.2 + vSeed * 17.0, d * 3.0 - vK * 5.0 - uTime * 0.6)) * 0.6
            + noise(vec2(a * 5.0 - vSeed * 9.0, d * 6.0 - vK * 9.0)) * 0.4;
    float ball = smoothstep(1.0, 0.35, d + (n - 0.5) * 0.55);
    // White-hot to orange to a dull red, and out; the core burns out first.
    vec3 hot = mix(vec3(1.0, 0.92, 0.72), vec3(1.0, 0.5, 0.12), smoothstep(0.0, 0.3, vK + d * 0.25));
    hot = mix(hot, vec3(0.45, 0.07, 0.02), smoothstep(0.3, 0.85, vK + d * 0.2));
    vec3 chem = mix(vec3(0.85, 1.0, 0.7), vec3(0.25, 0.95, 0.2), smoothstep(0.0, 0.4, vK + d * 0.3));
    chem = mix(chem, vec3(0.05, 0.3, 0.06), smoothstep(0.4, 0.9, vK));
    vec3 col = mix(hot, chem, vHue);
    float fade = (1.0 - smoothstep(0.55, 1.0, vK)) * min(1.0, vK * 12.0 + 0.3);
    float haze = clamp(1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * 0.35), 0.0, 1.0);
    // (The green held back a little: added up it would wash out to white.)
    gl_FragColor = vec4(col * (1.0 - haze * 0.75) * mix(1.6, 0.8, vHue), ball * fade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A pool of fireballs drawn in one call. Positions in the mesh's parent's space. */
export class Fireballs {
  constructor(count = 160, seed = 1) {
    this.count = count;
    let s = seed * 7919 + 104729;
    this.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("uv", quad.getAttribute("uv"));
    this.centres = new Float32Array(count * 3);
    this.looks = new Float32Array(count * 4);
    this.centreAttr = new THREE.InstancedBufferAttribute(this.centres, 3).setUsage(THREE.DynamicDrawUsage);
    this.lookAttr = new THREE.InstancedBufferAttribute(this.looks, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aCentre", this.centreAttr);
    geometry.setAttribute("aLook", this.lookAttr);
    geometry.instanceCount = count;
    this.uniforms = { uTime: { value: 0 }, ...fogUniforms() };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: FIRE_VERTEX, fragmentShader: FIRE_FRAGMENT,
      fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this._owned = [quad, geometry, this.material];
    this.balls = Array.from({ length: count }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 1, life: 0, size: 0, seed: this.random(), hue: 0, lift: 0 }));
    this._next = 0;
    /** How much is burning right now (0..~1): for lighting the dust and the sky. */
    this.heat = 0;
    this.update(0);
  }

  /**
   * One fireball.
   * @param {object} [o]  size (m, at birth - it grows), life (s), velocity, hue (0 fire .. 1 chemical), lift (buoyancy)
   */
  burst(x, y, z, { size = 12, life = 1.4, vx = 0, vy = 0, vz = 0, hue = 0, lift = 4 } = {}) {
    const b = this.balls[this._next];
    this._next = (this._next + 1) % this.count;
    b.p.set(x, y, z);
    b.v.set(vx, vy, vz);
    b.life = life * (0.8 + this.random() * 0.4);
    b.age = 0;
    b.size = size * (0.8 + this.random() * 0.4);
    b.hue = hue;
    b.lift = lift;
    b.seed = this.random();
    return b;
  }

  /** A cluster: a few balls round a point, thrown outward. */
  blast(x, y, z, { size = 20, count = 6, speed = 8, life = 1.8, hue = 0, up = 4 } = {}) {
    const k = this.random;
    for (let i = 0; i < count; i += 1) {
      const a = k() * Math.PI * 2;
      const e = (k() - 0.3) * 1.2;
      this.burst(x + (k() - 0.5) * size * 0.3, y + (k() - 0.5) * size * 0.3, z + (k() - 0.5) * size * 0.3, {
        size: size * (0.5 + k() * 0.6), life, hue,
        vx: Math.cos(a) * Math.cos(e) * speed, vy: Math.sin(e) * speed + up, vz: Math.sin(a) * Math.cos(e) * speed,
      });
    }
  }

  update(dt, time = 0) {
    this.uniforms.uTime.value = time;
    let heat = 0;
    for (let i = 0; i < this.count; i += 1) {
      const b = this.balls[i];
      let k = 2;
      if (b.age < b.life) {
        b.age += dt;
        b.v.multiplyScalar(Math.exp(-dt * 1.6));
        b.v.y += b.lift * dt;
        b.p.addScaledVector(b.v, dt);
        k = b.age / b.life;
        heat += (1 - k) * b.size / 30;
      }
      this.centres[i * 3] = b.p.x;
      this.centres[i * 3 + 1] = b.p.y;
      this.centres[i * 3 + 2] = b.p.z;
      this.looks[i * 4] = b.size * (0.55 + 1.3 * Math.sqrt(Math.min(k, 1)));
      this.looks[i * 4 + 1] = k;
      this.looks[i * 4 + 2] = b.seed;
      this.looks[i * 4 + 3] = b.hue;
    }
    this.heat = Math.min(1.5, heat);
    this.centreAttr.needsUpdate = true;
    this.lookAttr.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    for (const x of this._owned) x.dispose();
  }
}

/** Streaks of fire climbing from the streets and arcing over: one draw call of lines. */
export class Tracers {
  constructor(count = 48, seed = 3) {
    this.count = count;
    let s = seed * 4801 + 7;
    this.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    this.positions = new Float32Array(count * 6);
    this.colours = new Float32Array(count * 6);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colourAttr = new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.positionAttr);
    geometry.setAttribute("color", this.colourAttr);
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.streaks = Array.from({ length: count }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 1, life: 0, colour: new THREE.Color() }));
    this._next = 0;
    this.update(0);
  }

  /** A burst of `n` from (x, y, z), up and over toward `dir` (radians). */
  fire(x, y, z, { n = 5, dir = 0, speed = 90, colour = 0xffb050 } = {}) {
    const k = this.random;
    for (let i = 0; i < n; i += 1) {
      const t = this.streaks[this._next];
      this._next = (this._next + 1) % this.count;
      const a = dir + (k() - 0.5) * 0.25;
      const e = 0.9 + (k() - 0.5) * 0.3;
      const v = speed * (0.85 + k() * 0.3);
      // One after another, like a burst of fire.
      t.p.set(x, y, z);
      t.v.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).multiplyScalar(v);
      t.age = -i * 0.06;
      t.life = 2.4 + k() * 0.8;
      t.colour.set(colour);
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i += 1) {
      const t = this.streaks[i];
      let on = 0;
      if (t.age < t.life) {
        t.age += dt;
        if (t.age > 0) {
          t.v.y -= 9.8 * dt;
          t.p.addScaledVector(t.v, dt);
          on = 1 - t.age / t.life;
        }
      }
      const j = i * 6;
      this.positions[j] = t.p.x;
      this.positions[j + 1] = t.p.y;
      this.positions[j + 2] = t.p.z;
      // The tail: a twentieth of a second back.
      this.positions[j + 3] = t.p.x - t.v.x * 0.05 * on;
      this.positions[j + 4] = t.p.y - t.v.y * 0.05 * on;
      this.positions[j + 5] = t.p.z - t.v.z * 0.05 * on;
      for (let c = 0; c < 2; c += 1) {
        const f = on * (c ? 0.15 : 1);
        this.colours[j + c * 3] = t.colour.r * f;
        this.colours[j + c * 3 + 1] = t.colour.g * f;
        this.colours[j + c * 3 + 2] = t.colour.b * f;
      }
    }
    this.positionAttr.needsUpdate = true;
    this.colourAttr.needsUpdate = true;
  }

  dispose() {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The escalation, across the whole city: blasts on distant rooftops and
 * streets, tracers, more of both with `chaos` - and the sky's glow.
 *
 *   const war = new CityWar({ streetY: -160 });
 *   scene.add(war.root);
 *   war.update(dt, time, chaos);   // -> { blasts: [{ position, strength }] } for the host's sound
 *   war.glow                       // 0..1: how orange the sky is
 */
export class CityWar {
  /**
   * @param {object} [o]
   * @param {number} [o.streetY]
   * @param {{x:number, z:number, r:number}[]} [o.clear]  nowhere near these (the roof's own block)
   * @param {number} [o.seed]
   */
  constructor({ streetY = -160, seed = 11, near = 140, far = 520 } = {}) {
    this.streetY = streetY;
    this.near = near;
    this.far = far;
    this.root = new THREE.Group();
    this.root.name = "CityWar";
    this.fire = new Fireballs(140, seed);
    this.tracers = new Tracers(60, seed + 1);
    this.root.add(this.fire.mesh, this.tracers.lines);
    let s = seed * 131 + 17;
    this.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    this._blast = 4;
    this._tracer = 6;
    /** Burning spots that keep burning once hit: [{ p, until }]. */
    this.burning = [];
    this.glow = 0;
  }

  /** Somewhere out across the city: (x, z), a rooftop or a street height. */
  _spot(target = new THREE.Vector3()) {
    const k = this.random;
    // Mostly ahead of the roof (north, -z, where the camera looks), any side.
    const a = -Math.PI / 2 + (k() - 0.5) * Math.PI * 1.5;
    const r = this.near + k() * (this.far - this.near);
    return target.set(Math.cos(a) * r, this.streetY + (k() < 0.55 ? 4 + k() * 10 : 30 + k() * 140), Math.sin(a) * r);
  }

  update(dt, time, chaos = 0) {
    const out = [];
    const k = this.random;
    // The first ten percent is the city at night; then it starts.
    const war = THREE.MathUtils.clamp((chaos - 0.1) / 0.9, 0, 1);
    if (war > 0) {
      this._blast -= dt;
      if (this._blast <= 0) {
        this._blast = THREE.MathUtils.lerp(7, 1.1, war) * (0.5 + k());
        const p = this._spot();
        const big = k() < 0.25 + war * 0.3;
        const size = big ? 26 + k() * 30 : 10 + k() * 12;
        this.fire.blast(p.x, p.y, p.z, { size, count: big ? 7 : 4, speed: size * 0.4, life: big ? 2.6 : 1.6, up: 5 });
        if (big) this.burning.push({ p: p.clone(), until: time + 20 + k() * 30, size: size * 0.4 });
        out.push({ position: p.clone(), strength: big ? 0.6 : 0.3 });
      }
      this._tracer -= dt;
      if (this._tracer <= 0) {
        this._tracer = THREE.MathUtils.lerp(5, 0.5, war) * (0.5 + k());
        const p = this._spot();
        this.tracers.fire(p.x, this.streetY + 2, p.z, { n: 4 + Math.floor(k() * 6), dir: k() * Math.PI * 2, speed: 70 + k() * 50, colour: k() < 0.8 ? 0xffb050 : 0x9cff7a });
      }
    }
    // What's still burning: low fires, flaring now and then.
    this.burning = this.burning.filter((b) => b.until > time);
    for (const b of this.burning) {
      b.t = (b.t ?? 0) - dt;
      if (b.t <= 0) {
        b.t = 0.25 + k() * 0.35;
        this.fire.burst(b.p.x + (k() - 0.5) * b.size, b.p.y, b.p.z + (k() - 0.5) * b.size, { size: b.size * (0.6 + k()), life: 1.6, vy: 3, lift: 5 });
      }
    }
    this.fire.update(dt, time);
    this.tracers.update(dt);
    this.glow = THREE.MathUtils.damp(this.glow, Math.min(1, war * 0.8 + this.fire.heat * 0.4), 1.5, dt);
    return out;
  }

  dispose() {
    this.fire.dispose();
    this.tracers.dispose();
    this.root.removeFromParent();
  }
}
