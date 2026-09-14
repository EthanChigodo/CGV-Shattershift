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

const ARC = TURN_RADIUS * QUARTER; // 14.137m of travel through each junction

/**
 * How far an escape gate closes while the countdown is still running.
 * At 0.82 the opening is about 1.1m either side of the centre line - passable
 * in the centre lane, impassable in the outer two. They only slam fully shut
 * when the timer runs out.
 */
const ESCAPE_GATE_MAX_CLOSE = 0.82;

/**
 * Beat lengths. Everything inside a beat is placed as a fraction of its length
 * plus a spacing-driven filler, so changing these three numbers re-lays the
 * whole level instead of needing a hundred distances edited by hand.
 */
export const BEAT_LENGTHS = { intake: 256, rolling: 248, furnace: 232 };

export const BEATS = [
  { key: "intake", name: "INTAKE", start: 0, end: BEAT_LENGTHS.intake },
  {
    key: "rolling",
    name: "ROLLING FLOOR",
    start: BEAT_LENGTHS.intake + ARC,
    end: BEAT_LENGTHS.intake + ARC + BEAT_LENGTHS.rolling,
  },
  {
    key: "furnace",
    name: "FURNACE THROAT",
    start: BEAT_LENGTHS.intake + BEAT_LENGTHS.rolling + ARC * 2,
    end: BEAT_LENGTHS.intake + BEAT_LENGTHS.rolling + ARC * 2 + BEAT_LENGTHS.furnace,
  },
];

