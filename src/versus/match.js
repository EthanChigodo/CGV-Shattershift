/**
 * Rooftop Showdown - the match.
 *
 * Two Subjects on the burning roof, one seat on the helicopter. Both fight
 * the same waves of patients and scientists (src/versus/roof.js); every kill
 * takes time off the helicopter's clock. When it comes it hovers off one
 * ledge - the side the round's top killer is on - with its rope ladder down,
 * and the first one up the ladder wins the round. Best of three (or one, or
 * five).
 *
 * The ladder is where it is decided. Jump for it from the ledge and you are
 * on it - then you have to climb (mash jump, or hold it for a slow climb),
 * hands busy, launcher slung, while the other one does everything they can
 * to get you off:
 *
 *   shock    knocks you off the ladder - into the drop below
 *   glass    a hit makes you slip down the rungs
 *   cryo     freezes your hands: no climbing for a moment
 *   gravity  yanks you off the ladder toward the black hole - back onto the
 *            roof if it opened over the roof, down the side if it did not
 *
 * The same spheres work on the rival on the roof: shock is a stun and a
 * hard shove (near a ledge, over it), cryo slows them to a crawl, gravity
 * drags them in (open one past a ledge and it drags them off), glass hurts.
 * Down to no integrity, or over an edge, and you are out for a few seconds,
 * then back at the lift with a moment's grace.
 *
 * Phases: intro (the round's card, cameras swooping in) -> fight -> outro
 * (the winner hauled away on the ladder) -> the next round, or over (the
 * winner's shot, full screen, and the stats).
 *
 * The match owns the scene and the rules; competitor.js the bodies, split.js
 * the drawing, hud.js the screens, controls.js the hands on the controls.
 */

import * as THREE from "../three.js";
import { RoomEnvironment } from "../three-addons.js";
import { EDGE, CANISTER_RADIUS } from "../levels/meltdown/roof.js";
import { Projectiles, Debris } from "../levels/meltdown/effects.js";
import { createEnvironmentDimmer } from "../levels/meltdown/lighting.js";
import { THERMAL_HEAT } from "../levels/meltdown/kit.js";
import { ShatterFX } from "../fx/shatter.js";
import { SphereImpactFX } from "../fx/sphere-impact.js";
import { BALLS, SERUMS } from "../systems/arsenal.js";
import { canAffordThrow } from "../systems/ammo-recovery.js";
import { VersusRoof, SPAWNS, HELI_FLIGHT } from "./roof.js";
import { Competitor, MAX_INTEGRITY, MAX_SPHERES, TAG_LAYERS } from "./competitor.js";
import { SplitRenderer } from "./split.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                               */
/* ------------------------------------------------------------------ */

/** On the roof: the story's movement (game.js), so it plays the same. */
const SPEED = 6.4;
const DODGE_SPEED = 13;
const DODGE_SECONDS = 0.24;
const DODGE_COOLDOWN = 0.75;
/** A dodge is untouchable for this long - spheres included: dodge through a shot. */
const DODGE_INVULNERABLE = 0.3;
const GRAVITY = 24;
/** Below the deck by this much: over the edge, no coming back. */
const OVER_THE_EDGE = -0.6;
/** Falling, until this far down: then out. */
const FALL_OUT = -16;
const FIRE_INTERVAL = 0.22;
/** After an enemy's hit, enemies can't hit again for this long (the rival can). */
const MERCY = 0.9;

/** Out: seconds before you are back (down / fallen), and the grace once back. */
const RESPAWN_DOWN = 4;
const RESPAWN_FALL = 2.4;
const RESPAWN_GRACE = 2;
const RESPAWN_SPHERES = 10;
/** A hit from the rival counts toward their score (a knock-off, a takedown) for this long. */
const CREDIT_WINDOW = 4;

/** Aim: how far an un-targeted stick shot goes, and the assist's cones (radians) and reach. */
const STICK_AIM = 11;
const ASSIST_STICK = 0.22;
const ASSIST_KEYS = 0.62;
const ASSIST_RANGE = 24;
const AIM_FAR = 60;

/** What each sphere does to the rival. */
const RIVAL = {
  glass: { damage: 12, knock: 5 },
  cryo: { damage: 6, frozen: 2.6 },
  shock: { damage: 10, knock: 12.5, stun: 0.55 },
  gravity: { damage: 0, pull: 4.4, yank: 6 },
};
/** Frozen by cryo: this much of your speed. */
const FROZEN_SPEED = 0.42;
/** Seconds a gravity sphere's black hole keeps pulling. */
const WELL_SECONDS = 1.1;

/** The ladder: where your hands are when you catch it, how far there is to climb. */
const LADDER_GRIP = 0.9;
const CLIMB_HEIGHT = 4.4;
/** Each press of jump: one rung (metres), no faster than this; held: a slow climb. */
const CLIMB_TAP = 0.33;
const CLIMB_TAP_GAP = 0.075;
const CLIMB_HOLD = 0.3;
/** A glass sphere (or an enemy's) on the ladder: down the rungs. */
const SLIP_GLASS = 1.1;
/** Cryo on the ladder: hands frozen, no climbing. */
const ICED_HANDS = 1.8;
const LEAP_SECONDS = 0.5;
/** Body below the hands, and off the rungs toward the roof. */
const HANG = 2.05;
const OFF_RUNGS = 0.32;

/** Spheres for a kill. */
const KILL_SPHERES = { patient: 2, brute: 4, scientist: 3 };
/** The supply drop's serums, by the vial kind the roof drops (as in game.js). */
const VIAL_SERUM = { coolant: "thermal", adrenaline: "overdrive", overcharge: "prism", barrier: "shield" };

/** Seconds of each phase. */
const INTRO_SECONDS = 3.4;
const OUTRO_SECONDS = 5.2;
const FADE_SECONDS = 0.45;

const FOG_ROOF = new THREE.Color(0x151a24);
const UP = new THREE.Vector3(0, 1, 0);

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ndc = new THREE.Vector2();

/**
 * The fight camera for a view's shape: high and behind (south of) the
 * player, looking north. A tall half (side by side) pulls up and back to see
 * as much roof across as the full screen does; a short wide half (stacked)
 * narrows the field so the edges don't stretch.
 */
function framingFor(aspect) {
  if (aspect > 2.2) return { offset: new THREE.Vector3(0, 12.2, 9.6), look: new THREE.Vector3(0, 0.4, -2.2), fov: 44 };
  if (aspect < 1.3) return { offset: new THREE.Vector3(0, 13.4, 8.6), look: new THREE.Vector3(0, 0.3, -3.2), fov: 70 };
  return { offset: new THREE.Vector3(0, 9.9, 7.3), look: new THREE.Vector3(0, 0.6, -3.4), fov: 72 };
}

/** One step of a critically damped spring (game.js's), stable at any frame rate. */
function spring(x, v, target, omega, dt) {
  const offset = x - target;
  const e = Math.exp(-omega * dt);
  const k = v + omega * offset;
  return [target + (offset + k * dt) * e, (v - omega * k * dt) * e];
}

export class VersusMatch {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {Map} o.assets          loaded models (assets.js)
   * @param {object} o.setup        { players: [{device, character, skin}], wins, split }
   * @param {import("./controls.js").VersusInput} o.input
   * @param {import("./hud.js").VersusHud} o.hud
   */
  constructor({ renderer, assets, assetBase, setup, input, hud, sfx = null, audio = null }) {
    this.renderer = renderer;
    this.assets = assets;
    this.setup = setup;
    this.input = input;
    this.hud = hud;
    this.sfx = sfx;
    this.audio = audio;
    this.wins = setup.wins ?? 2;

    /* ---- The scene: the roof's look (game.js startRoof) ---- */
    const scene = new THREE.Scene();
    scene.name = "VersusScene";
    scene.background = FOG_ROOF.clone();
    scene.fog = new THREE.FogExp2(FOG_ROOF.clone(), 0.0058);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    scene.environment = this.envTexture;
    pmrem.dispose();
    this.scene = scene;

    this.roof = new VersusRoof({ assets, assetBase, seed: Math.floor(Math.random() * 99999) });
    this.roof.addTo(scene);
    this.environment = createEnvironmentDimmer(scene);

    this.players = setup.players.map((p, index) => new Competitor({ index, device: p.device, character: p.character, skin: p.skin, scene }));
    for (const p of this.players) p.setModels(assets);
    this.environment.refresh();
    this.environment.set(0.8);

    this.projectiles = new Projectiles(scene, { count: 40 });
    this.debris = new Debris(scene, { shards: 200 });
    this.shatter = new ShatterFX(scene, { floorHalfWidth: 1e4, env: [0x3a4548, 0x0d0b0a, 0x4a3326] });
    this.impact = new SphereImpactFX(scene);
    this.raycaster = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.15);

