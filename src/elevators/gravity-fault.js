/**
 * Elevator 2 - the Gravity Fault. The ride from Level 2 (the Foundry) up to
 * Level 3 (the Meltdown).
 *
 * From the project brief: "The second lift is damaged. Gravity weakens and
 * spheres, shards, and the avatar float inside the cabin. The player shoots
 * three stabilisers while the camera transitions between an interior
 * first-person view, an exterior tower view, and a top-down orthographic
 * diagnostic view."
 *
 * Here the tower is coming down around the lift: tremors, the lights
 * failing, and then the cable snaps. Two seconds of free fall - inside a
 * falling cabin everything is weightless, which is the brief's "gravity
 * weakens" for real - until the emergency brakes bite in a shower of sparks
 * and slam the lift to a stop. Then it climbs on to Level 3.
 *
 * The ride is a self-contained module like Level 3: its own scene, cameras
 * and HUD, rendered with the game's renderer. The host (main.js) creates it,
 * forwards the pointer, calls update() and render() every frame, and hands
 * over to Level 3 when `result.done` is set. While it runs, Level 3's models
 * keep streaming in the background - the ride is also the loading screen.
 *
 *   const ride = new GravityFaultRide({ renderer, spheres: ammo });
 *   ride.update(dt, time);   // every frame
 *   ride.render();
 *   ride.onPointerMove(x, y); // NDC, -1..1
 *   if (ride.result.done) { ... ride.dispose(); }
 *
 * Phases (PHASES below has the lengths):
 *   board     doors close behind Subject 07, the Foundry glowing through them
 *             (skipped when the player boarded in Level 2's Calibration Lift)
 *   climb     launch up the outside of Ascension Tower
 *   tremor    the building shakes, the lights flicker, the lift stalls; the
 *             left pane cracks, the cracks spread, and it blows out
 *   freefall  the cable snaps: blackout, red emergency light, two seconds
 *             of free fall, the floor counter running backwards; loose
 *             things and fallen shards drift up off the floor
 *   brake     the emergency brakes bite - sparks - and slam the lift to a
 *             stop; everything slams down and the right pane blows out
 *   launcher  something hits the roof. Level 3's launcher - the failed
 *             experiment, falling from the lab above - crashes through the
 *             glass ceiling; Subject 07 picks it up and carries it into
 *             Level 3
 *   clamps    the brakes are slipping. Shoot the three brake clamps with
 *             the launcher (the brief's stabilisers); each hit changes the
 *             camera - first person, outside, then the top-down orthographic
 *             diagnostic view - and a diagnostic monitor shows that view
 *             until then. Out of time, the clamps force-lock with a jolt
 *             and no bonus: the ride never fails
 *   resume    the brakes release and the lift climbs on; fade out
 *
 * Everything loose in the cabin (glass.js shards that fell in, debris.js)
 * is simulated in the cabin's own frame under the gravity felt there,
 * `state.gEff` = 9.8 + the cabin's acceleration: normal while it climbs,
 * zero in free fall, about 7 g as the brakes slam.
 *
 * Events (ride.events.on) for sound: shot, depart, tremor, flicker,
 * glass-crack, glass-break, cable-snap, brake, brake-slam, launcher-thud,
 * launcher-land, pickup, clamps, clamp-shot, clamp-lock, clamps-locked,
 * clamps-forced, resume, arrive.
 *
 * Scene hierarchy:
 *   RideScene
 *   |-- RideWorld        sky, city, skyline, Ascension Tower (shaders.js)
 *   |-- LiftShaft        rails, ring beams, marker lamps
 *   |-- GravityLiftCabin moves up (and down) the shaft
 *   |   |-- frame, glass, doors, floor display, energy conduits, brake shoes
 *   |   |-- cabin light, emergency beacon
 *   |   `-- PlayerRoot   the character picked on the start screen (Level 3's
 *   |                    PlayerAvatar), or a simple figure until it loads
 *   |   |-- shards that fell in, loose debris (glass.js, debris.js)
 *   |-- Sparks           brake sparks (sparks.js)
 *   |-- shards           blown out, falling down the shaft (glass.js)
 *   `-- lights           moon, fire uplight from below, hemisphere, spark glow
 */

import * as THREE from "../three.js";
import { createRideUniforms } from "./shaders.js";
import { buildWorld, buildShaft, buildCabin, buildFigure, Owned, STOREY } from "./kit.js";
import { CameraShake } from "./shake.js";
import { Sparks } from "./sparks.js";
import { CabinGlass } from "./glass.js";
import { CabinDebris } from "./debris.js";
import { Performer, disposeAvatar } from "./acting.js";
import { LauncherProp } from "./launcher.js";
import { BrakeClamps } from "./clamps.js";
import { DiagnosticView } from "./diagnostic.js";
import { ElevatorHud } from "../ui/elevator-hud.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";
import { StoryRideDirector } from "./story-ride.js";

