/**
 * The Skyline's security drones - the shock sphere's reason to be there.
 *
 * HALCYON sends them down the causeway after Subject 07: one flies in ahead,
 * keeps pace a few metres up, and sweeps a red scan along the floor after
 * you. It locks on (the beam holds still and brightens), then fires a bolt
 * down that line - change lane and it misses; stay and it hits. It keeps at
 * it until it is brought down or its time runs out. Glass, cryo and gravity
 * glance off its armour: only a shock sphere's EMP fries it (a direct hit,
 * or the burst of one next to it) - purple arcs crawl all over it, it goes
 * haywire, darting and spinning, then blows apart.
 *
 *   const drones = new SecurityDrones(level, { mode, hard });
 *   drones.update(dt, time, distance, playerLocal, playing);
 *   drones.targets()                  // their hurtboxes, for the aim
 *   drones.hit(mesh, { sphere })      // a sphere on one: down, or armoured
 *   drones.emp(point, radius)         // a shock burst near them
 *
 * Coordinates are the level root's (local z = -distance). Events go out
 * through `level.events`: "drone-in", "drone-lock", "drone-fire",
 * "drone-hit" {damage}, "drone-miss", "drone-down" (shocked),
 * "drone-blast" (it blows up).
 */

import * as THREE from "../../three.js";

export const DRONE = {
  /** Where it holds: metres ahead of you, metres up. */
  ahead: 10, height: 3.0,
  /** Where the scan meets the floor: metres in front of you (under you, it fills the view). */
  scanAhead: 4.5,
  /** Seconds sweeping before it locks; then held locked before it fires (Hard: quicker). */
  scan: [1.7, 1.15], lock: [0.6, 0.45],
  /** The bolt: speed (m/s), damage, and how near your middle counts (m). */
  bolt: 30, damage: 12, reach: 1.05,
  /** Seconds after a shot before it sweeps again; seconds it stays before it leaves. */
  rest: 0.9, life: 13,
  /** Points for bringing one down. */
  points: 450,
  /** Seconds it fries, haywire, before it blows. */
  zap: 1.25,
};

/** The story's: [distance, how many]. Endless: one now and then, two later on. */
const STORY = [[60, 1], [548, 1], [672, 2]];
const ENDLESS = { first: 170, gap: [230, 330], pairsFrom: 900 };

