/**
 * The story layer: one DOM overlay shared by every level's cutscenes.
 *
 * It owns nothing about timing - the CutscenePlayer and ReactionHits drive
 * it. Everything is a plain setter so a scene can animate any of it:
 *
 *   const ui = new StoryUI();
 *   ui.setLetterbox(true);
 *   ui.say("okoro", "Seven, can you hear me?");
 *   ui.setLids(0.4); ui.setBlur(6); ui.setFade(0);
 *   ui.title("FRACTURE RUN", "a game by ...");
 *
 * Speakers come from CAST (script.js): name and colour. A line in [square
 * brackets] is a stage direction - italic, no name.
 */

import { CAST } from "./script.js";

function ensureStylesheet() {
  if (document.querySelector("link[data-story-ui]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./story.css", import.meta.url).href;
  link.dataset.storyUi = "true";
  document.head.appendChild(link);
}

function div(className, parent) {
  const node = document.createElement("div");
  node.className = className;
  parent?.appendChild(node);
  return node;
}

const KEY_LABELS = { Space: "SPACE", ShiftLeft: "SHIFT", Enter: "ENTER", Escape: "ESC" };

/** "KeyE" -> "E", "Space" -> "SPACE". */
export function keyLabel(code) {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code.toUpperCase();
}

export class StoryUI {
  /**
   * @param {object} [o]
   * @param {HTMLElement} [o.container]
   * @param {HTMLElement[]} [o.blurTargets]  the game canvases: blurring them
   *   directly is cheaper and more reliable than a backdrop-filter overlay
   *   (which is the fallback when none are given)
   */
  constructor({ container = document.body, blurTargets = [] } = {}) {
    ensureStylesheet();
    this.blurTargets = blurTargets;
    this.root = div("story-layer");
    this.root.hidden = true;
    this.blur = div("story-blur", this.root);
    this.tint = div("story-tint", this.root);
    this.vignette = div("story-vignette", this.root);
    this.lidTop = div("story-lid top", this.root);
    this.lidBottom = div("story-lid bottom", this.root);
    this.fadeEl = div("story-fade", this.root);
    div("story-bar top", this.root);
    div("story-bar bottom", this.root);

    this.sub = div("story-sub", this.root);
    this.subWho = document.createElement("span");
    this.subWho.className = "who";
    this.subLine = document.createElement("span");
    this.subLine.className = "line";
    this.sub.append(this.subWho, this.subLine);

    this.skipEl = div("story-skip", this.root);
    this.skipEl.innerHTML = `<span>HOLD <kbd>ESC</kbd> TO SKIP</span><svg viewBox="0 0 26 26"><circle class="track" cx="13" cy="13" r="11"/><circle class="fill" cx="13" cy="13" r="11"/></svg>`;
    this.skipFill = this.skipEl.querySelector(".fill");

    this.react = div("story-react", this.root);
    this.reactLabel = div("label", this.react);
    this.reactKeys = div("keys", this.react);
    this.reactBar = div("bar", this.react);
    this.reactBarFill = document.createElement("i");
    this.reactBar.appendChild(this.reactBarFill);
    this.reactKeyEls = [];

    this.titleEl = div("story-title", this.root);
    this.titleH = document.createElement("h1");
    this.titleP = document.createElement("p");
    this.titleEl.append(this.titleH, this.titleP);

    // The end credits: a column that the host scrolls (so pause holds it).
    this.creditsEl = div("story-credits", this.root);
    this.creditsRoll = div("roll", this.creditsEl);

    container.appendChild(this.root);
    this.current = null;
    this.reset();
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }

  /** Everything back to a clear frame. */
  reset() {
    this.setLetterbox(false);
    this.setLids(0);
    this.setBlur(0);
    this.setVignette(0);
    this.setTint(0);
    this.setFade(0);
    this.say(null);
    this.setSkip(0, false);
    this.hideReaction();
    this.title(null);
    this.credits(null);
    document.body.classList.remove("story-cutscene");
  }

  /** Show the end credits (HTML), or hide them with null. */
  credits(html) {
    if (!html) {
      this.creditsEl.classList.remove("show");
      return;
    }
    this.creditsRoll.innerHTML = html;
    this.creditsEl.classList.add("show");
    this.setCreditsScroll(0);
  }

  /** 0 = the roll's top just below the screen, 1 = its bottom gone off the top. */
  setCreditsScroll(k) {
    const h = this.creditsRoll.offsetHeight || 2000;
    const view = this.creditsEl.offsetHeight || innerHeight;
    const y = view - Math.max(0, Math.min(1, k)) * (h + view);
    this.creditsRoll.style.transform = `translateY(${y.toFixed(1)}px)`;
  }

  /** How tall the roll is relative to the screen (for pacing the scroll). */
  get creditsLength() {
    return (this.creditsRoll.offsetHeight || 2000) / (this.creditsEl.offsetHeight || innerHeight);
  }

  /** Cutscene mode: letterbox, and the level HUDs fade out. */
  setCutscene(on) {
    this.setLetterbox(on);
    if (on) this.setGameplay(false);
    document.body.classList.toggle("story-cutscene", on);
  }

  setLetterbox(on) { this.root.classList.toggle("letterbox", on); }

  /** Subtitles over gameplay (no letterbox): raised clear of the HUD. */
  setGameplay(on) { this.root.classList.toggle("gameplay", on); }

  /** 0 = eyes open, 1 = shut. */
  setLids(k) {
    const h = `${(Math.max(0, Math.min(1, k)) * 52).toFixed(2)}vh`;
    this.lidTop.style.height = h;
    this.lidBottom.style.height = h;
  }

  setBlur(px) {
    const value = px > 0.05 ? `blur(${px.toFixed(1)}px)` : "";
    if (value === this._blur) return;
    this._blur = value;
    if (this.blurTargets.length) {
      for (const el of this.blurTargets) el.style.filter = value;
      return;
    }
    this.blur.style.backdropFilter = value;
    this.blur.style.webkitBackdropFilter = value;
  }

  setVignette(k) { this.vignette.style.opacity = Math.max(0, Math.min(1, k)).toFixed(3); }
  setTint(k) { this.tint.style.opacity = Math.max(0, Math.min(1, k)).toFixed(3); }
  setFade(k) { this.fadeEl.style.opacity = Math.max(0, Math.min(1, k)).toFixed(3); }

  /** Show a line (or clear with null). Returns true if it changed. */
  say(who, text) {
    const key = who ? `${who}|${text}` : null;
    if (key === this.current) return false;
    this.current = key;
    if (!who) {
      this.sub.classList.remove("show");
      return true;
    }
    const direction = /^\[.*\]$/.test(text.trim());
    const cast = CAST[who] ?? { name: who.toUpperCase(), colour: "#fff" };
    this.sub.classList.toggle("direction", direction);
    this.subWho.textContent = direction ? "" : cast.name;
    this.subWho.style.color = cast.colour;
    this.subLine.textContent = direction ? text.trim().slice(1, -1) : text;
    this.sub.classList.add("show");
    return true;
  }

  /** The hold-to-skip ring: k in 0..1. */
  setSkip(k, visible = true) {
    this.skipEl.classList.toggle("show", visible);
    this.skipFill.style.strokeDashoffset = (69.1 * (1 - Math.max(0, Math.min(1, k)))).toFixed(2);
  }

  title(text, sub = "") {
    if (!text) {
      this.titleEl.classList.remove("show");
      return;
    }
    this.titleH.textContent = text;
    this.titleP.textContent = sub;
    this.titleEl.classList.add("show");
  }

  /* ---- Reaction prompts (ReactionHits drives these) ---- */

  /**
   * @param {object} view
   * @param {string} view.label     e.g. "PRESS", "MASH"
   * @param {string[]} view.keys    key codes to draw
   * @param {"together"|"sequence"|"single"} view.layout
   * @param {boolean} [view.bar]    show the fill bar (mash / hold)
   */
  showReaction({ label, keys, layout = "single", bar = false }) {
    this.react.classList.remove("success", "fail");
    this.reactLabel.textContent = label;
    this.reactKeys.innerHTML = "";
    this.reactKeyEls = [];
    keys.forEach((code, i) => {
      if (i > 0 && layout === "together") {
        const plus = document.createElement("span");
        plus.className = "plus";
        plus.textContent = "+";
        this.reactKeys.appendChild(plus);
      }
      const k = div("story-key", this.reactKeys);
      const text = keyLabel(code);
      if (text.length > 2) k.classList.add("wide");
      k.innerHTML = `<svg viewBox="0 0 74 74"><circle class="track" cx="37" cy="37" r="32"/><circle class="timer" cx="37" cy="37" r="32"/></svg><b>${text}</b>`;
      this.reactKeyEls.push(k);
    });
    this.reactBar.hidden = !bar;
    this.reactBarFill.style.width = "0%";
    this.react.classList.add("show");
  }

  /**
   * Per-frame state of the prompt.
   * @param {object} s
   * @param {number} s.time      0..1 of the window left (the ring)
   * @param {number} [s.index]   sequence: the key being asked for
   * @param {boolean[]} [s.done] which keys are already hit
   * @param {boolean[]} [s.held] which keys are down right now
   * @param {number} [s.bar]     0..1 fill
   */
  updateReaction({ time = 1, index = -1, done = [], held = [], bar = null }) {
    this.reactKeyEls.forEach((k, i) => {
      const isDone = !!done[i];
      k.classList.toggle("done", isDone);
      k.classList.toggle("held", !!held[i] && !isDone);
      k.classList.toggle("next", i === index);
      k.classList.toggle("later", index >= 0 && i > index);
      const timer = k.querySelector(".timer");
      const show = index < 0 ? !isDone : i === index;
      timer.style.strokeDashoffset = show ? (201 * (1 - Math.max(0, Math.min(1, time)))).toFixed(1) : "201";
    });
    if (bar !== null) this.reactBarFill.style.width = `${(Math.max(0, Math.min(1, bar)) * 100).toFixed(1)}%`;
  }

  /** "success" | "fail" flash, then hide. */
  endReaction(result) {
    this.react.classList.add(result);
    this.reactLabel.textContent = result === "success" ? "OK" : "MISSED";
    clearTimeout(this._reactTimer);
    this._reactTimer = setTimeout(() => this.hideReaction(), result === "success" ? 380 : 700);
  }

  hideReaction() {
    clearTimeout(this._reactTimer);
    this.react.classList.remove("show", "success", "fail");
  }

  dispose() {
    clearTimeout(this._reactTimer);
    document.body.classList.remove("story-cutscene");
    this.root.remove();
  }
}
