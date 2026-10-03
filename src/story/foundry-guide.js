/**
 * Dr. Okoro in the Foundry (Phase 2): he runs a few metres ahead of the
 * player, on whichever lane is free, talks as the run goes on, hands over the
 * glass spheres, points out the first switch, and waits for the player in
 * the Calibration Lift at the end.
 *
 *   const guide = new FoundryGuide({ okoro, level: foundry, lift: foundryLift });
 *   guide.start(playerDistance);
 *   // each frame of the run:
 *   const out = guide.update(dt, { distance, speed, lane, exiting });
 *   for (const line of out.lines) story.talk(line);
 *   if (out.cues.includes("handoff")) ammo += 12;
 *
 * He is never hit by anything: the level's own collision test is only used
 * to *find* a free lane. Lead eases between 4 and 7 m (3-8 m guaranteed).
 * When every lane ahead is shut (a gate the player has not opened yet) he
 * stops short of it and points at the switch.
 */

import * as THREE from "../three.js";
import { SCENES } from "./script.js";

const LANES = [-3.2, 0, 3.2];
const LEAD = { min: 4, max: 7, talk: 4.4, rest: 5.4, handoff: 3.4 };
/** He checks this far ahead of himself when choosing a lane. */
const LOOK = [0, 2.5, 5, 7.5];
const LANE_SPEED = 5.5;

const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _size = new THREE.Vector3(1.1, 1.7, 1.6);
const _p = new THREE.Vector3();

export class FoundryGuide {
  /**
   * @param {object} o
   * @param {import("./companion.js").Companion} o.okoro
   * @param {object} o.level   the FoundryLevel (route, collide, breakables)
   * @param {import("../levels/common/calibration-lift.js").CalibrationLift} [o.lift]
   * @param {object[]} [o.lines]  SCENES.foundryTalk
   * @param {boolean} [o.talk]    false: no lines (already heard this session)
   * @param {object} [o.options]  for other levels (the Labs):
   *   lead: {min, max, rest, talk, handoff} metres;
   *   blocked: "wait" (stop short of a shut gate - the Foundry) or "vault"
   *     (go over it - the Labs' lasers and gaps, which nobody can stop for);
   *   avoidPlayerWithin: keep out of the player's lane while closer than this
   */
  constructor({ okoro, level, lift = null, lines = SCENES.foundryTalk, talk = true, options = {} }) {
    this.okoro = okoro;
    this.level = level;
    this.lift = lift;
    this.lines = lines;
    this.talkOn = talk;
    this.leads = { ...LEAD, ...(options.lead ?? {}) };
    this.blocked = options.blocked ?? "wait";
    this.avoidPlayerWithin = options.avoidPlayerWithin ?? 0;
    this.height = 0;
    this.said = new Set();
    this.d = 0;
    this.lateral = 0;
    this.lane = 1;
    this.lead = this.leads.rest;
    this.mode = "run"; // "run" | "wait" (at a shut gate) | "lift" | "inLift"
    this.point = 0;
    this.handoff = 0;
    this.laneTimer = 0;
    this.trace = []; // [playerDistance, okoroDistance, lateral] per metre, for tests
    this._lastTrace = -1;
  }

  /** Put him `lead` metres ahead of the player, in the middle lane. */
  start(playerDistance, { lateral = 0 } = {}) {
    this.d = playerDistance + this.lead;
    this.lateral = lateral;
    this.lane = LANES.indexOf(LANES.reduce((a, b) => (Math.abs(b - lateral) < Math.abs(a - lateral) ? b : a)));
    this.mode = "run";
    this._place(0);
  }

  /**
   * Is there nothing to run into at (lane x, route distance d)? Height is
   * ignored: a piston that is up now will be down by the time he is under
   * it, and he doesn't jump barriers - so anything over the lane blocks it.
   */
  free(x, d) {
    const level = this.level;
    level.route.sample(d, x, 0.95, _c);
    _box.setFromCenterAndSize(_c, _size);
    _box.min.y = -1e4;
    _box.max.y = 1e4;
    for (const entry of level._hazardIndex ?? []) {
      if (Math.abs(entry.distance - d) > 10) continue;
      const mesh = entry.mesh;
      if (!mesh.visible || mesh.userData.disabled) continue;
      mesh.updateWorldMatrix(true, false);
      entry.box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (entry.box.intersectsBox(_box)) return false;
    }
    return true;
  }

