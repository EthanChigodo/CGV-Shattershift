/**
 * What a key is called on the controller in use - for every prompt that
 * names one. (src/systems/pad-input.js drives the game from the pads; this
 * is only how the screen talks about them.)
 *
 * While a pad is the last thing the player used, <html> carries
 * `pad-active` and one of `pad-ps` / `pad-xbox` / `pad-generic`, and the
 * prompts name the pad's buttons instead of keys. Touch the keyboard or
 * the mouse and everything goes back.
 *
 *   setPadKind("ps");                // a DualSense was just used (null: keyboard and mouse)
 *   padGlyph("Space")                // "✕" (an Xbox pad: "A"; no pad in use: null)
 *   onGlyphChange((kind) => ...);    // the player switched device
 *
 * Two ways a prompt follows the device:
 *   - code that draws a key asks padGlyph(code): the story's reaction
 *     prompts, whose keys must be exactly the buttons pad-input.js sends
 *     them from (KEY_BUTTON below is that one table);
 *   - everything else is rewritten on the page while a pad is in use, and
 *     put back afterwards: every <kbd> by its text (<kbd>Space</kbd> -> ✕,
 *     <kbd>A</kbd><kbd>D</kbd> -> L-stick) and the key names in HUD lines,
 *     hints and the manual ("SPACE - JUMP THE DUCT", "USE GLASS (Q/E)").
 *     No markup has to change for it. [data-pad-keep] opts an element out;
 *     [data-pad-hide] is hidden while a pad is in use (src/ui/pad-input.css).
 */

import { label } from "./gamepad.js";

/**
 * The pad button each key is sent from (gamepad.js names). The reaction
 * keys (src/story/reaction.js REACTION_KEYS) get a face button or bumper
 * each, so a quick-time prompt can always be answered on the pad.
 */
export const KEY_BUTTON = {
  Space: "cross", Enter: "cross", NumpadEnter: "cross", Escape: "options",
  ShiftLeft: "circle", ShiftRight: "circle",
  KeyC: "triangle", KeyQ: "l1", KeyE: "r1", KeyV: "share", KeyH: "l3", KeyP: "r3",
  KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down",
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  KeyR: "triangle", KeyF: "square", KeyZ: "cross", KeyX: "circle", KeyG: "l1", KeyT: "r1",
};

/** Names for what is not a single button (a non-breaking hyphen: a key cap never wraps). */
const EXTRA = {
  lstick: { ps: "L‑stick", xbox: "L‑stick" },
  rstick: { ps: "R‑stick", xbox: "R‑stick" },
  dpad: { ps: "D‑pad", xbox: "D‑pad" },
};

/** A button's name on that family of pad ("cross" -> "✕" / "A"), sticks included. */
export function padLabel(button, kind = "xbox") {
  const family = kind === "ps" ? "ps" : "xbox";
  if (EXTRA[button]) return EXTRA[button][family];
  return label(button, family);
}

let kind = null;
const listeners = new Set();

/** The family of the pad in use ("ps" | "xbox" | "generic"), or null for keyboard and mouse. */
export function padKind() {
  return kind;
}

/** What a key is on the pad in use ("Space" -> "✕"), or null with no pad in use. */
export function padGlyph(code) {
  const button = kind && KEY_BUTTON[code];
  return button ? padLabel(button, kind) : null;
}

/** Hear when the device in use changes (the argument is the new kind or null). Returns an unsubscribe. */
export function onGlyphChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The pad in use changed (or, with null, the keyboard and mouse are back). */
export function setPadKind(next) {
  next = next || null;
  if (next === kind) return;
  kind = next;
  const root = document.documentElement;
  root.classList.toggle("pad-active", !!kind);
  for (const k of ["ps", "xbox", "generic"]) root.classList.toggle(`pad-${k}`, kind === k);
  page.set(kind);
  for (const fn of [...listeners]) fn(kind);
}

/* ---- Rewriting the page's prompts ----------------------------------------- */

/** Never rewritten: the credits (song titles), the keyboard reference, prompts drawn in code. */
const SKIP = "script, style, textarea, [data-pad-keep], .story-react, .settings-controls, #creditsBody, .credits-body, .story-credits, .mlt-credits";

/** A <kbd>'s text (upper case) -> the button it becomes. */
const KBD = {
  SPACE: "cross", ENTER: "cross", SHIFT: "circle", ESC: "options", R: "cross",
  Q: "l1", E: "r1", C: "triangle", V: "share", H: "l3", P: "r3",
  CLICK: "r2", "HOLD CLICK": "hold r2", RMB: "l2", MOUSE: "rstick",
  W: "lstick", A: "lstick", S: "lstick", D: "lstick", WASD: "lstick",
};

