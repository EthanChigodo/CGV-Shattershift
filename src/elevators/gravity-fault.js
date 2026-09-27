/**
 * Elevator 2 - the Gravity Fault. The ride from Level 2 (the Foundry) up to
 * Level 3 (the Meltdown).
 *
 * From the project brief: "The second lift is damaged. Gravity weakens and
 * spheres, shards, and the avatar float inside the cabin. The player shoots
 * three stabilisers while the camera transitions between an interior
 * first-person view, an exterior tower view, and a top-down orthographic
 * diagnostic view. This previews Level 3's gravity mechanic."
 *
 * The ride is a self-contained module like Level 3: its own scene, cameras
 * and HUD, rendered with the game's renderer. The host (main.js) creates it
 * when the Foundry is complete, forwards the pointer and clicks, calls
 * update() and render() every frame, and hands over to Level 3 when
 * `result.done` is set. While it runs, Level 3's models keep streaming in
 * the background - the ride is also the loading screen.
 *
 *   const ride = new GravityFaultRide({ renderer, spheres: ammo });
 *   ride.update(dt, time);   // every frame
 *   ride.render();
 *   ride.onPointerMove(x, y); // NDC, -1..1
 *   if (ride.result.done) { ... ride.dispose(); }
 *
 * Timeline (seconds from the doors closing):
 *   0.4  doors close behind Subject 07, the Foundry glowing through them
 *   1.8  the lift launches up the outside of Ascension Tower
 *   2.2  outside shot: the tower, the burning floors below, the city
 *   5.8  back inside: look around while the lift climbs
 *   ~10  fade out; Level 3 opens with this lift arriving
 *
 * Scene hierarchy:
 *   RideScene
 *   |-- RideWorld        sky, city, skyline, Ascension Tower (shaders.js)
 *   |-- LiftShaft        rails, ring beams, marker lamps
 *   |-- GravityLiftCabin moves up the shaft
 *   |   |-- frame, glass, doors, floor display, energy conduits
 *   |   |-- cabin light
 *   |   `-- PlayerRoot   the character picked on the start screen (Level 3's
 *   |                    PlayerAvatar), or a simple figure until it loads;
 *   |                    hidden in first-person shots
 *   `-- lights           moon, fire uplight from below, hemisphere
 */

import * as THREE from "../three.js";
import { createRideUniforms } from "./shaders.js";
import { buildWorld, buildShaft, buildCabin, buildFigure, Owned, STOREY } from "./kit.js";
import { ElevatorHud } from "../ui/elevator-hud.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";

/** Level 2 is floor 140 of Ascension Tower; Level 3 is further up. */
export const START_FLOOR = 141;
const CRUISE = 13;
const ACCEL = 6;

const DOORS_CLOSE = [0.4, 1.6];
const LAUNCH_AT = 1.8;
const END_AT = 9.8;
const FADE_IN = 0.6;
const FADE_OUT = 0.8;

