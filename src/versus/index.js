/**
 * Versus: Rooftop Showdown, as the host (main.js) sees it.
 *
 *   const versus = new Versus({ renderer, assetBase, sfx, music, onExit });
 *   versus.openLobby();             // the menu's Versus button
 *   // each frame, before the host's own update and render:
 *   if (versus.active) versus.update(dt, time);   // lobby or match
 *   if (versus.running) versus.render();          // the match owns the canvas
 *
 * `active` (lobby or match up) means Versus owns the keyboard, mouse and
 * pads - the host's input handlers stand aside, and the single-player pad
 * synthesis checks src/versus/active.js. `running` means a match is on
 * screen and draws the frame (split screen); otherwise the host keeps
 * drawing its menu scene behind the lobby.
 *
 * The match is built when both players are ready (the models stream in
 * while they pick), and torn down on the way out; leaving puts the renderer
 * back exactly as it was (pixel ratio, viewport, scissor, exposure).
 */

import { loadMeltdownAssets } from "../levels/meltdown/assets.js";
import { MeltdownAudio } from "../audio/meltdown-audio.js";
import { setVersusActive } from "./active.js";
import { VersusInput } from "./controls.js";
import { VersusHud, glyph } from "./hud.js";
import { VersusLobby } from "./lobby.js";
import { VersusMatch } from "./match.js";

/** Every model the match uses: the roof's, both Subjects, the launcher. */
const MODELS = [
  "scientistRadioman", "scientistRust", "patient", "helicopter", "gadgetBrass", "gadgetCoil", "ventFan", "utilityBox", "alarmLight", "duffelBag",
  "launcher", "playerFemale", "playerMale",
];

const nextFrame = () => new Promise((resolve) => {
  requestAnimationFrame(() => resolve());
  setTimeout(resolve, 120);
});

export class Versus {
  constructor({ renderer, assetBase, sfx = null, music = null, onExit = null, quality = () => "high", reducedMotion = () => false }) {
    this.renderer = renderer;
    this.assetBase = assetBase;
    this.sfx = sfx;
    this.music = music;
    this.onExit = onExit;
    this.quality = quality;
    this.reducedMotion = reducedMotion;
    this.input = new VersusInput();
    this.hud = new VersusHud();
    this.lobby = new VersusLobby({ input: this.input, onStart: (setup) => this.startMatch(setup), onExit: () => this.exit() });
    this.audio = null;
    this.match = null;
    this.active = false;
    this.loading = false;
    this.paused = false;
    this.assets = null;
    this._assetsPromise = null;
  }

  /** A match is on screen (it draws the frame). */
  get running() {
    return Boolean(this.match) && !this.loading;
  }

  /** Into the lobby (from the menu). */
  openLobby() {
    if (this.active) return;
    this.active = true;
    setVersusActive(true);
    document.body.classList.add("vs-active");
    this.input.attach();
    this.lobby.open();
    // A click opened it: sound is allowed now.
    this.audio ??= new MeltdownAudio({ volume: 0.75 });
    this.audio.useSamples = Boolean(this.sfx);
    this.audio.start();
    this.preload();
  }

  /** Start streaming the models (while the lobby is up). */
  preload() {
    this._assetsPromise ??= loadMeltdownAssets(this.assetBase, { names: MODELS }).then((map) => (this.assets = map));
    return this._assetsPromise;
  }

  /** Both ready: build the match (behind its loading card), then fight. */
  async startMatch(setup) {
    if (this.match || this.loading) return;
    this.loading = true;
    this.lobby.close();
    this.hud.show();
    this.hud.loading(true, 0.1, "LOADING THE MODELS");
    this.music?.playStage?.("roof");
    this.sfx?.startLevel?.();
    this.sfx?.preloadStage?.("roof");
    this.sfx?.preloadStage?.("common");
    try {
      await this.preload();
      if (!this.active) return;
      this.hud.loading(true, 0.45, "BUILDING THE ROOF");
      await nextFrame();
      if (!this.active) return;
      this._saveRenderer();
      const match = new VersusMatch({ renderer: this.renderer, assets: this.assets, assetBase: this.assetBase, setup, input: this.input, hud: this.hud, sfx: this.sfx, audio: this.audio });
      match.reducedMotion = this.reducedMotion();
      match.split.bloom.enabled = this.quality() !== "low";
      this.hud.loading(true, 0.8, "COMPILING SHADERS");
      await nextFrame();
      if (!this.active) { match.dispose(); return; }
      match.prewarm();
      this.match = match;
      this.paused = false;
      match.begin();
      document.body.classList.add("vs-running");
    } catch (error) {
      console.error("[versus] could not start the match", error);
      this.exit();
      return;
    } finally {
      this.loading = false;
      this.hud.loading(false);
    }
  }

  /** One frame of whatever is up. */
  update(dt, time) {
    if (!this.active) return;
    this.input.poll(dt);
    if (this.lobby.isOpen) {
      this.lobby.update(dt);
      return;
    }
    const match = this.match;
    if (!match || this.loading) return;
    const intents = match.players.map((p) => this.input.read(p.device));

    if (match.phase === "over") {
      if (intents.some((i) => i.confirm) || this.input.pressed.has("Enter")) this.rematch();
      else if (intents.some((i) => i.rounds) || this.input.pressed.has("KeyL")) this.backToLobby();
      else if (intents.some((i) => i.back) || this.input.escape) this.exit();
      else match.update(dt, time);
      return;
    }
    // A pad unplugged mid-match: hold everything until it's back.
    const lost = match.players.find((p) => p.device.startsWith("pad:") && !this.input.pad(p.device));
    if (this.paused) {
      if (this.input.escape || intents.some((i) => i.pause || i.confirm)) { if (!lost) this.setPaused(false); }
      else if (intents.some((i) => i.back) || this.input.pressed.has("KeyQ")) this.exit();
      return;
    }
    if (lost || this.input.escape || intents.some((i) => i.pause)) {
      this.setPaused(true, lost ? `${lost.team.label}'S CONTROLLER IS DISCONNECTED` : "");
      return;
    }
    document.body.classList.toggle("vs-aiming", match.players.some((p) => p.device === "keys-left") && this.input.mouse.used);
    match.update(dt, time);
    if (match.phase === "over" && !this._winnerShown) this._showWinnerButtons();
  }

