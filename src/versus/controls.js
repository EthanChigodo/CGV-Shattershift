/**
 * Versus controls: every way two people can hold the game, read raw.
 *
 * Single player turns pad 1 into keyboard and pointer events; Versus cannot
 * (two players, possibly on one keyboard), so it reads everything itself and
 * hands each player one `intent` per frame. The devices:
 *
 *   pad:<n>     a game controller (src/systems/gamepad.js): left stick moves,
 *               right stick aims (twin-stick), R2 fires, L1/R1 change sphere,
 *               cross jumps/dodges/climbs, options pauses
 *   keys-left   W A S D move, F fires (or the left mouse button), G or Space
 *               dodges and climbs, R / Q / E or the wheel change sphere - and
 *               the mouse aims, inside that player's half of the screen
 *   keys-right  arrows (or I J K L) move, Right Ctrl or / fires, Right Shift
 *               or . dodges and climbs, Enter or , change sphere
 *
 * The keyboard and mouse are listened to only while Versus is up (attach /
 * detach); the host's own handlers stand aside for the same span.
 *
 *   const input = new VersusInput();
 *   input.attach();
 *   input.poll(dt);                       // once a frame
 *   const intent = input.read("pad:0");   // { move, aimStick, pointer, fire, ... }
 */

import { Gamepads, label as padLabel } from "../systems/gamepad.js";

/** Keys a keyboard player owns: their default action is suppressed in Versus. */
const LEFT = {
  up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"],
  fire: ["KeyF"], dodge: ["KeyG", "Space"], next: ["KeyR", "KeyE"], prev: ["KeyQ"],
};
const RIGHT = {
  up: ["ArrowUp", "KeyI"], down: ["ArrowDown", "KeyK"], left: ["ArrowLeft", "KeyJ"], right: ["ArrowRight", "KeyL"],
  fire: ["ControlRight", "Slash", "Numpad0"], dodge: ["ShiftRight", "Period", "NumpadEnter"], next: ["Enter"], prev: ["Comma"],
};
const OWNED = new Set([...Object.values(LEFT).flat(), ...Object.values(RIGHT).flat(), "Escape", "Tab", "KeyT", "Backspace"]);

/** How each device is named in the lobby and on the HUD. */
const PAD_NAMES = { ps: "PlayStation pad", xbox: "Xbox pad", generic: "Controller" };

/** The legend for a device: [glyph, action] pairs, shown in the lobby. */
export function legendFor(device, kind = "xbox") {
  if (device === "keys-left") {
    return [["WASD", "Move"], ["Mouse", "Aim"], ["F / LMB", "Fire"], ["G / Space", "Dodge, jump, climb"], ["R / Wheel", "Sphere"]];
  }
  if (device === "keys-right") {
    return [["Arrows", "Move"], ["Auto", "Aim (assisted)"], ["R-Ctrl / /", "Fire"], ["R-Shift / .", "Dodge, jump, climb"], ["Enter", "Sphere"]];
  }
  const L = (b) => padLabel(b, kind);
  return [["L-stick", "Move"], ["R-stick", "Aim"], [L("r2"), "Fire"], [L("cross"), "Dodge, jump, climb"], [`${L("l1")} ${L("r1")}`, "Sphere"]];
}

/** A blank intent (nobody touching anything). */
export function idleIntent() {
  return {
    move: { x: 0, y: 0 }, aimStick: null, pointer: null,
    fire: false, dodge: false, climbHeld: false, cycle: 0, pause: false,
    confirm: false, back: false, left: false, right: false, rounds: false, split: false,
  };
}

