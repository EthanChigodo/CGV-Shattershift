/**
 * Before a sector starts in the story: what Subject 07 has gained there -
 * the new sphere type and the new abilities (systems/progression.js), each
 * with a picture of it in play, what it does and how to use it. Continue
 * (click, Space, Enter, the controller's A) and the host counts 3, 2, 1.
 *
 *   const card = new UnlockCard();
 *   card.show("labs", () => startCountdown());
 *   card.open;       // on screen (the game holds still)
 *   card.close();    // Continue
 */

import { BALLS } from "../systems/arsenal.js";
import { ABILITIES, GAINS, SPHERE_HOW, STAGE_NAMES, TIPS } from "../systems/progression.js";
import { isPadCode, padLabel } from "../systems/input-glyphs.js";

/**
 * The pictures: assets/ui/unlocks/<key>.jpg (captured in play). The version
 * on the end: a browser that once asked before they existed asks again.
 */
const PICTURES = new URL("../../assets/ui/unlocks/", import.meta.url).href;
const PICTURES_VERSION = 4;

/** What each sphere is for, where the card brings it in. */
const SPHERE_USE = {
  glass: "Breaks glass - the panes, the switches' covers, the cells.",
  shock: "Shatters all the glass round where it hits - and its EMP is the only thing that brings down HALCYON's security drones.",
  cryo: "Freezes everything round where it hits, and puts fire out - the fire walls across the Labs burn until a cryo sphere hits them.",
  gravity: "A black hole: every patient near it is pulled in, lifted off their feet and flung at the open ledge - near one, over it. It drags a winged one out of the sky too.",
};
const TIP_COLOURS = { firewall: "#ff8a3a", drone: "#ff4a3a", brute: "#7a5cff", vent: "#9fe8d8", sprinkler: "#ff6a4a" };
const ABILITY_COLOURS = { throw: "#ffd9a0", launcher: "#9fefff", charge: "#7fe3ff", focus: "#a9c8ff", dodge: "#ff8a5c" };

const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