    // The winner's shot at the end: both name tags in it.
    this.finalCamera = new THREE.PerspectiveCamera(50, 1, 0.05, 320);
    for (const layer of TAG_LAYERS) this.finalCamera.layers.enable(layer);
    scene.add(this.finalCamera);

    this.split = new SplitRenderer(renderer, scene);
    this.split.setLayout(setup.split === "h" ? "h" : "v");

    this.clock = 0;
    this.round = 0;
    this.phase = "idle";
    this.phaseT = 0;
    this.paused = false;
    this.fade = 0;
    this.wells = [];
    this.ladderOwner = null;
    this.roundWinner = null;
    this.matchWinner = null;
    this.blast = null;
    this._directHit = false;
    this._targets = [];
    this.events = [];
    this._bindRoofEvents();
  }

  /** Compile everything the fight draws (the screen is the lobby's meanwhile). */
  prewarm() {
    this.roof.prewarm(this.renderer, this.players[0].camera);
    this.renderer.compile(this.scene, this.players[0].camera);
  }

  /** The first round. */
  begin() {
    for (const p of this.players) {
      Object.assign(p.stats, { kills: 0, lured: 0, rivalHits: 0, takedowns: 0, knockOffs: 0, overboard: 0, downs: 0, shots: 0, ladderTime: 0, damageDealt: 0, roundsWon: 0 });
    }
    this.round = 0;
    this.matchWinner = null;
    this.split.setLayout(this.setup.split === "h" ? "h" : "v");
    this._startRound();
  }

  rival(p) {
    return this.players[1 - p.index];
  }

  /* ================================================================ */
  /* Rounds                                                            */
  /* ================================================================ */

  _startRound() {
    this.round += 1;
    this.roof.resetRound();
    this.projectiles.clear();
    this.debris.clear();
    this.shatter.clear();
    this.impact.clear();
    this.wells.length = 0;
    this.ladderOwner = null;
    this.roundWinner = null;
    this.blast = null;
    for (const p of this.players) {
      p.resetForRound(SPAWNS[p.index]);
      p.invulnerable = INTRO_SECONDS + 1;
      p.avatar.hold = 1;
      p.avatar.reachUp = 0;
      // Start high over the roof: the intro swoops down to each of them.
      p.cam.snap = false;
      p.camera.position.set(p.position.x * 0.4, 30, 30);
      p.cam.smoothedLook.set(0, 0, 0);
      p.cam.vel.set(0, 0, 0);
    }
    this.phase = "intro";
    this.phaseT = 0;
    this.hud.intro({ round: this.round, wins: this.wins, scores: this.players.map((p) => p.stats.roundsWon), final: this.players.every((p) => p.stats.roundsWon === this.wins - 1) });
    this._event("round", { round: this.round });
  }

  _winRound(p) {
    if (this.phase !== "fight") return;
    this.phase = "outro";
    this.phaseT = 0;
    this.roundWinner = p;
    p.state = "extracted";
    p.stats.roundsWon += 1;
    this.ladderOwner = null;
    this.roof.depart();
    const loser = this.rival(p);
    loser.velocity.set(0, 0, 0);
    p.log("ROUND WON // UP AND OUT", "win");
    loser.log(`${p.team.label} MADE IT ONTO THE HELICOPTER`, "loss");
    this.hud.roundEnd({ winner: p.index, scores: this.players.map((x) => x.stats.roundsWon), match: p.stats.roundsWon >= this.wins });
    this.audio?.stinger?.();
    this.sfx?.sphereCollected?.();
    this.input.rumble(p.device, 0.3, 0.6, 0.5);
    this._event("round-won", { round: this.round, winner: p.index });
  }

  _matchOver(p) {
    this.phase = "over";
    this.phaseT = 0;
    this.matchWinner = p;
    this.split.setLayout("single");
    // The winner's shot: the helicopter back in its hover off the ledge,
    // them hanging from the top of the ladder, the roof burning below.
    const s = this.roof.state;
    s.ending = "extraction";
    s.extractT = 10;
    p.state = "extracted";
    const loser = this.rival(p);
    if (loser.state !== "alive") loser.spawn(SPAWNS[loser.index]);
    loser.invulnerable = 0;
    this.hud.winner({
      winner: p.index,
      players: this.players.map((x) => ({ label: x.team.label, name: x.team.name, device: this.input.describe(x.device).name, stats: { ...x.stats } })),
      rounds: this.round,
    });
    this.audio?.powerup?.();
    this._event("match-won", { winner: p.index });
  }

  /* ================================================================ */
  /* Frame                                                             */
  /* ================================================================ */

  update(dt, time) {
    dt = Math.min(dt, 0.05);
    this.time = time;
    if (this.paused) return;
    this.clock += dt;
    this.phaseT += dt;
    const intents = this.players.map((p) => this.input.read(p.device));
    this.intents = intents;
    const fighting = this.phase === "fight";

    if (this.phase === "intro" && this.phaseT >= INTRO_SECONDS) {
      this.phase = "fight";
      this.phaseT = 0;
      for (const p of this.players) p.invulnerable = 1.2;
    }
    if (this.phase === "outro" && this.phaseT >= OUTRO_SECONDS) {
      if (this.roundWinner.stats.roundsWon >= this.wins) this._matchOver(this.roundWinner);
      else {
        this.phase = "next";
        this.phaseT = 0;
      }
    }
    if (this.phase === "next") {
      this.fade = Math.min(1, this.phaseT / FADE_SECONDS);
      if (this.phaseT >= FADE_SECONDS) this._startRound();
    } else this.fade = Math.max(0, this.fade - dt / FADE_SECONDS);

    // Who the roof's enemies can see.
    const view = this.players.map((p) => ({ position: p.position, velocity: p.velocity, targetable: fighting && p.targetable, exposed: fighting && p.state === "alive" }));
    const hits = this.roof.update({ dt, time, players: view, hold: !fighting });

    for (const p of this.players) this._updatePlayer(p, intents[p.index], dt, time, fighting);
    if (fighting) {
      this._separate();
      for (const [i, list] of hits.entries()) for (const h of list) this._enemyHit(this.players[i], h);
      this._updateWells(dt);
      this._walkIntoPickups();
    }
    if (this.blast && this.clock - this.blast.at > 2) this.blast = null;

    // Spheres in flight (the rivals' bodies are targets too).
    this._targets.length = 0;
    this._targets.push(...this.roof.breakables);
    for (const p of this.players) if (p.state === "alive" || p.state === "ladder" || p.state === "leap") this._targets.push(p.hurt);
    this.projectiles.update(dt, {
      breakables: this._targets,
      solids: this.roof.solids,
      onBreakable: (o, point, ball) => this._onBallHit(o, point, ball),
      onSolid: (o, point, ball) => this._onBallSolid(point, ball),
      onFloor: (point, ball) => this._onBallFloor(point, ball),
    });
    this.debris.update(dt);
    this.shatter.update(dt);
    this.impact.update(dt);

    // The look of a roof coming apart.
    const chaos = this.roof.state.chaos ?? 0;
    this.scene.fog.density = 0.0058 + chaos * 0.007;
    THERMAL_HEAT.value = 0.16;
    for (const p of this.players) this._updateCamera(p, dt, time);
    if (this.phase === "over") this._updateFinalCamera(dt, time);
    this._updateAudio(dt, time, fighting);
    this.hud.update(this._hudState());
  }

  render() {
    const time = this.time ?? 0;
    const chaos = this.roof.state.chaos ?? 0;
    this.renderer.toneMappingExposure = 1.0;
    if (this.phase === "over") {
      this.split.render([{ camera: this.finalCamera, grade: { danger: 0, hit: 0, dark: 0.22, heat: chaos * 0.2 } }], time);
      return;
    }
    const views = this.players.map((p) => ({
      camera: p.camera,
      before: () => this.roof.applyOcclusion?.(p.cam.hutFade),
      grade: {
        danger: THREE.MathUtils.clamp(1 - p.integrity / MAX_INTEGRITY, 0, 1) * (p.state === "alive" ? 1 : 0.3),
        hit: p.hitFlash,
        // Out: the view darkens and closes in until you are back.
        dark: 0.15 + chaos * 0.1 + (["down", "out", "falling"].includes(p.state) ? 0.55 : 0),
        heat: chaos * 0.35,
      },
    }));
    this.split.render(views, time);
  }

  /* ================================================================ */
  /* Players                                                           */
  /* ================================================================ */

  _updatePlayer(p, intent, dt, time, fighting) {
    p.dodge = Math.max(0, p.dodge - dt);
    p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    p.mercy = Math.max(0, (p.mercy ?? 0) - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.frozen = Math.max(0, p.frozen - dt);
    p.fireCooldown -= dt;
    p.cam.trauma = Math.max(0, p.cam.trauma - dt * 1.5);
    let present = { speed: 0, height: 0, aiming: false, sliding: false, climbing: 0 };

    if (p.state === "alive") {
      if (fighting) {
        if (intent.cycle) {
          const ball = p.arsenal.cycle(intent.cycle);
          p.log(`${ball.name.toUpperCase()} SPHERE // ${ball.cost} PER SHOT`, "info");
        }
        if (intent.dodge && p.stun <= 0) {
          if (!this.ladderOwner && this.roof.canReachLadder(p.position)) this._leap(p);
          else if (p.dodgeCooldown <= 0) {
            const dir = Math.hypot(intent.move.x, intent.move.y) > 0.2 ? _v.set(intent.move.x, 0, -intent.move.y) : p.velocity.lengthSq() > 0.5 ? _v.copy(p.velocity) : p.forward(_v);
            p.dodgeDir.copy(dir.setY(0).normalize());
            p.dodge = DODGE_SECONDS;
            p.dodgeCooldown = DODGE_COOLDOWN;
            p.invulnerable = Math.max(p.invulnerable, DODGE_INVULNERABLE);
            this.audio?.whoosh?.();
          }
        }
      }
      if (p.state === "alive") {
        this._move(p, fighting ? intent : null, dt);
        this._aim(p, fighting ? intent : null, dt);
        if (fighting && intent.fire && p.fireCooldown <= 0 && p.stun <= 0) {
          this._shoot(p);
          p.fireCooldown = FIRE_INTERVAL * (p.arsenal.isActive("overdrive") ? 0.7 : 1);
        }
        const before = p.spheres;
        p.spheres = p.recovery.update(dt, p.spheres, fighting, 3);
        if (p.spheres > before) p.log("+1 SPHERE // EMERGENCY RECHARGE", "info");
        if (p.position.y < OVER_THE_EDGE) this._overboard(p);
        present = { speed: p.velocity.length() + (p.dodge > 0 ? DODGE_SPEED : 0), height: p.vy < -1 ? 1 : 0, aiming: intent.fire, sliding: p.dodge > 0 };
      }
    } else if (p.state === "leap") {
      this._updateLeap(p, dt);
      present = { height: 1 };
    } else if (p.state === "ladder") {
      present = this._updateLadder(p, intent, dt, time);
    } else if (p.state === "yanked") {
      this._updateYank(p, dt);
      present = { height: 1 };
    } else if (p.state === "falling") {
      p.fall += dt;
      p.vy -= GRAVITY * dt;
      p.position.addScaledVector(p.velocity, dt);
      p.position.y += p.vy * dt;
      p.avatar.root.rotation.x = -p.fall * 1.9;
      p.avatar.root.rotation.z = Math.sin(p.fall * 3.1) * 0.6;
      p.avatar.reachUp = 0.9;
      present = { height: 1 };
      if (p.position.y < FALL_OUT) {
        p.state = "out";
        p.respawnIn = RESPAWN_FALL;
        p.avatar.setVisible(false);
      }
    } else if (p.state === "down") {
      // Slumped where they fell, until they are back.
      p.avatar.root.rotation.x += (-1.35 - p.avatar.root.rotation.x) * Math.min(1, dt * 6);
      p.respawnIn -= dt;
      if (p.respawnIn <= 0 && fighting) this._respawn(p);
    } else if (p.state === "out") {
      p.respawnIn -= dt;
      if (p.respawnIn <= 0 && fighting) this._respawn(p);
    } else if (p.state === "extracted") {
      // Hanging from the top of the ladder as it hauls them away.
      this.roof.ladderPoint(LADDER_GRIP + CLIMB_HEIGHT, p.position);
      p.position.y -= HANG;
      p.position.x -= this.roof.heliSide * OFF_RUNGS;
      p.position.z += Math.sin(time * 2.1) * 0.06;
      p.yaw = Math.atan2(-this.roof.heliSide, 0);
      p.avatar.reachUp = 1;
      p.avatar.hold = 0;
    }
    if (this.phase === "outro" && p !== this.roundWinner && p.state === "alive") {
      // The loser watches it go.
      const heli = this.roof.heli?.root.position ?? this.roof.holdPoint;
      const want = Math.atan2(-(heli.x - p.position.x), -(heli.z - p.position.z));
      p.yaw += Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)) * Math.min(1, dt * 4);
    }
    p.arsenal.update(dt);
    p.present(dt, time, present);
  }

  _move(p, intent, dt) {
    const moving = intent && p.stun <= 0;
    const speed = SPEED * (p.frozen > 0 ? FROZEN_SPEED : 1) * (p.arsenal.isActive("overdrive") ? 1.25 : 1);
    _v.set(moving ? intent.move.x : 0, 0, moving ? -intent.move.y : 0).multiplyScalar(speed);
    p.velocity.lerp(_v, 1 - Math.exp(-dt * 12));
    p.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
    p.position.addScaledVector(p.velocity, dt).addScaledVector(p.knock, dt);
    if (p.dodge > 0) p.position.addScaledVector(p.dodgeDir, DODGE_SPEED * dt);
    this.roof.clampPlayer(p.position);
    // Underfoot: the roof - or, past an open ledge or over a hatch, nothing.
    const ground = this.roof.groundAt(p.position);
    if (ground !== null && p.position.y >= ground - 0.3 && p.vy <= 0) {
      p.position.y = ground;
      p.vy = 0;
    } else {
      p.vy -= GRAVITY * dt;
      p.position.y += p.vy * dt;
    }
  }

  /** Keep the two of them from standing inside each other. */
  _separate() {
    const [a, b] = this.players;
    if (a.state !== "alive" || b.state !== "alive") return;
    _v.subVectors(b.position, a.position).setY(0);
    const d = _v.length();
    if (d > 0.9 || d < 1e-4) return;
    _v.multiplyScalar((0.9 - d) / d / 2);
    a.position.sub(_v);
    b.position.add(_v);
  }

  /* ---------------- Aim ---------------- */

  /**
   * Where a player aims. The mouse: right under the cursor, in their own
   * half. A stick: that way, with a narrow assist onto the enemy or rival
   * nearest the line. Keys only: the way they face, with a wide assist.
   */
  _aim(p, intent, dt) {
    const rival = this.rival(p);
    if (intent?.pointer) {
      const rect = this._viewRect(p.index);
      const canvas = this.renderer.domElement.getBoundingClientRect();
      const lx = intent.pointer.x - canvas.left;
      const ly = canvas.height - (intent.pointer.y - canvas.top);
      _ndc.set(THREE.MathUtils.clamp(((lx - rect.x) / rect.w) * 2 - 1, -1, 1), THREE.MathUtils.clamp(((ly - rect.y) / rect.h) * 2 - 1, -1, 1));
      // The reticle stays inside their half.
      p.reticle = { x: canvas.left + rect.x + ((_ndc.x + 1) / 2) * rect.w, y: canvas.top + canvas.height - (rect.y + ((_ndc.y + 1) / 2) * rect.h) };
      this.raycaster.setFromCamera(_ndc, p.camera);
      const targets = [...this.roof.breakables];
      if (rival.state === "alive" || rival.state === "ladder") targets.push(rival.hurt);
      const hit = this.raycaster.intersectObjects(targets, false)[0];
      this.aimPlane.constant = -(p.position.y + 1.15);
      if (hit) p.aim.copy(hit.point);
      else if (!this.raycaster.ray.intersectPlane(this.aimPlane, p.aim)) {
        _v.copy(this.raycaster.ray.direction).setY(0);
        if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
        p.aim.copy(p.position).addScaledVector(_v.normalize(), AIM_FAR).setY(p.position.y + 1.15);
      }
      p.hot = Boolean(hit);
      _v.subVectors(p.aim, p.position).setY(0);
      if (_v.lengthSq() > 0.6) p.aimDir.copy(_v.normalize());
    } else {
      p.reticle = null;
      let dir = null;
      let cone = ASSIST_KEYS;
      if (intent?.aimStick) {
        dir = _v.set(intent.aimStick.x, 0, -intent.aimStick.y).normalize();
        cone = ASSIST_STICK;
      } else if (p.velocity.lengthSq() > 1.2) dir = _v.copy(p.velocity).setY(0).normalize();
      if (dir) p.aimDir.lerp(dir, 1 - Math.exp(-dt * 20)).normalize();
      const target = this._assist(p, p.aimDir, cone);
      p.hot = Boolean(target);
      if (target) {
        p.aim.copy(target);
        _w.subVectors(target, p.position).setY(0);
        if (_w.lengthSq() > 0.3 && intent?.aimStick) p.aimDir.lerp(_w.normalize(), 0.35).normalize();
      } else p.aim.copy(p.position).addScaledVector(p.aimDir, STICK_AIM).setY(p.position.y + 1.15);
    }
    // Facing where they aim, as in any top-down shooter.
    _v.subVectors(p.aim, p.position).setY(0);
    const face = _v.lengthSq() > 0.8 ? _v : p.aimDir;
    const want = Math.atan2(-face.x, -face.z);
    p.yaw += Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)) * Math.min(1, dt * 22);
  }

  /** The best target near a line: an enemy, or the rival, led by its motion. */
  _assist(p, dir, cone) {
    let best = null;
    let bestScore = Infinity;
    const consider = (position, velocity, height) => {
      _a.subVectors(position, p.position).setY(0);
      const d = _a.length();
      if (d < 0.8 || d > ASSIST_RANGE) return;
      const angle = Math.acos(THREE.MathUtils.clamp(_a.dot(dir) / d, -1, 1));
      if (angle > cone) return;
      const score = angle / cone + d / ASSIST_RANGE * 0.35;
      if (score >= bestScore) return;
      if (!this.roof.clearLine(_b.copy(p.position).setY(0.8), _w.copy(position).setY(0.8))) return;
      bestScore = score;
      // Led by the flight time of the sphere in hand.
      const t = d / p.arsenal.current.speed;
      best = (best ?? new THREE.Vector3()).copy(position).setY(position.y + height);
      if (velocity) best.addScaledVector(velocity, t);
    };
    for (const e of this.roof.enemies) {
      if (!e.alive || e.state === "emerge") continue;
      consider(e.position, e.state === "charge" ? _b.copy(e.dir).multiplyScalar(e.stats?.charge ?? 0) : null, 1.1 * e.root.scale.y);
    }
    const rival = this.rival(p);
    if (rival.state === "alive") consider(rival.position, rival.velocity, 1.15);
    else if (rival.state === "ladder") consider(rival.position, null, 1.1);
    return best;
  }

  /* ---------------- Shooting ---------------- */

  _shoot(p) {
    const def = p.arsenal.current;
    const cost = p.arsenal.cost();
    if (!canAffordThrow(p.spheres, cost)) {
      if (!p.dryAt || this.clock - p.dryAt > 0.8) {
        p.dryAt = this.clock;
        p.log(p.spheres > 0 ? `${def.name.toUpperCase()} NEEDS ${cost} // SWITCH SPHERE` : "NO SPHERES // KILL FOR MORE, OR WAIT", "warn");
        this.audio?.dry?.();
      }
      return;
    }
    p.spheres -= cost;
    const count = p.arsenal.isActive("prism") ? 3 : 1;
    p.stats.shots += count;
    const muzzle = p.muzzle(_a);
    const fire = _w.subVectors(p.aim, muzzle).normalize();
    const flight = p.aim.distanceTo(muzzle) / def.speed;
    for (let i = 0; i < count; i += 1) {
      const dir = fire.clone();
      if (count > 1) dir.applyAxisAngle(UP, (i - 1) * 0.07);
      dir.multiplyScalar(def.speed).addScaledVector(UP, 0.5 * def.gravity * flight);
      const ball = this.projectiles.fire(muzzle, dir, dir.length(), {
        power: p.arsenal.isActive("overdrive") ? 2 : 1, inherit: _b.copy(p.velocity).multiplyScalar(0.5), gravity: def.gravity, kind: def.key, radius: def.radius,
      });
      ball.owner = p;
    }
    p.launcher.recoil = 1;
    this.audio?.shot?.(false);
    this.sfx?.throwBall?.();
  }

  /** A sphere into something it can hit: an enemy, a cache, a canister - or the rival. */
  _onBallHit(object, point, ball) {
    const owner = ball.owner;
    const data = object.userData;
    if (data.kind === "player") {
      const victim = data.competitor;
      // Your own body, or a dodge through it: it flies on.
      if (victim === owner || !owner || victim.invulnerable > 0) return false;
      this._rivalHit(victim, owner, ball.kind ?? "glass", point, true);
      if (ball.kind && ball.kind !== "glass") this._detonate(ball, point, false, victim);
      return true;
    }
    this._breakFor(owner, object, point, ball.power);
    if (ball.kind && ball.kind !== "glass") this._detonate(ball, point);
    return true;
  }

  _onBallSolid(point, ball) {
    this.debris.sparks(point, { count: 14, speed: 5 });
    this.audio?.clang?.();
    if (ball?.kind && ball.kind !== "glass") {
      this._detonate(ball, point);
      ball.life = 99;
    }
  }

  /** On the deck: a special sphere goes off there. Past the edge there is no deck: it goes off in the air. */
  _onBallFloor(point, ball) {
    const overVoid = this.roof.groundAt(point) === null;
    if (overVoid) {
      if (ball.kind && ball.kind !== "glass") this._detonate(ball, point.clone(), false);
      ball.life = 99;
      return;
    }
    if (!ball.kind || ball.kind === "glass") return;
    this._detonate(ball, point.clone(), true);
    ball.life = 99;
  }

  /** Break a roof target on someone's behalf, and give them what it gives. */
  _breakFor(owner, object, point, power) {
    const kind = object.userData.kind;
    if (kind === "canister") this.blast = { owner, at: this.clock };
    this._directHit = true;
    const result = this.roof.breakTarget(object, power, owner?.position ?? null);
    this._directHit = false;
    if (!result) return;
    if (result.kind === "enemy") {
      const enemy = object.userData.enemy;
      this.debris.burst(point, { kind: "concrete", count: result.partial ? 6 : 12, speed: 3, size: 0.1 });
      this.debris.dust(point, { size: result.partial ? 1.2 : 2.2, life: 0.7, color: 0x5a2a22 });
      this.debris.sparks(point, { count: 8, speed: 3 });
      this.audio?.thud?.();
      this.sfx?.impact?.(result.partial ? 0.4 : 0.7);
      if (!result.partial && owner) this._credit(owner, enemy, "down");
    } else if (result.kind === "sack" && !result.partial) {
      if (owner) {
        owner.spheres = Math.min(MAX_SPHERES, owner.spheres + (result.spheres ?? 0));
        owner.recovery.reset();
        owner.log(`SPHERE CACHE  +${result.spheres}`, "good");
      }
      this.debris.burst(result.position, { kind: "sack", count: 26, speed: 4 });
      this._chunks(result.position, 14, { tint: 0xd8f6ff, speed: 3.5 });
      this.sfx?.glassBreak?.();
      this.sfx?.sphereCollected?.();
      this.audio?.pickup?.();
    } else if (result.kind === "powerup") {
      const serum = VIAL_SERUM[result.powerupKind] ?? result.powerupKind;
      if (owner && SERUMS[serum]) {
        owner.arsenal.activate(serum);
        owner.log(`SERUM // ${SERUMS[serum].name.toUpperCase()}`, "power");
      }
      this.debris.sparks(result.position, { count: 30 });
      this._chunks(result.position, 18, { tint: 0xfff0a8, speed: 4.5 });
      this.sfx?.serumCollected?.();
      this.audio?.powerup?.();
    }
  }

  _chunks(point, count, options) {
    this.shatter.floor = 0;
    this.shatter.chunks(point, count, options);
  }

  /** A kill: the score, spheres, and the helicopter that much nearer. */
  _credit(p, enemy, how) {
    p.stats.kills += 1;
    p.stats.roundKills += 1;
    const kind = enemy?.kind === "scientist" ? "scientist" : enemy?.brute ? "brute" : "patient";
    const bonus = KILL_SPHERES[kind];
    p.spheres = Math.min(MAX_SPHERES, p.spheres + bonus);
    const shaved = this.roof.shave();
    const name = kind === "scientist" ? "SCIENTIST" : kind === "brute" ? "BRUTE" : "PATIENT";
    p.log(`${name} ${how === "lured" ? "OVER THE EDGE" : how === "blast" ? "BLOWN UP" : "DOWN"}  +${bonus}`, "kill");
    if (shaved > 0.01) this.hud.heliPulse(p.index, shaved);
  }

  /**
   * A special sphere going off: cryo and shock break what's in reach (on the
   * thrower's behalf); gravity opens a black hole. The rival in reach gets
   * its effect (a direct hit already did - `skip`).
   */
  _detonate(ball, point, ground = false, skip = null) {
    const def = BALLS[ball.kind];
    if (!def?.splash) return;
    const owner = ball.owner;
    this.impact.splash(point, ball.kind, def.splash, null, { ground });
    const rival = owner ? this.rival(owner) : null;
    if (ball.kind === "gravity") {
      this._openWell(point, def.splash, owner);
      if (rival && rival !== skip && rival.invulnerable <= 0 && this._inReach(rival, point, def.splash)) this._rivalHit(rival, owner, "gravity", point, false);
      this._shake(point, 0.15);
      return;
    }
    this.debris.sparks(point, { count: 26, speed: 6 });
    this._chunks(point, 22, { tint: ball.kind === "cryo" ? 0xbff4ff : 0xd9a6ff, speed: 5, radius: def.splash * 0.3, size: 0.08 });
    for (const target of this.roof.breakables.slice()) {
      if (!target.parent || target.userData.kind === "powerup") continue;
      target.getWorldPosition(_a);
      if (_a.distanceTo(point) > def.splash) continue;
      this._breakFor(owner, target, _a.clone(), ball.kind === "shock" ? 99 : 2);
    }
    if (rival && rival !== skip && rival.invulnerable <= 0 && this._inReach(rival, point, def.splash)) this._rivalHit(rival, owner, ball.kind, point, false);
    this._shake(point, 0.2);
    this.sfx?.glassBreak?.();
  }

  _inReach(p, point, radius) {
    if (!["alive", "ladder", "leap"].includes(p.state)) return false;
    return _a.copy(p.position).setY(p.position.y + 1).distanceTo(point) <= radius;
  }

  /* ---------------- The rival ---------------- */

  /**
   * One Subject's sphere on the other. On the roof: damage, and the sphere's
   * effect (a shove, a freeze, a pull). On the ladder: the ladder rules.
   */
  _rivalHit(victim, attacker, kind, point, direct) {
    const rule = RIVAL[kind] ?? RIVAL.glass;
    victim.lastRivalHit = this.clock;
    attacker.stats.rivalHits += 1;
    this.input.rumble(victim.device, 0.7, 0.5, 0.25);
    this.input.rumble(attacker.device, 0.15, 0.3, 0.1);

    if (victim.state === "ladder" || victim.state === "leap") {
      if (kind === "shock") {
        this._knockOff(victim, attacker, point);
      } else if (kind === "gravity") {
        this._yankOff(victim, attacker, point);
      } else if (kind === "cryo") {
        victim.ladder.iced = ICED_HANDS;
        victim.frozen = ICED_HANDS;
        victim.log("HANDS FROZEN // HOLD ON", "warn");
        attacker.log(`${victim.team.label}'S HANDS FROZEN`, "hit");
      } else {
        victim.ladder.h = Math.max(0, victim.ladder.h - SLIP_GLASS);
        victim.hitFlash = 1;
        victim.log("HIT // SLIPPED DOWN THE LADDER", "warn");
        attacker.log(`HIT ${victim.team.label} // THEY SLIPPED`, "hit");
      }
      this.audio?.clang?.();
      return;
    }

    if (victim.state !== "alive") return;
    const damage = rule.damage * (direct ? 1 : 0.8);
    if (damage > 0) {
      if (victim.arsenal.absorb()) {
        victim.log("SHIELD ABSORBED IT", "power");
        this.debris.sparks(_a.copy(victim.position).setY(1.2), { count: 20 });
      } else {
        victim.integrity = Math.max(0, victim.integrity - damage);
        attacker.stats.damageDealt += damage;
        victim.hitFlash = 1;
        victim.cam.trauma = Math.min(1, victim.cam.trauma + 0.45);
        this.sfx?.hurt?.(0.85);
        this.debris.sparks(_a.copy(victim.position).setY(1.2), { count: 14 });
      }
    }
    const away = _a.subVectors(victim.position, point).setY(0);
    if (away.lengthSq() < 0.04) away.subVectors(victim.position, attacker.position).setY(0);
    away.normalize();
    if (kind === "shock") {
      victim.knock.copy(away).multiplyScalar(rule.knock);
      victim.stun = rule.stun;
      victim.log(`SHOCKED BY ${attacker.team.label}`, "warn");
      attacker.log(`SHOCKED ${victim.team.label}`, "hit");
    } else if (kind === "cryo") {
      victim.frozen = rule.frozen;
      victim.log(`FROZEN BY ${attacker.team.label} // SLOWED`, "warn");
      attacker.log(`FROZE ${victim.team.label}`, "hit");
    } else if (kind === "gravity") {
      // Yanked toward the black hole (and dragged on by it while it lasts).
      _b.subVectors(point, victim.position).setY(0);
      const d = _b.length();
      if (d > 0.3) victim.knock.addScaledVector(_b.divideScalar(d), Math.min(rule.yank, 2 + d));
      victim.log(`PULLED BY ${attacker.team.label}'S GRAVITY`, "warn");
      attacker.log(`PULLED ${victim.team.label} IN`, "hit");
    } else {
      victim.knock.copy(away).multiplyScalar(rule.knock);
      victim.log(`HIT BY ${attacker.team.label}  -${Math.round(damage)}`, "warn");
      attacker.log(`HIT ${victim.team.label}  -${Math.round(damage)}`, "hit");
    }
    if (victim.integrity <= 0) this._down(victim, attacker);
  }

  /** A patient's charge, a scientist's orb, a canister: on the roof only. */
  _enemyHit(p, hit) {
    if (p.state !== "alive" || p.invulnerable > 0 || p.mercy > 0) return;
    if (p.arsenal.absorb()) {
      p.mercy = 0.6;
      this.debris.sparks(_a.copy(p.position).setY(1.2), { count: 20 });
      p.log("SHIELD ABSORBED IT", "power");
      return;
    }
    p.integrity = Math.max(0, p.integrity - hit.damage);
    p.mercy = MERCY;
    p.knock.subVectors(p.position, hit.from).setY(0).normalize().multiplyScalar(hit.knock);
    p.hitFlash = 1;
    p.cam.trauma = Math.min(1, p.cam.trauma + (hit.source === "patient" ? 0.8 : 0.45));
    p.log(hit.source === "patient" ? `CHARGED  -${hit.damage}` : hit.source === "blast" ? `CAUGHT IN THE BLAST  -${hit.damage}` : `ORB  -${hit.damage}`, "warn");
    this.audio?.stumble?.();
    this.sfx?.impact?.(hit.source === "patient" ? 1 : 0.7);
    this.sfx?.hurt?.(hit.source === "patient" ? 1.1 : 0.85);
    this.input.rumble(p.device, 0.8, 0.6, 0.3);
    if (p.integrity <= 0) this._down(p, hit.by ?? (this.clock - p.lastRivalHit < CREDIT_WINDOW ? this.rival(p) : null));
  }

  /** Out of integrity: down where they stand, back at the lift in a few seconds. */
  _down(p, by) {
    if (p.state !== "alive") return;
    p.state = "down";
    p.respawnIn = RESPAWN_DOWN;
    p.velocity.set(0, 0, 0);
    p.knock.set(0, 0, 0);
    p.stats.downs += 1;
    p.hurt.userData.alive = false;
    p.log(by ? `TAKEN DOWN BY ${by.team.label}` : "DOWN // THEY GOT YOU", "loss");
    if (by) {
      by.stats.takedowns += 1;
      by.log(`TOOK DOWN ${p.team.label}`, "kill");
    }
    this.debris.dust(_a.copy(p.position).setY(0.6), { size: 2.4, life: 1.2, color: 0x3a2e28 });
    this.audio?.bodyFall?.();
    this._event("down", { player: p.index, by: by?.index ?? null });
  }

  /** Off an open ledge (or down a hatch): falling, and out. */
  _overboard(p) {
    if (p.state !== "alive") return;
    const hatch = this.roof.overHatch(p.position);
    p.state = "falling";
    p.fall = 0;
    p.vy = Math.min(p.vy, 0);
    p.velocity.multiplyScalar(0.6).add(p.knock.multiplyScalar(0.3));
    p.stats.overboard += 1;
    p.hurt.userData.alive = false;
    const by = this.clock - p.lastRivalHit < CREDIT_WINDOW ? this.rival(p) : null;
    p.log(hatch ? "DOWN A HATCH" : by ? `${by.team.label} SENT YOU OVER THE EDGE` : "OVER THE EDGE", "loss");
    if (by) {
      by.stats.knockOffs += 1;
      by.log(`SENT ${p.team.label} OVER THE EDGE`, "kill");
    }
    this.sfx?.fallScream?.() ?? this.audio?.scream?.();
    this._event("overboard", { player: p.index, by: by?.index ?? null });
  }

  _respawn(p) {
    const rival = this.rival(p);
    // The spawn further from the rival.
    const [a, b] = SPAWNS;
    const at = a.distanceTo(rival.position) > b.distanceTo(rival.position) ? a : b;
    p.avatar.root.rotation.set(0, 0, 0);
    p.spawn(at, { spheres: RESPAWN_SPHERES, invulnerable: RESPAWN_GRACE });
    p.log("BACK IN THE FIGHT", "info");
  }

  /* ---------------- The ladder ---------------- */

  _leap(p) {
    p.state = "leap";
    p.ladder.t = 0;
    p.ladder.from.copy(p.position);
    p.ladder.h = 0;
    p.ladder.iced = 0;
    p.velocity.set(0, 0, 0);
    p.knock.set(0, 0, 0);
    this.ladderOwner = p;
    p.log("ON THE LADDER // MASH JUMP TO CLIMB", "power");
    this.rival(p).log(`${p.team.label} IS ON THE LADDER // SHOCK THEM OFF`, "alert");
    this.audio?.whoosh?.();
    this.input.rumble(p.device, 0.3, 0.5, 0.2);
    this._event("ladder", { player: p.index });
  }

  /** Where the body hangs for hands `h` up the ladder. */
  _onLadder(h, target) {
    this.roof.ladderPoint(LADDER_GRIP + h, target);
    target.y -= HANG;
    target.x -= this.roof.heliSide * OFF_RUNGS;
    return target;
  }

  _updateLeap(p, dt) {
    p.ladder.t += dt / LEAP_SECONDS;
    const t = Math.min(1, p.ladder.t);
    const to = this._onLadder(0, _a);
    p.position.lerpVectors(p.ladder.from, to, t);
    p.position.y += Math.sin(t * Math.PI) * 1.0;
    p.yaw = Math.atan2(-this.roof.heliSide, 0);
    p.avatar.reachUp = THREE.MathUtils.smoothstep(t, 0.1, 0.7);
    p.avatar.hold = 1 - p.avatar.reachUp;
    if (t >= 1) p.state = "ladder";
  }

  _updateLadder(p, intent, dt, time) {
    const l = p.ladder;
    p.stats.ladderTime += dt;
    l.iced = Math.max(0, l.iced - dt);
    const before = l.h;
    if (this.phase === "fight" && l.iced <= 0) {
      if (intent.dodge && this.clock - l.lastTap > CLIMB_TAP_GAP) {
        l.h += CLIMB_TAP;
        l.lastTap = this.clock;
        this.audio?.clang?.();
      } else if (intent.climbHeld) l.h += CLIMB_HOLD * dt;
    }
    l.h = Math.min(CLIMB_HEIGHT, l.h);
    const climbing = l.h > before ? 1 : 0;
    this._onLadder(l.h, p.position);
    p.yaw = Math.atan2(-this.roof.heliSide, 0);
    p.avatar.reachUp = 1;
    p.avatar.hold = 0;
    if (l.h >= CLIMB_HEIGHT) this._winRound(p);
    return { speed: climbing ? 2.5 : 0, height: 0, climbing };
  }

  /** Shock on the ladder: off it, and down the side of the tower. */
  _knockOff(p, by, from) {
    p.state = "falling";
    p.fall = 0;
    this.ladderOwner = null;
    const side = this.roof.heliSide;
    p.velocity.set(side * 2.5, 0, (p.position.z - from.z) > 0 ? 1.2 : -1.2);
    p.vy = 2.5;
    p.stats.overboard += 1;
    p.hurt.userData.alive = false;
    by.stats.knockOffs += 1;
    p.log(`${by.team.label} KNOCKED YOU OFF THE LADDER`, "loss");
    by.log(`KNOCKED ${p.team.label} OFF THE LADDER`, "kill");
    this.hud.flash("both", `${by.team.label} KNOCKED ${p.team.label} OFF`, "THE LADDER IS OPEN", by.index);
    this.sfx?.fallScream?.() ?? this.audio?.scream?.();
    this.audio?.crash?.(0.6);
    this._event("knock-off", { player: p.index, by: by.index });
  }

  /** Gravity on the ladder: yanked toward the black hole - onto the roof, or into the drop. */
  _yankOff(p, by, well) {
    this.ladderOwner = null;
    const overRoof = this.roof.groundAt(well) !== null;
    if (!overRoof) {
      this._knockOff(p, by, well);
      return;
    }
    p.state = "yanked";
    p.ladder.t = 0;
    p.ladder.from.copy(p.position);
    const side = this.roof.heliSide;
    // Thrown back onto the roof toward it - no further than the hole, and onto the deck.
    const to = p.ladder.to ?? new THREE.Vector3();
    to.set(THREE.MathUtils.clamp(well.x, -EDGE + 1.5, EDGE - 1.5), 0, THREE.MathUtils.clamp(well.z, -EDGE + 1.5, EDGE - 1.5));
    if (side * to.x > EDGE - 2.5) to.x = side * (EDGE - 2.5);
    this.roof.resolveCircle(to, 0.5);
    p.ladder.to = to;
    p.log(`${by.team.label} PULLED YOU OFF THE LADDER`, "loss");
    by.log(`PULLED ${p.team.label} OFF THE LADDER`, "kill");
    this.hud.flash("both", `${by.team.label} PULLED ${p.team.label} OFF`, "THE LADDER IS OPEN", by.index);
    this._event("yank", { player: p.index, by: by.index });
  }

  _updateYank(p, dt) {
    p.ladder.t += dt / 0.6;
    const t = Math.min(1, p.ladder.t);
    p.position.lerpVectors(p.ladder.from, p.ladder.to, THREE.MathUtils.smootherstep(t, 0, 1));
    p.position.y = p.ladder.from.y * (1 - t) + Math.sin(t * Math.PI) * 1.4;
    p.avatar.reachUp = 1 - t;
    p.avatar.hold = t;
    if (t >= 1) {
      p.state = "alive";
      p.position.y = 0;
      p.vy = 0;
      p.stun = 0.8;
      p.hurt.userData.alive = true;
    }
  }

  /* ---------------- Wells, pickups ---------------- */

  _openWell(point, radius, owner) {
    // The roof's people are yanked toward it and stunned (game.js's rules).
    for (const e of this.roof.enemies) {
      if (!e.alive || ["emerge", "fall", "down"].includes(e.state)) continue;
      _b.subVectors(point, e.position).setY(0);
      const d = _b.length();
      if (d > radius) continue;
      if (d > 0.3) e.velocity.addScaledVector(_b.divideScalar(d), Math.min(9, 3 + d));
      e.setState?.("stunned");
      e.stagger = 1;
    }
    // ...and the caches and serums in reach are the thrower's.
    for (const target of this.roof.breakables.slice()) {
      const kind = target.userData.kind;
      if (kind !== "sack" && kind !== "powerup") continue;
      target.getWorldPosition(_a);
      if (_a.distanceTo(point) <= radius) this._breakFor(owner, target, _a.clone(), 99);
    }
    this.wells.push({ point: point.clone(), radius, t: WELL_SECONDS, owner });
    this.audio?.whoosh?.();
  }

  _updateWells(dt) {
    for (let i = this.wells.length - 1; i >= 0; i -= 1) {
      const w = this.wells[i];
      w.t -= dt;
      if (w.t <= 0) {
        this.wells.splice(i, 1);
        continue;
      }
      for (const e of this.roof.enemies) {
        if (!e.alive || e.removed || ["emerge", "fall", "down"].includes(e.state)) continue;
        _b.subVectors(w.point, e.position).setY(0);
        const d = _b.length();
        if (d > w.radius || d < 0.7) continue;
        e.position.addScaledVector(_b.divideScalar(d), Math.min(d - 0.7, dt * 5.5));
        e.collide?.();
      }
      // The rival is dragged on by it - toward a ledge, if that's where it is.
      const rival = w.owner ? this.rival(w.owner) : null;
      if (rival?.state === "alive" && rival.invulnerable <= 0) {
        _b.subVectors(w.point, rival.position).setY(0);
        const d = _b.length();
        if (d <= w.radius && d > 0.5) rival.position.addScaledVector(_b.divideScalar(d), Math.min(d - 0.5, dt * RIVAL.gravity.pull));
      }
    }
  }

  /** Walk into a sphere cache or a serum to take it. */
  _walkIntoPickups() {
    for (const p of this.players) {
      if (p.state !== "alive") continue;
      for (const target of this.roof.breakables.slice()) {
        const kind = target.userData.kind;
        if ((kind !== "sack" && kind !== "powerup") || !target.userData.alive) continue;
        target.getWorldPosition(_a);
        if (_a.setY(0).distanceTo(_b.copy(p.position).setY(0)) < 1.0) this._breakFor(p, target, _a.clone().setY(1), 99);
      }
    }
  }

  /* ---------------- The roof's events ---------------- */

  _bindRoofEvents() {
    const roof = this.roof;
    const on = (name, fn) => roof.events.on(name, fn);
    on("wave", ({ index }) => {
      this.hud.flash("both", index === 1 ? "THEY'RE LETTING THEM OUT" : index === 3 ? "EVERYONE LEFT, AT ONCE" : "MORE OF THEM", "", null);
      this.sfx?.patient?.("horde", { strength: 0.8 });
    });
    on("patient-windup", () => this.sfx?.patient?.("growl", { strength: 0.9 }));
    on("patient-climb", ({ position }) => {
      for (const p of this.players) if (p.state === "alive" && Math.abs(p.position.x - position.x) < 10) p.log(`OVER THE ${position.x < 0 ? "WEST" : "EAST"} LEDGE`, "alert");
    });
    on("patient-stunned", ({ position }) => {
      this.debris.dust(position.clone().setY(1), { size: 2 });
      this.audio?.clang?.();
    });
    on("enemy-fall", ({ enemy }) => {
      if (enemy?.kind === "scientist") this.sfx?.play?.("scream-m", { volume: 0.6 });
      else this.sfx?.patient?.("shriek", { strength: 0.9 });
    });
    // Lured over the edge: the one it was going for gets it.
    on("vs-fall", ({ enemy, target }) => {
      const p = this.players[target];
      if (!p || this.phase !== "fight") return;
      p.stats.lured += 1;
      this._credit(p, enemy, "lured");
    });
    on("enemy-ash", ({ position, start }) => {
      if (start) {
        this.debris.sparks(position, { count: 34, speed: 5 });
        this.debris.dust(position, { size: 2.4, life: 1.9, color: 0x3d3632 });
      } else {
        this.debris.sparks(position, { count: 4, speed: 1.8 });
      }
    });
    on("enemy-down", ({ enemy }) => {
      this.audio?.bodyFall?.();
      if (enemy?.kind === "scientist") this.sfx?.play?.("hurt-m", { volume: 0.7 });
      else this.sfx?.patient?.("death", { strength: 1 });
      // A canister's blast (a direct hit was credited where it landed).
      if (!this._directHit && this.blast?.owner) this._credit(this.blast.owner, enemy, "blast");
    });
    on("canister", ({ position, downs }) => {
      this.impact.splash(position, "fire", CANISTER_RADIUS, [3.2, 1.2, 0.3]);
      this.debris.burst(position, { kind: "metal", count: 30, speed: 7 });
      this.debris.sparks(position, { count: 40, speed: 9 });
      this.debris.dust(position, { size: 4, life: 1.4, color: 0x2a1a12 });
      this.audio?.crash?.(1.3);
      this.sfx?.explosion?.(1, 0);
      this._shake(position, 0.6);
      const owner = this.blast?.owner ?? null;
      if (owner && downs > 1) owner.log(`CHAIN BLAST // ${downs} DOWN`, "kill");
      // Everyone near it - you too.
      for (const p of this.players) {
        if (p.state !== "alive" || p.invulnerable > 0) continue;
        const d = _a.copy(p.position).setY(0).distanceTo(_b.copy(position).setY(0));
        if (d >= CANISTER_RADIUS) continue;
        const damage = Math.round(24 * (1 - d / CANISTER_RADIUS)) + 6;
        const by = owner && owner !== p ? owner : null;
        if (by) {
          p.lastRivalHit = this.clock;
          by.stats.rivalHits += 1;
          by.stats.damageDealt += damage;
        }
        p.mercy = 0;
        this._enemyHit(p, { damage, from: position.clone(), knock: 8, source: "blast", by });
      }
    });
    on("drop-incoming", () => this.hud.flash("both", "SUPPLY DROP", "WATCH FOR THE FLARE", null));
    on("drop-landed", ({ position }) => {
      this.debris.dust(position.clone().setY(0.2), { size: 3, life: 1.2 });
      this.audio?.thud?.();
    });
    on("brute", () => {
      this.sfx?.patient?.("roar", { strength: 1.2 });
      this.hud.flash("both", "A BIG ONE", "TWO SPHERES WON'T STOP IT", null);
    });
    on("orb-fired", () => this.audio?.zap?.());
    on("orb-burst", ({ position }) => this.debris.sparks(position, { count: 22, speed: 5 }));
    on("explosion", ({ position, strength }) => {
      this.debris.burst(position.clone().setY(Math.max(0.3, position.y + 2)), { kind: "concrete", count: 24, speed: 7, up: 5 });
      this.debris.sparks(position.clone().setY(0.5), { count: 40, speed: 9 });
      this.debris.dust(position.clone().setY(1), { size: 7, life: 2.2, color: 0x3a2e28 });
      this._shake(position, strength * 0.7, 30);
      this.audio?.crash?.(0.4 + strength * 0.4);
      this.sfx?.explosion?.(0.4 + strength * 0.5, 0);
    });
    on("tremor", ({ strength }) => {
      for (const p of this.players) p.cam.trauma = Math.min(1, p.cam.trauma + strength * 0.55);
      this.audio?.crash?.(0.25 + strength * 0.3);
      this.sfx?.distantCollapse?.(0.5 + strength * 0.5);
    });
    // The helicopter: the round's top killer earned the ledge it comes to.
    on("heli-call", () => {
      const [a, b] = this.players;
      const lead = a.stats.roundKills === b.stats.roundKills ? null : a.stats.roundKills > b.stats.roundKills ? a : b;
      let side = lead && Math.abs(lead.position.x) > 1 ? Math.sign(lead.position.x) : 0;
      if (!side) side = Math.random() < 0.5 ? -1 : 1;
      this.heliEarnedBy = lead;
      roof.callHelicopter(side);
    });
    on("heli-inbound", ({ side }) => {
      const where = side < 0 ? "WEST" : "EAST";
      const why = this.heliEarnedBy ? `${this.heliEarnedBy.team.label}'S KILLS CALLED IT` : "ONE SEAT";
      this.hud.flash("both", `HELICOPTER INBOUND // ${where} LEDGE`, why, this.heliEarnedBy?.index ?? null);
      this.audio?.stinger?.();
      this._event("heli-inbound", { side });
    });
    on("heli-arrived", ({ side }) => {
      this.hud.flash("both", "IT'S HERE // GET TO THE LADDER", `${side < 0 ? "WEST" : "EAST"} LEDGE // FIRST ONE UP WINS`, null);
      this._event("heli-arrived", { side });
    });
  }

  /** Camera shake for whoever is near a point. */
  _shake(point, amount, reach = 18) {
    for (const p of this.players) {
      const near = Math.max(0, 1 - p.position.distanceTo(point) / reach);
      p.cam.trauma = Math.min(1, p.cam.trauma + amount * near);
    }
  }

  /* ================================================================ */
  /* Cameras                                                           */
  /* ================================================================ */

  _viewRect(index) {
    return this.split.rects()[Math.min(index, this.split.rects().length - 1)];
  }

  _updateCamera(p, dt, time) {
    if (this.phase === "over") return;
    const camera = p.camera;
    const rect = this._viewRect(p.index);
    const aspect = rect.w / Math.max(1, rect.h);
    const frame = framingFor(aspect);
    const c = p.cam;
    const side = this.roof.heliSide || 1;
    let stiffness = 60;
    let lookRate = 18;

    if (p.state === "ladder" || p.state === "leap" || (p.state === "extracted" && this.phase === "outro")) {
      // On the ladder: from the roof behind them, the climb above and the roof
      // (and the rival coming) below.
      const ladder = this.roof.ladderPoint(LADDER_GRIP + p.ladder.h, _a);
      if (p.state === "extracted") {
        c.desired.copy(p.position).add(_b.set(-side * 6.5, 1.6, 7.5));
        c.look.copy(p.position).lerp(this.roof.heli?.root.position ?? ladder, 0.3);
        stiffness = 8;
      } else {
        c.desired.set(side * (EDGE - 6.5), 6.2 + p.ladder.h * 0.4, ladder.z + 9.5);
        c.look.copy(p.position).setY(p.position.y + 1.2).lerp(_b.set(side * 7, 0, ladder.z), 0.35);
        stiffness = 14;
      }
      lookRate = 6;
    } else if (p.state === "falling" || p.state === "out") {
      // Watching them go from the ledge, down past the facade.
      if (!c.fallFrom) c.fallFrom = camera.position.clone();
      c.desired.copy(c.fallFrom);
      if (p.state === "falling") c.look.copy(p.position);
      stiffness = 4;
      lookRate = 8;
    } else {
      c.fallFrom = null;
      c.desired.copy(p.position).add(frame.offset);
      c.lean.copy(p.aim).sub(p.position).setY(0).clampLength(0, 14).multiplyScalar(0.32);
      if (this.phase === "outro" && p !== this.roundWinner) {
        // The loser watches the helicopter leave.
        c.look.copy(this.roof.heli?.root.position ?? this.roof.holdPoint);
        lookRate = 3;
      } else {
        c.desired.add(c.lean);
        c.look.copy(p.position).add(frame.look).add(c.lean);
      }
      if (this.phase === "intro") {
        stiffness = 4 + 60 * THREE.MathUtils.smoothstep(this.phaseT, 0.6, 2.8);
        lookRate = 4 + 14 * THREE.MathUtils.smoothstep(this.phaseT, 0.4, 2.4);
      }
    }
    if (Math.abs(camera.fov - frame.fov) > 0.01) {
      camera.fov += (frame.fov - camera.fov) * (c.snap ? 1 : Math.min(1, dt * 4));
      camera.updateProjectionMatrix();
    }
    if (c.snap) {
      camera.position.copy(c.desired);
      c.vel.set(0, 0, 0);
      c.smoothedLook.copy(c.look);
      c.snap = false;
    } else {
      const omega = Math.sqrt(stiffness);
      for (const axis of ["x", "y", "z"]) [camera.position[axis], c.vel[axis]] = spring(camera.position[axis], c.vel[axis], c.desired[axis], omega, dt);
      c.smoothedLook.lerp(c.look, 1 - Math.exp(-dt * lookRate));
    }
    camera.up.copy(UP);
    camera.lookAt(c.smoothedLook);
    // Shake, squared so big hits are violent and the tail settles fast.
    const amount = c.trauma * c.trauma * (this.reducedMotion ? 0.25 : 1);
    if (amount > 0.001) {
      camera.position.x += (Math.random() * 2 - 1) * amount * 0.4;
      camera.position.y += (Math.random() * 2 - 1) * amount * 0.3;
    }
    // The lift housing fades out of the way when this camera is right over it.
    c.hutFade = this.roof.occlusionFade?.(camera.position, c.hutFade, dt) ?? 1;
  }

  _updateFinalCamera(dt, time) {
    const camera = this.finalCamera;
    const size = this.renderer.getSize(_ndc);
    camera.aspect = size.x / Math.max(1, size.y);
    camera.updateProjectionMatrix();
    const winner = this.matchWinner;
    const side = this.roof.heliSide || 1;
    const focus = _a.copy(winner.position).setY(winner.position.y + 1.4);
    const angle = Math.PI * 0.75 + this.phaseT * 0.16 * -side;
    camera.position.set(focus.x - side * 4 + Math.cos(angle) * 9, focus.y + 1.5 + Math.sin(this.phaseT * 0.3) * 0.6, focus.z + Math.sin(angle) * 9);
    camera.lookAt(focus.lerp(_b.set(side * 8, 2, -2), 0.25));
  }

  /* ================================================================ */
  /* Sound, HUD, events                                                */
  /* ================================================================ */

  _updateAudio(dt, time, fighting) {
    const chaos = this.roof.state.chaos ?? 0;
    this.audio?.setRotor?.(this.roof.rotorLevel);
    this.audio?.setFireProximity?.(0.25 + chaos * 0.5);
    const danger = Math.max(...this.players.map((p) => 1 - p.integrity / MAX_INTEGRITY));
    this.audio?.setDanger?.(Math.max(danger * 0.6, chaos * 0.65));
    this.sfx?.updateWind?.(fighting ? 0.7 + Math.sin(time * 0.31) * 0.2 : 0.3);
    this.sfx?.updateAlarm?.(fighting ? 0.45 : 0, 0.65);
    if (fighting && this.sfx) {
      this._moanIn = (this._moanIn ?? 2) - dt;
      if (this._moanIn <= 0) {
        this._moanIn = 2.5 + Math.random() * 4;
        if (this.roof.enemies.some((e) => e.alive && e.kind === "patient")) this.sfx.patient?.(Math.random() < 0.25 ? "speech" : "moan", { strength: 0.7 });
      }
    }
  }

  /** What the HUD shows this frame (hud.js). */
  _hudState() {
    const roof = this.roof;
    const s = roof.state;
    const views = this.split.rects();
    const players = this.players.map((p) => {
      const rival = this.rival(p);
      const markers = [];
      if (this.phase !== "over") {
        if (roof.heliSide && roof.heli?.root.visible !== false) {
          const ladder = roof.ladderReady ? roof.ladderPoint(0, new THREE.Vector3()) : (roof.heli?.root.position.clone() ?? roof.holdPoint);
          markers.push(this._marker(p, ladder, roof.ladderReady ? "ladder" : "heli"));
        }
        if (["alive", "ladder", "leap", "down"].includes(rival.state)) markers.push(this._marker(p, _v.copy(rival.position).setY(rival.position.y + 1.2).clone(), "rival", rival));
      }
      let prompt = null;
      if (this.phase === "fight") {
        if (p.state === "alive" && !this.ladderOwner && roof.canReachLadder(p.position)) prompt = { action: "jump", text: "JUMP FOR THE LADDER" };
        else if (p.state === "ladder") prompt = { action: "jump", text: p.ladder.iced > 0 ? "HANDS FROZEN" : "MASH TO CLIMB", mash: true };
        else if (rival.state === "ladder" && p.state === "alive") prompt = { action: null, text: `${rival.team.label} IS CLIMBING // SHOCK THEM OFF`, alert: true };
        else if (roof.ladderReady && p.state === "alive") prompt = { action: null, text: `GET TO THE ${roof.heliSide < 0 ? "WEST" : "EAST"} LEDGE` };
      }
      return {
        index: p.index, label: p.team.label, name: p.team.name, device: this.input.describe(p.device), deviceId: p.device,
        integrity: p.integrity, spheres: p.spheres, ball: p.arsenal.ball, cost: p.arsenal.cost(), serums: p.arsenal.list(),
        state: p.state, respawnIn: p.respawnIn, stun: p.stun, frozen: p.frozen, iced: p.ladder.iced,
        roundsWon: p.stats.roundsWon, kills: p.stats.kills, roundKills: p.stats.roundKills, feed: p.feed,
        reticle: p.reticle, hot: p.hot, markers, prompt, view: views[p.index] ?? null,
      };
    });
    const owner = this.ladderOwner;
    return {
      phase: this.phase, phaseT: this.phaseT, round: this.round, wins: this.wins, fade: this.fade, layout: this.split.layout,
      players,
      heli: { eta: roof.heliETA, side: roof.heliSide, arrived: s.heliArrived, ready: roof.ladderReady, inbound: Boolean(roof.heliSide) && !s.heliArrived, flight: HELI_FLIGHT },
      ladder: owner && (owner.state === "ladder" || owner.state === "leap") ? { owner: owner.index, progress: owner.ladder.h / CLIMB_HEIGHT, iced: owner.ladder.iced > 0 } : null,
    };
  }

  /** A point on a player's screen: where to draw its marker, or an arrow at the edge if it is off. */
  _marker(p, point, kind, who = null) {
    const camera = p.camera;
    const distance = Math.round(_b.copy(point).setY(0).distanceTo(_a.copy(p.position).setY(0)));
    _w.copy(point).project(camera);
    let x = _w.x;
    let y = _w.y;
    const behind = _w.z > 1;
    if (behind) { x = -x; y = -y; }
    const on = !behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.9;
    if (!on) {
      const k = 1 / Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.82, 1e-6);
      x *= k;
      y *= k;
    }
    return { kind, on, x: (x + 1) / 2, y: (1 - y) / 2, angle: Math.atan2(-y, x), distance, label: who?.team.label ?? null, team: who?.index ?? null };
  }

  _event(name, payload = {}) {
    this.events.push({ name, t: this.clock, ...payload });
    if (this.events.length > 200) this.events.shift();
  }

  /** A debug view of the match (the checks read it). */
  snapshot() {
    const s = this.roof.state;
    return {
      phase: this.phase, round: this.round, wins: this.wins, layout: this.split.layout, paused: this.paused,
      heli: { eta: +this.roof.heliETA.toFixed(2), side: this.roof.heliSide, arrived: s.heliArrived, ready: this.roof.ladderReady, ending: s.ending },
      ladder: this.ladderOwner ? { owner: this.ladderOwner.index, h: +this.ladderOwner.ladder.h.toFixed(2) } : null,
      enemies: this.roof.enemiesAlive,
      players: this.players.map((p) => ({
        device: p.device, state: p.state, x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2),
        integrity: p.integrity, spheres: p.spheres, ball: p.arsenal.ball, ladder: +p.ladder.h.toFixed(2), stats: { ...p.stats },
      })),
      views: this.split.lastViews,
      events: this.events.map((e) => e.name),
    };
  }

  dispose() {
    for (const p of this.players) p.dispose();
    this.projectiles.dispose();
    this.shatter.dispose();
    this.impact.dispose();
    this.roof.dispose();
    this.split.dispose();
    this.envTexture.dispose();
    THERMAL_HEAT.value = 0;
    this.scene.clear();
  }
}
