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
 *   resume    the brakes release and the lift climbs on; fade out
 *
 * Everything loose in the cabin (glass.js shards that fell in, debris.js)
 * is simulated in the cabin's own frame under the gravity felt there,
 * `state.gEff` = 9.8 + the cabin's acceleration: normal while it climbs,
 * zero in free fall, about 7 g as the brakes slam.
 *
 * Events (ride.events.on) for sound: shot, depart, tremor, flicker,
 * glass-crack, glass-break, cable-snap, brake, brake-slam, resume, arrive.
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
import { ElevatorHud } from "../ui/elevator-hud.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";

/** Level 2 is floor 140 of Ascension Tower; Level 3 is further up. */
export const START_FLOOR = 141;
const GRAVITY = 9.8;
const CRUISE = 13;
const ACCEL = 6;

/** Phase lengths in seconds, in order. */
export const PHASES = [
  ["board", 1.8],
  ["climb", 2.8],
  ["tremor", 3.6],
  ["freefall", 2.0],
  ["brake", 1.6],
  ["resume", 3.2],
];

/** Camera shots within each phase: [seconds into the phase, shot]. */
const SHOTS = {
  board: [[0, "doors"]],
  climb: [[0, "exterior"]],
  tremor: [[0, "interior"], [1.9, "close"]],
  freefall: [[0, "interior"], [0.45, "falling"]],
  brake: [[0, "interior"], [0.8, "close"]],
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
   */
  constructor({ renderer, spheres = 0, reducedMotion = false, boarded = false, character = null }) {
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
    this.sparks = new Sparks(700);
    scene.add(this.world.root, this.shaft.root, this.cabin.root, this.sparks.points);
    this.glass = new CabinGlass(this.cabin, scene);
    this.debris = new CabinDebris(this.cabin.root);

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
    const s = this.state;
    s.pt += dt;
    s.age += dt;
    this.uniforms.uTime.value = time;

    // Advance through the phases.
    let [name, length] = this.phases[s.phaseIndex];
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

    this.figure.pose(0, time, dt);
    this.glass.update(dt, s.gEff);
    this.debris.update(dt, s.gEff);
    this.sparks.update(dt);
    this.sparkLight.intensity = Math.max(0, this.sparkLight.intensity - dt * 40);

    // Fades are the host's overlay; the ride only says how dark.
    const last = this.state.phaseIndex === this.phases.length - 1;
    const fadeOut = last ? THREE.MathUtils.clamp((s.pt - (length - FADE_OUT)) / FADE_OUT, 0, 1) : 0;
    this.fade = Math.max(1 - s.age / FADE_IN, fadeOut);

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
      this._crack("front", [0.72, 0.3], 0.9, 0.55);
      this.hud.alert("CABLE FAILURE", "danger");
      this.events.emit("cable-snap", { floor: START_FLOOR + s.cabinY / STOREY });
    } else if (name === "brake") {
      this.hud.alert("EMERGENCY BRAKES", "danger");
      this.events.emit("brake", {});
    } else if (name === "resume") {
      s.lights = { main: 0.75, a: 1, b: 0, red: 1 };
      this.hud.alert("BRAKES RELEASED // ASCENDING", "good");
      this.events.emit("resume", {});
    }
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
        this.hud.alert("SEISMIC EVENT", "danger");
      });
      once("quake2", 1.5, () => {
        this.shake.add(0.55);
        this.shake.kick(0.08, -0.1, 0);
        this.debris.jolt(0.55);
        this.glass.jolt(0.4);
        this._crack("left", [0.32, 0.62], 0.8, 0.85);
        this._crack("right", [0.7, 0.4], 0.8, 0.35);
        this.events.emit("flicker", {});
      });
      once("stall", 2.6, () => {
        this.shake.add(0.35);
        this.debris.jolt(0.3);
        this.hud.alert("LIFT STALLED", "danger");
      });
      once("blowout", 3.1, () => {
        this.shake.add(0.4);
        this.shake.kick(0.12, 0, 0);
        this._shatter("left", { outward: 0.8, force: 7 });
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
        // The lights stutter back on, dimmer.
        s.lights.main = pt > 0.9 ? 0.4 + 0.35 * flicker(time, 2.2) : 0;
        s.lights.a = pt > 1.1 ? flicker(time, 5.5) : 0;
      }
    } else if (name === "resume") {
      s.velocity = Math.min(9, s.velocity + 4 * dt);
      s.lights.main = 0.55 + 0.2 * flicker(time, 3.3);
      s.fault = Math.max(0.35, s.fault - dt * 0.3);
      this.shake.floor = 0.06;
    }
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
      cam.position.set(1.45 - u * 0.15, y + 1.75, -1.6);
      _look.set(-0.35, y + 1.15, 0.5);
      cam.fov = 60;
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
      view.yaw += (-this.pointer.x * 0.55 - view.yaw) * k;
      view.pitch += (this.pointer.y * 0.3 - 0.08 - view.pitch) * k;
      const bob = Math.sin(time * 1.6) * 0.012 * calm;
      cam.position.set(0, y + 1.62 + bob, 0.55);
      _look.set(Math.sin(view.yaw) * 8, y + 1.62 + Math.sin(view.pitch) * 8, 0.55 - Math.cos(view.yaw) * 8);
      cam.fov = 72;
    }

    cam.lookAt(_look);
    this.shake.apply(cam);
    cam.updateProjectionMatrix();
  }

  render() {
    const renderer = this.renderer;
    const size = renderer.getSize(_size);
    this.camera.aspect = size.x / Math.max(1, size.y);
    this.camera.updateProjectionMatrix();
    this.sparks.setViewportHeight(size.y * renderer.getPixelRatio());
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  /**
   * Free what the avatar owns: its stand-in, contact shadow and the rig's
   * cloned material. The model's geometry and textures are shared with the
   * game's own player body, so they are left alone.
   */
  _disposeAvatar() {
    const avatar = this._avatar;
    if (!avatar) return;
    avatar.standIn.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      o.material.dispose();
    });
    avatar.shadow.geometry.dispose();
    avatar.shadowMaterial.map?.dispose();
    avatar.shadowMaterial.dispose();
    avatar.model?.traverse((o) => {
      if (o.isMesh) for (const m of [].concat(o.material)) m.dispose();
    });
    this._avatar = null;
  }

  dispose() {
    this.visible = false;
    this._disposeAvatar();
    this.sparks.dispose();
    this.glass.dispose();
    this.debris.dispose();
    this.events.clear();
    this.hud.dispose();
    this.owned.dispose();
    this.scene.clear();
  }
}
