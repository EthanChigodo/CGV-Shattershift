/**
 * The Arena's screens (arena.js):
 *
 *   LOBBY       players enter: A (✕) on a controller, Enter for one keyboard
 *               and mouse; each box shows what they play with. LB / RB (or
 *               [ ]) the target; START (or Enter) on to the line-up.
 *   CUSTOMISE   a panel under each player's avatar on the helipad, two pages:
 *               the character (character, complexion, headwear), then the
 *               launcher (carry it or throw by hand; its finish). Up / down a
 *               row, left / right change it, A (Enter) on a page / ready,
 *               B back a page. Everyone ready: the match.
 *   MATCH       a box in each player's corner - health, pad time, spheres,
 *               the sphere in hand, a serum's time; a tag and a health bar
 *               over each head; the clock, and the last ten seconds counted
 *               down in the middle of the screen.
 *   PAUSE       resume, restart, change characters, the lobby, the menu.
 *   RESULTS     the podium, a panel under each player, and what next.
 */

import { B } from "../../systems/gamepads.js";
import { PODIUM_FRONT, ARENA_COST, TEAMS, MODE_TARGETS } from "./arena.js";
import { padLabel } from "../../systems/input-glyphs.js";
import { BALLS, SERUMS } from "../../systems/arsenal.js";
import { SKIN_TONES } from "../../figure/look.js";
import { HEADWEAR } from "../../figure/outfit.js";
import { LAUNCHER_SKINS } from "../../figure/launcher-skins.js";

/**
 * The awards' icons, on a 24 x 24 grid, drawn in strokes (fills where a
 * shape needs one) - each sits in the middle of a medal (medal() below).
 */
const AWARD_ICONS = {
  // Crossed swords.
  kos: `<path d="M5 5l10 10M19 5L9 15"/><path d="M13 17l4-4M7 13l4 4"/><path d="M15 15l4.5 4.5M9 15l-4.5 4.5"/>`,
  // A crosshair on a dot.
  sharp: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" class="f"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/>`,
  // Spheres in flight, with speed lines.
  trigger: `<circle cx="16.5" cy="7.5" r="3"/><circle cx="11" cy="14.5" r="3"/><circle cx="18" cy="17.5" r="2.4"/><path d="M2.5 6h7M1.5 13h5M4.5 19.5h5"/>`,
  // An impact burst.
  heavy: `<path d="M12 1.8l2.5 6.4 6.8-1.3-4.7 5.1 4.7 5.1-6.8-1.3L12 22.2l-2.5-6.4-6.8 1.3 4.7-5.1-4.7-5.1 6.8 1.3z"/><circle cx="12" cy="12" r="2" class="f"/>`,
  // The ledge, and an arrow over it, down.
  ledge: `<path d="M1.5 9.5h9v13"/><path d="M6.5 5.5c6.5-1.5 11.5 1.5 12.5 9"/><path d="M15.5 12l3.5 3.5 3.5-4"/>`,
  // A heart with a pulse through it.
  survivor: `<path d="M12 21s-8.5-5.4-8.5-11.4A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.5 2.9C20.5 15.6 12 21 12 21z"/><path d="M5.5 12.5h3l1.6-3.2 2.2 6.2 1.6-3h4.6"/>`,
  // A snowflake.
  ice: `<path d="M12 1.5v21M2.9 6.7l18.2 10.6M2.9 17.3L21.1 6.7"/><path d="M9.3 3.4L12 6l2.7-2.6M9.3 20.6L12 18l2.7 2.6M4 10.2l3.6 1-1 3.5M20 13.8l-3.6-1 1-3.5M4.6 15.6l3.5-1.1 1 3.6M19.4 8.4l-3.5 1.1-1-3.6"/>`,
  // A care package under its canopy.
  scavenger: `<path d="M4 9.5a8 8 0 0 1 16 0z"/><path d="M4.5 9.5l4.5 6M19.5 9.5l-4.5 6M12 9.5v6"/><rect x="7.5" y="15.5" width="9" height="6.5" rx="1"/><path d="M7.5 18.5h9"/>`,
  // A shield with a tick.
  untouchable: `<path d="M12 1.8l8.5 3.2v6.2c0 5.4-3.7 9.4-8.5 11.3-4.8-1.9-8.5-5.9-8.5-11.3V5z"/><path d="M8 12.2l2.8 2.8 5.2-5.6"/>`,
};

