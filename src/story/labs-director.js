/**
 * The story in the Labs (Phase 4, docs/story-phases-plan.md): MeltdownGame
 * builds one of these in a story run (mode "corridor" with `setStory`) and
 * calls it at a few points; without it the Labs play exactly as before.
 *
 *   4a  the breach      after the arrival lift: the incubators along the
 *                       ward burst, the patients spill out, Vale on a wall
 *                       monitor, "Go!"
 *   4b  Okoro runs      ahead on a free lane, never in your lane close to
 *                       you; his pistol cracks at patients in the side lanes
 *                       (cosmetic: it never breaks anything or changes a stat)
 *   4c  the bend        a patient jumps you at the first turn; mash to hold
 *                       it off until he shoots it
 *   4d  the desk        instead of running into the lift: the crowd, the
 *                       desk, the bag, his sacrifice (heard, not seen)
 *
 * The story layer's CutscenePlayer drives the Labs' camera during each
 * scene (the host keeps calling `story.update`); MeltdownGame sits in its
 * "story" phase meanwhile, with the clock and the fire held.
 */

import * as THREE from "../three.js";
import { Companion } from "./companion.js";
import { FoundryGuide } from "./foundry-guide.js";
import { breachScene, bendScene, hideScene } from "./scenes-labs.js";
import { BEATS, LANES } from "../levels/meltdown/index.js";
import { loadMeltdownAssets } from "../levels/meltdown/assets.js";

/** Incubators along the ward wall, just out of the lift: [route distance, side]. */
const INCUBATORS = [[8, -1], [11, 1], [17, -1], [18, 1], [21.5, -1], [25, 1]];
const INCUBATOR_LATERAL = 5.7;
/** Where Vale's monitor hangs: route distance, side, height. */
const MONITOR = { d: 13, side: -1, height: 3.7, width: 2.6, aspect: 16 / 9, lateral: 5.85 };
/** The bend attack: just before the first turn (the end of the ward). */
const BEND_AT = BEATS[0].end - 7;
/** Patients crowding the landing in front of the lift. */
const CROWD = 7;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * Okoro's pistol: a compact service pistol, built to scale (~19 cm long).
 * Its origin is the grip, where the hand closes; the barrel points down -Z.
 * A blued steel slide with rear serrations and sights over a dark polymer
 * frame: dust cover, trigger guard and trigger, a stippled grip with a
 * beavertail and the magazine's base plate; a muzzle flash with its light.
 */
function buildPistol() {
  const group = new THREE.Group();
  group.name = "Pistol";
  // (Lighter than real blued steel: dark-on-dark it didn't read as a gun at all.)
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.8, roughness: 0.3 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.15, roughness: 0.6 });
  const stipple = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.95 });
  const bore = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  const dot = new THREE.MeshBasicMaterial({ color: 0x9dffb0 });
  const box = (w, h, d, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    group.add(m);
    return m;
  };
  // The slide, its front chamfer, the ejection port, the serrations at the back.
  box(0.028, 0.032, 0.188, steel, 0, 0.052, -0.058);
  box(0.024, 0.02, 0.02, steel, 0, 0.046, -0.158, 0.5);
  box(0.029, 0.008, 0.04, bore, 0.0005, 0.065, -0.035);
  for (let i = 0; i < 6; i += 1) box(0.0295, 0.026, 0.003, polymer, 0, 0.052, 0.012 + i * 0.0055);
  // Sights: the rear notch, the front post, three dots.
  box(0.024, 0.008, 0.008, steel, 0, 0.072, 0.03);
  box(0.004, 0.008, 0.006, steel, 0, 0.072, -0.145);
  for (const [x, z] of [[-0.007, 0.03], [0.007, 0.03], [0, -0.145]]) box(0.002, 0.002, 0.002, dot, x, 0.077, z);
  // The barrel's muzzle under the slide's nose.
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 12), steel);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.05, -0.155);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0045, 12), bore);
  hole.position.set(0, 0.05, -0.1615);
  hole.rotation.y = Math.PI;
  group.add(muzzle, hole);
  // The frame: dust cover under the slide, the rail, the trigger guard.
  box(0.026, 0.016, 0.12, polymer, 0, 0.028, -0.07);
  box(0.02, 0.004, 0.06, steel, 0, 0.019, -0.095);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0035, 6, 16, Math.PI * 1.1), polymer);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, 0.012, -0.03);
  group.add(guard);
  box(0.005, 0.02, 0.006, steel, 0, 0.004, -0.027, 0.3);
  // The grip: raked back, stippled panels either side, a beavertail over the hand.
  box(0.026, 0.1, 0.045, polymer, 0, -0.028, 0.012, 0.28);
  for (const x of [-0.0135, 0.0135]) box(0.002, 0.07, 0.034, stipple, x, -0.03, 0.013, 0.28);
  box(0.024, 0.008, 0.024, polymer, 0, 0.022, 0.04, -0.4);
  box(0.03, 0.01, 0.05, polymer, 0, -0.077, 0.027, 0.28);
  // Muzzle flash: two crossed additive stars and a quick light, a frame or two.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  for (const r of [0, Math.PI / 2]) {
    const star = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    star.rotation.y = r;
    flash.add(star);
  }
  flash.position.set(0, 0.05, -0.27);
  const light = new THREE.PointLight(0xffb86a, 0, 6, 2);
  light.position.set(0, 0.05, -0.2);
  group.add(flash, light);
  group.userData.flash = flash;
  group.userData.flashMaterial = flashMat;
  group.userData.light = light;
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  // A little over life size: at game distance a real one was a few dark specks.
  group.scale.setScalar(1.35);
  return group;
}

