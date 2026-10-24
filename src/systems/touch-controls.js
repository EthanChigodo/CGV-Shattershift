/**
 * Playing on a touch screen: a phone or tablet held sideways.
 *
 * Like the controllers' PadBridge (gamepads.js), it plays the game by
 * sending the keys and mouse presses the game already listens for, so every
 * level, lift and cutscene works unchanged. A finger on the glass is caught
 * first (the capture phase), read as a gesture, and turned into those:
 *
 *   running   (the Foundry, the Labs, the Skyline)
 *     swipe left / right    change lane (A / D)
 *     swipe up / down       jump / slide (W / S; in the Skyline Space / Shift,
 *                           and sprint / brake (W / S) while the finger stays down)
 *     tap                   throw at that spot (a click there)
 *     hold                  charge, aiming where the finger is; let go to throw
 *     FOCUS button          slow time while held (the right mouse button)
 *   the roof
 *     left side             a stick where the thumb lands: walk (W A S D)
 *     right side            aim and fire where the finger is (held: keeps firing)
 *     DODGE button          dodge (Space) - also the generator's cord and the
 *                           jump for the ladder
 *   anywhere in a run
 *     the sphere wheel      tap it to change sphere (E)
 *     PAUSE                 the button at the top (already there)
 *   a cutscene               HOLD TO SKIP (holds Esc; a tap pauses)
 *   a quick-time hit         the screen is the two sticks of a controller
 *                            (reaction.js asks in those): swipe on the half it
 *                            says to, tap a side to "pull its trigger"
 *
 * Menus, cards and the lift's clamps are left to the browser's own taps.
 *
 *   const touch = new TouchControls({ canvas, mode: () => "run", ... });
 *   touch.update(dt);   // once a frame
 */

const TAP_MS = 240;
const TAP_MOVE = 16;
/** A swipe: this far (px, or a share of the short side on big screens) and quick. */
const SWIPE_MIN = 38;
const SWIPE_MS = 420;
/** Still this long: a hold (a charge, or the Labs' launcher). */
const HOLD_MS = 170;
/** How long a swiped key stays down at least (and for as long as the finger does). */
const KEY_MIN = 0.12;
const STICK_RADIUS = 58;

