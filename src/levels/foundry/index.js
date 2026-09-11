/**
 * Level 2 - The Shifting Foundry.
 *
 * "A darker mechanical sector with moving walls, pistons, rails, heat vents,
 *  and glowing industrial glass. The player dodges solid hazards that cannot
 *  all be destroyed. Glass switches alter the track. The level ends with a
 *  timed escape from closing walls."
 *
 * The level is authored as three beats along a route with two 90-degree
 * junctions:
 *
 *   BEAT A  INTAKE          0 - 58     teaches the switch: shoot glass, route opens
 *   J1      junction left   58 - 72
 *   BEAT B  ROLLING FLOOR   72 - 128   pistons, belts, moving walls, jump/slide
 *   J2      junction right  128 - 142
 *   BEAT C  FURNACE THROAT  142 - 194  timed escape through closing gates
 *
 * Scene hierarchy (the guide asks the team to be able to explain the parenting):
 *
 *   FoundryRoot
 *   |-- Shell          static corridor: floors, walls, ceiling rigs
 *   |-- Machinery      pistons, conveyors, vents - animated, hierarchical
 *   |-- Hazards        solid obstacles the player must dodge
 *   |-- Switches       breakable glass that reshapes the route
 *   |-- Signage        turn chevrons and warning strobes
 *   |-- Ambience       hemisphere + weak key light
 *   `-- PooledLighting fixed pool of dynamic lights (see lighting.js)
 *
 * Nothing in here touches the player, the camera, or the HUD. The level exposes
 * `breakables` / `obstacles` for the host game's collision code, a small event
 * emitter for UI cues, and `route.sample()` so the player controller can follow
 * the curve. See docs/level-2-foundry.md for the integration contract.
 */

import * as THREE from "../../three.js";
import { createFoundryKit } from "./kit.js";
import { createRoute, straightSegments } from "./route.js";
import { LightPool, createFoundryAmbience } from "./lighting.js";

const TURN_RADIUS = 9;
const QUARTER = Math.PI / 2;

export const BEATS = [
  { key: "intake", name: "INTAKE", start: 0, end: 58 },
  { key: "rolling", name: "ROLLING FLOOR", start: 72.14, end: 128.14 },
  { key: "furnace", name: "FURNACE THROAT", start: 142.28, end: 194.28 },
];

/** Tiny event emitter - the level announces, the UI listens. */
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

export class FoundryLevel {
  /**
   * @param {object} options
   * @param {THREE.Vector3} [options.origin]  where the level starts in world space
   * @param {number} [options.heading]         starting heading, 0 = down -Z
   * @param {boolean} [options.shadows]        enable shadow casting on pooled spots
   * @param {boolean} [options.straightRoute]  skip the junctions, for a player
   *                                           controller that only moves along -Z
   * @param {number} [options.halfWidth]       corridor half width
   * @param {number[]} [options.lanes]         lane offsets, matching the prototype
   */
  constructor({
    origin = new THREE.Vector3(0, 0, -146),
    heading = 0,
    shadows = false,
    straightRoute = false,
    halfWidth = 5.6,
    lanes = [-3.2, 0, 3.2],
    escapeSeconds = 26,
  } = {}) {
    this.options = { halfWidth, lanes, shadows, escapeSeconds };
    this.events = createEmitter();

    this.root = new THREE.Group();
    this.root.name = "FoundryRoot";

    this.groups = {
      shell: new THREE.Group(),
      machinery: new THREE.Group(),
      hazards: new THREE.Group(),
      switches: new THREE.Group(),
      signage: new THREE.Group(),
    };
    this.groups.shell.name = "Shell";
    this.groups.machinery.name = "Machinery";
    this.groups.hazards.name = "Hazards";
    this.groups.switches.name = "Switches";
    this.groups.signage.name = "Signage";
    for (const group of Object.values(this.groups)) this.root.add(group);

    const segments = straightRoute
      ? straightSegments(194.28)
      : [
          { type: "straight", length: 58 },
          { type: "arc", radius: TURN_RADIUS, angle: QUARTER },
          { type: "straight", length: 56 },
          { type: "arc", radius: TURN_RADIUS, angle: -QUARTER },
          { type: "straight", length: 52 },
        ];

    this.route = createRoute(segments, { origin, heading });
    this.kit = createFoundryKit({ shadows });

    this.ambience = createFoundryAmbience();
    this.root.add(this.ambience);

    this.lights = new LightPool({ points: 8, spots: 3, shadows });
    this.root.add(this.lights.group);

    /** Meshes a projectile can destroy. Push these into the host's breakables. */
    this.breakables = [];
    /** Solid meshes that damage the player. Push these into the host's obstacles. */
    this.obstacles = [];

    this._animated = [];
    this._culled = [];
    this._switchNodes = [];
    this._escapeGates = [];
    this._pendingEmitters = [];

    this.state = {
      beatIndex: -1,
      systemsOnline: 0,
      systemsTotal: 3,
      escape: { active: false, armed: false, remaining: escapeSeconds, failed: false },
      complete: false,
    };

    this._buildShell();
    this._buildBeatA();
    this._buildBeatB();
    this._buildBeatC();
    this._buildJunctions();
    this._registerEmitters();

    this._playerWorld = new THREE.Vector3();
    this._scratch = new THREE.Vector3();
  }

