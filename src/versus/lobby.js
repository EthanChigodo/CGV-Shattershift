/**
 * The Versus lobby: who is playing, on what, as whom.
 *
 * Each player joins by pressing a button on whatever they hold - a pad's
 * cross (A), F on the keyboard (keyboard and mouse), or / on the keyboard
 * (the arrows half). The first to join is P1, the second P2. Joined, they
 * see their device and its controls, pick their Subject (left / right) and
 * ready up (the same button again). Both ready: three seconds, and the match
 * starts. A pad's circle (B) backs out of ready, then out of the slot; Esc
 * leaves the lobby. Rounds (best of 1, 3 or 5) and the split (side by side
 * or stacked) are anyone's to change: triangle / square, R / T, or a click.
 *
 * Everything can be clicked too, so a mouse alone can set up a match.
 * The lobby only keeps the choices; index.js runs it each frame and starts
 * the match with `setup()`.
 */

import { CHARACTERS, savedCharacter } from "../levels/meltdown/game.js";
import { savedSkinTone } from "../figure/look.js";
import { legendFor } from "./controls.js";
import { glyph } from "./hud.js";

const CHARACTER_KEYS = Object.keys(CHARACTERS);
/** Wins needed, for best of 1 / 3 / 5. */
const WINS = [1, 2, 3];
/** Seconds of "starting" once both are ready. */
const COUNTDOWN = 3;

const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

export class VersusLobby {
  constructor({ container = document.body, input, onStart, onExit }) {
    this.input = input;
    this.onStart = onStart;
    this.onExit = onExit;
    this.slots = [null, null];
    this.options = { wins: 2, split: "v" };
    this.countdown = 0;
    this.root = el("section", "vs-lobby");
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Versus lobby");
    this.root.innerHTML = `
      <div class="vs-lobby-inner">
        <header class="vs-lobby-head">
          <p class="mono-label">VERSUS // LOCAL // TWO PLAYERS // ONE SCREEN</p>
          <h1 class="vs-lobby-title">ROOFTOP<span>SHOWDOWN</span></h1>
          <p class="vs-lobby-pitch">Two Subjects on the burning roof, one seat on the helicopter. Fight the horde - every kill brings it sooner - then get to the ladder first, and keep the other one off it.</p>
        </header>
        <div class="vs-slots"></div>
        <div class="vs-options">
          <div class="vs-option"><span class="mono-label">ROUNDS</span><div class="vs-seg" data-opt="wins">${WINS.map((w) => `<button type="button" data-value="${w}">Best of ${w * 2 - 1}</button>`).join("")}</div><kbd class="key">R</kbd></div>
          <div class="vs-option"><span class="mono-label">SPLIT SCREEN</span><div class="vs-seg" data-opt="split"><button type="button" data-value="v">Side by side</button><button type="button" data-value="h">Stacked</button></div><kbd class="key">T</kbd></div>
        </div>
        <footer class="vs-lobby-foot">
          <button type="button" class="vs-button" data-act="back"><kbd class="key">Esc</kbd>Back</button>
          <span class="vs-pads mono-label"></span>
          <span class="vs-go"></span>
        </footer>
      </div>`;
    this.slotsEl = this.root.querySelector(".vs-slots");
    this.root.querySelector("[data-act=back]").onclick = () => this.onExit?.();
    for (const seg of this.root.querySelectorAll(".vs-seg")) {
      seg.onclick = (event) => {
        const b = event.target.closest("button");
        if (!b) return;
        if (seg.dataset.opt === "wins") this.options.wins = Number(b.dataset.value);
        else this.options.split = b.dataset.value;
        this._changed();
      };
    }
    container.append(this.root);
    this._padsSeen = -1;
    this.render();
  }

