/**
 * A special sphere going off - the Skyline's look, in every level. Where a
 * cryo or shock sphere bursts, its colour pulses out: a bright core, a
 * shell of light swelling to the burst's reach and throbbing as it fades, a
 * shockwave ring along the floor, and a flash that lights the room in that
 * colour for a moment.
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
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        gl_FragColor = vec4(uColor * (0.15 + rim * 1.6), uOpacity * (0.2 + rim));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
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
    // A wide, soft-edged band (a radial texture across a disc), not a flat
    // ribbon: the shock fades in from the middle and out past its edge.
    this.ringGeometry = new THREE.CircleGeometry(1, 48);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.ringTexture = ringTexture();
    this.light = new THREE.PointLight(0xffffff, 0, 16, 1.8);
    this.root.add(this.light);
    this.lightLevel = 0;
    this.slots = [];
    for (let i = 0; i < POOL; i += 1) {
      const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
      const shell = new THREE.Mesh(this.shellGeometry, shellMaterial());
      const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({ ...additive, map: this.ringTexture, side: THREE.DoubleSide }));
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive, map: this.glow }));
      for (const m of [shell, ring, core]) { m.visible = false; m.frustumCulled = false; this.root.add(m); }
      this.slots.push({ shell, ring, core, age: LIFE, radius: 1, colour: new THREE.Color() });
    }
  }

  /**
   * A sphere of type `kind` bursting at `point`, reaching `radius` metres
   * (or anything else: `glow` is its colour, [r, g, b], over 1 to bloom).
   */
  splash(point, kind = "shock", radius = 5, glow = null) {
    const slot = this.slots.reduce((a, b) => (b.age > a.age ? b : a));
    const ball = BALLS[kind] ?? BALLS.glass;
    // Its own hue, saturated: normalised so the brightest channel is ~1.3
    // (any brighter and additive blending washes it out to white).
    const [r, g, b] = glow ?? ball.glow;
    slot.colour.setRGB(r, g, b).multiplyScalar(1.3 / Math.max(r, g, b));
    slot.age = 0;
    slot.radius = radius;
    slot.shell.position.copy(point);
    slot.core.position.copy(point);
    slot.ring.position.set(point.x, Math.min(point.y, this.floorY + 0.02) + 0.02, point.z);
    for (const m of [slot.shell, slot.ring, slot.core]) {
      m.visible = true;
      (m.material.uniforms?.uColor.value ?? m.material.color).copy(slot.colour);
    }
    this.light.position.copy(point);
    this.light.color.copy(slot.colour).multiplyScalar(1 / Math.max(slot.colour.r, slot.colour.g, slot.colour.b, 1e-3));
    this.lightLevel = 1;
  }

  update(dt) {
    for (const s of this.slots) {
      if (s.age >= LIFE) continue;
      s.age += dt;
      const k = Math.min(1, s.age / LIFE);
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
      if (k >= 1) for (const m of [s.shell, s.ring, s.core]) m.visible = false;
    }
    this.lightLevel = Math.max(0, this.lightLevel - dt * 2.2);
    this.light.intensity = 60 * this.lightLevel ** 2 * (0.75 + 0.25 * Math.cos(performance.now() * 0.03));
  }

  clear() {
    for (const s of this.slots) { s.age = LIFE; for (const m of [s.shell, s.ring, s.core]) m.visible = false; }
    this.lightLevel = 0;
    this.light.intensity = 0;
  }

  dispose() {
    this.root.removeFromParent();
    this.shellGeometry.dispose();
    this.ringGeometry.dispose();
    this.glow.dispose();
    this.ringTexture.dispose();
    for (const s of this.slots) for (const m of [s.shell, s.ring, s.core]) m.material.dispose();
  }
}
