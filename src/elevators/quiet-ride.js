/**
 * Cutscene 7 - the lift after the Labs (Tebogo's task sheet, new storyline):
 * "The player alone for the first time, holding his equipment, catching
 * their breath. A quiet, powerful beat after cutscene 6."
 *
 * Seen through Subject 07's own eyes, in the same glass lift as the Gravity
 * Fault, outside the tower. The doors close on the glow of the burning Labs
 * - and on the good scientist. The lift climbs. They turn to the glass, the
 * city burning far below, slide down the door wall and sit. Static, from
 * the doctor's bag beside them: they open it, take out his radio, tune it
 * in - the helicopter pilot, asking for the doctor, then telling whoever has
 * the radio how to reach the roof - put it away, and take the launcher from
 * where it leans on the glass; the tower shudders. A chime; they turn, and
 * the doors open on the skybridge's light. The bag, the radio and the
 * launcher are the player's to do (GATES: prompts that wait, untimed - the
 * ride's clock, and the lift, hold for them).
 *
 * Built on the Gravity Fault's glass cabin (kit.js), with the levels' own
 * city round it (the Roof's downtown and city at night) and the two
 * landings built as the levels look (landings.js): the Labs burning where
 * the doors close, the skybridge's corridor where they open. A ride object
 * like GravityFaultRide, so main.js runs it the same way: update(),
 * render(), `fade`, `result.done`, dispose().
 *
 * Events (ride.events.on) for sound: shot, depart, radio, tremor, chime,
 * doors, arrive.
 */

import * as THREE from "../three.js";
import { createRideUniforms } from "./shaders.js";
import { buildWorld, buildShaft, buildCabin, Owned, STOREY, TOWER_FACE } from "./kit.js";
import { towerWithOpenings, buildLabsLanding, buildSkybridgeLanding } from "./landings.js";
import { CityAtNight } from "../levels/meltdown/city.js";
import { CbdBuildings } from "../levels/meltdown/cbd.js";
import { CameraShake } from "./shake.js";
import { LauncherProp } from "./launcher.js";
import { ElevatorHud } from "../ui/elevator-hud.js";
import { VOICE_LINES } from "../audio/voice-lines.js";
import { SKIN_TONES, savedSkinTone } from "../figure/look.js";
import { OUTFITS, savedOutfit } from "../figure/outfit.js";

/**
 * The script: [seconds, beat, gate]. See _beat() for what each does. A gate
 * waits for the player (GATES) before the script goes on: its clock holds there.
 */
const SCRIPT = [
  [0.2, "close"],
  [1.2, "depart"],
  [2.0, "turn"],
  [3.6, "slide"],
  [4.8, "static"],
  [5.4, "open", true],
  [5.9, "take", true],
  [6.6, "tune", true],
  [6.9, "radio1"],
  [11.3, "radio2"],
  [15.5, "away", true],
  [16.1, "launcher", true],
  [16.8, "grab"],
  [17.9, "tremor"],
  [19.3, "chime"],
  [19.9, "doors"],
];
/** When each beat comes, on the script's clock. */
const AT = Object.fromEntries(SCRIPT.map(([t, beat]) => [beat, t]));
export const QUIET_RIDE_SECONDS = 22.3;
/**
 * What the player does at each gate: the story's prompts (story/reaction.js,
 * so keyboard, controller and touch all work), with no clock on them. One
 * input for the whole beat, held, not tapped (playtest: a press of E here and
 * a hold there read as a test): hold Space - the trigger, the half of the
 * screen - a moment for each, longer to turn the dial.
 */
