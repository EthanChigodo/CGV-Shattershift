/**
 * The roof, for two: Rooftop Showdown's arena.
 *
 * Everything RoofLevel (src/levels/meltdown/roof.js) builds is kept as it
 * is - the slab and its open ledges, the hatches, the city 160 m below, the
 * floods, the patients and scientists and their AI, the canisters, the
 * supply drop, the chaos, the helicopter and its rope ladder. What assumed a
 * single player is taken over here, in a subclass, so the story's roof file
 * is never edited:
 *
 *   - Two targets. Each enemy hunts the nearer Subject (with a little
 *     stickiness, so it does not dither between them); its charge and its
 *     orbs land on whoever it was after. A Subject on the ladder is out of
 *     reach - the patients crowd the ledge under them instead.
 *   - A fair layout. Spawns, canisters and sphere caches are mirrored east
 *     to west; the story's are placed for one player coming out of the lift.
 *   - The helicopter's clock is visible and every kill takes time off it
 *     (`shave`). When it is close the host picks a ledge (east or west) and
 *     it flies in there and holds, ladder down, for as long as it takes -
 *     no window, no leaving: one of the two will climb.
 *   - Rounds: `resetRound()` puts the roof back as it was (enemies gone,
 *     canisters and caches back, the drop and the helicopter cleared)
 *     without rebuilding it - the city, the textures and the compiled
 *     shaders stay.
 *
 * Coordinates are the roof's: y up, the open ledges at x = +/-EDGE, the lift
 * housing to the south (+Z), the helipad to the north.
 */

import * as THREE from "../three.js";
import { RoofLevel, EDGE } from "../levels/meltdown/roof.js";
import { fillAssetSlots } from "../levels/meltdown/assets.js";

/** Where each Subject comes out at the start of a round: either side of the lift housing. */
export const SPAWNS = [new THREE.Vector3(-5, 0, 11.5), new THREE.Vector3(5, 0, 11.5)];
/** Gas canisters and sphere caches, mirrored (x, z). */
const CANISTER_SPOTS = [[-12, 7], [12, 7], [-7.5, -7], [7.5, -7]];
const CACHE_SPOTS = [[-13.5, 1], [13.5, 1], [0, 6.5]];
/** Spheres in each roof cache. */
const CACHE_SPHERES = 7;

/** Seconds from the start of a round to the helicopter, before kills. */
export const HELI_SECONDS = 52;
/** Each enemy down takes this off the clock... */
export const KILL_SHAVE = 1.25;
/** ...but it never comes sooner than this into a round. */
export const HELI_EARLIEST = 26;
/** Seconds from the first sight of it to its hover off the ledge. */
export const HELI_FLIGHT = 12;
/** Seconds of settling into the hover before the ladder can be reached. */
export const HOLD_READY = 2.6;
/** How near the ladder's foot (m, across the roof) a jump for it can be made from. */
export const LADDER_REACH = 4.6;

