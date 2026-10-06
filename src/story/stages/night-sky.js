/**
 * The sky after the blast (Phase 5, the Skyline): what you see lying on your
 * back on the far building - the smoke going up from where the tower and
 * the bridge were, lit orange from underneath, embers rising through it,
 * two police searchlights sweeping across it, and stars in the gaps.
 *
 * Unlit and light-free (sprites, points and additive cones), like the
 * Fireball: adding real lights mid-cutscene would recompile the level.
 *
 *   const sky = new SmokeSky({ fire: towerBaseWorld });
 *   scene.add(sky.root);           // root at the ledge you lie on
 *   sky.setVisible(true);          // from the blast on
 *   sky.update(dt, time);          // every frame
 */

import * as THREE from "../../three.js";
import { beamMaterial } from "../../fx/police-helicopters.js";

function puffTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  // Lumpy, not a perfect disc: a few overlapping blobs.
  for (const [x, y, r, a] of [[64, 64, 60, 0.75], [44, 58, 34, 0.5], [84, 70, 36, 0.5], [66, 42, 30, 0.45]]) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.6, `rgba(255,255,255,${a * 0.35})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SMOKE = new THREE.Color(0x413a35);
const LIT = new THREE.Color(0xb0521c);

export class SmokeSky {
  /**
   * @param {object} o
   * @param {THREE.Vector3} o.fire  where the fire is below (world), relative
   *   positions are taken from the root, which the host puts at the ledge
   */
  constructor({ fire = new THREE.Vector3(0, -30, 60) } = {}) {
    this.root = new THREE.Group();
    this.root.name = "SmokeSky";
    this.root.visible = false;
    this.fire = fire.clone();
    this._owned = [];
    const own = (x) => (this._owned.push(x), x);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    // Stars: a dome high above, in the gaps.
    {
      const n = 900;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        const a = rnd() * Math.PI * 2;
        const up = 0.18 + rnd() * 0.82;
        const r = 700;
        const flat = Math.sqrt(1 - up * up);
        pos.set([Math.cos(a) * flat * r, up * r, Math.sin(a) * flat * r], i * 3);
      }
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = own(new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      this.stars = new THREE.Points(geo, mat);
      this.stars.frustumCulled = false;
      this.stars.renderOrder = -1;
      this.root.add(this.stars);
    }

    // The smoke column: big soft sprites drifting up and with the wind.
    this.texture = own(puffTexture());
    this.puffs = [];
    for (let i = 0; i < 56; i += 1) {
      const mat = own(new THREE.SpriteMaterial({ map: this.texture, color: SMOKE.clone(), transparent: true, opacity: 0, depthWrite: false, fog: false }));
      const s = new THREE.Sprite(mat);
      this.root.add(s);
      this.puffs.push({
        sprite: s,
        // Some right overhead (you're lying under it), most over the gap behind.
        base: new THREE.Vector3((rnd() - 0.5) * 70, rnd() * 120, (i % 4 === 0 ? -10 : 18) + rnd() * 90),
        size: 26 + rnd() * 40,
        rise: 1.2 + rnd() * 2.2,
        spin: (rnd() - 0.5) * 0.1,
        phase: rnd() * 100,
      });
    }

    // The fire's glow on the underside of it all, low over the tower's ruin.
    this.glows = [];
    for (let i = 0; i < 4; i += 1) {
      const mat = own(new THREE.SpriteMaterial({ map: this.texture, color: new THREE.Color(0xff6a24), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(36 + i * 14);
      this.root.add(s);
      this.glows.push({ sprite: s, i });
    }

    // Embers going up.
    {
      const n = 260;
      const pos = new Float32Array(n * 3);
      this.emberSpeed = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        pos.set([(rnd() - 0.5) * 60, rnd() * 80, 30 + rnd() * 70], i * 3);
        this.emberSpeed[i] = 2 + rnd() * 5;
      }
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = own(new THREE.PointsMaterial({ color: 0xffa046, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      this.embers = new THREE.Points(geo, mat);
      this.embers.frustumCulled = false;
      this.root.add(this.embers);
    }

    // Two police helicopters overhead (just their strobes) and their beams
    // sweeping across the smoke and the roof you're lying on.
    const beamGeo = own(new THREE.CylinderGeometry(0.2, 9, 1, 24, 1, true));
    beamGeo.translate(0, -0.5, 0);
    beamGeo.rotateX(-Math.PI / 2);
    const glow = own(this._glowTexture());
    this.lights = [];
    for (const [i, [x, y, z]] of [[-34, 62, 40], [30, 70, 70]].entries()) {
      const mat = own(beamMaterial());
      mat.uniforms.uOpacity.value = 0.42;
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.frustumCulled = false;
      beam.position.set(x, y, z);
      const strobes = [0xff2a2a, 0x2a5aff].map((c) => {
        const m = own(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        const sp = new THREE.Sprite(m);
        sp.scale.setScalar(5);
        return sp;
      });
      strobes[0].position.set(x - 1.4, y + 0.6, z);
      strobes[1].position.set(x + 1.4, y + 0.6, z);
      const lamp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: glow, color: 0xf4f7ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
      lamp.scale.setScalar(6);
      lamp.position.set(x, y - 0.8, z);
      this.root.add(beam, lamp, ...strobes);
      this.lights.push({ beam, strobes, lamp, i, aim: new THREE.Vector3() });
    }
  }

  _glowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  setVisible(on) {
    this.root.visible = on;
  }

  update(dt, time) {
    if (!this.root.visible) return;
    // The fire below, in the root's frame.
    const fire = this.root.worldToLocal(this.fire.clone());
    for (const p of this.puffs) {
      // Up, then out with the wind; each one wraps round to the bottom.
      const h = (p.base.y + time * p.rise) % 130;
      p.sprite.position.set(p.base.x + h * 0.35 + Math.sin(time * 0.1 + p.phase) * 3, h - 6, p.base.z);
      const s = p.size * (0.7 + h / 130);
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.rotation = p.phase + time * p.spin;
      // Lit from below near the bottom; thinning out at the top.
      const low = 1 - Math.min(1, h / 70);
      p.sprite.material.color.copy(SMOKE).lerp(LIT, low * low * 0.9);
      p.sprite.material.opacity = Math.min(1, h / 12) * (1 - Math.max(0, (h - 100) / 30)) * 0.8;
    }
    for (const g of this.glows) {
      g.sprite.position.set(fire.x + (g.i - 1.5) * 14, fire.y + 10 + g.i * 6, fire.z);
      g.sprite.material.opacity = (0.22 + Math.sin(time * 3.1 + g.i * 1.7) * 0.05) * (1 - g.i * 0.15);
    }
    const a = this.embers.geometry.attributes.position.array;
    for (let i = 0; i < this.emberSpeed.length; i += 1) {
      a[i * 3 + 1] += this.emberSpeed[i] * dt;
      a[i * 3] += Math.sin(time * 0.9 + i) * dt * 1.5 + dt * 1.2;
      if (a[i * 3 + 1] > 90) a[i * 3 + 1] = -10;
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
    for (const l of this.lights) {
      // Sweep: across the smoke and over the roof.
      const t = time * (0.33 + l.i * 0.07) + l.i * 2;
      l.aim.set(Math.sin(t) * 26, -4 + Math.sin(t * 0.7) * 6, 10 + Math.cos(t * 0.8) * 22);
      l.beam.lookAt(this.root.localToWorld(l.aim.clone()));
      l.beam.scale.set(1, 1, l.beam.position.distanceTo(l.aim));
      const beat = (time * 2.2 + l.i * 0.37) % 1;
      const redOn = beat < 0.12 || (beat > 0.2 && beat < 0.3);
      const blueOn = (beat > 0.5 && beat < 0.62) || (beat > 0.7 && beat < 0.8);
      l.strobes[0].material.opacity = redOn ? 1 : 0.08;
      l.strobes[1].material.opacity = blueOn ? 1 : 0.08;
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this._owned) x.dispose();
    this._owned.length = 0;
  }
}