  _laneFree(x, d) {
    return LOOK.every((k) => this.free(x, d + k));
  }

  /**
   * @param {number} dt
   * @param {object} p
   * @param {number} p.distance  the player's route distance
   * @param {number} p.speed     the player's speed (m/s)
   * @param {number} p.lane      the player's lane index
   * @param {boolean} [p.exiting]  past the end: run for the lift
   * @param {boolean} [p.riding]   the lift is riding up
   * @param {number} [p.playerLateral]  the player's lateral offset (for avoidPlayerWithin)
   * @returns {{lines: object[], cues: string[]}}
   */
  update(dt, { distance, speed, lane = 1, exiting = false, riding = false, playerLateral = null }) {
    const LEAD = this.leads;
    const out = { lines: [], cues: [] };
    const o = this.okoro;
    const total = this.level.route.totalLength;

    // Talk: lines by route progress.
    if (this.mode !== "inLift") {
      const progress = distance / total;
      for (const line of this.lines) {
        if (this.said.has(line) || progress < line.atRoute) continue;
        this.said.add(line);
        if (this.talkOn) out.lines.push(line);
        if (line.cue) out.cues.push(line.cue);
        if (line.cue === "point") this.point = 2.6;
        if (line.cue === "handoff") this.handoff = 1.6;
      }
    }

    if (riding && this.lift) {
      this.mode = "inLift";
      this._standInLift(dt, true);
      return out;
    }
    if ((exiting || distance + this.lead > total - 1) && this.lift) {
      this._toLift(dt, speed);
      return out;
    }

    this.point = Math.max(0, this.point - dt);
    this.handoff = Math.max(0, this.handoff - dt);

    // How far ahead: closer while he talks or hands something over.
    const leadTarget = this.handoff > 0 ? LEAD.handoff : this.point > 0 ? LEAD.talk : LEAD.rest;
    this.lead += (leadTarget - this.lead) * Math.min(1, dt * 1.6);
    let want = distance + THREE.MathUtils.clamp(this.lead, this.handoff > 0 ? 3.2 : LEAD.min, LEAD.max);

    // Lanes: keep his own while it stays clear, else the nearest clear one -
    // and, where asked, never the player's own while he is close to them.
    this.laneTimer -= dt;
    const here = LANES[this.lane];
    const near = this.avoidPlayerWithin > 0 && playerLateral !== null && this.d - distance < this.avoidPlayerWithin;
    const playerLane = playerLateral === null ? lane : LANES.indexOf(LANES.reduce((a, b) => (Math.abs(b - playerLateral) < Math.abs(a - playerLateral) ? b : a)));
    const ok = (i) => !(near && i === playerLane);
    if (this.laneTimer <= 0 || !this.free(here, this.d) || !this.free(here, this.d + 2.5) || !ok(this.lane)) {
      this.laneTimer = 0.2;
      if (!this._laneFree(here, this.d) || !ok(this.lane)) {
        const order = [0, 1, 2].sort((a, b) => Math.abs(a - this.lane) - Math.abs(b - this.lane) || Math.abs(b - lane) - Math.abs(a - lane));
        const pick = order.find((i) => ok(i) && this._laneFree(LANES[i], this.d)) ?? order.find((i) => ok(i));
        if (pick !== undefined) this.lane = pick;
      }
    }

    // A shut gate ahead in every lane: stop short of it (or, where nobody
    // can stop - the Labs - go over it).
    const step = Math.max(0, want - this.d);
    const maxStep = (speed + 4) * dt;
    let next = this.d + Math.min(step, maxStep);
    let vaulting = false;
    if (!this.free(LANES[this.lane], next + 1.2)) {
      const free = LANES.some((x) => this.free(x, next + 1.2));
      if (!free) {
        if (this.blocked === "wait") next = this.d;
        else vaulting = true;
      }
    }
    // A vault: a quick hop over whatever it is.
    this.height += ((vaulting ? 1.1 : 0) - this.height) * Math.min(1, dt * (vaulting ? 10 : 6));
    const moved = next - this.d;
    this.d = Math.max(this.d, next);
    this.mode = moved > 1e-4 ? "run" : "wait";

    // Sideways toward the lane: quick, but a step, not a teleport.
    const target = LANES[this.lane];
    const dx = target - this.lateral;
    this.lateral += Math.sign(dx) * Math.min(Math.abs(dx), LANE_SPEED * dt);

    // Pose.
    const runSpeed = dt > 0 ? moved / dt : 0;
    if (this.mode === "wait") {
      o.act("point");
      o.lookAt(this._nextSwitch(this.d), 0.8);
    } else {
      o.act("run");
      o.speed = runSpeed;
    }
    o.adjust.aimR += ((this.point > 0 && this.mode === "run" ? 1 : 0) - o.adjust.aimR) * Math.min(1, dt * 6);
    // The hand-off on the run: he turns back to you, arm out.
    const turn = this.handoff > 0 ? 1 : 0;
    o.adjust.twist += (turn * 0.75 - o.adjust.twist) * Math.min(1, dt * 7);
    o.adjust.aimL += (turn * 0.55 - o.adjust.aimL) * Math.min(1, dt * 7);
    if (this.point > 0 && this.mode === "run") o.lookAt(this._nextSwitch(this.d), 0.7);
    else if (this.handoff > 0) o.lookAt(this.level.route.sample(distance, LANES[lane], 1.6, _p).position, 0.8);
    else if (this.mode === "run") o.lookAt(null);
    this._place(runSpeed);

    // A record per metre for the checks: [player, okoro, okoro lateral].
    const metre = Math.floor(distance);
    if (metre !== this._lastTrace) {
      this._lastTrace = metre;
      this.trace.push([distance, this.d, this.lateral]);
    }
    return out;
  }

