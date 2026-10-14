/**
 * A special sphere going off - the Skyline's look, in every level.
 *
 * Shock (and anything else) pulses out in its colour: a bright core, a
 * shell of light swelling to the burst's reach and throbbing as it fades, a
 * shockwave ring along the floor, and a flash that lights the room in that
 * colour, flickering like a spark.
 *
 * Cryo freezes instead: a faceted shell of ice that spreads without a
 * pulse, a frost patch that creeps out across the floor in crystal branches
 * and lingers, a crown of ice spikes that shoots up and melts back down, and
 * a steady cold light.
 *
 *   const fx = new SphereImpactFX(scene);   // its one light goes in now
 *   fx.splash(point, "shock", 5.2);
 *   fx.update(dt);                          // every frame
 *
 * Pooled: a handful of bursts at once, nothing allocated after the start.
 * The light is created with the effect (intensity 0), so a burst never adds
 * a light to the scene - which would recompile every material in it.
 */

import * as THREE from "../three.js";
import { BALLS } from "../systems/arsenal.js";

const POOL = 6;
const LIFE = 0.75;
/** A cryo burst: the shell's spread, and how long the frost stays. */
const FROST_SHELL = 0.9;
const FROST_LIFE = 2.6;
/** Ice spikes per cryo burst. */
const SPIKES = 11;

/**
 * The shell: lit at its rim, clear in the middle (a bubble of light, not a
 * ball of paint), and only its outside drawn - so a camera inside a burst
 * never sees a wall of colour across the screen.
 */
function shellMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Clamped: a dot a hair over 1 makes pow() NaN, and bloom spreads a NaN into black blocks.
        float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0), 2.2);
        gl_FragColor = vec4(uColor * (0.15 + rim * 1.6), uOpacity * (0.2 + rim));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

/**
 * Ice: flat facets (the normal from the screen-space derivatives, so every
 * face catches the light differently), pale and see-through in the middle,
 * white at the edges. No lights needed.
 */
