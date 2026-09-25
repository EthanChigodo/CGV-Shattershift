/**
 * The smoke ceiling: the building filling up from the top down.
 *
 * Three stacked horizontal sheets that travel with the player, each drawn
 * with a world-space noise shader (so the smoke stays put while you run
 * under it, and drifts on its own). They sit just under the ceiling in the
 * lit beats, bank a little lower as the building burns, and in the dark beat
 * come down to a few metres over your head - "the smoke is taking over".
 *
 * Unlit on purpose: its colour is set from the level's light (ambient power,
 * the chasing fire's glow), which is cheaper than lighting three large
 * transparent sheets per pixel.
 */

import * as THREE from "../../three.js";

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vLocal;
  void main() {
    vLocal = position.xz;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uDensity;
  uniform float uSeed;
  uniform float uRadius;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  varying vec3 vWorld;
  varying vec2 vLocal;

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
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.07 + vec2(3.1, 1.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = vWorld.xz * 0.085 + vec2(uSeed * 7.0, uSeed * 3.0);
    vec2 drift = vec2(uTime * 0.035, -uTime * 0.05);
    float n = fbm(p + drift + fbm(p * 0.6 - drift) * 0.9);
    float body = smoothstep(0.32, 0.78, n);
    // Fade out toward the sheet's edge so it never shows a border.
    float edge = 1.0 - smoothstep(uRadius * 0.45, uRadius, length(vLocal));
    float a = uDensity * body * edge;
    if (a < 0.004) discard;
    vec3 col = mix(uColor, uColor + uGlow, n);
    gl_FragColor = vec4(col, a);
  }
`;

export class SmokeCeiling {
  constructor(sharedTime, { layers = 3, radius = 46 } = {}) {
    this.group = new THREE.Group();
    this.group.name = "SmokeCeiling";
    this.layers = [];
    this.height = 7.6;
    const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2, 1, 1);
    geometry.rotateX(-Math.PI / 2); // lies in local xz; the shader fades on that
    this.geometry = geometry;
    for (let i = 0; i < layers; i += 1) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: sharedTime,
          uDensity: { value: 0.3 },
          uSeed: { value: i * 1.37 },
          uRadius: { value: radius },
          uColor: { value: new THREE.Color(0x1d1916) },
          uGlow: { value: new THREE.Color(0x1a0a02) },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `SmokeLayer_${i}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.layers.push({ mesh, material, offset: i * 0.75 });
    }
    this._ceiling = 7.6;
    this._drop = 0;
    this._colour = new THREE.Color();
  }

  /**
   * @param {THREE.Vector3} player  world position (x/z followed)
   * @param {object} s
   * @param {number} s.ceiling    height of the space the player is in
   * @param {number} s.darkness   0..1 - the smoke bank comes down in the dark
   * @param {number} s.burn       0..1 - how far up the building (thicker)
   * @param {number} s.light      0..1 - ambient light, for the smoke's colour
   * @param {number} s.fireNear   0..1 - the chasing fire's glow in the smoke
   * @param {number} dt
   */
  update(player, { ceiling, darkness = 0, burn = 0, light = 1, fireNear = 0 }, dt) {
    const k = Math.min(1, dt * 1.5);
    this._ceiling += (ceiling - this._ceiling) * k;
    this._drop += (darkness * 3.1 + burn * 0.8 - this._drop) * k;
    this.group.position.set(player.x, 0, player.z);
    this._colour.setRGB(0.1, 0.09, 0.085).multiplyScalar(0.25 + light * 0.9);
    for (const layer of this.layers) {
      layer.mesh.position.y = this._ceiling - 0.6 - layer.offset - this._drop * (1 + layer.offset * 0.25);
      const u = layer.material.uniforms;
      u.uDensity.value = 0.26 + burn * 0.18 + darkness * 0.34;
      u.uColor.value.copy(this._colour);
      u.uGlow.value.setRGB(0.22, 0.07, 0.01).multiplyScalar(0.15 + fireNear * 0.9);
    }
  }

  dispose() {
    this.geometry.dispose();
    for (const layer of this.layers) layer.material.dispose();
  }
}