  open() {
    this.root.hidden = false;
    // Whoever was in it last time stays in, unready.
    for (const s of this.slots) if (s) s.ready = false;
    this.countdown = 0;
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.countdown = 0;
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** The match's setup, from the slots and options. */
  setup() {
    return {
      players: this.slots.map((s) => ({ device: s.device, character: s.character, skin: s.skin })),
      wins: this.options.wins,
      split: this.options.split,
    };
  }

  join(device) {
    if (this.slots.some((s) => s?.device === device)) return false;
    const i = this.slots.indexOf(null);
    if (i < 0) return false;
    // P1 is who you play as in the story; P2 the other Subject, so they look different.
    const mine = savedCharacter();
    const other = CHARACTER_KEYS.find((k) => k !== mine) ?? mine;
    const taken = this.slots.find(Boolean)?.character;
    this.slots[i] = { device, character: taken ? (taken === mine ? other : mine) : mine, skin: savedSkinTone(), ready: false };
    this._changed();
    return true;
  }

  leave(i) {
    this.slots[i] = null;
    this._changed();
  }

  _changed() {
    this.countdown = 0;
    this.render();
  }

  /** One frame: joins, picks, readies, options, the countdown. */
  update(dt) {
    const input = this.input;
    if (input.escape) {
      this.onExit?.();
      return;
    }
    let changed = false;
    for (const device of input.joinRequests()) {
      const slot = this.slots.find((s) => s?.device === device);
      if (slot) {
        slot.ready = !slot.ready;
        changed = true;
      } else if (this.join(device)) changed = false;
    }
    let anyJoined = false;
    for (const [i, slot] of this.slots.entries()) {
      if (!slot) continue;
      anyJoined = true;
      const intent = input.read(slot.device);
      if (!slot.ready && (intent.left || intent.right)) {
        const k = CHARACTER_KEYS.indexOf(slot.character);
        slot.character = CHARACTER_KEYS[(k + (intent.right ? 1 : -1) + CHARACTER_KEYS.length) % CHARACTER_KEYS.length];
        changed = true;
      }
      if (intent.back) {
        if (slot.ready) slot.ready = false;
        else this.slots[i] = null;
        changed = true;
      }
      if (intent.rounds) {
        this.options.wins = WINS[(WINS.indexOf(this.options.wins) + 1) % WINS.length];
        changed = true;
      }
      if (intent.split) {
        this.options.split = this.options.split === "v" ? "h" : "v";
        changed = true;
      }
    }
    // A pad nobody has joined with backs out of the empty lobby.
    if (!anyJoined) for (const p of input.padList()) if (p.pressed.circle) this.onExit?.();
    // Not joined yet: R / T still set the options from the keyboard.
    if (!this.slots.some((s) => s?.device === "keys-left")) {
      if (input.pressed.has("KeyR")) { this.options.wins = WINS[(WINS.indexOf(this.options.wins) + 1) % WINS.length]; changed = true; }
      if (input.pressed.has("KeyT")) { this.options.split = this.options.split === "v" ? "h" : "v"; changed = true; }
    }
    if (changed) this._changed();

    const pads = input.padList().length;
    if (pads !== this._padsSeen) {
      this._padsSeen = pads;
      this.render();
    }

    const ready = this.slots.every((s) => s?.ready);
    if (ready) {
      const before = Math.ceil(this.countdown);
      this.countdown = (this.countdown || COUNTDOWN) - dt;
      if (Math.ceil(this.countdown) !== before) this._renderGo();
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.onStart?.(this.setup());
      }
    } else if (this.countdown) {
      this.countdown = 0;
      this._renderGo();
    }
  }

  /* ---------------- Drawing ---------------- */

  render() {
    this.slotsEl.innerHTML = "";
    for (const [i, slot] of this.slots.entries()) this.slotsEl.append(this._slot(i, slot));
    for (const b of this.root.querySelectorAll("[data-opt=wins] button")) b.classList.toggle("on", Number(b.dataset.value) === this.options.wins);
    for (const b of this.root.querySelectorAll("[data-opt=split] button")) b.classList.toggle("on", b.dataset.value === this.options.split);
    const pads = this.input.padList();
    this.root.querySelector(".vs-pads").textContent = pads.length
      ? `${pads.length} CONTROLLER${pads.length === 1 ? "" : "S"} CONNECTED`
      : "NO CONTROLLER FOUND // PLUG ONE IN AND PRESS A BUTTON, OR SHARE THE KEYBOARD";
    this._renderGo();
  }

