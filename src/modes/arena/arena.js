/**
 * The Arena: 2-4 players on the roof, king of the hill.
 *
 * The roof of Ascension Tower (src/levels/meltdown/roof.js - its set, the
 * city, the sky; none of its enemies or its helicopter) and one camera over
 * all of it, BombSquad-style, framing everyone who is still up. Each player
 * is a Subject 07 in their controller's colour.
 *
 *   LOBBY        players enter (A on a controller, Enter for one keyboard
 *                and mouse); START moves everyone on to...
 *   CUSTOMISE    the players line up on the helipad and each changes their
 *                character, complexion and headwear on their own avatar,
 *                then whether to carry the launcher and its finish; then
 *                readies up. When everyone is ready the match starts.
 *   HOLD THE PAD stand on the helipad alone and the clock is yours: first
 *                to the target (30 s by default) wins, or whoever has the
 *                most when the match clock runs out (a 10-second countdown
 *                at the end; then overtime). Two or more on it: contested.
 *   HEALTH       100 each. Spheres hurt; at 0 you're taken out - back in 3 s,
 *                3 s of pad time lost, and whoever hit you gets the KO.
 *   SPHERES      thrown by hand where you aim (twin-stick), 15 at most,
 *                one back every 2.6 s, five from a duffel sack:
 *                  glass    a hard knock where it hits (1)
 *                  cryo     freezes everyone in 3.5 m for 4 s, then they slide (4)
 *                  shock    hits hard, blows everyone far out of 4 m - you too -
 *                           and its charge jumps on to whoever's near them (3)
 *                  gravity  a rift: whoever it catches is warped somewhere
 *                           random on the roof, off the pad (5)
 *   CARE PACKAGES  parachuted in every half minute or so, a serum on top:
 *                overdrive, unlimited spheres, prism split, kinetic shield.
 *   THE EDGES    the east and west ledges are open, and there are hatches:
 *                over one and you're out, as if taken out. The gas
 *                canisters blow.
 *
 *   const arena = new Arena({ renderer, pads, assetBase, audio, onExit });
 *   await arena.open();           // builds the roof, shows the lobby
 *   // every frame: arena.update(dt); arena.render();
 *   arena.close();
 */

import * as THREE from "../../three.js";
import { drawableType } from "../../systems/gpu.js";
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment } from "../../three-addons.js";
import { RoofLevel, CANISTER_RADIUS, EDGE } from "../../levels/meltdown/roof.js";
import { loadMeltdownAssets } from "../../levels/meltdown/assets.js";
import { PlayerAvatar } from "../../levels/meltdown/player.js";
import { SphereImpactFX } from "../../fx/sphere-impact.js";
import { serumPickup } from "../../systems/spheres.js";
import { BALLS, BALL_ORDER, SERUMS } from "../../systems/arsenal.js";
import { PAD_COLOURS, B } from "../../systems/gamepads.js";
import { SKIN_TONES } from "../../figure/look.js";
import { HEADWEAR } from "../../figure/outfit.js";
import { buildLauncher, mountLauncher, unmountLauncher, setLauncherSkin, slingLauncher } from "../../figure/launcher-model.js";
import { LAUNCHER_SKIN_ORDER, LAUNCHER_SKINS } from "../../figure/launcher-skins.js";
import { unlockedKeys } from "../../figure/kits.js";
import { ArenaUI } from "./arena-ui.js";
import { WEATHER, WEATHER_ORDER } from "../../levels/meltdown/weather.js";

const ASSET_NAMES = ["playerFemale", "playerMale", "launcher", "ventFan", "utilityBox", "alarmLight", "duffelBag"];

/** The hill: the helipad's inner ring. */
const HILL = new THREE.Vector3(0, 0, -8);
const HILL_RADIUS = 4.2;
const SPAWNS = [new THREE.Vector3(-9, 0, 9), new THREE.Vector3(9, 0, 9), new THREE.Vector3(-11, 0, 1), new THREE.Vector3(11, 0, 1)];

const RUN = 6.4;
const RADIUS = 0.45;
const HP = 100;
export const AMMO_MAX = 15;
const AMMO_START = 8;
const REGEN = 2.6;
const SACK_SPHERES = 5;
const THROW_SPEED = 19;
const THROW_GRAVITY = 10;
const THROW_COOLDOWN = 0.32;
/** A launcher's shot: faster, flatter (it still drops), and quicker to go again. */
const SHOT_SPEED = 27;
const SHOT_LIFT = 1.1;
const SHOT_COOLDOWN = 0.24;
const DODGE_SPEED = 14;
const DODGE_TIME = 0.18;
const DODGE_COOLDOWN = 0.85;
const OUT_PENALTY = 3;
/**
 * Capture the flag: two teams - P1 and P3 blue, P2 and P4 red (1v1 with two)
 * - each with a reactor core on a plinth at its end of the roof. Take the
 * other team's core and bring it home to your own plinth while yours is
 * still on it. The carrier is slower and can't throw; any hit makes them drop
 * it. Dropped, it waits 8 s (or until someone touches it: an enemy takes it
 * on, a teammate sends it home).
 */
export const TEAMS = [
  { key: "blue", name: "BLUE", hex: "#3aa0ff", base: new THREE.Vector3(-10, 0, 1), spawns: [new THREE.Vector3(-12, 0, 4), new THREE.Vector3(-12, 0, -2)] },
  { key: "red", name: "RED", hex: "#ff4d5a", base: new THREE.Vector3(10, 0, 1), spawns: [new THREE.Vector3(12, 0, 4), new THREE.Vector3(12, 0, -2)] },
];
const CORE_TOUCH = 1.15;
const CORE_DROP_TIME = 8;
const CAPTURE_RADIUS = 1.6;
const CARRY_SPEED = 0.82;
export const MODE_TARGETS = { koth: [20, 30, 45, 60], ctf: [1, 3, 5] };
const RESPAWN = 3;
const KO_CREDIT = 4;
/** Care packages: the first after this long, then every so often. */
const DROP_FIRST = 18;
const DROP_EVERY = [22, 32];
const DROP_HEIGHT = 26;
/** The serums that make sense in a fight (not the story's healing or fire-proofing). */
export const ARENA_POWERS = ["overdrive", "infinite", "prism", "shield"];

/** What each sphere does when it goes off. */
/**
 * What each sphere does in the Arena (its own rules, not the story's):
 *   glass    a knock where it hits
 *   cryo     freezes everyone near it - 4 s, then they slide
 *   shock    hits hard and blows everyone back a long way (the thrower too, half as hard)
 *   gravity  a rift: whoever it catches is thrown to a random place on the roof, off the pad
 */
const EFFECT = {
  glass: { radius: 0, knock: 10, stun: 0.3, damage: 20 },
  cryo: { radius: 3.5, freeze: 4, damage: 10 },
  shock: { radius: 4, knock: 26, stun: 0.7, self: 0.5, damage: 48 },
  // Its charge (the Roof's, roof.js shock): everyone it hits crawls with
  // violet arcs, and it jumps on to the nearest one within `jump` m, `delay`
  // s later - stunned, hurt a little - up to `hops` jumps; never back to
  // the thrower.
  charge: { arcs: 1.1, jump: 5, delay: 0.14, hops: 3, stun: 1.1, damage: 8 },
  gravity: { radius: 3, stun: 0.6, damage: 0 },
};
/** What each sphere costs in the Arena: the stronger, the dearer. */
export const ARENA_COST = { glass: 1, cryo: 4, shock: 3, gravity: 5 };
const CANISTER_DAMAGE = 45;

export const MATCH_TARGETS = [20, 30, 45, 60];

/** The podium's blocks (x across, h tall), 1st, 2nd, 3rd; where it stands on the helipad. */
const PODIUM = [{ x: 0, h: 1.05 }, { x: -1.75, h: 0.72 }, { x: 1.75, h: 0.45 }];
const PODIUM_W = 1.6;
const PODIUM_D = 1.3;
const PODIUM_Z = 0.8;
/** How far in front of a place's spot its card goes (the front of its block). */
export const PODIUM_FRONT = PODIUM_D / 2;
export const SKIN_KEYS = Object.keys(SKIN_TONES);
export const HEAD_KEYS = Object.keys(HEADWEAR);

const _v = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _bounce = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);
const _ndc = new THREE.Vector2();

export class Arena {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {import("../../systems/gamepads.js").Gamepads} o.pads
   * @param {string} o.assetBase                 assets/meltdown/
   * @param {object} [o.audio]                   Level1Audio (throw, glass, explosion, scream)
   * @param {(where: string) => void} [o.onExit] back to the main menu
   */
  constructor({ renderer, pads, assetBase, audio = null, onExit = null, onMatchEnd = null }) {
    /** Called with the Arena when a match is won (the trophies and statistics, main.js). */
    this.onMatchEnd = onMatchEnd;
    this.renderer = renderer;
    this.pads = pads;
    this.assetBase = assetBase;
    this.audio = audio;
    this.onExit = onExit;
    this.state = "closed"; // closed | lobby | customise | countdown | playing | paused | results
    this.players = [];
    this.target = 30;
    /** "koth" (hold the pad) or "ctf" (capture the core). */
    this.mode = "koth";
    this.teamScore = [0, 0];
    this.matchSeconds = 180;
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
    this.ui = new ArenaUI(this);
    this._onKey = (e) => this._key(e);
    this._onMouse = (e) => this._mouseEvent(e);
  }

  /* ================================================================ */
  /* Opening and closing                                              */
  /* ================================================================ */

  async open(mode = this.mode) {
    if (mode !== this.mode) this.target = mode === "ctf" ? 3 : 30;
    this.mode = mode;
    if (!this.scene) await this._build();
    this._showModeSet();
    for (const p of this.players) this._removeAvatar(p);
    this.players = [];
    this.state = "lobby";
    this.ui.showLobby();
    addEventListener("keydown", this._onKey, true);
    addEventListener("keyup", this._onKey, true);
    addEventListener("pointermove", this._onMouse, true);
    addEventListener("pointerdown", this._onMouse, true);
    addEventListener("pointerup", this._onMouse, true);
    this._clearField();
  }

