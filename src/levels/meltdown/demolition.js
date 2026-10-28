/**
 * A generic tower of the city brought down, the way it happens in the
 * movies - and in real demolitions. Except these are the Labs' annexes,
 * where the experiments were done, and the Labs are destroying the evidence:
 * hazard bands round their crowns, ASCENSION on the side, red beacons - and
 * when they go, they go like a war.
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
 * The war in it (war.js's Fireballs): every charge a fireball, rooms blown
 * out of the facade in a ripple, a green secondary blast from whatever they
 * kept inside ("chem"); with `topple`, the tower goes over sideways as it
 * crushes, like a felled tree. What's left: a jagged ruin - floor slabs
 * sticking out of the heap, hanging off their rebar - burning, with columns
 * of smoke off it for the rest of the fight, and things in it still going
 * off now and then.
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
import { Fireballs } from "./war.js";

const SPEED_OF_SOUND = 343;
const G = 9.8;
const CHARGES = 10;
const CHARGE_GAP = 0.12;
const DROP_AT = 1.4;
const DUST = 420;
const CHUNKS = 48;
/** When the green secondary goes up (s after the first charge). */
const CHEM_AT = 0.95;
const BLOWOUTS = 16;
/** How fast a toppling tower goes over (rad/s^2). */
const TOPPLE = 0.07;

