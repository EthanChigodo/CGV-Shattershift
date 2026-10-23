/**
 * A tower across the street coming down, seen from the roof.
 *
 * The city is burning; the longer the fight goes on (the roof's `chaos`),
 * the more of it gives way. A blast tears through one floor (`fail` metres
 * up), and everything above it drops onto the floors below: the falling
 * block leans as it goes, its lights die, and where it meets the failure it
 * is crushed into a spreading heap. A dust cloud rolls out from the break
 * and climbs.
 *
 * All of the falling is the vertex shader's: one segmented box and three
 * uniforms (uDrop, uCrush, uTilt), not a pre-broken model. The dust is a
 * pool of camera-facing billboards (an InstancedMesh, its own shader) - not
 * points, whose size the GPU may cap.
 *
 * Sound is late, as it is in life: you see the blast at once, but hear it -
 * and feel the shake - distance / 343 m/s later. update() returns what
 * happens each frame: { kind: "seen" } at the blast, then "blast" and
 * "fall" when their sound reaches the listener.
 *
 *   const c = new TowerCollapse({ x: -48, z: -44, streetY: -160, height: 178, fail: 118 });
 *   scene.add(c.root);
 *   c.start(listenerPosition);
 *   for (const e of c.update(dt, time)) ...;
 *   c.dispose();
 */

import * as THREE from "../../three.js";

const SPEED_OF_SOUND = 343;
/** The falling block's acceleration (less than g: the floors below resist). */
const FALL_ACCEL = 7;
const BLAST_TO_FALL = 0.7;
const DUST = 90;

