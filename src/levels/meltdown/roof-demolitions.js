/**
 * The towers round Ascension coming down while you hold the roof (the
 * finale). Vale's charges were never only in his own tower: three of the
 * neighbours are demolished during the fight - one early, one mid-fight,
 * one as the helicopter comes in - and the mid-fight blast catches a
 * police helicopter, which spins down into another tower's facade and
 * leaves it burning. All of it north of the roof, past the parapet the
 * roof camera looks over: in view, and never anywhere near the fight.
 *
 *   const show = new RoofDemolitions({ city, police, quality, sfx, audio, shake });
 *   scene.add(show.root);
 *   show.update(dt, time, roof.state, camera);   // every frame on the roof
 *   show.trigger("collapse");                     // the next one, now (debug); or "crash"
 *   show.dispose();
 *
 * Built from src/fx/demolition.js (the towers, the dust and fire) and
 * src/fx/heli-crash.js. The towers stand from the start, lit like the rest
 * of the city (whose own towers are cleared from where they stand).
 */

import * as THREE from "../../three.js";
import { DemolitionFX, DemolitionBuilding } from "../../fx/demolition.js";
import { HeliCrash } from "../../fx/heli-crash.js";

/**
 * The towers (roof frame: the camera looks north, -Z). `at` is roof time
 * in seconds, or a share of the helicopter's (hidden) arrival time.
 */
const TOWERS = [
  // Early: left of the helipad.
  { key: "early", x: -29, z: -97, top: 14, width: 30, depth: 22, floors: 16, yaw: 0.06, seed: 3, cut: 0.45 },
  // Mid-fight, straight ahead and further out: the blast that downs the helicopter.
  { key: "mid", x: 9, z: -138, top: 16, width: 34, depth: 26, floors: 18, yaw: -0.04, seed: 7, cut: 0.48 },
  // As the helicopter comes in, off to the north-west (it flies in over it).
  { key: "late", x: -60, z: -104, top: 16, width: 28, depth: 22, floors: 16, yaw: 0.1, seed: 11, cut: 0.45 },
];
/** The tower the helicopter goes into, north-east: it stands, and burns. */
const TARGET = { key: "target", x: 47, z: -113, top: 10, width: 24, depth: 20, floors: 13, yaw: 0, seed: 5 };
/**
 * The roof camera sees the city only past the north parapet: a band along
 * the top of the screen, between the HUD's corners and over the lift hut.
 * Everything here is placed to happen in it (for a player near the middle
 * of the roof), and the city's own towers are cleared from round them and
 * from these sightlines.
 */
const SIGHTLINES = [{ x: -36, z: -62, r: 20 }, { x: 12, z: -70, r: 16 }, { x: 30, z: -80, r: 14 }];
/** Seconds into the fight (endless: no helicopter to time them by). */
const EARLY_AT = 11;
const ENDLESS_AT = { mid: 40, late: 75 };
/** The mid-fight one: this share of the helicopter's time, but not before / too near it. */
const MID_SHARE = 0.5;
const MID_EARLIEST = 22;
/** The last: this many seconds before the helicopter is over the roof. */
const LATE_LEAD = 6;
/** The helicopter gets into place this long before the mid tower's charges. */
const CRASH_LEAD = 3.4;
/** Where it holds (low, in front of the mid tower), and how high on the target's facade it goes in. */
const CRASH_STAGE = new THREE.Vector3(-11, -8, -101);
const CRASH_HEIGHT = -10;
/** Clear of the city's own towers round each of these (metres past the footprint). */
const CLEAR_MARGIN = 6;

export class RoofDemolitions {
  /**
   * @param {object} o
   * @param {import("./city.js").CityAtNight} [o.city]   its towers are cleared where these stand
   * @param {import("../../fx/police-helicopters.js").PoliceHelicopters} [o.police]  one is lent for the crash
   * @param {"high"|"medium"|"low"} [o.quality]
   * @param {boolean} [o.endless]
   * @param {object} [o.sfx]     Level1Audio (explosion, buildingCollapse, demolitionCharges, metalGroan, debrisFall)
   * @param {object} [o.audio]   MeltdownAudio (the synthesized fallbacks)
   * @param {(amount:number) => void} [o.shake]
   */
  constructor({ city = null, police = null, quality = "high", endless = false, sfx = null, audio = null, shake = null } = {}) {
    this.root = new THREE.Group();
    this.root.name = "RoofDemolitions";
    this.fx = new DemolitionFX({
      quality,
      // The roof's moon (roof.js) and the city's glow from below.
      light: { keyDir: new THREE.Vector3(-30, 60, -20) },
    });
    this.root.add(this.fx.root);
    this.endless = endless;
    this.police = police;
    this.sfx = sfx;
    this.audio = audio;
    this.shake = shake ?? (() => {});
    this.towers = {};
    for (const spec of [...TOWERS, TARGET]) {
      const b = new DemolitionBuilding({
        fx: this.fx, position: new THREE.Vector3(spec.x, 0, spec.z), yaw: spec.yaw, width: spec.width, depth: spec.depth,
        floors: spec.floors, top: spec.top, bottom: -420, seed: spec.seed, lit: 0.34, name: `Demolition-${spec.key}`,
      });
      b.spec = spec;
      b.onEvent = (name, info) => this._onTower(b, name, info);
      this.root.add(b.root);
      this.towers[spec.key] = b;
      city?.clearAround(spec.x, spec.z, Math.hypot(spec.width, spec.depth) / 2 + CLEAR_MARGIN);
    }
    for (const c of SIGHTLINES) city?.clearAround(c.x, c.z, c.r);
    this.crash = null;
    this._lent = -1;
    this._camera = null;
    this._fired = new Set();
  }