export class Demolition {
  /**
   * @param {object} o
   * @param {import("./city.js").CityAtNight} o.city
   * @param {object} o.tower   one of city.demolitions
   * @param {number} [o.seed]
   * @param {number} [o.topple]  radians it goes over as it falls (0: straight down); the sign picks the side, as seen from the roof
   */
  constructor({ city, tower, seed = 1, topple = 0 }) {
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
    // Toppling: sideways to the roof's view (and a little away), about the
    // foot of that wall (city.js turns the tower the same way).
    this.maxLean = Math.abs(topple);
    this.heading = Math.atan2(tower.z, tower.x) + Math.sign(topple || 1) * 1.25;
    this.lean = 0;

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

    this.fire = new Fireballs(170, seed);
    this.owned.push(this.fire);
    this.root.add(this.fire.mesh);
    this._buildCrown(own);
    this._buildRuin(own);
    // The rooms blown out of the facade: a ripple up the building, before the drop.
    this.blowouts = Array.from({ length: BLOWOUTS }, (_, i) => {
      const face = this._face(Math.floor(this.random() * 4));
      const along = (this.random() - 0.5) * 0.8;
      const y = this.height * (0.12 + 0.8 * (i / BLOWOUTS) * (0.7 + this.random() * 0.3));
      return { at: 0.1 + (i / BLOWOUTS) * 1.15 + this.random() * 0.1, p: face.centre.clone().addScaledVector(face.tangent, along * face.width).setY(y), n: face.normal, done: false };
    });

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
      { at: CHEM_AT + delay, kind: "chem", strength: 0.8 },
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
            this.fire.blast(p.x, p.y, p.z, { size: 11, count: 3, speed: 9, life: 1.2, up: 2 });
          }
        }
      }
      // Rooms blown out, fire jetting from the windows.
      for (const b of this.blowouts) {
        if (b.done || t < b.at) continue;
        b.done = true;
        this.fire.burst(b.p.x, b.p.y, b.p.z, { size: 8, life: 1.1, vx: b.n.x * 26, vy: 2, vz: b.n.z * 26, lift: 3 });
        this.fire.burst(b.p.x, b.p.y, b.p.z, { size: 13, life: 1.7, vx: b.n.x * 12, vy: 3, vz: b.n.z * 12, lift: 4 });
        this._puff(b.p.x + b.n.x * 4, b.p.y, b.p.z + b.n.z * 4, b.n.x * 6, 1, b.n.z * 6, 14, 10);
      }
      // The secondary: something green and much bigger, out of its heart.
      if (!this._chem && t >= CHEM_AT) {
        this._chem = true;
        const f = this._face(this._front);
        const y = this.height * 0.45;
        // (Out in front of the facade: inside, the walls would cut it off.)
        const out = f.centre.clone().addScaledVector(f.normal, 9);
        this.fire.blast(out.x, y, out.z, { size: 46, count: 9, speed: 20, life: 3, hue: 1, up: 6 });
        this.fire.blast(out.x + f.normal.x * 6, y - 8, out.z + f.normal.z * 6, { size: 30, count: 5, speed: 30, life: 2.2, hue: 0.6, up: 3 });
        for (let i = 0; i < 12; i += 1) this._puff(f.centre.x + f.normal.x * 6, y + (this.random() - 0.5) * 20, f.centre.z + f.normal.z * 6, f.normal.x * 14 + (this.random() - 0.5) * 8, 2, f.normal.z * 14 + (this.random() - 0.5) * 8, 26, 16);
      }
      this.dustUniforms.uFlash.value = Math.max(flashing, Math.min(1, this.fire.heat * 0.7));
      // The drop: straight down at g, into a heap a tenth of its height.
      const ft = Math.max(0, t - DROP_AT);
      const before = this.drop;
      this.drop = Math.min(this.height * 0.9, 0.5 * G * ft * ft);
      const speed = (this.drop - before) / Math.max(dt, 1e-4);
      // The lights: a stutter as the power goes, then out.
      const dark = t < DROP_AT - 0.2 ? 0 : t < DROP_AT + 0.8 ? (Math.sin(t * 47) > 0.2 ? 0.85 : 0.2) : 1;
      // Over it goes (if it's one that topples), faster and faster till it's down.
      if (this.maxLean > 0) this.lean = Math.min(this.maxLean, 0.5 * TOPPLE * ft * ft * (1 + this.progress));
      this.city.setFall(this.tower, this.drop, dark, this.lean, this.heading);
      this._updateCrown(time, t);
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
          const p = this._leaned(_at.set((this.random() - 0.5) * this.tower.w * 1.3, y, (this.random() - 0.5) * this.tower.d * 1.3));
          this._puff(p.x, p.y, p.z, (this.random() - 0.5) * 4, 4 + this.random() * 5, (this.random() - 0.5) * 4, 40, 22);
        }
        // Fire at the crush, where the floors are going into each other.
        this._crush = (this._crush ?? 0) + dt * 9;
        while (this._crush >= 1) {
          this._crush -= 1;
          const f = this._face(Math.floor(this.random() * 4));
          const y = Math.max(this.height * 0.1, this.height - this.drop) - this.random() * 10;
          const p = f.centre.clone().addScaledVector(f.tangent, (this.random() - 0.5) * f.width).setY(y);
          this._leaned(p);
          this.fire.burst(p.x, p.y, p.z, { size: 14, life: 1.5, vx: f.normal.x * 10, vy: 4, vz: f.normal.z * 10 });
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
        this.fire.blast(0, 6, 0, { size: 36, count: 12, speed: 26, life: 2.6, up: 3 });
        this.ruin.visible = true;
      }
      if (this._landed) this._burn(dt, t);
    } else this._updateCrown(time, 0);
    this.fire.update(dt, time);
    this._updateDust(dt);
    this._updateChunks(dt);
    return out;
  }

  /**
   * One of the box's faces, in the root's frame: 0..3 = +x, -x, +z, -z of the
   * tower before its yaw. { centre (at the street), normal, tangent, width }.
   */
  _face(i) {
    const c = Math.cos(this.tower.yaw);
    const s = Math.sin(this.tower.yaw);
    const nx = [1, -1, 0, 0][i];
    const nz = [0, 0, 1, -1][i];
    const half = nx ? this.tower.w / 2 : this.tower.d / 2;
    // three.js's yaw: x' = x cos + z sin, z' = -x sin + z cos.
    const normal = new THREE.Vector3(c * nx + s * nz, 0, -s * nx + c * nz);
    const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
    return { centre: normal.clone().multiplyScalar(half), normal, tangent, width: nx ? this.tower.d : this.tower.w };
  }

  /** The face toward the roof (the origin of the world). */
  get _front() {
    if (this.__front !== undefined) return this.__front;
    const to = new THREE.Vector3(-this.tower.x, 0, -this.tower.z).normalize();
    let best = 0;
    for (let i = 1; i < 4; i += 1) if (this._face(i).normal.dot(to) > this._face(best).normal.dot(to)) best = i;
    return (this.__front = best);
  }

  /** A point on the standing tower, carried over with it as it topples (in place). */
  _leaned(p) {
    if (!this.lean) return p;
    const dir = _dir.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    const pivot = _pivot.copy(dir).multiplyScalar(this.tower.w * 0.5);
    const axis = _axis.set(dir.z, 0, -dir.x);
    return p.sub(pivot).applyAxisAngle(axis, this.lean).add(pivot);
  }

  /**
   * The Labs' marks on the crown (they fall, and go over, with it): ASCENSION
   * on the side toward the roof, hazard bands round the top floors, red
   * beacons on the corners.
   */
  _buildCrown(own) {
    const t = this.tower;
    // Turned with the tower when it topples: about the foot of that wall.
    this.pivot = new THREE.Group();
    this.crown = new THREE.Group();
    this.pivot.add(this.crown);
    this.root.add(this.pivot);
    const signTex = own(labSign(String.fromCharCode(65 + Math.floor(this.random() * 6))));
    const sign = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), own(new THREE.MeshBasicMaterial({ map: signTex, transparent: true, fog: true, color: 0xd8d8d8 })));
    const f = this._face(this._front);
    const width = Math.min(f.width * 0.82, 26);
    sign.scale.set(width, width * 0.3, 1);
    sign.position.copy(f.centre).addScaledVector(f.normal, 0.35).setY(this.height - 4 - width * 0.15);
    sign.rotation.y = Math.atan2(f.normal.x, f.normal.z);
    this.crown.add(sign);
    const stripes = own(hazardStripes());
    stripes.wrapS = THREE.RepeatWrapping;
    for (const y of [this.height - 1.4, this.height - 9 - width * 0.3]) {
      for (let i = 0; i < 4; i += 1) {
        const g = this._face(i);
        const tex = stripes.clone();
        tex.repeat.set(g.width / 3, 1);
        tex.needsUpdate = true;
        own(tex);
        const band = new THREE.Mesh(own(new THREE.PlaneGeometry(g.width + 0.6, 1.6)), own(new THREE.MeshBasicMaterial({ map: tex, fog: true, color: 0x9a9a9a })));
        band.position.copy(g.centre).addScaledVector(g.normal, 0.3).setY(y);
        band.rotation.y = Math.atan2(g.normal.x, g.normal.z);
        this.crown.add(band);
      }
    }
    this.beaconMaterial = own(new THREE.SpriteMaterial({ map: own(softDot()), color: 0xff2614, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    const c = Math.cos(t.yaw);
    const s = Math.sin(t.yaw);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const beacon = new THREE.Sprite(this.beaconMaterial);
      const x = sx * t.w * 0.5;
      const z = sz * t.d * 0.5;
      beacon.position.set(c * x + s * z, this.height + 1.2, -s * x + c * z);
      beacon.scale.setScalar(5);
      this.crown.add(beacon);
    }
  }

  _updateCrown(time, t) {
    // The beacons: a slow warning blink - and, once it's started, frantic.
    const rate = this.started ? 6 : 0.8;
    this.beaconMaterial.opacity = Math.sin(time * rate * Math.PI * 2) > 0 ? 1 : 0.08;
    const top = this.height - this.drop;
    this.crown.visible = top > this.height * 0.1 + 6;
    this.crown.position.y = -this.drop;
    const dir = _dir.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    this.pivot.position.copy(dir).multiplyScalar(this.tower.w * 0.5);
    this.crown.position.x = -this.pivot.position.x;
    this.crown.position.z = -this.pivot.position.z;
    this.pivot.quaternion.setFromAxisAngle(_axis.set(dir.z, 0, -dir.x), this.lean);
    if (t > 0) this.beaconMaterial.color.setHex(Math.sin(time * 40) > 0 ? 0xff2614 : 0xffb020);
  }

  /**
   * What's left standing (shown when the heap lands): a corner of the frame
   * sticking up out of the rubble - floor slabs, shorter and shorter, broken
   * off, some hanging by their rebar, the columns between them - like a
   * bombed-out block.
   */
  _buildRuin(own) {
    const t = this.tower;
    const k = this.random;
    this.ruin = new THREE.Group();
    this.ruin.visible = false;
    this.ruin.rotation.y = t.yaw;
    this.root.add(this.ruin);
    this.ruinMaterial = own(new THREE.MeshLambertMaterial({ color: 0x6a645d, emissive: 0x000000 }));
    const rebar = own(new THREE.MeshLambertMaterial({ color: 0x2a2420 }));
    const box = own(new THREE.BoxGeometry(1, 1, 1));
    const piece = (w, h, d, x, y, z, m = this.ruinMaterial) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      this.ruin.add(mesh);
      return mesh;
    };
    const heap = this.height * 0.1;
    const floors = 4 + Math.floor(k() * 3);
    const storey = 3.6;
    // The corner it stands on: away from the roof's side, so you see into it.
    const fx = -Math.sign(Math.cos(this.heading - t.yaw) || 1);
    const x0 = fx * t.w * 0.5;
    const z0 = -t.d * 0.5;
    this.flames = [];
    for (let i = 0; i < floors; i += 1) {
      const y = heap * 0.55 + i * storey;
      const lx = t.w * (0.9 - i * 0.13) * (0.75 + k() * 0.35);
      const lz = t.d * (0.85 - i * 0.12) * (0.7 + k() * 0.4);
      // The slab, from the corner in.
      piece(lx, 0.45, lz, x0 - fx * lx / 2, y, z0 + lz / 2);
      // Columns under it (some gone).
      for (const [cx, cz] of [[0.1, 0.1], [0.5, 0.1], [0.1, 0.55], [0.9, 0.15], [0.45, 0.8]]) {
        if (k() < 0.3 || i === 0) continue;
        piece(0.7, storey - 0.45, 0.7, x0 - fx * lx * cx, y - storey / 2, z0 + lz * cz);
      }
      // The broken edge: a piece of the next bay hanging off it.
      if (k() < 0.75) {
        const hang = new THREE.Group();
        const len = 2 + k() * 4;
        hang.position.set(x0 - fx * lx, y, z0 + lz * (0.2 + k() * 0.6));
        hang.rotation.z = fx * (0.5 + k() * 0.6);
        this.ruin.add(hang);
        const slab = new THREE.Mesh(box, this.ruinMaterial);
        slab.scale.set(len, 0.4, 2 + k() * 3);
        slab.position.x = -fx * len / 2;
        hang.add(slab);
      }
      // Rebar out of the broken edges.
      for (let j = 0; j < 6; j += 1) {
        const bar = piece(0.07, 0.07, 1 + k() * 1.6, x0 - fx * lx * k(), y + 0.1, z0 + lz, rebar);
        bar.rotation.set((k() - 0.5) * 0.8, (k() - 0.5) * 0.8, 0);
        bar.position.z += bar.scale.z * 0.4;
      }
      this.flames.push(new THREE.Vector3(x0 - fx * lx * (0.2 + k() * 0.6), y + 1.2, z0 + lz * (0.2 + k() * 0.6)).applyAxisAngle(THREE.Object3D.DEFAULT_UP, t.yaw));
    }
    // The two outer walls of the corner: stepped down from the top, jagged.
    const top = heap * 0.55 + floors * storey;
    for (let a = 0; a < 2; a += 1) {
      const span = a ? t.d : t.w;
      const bays = Math.floor(span / 2.25);
      for (let b = 0; b < bays * 0.7; b += 1) {
        const h = Math.max(2, top * (1 - b / (bays * 0.8)) * (0.75 + k() * 0.3) - heap * 0.3);
        if (a) piece(0.5, h, 2.1, x0, heap * 0.3 + h / 2, z0 + 1.1 + b * 2.25);
        else piece(2.1, h, 0.5, x0 - fx * (1.1 + b * 2.25), heap * 0.3 + h / 2, z0);
      }
    }
    // Smoke off it: three columns.
    this.smokes = this.flames.filter((_, i) => i % 2 === 0).slice(0, 3);
    this._cook = 3;
  }

  /** The ruin burning: flames in it, smoke climbing off it, things going off. */
  _burn(dt, t) {
    const k = this.random;
    this._flame = (this._flame ?? 0) + dt * 10;
    while (this._flame >= 1) {
      this._flame -= 1;
      const p = this.flames[Math.floor(k() * this.flames.length)];
      this.fire.burst(p.x + (k() - 0.5) * 4, p.y, p.z + (k() - 0.5) * 4, { size: 4 + k() * 5, life: 1.1, vy: 2.5, lift: 5 });
    }
    this._smoke = (this._smoke ?? 0) + dt * 2.2;
    while (this._smoke >= 1) {
      this._smoke -= 1;
      const p = this.smokes[Math.floor(k() * this.smokes.length)];
      this._puff(p.x, p.y + 4, p.z, (k() - 0.5) * 2 + 1.5, 7 + k() * 4, (k() - 0.5) * 2, 18, 26);
    }
    this._cook -= dt;
    if (this._cook <= 0) {
      // Something in there going off: a pop, now and then a green one.
      this._cook = 2.5 + k() * 4;
      const p = this.flames[Math.floor(k() * this.flames.length)];
      this.fire.blast(p.x, p.y, p.z, { size: 12 + k() * 10, count: 4, speed: 12, life: 1.6, hue: k() < 0.2 ? 1 : 0 });
      this.pending = this.pending.filter((e) => !e.done);
      this.pending.push({ at: t + 0.4, kind: "pop", strength: 0.3 });
    }
    // The ruin lit from inside by its own fires.
    const glow = Math.min(1, this.fire.heat) * (0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.1));
    this.ruinMaterial.emissive.setRGB(0.55 * glow, 0.2 * glow, 0.05 * glow);
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

const _dir = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _at = new THREE.Vector3();

/** The Labs' name on an annex: ASCENSION, and which one. */
function labSign(letter) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 154;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(12,14,16,0.92)";
  g.fillRect(0, 0, 512, 154);
  g.fillStyle = "#e8e4da";
  g.font = "bold 70px Arial, Helvetica, sans-serif";
  g.textAlign = "center";
  g.fillText("ASCENSION", 256, 78);
  g.fillStyle = "#d6a520";
  g.fillRect(24, 96, 464, 4);
  g.font = "bold 30px Arial, Helvetica, sans-serif";
  g.fillText(`THE LABS  \u00b7  ANNEX ${letter}`, 256, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Yellow and black, diagonally. */
function hazardStripes() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "#111";
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = "#e0a81c";
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