const GATES = {
  open: { kind: "hold", keys: ["Space"], label: "OPEN THE BAG", duration: 0.9, decay: 0.6 },
  take: { kind: "hold", keys: ["Space"], label: "TAKE OUT THE RADIO", duration: 0.9, decay: 0.6 },
  tune: { kind: "hold", keys: ["Space"], label: "TUNE IN", duration: 2.4, decay: 0.2 },
  away: { kind: "hold", keys: ["Space"], label: "PUT IT AWAY", duration: 0.9, decay: 0.6 },
  launcher: { kind: "hold", keys: ["Space"], label: "TAKE THE LAUNCHER", duration: 1.0, decay: 0.6 },
};
/** The radio's dial: from where it was left to Kestrel One's channel (MHz). */
const DIAL = { from: 116.4, to: 121.5 };
const FADE_IN = 0.8;
const FADE_OUT = 0.9;
/** The lift leaves the Labs this high on the tower's face (metres). */
const START_Y = 150;
/** The script's climb: its speed, second by second (update() and ARRIVE_Y). */
function climbSpeed(t, speed, dt, chimed) {
  const target = chimed ? 0 : t > AT.chime - 0.6 ? 1.5 : 6;
  return speed + (target - speed) * Math.min(1, dt * (target > speed ? 1.1 : 2.2));
}
/**
 * Where it stops: the skybridge's floor - the script's climb run through
 * once (at 60 fps), so the tower's opening for it is built in the right place.
 */
const ARRIVE_Y = (() => {
  let y = START_Y, speed = 0;
  const dt = 1 / 60;
  for (let t = 0; t < QUIET_RIDE_SECONDS; t += dt) {
    if (t >= AT.depart) speed = climbSpeed(t, speed, dt, t >= AT.chime);
    y += speed * dt;
  }
  return y;
})();
/**
 * The streets, this far down from the Labs' floor: the Roof's downtown round
 * the tower, its tallest at about the lift's height, the rest falling away below.
 */
