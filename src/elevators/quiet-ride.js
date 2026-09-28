/**
 * Cutscene 7 - the L2 to L3 elevator (Tebogo's task sheet, new storyline):
 * "The player alone for the first time, holding his equipment, catching
 * their breath. A quiet, powerful beat after cutscene 6."
 *
 * The doors have just closed on the good scientist. Subject 07 stands with
 * their back to the back wall in his vest, with his radio, the launcher
 * leaning on the wall beside them, breathing hard. The lift starts to climb.
 * They slide down the wall and sit, knees up. His radio crackles - the
 * helicopter pilot, asking for the doctor, then telling whoever has the
 * radio how to reach the roof. They get up, pick up the launcher and face
 * the doors. A tremor - the building is still coming apart. A chime; the
 * doors open on daylight.
 *
 * Built on the reusable elevator interior (interior.js), the character's
 * acting (acting.js) and the figure's look (the gear stage). A ride object
 * like GravityFaultRide, so main.js runs it the same way: update(),
 * render(), `fade`, `result.done`, dispose().
 *
 * Events (ride.events.on) for sound: shot, depart, radio, tremor, chime,
 * doors, arrive.
 */

import * as THREE from "../three.js";
import { buildInterior, INTERIOR } from "./interior.js";
import { Owned } from "./kit.js";
import { Performer, disposeAvatar } from "./acting.js";
import { CameraShake } from "./shake.js";
import { LauncherProp } from "./launcher.js";
import { ElevatorHud } from "../ui/elevator-hud.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";

/** The script: [seconds, beat]. See _beat() for what each does. */
const SCRIPT = [
  [0.3, "depart"],
  [1.2, "slide"],
  [5.6, "radio1"],
  [9.6, "radio2"],
  [13.4, "stand"],
  [15.2, "tremor"],
  [17.2, "chime"],
  [17.7, "doors"],
];
export const QUIET_RIDE_SECONDS = 20.4;
const FADE_IN = 0.8;
const FADE_OUT = 0.9;

/** Camera shots: [from seconds, shot]. */
const SHOTS = [
  [0, "corner"],
  [4.0, "low"],
  [6.0, "radio"],
  [11.2, "side"],
  [16.4, "shoulder"],
];

/** The pilot's lines (subtitles; the audio workstream can voice them). */
export const LINES = {
  radio1: ["RADIO", "...Doctor? Doctor, this is Kestrel One. We're on approach. Do you copy?"],
  radio2: ["RADIO", "...Whoever has this radio - the helipad is on the roof, across the skybridge. We can't hold long."],
};

function createEmitter() {
  const listeners = new Map();
  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    emit(name, payload) {
      for (const fn of listeners.get(name) ?? []) fn(payload);
    },
    clear() {
      listeners.clear();
    },
  };
}

const _size = new THREE.Vector2();
const _look = new THREE.Vector3();

export class QuietRide {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {THREE.Object3D} [o.character]  the chosen character's model template
   * @param {{wear:number, gear:boolean, skinTone?:string}} [o.figure]
   * @param {string} [o.assetBase]  Level 3's assets, for his weapon (the launcher model)
   * @param {number} [o.spheres]
   * @param {boolean} [o.reducedMotion]
   * @param {number} [o.fromFloor]  the floor number the ride starts at
   * @param {number} [o.toFloor]    the last number before the skybridge ("SB")
   * @param {() => boolean} [o.waitFor]  the next level is ready: until it is,
   *   the last shot holds (doors open, breathing) instead of fading to black
   */
  constructor({ renderer, character = null, figure = null, assetBase = null, spheres = 0, reducedMotion = false, fromFloor = 12, toFloor = 44, waitFor = null }) {
    this.renderer = renderer;
    this.reducedMotion = reducedMotion;
    this.events = createEmitter();
    this.owned = new Owned();
    this.visible = true;
    /** main.js hides the game's HUD while a cutscene ride plays. */
    this.cutscene = true;
    this.fromFloor = fromFloor;
    this.toFloor = toFloor;
    this.waitFor = waitFor;
    this.held = 0;

    const scene = (this.scene = new THREE.Scene());
    scene.name = "QuietRideScene";
    scene.background = new THREE.Color(0x050505);
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.03, 60);

    this.cabin = buildInterior(this.owned);
    scene.add(this.cabin.root);
    this.cabin.press("SB");

