/**
 * The tower behind the skybridge, demolished (the Skyline's blast): the
 * charges go floor by floor, bottom to top - a band of white flashes and
 * blown-out windows at each level - then the blast cuts its core level with
 * the bridge and the top comes down: leaning toward you, crushing the
 * floors under it one by one, sinking into its own dust, which rolls out
 * across the bridge while glass and debris rain past. The shared collapse
 * system (src/fx/demolition.js), with its own particles.
 *
 *   const tower = new DemolitionTower({ floors: 24, quality: "high" });
 *   tower.root.position.copy(where);           // base centre, below the bridge
 *   scene.add(tower.root);
 *   tower.detonate();                           // starts the sequence
 *   tower.update(dt, camera);                   // every frame
 *   tower.fallout(camera);                      // glass and dust round you
 *   tower.state  // { floorsGone, whole (0..1 after the blast), sink (m), done }
 *
 * Light-free like the rest of the stage: lit windows are emissive, the
 * blasts additive - no real lights, so nothing in the level recompiles
 * mid-cutscene.
 */

import * as THREE from "../../three.js";
import { DemolitionFX, DemolitionBuilding, BLAST_DELAY } from "../../fx/demolition.js";

const FLOOR_HEIGHT = 4.2;
/** Where the blast cuts the core (a share of the floors up): about level with the bridge. */
const CUT = 0.36;
/** How far the top leans over as it comes down (radians). */
const LEAN = 0.38;
/** Where it's watched from, in the tower's frame: the bridge, 75 m along it. */
const VIEWER = new THREE.Vector3(42, 36, -75);
/** It leans across your view, toward the bridge. */
const FALL = new THREE.Vector3(0.87, 0, 0.49);
/** The dust off the blast, rolling out across the bridge (+x). */
const SURGE = { puffs: 9, speed: 14 };
/** The night it's lit by: the burning sky, the fires below (linear RGB). */
const LIGHT = { ambient: [0.07, 0.05, 0.05], key: [0.2, 0.15, 0.13], keyDir: new THREE.Vector3(0.3, 1, 0.4), fire: [0.6, 0.26, 0.08] };

export class DemolitionTower {
  /**
   * @param {object} [o]
   * @param {number} [o.floors]   storeys (the root is at the base)
   * @param {number} [o.width]    footprint, metres (square)
   * @param {number} [o.interval] seconds between floors going
   * @param {"high"|"medium"|"low"} [o.quality]
   */
  constructor({ floors = 24, width = 22, interval = 0.11, quality = "high" } = {}) {
    this.floors = floors;
    this.width = width;
    this.interval = interval;
    this.height = floors * FLOOR_HEIGHT;
    this.root = new THREE.Group();
    this.root.name = "DemolitionTower";
    this.fx = new DemolitionFX({ quality, fogScale: 0.7, light: LIGHT });
    this.building = new DemolitionBuilding({
      fx: this.fx, width, depth: width, floors, floorHeight: FLOOR_HEIGHT, top: this.height, bottom: -260,
      seed: 13, lit: 0.36, name: "DemolitionTowerSlabs",
    });
    this.building.onEvent = (name, info) => this._on(name, info);
    this.root.add(this.building.root, this.fx.root);

    this.time = 0;
    this.started = false;
    this.state = { floorsGone: 0, whole: 0, sink: 0, done: false };
    /** The two faces that face the viewer (0..3 = +x, +z, -x, -z). */
    this.towardFaces = [0, 3];
    this.onFloor = null; // (index) => {} - for sound and shake
    this.onWhole = null; // () => {}
  }

  /** Light the charges: floor by floor from the bottom, then the blast. */
  detonate() {
    if (this.started) return;
    this.started = true;
    this.time = 0;
    this.root.updateMatrixWorld();
    this.building.detonate({
      interval: this.interval, cut: CUT, lean: LEAN, fall: FALL, blowouts: 0.12,
      viewer: this.root.localToWorld(VIEWER.clone()),
    });
  }

  /** Seconds from detonate() to the blast. */
  get wholeDelay() {
    return this.floors * this.interval + BLAST_DELAY;
  }

  /** Glass and debris raining past `follow` (the camera), dust blowing across from the tower. */
  fallout(follow, seconds = 7) {
    const from = VIEWER.clone().negate().setY(0).normalize();
    return this.fx.fallout(follow, { seconds, from });
  }

  _on(name, info) {
    if (name === "charge") {
      this.state.floorsGone = info.floor + 1;
      this.onFloor?.(info.floor);
    } else if (name === "blast") {
      this._surge();
      this.onWhole?.();
    }
  }

  /** The blast's dust, out of the bridge-side face and across the bridge. */
  _surge() {
    const fx = this.fx;
    const y = (Math.round(this.floors * CUT) + 1) * FLOOR_HEIGHT;
    for (let k = 0; k < fx.n(SURGE.puffs, 4); k += 1) {
      const p = this.root.localToWorld(new THREE.Vector3(this.width / 2 + 2, y + (Math.random() - 0.3) * 12, (Math.random() - 0.5) * this.width * 1.4));
      const v = new THREE.Vector3(1, 0.05, (Math.random() - 0.5) * 0.6).normalize().multiplyScalar(SURGE.speed * (0.6 + Math.random() * 0.6));
      fx.dust(p, { velocity: v, size: [10, 34 + Math.random() * 14], life: 9 + Math.random() * 4, drag: 0.18, rise: 0.6, shade: 0.62, warm: 0.45 });
    }
  }

  update(dt, camera = null) {
    if (this.started) this.time += dt;
    this.building.update(dt);
    const s = this.building.state;
    if (s.blown) this.state.whole = THREE.MathUtils.clamp((this.time - this.wholeDelay) / 0.4, 0.01, 1);
    this.state.sink = s.drop;
    this.state.done = s.down;
    this.fx.update(dt, camera);
  }

  dispose() {
    this.building.dispose();
    this.fx.dispose();
    this.root.removeFromParent();
  }
}

export { FLOOR_HEIGHT };
