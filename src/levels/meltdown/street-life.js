/**
 * Life on Johannesburg's streets, 160 m below the roof.
 *
 *   Minibus taxis   white Quantum-style minibuses on the street grid the
 *                   city's street shader draws - on the left, as in South
 *                   Africa - stopping wherever a passenger waves, hazards
 *                   blinking; a lit taxi rank by the bridge, and a few
 *                   crossing the Mandela Bridge itself.
 *   Jacarandas      purple canopies along some of the streets (they flower
 *                   in October), lit by the streetlamps, blossom on the
 *                   pavement under them.
 *
 * Everything is instanced: a handful of draw calls. Taxis are hidden where
 * a building stands on the street (the generic towers were placed with no
 * regard for it) and trees aren't planted there.
 *
 *   const life = new StreetLife({ streetY: -160, blocked: [...footprints] });
 *   scene.add(life.root);
 *   life.update(dt, time);
 *   life.dispose();
 */

import * as THREE from "../../three.js";
import { LANDMARKS } from "./landmarks.js";

/** The street grid of city.js's street shader: a street every 70 m, an avenue every third. */
const BLOCK = 70;
const streetAt = (n) => BLOCK * (n + 0.5);
const isAvenue = (n) => ((n % 3) + 3) % 3 === 0;
const widthOf = (n) => (isAvenue(n) ? 18 : 10);

