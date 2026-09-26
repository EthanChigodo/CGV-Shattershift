/**
 * Level 3 - The Meltdown, as one self-contained game module.
 *
 * Everything the level needs around MeltdownLevel (Phase A) and RoofLevel
 * (Phase B): its own scene, camera and post-processing, the player's body and
 * launcher, the runner's movement rules, four camera rigs, vitality, balls,
 * overheat and power-ups, the launcher's light, the HUD, the audio, the lift
 * cutscenes and the hand-over to the roof. A host only has to give it a
 * renderer, forward input, and call `update` and `render` each frame:
 *
 *   const game = new MeltdownGame({ renderer, assetBase });
 *   game.events.on("complete", (result) => ...);   // escaped the roof
 *   game.events.on("failed", (result) => ...);     // died / left behind
 *   await game.load();                              // build + stream models
 *   game.show();
 *   game.begin();                                   // the lift doors open
 *   // each frame:  game.update(dt, time); game.render();
 *   // input:       game.onKeyDown(e) / onKeyUp(e) / onPointerMove(x, y) /
 *   //              onPointerDown(e) / onPointerUp(e)
 *
 * main.js runs it as Level 3 of the full game; preview/meltdown.html runs it
 * on its own (with the dev keys R and P, and its own end-of-run card).
 *
 * Phases:
 *   idle        built, waiting for begin()
 *   arrive      the lift at the start: doors open, the player runs out
 *   run         Phase A - the escape
 *   depart      into the lift at the end, doors close, fade to black
 *   fade        black while the roof is built
 *   roofArrive  the roof's lift doors open, the player walks out
 *   roof        Phase B - the fight
 *   ending      a roof ending cutscene (climb, or the leap for the ladder)
 *   over        finished - "complete" or "failed" has been emitted
 */

import * as THREE from "../../three.js";
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment } from "../../three-addons.js";
import { MeltdownLevel, BEATS, LANES } from "./index.js";
import { Projectiles, Debris } from "./effects.js";
import { loadMeltdownAssets, MELTDOWN_ASSETS } from "./assets.js";
import { PlayerAvatar } from "./player.js";
import { LauncherLight } from "./flashlight.js";
import { createGradePass } from "./post.js";
import { createEnvironmentDimmer } from "./lighting.js";
import { RoofLevel, ROOF_SPAWN } from "./roof.js";
import { createCreditsPanel } from "./credits.js";
import { MeltdownHud } from "../../ui/meltdown-hud.js";
import { MeltdownAudio } from "../../audio/meltdown-audio.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                               */
/* ------------------------------------------------------------------ */

export const START_VITALITY = 100;
export const START_BALLS = 26;
const MAX_BALLS = 45;
const HIT_VITALITY = 14;
const HIT_FIRE_BURST = 6;
const HIT_BALL_DROP_RATIO = 0.25;
const HEAT_PER_SHOT = 9;
const HEAT_COOL_RATE = 16;
const HEAT_LOCKOUT_SECONDS = 3;
const WEAKENED_SECONDS = 6;
const FIRE_INTERVAL = 0.13; // held trigger: ~7.5 shots a second
const BALL_SPEED = 72;

/*
 * Movement feel. Lane changes are a critically damped spring rather than a
 * lerp: they start fast, never overshoot, and a second tap mid-change
 * carries the momentum on instead of restarting the curve. Jumps rise under
 * normal gravity and fall under heavier gravity (snappier, same apex, same
 * collider-proven 1.5 m clearance). Inputs are buffered so a jump pressed a
 * moment before landing still happens, and a slide pressed in the air
 * slams you down into it - the two things that make a runner feel like it
 * listens.
 */
const LANE_OMEGA = 15.5;
const JUMP_VELOCITY = 7.6;
const RISE_GRAVITY = 19;
const FALL_GRAVITY = 27;
const SLAM_VELOCITY = -16;
const INPUT_BUFFER = 0.16;
const SLIDE_SECONDS = 0.7;

/*
 * Phase B. On the roof the player moves freely: WASD relative to the camera
 * (which looks north, toward the helipad), the mouse aims, Space dodges -
 * a quick sidestep with a moment of invulnerability, which is also how you
 * make a charging patient miss and carry on over the ledge.
 */
const ROOF_SPEED = 6.4;
const DODGE_SPEED = 13;
const DODGE_SECONDS = 0.24;
const ROOF_NAMES = ["scientistRadioman", "scientistRust", "patient", "helicopter", "gadgetBrass", "gadgetCoil", "ventFan", "utilityBox", "alarmLight"];

/** The playable characters: asset key -> label. The first is the default. */
export const CHARACTERS = { playerFemale: "Female", playerMale: "Male" };
export const DEFAULT_CHARACTER = "playerFemale";
const CHARACTER_KEY = "meltdown.character";

