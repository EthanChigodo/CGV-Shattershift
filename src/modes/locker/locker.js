/**
 * Customise (single player): Subject 07 in the studio, two screens -
 *   CHARACTER  who you play as, skin, the scrubs' colour, headwear
 *   LAUNCHER   the launcher's finish (tiger, camo, carbon...), the sphere you start with
 * Every change shows on the figure at once and is kept for every
 * single-player game (the story, the chapters, Endless).
 *
 *   const locker = new Locker({ renderer, pads, assetBase, audio, look, apply, onExit });
 *   await locker.open("character");
 *   // every frame: locker.update(dt); locker.render();
 *
 * `look()` returns the saved choices; `apply(patch)` saves one and puts it
 * on the game's own figure and launchers.
 *
 * Controls: a controller (D-pad / stick: rows and choices, LB / RB the two
 * screens, B back), the keyboard (arrows, Q / E, Esc) or the mouse.
 */

import { Studio } from "../common/studio.js";
import { loadMeltdownAssets } from "../../levels/meltdown/assets.js";
import { B } from "../../systems/gamepads.js";
import { padLabel } from "../../systems/input-glyphs.js";
import { SKIN_TONES } from "../../figure/look.js";
import { OUTFITS, HEADWEAR } from "../../figure/outfit.js";
import { LAUNCHER_SKINS, LAUNCHER_SKIN_ORDER } from "../../figure/launcher-skins.js";
import { KITS, kitLocked } from "../../figure/kits.js";
import { BALLS, BALL_ORDER } from "../../systems/arsenal.js";

