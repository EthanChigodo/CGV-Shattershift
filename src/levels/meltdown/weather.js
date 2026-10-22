/**
 * Weather on the roof: "clear", "rain" or "storm".
 *
 *   rain      thousands of streaks falling through the floodlights - one
 *             LineSegments, moved entirely in the vertex shader (each drop's
 *             height is its start minus speed x time, wrapped in the box, so
 *             the CPU never touches them); rings of splashes on the deck
 *             (points that grow and fade, each on its own clock); the deck
 *             goes wet - darker and glossy, so the floods smear across it;
 *             the haze thickens
 *   storm     all of that, harder, and lightning: a forked bolt out over the
 *             city (a jagged line built fresh each time, drawn additive),
 *             the whole roof lit blue-white for a few flickers, thunder a
 *             moment later - further off, later and quieter
 *
 *   const w = new RoofWeather(roof, { kind: "storm", audio });
 *   w.update(dt, time);            // every frame
 *   w.dispose();
 */

import * as THREE from "../../three.js";

export const WEATHER = {
  clear: { key: "clear", label: "Clear night", drops: 0, splashes: 0, wet: 0, lightning: null },
  rain: { key: "rain", label: "Rain", drops: 7000, splashes: 900, wet: 1, speed: 26, lightning: [22, 40] },
  storm: { key: "storm", label: "Storm", drops: 12000, splashes: 1600, wet: 1, speed: 34, wind: 3.2, lightning: [5, 11] },
};
export const WEATHER_ORDER = ["clear", "rain", "storm"];

const BOX = { x: 64, y: 34, z: 64 }; // the rain's volume, centred on the roof
const LENGTH = 0.55; // a streak, metres

const RAIN_VERTEX = /* glsl */ `
  attribute vec4 aDrop;          // x, start y, z, phase
  attribute float aEnd;          // 0: the drop's head, 1: its tail
  uniform float uTime;
  uniform float uSpeed;
  uniform vec2 uWind;
  uniform vec3 uBox;
  uniform float uLength;
  varying float vFade;
  void main() {
    float fall = uTime * uSpeed * (0.85 + aDrop.w * 0.3);
    float y = mod(aDrop.y - fall, uBox.y) - 2.0;
    // The wind leans it, and carries it along as it falls.
    vec2 drift = uWind * (uBox.y - y) * 0.05;
    vec3 p = vec3(aDrop.x + drift.x, y, aDrop.z + drift.y);
    vec3 dir = normalize(vec3(uWind.x, -uSpeed, uWind.y));
    p -= dir * uLength * aEnd;
    // Thinner out at the edges of the box, and below the deck it's gone.
    vFade = (1.0 - smoothstep(0.35, 0.5, max(abs(aDrop.x), abs(aDrop.z)) / uBox.x)) * step(-1.5, y) * mix(1.0, 0.25, aEnd);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uFlash;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(uColour * (1.0 + uFlash * 3.0), vFade * 0.42);
  }
`;

// Splashes: rings lying flat on the deck, one small quad each (instanced),
// opening out and fading on their own clocks.
const SPLASH_VERTEX = /* glsl */ `
  attribute vec3 aSplash;         // x, z, phase
  uniform float uTime;
  uniform float uRate;
  varying float vLife;
  varying vec2 vUv;
  void main() {
    float life = fract(uTime * uRate + aSplash.z);
    vLife = life;
    vUv = uv * 2.0 - 1.0;
    float size = 0.06 + life * 0.26;
    vec3 p = vec3(aSplash.x + position.x * size, 0.025, aSplash.y + position.y * size);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const SPLASH_FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  varying float vLife;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    float ring = smoothstep(0.6, 0.82, r) * (1.0 - smoothstep(0.86, 1.0, r));
    float alpha = ring * (1.0 - vLife) * smoothstep(0.0, 0.1, vLife) * 0.5;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColour, alpha);
  }
`;