function iceMaterial({ instanced = false, deep = [0.32, 0.66, 0.95], frost = 0.55 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uDeep: { value: new THREE.Color(...deep) }, uFrost: { value: frost } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vec4 p = vec4(position, 1.0);
        ${instanced ? "p = instanceMatrix * p;" : ""}
        vec4 mv = modelViewMatrix * p;
        vPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uDeep;
      uniform float uFrost;
      varying vec3 vPos;
      void main() {
        // A melted spike is a sliver with no area: no normal (normalize(0) is NaN).
        vec3 c = cross(dFdx(vPos), dFdy(vPos));
        float area = length(c);
        if (area < 1e-10) discard;
        vec3 n = c / area;
        vec3 v = normalize(-vPos);
        if (dot(n, v) < 0.0) n = -n;
        float facing = clamp(abs(dot(n, v)), 0.0, 1.0);
        float rim = pow(1.0 - facing, 1.6);
        float key = max(dot(n, normalize(vec3(0.4, 0.8, 0.45))), 0.0);
        vec3 col = mix(uDeep, vec3(0.92, 0.98, 1.0), clamp(rim + key * uFrost, 0.0, 1.0));
        // A glint on the faces turned toward the light.
        col += pow(key, 12.0) * 0.8;
        gl_FragColor = vec4(col, uOpacity * (0.62 + rim * 0.38));
      }`,
    transparent: true,
    depthWrite: false,
  });
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Alpha across a disc: nothing in the middle, a soft bright band near the rim. */
function ringTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.04)");
  grad.addColorStop(0.78, "rgba(255,255,255,0.45)");
  grad.addColorStop(0.9, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.96, "rgba(255,255,255,0.3)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Frost on the floor, seen from above: a pale rime thickest in the middle,
 * crystal branches (with side shoots, like frost on a window) running out to
 * a ragged edge.
 */
function frostTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  // A fixed seed: the same frost every time, no Math.random at load.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rime = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rime.addColorStop(0, "rgba(235,250,255,0.75)");
  rime.addColorStop(0.35, "rgba(200,238,255,0.42)");
  rime.addColorStop(0.75, "rgba(170,225,255,0.14)");
  rime.addColorStop(1, "rgba(170,225,255,0)");
  g.fillStyle = rime;
  g.fillRect(0, 0, S, S);
  g.lineCap = "round";
  const branch = (x, y, angle, length, width, depth) => {
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    g.strokeStyle = `rgba(255,255,255,${0.35 + depth * 0.2})`;
    g.lineWidth = width;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    if (depth <= 0) return;
    // Side shoots at the frost's own 60 degrees, both ways along the branch.
    const shoots = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < shoots; i += 1) {
      const t = 0.25 + rand() * 0.6;
      const side = rand() < 0.5 ? -1 : 1;
      branch(x + (x2 - x) * t, y + (y2 - y) * t, angle + side * (Math.PI / 3) * (0.8 + rand() * 0.3), length * (0.28 + rand() * 0.22), width * 0.6, depth - 1);
    }
  };
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2 + rand() * 0.25;
    branch(S / 2, S / 2, a, S * (0.3 + rand() * 0.17), 2.4, 2);
  }
  // Specks of rime between the branches.
  for (let i = 0; i < 260; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * S * 0.46;
    g.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.5})`;
    g.fillRect(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An ice spike: four-sided, its base at the origin, pointing up +Y (1 m). */
function spikeGeometry() {
  const geo = new THREE.ConeGeometry(0.22, 1, 4, 1);
  geo.translate(0, 0.5, 0);
  return geo.toNonIndexed();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class SphereImpactFX {
  /**
   * @param {THREE.Object3D} scene
   * @param {object} [o]
   * @param {number} [o.floorY]  where the shockwave ring lies
   */
  constructor(scene, { floorY = 0.04 } = {}) {
    this.root = new THREE.Group();
    this.root.name = "SphereImpacts";
    scene.add(this.root);
    this.floorY = floorY;
    this.glow = glowTexture();
    this.shellGeometry = new THREE.SphereGeometry(1, 24, 16);
    // Cryo's shell: a low icosahedron - facets, not a smooth bubble.
    this.iceShellGeometry = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    // A wide, soft-edged band (a radial texture across a disc), not a flat
    // ribbon: the shock fades in from the middle and out past its edge.
    this.ringGeometry = new THREE.CircleGeometry(1, 48);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.ringTexture = ringTexture();
    this.frostTexture = frostTexture();
    this.spikeGeometry = spikeGeometry();
    this.light = new THREE.PointLight(0xffffff, 0, 16, 1.8);
    this.root.add(this.light);
    this.lightLevel = 0;
    this.lightSteady = false;
    this.slots = [];
    for (let i = 0; i < POOL; i += 1) {
      const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
      const shell = new THREE.Mesh(this.shellGeometry, shellMaterial());
      const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({ ...additive, map: this.ringTexture, side: THREE.DoubleSide }));
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive, map: this.glow }));
      const iceShell = new THREE.Mesh(this.iceShellGeometry, iceMaterial());
      const frost = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
        map: this.frostTexture, color: 0xd8f4ff, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      const spikes = new THREE.InstancedMesh(this.spikeGeometry, iceMaterial({ instanced: true, deep: [0.1, 0.38, 0.82], frost: 0.35 }), SPIKES);
      spikes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Drawn over the frost they stand in.
      frost.renderOrder = 1;
      spikes.renderOrder = 2;
      const parts = [shell, ring, core, iceShell, frost, spikes];
      for (const m of parts) { m.visible = false; m.frustumCulled = false; this.root.add(m); }
      // Each spike: where round the burst, how far out, how tall, its lean, when it rises.
      const spike = Array.from({ length: SPIKES }, () => ({ angle: 0, out: 0, height: 0, lean: 0, delay: 0 }));
      this.slots.push({ shell, ring, core, iceShell, frost, spikes, spike, parts, kind: "shock", age: LIFE, life: LIFE, radius: 1, colour: new THREE.Color(), base: new THREE.Vector3() });
    }
  }

  /**
   * A sphere of type `kind` bursting at `point`, reaching `radius` metres
   * (or anything else: `glow` is its colour, [r, g, b], over 1 to bloom).
   */
  splash(point, kind = "shock", radius = 5, glow = null) {
    // The burst furthest through its life makes way.
    const slot = this.slots.reduce((a, b) => (b.age / b.life > a.age / a.life ? b : a));
    for (const m of slot.parts) m.visible = false;
    const ball = BALLS[kind] ?? BALLS.glass;
    // Its own hue, saturated: normalised so the brightest channel is ~1.3
    // (any brighter and additive blending washes it out to white).
    const [r, g, b] = glow ?? ball.glow;
    slot.colour.setRGB(r, g, b).multiplyScalar(1.3 / Math.max(r, g, b));
    slot.kind = kind === "cryo" && !glow ? "cryo" : "shock";
    slot.life = slot.kind === "cryo" ? FROST_LIFE : LIFE;
    slot.age = 0;
    slot.radius = radius;
    const floor = Math.min(point.y, this.floorY + 0.02) + 0.02;
    slot.base.set(point.x, floor, point.z);
    if (slot.kind === "cryo") {
      slot.iceShell.position.copy(point);
      slot.iceShell.rotation.set(Math.random() * 6.28, Math.random() * 6.28, 0);
      slot.frost.position.copy(slot.base);
      slot.frost.rotation.y = Math.random() * Math.PI * 2;
      slot.core.position.copy(point);
      slot.core.material.color.setRGB(0.75, 0.95, 1.0);
      for (let i = 0; i < SPIKES; i += 1) {
        const s = slot.spike[i];
        s.angle = (i / SPIKES) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        // A ring of tall ones round the middle, shorter ones further out.
        s.out = radius * (0.12 + Math.random() * 0.4);
        s.height = (0.9 + Math.random() * 0.9) * (1.2 - s.out / radius) * Math.min(1.5, radius / 4);
        s.lean = 0.25 + Math.random() * 0.45;
        s.delay = (s.out / radius) * 0.18;
      }
      for (const m of [slot.iceShell, slot.frost, slot.spikes, slot.core]) m.visible = true;
      slot.spikes.position.copy(slot.base);
      this._placeSpikes(slot);
    } else {
      slot.shell.position.copy(point);
      slot.core.position.copy(point);
      slot.ring.position.copy(slot.base);
      for (const m of [slot.shell, slot.ring, slot.core]) {
        m.visible = true;
        (m.material.uniforms?.uColor.value ?? m.material.color).copy(slot.colour);
      }
    }
    this.light.position.copy(point);
    this.light.color.copy(slot.colour).multiplyScalar(1 / Math.max(slot.colour.r, slot.colour.g, slot.colour.b, 1e-3));
    this.lightLevel = 1;
    this.lightSteady = slot.kind === "cryo";
  }

  /** The spikes at this moment: shooting up, standing, then melting down into the floor. */
  _placeSpikes(slot) {
    const t = slot.age;
    for (let i = 0; i < SPIKES; i += 1) {
      const s = slot.spike[i];
      const rise = THREE.MathUtils.clamp((t - s.delay) / 0.14, 0, 1);
      const grow = 1 - (1 - rise) ** 3;
      const melt = THREE.MathUtils.clamp((t - (1.3 + s.delay)) / 0.9, 0, 1);
      const h = Math.max(0.02, s.height * grow * (1 - melt * melt));
      const w = 0.6 + 0.6 * (1 - melt);
      _p.set(Math.sin(s.angle) * s.out, -0.04, Math.cos(s.angle) * s.out);
      // Leaning out from the middle (tilted toward +Z, then turned round to its angle).
      _e.set(s.lean, s.angle, 0, "YXZ");
      _q.setFromEuler(_e);
      _s.set(w, h, w);
      slot.spikes.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    slot.spikes.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    for (const s of this.slots) {
      if (s.age >= s.life) continue;
      s.age += dt;
      if (s.kind === "cryo") this._updateFrost(s);
      else this._updateShock(s);
      if (s.age >= s.life) for (const m of s.parts) m.visible = false;
    }
    // Shock flickers like a spark; the cold just fades.
    this.lightLevel = Math.max(0, this.lightLevel - dt * (this.lightSteady ? 1.3 : 2.2));
    const flicker = this.lightSteady ? 0.85 : 0.75 + 0.25 * Math.cos(performance.now() * 0.03);
    this.light.intensity = 60 * this.lightLevel ** 2 * flicker;
  }

  _updateShock(s) {
    const k = Math.min(1, s.age / s.life);
    const out = 1 - (1 - k) ** 3;
    // The colour throbs as it fades - the burst pulsing.
    const pulse = 0.65 + 0.35 * Math.cos(s.age * 38);
    const fade = (1 - k) ** 1.6;
    s.shell.scale.setScalar(Math.max(0.05, s.radius * out));
    s.shell.material.uniforms.uOpacity.value = 0.55 * fade * pulse;
    s.ring.scale.setScalar(Math.max(0.05, s.radius * 1.25 * out));
    s.ring.material.opacity = 0.9 * fade;
    s.core.scale.setScalar(1.2 + s.radius * 0.5 * (1 - k) * pulse);
    s.core.material.opacity = Math.min(1, (1 - k) * 1.6);
  }

  _updateFrost(s) {
    // The ice shell: out fast, then gone - no pulse.
    const k = Math.min(1, s.age / FROST_SHELL);
    const out = 1 - (1 - k) ** 4;
    s.iceShell.visible = k < 1;
    s.iceShell.scale.setScalar(Math.max(0.05, s.radius * 0.85 * out));
    s.iceShell.material.uniforms.uOpacity.value = 0.5 * (1 - k) ** 1.4;
    // A quick white flash at the heart.
    const c = Math.min(1, s.age / 0.35);
    s.core.visible = c < 1;
    s.core.scale.setScalar(0.8 + s.radius * 0.35 * (1 - c));
    s.core.material.opacity = (1 - c) * 0.9;
    // The frost creeps out over half a second, holds, then thaws away.
    const creep = 1 - (1 - Math.min(1, s.age / 0.5)) ** 3;
    const thaw = THREE.MathUtils.clamp((s.age - 1.4) / (s.life - 1.4), 0, 1);
    s.frost.scale.setScalar(Math.max(0.05, s.radius * (0.3 + 0.75 * creep)));
    s.frost.material.opacity = 0.9 * (1 - thaw * thaw);
    // The spikes: up, stand, melt.
    s.spikes.material.uniforms.uOpacity.value = 1 - thaw;
    this._placeSpikes(s);
  }

  clear() {
    for (const s of this.slots) { s.age = s.life; for (const m of s.parts) m.visible = false; }
    this.lightLevel = 0;
    this.light.intensity = 0;
  }

  dispose() {
    this.root.removeFromParent();
    this.shellGeometry.dispose();
    this.iceShellGeometry.dispose();
    this.ringGeometry.dispose();
    this.spikeGeometry.dispose();
    this.glow.dispose();
    this.ringTexture.dispose();
    this.frostTexture.dispose();
    for (const s of this.slots) for (const m of s.parts) m.material.dispose();
  }
}