export class VersusInput {
  constructor() {
    this.pads = new Gamepads();
    this.held = new Set();
    /** Keys that went down since the last poll, and this frame's copy. */
    this._down = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, held: false, used: false, wheel: 0, clicked: false, _clicked: false, _wheel: 0 };
    this.attached = false;
    this._handlers = {
      keydown: (event) => {
        if (OWNED.has(event.code)) event.preventDefault();
        this.held.add(event.code);
        if (!event.repeat) this._down.add(event.code);
      },
      keyup: (event) => this.held.delete(event.code),
      blur: () => {
        this.held.clear();
        this.mouse.held = false;
      },
      pointermove: (event) => {
        if (event.movementX || event.movementY || event.clientX !== this.mouse.x || event.clientY !== this.mouse.y) this.mouse.used = true;
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
      },
      pointerdown: (event) => {
        if (event.button !== 0) return;
        // A click on the lobby's or the pause card's buttons is a click, not a shot.
        if (event.target?.closest?.("button, input, select, label, a")) return;
        this.mouse.held = true;
        this.mouse._clicked = true;
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
      },
      pointerup: (event) => {
        if (event.button === 0) this.mouse.held = false;
      },
      wheel: (event) => {
        this.mouse._wheel += Math.sign(event.deltaY);
      },
      contextmenu: (event) => event.preventDefault(),
    };
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    for (const [name, fn] of Object.entries(this._handlers)) addEventListener(name, fn, name === "wheel" ? { passive: true } : undefined);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    for (const [name, fn] of Object.entries(this._handlers)) removeEventListener(name, fn);
    this.held.clear();
    this._down.clear();
    this.pressed.clear();
    this.mouse.held = false;
  }

  /** Read every pad and latch this frame's key presses. Once a frame. */
  poll(dt = 0) {
    this.pads.poll(dt);
    // A stick pushed sideways counts once, like a d-pad press, until it comes back.
    for (const p of this.pads.list()) {
      const side = p.move.x < -0.6 ? -1 : p.move.x > 0.6 ? 1 : 0;
      p.stickPress = side && side !== p.stickLatch ? side : 0;
      if (Math.abs(p.move.x) < 0.3) p.stickLatch = 0;
      else if (side) p.stickLatch = side;
    }
    this.pressed = this._down;
    this._down = new Set();
    this.mouse.clicked = this.mouse._clicked;
    this.mouse._clicked = false;
    this.mouse.wheel = this.mouse._wheel;
    this.mouse._wheel = 0;
  }

  /** The connected pads (gamepad.js state objects), in the order they joined. */
  padList() {
    return this.pads.list();
  }

  pad(device) {
    if (!device?.startsWith("pad:")) return null;
    const index = Number(device.slice(4));
    const p = this.pads.byIndex.get(index);
    return p?.connected ? p : null;
  }

  /** A device's name for the lobby and the HUD. */
  describe(device) {
    if (device === "keys-left") return { name: "Keyboard + mouse", short: "KB + MOUSE", kind: "keys" };
    if (device === "keys-right") return { name: "Keyboard (arrows)", short: "KB ARROWS", kind: "keys" };
    const p = this.pad(device);
    const kind = p?.kind ?? "generic";
    return { name: PAD_NAMES[kind], short: kind === "ps" ? "PS PAD" : kind === "xbox" ? "XBOX PAD" : "PAD", kind };
  }

  /**
   * Devices that asked to join this frame: any pad's cross (or options),
   * F (or a click) for the left of the keyboard, / or Right Ctrl for the right.
   */
  joinRequests() {
    const out = [];
    for (const p of this.pads.list()) if (p.pressed.cross || p.pressed.options) out.push(`pad:${p.index}`);
    if (this.any(LEFT.fire)) out.push("keys-left");
    if (this.any(RIGHT.fire)) out.push("keys-right");
    return out;
  }

  any(codes, set = this.pressed) {
    return codes.some((c) => set.has(c));
  }

  axis(neg, pos) {
    return (this.any(pos, this.held) ? 1 : 0) - (this.any(neg, this.held) ? 1 : 0);
  }

  /** This frame's intent for one device. */
  read(device) {
    const out = idleIntent();
    if (device === "keys-left" || device === "keys-right") {
      const k = device === "keys-left" ? LEFT : RIGHT;
      out.move.x = this.axis(k.left, k.right);
      out.move.y = this.axis(k.down, k.up);
      const m = Math.hypot(out.move.x, out.move.y);
      if (m > 1) { out.move.x /= m; out.move.y /= m; }
      out.fire = this.any(k.fire, this.held);
      out.dodge = this.any(k.dodge);
      out.climbHeld = this.any(k.dodge, this.held);
      out.cycle = (this.any(k.next) ? 1 : 0) - (this.any(k.prev) ? 1 : 0);
      out.confirm = this.any(k.fire);
      out.left = this.any(k.left);
      out.right = this.any(k.right);
      if (device === "keys-left") {
        out.fire ||= this.mouse.held;
        out.cycle += this.mouse.wheel;
        if (this.mouse.used) out.pointer = { x: this.mouse.x, y: this.mouse.y };
        out.rounds = this.pressed.has("KeyR");
        out.split = this.pressed.has("KeyT");
      }
      out.cycle = Math.sign(out.cycle);
      return out;
    }
    const p = this.pad(device);
    if (!p) return out;
    out.move.x = p.move.x;
    out.move.y = p.move.y;
    if (Math.hypot(p.aim.x, p.aim.y) > 0.3) out.aimStick = { x: p.aim.x, y: p.aim.y };
    out.fire = p.held.r2 || p.value.r2 > 0.35;
    out.dodge = p.pressed.cross;
    out.climbHeld = p.held.cross;
    out.cycle = (p.pressed.r1 ? 1 : 0) - (p.pressed.l1 ? 1 : 0);
    out.pause = p.pressed.options;
    out.confirm = p.pressed.cross;
    out.back = p.pressed.circle;
    out.left = p.pressed.left || p.stickPress < 0;
    out.right = p.pressed.right || p.stickPress > 0;
    out.rounds = p.pressed.triangle;
    out.split = p.pressed.square;
    return out;
  }

  /** Esc, or a joined pad's options button: pause / back. */
  get escape() {
    return this.pressed.has("Escape");
  }

  rumble(device, strong, weak, seconds) {
    const p = this.pad(device);
    if (!p) return;
    const slot = this.pads.list().indexOf(p);
    if (slot >= 0) this.pads.rumble(slot, strong, weak, seconds);
  }
}

export { padLabel };