/** The saved character choice (shared by the game's start screen and the preview). */
export function savedCharacter() {
  try {
    const saved = localStorage.getItem(CHARACTER_KEY);
    if (saved && CHARACTERS[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_CHARACTER;
}

export function saveCharacter(name) {
  if (!CHARACTERS[name]) return;
  try {
    localStorage.setItem(CHARACTER_KEY, name);
  } catch {
    /* ignore */
  }
}

const CAMERA_MODES = ["CHASE", "FIRST PERSON", "CINEMATIC", "ORBIT"];
const POWERUP_LABELS = { coolant: "COOLANT", adrenaline: "ADRENALINE", overcharge: "OVERCHARGE", barrier: "BARRIER" };
const FOG_CALM = new THREE.Color(0x1a120d);
const FOG_DANGER = new THREE.Color(0x2a0804);
// In the dark beat the fog is smoke with nothing lighting it.
const FOG_DARK = new THREE.Color(0x050404);
const FOG_ROOF = new THREE.Color(0x0c0d12);
const BASE_FOV = 72;
const BASE_EXPOSURE = 0.95;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * One step of a critically damped spring, solved exactly rather than
 * integrated: stable at any frame rate. (Plain Euler on a spring this stiff
 * overshoots and oscillates once a frame takes 40-50 ms, which on lab
 * hardware it sometimes will.) Returns [position, velocity].
 */
function spring(x, v, target, omega, dt) {
  const offset = x - target;
  const e = Math.exp(-omega * dt);
  const k = v + omega * offset;
  return [target + (offset + k * dt) * e, (v - omega * k * dt) * e];
}

function createEmitter() {
  const handlers = new Map();
  return {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name)?.delete(fn);
    },
    emit(name, payload) {
      for (const fn of handlers.get(name) ?? []) fn(payload);
    },
    clear() {
      handlers.clear();
    },
  };
}

/** Stand-in for MeltdownAudio when the host wants the level silent. */
const SILENT_AUDIO = new Proxy({}, { get: (_, key) => (key === "ready" ? false : () => {}) });

export class MeltdownGame {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {string} o.assetBase     URL of assets/meltdown/
   * @param {string} [o.character]   CHARACTERS key
   * @param {boolean} [o.audio]      false = silent
   * @param {boolean} [o.reducedMotion]
   * @param {boolean} [o.devKeys]    R restarts, P skips to the roof, F dev stats
   * @param {boolean} [o.summary]    show the level's own end-of-run card
   */
  constructor({ renderer, assetBase, character = savedCharacter(), audio = true, reducedMotion = false, devKeys = false, summary = false, container = document.body }) {
    this.renderer = renderer;
    this.assetBase = assetBase;
    this.character = CHARACTERS[character] ? character : DEFAULT_CHARACTER;
    this.reducedMotion = reducedMotion;
    this.options = { devKeys, summary };
    this.events = createEmitter();

    /* ---- Scene, camera, post ---- */
    const scene = new THREE.Scene();
    scene.name = "MeltdownScene";
    scene.background = FOG_CALM.clone();
    scene.fog = new THREE.FogExp2(FOG_CALM.clone(), 0.012);
    // A pre-filtered environment for reflections. Without one, every metallic
    // PBR surface - steel walls, the imported props, the launcher - renders
    // close to black, because metal only shows what it reflects.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    scene.environment = this.envTexture;
    pmrem.dispose();
    this.scene = scene;

    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, size.x / size.y, 0.05, 320);
    scene.add(this.camera);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Bloom sells fire, lasers and emissive glass; at half resolution,
    // because a full-res bloom chain would double the fill-rate cost. The
    // grading pass (heat haze, hit split, vignette, grain) runs last.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = createGradePass();
    this.grade.uniforms.uResolution.value.set(size.x, size.y);
    this.composer.addPass(this.grade);

    /* ---- HUD, audio, effects ---- */
    this.hud = new MeltdownHud({ container, dev: false, reducedMotion });
    this.audio = audio ? new MeltdownAudio({ volume: 0.8 }) : SILENT_AUDIO;
    this.projectiles = new Projectiles(scene);
    this.debris = new Debris(scene);
    this.beam = new LauncherLight(scene);
    this.environment = createEnvironmentDimmer(scene);
    this.credits = createCreditsPanel(container);

    const el = (className) => {
      const node = document.createElement("div");
      node.className = className;
      node.hidden = true;
      container.append(node);
      return node;
    };
    this.ui = { reticle: el("mlt-reticle"), fade: el("mlt-fade"), letterbox: el("mlt-letterbox") };
    this.ui.fade.hidden = false;
    this.ui.letterbox.hidden = false;
    this.fade = { value: 0, target: 0, rate: 1.6, override: null };

    /* ---- Player ---- */
    this.avatar = new PlayerAvatar();
    scene.add(this.avatar.root);
    this.launcher = { rig: new THREE.Group(), muzzle: new THREE.Object3D(), model: null, heatMaterials: [], recoil: 0 };
    this.launcher.rig.add(this.launcher.muzzle);
    // Stand-in until the model loads: a simple tube.
    this.launcherStandIn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0x3d4a3a, metalness: 0.6, roughness: 0.5 }));
    this.launcherStandIn.rotation.x = Math.PI / 2;
    this.launcher.rig.add(this.launcherStandIn);
    this.launcher.muzzle.position.set(0, 0.02, -0.66);

    this.runner = {};
    this._resetRunner();
    this.hero = {
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), knock: new THREE.Vector3(),
      dodge: 0, dodgeCooldown: 0, dodgeDir: new THREE.Vector3(), yaw: 0, lastShot: 99, aim: new THREE.Vector3(),
    };
    this.held = new Set();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.15);

    /* ---- State ---- */
    this.phase = "idle";
    this.level = null;
    this.roof = null;
    this.roofAssets = null;
    this.roofAssetsPromise = null;
    /** Dev/test overrides for the roof, e.g. { heliSeconds: 10 }. */
    this.roofOptions = {};
    this.assetsReady = false;
    this.visible = false;
    this.paused = false;
    this.cameraMode = 0;
    this.trauma = 0;
    this.hitFlash = 0;
    this.warp = { active: false, t: 0 };
    this.snapCamera = true;
    this.landingDip = 0;
    this.cameraRoll = 0;
    this.clock = 0;
    this.roofClock = 0;
    this._timers = [];
    this.cut = null;

    this._v = {
      desired: new THREE.Vector3(), look: new THREE.Vector3(), smoothedLook: new THREE.Vector3(),
      behind: new THREE.Vector3(), camVelocity: new THREE.Vector3(), warpUp: new THREE.Vector3(),
      aim: new THREE.Vector3(), muzzle: new THREE.Vector3(), fireDir: new THREE.Vector3(), forwardVel: new THREE.Vector3(),
      laneRight: new THREE.Vector3(), beamTarget: new THREE.Vector3(),
      boxCentre: new THREE.Vector3(), boxSize: new THREE.Vector3(),
    };
    this.playerBox = new THREE.Box3();
  }

  /* ================================================================ */
  /* Lifecycle                                                         */
  /* ================================================================ */

  _resetRunner() {
    Object.assign(this.runner, {
      distance: 0, lane: 1, lateral: 0, lateralVel: 0, height: 0, verticalVelocity: 0, sliding: 0,
      jumpBuffer: 0, slideBuffer: 0, landed: 0,
      vitality: START_VITALITY, balls: START_BALLS, alive: true, invulnerable: 0, slow: 0,
      finished: false, heat: 0, lockout: 0, weakened: 0, coolant: 0, adrenaline: 0,
      overchargeShots: 0, barrierShield: 0, fireDistance: -45, lookBack: 0, pushing: false,
      firing: false, fireCooldown: 0, hits: 0, shots: 0, breaks: 0, downs: 0, speed: 0,
      baseSpeed: this.level ? this.level.speedAt(0) : 8.2,
    });
  }

  /** Start fetching every model now (cached); the level can be built later. */
  preload() {
    const names = [...Object.keys(MELTDOWN_ASSETS), this.character];
    this._preload ??= loadMeltdownAssets(this.assetBase, { names }).catch(() => null);
    this.loadRoofAssets();
    return this._preload;
  }

  /** Roof models load in the background while Phase A is being played. */
  loadRoofAssets() {
    this.roofAssetsPromise ??= loadMeltdownAssets(this.assetBase, { names: ROOF_NAMES }).then((map) => (this.roofAssets = map));
    return this.roofAssetsPromise;
  }

  /**
   * Build Phase A (tearing down any previous attempt), park the player in
   * the arrival lift and stream the models in. Resolves once they are in
   * and every shader is compiled. The level is usable before that, with
   * stand-ins.
   */
  async load({ balls = START_BALLS, vitality = START_VITALITY } = {}) {
    if (this.level) {
      this.hud.unbind();
      this.level.dispose();
    }
    if (this.roof) {
      this.roof.dispose();
      this.roof = null;
    }
    this._timers.length = 0;
    this.phase = "idle";
    this.cut = null;
    this.fade.value = this.fade.target = 0;
    this.fade.override = null;
    this.ui.letterbox.classList.remove("on");
    this.hud.vitals.style.visibility = "";
    this.avatar.hold = 1;
    this.avatar.reachUp = 0;
    this.audio.setRotor(0);
    this.avatar.setVisible(true);
    this.avatar.shadow.visible = true;
    this.scene.fog.density = 0.012;
    this.projectiles.clear();
    this.debris.clear();
    this.assetsReady = false;
    this.clock = 0;

    const level = new MeltdownLevel({ origin: new THREE.Vector3(0, 0, 0) });
    this.level = level;
    level.addTo(this.scene);
    this.hud.bind(level);
    this.hud.hideSummary();
    this._bindLevelEvents(level);

    this._resetRunner();
    Object.assign(this.runner, { balls, vitality });
    this.trauma = 0;
    this.hitFlash = 0;
    this.warp = { active: false, t: 0 };
    this.snapCamera = true;
    this.hud.setVitality(this.runner.vitality);
    this.hud.setBalls(this.runner.balls);
    this.hud.setDanger(0);
    this.cut = level.beginArrival();
    this._applyCutscene(this.cut, 0);

    // Models stream in; the level is playable with stand-ins meanwhile.
    this.hud.setLoading(0);
    const [loaded] = await Promise.all([level.loadAssets(this.assetBase, { onProgress: (r) => this.hud.setLoading(r) }), this._loadCharacter(this.character)]);
    if (level !== this.level) return;
    this.hud.setLoading(null);
    this._mountLauncherModel(loaded);
    // Compile and upload everything now rather than on first sight mid-run.
    level.prewarm(this.renderer, this.camera);
    this.environment.refresh();
    this.assetsReady = true;
    this.loadRoofAssets();
  }

  /** The lift doors open and the run begins. */
  begin() {
    this.audio.start();
    if (this.phase === "idle" && this.level) this.phase = "arrive";
  }

  /** Dev: start over (R in the preview). */
  async restart() {
    await this.load();
    this.begin();
  }

  show() {
    this.visible = true;
    document.body.classList.add("mlt-active");
    this.syncRenderer();
    this.hud.show();
    this.ui.reticle.hidden = false;
  }

  hide() {
    this.visible = false;
    document.body.classList.remove("mlt-active");
    this.hud.hide();
    this.ui.reticle.hidden = true;
    this.ui.letterbox.classList.remove("on");
    this.ui.fade.style.opacity = "0";
    this.credits.toggle(false);
    this.runner.firing = false;
    this.held.clear();
  }

  /** Pause or resume: freezes nothing by itself (the host stops calling update), but silences the level. */
  setPaused(paused) {
    this.paused = paused;
    this.runner.firing = false;
    this.held.clear();
    const ctx = this.audio === SILENT_AUDIO ? null : this.audio.ctx;
    if (ctx) {
      if (paused) ctx.suspend();
      else ctx.resume();
    }
  }

  /** Stop everything and free the level (the game object can be reused with load()). */
  unload() {
    this.hide();
    if (this.level) {
      this.hud.unbind();
      this.level.dispose();
      this.level = null;
    }
    this.roof?.dispose();
    this.roof = null;
    this.projectiles.clear();
    this.debris.clear();
    this.audio.stop();
    this.phase = "idle";
  }

  dispose() {
    this.unload();
    this.projectiles.dispose?.();
    this.beam.dispose?.();
    this.hud.dispose();
    this.credits.panel.remove();
    for (const node of Object.values(this.ui)) node.remove();
    this.composer.dispose?.();
    this.envTexture.dispose();
    this.events.clear();
  }

  /** After the host changes the renderer's pixel ratio or size. */
  syncRenderer() {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    const size = this.renderer.getSize(new THREE.Vector2());
    this.resize(size.x, size.y);
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width / 2, height / 2);
    this.grade.uniforms.uResolution.value.set(width, height);
  }

  setCharacter(name) {
    if (!CHARACTERS[name]) return;
    this.character = name;
    saveCharacter(name);
    this._loadCharacter(name);
  }

  setReducedMotion(value) {
    this.reducedMotion = value;
    this.hud.setReducedMotion?.(value);
  }

  setBloom(on) {
    this.bloom.enabled = on;
  }

  get cameraModeName() {
    return CAMERA_MODES[this.cameraMode];
  }

  /** Where the player is, for a status line. */
  get locationName() {
    if (!this.level) return "";
    if (this.phase === "roof" || this.phase === "roofArrive" || this.phase === "ending" || (this.phase === "over" && this.roof)) return "THE ROOF";
    const d = this.runner.distance;
    return this.level.hallAt(d)?.name ?? this.level.beatAt(d).name;
  }

  /** Numbers for the host's end screen and score. */
  get stats() {
    const r = this.runner;
    return {
      time: this.clock,
      roofTime: this.roofClock,
      distance: r.distance,
      total: this.level?.route.totalLength ?? 0,
      shots: r.shots,
      breaks: r.breaks,
      downs: r.downs,
      hits: r.hits,
      falls: this.roof?.state.falls ?? 0,
      balls: r.balls,
      vitality: r.vitality,
      onRoof: Boolean(this.roof),
      ending: this.roof?.state.ending ?? null,
    };
  }

  _after(seconds, fn) {
    this._timers.push({ at: this.clock + seconds, fn });
  }

  async _loadCharacter(name) {
    const loaded = await loadMeltdownAssets(this.assetBase, { names: [name] });
    const asset = loaded.get(name);
    if (asset && name === this.character) this.avatar.setModel(asset.template);
  }

  _mountLauncherModel(assets) {
    const asset = assets.get("launcher");
    const launcher = this.launcher;
    if (!asset || launcher.model) return;
    const model = asset.template.clone(true);
    // The source model's long axis is X; turn it to point down -Z and scale
    // it to a ~1.25 m shoulder launcher.
    const length = Math.max(asset.size.x, asset.size.z);
    model.scale.setScalar(1.25 / length);
    model.rotation.y = Math.PI / 2;
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    // Heat glow: the launcher gets its own material copies.
    model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0xff3a10);
        o.material.emissiveIntensity = 0;
        launcher.heatMaterials.push(o.material);
      }
    });
    this.launcherStandIn.visible = false;
    launcher.model = model;
    launcher.rig.add(model);
  }

  _bindLevelEvents(level) {
    const { hud, audio, debris } = this;
    const on = (name, fn) => level.events.on(name, (p) => level === this.level && fn(p));
    on("complete", () => this._startDeparture());
    on("timer-expired", () => {
      if (this.phase !== "run") return;
      this.runner.vitality = 0;
      this._finishRun(false, "THE BUILDING WENT UP");
    });
    on("warp-start", () => {
      this.warp = { active: true, t: 0 };
      audio.warp();
    });
    on("warp-tick", ({ t }) => (this.warp.t = t));
    on("warp-end", () => (this.warp.active = false));
    on("hazard-land", ({ kind, position }) => {
      debris.burst(position, { kind: kind === "duct" ? "metal" : "concrete", count: 30, speed: 5 });
      debris.dust(position, { size: kind === "shelf" ? 6 : 5 });
      debris.sparks(position, { count: 16 });
      const near = Math.max(0, 1 - position.distanceTo(this.avatar.root.position) / 30);
      this.trauma = Math.min(1, this.trauma + near * 0.5);
      audio.crash(0.5 + near * 0.5);
    });
    on("duct-cleared", () => audio.clang());
    on("patient-lurch", ({ position }) => audio.groan(Math.max(0.3, 1 - position.distanceTo(this.avatar.root.position) / 30)));
    on("patient-seen", () => audio.stinger());
    on("beat", ({ key }) => {
      const beat = BEATS.find((b) => b.key === key);
      if (beat?.dark) {
        audio.powerDown();
        this._after(0.9, () => {
          audio.beamOn();
          hud.showBanner("POWER FAILURE", "YOUR LAUNCHER HAS A LIGHT", 3200);
        });
      } else if (key === "stairwell") audio.powerUp();
    });
    // The lifts (placeholder cutscenes - see elevator.js).
    on("lift-arrived", () => {
      audio.crash(0.35);
      this.trauma = Math.min(1, this.trauma + 0.3);
    });
    on("lift-open", () => audio.whoosh());
    on("lift-exit", () => hud.showBanner("SECTOR 03", "THE MELTDOWN", 2600));
    on("lift-close", () => audio.clang());
    on("lift-depart", () => audio.powerUp());
  }

  /* ================================================================ */
  /* Input                                                             */
  /* ================================================================ */

  onPointerMove(clientX, clientY) {
    const size = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - size.left) / size.width) * 2 - 1;
    this.pointer.y = -((clientY - size.top) / size.height) * 2 + 1;
    this.ui.reticle.style.left = `${clientX}px`;
    this.ui.reticle.style.top = `${clientY}px`;
  }

  onPointerDown(event) {
    this.audio.start();
    if (event.button === 0) {
      this.runner.firing = true;
      this.runner.fireCooldown = 0;
    }
  }

  onPointerUp(event) {
    if (event.button === 0) this.runner.firing = false;
  }

  onBlur() {
    this.held.clear();
    this.runner.firing = false;
  }

  onKeyUp(event) {
    this.held.delete(event.code);
  }

  /** Returns true when the key was Level 3's (the host should not act on it too). */
  onKeyDown(event) {
    const code = event.code;
    this.held.add(code);
    this.audio.start();
    if (event.repeat && code !== "Space") return this._isGameKey(code);
    if (code === "KeyK") {
      this.credits.toggle();
      return true;
    }
    if (code === "KeyB") {
      this.bloom.enabled = !this.bloom.enabled;
      this.hud.toast("BLOOM", this.bloom.enabled ? "ON" : "OFF", "", 900);
      return true;
    }
    if (code === "KeyF") {
      this.hud.setDevVisible(this.hud.dev.hidden);
      return true;
    }
    if (this.options.devKeys && code === "KeyR") {
      this.restart();
      return true;
    }
    if (this.options.devKeys && code === "KeyP" && (this.phase === "run" || this.phase === "arrive")) {
      this.startRoof();
      return true;
    }
    if (this.phase === "roof" || this.phase === "roofArrive" || this.phase === "ending") {
      // The roof: WASD is movement (read from `held` each frame); Space dodges.
      if (code === "Space" && this.phase === "roof") {
        event.preventDefault?.();
        const hero = this.hero;
        // At the ledge with the ladder in reach, Space is the jump for it.
        if (this.roof?.grab(hero.position)) return true;
        if (hero.dodgeCooldown <= 0) {
          const dir = hero.velocity.lengthSq() > 0.5 ? hero.velocity.clone() : hero.aim.clone().sub(hero.position).setY(0);
          hero.dodgeDir.copy(dir.normalize());
          hero.dodge = DODGE_SECONDS;
          hero.dodgeCooldown = 0.75;
          this.runner.invulnerable = Math.max(this.runner.invulnerable, 0.32);
          this.audio.whoosh();
        }
      }
      return this._isGameKey(code);
    }
    if (this.phase !== "run") return this._isGameKey(code);
    const r = this.runner;
    if (code === "KeyA" || code === "ArrowLeft") r.lane = Math.max(0, r.lane - 1);
    if (code === "KeyD" || code === "ArrowRight") r.lane = Math.min(2, r.lane + 1);
    if (code === "Space" || code === "KeyW" || code === "ArrowUp") {
      event.preventDefault?.();
      this._jump();
    }
    if (code === "ShiftLeft" || code === "ShiftRight" || code === "KeyS" || code === "ArrowDown") r.slideBuffer = INPUT_BUFFER;
    if (code === "KeyC") this.cameraMode = (this.cameraMode + 1) % CAMERA_MODES.length;
    return this._isGameKey(code);
  }

  _isGameKey(code) {
    return /^(Key[WASDCBKF]|Arrow|Space|Shift)/.test(code);
  }

  _jump() {
    const push = this.level?.pushNearby(this.runner.distance);
    if (push) {
      this.audio.ductPush(push.progress);
      this.trauma = Math.min(1, this.trauma + 0.12);
      this.debris.sparks(this.avatar.root.position.clone().setY(1.4), { count: 6, speed: 3 });
      return;
    }
    this.runner.jumpBuffer = INPUT_BUFFER;
  }

  /* ================================================================ */
  /* Frame                                                             */
  /* ================================================================ */

  render() {
    this.composer.render();
  }

  update(dt, time) {
    dt = Math.min(dt, 0.05);
    if (!this.level) return;
    if (this.phase !== "idle" && this.phase !== "over") this.clock += dt;
    for (let i = this._timers.length - 1; i >= 0; i -= 1) {
      if (this.clock >= this._timers[i].at) this._timers.splice(i, 1)[0].fn();
    }
    this._updateFade(dt);
    const phase = this.phase;
    const onRoof = phase === "roof" || phase === "roofArrive" || phase === "ending" || (phase === "over" && this.roof) || (phase === "fade" && this.roof);
    const playing = onRoof ? phase === "roof" && this.runner.alive : phase === "run" && this.runner.alive && !this.runner.finished;
    this._updateLauncher(dt, playing);

    if (onRoof) {
      this.runner.invulnerable = Math.max(0, this.runner.invulnerable - dt);
      if (this.roof) this._updateRoofFrame(dt, time);
      this._updateRoofPresentation(dt, time, playing);
      return;
    }
    if (phase === "fade") return;
    this._updateRunFrame(dt, time, playing);
  }

  _updateFade(dt) {
    const f = this.fade;
    if (f.override !== null) f.value = f.override;
    else if (f.value !== f.target) {
      const step = dt * f.rate;
      f.value = f.value < f.target ? Math.min(f.target, f.value + step) : Math.max(f.target, f.value - step);
    }
    this.ui.fade.style.opacity = f.value.toFixed(3);
  }

  _updateLauncher(dt, playing) {
    const r = this.runner;
    // Held trigger, heat, lockout, weakened window.
    this.launcher.recoil = Math.max(0, this.launcher.recoil - dt * 7);
    r.fireCooldown -= dt;
    if (playing && r.firing && r.fireCooldown <= 0) {
      this._shoot();
      r.fireCooldown = FIRE_INTERVAL;
    }
    const wasLocked = r.lockout > 0;
    r.lockout = Math.max(0, r.lockout - dt);
    if (wasLocked && r.lockout <= 0) {
      r.heat = 0;
      r.weakened = WEAKENED_SECONDS;
      this.hud.toast("LAUNCHER WEAKENED", "", "warn", 1600);
    }
    if (r.lockout <= 0 && !(r.firing && playing)) r.heat = Math.max(0, r.heat - HEAT_COOL_RATE * dt);
    else if (r.lockout <= 0) r.heat = Math.max(0, r.heat - HEAT_COOL_RATE * 0.3 * dt);
    r.weakened = Math.max(0, r.weakened - dt);
    r.coolant = Math.max(0, r.coolant - dt);
    r.adrenaline = Math.max(0, r.adrenaline - dt);
    r.barrierShield = Math.max(0, r.barrierShield - dt);
    r.lookBack = Math.max(0, r.lookBack - dt);
  }

  /* ---------------- Phase A ---------------- */

  _updateRunFrame(dt, time, playing) {
    const { level, runner: r, avatar, camera } = this;
    const V = this._v;
    const cutscene = this.phase === "idle" || this.phase === "arrive" || this.phase === "depart";

    if (this.phase === "arrive") {
      this.cut = level.updateArrival(dt);
      if (this.cut?.done) {
        this.phase = "run";
        this.cut = null;
        r.baseSpeed = level.speedAt(0);
        this.hud.toast("A / D LANES", "SPACE JUMP // SHIFT SLIDE", "", 3600);
        this._after(2.2, () => this.hud.toast("HOLD CLICK", "TO FIRE", "", 3000));
        this.events.emit("phase", { phase: "run" });
      }
    } else if (this.phase === "depart") {
      this.cut = level.updateDeparture(dt);
      if (this.cut?.fire !== null && this.cut?.fire !== undefined) r.fireDistance = this.cut.fire;
      if (this.cut?.done) this.startRoof({ fromBlack: true });
    }

    if (!cutscene) this._updateMovement(dt, playing);

    // The fire: vitality drains steadily, and the fire front's distance
    // behind you is that vitality made visible.
    if (playing && r.adrenaline <= 0) {
      r.vitality = Math.max(0, r.vitality - level.drainRateAt(r.distance) * dt);
      if (r.vitality <= 0) {
        r.alive = false;
        this._finishRun(false, "CAUGHT BY THE FIRE");
      }
    }
    if (this.phase !== "depart") {
      const gap = 4 + r.vitality * 0.42;
      const target = r.distance - gap;
      if (!cutscene) r.fireDistance += (target - r.fireDistance) * Math.min(1, dt * (target > r.fireDistance ? 0.9 : 3));
    }
    level.setFireFront(r.fireDistance);

    const firstPerson = !cutscene && CAMERA_MODES[this.cameraMode] === "FIRST PERSON";
    if (cutscene && this.cut) {
      this._applyCutscene(this.cut, dt);
    } else {
      // The body.
      const placement = level.route.sample(r.distance, r.lateral, r.height);
      avatar.root.position.copy(placement.position);
      avatar.root.rotation.y = placement.heading;
      avatar.update(dt, {
        speed: r.speed, lateralVel: r.lateralVel, height: r.height, sliding: r.sliding > 0,
        pushing: r.pushing, stumble: r.lookBack > 0.5 ? 1 : 0, aiming: r.firing,
      });
      // Blink through the mercy window after a hit (not the long
      // "invulnerable" a test or demo teleport sets).
      const blinking = r.invulnerable > 0 && r.invulnerable < 2 && Math.floor(time * 14) % 2 === 0;
      avatar.setVisible(!firstPerson && !blinking);
      avatar.shadow.visible = !firstPerson;
    }

    level.update({ dt, time, distance: r.distance, playerPosition: avatar.root.position });
    if (playing) this._checkHazards(dt);
    if (!cutscene) this._updateCamera(dt, time);
    this._placeLauncher(firstPerson);
    this.projectiles.update(dt, { breakables: level.breakables, solids: level.obstacles, onBreakable: (o, p, b) => this._onBallBreakable(o, p, b), onSolid: (o, p) => this._onBallSolid(o, p) });
    this.debris.update(dt);

    // The launcher's light: from the muzzle toward what the reticle is on -
    // held like a weapon light, a little low, so aiming at the corridor
    // ahead also lights the floor you are about to run on.
    const darkness = level.state.darkness;
    this.raycaster.setFromCamera(this.pointer, camera);
    V.beamTarget.copy(this.raycaster.ray.origin).addScaledVector(this.raycaster.ray.direction, 24);
    V.beamTarget.y -= 1.3;
    this.launcher.muzzle.getWorldPosition(V.muzzle);
    this.beam.update(dt, { origin: V.muzzle, target: V.beamTarget, darkness, time, projectiles: this.projectiles });
    level.setFlashlight({ active: this.beam.power > 0.2, position: V.muzzle, direction: this.beam.direction(), cos: Math.cos(this.beam.angle * 0.8), range: 28 });

    // Danger: red tint, darker thicker smoke, louder fire and siren. The dark
    // beat pulls the fog to black smoke instead.
    const scene = this.scene;
    const danger = 1 - r.vitality / START_VITALITY;
    const fireNear = THREE.MathUtils.clamp(1 - (r.distance - r.fireDistance) / 45, 0, 1);
    level.setDanger(danger);
    this.hud.setDanger(Math.max(danger, fireNear * 0.8));
    scene.fog.color.copy(FOG_CALM).lerp(FOG_DANGER, danger).lerp(FOG_DARK, darkness * 0.9);
    this.environment.set(1 - darkness * 0.92);
    scene.background.copy(scene.fog.color);
    scene.fog.density = 0.011 + danger * 0.018 + (this.warp.active ? 0.01 : 0) + darkness * 0.022;
    this.renderer.toneMappingExposure = BASE_EXPOSURE - danger * 0.25 + darkness * 0.12;
    this.audio.setFireProximity(fireNear);
    this.audio.setDanger(danger);

    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const g = this.grade.uniforms;
    g.uTime.value = time;
    g.uDanger.value = danger;
    g.uDark.value = darkness;
    g.uHeat.value = this.reducedMotion ? 0 : Math.max(fireNear * fireNear, this.warp.active ? 0.5 : 0);
    g.uHit.value = this.reducedMotion ? this.hitFlash * 0.3 : this.hitFlash;

    // Reticle: hot over a target, red and pulsing when overheated.
    const reticle = this.ui.reticle;
    reticle.hidden = !this.visible || cutscene || this.phase === "over";
    reticle.classList.toggle("hot", this.raycaster.intersectObjects(level.breakables, false).length > 0);
    reticle.classList.toggle("overheated", r.lockout > 0);
    reticle.classList.toggle("weak", r.weakened > 0);

    this.hud.setVitality(r.vitality, START_VITALITY);
    this.hud.setBalls(r.balls);
    this.hud.setPrompt(this.phase !== "run" ? null : r.pushing || level.ductAhead(r.distance, 3.5) ? "MASH SPACE TO PUSH" : r.balls <= 0 && playing ? "NO BALLS" : null);
    this.hud.update({ fps: this._fps(dt), renderer: this.renderer });
  }

  _fps(dt) {
    this._fpsAcc = (this._fpsAcc ?? 0) + dt;
    this._fpsFrames = (this._fpsFrames ?? 0) + 1;
    if (this._fpsAcc >= 0.5) {
      this._fpsValue = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    return this._fpsValue ?? 0;
  }

  _updateMovement(dt, playing) {
    const r = this.runner;
    const level = this.level;
    // Forward: settle toward the beat's speed; a stumble or a fallen duct
    // takes it away.
    r.baseSpeed += (level.speedAt(r.distance) - r.baseSpeed) * Math.min(1, dt * 0.7);
    r.speed = 0;
    r.pushing = false;
    if (playing) {
      r.speed = r.baseSpeed * (r.slow > 0 ? 0.45 : 1);
      let next = Math.min(r.distance + r.speed * dt, level.route.totalLength - 1);
      const duct = level.blockingDuctAhead(r.distance, 4);
      if (duct !== null && next > duct - 1.7) {
        next = Math.max(r.distance, duct - 1.7);
        r.pushing = true;
        r.speed = 0;
      }
      r.distance = next;
    }

    // Lanes: critically damped spring toward the chosen lane.
    [r.lateral, r.lateralVel] = spring(r.lateral, r.lateralVel, LANES[r.lane], LANE_OMEGA, dt);

    // Buffered jump and slide.
    r.jumpBuffer = Math.max(0, r.jumpBuffer - dt);
    r.slideBuffer = Math.max(0, r.slideBuffer - dt);
    const grounded = r.height <= 0.001;
    if (r.jumpBuffer > 0 && grounded && playing) {
      r.verticalVelocity = JUMP_VELOCITY;
      r.jumpBuffer = 0;
      r.sliding = 0; // a jump cancels a slide
    }
    if (r.slideBuffer > 0 && playing) {
      if (grounded) {
        r.sliding = SLIDE_SECONDS;
        r.slideBuffer = 0;
      } else if (r.verticalVelocity > SLAM_VELOCITY) {
        // Slide pressed mid-air: slam down into it.
        r.verticalVelocity = SLAM_VELOCITY;
      }
    }
    const wasAirborne = r.height > 0.001;
    r.verticalVelocity -= (r.verticalVelocity > 0 ? RISE_GRAVITY : FALL_GRAVITY) * dt;
    r.height = Math.max(0, r.height + r.verticalVelocity * dt);
    if (r.height <= 0) {
      if (wasAirborne) {
        this.landingDip = Math.min(1, -r.verticalVelocity / 14);
        if (r.slideBuffer > 0) {
          r.sliding = SLIDE_SECONDS;
          r.slideBuffer = 0;
        }
      }
      r.verticalVelocity = 0;
    }
    r.sliding = Math.max(0, r.sliding - dt);
  }

  /**
   * Spring-follow the desired position. A critically damped spring (not a
   * lerp) keeps the camera's own velocity, so it glides through the
   * 90-degree turns instead of cutting the corner and never jerks when the
   * runner changes lanes mid-turn.
   */
  _follow(target, stiffness, dt) {
    const { camera } = this;
    const vel = this._v.camVelocity;
    if (this.snapCamera) {
      camera.position.copy(target);
      vel.set(0, 0, 0);
      return;
    }
    const omega = Math.sqrt(stiffness);
    for (const axis of ["x", "y", "z"]) {
      [camera.position[axis], vel[axis]] = spring(camera.position[axis], vel[axis], target[axis], omega, dt);
    }
  }

  _updateCamera(dt, time) {
    const { camera, runner: r, level } = this;
    const V = this._v;
    const mode = CAMERA_MODES[this.cameraMode];
    const reduced = this.reducedMotion;
    this.landingDip = Math.max(0, this.landingDip - dt * 3.2);
    const dip = reduced ? 0 : Math.sin(Math.min(1, this.landingDip) * Math.PI) * 0.18;

    if (mode === "FIRST PERSON") {
      const bob = reduced || r.height > 0.01 || r.speed <= 0 ? 0 : Math.abs(Math.sin(this.avatar.phase)) * 0.045;
      level.route.sample(r.distance + 0.3, r.lateral, 1.65 + r.height - this.avatar.crouch * 0.8 + bob - dip, V.desired);
      level.route.sample(r.distance + 14, r.lateral * 0.4, 1.5, V.look);
      this._follow(V.desired, 900, dt);
    } else if (mode === "CINEMATIC") {
      level.route.sample(r.distance + 8, 5.2, 3.2, V.desired);
      level.route.sample(r.distance, r.lateral, 1.4, V.look);
      this._follow(V.desired, 14, dt);
    } else if (mode === "ORBIT") {
      level.route.sample(r.distance, 0, 0, V.desired);
      V.desired.x += Math.cos(time * 0.25) * 16;
      V.desired.z += Math.sin(time * 0.25) * 16;
      V.desired.y += 9;
      level.route.sample(r.distance, 0, 2, V.look);
      this._follow(V.desired, 16, dt);
    } else {
      // Chase: pulled back a touch as speed rises, trailing the lateral move.
      const back = 6.4 + r.speed * 0.05;
      level.route.sample(r.distance - back, r.lateral * 0.62, 2.8 + r.height * 0.55 - dip, V.desired);
      level.route.sample(r.distance + 12, r.lateral * 0.3, 1.6, V.look);
      this._follow(V.desired, 70, dt);
    }

    // A stumble makes you look back at the fire gaining on you - the moment
    // the brief describes. Lasts under a second; reduced motion skips it.
    if (r.lookBack > 0 && !reduced && mode !== "ORBIT") {
      const k = Math.sin(Math.min(1, r.lookBack / 0.9) * Math.PI);
      level.route.sample(Math.max(0, r.fireDistance), 0, 2.5, V.behind);
      V.look.lerp(V.behind, k);
    }

    if (this.snapCamera) V.smoothedLook.copy(V.look);
    else V.smoothedLook.lerp(V.look, 1 - Math.exp(-dt * (r.lookBack > 0 ? 6 : 12)));
    camera.lookAt(V.smoothedLook);

    // Lean the view slightly into lane changes.
    const rollTarget = reduced || mode === "ORBIT" ? 0 : THREE.MathUtils.clamp(-r.lateralVel * 0.006, -0.05, 0.05);
    this.cameraRoll += (rollTarget - this.cameraRoll) * Math.min(1, dt * 8);
    camera.rotateZ(this.cameraRoll);

    // Speed widens the view: 72 degrees at a jog, ~79 flat out.
    let fov = BASE_FOV + (reduced ? 0 : THREE.MathUtils.clamp((r.speed - 8) * 1.1, 0, 7));
    // Reality warp: roll and up-vector drift, scaled down under reduced motion.
    if (this.warp.active) {
      const s = Math.sin(Math.min(1, this.warp.t) * Math.PI) * (reduced ? 0.3 : 1);
      camera.up.lerp(V.warpUp.set(Math.sin(time * 1.3) * 0.55 * s, 1, Math.cos(time * 0.9) * 0.3 * s).normalize(), Math.min(1, dt * 2));
      camera.rotateZ(Math.sin(time * 2.1) * 0.18 * s);
      fov += Math.sin(time * 1.7) * 9 * s;
    } else {
      camera.up.lerp(UP, Math.min(1, dt * 3));
    }
    this._setFov(fov, dt);
    this._shake(dt, 0.5, 0.4, 0.06);
    this.snapCamera = false;
  }

  _setFov(fov, dt) {
    const camera = this.camera;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  /** Trauma shake, squared so big hits are violent and the tail settles fast. */
  _shake(dt, x, y, roll) {
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    if (this.trauma <= 0.001) return;
    const amount = this.trauma * this.trauma * (this.reducedMotion ? 0.25 : 1);
    this.camera.position.x += (Math.random() * 2 - 1) * amount * x;
    this.camera.position.y += (Math.random() * 2 - 1) * amount * y;
    if (roll) this.camera.rotateZ((Math.random() * 2 - 1) * amount * roll);
  }

  /**
   * Apply a cutscene frame (the lifts, the roof endings): the level says
   * where the camera is and looks, where the player is and what they do.
   */
  _applyCutscene(cut, dt, sdt = dt) {
    const { avatar, camera } = this;
    const V = this._v;
    avatar.root.position.copy(cut.player);
    avatar.root.rotation.y = cut.playerYaw;
    avatar.setVisible(!cut.hidePlayer);
    avatar.shadow.visible = !cut.hidePlayer && cut.action !== "jump" && cut.action !== "hang";
    avatar.hold = cut.hold ?? 1;
    avatar.reachUp = cut.reachUp ?? 0;
    const speed = cut.speed ?? (cut.action === "run" ? 9 : cut.action === "climb" ? 2.5 : 0);
    avatar.update(sdt, { speed, height: cut.action === "jump" ? 1 : 0, aiming: false });
    // The lift cutscenes are already smooth: follow them exactly. The roof
    // endings cut between framings, so ease into each.
    const exact = cut.kind === "arrival" || cut.kind === "departure";
    if (this.snapCamera || exact) camera.position.copy(cut.camera);
    else camera.position.lerp(cut.camera, 1 - Math.exp(-dt * 3));
    if (this.snapCamera || exact) V.smoothedLook.copy(cut.look);
    else V.smoothedLook.lerp(cut.look, 1 - Math.exp(-dt * 4));
    camera.up.copy(UP);
    camera.lookAt(V.smoothedLook);
    this._setFov(BASE_FOV, dt);
    if (cut.shake) this.trauma = Math.max(this.trauma, cut.shake);
    this._shake(dt, 0.3, 0.25, 0.02);
    this.fade.override = cut.fade ? cut.fade : this.fade.override;
    this._v.camVelocity.set(0, 0, 0);
    this.snapCamera = false;
  }

  _placeLauncher(firstPerson) {
    const { launcher, avatar, camera, runner: r } = this;
    if (firstPerson) {
      if (launcher.rig.parent !== camera) camera.add(launcher.rig);
      // A little sway with the stride, so the launcher is carried, not glued.
      const bob = this.reducedMotion ? 0 : r.speed > 0 && r.height <= 0.01 ? Math.sin(avatar.phase) : 0;
      launcher.rig.position.set(0.36 + bob * 0.012, -0.33 + Math.abs(bob) * 0.012, -0.62 + launcher.recoil * 0.12);
      launcher.rig.rotation.set(0.04 + launcher.recoil * 0.2, 0.05, bob * 0.02);
    } else {
      if (launcher.rig.parent !== avatar.shoulder) avatar.shoulder.add(launcher.rig);
      if (avatar.hold > 0.5) {
        // Sat on the shoulder, most of the tube out in front, where both
        // hands of the hold pose (characters.js) close on it.
        launcher.rig.position.set(-0.04, -0.07, -0.18 + launcher.recoil * 0.1);
        launcher.rig.rotation.set(launcher.recoil * 0.15, 0, 0);
      } else {
        // Hands busy (the ladder): slung diagonally across the back.
        launcher.rig.position.set(-0.3, -0.35, 0.2);
        launcher.rig.rotation.set(0, Math.PI / 2, 0.85);
      }
    }
    const glow = r.lockout > 0 ? 1.2 : r.heat / 100;
    for (const m of launcher.heatMaterials) m.emissiveIntensity = glow * 1.4;
  }

  /* ---------------- Shooting ---------------- */

  _currentPower() {
    if (this.runner.overchargeShots > 0) return 99;
    return this.runner.weakened > 0 ? 0.5 : 1;
  }

  _shoot() {
    const { runner: r, level, audio, hud } = this;
    const V = this._v;
    if (!r.alive || !level) return;
    if (this.phase === "run" && r.finished) return;
    if (r.lockout > 0) return;
    if (r.balls <= 0) {
      audio.dry();
      return;
    }
    r.balls -= 1;
    r.shots += 1;

    if (r.coolant <= 0) {
      r.heat = Math.min(100, r.heat + HEAT_PER_SHOT);
      if (r.heat >= 100) {
        r.lockout = HEAT_LOCKOUT_SECONDS;
        hud.toast("LAUNCHER OVERHEATED", "", "warn");
        audio.overheat();
        this.debris.sparks(this.launcher.muzzle.getWorldPosition(V.muzzle), { count: 30, speed: 4 });
      }
    }

    // Aim where the reticle points: the first breakable or hazard under it,
    // or 60 m out. The ball then flies from the muzzle toward that point.
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.phase === "run") {
      const hit = this.raycaster.intersectObjects(level.breakables, false)[0];
      if (hit) V.aim.copy(hit.point);
      else V.aim.copy(this.raycaster.ray.origin).addScaledVector(this.raycaster.ray.direction, 60);
    } else {
      V.aim.copy(this.hero.aim);
    }

    this.launcher.muzzle.getWorldPosition(V.muzzle);
    V.fireDir.copy(V.aim).sub(V.muzzle).normalize();
    if (this.phase === "run") {
      const sample = level.route.sample(r.distance);
      V.forwardVel.set(-Math.sin(sample.heading), 0, -Math.cos(sample.heading)).multiplyScalar(r.speed);
    } else {
      V.forwardVel.copy(this.hero.velocity).multiplyScalar(0.5);
      this.hero.lastShot = 0;
    }
    this.projectiles.fire(V.muzzle, V.fireDir, BALL_SPEED, { power: this._currentPower(), inherit: V.forwardVel });
    if (r.overchargeShots > 0) r.overchargeShots -= 1;
    this.launcher.recoil = 1;
    audio.shot(r.weakened > 0);
  }

  _applyPowerup(kind) {
    const r = this.runner;
    if (kind === "coolant") {
      r.heat = 0;
      r.lockout = 0;
      r.weakened = 0;
      r.coolant = 4;
    } else if (kind === "adrenaline") r.adrenaline = 6;
    else if (kind === "overcharge") r.overchargeShots = 6;
    else if (kind === "barrier") r.barrierShield = 5;
  }

  _onBallBreakable(object, point, ball) {
    if (this.roof) return this._onRoofBreakable(object, point, ball);
    const { level, debris, audio, hud, runner: r } = this;
    const result = level.breakTarget(object, ball.power);
    if (!result) return true;
    if (result.partial) {
      if (result.kind === "glass") {
        debris.burst(point, { kind: "glass", count: 8, speed: 3, size: 0.18 });
        audio.glassCrack();
      } else if (result.kind === "patient") {
        debris.burst(point, { kind: "concrete", count: 6, speed: 2.5, size: 0.1 });
        debris.dust(point, { size: 1.2, life: 0.6, color: 0x5a2a22 });
        audio.thud();
      } else {
        debris.sparks(point, { count: 12 });
        audio.clang();
      }
      return true;
    }
    r.breaks += 1;
    if (result.kind === "glass") {
      const sample = level.route.sample(object.userData.routeDistance ?? r.distance);
      this._v.laneRight.set(Math.cos(sample.heading), 0, -Math.sin(sample.heading));
      debris.burst(result.position, { kind: "glass", count: 70, speed: 5.5, area: [3.0, 3.4], right: this._v.laneRight, push: ball.velocity.clone().multiplyScalar(0.15) });
      audio.glassShatter(true);
      this.trauma = Math.min(1, this.trauma + 0.15);
    } else if (result.kind === "sack") {
      r.balls = Math.min(MAX_BALLS, r.balls + (result.spheres ?? 0));
      debris.burst(result.position, { kind: "sack", count: 26, speed: 4 });
      debris.burst(result.position, { kind: "ball", count: 6, speed: 3, up: 2 });
      hud.toast("BALLS", `+${result.spheres}`);
      audio.glassShatter(false);
      audio.pickup();
    } else if (result.kind === "patient") {
      r.downs += 1;
      debris.burst(point, { kind: "concrete", count: 10, speed: 3, size: 0.12 });
      debris.dust(point, { size: 2, life: 0.9, color: 0x5a2a22 });
      audio.thud();
      audio.bodyFall();
    } else if (result.kind === "powerup") {
      this._applyPowerup(result.powerupKind);
      debris.burst(result.position, { kind: "power", count: 30, speed: 5 });
      debris.sparks(result.position, { count: 30 });
      hud.toast(POWERUP_LABELS[result.powerupKind] ?? "POWER-UP", "", "power");
      audio.powerup();
    }
    return true;
  }

  _onBallSolid(object, point) {
    this.debris.sparks(point, { count: 14, speed: 5 });
    this.audio.clang();
  }

  /* ---------------- Collision, vitality ---------------- */

  _checkHazards(dt) {
    const { runner: r, level, debris, audio, hud } = this;
    r.invulnerable = Math.max(0, r.invulnerable - dt);
    r.slow = Math.max(0, r.slow - dt);
    if (!r.alive || r.finished) return;

    const crouched = r.sliding > 0;
    const height = crouched ? 1.0 : 1.9;
    const centre = level.route.sample(r.distance, r.lateral, r.height, this._v.boxCentre);
    centre.y += 0.18 + height / 2;
    this.playerBox.setFromCenterAndSize(centre, this._v.boxSize.set(0.9, height, 0.9));
    const hits = level.collide(this.playerBox, r.distance);
    if (!hits.length || r.invulnerable > 0) return;

    const hazard = hits[0];
    // Crashing through an intact pane shatters it - you get through, but it
    // costs you like any other hit.
    if (hazard.userData.glass) {
      const pane = level.breakables.find((b) => b.userData.pane?.hit === hazard);
      if (pane) {
        const result = level.breakTarget(pane, 99);
        if (result) debris.burst(result.position, { kind: "glass", count: 60, speed: 6, area: [3, 3.4] });
        audio.glassShatter(true);
      }
    }
    if (r.barrierShield > 0) {
      debris.sparks(centre, { count: 20 });
      return;
    }

    r.vitality = Math.max(0, r.vitality - HIT_VITALITY - HIT_FIRE_BURST);
    const dropped = Math.min(r.balls, Math.max(r.balls > 0 ? 1 : 0, Math.round(r.balls * HIT_BALL_DROP_RATIO)));
    r.balls -= dropped;
    r.hits += 1;
    r.invulnerable = 1.1;
    r.slow = 0.55;
    r.lookBack = 0.9;
    this.trauma = Math.min(1, this.trauma + 0.85);
    this.hitFlash = 1;
    level.impact(1);
    hud.flashDamage();
    hud.toast("HIT", dropped ? `-${dropped} BALLS` : "", "warn");
    audio.stumble();
    // The dropped balls physically spill out behind you.
    if (dropped) debris.burst(centre, { kind: "ball", count: Math.min(12, dropped), speed: 3, up: 3 });

    if (r.vitality <= 0) {
      r.alive = false;
      this.trauma = 1;
      this._finishRun(false, "CAUGHT BY THE FIRE");
    }
  }

  /* ---------------- End of Phase A ---------------- */

  _startDeparture() {
    if (this.phase !== "run") return;
    this.phase = "depart";
    this.runner.finished = true;
    this.runner.firing = false;
    this.cut = this.level.beginDeparture(this.camera.position);
    this.hud.showBanner("SECTOR 03 CLEARED", "UP TO THE ROOF", 2600);
    this.hud.setPrompt(null);
    this.events.emit("phase", { phase: "depart" });
  }

  _finishRun(survived, title) {
    const r = this.runner;
    if (r.finished && this.phase !== "run") return;
    r.finished = true;
    r.alive = false;
    r.firing = false;
    if (survived) return;
    this._end(false, title, [
      ["Time", `${this.clock.toFixed(1)}s`],
      ["Distance", `${Math.round(r.distance)} / ${Math.round(this.level.route.totalLength)}m`],
      ["Hits taken", r.hits],
      ["Shots / breaks", `${r.shots} / ${r.breaks}`],
      ["Patients downed", r.downs],
      ["Balls left", r.balls, true],
    ]);
  }

  /** The run is over, one way or the other. */
  _end(escaped, title, rows, eyebrow) {
    this.phase = "over";
    this.runner.firing = false;
    this.ui.letterbox.classList.remove("on");
    this.hud.vitals.style.visibility = "";
    this.hud.setPrompt(null);
    const result = { escaped, title, rows, eyebrow, stats: this.stats };
    if (this.options.summary) this.hud.showSummary({ title, eyebrow, failed: !escaped, rows });
    this.events.emit(escaped ? "complete" : "failed", result);
  }

  /* ================================================================ */
  /* Phase B - the roof                                                */
  /* ================================================================ */

  /**
   * Up to the roof: (fade to) black, swap the corridor for the roof, compile
   * its shaders while the screen is black (the scene's light count changes,
   * so everything recompiles once - better here than mid-fight), then the
   * roof's lift doors open.
   */
  async startRoof({ fromBlack = false } = {}) {
    if (!["run", "arrive", "depart", "idle"].includes(this.phase)) return;
    this.phase = "fade";
    this.runner.firing = false;
    this.fade.override = fromBlack ? 1 : null;
    this.fade.target = 1;
    this.fade.value = fromBlack ? 1 : this.fade.value;
    const wait = new Promise((resolve) => setTimeout(resolve, fromBlack ? 50 : 650));
    await Promise.all([wait, this.loadRoofAssets()]);
    if (this.phase !== "fade" || !this.level) return;

    this.level.root.visible = false;
    this.projectiles.clear();
    this.debris.clear();
    this.roof?.dispose();
    const roof = new RoofLevel({ assets: this.roofAssets, ...this.roofOptions });
    this.roof = roof;
    roof.addTo(this.scene);
    this._bindRoofEvents(roof);

    const { hero, runner: r, avatar } = this;
    hero.position.copy(ROOF_SPAWN);
    hero.velocity.set(0, 0, 0);
    hero.knock.set(0, 0, 0);
    hero.yaw = 0;
    hero.aim.copy(ROOF_SPAWN).add(new THREE.Vector3(0, 1.15, -10));
    this.roofClock = 0;
    avatar.setVisible(true);
    avatar.shadow.visible = true;
    // A breath in the lift: a partial refill, not a reset.
    r.vitality = Math.min(START_VITALITY, r.vitality + 25);
    r.alive = true;
    r.finished = false;
    r.invulnerable = 1.5;
    r.heat = 0;
    r.lockout = 0;

    const scene = this.scene;
    scene.fog.color.copy(FOG_ROOF);
    // Night haze: enough that the city recedes instead of standing around you.
    scene.fog.density = 0.0105;
    scene.background.copy(FOG_ROOF);
    this.renderer.toneMappingExposure = 1.0;
    this.environment.refresh();
    this.environment.set(0.8);
    this.cut = roof.beginArrival();
    this.snapCamera = true;
    this._applyCutscene(this.cut, 0.016);
    roof.prewarm(this.renderer, this.camera);

    this.phase = "roofArrive";
    this.fade.override = null;
    this.fade.value = 1;
    this.fade.target = 0;
    this.hud.showBanner("SECTOR 03 // THE ROOF", "HOLD ON", 3200);
    this.events.emit("phase", { phase: "roof" });
  }

  _bindRoofEvents(roof) {
    const { hud, audio, debris } = this;
    const on = (name, fn) => roof.events.on(name, (p) => roof === this.roof && fn(p));
    on("lift-open", () => audio.whoosh());
    on("arrived", () => {
      hud.toast("WASD MOVE", "SPACE DODGE", "", 4200);
      this._after(1.8, () => hud.toast("LURE THEM", "OFF THE EDGE", "", 4200));
    });
    on("wave", ({ index }) => {
      hud.showBanner(index === 1 ? "THEY WERE WAITING" : "MORE OF THEM", index === 1 ? "THEY'RE LETTING THEM OUT" : "THE MACHINE ROOM", 2600);
      audio.groan(1);
    });
    on("patient-windup", () => audio.growl());
    on("patient-stunned", ({ position }) => {
      debris.dust(position.clone().setY(1), { size: 2 });
      audio.clang();
    });
    on("enemy-fall", () => {
      audio.scream();
      hud.toast("OVER THE EDGE", "");
    });
    on("enemy-down", ({ enemy }) => {
      audio.bodyFall();
      hud.toast("DOWN", enemy.kind === "scientist" ? "SCIENTIST" : "");
    });
    on("orb-fired", () => audio.zap());
    on("orb-burst", ({ position }) => debris.sparks(position, { count: 22, speed: 5 }));
    on("clear", () => hud.showBanner("ROOF CLEAR", "HERE IT COMES", 3000));
    on("heli-arrived", ({ ending }) => {
      if (ending === "victory") {
        roof.beginEnding(this.hero.position);
        this._startCutscene();
        hud.showBanner("EXTRACTION", "CLIMB THE LADDER", 3000);
      } else {
        // Not a cutscene: it waits off the east ledge and you have to get there.
        hud.showBanner("IT CAN'T LAND", "JUMP FOR THE LADDER", 3200);
        audio.stinger();
      }
    });
    on("ladder-grab", () => {
      this._startCutscene();
      audio.whoosh();
    });
    on("heli-left", () => {
      hud.showBanner("IT COULDN'T WAIT", "LEFT BEHIND", 3000);
      this.runner.firing = false;
      this._after(3, () => {
        if (this.phase !== "roof" || this.roof !== roof) return;
        this._roofSummary(false, "LEFT BEHIND");
      });
    });
    // The roof coming apart.
    on("explosion", ({ position, strength }) => {
      debris.burst(position.clone().setY(Math.max(0.3, position.y + 2)), { kind: "concrete", count: 24, speed: 7, up: 5 });
      debris.sparks(position.clone().setY(0.5), { count: 40, speed: 9 });
      debris.dust(position.clone().setY(1), { size: 7, life: 2.2, color: 0x3a2e28 });
      const near = Math.max(0.2, 1 - position.distanceTo(this.hero.position) / 30);
      this.trauma = Math.min(1, this.trauma + strength * near * 0.7);
      audio.crash(0.4 + near * strength * 0.6);
    });
    on("tremor", ({ strength }) => {
      this.trauma = Math.min(1, this.trauma + strength * 0.55);
      audio.crash(0.25 + strength * 0.3);
      hud.toast("THE BUILDING IS GOING", "", "warn", 1400);
    });
    on("roof-fire", ({ position }) => {
      debris.sparks(position.clone().setY(0.3), { count: 20, speed: 4 });
      audio.crash(0.15);
    });
  }

  _startCutscene() {
    this.phase = "ending";
    this.runner.firing = false;
    this.ui.letterbox.classList.add("on");
    this.hud.vitals.style.visibility = "hidden";
    this.hud.setPrompt(null);
  }

  _onRoofBreakable(object, point, ball) {
    const { roof, debris, audio, hud, runner: r } = this;
    const result = roof.breakTarget(object, ball.power, this.avatar.root.position);
    if (!result) return true;
    if (result.kind === "sack") {
      if (result.partial) return true;
      r.balls = Math.min(MAX_BALLS, r.balls + (result.spheres ?? 0));
      debris.burst(result.position, { kind: "sack", count: 26, speed: 4 });
      hud.toast("BALLS", `+${result.spheres}`);
      audio.glassShatter(false);
      audio.pickup();
      return true;
    }
    // A ball into a person: an impact, a burst, a stagger - not a shatter.
    debris.burst(point, { kind: "concrete", count: result.partial ? 6 : 12, speed: 3, size: 0.1 });
    debris.dust(point, { size: result.partial ? 1.2 : 2.2, life: 0.7, color: 0x5a2a22 });
    debris.sparks(point, { count: 8, speed: 3 });
    audio.thud();
    r.breaks += result.partial ? 0 : 1;
    if (!result.partial) r.downs += 1;
    return true;
  }

  _updateRoofCamera(dt) {
    // High and behind (south of) the player, looking north over their head,
    // leaning a little toward where they aim.
    const { hero, camera } = this;
    const V = this._v;
    V.desired.copy(hero.position).add(_roofCam);
    V.look.copy(hero.position).add(_roofLook).lerp(hero.aim, 0.16);
    this._follow(V.desired, 60, dt);
    if (this.snapCamera) V.smoothedLook.copy(V.look);
    else V.smoothedLook.lerp(V.look, 1 - Math.exp(-dt * 10));
    camera.up.copy(UP);
    camera.lookAt(V.smoothedLook);
    if (Math.abs(camera.fov - BASE_FOV) > 0.01) {
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
    }
    this._shake(dt, 0.4, 0.3, 0);
    this.snapCamera = false;
  }

  _roofHit(hit) {
    const { runner: r, hero } = this;
    if (r.invulnerable > 0 || this.phase !== "roof") return;
    r.vitality = Math.max(0, r.vitality - hit.damage);
    r.hits += 1;
    r.invulnerable = 1.0;
    hero.knock.subVectors(hero.position, hit.from).setY(0).normalize().multiplyScalar(hit.knock);
    this.trauma = Math.min(1, this.trauma + (hit.source === "patient" ? 0.8 : 0.45));
    this.hitFlash = 1;
    this.hud.flashDamage();
    this.hud.toast(hit.source === "fire" ? "BURNING" : "HIT", "", "warn");
    this.audio.stumble();
    this.debris.sparks(this.avatar.root.position.clone().setY(1.2), { count: 16 });
    if (r.vitality <= 0) {
      r.alive = false;
      this._roofSummary(false, "THEY GOT YOU");
    }
  }

  _roofSummary(escaped, title) {
    const r = this.runner;
    this._end(escaped, title, [
      ["Total time", `${this.clock.toFixed(1)}s`],
      ["On the roof", `${this.roofClock.toFixed(1)}s`],
      ["Shot down (both phases)", r.downs],
      ["Sent over the edge", this.roof ? this.roof.state.falls : 0],
      ["Hits taken", r.hits],
      ["Balls left", r.balls, true],
    ], escaped ? "LEVEL 3 COMPLETE" : "SECTOR 03 // THE ROOF");
  }

  _updateRoofFrame(dt, time) {
    const { roof, hero, avatar, runner: r } = this;
    const cut = roof.cutscene;
    const slow = this.phase === "ending" && cut ? cut.timeScale : 1;
    const sdt = dt * slow;
    if (this.phase === "roof") this.roofClock += dt;

    if (this.phase === "roofArrive") {
      roof.update({ dt, time, player: hero.position, playerVelocity: hero.velocity });
      const c = roof.cutscene;
      if (c) this._applyCutscene(c, dt);
      if (!c || c.done) {
        this.phase = "roof";
        hero.position.copy(ROOF_SPAWN);
        this.events.emit("phase", { phase: "roof-fight" });
      }
    } else if (this.phase === "roof") {
      // Movement, camera-relative (the camera looks down -Z).
      const held = this.held;
      const ix = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
      const iz = (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0) - (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0);
      const input = _input.set(ix, 0, iz);
      if (input.lengthSq() > 1) input.normalize();
      hero.velocity.lerp(input.multiplyScalar(ROOF_SPEED), 1 - Math.exp(-dt * 12));
      hero.dodge = Math.max(0, hero.dodge - dt);
      hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
      hero.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
      hero.position.addScaledVector(hero.velocity, dt).addScaledVector(hero.knock, dt);
      if (hero.dodge > 0) hero.position.addScaledVector(hero.dodgeDir, DODGE_SPEED * dt);
      roof.clampPlayer(hero.position);
      hero.position.y = 0;

      // Aim: an enemy or sack under the cursor, else a point at chest height.
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(roof.breakables, false)[0];
      if (hit) hero.aim.copy(hit.point);
      else if (!this.raycaster.ray.intersectPlane(this.aimPlane, hero.aim)) hero.aim.copy(hero.position).add(_ahead);
      this.ui.reticle.classList.toggle("hot", Boolean(hit));

      // Face the aim while shooting, otherwise the way you move.
      hero.lastShot += dt;
      const face = hero.lastShot < 0.6 || r.firing ? _face.copy(hero.aim).sub(hero.position) : hero.velocity.lengthSq() > 0.5 ? _face.copy(hero.velocity) : null;
      if (face) {
        const want = Math.atan2(-face.x, -face.z);
        let delta = want - hero.yaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        hero.yaw += delta * Math.min(1, dt * 14);
      }
      avatar.root.position.copy(hero.position);
      avatar.root.rotation.y = hero.yaw;
      const speed = hero.velocity.length() + (hero.dodge > 0 ? DODGE_SPEED : 0);
      avatar.update(dt, { speed, lateralVel: 0, height: 0, sliding: hero.dodge > 0, aiming: r.firing });

      const hits = roof.update({ dt, time, player: hero.position, playerVelocity: hero.velocity });
      for (const h of hits) this._roofHit(h);
      this._updateRoofCamera(dt);
    } else {
      roof.update({ dt: sdt, time, player: hero.position, playerVelocity: hero.velocity });
      if (cut && cut.kind !== "arrival") {
        this._applyCutscene(cut, dt, sdt);
        if (cut.done && this.phase === "ending") {
          this.avatar.hold = 1;
          this.avatar.reachUp = 0;
          this._roofSummary(true, roof.state.ending === "victory" ? "EXTRACTED" : "BARELY OUT");
        }
      } else {
        this._updateRoofCamera(dt);
      }
    }

    this._placeLauncher(false);
    // Balls fly through the cutscene's slow motion too.
    this.projectiles.update(sdt, { breakables: roof.breakables, solids: roof.solids, onBreakable: (o, p, b) => this._onBallBreakable(o, p, b), onSolid: (o, p) => this._onBallSolid(o, p) });
    this.debris.update(sdt);
    this.launcher.muzzle.getWorldPosition(this._v.muzzle);
    this.beam.update(dt, { origin: this._v.muzzle, target: hero.aim, darkness: 0, time, projectiles: this.projectiles });
    this.audio.setRotor(roof.rotorLevel);
  }

  _updateRoofPresentation(dt, time, playing) {
    const { runner: r, roof } = this;
    const danger = 1 - r.vitality / START_VITALITY;
    this.hud.setDanger(danger);
    // The roof coming apart: thicker smoke, heat haze, louder everything.
    const chaos = roof?.state.chaos ?? 0;
    this.scene.fog.density = 0.0105 + chaos * 0.011;
    this.renderer.toneMappingExposure = 1.0;
    this.audio.setFireProximity(0.25 + chaos * 0.5);
    this.audio.setDanger(Math.max(danger * 0.8, chaos * 0.65));
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const g = this.grade.uniforms;
    g.uTime.value = time;
    g.uDanger.value = danger;
    g.uDark.value = 0.15 + chaos * 0.1;
    g.uHeat.value = this.reducedMotion ? 0 : chaos * 0.35;
    g.uHit.value = this.reducedMotion ? this.hitFlash * 0.3 : this.hitFlash;
    const reticle = this.ui.reticle;
    reticle.hidden = !this.visible || this.phase !== "roof";
    reticle.classList.toggle("overheated", r.lockout > 0);
    reticle.classList.toggle("weak", r.weakened > 0);
    this.hud.setVitality(r.vitality, START_VITALITY);
    this.hud.setBalls(r.balls);
    const hint = this.phase === "roof" ? roof?.extractionHint(this.hero.position) : null;
    this.hud.setPrompt(hint === "jump" ? "SPACE - JUMP FOR THE LADDER!" : hint === "go" ? "GET TO THE EAST LEDGE" : r.balls <= 0 && playing ? "NO BALLS" : null);
    this.hud.update({ fps: this._fps(dt), renderer: this.renderer });
  }

  /* ================================================================ */
  /* Tests and demos                                                   */
  /* ================================================================ */

  /** Jump the run to a route distance (tests, screenshots, demos). */
  teleport(distance, { camera: mode = this.cameraMode, invulnerable = 999 } = {}) {
    if (this.phase === "idle" || this.phase === "arrive") {
      this.phase = "run";
      this.cut = null;
      this.level.updateArrival(99);
    }
    const r = this.runner;
    r.distance = distance;
    r.fireDistance = distance - 30;
    r.invulnerable = invulnerable;
    this.cameraMode = mode;
    this.snapCamera = true;
  }
}

const _roofCam = new THREE.Vector3(0, 11.5, 8.5);
const _roofLook = new THREE.Vector3(0, 0.6, -3.4);
const _ahead = new THREE.Vector3(0, 1.15, -10);
const _input = new THREE.Vector3();
const _face = new THREE.Vector3();

