/**
 * Controllers.
 *
 * Any controller the computer knows about - a USB pad, or a Bluetooth one
 * paired with the computer (Xbox, PlayStation, Switch Pro, the cheap ones) -
 * is read through the browser's Gamepad API. Browsers only report a
 * controller once a button on it has been pressed, so the game says so.
 *
 *   Gamepads     who is connected: each controller gets a player slot and
 *                its colour (P1 blue, P2 red, P3 green, P4 yellow), in the
 *                order they joined; reads buttons and sticks once a frame,
 *                with dead zones, and knows what went down this frame.
 *   PadBridge    plays the game with one: it turns the controller into the
 *                keys, pointer moves and clicks the game already listens
 *                for, so every level, cutscene and menu works unchanged:
 *                  play      left stick = W A S D, A jump, B slide, RT
 *                            throw / fire, LT focus, LB RB sphere, Y camera,
 *                            right stick aims (a cursor that moves), START pause
 *                  menu      D-pad / left stick move between buttons, A picks,
 *                            B back, left / right change a slider or list
 *                  reaction  the story's quick-time hits: flicks of either
 *                            stick and the triggers (the same on every pad)
 */

import { familyOf, padName } from "./input-glyphs.js";

/** Player colours, by slot (the controller's colour everywhere: chips, outfits). */
export const PAD_COLOURS = [
  { key: "blue", name: "Blue", hex: "#3aa0ff" },
  { key: "red", name: "Red", hex: "#ff4d5a" },
  { key: "green", name: "Green", hex: "#4ade80" },
  { key: "yellow", name: "Yellow", hex: "#ffd23f" },
];

/** Standard-mapping button indices. */
export const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };

const DEAD = 0.18;

function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return { x: 0, y: 0, m: 0 };
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return { x: x * k, y: y * k, m: Math.min(1, (m - DEAD) / (1 - DEAD)) };
}

export class Gamepads {
  constructor() {
    /** pad.index -> record */
    this.pads = new Map();
    /** The index of the controller used last (the one-player game follows it). */
    this.active = null;
    this._listeners = { connect: [], disconnect: [] };
    addEventListener("gamepadconnected", (e) => this._seen(e.gamepad));
    addEventListener("gamepaddisconnected", (e) => this._gone(e.gamepad.index));
  }

  on(type, fn) {
    this._listeners[type]?.push(fn);
    return this;
  }

  _emit(type, rec) {
    for (const fn of this._listeners[type] ?? []) fn(rec);
  }

  get list() {
    return [...this.pads.values()].sort((a, b) => a.slot - b.slot);
  }

  get count() {
    return this.pads.size;
  }