export class RoofWeather {
  /**
   * @param {object} roof    the RoofLevel (its root, lights, deck material)
   * @param {object} o
   * @param {"clear"|"rain"|"storm"} o.kind
   * @param {object} [o.audio]   Level1Audio: rain and thunder
   */
  constructor(roof, { kind = "clear", audio = null, seed = Math.random() } = {}) {
    this.roof = roof;
    this.audio = audio;
    this.def = WEATHER[kind] ?? WEATHER.clear;
    this.kind = this.def.key;
    this.root = new THREE.Group();
    this.root.name = "Weather";
    roof.root.add(this.root);
    this.time = { value: 0 };
    this.flash = { value: 0 };
    this._seed = seed;
    this._rand = mulberry(Math.floor(seed * 1e6) + 7);
    this.nextBolt = this.def.lightning ? this._between(...this.def.lightning) * 0.5 : Infinity;
    this.strike = null;
    this.thunderAt = [];
    if (this.def.drops) this._buildRain();
    if (this.def.splashes) this._buildSplashes();
    if (this.def.lightning) this._buildLightning();
    this._wetDeck(this.def.wet);
    this.audio?.rain?.(this.def.drops ? (this.kind === "storm" ? 1 : 0.6) : 0);
  }

  _between(a, b) {
    return a + this._rand() * (b - a);
  }

