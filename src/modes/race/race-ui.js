/**
 * The Race's screens (race.js), in the Arena's style (arena.css):
 *
 *   LOBBY    two players enter (A on a controller, Enter for keyboard and
 *            mouse); the course is chosen with the D-pad / LB RB (A D on
 *            the keyboard); START (Enter) - go.
 *   RACE     a half of the screen each: their box (place, distance, the gap
 *            to the other, health, spheres), the course's progress, their
 *            aiming ring (the right stick, or the mouse), "CATCH UP" when
 *            they fall back, and
 *            OUT when they're out.
 *   PAUSE    resume, restart, change course, the main menu.
 *   RESULTS  the winner, how they won, both runs side by side.
 */

import { B } from "../../systems/gamepads.js";
import { padLabel } from "../../systems/input-glyphs.js";
import { COURSES, COURSE_ORDER, RACE_TIERS, TIER_ORDER } from "./courses.js";
import { SKIN_TONES } from "../../figure/look.js";
import { HEADWEAR } from "../../figure/outfit.js";
import { LAUNCHER_SKINS } from "../../figure/launcher-skins.js";
import { BALLS } from "../../systems/arsenal.js";
// (A cycle with race.js: only read once the race is running.)
import { RACE_SPECIALS } from "./race.js";
import { SphereWheel } from "../../ui/sphere-wheel.js";