  render() {
    this.match?.render();
  }

  setPaused(on, note = "") {
    if (!this.match) return;
    this.paused = on;
    this.match.paused = on;
    document.body.classList.toggle("vs-aiming", false);
    const pad = this.match.players.find((p) => p.device.startsWith("pad:"));
    const kind = pad ? this.input.pad(pad.device)?.kind ?? "xbox" : null;
    this.hud.pause(on, {
      onResume: () => this.setPaused(false),
      onQuit: () => this.exit(),
      hints: { resume: kind ? `Esc / ${glyph(pad.device, "confirm", kind)}` : "Esc", quit: kind ? `Q / ${glyph(pad.device, "back", kind)}` : "Q" },
    });
    if (on && note) this.hud.pauseEl.querySelector("h2").textContent = note;
    const ctx = this.audio?.ctx;
    if (ctx) on ? ctx.suspend() : ctx.resume();
    this.sfx?.setPaused?.(on);
  }

  _showWinnerButtons() {
    this._winnerShown = true;
    const pad = this.match.players.find((p) => p.device.startsWith("pad:"));
    const kind = pad ? this.input.pad(pad.device)?.kind ?? "xbox" : null;
    const g = (a, key) => (kind ? `${key} / ${glyph(pad.device, a, kind)}` : key);
    // The match filled the card; the buttons are wired here (they leave the match).
    const card = this.hud.winnerEl;
    card.querySelector("[data-act=rematch]").onclick = () => this.rematch();
    card.querySelector("[data-act=lobby]").onclick = () => this.backToLobby();
    card.querySelector("[data-act=menu]").onclick = () => this.exit();
    card.querySelector("[data-act=rematch] kbd").textContent = g("confirm", "Enter");
    card.querySelector("[data-act=lobby] kbd").textContent = g("alt", "L");
    card.querySelector("[data-act=menu] kbd").textContent = g("back", "Esc");
    this.music?.playTheme?.();
  }

  /** The same two, again. */
  rematch() {
    if (!this.match) return;
    this._winnerShown = false;
    this.hud.winnerEl.hidden = true;
    this.music?.playStage?.("roof");
    this.match.begin();
  }

  /** Change who is playing: back to the lobby, the match torn down. */
  backToLobby() {
    this._teardown();
    this.lobby.open();
  }

  /** All the way out, to the main menu. */
  exit() {
    if (!this.active) return;
    this._teardown();
    this.lobby.close();
    // Out to the menu: the seats are empty next time (Change players keeps them).
    this.lobby.slots = [null, null];
    this.input.detach();
    this.active = false;
    setVersusActive(false);
    document.body.classList.remove("vs-active");
    this.audio?.stop?.();
    this.audio = null;
    this.sfx?.cleanupLevel?.();
    this.onExit?.();
  }

  _teardown() {
    this._winnerShown = false;
    this.paused = false;
    document.body.classList.remove("vs-running", "vs-aiming");
    this.hud.hide();
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    this._restoreRenderer();
    this.audio?.setRotor?.(0);
  }

  _saveRenderer() {
    const r = this.renderer;
    this._saved = { pixelRatio: r.getPixelRatio(), exposure: r.toneMappingExposure, autoClear: r.autoClear };
    // The roof is fill-rate bound and drawn twice: ratio 1 at most.
    r.setPixelRatio(Math.min(devicePixelRatio, 1));
    r.setSize(innerWidth, innerHeight);
  }

  /** Back as the single-player game had it: full-screen viewport, no scissor. */
  _restoreRenderer() {
    const r = this.renderer;
    if (this._saved) {
      r.setPixelRatio(this._saved.pixelRatio);
      r.toneMappingExposure = this._saved.exposure;
      r.autoClear = this._saved.autoClear;
      this._saved = null;
    }
    r.setSize(innerWidth, innerHeight);
    r.setScissorTest(false);
    r.setViewport(0, 0, innerWidth, innerHeight);
    r.setScissor(0, 0, innerWidth, innerHeight);
  }

  resize() {
    if (!this.match) return;
    this.renderer.setSize(innerWidth, innerHeight);
    this.match.split.resize();
  }

  /* ---------------- For the checks ---------------- */

  /** Skip the lobby: start a match with these devices (debug and tests). */
  quickStart({ devices = ["pad:0", "pad:1"], characters = ["playerFemale", "playerMale"], wins = 2, split = "v" } = {}) {
    if (!this.active) this.openLobby();
    return this.startMatch({ players: devices.map((device, i) => ({ device, character: characters[i], skin: "light" })), wins, split });
  }

  get state() {
    return {
      active: this.active, running: this.running, loading: this.loading, paused: this.paused,
      lobby: this.lobby.isOpen ? { slots: this.lobby.slots.map((s) => s && { ...s }), options: { ...this.lobby.options }, countdown: this.lobby.countdown } : null,
      match: this.match?.snapshot() ?? null,
    };
  }
}
