/**
 * A fireball for the story's blast (Phase 5): a cluster of additive,
 * billowing sprites that swell, rise and burn out into smoke. Unlit and
 * light-free on purpose - adding a real light to a level's scene would
 * recompile every material in it mid-cutscene.
 *
 *   const fire = new Fireball();
 *   scene.add(fire.root);
 *   fire.burst(position, { size: 30 });
 *   fire.update(dt);   // every frame
 */

import * as THREE from "../../three.js";

function puffTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const COUNT = 26;
const HOT = new THREE.Color(1, 0.86, 0.55);
const BURN = new THREE.Color(1, 0.38, 0.08);
const SMOKE = new THREE.Color(0.16, 0.12, 0.11);

export class Fireball {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = "Fireball";
    this.texture = puffTexture();
    this.puffs = [];
    for (let i = 0; i < COUNT; i += 1) {
      const material = new THREE.SpriteMaterial({ map: this.texture, color: HOT.clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.root.add(sprite);
      this.puffs.push({ sprite, velocity: new THREE.Vector3(), life: 0, age: 0, size: 1 });
    }
    this.active = false;
  }

  /**
   * Go off at `at` (in this.root's parent's frame - world, if the fireball
   * is added to the scene). `spread` scales how far the puffs fly out.
   */
  burst(at, { size = 26, spread = 1 } = {}) {
    this.active = true;
    this.puffs.forEach((p, i) => {
      const a = (i / COUNT) * Math.PI * 2 * 3.1;
      const up = 0.3 + ((i * 7) % 11) / 11;
      p.velocity.set(Math.cos(a) * (1 - up) * size * 0.45, up * size * 0.55, Math.sin(a) * (1 - up) * size * 0.45).multiplyScalar(spread);
      p.sprite.position.copy(at);
      p.age = -i * 0.025; // a quick ripple out, not all at once
      p.life = 3.2 + ((i * 13) % 7) * 0.25;
      p.size = size * (0.35 + ((i * 5) % 9) / 18);
      p.sprite.visible = true;
    });
  }

  update(dt) {
    if (!this.active) return;
    let alive = 0;
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age < 0) continue;
      const k = p.age / p.life;
      if (k >= 1) {
        p.sprite.visible = false;
        continue;
      }
      alive += 1;
      // Out fast, then drag; a slow rise as it burns.
      p.sprite.position.addScaledVector(p.velocity, dt * Math.max(0.05, 1 - k * 1.6));
      p.sprite.position.y += dt * 3 * k;
      const s = p.size * (0.4 + Math.sqrt(k) * 1.4);
      p.sprite.scale.set(s, s, 1);
      const m = p.sprite.material;
      // White-hot, to orange, to smoke (which stops glowing).
      if (k < 0.3) m.color.copy(HOT).lerp(BURN, k / 0.3);
      else m.color.copy(BURN).lerp(SMOKE, Math.min(1, (k - 0.3) / 0.5));
      m.blending = k < 0.55 ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.opacity = k < 0.08 ? k / 0.08 : (1 - k) * 0.9;
    }
    if (!alive) this.active = false;
  }

  dispose() {
    this.root.removeFromParent();
    this.texture.dispose();
    for (const p of this.puffs) p.sprite.material.dispose();
  }
}