/** Level 2 is floor 140 of Ascension Tower; Level 3 is further up. */
export const START_FLOOR = 141;
const GRAVITY = 9.8;
const CRUISE = 13;
const ACCEL = 6;

/** Seconds to shoot the three clamps before they force-lock. */
export const CLAMP_TIME = 10;
/** Camera for the clamps, by how many are locked: 0, 1, 2, then all three. */
const CLAMP_SHOTS = ["interior", "front", "diagnostic", "front"];

/** Phase lengths in seconds, in order. */
export const PHASES = [
  ["board", 1.8],
  ["climb", 2.8],
  ["tremor", 3.6],
  ["freefall", 2.0],
  ["brake", 1.6],
  ["launcher", 3.9],
  ["clamps", CLAMP_TIME + 1],
  ["resume", 3.2],
];

/** Camera shots within each phase: [seconds into the phase, shot]. */
const SHOTS = {
  board: [[0, "doors"]],
  climb: [[0, "exterior"]],
  tremor: [[0, "interior"], [1.9, "close"]],
  freefall: [[0, "interior"], [0.45, "falling"], [1.2, "close"]],
  brake: [[0, "interior"], [0.8, "close"]],
  launcher: [[0, "close"], [0.55, "roof"], [1.35, "pickup"]],
  resume: [[0, "rising"]],
};

const FADE_IN = 0.6;
const FADE_OUT = 0.8;

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

/** Deterministic flicker: on/off in irregular bursts, like a failing tube. */
function flicker(time, seed) {
  const a = Math.sin(time * 23 + seed) + Math.sin(time * 37 + seed * 1.7) + Math.sin(time * 5.3 + seed * 3.1);
  return a > 0.4 ? 1 : a > -0.6 ? 0.25 : 0;
}

