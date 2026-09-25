/**
 * Level 3 - The Meltdown (Phase A: the escape).
 *
 * "You regain consciousness mid-collapse: sirens, smoke alarms, and a building
 *  already coming apart. The staff are torching the evidence. A failed
 *  experiment - a ball launcher - is the only tool at hand. Get to the roof."
 *  See docs/level-3-meltdown.md.
 *
 * Layout: three beats joined by two 90-degree turns, each beat containing two
 * large halls with their own identity. Corridors between halls are where the
 * obstacle patterns come thick and fast.
 *
 *   BEAT A  RECOVERY WARD         ward hall -> research lab        (tier 1)
 *   TURN left
 *   BEAT B  CONTAINMENT CORRIDOR  containment block -> the experiment (tier 2)
 *   TURN right
 *   BEAT C  STAIRWELL ASCENT      records archive -> boiler hall    (tier 3)
 *
 * The level owns: environment, hazards and their collision, breakables, the
 * hidden phase timer (only ever shown on evac signs), the chasing fire front's
 * *placement*, and events. The host owns the player: vitality, balls, the
 * launcher, and where the fire front should be (it is driven by vitality).
 *
 * Scene hierarchy:
 *
 *   MeltdownRoot
 *   |-- Shell          instanced corridor shell, halls, wall openings, dressing
 *   |-- Hazards        every obstacle (visible parts + invisible colliders)
 *   |-- Pickups        ball sacks and power-up vials
 *   |-- Signage        evac signs and alarm beacons
 *   |-- FireFront      the wall of fire chasing the player
 *   |-- Ambience       hemisphere + key light, reddens as danger rises
 *   `-- PooledLighting fixed pool of dynamic lights (reused from Level 2)
 */

import * as THREE from "../../three.js";
import { createMeltdownKit } from "./kit.js";
import { createRoute, straightSegments } from "../foundry/route.js";
import { LightPool, createMeltdownAmbience } from "./lighting.js";
import { createFireMaterials, createFire } from "./fire.js";
import { buildHall } from "./halls.js";
import { loadMeltdownAssets, fillAssetSlots } from "./assets.js";

const TURN_RADIUS = 9;
const QUARTER = Math.PI / 2;
const ARC = TURN_RADIUS * QUARTER;

export const CORRIDOR_HALF = 7;
export const CORRIDOR_HEIGHT = 8.4;
export const LANES = [-3.2, 0, 3.2];

export const BEAT_LENGTHS = { ward: 240, corridor: 280, stairwell: 240 };

/** `drain` is passive vitality loss per second; `tier` sets obstacle difficulty. */
// Drain is budgeted against a clean run (~38 s / 21 s / 17 s per beat at the
// preview's speed zones): ~39 vitality lost to the fire over a perfect run,
// leaving room for about three hits (20 each) before the fourth is fatal.
export const BEATS = [
  { key: "ward", name: "RECOVERY WARD", start: 0, end: BEAT_LENGTHS.ward, drain: 0.35, tier: 1, wall: "wardWall" },
  {
    key: "corridor", name: "CONTAINMENT CORRIDOR", drain: 0.55, tier: 2, wall: "steelWall",
    start: BEAT_LENGTHS.ward + ARC,
    end: BEAT_LENGTHS.ward + ARC + BEAT_LENGTHS.corridor,
  },
  {
    key: "stairwell", name: "STAIRWELL ASCENT", drain: 0.8, tier: 3, wall: "concreteWall",
    start: BEAT_LENGTHS.ward + BEAT_LENGTHS.corridor + ARC * 2,
    end: BEAT_LENGTHS.ward + BEAT_LENGTHS.corridor + BEAT_LENGTHS.stairwell + ARC * 2,
  },
];

const TOTAL_LENGTH = BEATS[BEATS.length - 1].end;

/** Two halls per beat, positioned as a fraction of that beat. */
const HALLS = [
  { beat: "ward", at: 0.34, theme: "ward" },
  { beat: "ward", at: 0.78, theme: "lab" },
  { beat: "corridor", at: 0.24, theme: "containment" },
  { beat: "corridor", at: 0.66, theme: "experiment", halfWidth: 18 },
  { beat: "stairwell", at: 0.3, theme: "archive" },
  { beat: "stairwell", at: 0.74, theme: "boiler" },
];
const HALL_LENGTH = 44;

/** Trigger distance and fall time for pieces that drop/topple as you near them. */
const FALLING = {
  chunk: { range: 17, duration: 0.85 },
  duct: { range: 17, duration: 0.85 },
  shelf: { range: 24, duration: 1.05 },
};
const WARP_DURATION = 9;

function createEmitter() {
  const handlers = new Map();
  return {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name)?.delete(fn);
    },
    emit(name, payload) {
      for (const fn of handlers.get(name) ?? []) fn(payload);
    },
    clear() {
      handlers.clear();
    },
  };
}

