/**
 * The Race: two players, split screen, head to head through one of the
 * story's levels - the Foundry, the Labs or the Skyline (courses.js).
 *
 *   One course, one world: what one player breaks is broken for the other
 *   (a gate opened by a switch cell is open for both). Each has a screen of
 *   their own - P1 on the left, P2 on the right - a chase camera, health,
 *   spheres to throw (at the switch cells, the glass, the sacks), lanes,
 *   jump and slide, as in the story.
 *
 *   OUT     hit too often (health 0 - burned, in the Labs, where the fire
 *           behind each of you closes in as you're hurt), or more than
 *           LEFT_BEHIND metres behind the other: left behind.
 *   WIN     first to the end of the course; or, when one is out, the other
 *           wins by getting past where they went down - and if both go
 *           down, whoever got furthest. (The Skyline's bridge never ends:
 *           there, furthest wins.)
 *
 *   SPHERES  the story's, played as in Endless: glass from your spheres,
 *           three each of cryo, shock and gravity for the race; a ring
 *           that lights on what you can break - and on your rival - with
 *           a little aim assist; a glass sphere into your rival knocks
 *           them into a stumble. Serums work as in the story (Overdrive,
 *           unlimited spheres, prism split, kinetic shield, Thermal
 *           Aegis, restoration), each runner's own; run into one to take
 *           it, or shoot it.
 *
 *   const race = new Race({ renderer, pads, assetBase, audio, loading, onExit });
 *   await race.open();          // the lobby
 *   // every frame: race.update(dt); race.render();
 *   race.close();
 */

import * as THREE from "../../three.js";
import { PlayerAvatar } from "../../levels/meltdown/player.js";
import { loadMeltdownAssets } from "../../levels/meltdown/assets.js";
import { PAD_COLOURS, B } from "../../systems/gamepads.js";
import { buildCourse, COURSE_ORDER, LANES, RACE_TIERS, TIER_ORDER } from "./courses.js";
import { RaceUI } from "./race-ui.js";
import { Studio } from "../common/studio.js";
import { buildLauncher, mountLauncher } from "../../figure/launcher-model.js";
import { SKIN_TONES } from "../../figure/look.js";
import { HEADWEAR } from "../../figure/outfit.js";
import { LAUNCHER_SKIN_ORDER, LAUNCHER_SKINS } from "../../figure/launcher-skins.js";
import { unlockedKeys } from "../../figure/kits.js";
import { BALLS, BALL_ORDER, SERUMS } from "../../systems/arsenal.js";
import { SPHERE_FLIGHT, SPHERE_GEOMETRY, sphereMaterial, sphereHalo, launchVelocity, flySphere, floorSphere, touchSphere, worldSphere } from "../../systems/spheres.js";
import { LAYERS } from "../../levels/causeway/layers.js";
import { SphereImpactFX } from "../../fx/sphere-impact.js";
import { ElectricArcs } from "../../fx/electric.js";

const SKINS = Object.keys(SKIN_TONES);
const HEADS = Object.keys(HEADWEAR);
/** (Normal's; each difficulty has its own - RACE_TIERS.) */
export const LEFT_BEHIND = 55;
const WARN_BEHIND = 34;
const HP = 100;
const AMMO_MAX = 15;
const AMMO_START = 10;
/**
 * The special spheres: so many of each a runner has for the whole race - not
 * paid for out of the spheres (those are glass's), and not got back.
 */
export const RACE_SPECIALS = { cryo: 3, shock: 3, gravity: 3 };
/**
 * Caught in a rival's burst: frozen in ice (`frozen` s, at `slow` of the
 * pace), or shocked - violet arcs over them, stumbling (`shocked` s).
 */
const CAUGHT = { frozen: 1.3, slow: 0.3, shocked: 1.2 };
/** A glass sphere into the rival: the damage, and the stumble that costs them ground (Overdrive: 1.5x). */
const RIVAL_HIT = { damage: 8, stumble: 0.8 };
/** Standing in the Skyline's fire: integrity a second, full on (the story's). */
const FIRE_BURN = 18;
/**
 * Aim assist (as the story's, main.js resolveAim): a ring within this much
 * of something breakable - or the rival - counts as on it (in its half's
 * -1..1, past the target's own size).
 */
const ASSIST = 0.1;
/** The Labs' vials hold these serums (as the story's: meltdown/game.js). */
const VIAL_SERUM = { coolant: "thermal", adrenaline: "overdrive", overcharge: "prism", barrier: "shield" };
const REGEN = 2;
const JUMP = 7.4;
const GRAVITY = 19;
const SLIDE = 0.65;
const DAMAGE = { foundry: 18, labs: 20, skyline: 22 };
const PANE_DAMAGE = 12;
const AIM_RANGE = 42;
/**
 * Aiming: each runner's ring, moved with the right stick (the keyboard
 * player's with the mouse) and kept inside their own half of the screen -
 * in that half's -1..1 coordinates. No aim assist: a throw goes where the
 * ring is.
 */