const KEY_OF = { Space: " ", Escape: "Escape", ShiftLeft: "Shift", KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", KeyE: "e" };
const ARROWS = { Up: "↑", Down: "↓", Left: "←", Right: "→" };

export class TouchControls {
  /**
   * @param {object} host
   * @param {HTMLElement} host.canvas
   * @param {() => "off"|"run"|"roof"|"cutscene"|"reaction"|"lift"} host.mode
   * @param {() => object|null} [host.wants]      the quick-time hit's keys (ReactionHits.wants)
   * @param {() => boolean} [host.canFocus]       focus (slow time) is earned
   * @param {() => boolean} [host.skyline]        the Skyline (W / S held: sprint / brake)
   * @param {() => boolean} [host.enabled]        touch controls on
   */
  constructor(host) {
    this.host = host;
    this.tracks = new Map();
    this.keys = new Map();          // code -> seconds it must stay down
    this.mouse = null;              // the pointerId playing the mouse
    this.mode = "off";
    this.wheel = null;
    this._build();
    const opts = { capture: true, passive: false };
    addEventListener("pointerdown", (e) => this._down(e), opts);
    addEventListener("pointermove", (e) => this._move(e), opts);
    addEventListener("pointerup", (e) => this._up(e), opts);
    addEventListener("pointercancel", (e) => this._up(e, true), opts);
    // A long press would bring up the browser's menu.
    addEventListener("contextmenu", (e) => { if (this.mode !== "off" && e.target === this.host.canvas) e.preventDefault(); }, true);
  }

  get enabled() {
    return this.host.enabled?.() ?? true;
  }

  /* ---- what is on screen ---- */

  _build() {
    const root = document.createElement("div");
    root.className = "touch-ui";
    root.innerHTML = `
      <div class="tc-react" aria-hidden="true"><div class="tc-half tc-left"><b></b></div><div class="tc-half tc-right"><b></b></div></div>
      <div class="tc-stick" aria-hidden="true"><i></i></div>
      <button type="button" class="tc-button tc-focus" aria-label="Focus: slow time while held">FOCUS</button>
      <button type="button" class="tc-button tc-dodge" aria-label="Dodge">DODGE</button>
      <button type="button" class="tc-button tc-skip" aria-label="Hold to skip">HOLD TO SKIP</button>`;
    document.body.append(root);
    this.root = root;
    this.react = root.querySelector(".tc-react");
    this.halves = { L: root.querySelector(".tc-left b"), R: root.querySelector(".tc-right b") };
    this.stick = root.querySelector(".tc-stick");
    this.knob = this.stick.querySelector("i");
    const button = (sel, press, release) => {
      const el = root.querySelector(sel);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        el.classList.add("down");
        press();
      });
      const up = () => { if (el.classList.contains("down")) { el.classList.remove("down"); release(); } };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
      return el;
    };
    this.focusButton = button(".tc-focus", () => this._click("pointerdown", 2), () => this._click("pointerup", 2));
    this.dodgeButton = button(".tc-dodge", () => this.press("Space"), () => this.release("Space"));
    this.skipButton = button(".tc-skip", () => this.press("Escape"), () => this.release("Escape"));
  }

  /** The sphere wheel (sphere-wheel.js): a tap on it turns it. */
  attachWheel(el, cycle) {
    if (!el || this.wheel === el) return;
    this.wheel = el;
    el.addEventListener("pointerdown", (e) => {
      if (!this.enabled || e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      cycle();
    });
  }

  /* ---- keys and clicks, as the game hears them ---- */

  _key(type, code) {
    dispatchEvent(new KeyboardEvent(type, { code, key: KEY_OF[code] ?? code, bubbles: true, cancelable: true }));
  }

  /** Down now, up no sooner than `min` seconds (and not before release()). */
  press(code, min = 0) {
    if (!this.keys.has(code)) this._key("keydown", code);
    this.keys.set(code, { min, held: true });
  }

  release(code) {
    const k = this.keys.get(code);
    if (!k) return;
    k.held = false;
    if (k.min <= 0) { this.keys.delete(code); this._key("keyup", code); }
  }

  _pointer(type, x, y, button = 0, id = 41) {
    const init = { clientX: x, clientY: y, button, buttons: type === "pointerup" ? 0 : button === 2 ? 2 : 1, bubbles: true, cancelable: true, pointerId: id, pointerType: "mouse", isPrimary: true };
    (type === "pointermove" ? window : this.host.canvas).dispatchEvent(new PointerEvent(type, init));
  }

  _click(type, button) {
    const x = innerWidth / 2;
    const y = innerHeight / 2;
    this._pointer(type, x, y, button, 42);
  }

  /* ---- fingers ---- */

  _ours(e) {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return false;
    if (!this.enabled) return false;
    const t = e.target;
    // Buttons, menus and cards keep the browser's own taps.
    if (t instanceof Element && t.closest("button, input, select, a, label, .screen.active, .unlock-card, .sphere-wheel, .view-menu, .topbar, .pu-card, .mlt-credits, .touch-ui .tc-button")) return false;
    return true;
  }

  _down(e) {
    const mode = this.host.mode();
    this.mode = mode;
    if (!this._ours(e)) return;
    if (mode === "off" || mode === "lift" || mode === "cutscene") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // How quick a swipe is: timed by the events' own clocks (a slow frame
    // mustn't make a quick swipe look slow). How long a finger stays still
    // (a hold): by this clock, when the events are read.
    const now = performance.now();
    const t = e.timeStamp || now;
    const tr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: t, last: t, down: now, seen: now, kind: "pending", key: null, side: e.clientX < innerWidth / 2 ? "L" : "R" };
    this.tracks.set(e.pointerId, tr);
    if (mode === "reaction") {
      // A tap on a side is that side's trigger - if the hit wants it.
      const code = `Pad${tr.side}T`;
      if (this._wanted(code)) { tr.key = code; this.press(code); }
      return;
    }
    if (mode === "roof") {
      if (e.clientX < innerWidth * 0.42) {
        tr.kind = "stick";
        this._showStick(tr);
      } else if (this.mouse === null) {
        tr.kind = "aim";
        this.mouse = tr.id;
        this._pointer("pointermove", tr.x, tr.y);
        this._pointer("pointerdown", tr.x, tr.y);
      }
    }
  }

  _move(e) {
    if (e.pointerType === "mouse") return;
    const tr = this.tracks.get(e.pointerId);
    if (!tr) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    tr.x = e.clientX;
    tr.y = e.clientY;
    tr.last = e.timeStamp || performance.now();
    tr.seen = performance.now();
    const dx = tr.x - tr.x0;
    const dy = tr.y - tr.y0;
    const dist = Math.hypot(dx, dy);
    const quick = tr.last - tr.t0 < SWIPE_MS;
    const far = dist > Math.max(SWIPE_MIN, Math.min(innerWidth, innerHeight) * 0.06);
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "Left" : "Right") : (dy < 0 ? "Up" : "Down");
    if (this.mode === "reaction") {
      if (tr.kind === "pending" && far) {
        tr.kind = "swiped";
        const code = `Pad${tr.side}${dir}`;
        if (tr.key) this.release(tr.key);
        tr.key = code;
        this.press(code);
      }
      return;
    }
    if (tr.kind === "stick") { this._steer(tr); return; }
    if (tr.kind === "aim" || tr.kind === "hold") { this._pointer("pointermove", tr.x, tr.y); return; }
    // One stroke is one move, however long (two lanes: two flicks) - but it
    // can turn: left then right, or a jump then a lane.
    if (tr.kind === "pending" && far && quick) this._swipe(tr, dir);
    else if (tr.kind === "swiped" && far && quick && dir !== tr.dir) this._swipe(tr, dir);
  }

  _up(e, cancelled = false) {
    if (e.pointerType === "mouse") return;
    const tr = this.tracks.get(e.pointerId);
    if (!tr) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.tracks.delete(e.pointerId);
    if (tr.key) this.release(tr.key);
    if (tr.also) this.release(tr.also);
    if (tr.kind === "stick") { this._hideStick(); for (const c of ["KeyW", "KeyA", "KeyS", "KeyD"]) this.release(c); return; }
    if (tr.kind === "aim" || tr.kind === "hold") {
      if (this.mouse === tr.id) { this._pointer("pointerup", tr.x, tr.y); this.mouse = null; }
      return;
    }
    // A quick tap: a click right there (a throw).
    if (tr.kind === "pending" && !cancelled && this.mode === "run" && this.mouse === null) {
      if (Math.hypot(tr.x - tr.x0, tr.y - tr.y0) <= TAP_MOVE * 2 || performance.now() - tr.down < TAP_MS) {
        this._pointer("pointermove", tr.x0, tr.y0);
        this._pointer("pointerdown", tr.x0, tr.y0);
        this._pointer("pointerup", tr.x0, tr.y0);
      }
    }
  }

  _swipe(tr, dir) {
    const code = { Left: "KeyA", Right: "KeyD", Up: "KeyW", Down: "KeyS" }[dir];
    if (tr.key) this.release(tr.key);
    if (tr.also) this.release(tr.also);
    tr.key = code;
    tr.also = null;
    tr.kind = "swiped";
    tr.dir = dir;
    // The Skyline: W / S are sprint / brake (held with the finger); the jump and slide are Space / Shift.
    if (this.host.skyline?.() && (dir === "Up" || dir === "Down")) {
      tr.also = dir === "Up" ? "Space" : "ShiftLeft";
      this.press(tr.also, KEY_MIN);
      this.release(tr.also);
    }
    this.press(code, KEY_MIN);
    // Another swipe can follow from here, without lifting the finger.
    tr.x0 = tr.x;
    tr.y0 = tr.y;
    tr.t0 = tr.last;
    tr.down = tr.seen;
  }

  /* ---- the roof's stick ---- */

  _showStick(tr) {
    const r = STICK_RADIUS;
    tr.cx = Math.max(r + 8, Math.min(innerWidth * 0.42, tr.x0));
    tr.cy = Math.max(r + 8, Math.min(innerHeight - r - 8, tr.y0));
    this.stick.style.left = `${tr.cx}px`;
    this.stick.style.top = `${tr.cy}px`;
    this.stick.classList.add("show");
    this.knob.style.transform = "translate(-50%, -50%)";
  }

  _hideStick() {
    this.stick.classList.remove("show");
  }

  _steer(tr) {
    const r = STICK_RADIUS;
    let dx = tr.x - tr.cx;
    let dy = tr.y - tr.cy;
    const m = Math.hypot(dx, dy);
    if (m > r) { dx *= r / m; dy *= r / m; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / r;
    const ny = dy / r;
    const on = (c, v) => (v ? this.press(c) : this.release(c));
    on("KeyA", nx < -0.38);
    on("KeyD", nx > 0.38);
    on("KeyW", ny < -0.38);
    on("KeyS", ny > 0.38);
  }

  /* ---- quick-time hits ---- */

  _wanted(code) {
    const w = this.host.wants?.();
    return !!w && w.keys.includes(code);
  }

  /** What each half of the screen is for, in the hit on screen. */
  _reactionLabels() {
    const w = this.host.wants?.();
    const out = { L: [], R: [] };
    if (!w) return out;
    const keys = w.kind === "sequence" && w.index >= 0 ? [w.keys[w.index]].filter(Boolean) : w.keys;
    for (const k of keys) {
      const m = /^Pad([LR])(Up|Down|Left|Right|T)$/.exec(k);
      if (!m) continue;
      const side = m[1];
      const what = m[2] === "T" ? (w.kind === "hold" ? "HOLD" : w.kind === "mash" ? "TAP FAST" : "TAP") : `SWIPE ${ARROWS[m[2]]}`;
      if (!out[side].includes(what)) out[side].push(what);
    }
    return out;
  }

  /* ---- once a frame ---- */

  update(dt) {
    const mode = this.enabled ? this.host.mode() : "off";
    if (mode !== this.mode) this._change(mode);
    this.mode = mode;
    // Keys kept down for their minimum.
    for (const [code, k] of this.keys) {
      if (k.min > 0) k.min -= dt;
      if (!k.held && k.min <= 0) { this.keys.delete(code); this._key("keyup", code); }
    }
    // Still long enough: a hold - the press goes down where the finger is.
    // (Long enough plus a frame: a slow frame holds back the finger's moves
    // until after it, so a swipe begun in one isn't taken for a hold.)
    const now = performance.now();
    const gap = this._frame ? now - this._frame : 16;
    this._frame = now;
    if (mode === "run") {
      for (const tr of this.tracks.values()) {
        const still = Math.hypot(tr.x - tr.x0, tr.y - tr.y0) <= TAP_MOVE * 2;
        if (tr.kind === "pending" && now - tr.down > HOLD_MS + gap && (still || now - tr.seen > HOLD_MS + gap) && this.mouse === null) {
          tr.kind = "hold";
          this.mouse = tr.id;
          this._pointer("pointermove", tr.x, tr.y);
          this._pointer("pointerdown", tr.x, tr.y);
        }
      }
    }
    const show = (el, on) => el.classList.toggle("show", on);
    show(this.root, mode !== "off");
    show(this.focusButton, (mode === "run" || mode === "roof") && !!this.host.canFocus?.());
    show(this.dodgeButton, mode === "roof");
    show(this.skipButton, mode === "cutscene");
    show(this.react, mode === "reaction");
    if (mode === "reaction") {
      const labels = this._reactionLabels();
      for (const side of ["L", "R"]) {
        const text = labels[side].join(" · ");
        if (this.halves[side].textContent !== text) this.halves[side].textContent = text;
        this.halves[side].parentElement.classList.toggle("on", !!text);
      }
    }
  }

  /** Out of one kind of play into another: let go of everything held. */
  _change(mode) {
    for (const tr of this.tracks.values()) if (tr.key) this.release(tr.key);
    if (this.mouse !== null) {
      const tr = this.tracks.get(this.mouse);
      this._pointer("pointerup", tr?.x ?? innerWidth / 2, tr?.y ?? innerHeight / 2);
      this.mouse = null;
    }
    this.tracks.clear();
    this._hideStick();
    for (const el of this.root.querySelectorAll(".tc-button.down")) el.dispatchEvent(new Event("pointercancel"));
    for (const [code, k] of this.keys) { k.held = false; k.min = 0; }
  }
}