const STREET_Y = START_Y - 140;

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
  bag: { eye: [1.15, 0.8, 1.45], yaw: 1.2, pitch: -0.62 },
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
  constructor({ renderer, assetBase = null, spheres = 0, reducedMotion = false, fromFloor = 152, waitFor = null, layer = null }) {
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
    // The story's layer: its prompts for the gates (none in a preview: they pass on their own).
    this.layer = layer;
    this.reactions = layer?.reactions ?? null;
    this.gate = null;
    this.gatesDone = new Set();
    this.tuning = 0;
    this.staticOn = false;
    this._staticT = 0;
    // Subject 07's own hands: their complexion, their outfit's sleeves.
    const tone = SKIN_TONES[savedSkinTone()] ?? SKIN_TONES.light;
    this.skinColour = tone.color ?? tone.swatch;
    this.sleeveColour = OUTFITS[savedOutfit()]?.color ?? OUTFITS.scrubs.swatch;

    const scene = (this.scene = new THREE.Scene());
    scene.name = "QuietRideScene";
    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.FogExp2(this.uniforms.uFogColor.value, this.uniforms.uFogDensity.value);
    this.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.02, 5000);
    scene.add(this.camera);

    // Outside the tower, the Labs' floors burning below the lift.
    this.world = buildWorld(this.uniforms, this.owned);
    this.world.towerMat.uniforms.uFireLine.value = START_Y + 6;
    // The tower with real doorways at the two landings (the box is solid).
    this.world.tower.visible = false;
    this.world.root.add(towerWithOpenings(this.world.towerMat, this.owned, [START_Y, ARRIVE_Y]));
    // The city as the levels show it: the Roof's old downtown and the city
    // at night round it, in place of the ride's own boxes and flat ground.
    for (const o of this.world.root.children) if (o.name === "Skyline" || o.name === "City") o.visible = false;
    const centre = new THREE.Vector3(0, 0, TOWER_FACE + 20);
    this.cbd = new CbdBuildings({ streetY: STREET_Y, centre });
    this.city = new CityAtNight({ seed: 47, streetY: STREET_Y, centre, neighbours: 3, clear: [...this.cbd.footprints, { x: 0, z: 0, r: 34 }] });
    this.world.root.add(this.city.root, this.cbd.root);
    this.shaft = buildShaft(this.owned, { from: START_Y - 120, to: START_Y + 260 });
    this.cabin = buildCabin(this.uniforms, this.owned);
    scene.add(this.world.root, this.shaft.root, this.cabin.root);
    scene.add(new THREE.HemisphereLight(0x39405a, 0x3a1a0c, 0.75));
    const moon = new THREE.DirectionalLight(0x8aa0d0, 0.55);
    moon.position.set(-0.5, 1, -0.8);
    const fireLight = new THREE.DirectionalLight(0xff7a30, 1.1);
    fireLight.position.set(0.2, -1, -0.5);
    scene.add(moon, fireLight);

    // The landings behind the doorways: the Labs on fire as the doors
    // close, the skybridge where they open (landings.js).
    this.labs = buildLabsLanding(this.owned);
    this.labs.root.position.y = START_Y;
    this.bridge = buildSkybridgeLanding(this.owned);
    this.bridge.root.position.y = ARRIVE_Y;
    scene.add(this.labs.root, this.bridge.root);
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
    this.gripGlove = this._hand();
    this.gripGlove.position.set(-0.04, -0.19, -0.08);
    this.gripGlove.visible = false;
    this.grip.add(this.gripGlove);
    this.launcher = new LauncherProp(this.cabin.root, assetBase);
    this.launcher.restAt(new THREE.Vector3(-1.55, 0.62, 1.05), new THREE.Euler(Math.PI / 2 + 0.32, 0.25, 0.1));
    // The doctor's bag on the floor beside where they sit; his radio in it.
    this.bag = this._buildBag();
    this.cabin.root.add(this.bag.root);

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

  /**
   * The doctor's handheld radio, in Subject 07's left hand: dark casing, a
   * stub antenna, a talk light, and a screen with its dial - the frequency,
   * the signal bars, the channel's name once it is found.
   */
  _buildRadio() {
    const own = (x) => this.owned.add(x);
    const casing = own(new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.3, roughness: 0.55 }));
    const rubber = own(new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.9 }));
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 72;
    this.dialCanvas = c;
    this.dialTexture = own(new THREE.CanvasTexture(c));
    this.dialTexture.colorSpace = THREE.SRGBColorSpace;
    this.radioScreen = own(new THREE.MeshBasicMaterial({ color: 0xb8d8c2, map: this.dialTexture }));
    this._drawDial(0, false);
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
    const hand = this._hand();
    root.add(body, antenna, knob, screen, grille, led, hand);
    root.rotation.set(0.5, -0.25, 0.08);
    return root;
  }

  /** The radio's screen: the dial at `k` (0 where it was left, 1 on the channel). */
  _drawDial(k, found) {
    const g = this.dialCanvas.getContext("2d");
    const { width: w, height: h } = this.dialCanvas;
    g.fillStyle = "#0b1a10";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#9dffc0";
    g.font = "700 26px monospace";
    g.textBaseline = "top";
    g.fillText((DIAL.from + (DIAL.to - DIAL.from) * k).toFixed(1), 8, 6);
    g.font = "600 11px monospace";
    g.fillText("MHz", 92, 16);
    // Signal bars, and the static's snow until it's found.
    for (let i = 0; i < 5; i += 1) {
      g.globalAlpha = k * 5 > i + 0.4 ? 1 : 0.18;
      g.fillRect(8 + i * 10, 62 - i * 5, 7, 4 + i * 5);
    }
    g.globalAlpha = 1;
    g.fillText(found ? "KESTREL ONE" : k > 0 ? "SEARCHING" : "NO SIGNAL", 62, 50);
    if (!found) {
      g.fillStyle = "rgba(157,255,192,0.35)";
      for (let i = 0; i < 40 * (1 - k); i += 1) g.fillRect(Math.random() * w, 36 + Math.random() * 10, 2, 1);
    }
    this.dialTexture.needsUpdate = true;
  }

  /**
   * Subject 07's hand and forearm, as they hold something: the palm behind
   * it, four fingers round its side and across its front, the thumb up the
   * other side, the wrist and the sleeve running down out of the view (a
   * hand on its own floats in the air). Their complexion, their outfit's colour.
   */
  _hand() {
    const own = (x) => this.owned.add(x);
    const skin = own(new THREE.MeshStandardMaterial({ color: this.skinColour, roughness: 0.62 }));
    const sleeve = own(new THREE.MeshStandardMaterial({ color: this.sleeveColour, roughness: 0.9 }));
    const hand = new THREE.Group();
    hand.name = "Hand";
    const palm = new THREE.Mesh(own(new THREE.BoxGeometry(0.074, 0.085, 0.024)), skin);
    palm.position.set(0, -0.034, -0.031);
    hand.add(palm);
    const knuckle = own(new THREE.CapsuleGeometry(0.0085, 0.028, 3, 8));
    const tip = own(new THREE.CapsuleGeometry(0.0082, 0.024, 3, 8));
    for (let i = 0; i < 4; i += 1) {
      const y = -0.07 + i * 0.018;
      // Round the right side, then across the front, a little shorter each from the index down.
      const side = new THREE.Mesh(knuckle, skin);
      side.rotation.x = Math.PI / 2;
      side.position.set(0.041, y, -0.008);
      const front = new THREE.Mesh(tip, skin);
      front.rotation.z = Math.PI / 2;
      front.position.set(0.026 - (i === 3 ? 0.004 : 0), y, 0.024);
      hand.add(side, front);
    }
    const thumb = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.0095, 0.038, 3, 8)), skin);
    thumb.rotation.z = 0.25;
    thumb.position.set(-0.036, -0.03, 0.012);
    hand.add(thumb);
    // The wrist, then the forearm in its sleeve, down and back out of the frame.
    const down = new THREE.Vector3(-0.12, -0.86, 0.5).normalize();
    const arm = new THREE.Group();
    arm.position.set(0, -0.075, -0.03);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), down);
    const wrist = new THREE.Mesh(own(new THREE.CylinderGeometry(0.026, 0.03, 0.14, 12)), skin);
    wrist.position.y = -0.07;
    const cuff = new THREE.Mesh(own(new THREE.CylinderGeometry(0.042, 0.048, 0.5, 14)), sleeve);
    cuff.position.y = -0.37;
    arm.add(wrist, cuff);
    hand.add(arm);
    return hand;
  }

  /**
   * The doctor's bag: an olive duffel with black straps and a flap that
   * opens, his radio inside - its screen glowing, crackling, until it's taken.
   */
  _buildBag() {
    const own = (x) => this.owned.add(x);
    const canvas = own(new THREE.MeshStandardMaterial({ color: 0x55603e, roughness: 0.88 }));
    const strap = own(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 }));
    const inside = own(new THREE.MeshBasicMaterial({ color: 0x07080a }));
    const root = new THREE.Group();
    root.name = "DoctorsBag";
    root.position.set(0.5, 0, 1.22);
    root.rotation.y = 0.35;
    const body = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.16, 0.4, 6, 16)), canvas);
    body.rotation.z = Math.PI / 2;
    body.scale.set(1, 1, 0.86);
    body.position.y = 0.16;
    root.add(body);
    for (const x of [-0.14, 0.14]) {
      const ring = new THREE.Mesh(own(new THREE.TorusGeometry(0.163, 0.012, 6, 24)), strap);
      ring.rotation.y = Math.PI / 2;
      ring.scale.set(0.86, 1, 1);
      ring.position.set(x, 0.16, 0);
      root.add(ring);
    }
    const handle = new THREE.Mesh(own(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI)), strap);
    handle.position.set(0, 0.31, -0.02);
    root.add(handle);
    // The opening along the top, under the flap.
    const mouth = new THREE.Mesh(own(new THREE.BoxGeometry(0.36, 0.012, 0.1)), inside);
    mouth.position.set(0, 0.305, 0.02);
    root.add(mouth);
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.31, -0.035);
    const flap = new THREE.Mesh(own(new THREE.BoxGeometry(0.4, 0.016, 0.13)), canvas);
    flap.position.z = 0.062;
    hinge.add(flap);
    root.add(hinge);
    // His radio, in there: the screen's glow through the opening.
    const glowMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 0.7) }));
    const glow = new THREE.Mesh(own(new THREE.PlaneGeometry(0.05, 0.03)), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0.04, 0.312, 0.03);
    root.add(glow);
    const bag = { root, hinge, glow, glowMat, open: 0, target: 0 };
    bag.update = (dt, time, crackle) => {
      bag.open += (bag.target - bag.open) * Math.min(1, dt * 5);
      hinge.rotation.x = -1.9 * bag.open;
      const k = crackle ? 0.45 + 0.55 * (Math.sin(time * 37) * Math.sin(time * 23) > 0 ? 1 : 0.2) : 0.15;
      glowMat.color.setRGB(0.4 * k, 1.4 * k, 0.7 * k);
    };
    return bag;
  }

  /** Pointer in normalised device coordinates: a little looking around. */
  onPointerMove(x, y) {
    this.pointer.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  fire() {
    return false;
  }

  /** The script reached a gate: ask, and hold the clock until it's done. */
  _openGate(name) {
    this.gate = name;
    this._gateT = 0;
    this.events.emit("prompt", { name });
    const r = this.reactions;
    if (!r) return;
    this._uiWasHidden = this.layer.ui?.root?.hidden;
    this.layer.ui?.show?.();
    // No clock on it: an hour to do it in.
    r.start({ ...GATES[name], window: 3600, time: 3600 });
  }

  _updateGate(dt) {
    const r = this.reactions;
    if (!r) {
      // (A preview with no prompts: on by itself.)
      this._gateT += dt;
      if (this._gateT > 0.8) this._closeGate();
      return;
    }
    const result = r.update(dt);
    if (this.gate === "tune") this.tuning = r._s?.bar ?? (result === "success" ? 1 : this.tuning);
    if (result === "success") this._closeGate();
    // (Nothing to fail - no clock, and a hold has no wrong key - but if it does: ask again.)
    else if (result === "fail") r.start({ ...GATES[this.gate], window: 3600, time: 3600 });
  }

  _closeGate() {
    const name = this.gate;
    this.gate = null;
    this.gatesDone.add(name);
    if (this.reactions && this._uiWasHidden) this.layer.ui?.hide?.();
    this._beat(name);
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
    const before = this.t;
    if (this.gate) this._updateGate(dt);
    else if (this.t + dt >= holdAt && this.waitFor && !this.waitFor() && this.held < 20) {
      this.held += dt;
      this.t = Math.max(this.t, holdAt - 1e-4);
    } else {
      // Up to the next gate the player hasn't done, and no further.
      const next = SCRIPT.find(([at, beat, gate]) => gate && !this.gatesDone.has(beat) && this.t + dt >= at);
      if (next) {
        this.t = next[0];
        this._openGate(next[1]);
      } else this.t += dt;
    }
    // The script's own time this frame: none while a gate waits (the lift holds with it).
    const sdt = this.t - before;
    const t = this.t;
    this.uniforms.uTime.value = time;
    for (const [at, beat] of SCRIPT) {
      if (t >= at && !this.fired.has(beat)) {
        this.fired.add(beat);
        this._beat(beat);
      }
    }

    // The climb: speeds up, cruises, slows for the skybridge - and settles
    // on its floor exactly (the doorway built for it: ARRIVE_Y).
    if (this.fired.has("depart") && sdt > 0) this.speed = climbSpeed(t, this.speed, sdt, this.fired.has("chime"));
    if (this.fired.has("chime")) this.cabinY += (ARRIVE_Y - this.cabinY) * Math.min(1, dt * 2.2);
    else this.cabinY = Math.min(ARRIVE_Y, this.cabinY + this.speed * sdt);
    this.labs.update(dt, time);
    // The bag: its flap, the radio's crackle inside; the static, until it's tuned.
    this.bag.update(dt, time, this.staticOn && !this.gatesDone.has("take"));
    if (this._closeBag && (this._closeBag -= dt) <= 0) {
      this._closeBag = 0;
      this.bag.target = 0;
    }
    if (this.staticOn) {
      this._staticT -= dt;
      if (this._staticT <= 0) {
        this._staticT = 0.45 + Math.random() * 0.4;
        this.events.emit("static", { volume: 0.25 + 0.35 * (1 - this.tuning) });
      }
      if (this.gatesDone.has("take")) this._drawDial(this.tuning, false);
    }
    this.city.update(dt, time);
    this.cbd.update(dt, time);
    this._place();
    const floor = this.fromFloor + Math.floor((this.cabinY - START_Y) / STOREY);
    this.cabin.display.userData.draw(this.fired.has("chime") ? "SB" : String(floor));

    // The light: steady, a stutter in the tremor.
    const stutter = t > AT.tremor && t < AT.tremor + 1.1 ? (Math.sin(time * 41) + Math.sin(time * 23) > 0.2 ? 1 : 0.15) : 1;
    this.cabin.setLights(this.light * stutter, stutter, stutter > 0.5 ? 1 : 0.1, 0, time);
    this.doors += (this.doorsTarget - this.doors) * Math.min(1, dt * 1.6);
    if (Math.abs(this.doorsTarget - this.doors) < 0.002) this.doors = this.doorsTarget;
    this.cabin.setDoors(this.doors);
    // The skybridge's light spills in as the doors part.
    const open = this.fired.has("doors") ? this.doors : 0;
    this.bridgeLight.intensity = 14 * open;

    // The radio: up to the face while the pilot talks, its light on his words.
    this.radioUp += (this.radioUpTarget - this.radioUp) * Math.min(1, dt * 3.2);
    this.talking = Math.max(0, this.talking - dt);
    const live = this.talking > 0 && Math.sin(time * 26) > -0.6;
    this.radioLed.color.setHex(live ? 0xff3a2a : 0x401010);
    // (The screen's own picture is the dial: brighter on his words.)
    this.radioScreen.color.setHex(live ? 0xffffff : 0xb8d8c2);

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
    this.breath += ((t > AT.away ? 0.35 : 1) - this.breath) * Math.min(1, dt * 0.4);

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
    } else if (beat === "static") {
      // Static - from the doctor's bag, beside them.
      this.staticOn = true;
      this.target = VIEWS.bag;
      this._shot("bag");
      this.hud.caption("", "[Static crackles from the doctor's bag]");
      this._captionUntil = this.t + 2.4;
    } else if (beat === "open") {
      this.bag.target = 1;
    } else if (beat === "take") {
      // His radio, out of the bag and into their hand (the static's caption
      // goes: its clock is the script's, held at the gates).
      this.hud.caption(null, null);
      this._captionUntil = 0;
      this.target = VIEWS.radio;
      this.radioUpTarget = 1;
      this.bag.glow.visible = false;
      this._shot("radio");
    } else if (beat === "tune") {
      // On the channel: the static clears, and a voice.
      this.staticOn = false;
      this.tuning = 1;
      this._drawDial(1, true);
      this.events.emit("tuned", {});
    } else if (beat === "radio1") {
      this._say("radio1");
      this.events.emit("radio", { line: 1 });
    } else if (beat === "radio2") {
      this._say("radio2");
      this.events.emit("radio", { line: 2 });
    } else if (beat === "away") {
      // Back in the bag, the flap shut on it.
      this.radioUpTarget = 0;
      this.target = VIEWS.bag;
      this._closeBag = 0.5;
    } else if (beat === "launcher") {
      // Up, and the launcher where it leans on the glass.
      this.target = VIEWS.launcher;
      this._shot("launcher");
    } else if (beat === "grab") {
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
    this.city.dispose();
    this.cbd.dispose();
    this.launcher.dispose();
    this.events.clear();
    this.hud.dispose();
    this.owned.dispose();
    this.scene.clear();
  }
}