/** Camera shots by time: [start, name]. The last one that has started wins. */
const SHOTS = [
  [0, "doors"],
  [2.2, "exterior"],
  [5.8, "interior"],
];

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
   *   Calibration Lift): start with the doors shut, as the lift launches
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
    scene.add(this.world.root, this.shaft.root, this.cabin.root);

    scene.add(new THREE.HemisphereLight(0x39405a, 0x3a1a0c, 0.7));
    const moon = new THREE.DirectionalLight(0x8aa0d0, 0.55);
    moon.position.set(-0.5, 1, -0.8);
    const fireLight = new THREE.DirectionalLight(0xff7a30, 1.0);
    fireLight.position.set(0.2, -1, -0.5);
    scene.add(moon, fireLight);

    this.hud = new ElevatorHud();
    this.hud.show();

    this.state = {
      t: boarded ? LAUNCH_AT - 0.1 : 0,
      /** Seconds since the ride appeared (the fade-in). */
      age: 0,
      cabinY: 0,
      velocity: 0,
      shot: null,
      shake: 0,
      launched: false,
    };
    this.pointer = new THREE.Vector2();
    this._view = { yaw: 0, pitch: 0 };
    this.fade = 1;
    this.result = { done: false, stabilised: 0, bonus: 0, spheres };

    this.cabin.setDoors(boarded ? 0 : 1);
    this.cabin.display.userData.draw(String(START_FLOOR));
    this._place(0);
  }

  /** Pointer in normalised device coordinates (-1..1), from the host. */
  onPointerMove(x, y) {
    this.pointer.set(x, y);
  }

  update(dt, time) {
    if (this.result.done) return;
    const s = this.state;
    s.t += dt;
    s.age += dt;
    const t = s.t;
    this.uniforms.uTime.value = time;

    // Doors close, then the lift launches and accelerates to cruise.
    const [closeFrom, closeTo] = DOORS_CLOSE;
    this.cabin.setDoors(1 - (t - closeFrom) / (closeTo - closeFrom));
    if (!s.launched && t >= LAUNCH_AT) {
      s.launched = true;
      s.shake = Math.max(s.shake, 0.18);
      this.events.emit("depart", {});
    }
    if (s.launched) s.velocity = Math.min(CRUISE, s.velocity + ACCEL * dt);
    s.cabinY += s.velocity * dt;
    this._place(s.cabinY);

    const floor = START_FLOOR + s.cabinY / STOREY;
    this.hud.setFloor(floor, s.velocity);
    this.cabin.display.userData.draw(String(Math.floor(floor)));
    if (t < LAUNCH_AT && !this.boarded) this.hud.alert("DOORS CLOSING", "info");
    else if (t < LAUNCH_AT + 2.5) this.hud.alert("ASCENDING // SECTOR 03", "info");
    else this.hud.alert(null);

    this.figure.pose(0, time, dt);

    // Fades are the host's overlay; the ride only says how dark.
    this.fade = Math.max(1 - s.age / FADE_IN, THREE.MathUtils.clamp((t - (END_AT - FADE_OUT)) / FADE_OUT, 0, 1));
    if (t >= END_AT) {
      this.result.done = true;
      this.events.emit("arrive", { ...this.result });
    }

    this._updateCamera(dt, time);
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

  _shotAt(t) {
    let name = SHOTS[0][1];
    for (const [start, shot] of SHOTS) if (t >= start) name = shot;
    // Boarded in Level 2: the doors shot has already happened there.
    if (name === "doors" && this.boarded) name = "exterior";
    return name;
  }

  _updateCamera(dt, time) {
    const s = this.state;
    const cam = this.camera;
    const shot = this._shotAt(s.t);
    if (shot !== s.shot) {
      s.shot = shot;
      s.shotT = 0;
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
    } else if (shot === "exterior") {
      // Outside, over the drop: the cabin climbing the tower, the fire below.
      const u = Math.min(1, s.shotT / 3.6);
      const angle = THREE.MathUtils.lerp(-0.8, -0.3, u * calm + (1 - calm) * 0.5);
      const radius = 12.5 - u * 1.5;
      cam.position.set(Math.sin(angle) * radius, y - 2.2 + u * 3.6, -Math.cos(angle) * radius);
      _look.set(0, y + 1.3 - (1 - u) * 1.2, 0.8);
      cam.fov = 58;
    } else {
      // First person: look around with the mouse while the lift climbs.
      const view = this._view;
      const k = 1 - Math.exp(-dt * 5);
      view.yaw += (-this.pointer.x * 0.55 - view.yaw) * k;
      view.pitch += (this.pointer.y * 0.3 - 0.08 - view.pitch) * k;
      const bob = Math.sin(time * 1.6) * 0.012 * calm;
      cam.position.set(0, y + 1.62 + bob, 0.55);
      _look.set(Math.sin(view.yaw) * 8, y + 1.62 + Math.sin(view.pitch) * 8, 0.55 - Math.cos(view.yaw) * 8);
      cam.fov = 72;
    }

    if (s.shake > 0.001) {
      const k = s.shake * calm;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
      s.shake = Math.max(0, s.shake - dt * 0.8);
    }
    cam.lookAt(_look);
    cam.updateProjectionMatrix();
  }

  render() {
    const renderer = this.renderer;
    const size = renderer.getSize(_size);
    this.camera.aspect = size.x / Math.max(1, size.y);
    this.camera.updateProjectionMatrix();
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
    this.events.clear();
    this.hud.dispose();
    this.owned.dispose();
    this.scene.clear();
  }
}