/** The arcs a frying drone crawls with: how many, and the steps in each. */
const ARCS = 7;
const ARC_STEPS = 5;
const ARC_POINTS = ARCS * ARC_STEPS * 2;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class SecurityDrones {
  constructor(level, { mode = "story", hard = false } = {}) {
    this.level = level;
    this.mode = mode;
    this.hard = hard;
    this.root = new THREE.Group();
    this.root.name = "SecurityDrones";
    level.root.add(this.root);
    this.list = [];
    this.bolts = [];
    this.schedule = mode === "endless" ? [] : STORY.map(([d, n]) => ({ d, n }));
    this.nextEndless = ENDLESS.first;
    this.downed = 0;
    this._materials();
  }

  _materials() {
    const m = (o) => { (this.owned ??= []).push(o); return o; };
    this.mat = {
      // (Light enough to read against the corridor's dark ceiling.)
      hull: m(new THREE.MeshStandardMaterial({ color: 0x8c949e, metalness: 0.55, roughness: 0.35, emissive: 0x1a1d22 })),
      trim: m(new THREE.MeshStandardMaterial({ color: 0x40464e, metalness: 0.8, roughness: 0.3 })),
      eye: m(new THREE.MeshBasicMaterial({ color: 0xff3a30 })),
      glow: m(new THREE.MeshBasicMaterial({ color: 0xff2a20 })),
      lamp: m(new THREE.MeshBasicMaterial({ color: 0xf4f8ff })),
      rotor: m(new THREE.MeshBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })),
      beam: m(new THREE.MeshBasicMaterial({ color: 0xff2a20, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })),
      spot: m(new THREE.MeshBasicMaterial({ color: 0xff3a30, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })),
      bolt: m(new THREE.MeshBasicMaterial({ color: 0xff5a40 })),
      arc: m(new THREE.LineBasicMaterial({ color: 0xe2a6ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })),
      hurt: m(new THREE.MeshBasicMaterial({ visible: false })),
    };
    this.geo = {
      body: m(new THREE.SphereGeometry(0.42, 14, 10)),
      band: m(new THREE.TorusGeometry(0.44, 0.06, 6, 20)),
      arm: m(new THREE.BoxGeometry(1.5, 0.06, 0.12)),
      rotor: m(new THREE.CircleGeometry(0.34, 18)),
      eye: m(new THREE.SphereGeometry(0.15, 10, 8)),
      lamp: m(new THREE.SphereGeometry(0.06, 6, 4)),
      beam: m(new THREE.ConeGeometry(0.55, 1, 16, 1, true)),
      spot: m(new THREE.RingGeometry(0.25, 0.55, 24)),
      bolt: m(new THREE.CapsuleGeometry(0.07, 0.55, 3, 6)),
      hurt: m(new THREE.BoxGeometry(1.7, 0.9, 1.3)),
    };
  }

  _build() {
    const { mat, geo } = this;
    const root = new THREE.Group();
    root.name = "SecurityDrone";
    const body = new THREE.Mesh(geo.body, mat.hull);
    body.scale.set(1, 0.62, 1.15);
    root.add(body);
    // A glowing red band round its middle: HALCYON's colour, seen from far off.
    const band = new THREE.Mesh(geo.band, mat.glow);
    band.rotation.x = Math.PI / 2;
    root.add(band);
    const rotors = [];
    for (const turn of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(geo.arm, mat.trim);
      arm.rotation.y = turn;
      arm.position.y = 0.12;
      root.add(arm);
      for (const end of [-0.72, 0.72]) {
        const rotor = new THREE.Mesh(geo.rotor, mat.rotor);
        rotor.rotation.x = -Math.PI / 2;
        rotor.position.set(Math.cos(turn) * end, 0.2, -Math.sin(turn) * end);
        root.add(rotor);
        rotors.push(rotor);
        const lamp = new THREE.Mesh(geo.lamp, mat.lamp);
        lamp.position.set(Math.cos(turn) * end, 0.08, -Math.sin(turn) * end);
        root.add(lamp);
      }
    }
    const eye = new THREE.Mesh(geo.eye, mat.eye);
    eye.position.set(0, -0.12, 0.38);
    root.add(eye);
    // The scan: a cone down to the floor, and its ring where it lands.
    const beam = new THREE.Mesh(geo.beam, mat.beam.clone());
    this.owned.push(beam.material);
    beam.visible = false;
    this.root.add(beam);
    const spot = new THREE.Mesh(geo.spot, mat.spot.clone());
    this.owned.push(spot.material);
    spot.rotation.x = -Math.PI / 2;
    spot.visible = false;
    this.root.add(spot);
    // What a sphere hits (bigger than the body: it's a small thing to hit at speed).
    const hurt = new THREE.Mesh(geo.hurt, mat.hurt);
    root.add(hurt);
    root.scale.setScalar(1.35);
    this.root.add(root);
    return { root, rotors, eye, beam, spot, hurt };
  }

  _spawn(distance, slot = 0, of = 1) {
    const parts = this._build();
    const d = {
      ...parts,
      state: "approach", t: 0, age: 0,
      // Two at once take a side each.
      side: of > 1 ? (slot === 0 ? -1 : 1) : 0,
      x: 0, aimX: 0, lockX: 0, vy: 0, spin: 0,
    };
    d.root.position.set(d.side * 3, 7.5, -(distance + 70));
    d.hurt.userData = { causeway: true, kind: "drone", alive: true, breakable: true, points: DRONE.points, drone: d };
    this.list.push(d);
    this.level.events.emit("drone-in", { first: this.downed === 0 && this.list.length === 1 });
    return d;
  }

  _schedule(distance, playing) {
    if (!playing) return;
    if (this.mode === "endless") {
      if (distance >= this.nextEndless) {
        const n = distance >= ENDLESS.pairsFrom ? 2 : 1;
        for (let i = 0; i < n; i += 1) this._spawn(distance, i, n);
        this.nextEndless = distance + ENDLESS.gap[0] + Math.random() * (ENDLESS.gap[1] - ENDLESS.gap[0]);
      }
      return;
    }
    while (this.schedule.length && this.schedule[0].d <= distance) {
      const { n } = this.schedule.shift();
      for (let i = 0; i < n; i += 1) this._spawn(distance, i, n);
    }
  }

  /** `player`: where you are, in the level root's space. */
  update(dt, time, distance, player, playing = true) {
    // (Out of play - a cutscene, the lift: they hold off.)
    if (!playing) return;
    this._schedule(distance, playing);
    const scan = DRONE.scan[this.hard ? 1 : 0];
    const lock = DRONE.lock[this.hard ? 1 : 0];
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const d = this.list[i];
      d.t += dt;
      d.age += dt;
      const p = d.root.position;
      if (d.state === "zapped") {
        this._fry(d, dt, player);
        if (d.t >= DRONE.zap) this._blow(i);
        continue;
      }
      for (const r of d.rotors) r.rotation.z += dt * 40;
      // Its slot: ahead of you, over your lane (lagging, so a lane change gets clear).
      const leaving = d.state === "leave";
      const slotZ = player.z - DRONE.ahead - (leaving ? d.t * 22 : 0);
      const slotY = DRONE.height + d.side * 0.25 + Math.sin(time * 2.1 + i) * 0.12 + (leaving ? d.t * 5 : 0);
      if (d.state !== "lock") d.aimX += (player.x + d.side * 0.4 - d.aimX) * Math.min(1, dt * 2.2);
      const hoverX = d.state === "lock" ? d.lockX : d.aimX + d.side * 1.6;
      const k = Math.min(1, dt * (d.state === "approach" ? 2.2 : 6));
      p.x += (hoverX - p.x) * k;
      p.y += (slotY - p.y) * k;
      p.z += (slotZ - p.z) * k;
      // Facing back at you (+z), banking into its moves.
      d.root.rotation.z = THREE.MathUtils.clamp((hoverX - p.x) * -0.25, -0.4, 0.4);

      if (d.state === "approach" && Math.abs(p.z - slotZ) < 2) { d.state = "scan"; d.t = 0; }
      else if (d.state === "scan" && d.t >= scan) {
        d.state = "lock"; d.t = 0;
        d.lockX = d.aimX;
        this.level.events.emit("drone-lock", {});
      } else if (d.state === "lock" && d.t >= lock) {
        this._fire(d, player);
        d.state = "rest"; d.t = 0;
      } else if (d.state === "rest" && d.t >= DRONE.rest) {
        d.state = d.age > DRONE.life ? "leave" : "scan"; d.t = 0;
      } else if (d.state === "leave" && d.t > 2.2) {
        this._remove(i);
        continue;
      }
      // The scan beam: from its eye to the floor where it is looking.
      const looking = d.state === "scan" || d.state === "lock";
      d.beam.visible = d.spot.visible = looking;
      if (looking) {
        const floorX = d.state === "lock" ? d.lockX : d.aimX;
        const floorZ = player.z - DRONE.scanAhead;
        _v.set(floorX, 0.02, floorZ);
        _w.set(p.x, p.y - 0.15, p.z);
        const len = _v.distanceTo(_w);
        d.beam.position.copy(_v).add(_w).multiplyScalar(0.5);
        // Thin while it sweeps; thicker, brighter, once it has locked.
        const width = d.state === "lock" ? 0.55 : 0.2;
        d.beam.scale.set(width, len, width);
        d.beam.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, _w.sub(_v).normalize());
        d.beam.material.opacity = d.state === "lock" ? 0.5 + 0.25 * Math.sin(d.t * 40) : 0.22 + 0.08 * Math.sin(time * 9);
        d.spot.position.copy(_v);
        d.spot.material.opacity = d.state === "lock" ? 0.95 : 0.45;
      }
    }
    this._updateBolts(dt, player);
  }

  _fire(d, player) {
    const bolt = new THREE.Mesh(this.geo.bolt, this.mat.bolt);
    bolt.position.copy(d.root.position).y -= 0.2;
    this.root.add(bolt);
    this.bolts.push({ mesh: bolt, x: d.lockX });
    this.level.events.emit("drone-fire", { position: this.level.root.localToWorld(bolt.position.clone()) });
  }

  _updateBolts(dt, player) {
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const b = this.bolts[i];
      // Down the line it locked: at your middle where you are now (it keeps up with you, not with a lane change).
      _v.set(b.x, 1.0, player.z);
      _w.subVectors(_v, b.mesh.position);
      const left = _w.length();
      const step = DRONE.bolt * dt;
      if (left <= Math.max(step, 0.4)) {
        b.mesh.position.copy(_v);
        const hit = Math.abs(player.x - b.x) < DRONE.reach;
        const at = this.level.root.localToWorld(_v.clone());
        if (hit) this.level.events.emit("drone-hit", { damage: DRONE.damage, position: at });
        else {
          at.y = 0.1;
          this.level._burst("sparks", at, { count: 16 });
          this.level.events.emit("drone-miss", { position: at });
        }
        b.mesh.removeFromParent();
        this.bolts.splice(i, 1);
        continue;
      }
      _w.divideScalar(left);
      b.mesh.position.addScaledVector(_w, step);
      b.mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, _w);
    }
  }

  /** Their hurtboxes, for the aim. */
  targets() {
    return this.list.filter((d) => d.hurt.userData.alive).map((d) => d.hurt);
  }

  /**
   * A sphere on one (Causeway.breakTarget): a shock sphere (`sphere`, what was
   * actually thrown - a charged glass shot bursts like shock but isn't one)
   * brings it down; anything else glances off.
   */
  hit(mesh, { sphere = "glass" } = {}) {
    const d = mesh.userData.drone;
    const position = mesh.getWorldPosition(new THREE.Vector3());
    if (!d || !mesh.userData.alive) return null;
    if (sphere !== "shock") {
      this.level._burst("sparks", position, { count: 12, speed: 3 });
      return { kind: "drone", rejected: true, points: 0, spheres: 0, position, label: "ARMOURED // ONLY A SHOCK SPHERE (Q/E) FRIES A DRONE" };
    }
    this._down(d);
    return { kind: "drone", points: DRONE.points, spheres: 0, position, label: "DRONE DOWN // EMP" };
  }

  /** A shock burst at `point`: every drone in reach goes down. */
  emp(point, radius) {
    let downed = 0;
    for (const d of this.list) {
      if (!d.hurt.userData.alive) continue;
      if (d.hurt.getWorldPosition(_v).distanceTo(point) > radius + 0.8) continue;
      this._down(d);
      downed += 1;
    }
    return downed;
  }

  /** Shocked: frying (_fry) for DRONE.zap seconds, then it blows (_blow). */
  _down(d) {
    d.hurt.userData.alive = false;
    d.state = "zapped";
    d.t = 0;
    d.spark = 0;
    d.beam.visible = d.spot.visible = false;
    // The arcs: jagged lines over its body, drawn fresh every frame.
    const arcs = new THREE.LineSegments(new THREE.BufferGeometry(), this.mat.arc);
    arcs.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    arcs.frustumCulled = false;
    d.root.add(arcs);
    d.arcs = arcs;
    const at = d.root.getWorldPosition(new THREE.Vector3());
    this.level._burst("shock", at);
    this.level._flashAt(at, 0xd28bff, 8);
    this.downed += 1;
    this.level.events.emit("drone-down", { position: at });
  }

  /**
   * Frying: purple arcs crawling over it and snapping out from it, the eye
   * flickering, the rotors stuttering - and haywire, darting side to side,
   * bucking and spinning, still out ahead of you.
   */
  _fry(d, dt, player) {
    const p = d.root.position, k = d.t / DRONE.zap;
    // Haywire: jerks about a point ahead (it doesn't drop back behind you).
    p.z += (player.z - DRONE.ahead - p.z) * Math.min(1, dt * 4);
    if (Math.random() < dt * 9) d.dart = (Math.random() - 0.5) * 6;
    p.x += ((d.dart ?? 0) + (d.aimX ?? 0) * 0.3 - p.x) * Math.min(1, dt * 7);
    p.y = DRONE.height + Math.sin(d.t * 23) * 0.25 + (Math.random() - 0.5) * 0.18 - k * k * 0.8;
    d.root.rotation.y += dt * (6 + k * 18);
    d.root.rotation.x = Math.sin(d.t * 17) * 0.5;
    d.root.rotation.z = Math.sin(d.t * 13 + 1) * 0.6;
    for (const r of d.rotors) r.rotation.z += dt * (Math.random() < 0.5 ? 60 : -10);
    d.eye.material = Math.random() < 0.5 ? this.mat.eye : this.mat.hull;
    // New arcs: segments wandering over the body, a few snapping out into the air.
    const pos = d.arcs.geometry.attributes.position;
    let n = 0;
    for (let a = 0; a < ARCS; a += 1) {
      const out = a >= ARCS - 2 ? 1.3 + Math.random() * 0.6 : 0;
      let theta = Math.random() * Math.PI * 2, phi = Math.random() * Math.PI;
      let r = 0.5;
      for (let j = 0; j < ARC_STEPS; j += 1) {
        const x0 = Math.sin(phi) * Math.cos(theta) * r, y0 = Math.cos(phi) * r * 0.65, z0 = Math.sin(phi) * Math.sin(theta) * r;
        theta += (Math.random() - 0.5) * 0.9;
        phi += (Math.random() - 0.5) * 0.7;
        r = out ? r + out / ARC_STEPS : 0.48 + Math.random() * 0.14;
        const x1 = Math.sin(phi) * Math.cos(theta) * r, y1 = Math.cos(phi) * r * 0.65, z1 = Math.sin(phi) * Math.sin(theta) * r;
        pos.setXYZ(n++, x0, y0, z0);
        pos.setXYZ(n++, x1, y1, z1);
      }
    }
    pos.needsUpdate = true;
    d.arcs.material.opacity = 0.6 + Math.random() * 0.4;
    // Sparks and flashes off it as it fries.
    d.spark -= dt;
    if (d.spark <= 0) {
      d.spark = 0.12 + Math.random() * 0.1;
      const at = d.root.getWorldPosition(_v);
      this.level._burst("sparks", at, { count: 18, speed: 5, color: Math.random() < 0.5 ? 0xd28bff : 0xffd8ff });
      this.level._flashAt(at, 0xd28bff, 3 + Math.random() * 4);
    }
  }

  /** It blows: a fireball, a violet blast, the pieces flying. */
  _blow(i) {
    const d = this.list[i];
    const at = d.root.getWorldPosition(new THREE.Vector3());
    this.level._burst("fireball", at, { count: 90, scale: 520, speed: 8 });
    this.level._burst("shock", at, { count: 160, speed: 13 });
    this.level._burst("sparks", at, { count: 70, speed: 10 });
    this.level._chunks(at, 16, { tint: 0x6d757e, speed: 8, radius: 0.5, size: 0.14 });
    this.level._flashAt(at, 0xffb070, 16);
    this.level.events.emit("drone-blast", { position: at });
    this._remove(i);
  }

  _remove(i) {
    const d = this.list[i];
    d.arcs?.geometry.dispose();
    d.root.removeFromParent();
    d.beam.removeFromParent();
    d.spot.removeFromParent();
    this.list.splice(i, 1);
  }

  /** None left flying (a restart from a checkpoint): the schedule from `distance` on. */
  reset(distance = 0) {
    for (let i = this.list.length - 1; i >= 0; i -= 1) this._remove(i);
    for (const b of this.bolts) b.mesh.removeFromParent();
    this.bolts.length = 0;
    this.schedule = this.mode === "endless" ? [] : STORY.filter(([d]) => d > distance + 5).map(([d, n]) => ({ d, n }));
    this.nextEndless = Math.max(ENDLESS.first, distance + ENDLESS.gap[0]);
  }

  dispose() {
    this.reset();
    this.root.removeFromParent();
    for (const o of this.owned ?? []) o.dispose?.();
  }
}