/** A medal: a ribbon in the winner's colour, a gold disc, the award's icon in the middle. */
function medal(icon, colour, id) {
  return `<svg class="ar-medal" viewBox="0 0 64 74" aria-hidden="true">
    <defs>
      <radialGradient id="mg${id}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#f2be3a"/><stop offset="1" stop-color="#8f6312"/></radialGradient>
      <linearGradient id="mr${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${colour}"/><stop offset="1" stop-color="${colour}" stop-opacity=".55"/></linearGradient>
    </defs>
    <path d="M17 0h12l8 27-11 4z" fill="url(#mr${id})"/>
    <path d="M47 0H35l-8 27 11 4z" fill="url(#mr${id})" opacity=".8"/>
    <path d="M22 0h3M39 0h3" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
    <circle cx="32" cy="48" r="21" fill="url(#mg${id})"/>
    <circle cx="32" cy="48" r="21" fill="none" stroke="#5a3d06" stroke-opacity=".5" stroke-width="1"/>
    <circle cx="32" cy="48" r="16" fill="#131a23" stroke="#ffe39a" stroke-width="1.4"/>
    <path d="M18.5 38a17 17 0 0 1 12-7" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/>
    <g transform="translate(20.5 36.5) scale(.96)" fill="none" stroke="#ffe39a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${AWARD_ICONS[icon] ?? ""}</g>
  </svg>`;
}