function ensureStylesheets() {
  for (const [name, attr] of [["../arena/arena.css", "arenaUi"], ["./race.css", "raceUi"]]) {
    if (document.querySelector(`link[data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(name, import.meta.url).href;
    link.dataset[attr] = "";
    document.head.appendChild(link);
  }
}

const el = (tag, className, parent, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  parent?.appendChild(node);
  return node;
};

const PAD_ICON = `<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M13 4h22c6 0 9 4 10.5 10l2 9c1 5-2.5 8-6 6l-6-5H12.5l-6 5c-3.5 2-7-1-6-6l2-9C4 8 7 4 13 4z" fill="currentColor"/><circle cx="14" cy="14" r="3.2" fill="#0b0f14"/><circle cx="34" cy="11" r="1.8" fill="#0b0f14"/><circle cx="38" cy="15" r="1.8" fill="#0b0f14"/><circle cx="30" cy="15" r="1.8" fill="#0b0f14"/><circle cx="34" cy="19" r="1.8" fill="#0b0f14"/></svg>`;
const KEYS_ICON = `<svg viewBox="0 0 48 32" aria-hidden="true"><rect x="1" y="7" width="34" height="20" rx="3" fill="currentColor"/><g fill="#0b0f14"><rect x="5" y="11" width="4" height="4" rx="1"/><rect x="11" y="11" width="4" height="4" rx="1"/><rect x="17" y="11" width="4" height="4" rx="1"/><rect x="23" y="11" width="4" height="4" rx="1"/><rect x="5" y="17" width="4" height="4" rx="1"/><rect x="11" y="17" width="14" height="4" rx="1"/><rect x="27" y="17" width="4" height="4" rx="1"/></g><rect x="38" y="5" width="9" height="15" rx="4.5" fill="currentColor"/></svg>`;
const deviceIcon = (p) => (p.input.type === "pad" ? PAD_ICON : KEYS_ICON);
const SLOT_COLOURS = ["#3aa0ff", "#ff4d5a", "#4ade80", "#ffd23f"];
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export class RaceUI {
  constructor(race) {
    ensureStylesheets();
    this.race = race;
    this.root = el("div", "ar-root rc-root", document.body);
    this.root.dataset.keepKeys = "";
    this.lobby = el("section", "ar-lobby rc-lobby", this.root);
    this.hud = el("div", "rc-hud", this.root);
    this.pauseEl = el("div", "ar-pause", this.root);
    this.resultsEl = el("section", "rc-results", this.root);
    this.bannerEl = el("div", "ar-banner rc-banner", this.root);
    this._halves = [];
    this._nav = new Map();
    this.menu = null;
    this.hideAll();
  }

  hideAll() {
    this.root.hidden = true;
    for (const part of [this.lobby, this.hud, this.pauseEl, this.resultsEl]) part.hidden = true;
  }

  _only(part) {
    this.root.hidden = false;
    for (const p of [this.lobby, this.hud, this.resultsEl]) p.hidden = p !== part;
    this.pauseEl.hidden = true;
  }

  _dir(key, rec, dt) {
    let dir = null;
    if (rec.buttons[B.UP] || rec.left.y < -0.55) dir = "up";
    else if (rec.buttons[B.DOWN] || rec.left.y > 0.55) dir = "down";
    else if (rec.buttons[B.LEFT] || rec.left.x < -0.55) dir = "left";
    else if (rec.buttons[B.RIGHT] || rec.left.x > 0.55) dir = "right";
    const nav = this._nav.get(key) ?? { dir: null, wait: 0 };
    this._nav.set(key, nav);
    if (!dir) { nav.dir = null; return null; }
    if (dir === nav.dir) {
      nav.wait -= dt;
      if (nav.wait > 0) return null;
      nav.wait = 0.16;
      return dir;
    }
    nav.dir = dir;
    nav.wait = 0.4;
    return dir;
  }

  /* ---- Lobby: four steps - in, the course, the difficulty, the look ---- */

  showLobby() {
    this.race.step = "join";
    this.showStep();
  }

  /** Draw the step the lobby is on. */
  showStep() {
    this._only(this.lobby);
    const step = this.race.step;
    this.lobby.classList.toggle("rc-dressing", step === "customise");
    if (step === "customise") this._drawCustomise();
    else this.refreshLobby();
  }

  _steps() {
    const names = [["join", "Players"], ["course", "Course"], ["difficulty", "Difficulty"], ["customise", "Look"]];
    const at = names.findIndex(([k]) => k === this.race.step);
    return `<ol class="rc-steps">${names.map(([k, label], i) => `<li class="${i < at ? "done" : i === at ? "on" : ""}"><em>${i + 1}</em>${label}</li>`).join("")}</ol>`;
  }

  refreshLobby() {
    const r = this.race;
    if (r.step === "customise") { this._drawCustomise(); return; }
    const A = padLabel("PadA");
    const Bn = padLabel("PadB");
    const n = r.players.length;
    let body = "";
    let foot = "";
    if (r.step === "join") {
      const slots = [];
      for (let i = 0; i < 2; i += 1) {
        const p = r.players[i];
        if (!p) {
          const waiting = [...r.pads.pads.values()].find((rec) => !r.players.some((x) => x.input.type === "pad" && x.input.index === rec.index));
          const kbFree = !r.players.some((x) => x.input.type === "keyboard");
          slots.push(`<article class="ar-slot empty${waiting ? " waiting" : ""}" style="--pc:${SLOT_COLOURS[i]}">
            <span class="ar-device">${waiting ? PAD_ICON : "<i>+</i>"}</span><b class="ar-slot-name">PLAYER ${i + 1}</b>
            <p>${waiting ? `${waiting.name}<br><span class="ar-press"><kbd>${A}</kbd> to enter</span>` : "Connect a controller<br>and press any button"}${kbFree ? `<br><span class="ar-or">or <kbd>Enter</kbd> keyboard</span>` : ""}</p></article>`);
          continue;
        }
        slots.push(`<article class="ar-slot in" style="--pc:${p.colour.hex}">
          <span class="ar-device on">${deviceIcon(p)}</span><b class="ar-slot-name">${p.name}</b><span class="ar-colour">${p.colour.name.toUpperCase()}</span>
          <small>${p.input.type === "pad" ? (r.pads.pads.get(p.input.index)?.name ?? "Controller") : "Keyboard"}</small>
          <p class="ar-in">IN</p><p class="ar-leave"><kbd>${p.input.type === "pad" ? Bn : "Backspace"}</kbd> leave</p></article>`);
      }
      body = `<div class="rc-slots">${slots.join('<span class="rc-vs">VS</span>')}</div>`;
      foot = `<span class="${n >= 2 ? "ready" : "dim"}">${n >= 2 ? `<kbd>${A}</kbd> / <kbd>Enter</kbd> NEXT: THE COURSE` : "Two players to go on"}</span>
        <span class="dim"><kbd>${Bn}</kbd> / <kbd>Esc</kbd> ${n ? "leave" : "back to the menu"}</span>`;
    } else if (r.step === "course") {
      body = `<div class="rc-courses big">${COURSE_ORDER.map((k) => {
        const c = COURSES[k];
        return `<article class="rc-course${k === r.courseKey ? " on" : ""}" data-course="${k}" style="--cc:${c.colour}"><small>${c.sector}</small><b>${c.title}</b><p>${c.blurb}</p><span class="rc-random">A NEW LAYOUT EVERY RACE</span></article>`;
      }).join("")}</div>`;
      foot = `<span><kbd>◀▶</kbd> choose</span><span class="ready"><kbd>${A}</kbd> / <kbd>Enter</kbd> NEXT: DIFFICULTY</span><span class="dim"><kbd>${Bn}</kbd> / <kbd>Esc</kbd> back</span>`;
    } else if (r.step === "difficulty") {
      const c = COURSES[r.courseKey];
      body = `<p class="rc-on" style="--cc:${c.colour}">${c.sector} // ${c.title}</p>
        <div class="rc-tiers">${TIER_ORDER.map((k) => {
          const t = RACE_TIERS[k];
          return `<article class="rc-tier${k === r.tierKey ? " on" : ""}" data-tier="${k}" data-level="${TIER_ORDER.indexOf(k)}"><em>${t.numeral}</em><b>${t.name}</b><p>${t.blurb}</p>
            <dl><dt>Pace</dt><dd>x${t.speed.toFixed(2)}</dd><dt>Obstacles</dt><dd>x${t.density.toFixed(2)}</dd><dt>Hits</dt><dd>x${t.damage.toFixed(2)}</dd><dt>Left behind at</dt><dd>${t.behind} m</dd></dl></article>`;
        }).join("")}</div>`;
      foot = `<span><kbd>◀▶</kbd> choose</span><span class="ready"><kbd>${A}</kbd> / <kbd>Enter</kbd> NEXT: YOUR LOOK</span><span class="dim"><kbd>${Bn}</kbd> / <kbd>Esc</kbd> back</span>`;
    }
    this.lobby.innerHTML = `
      <header class="ar-head"><p class="ar-eyebrow">SPLIT SCREEN // 2 PLAYERS</p><h1 class="ar-title">RACE<span>HEAD TO HEAD</span></h1></header>
      ${this._steps()}
      ${body}
      <footer class="ar-foot">${foot}</footer>`;
    for (const card of this.lobby.querySelectorAll("[data-course]")) card.onclick = () => { r.courseKey = card.dataset.course; this._next(); };
    for (const card of this.lobby.querySelectorAll("[data-tier]")) card.onclick = () => { r.tierKey = card.dataset.tier; this._next(); };
  }

  /** On to the next step (A / Enter). */
  _next() {
    const r = this.race;
    r.audio?.uiClick?.();
    if (r.step === "join") { if (r.players.length < 2) return; r.step = "course"; }
    else if (r.step === "course") r.step = "difficulty";
    else if (r.step === "difficulty") { r.toCustomise(); return; }
    this.showStep();
  }

  /** Back a step (B / Esc). */
  _back() {
    const r = this.race;
    r.audio?.uiClick?.();
    if (r.step === "course") r.step = "join";
    else if (r.step === "difficulty") r.step = "course";
    else if (r.step === "customise") r.step = "difficulty";
    this.showStep();
  }

  _lobbyInput(dt) {
    const r = this.race;
    if (r.step === "customise") { this._customiseInput(dt); return; }
    let changed = false;
    for (const rec of r.pads.pads.values()) {
      const p = r.players.find((x) => x.input.type === "pad" && x.input.index === rec.index);
      if (r.step === "join") {
        if (!p) {
          if (r.pads.pressed(rec, B.A)) { r.join({ type: "pad", index: rec.index }); changed = true; }
          else if (r.pads.pressed(rec, B.B) && !r.players.length) { r.onExit?.(); return; }
          continue;
        }
        if (r.pads.pressed(rec, B.B)) { r.leave(p); changed = true; continue; }
        if ((r.pads.pressed(rec, B.A) || r.pads.pressed(rec, B.START)) && r.players.length >= 2) { this._next(); return; }
        continue;
      }
      if (!p) continue;
      // The course and the difficulty: anyone in can choose.
      const dir = this._dir(`l${rec.index}`, rec, dt);
      const step = dir === "left" ? -1 : dir === "right" ? 1 : r.pads.pressed(rec, B.LB) ? -1 : r.pads.pressed(rec, B.RB) ? 1 : 0;
      if (step) { if (r.step === "course") r.cycleCourse(step); else r.cycleTier(step); changed = true; }
      if (r.pads.pressed(rec, B.A) || r.pads.pressed(rec, B.START)) { this._next(); return; }
      if (r.pads.pressed(rec, B.B)) { this._back(); return; }
    }
    if (changed) this.refreshLobby();
  }

  /* ---- The look: a panel under each player's figure in the studio ---- */

  _drawCustomise() {
    const r = this.race;
    const c = COURSES[r.courseKey];
    this.lobby.innerHTML = `
      <header class="rc-dress-head"><p class="ar-eyebrow">${c.sector} // ${c.title} // ${r.tier.name.toUpperCase()}</p><h2>YOUR LOOK</h2>
      ${this._steps()}</header>
      <div class="rc-panels">${r.players.map((p) => `<article class="ar-panel rc-panel" data-slot="${p.slot}" style="--pc:${p.colour.hex}"></article>`).join("")}</div>
      <footer class="ar-foot rc-dress-foot"><span><kbd>▲▼</kbd> pick</span><span><kbd>◀▶</kbd> change</span><span><kbd>${padLabel("PadA")}</kbd> / <kbd>Enter</kbd> next / ready</span><span class="dim"><kbd>${padLabel("PadB")}</kbd> / <kbd>Esc</kbd> back</span></footer>`;
    for (const p of r.players) this._drawPanel(p);
  }

  _rows(p) {
    if (p.page === "character") {
      return [
        ["character", "Character", p.character === "playerMale" ? "Male" : "Female"],
        ["skin", "Complexion", `<i class="ar-swatch" style="background:${SKIN_TONES[p.skin].swatch}"></i>${SKIN_TONES[p.skin].label}`],
        ["headwear", "Headwear", HEADWEAR[p.headwear].label],
      ];
    }
    return [
      ["launcher", "Carry the launcher", p.launcher ? "Yes - shots" : "No - throw by hand"],
      ["launcherSkin", "Finish", p.launcher ? `<i class="ar-swatch sq" style="background:${LAUNCHER_SKINS[p.launcherSkin].swatch}"></i>${LAUNCHER_SKINS[p.launcherSkin].label}` : "-"],
    ];
  }

  _drawPanel(p) {
    const panel = this.lobby.querySelector(`.rc-panel[data-slot="${p.slot}"]`);
    if (!panel) return;
    const rows = this._rows(p);
    p.row = Math.min(p.row, rows.length - 1);
    const A = p.input.type === "pad" ? padLabel("PadA") : "Enter";
    panel.classList.toggle("ready", p.ready);
    panel.innerHTML = `<span class="ar-device on">${deviceIcon(p)}</span>
      <header><b>${p.name}</b><span>${p.colour.name.toUpperCase()}</span></header>
      <nav class="rc-pages"><span class="${p.page === "character" ? "on" : ""}">Character</span><span class="${p.page === "launcher" ? "on" : ""}">Launcher</span></nav>
      ${rows.map(([, label, value], i) => `<div class="ar-row${i === p.row && !p.ready ? " on" : ""}"><span>${label}</span><em><i>◀</i>${value}<i>▶</i></em></div>`).join("")}
      <footer>${p.ready ? "READY" : `<kbd>${A}</kbd> ${p.page === "character" ? "next: launcher" : "ready"}`}</footer>`;
  }

  _customiseMove(p, dir) {
    if (!dir || p.ready) return;
    const rows = this._rows(p);
    if (dir === "up" || dir === "down") {
      p.row = (p.row + (dir === "down" ? 1 : rows.length - 1)) % rows.length;
      this.race.audio?.uiClick?.();
    } else {
      const key = rows[p.row][0];
      if (key === "launcherSkin" && !p.launcher) return;
      this.race.change(p, key, dir === "right" ? 1 : -1);
    }
    this._drawPanel(p);
  }

  /** A: on to the launcher page, then ready. B: back a page, or out of the look. */
  _customiseA(p) {
    if (p.ready) return;
    if (p.page === "character") { p.page = "launcher"; p.row = 0; this.race.audio?.uiClick?.(); this.race._studioFigures(); }
    else this.race.setReady(p, true);
    this._drawPanel(p);
  }

  _customiseB(p) {
    if (p.ready) this.race.setReady(p, false);
    else if (p.page === "launcher") { p.page = "character"; p.row = 0; this.race._studioFigures(); }
    else { this._back(); return; }
    this._drawPanel(p);
  }

  _customiseInput(dt) {
    const r = this.race;
    for (const p of r.players) {
      if (p.input.type !== "pad") continue;
      const rec = r.pads.pads.get(p.input.index);
      if (!rec) continue;
      if (r.pads.pressed(rec, B.A)) { this._customiseA(p); continue; }
      if (r.pads.pressed(rec, B.B)) { this._customiseB(p); if (r.step !== "customise") return; continue; }
      this._customiseMove(p, this._dir(`c${p.slot}`, rec, dt));
    }
  }

  /** Each panel beside its figure: the left one's to its left, the right one's to its right. */
  _placePanels() {
    const r = this.race;
    if (!r.studio) return;
    for (const p of r.players) {
      const panel = this.lobby.querySelector(`.rc-panel[data-slot="${p.slot}"]`);
      if (!panel) continue;
      const s = r.studio.screenOf(p.slot, 1.05);
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const left = s.x < innerWidth / 2 ? s.x - 150 - w : s.x + 150;
      panel.style.left = `${Math.max(16, Math.min(innerWidth - w - 16, left))}px`;
      panel.style.top = `${Math.max(150, Math.min(innerHeight - h - 70, s.y - h / 2))}px`;
    }
  }

  /* ---- Race ---- */

  showRace() {
    this._only(this.hud);
    this.hud.innerHTML = `<div class="rc-divider"></div>`;
    this._halves = this.race.players.map((p, i) => {
      const half = el("div", `rc-half ${i ? "right" : "left"}`, this.hud);
      half.style.setProperty("--pc", p.colour.hex);
      half.innerHTML = `
        <article class="rc-box"><span class="ar-device on">${deviceIcon(p)}</span>
          <header><b>${p.name}</b><em class="rc-place"></em></header>
          <strong class="rc-dist"></strong><small class="rc-gap"></small>
          <div class="ar-meter hp"><span></span><em></em></div>
        </article>
        <div class="rc-progress"><span></span><i></i></div>
        <div class="rc-warn"></div>
        <div class="rc-out"></div>
        <strong class="rc-flash"></strong>
        <i class="rc-reticle"></i>`;
      const q = (s) => half.querySelector(s);
      // The story's sphere wheel (src/ui/sphere-wheel.js), in this half, with
      // this player's own keys on it (the game-wide renaming leaves it be).
      const wheel = new SphereWheel({ container: half });
      wheel.root.dataset.keepKeys = "";
      wheel.root.querySelector(".sw-q").textContent = p.input.type === "pad" ? padLabel("PadLB") : "Q";
      wheel.root.querySelector(".sw-e").textContent = p.input.type === "pad" ? padLabel("PadRB") : "E";
      return { half, wheel, place: q(".rc-place"), dist: q(".rc-dist"), gap: q(".rc-gap"), hp: q(".hp span"), hpText: q(".hp em"), progress: q(".rc-progress span"), rival: q(".rc-progress i"), warn: q(".rc-warn"), out: q(".rc-out"), flash: q(".rc-flash"), reticle: q(".rc-reticle"), box: q(".rc-box") };
    });
  }

  banner(text, sub = "") {
    this.bannerEl.innerHTML = `<b>${text}</b>${sub ? `<small>${sub}</small>` : ""}`;
    this.bannerEl.classList.remove("show");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("show");
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.bannerEl.classList.remove("show"), 900);
  }

  hurt(p, label) {
    const h = this._halves[this.race.players.indexOf(p)];
    if (!h) return;
    h.half.classList.remove("hurt");
    void h.half.offsetWidth;
    h.half.classList.add("hurt");
    this.flash(p, label);
  }

  flash(p, text) {
    const h = this._halves[this.race.players.indexOf(p)];
    if (!h) return;
    h.flash.textContent = text;
    h.flash.classList.remove("show");
    void h.flash.offsetWidth;
    h.flash.classList.add("show");
  }

  out(p, why) {
    const h = this._halves[this.race.players.indexOf(p)];
    if (!h) return;
    h.out.innerHTML = `<b>${why}</b><span>${Math.floor(p.distance)} m</span>`;
    h.half.classList.add("is-out");
  }

  _updateRace() {
    const r = this.race;
    r.players.forEach((p, i) => {
      const h = this._halves[i];
      if (!h || !p.pos) return;
      const { place, gap } = r.standing(p);
      h.place.textContent = place === 1 ? "1ST" : "2ND";
      h.place.classList.toggle("first", place === 1);
      h.dist.textContent = `${Math.floor(p.distance)} m`;
      h.gap.textContent = gap >= 0 ? `+${gap.toFixed(1)} m ahead` : `${gap.toFixed(1)} m behind`;
      h.hp.style.width = `${p.hp}%`;
      h.hp.classList.toggle("low", p.hp < 35);
      h.hpText.textContent = `${Math.ceil(p.hp)}`;
      // A special sphere shows what's left of its stock for the race; one used up, dimmed.
      const stock = p.specials?.[p.ball];
      const left = new Set(["glass", ...Object.keys(p.specials ?? {}).filter((k) => p.specials[k] > 0)]);
      if (stock === undefined) h.wheel.update({ ball: p.ball, spheres: p.ammo, cost: BALLS[p.ball].cost, visible: !p.out, allowed: left });
      else h.wheel.update({ ball: p.ball, spheres: stock, cost: 1, visible: !p.out, allowed: left, note: `${stock} OF ${RACE_SPECIALS[p.ball]} LEFT` });
      const finite = Number.isFinite(r.course.finish);
      h.progress.parentElement.hidden = !finite;
      if (finite) {
        const span = r.course.finish - r.course.start;
        h.progress.style.width = `${Math.min(100, ((p.distance - r.course.start) / span) * 100)}%`;
        const other = r.players.find((q) => q !== p);
        h.rival.style.left = `${Math.min(100, ((other.distance - r.course.start) / span) * 100)}%`;
        h.rival.style.setProperty("--rc", other.colour.hex);
      }
      const limit = r.tier.behind;
      const behind = !p.out && p.behind > limit * 0.62;
      h.warn.classList.toggle("show", behind);
      if (behind) h.warn.innerHTML = `CATCH UP<span>${Math.ceil(limit - p.behind)} m</span>`;
    });
  }

  /** Each runner's aiming ring (after the frame is drawn). */
  place() {
    const r = this.race;
    if (r.state === "lobby" && r.step === "customise") { this._placePanels(); return; }
    if (r.state !== "racing" && r.state !== "countdown") return;
    // Each runner's ring, in their own half (their half clips it: it never crosses over).
    r.players.forEach((p, i) => {
      const h = this._halves[i];
      if (!h) return;
      const show = !p.out && !p.finished && p.aim;
      h.reticle.classList.toggle("show", Boolean(show));
      if (!show) return;
      // Over something a sphere can break: the ring fills (no pull - just so you know).
      h.reticle.classList.toggle("on", Boolean(p.aimOn));
      const x = (p.aim.x * 0.5 + 0.5) * h.half.clientWidth;
      const y = (-p.aim.y * 0.5 + 0.5) * h.half.clientHeight;
      h.reticle.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    });
  }

  /* ---- Pause, results ---- */

  _setMenu(container, items, horizontal = false) {
    this.menu = { container, items, index: 0, horizontal };
    this._drawMenu();
  }

  _drawMenu() {
    const m = this.menu;
    if (!m) return;
    const list = m.container.querySelector(".ar-menu");
    list.classList.toggle("row", m.horizontal);
    list.innerHTML = m.items.map((it, i) => `<button type="button" class="${i === m.index ? "on" : ""}" data-i="${i}">${it.label}</button>`).join("");
    for (const b of list.querySelectorAll("button")) b.onclick = () => { m.index = Number(b.dataset.i); this._choose(); };
  }

  _menuMove(dir) {
    const m = this.menu;
    if (!m || !dir) return;
    const next = m.horizontal ? "right" : "down";
    const back = m.horizontal ? "left" : "up";
    if (dir !== next && dir !== back) return;
    m.index = (m.index + (dir === next ? 1 : m.items.length - 1)) % m.items.length;
    this.race.audio?.uiClick?.();
    this._drawMenu();
  }

  _choose() {
    const it = this.menu?.items[this.menu.index];
    if (!it) return;
    this.race.audio?.uiClick?.();
    it.action();
  }

  _menuInput(dt, onBack) {
    for (const p of this.race.players) {
      if (p.input.type !== "pad") continue;
      const rec = this.race.pads.pads.get(p.input.index);
      if (!rec) continue;
      if (this.race.pads.pressed(rec, B.A)) { this._choose(); return; }
      if (this.race.pads.pressed(rec, B.B)) { onBack?.(); return; }
      this._menuMove(this._dir(`m${rec.index}`, rec, dt));
    }
  }

  showPause(on) {
    this.pauseEl.hidden = !on;
    if (!on) { this.menu = null; return; }
    const r = this.race;
    this.pauseEl.innerHTML = `<div class="ar-sheet"><p class="ar-eyebrow">${r.courseTitle()} // PAUSED</p><h2>PAUSED</h2>
      <div class="ar-standings">${r.players.map((p) => `<span style="--pc:${p.colour.hex}"><b>${p.name}</b>${Math.floor(p.distance)} m</span>`).join("")}</div>
      <div class="ar-menu"></div><p class="dim"><kbd>${padLabel("PadA")}</kbd> / <kbd>Enter</kbd> choose &nbsp; <kbd>${padLabel("PadB")}</kbd> / <kbd>Esc</kbd> resume</p></div>`;
    this._setMenu(this.pauseEl, [
      { label: "Resume", action: () => r.pause(false) },
      { label: "Restart the race", action: () => { this.pauseEl.hidden = true; r.start(); } },
      { label: "Change course", action: () => { this.pauseEl.hidden = true; r.toLobby(); } },
      { label: "Quit to the main menu", action: () => r.onExit?.() },
    ]);
  }

  showResults(winner, how) {
    const r = this.race;
    this._only(this.resultsEl);
    const card = (p) => `<article class="rc-card${p === winner ? " won" : ""}" style="--pc:${p.colour.hex}">
      <span class="ar-device on">${deviceIcon(p)}</span><header><b>${p.name}</b><em>${p === winner ? "WINNER" : p.out ?? "BEATEN"}</em></header>
      <strong>${Math.floor(p.distance)} m</strong>
      <dl><dt>Time</dt><dd>${mmss(p.time)}</dd><dt>Hits taken</dt><dd>${p.stats.hits}</dd><dt>Spheres thrown</dt><dd>${p.stats.thrown}</dd><dt>Targets broken</dt><dd>${p.stats.broken}</dd><dt>Wins</dt><dd>${p.wins}</dd></dl></article>`;
    this.resultsEl.innerHTML = `<header class="rc-results-head"><p class="ar-eyebrow">${r.courseTitle()} // ${how}</p>
      <h1 class="ar-winner" style="--pc:${winner.colour.hex}">${winner.name} WINS</h1></header>
      <div class="rc-cards">${r.players.map(card).join("")}</div>
      <footer class="rc-results-foot"><div class="ar-menu"></div></footer>`;
    this._setMenu(this.resultsEl, [
      { label: "Rematch", action: () => r.start() },
      { label: "Change course", action: () => r.toLobby() },
      { label: "Main menu", action: () => r.onExit?.() },
    ], true);
  }

  /* ---- The keyboard player ---- */

  onKey(e) {
    if (e.repeat) return;
    const r = this.race;
    const kb = r.players.find((x) => x.input.type === "keyboard");
    if (r.state === "lobby") {
      const dir = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" }[e.code];
      if (r.step === "join") {
        if (e.code === "Enter") {
          if (!kb) { r.join({ type: "keyboard" }); this.refreshLobby(); }
          else this._next();
        } else if (e.code === "Escape" || e.code === "Backspace") {
          if (kb) { r.leave(kb); this.refreshLobby(); }
          else if (!r.players.length) r.onExit?.();
        }
      } else if (r.step === "course" || r.step === "difficulty") {
        if (e.code === "Enter") this._next();
        else if (e.code === "Escape" || e.code === "Backspace") this._back();
        else if (dir === "left" || dir === "right") {
          if (r.step === "course") r.cycleCourse(dir === "right" ? 1 : -1);
          else r.cycleTier(dir === "right" ? 1 : -1);
          this.refreshLobby();
        }
      } else if (r.step === "customise" && kb) {
        if (e.code === "Enter") this._customiseA(kb);
        else if (e.code === "Escape" || e.code === "Backspace") this._customiseB(kb);
        else if (dir) this._customiseMove(kb, dir);
      }
    } else if (r.state === "paused" || r.state === "results") {
      const dir = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.code];
      if (e.code === "Enter") this._choose();
      else if (dir) this._menuMove(dir);
      else if (r.state === "results" && (e.code === "Escape" || e.code === "Backspace")) r.toLobby();
    }
  }

  update(dt) {
    const r = this.race;
    if (r.state === "lobby") { this._lobbyInput(dt); return; }
    if (r.state === "paused") { this._menuInput(dt, () => r.pause(false)); return; }
    if (r.state === "results") { this._menuInput(dt, () => r.toLobby()); return; }
    if (r.state === "racing" || r.state === "countdown") this._updateRace();
  }
}
