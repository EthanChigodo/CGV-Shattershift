/**
 * Reaction button hits - the story's quick-time events.
 *
 * One reaction at a time, driven by the host's clock (update(dt)) and its
 * key events, so a test can play one frame by frame:
 *
 *   const hits = new ReactionHits(ui, { longWindows, holdInsteadOfMash });
 *   hits.listen();                       // or forward keyDown/keyUp yourself
 *   hits.start({ kind: "press", keys: ["KeyE"], window: 2 });
 *   // each frame:
 *   const state = hits.update(dt);       // "running" | "success" | "fail"
 *
 * Kinds:
 *   press     one key before the window runs out
 *   combo     every key, any order, inside one window ("PRESS BOTH")
 *   sequence  the keys in order, a fresh window for each
 *   mash      fill a bar by hammering a key (or alternating two) before
 *             `time` runs out; it drains while you stop
 *   hold      fill a bar by holding a key
 * A spec can chain another with `then` (the elevator's last break: a
 * sequence, then a mash) - the chain succeeds only if every link does.
 *
 * Pressing a reaction key that isn't the one asked for fails a press, combo
 * or sequence: no mashing every key to get through.
 *
 * Options (the settings menu): `longWindows` gives every window 1.6x the
 * time; `holdInsteadOfMash` turns every mash into a hold. `pad` (a
 * controller is in use): the keys become flicks of the sticks and the
 * triggers, the same on every controller - see toPadKeys. `difficulty` (a
 * DIFFICULTIES key, or a function returning the run's) scales the mash
 * meters - see MASH.
 */

import { PAD_FLICKS, padLabel } from "../systems/input-glyphs.js";

/**
 * Keys reactions draw from - clear of WASD/Space movement, Esc, and the
 * keys the game already uses mid-run (Q/E change sphere, C the camera, V
 * the view menu), so a habit press is never an instant wrong key.
 */
export const REACTION_KEYS = ["KeyR", "KeyF", "KeyZ", "KeyX", "KeyG", "KeyT"];

const LONG_WINDOW_SCALE = 1.6;

/**
 * A reaction played on a controller. Each reaction key is a flick of a
 * stick (R F Z X on the left stick, G T on the right); tapping Space is the
 * right trigger; alternating A D is the two triggers in turn. Two keys at
 * once ("PRESS BOTH") are always one on each stick, so both can be pushed.
 */
const PAD_FOR = {
  KeyR: "PadLUp", KeyF: "PadLDown", KeyZ: "PadLLeft", KeyX: "PadLRight",
  KeyG: "PadRLeft", KeyT: "PadRRight", KeyQ: "PadRUp", KeyE: "PadRDown",
  Space: "PadRT", KeyA: "PadLT", KeyD: "PadRT", ShiftLeft: "PadLT",
};
const OTHER_STICK = { L: "R", R: "L" };
export function toPadKeys(kind, keys) {
  const out = keys.map((k) => PAD_FOR[k] ?? k);
  if (kind === "combo") {
    for (let i = 1; i < out.length; i += 1) {
      const a = out[i - 1];
      const b = out[i];
      if (PAD_FLICKS.includes(a) && PAD_FLICKS.includes(b) && a[3] === b[3]) out[i] = `Pad${OTHER_STICK[b[3]]}${b.slice(4)}`;
    }
  }
  return out;
}

/**
 * The mash meters ("fill the bar"), retuned from beta feedback: "you have
 * to press Space to fill the bar - it is difficult, rather fill it a bit
 * faster". Each press now counts about twice as much and the bar drains a
 * third as fast, so a relaxed tapper (~5 presses a second) fills one in 7-8
 * presses. Presses to fill, from a steady rate (Normal):
 *
 *                       gain/press     drain/s       time    at 3/s   at 5/s   at 8/s
 *   LOCK IT (the lift)  0.085 -> 0.17  0.32 -> 0.12  3.2 s   - -> 8   - -> 7   22 -> 7
 *   SPRINT (Skyline)    0.06 -> 0.15   0.18 -> 0.10  4.5 s   - -> 9   - -> 8   27 -> 8
 *   PUSH IT OFF (Labs)  0.075 -> 0.16  0.30 -> 0.12  3.5 s   - -> 9   - -> 8   26 -> 7
 *
 * ("-": the old tuning could not be filled at all below ~7 presses a
 * second - the drain outran the taps.) The time limits are unchanged, so
 * there is still a clock to beat. Difficulty (src/systems/difficulty.js)
 * scales a press and the drain: Easy fills in a press or two fewer (6-7);
 * Hard needs 9-10 at 5/s and a steady 4/s or better - a little tension,
 * still fair.
 */
export const MASH = {
  lockIt: { gain: 0.17, decay: 0.12 },
  sprint: { gain: 0.15, decay: 0.1 },
  struggle: { gain: 0.16, decay: 0.12 },
};
export const MASH_DIFFICULTY = {
  easy: { gain: 1.15, decay: 0.75 },
  normal: { gain: 1, decay: 1 },
  hard: { gain: 0.85, decay: 1.5 },
};

