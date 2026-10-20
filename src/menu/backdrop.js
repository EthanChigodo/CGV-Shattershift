/**
 * The menus' backdrop: the live 3D stage (stage.js) wired to the menus.
 * main.js holds one of these and calls three things; everything else about
 * which shot, which figure and when is decided here.
 *
 *   const backdrop = new MenuBackdrop({ renderer, assetBase, quality: () => q, reducedMotion: () => b, figure: () => spec });
 *   backdrop.preload();                          // at boot: streams in the background
 *   // in the menus (state "intro"), each frame:
 *   if (backdrop.update(dt, { versus })) ...     // true: the stage is up (skip the old backdrop)
 *   if (backdrop.render(postfx)) return;         // drew the frame through the post chain
 *
 *  - Shots follow the menu: whichever `.screen` is active (a MutationObserver
 *    on their class attribute) maps to a shot (SCREEN_SHOTS); the Versus
 *    lobby has its own. Anything else can ask for one: requestMenuShot(name)
 *    (a window "menu:shot" event), e.g. an overlay that is not a .screen.
 *  - Subject 07 follows the loadout: a window "loadout:change" event with
 *    { character, skin, hair } (main.js sends it from the pickers).
 *  - It never blocks the menus: until the stage is in (or if it fails) the
 *    host keeps its old backdrop; when it arrives it fades up from black.
 *  - It costs nothing during a run: the host stops calling update/render
 *    when it leaves the menus. Coming back (main.js drops the body's
 *    "pregame" class for a run) cuts to the current shot and fades up.
 */

import { MenuStage } from "./stage.js";

/** Which shot each menu page gets (ids of the `.screen` sections in index.html). */
export const SCREEN_SHOTS = {
  storyScreen: "title",
  startScreen: "title",
  appearanceScreen: "appearance",
  newGameScreen: "newgame",
  chaptersScreen: "chapters",
  endlessScreen: "endless",
  settingsScreen: "dim",
  manualScreen: "dim",
  creditsScreen: "dim",
  reportScreen: "dim",
};

/** Ask the menu stage for a shot (SHOTS in shots.js) from anywhere in the UI. */
export function requestMenuShot(name) {
  dispatchEvent(new CustomEvent("menu:shot", { detail: { shot: name } }));
}

export class MenuBackdrop {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {string} o.assetBase                        assets/meltdown/ URL
   * @param {() => string} o.quality                    "low" | "medium" | "high"
   * @param {() => boolean} o.reducedMotion
   * @param {() => {character:string, skin:string, hair:string}} o.figure  the saved loadout
   */
  constructor({ renderer, assetBase, quality, reducedMotion, figure }) {
    this.renderer = renderer;
    this.assetBase = assetBase;
    this.quality = quality;
    this.reducedMotion = reducedMotion;
    this.figure = figure;
    this.stage = null;
    this.failed = false;
    this.showing = false;
    this.requested = null;
    this.screenShot = "title";
    this.away = true; // nothing shown yet: the first frame cuts and fades up

    this._onScreens = () => {
      this.screenShot = this._activeScreenShot();
      // A page change overrides an earlier request.
      this.requested = null;
    };
    this.observer = new MutationObserver(this._onScreens);
    for (const el of document.querySelectorAll(".screen")) this.observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    // A run started (main.js keeps "pregame" on the body only on the menus).
    this.bodyObserver = new MutationObserver(() => {
      if (!document.body.classList.contains("pregame")) this.away = true;
    });
    this.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.screenShot = this._activeScreenShot();
    this._onShot = (e) => { this.requested = e.detail?.shot ?? null; };
    this._onLoadout = (e) => this.stage?.setFigure(e.detail ?? {});
    this._onResize = () => this.stage?.resize(innerWidth, innerHeight);
    addEventListener("menu:shot", this._onShot);
    addEventListener("loadout:change", this._onLoadout);
    addEventListener("resize", this._onResize);
  }

  _activeScreenShot() {
    for (const el of document.querySelectorAll(".screen.active")) {
      if (SCREEN_SHOTS[el.id]) return SCREEN_SHOTS[el.id];
    }
    return this.screenShot ?? "title";
  }

  /** Start building the stage (models stream in the background). Safe to call twice. */
  preload() {
    if (this.stage || this.failed || this._pending) return;
    // (A moment later: the boot's loading screen gets its first frames first.)
    this._pending = setTimeout(() => this._create(), 80);
  }

  _create() {
    if (this.stage || this.failed) return;
    try {
      this.stage = new MenuStage({
        renderer: this.renderer,
        quality: this.quality(),
        reducedMotion: this.reducedMotion(),
        assetBase: this.assetBase,
        figure: this.figure(),
      });
      this.stage.resize(innerWidth, innerHeight);
      this.stage.ready.catch(() => { this.failed = true; });
    } catch (error) {
      console.warn("[menu stage] could not be built; keeping the old backdrop", error);
      this.failed = true;
      this.stage = null;
    }
  }

  /** The stage is built and can draw. */
  get live() {
    return !!this.stage && this.stage.isReady && !this.failed;
  }

  /** The shot the menus want now. */
  get shot() {
    return this._versus ? "versus" : this.requested ?? this.screenShot;
  }

  /**
   * One frame of the menus. Returns true when the stage is up (the host
   * should then skip its own backdrop).
   */
  update(dt, { versus = false } = {}) {
    this.preload();
    this.showing = this.live;
    if (!this.showing) return false;
    const stage = this.stage;
    const back = this.away;
    this.away = false;
    this._versus = versus;
    stage.setQuality(this.quality());
    stage.setReducedMotion(this.reducedMotion());
    const shot = this.shot;
    if (back) {
      // First frame, or back from a run: the right shot at once, up from black.
      stage.rig.cut(shot);
      stage.shot = shot;
      stage.fade = 1;
      stage.fadeTarget = 0;
    } else if (shot !== stage.shot) stage.setShot(shot);
    stage.update(dt, this._postfx);
    return true;
  }

  /** Draw the stage through the post chain. False when it is not up. */
  render(postfx) {
    this._postfx = postfx;
    if (!this.showing || !this.live) return false;
    this.stage.render(postfx);
    return true;
  }

  /** For a host compiling behind a loading screen: [[scene, camera]] once built. */
  warmTargets() {
    return this.live ? [this.stage.warmTarget] : [];
  }

  dispose() {
    clearTimeout(this._pending);
    this.failed = true; // (no rebuilding after this)
    this.observer.disconnect();
    this.bodyObserver.disconnect();
    removeEventListener("menu:shot", this._onShot);
    removeEventListener("loadout:change", this._onLoadout);
    removeEventListener("resize", this._onResize);
    this.stage?.dispose();
    this.stage = null;
    this.showing = false;
  }
}