  _renderGo() {
    const go = this.root.querySelector(".vs-go");
    const ready = this.slots.every((s) => s?.ready);
    go.classList.toggle("on", ready);
    go.textContent = ready ? `STARTING IN ${Math.max(1, Math.ceil(this.countdown || COUNTDOWN))}` : this.slots.every(Boolean) ? "BOTH READY UP TO START" : "WAITING FOR PLAYERS";
  }

  _slot(i, slot) {
    const node = el("article", `vs-slot vs-team-${i + 1}${slot ? " joined" : ""}${slot?.ready ? " ready" : ""}`);
    node.dataset.slot = String(i);
    const head = `<div class="vs-slot-head"><b class="vs-chip">P${i + 1}</b><span class="mono-label">SUBJECT 07-${i ? "B" : "A"}</span><span class="vs-slot-state mono-label">${slot ? (slot.ready ? "READY" : "JOINED") : "OPEN"}</span></div>`;
    if (!slot) {
      const keysTaken = (d) => this.slots.some((s) => s?.device === d);
      node.innerHTML = `${head}
        <div class="vs-slot-body vs-slot-open">
          <p class="vs-join">Press <kbd class="key pad">${glyph("pad:0", "confirm", "ps")}</kbd> / <kbd class="key pad">A</kbd><br>on a controller</p>
          <p class="vs-join-alt">${keysTaken("keys-left") ? "" : `<kbd class="key">F</kbd> keyboard + mouse`}${keysTaken("keys-left") || keysTaken("keys-right") ? "" : " &nbsp;·&nbsp; "}${keysTaken("keys-right") ? "" : `<kbd class="key">/</kbd> keyboard arrows`}</p>
          <button type="button" class="vs-button" data-act="join">Join with the keyboard</button>
        </div>`;
      node.querySelector("[data-act=join]").onclick = () => {
        this.join(this.slots.some((s) => s?.device === "keys-left") ? "keys-right" : "keys-left");
      };
      return node;
    }
    const d = this.input.describe(slot.device);
    const kind = this.input.pad(slot.device)?.kind ?? "xbox";
    const legend = legendFor(slot.device, kind).map(([k, v]) => `<dt><kbd class="key">${k}</kbd></dt><dd>${v}</dd>`).join("");
    const confirm = glyph(slot.device, "confirm", kind);
    node.innerHTML = `${head}
      <div class="vs-slot-body">
        <p class="vs-slot-device"><span class="vs-device-icon ${d.kind === "keys" ? "keys" : "pad"}"></span>${d.name}</p>
        <div class="vs-subject">
          <button type="button" data-act="prev" aria-label="Previous Subject">&#9664;</button>
          <div><span class="mono-label">PLAYING AS</span><strong>${CHARACTERS[slot.character].toUpperCase()}</strong></div>
          <button type="button" data-act="next" aria-label="Next Subject">&#9654;</button>
        </div>
        <dl class="vs-legend">${legend}</dl>
        <div class="vs-slot-actions">
          <button type="button" class="vs-button primary" data-act="ready"><kbd class="key${slot.device.startsWith("pad:") ? " pad" : ""}">${confirm}</kbd>${slot.ready ? "Ready!" : "Ready up"}</button>
          <button type="button" class="vs-button" data-act="leave">Leave</button>
        </div>
      </div>`;
    const pick = (step) => {
      if (slot.ready) return;
      const k = CHARACTER_KEYS.indexOf(slot.character);
      slot.character = CHARACTER_KEYS[(k + step + CHARACTER_KEYS.length) % CHARACTER_KEYS.length];
      this._changed();
    };
    node.querySelector("[data-act=prev]").onclick = () => pick(-1);
    node.querySelector("[data-act=next]").onclick = () => pick(1);
    node.querySelector("[data-act=ready]").onclick = () => { slot.ready = !slot.ready; this._changed(); };
    node.querySelector("[data-act=leave]").onclick = () => this.leave(i);
    return node;
  }

  dispose() {
    this.root.remove();
  }
}