function pickKeys(count, rng, pool = REACTION_KEYS) {
  const left = [...pool];
  const out = [];
  for (let i = 0; i < count && left.length; i += 1) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  return out;
}

/**
 * The elevator's break points: harder each time. (Round 4 playtest: every
 * timed event slowed down again - about 1.4x the time it had.)
 *   0  one key, 2.8 s
 *   1  two keys together, 2.4 s
 *   2  three in sequence, 1.6 s each
 *   3+ four in sequence, 1.2 s each, then mash
 */
export function reactionLadder(step, rng = Math.random) {
  if (step <= 0) return { kind: "press", keys: pickKeys(1, rng), window: 2.8 };
  if (step === 1) return { kind: "combo", keys: pickKeys(2, rng), window: 2.4 };
  if (step === 2) return { kind: "sequence", keys: pickKeys(3, rng), window: 1.6 };
  return {
    kind: "sequence",
    keys: pickKeys(4, rng),
    window: Math.max(0.85, 1.2 - (step - 3) * 0.1),
    then: { kind: "mash", keys: ["Space"], time: 4.5, ...MASH.lockIt, label: "LOCK IT" },
  };
}

/** Grabbing a ledge (the bridge, the helicopter ladder): two keys, quick. */
export function latchReaction(rng = Math.random) {
  return { kind: "sequence", keys: pickKeys(2, rng), window: 1.35, label: "GRAB" };
}

/**
 * Sprinting off a falling bridge: alternate two keys. (Its time is the
 * scene's - the bridge falls when it falls - so it is made slower to fill
 * instead: more per press, and it drains more gently.)
 */
export function sprintReaction({ time = 4.5 } = {}) {
  return { kind: "mash", keys: ["KeyA", "KeyD"], alternate: true, time, ...MASH.sprint, label: "SPRINT" };
}

/** Pushing something off you. */
export function struggleReaction({ time = 5 } = {}) {
  return { kind: "mash", keys: ["Space"], time, ...MASH.struggle, label: "PUSH IT OFF" };
}

const LABELS = { press: "PRESS", combo: "PRESS BOTH", sequence: "IN ORDER", mash: "TAP FAST", hold: "HOLD" };

/**
 * What the player physically does, in plain words, for the bar prompts -
 * playtesters read a story label like "HOLD IT" as "hold the key" when the
 * bar wants tapping. So it always says: "TAP SPACE FAST", "ALTERNATE A D
 * FAST", or (with "Hold instead of mash") "HOLD SPACE".
 */
function howTo(kind, spec, keys) {
  const names = keys.map((k) => padLabel(k) ?? (k === "Space" ? "SPACE" : k.replace(/^Key/, ""))).join(" ");
  if (kind === "hold") return `HOLD ${names}`;
  if (kind === "mash") return spec.alternate ? `ALTERNATE ${names} FAST` : `TAP ${names} FAST`;
  return null;
}