export class LabsDirector {
  /**
   * @param {import("../levels/meltdown/game.js").MeltdownGame} game
   * @param {object} story  { layer, okoroTemplate, valeTemplate: () => template|null, assetBase }
   */
  constructor(game, story) {
    this.game = game;
    this.layer = story.layer;
    this.story = story;
    this.level = game.level;
    this.root = new THREE.Group();
    this.root.name = "LabsStory";
    game.scene.add(this.root);
    this.owned = [];
    this.log = [];
    this.stage = "arrive"; // arrive | breach | run | bend | hide | gone
    this.bendDone = this.layer.hasSeen("bendAttack");
    this.flash = 0;
    this.shotTimer = 2.5;

    // Okoro, with his bag and a pistol.
    this.okoro = new Companion({ bag: true });
    this.okoro.setModel(story.okoroTemplate);
    this.root.add(this.okoro.root);
    // Unseen until he is first placed and posed (a frame drawn before that
    // showed him out in the corridor, arms out in his rest pose).
    this.okoro.root.visible = false;
    this.pistol = buildPistol();
    // In his right hand, kept upright (not rolled round the forearm).
    // Pointing ahead of him, a little down (low ready), in his hand whatever his arm does.
    this.okoro.hold(this.pistol, { hand: "R", offset: [0, 0.03, 0], facing: 0.35, fist: true });
    this.guide = new FoundryGuide({
      okoro: this.okoro,
      level: this.level,
      lines: [],
      talk: false,
      options: { lead: { min: 6.5, max: 10, rest: 8, talk: 7, handoff: 7 }, blocked: "vault", avoidPlayerWithin: 6.5 },
    });

    this._buildIncubators();
    this._buildMonitor();
  }

  /* ---- Building ---------------------------------------------------- */

  _buildIncubators() {
    const kit = this.level.kit;
    this.tanks = INCUBATORS.map(([d, side], i) => {
      const tank = kit.specimenTank({ seed: 40 + i, occupied: false, broken: false });
      this.level._add(this.level.groups.shell, tank, d, side * INCUBATOR_LATERAL);
      const glass = [];
      tank.traverse((o) => {
        if (o.isMesh && o.material?.transparent) glass.push(o);
      });
      // The patient inside, on the tank's base, head bowed.
      const patient = new Companion({ coat: 0x8fb7c4 });
      tank.updateMatrixWorld(true);
      tank.localToWorld(patient.root.position.set(0, 0.36, 0));
      // Facing out into the corridor.
      patient.root.rotation.y = tank.rotation.y + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      patient.adjust.headNod = 0.7;
      patient.shadow.visible = false;
      this.root.add(patient.root);
      return { tank, glass, patient, d, side, burst: false, walk: 0 };
    });
  }