  /* ================================================================ */
  /* Building                                                          */
  /* ================================================================ */

  /** Add a piece at a route distance, tracking animation and culling. */
  _add(group, piece, distance, lateral = 0, height = 0, { cull = true } = {}) {
    this.route.place(piece, distance, lateral, height);
    group.add(piece);
    piece.userData.routeDistance = distance;
    if (typeof piece.userData.tick === "function") {
      this._animated.push({ piece, distance });
    }
    if (cull) this._culled.push({ piece, distance });
    if (piece.userData.emitter) {
      this._pendingEmitters.push({ emitter: piece.userData.emitter, distance });
    }
    return piece;
  }

  /**
   * The corridor shell.
   *
   * The shell is the same handful of boxes repeated about thirty times along
   * the route, which as individual meshes cost roughly 600 draw calls - far too
   * many for the lab hardware the guide asks us to target. So the shell is
   * built as InstancedMesh sets instead: one draw call per piece type for the
   * whole level, about a dozen in total.
   *
   * Stations are walked along the route so the walls follow the junction arcs.
   * Arc stations are shorter and slightly overlapped so the curve has no gaps.
   */
  _buildShell() {
    const { halfWidth } = this.options;
    const { geometries: geo, materials: mat } = this.kit;
    const total = this.route.totalLength;

    // 1. Where does each shell station sit on the route?
    const stations = [];
    let distance = 0;
    let index = 0;
    while (distance < total) {
      const { node } = this.route.nodeAt(distance + 0.01);
      const isArc = node.type === "arc";
      const step = isArc ? 3.6 : 8;
      stations.push({
        distance: Math.min(distance + step / 2, total),
        scaleZ: (step / 8) * (isArc ? 1.18 : 1.02),
        index,
      });
      distance += step;
      index += 1;
    }

    // 2. What is stamped at each station? `every` thins a piece out; `offset`,
    //    `rot`, and `scale` are in station-local space (x lateral, z forward).
    const RIBS = [-2.6, -0.4, 2.3];
    const specs = [
      { key: "floor", geometry: geo.floorPlate, material: mat.grate, offset: [0, -0.16, 0], shadow: "receive" },
      { key: "ceiling", geometry: geo.floorPlate, material: mat.plating, offset: [0, 7.62, 0] },
      { key: "kerbL", geometry: geo.kerb, material: mat.trim, offset: [-5.2, 0.16, 0] },
      { key: "kerbR", geometry: geo.kerb, material: mat.trim, offset: [5.2, 0.16, 0] },
      // Dashed rather than continuous: a solid line blooms over the floor at a
      // grazing chase-camera angle and reads brighter than the hazards.
      { key: "seam", geometry: geo.seamStrip, material: mat.seam, offset: [0, 0.02, 0], every: 2, shadow: "none" },
      { key: "wallL", geometry: geo.wallPanel, material: mat.plating, offset: [-halfWidth, 3.7, 0] },
      { key: "wallR", geometry: geo.wallPanel, material: mat.plating, offset: [halfWidth, 3.7, 0] },
      { key: "trimL", geometry: geo.wallRib, material: mat.hazard, offset: [-(halfWidth - 0.26), 0.62, 0], scale: [0.6, 0.1, 22] },
      { key: "trimR", geometry: geo.wallRib, material: mat.hazard, offset: [halfWidth - 0.26, 0.62, 0], scale: [0.6, 0.1, 22] },
      { key: "beam", geometry: geo.beam, material: mat.trim, offset: [0, 7.1, 0], every: 2 },
      { key: "conduitA", geometry: geo.conduit, material: mat.trim, offset: [0, 7.48, -0.32], rot: [0, 0, Math.PI / 2], scale: [0.8, 1, 0.8], every: 2 },
      { key: "conduitB", geometry: geo.conduit, material: mat.trim, offset: [0, 7.48, 0.34], rot: [0, 0, Math.PI / 2], scale: [0.8, 1, 0.8], every: 2 },
      { key: "lampHousing", geometry: geo.lampHousing, material: mat.trim, offset: [2.6, 6.42, 0], rot: [Math.PI, 0, 0], every: 4 },
      { key: "lampBulb", geometry: geo.lampBulb, material: mat.lamp, offset: [2.6, 6.2, 0], every: 4, shadow: "none" },
    ];

    // Ribs vary per station so repeated segments do not read as tiling.
    for (const [i, z] of RIBS.entries()) {
      specs.push({ key: `ribL${i}`, geometry: geo.wallRib, material: mat.trim, offset: [-(halfWidth - 0.22), 3.7, z], vary: i });
      specs.push({ key: `ribR${i}`, geometry: geo.wallRib, material: mat.trim, offset: [halfWidth - 0.22, 3.7, z], vary: i });
    }

    // 3. Compose one matrix per instance: station transform * local transform.
    const stationMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (const spec of specs) {
      const matrices = [];

      for (const station of stations) {
        if (spec.every && station.index % spec.every !== 0) continue;

        const sample = this.route.sample(station.distance);
        quaternion.setFromEuler(euler.set(0, sample.heading, 0));
        stationMatrix.compose(sample.position, quaternion, scale.set(1, 1, station.scaleZ));

        const [ox, oy, oz] = spec.offset;
        const [rx, ry, rz] = spec.rot ?? [0, 0, 0];
        const [sx, sy, sz] = spec.scale ?? [1, 1, 1];
        // Ribs stretch slightly by station so the wall reads as hand-placed.
        const varyY = spec.vary === undefined ? 1 : 0.82 + ((station.index + spec.vary) % 3) * 0.09;

        quaternion.setFromEuler(euler.set(rx, ry, rz));
        localMatrix.compose(position.set(ox, oy, oz), quaternion, scale.set(sx, sy * varyY, sz));

        matrices.push(stationMatrix.clone().multiply(localMatrix));
      }

      if (!matrices.length) continue;

      const instanced = new THREE.InstancedMesh(spec.geometry, spec.material, matrices.length);
      instanced.name = `Shell_${spec.key}`;
      instanced.castShadow = this.options.shadows && spec.shadow !== "none" && spec.shadow !== "receive";
      instanced.receiveShadow = this.options.shadows && spec.shadow !== "none";
      for (const [i, matrix] of matrices.entries()) instanced.setMatrixAt(i, matrix);
      instanced.instanceMatrix.needsUpdate = true;
      // The shell spans the whole level, so per-instance frustum culling by
      // Three.js would be wrong; the fog and the short corridor handle it.
      instanced.frustumCulled = false;
      this.groups.shell.add(instanced);
    }

    // 4. Light anchors for the pooled spots, at every instanced lamp.
    for (const station of stations) {
      if (station.index % 4 !== 0) continue;
      const anchor = new THREE.Object3D();
      this.route.place(anchor, station.distance, 2.6, 6.1);
      this.groups.shell.add(anchor);
      this._pendingEmitters.push({
        emitter: { kind: "spot", anchor, color: 0xffd9a8, base: 30 },
        distance: station.distance,
      });
    }

    // 5. One swinging hero rig per beat: a real moving light, for the shadows.
    for (const beat of BEATS) {
      const rig = this.kit.ceilingRig({ light: false, seed: Math.round(beat.start) });
      this._add(this.groups.shell, rig, beat.start + 20);
    }
  }