/** Roughly one hazard every this many metres in the filler stretches. */
const HAZARD_SPACING = 14;
/** Roughly one pressure cell every this many metres. */
const CELL_SPACING = 17;

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
    runSpeed = 9.2,
    escapeSeconds = null,
    brightness = 1.6,
  } = {}) {
    // The escape timer is derived from how far the player actually has to run,
    // not hard-coded. At 194m the old fixed 26s could never expire, which made
    // the countdown decoration rather than a loss condition.
    this.options = { halfWidth, lanes, shadows, runSpeed, escapeSeconds, brightness };
    this.events = createEmitter();

    this.root = new THREE.Group();
    this.root.name = "FoundryRoot";

    this.groups = {
      shell: new THREE.Group(),
      machinery: new THREE.Group(),
      hazards: new THREE.Group(),
      switches: new THREE.Group(),
      targets: new THREE.Group(),
      signage: new THREE.Group(),
    };
    this.groups.targets.name = "Targets";
    this.groups.shell.name = "Shell";
    this.groups.machinery.name = "Machinery";
    this.groups.hazards.name = "Hazards";
    this.groups.switches.name = "Switches";
    this.groups.signage.name = "Signage";
    for (const group of Object.values(this.groups)) this.root.add(group);

    const TOTAL = BEAT_LENGTHS.intake + BEAT_LENGTHS.rolling + BEAT_LENGTHS.furnace + ARC * 2;
    const segments = straightRoute
      ? straightSegments(TOTAL)
      : [
          { type: "straight", length: BEAT_LENGTHS.intake },
          { type: "arc", radius: TURN_RADIUS, angle: QUARTER },
          { type: "straight", length: BEAT_LENGTHS.rolling },
          { type: "arc", radius: TURN_RADIUS, angle: -QUARTER },
          { type: "straight", length: BEAT_LENGTHS.furnace },
        ];

    this.route = createRoute(segments, { origin, heading });
    this.kit = createFoundryKit({ shadows });

    this.ambience = createFoundryAmbience({ brightness });
    this.root.add(this.ambience);

    this.lights = new LightPool({ points: 8, spots: 3, shadows, brightness });
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
    /** Hazards with their route distance and a reusable world-space box. */
    this._hazardIndex = [];
    this._escapeSeconds = 0;

    this.state = {
      beatIndex: -1,
      systemsOnline: 0,
      systemsTotal: 3,
      escape: { active: false, armed: false, remaining: 0, failed: false },
      complete: false,
      alarm: 0,
    };

    this._buildShell();
    this._buildBeatA();
    this._buildBeatB();
    this._buildBeatC();
    this._buildJunctions();
    this._buildTargets();
    this._registerEmitters();

    this._playerWorld = new THREE.Vector3();
    this._scratch = new THREE.Vector3();
    this._grazeBox = new THREE.Box3();
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
      const centre = Math.min(distance + step / 2, total);

      // Junctions swell into a chamber. At a 9m radius the corridor's own outer
      // wall sits 14m in front of the player through the turn, so a plain
      // constant-width corridor means staring at a blank wall for the whole
      // corner. Widening to ~1.5x and easing back gives a sightline through the
      // turn and somewhere for the machinery to sit.
      let widen = 1;
      if (isArc) {
        const fraction = (centre - node.startDistance) / node.length;
        widen = 1 + 0.55 * Math.sin(THREE.MathUtils.clamp(fraction, 0, 1) * Math.PI);
      }

      stations.push({
        distance: centre,
        scaleZ: (step / 8) * (isArc ? 1.18 : 1.02),
        widen,
        index,
      });
      distance += step;
      index += 1;
    }

    // 2. What is stamped at each station? `every` thins a piece out; `offset`,
    //    `rot`, and `scale` are in station-local space (x lateral, z forward).
    // `span` pieces stretch across the corridor and scale with the widening;
    // `edge` pieces sit against a wall and move outward with it.
    const RIBS = [-2.6, -0.4, 2.3];
    const specs = [
      { key: "floor", geometry: geo.floorPlate, material: mat.grate, offset: [0, -0.16, 0], shadow: "receive", span: true },
      { key: "ceiling", geometry: geo.floorPlate, material: mat.plating, offset: [0, 7.62, 0], span: true },
      { key: "kerbL", geometry: geo.kerb, material: mat.trim, offset: [-5.2, 0.16, 0], edge: true },
      { key: "kerbR", geometry: geo.kerb, material: mat.trim, offset: [5.2, 0.16, 0], edge: true },
      // Dashed rather than continuous: a solid line blooms over the floor at a
      // grazing chase-camera angle and reads brighter than the hazards.
      { key: "seam", geometry: geo.seamStrip, material: mat.seam, offset: [0, 0.02, 0], every: 2, shadow: "none" },
      { key: "wallL", geometry: geo.wallPanel, material: mat.plating, offset: [-halfWidth, 3.7, 0], edge: true },
      { key: "wallR", geometry: geo.wallPanel, material: mat.plating, offset: [halfWidth, 3.7, 0], edge: true },
      { key: "trimL", geometry: geo.wallRib, material: mat.hazard, offset: [-(halfWidth - 0.26), 0.62, 0], scale: [0.6, 0.1, 22], edge: true },
      { key: "trimR", geometry: geo.wallRib, material: mat.hazard, offset: [halfWidth - 0.26, 0.62, 0], scale: [0.6, 0.1, 22], edge: true },
      { key: "beam", geometry: geo.beam, material: mat.trim, offset: [0, 7.1, 0], every: 2, span: true },
      { key: "conduitA", geometry: geo.conduit, material: mat.trim, offset: [0, 7.48, -0.32], rot: [0, 0, Math.PI / 2], scale: [0.8, 1, 0.8], every: 2, span: true },
      { key: "conduitB", geometry: geo.conduit, material: mat.trim, offset: [0, 7.48, 0.34], rot: [0, 0, Math.PI / 2], scale: [0.8, 1, 0.8], every: 2, span: true },
      { key: "lampHousing", geometry: geo.lampHousing, material: mat.trim, offset: [2.6, 6.42, 0], rot: [Math.PI, 0, 0], every: 4 },
      { key: "lampBulb", geometry: geo.lampBulb, material: mat.lamp, offset: [2.6, 6.2, 0], every: 4, shadow: "none" },
    ];

    // Ribs vary per station so repeated segments do not read as tiling.
    for (const [i, z] of RIBS.entries()) {
      specs.push({ key: `ribL${i}`, geometry: geo.wallRib, material: mat.trim, offset: [-(halfWidth - 0.22), 3.7, z], vary: i, edge: true });
      specs.push({ key: `ribR${i}`, geometry: geo.wallRib, material: mat.trim, offset: [halfWidth - 0.22, 3.7, z], vary: i, edge: true });
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

        const [ox0, oy, oz] = spec.offset;
        const [rx, ry, rz] = spec.rot ?? [0, 0, 0];
        const [sx0, sy, sz] = spec.scale ?? [1, 1, 1];
        // Widen the junction chambers: edge pieces move out, spanning pieces
        // stretch to still reach across.
        const ox = spec.edge ? ox0 * station.widen : ox0;
        const sx = spec.span ? sx0 * station.widen : sx0;
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
  _switch({ distance, lane, label, action, system = false, points = 200, height = 2.3, spheres = 3 }) {
    const node = this.kit.switchNode({ x: 0, y: height, label, action, points });
    this._add(this.groups.switches, node, distance, lane);
    node.userData.glass.userData.system = system;
    node.userData.glass.userData.routeDistance = distance;
    node.userData.glass.userData.spheres = spheres;
    this.breakables.push(node.userData.glass);
    this._switchNodes.push(node);
    return node;
  }

  _hazard(piece, distance, lateral = 0) {
    this._add(this.groups.hazards, piece, distance, lateral);
    const hazardMesh = piece.userData.hazardMesh;
    if (hazardMesh) {
      this.obstacles.push(hazardMesh);
      this._indexHazard(hazardMesh, distance);
    }
    return piece;
  }

  /**
   * Record a hazard for collision testing. Its bounding box is computed once
   * in local space and transformed per test, so a moving piston head or a
   * closing gate is always tested where it actually is this frame.
   */
  _indexHazard(mesh, distance) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    this._hazardIndex.push({ mesh, distance, box: new THREE.Box3() });
  }

  /* ---------------------------------------------------------------- */
  /* Layout helpers                                                     */
  /* ---------------------------------------------------------------- */

  /** Deterministic generator, so every teammate and every run see one level. */
  _rng(seed) {
    let value = seed;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  /**
   * Fill a stretch with routine hazards at a target spacing.
   *
   * Set pieces - switches, gates, moving walls, piston banks tied to a switch -
   * are still placed by hand at fractions of the beat, because their positions
   * carry meaning. Everything between them is filler, and filler is better
   * generated at a spacing than typed out: it keeps a consistent rhythm, and
   * the level's length becomes a number rather than a hundred edits.
   */
  _fillHazards(from, to, { seed = 1, spacing = HAZARD_SPACING, avoid = [], lanes = [-3.2, 0, 3.2] } = {}) {
    const random = this._rng(seed);
    const clear = (d) => !avoid.some((a) => Math.abs(a - d) < 9);
    let at = from + spacing * 0.5;
    let index = 0;

    while (at < to) {
      if (clear(at)) {
        const roll = random();
        const lane = lanes[Math.floor(random() * lanes.length)];

        if (roll < 0.34) {
          this._hazard(this.kit.barrier({ kind: "low" }), at, lane);
        } else if (roll < 0.62) {
          this._hazard(this.kit.barrier({ kind: "high" }), at, lane);
        } else {
          this._hazard(
            this.kit.pistonBank({
              speed: 1.3 + random() * 0.8,
              phase: random() * Math.PI * 2,
              reach: roll > 0.86 ? 4.4 : 5.2,
              fromCeiling: roll <= 0.86,
            }),
            at,
            lane
          );
        }
        index += 1;
      }
      // Vary the gap so the rhythm never becomes metronomic.
      at += spacing * (0.82 + random() * 0.42);
    }
    return index;
  }

  /** Dress a stretch with belts and vents at a loose spacing. */
  _fillDressing(from, to, { seed = 1, spacing = 22 } = {}) {
    const { halfWidth } = this.options;
    const random = this._rng(seed);
    let at = from + 6;
    let index = 0;

    while (at < to) {
      const side = random() < 0.5 ? -1 : 1;
      if (random() < 0.55) {
        this._add(this.groups.machinery, this.kit.conveyor({ side, speed: 0.9 + random() * 0.8, halfWidth }), at);
      } else {
        this._add(this.groups.machinery, this.kit.heatVent({ side, halfWidth, seed: 30 + index }), at);
      }
      if (index % 3 === 0) {
        this._add(
          this.groups.signage,
          this.kit.warningStrobe({ x: 0, y: 5.6, speed: 3.2 + random(), phase: at }),
          at + spacing * 0.4
        );
      }
      at += spacing * (0.8 + random() * 0.5);
      index += 1;
    }
    return index;
  }

  /**
   * BEAT A - INTAKE.
   * One idea at a time: a belt to establish the place, a piston to establish
   * that some things are solid, then a blocked gate and the switch that opens
   * it. The player cannot leave the beat without using the mechanic once. The
   * back half repeats the lesson with movement layered on top.
   */
  _buildBeatA() {
    const { halfWidth } = this.options;
    const L = BEAT_LENGTHS.intake;
    const at = (f) => L * f;

    // --- Set pieces -----------------------------------------------------
    const gateAt = at(0.19);
    const switchAt = at(0.155);
    const halfGateAt = at(0.42);
    const bypassAt = at(0.385);

    // The teaching piston, alone, before anything else competes for attention.
    this._hazard(this.kit.pistonBank({ speed: 1.3, phase: 0, reach: 5.2 }), at(0.1), 0);

    const gate = this._closingPair(gateAt, 1);
    this._switch({
      distance: switchAt,
      lane: -3.2,
      label: "ROUTE GATE",
      system: true,
      points: 250,
      action: () => {
        for (const slab of gate) slab.userData.setProgress(0);
        this._restoreSystem("ROUTE GATE");
      },
    });

    // Optional: a half-gate closing off the right lane. Miss the switch and
    // you simply take the other two lanes - the first gate was the mandatory
    // lesson, this one rewards noticing.
    const halfGate = this.kit.shutterWall({ side: 1, halfWidth, closedOffset: 4, progress: 1 });
    this._add(this.groups.hazards, halfGate, halfGateAt);
    halfGate.userData.setProgress(1, true);
    if (halfGate.userData.hazardMesh) {
      this.obstacles.push(halfGate.userData.hazardMesh);
      this._indexHazard(halfGate.userData.hazardMesh, halfGateAt);
    }

    this._switch({
      distance: bypassAt,
      lane: 3.2,
      label: "INTAKE BYPASS",
      points: 200,
      action: () => {
        halfGate.userData.setProgress(0);
        this.events.emit("switch-bonus", { label: "INTAKE BYPASS" });
      },
    });

    // --- Filler ---------------------------------------------------------
    // The opening 24m stays deliberately clear so the player can look around.
    this._fillHazards(at(0.1) + 14, L - 10, {
      seed: 1301,
      avoid: [at(0.1), gateAt, switchAt, halfGateAt, bypassAt],
    });
    this._fillDressing(0, L, { seed: 2801 });

    // Junction 1 turns left, so the chevrons fan to the player's left.
    this._add(this.groups.signage, this.kit.turnChevrons({ direction: -1 }), L - 5, 0);
  }

  /**
   * BEAT B - ROLLING FLOOR.
   * Escalation: the beat combines what Beat A taught with lane timing. Two
   * piston banks on different phases, oscillating walls, and three switches
   * that each remove one pressure, so the player chooses what to disable.
   */
  _buildBeatB() {
    const base = BEATS[1].start;
    const L = BEAT_LENGTHS.rolling;
    const at = (f) => base + L * f;

    // --- Set pieces -----------------------------------------------------
    const bankA = [0.05, 0.1, 0.16].map((f, i) =>
      this._hazard(
        this.kit.pistonBank({ speed: 1.6 + i * 0.2, phase: i * 1.1, reach: i === 2 ? 4.4 : 5.2, fromCeiling: i !== 2 }),
        at(f),
        [-3.2, 3.2, 0][i]
      )
    );
    const bankB = [0.55, 0.63, 0.72].map((f, i) =>
      this._hazard(
        this.kit.pistonBank({ speed: 1.7 + i * 0.2, phase: 0.6 + i * 1.2, reach: i === 2 ? 4.4 : 5.2, fromCeiling: i !== 2 }),
        at(f),
        [-3.2, 3.2, 0][i]
      )
    );

    const walls = [this._closingPair(at(0.3), 0), this._closingPair(at(0.78), 0)];
    let wallsLive = true;
    this._animated.push({
      distance: at(0.3),
      piece: {
        userData: {
          tick: (dt, time) => {
            if (!wallsLive) return;
            for (const [i, pair] of walls.entries()) {
              const sweep = 0.5 + 0.5 * Math.sin(time * (1.15 + i * 0.35) + i * 2.1);
              for (const slab of pair) slab.userData.setProgress(sweep * 0.82, true);
            }
          },
        },
      },
    });

    const disableBank = (bank) => {
      for (const piston of bank) {
        piston.userData.tick = null;
        const head = piston.userData.hazardMesh;
        head.userData.disabled = true;
        head.visible = false;
        const index = this.obstacles.indexOf(head);
        if (index >= 0) this.obstacles.splice(index, 1);
      }
    };

    const switchA = at(0.22);
    const switchB = at(0.36);
    const switchC = at(0.66);

    this._switch({
      distance: switchA,
      lane: 3.2,
      label: "PISTON LOCK",
      system: true,
      points: 250,
      action: () => {
        disableBank(bankA);
        this._restoreSystem("PISTON LOCK");
      },
    });

    this._switch({
      distance: switchB,
      lane: -3.2,
      label: "WALL RETRACT",
      points: 200,
      action: () => {
        wallsLive = false;
        for (const pair of walls) for (const slab of pair) slab.userData.setProgress(0);
        this.events.emit("switch-bonus", { label: "WALL RETRACT" });
      },
    });

    this._switch({
      distance: switchC,
      lane: 0,
      label: "PRESSURE BLEED",
      points: 250,
      action: () => {
        disableBank(bankB);
        this.events.emit("switch-bonus", { label: "PRESSURE BLEED" });
      },
    });

    // --- Filler ---------------------------------------------------------
    const setPieces = [
      ...[0.05, 0.1, 0.16, 0.55, 0.63, 0.72, 0.3, 0.78].map(at),
      switchA,
      switchB,
      switchC,
    ];
    this._fillHazards(base + 18, base + L - 12, { seed: 5507, avoid: setPieces });
    this._fillDressing(base, base + L, { seed: 6203 });

    for (const [f, lane] of [[0.16, 3.2], [0.72, -3.2]]) {
      this._add(this.groups.machinery, this.kit.sparkBurst({ count: 22 }), at(f), lane, 1.4);
    }

    // Junction 2 turns right.
    this._add(this.groups.signage, this.kit.turnChevrons({ direction: 1 }), base + L - 5, 0);
  }

  /**
   * BEAT C - FURNACE THROAT.
   * The finale. Crossing the trigger arms the gates, which close as the player
   * approaches each one; at roughly two-thirds closed only the centre lane is
   * passable, so the escape is a lane-discipline test rather than a speed test.
   * Breaking the extraction valve stops every gate and completes the level.
   */
  _buildBeatC() {
    const { halfWidth } = this.options;
    const base = BEATS[2].start;
    const L = BEAT_LENGTHS.furnace;
    const at = (f) => base + L * f;

    // The furnace is dressed heavily - it is the loudest, hottest stretch.
    this._fillDressing(base, base + L, { seed: 7717, spacing: 16 });

    for (const f of [0.06, 0.14, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84]) {
      this._add(
        this.groups.signage,
        this.kit.warningStrobe({ x: 0, y: 5.8, speed: 5.2, phase: at(f) }),
        at(f)
      );
    }

    this._escapeTrigger = at(0.03);

    const gateFractions = [0.1, 0.2, 0.3, 0.42, 0.54, 0.66, 0.78, 0.88];
    for (const f of gateFractions) {
      const distance = at(f);
      const pair = this._closingPair(distance, 0);
      this._escapeGates.push({ distance, pair, progress: 0, triggered: false, elapsed: 0 });
    }

    // Side-lane hazards only. The escape already forces the centre; putting a
    // hazard there too would be unfair rather than hard. Sparser than the rest
    // of the level, because the gates are already the pressure.
    this._fillHazards(at(0.08), at(0.92), {
      seed: 9109,
      spacing: HAZARD_SPACING * 1.6,
      lanes: [-3.2, 3.2],
      avoid: gateFractions.map(at),
    });

    const finalSwitch = at(0.96);
    // 1.5x the time a clean run needs, so the countdown is a real loss
    // condition but not a coin flip. Derived from the run speed, so changing
    // the level's length or pace keeps the escape fair automatically.
    this.state.escape.remaining =
      this.options.escapeSeconds ??
      ((finalSwitch - this._escapeTrigger) / this.options.runSpeed) * 1.5;
    this._escapeSeconds = this.state.escape.remaining;

    this._switch({
      distance: finalSwitch,
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

      // Vents sit against the widened chamber wall, not the corridor wall.
      for (const fraction of [0.15, 0.55, 0.9]) {
        const distance = junction.startDistance + span * fraction;
        const widened = halfWidth * (1 + 0.55 * Math.sin(fraction * Math.PI));
        this._add(
          this.groups.machinery,
          this.kit.heatVent({ side: outside, halfWidth: widened, seed: (seed += 1) }),
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

  /**
   * Scatter pressure cells along the whole route.
   *
   * Placement is deterministic (a fixed seed), so every teammate and every run
   * sees the same layout and the level can be practised. Cells keep clear of
   * the route switches so the player never mistakes one for the other, and
   * every fourth position becomes a run of three at staggered heights - a
   * deliberate combo opportunity rather than an even sprinkle.
   */
  _buildTargets() {
    let seed = 20260912;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const switchDistances = this.breakables.map((mesh) => mesh.userData.routeDistance);
    const tooCloseToSwitch = (d) => switchDistances.some((s) => Math.abs(s - d) < 6);

    const total = this.route.totalLength;
    const heights = [1.5, 2.2, 3.0, 3.7];
    let distance = 10;
    let index = 0;

    while (distance < total - 12) {
      // Every fifth position is a run of two rather than three - clusters are
      // still a combo opportunity, but at the old density they were crowding
      // the corridor rather than punctuating it.
      const cluster = index % 5 === 4 ? 2 : 1;

      for (let i = 0; i < cluster; i += 1) {
        const at = distance + i * 4.2;
        if (at > total - 12 || tooCloseToSwitch(at)) continue;

        // Spread across the full corridor width, not just the three lanes:
        // reaching a cell near a wall is a real aim, not a lane change.
        const lateral = -4.4 + random() * 8.8;
        const height = heights[Math.floor(random() * heights.length)];

        // Every cell returns the sphere it cost. Hitting things sustains the
        // run and only missing drains it, which is the Smash Hit rule and the
        // reason spheres can be a real resource without becoming a trap: at
        // 55% return, a player who shot every cell ran dry before the
        // extraction valve and could not finish the level at all.
        const cell = this.kit.pressureCell({ points: 60, spheres: 1 });
        this._add(this.groups.targets, cell, at, lateral, height);
        cell.userData.glass.userData.routeDistance = at;
        this.breakables.push(cell.userData.glass);
      }

      distance += CELL_SPACING * (0.85 + random() * 0.4);
      index += 1;
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
      if (slab.userData.hazardMesh) {
        this.obstacles.push(slab.userData.hazardMesh);
        this._indexHazard(slab.userData.hazardMesh, distance);
      }
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
    const data = mesh?.userData;
    if (!data?.alive || (data.kind !== "switch" && data.kind !== "cell")) return null;

    const node = data.node;
    const owned =
      node &&
      (this.groups.switches.children.includes(node) || this.groups.targets.children.includes(node));
    if (!owned) return null;

    const position = new THREE.Vector3();
    mesh.getWorldPosition(position);
    const points = data.points ?? 60;

    node.userData.onBreak();

    const index = this.breakables.indexOf(mesh);
    if (index >= 0) this.breakables.splice(index, 1);

    const result = {
      points,
      label: data.label,
      kind: data.kind,
      spheres: data.spheres ?? 0,
      position,
    };

    this.events.emit(data.kind === "switch" ? "switch-broken" : "cell-broken", result);
    return result;
  }

  /**
   * Hazards the player is currently touching, and hazards they are passing
   * close to without touching.
   *
   * The near miss is the whole reason this returns two lists. A runner that
   * only punishes contact gives no reason to cut anything fine; paying out for
   * threading a gap turns a dodge into a decision.
   *
   * @returns {{hits: THREE.Mesh[], grazes: THREE.Mesh[]}}
   */
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

  /**
   * Test a player volume against every hazard near them.
   *
   * The host owns the player, so it passes in a world-space Box3 and its route
   * distance; the level owns the hazards, so it does the testing. Only hazards
   * within `radius` metres along the route are considered, which is normally
   * two or three boxes rather than the level's fifty-odd.
   *
   * Real axis-aligned boxes rather than a point-distance check: a piston head
   * is 2.3m across and a gate slab 4.6m, so a centre-to-centre threshold either
   * lets the player walk through the edges of things or trips on thin air.
   *
   * @param {THREE.Box3} playerBox world-space bounds of the player
   * @param {number} playerDistance the player's distance along the route
   * @returns {THREE.Mesh[]} hazards currently overlapping
   */
  collide(playerBox, playerDistance, radius = 9) {
    const hits = [];
    for (const entry of this._hazardIndex) {
      if (Math.abs(entry.distance - playerDistance) > radius) continue;

      const mesh = entry.mesh;
      if (!mesh.visible || mesh.userData.disabled) continue;

      // Ancestors first: a piston head hangs off a shaft off a housing, and a
      // gate slab is a child of a group the level moved this frame.
      mesh.updateWorldMatrix(true, false);
      entry.box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (entry.box.intersectsBox(playerBox)) hits.push(mesh);
    }
    return hits;
  }

  /**
   * The environment's reaction to the player being hit: the pooled lights bleed
   * to red and spike, and every warning strobe goes into overdrive. Decays on
   * its own over about half a second.
   *
   * This lives in the level rather than the HUD because it is the *world*
   * reacting - the same alarm should read from any camera, and it survives when
   * the HUD is replaced by the real game's.
   */
  /**
   * Set the level's overall light level. One knob for the ambient fill and
   * every pooled light, so the sector can be tuned without touching code.
   * 1.0 is moody, 1.6 is the default, past ~2.2 it stops reading as the dark
   * level.
   */
  setBrightness(value) {
    const brightness = Math.max(0.2, value);
    this.options.brightness = brightness;
    this.lights.brightness = brightness;
    this.ambience.userData.setBrightness?.(brightness);
    return brightness;
  }

  impact(strength = 1) {
    this.state.alarm = Math.min(1.4, this.state.alarm + strength);
    this.events.emit("impact", { strength, alarm: this.state.alarm });
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

    // Impact alarm decays fast enough to read as a hit rather than a mood.
    if (this.state.alarm > 0) {
      this.state.alarm = Math.max(0, this.state.alarm - dt * 2.4);
    }
    this.lights.alarm = this.state.alarm;

    this._updateEscape(dt, distance);

    // Tick and cull. Anything far from the player is skipped entirely and
    // hidden, which keeps the draw call count flat as the level grows.
    for (const entry of this._culled) {
      const gap = Math.abs(entry.distance - distance);
      entry.piece.visible = gap < 95;
    }
    const alarmed = this.state.alarm > 0.05;
    for (const entry of this._animated) {
      if (Math.abs(entry.distance - distance) > 70) continue;
      // During an impact every strobe in earshot fires, not just armed ones.
      if (alarmed && entry.piece.userData.armed !== undefined) {
        entry.piece.userData.tick?.(dt, time * 2.6);
        continue;
      }
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
      escape.remaining = this._escapeSeconds;
      this.events.emit("escape-start", { seconds: this._escapeSeconds });
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
      // Gates stop just short of shut while the clock is running, leaving the
      // centre lane passable. The HUD promises "hold the centre lane" and this
      // is what makes that promise true.
      //
      // Letting them close fully created a death spiral: an impact costs speed,
      // the lost speed means arriving after the next gate has shut, which costs
      // more speed. A simulated run took six gate hits in a row that way. The
      // timer is the loss condition here; the gates enforce the lane.
      gate.progress = Math.min(ESCAPE_GATE_MAX_CLOSE, gate.elapsed / 4);
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
    this._hazardIndex.length = 0;
    this.events.clear();
  }
}

export default FoundryLevel;
