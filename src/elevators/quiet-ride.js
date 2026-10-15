/**
 * Cutscene 7 - the lift after the Labs (Tebogo's task sheet, new storyline):
 * "The player alone for the first time, holding his equipment, catching
 * their breath. A quiet, powerful beat after cutscene 6."
 *
 * Seen through Subject 07's own eyes, in the same glass lift as the Gravity
 * Fault, outside the tower. The doors close on the glow of the burning Labs
 * - and on the good scientist. The lift climbs. They turn to the glass, the
 * city burning far below, slide down the door wall and sit. His radio, in
 * their hand, crackles: the helicopter pilot, asking for the doctor, then
 * telling whoever has the radio how to reach the roof. They get up, take
 * the launcher from where it leans on the glass, and the tower shudders. A
 * chime; they turn, and the doors open on the skybridge's light.
 *
 * Built on the Gravity Fault's world and glass cabin (kit.js). A ride object
 * like GravityFaultRide, so main.js runs it the same way: update(),
 * render(), `fade`, `result.done`, dispose().
 *
 * Events (ride.events.on) for sound: shot, depart, radio, tremor, chime,
 * doors, arrive.
 */

import * as THREE from "../three.js";
import { createRideUniforms } from "./shaders.js";
import { buildWorld, buildShaft, buildCabin, Owned, STOREY, TOWER_FACE } from "./kit.js";
import { CameraShake } from "./shake.js";
import { LauncherProp } from "./launcher.js";
import { ElevatorHud } from "../ui/elevator-hud.js";
import { VOICE_LINES } from "../audio/voice-lines.js";

/** The script: [seconds, beat]. See _beat() for what each does. */
const SCRIPT = [
  [0.2, "close"],
  [1.2, "depart"],
  [2.0, "turn"],
  [3.6, "slide"],
  [5.4, "radio1"],
  [9.8, "radio2"],
  [14.2, "stand"],
  [14.9, "take"],
  [16.0, "tremor"],
  [17.4, "chime"],
  [18.0, "doors"],
];
export const QUIET_RIDE_SECONDS = 20.4;
const FADE_IN = 0.8;
const FADE_OUT = 0.9;
/** The lift leaves the Labs this high on the tower's face (metres). */
const START_Y = 150;

/** The pilot's lines (subtitles; voiced - src/audio/voice-lines.js). */
export const LINES = {
  radio1: ["RADIO", "...Doctor? Doctor, this is Kestrel One. We're on approach. Do you copy?"],
  radio2: ["RADIO", "...Whoever has this radio - the helipad is on the roof, across the skybridge. We can't hold long."],
};

/**
 * Where the eyes are and what they look at, beat by beat (cabin frame: the
 * doors are the +Z wall, the city is toward -Z; yaw 0 looks out at the city).
 */