function ensureStyles() {
  if (document.querySelector("link[data-unlocks]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./unlock-card.css", import.meta.url).href;
  link.dataset.unlocks = "true";
  document.head.appendChild(link);
}

/** One line of keys: "Hold" + "Click", or the controller's names. */
function keys(list) {
  return list.map((k) => `<kbd>${isPadCode(k) ? padLabel(k) : k}</kbd>`).join("");
}

/**
 * The same line on a touch screen (touch-controls.js): what you do on the
 * glass - or null where it has no touch version (the mouse look, the camera
 * switch: a touch screen's roof is always seen from above).
 */
const TOUCH = {
  Click: ["Tap"], "Hold+Click": ["Hold"], "Hold+Right click": ["Hold", "FOCUS"],
  "W+A+S+D": ["Left thumb"], Space: ["DODGE"], "Q+E": ["Tap the wheel"], Mouse: null, C: null,
};
function touchKeys(kb) {
  const t = TOUCH[kb.join("+")];
  return t === undefined ? kb : t;
}

function how(lines) {
  return lines.map((l) => {
    const touch = touchKeys(l.kb);
    return `<div class="uc-how-line${touch ? "" : " no-touch"}">
      <dt><span class="kb-only">${keys(l.kb)}</span><span class="pad-only">${keys(l.pad)}</span>${touch ? `<span class="touch-only" data-keep-keys>${keys(touch)}</span>` : ""}</dt>
      <dd>${l.does}</dd>
    </div>`;
  }).join("");
}

export class UnlockCard {
  constructor() {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "unlock-card";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.innerHTML = `
      <div class="uc-box">
        <p class="uc-eyebrow"><i class="uc-dot"></i><span class="uc-where"></span></p>
        <h2 class="uc-title">New abilities</h2>
        <div class="uc-items"></div>
        <div class="uc-foot">
          <button type="button" class="uc-button"><span>Continue</span><i>&#9654;</i></button>
          <p class="uc-keys"><span class="kb-only"><kbd>Space</kbd> or <kbd>Enter</kbd></span><span class="pad-only"><kbd class="uc-pad-a"></kbd></span><span class="touch-only">Tap Continue</span> - then 3, 2, 1</p>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.where = this.root.querySelector(".uc-where");
    this.items = this.root.querySelector(".uc-items");
    this.button = this.root.querySelector(".uc-button");
    this.button.addEventListener("click", () => this.close());
    this.open = false;
    this.done = null;
  }

  /**
   * The card for a sector; `done` once Continue is pressed. `tipsOnly`: just
   * what to know about it (Endless, where nothing is earned).
   */
  show(stage, done, { tipsOnly = false } = {}) {
    const gains = GAINS[stage];
    if (!gains) { done?.(); return; }
    this.done = done;
    this.where.textContent = tipsOnly ? `Endless · ${STAGE_NAMES[stage].replace(/^Sector \d+ · /, "")}` : STAGE_NAMES[stage];
    this.root.querySelector(".uc-title").textContent = tipsOnly ? "Know this first" : "New abilities";
    const items = [];
    for (const key of tipsOnly ? [] : gains.spheres) {
      const ball = BALLS[key];
      // (The first one of all needs no "change sphere": it's the only one yet.)
      const first = stage === "foundry" && key === gains.spheres[0];
      items.push({
        key,
        tag: first ? "Sphere" : "New sphere",
        name: `${ball.name} sphere`,
        text: `${SPHERE_USE[key] ?? ball.text} Costs ${ball.cost} sphere${ball.cost > 1 ? "s" : ""}.`,
        how: first ? [] : SPHERE_HOW,
        colour: hex(ball.colour),
      });
    }
    for (const key of tipsOnly ? [] : gains.abilities) {
      const a = ABILITIES[key];
      const kind = a.kind ?? "Ability";
      items.push({ key, tag: stage === "foundry" ? kind : `${kind} unlocked`, name: a.name, text: a.text, how: a.how, colour: ABILITY_COLOURS[key] });
    }
    // What to know about the place (its hazards): after what's new.
    for (const key of gains.tips ?? []) {
      const t = TIPS[key];
      items.push({ key, tag: "Know this", name: t.name, text: t.text, how: t.how, colour: TIP_COLOURS[key] });
    }
    this.items.innerHTML = items.map((it, i) => `
      <article class="uc-item" style="--c:${it.colour}; --i:${i}">
        <figure class="uc-pic">
          <img src="${PICTURES}${it.key}.jpg?v=${PICTURES_VERSION}" alt="" loading="eager">
          <i class="uc-pic-fallback" aria-hidden="true"></i>
        </figure>
        <small class="uc-tag">${it.tag}</small>
        <b class="uc-name">${it.name}</b>
        <p class="uc-text">${it.text}</p>
        ${it.how.length ? `<dl class="uc-how">${how(it.how)}</dl>` : ""}
      </article>`).join("");
    // No picture: the art in its colour instead.
    for (const img of this.items.querySelectorAll("img")) {
      img.addEventListener("error", () => img.closest(".uc-pic").classList.add("missing"), { once: true });
    }
    this.root.querySelector(".uc-pad-a").textContent = padLabel("PadA");
    this.root.classList.toggle("few", items.length <= 2);
    this.root.classList.toggle("many", items.length >= 4);
    this.root.classList.remove("show");
    void this.root.offsetWidth;
    this.root.classList.add("show");
    this.root.hidden = false;
    this.open = true;
    this.button.focus({ preventScroll: true });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    const done = this.done;
    this.done = null;
    done?.();
  }

  /** Taken away without carrying on (the run was left). */
  dismiss() {
    this.open = false;
    this.done = null;
    this.root.hidden = true;
  }
}
