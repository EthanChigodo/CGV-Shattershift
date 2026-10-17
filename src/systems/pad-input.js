/**
 * Controller play: a PlayStation (DualShock 4, DualSense) or Xbox pad plays
 * the whole game - every level, every cutscene prompt and every menu -
 * without the keyboard or the mouse.
 *
 * It is not a second control scheme inside the levels. Once a frame it
 * reads the pads (gamepad.js) and turns them into the input the game
 * already understands:
 *   - buttons become keyboard events with the same `code`s, dispatched on
 *     window - so the story's capture-phase listeners (reaction prompts,
 *     hold Esc to skip) see them first, exactly as they see real keys;
 *   - the right stick moves a virtual mouse: pointer events on the game
 *     canvas, with acceleration and a mild pull toward targets; R2 and L2
 *     are its left and right buttons (throw / fire, Focus);
 *   - on the roof the left stick goes to the Labs module as an analog
 *     vector (smooth movement any way, not four keys), and the right stick
 *     aims twin-stick style: the way it points, from the hero;
 *   - over a menu (any .screen.active, the serum card, photo mode, the VIEW
 *     menu) it is spatial navigation: the d-pad or left stick moves a focus
 *     ring between the visible controls, ✕/A presses, ○/B goes back (Esc),
 *     L1/R1 switch tabs, left/right adjust sliders and selects, the right
 *     stick scrolls.
 *
 * The map (PlayStation / Xbox) - PAD_MAP below is what Settings lists:
 *   left stick, d-pad   lanes; up/down sprint and brake (Skyline), jump and
 *                       slide (Foundry, Labs); walk on the roof; menus
 *   right stick         aim
 *   R2 / RT             throw, fire (held: the launcher keeps firing)
 *   L2 / LT             Focus (slow time)
 *   L1 R1 / LB RB       sphere type; menu tabs
 *   ✕ / A               jump, dodge; confirm
 *   ○ / B               slide; back
 *   △ / Y               camera
 *   □ / X               quick-time prompts
 *   Options / Menu      pause (held in a cutscene: skip it)
 *   Create / View       the HUD's VIEW menu
 *   L3 / R3             hide the HUD / photo mode
 * A quick-time prompt asks for keys (src/story/reaction.js); each of them
 * has a face button or bumper (key-glyphs.js KEY_BUTTON), the prompt draws
 * that button while a pad is in use, and while it runs those buttons answer
 * it instead of doing their usual job.
 *
 *   const pad = new PadInput({ gamepads: new Gamepads(), canvas, game });
 *   pad.update(dt);                     // once a frame (it polls the pads itself)
 *   pad.rumble("glass");                // "glass" | "hit" | "blast" | "death"
 *   pad.feel(sounds, { hurt: "hit" });  // rumble whenever that sound plays
 *   pad.enabled = false;                // leave the pads to someone else
 *
 * `game` is the host's read-only view of itself (main.js builds it): its
 * state, what can be aimed at, the roof, photo mode, the running prompt.
 * The pad that was used last drives; the others wait their turn.
 */

import * as THREE from "../three.js";
import { BUTTONS } from "./gamepad.js";
import { KEY_BUTTON, padKind, padLabel, setPadKind, onGlyphChange } from "./key-glyphs.js";
import { REACTION_KEYS } from "../story/reaction.js";

/** A stick past PRESS counts as a direction; it lets go below RELEASE. */
const STICK_PRESS = 0.55;
const STICK_RELEASE = 0.3;
/** A held direction repeats: [first after, then every] seconds. */
const MENU_REPEAT = [0.38, 0.11];
const LANE_REPEAT = [0.3, 0.18];
/** A stick past this, or any button, means the pad is in use (a little drift does not). */
const ACTIVE = 0.5;
/** A mouse move shorter than this (px) is not the player taking the mouse back. */
const MOUSE_SLOP = 4;

/** The virtual mouse at full tilt: screen heights a second; the curve keeps small tilts fine. */
const AIM_SPEED = 1.2;
const AIM_CURVE = 1.8;
/** Held at full tilt past AIM_BOOST_AFTER seconds, it speeds up to AIM_BOOST x over AIM_BOOST_RAMP s. */
const AIM_BOOST = 1.9;
const AIM_BOOST_AFTER = 0.2;
const AIM_BOOST_RAMP = 0.45;
/** Aim assist: catch radius (px on a 720-high screen), slowdown over a target, pull (per second). */
const ASSIST_RADIUS = 80;
const ASSIST_FRICTION = 0.45;
const ASSIST_PULL = 3.5;