  /** Register a switch and wire its break action. */
  _switch({ distance, lane, label, action, system = false, points = 200, height = 2.3 }) {
    const node = this.kit.switchNode({ x: 0, y: height, label, action, points });
    this._add(this.groups.switches, node, distance, lane);
    node.userData.glass.userData.system = system;
    node.userData.glass.userData.routeDistance = distance;
    this.breakables.push(node.userData.glass);
    this._switchNodes.push(node);
    return node;
  }

  _hazard(piece, distance, lateral = 0) {
    this._add(this.groups.hazards, piece, distance, lateral);
    const hazardMesh = piece.userData.hazardMesh;
    if (hazardMesh) this.obstacles.push(hazardMesh);
    return piece;
  }

  /**
   * BEAT A - INTAKE.
   * One idea at a time: a belt to establish the place, a piston to establish
   * that some things are solid, then a blocked gate and the switch that opens
   * it. The player cannot leave the beat without using the mechanic once.
   */
  _buildBeatA() {
    const { halfWidth } = this.options;

    this._add(this.groups.machinery, this.kit.conveyor({ side: 1, speed: 1.1, halfWidth }), 15);
    this._add(this.groups.machinery, this.kit.conveyor({ side: 1, speed: 1.1, halfWidth }), 24);
    this._add(this.groups.machinery, this.kit.heatVent({ side: -1, halfWidth, seed: 1 }), 11);
    this._add(this.groups.machinery, this.kit.heatVent({ side: 1, halfWidth, seed: 2 }), 31);

    this._hazard(this.kit.pistonBank({ speed: 1.3, phase: 0, reach: 3.6 }), 26, 0);
    this._hazard(this.kit.barrier({ kind: "low" }), 36, 3.2);

    // The gate that blocks the corridor, and the switch that retracts it.
    const gate = this._closingPair(48, 1);
    this._switch({
      distance: 40,
      lane: -3.2,
      label: "ROUTE GATE",
      system: true,
      points: 250,
      action: () => {
        for (const slab of gate) slab.userData.setProgress(0);
        this._restoreSystem("ROUTE GATE");
      },
    });

    this._add(this.groups.signage, this.kit.warningStrobe({ x: 0, y: 5.6, speed: 3.2 }), 45);
    // Junction 1 turns left, so the chevrons fan to the player's left.
    this._add(this.groups.signage, this.kit.turnChevrons({ direction: -1 }), 54, 0);
  }

