/**
 * The Labs' and the Roof's right-tool problems (src/systems/problems.js).
 *
 *   FIRE WALL (the Labs, cryo)      A doorway out of a hall, filled wall to
 *     wall with flame. Glass passes through it and fizzles; a cryo sphere -
 *     on it, or bursting close enough - puts it out, the flames dying back
 *     in a wave out from where it hit. Run into it and it burns you badly and
 *     knocks you about (Thermal Aegis: you walk through). Two in a run, the
 *     first after the containment hall, seen across the whole hall; Hard
 *     has a third.
 *   JAMMED SHUTTER (the Labs, the charged shot)  A blast shutter jammed
 *     across the corridor at the archive's exit. Plain shots only dent it
 *     (the gold meter fills a little each time); one full charged shot
 *     blows it out. Dent it full and it gives too - eight spheres instead of
 *     two, and no bonus. Run into it and you shoulder through, hurt.
 *   STRANDED SUPPLIES (the Roof, gravity)  A crate on the window-cleaner's
 *     cradle off the west ledge, out over the drop - only a gravity well
 *     close to it drags it in over the ledge, where it bursts open.
 *   OVER THE EDGE (the Roof, gravity)  A gravity well near an open ledge
 *     drags the patients it catches over it.
 *
 * The level (index.js, roof.js) places the pieces; the game (game.js) hands
 * every hit, burst and frame to a ProblemPlay, which decides what each tool
 * does and reports to the host's ProblemLog.
 */

import * as THREE from "../../three.js";
import { toolBadge, toolSprite, floorStripes, toolColour, fadeMark, disposeMark } from "../../fx/problem-marks.js";
import { PROBLEMS } from "../../systems/problems.js";

/** The most spheres a runner holds (game.js MAX_BALLS): a refund doesn't go past it. */
const MAX_BALLS = 45;

const FLAME_SPOTS = 6;
const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** How far ahead a problem says what it wants (metres): further on Easy. */
const LEAD = { easy: 62, normal: 50, hard: 42 };
/** A dent from a plain hit (the shutter's meter: 1 = it gives). */
const DENT = { glass: 0.125, cryo: 0.2, shock: 0.22, gravity: 0 };
/** At least this much charge blows the shutter out at once. */
const FULL_CHARGE = 0.95;

function own(list, item) {
  list.push(item);
  return item;
}

/* ------------------------------------------------------------------ */
/* The pieces                                                           */
/* ------------------------------------------------------------------ */

/**
 * A wall of flame across the corridor, posts either side banded in cryo
 * cyan with its mark, a cyan line on the floor before it.
 */