function ensureStylesheets() {
  for (const [href, attr] of [["../arena/arena.css", "arena-ui"], ["./locker.css", "locker-ui"]]) {
    if (document.querySelector(`link[data-${attr}]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(href, import.meta.url).href;
    link.setAttribute(`data-${attr}`, "");
    document.head.appendChild(link);
  }
}

const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;
const LOCK_ICON = `<span class="lk-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg></span>`;

/** The rows on each screen: [key, label, options [{value, label, swatch}]]. */
function rows(tab) {
  if (tab === "character") {
    return [
      ["character", "Play as", [{ value: "playerFemale", label: "Female" }, { value: "playerMale", label: "Male" }]],
      ["skin", "Complexion", Object.entries(SKIN_TONES).map(([value, t]) => ({ value, label: t.label, swatch: t.swatch }))],
      ["outfit", "Outfit", Object.entries(OUTFITS).map(([value, o]) => ({ value, label: o.label, swatch: o.swatch, kit: o.kit, locked: kitLocked(o) }))],
      ["headwear", "Headwear", Object.entries(HEADWEAR).map(([value, h]) => ({ value, label: h.label, kit: h.kit, locked: kitLocked(h) }))],
    ];
  }
  return [
    ["launcherSkin", "Finish", LAUNCHER_SKIN_ORDER.map((value) => ({ value, label: LAUNCHER_SKINS[value].label, swatch: LAUNCHER_SKINS[value].swatch, tile: true, kit: LAUNCHER_SKINS[value].kit, locked: kitLocked(LAUNCHER_SKINS[value]) }))],
    ["ball", "Starting sphere", BALL_ORDER.map((value) => ({ value, label: BALLS[value].name, swatch: hex(BALLS[value].colour), orb: true }))],
  ];
}

export class Locker {
  constructor({ renderer, pads, assetBase, audio = null, look, apply, onExit }) {
    ensureStylesheets();
    this.renderer = renderer;
    this.pads = pads;
    this.assetBase = assetBase;
    this.audio = audio;
    this.look = look;
    this.apply = apply;
    this.onExit = onExit;
    this.state = "closed";
    this.tab = "character";
    this.row = 0;
    this.root = document.createElement("section");
    this.root.className = "ar-root lk-root";
    this.root.dataset.keepKeys = "";
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this._onKey = (e) => this._key(e);
    this._nav = { dir: null, wait: 0 };
  }

  get active() {
    return this.state !== "closed";
  }

  async open(tab = "character") {
    this.assets ??= await loadMeltdownAssets(this.assetBase, { names: ["playerFemale", "playerMale", "launcher"] });
    this.studio ??= new Studio(this.renderer, this.assets);
    this.state = "open";
    this.tab = tab;
    this.row = 0;
    this.root.hidden = false;
    addEventListener("keydown", this._onKey, true);
    this._figure();
    this._draw();
  }

  close() {
    this.state = "closed";
    this.root.hidden = true;
    removeEventListener("keydown", this._onKey, true);
  }

  /** The figure, as the saved choices have it; the launcher on its shoulder on the Launcher screen. */
  _figure() {
    const l = this.look();
    this.studio.setFigures([{ id: "me", character: l.character, skin: l.skin, outfit: l.outfit, headwear: l.headwear, launcher: this.tab === "launcher", launcherSkin: l.launcherSkin, colour: "#7ef4f1" }]);
    this.studio.frame(this.tab === "launcher" ? "launcher" : "body", { offsetX: 1.15, spin: false });
  }

  _set(key, value) {
    this.apply({ [key]: value });
    this.audio?.uiClick?.();
    this._figure();
    this._draw();
  }

  _draw() {
    const l = this.look();
    const list = rows(this.tab);
    this.row = Math.min(this.row, list.length - 1);
    const A = padLabel("PadA");
    this.root.innerHTML = `
      <aside class="lk-panel">
        <p class="ar-eyebrow">SINGLE PLAYER // SUBJECT 07</p>
        <h2>CUSTOMISE</h2>
        <nav class="lk-tabs">
          <kbd>${padLabel("PadLB")}</kbd>
          <button type="button" data-tab="character" class="${this.tab === "character" ? "on" : ""}">Character</button>
          <button type="button" data-tab="launcher" class="${this.tab === "launcher" ? "on" : ""}">Launcher</button>
          <kbd>${padLabel("PadRB")}</kbd>
        </nav>
        ${list.map(([key, label, options], r) => `
          <section class="lk-row${r === this.row ? " on" : ""}" data-row="${r}">
            <header><span>${label}</span><b>${options.find((o) => o.value === l[key])?.label ?? ""}</b></header>
            <div class="lk-options${options[0].tile ? " tiles" : ""}">
              ${options.map((o) => `<button type="button" class="lk-opt${o.value === l[key] ? " picked" : ""}${o.swatch ? " sw" : ""}${o.tile ? " tile" : ""}${o.orb ? " orb" : ""}${o.kit ? " kit" : ""}${o.locked ? " locked" : ""}" data-key="${key}" data-value="${o.value}" ${o.locked ? "aria-disabled=\"true\"" : ""} title="${o.locked ? `${o.label} - ${KITS[o.kit].how} to unlock (${KITS[o.kit].name})` : o.label}" style="${o.swatch ? `--sw:${o.swatch}` : ""}${o.kit ? `;--kc:${KITS[o.kit].colour}` : ""}">${o.swatch ? `<i></i>${o.tile ? `<small>${o.label}</small>` : ""}` : o.label}${o.locked ? LOCK_ICON : ""}</button>`).join("")}
            </div>
          </section>`).join("")}
        <p class="lk-note">${this.tab === "launcher" ? "The finish on your launcher in the Labs, the Skyline and on the roof. The sphere you start each run with." : "Who you are in every single-player run - the story, the chapters and Endless."}</p>
        <footer class="lk-foot"><span><kbd>▲▼</kbd> pick</span><span><kbd>◀▶</kbd> change</span><span><kbd>${padLabel("PadB")}</kbd> / <kbd>Esc</kbd> done</span></footer>
        <button type="button" class="lk-done">Done</button>
      </aside>`;
    for (const b of this.root.querySelectorAll("[data-tab]")) b.onclick = () => this._tab(b.dataset.tab);
    for (const b of this.root.querySelectorAll(".lk-opt")) b.onclick = () => {
      if (b.classList.contains("locked")) { this._lockedNote(b); return; }
      this._set(b.dataset.key, b.dataset.value);
    };
    for (const s of this.root.querySelectorAll(".lk-row")) s.onmouseenter = () => { this.row = Number(s.dataset.row); this._mark(); };
    this.root.querySelector(".lk-done").onclick = () => this.onExit?.();
    void A;
  }

  /** A locked piece: what unlocks it, for a moment. */
  _lockedNote(b) {
    const note = this.root.querySelector(".lk-note");
    if (note) note.innerHTML = `<b class="lk-locked-note">${b.title}</b>`;
    this.audio?.uiClick?.();
  }

  _mark() {
    for (const s of this.root.querySelectorAll(".lk-row")) s.classList.toggle("on", Number(s.dataset.row) === this.row);
  }

  _tab(tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this.row = 0;
    this.audio?.uiClick?.();
    this._figure();
    this._draw();
  }

  /** Left / right on the row in focus: the next or previous choice. */
  _step(dir) {
    const [key, , options] = rows(this.tab)[this.row];
    const l = this.look();
    // (Past the locked ones.)
    const open = options.filter((o) => !o.locked);
    const i = Math.max(0, open.findIndex((o) => o.value === l[key]));
    this._set(key, open[(i + dir + open.length) % open.length].value);
  }

  _move(dir) {
    const n = rows(this.tab).length;
    if (dir === "up" || dir === "down") {
      this.row = (this.row + (dir === "down" ? 1 : n - 1)) % n;
      this.audio?.uiClick?.();
      this._mark();
    } else this._step(dir === "right" ? 1 : -1);
  }

  _key(e) {
    if (!e.isTrusted) return;
    e.stopImmediatePropagation();
    if (e.repeat && !e.code.startsWith("Arrow")) return;
    const dir = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" }[e.code];
    if (dir) { e.preventDefault(); this._move(dir); }
    else if (e.code === "KeyQ" || e.code === "KeyE" || e.code === "Tab") { e.preventDefault(); this._tab(this.tab === "character" ? "launcher" : "character"); }
    else if (e.code === "Escape" || e.code === "Backspace" || e.code === "Enter") this.onExit?.();
  }

  update(dt) {
    this.studio?.update(dt);
    // Any controller drives it.
    for (const rec of this.pads.pads.values()) {
      if (this.pads.pressed(rec, B.B) || this.pads.pressed(rec, B.START)) { this.onExit?.(); return; }
      if (this.pads.pressed(rec, B.LB) || this.pads.pressed(rec, B.RB)) this._tab(this.tab === "character" ? "launcher" : "character");
      // The right stick turns the figure.
      if (rec.right.m > 0.2) this.studio.turn(rec.right.x * dt * 3);
      let dir = null;
      if (rec.buttons[B.UP] || rec.left.y < -0.55) dir = "up";
      else if (rec.buttons[B.DOWN] || rec.left.y > 0.55) dir = "down";
      else if (rec.buttons[B.LEFT] || rec.left.x < -0.55) dir = "left";
      else if (rec.buttons[B.RIGHT] || rec.left.x > 0.55) dir = "right";
      if (!dir) { if (rec.index === this._navPad) this._nav.dir = null; continue; }
      this._navPad = rec.index;
      if (dir === this._nav.dir) {
        this._nav.wait -= dt;
        if (this._nav.wait > 0) continue;
        this._nav.wait = 0.16;
      } else {
        this._nav.dir = dir;
        this._nav.wait = 0.4;
      }
      this._move(dir);
    }
  }

  render() {
    this.studio?.render();
  }
}