const TOWER_VERTEX = /* glsl */ `
  uniform float uDrop;    // metres the block above the failure has fallen
  uniform float uCrush;   // the failure: metres above the base
  uniform float uTilt;    // the block's lean as it falls
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vRest;     // where this point was before anything moved
  varying float vDepth;
  varying float vRubble;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vRest = position;
    vec3 p = position;    // base at y = 0
    float rubble = 0.0;
    if (position.y > uCrush + 0.01) {
      // Above the failure: falls as one block, leaning further the higher up.
      p.y -= uDrop;
      p.x += max(p.y - uCrush, 0.0) * uTilt;
      if (p.y < uCrush) {
        // Through the failure: crushed. The floors stack up thin, and the
        // heap bulges out past the walls, unevenly.
        float into = uCrush - p.y;
        float n = hash(floor(position * 0.4));
        rubble = clamp(into / 18.0, 0.0, 1.0);
        p.y = uCrush - into * 0.12 - rubble * n * 2.5;
        p.xz *= 1.0 + rubble * (0.2 + 0.4 * n);
      }
    }
    vRubble = rubble;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const TOWER_FRAGMENT = /* glsl */ `
  uniform float uCrush;
  uniform float uDark;    // the falling block's lights going out, 0..1
  uniform float uBlast;   // the failing floor's flash, 0..1
  uniform float uHeight;  // its top, metres above the base
  uniform float uPower;   // the grid (load-shedding.js): 0 off .. 1 on
  uniform float uSeed;
  uniform float uTime;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vRest;
  varying float vDepth;
  varying float vRubble;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 moon = vec3(0.6, 0.68, 0.84) * max(dot(n, normalize(vec3(-0.45, 0.8, -0.3))), 0.0) * 0.4;
    vec3 city = vec3(0.9, 0.42, 0.16) * (0.3 + 0.7 * max(-n.y, 0.0) + 0.2 * (1.0 - abs(n.y)));
    vec3 col = vec3(0.09, 0.095, 0.11) * (moon + city * 0.4 + 0.08);
    vec3 glow = vec3(0.0);
    if (abs(n.y) < 0.5) {
      // Windows on the rest position, so they ride down with the block.
      float along = abs(n.x) > 0.5 ? vRest.z : vRest.x;
      vec2 cell = vec2(along / 3.2, vRest.y / 3.8);
      vec2 id = floor(cell) + vec2(uSeed * 17.0, 0.0);
      vec2 f = fract(cell);
      float pane = step(0.15, f.x) * step(f.x, 0.85) * step(0.25, f.y) * step(f.y, 0.85);
      float r = hash(id);
      float falling = step(uCrush, vRest.y);
      // As it goes, the block's floors flicker and die, the top first.
      float dies = smoothstep(0.0, 1.0, uDark * 1.6 - hash(vec2(id.y, 3.0)) * 0.6);
      float flick = mix(1.0, step(0.4, fract(sin(uTime * 23.0 + r * 50.0) * 9.1)), step(0.02, uDark) * falling);
      float lit = step(0.62, r) * (1.0 - falling * dies) * flick;
      glow += mix(vec3(1.0, 0.72, 0.42), vec3(0.62, 0.8, 1.0), step(0.75, hash(id + 2.0))) * pane * lit * 0.55;
      // Floodlit crown, as on the city's towers - until the power goes.
      float crown = exp(-max(uHeight - vRest.y, 0.0) / 13.0) * (0.55 + 0.45 * cos(along / 3.2 * 3.14159265));
      glow += vec3(0.42, 0.37, 0.31) * vec3(1.0, 0.7, 0.42) * crown * 0.9 * (1.0 - uDark);
      // The blast: the failing floors burn orange-white.
      glow += vec3(1.0, 0.55, 0.2) * uBlast * exp(-abs(vRest.y - uCrush) / 5.0) * (0.6 + 0.8 * r) * 2.0;
    }
    // The heap: broken concrete, dust-grey.
    col = mix(col, vec3(0.13, 0.11, 0.1) * (city * 0.5 + 0.1), vRubble);
    glow *= 1.0 - vRubble;
    glow *= mix(0.03, 1.0, uPower);
    float haze = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * 0.6);
    gl_FragColor = vec4(mix(col, fogColor, clamp(haze, 0.0, 1.0)) + glow * (1.0 - haze * 0.7), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Dust: camera-facing quads. The quad's corner (position.xy) is added in view
// space, so it always faces the camera - a billboard.
export const DUST_VERTEX = /* glsl */ `
  attribute vec3 aCentre;
  attribute vec3 aLook;     // x: size (m), y: opacity, z: seed
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  varying float vDepth;
  varying float vHeight;
  void main() {
    vUv = uv;
    vAlpha = aLook.y;
    vSeed = aLook.z;
    vHeight = aCentre.y;
    vec4 mv = modelViewMatrix * vec4(aCentre, 1.0);
    mv.xy += position.xy * aLook.x;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const DUST_FRAGMENT = /* glsl */ `
  uniform float uFlash;
  uniform float uBreak;   // world y of the failure (the glow comes from there)
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  varying float vDepth;
  varying float vHeight;
  void main() {
    vec2 c = vUv - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    // A soft, lumpy puff: a few lobes round the centre, turning with the seed.
    float a = atan(c.y, c.x) + vSeed * 6.283;
    float lumpy = 0.85 + 0.15 * sin(a * 3.0) * sin(a * 5.0 + vSeed * 9.0);
    float puff = smoothstep(1.0, 0.25, d / lumpy);
    // Grey dust, lit orange from below by the fires and the blast.
    float low = exp(-max(vHeight - uBreak, 0.0) / 40.0);
    vec3 col = vec3(0.2, 0.18, 0.17) + vec3(0.5, 0.22, 0.08) * low * 0.6 + vec3(1.0, 0.55, 0.25) * uFlash * low;
    float haze = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * 0.6);
    gl_FragColor = vec4(mix(col, fogColor, clamp(haze, 0.0, 1.0)), puff * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const fogUniforms = () => ({ fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 }, fogNear: { value: 1 }, fogFar: { value: 1000 } });

export class TowerCollapse {
  /**
   * @param {object} o
   * @param {number} o.x  @param {number} o.z   where it stands (its centre), world metres
   * @param {number} [o.streetY]
   * @param {number} [o.height]   metres above the street
   * @param {number} [o.width]  @param {number} [o.depth]
   * @param {number} [o.fail]     the floor that goes, metres above the street
   * @param {number} [o.lean]     how far over the falling block tips (+x)
   * @param {number} [o.seed]
   */
  constructor({ x, z, streetY = -160, height = 178, width = 24, depth = 20, fail = 118, lean = 0.07, seed = 1 }) {
    this.root = new THREE.Group();
    this.root.name = "TowerCollapse";
    this.root.position.set(x, streetY, z);
    this.height = height;
    this.fail = fail;
    this.lean = lean;
    this.width = width;
    this.depth = depth;
    this.owned = [];
    const own = (o) => (this.owned.push(o), o);

    // From well under the street (it stands in the haze, like the city's
    // towers), segmented so the shader has vertices to crush.
    const below = 120;
    const box = own(new THREE.BoxGeometry(width, height + below, depth, 6, 70, 6));
    box.translate(0, (height + below) / 2 - below, 0);
    this.uniforms = {
      uDrop: { value: 0 }, uCrush: { value: fail }, uTilt: { value: 0 },
      uDark: { value: 0 }, uBlast: { value: 0 }, uSeed: { value: seed }, uTime: { value: 0 }, uHeight: { value: height }, uPower: { value: 1 },
      ...fogUniforms(),
    };
    this.tower = new THREE.Mesh(box, own(new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: TOWER_VERTEX, fragmentShader: TOWER_FRAGMENT, fog: true })));
    this.tower.frustumCulled = false;
    this.root.add(this.tower);

    // The dust pool.
    const quad = own(new THREE.PlaneGeometry(1, 1));
    const dustGeometry = own(new THREE.InstancedBufferGeometry());
    dustGeometry.index = quad.index;
    dustGeometry.setAttribute("position", quad.getAttribute("position"));
    dustGeometry.setAttribute("uv", quad.getAttribute("uv"));
    this.centres = new Float32Array(DUST * 3);
    this.looks = new Float32Array(DUST * 3);
    this.centreAttr = new THREE.InstancedBufferAttribute(this.centres, 3).setUsage(THREE.DynamicDrawUsage);
    this.lookAttr = new THREE.InstancedBufferAttribute(this.looks, 3).setUsage(THREE.DynamicDrawUsage);
    dustGeometry.setAttribute("aCentre", this.centreAttr);
    dustGeometry.setAttribute("aLook", this.lookAttr);
    dustGeometry.instanceCount = DUST;
    this.dustUniforms = { uFlash: { value: 0 }, uBreak: { value: fail }, ...fogUniforms() };
    this.dust = new THREE.Mesh(dustGeometry, own(new THREE.ShaderMaterial({
      uniforms: this.dustUniforms, vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT,
      fog: true, transparent: true, depthWrite: false,
    })));
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 2;
    this.root.add(this.dust);
    this.puffs = Array.from({ length: DUST }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 0, size: 0, seed: Math.random() }));
    this._next = 0;

    this.started = false;
    this.t = 0;
    this.pending = [];
    this.random = (() => {
      let s = seed * 9301 + 49297;
      return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    })();
  }

  /** The blast. `listener`: where the sound is heard (the player), world space. */
  start(listener) {
    if (this.started) return;
    this.started = true;
    this.t = 0;
    const world = this.root.position.clone().setY(this.root.position.y + this.fail);
    const delay = listener ? world.distanceTo(listener) / SPEED_OF_SOUND : 0.25;
    this.pending = [
      { at: 0, kind: "seen", strength: 1 },
      { at: delay, kind: "blast", strength: 0.7 },
      { at: BLAST_TO_FALL + 0.8 + delay, kind: "fall", strength: 1 },
    ];
  }

  get fallen() {
    return this.uniforms.uDrop.value >= this.height - this.fail;
  }

  _puff(fromY, speed, size, life) {
    const k = this.random;
    const d = this.puffs[this._next];
    this._next = (this._next + 1) % DUST;
    const a = k() * Math.PI * 2;
    d.p.set(Math.cos(a) * this.width * 0.55, fromY + (k() - 0.5) * 6, Math.sin(a) * this.depth * 0.55);
    d.v.set(Math.cos(a) * speed * (0.5 + k()), 1.5 + k() * 4, Math.sin(a) * speed * (0.5 + k()));
    d.age = 0;
    d.life = life * (0.7 + k() * 0.6);
    d.size = size * (0.6 + k() * 0.8);
  }

  /** @returns {{kind:string, strength:number}[]} what happened this frame */
  update(dt, time) {
    const out = [];
    this.uniforms.uTime.value = time;
    if (this.started) {
      this.t += dt;
      const t = this.t;
      for (const e of this.pending) {
        if (!e.done && t >= e.at) {
          e.done = true;
          out.push({ kind: e.kind, strength: e.strength });
        }
      }
      const u = this.uniforms;
      const above = this.height - this.fail;
      u.uBlast.value = Math.max(0, 1 - t / 1.6) * (t < 0.08 ? t / 0.08 : 1);
      this.dustUniforms.uFlash.value = u.uBlast.value;
      if (t < 0.3 && dt > 0) for (let i = 0; i < 3; i += 1) this._puff(this.fail, 9, 14, 9);
      const ft = Math.max(0, t - BLAST_TO_FALL);
      const before = u.uDrop.value;
      u.uDrop.value = Math.min(above, 0.5 * FALL_ACCEL * ft * ft);
      u.uTilt.value = this.lean * Math.min(1, ft / 4);
      u.uDark.value = Math.min(1, ft / 2.5);
      // Dust from the break, as much as the block is falling.
      const falling = (u.uDrop.value - before) / Math.max(dt, 1e-4);
      if (falling > 0.5) {
        this._spawn = (this._spawn ?? 0) + dt * Math.min(18, falling * 0.9);
        while (this._spawn >= 1) {
          this._spawn -= 1;
          this._puff(this.fail - 4, 7 + falling * 0.3, 20, 13);
        }
      }
      if (this.fallen && !this._settled) {
        // The heap lands: one big roll of dust out from the base of the break.
        this._settled = true;
        for (let i = 0; i < 14; i += 1) this._puff(this.fail - 6, 14, 22, 15);
      }
    }
    // The dust: drifts out, slows, climbs, grows, fades.
    for (let i = 0; i < DUST; i += 1) {
      const d = this.puffs[i];
      let alpha = 0;
      let size = 0;
      if (d.life > 0 && d.age < d.life) {
        d.age += dt;
        d.v.x *= Math.exp(-dt * 0.5);
        d.v.z *= Math.exp(-dt * 0.5);
        d.v.y = d.v.y * Math.exp(-dt * 0.15) + dt * 0.6;   // warm: it rises
        d.p.addScaledVector(d.v, dt);
        const k = d.age / d.life;
        size = d.size * (0.5 + k * 1.8);
        alpha = Math.min(1, d.age * 3) * (1 - k * k) * 0.75;
      }
      this.centres.set([d.p.x, d.p.y, d.p.z], i * 3);
      this.looks[i * 3] = size;
      this.looks[i * 3 + 1] = alpha;
      this.looks[i * 3 + 2] = d.seed;
    }
    this.centreAttr.needsUpdate = true;
    this.lookAttr.needsUpdate = true;
    return out;
  }

  dispose() {
    this.root.removeFromParent();
    for (const o of this.owned) o.dispose?.();
    this.owned.length = 0;
  }
}