const TAXIS = 46;
const REACH = 250;          // how far out along each street they drive
const PARKED = 18;
const BRIDGE_TAXIS = 4;

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export class StreetLife {
  /**
   * @param {object} [o]
   * @param {number} [o.streetY]
   * @param {{x:number, z:number, r:number}[]} [o.blocked]  where buildings stand (from the centre)
   * @param {number} [o.seed]
   */
  constructor({ streetY = -160, blocked = [], seed = 23 } = {}) {
    this.root = new THREE.Group();
    this.root.name = "StreetLife";
    this.root.position.y = streetY;
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const r = rng(seed);
    this.blocked = blocked;
    this.random = r;

    // ---- Minibus taxis: body, windows, lights, the pool of light ahead ----
    const body = own(new THREE.BoxGeometry(5.2, 1.9, 2.0));
    body.translate(0, 1.25, 0);
    const glass = own(new THREE.BoxGeometry(4.2, 0.6, 2.04));
    glass.translate(-0.25, 1.75, 0);
    const lamp = own(new THREE.BoxGeometry(0.12, 0.25, 1.7));
    const pool = own(new THREE.PlaneGeometry(9, 3.2));
    pool.rotateX(-Math.PI / 2);
    pool.translate(7.4, 0.12, 0);
    const count = TAXIS + PARKED + BRIDGE_TAXIS;
    const mk = (geometry, material) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    this.bodies = mk(body, own(new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a3a3a })));
    this.windows = mk(glass, own(new THREE.MeshLambertMaterial({ color: 0x15181c })));
    this.heads = mk(lamp, own(new THREE.MeshBasicMaterial({ color: 0xfff4dc, fog: true })));
    this.tails = mk(lamp, own(new THREE.MeshBasicMaterial({ color: 0xff2a14, fog: true })));
    this.pools = mk(pool, own(new THREE.MeshBasicMaterial({ color: 0xffe9c2, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: true })));
    const colour = new THREE.Color();
    for (let i = 0; i < count; i += 1) this.bodies.setColorAt(i, colour.set(r() < 0.8 ? 0xf2f2ee : 0xe8dcc0));

    // Moving taxis: a street each, a lane, a speed; now and then a stop.
    this.taxis = [];
    const streets = [];
    for (let n = -3; n <= 2; n += 1) {
      streets.push({ axis: "x", at: streetAt(n), w: widthOf(n) });
      streets.push({ axis: "z", at: streetAt(n), w: widthOf(n) });
    }
    for (let i = 0; i < TAXIS; i += 1) {
      const street = streets[i % streets.length];
      const dir = r() < 0.5 ? 1 : -1;
      this.taxis.push({
        street,
        dir,
        along: (r() - 0.5) * 2 * REACH,
        speed: 9 + r() * 6,
        v: 0,
        stopIn: 4 + r() * 14,
        stopped: 0,
      });
    }

    // The rank: a pad, a long canopy on posts, lit underneath, taxis in rows.
    const rank = { x: -66, z: -2 };   // by the bridge, as the real ranks are by Park Station
    this.rank = rank;
    const concrete = own(new THREE.MeshLambertMaterial({ color: 0x5c5a56 }));
    const roof = own(new THREE.MeshLambertMaterial({ color: 0x8a8e92, emissive: 0x2a2620 }));
    const pad = new THREE.Mesh(own(new THREE.BoxGeometry(40, 0.3, 20)), concrete);
    pad.position.set(rank.x, 0.15, rank.z);
    const canopy = new THREE.Mesh(own(new THREE.BoxGeometry(38, 0.3, 7)), roof);
    canopy.position.set(rank.x, 4.6, rank.z);
    this.root.add(pad, canopy);
    const glowStrip = new THREE.Mesh(own(new THREE.PlaneGeometry(36, 5.4)), own(new THREE.MeshBasicMaterial({ color: 0xffe2ad, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: true })));
    glowStrip.rotation.x = -Math.PI / 2;
    glowStrip.position.set(rank.x, 0.35, rank.z);
    this.root.add(glowStrip);
    const posts = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.3, 4.6, 0.3)), concrete, 10);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 10; i += 1) posts.setMatrixAt(i, m.makeTranslation(rank.x - 17 + (i % 5) * 8.5, 2.3, rank.z + (i < 5 ? -3.2 : 3.2)));
    this.root.add(posts);
    this.parked = [];
    for (let i = 0; i < PARKED; i += 1) {
      const row = Math.floor(i / 6);
      this.parked.push({ x: rank.x - 15 + (i % 6) * 6, z: rank.z - 6 + row * 6, yaw: Math.PI / 2 + (r() - 0.5) * 0.08 });
    }

    // On the Mandela Bridge's deck (landmarks.js: 150 m long, 14 m up).
    const b = LANDMARKS.bridge;
    const view = new THREE.Vector2(b.x, b.z).normalize();
    this.bridge = { x: b.x, z: b.z, ax: view.y, az: -view.x, deck: 14.4 };   // along the deck; its top
    this.bridgeTaxis = Array.from({ length: BRIDGE_TAXIS }, (_, i) => ({ along: -60 + i * 33, dir: i % 2 ? 1 : -1, speed: 8 + r() * 4 }));

    // ---- Jacarandas ----
    const trees = [];
    const near = (x, z, pad) => blocked.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad) || (Math.abs(x) < 24 && Math.abs(z) < 24);
    for (let n = -3; n <= 2; n += 1) {
      for (const axis of ["x", "z"]) {
        if (r() > 0.55) continue;             // not every street
        const at = streetAt(n);
        const w = widthOf(n);
        for (const side of [-1, 1]) {
          for (let s = -REACH; s <= REACH; s += 10 + r() * 4) {
            const off = side * (w / 2 + 2.6);
            const x = axis === "x" ? s : at + off;
            const z = axis === "x" ? at + off : s;
            if (near(x, z, 4) || r() < 0.12) continue;
            trees.push([x, z, 0.8 + r() * 0.5, r()]);
          }
        }
      }
    }
    const trunk = own(new THREE.CylinderGeometry(0.18, 0.32, 1, 6));
    trunk.translate(0, 0.5, 0);
    const crown = own(new THREE.IcosahedronGeometry(1, 1));
    const disc = own(new THREE.CircleGeometry(1, 12));
    disc.rotateX(-Math.PI / 2);
    const trunks = new THREE.InstancedMesh(trunk, own(new THREE.MeshLambertMaterial({ color: 0x3b2c22 })), trees.length);
    // Lit purple by the streetlamps, not lost in the dark.
    const crowns = new THREE.InstancedMesh(crown, own(new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2b1a4d })), trees.length * 2);
    const blossom = new THREE.InstancedMesh(disc, own(new THREE.MeshLambertMaterial({ color: 0x9a7ce0, emissive: 0x241540 })), trees.length);
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    trees.forEach(([x, z, k, h], i) => {
      const height = 6 + k * 5;
      trunks.setMatrixAt(i, m.compose(p.set(x, 0, z), q.identity(), sc.set(1, height * 0.75, 1)));
      // Two lobes per canopy, wide and flat as jacarandas grow.
      for (let j = 0; j < 2; j += 1) {
        const rad = (3.2 + k * 2.4) * (j ? 0.75 : 1);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h * 6.28 + j);
        crowns.setMatrixAt(i * 2 + j, m.compose(p.set(x + (j ? rad * 0.5 : 0), height * 0.75 + rad * 0.35 + j * 0.8, z + (j ? -rad * 0.3 : 0)), q, sc.set(rad, rad * 0.55, rad)));
        crowns.setColorAt(i * 2 + j, colour.set(0x7d5fc4).lerp(new THREE.Color(0xb293ee), (h + j * 0.3) % 1));
      }
      blossom.setMatrixAt(i, m.compose(p.set(x, 0.14, z), q.identity(), sc.set(3.5 + k * 2, 1, 3.5 + k * 2)));
    });
    for (const mesh of [trunks, crowns, blossom]) {
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    this.treeCount = trees.length;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._ahead = new THREE.Vector3();
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.update(0, 0);
  }

  /** 1 in the open, falling to 0 where a building stands on the street. */
  _open(x, z) {
    let open = 1;
    for (const c of this.blocked) open = Math.min(open, THREE.MathUtils.smoothstep(Math.hypot(x - c.x, z - c.z), c.r, c.r + 6));
    return open;
  }

  _place(i, x, y, z, yaw, scale, braking, hazard) {
    const { _m: m, _q: q, _p: p, _s: s } = this;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    s.setScalar(scale);
    m.compose(p.set(x, y, z), q, s);
    this.bodies.setMatrixAt(i, m);
    this.windows.setMatrixAt(i, m);
    this.pools.setMatrixAt(i, hazard ? this._hidden : m);
    // Lamps: at the nose and the tail (local +x is forward).
    const ahead = this._ahead.set(2.62, 0.9, 0).applyQuaternion(q).multiplyScalar(scale);
    m.compose(p.set(x + ahead.x, y + ahead.y, z + ahead.z), q, s.setScalar(scale * (hazard ? 0.6 : 1)));
    this.heads.setMatrixAt(i, m);
    m.compose(p.set(x - ahead.x, y + ahead.y, z - ahead.z), q, s.setScalar(scale * (braking || hazard ? 1.6 : 1)));
    this.tails.setMatrixAt(i, m);
  }

  update(dt, time) {
    let i = 0;
    const blink = Math.sin(time * 9) > 0;
    for (const t of this.taxis) {
      // Drive; stop now and then for a passenger, hazards on.
      if (t.stopped > 0) {
        t.stopped -= dt;
        t.v = Math.max(0, t.v - dt * 12);
      } else {
        t.stopIn -= dt;
        if (t.stopIn <= 0) {
          t.stopped = 1.5 + this.random() * 2.5;
          t.stopIn = 8 + this.random() * 14;
        }
        t.v = Math.min(t.speed, t.v + dt * 4);
      }
      t.along += t.v * t.dir * dt;
      if (t.along > REACH) t.along -= 2 * REACH;
      if (t.along < -REACH) t.along += 2 * REACH;
      // On the left: heading +x the left is -z; heading +z it's +x.
      const lane = t.street.w * 0.22;
      const x = t.street.axis === "x" ? t.along : t.street.at + lane * t.dir;
      const z = t.street.axis === "x" ? t.street.at - lane * t.dir : t.along;
      const yaw = t.street.axis === "x" ? (t.dir > 0 ? 0 : Math.PI) : (t.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      const ends = 1 - THREE.MathUtils.smoothstep(Math.abs(t.along), REACH - 20, REACH);
      this._place(i++, x, 0, z, yaw, this._open(x, z) * ends, t.v < t.speed * 0.5, t.stopped > 0 && blink);
    }
    for (const p of this.parked) this._place(i++, p.x, 0.3, p.z, p.yaw, 1, false, false);
    const b = this.bridge;
    for (const t of this.bridgeTaxis) {
      t.along += t.speed * t.dir * dt;
      if (t.along > 70) t.along -= 140;
      if (t.along < -70) t.along += 140;
      const lane = 2.6 * t.dir;
      const x = b.x + b.ax * t.along - b.az * lane;
      const z = b.z + b.az * t.along + b.ax * lane;
      const yaw = Math.atan2(-b.az * t.dir, b.ax * t.dir);
      const ends = 1 - THREE.MathUtils.smoothstep(Math.abs(t.along), 60, 70);
      this._place(i++, x, b.deck, z, yaw, ends, false, false);
    }
    for (const mesh of [this.bodies, this.windows, this.heads, this.tails, this.pools]) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
