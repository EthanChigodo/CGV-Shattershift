/**
 * The keys the game names on screen, in the controller's names while one is
 * in use: Q / E become L1 / R1 (LB / RB...), Esc becomes OPTIONS (MENU, +),
 * Space ✕ (A), click R2 (RT), W A S D the left stick, the mouse the right
 * stick. Back to the keyboard's names when the keyboard is used again.
 *
 *   applyInputNames(root)   every <kbd> (and [data-key] badge, and
 *                           [data-keys] text) under root, renamed
 *   watchInputNames()       ...and anything added to the page later
 *   padText("USE GLASS (Q/E)")  a message, in the names in use
 *
 * On a touch screen (systems/touch-controls.js), the same keys in what you
 * do on the glass: A / D "SWIPE ← / →", Space "SWIPE ↑" (on the roof "DODGE",
 * its button), click "TAP", Q / E "WHEEL" (tap the sphere wheel), Esc
 * "PAUSE", W A S D on the roof "STICK".
 *
 * Left as they are: <kbd data-pad> (already a controller's), and anything
 * inside .kb-only or [data-keep-keys] (the keyboard's own reference lists).
 */

import { padLabel, padActive, touchActive } from "../systems/input-glyphs.js";

/** A keyboard key's name -> the control that does it on a controller. */
const KB_PAD = {
  // The sphere wheel: L1 turns it counter-clockwise (Q), R1 clockwise (E).
  Q: "PadLB", E: "PadRB",
  ESC: "PadStart", SPACE: "PadA", ENTER: "PadA", SHIFT: "PadB", C: "PadY",
  RMB: "PadLT", CLICK: "PadRT", "HOLD CLICK": "hold:PadRT",
  MOUSE: "R-STICK", A: "L-STICK", D: "L-STICK", W: "L-STICK", S: "L-STICK", WASD: "L-STICK",
};

/** Where the touch controls are: "run" (swipes) or "roof" (a stick and a DODGE button). */
let touchPlace = "run";
export function setTouchPlace(place) {
  touchPlace = place === "roof" ? "roof" : "run";
}

/** A keyboard key's name -> what you do on a touch screen. */
function touchNameFor(label) {
  const k = String(label).trim().toUpperCase();
  const roof = touchPlace === "roof";
  const names = {
    Q: "WHEEL", E: "WHEEL", ESC: "PAUSE", ENTER: "TAP", C: "C",
    SPACE: roof ? "DODGE" : "SWIPE ↑", SHIFT: "SWIPE ↓",
    RMB: "FOCUS", "RIGHT CLICK": "FOCUS", CLICK: "TAP", "HOLD CLICK": "HOLD", MOUSE: "FINGER",
    A: roof ? "STICK" : "SWIPE ←", D: roof ? "STICK" : "SWIPE →",
    W: roof ? "STICK" : "SWIPE ↑", S: roof ? "STICK" : "SWIPE ↓", WASD: "STICK",
  };
  return names[k] ?? null;
}

/** A message in what you do on a touch screen ("SPACE - JUMP FOR THE LADDER!" -> "DODGE - ..."). */
function touchText(str) {
  const roof = touchPlace === "roof";
  return str
    .replace(/\bQ ?\/ ?E\b/g, "THE WHEEL")
    .replace(/\bA \/ D\b/g, roof ? "THE STICK" : "SWIPE")
    .replace(/\bWASD\b/g, "THE STICK")
    .replace(/\bHOLD CLICK\b/gi, "HOLD")
    .replace(/\bRIGHT CLICK\b/gi, "FOCUS")
    .replace(/\bCLICK\b/g, "TAP")
    .replace(/\bSPACE\b/g, roof ? "DODGE" : "SWIPE UP")
    .replace(/\bSHIFT\b/g, "SWIPE DOWN")
    .replace(/\b(ESC|Esc)\b/g, "PAUSE");
}

/** "Q" -> "L1" (on a PlayStation pad), "Hold click" -> "HOLD R2"; null if it has no controller name. */
export function padNameFor(label) {
  const v = KB_PAD[String(label).trim().toUpperCase()];
  if (!v) return null;
  if (v.startsWith("hold:")) return `HOLD ${padLabel(v.slice(5))}`;
  return v.startsWith("Pad") ? padLabel(v) : v;
}

/** A message in the names in use ("SWITCH TO GLASS (Q/E)" -> "SWITCH TO GLASS (L1/R1)"). */
export function padText(str) {
  if (typeof str !== "string") return str;
  if (!padActive()) return touchActive() ? touchText(str) : str;
  const L = (code) => padLabel(code);
  return str
    .replace(/\bQ ?\/ ?E\b/g, `${L("PadLB")}/${L("PadRB")}`)
    .replace(/\bA \/ D\b/g, "L-STICK")
    .replace(/\bWASD\b/g, "L-STICK")
    .replace(/\bHOLD CLICK\b/gi, `HOLD ${L("PadRT")}`)
    .replace(/\bCLICK\b/g, L("PadRT"))
    .replace(/\bSPACE\b/g, L("PadA"))
    .replace(/\bSHIFT\b/g, L("PadB"))
    .replace(/\b(ESC|Esc)\b/g, L("PadStart"));
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/** Rename the keys under `root` (itself included) for the device in use. */
export function applyInputNames(root = document) {
  const pad = padActive();
  const touch = !pad && touchActive();
  const all = (selector) => {
    const list = root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    if (root.matches?.(selector)) list.unshift(root);
    return list;
  };
  // Running text with keys in it.
  for (const el of all("[data-keys]")) {
    if (el.dataset.kbHtml === undefined) el.dataset.kbHtml = el.innerHTML;
    const html = pad || touch ? padText(el.dataset.kbHtml) : el.dataset.kbHtml;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  const keys = all("kbd:not([data-pad]), [data-key]").filter((k) => !k.closest(".kb-only, [data-keep-keys]"));
  for (const k of keys) {
    if (k.dataset.kb === undefined) k.dataset.kb = k.dataset.key ?? k.textContent;
    setText(k, (pad && padNameFor(k.dataset.kb)) || (touch && touchNameFor(k.dataset.kb)) || k.dataset.kb);
  }
  // W A S D are one stick: one cap, not four (Q E one wheel).
  for (const k of keys) {
    if (k.tagName !== "KBD") continue;
    const prev = k.previousElementSibling;
    const dup = (pad || touch) && prev?.tagName === "KBD" && prev.textContent === k.textContent;
    const display = dup ? "none" : "";
    if (k.style.display !== display) k.style.display = display;
  }
}

let observer = null;
/** Keep renaming what is added to the page later (toasts, menus, cards). */
export function watchInputNames() {
  if (observer) return;
  observer = new MutationObserver((records) => {
    if (!padActive() && !touchActive()) return;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches("kbd, [data-key], [data-keys]") || node.querySelector("kbd, [data-key], [data-keys]")) applyInputNames(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