  /**
   * BEAT B - ROLLING FLOOR.
   * Escalation: the beat combines what Beat A taught with lane timing. Three
   * piston banks on different phases, a jump and a slide, oscillating walls,
   * and two switches that each remove one pressure so the player chooses what
   * to disable first.
   */
  _buildBeatB() {
    const { halfWidth } = this.options;
    const base = BEATS[1].start;

    for (const [offset, side, speed] of [
      [6, -1, 1.2],
      [14, 1, 1.5],
      [30, -1, 1.0],
    ]) {
      this._add(this.groups.machinery, this.kit.conveyor({ side, speed, halfWidth }), base + offset);
    }

    for (const [offset, side, seed] of [
      [4, 1, 3],
      [24, -1, 4],
      [44, 1, 5],
    ]) {
      this._add(this.groups.machinery, this.kit.heatVent({ side, halfWidth, seed }), base + offset);
    }

    const pistonA = this._hazard(this.kit.pistonBank({ speed: 1.6, phase: 0, reach: 3.6 }), base + 10, -3.2);
    const pistonB = this._hazard(this.kit.pistonBank({ speed: 1.9, phase: 1.1, reach: 3.6 }), base + 20, 3.2);
    const pistonC = this._hazard(
      this.kit.pistonBank({ speed: 1.4, phase: 2.2, reach: 3.9, fromCeiling: false }),
      base + 32,
      0
    );

    this._hazard(this.kit.barrier({ kind: "high" }), base + 16, 0);
    this._hazard(this.kit.barrier({ kind: "low" }), base + 26, -3.2);

    const sparks = this.kit.sparkBurst({ count: 22 });
    this._add(this.groups.machinery, sparks, base + 20, 3.2, 1.4);

    // Oscillating "moving walls" - driven directly rather than damped, so they
    // sweep at a readable, constant rate.
    const movingWalls = this._closingPair(base + 38, 0);
    let wallsLive = true;
    this._animated.push({
      distance: base + 38,
      piece: {
        userData: {
          tick: (dt, time) => {
            if (!wallsLive) return;
            const sweep = 0.5 + 0.5 * Math.sin(time * 1.15);
            for (const slab of movingWalls) slab.userData.setProgress(sweep * 0.82, true);
          },
        },
      },
    });

    this._switch({
      distance: base + 28,
      lane: 3.2,
      label: "PISTON LOCK",
      system: true,
      points: 250,
      action: () => {
        for (const piston of [pistonA, pistonB, pistonC]) {
          piston.userData.tick = null;
          const head = piston.userData.hazardMesh;
          head.userData.disabled = true;
          head.visible = false;
          const index = this.obstacles.indexOf(head);
          if (index >= 0) this.obstacles.splice(index, 1);
        }
        this._restoreSystem("PISTON LOCK");
      },
    });

    this._switch({
      distance: base + 44,
      lane: -3.2,
      label: "WALL RETRACT",
      points: 200,
      action: () => {
        wallsLive = false;
        for (const slab of movingWalls) slab.userData.setProgress(0);
        this.events.emit("switch-bonus", { label: "WALL RETRACT" });
      },
    });

    for (const offset of [12, 34]) {
      this._add(this.groups.signage, this.kit.warningStrobe({ x: 0, y: 5.6, speed: 3.8 }), base + offset);
    }
    // Junction 2 turns right.
    this._add(this.groups.signage, this.kit.turnChevrons({ direction: 1 }), base + 52, 0);
  }