  _seen(gp) {
    if (!gp || this.pads.has(gp.index)) return this.pads.get(gp?.index);
    const used = new Set([...this.pads.values()].map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot += 1;
    const rec = {
      index: gp.index, id: gp.id, family: familyOf(gp.id), name: padName(gp.id), slot,
      colour: PAD_COLOURS[slot % PAD_COLOURS.length],
      buttons: [], prev: [], left: { x: 0, y: 0, m: 0 }, right: { x: 0, y: 0, m: 0 }, lt: 0, rt: 0,
      gamepad: gp, activeAt: performance.now(),
    };
    this.pads.set(gp.index, rec);
    if (this.active === null) this.active = gp.index;
    this._emit("connect", rec);
    return rec;
  }

  _gone(index) {
    const rec = this.pads.get(index);
    if (!rec) return;
    this.pads.delete(index);
    if (this.active === index) this.active = this.list[0]?.index ?? null;
    this._emit("disconnect", rec);
  }

  /** Read every controller (once a frame). Returns the records with input this frame. */
  poll() {
    const busy = [];
    const raw = navigator.getGamepads ? navigator.getGamepads() : [];
    const live = new Set();
    for (const gp of raw) {
      if (!gp || !gp.connected) continue;
      live.add(gp.index);
      const rec = this.pads.get(gp.index) ?? this._seen(gp);
      rec.gamepad = gp;
      rec.prev = rec.buttons;
      rec.buttons = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      rec.lt = gp.buttons[B.LT]?.value ?? 0;
      rec.rt = gp.buttons[B.RT]?.value ?? 0;
      rec.left = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      rec.right = stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
      const any = rec.buttons.some(Boolean) || rec.left.m > 0.25 || rec.right.m > 0.25;
      const pressedNow = rec.buttons.some((b, i) => b && !rec.prev[i]);
      if (pressedNow || (any && performance.now() - rec.activeAt > 250)) {
        rec.activeAt = performance.now();
        this.active = gp.index;
        busy.push(rec);
      } else if (any) busy.push(rec);
    }
    // (Some browsers never send the disconnect event.)
    for (const index of [...this.pads.keys()]) if (!live.has(index)) this._gone(index);
    return busy;
  }

  /** Held now. */
  down(rec, b) {
    return !!rec?.buttons[b];
  }
  /** Went down this frame. */
  pressed(rec, b) {
    return !!rec?.buttons[b] && !rec.prev[b];
  }
  /** Came up this frame. */
  released(rec, b) {
    return !rec?.buttons[b] && !!rec?.prev[b];
  }

  /** A rumble, where the pad and browser support one. */
  rumble(rec, { strong = 0.5, weak = 0.5, ms = 160 } = {}) {
    const act = rec?.gamepad?.vibrationActuator;
    if (!act?.playEffect) return;
    try {
      act.playEffect(act.type === "dual-rumble" || !act.type ? "dual-rumble" : act.type, { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    } catch {}
  }
}

/* ---- Playing the game with one ------------------------------------------- */

const KEY_OF = { Space: " ", Escape: "Escape", ShiftLeft: "Shift", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Enter: "Enter" };
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export class PadBridge {
  /**
   * @param {Gamepads} pads
   * @param {object} host
   * @param {() => "play"|"menu"|"reaction"|"off"} host.mode
   * @param {HTMLElement} host.canvas           where clicks are sent
   * @param {() => Element|null} host.menuRoot  the menu on screen
   * @param {() => boolean} [host.confirmCard]  A on a card that wants Space (true: handled)
   * @param {() => number} [host.aimSpeed]      1 = default
   * @param {() => void} [host.onActive]        a controller was used
   */
  constructor(pads, host) {
    this.pads = pads;
    this.host = host;
    this.held = new Set();
    this.mode = "off";
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.firing = { 0: false, 2: false };
    this.flick = { left: null, right: null };
    this.nav = { dir: null, wait: 0 };
    this.focused = null;
    // The mouse moves the same cursor.
    addEventListener("pointermove", (e) => {
      if (!e.isTrusted) return;
      this.cursor.x = e.clientX;
      this.cursor.y = e.clientY;
    });
  }

  /** Once a frame. */
  update(dt) {
    const busy = this.pads.poll();
    const rec = this.pads.pads.get(this.pads.active);
    if (busy.length) this.host.onActive?.(busy[0]);
    const mode = rec ? this.host.mode() : "off";
    if (mode !== this.mode) {
      this.releaseAll();
      this.mode = mode;
      if (mode !== "menu") this._blur();
    }
    if (!rec) return;
    if (mode === "menu") this._menu(rec, dt);
    else if (mode === "reaction") this._reaction(rec);
    else if (mode === "play") this._play(rec, dt);
  }

  /* ---- keys and clicks, as the game hears them ---- */

  key(type, code) {
    dispatchEvent(new KeyboardEvent(type, { code, key: KEY_OF[code] ?? (code.startsWith("Key") ? code.slice(3).toLowerCase() : code), bubbles: true, cancelable: true }));
  }

  hold(code, on) {
    if (on && !this.held.has(code)) {
      this.held.add(code);
      this.key("keydown", code);
    } else if (!on && this.held.has(code)) {
      this.held.delete(code);
      this.key("keyup", code);
    }
  }

  tap(code) {
    this.key("keydown", code);
    this.key("keyup", code);
  }

  _pointer(type, button) {
    const init = { clientX: this.cursor.x, clientY: this.cursor.y, button, buttons: type === "pointerup" ? 0 : button === 2 ? 2 : 1, bubbles: true, cancelable: true, pointerId: 41, pointerType: "mouse", isPrimary: true };
    const target = type === "pointermove" ? window : this.host.canvas;
    target.dispatchEvent(new PointerEvent(type, init));
  }

  _click(button, on) {
    if (on === this.firing[button]) return;
    this.firing[button] = on;
    this._pointer(on ? "pointerdown" : "pointerup", button);
  }

  releaseAll() {
    for (const code of [...this.held]) this.hold(code, false);
    this._click(0, false);
    this._click(2, false);
    this.flick = { left: null, right: null };
    this.nav = { dir: null, wait: 0 };
  }

  recentre() {
    this.cursor.x = innerWidth / 2;
    this.cursor.y = innerHeight / 2;
    this._pointer("pointermove", 0);
  }

  /* ---- play ---- */

  _play(rec, dt) {
    const p = this.pads;
    const L = rec.left;
    // The left stick is W A S D (a push is one lane; the roof walks with it).
    this.hold("KeyA", L.x < -0.5 || (this.held.has("KeyA") && L.x < -0.3));
    this.hold("KeyD", L.x > 0.5 || (this.held.has("KeyD") && L.x > 0.3));
    this.hold("KeyW", L.y < -0.55 || (this.held.has("KeyW") && L.y < -0.35));
    this.hold("KeyS", L.y > 0.55 || (this.held.has("KeyS") && L.y > 0.35));
    // The D-pad is the arrow keys.
    this.hold("ArrowUp", p.down(rec, B.UP));
    this.hold("ArrowDown", p.down(rec, B.DOWN));
    this.hold("ArrowLeft", p.down(rec, B.LEFT));
    this.hold("ArrowRight", p.down(rec, B.RIGHT));
    this.hold("Space", p.down(rec, B.A));
    this.hold("ShiftLeft", p.down(rec, B.B));
    this.hold("KeyC", p.down(rec, B.Y));
    // The bumpers turn the sphere wheel: R1 clockwise (E), L1 counter-clockwise (Q).
    this.hold("KeyQ", p.down(rec, B.LB));
    this.hold("KeyE", p.down(rec, B.RB));
    this.hold("Escape", p.down(rec, B.START));
    // Triggers: throw / fire (held for the launcher), and focus.
    this._click(0, rec.rt > 0.45 || (this.firing[0] && rec.rt > 0.25));
    this._click(2, rec.lt > 0.45 || (this.firing[2] && rec.lt > 0.25));
    // The right stick moves the aim, faster the further it is pushed.
    const R = rec.right;
    if (p.pressed(rec, B.RS)) this.recentre();
    // (The host may take it to turn a camera: the roof's over the shoulder.)
    if (R.m > 0 && this.host.lookStick?.((R.x / R.m) * R.m * R.m, (R.y / R.m) * R.m * R.m, dt)) return;
    if (R.m > 0) {
      const speed = Math.min(innerWidth, innerHeight) * 1.25 * (this.host.aimSpeed?.() ?? 1);
      const curve = R.m * R.m;
      this.cursor.x = Math.min(innerWidth - 1, Math.max(0, this.cursor.x + (R.x / R.m) * curve * speed * dt));
      this.cursor.y = Math.min(innerHeight - 1, Math.max(0, this.cursor.y + (R.y / R.m) * curve * speed * dt));
      this._pointer("pointermove", 0);
    }
  }

  /* ---- the story's quick-time hits ---- */

  _reaction(rec) {
    const p = this.pads;
    for (const [side, s, prefix] of [["left", rec.left, "PadL"], ["right", rec.right, "PadR"]]) {
      const was = this.flick[side];
      if (!was && s.m > 0.6) {
        const dir = Math.abs(s.x) > Math.abs(s.y) ? (s.x < 0 ? "Left" : "Right") : (s.y < 0 ? "Up" : "Down");
        this.flick[side] = `${prefix}${dir}`;
        this.hold(this.flick[side], true);
      } else if (was && s.m < 0.3) {
        this.hold(was, false);
        this.flick[side] = null;
      }
    }
    this.hold("PadLT", rec.lt > 0.45 || (this.held.has("PadLT") && rec.lt > 0.25));
    this.hold("PadRT", rec.rt > 0.45 || (this.held.has("PadRT") && rec.rt > 0.25));
    this.hold("Escape", p.down(rec, B.START));
  }

  /* ---- menus ---- */

  _menu(rec, dt) {
    const p = this.pads;
    // A new menu on screen: its main button is picked to begin with.
    const list = this.focusables();
    if (list.length && !(this.focused && list.includes(this.focused))) this._current(list);
    if (p.pressed(rec, B.A) && !this.host.confirmCard?.()) this._confirm();
    // L1 / R1: a screen's tabs (the host says which).
    if (p.pressed(rec, B.LB)) this.host.onBumper?.(-1);
    if (p.pressed(rec, B.RB)) this.host.onBumper?.(1);
    this.hold("Escape", p.down(rec, B.B) || p.down(rec, B.START));
    const L = rec.left;
    let dir = null;
    if (p.down(rec, B.UP) || L.y < -0.55) dir = "up";
    else if (p.down(rec, B.DOWN) || L.y > 0.55) dir = "down";
    else if (p.down(rec, B.LEFT) || L.x < -0.55) dir = "left";
    else if (p.down(rec, B.RIGHT) || L.x > 0.55) dir = "right";
    if (!dir) { this.nav.dir = null; return; }
    if (dir === this.nav.dir) {
      this.nav.wait -= dt;
      if (this.nav.wait > 0) return;
      this.nav.wait = 0.12;
    } else {
      this.nav.dir = dir;
      this.nav.wait = 0.38;
    }
    this.move(dir);
  }

  /** The buttons (and sliders, lists) of the menu on screen. */
  focusables() {
    const root = this.host.menuRoot();
    if (!root) return [];
    return [...root.querySelectorAll("button, input, select, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => {
      if (el.disabled || el.hidden || el.closest("[hidden]")) return false;
      if (el.type === "hidden") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none" && cs.pointerEvents !== "none";
    });
  }

  _blur() {
    this.focused?.classList.remove("pad-focus");
    this.focused = null;
  }

  focus(el) {
    if (!el) return;
    this._blur();
    this.focused = el;
    el.classList.add("pad-focus");
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Into the menu: the main button first. */
  _current(list) {
    if (this.focused && list.includes(this.focused)) return this.focused;
    const pick = list.find((el) => el.classList.contains("primary") && !el.hidden) ?? list[0];
    this.focus(pick);
    return null;
  }

  move(dir) {
    const list = this.focusables();
    if (!list.length) return;
    const cur = this._current(list);
    if (!cur) return;
    // A slider or a list: left / right change it.
    if ((dir === "left" || dir === "right") && (cur.type === "range" || cur.tagName === "SELECT")) {
      this._adjust(cur, dir === "right" ? 1 : -1);
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const [dx, dy] = DIRS[dir];
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const along = (ex - ax) * dx + (ey - ay) * dy;
      if (along <= 4) continue;
      const across = Math.abs((ex - ax) * dy) + Math.abs((ey - ay) * dx);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best);
  }

  _adjust(el, step) {
    if (el.type === "range") {
      const s = Number(el.step) || (Number(el.max) - Number(el.min)) / 20 || 1;
      el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + step * s * 2)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.selectedIndex = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + step));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  _confirm() {
    const list = this.focusables();
    const cur = this.focused && list.includes(this.focused) ? this.focused : null;
    if (!cur) { this._current(list); return; }
    if (cur.type === "range") return;
    if (cur.tagName === "SELECT") { this._adjust(cur, 1); return; }
    cur.click();
  }
}