const _size = new THREE.Vector2();
const _look = new THREE.Vector3();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class GravityFaultRide {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer  the game's renderer
   * @param {number} [o.spheres]  spheres carried in from Level 2
   * @param {boolean} [o.reducedMotion]  less shake, gentler camera moves
   * @param {THREE.Object3D} [o.character]  the chosen character's model
   *   template (loadMeltdownAssets), so the ride shows the same person as
   *   Levels 1 and 2. Without it, a simple stand-in figure.
   * @param {boolean} [o.boarded]  the player boarded in Level 2 already (the
   *   Calibration Lift): skip the board phase and start as the lift climbs
   * @param {string} [o.assetBase]  Level 3's asset folder, for the launcher model
   * @param {object} [o.story]  the story's version (story-ride.js): Dr. Okoro
   *   drops the launcher, and the clamps are reaction hits -
   *   { layer: StoryLayer, okoroTemplate }. Without it the ride is unchanged.
   * @param {{wear:number, gear:boolean, skinTone?:string}} [o.figure]  the character's state and skin tone (src/figure/look.js)
   */
  constructor({ renderer, spheres = 0, reducedMotion = false, boarded = false, character = null, assetBase = null, story = null, figure = null }) {
    this.figureState = figure;
    this.renderer = renderer;
    this.reducedMotion = reducedMotion;
    this.boarded = boarded;
    this.events = createEmitter();
    this.owned = new Owned();
    this.uniforms = createRideUniforms();
    this.visible = true;

    const scene = (this.scene = new THREE.Scene());
    scene.name = "RideScene";
    scene.background = new THREE.Color(0x05060a);
    // Same exponential-squared fog as the ride shaders use.
    scene.fog = new THREE.FogExp2(this.uniforms.uFogColor.value, this.uniforms.uFogDensity.value);

    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 5000);

    this.world = buildWorld(this.uniforms, this.owned);
    this.shaft = buildShaft(this.owned);
    this.cabin = buildCabin(this.uniforms, this.owned);
    this.figure = character ? this._characterFigure(character) : buildFigure(this.owned);
    this.figure.root.position.set(-0.35, 0, 0.35);
    this.cabin.root.add(this.figure.root);
    // The character acts: reacts, stumbles, braces, floats (acting.js).
    this.performer = this._avatar ? new Performer(this._avatar, { home: this.figure.root.position, reduced: reducedMotion }) : null;
    this.sparks = new Sparks(700);
    scene.add(this.world.root, this.shaft.root, this.cabin.root, this.sparks.points);
    this.glass = new CabinGlass(this.cabin, scene);
    this.debris = new CabinDebris(this.cabin.root);
    this.launcher = new LauncherProp(this.cabin.root, assetBase);
    this.clamps = new BrakeClamps(this.cabin.root, scene);
    // The diagnostic view: the structure as a hologram, the clamps and the
    // character in their own colours on top.
    this.diag = new DiagnosticView();
    for (const child of this.cabin.root.children) {
      if (child !== this.figure.root && child !== this.launcher.root && !child.name.startsWith("BrakeClamp")) this.diag.scan(child);
    }
    this.diag.scan(this.shaft.root);
    this.diag.scan(this.world.tower);
    this.diag.scan(this.glass.out.mesh);
    for (const c of this.clamps.clamps) this.diag.mark(c.root);
    this.diag.mark(this.figure.root);
    this.diag.mark(this.launcher.root);
    this.fireCooldown = 0;
    this.aimTarget = null;
    this.launcher.onLand = (speed) => {
      this.shake.add(0.25);
      this.debris.jolt(0.15);
      this.events.emit("launcher-land", { speed });
    };

    scene.add(new THREE.HemisphereLight(0x39405a, 0x3a1a0c, 0.7));
    const moon = new THREE.DirectionalLight(0x8aa0d0, 0.55);
    moon.position.set(-0.5, 1, -0.8);
    const fireLight = new THREE.DirectionalLight(0xff7a30, 1.0);
    fireLight.position.set(0.2, -1, -0.5);
    // The sparks light the cabin and the shaft from below.
    this.sparkLight = new THREE.PointLight(0xff8a30, 0, 14, 1.5);
    this.cabin.root.add(this.sparkLight);
    this.sparkLight.position.set(0, -0.4, 0);
    scene.add(moon, fireLight);

    this.shake = new CameraShake({ reduced: reducedMotion });
    this.hud = new ElevatorHud();
    this.hud.show();

    this.phases = boarded ? PHASES.filter(([name]) => name !== "board") : PHASES.slice();
    // The story's clamps end when the last reaction lands, not on a clock.
    if (story) this.phases = this.phases.map(([name, length]) => [name, name === "clamps" ? 600 : length]);
    this.state = {
      phaseIndex: 0,
      /** Seconds into the current phase. */
      pt: 0,
      /** Seconds since the ride appeared (the fade-in). */
      age: 0,
      cabinY: 0,
      // Boarded: the Calibration Lift was already climbing.
      velocity: boarded ? 6 : 0,
      /** Gravity as felt inside the cabin: 9.8 at rest, 0 in free fall. */
      gEff: GRAVITY,
      shot: null,
      shotT: 0,
      fired: new Set(),
      lights: { main: 1, a: 1, b: 1, red: 0 },
      fault: 0,
      flash: 0,
      minVelocity: 0,
      fallFrom: 0,
    };
    this.pointer = new THREE.Vector2();
    this._view = { yaw: 0, pitch: 0 };
    this.fade = 1;
    this.result = { done: false, stabilised: 0, bonus: 0, spheres };

    this.cabin.setDoors(boarded ? 0 : 1);
    this.cabin.display.userData.draw(String(START_FLOOR));
    this._place(0);
    this.director = story ? new StoryRideDirector(this, story) : null;
  }

  /**
   * The story's version plays as a cutscene throughout (Okoro's scenes, and
   * the clamps as reaction prompts, not aiming): the host hides the game's
   * HUD for it, so the subtitles and prompts have the screen. The plain ride
   * keeps its HUD.
   */
  get cutscene() {
    return !!this.director;
  }

  /** Name of the current phase. */
  get phase() {
    return this.phases[this.state.phaseIndex]?.[0] ?? "done";
  }

  /** Pointer in normalised device coordinates (-1..1), from the host. */
  onPointerMove(x, y) {
    this.pointer.set(x, y);
  }

  update(dt, time) {
    if (this.result.done) return;
    // The story's director: its reactions run in real time, the ride slows.
    if (this.director) dt *= this.director.update(dt);
    const s = this.state;
    s.pt += dt;
    s.age += dt;
    this.uniforms.uTime.value = time;

    // Advance through the phases.
    let [name, length] = this.phases[s.phaseIndex];
    if (this.director) s.pt = this.director.clampTime(name, s.pt);
    while (s.pt >= length) {
      s.pt -= length;
      s.phaseIndex += 1;
      if (s.phaseIndex >= this.phases.length) {
        this.result.done = true;
        this.fade = 1;
        this.events.emit("arrive", { ...this.result });
        return;
      }
      [name, length] = this.phases[s.phaseIndex];
      s.fired.clear();
      this._enter(name);
    }

    const before = s.velocity;
    this._phaseUpdate(name, s.pt, dt, time);
    s.cabinY += s.velocity * dt;
    // Felt gravity: the cabin's own acceleration adds to (or cancels) it.
    s.gEff = GRAVITY + (dt > 0 ? (s.velocity - before) / dt : 0);
    s.minVelocity = Math.min(s.minVelocity, s.velocity);
    this._place(s.cabinY);

    // Floor counter, and the display over the doors.
    const floor = START_FLOOR + s.cabinY / STOREY;
    this.hud.setFloor(floor, s.velocity);
    this.cabin.display.userData.draw(String(Math.floor(floor)), s.velocity < -1 || name === "brake" ? "#ff4a54" : "#7ef4f1");

    // Lights and the energy conduits.
    const L = s.lights;
    this.cabin.setLights(L.main, L.a, L.b, L.red, time);
    this.cabin.energy.uniforms.uFault.value += (s.fault - this.cabin.energy.uniforms.uFault.value) * Math.min(1, dt * 6);
    this.cabin.energy.uniforms.uLevel.value = name === "freefall" ? 0.35 : 1;
    s.flash = Math.max(0, s.flash - dt * 3);
    this.uniforms.uFlash.value = s.flash;

    if (this.performer) this.performer.update(dt, s.gEff);
    else this.figure.pose(s.gEff < 3 ? 1 : 0, time);
    this.glass.update(dt, s.gEff);
    this.debris.update(dt, s.gEff);
    this.launcher.update(dt, s.gEff);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    const locked = this.clamps.update(dt, time);
    if (locked >= 0) this._clampLocked(locked);
    this.sparks.update(dt);
    this.sparkLight.intensity = Math.max(0, this.sparkLight.intensity - dt * 40);

    // Fades are the host's overlay; the ride only says how dark.
    const last = this.state.phaseIndex === this.phases.length - 1;
    const fadeOut = last ? THREE.MathUtils.clamp((s.pt - (length - FADE_OUT)) / FADE_OUT, 0, 1) : 0;
    this.fade = Math.max(1 - s.age / FADE_IN, fadeOut, this.director?.fade ?? 0);

    this.shake.update(dt);
    this._updateCamera(dt, time);
  }

  /** Once per phase, on the way in. */
  _enter(name) {
    const s = this.state;
    if (name === "tremor") {
      this.events.emit("tremor", {});
    } else if (name === "freefall") {
      // The cable snaps. Blackout; the emergency beacon takes over.
      s.fallFrom = s.cabinY;
      s.velocity = Math.min(s.velocity, 0);
      s.lights = { main: 0, a: 0, b: 0, red: 1 };
      s.fault = 1;
      s.flash = 1;
      this.shake.add(0.85);
      this.shake.kick(0, 0.22, 0);
      // The floor drops away: everything loose lifts off it.
      this.debris.jolt(1);
      this.glass.jolt(1);
      this._act((p) => {
        p.setBrace(0);
        p.jolt(0.9);
        p.react(0, 0.8);
      });
      this._crack("front", [0.72, 0.3], 0.9, 0.55);
      this.hud.alert("CABLE FAILURE", "danger");
      this.events.emit("cable-snap", { floor: START_FLOOR + s.cabinY / STOREY });
    } else if (name === "brake") {
      this._act((p) => p.look(0.3, 1.5));
      this.hud.alert("EMERGENCY BRAKES", "danger");
      this.events.emit("brake", {});
    } else if (name === "launcher") {
      this.hud.alert(null);
    } else if (name === "clamps") {
      this.clamps.show();
      this.hud.alert("BRAKES SLIPPING // SHOOT THE 3 CLAMPS", "danger");
      this.events.emit("clamps", {});
    } else if (name === "resume") {
      this.hud.setClamps(null);
      s.lights = { main: 0.75, a: 1, b: 0, red: 1 };
      this._act((p) => {
        p.setBrace(0.25);
        p.look(-0.5, 1.6);
      });
      this.hud.alert("BRAKES RELEASED // ASCENDING", "good");
      this.events.emit("resume", {});
    }
    this.director?.enter(name);
  }

  /** Per-frame work for the current phase: velocity, lights, one-shot beats. */
  _phaseUpdate(name, pt, dt, time) {
    const s = this.state;
    const once = (key, at, fn) => {
      if (pt >= at && !s.fired.has(key)) {
        s.fired.add(key);
        fn();
      }
    };

    if (name === "board") {
      this.cabin.setDoors(1 - (pt - 0.4) / 1.2);
      if (!this.boarded) this.hud.alert("DOORS CLOSING", "info");
    } else if (name === "climb") {
      this.cabin.setDoors(0);
      once("depart", 0, () => {
        this.shake.add(0.25);
        this._act((p) => {
          p.impact = 0.25;
          p.look(0.4, 1.5);
        });
        this.hud.alert("ASCENDING // SECTOR 03", "info");
        this.events.emit("depart", {});
      });
      s.velocity = Math.min(CRUISE, s.velocity + ACCEL * dt);
    } else if (name === "tremor") {
      // The building groans. The lift judders and stalls; the lights go.
      this.shake.floor = 0.22;
      once("quake1", 0.15, () => {
        this.shake.add(0.5);
        s.flash = 0.8;
        this.debris.jolt(0.45);
        this._crack("left", [0.32, 0.62], 1.0, 0.45);
        // Something cracked, to their left: flinch and turn to it.
        this._act((p) => p.react(1.1, 0.8));
        this.hud.alert("SEISMIC EVENT", "danger");
      });
      once("quake2", 1.5, () => {
        this.shake.add(0.55);
        this.shake.kick(0.08, -0.1, 0);
        this.debris.jolt(0.55);
        this.glass.jolt(0.4);
        this._crack("left", [0.32, 0.62], 0.8, 0.85);
        this._crack("right", [0.7, 0.4], 0.8, 0.35);
        this._act((p) => {
          p.stumble(0.35, -0.1, 1);
          p.setBrace(0.6);
        });
        this.events.emit("flicker", {});
      });
      once("stall", 2.6, () => {
        this.shake.add(0.35);
        this.debris.jolt(0.3);
        this._act((p) => p.react(0, 0.4));
        this.hud.alert("LIFT STALLED", "danger");
      });
      once("blowout", 3.1, () => {
        this.shake.add(0.4);
        this.shake.kick(0.12, 0, 0);
        this._shatter("left", { outward: 0.8, force: 7 });
        // Thrown away from the blast, arms up.
        this._act((p) => {
          p.react(1.1, 1);
          p.stumble(0.4, 0.1, 1);
          p.setBrace(0.85);
        });
      });
      // Flickering from the second quake; strip B dies for good.
      const flick = pt > 1.5 ? flicker(time, 1.3) : 1;
      s.lights.main = pt > 1.5 ? 0.25 + 0.75 * flick : 1;
      s.lights.a = pt > 1.5 ? flicker(time, 4.1) : 1;
      s.lights.b = pt > 2.4 ? 0 : pt > 1.5 ? flicker(time, 7.9) : 1;
      s.fault = Math.min(1, pt / 3);
      // Juddering to a stop: slower, with jerks.
      const target = CRUISE * Math.max(0, 1 - pt / 2.8);
      s.velocity += (target - s.velocity) * Math.min(1, dt * 3);
      s.velocity += Math.sin(pt * 31) * 0.8 * (pt < 2.8 ? 1 : 0);
      if (pt > 2.8) s.velocity *= Math.max(0, 1 - dt * 10);
    } else if (name === "freefall") {
      // Nothing holding it: fall. The rails start to scream near the end as
      // the brakes try to bite.
      this.shake.floor = 0.3;
      s.velocity -= GRAVITY * dt;
      if (pt > 1.2) this._grind(dt, 40, 0.4);
    } else if (name === "brake") {
      // Brakes bite: ~0.35 s from full fall to a dead stop, in sparks.
      this.shake.floor = 0;
      const SLAM = 0.35;
      if (pt < SLAM) {
        s.velocity = Math.min(0, s.velocity + (-s.velocity / Math.max(0.02, SLAM - pt)) * dt);
        this._grind(dt, 420, 1.4);
      } else {
        s.velocity = 0;
        once("slam", SLAM, () => {
          this.shake.add(1);
          this.shake.kick(0, -0.35, 0);
          s.flash = 0.6;
          this._shatter("right", { outward: 0.7, force: 8 });
          this._crack("front", [0.72, 0.3], 0.5, 0.85);
          this.events.emit("brake-slam", { dropped: s.fallFrom - s.cabinY });
        });
        this._grind(dt, Math.max(0, 60 * (1 - (pt - SLAM) / 0.8)), 0.3);
        once("recover", 0.9, () => this._act((p) => p.setBrace(0.5)));
        // The lights stutter back on, dimmer.
        s.lights.main = pt > 0.9 ? 0.4 + 0.35 * flicker(time, 2.2) : 0;
        s.lights.a = pt > 1.1 ? flicker(time, 5.5) : 0;
      }
    } else if (name === "launcher") {
      this._launcherBeat(pt, once);
    } else if (name === "clamps") {
      this._clampsBeat(pt, dt, time);
    } else if (name === "resume") {
      s.velocity = Math.min(9, s.velocity + 4 * dt);
      s.lights.main = 0.55 + 0.2 * flicker(time, 3.3);
      s.fault = Math.max(0.35, s.fault - dt * 0.3);
      this.shake.floor = 0.06;
    }
  }

  /**
   * Something heavy hits the roof, then comes through it: the launcher. It
   * lands in front of Subject 07, who looks at it, steps over, crouches,
   * picks it up and brings it to the shoulder.
   */
  _launcherBeat(pt, once) {
    const s = this.state;
    s.lights.main = 0.45 + 0.3 * flicker(this.uniforms.uTime.value, 2.2);
    s.lights.a = 1;
    // The story: Okoro dropped it in the fall - nothing comes through the roof.
    if (this.director) once("thud", 0, () => {});
    if (this.director) once("crash", 0, () => {});
    once("thud", 0.05, () => {
      this.shake.add(0.35);
      this.shake.kick(0, -0.06, 0);
      this.debris.jolt(0.3);
      this._act((p) => {
        p.react(0, 0.6);
        p.lookUp(0.9);
      });
      this.events.emit("launcher-thud", {});
    });
    once("crash", 0.7, () => {
      this.shake.add(0.5);
      s.flash = 0.4;
      this._shatter("roof", { outward: 0, force: 2.5, count: 60 });
      this.launcher.drop(new THREE.Vector3(0.3, 3.6, -0.5), new THREE.Vector3(-0.1, -3.2, 0.15));
      this._act((p) => {
        p.react(0, 1);
        p.setBrace(0.7);
      });
    });
    const lying = this.launcher.root.position;
    once("notice", 1.5, () => this._act((p) => {
      p.setBrace(0.15);
      p.attention = p.yawTo(lying.x, lying.z);
      // Looking down at it.
      p.override = { lean: 0.35, pitch: -0.12 };
    }));
    once("step", 1.75, () => this._act((p) => {
      // Stand beside it, to its +Z side.
      p.attention = null;
      p.override = null;
      p.walkTo(lying.x - 0.1, lying.z + 0.5);
    }));
    once("reach", 2.25, () => this._act((p) => {
      p.attention = p.yawTo(lying.x, lying.z);
      p.override = { crouch: 0.95, lean: 1.0, hold: 0.25, reach: 0, swing: 0.08, stride: 0, pitch: -0.1 };
    }));
    once("grab", 2.65, () => {
      if (!this._avatar) return;
      // Up in front of the chest on its way to the shoulder.
      const via = this._avatar.root.localToWorld(new THREE.Vector3(0.1, 1.05, -0.5));
      this.launcher.attach(this._avatar.shoulder, 0.6, via);
      this.events.emit("pickup", {});
    });
    once("stand", 3.0, () => this._act((p) => {
      p.override = null;
      p.holding = true;
      p.setBrace(0.1);
      p.attention = null;
      p.look(0, 1.2);
      this.hud.alert("LAUNCHER ACQUIRED", "good");
    }));
  }

  /**
   * The brakes slip - the cabin sinks in jerks, the loose clamps grind -
   * until all three are locked (or time runs out and they force-lock).
   */
  _clampsBeat(pt, dt, time) {
    if (this.director) {
      this.director.clampsBeat(pt, dt, time);
      return;
    }
    const s = this.state;
    const left = Math.max(0, CLAMP_TIME - pt);
    const done = this.clamps.locked === 3;
    this.hud.setClamps(this.clamps.locked, 3, done ? null : left);
    s.lights.main = 0.4 + 0.3 * flicker(time, 2.2);
    if (!done) {
      // Slipping: sinking in jerks, the unlocked clamps grinding.
      const slip = (3 - this.clamps.locked) / 3;
      s.velocity = -0.7 * slip * (0.6 + 0.4 * Math.abs(Math.sin(pt * 7)));
      this.shake.floor = 0.1 * slip;
      for (const c of this.clamps.clamps) {
        if (c.locked || Math.random() > dt * 30) continue;
        this.sparks.emit(this.clamps.worldPosition(c, _v), 3, { direction: _dir.set(0, -1, 0), spread: 0.8, speed: 4 });
      }
      // The character turns to aim at whatever the crosshair is nearest.
      this._act((p) => {
        const c = this.aimTarget ?? this.clamps.clamps.find((k) => !k.locked);
        if (c) p.attention = p.yawTo(c.root.position.x, c.root.position.z);
      });
      if (left <= 0) this._forceClamps();
    } else {
      s.velocity *= Math.max(0, 1 - dt * 6);
      this.shake.floor = 0;
    }
  }

  /** Called by the host on a click: fire the launcher at the crosshair. */
  fire() {
    // The story's clamps are reaction hits; its launcher fires on success.
    if (this.director) return false;
    if (this.phase !== "clamps" || this.clamps.locked === 3 || this.fireCooldown > 0) return false;
    this.fireCooldown = 0.2;
    const from = new THREE.Vector3();
    if (this.launcher.state === "held") this.launcher.root.localToWorld(from.set(0, 0, -0.7));
    else this.cabin.root.localToWorld(from.set(0, 1.4, 0));
    const camera = this.currentShot() === "diagnostic" ? this.diag.camera : this.camera;
    const target = this.clamps.fire(from, camera, this.pointer);
    this.launcher.recoil = 1;
    this.shake.add(0.08);
    this.events.emit("clamp-shot", { assisted: !!target });
    return true;
  }

  /** Is the player aiming right now (for the host's crosshair)? */
  get wantsAim() {
    return !this.director && this.phase === "clamps" && this.clamps.locked < 3;
  }

  _clampLocked(index) {
    const s = this.state;
    const n = this.clamps.locked;
    this.shake.add(0.3);
    this.shake.kick(0, 0.05, 0);
    this.sparks.emit(this.clamps.worldPosition(this.clamps.clamps[index], _v), 60, { direction: _dir.set(0, 1, 0), spread: 1, speed: 5 });
    if (!s.forced) this.result.stabilised += 1;
    this.events.emit("clamp-lock", { index, locked: n });
    // (The story has a fourth: the brake itself - its director ends the phase.)
    if (n === 3 && !s.forced && !this.director) {
      const left = Math.max(0, CLAMP_TIME - s.pt);
      this.result.bonus = this.result.stabilised * 400 + 800 + Math.round(left) * 50;
      this.hud.alert(`BRAKES LOCKED // +${this.result.bonus}`, "good");
      this.events.emit("clamps-locked", { bonus: this.result.bonus });
      // A beat to see it, then on.
      s.pt = Math.max(s.pt, CLAMP_TIME);
    }
  }

  /** Out of time: the remaining clamps slam shut on their own. */
  _forceClamps() {
    const s = this.state;
    if (s.forced) return;
    s.forced = true;
    for (const c of this.clamps.clamps) if (!c.locked) this.clamps.lock(c);
    this.result.bonus = this.result.stabilised * 400;
    this.shake.add(0.8);
    this.shake.kick(0, -0.25, 0);
    this.debris.jolt(0.4);
    this._act((p) => p.react(0, 0.8));
    this.hud.alert("CLAMPS FORCED", "danger");
    this.events.emit("clamps-forced", { stabilised: this.result.stabilised });
  }

  /** Direct the character (no-op for the stand-in figure). */
  _act(fn) {
    if (this.performer) fn(this.performer);
  }

  _crack(pane, impact, seconds, amount) {
    this.glass.crack(pane, impact, seconds, amount);
    this.events.emit("glass-crack", { pane, amount });
  }

  _shatter(pane, options) {
    this.glass.shatter(pane, { ...options, cabinVelocity: this.state.velocity });
    this.events.emit("glass-break", { pane });
  }

  /** Brake shoes grinding on the rails: sparks per second, and their glow. */
  _grind(dt, rate, glow) {
    const n = rate * dt;
    for (const local of this.cabin.brakePoints) {
      const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      if (!count) continue;
      _v.copy(local);
      this.cabin.root.localToWorld(_v);
      // Out from the cabin and down (the cabin is falling onto them).
      _dir.set(Math.sign(local.x) * 0.6, this.state.velocity < -1 ? 1.2 : -0.6, Math.sign(local.z) * 0.6);
      this.sparks.emit(_v, count, { direction: _dir, spread: 0.7, speed: 5 + glow * 3 });
    }
    this.sparkLight.intensity = Math.max(this.sparkLight.intensity, 25 * glow);
  }

  /**
   * The player's own body: Level 3's PlayerAvatar with the chosen model,
   * arms free (Subject 07 throws by hand), standing. Exposes the same
   * `root` / `pose()` as the stand-in figure.
   */
  _characterFigure(template) {
    const avatar = new PlayerAvatar();
    avatar.hold = 0;
    if (this.figureState) {
      avatar.setWear(this.figureState.wear);
      avatar.setGear(this.figureState.gear);
      if (this.figureState.skinTone) avatar.setSkinTone(this.figureState.skinTone);
    }
    avatar.setModel(template);
    this._avatar = avatar;
    return {
      root: avatar.root,
      pose: (float, time, dt = 0) => avatar.update(dt, { speed: 0 }),
    };
  }

  _place(y) {
    this.cabin.root.position.y = y;
  }

  /** The camera shot for the current phase and time. */
  currentShot() {
    // For the check harness and screenshots: hold one shot.
    if (this.forceShot) return this.forceShot;
    if (this.phase === "clamps") return CLAMP_SHOTS[this.clamps.locked];
    const list = SHOTS[this.phase] ?? SHOTS.climb;
    let shot = list[0][1];
    for (const [at, name] of list) if (this.state.pt >= at) shot = name;
    return shot;
  }

  _updateCamera(dt, time) {
    const s = this.state;
    const cam = this.camera;
    const shot = this.currentShot();
    if (shot !== s.shot) {
      s.shot = shot;
      s.shotT = 0;
      s.shotY = s.cabinY;
      this.events.emit("shot", { shot });
    }
    s.shotT += dt;
    const y = s.cabinY;
    const calm = this.reducedMotion ? 0.35 : 1;

    // The figure is only seen from outside the first person.
    this.figure.root.visible = shot !== "interior";

    if (shot === "doors") {
      // From the front corner, looking back past Subject 07 at the doors
      // closing on the Foundry's orange glow.
      const u = Math.min(1, s.shotT / 2.2);
      cam.position.set(1.35 - u * 0.2, y + 1.7, -1.55);
      _look.set(-0.1, y + 1.35, 2.2);
      cam.fov = 62;
    } else if (shot === "close") {
      // Inside, from the front corner, on Subject 07.
      const u = Math.min(1, s.shotT / 3);
      const who = this.figure.root.position;
      cam.position.set(1.45 - u * 0.15, y + 1.75, -1.6);
      _look.set(who.x, y + who.y + 1.1, who.z + 0.15);
      cam.fov = 60;
    } else if (shot === "front") {
      // Outside, in front of the cabin: all three clamps in view.
      const u = Math.min(1, s.shotT / 4);
      cam.position.set(2.8 - u * 1.2, y + 2.3, -9.5 + u * 0.8);
      _look.set(0, y + 1.7, -1);
      cam.fov = 58;
    } else if (shot === "diagnostic") {
      // Rendered through the orthographic camera (render()); keep this one
      // sensible for anything that asks.
      cam.position.set(0, y + 12, 0.01);
      _look.set(0, y, 0);
    } else if (shot === "roof") {
      // Low in the corner, looking up: the roof caves in.
      cam.position.set(1.5, y + 0.85, -1.55);
      _look.set(0.1, y + 2.6, 0.1);
      cam.fov = 70;
    } else if (shot === "pickup") {
      // Low and close, the launcher on the floor and Subject 07 over it.
      const who = this.figure.root.position;
      cam.position.set(1.45, y + 1.15, -1.65);
      _look.set((who.x + this.launcher.root.position.x) / 2, y + 0.75, (who.z + this.launcher.root.position.z) / 2);
      cam.fov = 62;
    } else if (shot === "exterior" || shot === "rising") {
      // Outside, over the drop: the cabin climbing the tower, the fire below.
      const u = Math.min(1, s.shotT / 3.6);
      const angle = shot === "rising" ? THREE.MathUtils.lerp(0.55, 0.25, u) : THREE.MathUtils.lerp(-0.8, -0.3, u * calm + (1 - calm) * 0.5);
      const radius = 12.5 - u * 1.5;
      // "rising" holds its height and lets the cabin climb out of frame.
      const camY = shot === "rising" ? s.shotY + 1.5 + u * 2 : y - 2.2 + u * 3.6;
      cam.position.set(Math.sin(angle) * radius, camY, -Math.cos(angle) * radius);
      _look.set(0, (shot === "rising" ? y : y - (1 - u) * 1.2) + 1.3, 0.8);
      cam.fov = 58;
    } else if (shot === "falling") {
      // Fixed below and to the side: the cabin drops toward the camera and
      // past it, throwing sparks.
      cam.position.set(-6.2, s.shotY - 16, -8.5);
      _look.set(0, y + 1.2, 0);
      cam.fov = 64;
    } else {
      // First person: look around with the mouse.
      const view = this._view;
      const k = 1 - Math.exp(-dt * 5);
      // Wider while aiming at the clamps (they are off to the sides and up).
      const aiming = this.phase === "clamps";
      // Pointer right looks right (+X).
      view.yaw += (this.pointer.x * (aiming ? 0.85 : 0.55) - view.yaw) * k;
      view.pitch += (this.pointer.y * (aiming ? 0.6 : 0.3) - 0.08 - view.pitch) * k;
      const bob = Math.sin(time * 1.6) * 0.012 * calm;
      cam.position.set(0, y + 1.62 + bob, 0.55);
      _look.set(Math.sin(view.yaw) * 8, y + 1.62 + Math.sin(view.pitch) * 8, 0.55 - Math.cos(view.yaw) * 8);
      cam.fov = 72;
    }

    cam.lookAt(_look);
    this.shake.apply(cam);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // Keep the diagnostic camera over the cabin, and see what is under the crosshair.
    // Centred a little forward, so the clamps (at the front) sit mid-screen,
    // clear of the alerts at the top.
    this.diag.follow(0, y, -1.5, time);
    this.aimTarget = this.wantsAim ? this.clamps.aim(shot === "diagnostic" ? this.diag.camera : cam, this.pointer) : null;
  }

  render() {
    const renderer = this.renderer;
    const size = renderer.getSize(_size);
    this.camera.aspect = size.x / Math.max(1, size.y);
    this.camera.updateProjectionMatrix();
    this.sparks.setViewportHeight(size.y * renderer.getPixelRatio());
    renderer.setRenderTarget(null);
    if (this.currentShot() === "diagnostic") {
      this.diag.render(renderer, this.scene);
      this.hud.monitor(null, true);
      return;
    }
    renderer.render(this.scene, this.camera);
    // The diagnostic monitor, bottom right, while the brakes slip.
    if (this.wantsAim) {
      const w = Math.round(Math.min(240, size.x * 0.26));
      const rect = { x: size.x - w - 18, y: 118, w, h: w };
      this.diag.render(renderer, this.scene, rect);
      this.hud.monitor(rect, false);
    } else this.hud.monitor(null, false);
  }

  dispose() {
    this.visible = false;
    this.director?.dispose();
    disposeAvatar(this._avatar);
    this._avatar = null;
    this.sparks.dispose();
    this.glass.dispose();
    this.debris.dispose();
    this.launcher.dispose();
    this.clamps.dispose();
    this.diag.dispose();
    this.events.clear();
    this.hud.dispose();
    this.owned.dispose();
    this.scene.clear();
  }
}