/** The roof: the aim point's distance from the hero (m) and its height (game.js aims at the chest). */
const ROOF_REACH = 7;
const ROOF_CHEST = 1.15;
/** Aim assist on the roof: an enemy within this cone (deg) of the stick, and range (m), is aimed at. */
const ROOF_SNAP = Math.cos(THREE.MathUtils.degToRad(16));
const ROOF_SNAP_RANGE = 24;
/** This long without the right stick, the roof aims the way you walk. */
const ROOF_FACE_WALK = 0.8;

/** Photo mode: orbit and tilt (rad/s), zoom (e-folds per second). */
const PHOTO_ORBIT = 2.2;
const PHOTO_TILT = 1.5;
const PHOTO_ZOOM = 1.4;
/** Menus: right stick scroll (px/s); a d-pad step through a long page (of its visible height). */
const SCROLL_SPEED = 1200;
const SCROLL_STEP = 0.55;

/** Rumble per event: [strong motor, weak motor, seconds]. */
const RUMBLE = {
  glass: [0.1, 0.45, 0.08],
  hit: [0.7, 0.5, 0.22],
  blast: [0.9, 0.6, 0.35],
  death: [1, 0.9, 0.65],
};
/** Glass no more often than this (s): a pane bursting into twenty is one buzz. */
const RUMBLE_GAP = 0.06;

/** Settings > Controller, kept in this browser. */
const SETTINGS_KEY = "fractureRun.controller";
const DEFAULTS = { sensitivity: 100, invertY: false, vibration: true };

/** The pad's "mouse" has its own pointer id. */
const POINTER_ID = 47;
/** What a menu can move between. */
const FOCUSABLE = "button, input:not([type=hidden]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

/** Buttons in play and what each sends (the d-pad is read as directions). */
const PLAY = {
  cross: { key: "Space" }, circle: { key: "ShiftLeft" }, triangle: { key: "KeyC" },
  l1: { key: "KeyQ" }, r1: { key: "KeyE" },
  options: { key: "Escape" }, share: { key: "KeyV" }, l3: { key: "KeyH" }, r3: { key: "KeyP" },
  r2: { mouse: 0 }, l2: { mouse: 2 },
};
/** The buttons a quick-time prompt can ask for, and each one's own reaction key. */
const REACTION_KEY_FOR = Object.fromEntries(REACTION_KEYS.map((code) => [KEY_BUTTON[code], code]));

/** The controls, as Settings lists them: [buttons (gamepad.js names, or a stick), what they do]. */
export const PAD_MAP = [
  [["lstick", "dpad"], "Change lane; up / down: sprint and brake (Skyline), jump and slide (Foundry, Labs); walk on the roof"],
  [["rstick"], "Aim (on the roof: the way you fire)"],
  [["r2"], "Throw / fire - hold it for the launcher"],
  [["l2"], "Focus (slow time)"],
  [["l1", "r1"], "Sphere type; tabs in menus"],
  [["cross"], "Jump, dodge; confirm"],
  [["circle"], "Slide; back"],
  [["triangle"], "Change camera"],
  [["square"], "Quick-time prompts (with the other face buttons and bumpers, as shown)"],
  [["options"], "Pause; hold it to skip a cutscene"],
  [["share"], "Choose what the HUD shows"],
  [["l3"], "Hide the HUD"],
  [["r3"], "Photo mode (Foundry, Skyline): the right stick orbits, the triggers zoom"],
];