  /**
   * BEAT C - FURNACE THROAT.
   * The finale. Crossing the trigger arms four gates that close as the player
   * approaches each one; at roughly two-thirds closed only the centre lane is
   * passable, so the escape is a lane-discipline test rather than a speed test.
   * Breaking the extraction valve stops every gate and completes the level.
   */
  _buildBeatC() {
    const { halfWidth } = this.options;
    const base = BEATS[2].start;

    for (const [offset, side, seed] of [
      [4, -1, 6],
      [10, 1, 7],
      [20, -1, 8],
      [28, 1, 9],
      [38, -1, 10],
      [44, 1, 11],
    ]) {
      this._add(this.groups.machinery, this.kit.heatVent({ side, halfWidth, seed }), base + offset);
    }

    for (const offset of [6, 16, 26, 36, 46]) {
      this._add(
        this.groups.signage,
        this.kit.warningStrobe({ x: 0, y: 5.8, speed: 5.2, phase: offset }),
        base + offset
      );
    }

    this._escapeTrigger = base + 5;

    for (const offset of [14, 24, 34, 44]) {
      const distance = base + offset;
      const pair = this._closingPair(distance, 0);
      this._escapeGates.push({ distance, pair, progress: 0, triggered: false, elapsed: 0 });
    }

    this._switch({
      distance: base + 48,
      lane: 0,
      label: "EXTRACTION VALVE",
      system: true,
      points: 400,
      height: 2.6,
      action: () => {
        this.state.escape.active = false;
        for (const gate of this._escapeGates) {
          gate.triggered = false;
          gate.progress = 0;
          for (const slab of gate.pair) slab.userData.setProgress(0, true);
        }
        for (const strobe of this.groups.signage.children) {
          if (strobe.userData.armed !== undefined) strobe.userData.armed = false;
        }
        this._restoreSystem("EXTRACTION VALVE");
        this.state.complete = true;
        this.events.emit("escape-end", { survived: true });
        this.events.emit("complete", { systemsOnline: this.state.systemsOnline });
      },
    });
  }