  close() {
    this.state = "closed";
    removeEventListener("keydown", this._onKey, true);
    removeEventListener("keyup", this._onKey, true);
    removeEventListener("pointermove", this._onMouse, true);
    removeEventListener("pointerdown", this._onMouse, true);
    removeEventListener("pointerup", this._onMouse, true);
    this.keys.clear();
    this.ui.hideAll();
    this._clearField();
    this.roof?.setWeather("clear");
    for (const p of this.players) this._removeAvatar(p);
    this.players = [];
  }

  get active() {
    return this.state !== "closed";
  }

  async _build() {
    const renderer = this.renderer;
    const scene = new THREE.Scene();
    scene.name = "ArenaScene";
    scene.background = new THREE.Color(0x1a120d);
    scene.fog = new THREE.FogExp2(0x1a120d, 0.0062);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    scene.environment = this.envTexture;
    pmrem.dispose();
    this.scene = scene;
    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(42, size.x / size.y, 0.1, 400);
    this.camera.position.set(0, 26, 22);
    this.camera.lookAt(0, 0, -2);
    scene.add(this.camera);
    this.camTarget = new THREE.Vector3(0, 0, -2);
    this.camHeight = 24;
    this.camPos = new THREE.Vector3(0, 26, 22);
    this.camLook = new THREE.Vector3(0, 0, -2);

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: drawableType(renderer) }));
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 3, size.y / 3), 0.55, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.assets = await loadMeltdownAssets(this.assetBase, { names: ASSET_NAMES });
    const roof = new RoofLevel({ assets: this.assets, endless: true, assetBase: this.assetBase });
    this.roof = roof;
    roof.addTo(scene);
    // The roof as a set: no helicopter, its lift shut.
    if (roof.heli) roof.heli.root.visible = false;
    roof._liftClose = 1;
    roof.lift?.userData.lift?.setDoors?.(0);
    this.sacks = roof.groups.pickups.children.map((sack) => ({ sack, at: sack.position.clone(), back: 0 }));
    // A strong key light from above, so the players read from the high camera.
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(-6, 20, 8);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x3a2a20, 0.9));
    // A spotlight for the line-up and the podium.
    this.stageLight = new THREE.SpotLight(0xfff4e6, 0, 18, 0.55, 0.6, 1.2);
    this.stageLight.position.set(0, 7, -3);
    this.stageLight.target.position.copy(HILL);
    scene.add(this.stageLight, this.stageLight.target);

    this.impact = new SphereImpactFX(scene);
    this._buildPodium();
    this._buildCrown();

    // The hill: a ring round the helipad's middle, lit in the colour of whoever holds it.
    this.hillMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.hillRing = new THREE.Mesh(new THREE.RingGeometry(HILL_RADIUS - 0.18, HILL_RADIUS, 72), this.hillMaterial);
    this.hillRing.rotation.x = -Math.PI / 2;
    this.hillRing.position.set(HILL.x, 0.04, HILL.z);
    this._buildCores(scene);
    this.hillFillMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false });
    this.hillFill = new THREE.Mesh(new THREE.CircleGeometry(HILL_RADIUS - 0.18, 72), this.hillFillMaterial);
    this.hillFill.rotation.x = -Math.PI / 2;
    this.hillFill.position.set(HILL.x, 0.035, HILL.z);
    this.hillLight = new THREE.PointLight(0xffffff, 0, 12, 1.6);
    this.hillLight.position.set(HILL.x, 2.5, HILL.z);
    scene.add(this.hillRing, this.hillFill, this.hillLight);

    // Thrown spheres: a pool.
    this.ballGeometry = new THREE.SphereGeometry(0.17, 16, 12);
    this.ballMaterials = {};
    for (const k of BALL_ORDER) {
      const glow = BALLS[k].glow ?? [1.4, 1.6, 1.8];
      this.ballMaterials[k] = new THREE.MeshBasicMaterial({ color: new THREE.Color(glow[0], glow[1], glow[2]) });
    }
    this.balls = [];
    for (let i = 0; i < 36; i += 1) {
      const mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterials.glass);
      mesh.visible = false;
      scene.add(mesh);
      this.balls.push({ mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), kind: "glass", owner: null, active: false, life: 0 });
    }
    this.wells = [];
    this.iceGeometry = new THREE.IcosahedronGeometry(0.7, 1);
    this.iceMaterial = new THREE.MeshStandardMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1, emissive: 0x2a7f99, flatShading: true, depthWrite: false });
    this.shieldGeometry = new THREE.SphereGeometry(0.95, 24, 16);
    this._buildDrop();
    // Compiled now, behind the loading screen.
    renderer.compile(scene, this.camera);
  }

  resize(w, h) {
    if (!this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.bloom.setSize(w / 3, h / 3);
  }

  /** Where a world point is on the screen (for the labels over players). */
  screenOf(point, out = { x: 0, y: 0, visible: false }) {
    _w.copy(point).project(this.camera);
    out.visible = _w.z < 1 && Math.abs(_w.x) < 1.2 && Math.abs(_w.y) < 1.2;
    out.x = (_w.x * 0.5 + 0.5) * innerWidth;
    out.y = (-_w.y * 0.5 + 0.5) * innerHeight;
    return out;
  }

  /* ================================================================ */
  /* Players: entering, customising                                   */
  /* ================================================================ */

  /** Enter a player (the lobby): `input` = { type: "pad", index } | { type: "keyboard" }. */
  join(input) {
    if (this.players.length >= 4) return null;
    const used = new Set(this.players.map((p) => p.slot));
    // A controller plays in its own colour; the keyboard takes a colour no
    // connected controller has.
    const padSlots = new Set([...this.pads.pads.values()].map((r) => r.slot));
    let slot = input.type === "pad" ? (this.pads.pads.get(input.index)?.slot ?? 0) : [0, 1, 2, 3].find((s) => !used.has(s) && !padSlots.has(s)) ?? 0;
    if (used.has(slot)) { slot = 0; while (used.has(slot)) slot += 1; }
    const colour = PAD_COLOURS[slot % PAD_COLOURS.length];
    const p = {
      slot, colour, input, name: `P${slot + 1}`,
      character: slot % 2 ? "playerMale" : "playerFemale",
      skin: SKIN_KEYS[slot % SKIN_KEYS.length],
      headwear: HEAD_KEYS[1 + (slot % (HEAD_KEYS.length - 1))],
      // The launcher on their shoulder (or throw by hand), and its finish.
      launcher: true,
      launcherSkin: LAUNCHER_SKIN_ORDER[1 + (slot * 3) % (LAUNCHER_SKIN_ORDER.length - 1)],
      page: "character",
      ready: false, row: 0,
      score: 0, kos: 0, outs: 0, wins: 0,
    };
    this.players.push(p);
    this.players.sort((a, b) => a.slot - b.slot);
    this.audio?.uiClick?.();
    return p;
  }

  leave(p) {
    this._removeAvatar(p);
    this.players = this.players.filter((x) => x !== p);
  }

  /** On to the line-up: everyone's avatar on the helipad, to dress. */
  toCustomise() {
    if (this.players.length < 2) return;
    this._clearField();
    for (const p of this.players) {
      p.ready = false;
      p.row = 0;
      p.page = "character";
      if (!p.avatar) this._makeAvatar(p);
    }
    this._lineUp();
    this._cutToStage = true;
    this.state = "customise";
    this.ui.showCustomise();
  }

  /** Change one thing about a player (customise): "character" | "skin" | "headwear" | "launcher" | "launcherSkin", by step. */
  change(p, what, step) {
    if (what === "character") {
      p.character = p.character === "playerFemale" ? "playerMale" : "playerFemale";
      this._makeAvatar(p);
      this._lineUp();
    } else if (what === "skin") {
      p.skin = SKIN_KEYS[(SKIN_KEYS.indexOf(p.skin) + step + SKIN_KEYS.length) % SKIN_KEYS.length];
      p.avatar?.setSkinTone(p.skin);
    } else if (what === "headwear") {
      // (Only what's unlocked: the kits' pieces once earned - src/figure/kits.js.)
      const heads = unlockedKeys(HEADWEAR);
      p.headwear = heads[(heads.indexOf(p.headwear) + step + heads.length) % heads.length];
      p.avatar?.setHeadwear(p.headwear);
    } else if (what === "launcher") {
      p.launcher = !p.launcher;
      this._fitLauncher(p);
    } else if (what === "launcherSkin" && p.launcher) {
      const skins = unlockedKeys(LAUNCHER_SKINS);
      p.launcherSkin = skins[(skins.indexOf(p.launcherSkin) + step + skins.length) % skins.length];
      setLauncherSkin(p.rig, p.launcherSkin);
    }
    this.audio?.uiClick?.();
  }

  /** The launcher on their shoulder, in their finish - or none, arms free. */
  _fitLauncher(p) {
    if (!p.avatar) return;
    if (p.launcher && !p.rig) {
      p.rig = buildLauncher(this.assets.get("launcher"), p.launcherSkin);
      mountLauncher(p.avatar, p.rig);
    } else if (!p.launcher && p.rig) {
      unmountLauncher(p.avatar, p.rig);
      p.rig = null;
    }
  }

  setReady(p, ready) {
    p.ready = ready;
    // A little flourish as they're ready (by hand).
    if (ready && !p.rig) p.avatar?.throw();
    this.audio?.uiClick?.();
    if (this.players.length >= 2 && this.players.every((x) => x.ready)) {
      this.ui.banner("ALL READY", "", 0.9);
      this._startIn = 0.9;
    } else this._startIn = null;
  }

  /** The line-up on the helipad, facing the camera. */
  _lineUp() {
    const n = this.players.length;
    this.players.forEach((p, i) => {
      const x = (i - (n - 1) / 2) * 1.55;
      p.pos = new THREE.Vector3(HILL.x + x, 0, HILL.z + 0.6);
      p.yaw = Math.PI;
      p.aim = new THREE.Vector3(0, 0, 1);
      p.vel = new THREE.Vector3();
      p.frozen = 0;
      p.dodge = 0;
      p.stun = 0;
      p.shocked = 0;
      p.invuln = 0;
      if (p.avatar) {
        p.avatar.root.position.copy(p.pos);
        p.avatar.root.rotation.y = Math.PI;
        p.avatar.root.visible = true;
        p.avatar.reachUp = 0;
        if (p.rig) slingLauncher(p.avatar, p.rig, false);
      }
    });
  }

  _makeAvatar(p) {
    this._removeAvatar(p);
    const a = new PlayerAvatar();
    a.hold = 0;
    a.setOutfit(p.colour.key);
    a.setHeadwear(p.headwear);
    a.setSkinTone(p.skin);
    a.setHairColour("natural");
    const template = this.assets.get(p.character)?.template;
    if (template) a.setModel(template);
    this.scene.add(a.root);
    p.avatar = a;
    p.rig = null;
    this._fitLauncher(p);
    // Under them: a ring in their colour.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), new THREE.MeshBasicMaterial({ color: p.colour.hex, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    a.root.add(ring);
    const ice = new THREE.Mesh(this.iceGeometry, this.iceMaterial);
    ice.scale.set(0.85, 1.45, 0.85);
    ice.position.y = 0.95;
    ice.visible = false;
    a.root.add(ice);
    const shield = new THREE.Mesh(this.shieldGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(SERUMS.shield.colour), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    shield.scale.set(1, 1.25, 1);
    shield.position.y = 1;
    shield.visible = false;
    a.root.add(shield);
    p.ring = ring;
    p.ice = ice;
    p.shieldMesh = shield;
  }

  _removeAvatar(p) {
    if (!p.avatar) return;
    this.scene?.remove(p.avatar.root);
    p.ring?.geometry.dispose();
    p.ring?.material.dispose();
    p.shieldMesh?.material.dispose();
    p.avatar = null;
  }

  _resetPlayer(p, spawn) {
    p.pos = spawn.clone();
    p.vel = new THREE.Vector3();
    p.knock = new THREE.Vector3();
    p.vy = 0;
    p.yaw = Math.atan2(-(HILL.x - spawn.x), -(HILL.z - spawn.z));
    p.aim = new THREE.Vector3(HILL.x - spawn.x, 0, HILL.z - spawn.z).normalize();
    p.hp = HP;
    p.regen = 0;
    p.throwCd = 0;
    p.dodge = 0;
    p.dodgeCd = 0;
    p.dodgeDir = new THREE.Vector3();
    p.frozen = 0;
    p.stun = 0;
    p.shocked = 0;
    p.invuln = 1.2;
    p.falling = false;
    p.out = 0;
    p.lastHit = null;
    p.lastHitAt = -99;
    p.hurtAt = -99;
    // (A button still held from the menus or a respawn is not a press.)
    p.prev = { throw: true, dodge: true, lb: true, rb: true, start: true, b: true };
    if (p.avatar) {
      p.avatar.root.position.copy(p.pos);
      p.avatar.root.visible = true;
      p.avatar.reachUp = 0;
      if (p.rig) slingLauncher(p.avatar, p.rig, false);
    }
  }

  /* ================================================================ */
  /* The match                                                        */
  /* ================================================================ */

  startMatch() {
    if (this.players.length < 2) return;
    this._clearField();
    this._startIn = null;
    this.teamScore = [0, 0];
    this.winningTeam = null;
    this._resetCores();
    this.players.forEach((p, i) => {
      p.team = p.slot % 2;
      p.carrying = null;
      // In capture the flag, the ring under them is their team's.
      p.ring?.material.color.set(this.mode === "ctf" ? TEAMS[p.team].hex : p.colour.hex);
      p.score = 0;
      p.kos = 0;
      p.outs = 0;
      p.ball = "glass";
      p.ammo = AMMO_START;
      p.power = null;
      // For the awards at the end.
      p.stats = { thrown: 0, hits: 0, damage: 0, taken: 0, ledge: 0, pickups: 0, frozen: 0, dodges: 0 };
      if (!p.avatar) this._makeAvatar(p);
      this._resetPlayer(p, this._spawnFor(p, i));
    });
    this.clock = this.matchSeconds;
    this.time = 0;
    this.holder = null;
    this.contested = false;
    this._overtime = false;
    this._lastTick = null;
    this.nextDrop = DROP_FIRST;
    this.countdown = 3.4;
    this.state = "countdown";
    // A different night each match: clear, rain or a storm.
    const sky = WEATHER_ORDER[[0, 0, 1, 1, 2][Math.floor(Math.random() * 5)]];
    this.roof.setWeather(sky, this.audio);
    this.weatherKey = sky;
    this.ui.showMatch();
    this.ui.banner("3", sky === "clear" ? "" : WEATHER[sky].label.toUpperCase() + " TONIGHT", 0.9);
  }

  _clearField() {
    for (const p of this.players) if (p.carrying) p.carrying = null;
    if (this.cores) this._resetCores();
    for (const b of this.balls ?? []) { b.active = false; b.mesh.visible = false; }
    this.wells = [];
    this._jumps = [];
    this.roof?.electric.clear();
    this.impact?.clear?.();
    for (const s of this.sacks ?? []) { s.sack.visible = true; s.back = 0; }
    this._endDrop();
    if (this.podiumGroup) this.podiumGroup.visible = false;
    if (this.crown) this.crown.visible = false;
    // Canisters back up for a new match.
    for (const c of this.roof?.canisters ?? []) {
      if (c.hit.userData.alive) continue;
      c.hit.userData.alive = true;
      c.group.visible = true;
      if (!this.roof.cover.includes(c.box)) this.roof.cover.push(c.box);
      if (!this.roof.breakables.includes(c.hit)) this.roof.breakables.push(c.hit);
    }
  }

  pause(on = true) {
    if (on && (this.state === "playing" || this.state === "countdown")) {
      this._resume = this.state;
      this.state = "paused";
      this.ui.showPause(true);
    } else if (!on && this.state === "paused") {
      this.state = this._resume ?? "playing";
      this.ui.showPause(false);
      for (const p of this.players) p.prev = { throw: true, dodge: true, lb: true, rb: true, start: true, b: true };
    }
  }

  /** A controller dropped out mid-match: pause, like a console. */
  padLost(index) {
    if (this.players.some((p) => p.input.type === "pad" && p.input.index === index)) this.pause(true);
    this.ui.refreshLobby();
  }

  toLobby() {
    this._clearField();
    for (const p of this.players) { this._removeAvatar(p); p.ready = false; }
    this.state = "lobby";
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
      // The arena owns the keyboard while it is up.
      this.ui.onKey(e);
      if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace"].includes(e.code)) e.preventDefault();
    }
    e.stopImmediatePropagation();
  }

  _mouseEvent(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (e.type === "pointerdown" && e.button === 0 && (this.state === "playing" || this.state === "countdown")) {
      this.mouse.down = true;
      if (e.target === this.renderer.domElement) e.stopImmediatePropagation();
    }
    if (e.type === "pointerup" && e.button === 0) this.mouse.down = false;
  }

  /** One player's controls this frame. */
  _read(p) {
    const out = { mx: 0, mz: 0, ax: 0, az: 0, aim: false, throw: false, dodge: false, lb: false, rb: false, start: false, b: false };
    if (p.input.type === "pad") {
      const rec = this.pads.pads.get(p.input.index);
      if (!rec) return out;
      out.mx = rec.left.x;
      out.mz = rec.left.y;
      if (rec.right.m > 0.3) { out.ax = rec.right.x; out.az = rec.right.y; out.aim = true; }
      out.throw = rec.rt > 0.45;
      out.dodge = !!rec.buttons[B.A];
      out.lb = !!rec.buttons[B.LB];
      out.rb = !!rec.buttons[B.RB];
      out.start = !!rec.buttons[B.START];
      out.b = !!rec.buttons[B.B];
    } else {
      const k = this.keys;
      out.mx = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
      out.mz = (k.has("KeyS") ? 1 : 0) - (k.has("KeyW") ? 1 : 0);
      const m = Math.hypot(out.mx, out.mz);
      if (m > 1) { out.mx /= m; out.mz /= m; }
      // Aim: from the player to the mouse on the ground.
      _ndc.set((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, this.camera);
      if (_ray.ray.intersectPlane(_plane, _v) && p.pos) {
        _v.sub(p.pos).setY(0);
        if (_v.lengthSq() > 0.04) { _v.normalize(); out.ax = _v.x; out.az = _v.z; out.aim = true; }
      }
      out.throw = this.mouse.down;
      out.dodge = k.has("Space");
      out.lb = k.has("KeyQ");
      out.rb = k.has("KeyE");
      out.start = k.has("Escape");
    }
    return out;
  }

  /* ================================================================ */
  /* Frame                                                            */
  /* ================================================================ */

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (!this.scene) return;
    const t = (this.ambientTime = (this.ambientTime ?? 0) + dt);
    // The roof lives on behind everything: the city, steam, smoke, the wind sock.
    this.roof.fire.setTime(t);
    this.roof.city?.update(dt, t, { haze: this.roof.cityHaze });
    this.roof.weather?.update(dt, t);
    for (const piece of this.roof._ticking) piece.userData.tick?.(dt, t);
    const staged = this.state === "customise" || this.state === "results";
    this.stageLight.intensity += ((staged ? 14 : 0) - this.stageLight.intensity) * Math.min(1, dt * 4);
    // Close up on the white helipad, the glow is a haze: less of it.
    this.bloom.strength += ((staged ? 0.16 : 0.55) - this.bloom.strength) * Math.min(1, dt * 4);

    this.ui.update(dt);
    if (this.state === "lobby") {
      this._orbit(dt, t);
      return;
    }
    if (this.state === "customise") {
      if (this._startIn != null) {
        this._startIn -= dt;
        if (this._startIn <= 0) { this.startMatch(); return; }
      }
      this._stageCamera(dt);
      for (const p of this.players) this._animate(p, dt, 0, { face: Math.PI });
      return;
    }
    if (this.state === "results") {
      this._stageCamera(dt, true);
      for (const p of this.players) this._animate(p, dt, 0, { face: Math.PI, stand: true });
      this._updateCrown(dt, t);
      this.impact.update(dt);
      return;
    }
    // Start pauses (and unpauses) from any player.
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
      if (now !== before) {
        this.ui.banner(now > 0 ? String(now) : "GO", now > 0 ? "" : "HOLD THE PAD", now > 0 ? 0.9 : 1.2);
        this.audio?.uiClick?.();
      }
      for (const p of this.players) this._animate(p, dt, 0);
      this._frame(dt);
      if (this.countdown <= 0) this.state = "playing";
      return;
    }
    this.time += dt;
    this.clock = Math.max(0, this.clock - dt);
    // The last ten seconds, counted down.
    if (this.clock > 0 && this.clock <= 10) {
      const n = Math.ceil(this.clock);
      if (n !== this._lastTick) { this._lastTick = n; this.ui.finalTick(n); this.audio?.uiClick?.(); }
    }
    for (const p of this.players) this._control(p, dt);
    this._collidePlayers();
    for (const p of this.players) this._move(p, dt);
    this._updateBalls(dt);
    this._updateCharge(dt);
    this._updateWells(dt);
    this._updateSacks(dt);
    this._updateDrop(dt, t);
    if (this.mode === "ctf") this._updateCores(dt);
    else this._updateHill(dt);
    this._frame(dt);
    this._checkEnd();
  }

  _control(p, dt) {
    const c = this._read(p);
    p.throwCd = Math.max(0, p.throwCd - dt);
    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.shocked = Math.max(0, (p.shocked ?? 0) - dt);
    if (p.coreCd > 0) p.coreCd -= dt;
    // Serums run out.
    if (p.power) {
      p.power.t -= dt;
      if (p.power.t <= 0 || (p.power.key === "shield" && p.power.charges <= 0)) p.power = null;
    }
    if (p.ammo < AMMO_MAX) {
      p.regen += dt;
      if (p.regen >= REGEN) { p.regen = 0; p.ammo += 1; }
    } else p.regen = 0;
    if (p.out > 0) {
      p.out -= dt;
      if (p.out <= 0) this._respawn(p);
      p.prev = { ...p.prev, throw: c.throw, dodge: c.dodge, lb: c.lb, rb: c.rb };
      return;
    }
    // The sphere wheel: RB clockwise, LB back.
    if (c.rb && !p.prev.rb) this._cycle(p, 1);
    if (c.lb && !p.prev.lb) this._cycle(p, -1);
    const can = p.frozen <= 0 && p.stun <= 0 && !p.falling;
    // Where they look: the right stick (or the mouse), else where they run.
    if (c.aim) p.aim.set(c.ax, 0, c.az).normalize();
    else if (Math.hypot(c.mx, c.mz) > 0.3) p.aim.set(c.mx, 0, c.mz).normalize();
    // Run (faster on overdrive).
    const run = RUN * (p.power?.key === "overdrive" ? 1.3 : 1) * (p.carrying ? CARRY_SPEED : 1);
    const wantX = can ? c.mx * run : 0;
    const wantZ = can ? c.mz * run : 0;
    const grip = p.frozen > 0 ? 0 : 1 - Math.exp(-dt * 14);
    p.vel.x += (wantX - p.vel.x) * grip;
    p.vel.z += (wantZ - p.vel.z) * grip;
    // Dodge: a short burst, untouchable.
    if (c.dodge && !p.prev.dodge && can && p.dodgeCd <= 0) {
      const m = Math.hypot(c.mx, c.mz);
      p.dodgeDir.set(m > 0.2 ? c.mx / m : p.aim.x, 0, m > 0.2 ? c.mz / m : p.aim.z);
      p.dodge = DODGE_TIME;
      p.dodgeCd = DODGE_COOLDOWN;
      p.invuln = Math.max(p.invuln, DODGE_TIME + 0.08);
      p.stats.dodges += 1;
    }
    // Throw.
    if (c.throw && !p.prev.throw && can && p.throwCd <= 0) this._throw(p);
    p.prev.throw = c.throw;
    p.prev.dodge = c.dodge;
    p.prev.lb = c.lb;
    p.prev.rb = c.rb;
  }

  _cycle(p, step) {
    const i = BALL_ORDER.indexOf(p.ball);
    p.ball = BALL_ORDER[(i + step + BALL_ORDER.length) % BALL_ORDER.length];
    this.audio?.uiClick?.();
  }

  _throw(p) {
    if (p.carrying) { this.ui.flash(p, "HANDS FULL: BRING IT HOME"); return; }
    const cost = ARENA_COST[p.ball] ?? BALLS[p.ball].cost;
    const free = p.power?.key === "overdrive" || p.power?.key === "infinite";
    if (!free && p.ammo < cost) {
      this.ui.flash(p, "NOT ENOUGH SPHERES");
      return;
    }
    if (!free) p.ammo -= cost;
    // From the launcher's muzzle, fast and flat; or thrown, in an arc.
    const shot = Boolean(p.rig);
    p.throwCd = shot ? SHOT_COOLDOWN : THROW_COOLDOWN;
    if (shot) p.rig.userData.muzzle.getWorldPosition(_muzzle);
    else p.avatar?.throw();
    // Prism split: three, fanned.
    const fan = p.power?.key === "prism" ? [-0.22, 0, 0.22] : [0];
    for (const angle of fan) {
      const b = this.balls.find((x) => !x.active);
      if (!b) break;
      p.stats.thrown += 1;
      b.landed = false;
      b.bounces = 0;
      b.active = true;
      b.kind = p.ball;
      b.owner = p;
      b.life = 0;
      b.mesh.material = this.ballMaterials[p.ball];
      b.mesh.visible = true;
      _v.copy(p.aim).applyAxisAngle(_w.set(0, 1, 0), angle);
      if (shot) {
        b.pos.copy(_muzzle);
        b.vel.copy(_v).multiplyScalar(SHOT_SPEED);
        b.vel.y = SHOT_LIFT;
      } else {
        b.pos.copy(p.pos).addScaledVector(_v, 0.6).setY(1.45);
        b.vel.copy(_v).multiplyScalar(THROW_SPEED);
        b.vel.y = 3.2;
      }
    }
    this.audio?.throwBall?.();
  }

  _move(p, dt) {
    const a = p.avatar;
    if (p.out > 0) {
      if (a) a.root.visible = false;
      return;
    }
    const knockDecay = Math.exp(-dt * (p.frozen > 0 ? 0.9 : 3.4));
    p.knock.multiplyScalar(knockDecay);
    if (p.frozen > 0) p.frozen = Math.max(0, p.frozen - dt);
    if (p.dodge > 0) p.dodge = Math.max(0, p.dodge - dt);
    _v.copy(p.vel).add(p.knock);
    if (p.dodge > 0) _v.addScaledVector(p.dodgeDir, DODGE_SPEED);
    p.pos.x += _v.x * dt;
    p.pos.z += _v.z * dt;
    if (!p.falling) {
      // The parapets and the cover hold them; the open ledges and hatches don't.
      this.roof.clampPlayer(p.pos);
      if (this.roof.groundAt(p.pos) === null) {
        p.falling = true;
        p.vy = 0;
        this._takenOut(p, "fall");
        this.audio?.fallScream?.();
      }
    }
    if (p.falling) {
      p.vy -= 22 * dt;
      p.pos.y += p.vy * dt;
      if (p.pos.y < -9) {
        p.falling = false;
        p.out = RESPAWN;
        if (a) a.root.visible = false;
        return;
      }
    }
    this._animate(p, dt, Math.hypot(p.vel.x, p.vel.z));
  }

  /** Out: off the edge ("fall") or taken out ("ko"). The pad time lost, the KO credited. */
  _takenOut(p, how) {
    p.outs += 1;
    if (this.mode === "koth") p.score = Math.max(0, p.score - OUT_PENALTY);
    // Off the roof with it, it goes home; taken out, it drops where they fell.
    if (p.carrying) {
      if (how === "fall") this._coreHome(p.carrying, `${TEAMS[p.carrying.team].name} CORE IS HOME`);
      else this._dropCore(p);
    }
    p.power = null;
    const by = p.lastHit && this.time - p.lastHitAt < KO_CREDIT && p.lastHit !== p ? p.lastHit : null;
    if (by) {
      by.kos += 1;
      if (how === "fall") by.stats.ledge += 1;
    }
    if (how === "ko") {
      this.ui.feed(by ? `${by.name} took out ${p.name}` : `${p.name} went down`, by ? by.colour.hex : p.colour.hex, p.colour.hex);
      // A burst in their colour where they went down.
      const c = new THREE.Color(p.colour.hex);
      this.impact.splash(p.pos.clone().setY(1), "shock", 2.4, [c.r * 3.2 + 0.2, c.g * 3.2 + 0.2, c.b * 3.2 + 0.2]);
      p.out = RESPAWN;
      p.knock.set(0, 0, 0);
      if (p.avatar) p.avatar.root.visible = false;
      this.audio?.hurt?.(1);
    } else {
      this.ui.feed(by ? `${by.name} knocked ${p.name} off` : `${p.name} fell`, by ? by.colour.hex : p.colour.hex, p.colour.hex);
    }
  }

  _animate(p, dt, speed, { face = null, stand = false } = {}) {
    const a = p.avatar;
    if (!a) return;
    a.root.position.copy(p.pos);
    // Face where they aim (the body runs down -Z); the line-up faces the camera.
    const want = face ?? Math.atan2(-p.aim.x, -p.aim.z);
    let d = want - p.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.yaw += d * Math.min(1, dt * 14);
    a.root.rotation.y = p.yaw;
    const lateral = p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw);
    // (On the podium they stand on a block: feet on it, not in the air.)
    // (Frozen stiff: no idle.)
    a.idleOff = p.frozen > 0;
    a.update(dt, { speed: p.frozen > 0 ? 0 : speed, lateralVel: lateral, height: stand ? 0 : Math.max(0, p.pos.y), sliding: p.dodge > 0, stumble: p.stun > 0 ? 1 : 0 });
    p.ice.visible = p.frozen > 0;
    p.shieldMesh.visible = p.power?.key === "shield";
    if (p.shieldMesh.visible) p.shieldMesh.material.opacity = 0.14 + Math.sin(this.ambientTime * 6) * 0.05;
    // Blink while they can't be touched (just back on the roof).
    a.root.visible = !(p.invuln > 0.3 && p.dodge <= 0 && Math.floor((this.time ?? 0) * 14) % 2 === 0);
  }

  _respawn(p) {
    if (this.mode === "ctf") {
      this._resetPlayer(p, this._spawnFor(p));
      p.invuln = 1.6;
      return;
    }
    // The spawn furthest from everyone else.
    let best = SPAWNS[0];
    let bestD = -1;
    for (const s of SPAWNS) {
      let d = Infinity;
      for (const o of this.players) if (o !== p && o.out <= 0 && o.pos) d = Math.min(d, o.pos.distanceTo(s));
      if (d > bestD) { bestD = d; best = s; }
    }
    this._resetPlayer(p, best);
    p.invuln = 1.6;
  }

  _collidePlayers() {
    const live = this.players.filter((p) => p.out <= 0 && !p.falling);
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const a = live[i];
        const b = live[j];
        _v.subVectors(b.pos, a.pos).setY(0);
        const d = _v.length();
        if (d >= RADIUS * 2 || d < 1e-5) continue;
        _v.multiplyScalar((RADIUS * 2 - d) / d / 2);
        a.pos.sub(_v);
        b.pos.add(_v);
      }
    }
  }

  /* ---- damage ---- */

  /** Hurt a player. A kinetic shield takes the hit instead. Returns false if it didn't land. */
  _hurt(p, amount, by, { knockDir = null, knock = 0, stun = 0 } = {}) {
    if (p.invuln > 0 || p.out > 0 || p.falling) return false;
    if (p.power?.key === "shield" && p.power.charges > 0 && (amount > 0 || knock > 0)) {
      p.power.charges -= 1;
      this.ui.flash(p, p.power.charges > 0 ? "SHIELD: 1 LEFT" : "SHIELD BROKEN");
      this.impact.splash(p.pos.clone().setY(1), "glass", 1.4, [0.6, 3.2, 1.2]);
      return false;
    }
    const heavy = by?.power?.key === "overdrive" ? 1.5 : 1;
    // Carrying the core: any hit and it's out of their hands.
    if (p.carrying && (amount > 0 || knock > 0)) this._dropCore(p);
    if (knockDir && knock > 0) p.knock.addScaledVector(knockDir, knock * heavy);
    p.stun = Math.max(p.stun, stun);
    if (by && by !== p) { p.lastHit = by; p.lastHitAt = this.time; }
    if (amount > 0) {
      const dealt = Math.min(p.hp, amount * heavy);
      p.stats.taken += dealt;
      if (by && by !== p) by.stats.damage += dealt;
      p.hp = Math.max(0, p.hp - amount * heavy);
      p.hurtAt = this.time;
      this.ui.hurt(p);
      if (amount > 12) this.audio?.hurt?.(0.6);
      if (p.hp <= 0) this._takenOut(p, "ko");
    }
    return true;
  }

  /* ---- spheres ---- */

  _updateBalls(dt) {
    for (const b of this.balls) {
      if (!b.active) continue;
      b.life += dt;
      b.vel.y -= THROW_GRAVITY * dt;
      _w.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.y += dt * 9;
      let hit = null;
      // A player (not the thrower, in its first moments).
      for (const p of this.players) {
        if (p.out > 0 || p.falling || (p === b.owner && b.life < 0.25)) continue;
        _v.set(p.pos.x, Math.min(Math.max(b.pos.y, 0.2), 1.7), p.pos.z);
        if (_v.distanceTo(b.pos) < RADIUS + 0.2) { hit = { player: p, point: b.pos.clone() }; break; }
      }
      // A gas canister: it blows.
      if (!hit) {
        for (const c of this.roof.canisters) {
          if (c.hit.userData.alive && c.box.containsPoint(b.pos)) { hit = { canister: c, point: b.pos.clone() }; break; }
        }
      }
      // Cover: glass ricochets off it (twice at most - bank shots), the rest go off.
      if (!hit && b.pos.y < 2.6 && this.roof.blocked(b.pos, 0.12)) {
        if (b.kind === "glass" && b.bounces < 2) {
          // Which face: whichever way back out of the box clears it.
          const xFace = !this.roof.blocked(_bounce.set(_w.x, b.pos.y, b.pos.z), 0.12);
          const zFace = !this.roof.blocked(_bounce.set(b.pos.x, b.pos.y, _w.z), 0.12);
          if (xFace || !zFace) b.vel.x *= -1;
          if (zFace || !xFace) b.vel.z *= -1;
          b.vel.multiplyScalar(0.7);
          b.pos.copy(_w);
          b.mesh.position.copy(b.pos);
          b.bounces += 1;
          this.impact.splash(_w, "glass", 0.5, null, { ground: false });
          this.audio?.surfaceRicochet?.();
          continue;
        }
        hit = { point: _w.clone() };
      }
      // The floor, or off into the night.
      if (!hit && b.pos.y <= 0.15 && this.roof.groundAt(b.pos) !== null) hit = { point: b.pos.clone().setY(0.15), ground: true };
      if (!hit && (b.pos.y < -20 || b.life > 4)) { b.active = false; b.mesh.visible = false; continue; }
      if (!hit) continue;
      b.active = false;
      b.mesh.visible = false;
      if (hit.canister) this._blowCanister(hit.canister, b.owner);
      this._burst(b, hit);
    }
  }

  _burst(b, hit) {
    const fx = EFFECT[b.kind];
    const def = BALLS[b.kind];
    const point = hit.point;
    if (b.kind === "glass") {
      this.impact.splash(point, "glass", 1.2, null, { ground: !!hit.ground });
      this.audio?.glassBreak?.();
      if (hit.player && this._hurt(hit.player, fx.damage, b.owner, { knockDir: _v.copy(b.vel).setY(0).normalize().clone(), knock: fx.knock, stun: fx.stun }) && hit.player !== b.owner) this._landed(b);
      return;
    }
    this.impact.splash(point, b.kind, def.splash ?? fx.radius, null, { ground: point.y < 0.6 });
    this.audio?.impact?.(0.7);
    for (const p of this.players) {
      if (p.out > 0 || p.falling) continue;
      _v.subVectors(p.pos, point).setY(0);
      const d = _v.length();
      if (d > fx.radius) continue;
      const k = 1 - (d / fx.radius) * 0.5;
      if (b.kind === "shock") {
        const self = p === b.owner ? fx.self : 1;
        const dir = d > 0.05 ? _v.divideScalar(d) : _v.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        if (this._hurt(p, fx.damage * k * self, b.owner, { knockDir: dir.clone(), knock: fx.knock * k * self, stun: fx.stun })) {
          if (p !== b.owner) this._landed(b);
          this._electrify(p, b.owner);
        }
      } else if (b.kind === "cryo") {
        if (p === b.owner) continue;
        if (this._hurt(p, fx.damage, b.owner)) {
          p.frozen = fx.freeze;
          p.vel.multiplyScalar(0.4);
          b.owner.stats.frozen += 1;
          this._landed(b);
        }
      }
    }
    if (b.kind === "gravity") {
      // A rift: everyone it catches (not the thrower) is thrown somewhere else on the roof.
      for (const p of this.players) {
        if (p === b.owner || p.out > 0 || p.falling || p.invuln > 0) continue;
        if (Math.hypot(p.pos.x - point.x, p.pos.z - point.z) > fx.radius) continue;
        this._teleport(p, b.owner);
        this._landed(b);
      }
    }
  }

  /**
   * A shock's charge in someone (EFFECT.charge): violet arcs over them, and
   * the charge on its way to whoever's next to them. `jump`: the chain it's
   * part of (who it's been through, how many jumps it has left).
   */
  _electrify(p, by, jump = null) {
    const C = EFFECT.charge;
    p.shocked = Math.max(p.shocked ?? 0, C.arcs);
    const chain = jump ?? { visited: new Set([by]), hops: C.hops };
    chain.visited.add(p);
    if (chain.hops > 0) (this._jumps ??= []).push({ from: p, at: p.pos.clone(), by, visited: chain.visited, hops: chain.hops, t: C.delay });
  }

  /** The charge jumping on, and this frame's arcs and bolts (fx/electric.js, the roof's). */
  _updateCharge(dt) {
    const C = EFFECT.charge;
    const electric = this.roof.electric;
    for (let i = (this._jumps?.length ?? 0) - 1; i >= 0; i -= 1) {
      const jump = this._jumps[i];
      jump.t -= dt;
      if (jump.t > 0) continue;
      this._jumps.splice(i, 1);
      let next = null;
      let best = C.jump;
      for (const p of this.players) {
        if (jump.visited.has(p) || p.out > 0 || p.falling) continue;
        const d = Math.hypot(p.pos.x - jump.at.x, p.pos.y - jump.at.y, p.pos.z - jump.at.z);
        if (d < best) {
          next = p;
          best = d;
        }
      }
      if (!next) continue;
      jump.visited.add(next);
      electric.bolt(_v.copy(jump.at).setY(jump.at.y + 1.2), _w.copy(next.pos).setY(next.pos.y + 1.2));
      this.audio?.surfaceRicochet?.();
      if (this._hurt(next, C.damage, jump.by, { stun: C.stun })) {
        if (jump.by?.stats) jump.by.stats.hits += 1;
        this._electrify(next, jump.by, { visited: jump.visited, hops: jump.hops - 1 });
      }
    }
    electric.begin();
    for (const p of this.players) if (p.shocked > 0 && !(p.out > 0)) electric.body(p.pos);
    electric.end(dt);
  }

  /** A sphere that got someone else: once, for its thrower's accuracy. */
  _landed(b) {
    if (b.landed || !b.owner?.stats) return;
    b.landed = true;
    b.owner.stats.hits += 1;
  }

  _blowCanister(c, by) {
    this.roof._blowCanister(c.hit);
    this.impact.splash(c.at, "shock", CANISTER_RADIUS, [4, 1.4, 0.3]);
    this.audio?.explosion?.(1);
    for (const p of this.players) {
      if (p.out > 0 || p.falling) continue;
      _v.subVectors(p.pos, c.at).setY(0);
      const d = _v.length();
      if (d > CANISTER_RADIUS) continue;
      const k = 1 - (d / CANISTER_RADIUS) * 0.4;
      this._hurt(p, CANISTER_DAMAGE * k, by, { knockDir: (d > 0.05 ? _v.divideScalar(d) : _v.set(1, 0, 0)).clone(), knock: 18 * k, stun: 0.7 });
    }
  }

  /** Thrown through a gravity rift: out here, in somewhere random on the roof - off the pad, clear of the edges and the hatches. */
  _teleport(p, by) {
    const from = p.pos.clone().setY(1);
    let to = null;
    for (let i = 0; i < 60 && !to; i += 1) {
      const c = new THREE.Vector3((Math.random() * 2 - 1) * (EDGE - 2.5), 0, (Math.random() * 2 - 1) * (EDGE - 2.5));
      if (c.distanceTo(HILL) < HILL_RADIUS + 1.5 || c.distanceTo(p.pos) < 6) continue;
      // Solid roof all round it, nothing in the way, nobody on top of it.
      if ([[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]].some(([dx, dz]) => this.roof.groundAt(_v.set(c.x + dx, 0, c.z + dz)) === null)) continue;
      if (this.roof.blocked(c, 0.9)) continue;
      if (this.players.some((o) => o !== p && o.pos && o.pos.distanceTo(c) < 2)) continue;
      to = c;
    }
    if (!to) return;
    if (p.carrying) this._dropCore(p);
    this.impact.splash(from, "gravity", 2.2, null, { ground: true });
    p.pos.copy(to);
    p.vel.set(0, 0, 0);
    p.knock.set(0, 0, 0);
    p.stun = Math.max(p.stun ?? 0, EFFECT.gravity.stun);
    p.lastHit = by;
    p.lastHitAt = this.time;
    if (p.avatar) p.avatar.root.position.copy(to);
    this.impact.splash(to.clone().setY(1), "gravity", 1.6, null, { ground: true });
    this.ui.flash?.(p, "WARPED");
    this.audio?.impact?.(0.6);
  }

  /* ---- capture the flag ---- */

  /** The hill for King of the Hill, the plinths and cores for capture the flag. */
  _showModeSet() {
    const ctf = this.mode === "ctf";
    this.hillRing.visible = !ctf;
    this.hillFill.visible = !ctf;
    for (const c of this.cores ?? []) c.group.visible = ctf;
  }

  /** A player's spawn: by their team's plinth in capture the flag, else a corner. */
  _spawnFor(p, i = 0) {
    if (this.mode !== "ctf") return SPAWNS[i % SPAWNS.length];
    const spots = TEAMS[p.team].spawns;
    let best = spots[0];
    let bestD = -1;
    for (const s of spots) {
      let d = Infinity;
      for (const o of this.players) if (o !== p && o.out <= 0 && o.pos) d = Math.min(d, o.pos.distanceTo(s));
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  _buildCores(scene) {
    this.coreGeometry ??= new THREE.IcosahedronGeometry(0.34, 1);
    this.cores = TEAMS.map((team, i) => {
      const colour = new THREE.Color(team.hex);
      const group = new THREE.Group();
      group.name = `Core_${team.key}`;
      // The plinth: a dark steel drum with a ring of its team's light round the top.
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 0.5, 32), new THREE.MeshStandardMaterial({ color: 0x22272c, roughness: 0.45, metalness: 0.7 }));
      plinth.position.y = 0.25;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(2.2) }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.5;
      // A column of light up from it, so a base reads across the roof.
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 7, 32, 1, true), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 4;
      const ring = new THREE.Mesh(new THREE.RingGeometry(CAPTURE_RADIUS - 0.12, CAPTURE_RADIUS, 64), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      group.add(plinth, rim, beam, ring);
      group.position.copy(team.base);
      scene.add(group);
      // The core: a faceted crystal, bright in its colour, a halo round it and a light.
      const core = new THREE.Group();
      const crystal = new THREE.Mesh(this.coreGeometry, new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(2.6) }));
      const shell = new THREE.Mesh(this.coreGeometry, new THREE.MeshBasicMaterial({ color: colour, wireframe: true, transparent: true, opacity: 0.8 }));
      shell.scale.setScalar(1.45);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      const light = new THREE.PointLight(colour, 6, 9, 1.6);
      core.add(crystal, shell, halo, light);
      scene.add(core);
      group.visible = false;
      return { team: i, group, beam, core, crystal, shell, state: "home", carrier: null, pos: team.base.clone().setY(1.25), timer: 0 };
    });
    for (const c of this.cores) c.core.visible = false;
  }

  _resetCores() {
    for (const c of this.cores ?? []) {
      if (c.carrier) c.carrier.carrying = null;
      c.state = "home";
      c.carrier = null;
      c.timer = 0;
      c.pos.copy(TEAMS[c.team].base).setY(1.25);
      c.core.visible = this.mode === "ctf";
    }
  }

  _coreHome(c, message = null) {
    if (c.carrier) c.carrier.carrying = null;
    c.state = "home";
    c.carrier = null;
    c.pos.copy(TEAMS[c.team].base).setY(1.25);
    this.impact.splash(c.pos.clone(), "cryo", 1.6, null, { ground: false });
    if (message) this.ui.banner(message, "", 1.1, TEAMS[c.team].hex);
  }

  /** Out of the carrier's hands, where they stand - or home, if that's off the roof. */
  _dropCore(p) {
    const c = p.carrying;
    if (!c) return;
    p.carrying = null;
    // (They can't just pick it straight back up.)
    p.coreCd = 1.4;
    c.carrier = null;
    const at = p.pos.clone().setY(0);
    if (this.roof.groundAt(at) === null) { this._coreHome(c, `${TEAMS[c.team].name} CORE IS HOME`); return; }
    c.state = "dropped";
    c.timer = CORE_DROP_TIME;
    c.pos.copy(at).setY(0.7);
    this.ui.feed(`${p.name} dropped the ${TEAMS[c.team].name.toLowerCase()} core`, TEAMS[c.team].hex, p.colour.hex);
    this.audio?.impact?.(0.5);
  }

  _updateCores(dt) {
    for (const c of this.cores) {
      if (c.state === "carried") {
        const p = c.carrier;
        c.pos.set(p.pos.x, p.pos.y + 2.45, p.pos.z);
      } else if (c.state === "dropped") {
        c.timer -= dt;
        if (c.timer <= 0) { this._coreHome(c, `${TEAMS[c.team].name} CORE IS HOME`); continue; }
      }
      if (c.state === "carried") continue;
      for (const p of this.players) {
        if (p.out > 0 || p.falling || !p.pos) continue;
        if (Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) > CORE_TOUCH + (c.state === "home" ? 0.4 : 0)) continue;
        if (p.team !== c.team && !p.carrying && p.stun <= 0 && p.frozen <= 0 && !(p.coreCd > 0)) {
          // Taken.
          c.state = "carried";
          c.carrier = p;
          p.carrying = c;
          this.ui.banner(`${p.name} HAS THE ${TEAMS[c.team].name} CORE`, "", 1.2, TEAMS[p.team].hex);
          this.ui.feed(`${p.name} took the ${TEAMS[c.team].name.toLowerCase()} core`, p.colour.hex, TEAMS[c.team].hex);
          this.audio?.uiClick?.();
          break;
        }
        if (p.team === c.team && c.state === "dropped") {
          // Saved: a teammate sends it home.
          this._coreHome(c, `${p.name} SAVED THE ${TEAMS[c.team].name} CORE`);
          break;
        }
      }
    }
    // Home with it, while yours is on its plinth: a capture.
    for (const p of this.players) {
      const c = p.carrying;
      if (!c || p.out > 0 || p.falling) continue;
      const own = this.cores[p.team];
      if (own.state !== "home") continue;
      if (Math.hypot(p.pos.x - TEAMS[p.team].base.x, p.pos.z - TEAMS[p.team].base.z) > CAPTURE_RADIUS) continue;
      this.teamScore[p.team] += 1;
      p.score += 1;
      this._coreHome(c);
      this.impact.splash(TEAMS[p.team].base.clone().setY(1.2), "shock", 3.2, null, { ground: true });
      this.ui.banner(`${TEAMS[p.team].name} SCORES`, `${p.name} - ${this.teamScore[0]} : ${this.teamScore[1]}`, 1.6, TEAMS[p.team].hex);
      this.ui.feed(`${p.name} captured the ${TEAMS[c.team].name.toLowerCase()} core`, p.colour.hex, TEAMS[p.team].hex);
      this.audio?.glassBreak?.();
    }
  }

  /** The cores: spinning, bobbing; a dropped one blinks as its time runs out. */
  _frameCores(t) {
    for (const c of this.cores ?? []) {
      c.core.position.copy(c.pos);
      if (c.state !== "carried") c.core.position.y += Math.sin(t * 2.2 + c.team * 2) * 0.12;
      c.crystal.rotation.set(t * 0.9, t * 1.3, 0);
      c.shell.rotation.set(-t * 0.6, -t * 0.8, t * 0.4);
      c.core.visible = c.state !== "dropped" || c.timer > 2.5 || Math.floor(t * 8) % 2 === 0;
      c.beam.material.opacity = c.state === "home" ? 0.12 + Math.sin(t * 3) * 0.03 : 0.04;
    }
  }

  _checkCtfEnd() {
    const [a, b] = this.teamScore;
    let team = null;
    if (a >= this.target || b >= this.target) team = a > b ? 0 : 1;
    else if (this.clock <= 0) {
      if (a !== b) team = a > b ? 0 : 1;
      else if (!this._overtime) {
        this._overtime = true;
        this.ui.banner("OVERTIME", "NEXT CAPTURE WINS", 1.6, "#ff9a4a");
      }
    }
    if (team === null) return;
    // The team's best is the one crowned.
    const winner = this.ranked().find((p) => p.team === team);
    if (!winner) return;
    for (const p of this.players) if (p.team === team) p.wins += 1;
    this.winner = winner;
    this.winningTeam = team;
    this._clearField();
    this._podium();
    this.state = "results";
    this.ui.showResults(winner);
    this.onMatchEnd?.(this);
  }

  _updateWells(dt) {
    for (const w of this.wells) {
      w.t -= dt;
      for (const p of this.players) {
        if (p === w.owner || p.out > 0 || p.falling || p.invuln > 0) continue;
        _v.subVectors(w.point, p.pos).setY(0);
        const d = _v.length();
        if (d > EFFECT.gravity.radius || d < 0.4) continue;
        p.pos.addScaledVector(_v.divideScalar(d), EFFECT.gravity.pull * dt);
        if (w.ball) { this._landed(w.ball); w.ball = null; }
        p.lastHit = w.owner;
        p.lastHitAt = this.time;
      }
    }
    this.wells = this.wells.filter((w) => w.t > 0);
  }

  _updateSacks(dt) {
    for (const s of this.sacks) {
      if (!s.sack.visible) {
        s.back -= dt;
        if (s.back <= 0) s.sack.visible = true;
        continue;
      }
      for (const p of this.players) {
        if (p.out > 0 || p.falling || p.ammo >= AMMO_MAX || p.pos.distanceTo(s.at) > 1.1) continue;
        p.ammo = Math.min(AMMO_MAX, p.ammo + SACK_SPHERES);
        p.stats.pickups += 1;
        s.sack.visible = false;
        s.back = 10;
        this.ui.flash(p, `+${SACK_SPHERES} SPHERES`);
        this.audio?.sphereCollected?.();
        break;
      }
    }
  }

  /* ---- the podium, and the crown ---- */

  /**
   * An Olympic podium for the results: 1st in the middle on the tallest
   * block, 2nd on its right (the left of the screen), 3rd on its left; a
   * 4th stands on the roof beside it. Dark steel, a band of gold, silver or
   * bronze round the top, the place on the front.
   */
  _buildPodium() {
    const group = new THREE.Group();
    group.name = "Podium";
    const steel = new THREE.MeshStandardMaterial({ color: 0x262c34, roughness: 0.45, metalness: 0.65 });
    const metals = [0xe0ad2a, 0xc3ccd6, 0xb8733a];
    this.podiumSpots = [];
    PODIUM.forEach((b, i) => {
      const hex = `#${metals[i].toString(16).padStart(6, "0")}`;
      const block = new THREE.Mesh(new THREE.BoxGeometry(PODIUM_W, b.h, PODIUM_D), steel);
      block.position.set(b.x, b.h / 2, 0);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
      const metal = new THREE.MeshStandardMaterial({ color: metals[i], roughness: 0.25, metalness: 0.9, emissive: metals[i], emissiveIntensity: 0.18 });
      const band = new THREE.Mesh(new THREE.BoxGeometry(PODIUM_W + 0.04, 0.08, PODIUM_D + 0.04), metal);
      band.position.set(b.x, b.h - 0.04, 0);
      group.add(band);
      // The place on the front.
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d");
      g.font = "900 190px Inter, Arial, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.shadowColor = hex;
      g.shadowBlur = 24;
      g.fillStyle = hex;
      g.fillText(String(i + 1), 128, 140);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const number = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
      number.position.set(b.x, Math.max(0.24, b.h * 0.48), PODIUM_D / 2 + 0.005);
      group.add(number);
      this.podiumSpots.push({ x: b.x, y: b.h });
    });
    group.position.set(HILL.x, 0, HILL.z + PODIUM_Z);
    group.visible = false;
    this.scene.add(group);
    this.podiumGroup = group;
    // A 4th stands beside it.
    this.podiumSpots.push({ x: 3.5, y: 0 });
  }

  /**
   * The king of the hill's crown: a gold band with five points, a jewel on
   * each and a ruby at the front, floating over the winner's head, turning
   * slowly and glowing.
   */
  _buildCrown() {
    const crown = new THREE.Group();
    crown.name = "Crown";
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.22, metalness: 1, emissive: 0x6b4500, emissiveIntensity: 0.6 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.155, 0.1, 40, 1, true), gold);
    band.material = gold.clone();
    band.material.side = THREE.DoubleSide;
    crown.add(band);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.163, 0.014, 8, 40), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.05;
    crown.add(rim);
    const rimTop = rim.clone();
    rimTop.position.y = 0.05;
    rimTop.scale.setScalar(1.05);
    crown.add(rimTop);
    const gems = [0xff2a4a, 0x3aa0ff, 0x4ade80, 0x3aa0ff, 0xff2a4a];
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      const point = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), gold);
      point.position.set(Math.sin(a) * 0.16, 0.12, Math.cos(a) * 0.16);
      point.rotation.y = a;
      crown.add(point);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), gold);
      ball.position.set(Math.sin(a) * 0.16, 0.21, Math.cos(a) * 0.16);
      crown.add(ball);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.026), new THREE.MeshBasicMaterial({ color: new THREE.Color(gems[i]).multiplyScalar(2.2) }));
      gem.position.set(Math.sin(a) * 0.172, 0, Math.cos(a) * 0.172);
      crown.add(gem);
    }
    const glow = new THREE.PointLight(0xffc83d, 0, 3, 2);
    glow.position.y = 0.1;
    crown.add(glow);
    crown.scale.setScalar(1.35);
    crown.visible = false;
    this.scene.add(crown);
    this.crown = crown;
    this.crownGlow = glow;
  }

  /** The crown over the winner (the results), bobbing and turning. */
  _updateCrown(dt, t) {
    const w = this.state === "results" ? this.winner : null;
    this.crown.visible = !!w?.avatar;
    if (!this.crown.visible) return;
    const top = (w.avatar.bodyInfo?.height ?? 1.75) + w.pos.y;
    this.crown.position.set(w.pos.x, top + 0.42 + Math.sin(t * 2.2) * 0.06, w.pos.z);
    this.crown.rotation.y += dt * 0.9;
    this.crown.rotation.z = Math.sin(t * 1.3) * 0.08;
    this.crownGlow.intensity = 2.5 + Math.sin(t * 3) * 0.6;
  }

  /* ---- care packages ---- */

  _buildDrop() {
    const g = new THREE.Group();
    g.name = "CarePackage";
    const wood = new THREE.MeshStandardMaterial({ color: 0x4b5232, roughness: 0.8, metalness: 0.2 });
    const strap = new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.6 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.85, 0.95), wood);
    crate.position.y = 0.43;
    g.add(crate);
    for (const z of [-0.28, 0.28]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.89, 0.08), strap);
      s.position.set(0, 0.43, z);
      g.add(s);
    }
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9, side: THREE.DoubleSide }));
    canopy.position.y = 4;
    canopy.scale.y = 0.6;
    chute.add(canopy);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const top = new THREE.Vector3(Math.cos(a) * 1.8, 3.9, Math.sin(a) * 1.8);
      const bottom = new THREE.Vector3(0, 0.88, 0);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, top.distanceTo(bottom), 4), lineMat);
      line.position.copy(top).add(bottom).multiplyScalar(0.5);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
      chute.add(line);
    }
    g.add(chute);
    // Where it will land: a pulsing ring.
    this.dropMarker = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.dropMarker.rotation.x = -Math.PI / 2;
    this.dropMarker.visible = false;
    g.visible = false;
    this.scene.add(g, this.dropMarker);
    this.dropRoot = g;
    this.dropChute = chute;
    this.drop = null;
  }

  _startDrop() {
    // Somewhere open, off the pad, away from the edges.
    let at = null;
    for (let i = 0; i < 30 && !at; i += 1) {
      const p = new THREE.Vector3((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 24);
      if (p.distanceTo(HILL) < HILL_RADIUS + 1.5 || this.roof.blocked(p, 1.2) || this.roof.overHatch(p)) continue;
      at = p;
    }
    if (!at) return;
    const kind = ARENA_POWERS[Math.floor(Math.random() * ARENA_POWERS.length)];
    const pickup = serumPickup(kind, { scale: 0.55 });
    pickup.root.position.set(0, 1.35, 0);
    this.dropRoot.add(pickup.root);
    this.dropRoot.position.set(at.x, DROP_HEIGHT, at.z);
    this.dropRoot.visible = true;
    this.dropChute.visible = true;
    this.dropMarker.position.set(at.x, 0.05, at.z);
    this.dropMarker.material.color.set(SERUMS[kind].colour);
    this.dropMarker.visible = true;
    this.drop = { at, kind, pickup, landed: false };
    this.ui.banner("CARE PACKAGE", SERUMS[kind].name.toUpperCase(), 1.4, SERUMS[kind].colour);
  }

  _endDrop() {
    if (!this.drop) return;
    this.dropRoot.remove(this.drop.pickup.root);
    for (const m of this.drop.pickup.materials) m.dispose();
    this.dropRoot.visible = false;
    this.dropMarker.visible = false;
    this.drop = null;
  }

  _updateDrop(dt, t) {
    if (!this.drop) {
      this.nextDrop -= dt;
      if (this.nextDrop <= 0) {
        this.nextDrop = DROP_EVERY[0] + Math.random() * (DROP_EVERY[1] - DROP_EVERY[0]);
        this._startDrop();
      }
      return;
    }
    const d = this.drop;
    d.pickup.tick(dt, t);
    this.dropMarker.material.opacity = 0.45 + Math.sin(t * 7) * 0.35;
    if (!d.landed) {
      const y = Math.max(0, this.dropRoot.position.y - dt * 5.5);
      this.dropRoot.position.y = y;
      this.dropRoot.rotation.z = Math.sin(t * 1.4) * 0.1 * (y / DROP_HEIGHT);
      if (y <= 0) {
        d.landed = true;
        this.dropRoot.rotation.set(0, 0, 0);
        this.dropChute.visible = false;
        this.audio?.impact?.(0.5);
      }
      return;
    }
    for (const p of this.players) {
      if (p.out > 0 || p.falling || p.pos.distanceTo(d.at) > 1.3) continue;
      const s = SERUMS[d.kind];
      p.power = { key: d.kind, t: s.duration, total: s.duration, charges: s.charges ?? 0 };
      p.stats.pickups += 1;
      this.ui.banner(`${p.name}: ${s.name.toUpperCase()}`, s.text.toUpperCase(), 1.5, p.colour.hex);
      this.audio?.serumCollected?.();
      this._endDrop();
      break;
    }
  }

  /* ---- the hill ---- */

  _updateHill(dt) {
    const on = this.players.filter((p) => p.out <= 0 && !p.falling && Math.hypot(p.pos.x - HILL.x, p.pos.z - HILL.z) < HILL_RADIUS);
    const holder = on.length === 1 ? on[0] : null;
    const contested = on.length > 1;
    if (holder) holder.score += dt;
    if (holder !== this.holder || contested !== this.contested) {
      if (holder) this.ui.banner(`${holder.name} HAS THE PAD`, "", 1.1, holder.colour.hex);
      else if (contested) this.ui.banner("CONTESTED", "", 0.9, "#ff5a4a");
    }
    this.holder = holder;
    this.contested = contested;
  }

  _checkEnd() {
    if (this.mode === "ctf") { this._checkCtfEnd(); return; }
    const ranked = this.ranked();
    const top = ranked[0];
    const winner = top.score >= this.target ? top : this.clock <= 0 && top.score > (ranked[1]?.score ?? -1) ? top : null;
    if (!winner) {
      if (this.clock <= 0 && !this._overtime) {
        this._overtime = true;
        this.ui.banner("OVERTIME", "NEXT ONE AHEAD WINS", 1.6, "#ff9a4a");
      }
      return;
    }
    winner.wins += 1;
    this.winner = winner;
    this._clearField();
    this._podium();
    this.state = "results";
    this.ui.showResults(winner);
    this.onMatchEnd?.(this);
  }

  /**
   * The awards for the results: the best at each thing (nobody gets one for
   * zero, except the survivor). [{ title, player, value }]
   */
  awards() {
    const ps = this.players.filter((p) => p.stats);
    const best = (score, ok = (v) => v > 0) => {
      let top = null;
      let topV = -Infinity;
      for (const p of ps) {
        const v = score(p);
        if (v > topV) { topV = v; top = p; }
      }
      return top && ok(topV) ? { player: top, v: topV } : null;
    };
    const list = [];
    const add = (title, icon, r, text) => { if (r) list.push({ title, icon, player: r.player, value: text(r.v) }); };
    add("Most KOs", "kos", best((p) => p.kos), (v) => `${v} taken out`);
    add("Sharpshooter", "sharp", best((p) => (p.stats.thrown >= 5 ? p.stats.hits / p.stats.thrown : -1), (v) => v > 0), (v) => `${Math.round(v * 100)}% of spheres landed`);
    add("Trigger happy", "trigger", best((p) => p.stats.thrown), (v) => `${v} spheres thrown`);
    add("Heavy hitter", "heavy", best((p) => p.stats.damage), (v) => `${Math.round(v)} damage dealt`);
    add("Ledge master", "ledge", best((p) => p.stats.ledge), (v) => `${v} knocked off the roof`);
    add("Survivor", "survivor", best((p) => -p.outs * 1000 + p.score, () => true), () => "Went down the least");
    add("Ice cold", "ice", best((p) => p.stats.frozen), (v) => `${v} frozen`);
    add("Scavenger", "scavenger", best((p) => p.stats.pickups), (v) => `${v} pickups`);
    add("Untouchable", "untouchable", best((p) => -p.stats.taken, () => true), () => "Took the least damage");
    return list.slice(0, 8);
  }

  /** The players, best first. */
  ranked() {
    if (this.mode === "ctf") {
      // The winning team first; then captures, then KOs.
      const t = (p) => this.teamScore[p.team] * 1000;
      return [...this.players].sort((a, b) => t(b) - t(a) || b.score - a.score || b.kos - a.kos);
    }
    return [...this.players].sort((a, b) => b.score - a.score || b.kos - a.kos);
  }

  /** The podium: everyone on their block, the winner in the middle with arms up. */
  _podium() {
    const order = this.ranked();
    this.podiumGroup.visible = true;
    this._cutToStage = true;
    order.forEach((p, i) => {
      const spot = this.podiumSpots[i];
      p.pos.set(HILL.x + spot.x, spot.y, HILL.z + PODIUM_Z);
      p.yaw = Math.PI;
      p.out = 0;
      p.falling = false;
      p.frozen = 0;
      p.stun = 0;
      p.shocked = 0;
      p.dodge = 0;
      p.invuln = 0;
      p.power = null;
      p.vel.set(0, 0, 0);
      if (p.avatar) {
        p.avatar.root.visible = true;
        p.avatar.reachUp = i === 0 ? 1 : 0;
        // The winner's arms are up: the launcher across their back, not floating by their head.
        if (p.rig) slingLauncher(p.avatar, p.rig, i === 0);
      }
    });
  }

  /* ---- camera, render ---- */

  _frame(dt) {
    // The hill in its holder's colour; white, or pulsing red when contested.
    const t = this.ambientTime;
    const colour = this.holder ? this.holder.colour.hex : this.contested ? (Math.sin(t * 14) > 0 ? "#ff3b30" : "#ffffff") : "#ffffff";
    this.hillMaterial.color.set(colour);
    this.hillFillMaterial.color.set(colour);
    this.hillFillMaterial.opacity = this.holder ? 0.1 + Math.sin(t * 5) * 0.03 : 0.04;
    this.hillLight.color.set(colour);
    // (Soft: the white H under bloom would wash out whoever stands on it.)
    this.hillLight.intensity = this.mode === "ctf" ? 0 : this.holder || this.contested ? 3.5 : 1;
    if (this.mode === "ctf") this._frameCores(t);
    // Everyone up, framed.
    const live = this.players.filter((p) => p.out <= 0 && p.pos && p.pos.y > -3);
    const centre = _v.set(0, 0, 0);
    if (live.length) {
      for (const p of live) centre.add(p.pos);
      centre.divideScalar(live.length).setY(0);
    } else centre.set(0, 0, -2);
    let spread = 0;
    for (const p of live) spread = Math.max(spread, Math.hypot(p.pos.x - centre.x, (p.pos.z - centre.z) * 1.4));
    // (Pulled a little toward the hill: it's what everyone is fighting for.)
    centre.lerp(HILL, 0.15);
    const height = THREE.MathUtils.clamp(11 + spread * 1.15, 14, 30);
    const k = 1 - Math.exp(-dt * 2.6);
    this.camTarget.lerp(centre, k);
    this.camHeight += (height - this.camHeight) * k;
    this.camPos.set(this.camTarget.x, this.camHeight, this.camTarget.z + this.camHeight * 0.72);
    this.camLook.set(this.camTarget.x, 0, this.camTarget.z - 0.5);
    this.camera.position.lerp(this.camPos, Math.min(1, dt * 6));
    this.camera.lookAt(this.camLook);
    this.impact.update(dt);
  }

  /**
   * The line-up and the podium: low, in front of them, looking a little
   * down so they stand in the upper part of the screen - their panels (the
   * line-up) and the results (the podium) go underneath.
   */
  _stageCamera(dt, podium = false) {
    const n = Math.max(2, this.players.length);
    if (podium) {
      // The whole podium and whoever is on it, crown and all, in the top of the screen.
      const shift = n > 3 ? 0.9 : 0;
      const z = HILL.z + PODIUM_Z;
      this.camPos.set(HILL.x + shift, 2.7, z + 9.6 + (n > 3 ? 0.8 : 0));
      this.camLook.set(HILL.x + shift, 1.02, z);
    } else {
      const dist = 4.4 + n * 0.8;
      this.camPos.set(HILL.x, 1.7, HILL.z + 0.6 + dist);
      this.camLook.set(HILL.x, 0.45, HILL.z + 0.6);
    }
    // (A cut onto the line-up or the podium, then it settles.)
    if (this._cutToStage) { this.camera.position.copy(this.camPos); this._cutToStage = false; }
    this.camera.position.lerp(this.camPos, Math.min(1, dt * 3));
    this.camera.lookAt(this.camLook);
    this.hillMaterial.color.set("#ffffff");
    this.hillLight.intensity = 0;
  }

  /** The lobby: the camera drifting round the roof. */
  _orbit(dt, t) {
    const a = t * 0.07;
    this.camera.position.set(Math.sin(a) * 30, 17, Math.cos(a) * 30);
    this.camera.lookAt(0, 0, -2);
    this.impact.update(dt);
  }

  render() {
    if (!this.composer) return;
    this.composer.render();
  }
}
