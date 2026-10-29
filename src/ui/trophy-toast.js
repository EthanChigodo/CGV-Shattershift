/**
 * A trophy earned: a card slides down at the top of the screen - the badge
 * pops in, a shine runs across, a chime - and slides away again, as on a
 * PlayStation. Several in a row wait their turn; the platinum's is bigger.
 *
 *   const toast = new TrophyToast();
 *   toast.show(trophy);
 *   toast.note({ label, title, text, colour, art });   // any other notice (a new ghost)
 */

import { TIERS } from "../systems/trophies.js";
import { effectsFor } from "../audio/output.js";
import { trophyBadge, cupIcon, kitToken } from "./trophy-art.js";

const HOLD = 4.2; // seconds on screen

export function ensureTrophyStyles() {
  if (document.querySelector("link[data-trophies]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./trophies.css", import.meta.url).href;
  link.dataset.trophies = "true";
  document.head.appendChild(link);
}

export class TrophyToast {
  constructor({ volume = () => 1 } = {}) {
    ensureTrophyStyles();
    this.root = document.createElement("div");
    this.root.className = "tt-root";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    document.body.appendChild(this.root);
    this.queue = [];
    this.busy = false;
    this.volume = volume;
  }

  show(trophy) {
    this.queue.push(trophy);
    if (!this.busy) this._next();
  }

  /** A kit unlocked (src/figure/kits.js): its token, after the trophy that earned it. */
  showKit(kit) {
    this.queue.push({ kit });
    if (!this.busy) this._next();
  }

  /** Any other notice, in the same card and the same queue: `art` is the badge's markup. */
  note({ label, title, text = "", colour = "#8fe6ff", art = "" }) {
    this.queue.push({ note: { label, title, text, colour, art } });
    if (!this.busy) this._next();
  }

  _next() {
    const t = this.queue.shift();
    if (!t) { this.busy = false; return; }
    this.busy = true;
    if (t.kit) { this._kitCard(t.kit); return; }
    if (t.note) { this._noteCard(t.note); return; }
    const tier = TIERS[t.tier];
    const card = document.createElement("div");
    card.className = `tt-card tier-${t.tier}`;
    card.style.setProperty("--tc", tier.colour);
    card.innerHTML = `
      <div class="tt-art">${trophyBadge(t)}</div>
      <div class="tt-text">
        <small>${cupIcon()}${t.tier === "platinum" ? "PLATINUM TROPHY" : `${tier.label.toUpperCase()} TROPHY`} EARNED</small>
        <b>${t.name}</b>
        <span>${t.text}</span>
      </div>
      <i class="tt-shine"></i>`;
    this.root.appendChild(card);
    this._chime(t.tier);
    requestAnimationFrame(() => card.classList.add("in"));
    this._hold(card, HOLD + (t.tier === "platinum" ? 1.5 : 0));
  }

  _kitCard(kit) {
    const card = document.createElement("div");
    card.className = "tt-card tt-kit";
    card.style.setProperty("--tc", kit.colour);
    card.innerHTML = `
      <div class="tt-art">${kitToken(kit)}</div>
      <div class="tt-text">
        <small>KIT UNLOCKED</small>
        <b>${kit.name}</b>
        <span>${kit.items.join(" · ")} - in Customise</span>
      </div>
      <i class="tt-shine"></i>`;
    this.root.appendChild(card);
    this._chime("gold");
    requestAnimationFrame(() => card.classList.add("in"));
    this._hold(card, HOLD);
  }

  _noteCard({ label, title, text, colour, art }) {
    const card = document.createElement("div");
    card.className = "tt-card tt-note";
    card.style.setProperty("--tc", colour);
    card.innerHTML = `
      <div class="tt-art">${art}</div>
      <div class="tt-text">
        <small>${label}</small>
        <b>${title}</b>
        ${text ? `<span>${text}</span>` : ""}
      </div>
      <i class="tt-shine"></i>`;
    this.root.appendChild(card);
    requestAnimationFrame(() => card.classList.add("in"));
    this._hold(card, HOLD);
  }

  /**
   * On screen for `seconds` of frames actually drawn, then away: a hitch
   * (a level or the menu being built) doesn't use the time up - by the
   * clock, a card shown just before one was gone before it could be read.
   */
  _hold(card, seconds) {
    let last = performance.now();
    let left = seconds;
    const tick = (now) => {
      left -= Math.min(0.1, (now - last) / 1000);
      last = now;
      if (left > 0) { requestAnimationFrame(tick); return; }
      card.classList.remove("in");
      card.classList.add("out");
      setTimeout(() => { card.remove(); this._next(); }, 500);
    };
    requestAnimationFrame(tick);
  }

  /** The chime: two bright notes and a shimmer (a third for the platinum). */
  _chime(tier) {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      if (ctx.state === "suspended") ctx.resume();
      const level = 0.12 * Math.max(0, Math.min(1, this.volume()));
      if (!level) return;
      const notes = tier === "platinum" ? [784, 1175, 1568, 2349] : tier === "gold" ? [988, 1480, 1976] : [988, 1480];
      notes.forEach((f, i) => {
        const at = ctx.currentTime + 0.02 + i * 0.09;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(level, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0008, at + 1.1);
        o.connect(g).connect(effectsFor(ctx));
        o.start(at);
        o.stop(at + 1.2);
      });
    } catch {}
  }
}