  /**
   * Junction dressing. A corner the player cannot see into is an unfair corner,
   * so each turn gets vents on the outside of the curve (where the eye goes)
   * and a strobe on the apex. This is lighting as signposting, not decoration.
   */
  _buildJunctions() {
    const { halfWidth } = this.options;
    let seed = 20;

    for (const junction of this.route.junctions) {
      const outside = junction.direction === "left" ? 1 : -1;
      const span = junction.endDistance - junction.startDistance;

      for (const fraction of [0.15, 0.55, 0.9]) {
        const distance = junction.startDistance + span * fraction;
        this._add(
          this.groups.machinery,
          this.kit.heatVent({ side: outside, halfWidth, seed: (seed += 1) }),
          distance
        );
      }

      this._add(
        this.groups.signage,
        this.kit.warningStrobe({ x: outside * 3.4, y: 5.4, speed: 4.2 }),
        junction.startDistance + span * 0.5
      );
    }
  }

  /** A left/right pair of shutter slabs that close across the corridor. */
  _closingPair(distance, progress) {
    const { halfWidth } = this.options;
    const pair = [];
    for (const side of [-1, 1]) {
      const slab = this.kit.shutterWall({ side, halfWidth, progress });
      this._add(this.groups.hazards, slab, distance);
      slab.userData.setProgress(progress, true);
      if (slab.userData.hazardMesh) this.obstacles.push(slab.userData.hazardMesh);
      pair.push(slab);
    }
    return pair;
  }

  /** World positions for pooled lights are cached once the root is populated. */
  _registerEmitters() {
    this.root.updateMatrixWorld(true);
    for (const { emitter, distance } of this._pendingEmitters) {
      this.lights.register(emitter, distance);
    }
    this._pendingEmitters.length = 0;
  }

  _restoreSystem(label) {
    this.state.systemsOnline = Math.min(this.state.systemsTotal, this.state.systemsOnline + 1);
    this.events.emit("system-restored", {
      label,
      online: this.state.systemsOnline,
      total: this.state.systemsTotal,
    });
  }

  /* ================================================================ */
  /* Runtime                                                           */
  /* ================================================================ */

  /**
   * Called when a projectile hits something. Pass the mesh the host's raycast
   * returned; the level handles it only if it is one of its own switches.
   * @returns {{points:number,label:string,position:THREE.Vector3}|null}
   */
  breakTarget(mesh) {
    if (!mesh?.userData || mesh.userData.kind !== "switch" || !mesh.userData.alive) return null;
    const node = mesh.userData.node;
    if (!node || !this.groups.switches.children.includes(node)) return null;

    const position = new THREE.Vector3();
    mesh.getWorldPosition(position);
    const points = mesh.userData.points ?? 200;

    node.userData.onBreak();

    const index = this.breakables.indexOf(mesh);
    if (index >= 0) this.breakables.splice(index, 1);

    this.events.emit("switch-broken", { label: mesh.userData.label, points, position });
    return { points, label: mesh.userData.label, position };
  }

  /** Beat containing a route distance, or null in a junction. */
  beatAt(distance) {
    return BEATS.find((beat) => distance >= beat.start && distance <= beat.end) ?? null;
  }

  /** Nearest junction ahead of the player, for camera easing and UI chevrons. */
  junctionAhead(distance, lookahead = 26) {
    for (const junction of this.route.junctions) {
      const gap = junction.startDistance - distance;
      const arcLength = junction.endDistance - junction.startDistance;
      // Still ahead, or currently being driven through.
      if (gap > -arcLength && gap < lookahead) return { ...junction, gap };
    }
    return null;
  }