  _buildRain() {
    const n = this.def.drops;
    const drops = new Float32Array(n * 2 * 4);
    const ends = new Float32Array(n * 2);
    const pos = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i += 1) {
      const x = (this._rand() - 0.5) * BOX.x;
      const y = this._rand() * BOX.y;
      const z = (this._rand() - 0.5) * BOX.z;
      const w = this._rand();
      for (let e = 0; e < 2; e += 1) {
        drops.set([x, y, z, w], (i * 2 + e) * 4);
        ends[i * 2 + e] = e;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aDrop", new THREE.BufferAttribute(drops, 4));
    g.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
    // (Positions come from the shader: give it a box it can't be culled out of.)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, BOX.y / 2, 0), BOX.x);
    const wind = this.def.wind ?? 1;
    this.rainMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.time, uSpeed: { value: this.def.speed }, uWind: { value: new THREE.Vector2(wind, wind * 0.35) },
        uBox: { value: new THREE.Vector3(BOX.x, BOX.y, BOX.z) }, uLength: { value: LENGTH * (this.kind === "storm" ? 1.4 : 1) },
        uColour: { value: new THREE.Color(0.62, 0.72, 0.86) }, uFlash: this.flash,
      },
      vertexShader: RAIN_VERTEX, fragmentShader: RAIN_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.rain = new THREE.LineSegments(g, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.root.add(this.rain);
  }

  _buildSplashes() {
    const n = this.def.splashes;
    const data = new Float32Array(n * 3);
    const edge = 15.5;
    for (let i = 0; i < n; i += 1) data.set([(this._rand() * 2 - 1) * edge, (this._rand() * 2 - 1) * edge, this._rand()], i * 3);
    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    g.setAttribute("aSplash", new THREE.InstancedBufferAttribute(data, 3));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);
    this.splashMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uRate: { value: this.kind === "storm" ? 2.6 : 1.8 }, uColour: { value: new THREE.Color(0.7, 0.8, 0.92) } },
      vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.splashes = new THREE.Mesh(g, this.splashMaterial);
    this.splashes.frustumCulled = false;
    this.root.add(this.splashes);
  }

  _buildLightning() {
    // The flash itself: a cold light from overhead, off until a strike.
    this.flashLight = new THREE.DirectionalLight(0xcfe0ff, 0);
    this.flashLight.position.set(20, 60, -40);
    this.root.add(this.flashLight);
    this.boltMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(2.6, 2.8, 3.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }

  /** Rain on the deck: darker and glossy. */
  _wetDeck(wet) {
    const m = this.roof.deckMaterial;
    if (!m) return;
    this._dry ??= { roughness: m.roughness, color: m.color.clone(), envMapIntensity: m.envMapIntensity ?? 1 };
    // Darker, and glossier - the floods smear across it - but not a mirror.
    m.roughness = this._dry.roughness * (1 - wet * 0.32);
    m.color.copy(this._dry.color).multiplyScalar(1 - wet * 0.42);
    m.envMapIntensity = this._dry.envMapIntensity * (1 - wet * 0.25);
    m.needsUpdate = true;
  }

  /** A strike: a fresh forked bolt out over the city, the flash, then the thunder. */
  _strike() {
    const angle = this._rand() * Math.PI * 2;
    const far = 70 + this._rand() * 90;
    const base = new THREE.Vector3(Math.cos(angle) * far, -60, Math.sin(angle) * far);
    const top = base.clone().add(new THREE.Vector3((this._rand() - 0.5) * 30, 140, (this._rand() - 0.5) * 30));
    const points = [];
    const fork = (from, to, depth) => {
      const steps = 10 - depth * 3;
      let prev = from.clone();
      for (let i = 1; i <= steps; i += 1) {
        const p = from.clone().lerp(to, i / steps);
        if (i < steps) p.add(new THREE.Vector3((this._rand() - 0.5) * 9, (this._rand() - 0.5) * 4, (this._rand() - 0.5) * 9).multiplyScalar(1 - depth * 0.3));
        points.push(prev, p);
        if (depth < 2 && this._rand() < 0.22) {
          const branchTo = p.clone().add(new THREE.Vector3((this._rand() - 0.5) * 40, -20 - this._rand() * 30, (this._rand() - 0.5) * 40));
          fork(p, branchTo, depth + 1);
        }
        prev = p;
      }
    };
    fork(top, base, 0);
    if (this.bolt) { this.root.remove(this.bolt); this.bolt.geometry.dispose(); }
    this.bolt = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), this.boltMaterial);
    this.bolt.frustumCulled = false;
    this.root.add(this.bolt);
    // Two or three flickers over half a second.
    this.strike = { t: 0, pulses: [0, 0.09 + this._rand() * 0.05, 0.22 + this._rand() * 0.12].slice(0, 2 + (this._rand() < 0.6 ? 1 : 0)) };
    this.thunderAt.push({ at: this.time.value + 0.6 + far / 110, power: 1 - (far - 70) / 140 });
  }

  update(dt, time) {
    this.time.value = time;
    if (this.def.lightning) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this._strike();
        this.nextBolt = this._between(...this.def.lightning);
      }
      let f = 0;
      if (this.strike) {
        this.strike.t += dt;
        for (const p of this.strike.pulses) {
          const k = this.strike.t - p;
          if (k >= 0 && k < 0.16) f = Math.max(f, 1 - k / 0.16);
        }
        if (this.strike.t > 0.7) this.strike = null;
      }
      this.flash.value = f;
      this.flashLight.intensity = f * 3.8;
      this.boltMaterial.opacity = Math.min(1, f * 1.6);
      if (this.roof.hemisphere) this.roof.hemisphere.intensity = (this.roof._hemiBase ??= this.roof.hemisphere.intensity) * (1 + f * 1.4);
      for (let i = this.thunderAt.length - 1; i >= 0; i -= 1) {
        if (this.time.value < this.thunderAt[i].at) continue;
        this.audio?.thunder?.(this.thunderAt[i].power);
        this.thunderAt.splice(i, 1);
      }
    }
  }

  /** The night clears up (a new match, or leaving the roof). */
  dispose() {
    this._wetDeck(0);
    this.audio?.rain?.(0);
    if (this.roof.hemisphere && this.roof._hemiBase) this.roof.hemisphere.intensity = this.roof._hemiBase;
    this.root.removeFromParent();
    this.rain?.geometry.dispose();
    this.splashes?.geometry.dispose();
    this.bolt?.geometry.dispose();
    this.rainMaterial?.dispose();
    this.splashMaterial?.dispose();
    this.boltMaterial?.dispose();
  }
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
