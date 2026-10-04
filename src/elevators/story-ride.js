/**
 * The Gravity Fault ride in the story (Phase 3, docs/story-phases-plan.md).
 *
 * The ride (gravity-fault.js) plays exactly as before unless it is built with
 * `story`; then this director takes over three things and leaves the rest
 * (the tremor, the snap, the free fall, the brakes, every camera) alone:
 *
 *   - Dr. Okoro rides with you, holding the launcher. The cable snap jolts it
 *     out of his hands; it floats in the free fall and clatters down when the
 *     brakes slam. Picking it up is a reaction (one key), not a timer.
 *   - The brake clamps are reaction hits instead of aiming and shooting,
 *     harder each time (reactionLadder: one key, two together, three in
 *     order, four in order then mash to hold the last one). Each success
 *     still fires the launcher at that clamp and changes the camera, so the
 *     brief's "shoot the stabilisers" stays visibly true.
 *   - Miss one and the last cable gives: the cabin drops, red, black - then
 *     you are back just before that clamp, with the earlier ones still
 *     locked and the cabin where it was.
 *
 *   new GravityFaultRide({ ..., story: { layer, okoroTemplate } });
 */

import * as THREE from "../three.js";
import { Companion } from "../story/companion.js";
import { SCENES } from "../story/script.js";
import { REACTION_KEYS, reactionLadder } from "../story/reaction.js";
import { MARK } from "./diagnostic.js";

/** Seconds from a clamp's shout to its reaction. */
const SHOUT_LEAD = 0.9;
/** Seconds between one clamp locking and the next shout. */
const BETWEEN = 1.1;
/** The fall after a miss: seconds before black, and before the retry. */
const FALL_BLACK = 1.2;
const FALL_RETRY = 2.3;
/** Slow motion while a reaction is up. */
const REACTION_SLOW = 0.3;

const _v = new THREE.Vector3();
const _ndc = new THREE.Vector3();

export class StoryRideDirector {
  /**
   * @param {import("./gravity-fault.js").GravityFaultRide} ride
   * @param {object} o
   * @param {import("../story/story-layer.js").StoryLayer} o.layer
   * @param {THREE.Object3D} [o.okoroTemplate]  Okoro's model (stand-in without it)
   * @param {() => number} [o.rng]
   */
  constructor(ride, { layer, okoroTemplate = null, rng = Math.random }) {
    this.ride = ride;
    this.layer = layer;
    this.reactions = layer.reactions;
    this.rng = rng;
    this.fade = 0;
    this.timeScale = 1;
    /** "ride" | "pickup" | "picked" | "clamp" | "fall" | "saved" */
    this.stage = "ride";
    this.clamp = 0;
    this.wait = 0;
    this.fall = null;
    this.snapshot = null;
    this.log = [];
    this.saved = false;
    this.fails = 0;

    // Okoro, in the cabin, holding the launcher.
    const okoro = new Companion({ bag: true });
    okoro.setModel(okoroTemplate);
    okoro.root.position.set(0.95, 0, -0.85);
    okoro.root.rotation.y = -2.4; // toward the doors and the player
    ride.cabin.root.add(okoro.root);
    this.okoro = okoro;
    okoro.act("hold");
    const launcher = ride.launcher;
    launcher.root.visible = true;
    okoro.hold(launcher.root, { hand: "R", offset: [0, 0.05, -0.25] });
    this.holding = true;
    // When it comes down with the brakes: the clatter.
    ride.events.on("launcher-land", () => {
      if (this._clattered) return;
      this._clattered = true;
      this._say(SCENES.liftFault[2]);
    });
  }

  /** Lines through the story layer's subtitles. */
  _say(line) {
    this.layer.talk(line);
    this.log.push(["line", line.who, line.text]);
  }

  /** A phase begins (called from the ride's _enter). */
  enter(name) {
    const ride = this.ride;
    const f = SCENES.liftFault;
    if (name === "tremor") this._say(f[0]);
    else if (name === "freefall") {
      this._say(f[1]);
      this._dropLauncher();
      this.okoro.act("crouch");
    } else if (name === "brake") {
      this.okoro.act("crouch");
    } else if (name === "launcher") {
      this._say(f[3]);
      this.okoro.act("point");
      this.stage = "pickup";
      this.wait = 1.0;
    } else if (name === "clamps") {
      ride.hud.alert("BRAKES SLIPPING // HIT THE PROMPTS", "danger");
      this.stage = "clamp";
      this.clamp = 0;
      this._queueClamp();
    } else if (name === "resume") {
      this.okoro.act("idle");
    }
  }

  /** The cable snap jolts the launcher out of his hands: weightless, it floats. */
  _dropLauncher() {
    if (!this.holding) return;
    this.holding = false;
    const launcher = this.ride.launcher;
    this.okoro.drop(launcher.root, this.ride.cabin.root);
    launcher.root.updateMatrixWorld(true);
    launcher.drop(launcher.root.position.clone(), new THREE.Vector3(-0.7, 0.5, 0.5));
    this.log.push(["event", "drop"]);
  }