/** A pad's name from the id the browser reports ("DualSense", "Xbox controller"). */
export function padName(id = "") {
  const s = id.toLowerCase();
  if (/dualsense|0ce6|0df2/.test(s)) return "DualSense";
  if (/xbox|045e|xinput|microsoft/.test(s)) return "Xbox controller";
  if (/dualshock|05c4|09cc/.test(s)) return "DualShock 4";
  if (/054c|sony|playstation|wireless controller/.test(s)) return "PlayStation controller";
  return id.replace(/\s*\(.*$/, "").trim() || "Controller";
}

const clamp = THREE.MathUtils.clamp;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

/** `key` for the synthetic events (the game reads `code`). */
function keyOf(code) {
  if (code === "Space") return " ";
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Shift")) return "Shift";
  return code;
}

/** One axis read as two buttons: -1, 0 or 1, with hysteresis, repeating while held. */
class DigitalAxis {
  constructor() {
    this.value = 0;
    this.held = 0;
    this.next = 0;
  }

  /**
   * @param {number} analog  -1..1
   * @param {number} dt
   * @param {number[]|null} repeat  [delay, every], or null for no repeats
   * @param {number} [other]  the other axis: a push only counts where it is the stronger
   * @returns {number} -1 or 1 on a push (or a repeat), else 0
   */
  update(analog, dt, repeat, other = 0) {
    let v = 0;
    if (this.value) v = analog * this.value > STICK_RELEASE ? this.value : 0;
    else if (Math.abs(analog) > STICK_PRESS && Math.abs(analog) >= other) v = Math.sign(analog);
    if (v !== this.value) {
      this.value = v;
      this.held = 0;
      this.next = repeat ? repeat[0] : Infinity;
      return v;
    }
    if (!v) return 0;
    this.held += dt;
    if (this.held < this.next) return 0;
    this.next += repeat[1];
    return v;
  }
}

function loadSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export class PadInput {
  /**
   * @param {object} o
   * @param {import("./gamepad.js").Gamepads} o.gamepads
   * @param {HTMLCanvasElement} o.canvas  the game canvas (pointer events go to it)
   * @param {object} o.game  the host's view of itself (see the header)
   */
  constructor({ gamepads, canvas, game }) {
    this.gamepads = gamepads;
    this.canvas = canvas;
    this.game = game;
    /** false: the pads are left alone (a mode that reads them itself). */
    this.enabled = true;
    /** What the player used last: "pad" or "kbm". */
    this.device = "kbm";
    this.settings = loadSettings();
    /** The virtual mouse, where the crosshair is (-1..1 both ways, y up). */
    this.aim = new THREE.Vector2(0, 0.08);
    this._tilt = 0;
    this._aiming = false;
    /** The browser index of the pad driving. */
    this._driver = null;
    this._justUsed = false;
    /** Browser index -> id, for the connect and disconnect toasts. */
    this._known = new Map();
    /** Pad button -> what its press sent ({ key } | { mouse }), to send the release to the same place. */
    this._buttons = new Map();
    /** Keys held for the directions (up/down sprint, the d-pad on the roof). */
    this._dirKeys = new Set();
    this._mouseButtons = 0;
    this._laneX = new DigitalAxis();
    this._laneY = new DigitalAxis();
    this._menuX = new DigitalAxis();
    this._menuY = new DigitalAxis();
    this._roofGame = null;
    this._roofDir = new THREE.Vector3(0, 0, -1);
    this._roofIdle = Infinity;
    /** Menus: the layer the ring is in, the control it is on, and where it was on each layer. */
    this._layer = null;
    this._focus = null;
    this._ringEl = null;
    this._memory = new WeakMap();
    this._mouseAt = null;
    this._lastRumble = 0;

    // The keyboard or the mouse taken up again: their prompts come back.
    const kbm = (event) => this._keyboardMouse(event);
    for (const type of ["keydown", "pointerdown", "pointermove", "wheel"]) addEventListener(type, kbm, { capture: true, passive: true });
    this._bindSettings();
  }

  /** Once a frame: read the pads and play what they say. */
  update(dt) {
    if (!this.enabled) return;
    this.gamepads.poll(dt);
    this._connections();
    const pad = this._pick();
    if (!pad) {
      this._releaseAll();
      return;
    }
    if (this._active(pad)) this._use(pad);
    if (this.device === "pad") {
      const layer = this._menuLayer();
      if (layer) {
        this._releaseAll();
        this._menu(layer, pad, dt);
      } else {
        this._leaveMenu();
        this._play(pad, dt);
      }
    }
    this._justUsed = false;
  }

  /** A felt event, on the pad in use (if it can, and Settings allow). */
  rumble(kind, strength = 1) {
    if (this.device !== "pad" || !this.settings.vibration) return;
    const now = performance.now() / 1000;
    if (kind === "glass" && now - this._lastRumble < RUMBLE_GAP) return;
    this._lastRumble = now;
    const [strong, weak, seconds] = RUMBLE[kind] ?? RUMBLE.hit;
    const k = clamp(strength, 0.3, 1.2);
    const slot = this.gamepads.list().findIndex((p) => p.index === this._driver);
    this.gamepads.rumble(Math.max(0, slot), Math.min(1, strong * k), Math.min(1, weak * k), seconds);
  }

  /**
   * Rumble whenever one of these sounds plays: { method: rumble kind }. The
   * sound's first argument, when it is a number, is its strength.
   */
  feel(sounds, map) {
    for (const [method, kind] of Object.entries(map)) {
      const play = sounds[method];
      if (typeof play !== "function") continue;
      sounds[method] = (...args) => {
        this.rumble(kind, typeof args[0] === "number" ? args[0] : 1);
        return play.apply(sounds, args);
      };
    }
  }

  /* ---- Which pad, which device ---------------------------------------- */

  /** The pad someone is using; else the one that was; else the first. */
  _pick() {
    const pads = this.gamepads.list();
    if (!pads.length) return null;
    const busy = pads.find((p) => this._active(p));
    if (busy) this._driver = busy.index;
    return pads.find((p) => p.index === this._driver) ?? pads[0];
  }

  _active(p) {
    if (BUTTONS.some((b) => p.pressed[b])) return true;
    return Math.hypot(p.move.x, p.move.y) > ACTIVE || Math.hypot(p.aim.x, p.aim.y) > ACTIVE || p.value.l2 > ACTIVE || p.value.r2 > ACTIVE;
  }

  _use(pad) {
    // Browsers that count a pad press as a user gesture let the sound start on one.
    if (BUTTONS.some((b) => pad.pressed[b])) this.game.unlockAudio?.();
    if (this.device === "pad" && padKind() === pad.kind) return;
    this._justUsed = this.device !== "pad";
    this.device = "pad";
    setPadKind(pad.kind);
  }

  _keyboardMouse(event) {
    if (!event.isTrusted) return; // the pad's own events
    if (event.type === "pointermove") {
      const at = { x: event.clientX, y: event.clientY };
      const was = this._mouseAt;
      if (this.device === "pad" && was && Math.hypot(at.x - was.x, at.y - was.y) < MOUSE_SLOP) return;
      this._mouseAt = at;
      // The virtual mouse carries on from where the real one is.
      const s = this.game.aimScale ?? 1;
      this.aim.set(clamp(((at.x / innerWidth) * 2 - 1) * s, -1, 1), clamp((1 - (at.y / innerHeight) * 2) * s, -1, 1));
    }
    if (this.device !== "pad") return;
    this.device = "kbm";
    this._releaseAll();
    this._leaveMenu();
    setPadKind(null);
  }

  _connections() {
    const now = new Map(this.gamepads.list().map((p) => [p.index, p]));
    let changed = false;
    for (const [index, p] of now) {
      if (this._known.get(index) === p.id) continue;
      this._known.set(index, p.id);
      changed = true;
      this.game.toast?.(`CONTROLLER CONNECTED - ${padName(p.id)}`);
    }
    for (const index of [...this._known.keys()]) {
      if (now.has(index)) continue;
      this._known.delete(index);
      changed = true;
      this.game.toast?.("CONTROLLER DISCONNECTED");
      // The pad in your hands went: the game waits for you.
      if (index === this._driver && this.device === "pad") {
        this._releaseAll();
        if (["playing", "lift", "cutscene"].includes(this.game.state) && !this.game.paused && !this._menuLayer()) this._tapKey("Escape");
      }
    }
    if (changed) this._showStatus();
  }

  /* ---- In play ---------------------------------------------------------- */

  _play(pad, dt) {
    const roof = this.game.roof;
    const prompt = this.game.reactionKeys;
    for (const name of BUTTONS) {
      if (pad.pressed[name]) this._press(name, prompt);
      else if (pad.released[name]) this._release(name);
    }

    const h = pad.held;
    const want = new Set();
    if (roof) {
      // The roof: the stick to the module as it is (any direction, any
      // speed); the d-pad as the four keys.
      this._roofGame = roof;
      if (roof.padMove) {
        roof.padMove.x = pad.move.x;
        roof.padMove.y = pad.move.y;
      }
      if (h.up) want.add("KeyW");
      if (h.down) want.add("KeyS");
      if (h.left) want.add("KeyA");
      if (h.right) want.add("KeyD");
    } else {
      this._clearRoofMove();
      const x = (h.right ? 1 : 0) - (h.left ? 1 : 0) || pad.move.x;
      const y = (h.up ? 1 : 0) - (h.down ? 1 : 0) || pad.move.y;
      // Left and right: one lane a push, repeating while held. (A and D,
      // not the arrows: the story's sprint prompt alternates A and D.)
      const step = this._laneX.update(x, dt, LANE_REPEAT, Math.abs(y) * 0.8);
      if (step) this._tapKey(step < 0 ? "KeyA" : "KeyD");
      // Up and down are held, as W and S: sprint and brake, or jump and slide on the push.
      this._laneY.update(y, dt, null, Math.abs(x));
      if (this._laneY.value > 0) want.add("KeyW");
      else if (this._laneY.value < 0) want.add("KeyS");
    }
    this._holdKeys(want);
    this._aimStick(pad, dt, roof);
  }

  /** A button went down in play: its key or mouse button (a prompt's key while one runs). */
  _press(name, prompt) {
    let action = PLAY[name];
    if (prompt?.length && REACTION_KEY_FOR[name]) {
      // The key the prompt asks for on this button; else the button's own
      // reaction key - a wrong key, as a stray letter is on the keyboard.
      action = { key: prompt.find((code) => KEY_BUTTON[code] === name) ?? REACTION_KEY_FOR[name] };
    }
    if (!action) return;
    this._buttons.set(name, action);
    if (action.key) this._key("keydown", action.key);
    else {
      if (document.body.classList.contains("aiming")) this._pointer("pointermove");
      this._pointer("pointerdown", action.mouse);
    }
  }

  _release(name) {
    const action = this._buttons.get(name);
    if (!action) return;
    this._buttons.delete(name);
    if (action.key) this._key("keyup", action.key);
    else this._pointer("pointerup", action.mouse);
  }

  /** Let go of everything the pad holds down (a menu opened, the mouse came back, the pad went). */
  _releaseAll() {
    for (const name of [...this._buttons.keys()]) this._release(name);
    this._holdKeys(new Set());
    this._clearRoofMove();
    this._aiming = false;
  }

  _holdKeys(want) {
    for (const code of this._dirKeys) if (!want.has(code)) this._key("keyup", code);
    for (const code of want) if (!this._dirKeys.has(code)) this._key("keydown", code);
    this._dirKeys = want;
  }

  _clearRoofMove() {
    if (this._roofGame?.padMove) this._roofGame.padMove.x = this._roofGame.padMove.y = 0;
    this._roofGame = null;
  }

  /** The right stick: the virtual mouse (or the roof's twin-stick aim), while the game is aiming. */
  _aimStick(pad, dt, roof) {
    if (!document.body.classList.contains("aiming")) {
      this._aiming = false;
      return;
    }
    // Just started aiming: tell the game where the pad's crosshair is.
    let moved = !this._aiming;
    this._aiming = true;
    if (roof) moved = this._roofAim(roof, pad, dt) || moved;
    else moved = this._cursor(pad, dt) || moved;
    if (moved) this._pointer("pointermove");
  }

  _cursor(pad, dt) {
    const x = pad.aim.x;
    const y = this.settings.invertY ? -pad.aim.y : pad.aim.y;
    const tilt = Math.min(1, Math.hypot(x, y));
    const assist = this._assist(dt, tilt > 0);
    if (!tilt) {
      this._tilt = 0;
      return assist.pulled;
    }
    // Full tilt held: faster, to cross the screen; a small tilt stays fine.
    this._tilt = tilt > 0.92 ? this._tilt + dt : 0;
    const boost = 1 + (AIM_BOOST - 1) * clamp((this._tilt - AIM_BOOST_AFTER) / AIM_BOOST_RAMP, 0, 1);
    const speed = AIM_SPEED * innerHeight * tilt ** AIM_CURVE * boost * (this.settings.sensitivity / 100) * assist.speed;
    this.aim.x = clamp(this.aim.x + (x / tilt) * speed * dt / (innerWidth / 2), -1, 1);
    this.aim.y = clamp(this.aim.y + (y / tilt) * speed * dt / (innerHeight / 2), -1, 1);
    return true;
  }

  /**
   * A mild aim assist (Settings > Aim assist): over or near a target the
   * crosshair slows, and while the stick moves it drifts onto the target.
   * Throws still go through the game's own aim assist when fired.
   */
  _assist(dt, moving) {
    const none = { speed: 1, pulled: false };
    const view = this.game.aimAssist ? this.game.aimTargets : null;
    if (!view?.targets?.length) return none;
    const halfW = innerWidth / 2;
    const halfH = innerHeight / 2;
    const radius = (ASSIST_RADIUS * innerHeight) / 720;
    let best = radius;
    let bx = 0;
    let by = 0;
    for (const mesh of view.targets) {
      if (!mesh.visible || mesh.userData?.alive === false) continue;
      mesh.getWorldPosition(_v).project(view.camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue;
      const d = Math.hypot((_v.x - this.aim.x) * halfW, (_v.y - this.aim.y) * halfH);
      if (d < best) {
        best = d;
        bx = _v.x;
        by = _v.y;
      }
    }
    if (best >= radius) return none;
    const near = 1 - best / radius;
    if (moving) {
      const k = Math.min(1, dt * ASSIST_PULL * near);
      this.aim.x += (bx - this.aim.x) * k;
      this.aim.y += (by - this.aim.y) * k;
    }
    return { speed: 1 - ASSIST_FRICTION * near, pulled: moving };
  }

  /**
   * The roof, twin-stick: aim the way the right stick points, from the
   * hero (or the way you walk, once it has been let go a while); with aim
   * assist, at the enemy nearest that line. The crosshair goes where that
   * point is on screen, and the game aims at it as it would at the mouse.
   */
  _roofAim(roof, pad, dt) {
    const hero = roof.hero?.position;
    const camera = roof.camera;
    if (!hero || !camera) return false;
    const a = pad.aim;
    const m = pad.move;
    if (Math.hypot(a.x, a.y) > STICK_RELEASE) {
      this._roofDir.set(a.x, 0, -a.y).normalize();
      this._roofIdle = 0;
    } else {
      this._roofIdle += dt;
      if (this._roofIdle > ROOF_FACE_WALK && Math.hypot(m.x, m.y) > STICK_RELEASE) this._roofDir.set(m.x, 0, -m.y).normalize();
    }
    _v.copy(hero).addScaledVector(this._roofDir, ROOF_REACH);
    _v.y = hero.y + ROOF_CHEST;
    if (this.game.aimAssist && this._roofIdle === 0) {
      let best = null;
      let bestDot = ROOF_SNAP;
      for (const mesh of roof.roof?.breakables ?? []) {
        mesh.getWorldPosition(_d).sub(hero).setY(0);
        const distance = _d.length();
        if (distance < 0.5 || distance > ROOF_SNAP_RANGE) continue;
        const dot = _d.divideScalar(distance).dot(this._roofDir);
        if (dot > bestDot) {
          bestDot = dot;
          best = mesh;
        }
      }
      if (best) best.getWorldPosition(_v);
    }
    _v.project(camera);
    this.aim.set(clamp(_v.x, -0.98, 0.98), clamp(_v.y, -0.98, 0.98));
    return true;
  }

  /** Photo mode: the right stick orbits, the triggers zoom (R2 in, L2 out). */
  _orbit(photo, pad, dt) {
    const y = this.settings.invertY ? -pad.aim.y : pad.aim.y;
    photo.yaw -= pad.aim.x * PHOTO_ORBIT * dt;
    photo.pitch = clamp(photo.pitch - y * PHOTO_TILT * dt, -1.2, 1.35);
    const zoom = pad.value.r2 - pad.value.l2;
    if (Math.abs(zoom) > 0.05) photo.radius = clamp(photo.radius * Math.exp(-zoom * PHOTO_ZOOM * dt), 1.6, 40);
  }

  /* ---- Events the game hears -------------------------------------------- */

  _key(type, code) {
    dispatchEvent(new KeyboardEvent(type, { code, key: keyOf(code), bubbles: true, cancelable: true }));
  }

  _tapKey(code) {
    this._key("keydown", code);
    this._key("keyup", code);
  }

  /** Where the virtual mouse is, in the page (the game scales the mouse by its sensitivity; this undoes it). */
  _client() {
    const s = this.game.aimScale || 1;
    return { x: ((this.aim.x / s + 1) / 2) * innerWidth, y: ((1 - this.aim.y / s) / 2) * innerHeight };
  }

  /** On the canvas, not window: the game's handlers look at what was clicked. */
  _pointer(type, button = -1) {
    const bit = button === 0 ? 1 : button === 2 ? 2 : 0;
    if (type === "pointerdown") this._mouseButtons |= bit;
    if (type === "pointerup") this._mouseButtons &= ~bit;
    const { x, y } = this._client();
    this.canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button, buttons: this._mouseButtons, pointerId: POINTER_ID, pointerType: "mouse", isPrimary: true,
    }));
  }

  /* ---- Menus ------------------------------------------------------------ */

  /** The menu over the game, if any: the serum card, photo mode, a screen, the VIEW menu. */
  _menuLayer() {
    const shown = (el) => !!el && el.getClientRects().length > 0;
    const card = this.game.serumCard;
    if (shown(card)) return card;
    const photo = this.game.photo && document.querySelector(".cw-photo:not([hidden])");
    if (shown(photo)) return photo;
    const screens = document.querySelectorAll(".screen.active");
    for (let i = screens.length - 1; i >= 0; i -= 1) if (shown(screens[i])) return screens[i];
    const view = document.getElementById("viewMenu");
    return view && !view.hidden && shown(view) ? view : null;
  }

  _menu(layer, pad, dt) {
    if (layer !== this._layer) {
      if (this._layer && this._focus) this._memory.set(this._layer, this._focus);
      this._layer = layer;
      this._focus = null;
    }
    if (!this._focus || !layer.contains(this._focus) || !this._usable(this._focus)) this._setFocus(this._initialFocus(layer));
    const dir = this._direction(pad, dt);
    // The first press after the mouse only shows where the ring is.
    if (this._justUsed) return;
    const p = pad.pressed;
    const el = this._focus;
    if (dir) {
      if (el && (dir === "left" || dir === "right") && this._adjustable(el)) this._adjust(el, dir === "left" ? -1 : 1);
      else this._move(layer, dir);
    }
    if (p.cross && el) this._activate(el);
    if (p.circle) this._back(layer);
    if (p.options) this._tapKey("Escape");
    if (p.share) this._tapKey("KeyV");
    if (p.r3) this._tapKey("KeyP");
    if (p.l1 || p.r1) this._tab(layer, p.r1 ? 1 : -1);
    const photo = this.game.photo;
    if (photo && layer.matches(".cw-photo")) this._orbit(photo, pad, dt);
    else if (Math.abs(pad.aim.y) > 0.1) this._scrollBy(layer, -pad.aim.y * SCROLL_SPEED * dt);
  }

  _leaveMenu() {
    if (this._layer && this._focus) this._memory.set(this._layer, this._focus);
    this._layer = null;
    this._focus = null;
    this._ring(null);
  }

  /** The d-pad or left stick as one direction at a time, repeating while held. */
  _direction(pad, dt) {
    const h = pad.held;
    let x = (h.right ? 1 : 0) - (h.left ? 1 : 0);
    let y = (h.up ? 1 : 0) - (h.down ? 1 : 0);
    if (!x && !y) {
      x = pad.move.x;
      y = pad.move.y;
    }
    if (Math.abs(x) >= Math.abs(y)) y = 0;
    else x = 0;
    const sx = this._menuX.update(x, dt, MENU_REPEAT);
    const sy = this._menuY.update(y, dt, MENU_REPEAT);
    if (sx) return sx > 0 ? "right" : "left";
    if (sy) return sy > 0 ? "up" : "down";
    return null;
  }

  /** Where the ring is drawn: a setting's whole row for the input in it. */
  _ringOf(el) {
    return el?.closest?.("label") ?? el;
  }

  _rect(el) {
    return this._ringOf(el).getBoundingClientRect();
  }

  _usable(el) {
    if (!el?.isConnected || el.disabled || el.closest("[hidden], [inert]")) return false;
    const r = this._rect(el);
    return r.width >= 1 && r.height >= 1 && getComputedStyle(el).visibility !== "hidden";
  }

  _focusables(layer) {
    return [...layer.querySelectorAll(FOCUSABLE)].filter((el) => this._usable(el));
  }

  /** Where the ring starts on a layer: where it was last time, else the main action, else the first control. */
  _initialFocus(layer) {
    const kept = this._memory.get(layer);
    if (kept && layer.contains(kept) && this._usable(kept)) return kept;
    const list = this._focusables(layer);
    return list.find((el) => el.matches(".menu-button.primary, .pu-card-button")) ?? list[0] ?? null;
  }

  _setFocus(el) {
    this._focus = el;
    this._ring(el);
    if (!el) return;
    el.focus({ preventScroll: true });
    this._ringOf(el).scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  _ring(el) {
    this._ringEl?.classList.remove("pad-focus");
    this._ringEl = el ? this._ringOf(el) : null;
    this._ringEl?.classList.add("pad-focus");
  }

  _move(layer, dir) {
    const from = this._focus;
    if (!from) return;
    const next = this._neighbour(from, this._focusables(layer), dir);
    // A long page (the manual, the credits): step through what is between
    // before jumping to a control far off screen.
    if (dir === "up" || dir === "down") {
      const box = this._scroller(layer);
      if (box) {
        const page = box === document.scrollingElement;
        const view = page ? { top: 0, bottom: innerHeight } : box.getBoundingClientRect();
        const r = next && this._rect(next);
        const far = !next || (dir === "down" ? r.top > view.bottom : r.bottom < view.top);
        const room = dir === "down" ? box.scrollTop + box.clientHeight < box.scrollHeight - 1 : box.scrollTop > 0;
        if (far && room) {
          box.scrollTop += (dir === "down" ? 1 : -1) * (page ? innerHeight : box.clientHeight) * SCROLL_STEP;
          return;
        }
      }
    }
    if (next) this._setFocus(next);
  }

  /**
   * The nearest control that way: its middle past this one's, scored by how
   * far along it is plus (three times) how far off to the side.
   */
  _neighbour(from, list, dir) {
    const a = this._rect(from);
    const ax = (a.left + a.right) / 2;
    const ay = (a.top + a.bottom) / 2;
    const vertical = dir === "up" || dir === "down";
    const sign = dir === "down" || dir === "right" ? 1 : -1;
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === from || this._ringOf(el) === this._ringOf(from)) continue;
      const b = this._rect(el);
      const along = sign * (vertical ? (b.top + b.bottom) / 2 - ay : (b.left + b.right) / 2 - ax);
      if (along <= 1) continue;
      // Not one that only reaches past us while overlapping where we are.
      if (vertical ? (sign > 0 ? b.bottom <= a.bottom : b.top >= a.top) : (sign > 0 ? b.right <= a.right : b.left >= a.left)) continue;
      const across = vertical ? Math.max(0, a.left - b.right, b.left - a.right) : Math.max(0, a.top - b.bottom, b.top - a.bottom);
      const score = along + across * 3;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  _activate(el) {
    if (el.tagName === "SELECT") this._adjust(el, 1, true);
    else if (el.type !== "range") el.click();
  }

  _adjustable(el) {
    return el.tagName === "SELECT" || el.type === "range";
  }

  /** A slider a step (a thirtieth of its range), or a select an option, then the events a hand would send. */
  _adjust(el, step, wrap = false) {
    if (el.tagName === "SELECT") {
      const n = el.options.length;
      const i = wrap ? (el.selectedIndex + step + n) % n : clamp(el.selectedIndex + step, 0, n - 1);
      if (i === el.selectedIndex) return;
      el.selectedIndex = i;
    } else {
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const unit = Number(el.step) || 1;
      const delta = Math.max(unit, Math.round((max - min) / 30 / unit) * unit);
      const value = clamp(Number(el.value) + step * delta, min, max);
      if (value === Number(el.value)) return;
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** Back: Esc, as the keyboard does it (the VIEW menu just closes). */
  _back(layer) {
    if (layer.id === "viewMenu") document.getElementById("viewButton")?.click();
    else this._tapKey("Escape");
  }

  /** L1 / R1: the layer's tabs, round and round. */
  _tab(layer, step) {
    const list = [...layer.querySelectorAll("[role=tablist]")].find((t) => t.getClientRects().length);
    const tabs = list ? [...list.querySelectorAll("[role=tab]")].filter((t) => this._usable(t)) : [];
    if (!tabs.length) return;
    const at = Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"));
    const next = tabs[(at + step + tabs.length) % tabs.length];
    next.click();
    this._setFocus(next);
  }

  _scrolls(el) {
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    const overflow = getComputedStyle(el).overflowY;
    return overflow === "auto" || overflow === "scroll";
  }

  /** What scrolls here: around the ring, else in the layer, else the page. */
  _scroller(layer) {
    for (let el = this._ringOf(this._focus) ?? layer; el && el !== document.body; el = el.parentElement) {
      if (this._scrolls(el)) return el;
      if (el === layer) break;
    }
    for (const el of layer.querySelectorAll("*")) if (this._scrolls(el)) return el;
    const page = document.scrollingElement;
    return page && page.scrollHeight > innerHeight + 1 ? page : null;
  }

  _scrollBy(layer, dy) {
    const box = this._scroller(layer);
    if (box) box.scrollTop += dy;
  }

  /* ---- Settings > Controller -------------------------------------------- */

  _bindSettings() {
    const $ = (id) => document.getElementById(id);
    const slider = $("padSensitivitySlider");
    const invert = $("padInvertToggle");
    const vibration = $("padVibrationToggle");
    const show = () => {
      if (slider) slider.value = String(this.settings.sensitivity);
      if (invert) invert.checked = this.settings.invertY;
      if (vibration) vibration.checked = this.settings.vibration;
    };
    const save = () => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      } catch {
        /* private mode: kept for this visit */
      }
    };
    slider?.addEventListener("input", () => { this.settings.sensitivity = Number(slider.value); save(); });
    invert?.addEventListener("change", () => { this.settings.invertY = invert.checked; save(); });
    vibration?.addEventListener("change", () => {
      this.settings.vibration = vibration.checked;
      save();
      if (vibration.checked) this.rumble("hit", 0.6); // so you know it works
    });
    $("resetSettingsButton")?.addEventListener("click", () => { this.settings = { ...DEFAULTS }; save(); show(); });
    show();
    this._showStatus();
    onGlyphChange(() => this._showStatus());
  }

  /** The connected pad in Settings, and its buttons in the controls list. */
  _showStatus() {
    const status = document.getElementById("padStatus");
    const pads = this.gamepads.list();
    if (status) {
      status.textContent = pads.length
        ? `Connected: ${pads.map((p) => padName(p.id)).join(", ")}. The pad you press a button on plays.`
        : "No controller connected. Plug one in or pair it, then press any button on it.";
    }
    const list = document.querySelector("[data-pad-controls]");
    if (!list) return;
    const kind = padKind() ?? pads[0]?.kind ?? null;
    const name = (button) => {
      if (kind) return padLabel(button, kind);
      const ps = padLabel(button, "ps");
      const xbox = padLabel(button, "xbox");
      return ps === xbox ? ps : `${ps} / ${xbox}`;
    };
    list.innerHTML = PAD_MAP.map(([buttons, text]) => `<span>${buttons.map((b) => `<kbd>${name(b)}</kbd>`).join("")} ${text}</span>`).join("");
  }
}