/**
 * Key names in running text. Each is [pattern, replacement(name)], where
 * name(button) is the button's label; an all-capitals match gets an
 * all-capitals replacement. Only the spellings the game uses: plain
 * "Shift" or "A" in a sentence is English, not a key.
 */
const PROSE = [
  [/\bHOLD CLICK\b/g, (n) => `HOLD ${n("r2")}`],
  [/\bCLICK\b/g, (n) => n("r2")],
  [/\bSPACE\b/g, (n) => n("cross")],
  [/\bSHIFT\b/g, (n) => n("circle")],
  [/\bESC\b/g, (n) => n("options")],
  [/\bRMB\b/g, (n) => n("l2")],
  [/\b(?:A \/ D|WASD)\b/g, (n) => n("lstick")],
  [/\bQ ?\/ ?E\b/g, (n) => `${n("l1")}/${n("r1")}`],
  [/\((?:Space)\b/g, (n) => `(${n("cross")}`],
  [/\((?:Shift)\b/g, (n) => `(${n("circle")}`],
  [/\bpress Esc\b/g, (n) => `press ${n("options")}`],
  [/\bright mouse\b/g, (n) => n("l2")],
  [/\bW sprints, S brakes\b/g, () => "Up sprints, down brakes"],
  [/\b(or|with) W\b/g, (n, word) => `${word} up`],
  [/\bor S\b/g, () => "or down"],
];
/** A cheap first look before the patterns. */
const MAYBE = /CLICK|SPACE|SHIFT|ESC|RMB|A \/ D|WASD|Q ?\/ ?E|\(Space|\(Shift|press Esc|right mouse|\b[WS]\b/;

function rewrite(text, k) {
  if (!MAYBE.test(text)) return null;
  let out = text;
  for (const [pattern, swap] of PROSE) {
    out = out.replace(pattern, (match, ...groups) => {
      const said = swap((button) => padLabel(button, k), ...groups);
      return /[a-z]/.test(match) ? said : said.toUpperCase();
    });
  }
  return out === text ? null : out;
}

function kbdText(text, k) {
  const button = KBD[text.trim().toUpperCase()];
  if (!button) return null;
  return button === "hold r2" ? `Hold ${padLabel("r2", k)}` : padLabel(button, k);
}

/**
 * Rewrites the text nodes that name keys while a pad is in use (and new
 * ones as the game writes them), and puts every one back when it is not.
 */
class PagePrompts {
  constructor() {
    /** Text node -> { original, replaced }. */
    this.records = new Map();
    this.kind = null;
    this.observer = null;
  }

  set(next) {
    if (typeof document === "undefined" || !document.body) return;
    this._restore();
    this.kind = next;
    if (!next) return;
    this._walk(document.body);
    this.observer ??= new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") this._text(m.target);
        else for (const node of m.addedNodes) this._walk(node);
      }
    });
    this.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  _restore() {
    this.observer?.disconnect();
    for (const [node, r] of this.records) if (node.isConnected && node.data === r.replaced) node.data = r.original;
    this.records.clear();
    for (const el of document.querySelectorAll(".pad-dupe")) el.classList.remove("pad-dupe");
  }

  _walk(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      this._text(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) this._text(node);
  }

  _text(node) {
    const parent = node.parentElement;
    if (!parent || !this.kind) return;
    const kbd = parent.tagName === "KBD";
    const next = kbd ? kbdText(node.data, this.kind) : rewrite(node.data, this.kind);
    if (next === null || next === node.data || parent.closest(SKIP)) return;
    if (this.records.size > 400) for (const old of this.records.keys()) if (!old.isConnected) this.records.delete(old);
    this.records.set(node, { original: node.data, replaced: next });
    node.data = next;
    // <kbd>A</kbd><kbd>D</kbd> are one stick: the second goes.
    const prev = kbd && parent.previousElementSibling;
    if (prev?.tagName === "KBD" && prev.textContent === next && !/\S/.test(between(prev, parent))) parent.classList.add("pad-dupe");
  }
}

/** The text between two sibling elements. */
function between(a, b) {
  let text = "";
  for (let n = a.nextSibling; n && n !== b; n = n.nextSibling) text += n.textContent;
  return text;
}

const page = new PagePrompts();