export class MeltdownLevel {
  /**
   * @param {object} options
   * @param {THREE.Vector3} [options.origin]
   * @param {number} [options.heading]
   * @param {boolean} [options.shadows]
   * @param {boolean} [options.straightRoute] skip the turns (for a -Z-only controller)
   * @param {number} [options.phaseSeconds]   the hidden countdown for the whole phase
   * @param {number} [options.brightness]
   */
  constructor({
    origin = new THREE.Vector3(0, 0, 0),
    heading = 0,
    shadows = false,
    straightRoute = false,
    // ~1.3x a clean run (~77 s of running + a few seconds per duct), so the
    // clock is a real threat rather than decoration.
    phaseSeconds = 105,
    brightness = 1.5,
  } = {}) {
    this.options = { halfWidth: CORRIDOR_HALF, lanes: LANES, shadows, brightness, straightRoute };
    this.events = createEmitter();

    this.root = new THREE.Group();
    this.root.name = "MeltdownRoot";
    this.groups = {
      shell: new THREE.Group(),
      hazards: new THREE.Group(),
      pickups: new THREE.Group(),
      signage: new THREE.Group(),
    };
    for (const [name, group] of Object.entries(this.groups)) {
      group.name = name[0].toUpperCase() + name.slice(1);
      this.root.add(group);
    }

    const segments = straightRoute
      ? straightSegments(TOTAL_LENGTH)
      : [
          { type: "straight", length: BEAT_LENGTHS.ward },
          { type: "arc", radius: TURN_RADIUS, angle: QUARTER },
          { type: "straight", length: BEAT_LENGTHS.corridor },
          { type: "arc", radius: TURN_RADIUS, angle: -QUARTER },
          { type: "straight", length: BEAT_LENGTHS.stairwell },
        ];
    this.route = createRoute(segments, { origin, heading });

    this.fire = createFireMaterials();
    this.kit = createMeltdownKit({ shadows, fire: this.fire });

    this.ambience = createMeltdownAmbience({ brightness });
    this.root.add(this.ambience);
    this.lights = new LightPool({ points: 9, spots: 1, shadows, brightness });
    this.root.add(this.lights.group);

    /** Meshes a projectile can hit: sacks, power-ups, glass panes. */
    this.breakables = [];
    /** Invisible collider boxes that hurt the player. */
    this.obstacles = [];

    this._animated = [];
    this._culled = [];
    this._hazardIndex = [];
    this._pendingEmitters = [];
    this._fallingHazards = [];
    this._pushables = [];
    this._signs = [];
    this._setPieces = [];

    this.state = {
      beatIndex: -1,
      hallIndex: -1,
      timeRemaining: phaseSeconds,
      timeTotal: phaseSeconds,
      timerFailed: false,
      complete: false,
      alarm: 0,
      warp: { active: false, elapsed: 0, fired: false },
    };

    this._planHalls();
    this._planOpenings();

    this._buildShell();
    this._buildHalls();
    this._buildOpenings();
    this._buildJunctions();
    this._buildBeatWard();
    this._buildBeatCorridor();
    this._buildBeatStairwell();
    this._buildPatterns();
    this._buildCorridorDressing();
    this._buildSigns();
    this._buildFireFront();
    this._registerEmitters();

    this._playerWorld = new THREE.Vector3();
    this._grazeBox = new THREE.Box3();
    this._landPos = new THREE.Vector3();
  }

  /* ================================================================ */
  /* Planning                                                          */
  /* ================================================================ */

  _planHalls() {
    this.halls = HALLS.map((h, i) => {
      const beat = BEATS.find((b) => b.key === h.beat);
      const centre = beat.start + BEAT_LENGTHS[h.beat] * h.at;
      return {
        index: i,
        theme: h.theme,
        halfWidth: h.halfWidth ?? 16,
        centre,
        start: centre - HALL_LENGTH / 2,
        end: centre + HALL_LENGTH / 2,
      };
    });
    const experiment = this.halls.find((h) => h.theme === "experiment");
    this._warpTrigger = experiment ? experiment.centre - 2 : TOTAL_LENGTH * 0.5;
  }

  hallAt(distance) {
    return this.halls.find((h) => distance >= h.start && distance <= h.end) ?? null;
  }

  /** Half-width of the space at a route distance: a hall's, or the corridor's. */
  widthAt(distance) {
    return this.hallAt(distance)?.halfWidth ?? CORRIDOR_HALF;
  }

  _isArc(distance) {
    return this.route.nodeAt(distance + 0.01).node.type === "arc";
  }

  _nearHall(distance, margin = 6) {
    return this.halls.some((h) => distance > h.start - margin && distance < h.end + margin);
  }

  /**
   * Which corridor wall stations get an opening (window, doorway, breach)
   * instead of a solid panel. Planned up front because the shell has to
   * leave a hole where the opening goes.
   */
  _planOpenings() {
    this._openings = [];
    const random = this._rng(9127);
    let index = 0;
    let side = 1;
    for (let d = 4; d < TOTAL_LENGTH; d += 8, index += 1) {
      if (this._isArc(d - 5) || this._isArc(d + 5) || this._nearHall(d)) continue;
      if (index % 3 !== 1) continue;
      const beat = this.beatAt(d);
      const roll = random();
      let type;
      if (beat.key === "ward") type = roll < 0.45 ? "window" : roll < 0.8 ? "door-ajar" : "door";
      else if (beat.key === "corridor") type = roll < 0.4 ? "window-fire" : roll < 0.7 ? "window" : "door-fire";
      else type = roll < 0.5 ? "breach" : roll < 0.8 ? "door-fire" : "window-fire";
      // `distance` is provisional: _buildShell snaps it to the centre of the
      // wall station that actually gets the hole, so piece and hole line up.
      this._openings.push({ side, type, distance: d, claimed: false });
      side *= -1;
    }
  }

  /* ================================================================ */
  /* Building                                                          */
  /* ================================================================ */

  _add(group, piece, distance, lateral = 0, height = 0) {
    this.route.place(piece, distance, lateral, height);
    group.add(piece);
    piece.userData.routeDistance = distance;
    if (typeof piece.userData.tick === "function") this._animated.push({ piece, distance });
    this._culled.push({ piece, distance });
    // Pieces nest (a breach holds a fire, a hall holds dozens of lamps), so
    // every light emitter anywhere inside is registered, not just the root's.
    piece.traverse((o) => {
      if (o.userData.emitter) this._pendingEmitters.push({ emitter: o.userData.emitter, distance });
    });
    return piece;
  }