/** Enemies alive at once (each one is drawn twice, once per view). */
const MAX_ALIVE = 10;
/** After the three set waves, another this often. */
const WAVE_EVERY = 13;
/** Patients climbing over the open ledges mid-round: [wave, seconds, side]. */
const CLIMBERS = [[1, 8, -1], [1, 9, 1], [2, 22, 1], [2, 23, -1], [3, 36, -1], [3, 37.5, 1]];
/** An enemy sticks with its target unless the other is this much nearer. */
const STICKY = 0.75;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class VersusRoof extends RoofLevel {
  constructor(options = {}) {
    // Hard's extras: one more patient in the first waves, the brute early -
    // there are two of you.
    super({ ...options, endless: false, difficulty: { waves: 1, damage: 1, enemySpeed: 1, heli: 1, lastWave: 3, extras: true } });
    this._baseCover = this.cover.slice();
    /** -1 west, 1 east, 0 not called yet. */
    this.heliSide = 0;
    this.heliLeft = HELI_SECONDS;
    this.state.heliAt = HELI_SECONDS;
    this._idle = { player: new THREE.Vector3(), playerVelocity: new THREE.Vector3(), hits: [], frozen: true };
  }

  /* ---------------- A mirrored layout ---------------- */

  /** The base's canisters, at mirrored spots (called from RoofLevel's constructor). */
  _buildCanisters() {
    const k = this.kit;
    const red = this._track(new THREE.MeshStandardMaterial({ color: 0xa3201a, roughness: 0.45, metalness: 0.45 }));
    const band = this._track(new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.6 }));
    this.canisters = [];
    for (const [i, [x, z]] of CANISTER_SPOTS.entries()) {
      const at = new THREE.Vector3(x, 0, z);
      const group = new THREE.Group();
      group.name = "GasCanister";
      group.position.copy(at);
      // Turned so each pair faces into the roof the same way.
      const flip = x < 0 ? 1 : -1;
      for (const [dx, dz] of [[0, 0], [0.55 * flip, 0.25]]) {
        const body = new THREE.Mesh(k.geometries.unitCyl, red);
        body.scale.set(0.6, 1.3, 0.6);
        body.position.set(dx, 0.65, dz);
        group.add(body);
        const stripe = new THREE.Mesh(k.geometries.unitCyl, band);
        stripe.scale.set(0.62, 0.12, 0.62);
        stripe.position.set(dx, 1.0, dz);
        group.add(stripe);
        const valve = new THREE.Mesh(k.geometries.unitCyl, k.materials.darkMetal);
        valve.scale.set(0.16, 0.18, 0.16);
        valve.position.set(dx, 1.38, dz);
        group.add(valve);
      }
      const hit = new THREE.Mesh(k.geometries.unitBox, k.materials.collider);
      hit.scale.set(1.3, 1.5, 1.0);
      hit.position.set(0.27 * flip, 0.75, 0.12);
      hit.userData = { kind: "canister", breakable: true, alive: true, index: i };
      group.add(hit);
      this.groups.set.add(group);
      this.breakables.push(hit);
      const box = new THREE.Box3().setFromCenterAndSize(at.clone().add(new THREE.Vector3(0.27 * flip, 0.75, 0.12)), new THREE.Vector3(1.3, 1.5, 1.0));
      this.cover.push(box);
      this.canisters.push({ group, hit, box, at: at.clone().setY(0.9) });
    }
  }

  /** Sphere caches, mirrored (and rebuilt every round). */
  _buildPickups() {
    for (const [x, z] of CACHE_SPOTS) {
      const sack = this.kit.sack({ hp: 1, spheres: CACHE_SPHERES });
      sack.position.set(x, 0, z);
      this.groups.pickups.add(sack);
      this._ticking.push(sack);
      this.breakables.push(sack.userData.glass);
      if (this.assets) fillAssetSlots(sack, this.assets);
    }
  }

  /* ---------------- The fight ---------------- */

  /**
   * One frame of the roof.
   * @param {object} p
   * @param {number} p.dt
   * @param {number} p.time
   * @param {{position: THREE.Vector3, velocity: THREE.Vector3, targetable: boolean, exposed: boolean}[]} p.players
   *   targetable: worth hunting (on the roof, or on the ladder); exposed: can be charged and shot (on the roof)
   * @param {boolean} [p.hold]  the round's intro or its end: the clock and the AI stand still
   * @returns {object[][]} hits on each player this frame
   */
  update({ dt, time, players, hold = false }) {
    const s = this.state;
    this.fire.setTime(time);
    this.city?.update(dt, time, { haze: this.cityHaze });
    for (const piece of this._ticking) piece.userData.tick?.(dt, time);
    const hits = players.map(() => []);

    if (!hold) {
      s.time += dt;
      this._waves(players);
      if (!this.heliSide) {
        this.heliLeft -= dt;
        if (this.heliLeft <= HELI_FLIGHT) {
          // The host picks the ledge (the round's top killer earned it); a coin if nobody does.
          this.events.emit("heli-call", {});
          if (!this.heliSide) this.callHelicopter(this.random() < 0.5 ? -1 : 1);
        }
      } else if (!s.heliArrived) this.heliLeft -= dt;
      s.heliAt = s.time + this.heliLeft;
    }

    this._updateEnemies(dt, time, players, hits, hold);
    if (!hold) {
      this._updateVersusOrbs(dt, players, hits);
      this._updateChaos(dt, time, null);
      // A supply drop, once a round, after the second wave is in.
      if (!this.drop && s.wave >= 2 && s.time > 22) this._startDrop(null);
      for (const c of this.canisters) {
        if (c.chain === undefined || !c.hit.userData.alive) continue;
        c.chain -= dt;
        if (c.chain <= 0) {
          const i = this.breakables.indexOf(c.hit);
          if (i >= 0) this.breakables.splice(i, 1);
          this._blowCanister(c.hit);
        }
      }
    }
    this._updateDrop(dt, time);
    for (const p of this.points) {
      if (!p.flicker) continue;
      p.flash = Math.max(0, (p.flash ?? 0) - dt * 3);
      p.light.intensity = p.base * (1 + s.chaos * 0.4 + p.flash * 12);
    }
    this._updateVersusHelicopter(dt, time);
    return hits;
  }

  _waves(players) {
    const s = this.state;
    const alive = this.enemiesAlive;
    if (s.wave === 0 && s.time > 1.2) this._spawnWave(1);
    else if (s.wave === 1 && (s.time > 15 || (s.time > 5 && alive === 0))) this._spawnWave(2);
    else if (s.wave === 2 && (s.time > 29 || (s.time > 19 && alive === 0))) this._spawnWave(3);
    else if (s.wave >= 3 && s.time > s.nextWaveAt && alive <= MAX_ALIVE - 4) this._spawnWave(s.wave + 1);
    if (s.wave >= 3 && s.nextWaveAt <= s.time) s.nextWaveAt = s.time + WAVE_EVERY;

    // Over the open ledges, beside whichever of them is out there.
    s.climbers ??= CLIMBERS.map(([wave, at, side]) => ({ wave, at, side }));
    const next = s.climbers[0];
    if (next && this._patientClass && s.wave >= next.wave && s.time > next.at && alive < MAX_ALIVE) {
      s.climbers.shift();
      const near = players.filter((p) => p.exposed);
      const z = near.length ? near[Math.floor(this.random() * near.length)].position.z : 0;
      const at = new THREE.Vector3(next.side * EDGE, 0, THREE.MathUtils.clamp(z + (this.random() - 0.5) * 8, -EDGE + 3, EDGE - 4));
      const climber = new this._patientClass(this, { model: this._character("patient"), position: at, delay: 0.4, climb: next.side });
      this._addEnemy(climber);
      this.events.emit("patient-climb", { position: climber.position.clone() });
    }
    this._cullFallen();
  }

  /** The base's Patient class is not exported by roof.js: taken from the first wave's (for the climbers). */
  _spawnWave(index) {
    super._spawnWave(index);
    this._patientClass ??= this.enemies.find((e) => e.kind === "patient")?.constructor;
  }

  /** Each enemy after the nearer Subject, with its own context (its hits land on them). */
  _updateEnemies(dt, time, players, hits, hold) {
    const ctxs = players.map((p, i) => ({ player: p.position, playerVelocity: p.velocity, hits: hits[i], frozen: hold || !p.exposed }));
    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      const target = this._targetFor(enemy, players);
      let ctx;
      if (target >= 0) {
        ctx = ctxs[target];
        (enemy.vsLast ??= new THREE.Vector3()).copy(players[target].position);
      } else {
        // Nobody to go for (both down or over the edge): hold where they were looking.
        ctx = this._idle;
        ctx.player.copy(enemy.vsLast ?? _v.copy(enemy.position).add(_w.set(0, 0, 1)));
        ctx.hits.length = 0;
      }
      enemy.update(dt, time, ctx);
      if (enemy.state === "fall" && !enemy.counted) {
        enemy.counted = true;
        enemy.hurt.userData.alive = false;
        const i = this.breakables.indexOf(enemy.hurt);
        if (i >= 0) this.breakables.splice(i, 1);
        this.state.falls += 1;
        // Who it was going for when it went over: they lured it.
        this.events.emit("vs-fall", { enemy, target: enemy.vsTarget ?? -1, position: enemy.position.clone() });
      }
      if (enemy.removed) enemy.root.visible = false;
    }
  }

  _targetFor(enemy, players) {
    if (!enemy.alive) return enemy.vsTarget ?? -1;
    let best = -1;
    let bestD = Infinity;
    for (const [i, p] of players.entries()) {
      if (!p.targetable) continue;
      let d = Math.hypot(p.position.x - enemy.position.x, p.position.z - enemy.position.z);
      if (!p.exposed) d *= 1.6; // up the ladder: only if there is nobody else
      if (i === enemy.vsTarget) d *= STICKY;
      if (d < bestD) { bestD = d; best = i; }
    }
    // Committed to a charge: it keeps its target until it ends.
    if (enemy.state === "charge" || enemy.state === "windup") return enemy.vsTarget ?? best;
    enemy.vsTarget = best;
    return best;
  }

  /** The scientists' orbs: they burst on whichever Subject they reach. */
  _updateVersusOrbs(dt, players, hits) {
    for (const orb of this.orbs) {
      if (!orb.active) continue;
      orb.life += dt;
      const p = orb.mesh.position;
      p.addScaledVector(orb.velocity, dt);
      orb.mesh.scale.setScalar(0.28 + Math.sin(orb.life * 30) * 0.03);
      let end = orb.life > 4 || p.y < 0.1 || Math.abs(p.x) > EDGE + 20 || Math.abs(p.z) > EDGE + 20;
      if (!end && this.blocked(p, 0.05) && p.y < 2.2) end = true;
      if (!end) {
        for (const [i, player] of players.entries()) {
          if (!player.exposed) continue;
          _v.copy(player.position).setY(player.position.y + 1.1);
          if (p.distanceTo(_v) < 0.75) {
            hits[i].push({ damage: 10, from: p.clone(), knock: 3, source: "orb" });
            end = true;
            break;
          }
        }
      }
      if (end) {
        orb.active = false;
        orb.mesh.visible = false;
        this.events.emit("orb-burst", { position: p.clone() });
      }
    }
  }

  /* ---------------- Kills and the clock ---------------- */

  /** A kill: the helicopter is that much nearer (until it is in the air). */
  shave(seconds = KILL_SHAVE) {
    if (this.heliSide) return 0;
    const earliest = Math.max(0, HELI_EARLIEST - this.state.time);
    const before = this.heliLeft;
    this.heliLeft = Math.max(earliest, HELI_FLIGHT, this.heliLeft - seconds);
    return before - this.heliLeft;
  }

  /** Seconds until it hovers off the ledge (0 once it is there). */
  get heliETA() {
    return this.state.heliArrived ? 0 : Math.max(0, this.heliLeft);
  }

  /* ---------------- The helicopter ---------------- */

  /** Bring it in to one ledge: -1 west, 1 east. */
  callHelicopter(side) {
    if (this.heliSide) return;
    this.heliSide = side < 0 ? -1 : 1;
    this.heliLeft = Math.max(this.heliLeft, HELI_FLIGHT);
    const hold = this.holdPoint;
    const x = this.heliSide;
    this._approach = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x * 150, 45, -170),
      new THREE.Vector3(x * 72, 30, -92),
      new THREE.Vector3(x * 34, 15, -30),
      hold,
    ]);
    this.events.emit("heli-inbound", { side: this.heliSide });
  }

  /** Where it holds off the chosen ledge, its door (and ladder) side to the roof. */
  get holdPoint() {
    return new THREE.Vector3((this.heliSide || 1) * (EDGE + 3.45), 7.1, -2.5);
  }

  /** Its yaw in the hover: nose north on the west ledge, south on the east, so the ladder faces the roof. */
  get _holdYaw() {
    return this.heliSide > 0 ? Math.PI : 0;
  }

  _updateVersusHelicopter(dt, time) {
    const s = this.state;
    const heli = this.heli;
    if (!this.heliSide) {
      if (heli) heli.root.visible = false;
      return;
    }
    if (!s.heliArrived) {
      const t = THREE.MathUtils.clamp(1 - this.heliLeft / HELI_FLIGHT, 0, 1);
      if (heli) {
        const eased = 1 - Math.pow(1 - t, 2.2);
        this._approach.getPointAt(eased, heli.root.position);
        const ahead = this._approach.getPointAt(Math.min(1, eased + 0.02)).sub(heli.root.position);
        if (ahead.lengthSq() > 1e-4) {
          heli.orient(ahead, { pitch: -0.16 * (1 - eased), bank: Math.sin(time * 0.9) * 0.03 + (1 - eased) * 0.1 * this.heliSide });
          this._heliYaw = heli.root.rotation.y;
        }
        heli.root.visible = true;
      }
      if (!s.heliSeen && t > 0) {
        s.heliSeen = true;
        this.events.emit("heli-seen", { side: this.heliSide });
      }
      if (this.heliLeft <= 0) {
        s.heliArrived = true;
        s.ending = "extraction";
        s.extractT = 0;
        this._extractFrom = heli ? heli.root.position.clone() : this.holdPoint;
        this.events.emit("heli-arrived", { side: this.heliSide });
      }
    } else if (s.ending === "extraction") {
      s.extractT += dt;
      if (heli) {
        const k = THREE.MathUtils.smoothstep(s.extractT, 0, 3);
        heli.root.position.lerpVectors(this._extractFrom, this.holdPoint, k);
        heli.root.position.y += Math.sin(time * 1.3) * 0.25 * k;
        heli.root.position.z += Math.sin(time * 0.6) * 0.4 * k;
        // The shortest way round to the hover's heading.
        let from = this._heliYaw ?? this._holdYaw;
        let delta = this._holdYaw - from;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        heli.root.rotation.set(0, from + delta * k, Math.sin(time * 0.8) * 0.04);
      }
    } else if (s.ending === "departing") {
      s.extractT += dt;
      const k = s.extractT;
      if (heli) {
        heli.root.position.copy(this._leaveFrom).add(_v.set(this.heliSide * k * k * 1.3, k * k * 0.9 + k * 0.5, k * 1.6));
        heli.root.rotation.set(-0.12 * Math.min(1, k), this._holdYaw - this.heliSide * Math.min(0.5, k * 0.15), -0.08 * Math.min(1, k) * this.heliSide);
        if (k > 14) heli.root.visible = false;
      }
    }
    if (heli?.root.visible) heli.update(dt, { rotor: 1, light: 1 });
  }

  /** Hovering, settled, ladder down: it can be jumped for. */
  get ladderReady() {
    return this.state.ending === "extraction" && this.state.extractT >= HOLD_READY;
  }

  /** A point on the ladder, `h` m up from its foot (where it would hang without the model, too). */
  ladderPoint(h, target = new THREE.Vector3()) {
    if (this.heli) return this.heli.ladderPoint(h, target);
    const side = this.heliSide || 1;
    return target.set(side * (EDGE + 2.2), 1.0 + h, -1.3);
  }

  /** Close enough to the ladder, at the right ledge, to jump for it? */
  canReachLadder(p) {
    if (!this.ladderReady || p.y < -0.3) return false;
    const foot = this.ladderPoint(0, _w);
    return this.heliSide * p.x > EDGE - 4.5 && Math.hypot(foot.x - p.x, foot.z - p.z) < LADDER_REACH;
  }

  /** Someone is up: away it goes, the winner on the ladder. */
  depart() {
    const s = this.state;
    if (s.ending === "departing") return;
    s.ending = "departing";
    s.extractT = 0;
    this._leaveFrom = this.heli ? this.heli.root.position.clone() : this.holdPoint;
  }

  get rotorLevel() {
    const s = this.state;
    if (s.ending === "departing") return Math.max(0, 1 - s.extractT / 9);
    if (s.heliArrived) return 1;
    return THREE.MathUtils.clamp(1 - this.heliLeft / 16, 0, 1);
  }

  /* ---------------- Rounds ---------------- */

  /** The roof as it was at the start: no enemies, canisters and caches back, no drop, no helicopter. */
  resetRound() {
    const s = this.state;
    for (const e of this.enemies) {
      this.groups.enemies.remove(e.root);
      if (!e.removed) e._ash?.dispose?.();
      e.glowMaterial?.dispose?.();
    }
    this.enemies.length = 0;
    for (const o of this.orbs) {
      o.active = false;
      o.mesh.visible = false;
    }
    // The caches (and whatever the drop left) go; new ones are put out.
    for (const child of [...this.groups.pickups.children]) {
      this.groups.pickups.remove(child);
      const i = this._ticking.indexOf(child);
      if (i >= 0) this._ticking.splice(i, 1);
    }
    if (this.drop) {
      this.groups.set.remove(this.drop.crate, this.drop.glow);
      this.groups.hazards.remove(this.drop.flare);
      const i = this._ticking.indexOf(this.drop.flare);
      if (i >= 0) this._ticking.splice(i, 1);
      this.drop = null;
    }
    this.cover = this._baseCover.slice();
    this.breakables.length = 0;
    for (const c of this.canisters) {
      c.group.visible = true;
      c.hit.userData.alive = true;
      delete c.chain;
      this.breakables.push(c.hit);
    }
    this._buildPickups();
    Object.assign(s, {
      time: 0, wave: 0, nextWaveAt: 0, heliSeen: false, heliArrived: false, cleared: false, ending: null,
      downs: 0, falls: 0, chaos: 0, extractT: 0, blastTimer: 7, tremorTimer: 13, heliAt: HELI_SECONDS,
    });
    delete s.climbers;
    this.heliSide = 0;
    this.heliLeft = HELI_SECONDS;
    this._approach = null;
    this._heliYaw = undefined;
    if (this.heli) {
      this.heli.root.visible = false;
      this.heli._sway?.set(0, 0);
      this.heli._swayV?.set(0, 0);
      this.heli._lastPos = null;
    }
    if (this.embers) this.embers.material.opacity = 0;
    for (const p of this.points) p.flash = 0;
  }
}
