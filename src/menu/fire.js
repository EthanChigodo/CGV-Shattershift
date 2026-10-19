/**
 * The fire's moving parts on the menu stage, all GPU-cheap:
 *
 *  - Flames: one instanced draw. A flame is a quad standing out of a blown
 *    window, turned to face the camera about its own vertical axis, its
 *    shape and heat from two scrolls of the shared noise texture (shape
 *    tapering upward, heat through a black-body ramp into HDR so the bloom
 *    takes it). They lean with the wind toward their tips.
 *  - Glow: a few soft additive sprites over the burning floors - the light
 *    scattered in the smoke right at the fire, wider than bloom can reach.
 *  - Smoke plume: ~100 big puffs, one instanced draw, simulated on the CPU
 *    (rise, wind shear, growth) and sorted back to front each frame. Each
 *    puff is billowy noise lit three ways - the fire from below (strong near
 *    the windows, fading as it climbs), the city's sodium glow on its
 *    underside, the moon on its top - and ends in the stage's haze, so the
 *    far end of the plume dissolves into the night.
 *  - Embers: GPU points, their whole flight computed in the vertex shader
 *    from time and a seed - nothing to upload per frame.
 *  - Blow-outs: a flash, a burst of glass shards (glinting as they tumble
 *    and fall), a gout of smoke.
 */