export function buildFireWall(kit, fire, { halfWidth = 7, height = 5.4, seed = 1 } = {}) {
  const owned = [];
  const group = new THREE.Group();
  group.name = "FireWall";
  const span = halfWidth * 2 - 0.5;
  const band = own(owned, new THREE.MeshBasicMaterial({ color: toolColour("cryo", 2.4), toneMapped: false }));
  const marks = [];
  for (const side of [-1, 1]) {
    const x = side * (halfWidth - 0.3);
    group.add(kit.box(0.42, 5.4, 0.42, kit.materials.darkMetal, 0, x, 0));
    for (const y of [0.35, 0.95, 4.6]) group.add(kit.box(0.46, 0.14, 0.46, band, y, x, 0));
    const badge = toolBadge("cryo", 0.95);
    badge.position.set(x - side * 0.02, 2.7, 0.24);
    group.add(badge);
    marks.push(badge);
  }
  const top = toolBadge("cryo", 1.5);
  top.position.set(0, height + 0.9, 0.4);
  group.add(top);
  marks.push(top);
  const line = floorStripes("cryo", span, 0.9);
  line.position.z = 3.4;
  group.add(line);
  marks.push(line);

  // The flames: their own material each, so they can die back one by one.
  const spots = [];
  for (let i = 0; i < FLAME_SPOTS; i += 1) {
    const x = -span / 2 + (span * (i + 0.5)) / FLAME_SPOTS;
    const material = own(owned, fire.fire.clone());
    material.uniforms.uTime = fire.fire.uniforms.uTime;
    material.uniforms.uHeightScale = { value: 1 };
    const flame = kit.fireSpot({
      width: span / FLAME_SPOTS + 0.6, depth: 1.2, height, count: 17,
      smoke: i % 2 === 0, light: false, seed: seed * 17 + i, materialSet: { ...fire, fire: material },
    });
    flame.position.x = x;
    group.add(flame);
    spots.push({ x, flame, material, k: 1, delay: -1 });
  }

  const state = { lit: 1 };
  const anchor = new THREE.Object3D();
  anchor.position.y = 2.2;
  group.add(anchor);
  group.userData.emitter = {
    kind: "point", anchor, color: 0xff6a1c, base: 10, distance: 24,
    intensityAt: (time) => (9 + Math.sin(time * 11) * 1.8 + Math.sin(time * 23) * 0.9) * state.lit,
  };

  // In the way of the body (Thermal Aegis lets you through, as a vent's
  // flames: `fireVent`); not of a sphere (`pass`) - it reaches the target.
  const collider = new THREE.Mesh(kit.geometries.unitBox, kit.materials.collider);
  collider.scale.set(span, height + 1, 1.2);
  collider.position.y = (height + 1) / 2;
  collider.userData = { kind: "hazard", solid: true, fireVent: true, fireWall: true, pass: true, problem: "firewall" };
  group.add(collider);
  const target = new THREE.Mesh(kit.geometries.unitBox, kit.materials.collider);
  target.scale.set(span, height, 0.5);
  target.position.set(0, height / 2, 0.25);
  target.name = "FireWallTarget";
  target.userData = { kind: "firewall", problem: "firewall", breakable: true, alive: true, node: group };
  group.add(target);

  // Dying back: each spot, after its delay, shrinks to nothing.
  group.userData.tick = (dt) => {
    let lit = 0;
    for (const s of spots) {
      if (s.dying) {
        if (s.delay > 0) s.delay -= dt;
        else s.k = Math.max(0, s.k - dt * 3.2);
      }
      s.material.uniforms.uHeightScale.value = s.k;
      s.flame.visible = s.k > 0.01;
      lit += s.k / spots.length;
    }
    state.lit = lit;
  };

  group.userData.hazardMeshes = [collider];
  group.userData.breakableMeshes = [target];
  group.userData.problem = { key: "firewall", collider, target, spots, marks, state, owned };
  return group;
}

/**
 * A heavy blast shutter jammed crooked in its frame, hazard-striped, with the
 * charged shot's gold mark and a gold meter of how far it has been dented.
 */
