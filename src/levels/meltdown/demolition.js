/**
 * A generic tower of the city brought down, the way it happens in the
 * movies - and in real demolitions.
 *
 *   0.0 s   charges: a ripple of white-orange flashes down the corners,
 *           floor after floor, each with a spit of dust
 *   1.4 s   a beat of nothing - then the whole building drops straight down
 *           into its own footprint at g, the facade buckling, its lights
 *           dying, crushed into a heap a tenth of its height (city.js's
 *           tower shader does the falling: setFall)
 *           dust surges out along the streets from the base, a column
 *           climbs past the roof, chunks shed from the facade
 *   ~7 s    the heap, and the dust, drifting for half a minute
 *
 * You see it at once; you hear it - and feel it - distance / 343 m/s later.
 * update() returns what happens each frame for the host's sound and shake:
 * { kind: "seen" }, then "charges", "fall" and "impact" when their sound
 * reaches the listener.
 *
 *   const d = new Demolition({ city, tower: city.demolitions[0] });
 *   scene.add(d.root);
 *   d.start(listener);
 *   for (const e of d.update(dt, time)) ...;
 */

import * as THREE from "../../three.js";
import { DUST_VERTEX, DUST_FRAGMENT, fogUniforms } from "./skyline-collapse.js";

const SPEED_OF_SOUND = 343;
const G = 9.8;
const CHARGES = 10;
const CHARGE_GAP = 0.12;
const DROP_AT = 1.4;
const DUST = 420;
const CHUNKS = 48;

export class Demolition {
  /**
   * @param {object} o
   * @param {import("./city.js").CityAtNight} o.city
   * @param {object} o.tower   one of city.demolitions
   * @param {number} [o.seed]
   */
  constructor({ city, tower, seed = 1 }) {
    this.city = city;
    this.tower = tower;
    this.streetY = city.streetY;
    this.height = tower.top - this.streetY;         // above the street
    this.root = new THREE.Group();
    this.root.name = "Demolition";
    this.root.position.set(tower.x, this.streetY, tower.z);
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    let s = seed * 9301 + 49297;
    this.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

    // Charge flashes: sprites at the corners.
    const flash = own(new THREE.SpriteMaterial({ color: 0xfff0d0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, map: own(softDot()) }));
    this.charges = [];
    const c = Math.cos(tower.yaw);
    const sn = Math.sin(tower.yaw);
    for (let i = 0; i < CHARGES; i += 1) {
      const sx = (i % 2 ? 1 : -1) * tower.w * 0.52;
      const sz = (i % 4 < 2 ? 1 : -1) * tower.d * 0.52;
      const sprite = new THREE.Sprite(flash.clone());
      this.owned.push(sprite.material);
      // Down the building: from about half way to near the street.
      sprite.position.set(c * sx + sn * sz, this.height * (0.55 - (i / CHARGES) * 0.47), -sn * sx + c * sz);
      sprite.visible = false;
      this.root.add(sprite);
      this.charges.push({ sprite, at: i * CHARGE_GAP });
    }

    // The dust: camera-facing billboards (skyline-collapse.js's shader).
    const quad = own(new THREE.PlaneGeometry(1, 1));
    const geometry = own(new THREE.InstancedBufferGeometry());
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("uv", quad.getAttribute("uv"));
    this.centres = new Float32Array(DUST * 3);
    this.looks = new Float32Array(DUST * 3);
    this.centreAttr = new THREE.InstancedBufferAttribute(this.centres, 3).setUsage(THREE.DynamicDrawUsage);
    this.lookAttr = new THREE.InstancedBufferAttribute(this.looks, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aCentre", this.centreAttr);
    geometry.setAttribute("aLook", this.lookAttr);
    geometry.instanceCount = DUST;
    this.dustUniforms = { uFlash: { value: 0 }, uBreak: { value: 4 }, ...fogUniforms() };
    this.dust = new THREE.Mesh(geometry, own(new THREE.ShaderMaterial({
      uniforms: this.dustUniforms, vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT,
      fog: true, transparent: true, depthWrite: false,
    })));
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 2;
    this.root.add(this.dust);
    this.puffs = Array.from({ length: DUST }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 0, size: 0, seed: this.random() }));
    this._next = 0;