  _buildMonitor() {
    const level = this.level;
    const rt = new THREE.WebGLRenderTarget(512, 288);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.monitorRT = rt;
    this.owned.push(rt);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x0a1012 });
    this.owned.push(screenMat);
    this.screenMat = screenMat;
    const w = MONITOR.width;
    const h = w / MONITOR.aspect;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1d1f, metalness: 0.6, roughness: 0.5 }));
    this.owned.push(screen.geometry, frame.geometry, frame.material);
    frame.position.z = -0.06;
    const monitor = new THREE.Group();
    monitor.add(frame, screen);
    // Out from the wall's face, on a bracket.
    const s = level.route.sample(MONITOR.d, MONITOR.side * MONITOR.lateral, MONITOR.height);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.3), new THREE.MeshStandardMaterial({ color: 0x2a2e30, metalness: 0.6, roughness: 0.5 }));
    this.owned.push(bracket.geometry, bracket.material);
    bracket.position.z = -0.7;
    monitor.add(bracket);
    monitor.position.copy(s.position);
    // Face across the corridor (toward the other wall).
    monitor.rotation.y = s.heading + (MONITOR.side < 0 ? Math.PI / 2 : -Math.PI / 2);
    this.root.add(monitor);
    this.monitor = monitor;
    this.monitorOn = false;

    // The little scene on the other end: Vale, head and shoulders.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x140808);
    scene.add(new THREE.HemisphereLight(0xc8d0e0, 0x201010, 1.2));
    const key = new THREE.DirectionalLight(0xff8870, 2.2);
    key.position.set(1, 2, 2);
    scene.add(key);
    const vale = new Companion();
    scene.add(vale.root);
    vale.root.rotation.y = Math.PI; // facing the camera (+Z)
    this.vale = vale;
    this.valeScene = scene;
    this.valeCamera = new THREE.PerspectiveCamera(26, MONITOR.aspect, 0.05, 20);
    this.valeCamera.position.set(0, 1.62, 1.55);
    this.valeCamera.lookAt(0, 1.56, 0);
  }

  /** Models are in (or as in as they will get). */
  async onAssets() {
    const assets = await loadMeltdownAssets(this.story.assetBase, { names: ["patient", "officeDesk"] });
    if (this.disposed) return;
    this.assets = assets;
    const patient = assets.get("patient")?.template;
    if (patient) for (const t of this.tanks) t.patient.setModel(patient);
    const vale = this.story.valeTemplate?.();
    if (vale) this.vale.setModel(vale);
  }

  /* ---- 4a: the arrival and the breach -------------------------------- */

  /** During the arrival lift: Okoro steps out of it beside you. */
  updateArrival(cut, dt) {
    if (!cut) return;
    const o = this.okoro;
    o.root.visible = true;
    _v.set(-Math.cos(cut.playerYaw), 0, Math.sin(cut.playerYaw)); // the player's left
    o.root.position.copy(cut.player).addScaledVector(_v, 1.3);
    o.root.rotation.y = cut.playerYaw;
    const running = cut.action === "run";
    o.act(running ? "run" : "idle");
    o.update(dt, { speed: running ? cut.speed ?? 6 : 0 });
    this._idlePatients(dt);
  }

  /** The arrival is over: play the breach (true), or straight to the run (false). */
  afterArrival() {
    if (this.layer.hasSeen("breach")) {
      this._startRun(this.game.runner.distance);
      return false;
    }
    this.stage = "breach";
    this.okoro.root.visible = true;
    const game = this.game;
    const route = this.level.route;
    const r = game.runner;
    const d = Math.max(2, r.distance + 2);
    r.distance = d;
    this.okoro.root.position.copy(route.sample(d + 0.8, -1.4).position);
    this.okoro.root.rotation.y = route.sample(d).heading;
    const eye = route.sample(d, r.lateral, 1.65).position.clone();
    const ahead = route.sample(d + 14, 0, 1.5).position.clone();
    const tanks = this.tanks.map((t) => {
      t.tank.updateMatrixWorld(true);
      return t.tank.localToWorld(new THREE.Vector3(0, 1.5, 0));
    });
    const monitor = this.monitor.getWorldPosition(new THREE.Vector3());
    const scene = breachScene({
      from: { pos: game.camera.position.clone(), look: game._v.smoothedLook.clone() },
      eye,
      ahead,
      tanks,
      monitor,
      okoro: this.okoro,
      chase: () => this._chasePose(d),
    });
    game.avatar.setVisible(false);
    game.avatar.shadow.visible = false;
    this.layer.play(scene, {
      camera: game.camera,
      on: {
        event: (name, data) => this._breachEvent(name, data),
        done: () => this._startRun(d),
      },
    });
    return true;
  }

  _breachEvent(name, data) {
    const game = this.game;
    this.log.push(["event", name, data?.index ?? null]);
    if (name === "alarm") game.audio.stinger?.();
    else if (name === "burst") this._burst(this.tanks[data.index]);
    else if (name === "monitor-on") {
      this.monitorOn = true;
      this.screenMat.map = this.monitorRT.texture;
      this.screenMat.color.set(0xffffff);
      this.screenMat.needsUpdate = true;
      this.vale.act("talk");
    } else if (name === "monitor-off") {
      this.monitorOn = false;
      this.screenMat.map = null;
      this.screenMat.color.set(0x0a1012);
      this.screenMat.needsUpdate = true;
    }
  }

  /** An incubator bursts: the glass goes, its patient staggers out and away. */
  _burst(t) {
    if (!t || t.burst) return;
    t.burst = true;
    const game = this.game;
    for (const g of t.glass) g.visible = false;
    t.tank.updateMatrixWorld(true);
    const at = t.tank.localToWorld(new THREE.Vector3(0, 1.4, 0));
    game._chunks(at, 34, { tint: 0x9dffc8, speed: 4.8, radius: 0.9, size: 0.12 });
    game.debris.burst(at, { kind: "glass", count: 24, speed: 5 });
    game.audio.glassShatter(true);
    game.sfx?.glassBreak();
    // And what was inside, awake.
    game._patientSound?.(this.tanks.indexOf(t) % 2 ? "growl" : "shriek", at, 0.85);
    game.trauma = Math.min(1, game.trauma + 0.25);
    t.walk = 0.001;
    this.log.push(["burst", this.tanks.indexOf(t)]);
  }

  _idlePatients(dt) {
    const at = this.game.runner.distance;
    for (const t of this.tanks) {
      const p = t.patient;
      if (!p.root.visible) continue;
      // Out of sight: not worth animating.
      if (!t.walk && Math.abs(t.d - at) > 60) continue;
      if (t.walk > 0) {
        // Out of the tank, then away down the corridor along the wall,
        // lurching - into the dark ahead, where they'll be waiting.
        t.walk += dt;
        const route = this.level.route;
        const d = t.d + Math.max(0, t.walk - 0.6) * 1.6;
        const s = route.sample(d, t.side * (INCUBATOR_LATERAL - 0.2 + Math.min(1, t.walk) * 0.6));
        p.root.position.lerp(s.position, Math.min(1, dt * 3));
        p.root.rotation.y = s.heading;
        p.act("walk");
        p.speed = 1.6;
        p.adjust.headNod = 0.35;
        p.adjust.lean = 0.25 + Math.sin(t.walk * 3.1) * 0.1;
        p.adjust.aimR = 0.35;
        p.adjust.aimL = 0.25;
        if (t.walk > 9) p.root.visible = false;
      } else {
        p.act("idle");
      }
      p.update(dt);
    }
  }

  /* ---- 4b: Okoro runs with you --------------------------------------- */

  _startRun(d) {
    this.stage = "run";
    this.okoro.root.visible = true;
    this.game.snapCamera = true;
    this.guide.start(d, { lateral: -3.2 });
    this.okoro.act("run");
  }

  /** The run's chase camera at route distance d (game.js's CHASE rig). */
  _chasePose(d) {
    const route = this.level.route;
    const r = this.game.runner;
    const speed = this.level.speedAt(d);
    const back = 6.4 + speed * 0.05;
    return {
      pos: route.sample(d - back, r.lateral * 0.62, 2.8).position.clone(),
      look: route.sample(d + 12, r.lateral * 0.3, 1.6).position.clone(),
    };
  }

  /**
   * Every frame of the run (phase "run"). Returns true when a scene took
   * over (the host switches to its "story" phase).
   */
  updateRun(dt, time) {
    const game = this.game;
    const r = game.runner;
    this._idlePatients(dt);
    if (this.stage !== "run") return false;
    const lane = LANES.indexOf(LANES.reduce((a, b) => (Math.abs(b - r.lateral) < Math.abs(a - r.lateral) ? b : a)));
    this.guide.update(dt, { distance: r.distance, speed: r.speed, lane, playerLateral: r.lateral });
    this.okoro.update(dt, { speed: this.guide.gaitSpeed });
    this._pistol(dt, time);
    // 4c: the bend - on the ground, not mid-jump or mid-slide.
    if (!this.bendDone && r.distance >= BEND_AT && r.height <= 0.001 && r.sliding <= 0) {
      this._startBend();
      return true;
    }
    return false;
  }

  /** Now and then he fires at a patient in a side lane ahead. Cosmetic only. */
  _pistol(dt) {
    const flash = this.pistol.userData.flash;
    this.flash = Math.max(0, this.flash - dt * 12);
    this.pistol.userData.flashMaterial.opacity = this.flash;
    flash.rotation.z += 1.7;
    this.pistol.userData.light.intensity = this.flash * 6;
    this.shotTimer -= dt;
    const o = this.okoro;
    if (this.aimTimer > 0) {
      // Up into a two-handed grip, the left hand under the right.
      this.aimTimer -= dt;
      o.adjust.aimR = 1;
      o.adjust.aimL = Math.max(o.adjust.aimL, 0.85);
    } else {
      // Low ready on the run: the pistol forward and down, not swinging.
      o.adjust.aimR += (0.4 - o.adjust.aimR) * Math.min(1, dt * 6);
      o.adjust.aimR = Math.max(o.adjust.aimR, 0.38);
    }
    if (this.shotTimer > 0) return;
    const r = this.game.runner;
    const target = this.level._lurchers?.find((e) => {
      const ahead = e.distance - this.guide.d;
      // Only side lanes - never the one you're in: your targets stay yours.
      return ahead > 2 && ahead < 24 && Math.abs((e.group.userData.lane ?? 0) - r.lateral) > 1.5 && e.group.userData.state?.() !== "down";
    });
    // Nobody to shoot: look again in a moment.
    this.shotTimer = target ? 1.4 + Math.random() * 1.2 : 0.25;
    if (!target) return;
    this.aimTimer = 0.45;
    this.flash = 1;
    o.lookAt(target.group.userData.worldPosition().setY(1.5), 1);
    // His pistol, and the patient it hits.
    this.game.sfx?.play("pistol", { volume: 0.55, cooldown: 0.3 });
    this.game.audio.thud?.();
    this.game.sfx?.impact(0.25);
    this.game._patientSound?.("pain", target.group.userData.worldPosition(), 0.8);
    // The patient staggers (and is still there - the player's to deal with).
    target.group.userData.stagger?.();
    this.log.push(["pistol", Math.round(target.distance)]);
  }

  /* ---- 4c: the bend attack ------------------------------------------- */

  _startBend() {
    this.stage = "bend";
    this.bendDone = true;
    const game = this.game;
    const route = this.level.route;
    const r = game.runner;
    const d = r.distance;
    const s = route.sample(d, r.lateral, 1.65);
    const eye = s.position.clone();
    const forward = new THREE.Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading));
    // The first turn is to the left: its blind side is the left.
    const side = new THREE.Vector3(-Math.cos(s.heading), 0, Math.sin(s.heading));
    const patient = new Companion({ coat: 0x8fb7c4 });
    const template = this.assets?.get("patient")?.template;
    if (template) patient.setModel(template);
    this.root.add(patient.root);
    this.bendPatient = patient;
    // Okoro: a few metres ahead, turning back.
    this.okoro.root.position.copy(route.sample(d + 5, r.lateral < 0 ? 3.2 : -3.2).position);
    _v.copy(eye).setY(0).sub(this.okoro.root.position);
    this.okoro.root.rotation.y = Math.atan2(-_v.x, -_v.z);
    game.avatar.setVisible(false);
    game.avatar.shadow.visible = false;
    const reactions = this.layer.reactions;
    const scene = bendScene({
      eye, forward, side, patient, okoro: this.okoro,
      struggle: () => (reactions.running && reactions._s?.bar !== undefined ? reactions._s.bar : 1),
      chase: () => this._chasePose(d),
    });
    this.layer.play(scene, {
      camera: game.camera,
      // A miss: it wins - pinned, it comes down on you (_bendDeath), claws across the screen.
      deathSeconds: 2.2,
      deathFx: "mauled",
      on: {
        event: (name) => {
          this.log.push(["event", name]);
          if (name === "hit") {
            game._patientSound?.("shriek", null, 1.3);
            game.audio.stumble?.();
            game.sfx?.hurt(1.2);
            game.trauma = 1;
          } else if (name === "shot") {
            this.flash = 1;
            this.aimTimer = 0.4;
            game.audio.thud?.();
            game.sfx?.impact(0.9);
            game.audio.bodyFall?.();
            game._patientSound?.("death", null, 1);
          }
        },
        // It wins: one chance, as with the roof's flying patients - the
        // death plays out (_bendDeath: it comes down on you), then the run is
        // over. (It used to cost 30 and come round again, and when that 30
        // was the last of you the run stuck: stopped mid-death, then retried.)
        fail: () => {
          r.vitality = 0;
          game.hitFlash = 1;
          game.hud.flashDamage();
          this.log.push(["struggle-fail", r.vitality]);
          return "over";
        },
        over: () => {
          this._endScene();
          r.alive = false;
          game._finishRun(false, "THEY GOT YOU");
        },
        done: () => {
          patient.root.visible = false;
          this._endScene();
          // (Then 3, 2, 1, as after every cutscene: main.js watchCutscenes.)
          this._startRun(d);
        },
      },
    });
  }

  _endScene() {
    const game = this.game;
    if (game.phase === "story") game.phase = "run";
    game.snapCamera = true;
  }

  /* ---- 4d/4e: the desk, the sacrifice, the lift ---------------------- */

  /** The end of the corridor: this replaces running into the lift. */
  onComplete() {
    if (this.stage === "hide" || this.stage === "gone") return true;
    this.stage = "hide";
    const game = this.game;
    const level = this.level;
    const route = level.route;
    const r = game.runner;
    const total = route.totalLength;
    const end = route.sample(total - 1);
    const E = end.position.clone();
    const fwd = new THREE.Vector3(-Math.sin(end.heading), 0, -Math.cos(end.heading));
    const right = new THREE.Vector3(Math.cos(end.heading), 0, -Math.sin(end.heading));
    const lift = level.endLift;
    lift.root.updateMatrixWorld(true);
    const liftCentre = lift.root.getWorldPosition(new THREE.Vector3());
    const doors = liftCentre.clone().addScaledVector(fwd, -3.6).setY(1.5);

    // The desk, on its side of the corridor end; you and Okoro behind it.
    const deskAt = E.clone().addScaledVector(fwd, -3).addScaledVector(right, 1.0);
    const desk = this._desk();
    desk.position.copy(deskAt);
    desk.rotation.y = end.heading;
    this.root.add(desk);
    const deskEye = deskAt.clone().addScaledVector(fwd, -1.3).addScaledVector(right, 0.55).setY(0.95);
    const o = this.okoro;
    o.root.position.copy(deskAt).addScaledVector(fwd, -1.25).addScaledVector(right, -0.6).setY(0);
    _v.copy(deskEye).setY(0).sub(o.root.position);
    o.root.rotation.y = Math.atan2(-_v.x, -_v.z);
    o.adjust.aimR = 0;
    this.pistol.visible = true;

    // The crowd, between the corridor and the lift.
    const template = this.assets?.get("patient")?.template;
    this.crowd = [];
    for (let i = 0; i < CROWD; i += 1) {
      const p = new Companion({ coat: 0x8fb7c4 });
      if (template) p.setModel(template);
      const lateral = (i / (CROWD - 1) - 0.5) * 9 + Math.sin(i * 7.3) * 0.6;
      p.root.position.copy(E).addScaledVector(fwd, 3.5 + (i % 3) * 1.6).addScaledVector(right, lateral);
      _v.copy(E).sub(p.root.position).setY(0);
      p.root.rotation.y = Math.atan2(-_v.x, -_v.z) + Math.sin(i * 3.1) * 0.5;
      p.adjust.headNod = 0.4;
      p.adjust.lean = 0.2;
      p.act("idle");
      this.root.add(p.root);
      this.crowd.push({ p, phase: i * 0.7, chasing: false });
    }
    const crowdCentre = E.clone().addScaledVector(fwd, 5.5).setY(1.2);
    const runTo = E.clone().addScaledVector(fwd, 4).addScaledVector(right, -12).setY(1.2);
    const runPath = [
      deskEye.clone().setY(0),
      E.clone().addScaledVector(right, 4.6).addScaledVector(fwd, 1.5),
      liftCentre.clone().addScaledVector(fwd, -2.2).addScaledVector(right, 1.2),
      liftCentre.clone().addScaledVector(right, 0.6).addScaledVector(fwd, 0.6),
    ];
    this.hide = { E, fwd, right, runTo, liftCentre, doors, okoroRunning: false };

    // Hold the run: the fire, the clock, and the level's own lift.
    level._departure = { story: true };
    r.finished = true;
    r.firing = false;
    game.phase = "story";
    game.avatar.setVisible(false);
    game.avatar.shadow.visible = false;
    game.hud.setPrompt(null);
    const scene = hideScene({
      standEye: game.camera.position.clone().lerp(route.sample(total - 3, r.lateral, 1.65).position, 1),
      crowdCentre,
      deskEye,
      runTo,
      runPath,
      doors,
      okoro: o,
    });
    this.layer.play(scene, {
      camera: game.camera,
      on: {
        event: (name) => this._hideEvent(name),
        // The doors are shut on him: the quiet ride up (src/elevators/quiet-ride.js) takes it from here.
        done: () => {
          this.stage = "gone";
          game._corridorDone();
        },
      },
    });
    return true;
  }

  _desk() {
    const asset = this.assets?.get("officeDesk");
    const group = new THREE.Group();
    if (asset) {
      const model = asset.template.clone(true);
      const s = 1.9 / Math.max(asset.size.x, asset.size.z);
      model.scale.setScalar(s);
      if (asset.size.z > asset.size.x) model.rotation.y = Math.PI / 2;
      group.add(model);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a6266, metalness: 0.5, roughness: 0.5 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.85), mat);
      top.position.y = 0.76;
      const front = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 0.04), mat);
      front.position.set(0, 0.4, -0.4);
      group.add(top, front);
      this.owned.push(top.geometry, front.geometry, mat);
    }
    return group;
  }

  _hideEvent(name) {
    const game = this.game;
    this.log.push(["event", name]);
    if (name === "crowd-turn") game._patientSound?.("growl", null, 0.9);
    else if (name === "bag") {
      // Into your hands: his bag is gone from him; the HUD says you have it.
      if (this.okoro.bag) this.okoro.bag.visible = false;
      game.storyBag = true;
      game.hud.toast("DR. OKORO'S BAG", "EVERYTHING HE FOUND", "power", 3200);
      game.sfx?.sphereCollected();
    } else if (name === "okoro-run") {
      this.hide.okoroRunning = true;
      for (const c of this.crowd) c.chasing = true;
      // All of them, after him.
      game._patientSound?.("horde", null, 1.1);
    } else if (name === "doors") {
      // The doors close on it.
      this._doors = 0;
      game.audio.clang?.();
      game.sfx?.play("clank");
    } else if (name === "silence") {
      // His death is heard, not seen: the shouting cuts off.
      game.audio.bodyFall?.();
      this.okoro.root.visible = false;
      for (const c of this.crowd) c.p.root.visible = false;
    }
  }

  /** Every frame of the "story" phase: the people in the scene. */
  updateScene(dt) {
    this._idlePatients(dt);
    const o = this.okoro;
    if (this.stage === "breach" || this.stage === "bend") {
      o.update(dt);
      this.bendPatient?.update(dt);
      this.vale.update(dt);
      if (this.stage === "bend") this._pistol(dt);
      const dying = this.stage === "bend" ? this.layer.deathTime : 0;
      if (dying > 0) this._bendDeath(dying);
      else this._bendDeathFrom = null;
    } else if (this.stage === "hide") {
      this._updateHide(dt);
    }
    if (this._doors !== undefined && this._doors < 1) {
      this._doors = Math.min(1, this._doors + dt / 0.9);
      this.level.endLift.setDoorsOpen(1 - this._doors);
    }
  }

  /**
   * The struggle lost: it gets through. The view sinks to the floor and
   * rolls as it comes down onto you, its face filling the frame (the scene
   * itself is held while the story layer plays the death - this moves the
   * camera and the patient over it; a retry puts both back).
   */
  _bendDeath(t) {
    const game = this.game;
    const cam = game.camera;
    const p = this.bendPatient;
    if (!p) return;
    if (!this._bendDeathFrom) {
      this._bendDeathFrom = { pos: cam.position.clone(), patient: p.root.position.clone() };
      game._patientSound?.("roar", null, 1.3);
      game.sfx?.hurt(1.3);
      game.trauma = 1;
    }
    const from = this._bendDeathFrom;
    const k = THREE.MathUtils.smoothstep(t, 0, 0.9);
    // It comes down: most of the way onto where you lie.
    p.root.position.lerpVectors(from.patient, _w.copy(from.pos).setY(0), 0.55 * k);
    Object.assign(p.adjust, { lean: 0.45 + 0.35 * k, aimR: 1, aimL: 1, headNod: 0.35 * k });
    // Pinned: lower, shaking, rolled over, looking up into its face.
    cam.position.copy(from.pos);
    cam.position.y -= 0.45 * k;
    const shake = 0.05 * (1 - 0.6 * k);
    cam.position.x += (Math.random() - 0.5) * shake;
    cam.position.z += (Math.random() - 0.5) * shake;
    cam.lookAt(p.headPosition(_v));
    cam.rotateZ(0.45 + 0.5 * k);
  }

  _updateHide(dt) {
    const h = this.hide;
    if (!h) return;
    const o = this.okoro;
    if (h.okoroRunning && o.root.visible) {
      // Left, shouting, off along the landing.
      _v.copy(h.runTo).setY(0).sub(o.root.position);
      const left = _v.length();
      if (left > 0.3) {
        o.root.position.addScaledVector(_v.normalize(), Math.min(left, 6.5 * dt));
        o.root.rotation.y = Math.atan2(-_v.x, -_v.z);
        o.act("run");
        o.adjust.aimL = 0.6;
        o.update(dt, { speed: 6.5 });
      } else {
        o.act("wave");
        o.update(dt);
      }
    } else o.update(dt);
    for (const c of this.crowd ?? []) {
      const p = c.p;
      if (c.chasing && o.root.visible) {
        _v.copy(o.root.position).sub(p.root.position).setY(0);
        const dist = _v.length();
        if (dist > 1.2) {
          p.root.position.addScaledVector(_v.normalize(), Math.min(dist, 4.2 * dt));
          p.root.rotation.y = Math.atan2(-_v.x, -_v.z);
        }
        p.act("run");
        p.adjust.aimR = p.adjust.aimL = 0.8;
        p.update(dt, { speed: 4.2 });
      } else {
        // Swaying where they stand.
        c.phase += dt;
        p.adjust.lean = 0.2 + Math.sin(c.phase * 1.7) * 0.08;
        p.update(dt);
      }
    }
  }

  /** Render Vale's monitor before the Labs' frame. */
  beforeRender(renderer) {
    if (!this.monitorOn) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.monitorRT);
    renderer.render(this.valeScene, this.valeCamera);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.disposed = true;
    if (this.layer.sceneId && ["breach", "bendAttack", "hide"].includes(this.layer.sceneId)) this.layer.stop();
    this.okoro.dispose();
    for (const t of this.tanks) t.patient.dispose();
    for (const c of this.crowd ?? []) c.p.dispose();
    this.bendPatient?.dispose();
    this.vale.dispose();
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
  }
}