export function buildShutter(kit, { halfWidth = 7, height = 5.6 } = {}) {
  const owned = [];
  const group = new THREE.Group();
  group.name = "JammedShutter";
  const span = halfWidth * 2 - 0.6;
  for (const side of [-1, 1]) group.add(kit.box(0.6, height + 0.8, 0.9, kit.materials.darkMetal, 0, side * (halfWidth - 0.25), 0));
  group.add(kit.box(span + 1.2, 0.7, 0.9, kit.materials.darkMetal, height + 0.1, 0, 0));

  const slab = new THREE.Group();
  group.add(slab);
  const metal = own(owned, new THREE.MeshStandardMaterial({ color: 0x4d5458, metalness: 0.78, roughness: 0.42, emissive: 0xff5a14, emissiveIntensity: 0 }));
  slab.add(kit.box(span, height, 0.42, metal, 0, 0, 0));
  slab.add(kit.box(span, 0.55, 0.46, kit.materials.hazard, 0.15, 0, 0));
  for (const y of [1.3, 2.5, 3.7, 4.9]) slab.add(kit.box(span, 0.16, 0.5, kit.materials.darkMetal, y, 0, 0));
  // Jammed: dropped at one end.
  slab.rotation.z = 0.035;
  slab.position.y = -0.1;

  const badge = toolBadge("charge", 1.6);
  badge.position.set(0, 2.3, 0.3);
  slab.add(badge);
  const gold = toolColour("charge", 2.2);
  const meterBack = own(owned, new THREE.MeshBasicMaterial({ color: 0x07080a }));
  const meterFill = own(owned, new THREE.MeshBasicMaterial({ color: gold, toneMapped: false }));
  // (Ticks every eighth: a plain glass hit's dent.)
  const back = kit.box(5.2, 0.5, 0.05, meterBack, 3.35, 0, 0.27);
  const fill = kit.box(5.0, 0.34, 0.06, meterFill, 3.43, 0, 0.29);
  for (let i = 1; i < 8; i += 1) back.add(kit.box(0.012, 1.1, 1.4, kit.materials.darkMetal, -0.55, -0.5 + i / 8, 0));
  fill.scale.x = 0.001;
  slab.add(back, fill);
  const marks = [badge];
  const line = floorStripes("charge", span, 0.9);
  line.position.z = 3.4;
  group.add(line);
  marks.push(line);

  const collider = new THREE.Mesh(kit.geometries.unitBox, kit.materials.collider);
  collider.scale.set(span, height, 0.6);
  collider.position.y = height / 2;
  collider.userData = { kind: "hazard", solid: true, problem: "shutter" };
  group.add(collider);
  const target = new THREE.Mesh(kit.geometries.unitBox, kit.materials.collider);
  target.scale.set(span - 0.4, height - 0.3, 0.2);
  target.position.set(0, height / 2, 0.45);
  target.name = "ShutterTarget";
  target.userData = { kind: "shutter", problem: "shutter", breakable: true, alive: true, node: group };
  group.add(target);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, 3, 1.2);
  group.add(anchor);
  const state = { dent: 0, heat: 0, shake: 0, blast: null };
  group.userData.emitter = { kind: "point", anchor, color: 0xffc04a, base: 3, distance: 12, intensityAt: () => (state.blast ? 0 : 2.5 + state.heat * 6) };

  group.userData.tick = (dt) => {
    state.heat = Math.max(0, state.heat - dt * 1.2);
    state.shake = Math.max(0, state.shake - dt * 4);
    metal.emissiveIntensity = state.dent * 0.5 + state.heat * 1.2;
    fill.scale.x = Math.max(0.001, state.dent);
    fill.position.x = -2.5 + 2.5 * state.dent;
    if (state.blast) {
      // Blown out of its frame, away down the corridor.
      const b = state.blast;
      b.t += dt;
      b.velocity.y -= 18 * dt;
      slab.position.addScaledVector(b.velocity, dt);
      if (slab.position.y < -1.2) { slab.position.y = -1.2; b.velocity.set(0, 0, 0); }
      slab.rotation.x = Math.max(-1.45, slab.rotation.x - dt * 2.4);
      if (b.t > 2.4) slab.visible = false;
    } else {
      slab.position.z = Math.sin(state.shake * 40) * 0.04 * state.shake;
    }
  };

  group.userData.hazardMeshes = [collider];
  group.userData.breakableMeshes = [target];
  group.userData.problem = { key: "shutter", collider, target, marks, state, slab, owned };
  return group;
}

/**
 * Lay the Labs' problems out (from MeltdownLevel's constructor, before the
 * filler patterns, which keep clear of them): at the exits of the
 * containment hall, the substation and the archive - each seen across the
 * whole hall before it - and on Hard the boiler hall too.
 */