  _indexHazard(mesh, distance) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    this._hazardIndex.push({ mesh, distance, box: new THREE.Box3() });
  }

  _hazard(piece, distance, lateral = 0) {
    this._add(this.groups.hazards, piece, distance, lateral);
    const meshes = piece.userData.hazardMeshes ?? (piece.userData.hazardMesh ? [piece.userData.hazardMesh] : []);
    for (const m of meshes) {
      this.obstacles.push(m);
      this._indexHazard(m, distance);
    }
    for (const b of piece.userData.breakableMeshes ?? []) {
      b.userData.routeDistance = distance;
      this.breakables.push(b);
    }
    return piece;
  }

  /** A piece that falls or topples once the player is close. */
  _falling(piece, distance, lateral, kind) {
    this._hazard(piece, distance, lateral);
    this._fallingHazards.push({ distance, group: piece, triggered: false, landed: false, elapsed: 0, kind });
    if (kind === "duct") this._pushables.push({ distance, group: piece });
    return piece;
  }

  _pickup(piece, distance, lateral, height = 0) {
    this._add(this.groups.pickups, piece, distance, lateral, height);
    const glass = piece.userData.glass;
    if (glass) {
      glass.userData.routeDistance = distance;
      this.breakables.push(glass);
    }
    return piece;
  }

  _rng(seed) {
    let value = seed;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  /**
   * The corridor shell, instanced. Per-beat wall finishes (clinical tile,
   * steel containment panels, concrete) come from splitting each wall spec by
   * beat. Stations inside a hall are skipped - the hall is its own room.
   * Stations with a planned opening get two short wall panels and a lintel
   * instead of one solid panel, leaving a real hole in the wall.
   */
  _buildShell() {
    const { straightRoute } = this.options;
    const { geometries: geo, materials: mat } = this.kit;
    const total = this.route.totalLength;
    const hw = CORRIDOR_HALF;
    const H = CORRIDOR_HEIGHT;

    const stations = [];
    let distance = 0;
    let index = 0;
    while (distance < total) {
      const { node } = this.route.nodeAt(distance + 0.01);
      const isArc = !straightRoute && node.type === "arc";
      const step = isArc ? 3.6 : 8;
      const centre = Math.min(distance + step / 2, total);
      let widen = 1;
      if (isArc) {
        const fraction = (centre - node.startDistance) / node.length;
        widen = 1 + 0.55 * Math.sin(THREE.MathUtils.clamp(fraction, 0, 1) * Math.PI);
      }
      const hall = this.hallAt(centre);
      let opening = null;
      if (!isArc) {
        opening = this._openings.find((o) => !o.claimed && Math.abs(o.distance - centre) < 4) ?? null;
        if (opening) {
          opening.claimed = true;
          opening.distance = centre;
        }
      }
      stations.push({
        distance: centre,
        scaleZ: (step / 8) * (isArc ? 1.18 : 1.02),
        widen,
        opening,
        isArc,
        inHall: Boolean(hall && centre > hall.start + 1 && centre < hall.end - 1),
        wall: (this.beatAt(centre) ?? BEATS[0]).wall,
      });
      distance += step;
      index += 1;
    }

    // [key, geometry, material, [x,y,z], {rot, scale, edge, span, every, wallSide, onlyWall}]
    const specs = [
      { key: "floor", geometry: geo.floorPlate, material: mat.floor, offset: [0, -0.16, 0], scale: [hw * 2, 1, 1], span: true, shadow: "receive" },
      { key: "ceiling", geometry: geo.floorPlate, material: mat.trim, offset: [0, H + 0.15, 0], scale: [hw * 2, 1, 1], span: true },
      { key: "kerbL", geometry: geo.kerb, material: mat.trim, offset: [-(hw - 0.25), 0.2, 0], edge: true },
      { key: "kerbR", geometry: geo.kerb, material: mat.trim, offset: [hw - 0.25, 0.2, 0], edge: true },
      { key: "beam", geometry: geo.beam, material: mat.darkMetal, offset: [0, H - 0.3, 0], scale: [hw * 2, 1, 1], every: 2, span: true },
      { key: "pipeL1", geometry: geo.pipe, material: mat.ductMetal, offset: [-(hw - 0.5), H - 1.6, 0], rot: [Math.PI / 2, 0, 0], edge: true },
      { key: "pipeL2", geometry: geo.pipe, material: mat.paintedMetal, offset: [-(hw - 0.45), H - 2.2, 0], rot: [Math.PI / 2, 0, 0], scale: [0.7, 1, 0.7], edge: true },
      { key: "pipeR1", geometry: geo.pipe, material: mat.ductMetal, offset: [hw - 0.5, H - 1.6, 0], rot: [Math.PI / 2, 0, 0], edge: true },
      { key: "trayR", geometry: geo.kerb, material: mat.darkMetal, offset: [hw - 0.6, H - 0.9, 0], scale: [1.4, 0.4, 1], edge: true },
      { key: "conduit", geometry: geo.conduit, material: mat.trim, offset: [1.4, H - 0.15, 0], rot: [Math.PI / 2, 0, 0] },
      { key: "lightTube", geometry: geo.ceilingPanel, material: mat.lightTube, offset: [0, H - 0.05, 0], scale: [0.35, 1, 1.4], every: 2 },
      { key: "laneLineL", geometry: geo.kerb, material: mat.hazard, offset: [-5, 0.005, 0], scale: [0.3, 0.03, 1] },
      { key: "laneLineR", geometry: geo.kerb, material: mat.hazard, offset: [5, 0.005, 0], scale: [0.3, 0.03, 1] },
    ];
    for (const side of [-1, 1]) {
      specs.push({ key: `pilaster${side}`, geometry: geo.pilaster, material: mat.darkMetal, offset: [side * (hw - 0.25), H / 2, -4], scale: [1, H, 1], edge: true });
    }

    const stationMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    const addInstanced = (name, geometry, material, matrices, receiveOnly) => {
      if (!matrices.length) return;
      const instanced = new THREE.InstancedMesh(geometry, material, matrices.length);
      instanced.name = `Shell_${name}`;
      instanced.castShadow = this.options.shadows && !receiveOnly;
      instanced.receiveShadow = this.options.shadows;
      for (const [i, m] of matrices.entries()) instanced.setMatrixAt(i, m);
      instanced.instanceMatrix.needsUpdate = true;
      instanced.frustumCulled = false;
      this.groups.shell.add(instanced);
    };

    const stationTransform = (station) => {
      const sample = this.route.sample(station.distance);
      quaternion.setFromEuler(euler.set(0, sample.heading, 0));
      return stationMatrix.clone().compose(sample.position, quaternion, scale.set(1, 1, station.scaleZ));
    };

    const local = (ox, oy, oz, rot = [0, 0, 0], s = [1, 1, 1]) => {
      quaternion.setFromEuler(euler.set(...rot));
      return localMatrix.clone().compose(position.set(ox, oy, oz), quaternion, scale.set(...s));
    };

    for (const spec of specs) {
      const matrices = [];
      for (const [i, station] of stations.entries()) {
        if (station.inHall) continue;
        if (spec.every && i % spec.every !== 0) continue;
        const [ox0, oy, oz] = spec.offset;
        const [sx0, sy, sz] = spec.scale ?? [1, 1, 1];
        const ox = spec.edge ? ox0 * station.widen : ox0;
        const sx = spec.span ? sx0 * station.widen : sx0;
        matrices.push(stationTransform(station).multiply(local(ox, oy, oz, spec.rot, [sx, sy, sz])));
      }
      addInstanced(spec.key, spec.geometry, spec.material, matrices, spec.shadow === "receive");
    }

    // Walls: one instanced set per beat finish, with holes at openings.
    const wallSets = new Map();
    for (const station of stations) {
      if (station.inHall) continue;
      const opening = station.opening;
      if (!wallSets.has(station.wall)) wallSets.set(station.wall, []);
      const list = wallSets.get(station.wall);
      const t = stationTransform(station);
      for (const side of [-1, 1]) {
        const x = side * hw * station.widen;
        if (opening && opening.side === side && !station.isArc) {
          // Two 2.2 m panels either side of a 3.6 m hole, and a lintel.
          for (const z of [-2.9, 2.9]) list.push(t.clone().multiply(local(x, H / 2, z, [0, 0, 0], [1, H, 2.2 / 8])));
          list.push(t.clone().multiply(local(x, H - (H - 3.9) / 2, 0, [0, 0, 0], [1, H - 3.9, 3.6 / 8])));
        } else {
          list.push(t.clone().multiply(local(x, H / 2, 0, [0, 0, 0], [1, H, 1])));
        }
      }
    }
    for (const [wall, matrices] of wallSets) addInstanced(`wall_${wall}`, geo.wallPanel, mat[wall], matrices);

    // Ceiling lights feed the light pool every third station.
    for (const [i, station] of stations.entries()) {
      if (station.inHall || i % 3 !== 0) continue;
      const anchor = new THREE.Object3D();
      this.route.place(anchor, station.distance, 0, H - 0.6);
      this.groups.shell.add(anchor);
      const flicker = i % 4 === 0;
      this._pendingEmitters.push({
        emitter: {
          kind: "point", anchor, color: 0xffd0a0, base: 8, distance: 15,
          intensityAt: (t) => (flicker && Math.sin(t * 11 + i) > 0.8 ? 1 : 7),
        },
        distance: station.distance,
      });
    }
  }

  _buildHalls() {
    for (const hall of this.halls) {
      const group = buildHall(this.kit, {
        theme: hall.theme,
        length: HALL_LENGTH,
        halfWidth: hall.halfWidth,
        corridorHalf: CORRIDOR_HALF,
        corridorHeight: CORRIDOR_HEIGHT,
        seed: hall.index * 31 + 7,
      });
      hall.name = group.userData.hallName;
      this._add(this.groups.shell, group, hall.centre, 0);
    }
  }

  _buildOpenings() {
    const hw = CORRIDOR_HALF;
    for (const opening of this._openings) {
      if (!opening.claimed) continue;
      const { side, type, distance } = opening;
      let piece;
      if (type === "window") piece = this.kit.observationWindow({ side });
      else if (type === "window-fire") piece = this.kit.observationWindow({ side, fireBehind: true });
      else if (type === "door") piece = this.kit.doorway({ side, state: "shut" });
      else if (type === "door-ajar") piece = this.kit.doorway({ side, state: "ajar" });
      else if (type === "door-fire") piece = this.kit.doorway({ side, state: "fire" });
      else piece = this.kit.wallBreach({ side });
      this._add(this.groups.shell, piece, distance, side * hw);
    }
  }

  _buildJunctions() {
    for (const junction of this.route.junctions) {
      const outside = junction.direction === "left" ? 1 : -1;
      const span = junction.endDistance - junction.startDistance;
      this._add(this.groups.signage, this.kit.alarmBeacon({ x: outside * 4.5, y: 6.2, speed: 4 }), junction.startDistance + span * 0.5);
      this._add(this.groups.shell, this.kit.fireSpot({ width: 2.5, depth: 2, height: 3 }), junction.startDistance + span * 0.3, outside * 8);
    }
  }

  /** Mark a hand-placed set piece so the pattern filler keeps clear of it. */
  _mark(distance) {
    this._setPieces.push(distance);
    return distance;
  }

  /**
   * BEAT A - RECOVERY WARD. Each mechanic taught once before patterns start
   * combining them: jump, a falling chunk, a sack, glass you must shoot, a
   * power-up, a floor gap, a duct you push open, a laser grid.
   */
  _buildBeatWard() {
    const L = BEAT_LENGTHS.ward;
    const at = (f) => this._mark(L * f);
    const hw = CORRIDOR_HALF;
    this._hazard(this.kit.barrier({ kind: "low" }), at(0.05), 0);
    this._falling(this.kit.ceilingChunk({ seed: 1 }), at(0.1), -3.2, "chunk");
    this._pickup(this.kit.sack({ hp: 1, spheres: 5 }), at(0.15), 3.2, 0.4);
    this._hazard(this.kit.glassPane({ lanes: LANES, hp: 1 }), at(0.2), 0);
    this._pickup(this.kit.powerup({ kind: "coolant" }), at(0.26), 0, 0);
    this._hazard(this.kit.floorGap({ mandatory: false }), at(0.46), 0);
    this._falling(this.kit.airDuct({ mode: "blocker", halfWidth: hw }), at(0.53), 0, "duct");
    this._hazard(this.kit.laserGrid({ mode: "low", span: hw * 2 - 1.6 }), at(0.6), 0);
    this._pickup(this.kit.sack({ hp: 1, spheres: 5 }), at(0.9), -3.2, 0.4);
  }

  /** BEAT B - CONTAINMENT CORRIDOR. Escalation; the experiment and the warp. */
  _buildBeatCorridor() {
    const base = BEATS[1].start;
    const L = BEAT_LENGTHS.corridor;
    const at = (f) => this._mark(base + L * f);
    const hw = CORRIDOR_HALF;
    this._falling(this.kit.ceilingChunk({ seed: 2 }), at(0.04), 3.2, "chunk");
    this._falling(this.kit.ceilingChunk({ seed: 3 }), at(0.09), -3.2, "chunk");
    this._crossing(at(0.42));
    this._pickup(this.kit.powerup({ kind: "adrenaline" }), at(0.47), -3.2, 0);
    this._falling(this.kit.airDuct({ mode: "blocker", halfWidth: hw }), at(0.52), 0, "duct");
    this._pickup(this.kit.sack({ hp: 2, spheres: 6 }), at(0.57), 3.2, 0.4);
    this._pickup(this.kit.powerup({ kind: "overcharge" }), at(0.8), 0, 0);
    this._hazard(this.kit.glassPane({ lanes: LANES, hp: 2 }), at(0.86), 0);
    this._falling(this.kit.ceilingChunk({ seed: 4 }), at(0.93), 0, "chunk");
  }

  /** BEAT C - STAIRWELL ASCENT. Everything at once; ends at the roof door. */
  _buildBeatStairwell() {
    const base = BEATS[2].start;
    const L = BEAT_LENGTHS.stairwell;
    const at = (f) => this._mark(base + L * f);
    const hw = CORRIDOR_HALF;
    this._falling(this.kit.ceilingChunk({ seed: 5 }), at(0.05), -3.2, "chunk");
    this._falling(this.kit.airDuct({ mode: "blocker", halfWidth: hw }), at(0.12), 0, "duct");
    this._hazard(this.kit.floorGap({ mandatory: false }), at(0.18), 3.2);
    this._crossing(at(0.48));
    this._pickup(this.kit.powerup({ kind: "barrier" }), at(0.53), 0, 0);
    this._falling(this.kit.ceilingChunk({ seed: 7 }), at(0.58), -3.2, "chunk");
    this._falling(this.kit.airDuct({ mode: "blocker", halfWidth: hw }), at(0.87), 0, "duct");
    this._pickup(this.kit.sack({ hp: 3, spheres: 7 }), at(0.91), 3.2, 0.4);
    // The roof-access door: reinforced glass, the last thing between you and air.
    this._hazard(this.kit.glassPane({ lanes: LANES, hp: 3 }), at(0.97), 0);
  }

  /** Fire below both outer lanes; a fallen duct bridges the centre. */
  _crossing(distance) {
    this._hazard(this.kit.floorGap({ mandatory: true }), distance, -3.2);
    this._hazard(this.kit.floorGap({ mandatory: true }), distance, 3.2);
    this._add(this.groups.hazards, this.kit.airDuct({ mode: "bridge" }), distance, 0);
  }

  /**
   * Obstacle patterns. A single hazard in one lane is trivially dodged by
   * standing in another, which is why the first version felt easy - so every
   * pattern here is a *decision*: it closes two lanes, or all three unless
   * you jump/slide/shoot/time it. Every one has at least one way through.
   */
  _buildPatterns() {
    const hw = CORRIDOR_HALF;
    const k = this.kit;
    const span = hw * 2 - 1.6;

    const lanesExcept = (open) => LANES.filter((l) => l !== open);
    const shuffle = (list, random) => list.map((v) => [random(), v]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

    const PATTERNS = {
      rubblePair: (d, r) => {
        const open = LANES[Math.floor(r() * 3)];
        for (const lane of lanesExcept(open)) this._hazard(k.rubbleWall({ burning: r() < 0.4 }), d, lane);
      },
      laserLow: (d) => this._hazard(k.laserGrid({ mode: "low", span }), d, 0),
      laserHigh: (d) => this._hazard(k.laserGrid({ mode: "high", span }), d, 0),
      laserSweep: (d, r) => this._hazard(k.laserGrid({ mode: "sweep", span, speed: 1.3 + r() * 0.8, phase: r() * 6 }), d, 0),
      concreteRow: (d, r) => {
        const rubbleLane = r() < 0.5 ? LANES[Math.floor(r() * 3)] : null;
        for (const lane of LANES) {
          if (lane === rubbleLane) this._hazard(k.rubbleWall({}), d, lane);
          else this._hazard(k.barrier({ kind: "low" }), d, lane);
        }
      },
      barrierMix: (d, r) => {
        const [a, b, c] = shuffle(LANES, r);
        this._hazard(k.barrier({ kind: "low" }), d, a);
        this._hazard(k.barrier({ kind: "high" }), d, b);
        this._hazard(k.rubbleWall({ burning: true }), d, c);
      },
      glassWall: (d, r, tier) => this._hazard(k.glassPane({ lanes: LANES, hp: tier }), d, 0),
      glassGate: (d, r, tier) => {
        const blocked = LANES[Math.floor(r() * 3)];
        this._hazard(k.glassPane({ lanes: lanesExcept(blocked), hp: tier }), d, 0);
        this._hazard(k.rubbleWall({ burning: r() < 0.5 }), d, blocked);
      },
      cylinder: (d, r) => this._hazard(k.rollingCylinder({ speed: 1.1 + r() * 0.7, phase: r() * 6 }), d, 0),
      cart: (d, r) => this._hazard(k.slidingCart({ speed: 0.9 + r() * 0.6, phase: r() * 6 }), d, 0),
      vents: (d, r, tier) => {
        if (tier >= 3) {
          // Two vents out of phase across all three lanes: read the rhythm.
          const [a, b, c] = shuffle(LANES, r);
          const period = 2.4;
          this._hazard(k.fireVent({ lanes: [a, b], period, phase: 0 }), d, 0);
          this._hazard(k.fireVent({ lanes: [c], period, phase: period / 2 }), d, 0);
        } else {
          const open = LANES[Math.floor(r() * 3)];
          this._hazard(k.fireVent({ lanes: lanesExcept(open), period: 2.6, phase: r() * 3 }), d, 0);
        }
      },
      shelf: (d, r) => {
        const side = r() < 0.5 ? -1 : 1;
        this._falling(k.topplingShelf({ side }), d, 0, "shelf");
      },
      pendulumRubble: (d, r) => {
        this._hazard(k.pendulum({ speed: 1 + r() * 0.6, phase: r() * 6, amplitude: 3.4 }), d, 0);
        this._hazard(k.rubbleWall({}), d + 3, r() < 0.5 ? -3.2 : 3.2);
      },
      fireGap: (d, r) => {
        const [a, b] = shuffle(LANES, r);
        this._hazard(k.floorGap({ mandatory: false }), d, a);
        this._hazard(k.rubbleWall({ burning: true }), d, b);
      },
      highAndGap: (d, r) => {
        const [a, b, c] = shuffle(LANES, r);
        this._hazard(k.barrier({ kind: "high" }), d, a);
        this._hazard(k.floorGap({ mandatory: false }), d, b);
        this._hazard(k.laserGrid({ mode: "high", span: 3.2 }), d, c);
      },
    };

    const TIERS = {
      1: ["rubblePair", "laserLow", "laserHigh", "concreteRow", "barrierMix", "glassWall", "cylinder", "rubblePair"],
      2: ["rubblePair", "laserSweep", "vents", "cart", "shelf", "pendulumRubble", "fireGap", "glassGate", "barrierMix", "cylinder", "laserHigh"],
      3: ["vents", "laserSweep", "shelf", "cart", "glassGate", "highAndGap", "fireGap", "pendulumRubble", "cylinder", "rubblePair", "glassWall"],
    };
    const SPACING = { 1: 17, 2: 13.5, 3: 11.5 };

    const clear = (d) => !this._setPieces.some((s) => Math.abs(s - d) < 9) && !this._isArc(d) && !this._isArc(d - 5) && !this._isArc(d + 5);

    for (const beat of BEATS) {
      const random = this._rng(4001 + beat.tier * 977);
      const names = TIERS[beat.tier];
      let last = null;
      let d = beat.start + 14;
      while (d < beat.end - 10) {
        if (clear(d)) {
          let name = names[Math.floor(random() * names.length)];
          if (name === last) name = names[(names.indexOf(name) + 1) % names.length];
          PATTERNS[name](d, random, beat.tier);
          last = name;
          // Tier 3 sometimes stacks a second pattern right behind the first.
          if (beat.tier === 3 && random() < 0.25 && clear(d + 6)) {
            PATTERNS.rubblePair(d + 6, random, beat.tier);
            d += 6;
          }
        }
        d += SPACING[beat.tier] * (0.85 + random() * 0.3);
      }
    }
  }

  /**
   * Corridor dressing: what's against the walls between halls. Kept outside
   * |x| = 5.2 so it never reads as an obstacle in a lane. Fire density rises
   * beat by beat - the building is burning faster the higher you get.
   */
  _buildCorridorDressing() {
    const hw = CORRIDOR_HALF;
    const k = this.kit;
    const random = this._rng(77123);
    const FIRE_EVERY = { ward: 34, corridor: 22, stairwell: 13 };
    const openingAt = (d) => this._openings.find((o) => o.claimed && Math.abs(o.distance - d) < 3.5);

    let side = 1;
    for (let d = 6; d < TOTAL_LENGTH - 4; d += 6.5 + random() * 3) {
      if (this._nearHall(d, 2) || this._isArc(d)) continue;
      side *= -1;
      const opening = openingAt(d);
      if (opening && opening.side === side) side *= -1;
      const beat = this.beatAt(d).key;
      const x = side * (hw - 0.9);
      const roll = random();

      if (roll < 0.14) this._add(this.groups.shell, k.utilityBoxUnit(), d, side * (hw - 0.45));
      else if (roll < 0.24) this._add(this.groups.shell, k.securityCam({ side }), d, side * (hw - 0.35), 5.6);
      else if (roll < 0.34) this._add(this.groups.shell, k.alarmBeacon({ x: 0, y: 5.2, phase: random() * 6 }), d, side * (hw - 0.4));
      else if (roll < 0.46) {
        const gurney = k.labGurney({ tipped: beat === "ward" ? 0 : 0.6 });
        this._add(this.groups.shell, gurney, d, side * (hw - 1.2));
      } else if (roll < 0.56) this._add(this.groups.shell, k.shelfUnit(), d, side * (hw - 0.6));
      else if (roll < 0.64) this._add(this.groups.shell, k.specimenTank({ seed: Math.round(d), broken: random() < 0.6 }), d, side * (hw - 1.3));
      else if (roll < 0.72) this._add(this.groups.shell, k.hangingCables({ seed: Math.round(d) }), d, side * 3);
      else if (roll < 0.8) this._add(this.groups.shell, k.brokenLight(), d, side * 2.5);
      else if (roll < 0.88) this._add(this.groups.shell, k.consolePanel({ side }), d, x);
      else this._add(this.groups.shell, k.smokeJet({ count: 10 }), d, side * 4, 3.5);
    }

    // Duct lines along the corridor ceiling - the supplied duct kit - in
    // runs of ~20 m, alternating sides, broken where the building has broken.
    let ductSide = -1;
    for (let d = 20; d < TOTAL_LENGTH - 20; d += 34 + random() * 16) {
      if (this._nearHall(d, 12) || this._isArc(d - 11) || this._isArc(d + 11)) continue;
      this._add(this.groups.shell, k.ductRun({ length: 20, w: 1.3, h: 1.0 }), d, ductSide * (hw - 1.8), CORRIDOR_HEIGHT - 1.3);
      ductSide *= -1;
    }

    // Wall-base fires, alternating sides, denser each beat.
    for (const beat of BEATS) {
      let s = 1;
      for (let d = beat.start + 8; d < beat.end - 4; d += FIRE_EVERY[beat.key] * (0.8 + random() * 0.4)) {
        if (this._nearHall(d, 0) || this._isArc(d)) continue;
        this._add(this.groups.shell, k.fireSpot({ width: 1.6 + random(), depth: 1.2, height: 2 + random() * 1.5 }), d, s * (hw - 1.1));
        s *= -1;
      }
    }
  }

  /** Evac signs: fixed spacing, never inside a hall, text set when passed. */
  _buildSigns() {
    let side = 1;
    for (let distance = 100; distance < this.route.totalLength - 20; distance += 110) {
      let d = distance;
      const hall = this.hallAt(d);
      if (hall) d = hall.end + 5;
      if (this._isArc(d)) d += 18;
      const sign = this.kit.evacSign({ side, halfWidth: CORRIDOR_HALF });
      this._add(this.groups.signage, sign, d, 0);
      this._signs.push({ distance: d, group: sign, shown: false });
      side *= -1;
    }
  }

  /**
   * The fire that is chasing you. The host moves it every frame from the
   * player's vitality (low vitality = right behind you); the level just
   * places it and sizes it to whatever space it is passing through.
   */
  _buildFireFront() {
    const front = new THREE.Group();
    front.name = "FireFront";
    const width = CORRIDOR_HALF * 2 - 0.5;
    // Its own flame material (same clock, same compiled shader) at lower
    // per-tongue intensity: a wall of fire is *many* overlapping tongues, and
    // at normal intensity additive blending clips the whole wall to white.
    const frontFire = this.fire.fire.clone();
    frontFire.uniforms.uTime = this.fire.fire.uniforms.uTime;
    frontFire.uniforms.uIntensity = { value: 0.42 };
    frontFire.uniforms.uSway = { value: 0.3 };
    this._frontFire = frontFire;
    const set = { ...this.fire, fire: frontFire };
    const back = createFire(set, { width, depth: 5, height: 7.5, count: 34, smoke: true, light: false, seed: 911 });
    back.position.z = 2.5;
    const mid = createFire(set, { width, depth: 3, height: 4.6, count: 26, smoke: false, light: false, seed: 313 });
    const lick = createFire(set, { width: width * 0.9, depth: 2, height: 2.4, count: 18, smoke: false, light: false, seed: 17 });
    lick.position.z = -2.2;
    front.add(back, mid, lick);
    const light = new THREE.PointLight(0xff5a1a, 60, 38, 1.6);
    light.position.set(0, 3, -3);
    front.add(light);
    front.userData.light = light;
    this.fireFront = front;
    this.root.add(front);
    this._fireFrontDistance = -40;
    this.setFireFront(-40);
  }

  /** Put the chasing fire at a route distance. */
  setFireFront(distance) {
    this._fireFrontDistance = distance;
    const d = THREE.MathUtils.clamp(distance, 0, this.route.totalLength);
    this.route.place(this.fireFront, d, 0, 0);
    if (distance < 0) {
      // Before the route starts, just push it further back along -forward.
      const sample = this.route.sample(0);
      this.fireFront.position.copy(sample.position).add(new THREE.Vector3(-Math.sin(sample.heading), 0, -Math.cos(sample.heading)).multiplyScalar(distance));
    }
    this.fireFront.scale.x = this.widthAt(d) / CORRIDOR_HALF;
  }

  _registerEmitters() {
    this.root.updateMatrixWorld(true);
    for (const { emitter, distance } of this._pendingEmitters) this.lights.register(emitter, distance);
    this._pendingEmitters.length = 0;
  }

  /* ================================================================ */
  /* Assets                                                            */
  /* ================================================================ */

  /**
   * Load the imported models and swap them in for their stand-ins. The level
   * is fully playable before this resolves.
   */
  async loadAssets(baseUrl, { onProgress } = {}) {
    this.assets = await loadMeltdownAssets(baseUrl, { onProgress });
    const filled = fillAssetSlots(this.root, this.assets);
    this.events.emit("assets-ready", { loaded: this.assets.size, filled });
    return this.assets;
  }

  /* ================================================================ */
  /* Runtime                                                           */
  /* ================================================================ */

  /**
   * A projectile hit something. Returns null (not ours / already broken),
   * `{partial: true, ...}` for damage that didn't break it, or the result.
   * `power` < 1 is an overheat-weakened shot.
   */
  breakTarget(mesh, power = 1) {
    const data = mesh?.userData;
    if (!data?.alive) return null;
    const position = new THREE.Vector3();
    mesh.getWorldPosition(position);
    const remove = () => {
      const index = this.breakables.indexOf(mesh);
      if (index >= 0) this.breakables.splice(index, 1);
    };

    if (data.kind === "sack") {
      if (!data.node.userData.hit(power)) {
        this.events.emit("sack-hit", { label: data.label, hp: data.hp, position });
        return { partial: true, kind: "sack", label: data.label, position };
      }
      remove();
      const result = { kind: "sack", label: data.label, spheres: data.spheres, position };
      this.events.emit("sack-broken", result);
      return result;
    }

    if (data.kind === "glass") {
      if (!data.pane.hitPane(power)) {
        this.events.emit("glass-hit", { hp: data.hp, position });
        return { partial: true, kind: "glass", position };
      }
      remove();
      const obstacle = this.obstacles.indexOf(data.pane.hit);
      if (obstacle >= 0) this.obstacles.splice(obstacle, 1);
      const result = { kind: "glass", label: "GLASS", position, size: [3.0, 3.5] };
      this.events.emit("glass-broken", result);
      return result;
    }

    if (data.kind === "powerup") {
      if (!data.node.userData.onBreak()) return null;
      remove();
      const result = { kind: "powerup", powerupKind: data.powerupKind, label: data.label, position };
      this.events.emit("powerup", result);
      return result;
    }

    return null;
  }

  collide(playerBox, playerDistance, radius = 9) {
    const hits = [];
    for (const entry of this._hazardIndex) {
      if (Math.abs(entry.distance - playerDistance) > radius) continue;
      const mesh = entry.mesh;
      if (!mesh.visible || mesh.userData.disabled) continue;
      mesh.updateWorldMatrix(true, false);
      entry.box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (entry.box.intersectsBox(playerBox)) hits.push(mesh);
    }
    return hits;
  }

  probe(playerBox, playerDistance, grazeMargin = 0.55) {
    const hits = this.collide(playerBox, playerDistance);
    if (hits.length) return { hits, grazes: [] };
    this._grazeBox.copy(playerBox).expandByScalar(grazeMargin);
    const grazes = [];
    for (const entry of this._hazardIndex) {
      if (Math.abs(entry.distance - playerDistance) > 9) continue;
      const mesh = entry.mesh;
      if (!mesh.visible || mesh.userData.disabled) continue;
      mesh.updateWorldMatrix(true, false);
      entry.box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (entry.box.intersectsBox(this._grazeBox)) grazes.push(mesh);
    }
    return { hits, grazes };
  }

  /** Mash-key press near a fallen duct. Returns null if nothing is in reach. */
  pushNearby(playerDistance, radius = 3.4) {
    for (const entry of this._pushables) {
      if (!entry.group.userData.blocking) continue;
      if (entry.group.userData.pushProgress() >= 1) continue;
      if (Math.abs(entry.distance - playerDistance) > radius) continue;
      const progress = entry.group.userData.push(1);
      if (progress >= 1) {
        const mesh = entry.group.userData.hazardMesh;
        const index = this.obstacles.indexOf(mesh);
        if (index >= 0) this.obstacles.splice(index, 1);
        mesh.userData.disabled = true;
        this.events.emit("duct-cleared", { distance: entry.distance });
      }
      return { progress, distance: entry.distance };
    }
    return null;
  }

  /** Is there a fallen, un-pushed duct within reach? (for the HUD prompt) */
  ductAhead(playerDistance, radius = 6) {
    return this._pushables.some(
      (e) => e.group.userData.blocking && e.group.userData.pushProgress() < 1 && Math.abs(e.distance - playerDistance) < radius
    );
  }

  /**
   * Route distance of the nearest fallen, un-cleared duct in front of the
   * player, or null. The host stops the runner short of it: a duct is
   * something you push through, not something you can outrun - and every
   * second spent pushing is a second the fire gains.
   */
  blockingDuctAhead(playerDistance, range = 4) {
    let best = null;
    for (const e of this._pushables) {
      if (!e.group.userData.blocking || e.group.userData.pushProgress() >= 1) continue;
      const gap = e.distance - playerDistance;
      if (gap < -0.5 || gap > range) continue;
      if (best === null || e.distance < best) best = e.distance;
    }
    return best;
  }

  impact(strength = 1) {
    this.state.alarm = Math.min(1.4, this.state.alarm + strength);
    this.events.emit("impact", { strength, alarm: this.state.alarm });
  }

  setBrightness(value) {
    const brightness = Math.max(0.2, value);
    this.options.brightness = brightness;
    this.lights.brightness = brightness;
    this.ambience.userData.setBrightness?.(brightness);
    return brightness;
  }

  /** 0 (safe) .. 1 (about to be caught): reddens ambience and fire. */
  setDanger(value) {
    const d = THREE.MathUtils.clamp(value, 0, 1);
    this.ambience.userData.setDanger?.(d);
    this.fire.fire.uniforms.uIntensity.value = 0.9 + d * 0.35;
  }

  beatAt(distance) {
    return BEATS.find((beat) => distance >= beat.start && distance <= beat.end) ?? (distance < BEATS[1].start ? BEATS[0] : distance < BEATS[2].start ? BEATS[1] : BEATS[2]);
  }

  drainRateAt(distance) {
    return this.beatAt(distance).drain;
  }

  update({ dt, time, distance, playerPosition }) {
    const player = playerPosition ?? this.route.sample(distance, 0, 1.4, this._playerWorld).position;
    this.fire.setTime(time);

    const beat = this.beatAt(distance);
    const beatIndex = BEATS.indexOf(beat);
    if (beatIndex !== this.state.beatIndex) {
      this.state.beatIndex = beatIndex;
      this.events.emit("beat", { index: beatIndex, key: beat.key, name: beat.name });
    }

    const hall = this.hallAt(distance);
    const hallIndex = hall ? hall.index : -1;
    if (hallIndex !== this.state.hallIndex) {
      this.state.hallIndex = hallIndex;
      if (hall) this.events.emit("hall", { index: hall.index, name: hall.name, theme: hall.theme });
    }

    if (this.state.alarm > 0) this.state.alarm = Math.max(0, this.state.alarm - dt * 2.4);
    this.lights.alarm = this.state.alarm;

    if (!this.state.complete && !this.state.timerFailed) {
      this.state.timeRemaining = Math.max(0, this.state.timeRemaining - dt);
      if (this.state.timeRemaining <= 0) {
        this.state.timerFailed = true;
        this.events.emit("timer-expired", {});
      }
    }

    for (const sign of this._signs) {
      if (sign.shown || distance < sign.distance) continue;
      sign.shown = true;
      const remaining = Math.max(0, Math.round(this.state.timeRemaining));
      sign.group.userData.setText(`${remaining}S`);
      this.events.emit("sign", { distance: sign.distance, remaining });
    }

    for (const entry of this._fallingHazards) {
      if (entry.landed && (entry.group.userData.fallen?.() || entry.group.userData.blocking)) continue;
      const cfg = FALLING[entry.kind];
      const gap = entry.distance - distance;
      if (!entry.triggered) {
        if (gap > cfg.range || gap < -2) continue;
        entry.triggered = true;
        this.events.emit("hazard-fall", { kind: entry.kind, distance: entry.distance });
      }
      entry.elapsed += dt;
      const t = Math.min(1, entry.elapsed / cfg.duration);
      entry.group.userData.setFallen(t);
      if (!entry.landed && t >= 0.82) {
        entry.landed = true;
        entry.group.userData.hazardMesh.getWorldPosition(this._landPos);
        this.events.emit("hazard-land", { kind: entry.kind, position: this._landPos.clone(), distance: entry.distance });
      }
      if (t >= 1 && entry.kind === "duct") entry.group.userData.blocking = true;
    }

    if (!this.state.warp.fired && distance >= this._warpTrigger) {
      this.state.warp.fired = true;
      this.state.warp.active = true;
      this.state.warp.elapsed = 0;
      this.events.emit("warp-start", { duration: WARP_DURATION });
    }
    if (this.state.warp.active) {
      this.state.warp.elapsed += dt;
      const t = this.state.warp.elapsed / WARP_DURATION;
      this.events.emit("warp-tick", { t: Math.min(1, t) });
      if (t >= 1) {
        this.state.warp.active = false;
        this.events.emit("warp-end", {});
      }
    }

    for (const entry of this._culled) {
      entry.piece.visible = Math.abs(entry.distance - distance) < 110;
    }
    for (const entry of this._animated) {
      if (Math.abs(entry.distance - distance) > 80) continue;
      entry.piece.userData.tick?.(dt, time);
    }

    const flicker = 1 + Math.sin(time * 13) * 0.12 + Math.sin(time * 29) * 0.08;
    this.fireFront.userData.light.intensity = 60 * flicker;

    this.lights.update(player, time);
    // The shared pool's travelling light is tuned for Level 2's dark metal;
    // here, right over a light-coloured player in pale-tiled rooms, full
    // strength just blows the player out. Keep it as a soft fill.
    this.lights.playerLight.intensity *= 0.35;

    if (!this.state.complete && distance >= this.route.totalLength - 2) {
      this.state.complete = true;
      this.events.emit("complete", {});
    }
    return this.state;
  }

  /* ================================================================ */
  /* Lifecycle                                                         */
  /* ================================================================ */

  addTo(scene) {
    scene.add(this.root);
    return this;
  }

  dispose() {
    this.root.traverse((object) => {
      if (object.userData?.disposeGeometry) object.userData.disposeGeometry.dispose();
      if (object.isPoints && object.geometry) object.geometry.dispose();
    });
    for (const hall of this.groups.shell.children) hall.userData.dispose?.();
    this.lights.dispose();
    this.ambience.userData.dispose?.();
    this.kit.dispose();
    this.fire.dispose();
    this._frontFire?.dispose();
    this.root.parent?.remove(this.root);
    this.breakables.length = 0;
    this.obstacles.length = 0;
    this._animated.length = 0;
    this._culled.length = 0;
    this._hazardIndex.length = 0;
    this._fallingHazards.length = 0;
    this._pushables.length = 0;
    this._signs.length = 0;
    this.events.clear();
  }
}

export default MeltdownLevel;