  _place(speed) {
    this.okoro.follow(this.level.route, this.d, this.lateral, this.height);
    this.okoro._guideSpeed = speed;
  }

  /** The next switch's glass ahead of route distance d (world position), or a point ahead. */
  _nextSwitch(d) {
    let best = null;
    for (const glass of this.level.breakables) {
      const at = glass.userData.routeDistance;
      if (at === undefined || at < d - 2 || !glass.userData.alive) continue;
      if (!best || at < best.userData.routeDistance) best = glass;
    }
    if (best) return best.getWorldPosition(_p);
    return this.level.route.sample(d + 10, 0, 1.6, _p).position;
  }

  /** Where he waits in the lift: off to one side of the doors, facing out. */
  _liftSpot(target) {
    this.lift.root.updateMatrixWorld();
    return this.lift.root.localToWorld(target.set(-1.7, this.lift.state.cabinY, -1.2));
  }

  /** Past the end of the run: into the Calibration Lift, then turn and wait. */
  _toLift(dt, speed) {
    const o = this.okoro;
    if (this.mode !== "lift" && this.mode !== "inLift") this.mode = "lift";
    if (this.mode === "inLift") {
      this._standInLift(dt, false);
      return;
    }
    const spot = this._liftSpot(_p);
    const pos = o.root.position;
    const to = spot.clone().sub(pos).setY(0);
    const left = to.length();
    const run = Math.max(speed, 6) + 1;
    if (left > 0.15) {
      pos.addScaledVector(to.normalize(), Math.min(left, run * dt));
      o.root.rotation.y = Math.atan2(-to.x, -to.z);
      o.act("run");
      o._guideSpeed = run;
      o.lookAt(null);
    } else this.mode = "inLift";
  }

  /** In the cabin: turned to the doors, beckoning (holding them) until it rides. */
  _standInLift(dt, riding) {
    const o = this.okoro;
    this._liftSpot(o.root.position);
    // Face the doors (local +Z of the lift).
    const want = this.lift.root.rotation.y + Math.PI;
    o.root.rotation.y += (want - o.root.rotation.y) * Math.min(1, dt * 8);
    o.act(riding ? "idle" : "beckon");
    o._guideSpeed = 0;
    o.adjust.aimR = 0;
    o.adjust.twist = 0;
    o.adjust.aimL = 0;
  }

  /** The speed to drive his gait with this frame. */
  get gaitSpeed() {
    return this.okoro._guideSpeed ?? 0;
  }
}