    // Subject 07, with his vest and radio (the gear stage); his weapon leans
    // on the back wall to their left.
    const home = this.cabin.backWall.clone().add(new THREE.Vector3(0.1, 0, 0));
    this._avatar = null;
    this.performer = null;
    this.launcher = new LauncherProp(this.cabin.root, assetBase);
    if (character) {
      const avatar = new PlayerAvatar();
      avatar.hold = 1;
      const f = figure ?? { wear: 0.66, gear: true };
      avatar.setWear(f.wear);
      avatar.setGear(f.gear);
      if (f.skinTone) avatar.setSkinTone(f.skinTone);
      avatar.setModel(character);
      this.cabin.root.add(avatar.root);
      this._avatar = avatar;
      this.performer = new Performer(avatar, { home, reduced: reducedMotion });
      this.performer.scare(1);
      this.performer.setBrace(0.3);
    }
    this.launcher.restAt(
      new THREE.Vector3(home.x - 0.62, 0.6, INTERIOR.halfDepth - 0.2),
      new THREE.Euler(Math.PI / 2 + 0.3, 0, 0.12),
    );
    /** 0 standing, 1 sitting on the floor against the wall. */
    this.sit = 0;
    this.sitTarget = 0;
    this.lookDown = 0;

    this.shake = new CameraShake({ reduced: reducedMotion });
    this.hud = new ElevatorHud({ panel: false });
    this.hud.show();
    this.hud.cinema(true);