  /**
   * Advance the level.
   * @param {{dt:number,time:number,distance:number,playerPosition?:THREE.Vector3}} args
   */
  update({ dt, time, distance, playerPosition }) {
    const player = playerPosition ?? this.route.sample(distance, 0, 1.4, this._playerWorld).position;

    // Beat announcements.
    const beat = this.beatAt(distance);
    const beatIndex = beat ? BEATS.indexOf(beat) : this.state.beatIndex;
    if (beat && beatIndex !== this.state.beatIndex) {
      this.state.beatIndex = beatIndex;
      this.events.emit("beat", { index: beatIndex, key: beat.key, name: beat.name });
    }

    this._updateEscape(dt, distance);

    // Tick and cull. Anything far from the player is skipped entirely and
    // hidden, which keeps the draw call count flat as the level grows.
    for (const entry of this._culled) {
      const gap = Math.abs(entry.distance - distance);
      entry.piece.visible = gap < 95;
    }
    for (const entry of this._animated) {
      if (Math.abs(entry.distance - distance) > 70) continue;
      entry.piece.userData.tick?.(dt, time);
    }

    this.lights.update(player, time);

    // Junction cue for the camera controller and the HUD.
    const junction = this.junctionAhead(distance);
    if (junction && junction.gap > 0 && junction.gap < 24) {
      if (this._lastJunction !== junction.startDistance) {
        this._lastJunction = junction.startDistance;
        this.events.emit("junction", { direction: junction.direction, gap: junction.gap });
      }
    }

    return this.state;
  }

  _updateEscape(dt, distance) {
    const escape = this.state.escape;

    if (!escape.armed && !this.state.complete && distance >= this._escapeTrigger) {
      escape.armed = true;
      escape.active = true;
      escape.remaining = this.options.escapeSeconds;
      this.events.emit("escape-start", { seconds: this.options.escapeSeconds });
    }

    if (!escape.active) return;

    escape.remaining = Math.max(0, escape.remaining - dt);
    this.events.emit("escape-tick", { remaining: escape.remaining });

    if (escape.remaining <= 0 && !escape.failed) {
      escape.failed = true;
      escape.active = false;
      for (const gate of this._escapeGates) {
        for (const slab of gate.pair) slab.userData.setProgress(1);
      }
      this.events.emit("escape-end", { survived: false });
      return;
    }

    // Each gate starts closing when the player is 24m out and takes 4 seconds,
    // so the player meets it about two-thirds closed - centre lane only.
    for (const gate of this._escapeGates) {
      if (!gate.triggered && distance > gate.distance - 24) {
        gate.triggered = true;
        gate.elapsed = 0;
      }
      if (!gate.triggered) continue;
      gate.elapsed += dt;
      gate.progress = Math.min(1, gate.elapsed / 4);
      for (const slab of gate.pair) slab.userData.setProgress(gate.progress, true);
    }
  }

  /* ================================================================ */
  /* Lifecycle                                                         */
  /* ================================================================ */

  addTo(scene) {
    scene.add(this.root);
    return this;
  }

  /**
   * Free every GPU resource this level owns. The guide flags "level changes
   * leak GPU memory" as a risk; this is the answer to it. Safe to call twice.
   */
  dispose() {
    this.root.traverse((object) => {
      if (object.userData?.disposeGeometry) object.userData.disposeGeometry.dispose();
      if (object.isPoints && object.geometry) object.geometry.dispose();
    });

    this.lights.dispose();
    this.ambience.userData.dispose?.();
    this.kit.dispose();
    this.root.parent?.remove(this.root);

    this.breakables.length = 0;
    this.obstacles.length = 0;
    this._animated.length = 0;
    this._culled.length = 0;
    this._switchNodes.length = 0;
    this._escapeGates.length = 0;
    this.events.clear();
  }
}

export default FoundryLevel;
