/**
 * The right-tool obstacles on screen (src/systems/problems.js), in the
 * NIGHTFALL look: words on the picture, the solving sphere's colour and mark
 * the only colour.
 *
 *   hint     the first time one is in view: its mark, its name, what it wants
 *   wrong    the wrong sphere on it: "NEEDS CRYO", with a shiver
 *   solved   "SOLVED +600" and what happened, in the tool's colour
 *
 * One for every level: it listens to the host's ProblemLog.
 *
 *   const cue = new ProblemCue();
 *   cue.bind(log);
 */

import { TOOLS } from "../systems/problems.js";
import { padText } from "./key-names.js";

const SIGNS = {
  glass: `<path d="M12 3l7 9-7 9-7-9z"/><path d="M5 12h14M12 3l-2.5 9L12 21l2.5-9z" stroke-width="1.1" opacity=".8"/>`,
  cryo: `<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>`,
  shock: `<path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6.2z"/>`,
  gravity: `<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-20 12 12)"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>`,
  charge: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M5 19l2.8-2.8M16.2 7.8L19 5"/>`,
};

/** A tool's mark as inline SVG (also used by the field manual's cards). */
export function toolSign(tool) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIGNS[tool] ?? SIGNS.glass}</svg>`;
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

export class ProblemCue {
  constructor({ container = document.body } = {}) {
    if (!document.querySelector("link[data-problem-cue]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("./problem-cue.css", import.meta.url).href;
      link.dataset.problemCue = "";
      document.head.appendChild(link);
    }
    this.root = el("div", "pc-root", container);
    this.root.setAttribute("aria-live", "polite");
    this.hintEl = el("div", "pc-hint", this.root);
    this.lineEl = el("div", "pc-line", this.root);
    this._timers = { hint: 0, line: 0 };
    this._off = [];
  }

  /** Listen to a ProblemLog (replacing any earlier one). */
  bind(log) {
    for (const off of this._off) off();
    this._off = [
      log.on("hint", ({ def }) => this.hint(def)),
      log.on("wrong", ({ def, text }) => this.wrong(def, text)),
      log.on("solved", ({ def, bonus, label }) => this.solved(def, bonus, label)),
    ];
  }

  _show(node, key, seconds, html, tool, kind) {
    clearTimeout(this._timers[key]);
    node.innerHTML = html;
    node.style.setProperty("--c", TOOLS[tool]?.colour ?? "#fff");
    node.className = `${key === "hint" ? "pc-hint" : "pc-line"} ${kind} show`;
    // Restart the entrance animation.
    void node.offsetWidth;
    this._timers[key] = setTimeout(() => node.classList.remove("show"), seconds * 1000);
  }

  /** The first sighting: mark, name, what to do. */
  hint(def) {
    const tool = TOOLS[def.tool];
    const [name, how] = padText(def.hint).split(/:\s*/, 2);
    this._show(this.hintEl, "hint", 4.2,
      `<i class="pc-mark">${toolSign(def.tool)}</i><span class="pc-text"><small>THE RIGHT TOOL // ${tool.name.toUpperCase()}</small><b>${name}</b>${how ? `<em>${how}</em>` : ""}</span>`,
      def.tool, "hint");
  }

  wrong(def, text) {
    if (!text) return;
    this._show(this.lineEl, "line", 1.5, `<i class="pc-mark">${toolSign(def.tool)}</i><b>${padText(text)}</b>`, def.tool, "wrong");
  }

  solved(def, bonus, label) {
    this._show(this.lineEl, "line", 2.2, `<i class="pc-mark">${toolSign(def.tool)}</i><b>SOLVED +${bonus}</b><span>${label}</span>`, def.tool, "solved");
  }

  /** Off the screen at once (a level change, the menus). */
  clear() {
    for (const node of [this.hintEl, this.lineEl]) node.classList.remove("show");
  }
}