  /** When each happens, from the roof's clock and the helicopter's time. */
  _schedule(state) {
    if (this.endless || !Number.isFinite(state.heliAt)) return { early: EARLY_AT, mid: ENDLESS_AT.mid, late: ENDLESS_AT.late };
    const heli = state.heliAt;
    const mid = THREE.MathUtils.clamp(heli * MID_SHARE, MID_EARLIEST, Math.max(MID_EARLIEST, heli - 16));
    return { early: Math.min(EARLY_AT, mid - 8), mid, late: Math.max(mid + 10, heli - LATE_LEAD) };
  }

  /**
   * @param {number} dt
   * @param {number} time
   * @param {object} state    the roof's state ({ time, heliAt, heliArrived, ending })
   * @param {THREE.Camera} [camera]
   * @param {number} [height]  the drawing height, pixels (the glints' minimum size)
   */
  update(dt, time, state, camera = null, height = 720) {
    this._camera = camera;
    if (state && state.ending !== "left") {
      const when = this._schedule(state);
      const t = state.time;
      if (t >= when.early) this._go("early");
      if (t >= when.mid - CRASH_LEAD) this._startCrash();
      if (t >= when.mid) this._go("mid");
      if (t >= when.late || state.heliArrived) this._go("late");
    }
    for (const b of Object.values(this.towers)) b.update(dt);
    this.crash?.update(dt);
    this.fx.update(dt, camera, height);
  }

  /** Demolish one (once). */
  _go(key) {
    if (this._fired.has(key)) return;
    this._fired.add(key);
    const b = this.towers[key];
    // Watched from the roof: the bursts face it; the tops go over sideways.
    b.detonate({ viewer: new THREE.Vector3(0, 10, 12), cut: b.spec.cut, lean: 0.32 });
  }

  /** Borrow a police helicopter and bring it in to hold by the mid tower. */
  _startCrash() {
    if (this._fired.has("crash")) return;
    this._fired.add("crash");
    const index = this.police?.craft.length > 1 ? 1 : 0;
    const craft = this.police?.release(index);
    if (!craft) return;
    this._lent = index;
    const target = this.towers.target;
    const at = this.crashPoint;
    this.crash = new HeliCrash({ fx: this.fx, craft });
    this.crash.onEvent = (name, info) => this._onCrash(name, info);
    this.crash.start({ stage: CRASH_STAGE, target: at, building: target, look: new THREE.Vector3(0, 0, 0), approach: CRASH_LEAD - 0.4 });
  }

  /** Where the helicopter goes in: the target's west face (toward it, and the roof), toward the front. */
  get crashPoint() {
    const spec = this.towers.target.spec;
    return new THREE.Vector3(spec.x - spec.width / 2 - 0.2, CRASH_HEIGHT, spec.z + spec.depth * 0.25);
  }

  /** Left/right in the mix, from where it is against the camera. */
  _pan(position) {
    const c = this._camera?.position;
    return c && position ? THREE.MathUtils.clamp((position.x - c.x) / 70, -0.9, 0.9) : 0;
  }

  _onTower(b, name, info) {
    const pan = this._pan(info.position ?? b.root.position);
    if (name === "charges") this.sfx?.demolitionCharges(0.8);
    else if (name === "blast") {
      if (this.sfx) this.sfx.explosion(0.9, pan);
      else this.audio?.crash(0.6);
      this.shake(0.22);
      // The mid tower's blast catches the helicopter holding off it.
      if (b === this.towers.mid) this.crash?.hit();
    } else if (name === "collapse") {
      this.sfx?.buildingCollapse(1);
      this.sfx?.metalGroan(0.9, pan);
      this.audio?.distantCollapse?.(0.7);
      this.shake(0.32);
    } else if (name === "crush" && info.floor % 3 === 0) {
      this.sfx?.debrisFall(0.55, pan);
      this.shake(0.06);
    }
  }

  _onCrash(name, info) {
    const pan = this._pan(info.position);
    if (name === "hit") {
      this.sfx?.explosion(0.7, pan);
      this.sfx?.metalGroan(1, pan);
      this.shake(0.12);
    } else if (name === "impact") {
      if (this.sfx) this.sfx.explosion(1.1, pan);
      else this.audio?.crash(1);
      this.sfx?.debrisFall(0.8, pan);
      this.sfx?.glassCascade(0.7);
      this.shake(0.45);
    }
  }

  /** Debug: the next demolition (or the crash, whole: in, hit, down) now. */
  trigger(what = "collapse") {
    if (what === "crash") {
      this._startCrash();
      if (!this.crash || this.crash.phase === "done") return false;
      if (this.crash.phase !== "spin") {
        this.crash.craft.holder.position.copy(CRASH_STAGE);
        this.crash.hit();
      }
      return true;
    }
    const next = ["early", "mid", "late"].find((key) => !this._fired.has(key));
    if (next) this._go(next);
    return next ?? null;
  }

  dispose() {
    this.crash?.dispose();
    // The borrowed helicopter goes back to circling (the police outlive the roof).
    if (this._lent >= 0) this.police?.restore(this._lent);
    for (const b of Object.values(this.towers)) b.dispose();
    this.fx.dispose();
    this.root.removeFromParent();
  }
}