    // Chunks shed from the facade as it goes.
    this.chunks = new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 1, 1)), own(new THREE.MeshLambertMaterial({ color: 0x77706a })), CHUNKS);
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunks.frustumCulled = false;
    this.root.add(this.chunks);
    this.bits = Array.from({ length: CHUNKS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), spin: new THREE.Euler(), w: new THREE.Vector3(), size: 0, alive: false }));
    this._nextBit = 0;

    this.started = false;
    this.t = 0;
    this.drop = 0;
    this.pending = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._updateDust(0);
    this._updateChunks(0);
  }

  /** Seconds from the first charge until the heap lands. */
  get duration() {
    return DROP_AT + Math.sqrt((2 * this.height * 0.9) / G);
  }

  /** How far down it has come, 0..1 (for a camera following it). */
  get progress() {
    return Math.min(1, this.drop / (this.height * 0.9));
  }

  /** The charges. `listener`: where the sound is heard (the player), world space. */
  start(listener) {
    if (this.started) return;
    this.started = true;
    this.t = 0;
    const at = this.root.position.clone().setY(this.streetY + this.height * 0.4);
    const delay = listener ? at.distanceTo(listener) / SPEED_OF_SOUND : 0.3;
    this.pending = [
      { at: 0, kind: "seen", strength: 1 },
      { at: delay, kind: "charges", strength: 0.6 },
      { at: DROP_AT + 0.3 + delay, kind: "fall", strength: 1 },
      { at: this.duration + delay, kind: "impact", strength: 1 },
    ];
  }

  _puff(x, y, z, vx, vy, vz, size, life) {
    const d = this.puffs[this._next];
    this._next = (this._next + 1) % DUST;
    d.p.set(x, y, z);
    d.v.set(vx, vy, vz);
    d.age = 0;
    d.life = life * (0.75 + this.random() * 0.5);
    d.size = size * (0.7 + this.random() * 0.6);
  }

  /** A puff at the foot of the building, rolling out along the ground. */
  _surge(speed, size, life) {
    const k = this.random;
    const a = k() * Math.PI * 2;
    const r = Math.max(this.tower.w, this.tower.d) * 0.55;
    this._puff(Math.cos(a) * r, 3 + k() * 8, Math.sin(a) * r, Math.cos(a) * speed * (0.6 + k() * 0.8), 1 + k() * 3, Math.sin(a) * speed * (0.6 + k() * 0.8), size, life);
  }

  update(dt, time) {
    const out = [];
    if (this.started) {
      this.t += dt;
      const t = this.t;
      for (const e of this.pending) {
        if (!e.done && t >= e.at) {
          e.done = true;
          out.push({ kind: e.kind, strength: e.strength });
        }
      }
      // The charges, one after another down the building.
      let flashing = 0;
      for (const ch of this.charges) {
        const age = t - ch.at;
        const on = age >= 0 && age < 0.32;
        ch.sprite.visible = on;
        if (on) {
          const k = 1 - age / 0.32;
          ch.sprite.scale.setScalar(6 + 26 * k);
          ch.sprite.material.opacity = k;
          flashing = Math.max(flashing, k);
          if (!ch.puffed) {
            ch.puffed = true;
            const p = ch.sprite.position;
            for (let i = 0; i < 3; i += 1) this._puff(p.x, p.y, p.z, p.x * 0.4, 1, p.z * 0.4, 9, 6);
          }
        }
      }
      this.dustUniforms.uFlash.value = flashing;
      // The drop: straight down at g, into a heap a tenth of its height.
      const ft = Math.max(0, t - DROP_AT);
      const before = this.drop;
      this.drop = Math.min(this.height * 0.9, 0.5 * G * ft * ft);
      const speed = (this.drop - before) / Math.max(dt, 1e-4);
      // The lights: a stutter as the power goes, then out.
      const dark = t < DROP_AT - 0.2 ? 0 : t < DROP_AT + 0.8 ? (Math.sin(t * 47) > 0.2 ? 0.85 : 0.2) : 1;
      this.city.setFall(this.tower, this.drop, dark);
      this.dustUniforms.uBreak.value = this.height * 0.1;
      if (ft > 0 && speed > 0.5) {
        // Surging out along the streets, and a column climbing.
        this._spawn = (this._spawn ?? 0) + dt * Math.min(40, 8 + speed * 1.2);
        while (this._spawn >= 1) {
          this._spawn -= 1;
          if (this.random() < 0.7) this._surge(14 + speed * 0.5, 38, 20);
          else this._puff((this.random() - 0.5) * this.tower.w, this.height * 0.1 + this.random() * 20, (this.random() - 0.5) * this.tower.d, 0, 6 + this.random() * 5, 0, 34, 22);
        }
        // And it sinks into its own dust: puffs at its falling top, which
        // climb over the rooftops round you.
        this._engulf = (this._engulf ?? 0) + dt * 14;
        while (this._engulf >= 1) {
          this._engulf -= 1;
          const y = Math.max(this.height * 0.1, this.height - this.drop) + (this.random() - 0.3) * 12;
          this._puff((this.random() - 0.5) * this.tower.w * 1.3, y, (this.random() - 0.5) * this.tower.d * 1.3, (this.random() - 0.5) * 4, 4 + this.random() * 5, (this.random() - 0.5) * 4, 40, 22);
        }
        // Chunks off the facade, near the crush.
        this._shed = (this._shed ?? 0) + dt * 16;
        while (this._shed >= 1) {
          this._shed -= 1;
          this._chunk(speed);
        }
      }
      if (this.drop >= this.height * 0.9 && !this._landed) {
        // The heap lands: one last roll of dust, the biggest.
        this._landed = true;
        for (let i = 0; i < 30; i += 1) this._surge(24, 40, 26);
      }
    }
    this._updateDust(dt);
    this._updateChunks(dt);
    return out;
  }

  _chunk(fallSpeed) {
    const k = this.random;
    const b = this.bits[this._nextBit];
    this._nextBit = (this._nextBit + 1) % CHUNKS;
    const side = k() < 0.5 ? 1 : -1;
    const along = (k() - 0.5) * this.tower.w;
    const c = Math.cos(this.tower.yaw);
    const s = Math.sin(this.tower.yaw);
    const ox = k() < 0.5 ? along : side * this.tower.w * 0.5;
    const oz = k() < 0.5 ? side * this.tower.d * 0.5 : (k() - 0.5) * this.tower.d;
    const y = this.height * 0.1 + 6 + k() * 30;
    b.p.set(c * ox + s * oz, y, -s * ox + c * oz);
    b.v.set(b.p.x * 0.25 + (k() - 0.5) * 4, -fallSpeed * 0.6, b.p.z * 0.25 + (k() - 0.5) * 4);
    b.w.set((k() - 0.5) * 6, (k() - 0.5) * 6, (k() - 0.5) * 6);
    b.size = 0.8 + k() * 2.2;
    b.alive = true;
  }

  _updateChunks(dt) {
    const { _m: m, _q: q, _s: s } = this;
    for (let i = 0; i < CHUNKS; i += 1) {
      const b = this.bits[i];
      if (b.alive) {
        b.v.y -= G * dt;
        b.p.addScaledVector(b.v, dt);
        b.spin.set(b.spin.x + b.w.x * dt, b.spin.y + b.w.y * dt, b.spin.z + b.w.z * dt);
        if (b.p.y < 0) b.alive = false;
      }
      q.setFromEuler(b.spin);
      m.compose(b.p, q, s.setScalar(b.alive ? b.size : 0));
      this.chunks.setMatrixAt(i, m);
    }
    this.chunks.instanceMatrix.needsUpdate = true;
  }

  _updateDust(dt) {
    for (let i = 0; i < DUST; i += 1) {
      const d = this.puffs[i];
      let alpha = 0;
      let size = 0;
      if (d.life > 0 && d.age < d.life) {
        d.age += dt;
        // Rolling out and slowing; warm, so it climbs; growing as it thins.
        d.v.x *= Math.exp(-dt * 0.35);
        d.v.z *= Math.exp(-dt * 0.35);
        d.v.y = d.v.y * Math.exp(-dt * 0.12) + dt * 0.5;
        d.p.addScaledVector(d.v, dt);
        if (d.p.y < 2) d.p.y = 2;
        const k = d.age / d.life;
        size = d.size * (0.6 + k * 2.0);
        alpha = Math.min(1, d.age * 2.5) * (1 - k * k) * 0.8;
      }
      this.centres[i * 3] = d.p.x;
      this.centres[i * 3 + 1] = d.p.y;
      this.centres[i * 3 + 2] = d.p.z;
      this.looks[i * 3] = size;
      this.looks[i * 3 + 1] = alpha;
      this.looks[i * 3 + 2] = d.seed;
    }
    this.centreAttr.needsUpdate = true;
    this.lookAttr.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}

function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,230,180,0.8)");
  grad.addColorStop(1, "rgba(255,160,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