import * as THREE from "../three.js";
import { HAZE_GLSL } from "./atmosphere.js";

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function glowTexture(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The fire's overall flicker, 0..1 (smooth, never periodic to the eye). */
export function fireFlicker(t) {
  return THREE.MathUtils.clamp(
    0.55 + 0.18 * Math.sin(t * 7.3) + 0.12 * Math.sin(t * 12.9 + 1.3) + 0.09 * Math.sin(t * 23.1 + 0.4) + 0.06 * Math.sin(t * 2.1 + 2.0),
    0, 1,
  );
}

const FIRE_RAMP = /* glsl */ `
  vec3 fireRamp(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c = mix(vec3(0.0), vec3(0.5, 0.04, 0.0), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3(2.4, 0.62, 0.06), smoothstep(0.18, 0.5, t));
    c = mix(c, vec3(5.5, 2.6, 0.55), smoothstep(0.45, 0.78, t));
    return mix(c, vec3(10.0, 7.5, 4.0), smoothstep(0.78, 1.0, t));
  }
`;

/* ------------------------------------------------------------------ */
/* Flames                                                               */
/* ------------------------------------------------------------------ */

const FLAME_VERTEX = /* glsl */ `
  attribute vec3 aBase;
  attribute vec3 aNormal;
  attribute vec4 aShape;    // width, height, seed, power
  uniform vec3 uWind;
  varying vec2 vUv;
  varying float vSeed;
  varying float vPower;
  varying vec3 vWorld;
  void main() {
    vUv = vec2(position.x, position.y);
    vSeed = aShape.z;
    vPower = aShape.w;
    vec3 toCam = normalize(cameraPosition - aBase);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    float y = position.y;
    vec3 p = aBase
      + aNormal * (0.4 + y * y * 2.2)                        // out of the window, curling up the face
      + right * position.x * aShape.x * (1.0 + y * 0.35)
      + vec3(0.0, 1.0, 0.0) * y * aShape.y
      + uWind * y * y * aShape.y * 0.06;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const FLAME_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uNoise;
  uniform float uIntensity;
  varying vec2 vUv;
  varying float vSeed;
  varying float vPower;
  varying vec3 vWorld;
  ${HAZE_GLSL}
  ${FIRE_RAMP}
  void main() {
    float y = vUv.y;
    float t = uTime * (0.9 + vSeed * 0.3);
    vec2 q = vec2(vUv.x * 0.55 + vSeed * 3.7, y * 0.42 - t * 0.55);
    float n = texture2D(uNoise, q).r;
    float n2 = texture2D(uNoise, q * vec2(2.1, 2.4) + vec2(0.0, -t * 0.4)).a;
    float turb = n * 0.62 + n2 * 0.38;
    // A tongue: wide at the window, tapering, torn apart toward the tip.
    float x = abs(vUv.x + (turb - 0.5) * 0.55 * y);
    float w = mix(0.48, 0.05, pow(y, 0.8));
    float body = 1.0 - smoothstep(w * 0.35, w, x);
    float heat = body * (1.05 - y * 1.1) + (turb - 0.5) * 0.7 * y;
    heat *= smoothstep(0.0, 0.12, y) * vPower * (1.0 - smoothstep(0.55, 1.0, y) * 0.6);
    vec3 col = fireRamp(heat) * uIntensity;
    // Fade into the haze like everything else, but keep most of the glow.
    float a = clamp(heat * 1.4, 0.0, 1.0);
    vec3 hazed = applyHaze(col, vWorld);
    col = mix(hazed, col, 0.55) * a;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Flames {
  constructor({ haze, noise, max = 48 }) {
    this.max = max;
    const plane = new THREE.PlaneGeometry(1, 1, 1, 6);
    plane.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.attributes.position);
    geo.setAttribute("uv", plane.attributes.uv);
    this.base = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.normal = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.shape = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    geo.setAttribute("aBase", this.base);
    geo.setAttribute("aNormal", this.normal);
    geo.setAttribute("aShape", this.shape);
    geo.instanceCount = 0;
    this.geometry = geo;
    this.plane = plane;
    this.uniforms = { ...haze, uTime: { value: 0 }, uNoise: { value: noise }, uWind: { value: new THREE.Vector3(-1, 0, 0.3) }, uIntensity: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.list = [];
    this.r = rng(17);
  }

  /** One flame out of a window ({ position, normal, width }), growing in over `grow` seconds. */
  add({ position, normal, width }, { grow = 0, power = 1 } = {}) {
    if (this.list.length >= this.max) this.list.shift();
    const r = this.r;
    this.list.push({
      position: position.clone().add(new THREE.Vector3(0, -1.2, 0)),
      normal: normal.clone(),
      width: width * (1.5 + r() * 0.9),
      height: 3.5 + r() * 5,
      seed: r(),
      power: 0.75 + r() * 0.35,
      target: power,
      age: grow > 0 ? 0 : 99,
      grow,
    });
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    const n = this.list.length;
    for (let i = 0; i < n; i += 1) {
      const f = this.list[i];
      f.age += dt;
      const k = f.grow > 0 ? Math.min(1, f.age / f.grow) : 1;
      // A fresh blow-out roars, then settles.
      const roar = f.grow > 0 ? 1 + Math.max(0, 1.6 - f.age) * 0.8 : 1;
      this.base.setXYZ(i, f.position.x, f.position.y, f.position.z);
      this.normal.setXYZ(i, f.normal.x, f.normal.y, f.normal.z);
      this.shape.setXYZW(i, f.width * roar, f.height * (0.3 + 0.7 * k) * roar, f.seed, f.power * k);
    }
    this.geometry.instanceCount = n;
    if (n) {
      this.base.needsUpdate = true;
      this.normal.needsUpdate = true;
      this.shape.needsUpdate = true;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.plane.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Smoke plume                                                          */
/* ------------------------------------------------------------------ */

const SMOKE_VERTEX = /* glsl */ `
  attribute vec3 aPos;
  attribute vec4 aParams;   // size, rotation, alpha, fire light
  attribute float aSeed;
  varying vec2 vUv;
  varying vec4 vParams;
  varying float vSeed;
  varying vec3 vWorld;
  varying vec3 vRight;
  varying vec3 vUp;
  void main() {
    vUv = position.xy + 0.5;
    vParams = aParams;
    vSeed = aSeed;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vRight = right;
    vUp = up;
    vec3 p = aPos + (right * position.x + up * position.y) * aParams.x;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const SMOKE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uNoise;
  uniform vec3 uFireLight;
  uniform vec3 uFireAt;
  uniform float uFlicker;
  varying vec2 vUv;
  varying vec4 vParams;
  varying float vSeed;
  varying vec3 vWorld;
  varying vec3 vRight;
  varying vec3 vUp;
  ${HAZE_GLSL}
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float c = cos(vParams.y), s = sin(vParams.y);
    vec2 rq = mat2(c, -s, s, c) * q;
    vec2 base = vec2(vSeed * 3.17, vSeed * 7.31);
    float billow = texture2D(uNoise, rq * 0.36 + base + vec2(0.0, uTime * 0.004)).b;
    float detail = texture2D(uNoise, rq * 0.9 + base * 1.7 - vec2(uTime * 0.006, 0.0)).r;
    float d = billow * 0.7 + detail * 0.45 - 0.22 - r2 * 0.95;
    float dens = smoothstep(0.0, 0.5, d);
    float a = dens * vParams.z;
    if (a < 0.003) discard;

    // A rounded puff: the normal of a sphere, roughened by the billows.
    vec3 toCam = normalize(cameraPosition - vWorld);
    vec3 n = normalize(vRight * (q.x + (detail - 0.5) * 0.8) + vUp * (q.y + (billow - 0.5) * 0.8) + toCam * sqrt(max(0.0, 1.0 - r2)));
    vec3 toFire = normalize(uFireAt - vWorld);
    float fireSide = 0.3 + 0.7 * max(dot(n, toFire), 0.0);
    float under = 0.5 + 0.5 * max(-n.y, 0.0);
    float top = max(dot(n, uMoonDir), 0.0);
    vec3 albedo = vec3(0.1, 0.092, 0.086);
    vec3 lit = albedo * (uHazeLow * 4.0 * under + uMoonGlow * 1.0 * top + vec3(0.015, 0.02, 0.03));
    float f = vParams.w;
    lit += albedo * uFireLight * f * fireSide * (2.4 + uFlicker * 1.4);
    // Hot smoke right at the fire glows on its own.
    lit += uFireLight * pow(f, 2.2) * dens * (0.22 + 0.25 * detail) * (0.7 + 0.6 * uFlicker);
    // Thick smoke shadows itself.
    lit *= mix(1.0, 0.45, smoothstep(0.25, 0.8, d));
    vec3 col = applyHaze(lit, vWorld);
    gl_FragColor = vec4(col * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class SmokePlume {
  /**
   * @param {object} o
   * @param {{position:THREE.Vector3, normal:THREE.Vector3}[]} o.emitters  windows the smoke pours out of
   * @param {THREE.Vector3} o.wind  m/s at the fire's height
   * @param {number} o.count
   */
  constructor({ haze, noise, emitters, wind, count = 90, fireAt, fireLight }) {
    this.emitters = emitters;
    this.wind = wind.clone();
    this.count = count;
    this.r = rng(29);
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.attributes.position);
    this.plane = plane;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPos", this.pos);
    geo.setAttribute("aParams", this.params);
    geo.setAttribute("aSeed", this.seed);
    geo.instanceCount = count;
    this.geometry = geo;
    this.uniforms = {
      ...haze,
      uTime: { value: 0 },
      uNoise: { value: noise },
      uFireLight: fireLight,
      uFireAt: { value: fireAt.clone() },
      uFlicker: { value: 0.5 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SMOKE_VERTEX,
      fragmentShader: SMOKE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    // Two families: thick, short-lived smoke boiling at the windows, and the
    // long plume it feeds. Pre-aged, so the plume is whole on the first frame.
    this.puffs = [];
    const r = this.r;
    for (let i = 0; i < count; i += 1) {
      const near = i < Math.round(count * 0.3);
      const p = { near, seed: r(), life: 0, age: 0, emitter: 0, jitter: new THREE.Vector3(), spin: (r() - 0.5) * 0.06, depth: 0, x: new THREE.Vector3() };
      this._spawn(p);
      p.age = r() * p.life;
      this.puffs.push(p);
    }
    this.order = this.puffs.map((_, i) => i);
    this._v = new THREE.Vector3();
    this.extra = [];
  }

  _spawn(p, at = null) {
    const r = this.r;
    p.life = p.near ? 9 + r() * 6 : 46 + r() * 26;
    p.age = 0;
    p.seed = r();
    p.emitter = Math.floor(r() * this.emitters.length);
    p.jitter.set((r() - 0.5) * 6, (r() - 0.5) * 5, (r() - 0.5) * 6);
    p.at = at;
  }

  /** A gout of smoke from a window that just blew. */
  burst(position, normal) {
    for (let k = 0; k < 5; k += 1) {
      const p = this.puffs[Math.floor(this.r() * this.puffs.length * 0.3)];
      this._spawn(p, { position: position.clone(), normal: normal.clone() });
      p.age = this.r() * 0.6;
    }
  }

  _place(p, out) {
    const e = p.at ?? this.emitters[p.emitter];
    const a = p.age;
    const k = a / p.life;
    // Out of the window, then up: fast while hot, slowing as it cools; the
    // wind takes it, harder the higher it goes (shear).
    const rise = p.near ? 2.2 * a + 0.03 * a * a : 11 * Math.log(1 + a * 0.3) + a * 0.42;
    out.copy(e.position).addScaledVector(e.normal, 2.5 + Math.min(a, 6) * 0.9).add(p.jitter);
    out.y += rise;
    const shear = p.near ? 0.35 : 0.65 + Math.min(1.2, rise / 90);
    out.addScaledVector(this.wind, a * shear);
    // Slow lazy curls.
    out.x += Math.sin(a * 0.21 + p.seed * 30) * (3 + a * 0.25);
    out.z += Math.cos(a * 0.17 + p.seed * 21) * (2 + a * 0.2);
    const size = p.near ? 11 + a * 2.2 + p.seed * 5 : 18 + a * 1.4 + Math.sqrt(a) * 4 + p.seed * 8;
    const fadeIn = THREE.MathUtils.smoothstep(a, 0, p.near ? 1.2 : 3.5);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(k, p.near ? 0.5 : 0.62, 1);
    const alpha = fadeIn * fadeOut * (p.near ? 0.95 : 0.85);
    // Lit by the fire below: by how far the puff has drifted from it.
    const away = out.distanceTo(this.uniforms.uFireAt.value);
    const light = 0.95 * Math.exp(-away / 38) + 0.22 * Math.exp(-away / 160);
    return { size, alpha, light };
  }

  update(dt, time, camera, flicker) {
    this.uniforms.uTime.value = time;
    this.uniforms.uFlicker.value = flicker;
    const cam = camera.position;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age >= p.life) this._spawn(p);
      p.look = this._place(p, p.x);
      p.depth = (p.x.x - cam.x) * fwd.x + (p.x.y - cam.y) * fwd.y + (p.x.z - cam.z) * fwd.z;
    }
    // Far to near: blended smoke must be drawn back to front.
    this.order.sort((a, b) => this.puffs[b].depth - this.puffs[a].depth);
    for (let i = 0; i < this.order.length; i += 1) {
      const p = this.puffs[this.order[i]];
      this.pos.setXYZ(i, p.x.x, p.x.y, p.x.z);
      this.params.setXYZW(i, p.look.size, p.seed * 6.28 + p.age * p.spin, p.look.alpha, p.look.light);
      this.seed.setX(i, p.seed);
    }
    this.pos.needsUpdate = true;
    this.params.needsUpdate = true;
    this.seed.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.plane.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Embers                                                               */
/* ------------------------------------------------------------------ */

const EMBER_VERTEX = /* glsl */ `
  attribute vec4 aSeed;
  attribute vec4 aSeed2;
  uniform float uTime;
  uniform vec3 uOrigin;
  uniform vec3 uSpread;
  uniform vec3 uWind;
  uniform float uScale;
  uniform float uSize;
  uniform float uRise;
  uniform float uLife;
  varying float vBright;
  varying float vSize;
  void main() {
    float life = uLife * (0.5 + aSeed.x);
    float age = mod(uTime * (0.85 + aSeed.y * 0.3) + aSeed.z * life * 7.0, life);
    float k = age / life;
    vec3 p = uOrigin + (aSeed2.xyz - 0.5) * uSpread;
    p.y += age * uRise * (0.5 + aSeed.w) - age * age * 0.04 * uRise;
    p += uWind * age * (0.6 + aSeed.y * 0.8);
    p.x += sin(age * (1.1 + aSeed.w) + aSeed2.w * 30.0) * (0.6 + age * 0.5);
    p.z += cos(age * (0.9 + aSeed.x) + aSeed2.w * 17.0) * (0.6 + age * 0.4);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = uSize * (0.5 + aSeed2.w) * uScale / max(0.1, -mv.z);
    // Too small to draw: keep it at a pixel and a half, dimmer (no sparkle).
    float shown = max(px, 1.5);
    gl_PointSize = min(shown, 24.0);
    vSize = shown;
    float flick = 0.6 + 0.4 * sin(uTime * (9.0 + aSeed.x * 14.0) + aSeed.z * 40.0);
    vBright = (1.0 - k) * smoothstep(0.0, 0.05, k) * flick * min(1.0, px / 1.5);
  }
`;

const EMBER_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vBright;
  varying float vSize;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    if (r > 1.0) discard;
    float core = exp(-r * 4.0);
    gl_FragColor = vec4(uColor * core * vBright, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Embers {
  constructor({ count, origin, spread, wind, size = 0.22, rise = 4.5, life = 9, color = new THREE.Color(6, 2.2, 0.5), seed = 41 }) {
    const r = rng(seed);
    const s1 = new Float32Array(count * 4);
    const s2 = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i += 1) {
      s1[i] = r();
      s2[i] = r();
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(s1, 4));
    this.geometry.setAttribute("aSeed2", new THREE.BufferAttribute(s2, 4));
    this.uniforms = {
      uTime: { value: 0 },
      uOrigin: { value: origin.clone() },
      uSpread: { value: spread.clone() },
      uWind: { value: wind.clone() },
      uScale: { value: 800 },
      uSize: { value: size },
      uRise: { value: rise },
      uLife: { value: life },
      uColor: { value: color },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: EMBER_VERTEX,
      fragmentShader: EMBER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  update(time, pixelScale) {
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = pixelScale;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Glass from a blow-out                                                */
/* ------------------------------------------------------------------ */

const SHARD_VERTEX = /* glsl */ `
  attribute float aLife;
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vBright;
  void main() {
    vec4 mv = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = 0.35 * uScale / max(0.1, -mv.z);
    gl_PointSize = clamp(px, 1.5, 6.0);
    // Tumbling glass: it flashes when a face turns to the fire.
    float glint = pow(max(0.0, sin(uTime * (14.0 + aSeed * 20.0) + aSeed * 50.0)), 6.0);
    vBright = aLife * (0.25 + glint * 1.8) * min(1.0, px / 1.5);
  }
`;

const SHARD_FRAGMENT = /* glsl */ `
  varying float vBright;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    if (dot(q, q) > 1.0) discard;
    gl_FragColor = vec4(vec3(5.0, 3.2, 1.6) * vBright, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Shards {
  constructor(max = 160) {
    this.max = max;
    this.position = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.life = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    const seeds = new Float32Array(max);
    for (let i = 0; i < max; i += 1) seeds[i] = Math.random();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", this.position);
    this.geometry.setAttribute("aLife", this.life);
    this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 800 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SHARD_VERTEX,
      fragmentShader: SHARD_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.shards = Array.from({ length: max }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, life: 0 }));
    this.next = 0;
  }

  burst(position, normal, n = 70) {
    for (let k = 0; k < n; k += 1) {
      const s = this.shards[this.next];
      this.next = (this.next + 1) % this.max;
      s.p.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.6));
      s.v.copy(normal).multiplyScalar(6 + Math.random() * 12);
      s.v.x += (Math.random() - 0.5) * 9;
      s.v.z += (Math.random() - 0.5) * 9;
      s.v.y += Math.random() * 7 - 1;
      s.life = 3 + Math.random() * 3;
      s.t = s.life;
    }
  }

  update(dt, time, pixelScale) {
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = pixelScale;
    let any = false;
    for (let i = 0; i < this.max; i += 1) {
      const s = this.shards[i];
      if (s.t > 0) {
        s.t -= dt;
        s.v.y -= 9.8 * dt;
        s.v.multiplyScalar(1 - dt * 0.15);
        s.p.addScaledVector(s.v, dt);
        any = true;
      }
      this.position.setXYZ(i, s.p.x, s.p.y, s.p.z);
      this.life.setX(i, s.t > 0 ? Math.min(1, s.t / s.life * 1.5) : 0);
    }
    this.points.visible = any;
    if (any) {
      this.position.needsUpdate = true;
      this.life.needsUpdate = true;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* The fire, put together                                               */
/* ------------------------------------------------------------------ */

export class TowerFire {
  /**
   * @param {object} o
   * @param {import("./tower.js").AscensionTower} o.tower
   * @param {object} o.haze
   * @param {THREE.Texture} o.noise
   * @param {THREE.Vector3} o.wind
   * @param {string} o.quality
   */
  constructor({ tower, haze, noise, wind, quality = "medium" }) {
    this.root = new THREE.Group();
    this.root.name = "TowerFire";
    this.tower = tower;
    this.wind = wind.clone();
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const q = { low: 0, medium: 1, high: 2 }[quality] ?? 1;

    // Flames out of every blown window we can see.
    this.flames = new Flames({ haze, noise, max: [28, 44, 60][q] });
    this.flames.uniforms.uWind.value.copy(wind).normalize();
    for (const w of tower.cells.openWindows()) {
      const at = tower.windowAt(w.face, w.col, w.floor);
      this.flames.add(at, { power: 0.6 + w.burn * 0.4 });
    }
    this.root.add(this.flames.mesh);

    // The glow round the burning floors.
    this.glowMap = own(glowTexture());
    this.glows = [];
    const centre = tower.fireCentre;
    const front = tower.fireFront;
    const span = tower.half * 2;
    const glowAt = [
      [front.clone(), 150, 0.035],
      [front.clone().add(new THREE.Vector3(0, 6, 0)), 70, 0.2],
      [front.clone().add(new THREE.Vector3(-span * 0.25, -4, 0)), 42, 0.35],
      [front.clone().add(new THREE.Vector3(span * 0.25, 4, 0)), 42, 0.3],
    ];
    for (const [p, size, strength] of glowAt) {
      const mat = own(new THREE.SpriteMaterial({ map: this.glowMap, color: new THREE.Color(1, 0.42, 0.12), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true, fog: false }));
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(p);
      sprite.scale.setScalar(size);
      sprite.renderOrder = 3;
      this.root.add(sprite);
      this.glows.push({ sprite, strength, phase: this.glows.length * 1.7 });
    }

    // Smoke out of the burning windows (a sample of them) and the floors'
    // broken corners.
    const open = tower.cells.openWindows();
    const emitters = [];
    for (let i = 0; i < Math.min(14, open.length); i += 1) {
      const w = open[Math.floor((i / Math.min(14, open.length)) * open.length)];
      const at = tower.windowAt(w.face, w.col, w.floor);
      emitters.push({ position: at.position.clone().add(new THREE.Vector3(0, 2, 0)), normal: at.normal.clone() });
    }
    if (!emitters.length) emitters.push({ position: front.clone(), normal: new THREE.Vector3(0, 0, 1) });
    this.fireLight = { value: tower.uniforms.uFireLight.value };
    this.smoke = new SmokePlume({ haze, noise, emitters, wind, count: [55, 90, 120][q], fireAt: centre, fireLight: this.fireLight });
    this.root.add(this.smoke.mesh);

    // Embers off the fire.
    this.embers = new Embers({
      count: [250, 600, 1100][q],
      origin: front.clone().add(new THREE.Vector3(0, -6, 0)),
      spread: new THREE.Vector3(span * 1.1, 26, span * 0.9),
      wind: wind.clone().multiplyScalar(0.9),
      size: 0.35,
      rise: 5,
      life: 12,
    });
    this.root.add(this.embers.points);

    this.shards = new Shards(q === 0 ? 80 : 160);
    this.root.add(this.shards.points);

    // Blow-outs: a flash sprite, glass, smoke, a new flame.
    this.flashMat = own(new THREE.SpriteMaterial({ map: this.glowMap, color: new THREE.Color(1, 0.7, 0.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.renderOrder = 7;
    this.root.add(this.flash);
    this.flashT = 99;
    this.lastBlast = 0;
    tower.onBlowout = (e) => this._blowout(e);
    this.flicker = 0.5;
  }

  _blowout(e) {
    this.flash.position.copy(e.position).addScaledVector(e.normal, 2);
    this.flashT = 0;
    this.shards.burst(e.position.clone().addScaledVector(e.normal, 0.5), e.normal);
    this.smoke.burst(e.position, e.normal);
    this.flames.add(e, { grow: 0.4, power: 1 });
    this.lastBlast = 0;
  }

  /** 0..1, how much a blow-out is lighting things up right now. */
  get blast() {
    return Math.max(0, 1 - this.flashT / 0.9);
  }

  update(dt, time, camera, pixelScale) {
    this.flicker = fireFlicker(time);
    this.flames.update(dt, time);
    this.smoke.update(dt, time, camera, this.flicker);
    this.embers.update(time, pixelScale);
    this.shards.update(dt, time, pixelScale);
    for (const g of this.glows) {
      const f = 0.75 + 0.25 * fireFlicker(time * 0.8 + g.phase);
      g.sprite.material.opacity = g.strength * f * (1 + this.blast * 1.5);
    }
    this.flashT += dt;
    const k = this.blast;
    this.flashMat.opacity = k * k;
    this.flash.scale.setScalar(12 + (1 - k) * 40);
  }

  dispose() {
    this.root.removeFromParent();
    this.flames.dispose();
    this.smoke.dispose();
    this.embers.dispose();
    this.shards.dispose();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Ash and stray embers drifting across the roof (the foreground)      */
/* ------------------------------------------------------------------ */

const ASH_VERTEX = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec3 uCentre;
  uniform vec3 uBox;
  uniform vec3 uWind;
  uniform float uScale;
  uniform float uFocus;
  uniform float uAperture;
  varying float vBright;
  varying float vEmber;
  varying float vSoft;
  void main() {
    float ember = step(0.95, aSeed.w);
    vEmber = ember;
    // Drift with the wind, ash settling and embers lifting, wrapped in a box
    // round the roof so there is always some in view.
    vec3 vel = uWind * (0.35 + aSeed.y * 0.3) + vec3(0.0, mix(-0.35, 0.6, ember), 0.0);
    vec3 p = position * uBox + vel * uTime;
    p.x += sin(uTime * (0.6 + aSeed.x) + aSeed.z * 30.0) * 0.6;
    p.y += sin(uTime * (0.8 + aSeed.y) + aSeed.x * 20.0) * 0.4;
    p = mod(p, uBox) - uBox * 0.5 + uCentre;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(0.05, -mv.z);
    float size = mix(0.016, 0.03, ember) * (0.6 + aSeed.z * 0.8);
    float px = size * uScale / dist;
    // Out of focus: a disc as wide as the circle of confusion, its light spread over it.
    float coc = abs(1.0 / dist - 1.0 / uFocus) * uAperture * uScale;
    float shown = clamp(max(px, coc), 1.2, 42.0);
    gl_PointSize = shown;
    vSoft = clamp(coc / max(px, 0.01), 0.0, 1.0);
    float energy = min(1.0, (px * px) / (shown * shown) * 4.0);
    float twinkle = ember > 0.5 ? 0.6 + 0.4 * sin(uTime * (7.0 + aSeed.x * 9.0) + aSeed.y * 40.0) : 1.0;
    vBright = energy * twinkle * smoothstep(0.4, 1.2, dist) * (1.0 - smoothstep(30.0, 45.0, dist));
  }
`;

const ASH_FRAGMENT = /* glsl */ `
  uniform vec3 uAsh;
  uniform vec3 uEmber;
  varying float vBright;
  varying float vEmber;
  varying float vSoft;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    if (r > 1.0) discard;
    // In focus a soft point; out of focus a flat disc with a brighter rim (bokeh).
    float sharp = exp(-r * 3.5);
    float disc = smoothstep(1.0, 0.8, r) * (0.75 + 0.25 * r);
    float shape = mix(sharp, disc, vSoft);
    vec3 c = mix(uAsh, uEmber, vEmber) * shape * vBright;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class DriftingAsh {
  constructor({ count = 500, centre, box = new THREE.Vector3(36, 12, 34), wind, seed = 77 }) {
    const r = rng(seed);
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      pos.set([r(), r(), r()], i * 3);
      seeds.set([r(), r(), r(), r()], i * 4);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    this.uniforms = {
      uTime: { value: 0 },
      uCentre: { value: centre.clone() },
      uBox: { value: box.clone() },
      uWind: { value: wind.clone() },
      uScale: { value: 800 },
      uFocus: { value: 5 },
      uAperture: { value: 0.035 },
      uAsh: { value: new THREE.Color(0.55, 0.36, 0.26) },
      uEmber: { value: new THREE.Color(4.5, 1.5, 0.35) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: ASH_VERTEX,
      fragmentShader: ASH_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
  }

  update(time, pixelScale, focus) {
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = pixelScale;
    if (focus) this.uniforms.uFocus.value = focus;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export { Embers };
