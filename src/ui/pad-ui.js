/**
 * Controllers on screen: a card when one connects or drops out (in its
 * player colour, like a console's), and the list of who is connected - on
 * the main menu and in Settings.
 *
 *   const ui = new PadUI(pads, { lists: [menuEl, settingsEl] });
 *   pads.on("connect", (p) => ui.connected(p)).on("disconnect", (p) => ui.disconnected(p));
 */

import { padLabel } from "../systems/input-glyphs.js";

function ensureStylesheet() {
  if (document.querySelector("link[data-pad-ui]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./pad-ui.css", import.meta.url).href;
  link.dataset.padUi = "";
  document.head.appendChild(link);
}

const PAD_ICON = `<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M13 4h22c6 0 9 4 10.5 10l2 9c1 5-2.5 8-6 6l-6-5H12.5l-6 5c-3.5 2-7-1-6-6l2-9C4 8 7 4 13 4z" fill="currentColor" opacity=".9"/><circle cx="14" cy="14" r="3.2" fill="#0b0f14"/><circle cx="34" cy="11" r="1.8" fill="#0b0f14"/><circle cx="38" cy="15" r="1.8" fill="#0b0f14"/><circle cx="30" cy="15" r="1.8" fill="#0b0f14"/><circle cx="34" cy="19" r="1.8" fill="#0b0f14"/></svg>`;

export class PadUI {
  constructor(pads, { lists = [] } = {}) {
    ensureStylesheet();
    this.pads = pads;
    this.lists = lists.filter(Boolean);
    this.stack = document.createElement("div");
    this.stack.className = "pad-toasts";
    this.stack.setAttribute("aria-live", "polite");
    document.body.appendChild(this.stack);
    this.refresh();
  }

  _toast(rec, title, sub, gone = false) {
    const t = document.createElement("div");
    t.className = `pad-toast${gone ? " gone" : ""}`;
    t.style.setProperty("--pad", rec.colour.hex);
    t.innerHTML = `<span class="pad-icon">${PAD_ICON}</span><span class="pad-text"><b>${title}</b><small>${sub}</small></span><span class="pad-slot">P${rec.slot + 1}</span>`;
    this.stack.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    setTimeout(() => {
      t.classList.remove("in");
      setTimeout(() => t.remove(), 400);
    }, 3200);
  }

  connected(rec) {
    this._toast(rec, "CONTROLLER CONNECTED", `${rec.name} // Player ${rec.slot + 1} - ${rec.colour.name}`);
    this.refresh();
  }

  disconnected(rec) {
    this._toast(rec, "CONTROLLER DISCONNECTED", `${rec.name} // Player ${rec.slot + 1}`, true);
    this.refresh();
  }

  /** Redraw the lists of who is connected. */
  refresh() {
    const list = this.pads.list;
    const html = list.length
      ? list.map((p) => `<span class="pad-chip" style="--pad:${p.colour.hex}"><span class="pad-icon">${PAD_ICON}</span><b>P${p.slot + 1}</b>${p.name}</span>`).join("")
      : `<span class="pad-chip none"><span class="pad-icon">${PAD_ICON}</span>No controller yet: connect one (USB or Bluetooth) and press any button on it</span>`;
    for (const el of this.lists) el.innerHTML = html;
  }
}

/** The controls, as a controller sees them, for the hints (names follow the pad in use). */
export function padControlsHTML() {
  const k = (code) => `<kbd data-pad="${code}">${padLabel(code)}</kbd>`;
  return [
    `<span><kbd data-pad>L-STICK</kbd> Change lane / move</span>`,
    `<span><kbd data-pad>R-STICK</kbd> Aim (click it to centre)</span>`,
    `<span>${k("PadRT")} Throw / fire</span>`,
    `<span>${k("PadLT")} Focus (slow time)</span>`,
    `<span>${k("PadLB")} / ${k("PadRB")} Sphere wheel: back / round (clockwise)</span>`,
    `<span>${k("PadA")} Jump &nbsp; ${k("PadB")} Slide</span>`,
    `<span>${k("PadY")} Change camera</span>`,
    `<span>${k("PadStart")} Pause</span>`,
    `<span><kbd data-pad>STICK FLICKS</kbd> ${k("PadLT")}${k("PadRT")} Quick-time hits</span>`,
  ].join("");
}