function ensureStylesheet() {
  if (document.querySelector("link[data-arena-ui]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./arena.css", import.meta.url).href;
  link.dataset.arenaUi = "";
  document.head.appendChild(link);
}

const el = (tag, className, parent, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  parent?.appendChild(node);
  return node;
};

const PAD_ICON = `<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M13 4h22c6 0 9 4 10.5 10l2 9c1 5-2.5 8-6 6l-6-5H12.5l-6 5c-3.5 2-7-1-6-6l2-9C4 8 7 4 13 4z" fill="currentColor"/><circle cx="14" cy="14" r="3.2" fill="#0b0f14"/><circle cx="34" cy="11" r="1.8" fill="#0b0f14"/><circle cx="38" cy="15" r="1.8" fill="#0b0f14"/><circle cx="30" cy="15" r="1.8" fill="#0b0f14"/><circle cx="34" cy="19" r="1.8" fill="#0b0f14"/></svg>`;
const KEYS_ICON = `<svg viewBox="0 0 48 32" aria-hidden="true"><rect x="1" y="7" width="34" height="20" rx="3" fill="currentColor"/><g fill="#0b0f14"><rect x="5" y="11" width="4" height="4" rx="1"/><rect x="11" y="11" width="4" height="4" rx="1"/><rect x="17" y="11" width="4" height="4" rx="1"/><rect x="23" y="11" width="4" height="4" rx="1"/><rect x="5" y="17" width="4" height="4" rx="1"/><rect x="11" y="17" width="14" height="4" rx="1"/><rect x="27" y="17" width="4" height="4" rx="1"/></g><rect x="38" y="5" width="9" height="15" rx="4.5" fill="currentColor"/><line x1="42.5" y1="5" x2="42.5" y2="11" stroke="#0b0f14" stroke-width="1.2"/></svg>`;
const deviceIcon = (p) => (p.input.type === "pad" ? PAD_ICON : KEYS_ICON);
const CHARACTER_NAMES = { playerFemale: "Female", playerMale: "Male" };
const PAGES = { character: ["character", "skin", "headwear"], launcher: ["launcher", "launcherSkin"] };
const ROW_NAMES = { character: "Character", skin: "Complexion", headwear: "Headwear", launcher: "Carry the launcher", launcherSkin: "Finish" };
const SLOT_COLOURS = ["#3aa0ff", "#ff4d5a", "#4ade80", "#ffd23f"];
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ordinal = (n) => ["1ST", "2ND", "3RD", "4TH"][n] ?? `${n + 1}TH`;

export class ArenaUI {
  constructor(arena) {
    ensureStylesheet();
    this.arena = arena;
    this.root = el("div", "ar-root", document.body);
    this.root.hidden = true;
    // Its key caps are already the right names (src/ui/key-names.js leaves them).
    this.root.dataset.keepKeys = "";

    // ---- Lobby ----
    this.lobby = el("section", "ar-lobby", this.root);
    const head = el("header", "ar-head", this.lobby);
    el("p", "ar-eyebrow", head, "ASCENSION TOWER // THE ROOF // 2 - 4 PLAYERS");
    this.lobbyTitle = el("h1", "ar-title", head, "");
    this.lobbyRules = el("p", "ar-rules", head, "");
    this.slots = el("div", "ar-slots", this.lobby);
    this.lobbyFoot = el("footer", "ar-foot", this.lobby);

    // ---- Customise ----
    this.custom = el("section", "ar-custom", this.root);
    this.customHead = el("header", "ar-custom-head", this.custom);
    this.panels = el("div", "ar-panels", this.custom);

    // ---- Match ----
    this.hud = el("div", "ar-hud", this.root);
    this.top = el("div", "ar-top", this.hud);
    this.clockEl = el("b", "ar-clock", this.top);
    this.statusEl = el("small", "ar-target", this.top);
    this.feedEl = el("div", "ar-feed", this.hud);
    this.boxes = el("div", "ar-boxes", this.hud);
    this.tags = el("div", "ar-tags", this.hud);
    this.bannerEl = el("div", "ar-banner", this.hud);
    this.tickEl = el("div", "ar-tick", this.hud);

    // ---- Pause, results ----
    this.pauseEl = el("div", "ar-pause", this.root);
    this.resultsEl = el("section", "ar-results", this.root);

    this._boxEls = new Map();
    this._tagEls = new Map();
    this._panelEls = new Map();
    this._nav = new Map();
    this._bannerT = 0;
    this.menu = null;
    this.hideAll();
  }

  hideAll() {
    this.root.hidden = true;
    for (const part of [this.lobby, this.custom, this.hud, this.pauseEl, this.resultsEl]) part.hidden = true;
  }

  _only(part) {
    this.root.hidden = false;
    for (const p of [this.lobby, this.custom, this.hud, this.resultsEl]) p.hidden = p !== part;
    this.pauseEl.hidden = true;
  }

  /* ================================================================ */
  /* Input helpers                                                    */
  /* ================================================================ */

  /** A direction from a controller (D-pad or left stick), with repeat while held. */
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
      nav.wait = 0.14;
      return dir;
    }
    nav.dir = dir;
    nav.wait = 0.4;
    return dir;
  }

  /** The controllers of the players in the game (pause and results take anyone's). */
  _playerPads() {
    return this.arena.players.filter((p) => p.input.type === "pad").map((p) => this.arena.pads.pads.get(p.input.index)).filter(Boolean);
  }

  /* ================================================================ */
  /* Lobby                                                            */
  /* ================================================================ */

  showLobby() {
    this._only(this.lobby);
    this.refreshLobby();
  }

  refreshLobby() {
    const a = this.arena;
    const A = padLabel("PadA");
    const Bn = padLabel("PadB");
    const S = padLabel("PadStart");
    const cards = [];
    for (let slot = 0; slot < 4; slot += 1) {
      const p = a.players.find((x) => x.slot === slot);
      const colour = SLOT_COLOURS[slot];
      if (!p) {
        const waiting = [...a.pads.pads.values()].find((r) => r.slot === slot && !a.players.some((x) => x.input.type === "pad" && x.input.index === r.index));
        const kbFree = !a.players.some((x) => x.input.type === "keyboard");
        cards.push(`<article class="ar-slot empty${waiting ? " waiting" : ""}" style="--pc:${colour}">
          <span class="ar-device">${waiting ? PAD_ICON : "<i>+</i>"}</span>
          <b class="ar-slot-name">P${slot + 1}</b>
          <p>${waiting ? `${waiting.name}<br><span class="ar-press"><kbd>${A}</kbd> to enter</span>` : `Connect a controller<br>and press any button${kbFree && slot === a.players.length ? `<br><span class="ar-or">or <kbd>Enter</kbd> keyboard &amp; mouse</span>` : ""}`}</p>
        </article>`);
        continue;
      }
      const device = p.input.type === "pad" ? (a.pads.pads.get(p.input.index)?.name ?? "Controller") : "Keyboard & mouse";
      cards.push(`<article class="ar-slot in" style="--pc:${p.colour.hex}">
        <span class="ar-device on">${deviceIcon(p)}</span>
        <b class="ar-slot-name">${p.name}</b>
        <span class="ar-colour">${p.colour.name.toUpperCase()}</span>
        <small>${device}</small>
        <p class="ar-in">IN</p>
        <p class="ar-leave"><kbd>${p.input.type === "pad" ? Bn : "Backspace"}</kbd> leave</p>
      </article>`);
    }
    this.slots.innerHTML = cards.join("");
    const n = a.players.length;
    const ctf = a.mode === "ctf";
    this.lobbyTitle.innerHTML = ctf ? "ARENA<span>CAPTURE THE CORE</span>" : "ARENA<span>HOLD THE PAD</span>";
    this.lobbyRules.textContent = ctf
      ? "Two teams: P1 and P3 blue, P2 and P4 red. Take the other team's core and bring it home to your plinth while yours is still on it. Carrying it you're slower and can't throw - and any hit makes you drop it."
      : "Stand on the helipad alone and the clock is yours. Knock the others off it - and off the open ledges. First to the target wins.";
    this.lobbyFoot.innerHTML = `
      <span class="ar-target-pick"><kbd>${padLabel("PadLB")}</kbd> First to <b>${ctf ? `${a.target} capture${a.target === 1 ? "" : "s"}` : `${a.target} s`}</b> <kbd>${padLabel("PadRB")}</kbd></span>
      <span class="${n >= 2 ? "ready" : "dim"}">${n >= 2 ? `<kbd>${S}</kbd> / <kbd>Enter</kbd> NEXT: CHOOSE YOUR LOOK` : "Two players or more to go on"}</span>
      <span class="dim"><kbd>${Bn}</kbd> / <kbd>Esc</kbd> ${n ? "leave" : "back to the menu"}</span>`;
  }

  _target(step) {
    const list = MODE_TARGETS[this.arena.mode] ?? MODE_TARGETS.koth;
    const i = Math.max(0, list.indexOf(this.arena.target));
    this.arena.target = list[(i + step + list.length) % list.length];
  }

  _lobbyInput() {
    const a = this.arena;
    const pads = a.pads;
    let changed = false;
    for (const rec of pads.pads.values()) {
      const p = a.players.find((x) => x.input.type === "pad" && x.input.index === rec.index);
      if (!p) {
        if (pads.pressed(rec, B.A)) { a.join({ type: "pad", index: rec.index }); changed = true; }
        else if (pads.pressed(rec, B.B) && !a.players.length) { a.onExit?.("menu"); return; }
        continue;
      }
      if (pads.pressed(rec, B.LB) || pads.pressed(rec, B.RB)) { this._target(pads.pressed(rec, B.RB) ? 1 : -1); changed = true; }
      if (pads.pressed(rec, B.B)) { a.leave(p); changed = true; }
      if (pads.pressed(rec, B.START) && a.players.length >= 2) { a.toCustomise(); return; }
    }
    if (changed) { a.audio?.uiClick?.(); this.refreshLobby(); }
  }

  /* ================================================================ */
  /* Customise                                                        */
  /* ================================================================ */

  showCustomise() {
    this._only(this.custom);
    this.customHead.innerHTML = `<p class="ar-eyebrow">THE LINE-UP</p><h2>CHOOSE YOUR LOOK</h2>
      <p class="dim"><kbd>▲▼</kbd> pick &nbsp; <kbd>◀▶</kbd> change &nbsp; <kbd>${padLabel("PadA")}</kbd> / <kbd>Enter</kbd> next / ready &nbsp; <kbd>${padLabel("PadB")}</kbd> / <kbd>Backspace</kbd> back</p>`;
    this.panels.innerHTML = "";
    this._panelEls.clear();
    for (const p of this.arena.players) {
      const panel = el("article", "ar-panel", this.panels);
      panel.style.setProperty("--pc", p.colour.hex);
      this._panelEls.set(p, panel);
      this._drawPanel(p);
    }
  }

  _drawPanel(p) {
    const panel = this._panelEls.get(p);
    if (!panel) return;
    const value = {
      character: CHARACTER_NAMES[p.character],
      skin: `<i class="ar-swatch" style="background:${SKIN_TONES[p.skin].swatch}"></i>${SKIN_TONES[p.skin].label}`,
      headwear: HEADWEAR[p.headwear].label,
      launcher: p.launcher ? "Yes - shots" : "No - throw by hand",
      launcherSkin: p.launcher ? `<i class="ar-swatch sq" style="background:${LAUNCHER_SKINS[p.launcherSkin].swatch}"></i>${LAUNCHER_SKINS[p.launcherSkin].label}` : "-",
    };
    const rows = PAGES[p.page];
    p.row = Math.min(p.row, rows.length - 1);
    panel.classList.toggle("ready", p.ready);
    panel.innerHTML = `<span class="ar-device on">${deviceIcon(p)}</span>
      <header><b>${p.name}</b><span>${p.colour.name.toUpperCase()}</span></header>
      <nav class="ar-pages"><span class="${p.page === "character" ? "on" : ""}">Character</span><span class="${p.page === "launcher" ? "on" : ""}">Launcher</span></nav>
      ${rows.map((r, i) => `<div class="ar-row${i === p.row && !p.ready ? " on" : ""}"><span>${ROW_NAMES[r]}</span><em><i>◀</i>${value[r]}<i>▶</i></em></div>`).join("")}
      <footer>${p.ready ? "READY" : `<kbd>${p.input.type === "pad" ? padLabel("PadA") : "Enter"}</kbd> ${p.page === "character" ? "next: launcher" : "ready"}`}</footer>`;
  }

  /** A: on to the launcher page, then ready. */
  _customiseA(p) {
    if (p.ready) { this.arena.setReady(p, false); }
    else if (p.page === "character") { p.page = "launcher"; p.row = 0; this.arena.audio?.uiClick?.(); }
    else this.arena.setReady(p, true);
    this._drawPanel(p);
  }

  /** B: unready, back a page, or back to the lobby. */
  _customiseB(p) {
    if (p.ready) this.arena.setReady(p, false);
    else if (p.page === "launcher") { p.page = "character"; p.row = 0; this.arena.audio?.uiClick?.(); }
    else { this.arena.toLobby(); return; }
    this._drawPanel(p);
  }

  _customiseInput(dt) {
    const a = this.arena;
    for (const p of a.players) {
      if (p.input.type !== "pad") continue;
      const rec = a.pads.pads.get(p.input.index);
      if (!rec) continue;
      if (a.pads.pressed(rec, B.A)) { this._customiseA(p); continue; }
      if (a.pads.pressed(rec, B.B)) {
        this._customiseB(p);
        if (a.state !== "customise") return;
        continue;
      }
      if (p.ready) continue;
      const dir = this._dir(`c${p.slot}`, rec, dt);
      this._customiseMove(p, dir);
    }
  }

  _customiseMove(p, dir) {
    if (!dir) return;
    const rows = PAGES[p.page];
    if (dir === "up" || dir === "down") p.row = (p.row + (dir === "down" ? 1 : rows.length - 1)) % rows.length;
    else this.arena.change(p, rows[p.row], dir === "right" ? 1 : -1);
    this.arena.audio?.uiClick?.();
    // (A new character re-lines everyone up: all the panels.)
    for (const q of this.arena.players) this._drawPanel(q);
  }

  /** The panels sit under each avatar's feet. */
  _placePanels() {
    for (const [p, panel] of this._panelEls) {
      if (!p.pos) continue;
      const s = this.arena.screenOf(p.pos);
      panel.style.left = `${s.x}px`;
      panel.style.top = `${s.y + 14}px`;
    }
  }

  /* ================================================================ */
  /* Match                                                            */
  /* ================================================================ */

  showMatch() {
    this._only(this.hud);
    this.boxes.innerHTML = "";
    this.tags.innerHTML = "";
    this._boxEls.clear();
    this._tagEls.clear();
    for (const p of this.arena.players) {
      const box = el("article", `ar-box corner-${p.slot}`, this.boxes);
      box.style.setProperty("--pc", p.colour.hex);
      box.innerHTML = `<span class="ar-device on">${deviceIcon(p)}</span>
        <header><b>${p.name}</b><span class="ar-kos"></span></header>
        <div class="ar-meter hp"><span></span><em></em></div>
        <div class="ar-meter pad"><span></span><em></em></div>
        <div class="ar-line"><i class="ar-ball"></i><span class="ar-ballname"></span><span class="ar-ammo"></span></div>
        <div class="ar-pips"></div>
        <div class="ar-power"><span></span><em></em></div>
        <strong class="ar-status"></strong><strong class="ar-flash"></strong>`;
      box.querySelector(".ar-pips").innerHTML = "<i></i>".repeat(15);
      this._boxEls.set(p, {
        box, hp: box.querySelector(".hp span"), hpText: box.querySelector(".hp em"), pad: box.querySelector(".pad span"), padText: box.querySelector(".pad em"),
        kos: box.querySelector(".ar-kos"), ball: box.querySelector(".ar-ball"), ballName: box.querySelector(".ar-ballname"), ammo: box.querySelector(".ar-ammo"),
        pips: [...box.querySelectorAll(".ar-pips i")], power: box.querySelector(".ar-power"), status: box.querySelector(".ar-status"), flash: box.querySelector(".ar-flash"),
      });
      const tag = el("div", "ar-tag", this.tags, `<b>${p.name}</b><span><i></i></span>`);
      tag.style.setProperty("--pc", p.colour.hex);
      this._tagEls.set(p, { tag, hp: tag.querySelector("i") });
    }
    this.feedEl.innerHTML = "";
    this.tickEl.classList.remove("show");
  }

  banner(text, sub = "", seconds = 1.2, colour = "#ffffff") {
    this.bannerEl.innerHTML = `<b style="color:${colour}">${text}</b>${sub ? `<small>${sub}</small>` : ""}`;
    this.bannerEl.classList.remove("show");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("show");
    this._bannerT = seconds;
  }

  /** The last ten seconds, one at a time in the middle of the screen. */
  finalTick(n) {
    this.tickEl.textContent = String(n);
    this.tickEl.classList.remove("show");
    void this.tickEl.offsetWidth;
    this.tickEl.classList.add("show");
  }

  feed(text, colourA, colourB) {
    const line = el("p", "", this.feedEl, text);
    line.style.setProperty("--ca", colourA);
    line.style.setProperty("--cb", colourB);
    setTimeout(() => line.remove(), 3800);
  }

  flash(p, text) {
    const c = this._boxEls.get(p);
    if (!c) return;
    c.flash.textContent = text;
    c.flash.classList.remove("show");
    void c.flash.offsetWidth;
    c.flash.classList.add("show");
  }

  hurt(p) {
    const c = this._boxEls.get(p);
    if (!c) return;
    c.box.classList.remove("hurt");
    void c.box.offsetWidth;
    c.box.classList.add("hurt");
  }

  _updateMatch(dt) {
    const a = this.arena;
    this._bannerT -= dt;
    if (this._bannerT <= 0) this.bannerEl.classList.remove("show");
    const last = !a._overtime && a.clock <= 10;
    this.clockEl.textContent = a._overtime ? "OVERTIME" : mmss(a.clock);
    this.clockEl.classList.toggle("last", last);
    const ctf = a.mode === "ctf";
    if (ctf) {
      this.statusEl.innerHTML = `<b style="color:${TEAMS[0].hex}">BLUE ${a.teamScore[0]}</b> &nbsp;:&nbsp; <b style="color:${TEAMS[1].hex}">${a.teamScore[1]} RED</b> &nbsp;·&nbsp; FIRST TO ${a.target}`;
      this.statusEl.style.color = "";
    } else {
      this.statusEl.textContent = a.holder ? `${a.holder.name} HAS THE PAD` : a.contested ? "CONTESTED" : `FIRST TO ${a.target} s ON THE PAD`;
      this.statusEl.style.color = a.holder ? a.holder.colour.hex : a.contested ? "#ff5a4a" : "";
    }
    for (const [p, c] of this._boxEls) {
      const hp = Math.max(0, p.hp ?? 0);
      c.hp.style.width = `${hp}%`;
      c.hp.classList.toggle("low", hp < 35);
      c.hpText.textContent = `${Math.ceil(hp)}`;
      if (ctf) {
        // Their team's captures, in the team's colour; "CORE" while they carry one.
        const team = TEAMS[p.team ?? 0];
        c.pad.style.width = `${Math.min(100, (a.teamScore[p.team ?? 0] / a.target) * 100)}%`;
        c.pad.style.background = team.hex;
        c.padText.textContent = p.carrying ? `CARRYING THE ${TEAMS[p.carrying.team].name} CORE` : `${team.name} TEAM · ${a.teamScore[p.team ?? 0]} / ${a.target}`;
      } else {
        c.pad.style.background = "";
        c.pad.style.width = `${Math.min(100, (p.score / a.target) * 100)}%`;
        c.padText.textContent = `${p.score.toFixed(1)} / ${a.target} s`;
      }
      c.kos.textContent = `${p.kos} KO`;
      const ball = BALLS[p.ball];
      c.ball.style.setProperty("--bc", `#${ball.colour.toString(16).padStart(6, "0")}`);
      c.ballName.textContent = `${ball.name} · ${ARENA_COST[p.ball] ?? ball.cost}`;
      c.ammo.textContent = `${p.ammo} / 15`;
      c.pips.forEach((pip, i) => pip.classList.toggle("on", i < p.ammo));
      c.box.classList.toggle("holding", ctf ? Boolean(p.carrying) : a.holder === p);
      c.box.classList.toggle("out", p.out > 0 || p.falling);
      if (p.power) {
        const s = SERUMS[p.power.key];
        c.power.hidden = false;
        c.power.style.setProperty("--sc", s.colour);
        c.power.querySelector("span").textContent = p.power.key === "shield" ? `${s.name} · ${p.power.charges}` : s.name;
        c.power.querySelector("em").style.width = `${Math.max(0, (p.power.t / p.power.total) * 100)}%`;
      } else c.power.hidden = true;
      c.status.textContent = p.out > 0 ? `BACK IN ${Math.ceil(p.out)}` : p.falling ? "OVER THE EDGE" : p.frozen > 0 ? "FROZEN" : "";
    }
    // Tags over their heads.
    for (const [p, t] of this._tagEls) {
      const up = p.out <= 0 && !p.falling && p.pos;
      t.tag.hidden = !up;
      if (!up) continue;
      const s = a.screenOf(p.pos.clone().setY(2.3));
      t.tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      t.hp.style.width = `${Math.max(0, p.hp)}%`;
      t.hp.classList.toggle("low", p.hp < 35);
    }
  }

  /* ================================================================ */
  /* Menus: pause, results                                            */
  /* ================================================================ */

  /** A list of choices any player can move through (a controller or the keyboard). */
  _setMenu(container, items, { horizontal = false } = {}) {
    this.menu = { container, items, index: 0, horizontal };
    this._drawMenu();
  }

  _drawMenu() {
    const m = this.menu;
    if (!m) return;
    const list = m.container.querySelector(".ar-menu");
    list.innerHTML = m.items.map((it, i) => `<button type="button" class="${i === m.index ? "on" : ""}" data-i="${i}">${it.label}</button>`).join("");
    list.classList.toggle("row", m.horizontal);
    for (const b of list.querySelectorAll("button")) {
      b.onclick = () => { m.index = Number(b.dataset.i); this._choose(); };
      b.onmouseenter = () => { m.index = Number(b.dataset.i); this._drawMenu(); };
    }
  }

  _menuMove(dir) {
    const m = this.menu;
    if (!m || !dir) return;
    const back = m.horizontal ? "left" : "up";
    const next = m.horizontal ? "right" : "down";
    if (dir !== back && dir !== next) return;
    m.index = (m.index + (dir === next ? 1 : m.items.length - 1)) % m.items.length;
    this.arena.audio?.uiClick?.();
    this._drawMenu();
  }

  _choose() {
    const it = this.menu?.items[this.menu.index];
    if (!it) return;
    this.arena.audio?.uiClick?.();
    it.action();
  }

  _menuInput(dt, onBack) {
    for (const rec of this._playerPads()) {
      if (this.arena.pads.pressed(rec, B.A)) { this._choose(); return; }
      if (this.arena.pads.pressed(rec, B.B)) { onBack?.(); return; }
      this._menuMove(this._dir(`m${rec.index}`, rec, dt));
    }
  }

  showPause(on) {
    this.pauseEl.hidden = !on;
    if (!on) { this.menu = null; return; }
    const a = this.arena;
    this.pauseEl.innerHTML = `<div class="ar-sheet"><p class="ar-eyebrow">MATCH PAUSED // ${mmss(a.clock)} LEFT</p><h2>PAUSED</h2>
      <div class="ar-standings">${a.ranked().map((p) => `<span style="--pc:${p.colour.hex}"><b>${p.name}</b>${a.mode === "ctf" ? `${TEAMS[p.team].name} · ${p.score} cap` : `${p.score.toFixed(1)} s`} · ${p.kos} KO</span>`).join("")}</div>
      <div class="ar-menu"></div>
      <p class="dim"><kbd>${padLabel("PadA")}</kbd> / <kbd>Enter</kbd> choose &nbsp; <kbd>${padLabel("PadB")}</kbd> / <kbd>Esc</kbd> resume</p></div>`;
    this._setMenu(this.pauseEl, [
      { label: "Resume", action: () => a.pause(false) },
      { label: "Restart the match", action: () => { this.pauseEl.hidden = true; a.startMatch(); } },
      { label: "Change characters", action: () => { this.pauseEl.hidden = true; a.toCustomise(); } },
      { label: "Back to the lobby", action: () => { this.pauseEl.hidden = true; a.toLobby(); } },
      { label: "Quit to the main menu", action: () => a.onExit?.("menu") },
    ]);
  }

  showResults(winner) {
    const a = this.arena;
    this._only(this.resultsEl);
    const ranked = a.ranked();
    this.resultsEl.innerHTML = `
      <header class="ar-results-head"><p class="ar-eyebrow">MATCH OVER // ${a.mode === "ctf" ? `BLUE ${a.teamScore[0]} : ${a.teamScore[1]} RED` : `FIRST TO ${a.target} s`}</p>
      ${a.mode === "ctf"
        ? `<h1 class="ar-winner" style="--pc:${TEAMS[a.winningTeam].hex}">${TEAMS[a.winningTeam].name} TEAM WINS</h1>`
        : `<h1 class="ar-winner" style="--pc:${winner.colour.hex}">${winner.name} WINS</h1>`}</header>
      <div class="ar-podium"></div>
      <footer class="ar-results-foot"><div class="ar-awards"></div><div class="ar-menu"></div></footer>`;
    // The awards, one after another.
    this.resultsEl.querySelector(".ar-awards").innerHTML = a.awards().map((w, i) => `<article class="ar-award" style="--pc:${w.player.colour.hex}; animation-delay:${0.25 + i * 0.12}s">
      ${medal(w.icon, w.player.colour.hex, i)}<small>${w.title}</small><b>${w.player.name}</b><span>${w.value}</span></article>`).join("");
    const podium = this.resultsEl.querySelector(".ar-podium");
    this._podiumEls = new Map();
    ranked.forEach((p, i) => {
      const card = el("article", `ar-place place-${i}`, podium);
      card.style.setProperty("--pc", p.colour.hex);
      card.innerHTML = `<span class="ar-device on">${deviceIcon(p)}</span><header><em>${ordinal(i)}</em><b>${p.name}</b></header>
        <dl>${a.mode === "ctf" ? `<dt>Captures</dt><dd>${p.score}</dd>` : `<dt>Pad</dt><dd>${p.score.toFixed(1)} s</dd>`}<dt>KOs</dt><dd>${p.kos}</dd><dt>Down</dt><dd>${p.outs}</dd>
        <dt>Accuracy</dt><dd>${p.stats?.thrown ? Math.round((p.stats.hits / p.stats.thrown) * 100) : 0}%</dd></dl>
        <p class="ar-wins">${p.wins} win${p.wins === 1 ? "" : "s"}</p>`;
      this._podiumEls.set(p, card);
    });
    this._setMenu(this.resultsEl, [
      { label: "Rematch", action: () => a.startMatch() },
      { label: "Change characters", action: () => a.toCustomise() },
      { label: "Lobby", action: () => a.toLobby() },
      { label: "Main menu", action: () => a.onExit?.("menu") },
    ], { horizontal: true });
  }

  /** Each player's card centred under the front of their block, all in one row. */
  _placePodium() {
    const spots = [];
    for (const [p, card] of this._podiumEls ?? []) {
      if (!p.pos) continue;
      spots.push([card, this.arena.screenOf(p.pos.clone().setY(0).add({ x: 0, y: 0, z: PODIUM_FRONT }))]);
    }
    const top = Math.max(...spots.map(([, s]) => s.y)) + 10;
    for (const [card, s] of spots) {
      card.style.left = `${s.x}px`;
      card.style.top = `${top}px`;
    }
  }

  /* ================================================================ */
  /* The keyboard player                                              */
  /* ================================================================ */

  onKey(e) {
    if (e.repeat) return;
    const a = this.arena;
    const kb = a.players.find((x) => x.input.type === "keyboard");
    const dirOf = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
    if (a.state === "lobby") {
      if (e.code === "Enter") {
        if (!kb) a.join({ type: "keyboard" });
        else if (a.players.length >= 2) { a.toCustomise(); return; }
      } else if (e.code === "Escape") {
        if (kb) a.leave(kb);
        else if (!a.players.length) { a.onExit?.("menu"); return; }
      } else if (kb && e.code === "Backspace") a.leave(kb);
      else if (e.code === "BracketLeft" || e.code === "BracketRight") this._target(e.code === "BracketRight" ? 1 : -1);
      else return;
      a.audio?.uiClick?.();
      this.refreshLobby();
    } else if (a.state === "customise" && kb) {
      if (e.code === "Enter") this._customiseA(kb);
      else if (e.code === "Backspace" || e.code === "Escape") this._customiseB(kb);
      else if (!kb.ready && dirOf[e.code]) this._customiseMove(kb, dirOf[e.code]);
    } else if (a.state === "paused" || a.state === "results") {
      if (e.code === "Enter") this._choose();
      else if (dirOf[e.code] && e.code.startsWith("Arrow")) this._menuMove(dirOf[e.code]);
      else if (a.state === "results" && (e.code === "Escape" || e.code === "Backspace")) a.toLobby();
    }
  }

  /* ================================================================ */
  /* Frame                                                            */
  /* ================================================================ */

  update(dt) {
    const a = this.arena;
    if (a.state === "lobby") { this._lobbyInput(); return; }
    if (a.state === "customise") { this._customiseInput(dt); this._placePanels(); return; }
    if (a.state === "results") { this._menuInput(dt, () => a.toLobby()); this._placePodium(); return; }
    if (a.state === "paused") { this._menuInput(dt, () => a.pause(false)); return; }
    this._updateMatch(dt);
  }
}