  /**
   * Hold the ride's clock inside a phase while the story waits on a
   * reaction. Returns the phase time to use.
   */
  clampTime(name, pt) {
    if (name === "launcher" && (this.stage === "pickup")) return Math.min(pt, 1.2);
    return pt;
  }

  /** One frame: returns the ride's time scale (slow motion during a reaction). */
  update(dt) {
    const ride = this.ride;
    const r = this.reactions;
    // The reaction clock runs in real time; the world crawls. (A key press
    // can finish it between frames, so read the result, not just "running".)
    if (this.watching) {
      const result = r.update(dt);
      if (result === "success" || result === "fail") {
        this.watching = false;
        if (result === "success") this._success();
        else this._fail(r.failReason);
      }
    }
    this.timeScale = r.running ? REACTION_SLOW : 1;

    if (this.stage === "pickup" && !r.running && ride.phase === "launcher") {
      this.wait -= dt;
      if (this.wait <= 0 && ride.state.pt >= 1.15) {
        this._start("pickup", { kind: "press", keys: [REACTION_KEYS[Math.floor(this.rng() * REACTION_KEYS.length)]], window: 2.4, label: "PICK IT UP" });
      }
    } else if (this.stage === "clamp" && !r.running && this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this._start(`clamp-${this.clamp}`, reactionLadder(this.clamp, this.rng));
    } else if (this.stage === "fall") {
      this._updateFall(dt);
    }

    // Okoro: toward whatever matters now.
    const o = this.okoro;
    if (this.stage === "pickup" || this.stage === "picked") {
      o.lookAt(ride.launcher.root.getWorldPosition(_v), 0.9);
    } else if (this.stage === "clamp") {
      const c = ride.clamps.clamps[Math.min(this.clamp, 2)];
      o.lookAt(ride.clamps.worldPosition(c, _v), 0.9);
      o.act(this.clamp < 3 ? "point" : "hold");
    } else if (this.stage === "saved") {
      o.lookAt(ride.camera.position, 0.8);
    } else if (ride.phase === "climb" || ride.phase === "tremor") {
      o.lookAt(ride.camera.position, 0.5);
    }
    o.update(dt * (r.running ? REACTION_SLOW : 1));
    return this.timeScale;
  }

  _start(id, spec) {
    // Remember where everything was, for a retry of this one.
    const ride = this.ride;
    this.snapshot = { cabinY: ride.state.cabinY, locked: ride.clamps.clamps.map((c) => c.locked) };
    this.current = id;
    this.watching = true;
    this.reactions.start(spec);
    this.log.push(["reaction-start", id, spec.kind, spec.keys?.length ?? 0, spec.window ?? spec.time]);
  }

  _success() {
    const ride = this.ride;
    const id = this.current;
    this.log.push(["reaction-success", id]);
    if (id === "pickup") {
      this.stage = "picked";
      // On with the ride's own pickup: notice, step over, crouch, grab.
      ride.state.pt = Math.max(ride.state.pt, 1.45);
      this.okoro.act("talk");
      return;
    }
    const i = this.clamp;
    if (i < 3) {
      // The launcher fires at the clamp - the ball locks it (the ride's own
      // lock: sparks, shake, and the camera moves on).
      this._fireAt(i);
      this.clamp += 1;
      this._queueClamp(BETWEEN);
    } else {
      // The last one: the brakes catch.
      this.saved = true;
      this.stage = "saved";
      ride.state.velocity = 0;
      ride.shake.add(0.6);
      ride.hud.alert("BRAKES HOLDING", "good");
      ride.result.bonus = ride.result.stabilised * 400 + 800;
      ride.events.emit("clamps-locked", { bonus: ride.result.bonus, story: true });
      for (const line of SCENES.liftSaved) this._say(line);
      this.okoro.act("talk");
      this.wait = 0;
      this._savedAt = ride.state.pt;
    }
  }

  /** The next clamp: Okoro shouts, then the prompt comes up. */
  _queueClamp(delay = 0) {
    if (this.clamp > 3) return;
    const shout = SCENES.liftBreaks[this.clamp];
    this.wait = delay + SHOUT_LEAD;
    this._shoutIn = delay;
    if (shout) {
      if (delay <= 0) this._say(shout);
      else this._pendingShout = { line: shout, in: delay };
    }
  }

  /** Fire the launcher at clamp i (a real ball, from the muzzle, through the clamps' own hit test). */
  _fireAt(i) {
    const ride = this.ride;
    const clamp = ride.clamps.clamps[i];
    if (!clamp || clamp.locked) return;
    const from = new THREE.Vector3();
    if (ride.launcher.state === "held") ride.launcher.root.localToWorld(from.set(0, 0, -0.7));
    else ride.cabin.root.localToWorld(from.set(0, 1.4, 0));
    // Straight at it (the reaction was the aim): a ball through the clamps'
    // own flight and hit test, so it locks the way a shot one does.
    const clamps = ride.clamps;
    const mesh = new THREE.Mesh(clamps._ballGeo, clamps._ballMat);
    mesh.layers.enable(MARK);
    mesh.position.copy(from);
    clamps.world.add(mesh);
    // 15 m/s: under the hit radius per frame even at 30 fps, so it can't
    // step over the clamp between frames.
    const velocity = clamps.worldPosition(clamp, _ndc).sub(from).normalize().multiplyScalar(15);
    clamps.balls.push({ mesh, velocity, life: 1.5 });
    ride.launcher.recoil = 1;
    ride.shake.add(0.08);
    ride.events.emit("clamp-shot", { assisted: true, story: true });
  }