const AIM_SPEED = 1.7; // screen halves a second, the stick all the way over
const AIM_EDGE = 0.9;
const AIM_HOME = { x: 0, y: 0.2 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

export class Race {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {import("../../systems/gamepads.js").Gamepads} o.pads
   * @param {string} o.assetBase
   * @param {object} [o.audio]          Level1Audio
   * @param {object} [o.loading]        { hold(label), release(targets) } - the game's loading screen
   * @param {() => void} [o.onExit]     back to the main menu
   */
  constructor({ renderer, pads, assetBase, audio = null, loading = null, onExit = null, onEnd = null }) {
    /** Called with the Race when it's decided (the trophies and statistics, main.js). */
    this.onEnd = onEnd;
    this.renderer = renderer;
    this.pads = pads;
    this.assetBase = assetBase;
    this.audio = audio;
    this.loading = loading;
    this.onExit = onExit;
    this.state = "closed"; // closed | lobby | loading | countdown | racing | paused | results
    this.players = [];
    this.courseKey = "foundry";
    this.tierKey = "normal";
    /** The lobby's step: join, course, difficulty, customise (race-ui.js). */
    this.step = "join";
    this.keys = new Set();
    this.ui = new RaceUI(this);
    this._onKey = (e) => this._key(e);
    this._onPointer = (e) => this._pointer(e);
    this.cameras = [new THREE.PerspectiveCamera(62, 1, 0.1, 600), new THREE.PerspectiveCamera(62, 1, 0.1, 600)];
    // The Skyline draws its glass (and its fire, smoke and sparks) on layers
    // of their own: seen by both screens, or the race ran past invisible glass.
    for (const cam of this.cameras) {
      cam.layers.enable(LAYERS.GLASS);
      cam.layers.enable(LAYERS.FX);
    }
  }

  get active() {
    return this.state !== "closed";
  }

  async open() {
    this.state = "lobby";
    for (const p of this.players) this._removeAvatar(p);
    this.players = [];
    if (!this.lobbyScene) {
      // The lobby's backdrop: a dark room and a slow light.
      this.lobbyScene = new THREE.Scene();
      this.lobbyScene.background = new THREE.Color(0x0b0f14);
    }
    this.ui.showLobby();
    addEventListener("keydown", this._onKey, true);
    addEventListener("keyup", this._onKey, true);
    addEventListener("pointermove", this._onPointer, true);
    addEventListener("pointerdown", this._onPointer, true);
    this.assets ??= await loadMeltdownAssets(this.assetBase, { names: ["playerFemale", "playerMale", "launcher"] });
    this.studio ??= new Studio(this.renderer, this.assets);
  }

  close() {
    this.state = "closed";
    removeEventListener("keydown", this._onKey, true);
    removeEventListener("keyup", this._onKey, true);
    removeEventListener("pointermove", this._onPointer, true);
    removeEventListener("pointerdown", this._onPointer, true);
    this.keys.clear();
    this.ui.hideAll();
    this._teardown();
    this.players = [];
  }

  /* ================================================================ */
  /* Players                                                          */
  /* ================================================================ */

  join(input) {
    if (this.players.length >= 2) return null;
    const used = new Set(this.players.map((p) => p.slot));
    const padSlots = new Set([...this.pads.pads.values()].map((r) => r.slot));
    let slot = input.type === "pad" ? (this.pads.pads.get(input.index)?.slot ?? 0) : [0, 1, 2, 3].find((s) => !used.has(s) && !padSlots.has(s)) ?? 0;
    if (used.has(slot)) { slot = 0; while (used.has(slot)) slot += 1; }
    const p = {
      slot, input, colour: PAD_COLOURS[slot % PAD_COLOURS.length], name: `P${slot + 1}`,
      character: slot % 2 ? "playerMale" : "playerFemale",
      skin: SKINS[slot % SKINS.length],
      headwear: ["cap", "beanie", "bandana", "headband"][slot % 4],
      // The launcher on their shoulder (or throw by hand), and its finish.
      launcher: true,
      launcherSkin: LAUNCHER_SKIN_ORDER[1 + (slot * 3) % (LAUNCHER_SKIN_ORDER.length - 1)],
      page: "character", row: 0, ready: false,
      wins: 0,
    };
    this.players.push(p);
    this.audio?.uiClick?.();
    return p;
  }

  leave(p) {
    this._removeAvatar(p);
    this.players = this.players.filter((x) => x !== p);
  }

  cycleCourse(step) {
    const i = COURSE_ORDER.indexOf(this.courseKey);
    this.courseKey = COURSE_ORDER[(i + step + COURSE_ORDER.length) % COURSE_ORDER.length];
    this.audio?.uiClick?.();
  }

  cycleTier(step) {
    const i = TIER_ORDER.indexOf(this.tierKey);
    this.tierKey = TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + step))];
    this.audio?.uiClick?.();
  }

  get tier() {
    return RACE_TIERS[this.tierKey];
  }

  /* ---- customising, in the studio ---- */

  /** One thing about a player: the character, skin, headwear; or their launcher - carried, its finish. */
  change(p, what, step) {
    const cycle = (list, v) => list[(list.indexOf(v) + step + list.length) % list.length];
    if (what === "character") p.character = p.character === "playerFemale" ? "playerMale" : "playerFemale";
    else if (what === "skin") p.skin = cycle(SKINS, p.skin);
    // (Only what's unlocked: the kits' pieces once earned - src/figure/kits.js.)
    else if (what === "headwear") p.headwear = cycle(unlockedKeys(HEADWEAR), p.headwear);
    else if (what === "launcher") p.launcher = !p.launcher;
    else if (what === "launcherSkin") p.launcherSkin = cycle(unlockedKeys(LAUNCHER_SKINS), p.launcherSkin);
    this.audio?.uiClick?.();
    this._studioFigures();
  }

  /** The studio shows everyone as they've dressed; in close on the launcher while anyone is choosing one. */
  _studioFigures() {
    if (!this.studio) return;
    this.studio.setFigures(this.players.map((p) => ({ id: p.slot, character: p.character, skin: p.skin, outfit: p.colour.key, headwear: p.headwear, launcher: p.launcher, launcherSkin: p.launcherSkin, colour: p.colour.hex })));
    this.studio.frame(this.players.some((p) => p.page === "launcher" && !p.ready) ? "launcher" : "body");
  }

  toCustomise() {
    for (const p of this.players) { p.page = "character"; p.row = 0; p.ready = false; }
    this.step = "customise";
    this._studioFigures();
    this.ui.showStep();
  }

  setReady(p, ready) {
    p.ready = ready;
    this.audio?.uiClick?.();
    this._studioFigures();
    if (this.players.length >= 2 && this.players.every((x) => x.ready)) this.start();
  }

  /* ================================================================ */
  /* The course                                                       */
  /* ================================================================ */

  /** Build the course (behind the loading screen), place the runners, count down. */
  async start() {
    if (this.players.length < 2 || this.state === "loading") return;
    this.state = "loading";
    this.ui.hideAll();
    this.loading?.hold(["HEAD TO HEAD", this.courseTitle()]);
    // A new course each time: the levels are built for one run, and what
    // was broken in the last race is whole again.
    this._teardown();
    this.scene = new THREE.Scene();
    try {
      this.course = await buildCourse(this.courseKey, { scene: this.scene, renderer: this.renderer, assetBase: this.assetBase, tier: this.tier });
    } catch (error) {
      console.warn("[race] could not build the course", error);
      this.loading?.cancel?.();
      this.toLobby();
      return;
    }
    this.builtFor = this.courseKey;
    // The story's spheres (src/systems/spheres.js): the same orb and halo, the
    // same flight - each one shaped like the story's projectiles.
    this.balls = [];
    for (let i = 0; i < 16; i += 1) {
      const mesh = new THREE.Mesh(SPHERE_GEOMETRY, sphereMaterial("glass"));
      mesh.visible = false;
      this.scene.add(mesh);
      this.balls.push({ mesh, halo: null, velocity: new THREE.Vector3(), gravity: 0, life: 0, ball: "glass", touched: false, bounces: 0, owner: null, active: false });
    }
    this.impact = new SphereImpactFX(this.scene);
    // A shocked runner's arcs (the drones' violet, fx/electric.js), and the ice a frozen one is in.
    this.electric = new ElectricArcs(this.scene);
    this.iceGeometry = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    this.iceGeometry.computeVertexNormals();
    this.iceMaterial = new THREE.MeshStandardMaterial({ color: 0xcff6ff, emissive: 0x3aa8d8, emissiveIntensity: 0.45, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.5, depthWrite: false, flatShading: true });
    for (const c of this.cameras) this.scene.add(c);
    this.players.forEach((p, i) => this._place(p, i));
    for (const [i, p] of this.players.entries()) this._cameraFollow(p, this.cameras[i], 1, true);
    this.time = 0;
    this.countdown = 3.4;
    this.ended = false;
    this.state = "countdown";
    this.ui.showRace();
    this.ui.banner("3");
    await this.loading?.release([[this.scene, this.cameras[0], () => this.render()]]);
  }

  courseTitle() {
    return { foundry: "THE FOUNDRY", labs: "THE LABS", skyline: "THE SKYLINE" }[this.courseKey];
  }

  _teardown() {
    for (const p of this.players) this._removeAvatar(p);
    this.impact?.dispose?.();
    this.impact = null;
    this.electric?.dispose();
    this.electric = null;
    this.iceGeometry?.dispose();
    this.iceMaterial?.dispose();
    this.iceGeometry = this.iceMaterial = null;
    if (this.course) this.course.dispose();
    this.course = null;
    this.scene = null;
    this.builtFor = null;
  }

  _place(p, i) {
    const c = this.course;
    this._removeAvatar(p);
    const a = new PlayerAvatar();
    a.hold = 0;
    a.setOutfit(p.colour.key);
    a.setHeadwear(p.headwear);
    a.setSkinTone(p.skin);
    a.setHairColour("natural");
    const template = this.assets?.get(p.character)?.template;
    if (template) a.setModel(template);
    // The Skyline turns the general lights off (as the story does): a touch
    // of self-light so the runner reads in its dark, fire-lit halls - as the
    // story's own figure does there.
    if (c.key === "skyline") {
      a.model?.traverse((o) => {
        if (!o.isMesh || !o.material?.map) return;
        o.material.emissiveMap = o.material.map;
        o.material.emissive.setRGB(1, 1, 1);
        o.material.emissiveIntensity = 0.32;
        o.material.needsUpdate = true;
      });
    }
    this.scene.add(a.root);
    p.avatar = a;
    // Their launcher on the shoulder, in their finish - or arms free to throw.
    p.rig = p.launcher ? buildLauncher(this.assets?.get("launcher"), p.launcherSkin) : null;
    if (p.rig) mountLauncher(a, p.rig);
    p.ice = new THREE.Mesh(this.iceGeometry, this.iceMaterial);
    p.ice.position.y = 0.95;
    p.ice.scale.set(0.62, 1.08, 0.56);
    p.ice.visible = false;
    a.root.add(p.ice);
    Object.assign(p, {
      distance: c.start - i * 0.01, lane: i === 0 ? 0 : 2, lateral: LANES[i === 0 ? 0 : 2], latVel: 0,
      height: 0, vy: 0, slide: 0, ground: 0, hp: HP, invuln: 0, stumble: 0, shake: 0, frozen: 0, shocked: 0,
      ammo: AMMO_START, regen: 0, throwCd: 0, aim: { ...AIM_HOME }, ball: "glass", out: null, finished: false, time: 0,
      specials: { ...RACE_SPECIALS },
      fire: c.fire ? c.start - 40 : null,
      stats: { hits: 0, thrown: 0, broken: 0, best: 0 },
      prev: { lx: 0, ly: 0, a: true, b: true, rt: true, start: true, left: true, right: true, up: true, down: true, lb: true, rb: true },
      pos: new THREE.Vector3(),
    });
    c.sample(p.distance, p.lateral, 0, p.pos);
    a.root.position.copy(p.pos);
  }

  _removeAvatar(p) {
    if (!p.avatar) return;
    this.scene?.remove(p.avatar.root);
    p.avatar = null;
  }

  pause(on) {
    if (on && (this.state === "racing" || this.state === "countdown")) {
      this._resume = this.state;
      this.state = "paused";
      this.ui.showPause(true);
    } else if (!on && this.state === "paused") {
      this.state = this._resume ?? "racing";
      this.ui.showPause(false);
      for (const p of this.players) Object.assign(p.prev, { a: true, b: true, rt: true, start: true });
    }
  }

  padLost(index) {
    if (this.players.some((p) => p.input.type === "pad" && p.input.index === index)) this.pause(true);
    this.ui.refreshLobby();
  }

  toLobby() {
    this.state = "lobby";
    this._teardown();
    this.step = "join";
    this.ui.showLobby();
  }

  /* ================================================================ */
  /* Input                                                            */
  /* ================================================================ */

  _key(e) {
    if (!e.isTrusted) return;
    if (e.type === "keydown") this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (e.type === "keydown") {
      this.ui.onKey(e);
      if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace"].includes(e.code)) e.preventDefault();
    }
    e.stopImmediatePropagation();
  }

  /** The keyboard player aims with the mouse, in their own half, and clicks to throw. */
  _pointer(e) {
    if (this.state !== "racing" && this.state !== "countdown") return;
    const i = this.players.findIndex((p) => p.input.type === "keyboard");
    if (i < 0) return;
    const p = this.players[i];
    const half = innerWidth / 2;
    const x = ((e.clientX - i * half) / half) * 2 - 1;
    const y = -((e.clientY / innerHeight) * 2 - 1);
    p.aim.x = THREE.MathUtils.clamp(x, -AIM_EDGE, AIM_EDGE);
    p.aim.y = THREE.MathUtils.clamp(y, -AIM_EDGE, AIM_EDGE);
    if (e.type === "pointerdown" && e.button === 0 && this.state === "racing") this._throw(p);
  }

  /** One runner's controls this frame (held states; edges are worked out below). */
  _read(p) {
    const out = { left: false, right: false, jump: false, slide: false, throw: false, start: false };
    if (p.input.type === "pad") {
      const r = this.pads.pads.get(p.input.index);
      if (!r) return out;
      out.left = r.left.x < -0.5 || !!r.buttons[B.LEFT];
      out.right = r.left.x > 0.5 || !!r.buttons[B.RIGHT];
      out.jump = !!r.buttons[B.A] || r.left.y < -0.6 || !!r.buttons[B.UP];
      out.slide = !!r.buttons[B.B] || r.left.y > 0.6 || !!r.buttons[B.DOWN];
      out.throw = r.rt > 0.45 || !!r.buttons[B.X];
      out.start = !!r.buttons[B.START];
      // The sphere type: R1 clockwise round the wheel, L1 back - as in the story.
      out.rb = !!r.buttons[B.RB];
      out.lb = !!r.buttons[B.LB];
      out.aimX = r.right.x;
      out.aimY = r.right.y;
    } else {
      const k = this.keys;
      out.left = k.has("KeyA") || k.has("ArrowLeft");
      out.right = k.has("KeyD") || k.has("ArrowRight");
      out.jump = k.has("KeyW") || k.has("ArrowUp") || k.has("Space");
      out.slide = k.has("KeyS") || k.has("ArrowDown") || k.has("ShiftLeft");
      out.throw = k.has("KeyF") || k.has("Enter");
      out.start = k.has("Escape");
      out.rb = k.has("KeyE");
      out.lb = k.has("KeyQ");
    }
    return out;
  }

  /* ================================================================ */
  /* Frame                                                            */
  /* ================================================================ */

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.ui.update(dt);
    if (this.state === "lobby" && this.step === "customise") { this.studio?.update(dt); return; }
    if (!this.scene || this.state === "lobby" || this.state === "loading" || this.state === "results") {
      if (this.state === "results") this._world(dt);
      return;
    }
    for (const p of this.players) {
      const c = this._read(p);
      if (c.start && !p.prev.start) this.pause(this.state !== "paused");
      p.prev.start = c.start;
    }
    if (this.state === "paused") return;
    if (this.state === "countdown") {
      const before = Math.ceil(this.countdown - 0.4);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown - 0.4);
      if (now !== before) { this.ui.banner(now > 0 ? String(now) : "GO"); this.audio?.uiClick?.(); }
      if (this.countdown <= 0) this.state = "racing";
      this._world(dt);
      return;
    }
    this.time += dt;
    // (What the rings can be over, this frame - and what a sphere, or the
    // aim, bounces off: not a pane's own collider just in front of its glass,
    // as in the story's flight, nor anything switched off.)
    this._aimTargets = this._breakableMeshes();
    this._solids = (this.course.solids?.() ?? []).filter((m) => !m.userData.glass && !m.userData.disabled);
    for (const p of this.players) this._run(p, dt);
    this._updateBalls(dt);
    this.impact?.update(dt);
    // This frame's arcs over anyone shocked, and the ice on anyone frozen.
    this.electric.begin();
    for (const p of this.players) {
      if (p.ice) p.ice.visible = p.frozen > 0 && !p.out;
      if (p.shocked > 0 && !p.out && p.avatar) this.electric.body(p.avatar.root.position);
    }
    this.electric.end(dt);
    this._rules();
    this._world(dt);
  }

  /** The course and everything on it moves on; the avatars and cameras follow. */
  _world(dt) {
    const live = this.players.filter((p) => p.pos);
    const lead = live.reduce((a, b) => (b.distance > a.distance ? b : a), live[0]);
    const trail = live.reduce((a, b) => (b.distance < a.distance ? b : a), live[0]);
    this.course.update(dt, (this.clock = (this.clock ?? 0) + dt), { lead: lead.distance, trail: trail.distance, leadPos: lead.pos, trailPos: trail.pos });
    if (this.course.fire) {
      const front = Math.max(...this.players.filter((p) => !p.out).map((p) => p.fire ?? -Infinity), -50);
      this.course.setFire?.(front);
    }
    this.players.forEach((p, i) => {
      this._animate(p, dt);
      // An out runner's screen follows whoever is still going.
      const follow = p.out ? (this.players.find((q) => !q.out) ?? p) : p;
      this._cameraFollow(follow, this.cameras[i], dt, false, p);
    });
  }

  _run(p, dt) {
    const course = this.course;
    p.invuln = Math.max(0, p.invuln - dt);
    p.stumble = Math.max(0, p.stumble - dt);
    p.frozen = Math.max(0, p.frozen - dt);
    p.shocked = Math.max(0, p.shocked - dt);
    p.shake = Math.max(0, p.shake - dt * 2.5);
    p.throwCd = Math.max(0, p.throwCd - dt);
    if (p.out || p.finished) return;
    p.time += dt;
    // A serum running out.
    if (p.power) {
      p.power.left -= dt;
      if (p.power.left <= 0) {
        this.ui.flash(p, `${SERUMS[p.power.key].name.toUpperCase()} WORE OFF`);
        p.power = null;
      }
    }
    const c = this._read(p);
    // Lanes: one per push.
    if (c.left && !p.prev.left) p.lane = Math.max(0, p.lane - 1);
    if (c.right && !p.prev.right) p.lane = Math.min(LANES.length - 1, p.lane + 1);
    if (c.jump && !p.prev.a && p.height <= p.ground + 0.02) p.vy = JUMP;
    if (c.slide && !p.prev.b) {
      p.slide = SLIDE;
      if (p.height > p.ground + 0.05) p.vy = Math.min(p.vy, -12);
    }
    this._aim(p, c, dt);
    if (c.rb && !p.prev.rb) this._cycleBall(p, 1);
    if (c.lb && !p.prev.lb) this._cycleBall(p, -1);
    p.prev.rb = c.rb;
    p.prev.lb = c.lb;
    if (c.throw && !p.prev.rt) this._throw(p);
    p.prev.left = c.left;
    p.prev.right = c.right;
    p.prev.a = c.jump;
    p.prev.b = c.slide;
    p.prev.rt = c.throw;
    // Spheres come back.
    if (p.ammo < AMMO_MAX) {
      p.regen += dt;
      if (p.regen >= this.tier.regen) { p.regen = 0; p.ammo += 1; }
    }
    // Forward, sideways, up and down.
    const pace = course.speedAt(p.distance) * (p.frozen > 0 ? CAUGHT.slow : p.stumble > 0 ? 0.45 : 1) * (p.power?.key === "overdrive" ? 1.25 : 1);
    p.distance += pace * dt;
    const want = LANES[p.lane];
    const prevLat = p.lateral;
    p.lateral += (want - p.lateral) * Math.min(1, dt * 12);
    p.latVel = (p.lateral - prevLat) / Math.max(dt, 1e-4);
    p.ground = course.groundAt(p.distance, p.lateral) ?? 0;
    p.vy -= GRAVITY * dt;
    p.height = Math.max(p.ground, p.height + p.vy * dt);
    if (p.height <= p.ground) p.vy = Math.max(0, p.vy);
    if (p.height <= p.ground + 0.05 || p.vy > -1) p.slide = Math.max(0, p.slide - dt);
    course.sample(p.distance, p.lateral, p.height, p.pos);
    // What they ran into.
    const tall = p.slide > 0 ? 1.0 : 1.9;
    course.sample(p.distance, p.lateral, 0.18 + p.height + tall / 2, _centre);
    _box.setFromCenterAndSize(_centre, _size.set(0.9, tall, 0.9));
    const { hits: all, panes, pickups = [] } = course.collide(_box, p.distance);
    for (const pane of panes) {
      // Through the glass: it breaks, and it hurts a little.
      const broke = course.breakTarget(pane, { point: _centre.clone(), direction: new THREE.Vector3(0, 0, -1), body: true });
      if (broke && !broke.rejected) this.impact?.splash(_centre, "glass", 1.2, null, { ground: false });
      this._hurt(p, PANE_DAMAGE, "THROUGH THE GLASS");
    }
    // Run into a serum, a case file, a sphere cache: it's yours.
    for (const m of pickups) this._break({ owner: p, ball: "glass", velocity: _fwd }, m, m.getWorldPosition(new THREE.Vector3()), { body: true });
    // Thermal Aegis (a serum): fire can't burn you - the fire walls and vents pass you by.
    const hits = p.power?.key === "thermal" ? all.filter((h) => !h.userData.fireWall && !h.userData.fireVent) : all;
    if (hits.length) {
      const h = hits[0];
      // A fallen duct (the Labs): you scramble up onto it - and it costs you.
      if (h.userData.duct) {
        p.height = Math.max(p.height, h.userData.top ?? 1);
        p.vy = Math.max(p.vy, 2.2);
      }
      this._hurt(p, (DAMAGE[course.key] ?? 18) * this.tier.damage, h.userData.barrier === "high" ? "LOW CLEARANCE" : "HIT");
    }
    // In the Skyline's fire: it burns, as in the story - unless a serum keeps it off.
    const burning = course.burns?.(_box) ?? 0;
    if (burning > 0 && p.power?.key !== "thermal" && p.power?.key !== "shield") {
      p.hp = Math.max(0, p.hp - FIRE_BURN * this.tier.damage * burning * dt);
      p.burnFlash = (p.burnFlash ?? 0) - dt;
      if (p.burnFlash <= 0) { p.burnFlash = 1; this.ui.flash(p, "BURNING // CRYO PUTS IT OUT"); }
      if (p.hp <= 0) this._out(p, "BURNED");
    }
    // The Labs: the fire behind, closer the more you're hurt (Thermal Aegis: it gains nothing).
    if (p.fire !== null) {
      const target = p.distance - (4 + Math.min(HP, p.hp) * 0.42);
      if (!(p.power?.key === "thermal" && target > p.fire)) p.fire += (target - p.fire) * Math.min(1, dt * (target > p.fire ? 0.9 : 3));
    }
    p.stats.best = Math.max(p.stats.best, p.distance);
  }

  /** Hurt a runner (`stumble`: how long they're knocked off their stride). False if it didn't land. */
  _hurt(p, amount, label, { stumble = 0.55 } = {}) {
    if (p.invuln > 0 || p.out) return false;
    // A kinetic shield (a serum) takes it.
    if (p.power?.key === "shield" && p.power.charges > 0) {
      p.power.charges -= 1;
      p.invuln = 0.8;
      this.ui.flash(p, p.power.charges > 0 ? "SHIELD: 1 LEFT" : "SHIELD BROKEN");
      if (p.power.charges <= 0) p.power = null;
      this.audio?.impact?.(0.5);
      return false;
    }
    p.hp = Math.max(0, p.hp - amount);
    p.invuln = 1.1;
    p.stumble = Math.max(p.stumble, stumble);
    p.shake = 1;
    p.stats.hits += 1;
    this.ui.hurt(p, label);
    this.audio?.impact?.(0.8);
    this.audio?.hurt?.(0.6);
    if (p.hp <= 0) this._out(p, this.course.fire ? "BURNED" : "WRECKED");
    return true;
  }

  /** A serum (the story's - arsenal.js): restoration at once; the rest for their time, this runner's own. */
  _serum(p, key) {
    const def = SERUMS[key];
    if (!def) return;
    if (def.instant) {
      p.hp = HP;
      p.ammo = AMMO_MAX;
      this.ui.flash(p, `${def.name.toUpperCase()} // FULL`);
    } else {
      p.power = { key, left: def.duration, charges: def.charges ?? 0 };
      this.ui.flash(p, `${def.name.toUpperCase()} // ${def.duration} S`);
    }
    this.audio?.serumCollected?.();
  }

  _out(p, why) {
    if (p.out) return;
    p.out = why;
    p.vy = 0;
    this.ui.out(p, why);
    this.audio?.fallScream?.();
  }

  /* ---- aiming and throwing: through your ring ---- */

  /** Move the ring with the right stick (the mouse moves the keyboard player's - _pointer), kept in their half. */
  _aim(p, c, dt) {
    if (c.aimX !== undefined) {
      p.aim.x += c.aimX * AIM_SPEED * dt;
      p.aim.y -= c.aimY * AIM_SPEED * dt;
    }
    p.aim.x = THREE.MathUtils.clamp(p.aim.x, -AIM_EDGE, AIM_EDGE);
    p.aim.y = THREE.MathUtils.clamp(p.aim.y, -AIM_EDGE, AIM_EDGE);
    this._aimPoint(p);
  }

  /**
   * What's under the ring: the first thing along the camera's line through it -
   * something breakable, a solid thing, a wall or the ceiling, the floor - or,
   * past all that, a point far ahead. A throw goes there (so it lands where the
   * ring is); p.aimOn says it's over something a sphere can break (the ring
   * lights up - feedback, not a pull).
   */
  _aimPoint(p) {
    const cam = this.cameras[this.players.indexOf(p)];
    p.aimAt ??= new THREE.Vector3();
    if (!cam || !this.course) return p.aimAt;
    _ray.setFromCamera(_ndc.set(p.aim.x, p.aim.y), cam);
    const o = _ray.ray.origin;
    const dir = _ray.ray.direction;
    // (From past the runner: not their own shoulder.)
    const near = Math.max(2.5, cam.position.distanceTo(p.pos) + 0.8);
    const far = AIM_RANGE * 1.6;
    _ray.near = near;
    _ray.far = far;
    let best = far;
    // What the ring is on: something breakable, the rival, or nothing.
    let on = null;
    const hit = this._aimTargets?.length ? _ray.intersectObjects(this._aimTargets, false)[0] : null;
    if (hit) { best = hit.distance; on = "target"; }
    // The rival: their body.
    let rival = null;
    for (const q of this.players) {
      if (q === p || q.out || !q.avatar) continue;
      _rivalBox.setFromCenterAndSize(_rv.set(q.pos.x, q.pos.y + 0.95, q.pos.z), _rs.set(0.9, 1.9, 0.9));
      const at = _ray.ray.intersectBox(_rivalBox, _rv);
      const d = at ? o.distanceTo(at) : Infinity;
      if (d > near && d < best) { best = d; on = "rival"; rival = q; }
    }
    const solids = this._solids ?? [];
    const solid = solids.length ? _ray.intersectObjects(solids, false)[0] : null;
    if (solid && solid.distance < best) { best = solid.distance; on = null; }
    _ray.near = 0;
    _ray.far = Infinity;
    // The floor.
    if (dir.y < -1e-3) {
      const t = (0.05 - o.y) / dir.y;
      if (t > near && t < best) { best = t; on = null; }
    }
    // A wall or the ceiling, in steps along the line.
    if (this.course.surfaceHit) {
      for (let s = near; s < best; s += 2.5) {
        _seg.copy(o).addScaledVector(dir, s);
        _p.copy(o).addScaledVector(dir, Math.min(best, s + 2.5));
        const sh = this.course.surfaceHit(_seg, _p, 0);
        if (sh) { best = Math.min(best, o.distanceTo(sh.point ?? sh.position)); on = null; break; }
      }
    }
    p.aimRival = on === "rival" ? rival : null;
    p.aimOn = Boolean(on);
    if (on) return p.aimAt.copy(o).addScaledVector(dir, best);
    // Not on anything: close enough to something counts (the assist).
    const assist = this._assist(p, cam, near, far);
    if (assist) {
      p.aimOn = true;
      p.aimRival = assist.rival;
      return p.aimAt.copy(assist.point);
    }
    return p.aimAt.copy(o).addScaledVector(dir, best);
  }

  /**
   * Aim assist: the breakable (or the rival) nearest the ring on screen,
   * if it's within ASSIST of it past its own size, in range and in sight -
   * the story's resolveAim, in a runner's half. { point, rival } or null.
   */
  _assist(p, cam, near, far) {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    _camFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null;
    const consider = (centre, radius, rival = null) => {
      _rv.subVectors(centre, cam.position);
      const depth = _rv.dot(_camFwd);
      if (depth < near || depth > far) return;
      _ndc3.copy(centre).project(cam);
      const size = radius / (depth * tanHalf);
      const gap = Math.hypot((_ndc3.x - p.aim.x) * cam.aspect, _ndc3.y - p.aim.y) - size;
      if (gap > ASSIST || (best && gap >= best.gap)) return;
      best = { gap, point: centre.clone(), rival, depth };
    };
    for (const m of this._aimTargets ?? []) {
      const s = worldSphere(m);
      consider(s.center, Math.min(s.radius, 1.6));
    }
    for (const q of this.players) {
      if (q === p || q.out || !q.avatar) continue;
      consider(_rc.set(q.pos.x, q.pos.y + 1.0, q.pos.z), 0.6, q);
    }
    if (!best) return null;
    // In sight: nothing solid between.
    _sight.set(cam.position, _rv.subVectors(best.point, cam.position).normalize());
    _sight.near = near;
    _sight.far = cam.position.distanceTo(best.point) - 0.4;
    const blocked = (this._solids?.length ? _sight.intersectObjects(this._solids, false) : []).length > 0;
    return blocked ? null : best;
  }

  _cycleBall(p, step) {
    const i = BALL_ORDER.indexOf(p.ball);
    p.ball = BALL_ORDER[(i + step + BALL_ORDER.length) % BALL_ORDER.length];
    this.audio?.uiClick?.();
  }

  /**
   * The story's throw (main.js fire): the type's speed and drop - from the
   * launcher as fired, by hand slower and with a real arc - aimed high by
   * the drop so it lands on the ring.
   */
  _throw(p) {
    const def = BALLS[p.ball];
    if (p.throwCd > 0) return;
    // A special sphere: from the race's stock of it (RACE_SPECIALS); glass, from the spheres.
    // (Unlimited spheres: every throw free; Overdrive: glass free - the story's serums.)
    const special = def.key in RACE_SPECIALS;
    const free = p.power?.key === "infinite" || (p.power?.key === "overdrive" && !special);
    if (special && !free && p.specials[def.key] <= 0) {
      this.ui.flash(p, `NO ${def.name.toUpperCase()} LEFT`);
      return;
    }
    if (!special && !free && p.ammo < def.cost) {
      this.ui.flash(p, p.ammo < 1 ? "NO SPHERES" : `${def.name.toUpperCase()} NEEDS ${def.cost}`);
      return;
    }
    if (!this.balls.some((x) => !x.active)) return;
    if (!free) {
      if (special) p.specials[def.key] -= 1;
      else p.ammo -= def.cost;
    }
    p.stats.thrown += 1;
    const hand = !p.rig;
    const speed = def.speed * (hand ? SPHERE_FLIGHT.handSpeed : 1);
    // Where it goes: the ring's point - or, on the rival, where they'll be when it gets there.
    const aim = this._throwAim(p, speed);
    // Prism split (a serum): three at once, fanned across the lanes.
    const count = p.power?.key === "prism" ? 3 : 1;
    for (let k = 0; k < count; k += 1) {
      const b = this.balls.find((x) => !x.active);
      if (!b) break;
      _aimK.copy(aim);
      if (k) {
        _right.subVectors(aim, p.pos).setY(0).normalize();
        _aimK.x += -_right.z * (k === 1 ? 1.4 : -1.4);
        _aimK.z += _right.x * (k === 1 ? 1.4 : -1.4);
      }
      this._launch(p, b, def, hand, speed, _aimK);
    }
    if (hand) {
      p.throwCd = 0.32;
      p.avatar?.throw();
    } else p.throwCd = 0.22;
    this.audio?.throwBall?.();
  }

  /** The point a throw goes for: the ring's, led onto a rival who's running too. */
  _throwAim(p, speed) {
    const at = this._aimPoint(p).clone();
    const q = p.aimRival;
    if (!q || q.out) return at;
    const from = p.avatar?.root.position ?? p.pos;
    const pace = this.course.speedAt(q.distance) * (q.frozen > 0 ? CAUGHT.slow : q.stumble > 0 ? 0.45 : 1) * (q.power?.key === "overdrive" ? 1.25 : 1);
    let t = at.distanceTo(from) / speed;
    for (let i = 0; i < 2; i += 1) {
      this.course.sample(q.distance + pace * t, q.lateral, q.height + 1.0, at);
      t = at.distanceTo(from) / speed;
    }
    return at;
  }

  /** One sphere out: its look, its flight, from the launcher (or the hand) at `aim`. */
  _launch(p, b, def, hand, speed, aim) {
    b.gravity = def.gravity * (hand ? SPHERE_FLIGHT.handGravity : 1);
    b.ball = def.key;
    b.mesh.material = sphereMaterial(def.key);
    b.mesh.scale.setScalar(def.radius);
    if (b.halo) b.mesh.remove(b.halo);
    b.halo = sphereHalo(def.key);
    b.mesh.add(b.halo);
    b.touched = false;
    b.bounces = 0;
    b.life = SPHERE_FLIGHT.life;
    b.owner = p;
    b.active = true;
    b.landed = false;
    if (hand) b.mesh.position.copy(p.pos).add(_v.set(0.3, 1.5, -0.4));
    else p.rig.userData.muzzle.getWorldPosition(b.mesh.position);
    // At whatever is under the ring (so it lands there).
    launchVelocity(b.mesh.position, aim, speed, b.gravity, b.velocity);
    b.mesh.visible = true;
  }

  /**
   * Spheres in flight: the story's flight (spheres.js flySphere - the drop,
   * walls and ceilings handing it back, glass off solid things twice, the
   * floor), and what the race does with what they meet: break it (a glass
   * sphere punches on through a pane, slower), knock the rival, or - cryo,
   * shock, gravity - go off.
   */
  /** What a sphere can break right now (meshes, alive, shown). */
  _breakableMeshes() {
    const targets = [];
    for (const m of this.course.breakables()) {
      if (!m.isMesh || (!m.userData?.alive && m.userData?.alive !== undefined)) continue;
      if (m.visible === false || (m.parent && m.parent.visible === false)) continue;
      targets.push(m);
    }
    return targets;
  }

  _updateBalls(dt) {
    const targets = this._breakableMeshes();
    const world = {
      targets,
      solids: this._solids ?? [],
      surfaceHit: this.course.surfaceHit ? (a, b, r) => this.course.surfaceHit(a, b, r) : null,
      graze: true,
    };
    for (const b of this.balls) {
      if (!b.active) continue;
      const met = flySphere(b, dt, world);
      const pos = b.mesh.position;
      const rival = this._rivalOn(b, b.from, pos);
      if (rival && (!met || rival.distance <= (met.hit ?? met.surface ?? met.solid)?.distance)) {
        if (b.ball !== "glass") this._detonate(b, rival.point);
        else {
          // A glass sphere into them: hurt, and knocked off their stride.
          const heavy = b.owner.power?.key === "overdrive" ? 1.5 : 1;
          const landed = this._hurt(rival.player, RIVAL_HIT.damage * heavy, `HIT BY ${b.owner.name}`, { stumble: RIVAL_HIT.stumble });
          this.impact?.splash(rival.point, "glass", 1.1, null, { ground: false });
          if (landed) {
            b.owner.stats.landed = (b.owner.stats.landed ?? 0) + 1;
            this.ui.flash(b.owner, `HIT ${rival.player.name}`);
          }
        }
        this._spend(b);
        continue;
      }
      if (met?.type === "target") {
        if (b.ball !== "glass") { this._detonate(b, met.hit.point); this._spend(b); continue; }
        // It breaks it, and is gone in the burst.
        this._break(b, met.hit.object, met.hit.point);
        this._spend(b);
        continue;
      } else if (met?.type === "surface") {
        this.audio?.surfaceRicochet?.();
      } else if (met?.type === "solid") {
        if (met.detonate) { this._detonate(b, met.solid.point); this._spend(b); continue; }
        this.audio?.surfaceRicochet?.();
        if (met.spent) { this._spend(b); continue; }
      }
      if (floorSphere(b) === "detonate") { this._detonate(b, _w.copy(pos).setY(0.05)); this._spend(b); continue; }
      if (b.life <= 0) this._spend(b);
    }
  }

  _spend(b) {
    b.active = false;
    b.mesh.visible = false;
  }

  /** The other runner, if the segment a -> c passes through them. */
  _rivalOn(b, a, c) {
    if (!a) return null;
    for (const p of this.players) {
      if (p === b.owner || p.out || !p.avatar) continue;
      _w.set(p.pos.x, p.pos.y + 1.0, p.pos.z);
      _seg.subVectors(c, a);
      const len2 = Math.max(1e-8, _seg.lengthSq());
      const t = THREE.MathUtils.clamp(_v.subVectors(_w, a).dot(_seg) / len2, 0, 1);
      _p.copy(a).addScaledVector(_seg, t);
      if (Math.abs(_p.y - _w.y) < 0.95 && Math.hypot(_p.x - _w.x, _p.z - _w.z) < 0.45 + b.mesh.scale.x) return { player: p, point: _p.clone(), distance: t * Math.sqrt(len2) };
    }
    return null;
  }

  /** Break it, for whoever threw it (or ran into it: `info.body`). */
  _break(b, mesh, point, info = {}) {
    const r = this.course.breakTarget(mesh, { point, direction: b.velocity.clone().normalize(), ball: b.ball, ...info });
    if (!r || r.rejected) return r;
    b.owner.stats.broken += 1;
    if (r.spheres) b.owner.ammo = Math.min(AMMO_MAX, b.owner.ammo + Math.min(5, r.spheres));
    // A serum in it (the Foundry's and the Skyline's by name, the Labs' by its vial).
    const serum = r.serum ?? (r.powerupKind ? VIAL_SERUM[r.powerupKind] ?? r.powerupKind : null);
    if (serum && SERUMS[serum]) this._serum(b.owner, serum);
    this.audio?.glassBreak?.();
    this.impact?.splash(point, "glass", 1, null, { ground: point.y < 0.6 });
    return r;
  }

  /**
   * Cryo, shock and gravity, where they land (arsenal.js): cryo and shock
   * break everything breakable in reach; gravity drags in the sphere sacks
   * for its thrower; cryo puts out the fires in reach (the course's own:
   * the Labs' fire walls and vents, the Skyline's fires). The rival, caught
   * in it: frozen in ice (slowed right down), shocked (hurt, stumbling in
   * violet arcs), or pulled in (stumbles, into its lane).
   */
  _detonate(b, point) {
    const def = BALLS[b.ball];
    const reach = def.splash ?? 4;
    this.impact?.splash(point, b.ball, reach, null, { ground: point.y < 0.6 });
    this.audio?.impact?.(0.7);
    const caught = [];
    for (const m of this.course.breakables()) {
      if (!m.userData?.alive && m.userData?.alive !== undefined) continue;
      if (m.visible === false || (m.parent && m.parent.visible === false)) continue;
      m.getWorldPosition(_w);
      if (_w.distanceTo(point) > reach) continue;
      if (b.ball === "gravity" && m.userData?.kind !== "sack") continue;
      caught.push([m, _w.clone()]);
    }
    for (const [m, at] of caught) this._break(b, m, at);
    const out = this.course.special?.(b.ball, point, reach) ?? 0;
    if (out) this.ui.flash(b.owner, out > 1 ? `${out} FIRES OUT` : "FIRE OUT");
    for (const p of this.players) {
      if (p.out || !p.avatar) continue;
      if (Math.hypot(p.pos.x - point.x, p.pos.z - point.z) > reach * 0.6) continue;
      if (p === b.owner && b.ball !== "shock") continue;
      if (b.ball === "cryo") {
        this._hurt(p, 4, "FROZEN");
        p.frozen = Math.max(p.frozen, CAUGHT.frozen);
        p.stumble = Math.max(p.stumble, CAUGHT.frozen);
      } else if (b.ball === "shock") {
        this._hurt(p, p === b.owner ? 6 : 14, "SHOCKED");
        p.shocked = Math.max(p.shocked, CAUGHT.shocked);
        p.stumble = Math.max(p.stumble, CAUGHT.shocked * 0.8);
      }
      else if (b.ball === "gravity") {
        p.stumble = Math.max(p.stumble, 1);
        p.lane = LANES.reduce((best, x, i) => (Math.abs(x - point.x) < Math.abs(LANES[best] - point.x) ? i : best), p.lane);
        this.ui.flash(p, "PULLED IN");
      }
    }
  }

  /* ---- the rules ---- */

  _rules() {
    if (this.ended) return;
    const [a, b] = this.players;
    // Left behind (both still going).
    if (!a.out && !b.out && !a.finished && !b.finished) {
      const back = a.distance < b.distance ? a : b;
      const front = back === a ? b : a;
      const gap = front.distance - back.distance;
      back.behind = gap;
      front.behind = 0;
      if (gap > this.tier.behind) this._out(back, "LEFT BEHIND");
    }
    // Over the line.
    for (const p of this.players) {
      if (!p.out && !p.finished && p.distance >= this.course.finish) {
        p.finished = true;
        this._end(p, "FIRST OVER THE LINE");
        return;
      }
    }
    const alive = this.players.filter((p) => !p.out);
    if (alive.length === 1) {
      const runner = alive[0];
      const best = Math.max(...this.players.filter((p) => p.out).map((p) => p.distance));
      if (runner.distance > best + 1) this._end(runner, "STILL STANDING");
    } else if (!alive.length) {
      const far = this.players.reduce((x, y) => (y.distance > x.distance ? y : x));
      this._end(far, "GOT FURTHEST");
    }
  }

  _end(winner, how) {
    if (this.ended) return;
    this.ended = true;
    winner.wins += 1;
    this.winner = winner;
    this.how = how;
    this.state = "results";
    this.ui.showResults(winner, how);
    this.onEnd?.(this);
  }

  /** Where each runner is: 1st or 2nd, and by how much. */
  standing(p) {
    const other = this.players.find((q) => q !== p);
    if (!other) return { place: 1, gap: 0 };
    return { place: p.distance >= other.distance ? 1 : 2, gap: p.distance - other.distance };
  }

  /* ---- avatars, cameras, drawing ---- */

  _animate(p, dt) {
    const a = p.avatar;
    if (!a) return;
    a.root.position.copy(p.pos);
    a.root.rotation.y = 0;
    a.root.visible = !(p.invuln > 0.25 && Math.floor(this.time * 14) % 2 === 0) && !(p.out === "LEFT BEHIND");
    const running = !p.out && !p.finished && this.state === "racing";
    a.update(dt, { speed: running ? this.course.speedAt(p.distance) : 0, lateralVel: running ? p.latVel : 0, height: Math.max(0, p.height - p.ground), sliding: p.slide > 0, stumble: p.stumble > 0 ? 1 : 0 });
  }

  _cameraFollow(p, cam, dt, snap = false, viewer = p) {
    const c = this.course;
    const k = snap ? 1 : 1 - Math.exp(-dt * 8);
    c.sample(p.distance - 5.6, p.lateral * 0.55, 3.1 + p.height * 0.6, _v);
    cam.position.lerp(_v, k);
    c.sample(p.distance + 9, p.lateral * 0.35, 1.3 + p.height * 0.4, _w);
    if (snap || !cam.userData.look) cam.userData.look = _w.clone();
    cam.userData.look.lerp(_w, k);
    cam.lookAt(cam.userData.look);
    // A hit shakes their screen.
    if (viewer.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * 0.25 * viewer.shake;
      cam.position.y += (Math.random() - 0.5) * 0.2 * viewer.shake;
    }
  }

  /** Two screens, side by side: P1 left, P2 right. */
  render() {
    const r = this.renderer;
    if (this.state === "lobby" && this.step === "customise" && this.studio) {
      this.studio.render();
      this.ui.place();
      return;
    }
    if (!this.scene) {
      r.setClearColor(0x0b0f14, 1);
      r.clear();
      return;
    }
    const size = r.getSize(_v2);
    const half = size.x / 2;
    r.setScissorTest(true);
    this.cameras.forEach((cam, i) => {
      cam.aspect = half / size.y;
      cam.updateProjectionMatrix();
      r.setViewport(i * half, 0, half, size.y);
      r.setScissor(i * half, 0, half, size.y);
      r.render(this.scene, cam);
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    this.ui.place();
  }

  /** Where a world point is on a player's half of the screen. */
  screenOf(point, i, out = { x: 0, y: 0, visible: false }) {
    const cam = this.cameras[i];
    _w.copy(point).project(cam);
    const half = innerWidth / 2;
    out.visible = _w.z < 1 && Math.abs(_w.x) < 1 && Math.abs(_w.y) < 1;
    out.x = i * half + (_w.x * 0.5 + 0.5) * half;
    out.y = (-_w.y * 0.5 + 0.5) * innerHeight;
    return out;
  }
}

const _v2 = new THREE.Vector2();
const _ndc = new THREE.Vector2();
const _seg = new THREE.Vector3();
const _p = new THREE.Vector3();
const _ray = new THREE.Raycaster();
// (Every layer: the Skyline's glass, caches and vent covers are on their own - as the story's aim.)
_ray.layers.enableAll();
const _sight = new THREE.Raycaster();
_sight.layers.enableAll();
const _rivalBox = new THREE.Box3();
const _rv = new THREE.Vector3();
const _rs = new THREE.Vector3();
const _rc = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _ndc3 = new THREE.Vector3();
const _aimK = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, -1);