export function placeLabsProblems(level) {
  const list = [];
  const exit = (theme) => {
    const hall = level.halls.find((h) => h.theme === theme);
    return hall ? hall.end + 3 : null;
  };
  const plan = [["firewall", exit("containment")], ["firewall", exit("substation")], ["shutter", exit("archive")]];
  if (level.options.extras) plan.push(["firewall", exit("boiler")]);
  for (const [i, [key, at]] of plan.entries()) {
    if (at === null) continue;
    let d = at;
    for (let k = 0; k < 8 && level._setPieces.some((s) => Math.abs(s - d) < 6); k += 1) d += 1.5;
    const piece = key === "firewall" ? buildFireWall(level.kit, level.fire, { halfWidth: 7, seed: i + 1 }) : buildShutter(level.kit, { halfWidth: 7 });
    level._hazard(piece, d, 0);
    // A clear run-up: the filler keeps 9 m off each mark, so nothing stands
    // in the line of fire for the last ~17 m.
    level._mark(d);
    level._mark(d - 8);
    const p = { key, distance: d, group: piece, solved: false, contact: false, ...piece.userData.problem };
    p.target.userData.problemRef = p;
    p.collider.userData.problemRef = p;
    list.push(p);
  }
  return {
    list,
    dispose() {
      for (const p of list) {
        for (const m of p.owned) m.dispose?.();
        for (const m of p.marks) disposeMark(m);
      }
      list.length = 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/* The Roof's: supplies stranded off the west ledge                     */
/* ------------------------------------------------------------------ */

/**
 * The window-cleaner's cradle hung off the open west ledge on its davit
 * arm, a supply crate left on it, out over the drop: gravity's indigo on the
 * crate and on the ledge in front of it.
 */
export function buildStrandedCrate(kit, { edge = 16, z = 4 } = {}) {
  const owned = [];
  const group = new THREE.Group();
  group.name = "StrandedSupplies";
  const out = -(edge + 2.6);
  // The davit: a post on the roof, an arm out over the edge, the cables.
  group.add(kit.box(0.3, 3.6, 0.3, kit.materials.darkMetal, 0, -edge + 0.9, z));
  const arm = kit.box(3.9, 0.22, 0.22, kit.materials.darkMetal, 3.5, -edge - 0.85, z);
  group.add(arm);
  for (const dz of [-0.9, 0.9]) {
    const cable = kit.box(0.04, 3.5, 0.04, kit.materials.darkMetal, 0.05, out, z + dz);
    group.add(cable);
  }
  // The cradle: a steel deck with a rail, hanging level with the roof.
  const cradle = new THREE.Group();
  cradle.position.set(out, -0.25, z);
  group.add(cradle);
  cradle.add(kit.box(2.2, 0.12, 2.4, kit.materials.paintedMetal, 0, 0, 0));
  for (const dz of [-1.15, 1.15]) cradle.add(kit.box(2.2, 0.06, 0.06, kit.materials.darkMetal, 1.0, 0, dz));
  cradle.add(kit.box(0.06, 1.0, 2.4, kit.materials.darkMetal, 0.06, -1.07, 0));

  // The crate on it.
  const crate = new THREE.Group();
  crate.position.set(out, 0, z);
  group.add(crate);
  const wood = own(owned, new THREE.MeshStandardMaterial({ color: 0x4b5232, roughness: 0.8, metalness: 0.2 }));
  const body = kit.box(1.2, 0.85, 0.95, wood, 0, 0, 0);
  crate.add(body);
  const strap = own(owned, new THREE.MeshBasicMaterial({ color: toolColour("gravity", 2.2), toneMapped: false }));
  for (const dz of [-0.28, 0.28]) crate.add(kit.box(1.24, 0.88, 0.07, strap, 0, 0, dz));
  const sprite = toolSprite("gravity", 1.3);
  sprite.position.set(0, 2.0, 0);
  crate.add(sprite);
  const marks = [sprite];
  // The ledge in front of it, striped in indigo.
  const line = floorStripes("gravity", 0.9, 4.2);
  line.position.set(-edge + 0.95, 0.03, z);
  group.add(line);
  marks.push(line);

  // What a sphere hits (and the reticle warms to).
  const target = new THREE.Mesh(kit.geometries.unitBox, kit.materials.collider);
  target.scale.set(1.6, 1.4, 1.4);
  target.position.set(out, 0.7, z);
  target.name = "StrandedTarget";
  target.userData = { kind: "stranded", problem: "stranded", breakable: true, alive: true, node: group };
  group.add(target);

  const state = { pull: null };
  group.userData.dispose = () => {
    for (const m of owned) m.dispose?.();
    for (const m of marks) disposeMark(m);
  };
  group.userData.problem = { key: "stranded", crate, target, marks, state, owned, home: new THREE.Vector3(out, 0, z), landing: new THREE.Vector3(-edge + 3.2, 0, z) };
  return group;
}

/* ------------------------------------------------------------------ */
/* The game's side: what each tool does to them                         */
/* ------------------------------------------------------------------ */

export class ProblemPlay {
  /** @param {import("./game.js").MeltdownGame} game */
  constructor(game) {
    this.game = game;
  }

  get log() {
    return this.game.problems;
  }

  /** The Labs' problems, or the Roof's. */
  get list() {
    return this.game.roof ? this.game.roof.problems ?? [] : this.game.level?.problemSet?.list ?? [];
  }

  /** The used sphere's name for the wrong-tool line. */
  _used(ball) {
    return ball.charged ? "charge" : ball.kind ?? "glass";
  }

  /**
   * A sphere straight on to a problem's target (_onBallBreakable's answer:
   * "through" = keep flying).
   */
  hit(object, point, ball) {
    const p = object.userData.problemRef;
    if (!p || p.solved) return ball.kind === "glass" && !ball.charged ? "through" : true;
    const g = this.game;
    if (p.key === "firewall") {
      if (ball.kind === "cryo") {
        this._extinguish(p, point);
        return true;
      }
      // Into the flames and gone: a hiss and a puff.
      g.debris.dust(point, { size: 1.6, life: 0.7, color: 0x9a9690 });
      g.debris.sparks(point, { count: 10, speed: 3 });
      g.sfx?.surfaceRicochet();
      this.log.wrong("firewall", this._used(ball));
      return ball.kind === "glass" && !ball.charged ? "through" : true;
    }
    if (p.key === "shutter") {
      // A charged one bursts on it (game.js _overcharge, then splash()).
      if (ball.charged) return true;
      this._dent(p, point, DENT[ball.kind] ?? DENT.glass);
      this.log.wrong("shutter", this._used(ball));
      return true;
    }
    if (p.key === "stranded") {
      // Steel and out of reach: it clangs.
      if (ball.kind === "gravity") return true;
      g.debris.sparks(point, { count: 12, speed: 4 });
      g.audio.clang();
      this.log.wrong("stranded", this._used(ball));
      return true;
    }
    return true;
  }

  /**
   * A sphere bursting at `point` (`radius` its reach; `charged` its charge,
   * 0 none): what it does to every problem in reach.
   */
  splash(point, kind, radius, charged = 0) {
    for (const p of this.list) {
      if (p.solved || !p.target) continue;
      _box.setFromObject(p.target);
      if (_box.distanceToPoint(point) > radius) continue;
      if (p.key === "firewall") {
        if (kind === "cryo") this._extinguish(p, point);
        else if (kind !== "gravity") this.log.wrong("firewall", charged && kind === "glass" ? "charge" : kind);
      } else if (p.key === "shutter") {
        if (charged >= FULL_CHARGE) this._blast(p, point, true);
        else if (charged) {
          this._dent(p, point, charged * 0.6);
          if (!p.solved) this.log.wrong("shutter", "charge");
        } else if (kind !== "gravity") this._dent(p, point, (DENT[kind] ?? 0.1) * 0.8);
      } else if (p.key === "stranded" && kind === "gravity") {
        this._pullIn(p);
      }
    }
  }

  /**
   * A gravity well opening on the roof: the stranded crate if it's close,
   * and patients dragged over an open ledge.
   */
  well(point, radius) {
    this.splash(point, "gravity", radius);
  }

  /** Put a fire wall out: the flames die back in a wave out from `point`. */
  _extinguish(p, point) {
    const g = this.game;
    p.solved = true;
    p.collider.userData.disabled = true;
    p.target.userData.alive = false;
    this._removeTarget(p);
    const local = p.group.worldToLocal(_v.copy(point));
    for (const s of p.spots) {
      s.delay = Math.abs(s.x - local.x) / 11;
      s.dying = true;
      // Steam and frost as each one goes.
      const at = s.flame.getWorldPosition(new THREE.Vector3()).setY(1.6);
      g._after(s.delay, () => {
        g.debris.dust(at, { size: 3.4, life: 1.8, color: 0xdcecf2 });
        g._chunks(at, 8, { tint: 0xbff4ff, speed: 3, radius: 0.6, size: 0.07 });
      });
    }
    for (const m of p.marks) fadeMark(m, 0);
    g.sfx?.sprinklerBurst();
    g.audio.whoosh?.();
    g.trauma = Math.min(1, g.trauma + 0.2);
    this._solved(p);
  }

  /** A dent in the shutter: the meter fills; full, it gives (no bonus). */
  _dent(p, point, amount) {
    const g = this.game;
    const s = p.state;
    s.dent = Math.min(1, s.dent + amount);
    s.heat = 1;
    s.shake = 1;
    g.debris.sparks(point, { count: 16, speed: 5 });
    g.audio.clang();
    g.sfx?.impact(0.4);
    if (s.dent >= 1) this._blast(p, point, false);
  }

  /** The shutter blown out (`clever`: by a full charged shot - the bonus). */
  _blast(p, point, clever) {
    const g = this.game;
    if (p.solved) return;
    p.solved = true;
    p.state.dent = 1;
    p.state.blast = { t: 0, velocity: new THREE.Vector3(0, 4.5, -11) };
    p.collider.userData.disabled = true;
    p.target.userData.alive = false;
    this._removeTarget(p);
    const at = _w.copy(point);
    g.debris.sparks(at, { count: 70, speed: 10 });
    g.debris.burst(at, { kind: "concrete", count: 30, speed: 7, size: 0.2 });
    g.debris.dust(at, { size: 5, life: 1.6, color: 0x6a625a });
    g.sfx?.explosion?.(0.8);
    g.audio.crash?.();
    g.trauma = Math.min(1, g.trauma + 0.55);
    g.hitFlash = Math.max(g.hitFlash, 0.2);
    for (const m of p.marks) fadeMark(m, 0);
    if (clever) this._solved(p);
    else g.hud.toast("SHUTTER GIVES", "BATTERED OPEN", "", 1600);
  }

  /** The stranded crate dragged in over the ledge. */
  _pullIn(p) {
    const g = this.game;
    p.solved = true;
    p.target.userData.alive = false;
    this._removeTarget(p);
    p.state.pull = { t: 0, from: p.crate.position.clone() };
    g.audio.whoosh?.();
    this._solved(p);
  }

  _removeTarget(p) {
    const list = this.game.roof ? this.game.roof.breakables : this.game.level?.breakables;
    const i = list?.indexOf(p.target) ?? -1;
    if (i >= 0) list.splice(i, 1);
  }

  _solved(p) {
    const g = this.game;
    this.log.solve(p.key);
    // The right tool's cost back (problems.js `refund`).
    const refund = PROBLEMS[p.key]?.refund ?? 0;
    if (refund) g.runner.balls = Math.max(g.runner.balls, Math.min(MAX_BALLS, g.runner.balls + refund));
    g.sfx?.serumCollected?.();
    g.runner.solved = (g.runner.solved ?? 0) + 1;
  }

  /* ---- Each frame ------------------------------------------------- */

  /** The Labs: sightings, the body against a fire wall or the shutter. */
  update(dt, playing) {
    const g = this.game;
    const r = g.runner;
    if (!playing || !g.level) return;
    const lead = LEAD[g.difficulty?.key] ?? LEAD.normal;
    for (const p of this.list) {
      const gap = p.distance - r.distance;
      if (!p.solved && gap > 0 && gap < lead) this.log.sighted(p.key, { lead: gap });
      // The body: only through the solid one (the level's own collide()).
      // (Not a test's or a demo's teleport, with its long invulnerability.)
      if (p.solved || p.contact || Math.abs(gap) > 3 || r.invulnerable > 5) continue;
      p.collider.updateWorldMatrix(true, false);
      p.collider.geometry.boundingBox ?? p.collider.geometry.computeBoundingBox();
      _box.copy(p.collider.geometry.boundingBox).applyMatrix4(p.collider.matrixWorld);
      if (!_box.intersectsBox(g.playerBox)) continue;
      p.contact = true;
      if (p.key === "firewall") this._burn(p);
      else if (p.key === "shutter") this._shoulder(p);
    }
  }

  /** Ran into a fire wall: the hit (game.js) and a heavy burn on top - unless fireproof. */
  _burn(p) {
    const g = this.game;
    const r = g.runner;
    if (g.arsenal.isActive("thermal")) {
      g.hud.toast("THERMAL AEGIS", "THROUGH THE FIRE", "power", 1500);
      return;
    }
    const burn = 12 * (g.difficulty?.damage ?? 1);
    r.vitality = Math.max(0, r.vitality - burn);
    r.slow = Math.max(r.slow, 0.9);
    g.hitFlash = 1;
    g.hud.flashDamage?.();
    g.hud.toast("BURNED", `-${Math.round(burn)} // FREEZE IT NEXT TIME`, "warn", 1800);
    g.sfx?.hurt?.();
    g.playerBox.getCenter(_v);
    g.debris.sparks(_v, { count: 30, speed: 4 });
    if (r.vitality <= 0 && r.alive) {
      r.alive = false;
      g._caughtByFire();
    }
  }

  /** Ran into the shutter: you shoulder it through its frame, hurt (no bonus). */
  _shoulder(p) {
    const g = this.game;
    const r = g.runner;
    const cost = 10 * (g.difficulty?.damage ?? 1);
    r.vitality = Math.max(0, r.vitality - cost);
    r.slow = Math.max(r.slow, 0.7);
    g.playerBox.getCenter(_v);
    p.solved = true;
    p.state.blast = { t: 0, velocity: new THREE.Vector3(0, 2, -6) };
    p.collider.userData.disabled = true;
    p.target.userData.alive = false;
    this._removeTarget(p);
    for (const m of p.marks) fadeMark(m, 0);
    g.debris.sparks(_v, { count: 40, speed: 6 });
    g.audio.crash?.();
    g.hud.toast("SHOULDERED THROUGH", `-${Math.round(cost)} // A CHARGED SHOT BLASTS IT`, "warn", 2000);
    if (r.vitality <= 0 && r.alive) {
      r.alive = false;
      g._caughtByFire();
    }
  }

  /**
   * The Labs' HUD line for the nearest problem ahead in range (the first
   * sighting also gets the shared hint), or null.
   */
  prompt() {
    const g = this.game;
    const r = g.runner;
    const lead = LEAD[g.difficulty?.key] ?? LEAD.normal;
    let best = null;
    for (const p of this.list) {
      const gap = p.distance - r.distance;
      if (p.solved || gap < 1 || gap > lead) continue;
      if (!best || gap < best.gap) best = { p, gap };
    }
    if (!best) return null;
    const m = Math.round(best.gap);
    return best.p.key === "firewall" ? `FIRE WALL ${m} M - FREEZE IT: CRYO (Q/E)` : `JAMMED SHUTTER ${m} M - HOLD CLICK: CHARGED SHOT`;
  }

  /** The Roof: sightings, the crate's flight in, what it brought. */
  updateRoof(dt, playing) {
    const g = this.game;
    const roof = g.roof;
    if (!roof) return;
    for (const p of this.list) {
      if (p.key !== "stranded") continue;
      if (playing && !p.solved && g.hero && g.hero.position.distanceTo(p.home) < 15) this.log.sighted("stranded");
      const pull = p.state.pull;
      if (!pull || pull.done) continue;
      // Dragged in on an arc over the ledge, and down on the roof.
      pull.t += dt;
      const k = Math.min(1, pull.t / 0.8);
      p.crate.position.lerpVectors(pull.from, p.landing, k);
      p.crate.position.y = Math.sin(k * Math.PI) * 1.8;
      p.crate.rotation.y += dt * 6 * (1 - k);
      if (k >= 1) {
        pull.done = true;
        p.crate.getWorldPosition(_v);
        g.debris.burst(_v.clone().setY(0.6), { kind: "sack", count: 24, speed: 4 });
        g.debris.dust(_v.clone().setY(0.4), { size: 2.5, life: 1, color: 0x6f665e });
        g.audio.thud?.();
        p.crate.visible = false;
        roof.addSupplies?.(_v.clone().setY(0));
      }
    }
  }

  /**
   * A gravity well opened close to an open ledge (x = +/-edge, the middle of
   * the side: the corners are walled) pulls toward a point out past it, not
   * its own centre: what it catches is dragged over. That point, or null.
   */
  ledgeGoal(point, edge) {
    if (!this.game.roof || Math.abs(point.x) < edge - 4.5 || Math.abs(point.z) > edge - 2.6) return null;
    return new THREE.Vector3(Math.sign(point.x) * (edge + 2), 0, point.z);
  }

  /** One of them dragged over the ledge by a well: falls, and counts (a clever kill). */
  sendOver(enemy) {
    const roof = this.game.roof;
    if (!roof || !enemy.alive) return;
    const side = Math.sign(enemy.position.x);
    enemy.velocity.set(side * 5, 2.2, 0);
    enemy.die("fall");
    roof.events.emit("enemy-fall", { enemy, position: enemy.position.clone(), well: true });
    this.log.solve("ledge");
  }
}