    this.t = 0;
    this.fired = new Set();
    this.speed = 0;
    this.lift = 0;
    this.light = 1;
    this.shot = null;
    this.shotT = 0;
    this.fade = 1;
    this.result = { done: false, stabilised: 0, bonus: 0, spheres };
    this.wantsAim = false;
    this.aimTarget = null;
    this.cabin.setFloor(String(fromFloor), null);
  }

  onPointerMove() {}

  fire() {
    return false;
  }

  /** The current camera shot. */
  currentShot() {
    let shot = SHOTS[0][1];
    for (const [at, name] of SHOTS) if (this.t >= at) shot = name;
    return shot;
  }

  update(dt, time) {
    if (this.result.done) return;
    // Hold before the fade-out while the next level is still being built
    // (at most 20 s; then fade anyway and let the game's loading take over).
    const holdAt = QUIET_RIDE_SECONDS - FADE_OUT;
    if (this.t + dt >= holdAt && this.waitFor && !this.waitFor() && this.held < 20) {
      this.held += dt;
      this.t = Math.max(this.t, holdAt - 1e-4);
    } else this.t += dt;
    const t = this.t;
    for (const [at, beat] of SCRIPT) {
      if (t >= at && !this.fired.has(beat)) {
        this.fired.add(beat);
        this._beat(beat);
      }
    }

    // The climb: speeds up, cruises, slows for the skybridge.
    const cruise = 6;
    if (this.fired.has("depart")) {
      const target = t < 16.6 ? cruise : 0;
      this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 1.2 : 2.4));
    }
    this.lift += this.speed * dt;
    const floor = Math.min(this.toFloor, this.fromFloor + Math.floor(this.lift / 3.4));
    this.cabin.setFloor(t >= 17.2 ? "SB" : String(floor), t >= 17.2 ? null : this.speed > 0.3 ? "up" : null);
    this.cabin.update(dt, time, this.speed);

    // The light: steady, a stutter in the tremor.
    const stutter = t > 15.2 && t < 16.4 ? (Math.sin(time * 41) + Math.sin(time * 23) > 0.2 ? 1 : 0.2) : 1;
    this.cabin.setLight(this.light * stutter);
    this.cabin.setDoors(this.fired.has("doors") ? (t - 17.7) / 1.4 : 0);

    // Subtitles clear on their own.
    if (this._captionUntil && t > this._captionUntil) {
      this.hud.caption(null, null);
      this._captionUntil = 0;
    }

    this._pose(dt);
    this.performer?.update(dt, 9.8);
    this.launcher.update(dt, 9.8);
    this.shake.update(dt);

    const fadeOut = THREE.MathUtils.clamp((t - (QUIET_RIDE_SECONDS - FADE_OUT)) / FADE_OUT, 0, 1);
    this.fade = Math.max(1 - t / FADE_IN, fadeOut);
    if (t >= QUIET_RIDE_SECONDS) {
      this.result.done = true;
      this.hud.cinema(false);
      this.events.emit("arrive", { ...this.result });
    }
    this._updateCamera(dt);
  }

  /**
   * Sitting against the wall: the rig's crouch and tuck fold the legs, and
   * the whole body drops so they sit on the floor.
   */
  _pose(dt) {
    const p = this.performer;
    const rate = this.sitTarget > this.sit ? 1.1 : 1.8;
    this.sit += (this.sitTarget - this.sit) * Math.min(1, dt * rate);
    if (!p) return;
    const k = this.sit;
    p.home.y = -0.45 * k;
    if (k < 0.01 && !this.lookDown) {
      p.override = null;
      return;
    }
    p.override = {
      crouch: 0.7 * k,
      tuck: k,
      // Back against the wall; leaning in over the radio to listen.
      lean: -0.3 * k + 0.12 * this.lookDown,
      pitch: -0.18 * this.lookDown,
    };
    // Hands loose while sitting; on the launcher once it is picked up.
    if (!p.holding) Object.assign(p.override, { hold: 0.1 * k, swing: 0.04 });
    // Once they are up again, take the launcher.
    if (this.fired.has("stand") && this.launcher.state === "resting" && k < 0.35 && this._avatar) {
      const w = this._avatar.root.position;
      this.launcher.attach(this._avatar.shoulder, 0.75, new THREE.Vector3(w.x - 0.25, 1.1, w.z - 0.35));
    }
    if (this.launcher.state === "held") p.holding = true;
  }

  _say(key, seconds) {
    const [who, text] = LINES[key];
    this.hud.caption(who, text);
    this._captionUntil = this.t + seconds;
  }

  _beat(beat) {
    const p = this.performer;
    if (beat === "depart") {
      this.shake.add(0.3);
      this.shake.kick(0, -0.04, 0);
      if (p) p.impact = 0.3;
      this.events.emit("depart", {});
    } else if (beat === "slide") {
      // Back against the wall, sliding down it to sit, knees up.
      this.sitTarget = 1;
    } else if (beat === "radio1") {
      this._say("radio1", 3.6);
      // Looks down at the radio on the vest, listening.
      this.lookDown = 1;
      if (p) p.look(-0.25, 7.5);
      this.events.emit("radio", { line: 1 });
    } else if (beat === "radio2") {
      this._say("radio2", 3.8);
      this.events.emit("radio", { line: 2 });
    } else if (beat === "stand") {
      // Gets up, takes the launcher, faces the doors. Breathing slows.
      this.sitTarget = 0;
      this.lookDown = 0;
      if (p) {
        p.setBrace(0.15);
        p.fear = Math.min(p.fear, 0.4);
        p.look(0, 5);
      }
    } else if (beat === "tremor") {
      this.shake.add(0.45);
      this.shake.kick(0.03, -0.03, 0);
      if (p) p.react(0.4, 0.4);
      this.events.emit("tremor", {});
    } else if (beat === "chime") {
      this.events.emit("chime", {});
    } else if (beat === "doors") {
      if (p) p.look(0, 4);
      this.events.emit("doors", {});
    }
  }

  _updateCamera(dt) {
    const cam = this.camera;
    const shot = this.currentShot();
    if (shot !== this.shot) {
      this.shot = shot;
      this.shotT = 0;
      this.events.emit("shot", { shot });
    }
    this.shotT += dt;
    const u = this.shotT;
    const who = this.performer ? this.performer.home : this.cabin.backWall;
    const D = INTERIOR.halfDepth;
    // Head height follows the sit.
    const head = 1.55 - this.sit * 0.62;

    if (shot === "corner") {
      // From the front corner by the doors: them against the back wall.
      cam.position.set(-0.85 + u * 0.02, 1.7, -0.8 + u * 0.03);
      _look.set(who.x, head - 0.25, who.z);
      cam.fov = 55;
    } else if (shot === "low") {
      // Low and close: the face, breathing.
      cam.position.set(who.x + 0.45, 0.55, who.z - 0.75 + u * 0.03);
      _look.set(who.x, head, who.z);
      cam.fov = 48;
    } else if (shot === "radio") {
      // In front, a little to their left: the face bent over the radio on
      // the vest, pushing in slowly.
      cam.position.set(who.x - 0.38, head - 0.02, who.z - 0.95 + u * 0.02);
      _look.set(who.x - 0.04, head - 0.26, who.z);
      cam.fov = 42;
    } else if (shot === "side") {
      // From the side wall: getting up, taking the launcher.
      cam.position.set(1.0, 1.35, -0.25 - u * 0.02);
      _look.set(who.x - 0.15, head - 0.35, who.z - 0.05);
      cam.fov = 60;
    } else {
      // Over the left shoulder at the doors and the display: arrival, the
      // doors opening on daylight.
      cam.position.set(who.x - 0.62, 1.86, who.z + 0.24);
      _look.set(0.15, 1.62, -D);
      cam.fov = 62;
    }
    cam.lookAt(_look);
    this.shake.apply(cam);
    cam.updateProjectionMatrix();
  }

  render() {
    const size = this.renderer.getSize(_size);
    this.camera.aspect = size.x / Math.max(1, size.y);
    this.camera.updateProjectionMatrix();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.visible = false;
    disposeAvatar(this._avatar);
    this._avatar = null;
    this.launcher.dispose();
    this.events.clear();
    this.hud.dispose();
    this.owned.dispose();
    this.scene.clear();
  }
}