const VIEWS = {
  doors: { eye: [0.05, 1.62, 0.55], yaw: Math.PI, pitch: -0.04 },
  city: { eye: [0.3, 1.6, -1.25], yaw: 0.1, pitch: -0.55 },
  sit: { eye: [1.2, 0.8, 1.55], yaw: 0.14, pitch: 0.0 },
  radio: { eye: [1.2, 0.76, 1.5], yaw: 0.2, pitch: -0.36 },
  launcher: { eye: [0.9, 1.6, 1.25], yaw: 1.42, pitch: -0.5 },
  ready: { eye: [0.6, 1.62, 1.0], yaw: 0.05, pitch: -0.06 },
  up: { eye: [0.6, 1.58, 1.0], yaw: 0.25, pitch: 0.42 },
  arrive: { eye: [0.05, 1.62, 0.35], yaw: Math.PI, pitch: -0.02 },
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

/**
 * A doorway seen from outside: a corridor in one-point perspective, lit at
 * its far end - the Labs burning (orange, smoke) or the skybridge in daylight.
 */
function doorwayTexture(kind) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 384;
  const g = c.getContext("2d");
  const fire = kind === "fire";
  const [near, far, glow] = fire ? ["#1a0a05", "#7a2a0c", "#ffb24a"] : ["#1c2630", "#9fb4c4", "#f4fbff"];
  // Walls, floor and ceiling converge on the far end.
  const fx = 128;
  const fy = 210;
  const fw = 52;
  const fh = 78;
  const quad = (pts, colour) => {
    g.fillStyle = colour;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.fill();
  };
  const L = fx - fw;
  const R = fx + fw;
  const T = fy - fh;
  const B = fy + fh;
  quad([[0, 0], [L, T], [L, B], [0, 384]], fire ? "#2a1006" : "#2d3a45");
  quad([[256, 0], [R, T], [R, B], [256, 384]], fire ? "#24100a" : "#26323c");
  quad([[0, 0], [256, 0], [R, T], [L, T]], near);
  quad([[0, 384], [256, 384], [R, B], [L, B]], fire ? "#120806" : "#33414c");
  // The far end, and light down the corridor.
  const end = g.createRadialGradient(fx, fy, 4, fx, fy, 120);
  end.addColorStop(0, glow);
  end.addColorStop(0.45, far);
  end.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = end;
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = glow;
  g.fillRect(L + 6, T + 6, fw * 2 - 12, fh * 2 - 12);
  // Ceiling lights (or flames licking up the walls).
  g.globalAlpha = 0.85;
  for (let i = 0; i < 4; i += 1) {
    const k = i / 4;
    const y = T * k;
    const x0 = L * k;
    const x1 = 256 - (256 - R) * k;
    if (fire) {
      g.fillStyle = i % 2 ? "#ff7a1c" : "#ffcf5a";
      for (let f = 0; f < 3; f += 1) g.fillRect(x0 + (x1 - x0) * (0.15 + f * 0.33), 384 - (384 - B) * k - 30 * (1 - k), 10 * (1 - k) + 4, 40 * (1 - k) + 8);
    } else {
      g.fillStyle = "#ffffff";
      g.fillRect(x0 + (x1 - x0) * 0.3, y + 4, (x1 - x0) * 0.4, 6 * (1 - k) + 2);
    }
  }
  // Smoke rolling along the ceiling.
  if (fire) {
    g.globalAlpha = 0.5;
    const smoke = g.createLinearGradient(0, 0, 0, 200);
    smoke.addColorStop(0, "#050302");
    smoke.addColorStop(1, "rgba(5,3,2,0)");
    g.fillStyle = smoke;
    g.fillRect(0, 0, 256, 200);
  }
  g.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const _size = new THREE.Vector2();
const _eye = new THREE.Vector3();

export class QuietRide {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {string} [o.assetBase]  Level 3's assets, for the launcher model
   * @param {number} [o.spheres]
   * @param {boolean} [o.reducedMotion]
   * @param {number} [o.fromFloor]  the floor number the ride starts at
   * @param {() => boolean} [o.waitFor]  the next level is ready: until it is,
   *   the last shot holds (doors open, breathing) instead of fading to black
   */
  constructor({ renderer, assetBase = null, spheres = 0, reducedMotion = false, fromFloor = 152, waitFor = null }) {
    this.renderer = renderer;
    this.reducedMotion = reducedMotion;
    this.events = createEmitter();
    this.owned = new Owned();
    this.uniforms = createRideUniforms();
    this.visible = true;
    /** main.js hides the game's HUD while a cutscene ride plays. */
    this.cutscene = true;
    this.fromFloor = fromFloor;
    this.waitFor = waitFor;
    this.held = 0;

    const scene = (this.scene = new THREE.Scene());
    scene.name = "QuietRideScene";
    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.FogExp2(this.uniforms.uFogColor.value, this.uniforms.uFogDensity.value);
    this.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.02, 5000);
    scene.add(this.camera);

    // Outside the tower, the Labs' floors burning below the lift.
    this.world = buildWorld(this.uniforms, this.owned);
    this.world.towerMat.uniforms.uFireLine.value = START_Y + 6;
    this.shaft = buildShaft(this.owned, { from: START_Y - 120, to: START_Y + 260 });
    this.cabin = buildCabin(this.uniforms, this.owned);
    scene.add(this.world.root, this.shaft.root, this.cabin.root);
    scene.add(new THREE.HemisphereLight(0x39405a, 0x3a1a0c, 0.75));
    const moon = new THREE.DirectionalLight(0x8aa0d0, 0.55);
    moon.position.set(-0.5, 1, -0.8);
    const fireLight = new THREE.DirectionalLight(0xff7a30, 1.1);
    fireLight.position.set(0.2, -1, -0.5);
    scene.add(moon, fireLight);

    // The doorways on the tower's face: the Labs on fire behind the doors as
    // they close, and the skybridge's light where they open.
    const doorway = this.owned.add(new THREE.PlaneGeometry(2.2, 3.3));
    this.labsGlow = this.owned.add(new THREE.MeshBasicMaterial({ map: this.owned.add(doorwayTexture("fire")), color: new THREE.Color(1.3, 1.1, 1), fog: false }));
    this.bridgeGlow = this.owned.add(new THREE.MeshBasicMaterial({ map: this.owned.add(doorwayTexture("day")), color: new THREE.Color(0, 0, 0), fog: false }));
    this.labsDoor = new THREE.Mesh(doorway, this.labsGlow);
    this.bridgeDoor = new THREE.Mesh(doorway, this.bridgeGlow);
    for (const d of [this.labsDoor, this.bridgeDoor]) {
      d.rotation.y = Math.PI;
      scene.add(d);
    }
    this.labsDoor.position.set(0, START_Y + 1.65, TOWER_FACE - 0.03);
    this.bridgeLight = new THREE.PointLight(0xdfeeff, 0, 12, 1.5);
    this.cabin.root.add(this.bridgeLight);
    this.bridgeLight.position.set(0, 1.6, 2.6);

    // In their hands: the radio (his), and later the launcher.
    this.hands = new THREE.Group();
    this.camera.add(this.hands);
    this.radio = this._buildRadio();
    this.hands.add(this.radio);
    this.grip = new THREE.Group();
    this.grip.position.set(0.3, -0.33, -0.45);
    this.grip.rotation.set(0.08, 0.55, 0.2);
    this.camera.add(this.grip);
    this.gripGlove = this._glove();
    this.gripGlove.position.set(-0.04, -0.19, -0.08);
    this.gripGlove.visible = false;
    this.grip.add(this.gripGlove);
    this.launcher = new LauncherProp(this.cabin.root, assetBase);
    this.launcher.restAt(new THREE.Vector3(-1.55, 0.62, 1.05), new THREE.Euler(Math.PI / 2 + 0.32, 0.25, 0.1));

    /** 0 standing, 1 sitting on the floor against the door wall. */
    this.sit = 0;
    this.radioUp = 0;
    this.radioUpTarget = 0;
    this.view = { ...VIEWS.doors, eye: new THREE.Vector3(...VIEWS.doors.eye) };
    this.target = VIEWS.doors;
    this.pointer = new THREE.Vector2();
    this.look = new THREE.Vector2();
    this.breath = 1;

    this.shake = new CameraShake({ reduced: reducedMotion });
    this.hud = new ElevatorHud({ panel: false });
    this.hud.show();
    this.hud.cinema(true);

    this.t = 0;
    this.fired = new Set();
    this.speed = 0;
    this.cabinY = START_Y;
    this.doors = 1;
    this.doorsTarget = 1;
    this.light = 1;
    this.shot = null;
    this.fade = 1;
    this.talking = 0;
    this.result = { done: false, stabilised: 0, bonus: 0, spheres };
    this.wantsAim = false;
    this.aimTarget = null;
    this._place();
    this.cabin.display.userData.draw(String(fromFloor));
  }

  /** A handheld radio in a gloved hand: dark casing, a stub antenna, a lit screen and a talk light. */
  _buildRadio() {
    const own = (x) => this.owned.add(x);
    const casing = own(new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.3, roughness: 0.55 }));
    const rubber = own(new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.9 }));
    this.radioScreen = own(new THREE.MeshBasicMaterial({ color: 0x5fe08a }));
    this.radioLed = own(new THREE.MeshBasicMaterial({ color: 0x401010 }));
    const root = new THREE.Group();
    root.name = "Radio";
    const body = new THREE.Mesh(own(new THREE.BoxGeometry(0.068, 0.15, 0.036)), casing);
    const antenna = new THREE.Mesh(own(new THREE.CylinderGeometry(0.007, 0.009, 0.08, 8)), rubber);
    antenna.position.set(0.022, 0.115, 0);
    const knob = new THREE.Mesh(own(new THREE.CylinderGeometry(0.009, 0.009, 0.014, 10)), rubber);
    knob.position.set(-0.018, 0.082, 0);
    const screen = new THREE.Mesh(own(new THREE.PlaneGeometry(0.046, 0.026)), this.radioScreen);
    screen.position.set(0, 0.036, 0.0185);
    const grille = new THREE.Mesh(own(new THREE.PlaneGeometry(0.05, 0.05)), rubber);
    grille.position.set(0, -0.025, 0.0185);
    const led = new THREE.Mesh(own(new THREE.SphereGeometry(0.0055, 8, 6)), this.radioLed);
    led.position.set(-0.024, 0.07, 0.016);
    const glove = this._glove();
    glove.position.set(0.005, -0.055, -0.02);
    root.add(body, antenna, knob, screen, grille, led, glove);
    root.rotation.set(0.5, -0.25, 0.08);
    return root;
  }

  /** A gloved hand and the sleeve behind it, reaching up from the bottom of the view. */
  _glove() {
    const own = (x) => this.owned.add(x);
    const glove = own(new THREE.MeshStandardMaterial({ color: 0x1a1d1f, roughness: 0.85 }));
    const sleeve = own(new THREE.MeshStandardMaterial({ color: 0x2c3a3f, roughness: 0.9 }));
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.036, 0.05, 4, 10)), glove);
    palm.rotation.z = Math.PI / 2;
    palm.scale.set(1, 1, 0.8);
    const arm = new THREE.Mesh(own(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 12)), sleeve);
    arm.position.set(0.02, -0.06, 0.17);
    arm.rotation.x = Math.PI / 2 - 0.35;
    hand.add(palm, arm);
    return hand;
  }

  /** Pointer in normalised device coordinates: a little looking around. */
  onPointerMove(x, y) {
    this.pointer.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  fire() {
    return false;
  }

  /** Where the doors are: 0 shut, 1 open (the checks read it). */
  get doorsOpen() {
    return this.doors;
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
    this.uniforms.uTime.value = time;
    for (const [at, beat] of SCRIPT) {
      if (t >= at && !this.fired.has(beat)) {
        this.fired.add(beat);
        this._beat(beat);
      }
    }

    // The climb: speeds up, cruises, slows for the skybridge.
    if (this.fired.has("depart")) {
      const target = this.fired.has("chime") ? 0 : t > 16.8 ? 1.5 : 6;
      this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 1.1 : 2.2));
    }
    this.cabinY += this.speed * dt;
    this._place();
    const floor = this.fromFloor + Math.floor((this.cabinY - START_Y) / STOREY);
    this.cabin.display.userData.draw(this.fired.has("chime") ? "SB" : String(floor));

    // The light: steady, a stutter in the tremor.
    const stutter = t > 16 && t < 17.1 ? (Math.sin(time * 41) + Math.sin(time * 23) > 0.2 ? 1 : 0.15) : 1;
    this.cabin.setLights(this.light * stutter, stutter, stutter > 0.5 ? 1 : 0.1, 0, time);
    this.doors += (this.doorsTarget - this.doors) * Math.min(1, dt * 1.6);
    if (Math.abs(this.doorsTarget - this.doors) < 0.002) this.doors = this.doorsTarget;
    this.cabin.setDoors(this.doors);
    // The skybridge's light spills in as the doors part.
    const open = this.fired.has("doors") ? this.doors : 0;
    this.bridgeGlow.color.setScalar(0.15 + 1.05 * open);
    this.bridgeLight.intensity = 14 * open;

    // The radio: up to the face while the pilot talks, its light on his words.
    this.radioUp += (this.radioUpTarget - this.radioUp) * Math.min(1, dt * 3.2);
    this.talking = Math.max(0, this.talking - dt);
    const live = this.talking > 0 && Math.sin(time * 26) > -0.6;
    this.radioLed.color.setHex(live ? 0xff3a2a : 0x401010);
    this.radioScreen.color.setHex(live ? 0x8affb0 : 0x2f7046);

    // Subtitles clear on their own.
    if (this._captionUntil && t > this._captionUntil) {
      this.hud.caption(null, null);
      this._captionUntil = 0;
    }
    this.launcher.update(dt, 9.8);
    if (this.launcher.state === "held") this.gripGlove.visible = true;
    this._trimLauncher();
    this.shake.update(dt);
    // Breathing hard after the Labs, slower by the end.
    this.breath += ((t > 13 ? 0.35 : 1) - this.breath) * Math.min(1, dt * 0.4);

    const fadeOut = THREE.MathUtils.clamp((t - (QUIET_RIDE_SECONDS - FADE_OUT)) / FADE_OUT, 0, 1);
    this.fade = Math.max(1 - t / FADE_IN, fadeOut);
    if (t >= QUIET_RIDE_SECONDS) {
      this.result.done = true;
      this.hud.cinema(false);
      this.events.emit("arrive", { ...this.result });
    }
    this._updateCamera(dt, time);
  }

  /**
   * Seen from behind, this close, the model's small front fitting reads as
   * bits floating past the barrel: in the hands, without it.
   */
  _trimLauncher() {
    const model = this.launcher.model;
    if (!model || this._trimmed) return;
    this._trimmed = true;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    model.traverse((o) => {
      if (o.isMesh && box.setFromObject(o).getSize(size).length() < 0.25) o.visible = false;
    });
  }

  _place() {
    this.cabin.root.position.y = this.cabinY;
  }

  _say(key) {
    const [who, text] = LINES[key];
    const speech = VOICE_LINES[`pilot|${text}`]?.[1] ?? 3.6;
    this.hud.caption(who, text);
    this._captionUntil = this.t + speech + 0.25;
    this.talking = speech;
  }

  _shot(name) {
    if (name === this.shot) return;
    this.shot = name;
    this.events.emit("shot", { shot: name });
  }

  _beat(beat) {
    if (beat === "close") {
      // The doors shut on the Labs - and on Okoro.
      this.doorsTarget = 0;
      this._shot("doors");
    } else if (beat === "depart") {
      this.shake.add(0.3);
      this.shake.kick(0, -0.04, 0);
      this.events.emit("depart", {});
    } else if (beat === "turn") {
      this.target = VIEWS.city;
      this._shot("city");
    } else if (beat === "slide") {
      // Back against the door wall, sliding down it to sit.
      this.target = VIEWS.sit;
    } else if (beat === "radio1") {
      this.target = VIEWS.radio;
      this.radioUpTarget = 1;
      this._say("radio1");
      this._shot("radio");
      this.events.emit("radio", { line: 1 });
    } else if (beat === "radio2") {
      this._say("radio2");
      this.events.emit("radio", { line: 2 });
    } else if (beat === "stand") {
      // Up, and the launcher where it leans on the glass.
      this.radioUpTarget = 0;
      this.target = VIEWS.launcher;
      this._shot("launcher");
    } else if (beat === "take") {
      this.launcher.attach(this.grip, 0.8, null);
      this.target = VIEWS.ready;
    } else if (beat === "tremor") {
      this.shake.add(0.5);
      this.shake.kick(0.03, -0.04, 0);
      this.target = VIEWS.up;
      this.events.emit("tremor", {});
      // A look up at the noise overhead, then back.
      this._backAt = this.t + 0.9;
    } else if (beat === "chime") {
      this.target = VIEWS.arrive;
      this.bridgeDoor.position.set(0, this.cabinY + 1.65, TOWER_FACE - 0.03);
      this._shot("arrival");
      this.events.emit("chime", {});
    } else if (beat === "doors") {
      this.doorsTarget = 1;
      this.events.emit("doors", {});
    }
  }

  _updateCamera(dt, time) {
    if (this._backAt && this.t >= this._backAt) {
      this._backAt = 0;
      if (this.target === VIEWS.up) this.target = VIEWS.ready;
    }
    const v = this.view;
    const to = this.target;
    // Eyes move like a person's: the turn quick, sitting down slower.
    const kTurn = Math.min(1, dt * (this.reducedMotion ? 1.6 : 2.4));
    const kMove = Math.min(1, dt * 1.7);
    v.yaw += (to.yaw - v.yaw) * kTurn;
    v.pitch += (to.pitch - v.pitch) * kTurn;
    v.eye.lerp(_eye.set(...to.eye), kMove);
    this.sit = THREE.MathUtils.clamp((1.6 - v.eye.y) / 0.8, 0, 1);
    // The player can look round a little.
    this.look.lerp(this.pointer, Math.min(1, dt * 3));

    const cam = this.camera;
    const amp = this.reducedMotion ? 0.3 : 1;
    const rate = 2.2 + 3.2 * this.breath;
    const breathe = Math.sin(time * rate) * (0.006 + 0.016 * this.breath) * amp;
    cam.position.copy(v.eye);
    cam.position.y += breathe + this.cabinY;
    cam.rotation.set(v.pitch + breathe * 0.6 + this.look.y * 0.16, v.yaw - this.look.x * 0.32, 0, "YXZ");
    this.shake.apply(cam);

    // The radio rises into view in the left hand.
    const r = this.radioUp;
    this.radio.visible = r > 0.02;
    this.radio.position.set(-0.03, -0.34 + r * 0.25 + breathe * 0.4, -0.3);
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
    this.launcher.dispose();
    this.events.clear();
    this.hud.dispose();
    this.owned.dispose();
    this.scene.clear();
  }
}
