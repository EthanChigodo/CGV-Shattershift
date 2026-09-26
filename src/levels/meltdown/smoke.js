/**
 * The smoke bank: the building filling up from the top down.
 *
 * A single InstancedMesh of soft, camera-facing puffs laid out along the
 * route ahead of and behind the player. Each puff belongs to a fixed slot of
 * route distance, so the smoke stays put in the world while you run through
 * it, and slots recycle ahead of you as you pass them.
 *
 * (The first version used three flat noise-shaded sheets. Wherever a sheet
 * met a wall, or was seen edge-on down the corridor, it drew a hard
 * horizontal line - "the smoke is lines". Puffs have no edges: each one fades
 * out radially, fades as the camera nears it, and they are kept off the
 * walls, so nothing ever cuts through them.)
 *
 * In the lit beats the bank hangs just under the ceiling; in the dark beat it
 * comes down to a few metres over your head and thickens - "the smoke is
 * taking over". Unlit on purpose: its colour follows the level's light, and
 * the launcher's beam cone is what lights it up in the dark.
 */

import * as THREE from "../../three.js";

const VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;

  void main() {
    vUv = uv;
    vSeed = aSeed;
    float size = length(instanceMatrix[0].xyz);
    vec4 centre = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    // A slow roll and drift so the bank churns.
    float a = uTime * (0.05 + aSeed * 0.08) + aSeed * 6.28;
    vec2 corner = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy;
    centre.xy += corner * size;
    centre.x += sin(uTime * 0.2 + aSeed * 13.0) * 0.4;
    // Fade out close to the eye, so a puff never pops across the lens.
    vFade = smoothstep(1.2, 6.0, -centre.z);
    gl_Position = projectionMatrix * centre;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uDensity;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    vec2 p = vUv * 2.6 + vec2(vSeed * 9.0, vSeed * 4.0 - uTime * 0.04);
    float n = noise(p) * 0.55 + noise(p * 2.3 + 7.0) * 0.3 + noise(p * 5.1 - 3.0) * 0.15;
    // Soft round body, broken up by the noise so no two puffs are discs.
    float body = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.55);
    float a = body * body * uDensity * vFade * (0.55 + n * 0.6);
    if (a < 0.003) discard;
    vec3 col = uColor * (0.75 + n * 0.5) + uGlow * n;
    gl_FragColor = vec4(col, a);
  }
`;

function hash(i, k) {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class SmokeBank {
  /**
   * @param {{value:number}} sharedTime  the fire clock uniform
   * @param {object} [o]
   * @param {number} [o.count]    puffs in the bank
   * @param {number} [o.spacing]  metres of route per puff
   * @param {number} [o.halfWidth] keep puffs this far inside the walls
   */
  constructor(sharedTime, { count = 40, spacing = 1.5, halfWidth = 5.2 } = {}) {
    this.count = count;
    this.spacing = spacing;
    this.halfWidth = halfWidth;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedTime,
        uDensity: { value: 0.2 },
        uColor: { value: new THREE.Color(0x1d1916) },
        uGlow: { value: new THREE.Color(0x1a0a02) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) seeds[i] = hash(i, 3);
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
    this.mesh.name = "SmokeBank";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group = new THREE.Group();
    this.group.name = "SmokeBank";
    this.group.add(this.mesh);
    this._ceiling = 7.6;
    this._drop = 0;
    this._matrix = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3();
  }

  /**
   * @param {object} route      the level's route (sample(distance, lateral, height, target))
   * @param {number} distance   the player's route distance
   * @param {object} s
   * @param {number} s.ceiling  height of the space the player is in
   * @param {number} s.darkness 0..1 - the bank comes down and thickens in the dark
   * @param {number} s.burn     0..1 - how far up the building
   * @param {number} s.light    0..1 - ambient light, for the smoke's colour
   * @param {number} s.fireNear 0..1 - the chasing fire's glow in the smoke
   * @param {number} dt
   */
  update(route, distance, { ceiling, darkness = 0, burn = 0, light = 1, fireNear = 0 }, dt) {
    const k = Math.min(1, dt * 1.5);
    this._ceiling += (ceiling - this._ceiling) * k;
    this._drop += (darkness * 2.8 + burn * 0.7 - this._drop) * k;
    const start = distance - 12;
    const first = Math.floor(start / this.spacing);
    const span = this.count * this.spacing;
    for (let i = 0; i < this.count; i += 1) {
      // Slot index -> a fixed place in the world, recycled as you pass.
      const slot = first + i;
      const d = slot * this.spacing;
      const lateral = (hash(slot, 1) * 2 - 1) * this.halfWidth;
      const layer = hash(slot, 2);
      const height = this._ceiling - 0.9 - layer * (1.6 + darkness * 1.4) - this._drop;
      route.sample(d, lateral, Math.max(2.6, height), this._pos);
      // Shrink puffs to nothing at the two ends of the window so recycling
      // never pops.
      const edge = Math.min(1, (d - start) / 6, (start + span - d) / 10);
      const size = (3.4 + hash(slot, 4) * 3.2 + darkness * 1.6) * Math.max(0, edge);
      this._matrix.compose(this._pos, this._quat, this._scale.setScalar(Math.max(0.001, size)));
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    const u = this.material.uniforms;
    u.uDensity.value = 0.14 + burn * 0.08 + darkness * 0.2;
    u.uColor.value.setRGB(0.1, 0.09, 0.085).multiplyScalar(0.25 + light * 0.9);
    u.uGlow.value.setRGB(0.22, 0.07, 0.01).multiplyScalar(0.15 + fireNear * 0.9);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