export class ReactionHits {
  /**
   * @param {import("./story-ui.js").StoryUI|null} ui  (null: headless)
   * @param {object} [options]
   */
  constructor(ui, { longWindows = false, holdInsteadOfMash = false, pad = false, difficulty = "normal" } = {}) {
    this.ui = ui;
    this.options = { longWindows, holdInsteadOfMash, pad, difficulty };
    /** Told when a reaction begins (the controller's rumble). */
    this.onStart = null;
    this.state = "idle";
    this.failReason = null;
    this.onResult = null;
    this._s = null;
    /** The game's pause menu is up: keys are the menu's, and nothing counts. */
    this.paused = false;
    this._onKeyDown = (e) => {
      if (this.paused) return;
      if (this.state === "running" && this.keyDown(e.code, e.repeat)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    this._onKeyUp = (e) => {
      if (this.keyUp(e.code)) e.stopImmediatePropagation();
    };
  }

  setOptions(options) {
    Object.assign(this.options, options);
  }

  /** Catch keys at the window before the game sees them (capture phase). */
  listen(target = window) {
    this.unlisten();
    this._target = target;
    target.addEventListener("keydown", this._onKeyDown, true);
    target.addEventListener("keyup", this._onKeyUp, true);
  }

  unlisten() {
    this._target?.removeEventListener("keydown", this._onKeyDown, true);
    this._target?.removeEventListener("keyup", this._onKeyUp, true);
    this._target = null;
  }

  get running() {
    return this.state === "running";
  }

  /** Begin a reaction (see the header for specs). */
  start(spec) {
    const o = this.options;
    let kind = spec.kind;
    let keys = [...(spec.keys ?? ["Space"])];
    // Accessibility: a mash becomes a hold of one key.
    if (kind === "mash" && o.holdInsteadOfMash) kind = "hold";
    if (o.pad) keys = toPadKeys(kind, keys);
    const scale = o.longWindows ? LONG_WINDOW_SCALE : 1;
    // The run's difficulty scales a mash's press and drain (not a hold's).
    const level = typeof o.difficulty === "function" ? o.difficulty() : o.difficulty;
    const tune = kind === "mash" ? MASH_DIFFICULTY[level] ?? MASH_DIFFICULTY.normal : MASH_DIFFICULTY.normal;
    this._s = {
      spec,
      kind,
      keys: kind === "hold" ? keys.slice(0, 1) : keys,
      window: (spec.window ?? 2) * scale,
      time: (spec.time ?? 3.5) * scale,
      gain: (spec.gain ?? 0.08) * (o.longWindows ? 1.25 : 1) * tune.gain,
      decay: (spec.decay ?? 0.3) * tune.decay,
      duration: spec.duration ?? 1.4,
      t: 0,
      total: 0,
      index: kind === "sequence" ? 0 : -1,
      done: keys.map(() => false),
      held: new Set(),
      bar: 0,
      last: null,
      presses: 0,
    };
    this.state = "running";
    this.failReason = null;
    const s = this._s;
    // The story's verb ("LOCK IT", "SPRINT") and, for the bars, how: "LOCK IT - TAP SPACE FAST".
    const how = howTo(kind, spec, s.keys);
    const label = spec.label ? (how ? `${spec.label} - ${how}` : spec.label) : how ?? LABELS[kind];
    this.ui?.showReaction({
      label,
      keys: s.keys,
      layout: kind === "combo" ? "together" : kind === "sequence" ? "sequence" : "single",
      bar: kind === "mash" || kind === "hold",
      // A mash gets the big pulsing prompt, its bar marked in presses.
      mash: kind === "mash",
      step: kind === "mash" ? s.gain : 0,
    });
    this._draw();
    this.onStart?.(s);
    return this;
  }

  /**
   * A key went down. Returns true if the reaction used it (the host should
   * not act on it).
   */
  keyDown(code, repeat = false) {
    const s = this._s;
    if (this.state !== "running" || !s) return false;
    const mine = s.keys.includes(code);
    const pool = mine || REACTION_KEYS.includes(code) || PAD_FLICKS.includes(code);
    if (!pool) return false;
    if (repeat) return true;
    s.held.add(code);
    switch (s.kind) {
      case "press":
        if (mine) this._finish("success");
        else this._fail("wrong key");
        break;
      case "combo":
        if (mine) {
          s.done[s.keys.indexOf(code)] = true;
          if (s.done.every(Boolean)) this._finish("success");
        } else this._fail("wrong key");
        break;
      case "sequence":
        if (code === s.keys[s.index]) {
          s.done[s.index] = true;
          s.index += 1;
          s.t = 0;
          if (s.index >= s.keys.length) this._finish("success");
        } else this._fail("wrong key");
        break;
      case "mash":
        if (!mine) return true;
        // Alternating two keys: pressing the same one twice does nothing.
        if (s.spec.alternate && s.keys.length > 1 && code === s.last) return true;
        s.last = code;
        s.presses += 1;
        s.bar = Math.min(1, s.bar + s.gain);
        if (s.bar >= 1) this._finish("success");
        break;
      default:
        break;
    }
    if (this.state === "running") this._draw();
    return true;
  }

  keyUp(code) {
    const s = this._s;
    if (!s) return false;
    const had = s.held.delete(code);
    return had && this.state === "running";
  }

  /** Advance the clock. Returns the state. */
  update(dt) {
    const s = this._s;
    if (this.state !== "running" || !s) return this.state;
    s.t += dt;
    s.total += dt;
    switch (s.kind) {
      case "press":
      case "combo":
      case "sequence":
        if (s.t >= s.window) this._fail("too slow");
        break;
      case "mash":
        s.bar = Math.max(0, s.bar - s.decay * dt);
        if (s.total >= s.time) this._fail("too slow");
        break;
      case "hold": {
        const holding = s.keys.some((k) => s.held.has(k));
        s.bar = holding ? Math.min(1, s.bar + dt / s.duration) : Math.max(0, s.bar - s.decay * dt);
        if (s.bar >= 1) this._finish("success");
        else if (s.total >= s.time) this._fail("too slow");
        break;
      }
      default:
        break;
    }
    if (this.state === "running") this._draw();
    return this.state;
  }

  /** Stop without a result (a skip, a pause-quit). */
  cancel() {
    this.state = "idle";
    this._s = null;
    this.ui?.hideReaction();
  }

  _draw() {
    const s = this._s;
    if (!s || !this.ui) return;
    const timed = s.kind === "mash" || s.kind === "hold" ? 1 - s.total / s.time : 1 - s.t / s.window;
    this.ui.updateReaction({
      time: timed,
      index: s.index,
      done: s.done,
      held: s.keys.map((k) => s.held.has(k)),
      bar: s.kind === "mash" || s.kind === "hold" ? s.bar : null,
      // Each counted press pulses its key and bumps the bar.
      presses: s.presses,
      pressed: s.last ? s.keys.indexOf(s.last) : -1,
    });
  }

  _fail(reason) {
    this.failReason = reason;
    this._finish("fail");
  }

  _finish(result) {
    const s = this._s;
    // A chained reaction: on to the next link.
    if (result === "success" && s?.spec.then) {
      this.start(s.spec.then);
      return;
    }
    this.state = result;
    this.ui?.endReaction(result);
    this.onResult?.(result, this.failReason);
  }

  dispose() {
    this.unlisten();
    this.cancel();
  }
}