  _fail(reason) {
    const id = this.current;
    this.fails += 1;
    this.log.push(["reaction-fail", id, reason]);
    if (id === "pickup") {
      // Fumbled it: a beat, and reach again.
      this.wait = 0.8;
      return;
    }
    // A clamp missed: the last cable gives.
    this.stage = "fall";
    this.fall = { t: 0 };
    const ride = this.ride;
    ride.state.lights = { main: 0, a: 0, b: 0, red: 1 };
    ride.state.flash = 1;
    ride.shake.add(0.9);
    ride.debris.jolt(0.8);
    ride.hud.alert("CABLE FAILURE", "danger");
    this._say(SCENES.liftFall[0]);
    this.layer.ui.setTint(0.85);
    ride.events.emit("cable-snap", { story: true });
  }

  _updateFall(dt) {
    const f = this.fall;
    const ride = this.ride;
    f.t += dt;
    ride.state.velocity -= 9.8 * dt;
    ride.shake.floor = 0.35;
    this.fade = Math.min(1, Math.max(0, (f.t - FALL_BLACK) / 0.5));
    this.layer.ui.setTint(Math.max(0, 0.85 - f.t * 0.3));
    if (f.t >= FALL_RETRY) this.retry();
  }

  /** Back to just before the missed clamp: its height, the earlier clamps still locked. */
  retry() {
    const ride = this.ride;
    const snap = this.snapshot;
    if (snap) {
      ride.state.cabinY = snap.cabinY;
      ride.clamps.clamps.forEach((c, i) => {
        c.locked = snap.locked[i];
        if (!c.locked) c.lockT = 0;
      });
    }
    ride.state.velocity = 0;
    ride.state.lights = { main: 0.6, a: 1, b: 0, red: 1 };
    ride.shake.floor = 0;
    ride._place(ride.state.cabinY);
    this.fall = null;
    this.stage = "clamp";
    this.layer.ui.setTint(0);
    ride.hud.alert("BRAKES SLIPPING // HIT THE PROMPTS", "danger");
    this._fadeBack = 0.5;
    this.log.push(["retry", this.current]);
    this._queueClamp(0.5);
  }

  /**
   * Per-frame clamps work in the story (instead of the shooting version's):
   * the slipping, the sparks, the fade back after a retry, and the end.
   */
  clampsBeat(pt, dt, time) {
    const ride = this.ride;
    const s = ride.state;
    if (this._pendingShout) {
      this._pendingShout.in -= dt;
      if (this._pendingShout.in <= 0) {
        this._say(this._pendingShout.line);
        this._pendingShout = null;
      }
    }
    if (this._fadeBack > 0) {
      this._fadeBack = Math.max(0, this._fadeBack - dt);
      this.fade = this._fadeBack / 0.5;
    } else if (this.stage !== "fall") this.fade = 0;
    ride.hud.setClamps(ride.clamps.locked, 3, null);
    if (this.stage === "fall") return;
    s.lights.main = 0.4 + 0.3 * flicker(time);
    if (this.saved) {
      s.velocity *= Math.max(0, 1 - dt * 6);
      ride.shake.floor = 0;
      // A few seconds to hear him out, then on up.
      if (pt - this._savedAt > 5.2) s.pt = Math.max(s.pt, ride.phases[s.phaseIndex][1]);
      return;
    }
    // Slipping: sinking in jerks while any brake is loose.
    const slip = Math.max(0.25, (3 - ride.clamps.locked) / 3);
    s.velocity = -0.7 * slip * (0.6 + 0.4 * Math.abs(Math.sin(pt * 7)));
    ride.shake.floor = 0.1 * slip;
    for (const c of ride.clamps.clamps) {
      if (c.locked || Math.random() > dt * 30) continue;
      ride.sparks.emit(ride.clamps.worldPosition(c, _v), 3, { direction: new THREE.Vector3(0, -1, 0), spread: 0.8, speed: 4 });
    }
    ride._act((p) => {
      const c = ride.clamps.clamps.find((k) => !k.locked);
      if (c) p.attention = p.yawTo(c.root.position.x, c.root.position.z);
    });
  }

  dispose() {
    this.reactions.cancel();
    this.okoro.dispose();
  }
}

function flicker(time) {
  const a = Math.sin(time * 23 + 2.2) + Math.sin(time * 37 + 3.7) + Math.sin(time * 5.3 + 6.8);
  return a > 0.4 ? 1 : a > -0.6 ? 0.25 : 0;
}
