/**
 * Standalone preview harness for Level 3 - The Meltdown (Phase A).
 *
 * Scaffolding around the real level (src/levels/meltdown/) and HUD
 * (src/ui/meltdown-hud.js): the runner's movement rules, four camera rigs,
 * the launcher, and the player-side rules (vitality, balls, overheat,
 * power-ups). Everything meant to outlive the preview - the player body,
 * projectiles, debris, the launcher's light, the grading pass, audio - lives
 * in src/ already; this file wires them together.
 *
 * Phase B (the roof) runs in the same page: finishing Phase A fades to black,
 * hides the corridor, and brings up `RoofLevel` - or press P to skip there.
 *
 * Serve the repository over HTTP and open /preview/meltdown.html.
 */

import * as THREE from "../src/three.js";
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment } from "../src/three-addons.js";
import { MeltdownLevel, BEATS, LANES } from "../src/levels/meltdown/index.js";
import { Projectiles, Debris } from "../src/levels/meltdown/effects.js";
import { loadMeltdownAssets } from "../src/levels/meltdown/assets.js";
import { PlayerAvatar } from "../src/levels/meltdown/player.js";
import { LauncherLight } from "../src/levels/meltdown/flashlight.js";
import { createGradePass } from "../src/levels/meltdown/post.js";
import { createEnvironmentDimmer } from "../src/levels/meltdown/lighting.js";
import { RoofLevel, ROOF_SPAWN } from "../src/levels/meltdown/roof.js";
import { createCreditsPanel } from "../src/levels/meltdown/credits.js";
import { MeltdownHud } from "../src/ui/meltdown-hud.js";
import { MeltdownAudio } from "../src/audio/meltdown-audio.js";

/* ------------------------------------------------------------------ */
/* Renderer, scene, post-processing                                     */
/* ------------------------------------------------------------------ */

const canvas = document.querySelector("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
// Level 2 measured this game as fill-rate bound: cap the pixel ratio.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const BASE_EXPOSURE = 0.95;
renderer.toneMappingExposure = BASE_EXPOSURE;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG_CALM = new THREE.Color(0x1a120d);
const FOG_DANGER = new THREE.Color(0x2a0804);
// In the dark beat the fog is smoke with nothing lighting it.
const FOG_DARK = new THREE.Color(0x050404);
scene.background = FOG_CALM.clone();
scene.fog = new THREE.FogExp2(FOG_CALM.clone(), 0.012);
// A pre-filtered environment for reflections. Without one, every metallic
// PBR surface - steel walls, the imported props, the launcher - renders
// close to black, because metal only shows what it reflects.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
pmrem.dispose();

const BASE_FOV = 72;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 320);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Bloom sells fire, lasers and emissive glass; at half resolution, because
// a full-res bloom chain would double the fill-rate cost. The grading pass
// (heat haze, hit split, vignette, grain) runs last, in display space.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.6, 0.45, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = createGradePass();
grade.uniforms.uResolution.value.set(innerWidth, innerHeight);
composer.addPass(grade);

/* ------------------------------------------------------------------ */
/* Level, HUD, audio, effects                                           */
/* ------------------------------------------------------------------ */

let level = null;
const hud = new MeltdownHud({ dev: false });
const audio = new MeltdownAudio({ volume: 0.8 });
const projectiles = new Projectiles(scene);
const debris = new Debris(scene);
const beam = new LauncherLight(scene);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const environment = createEnvironmentDimmer(scene);
const credits = createCreditsPanel();

const ui = {
  cameraName: document.querySelector("#cameraName"),
  beatName: document.querySelector("#beatName"),
  reticle: document.querySelector("#reticle"),
  heat: document.querySelector("#heatFill"),
  heatBar: document.querySelector("#heatBar"),
  start: document.querySelector("#startOverlay"),
  picks: [...document.querySelectorAll("[data-character]")],
  fade: document.querySelector("#fade"),
  letterbox: document.querySelector("#letterbox"),
};

/* ------------------------------------------------------------------ */
/* Runner rules                                                         */
/* ------------------------------------------------------------------ */

const START_VITALITY = 100;
const START_BALLS = 26;
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

const CHARACTERS = { playerFemale: "PATIENT 0417", playerMale: "PATIENT 0932" };
let character = "playerFemale";
try {
  const saved = localStorage.getItem("meltdown.character");
  if (saved && CHARACTERS[saved]) character = saved;
} catch {
  /* storage unavailable: keep the default */
}

const avatar = new PlayerAvatar();
scene.add(avatar.root);

const runner = {
  distance: 0, lane: 1, lateral: 0, lateralVel: 0, height: 0, verticalVelocity: 0, sliding: 0,
  jumpBuffer: 0, slideBuffer: 0, landed: 0,
  vitality: START_VITALITY, balls: START_BALLS, alive: true, invulnerable: 0, slow: 0,
  finished: false, startedAt: 0, heat: 0, lockout: 0, weakened: 0,
  coolant: 0, adrenaline: 0, overchargeShots: 0, barrierShield: 0,
  fireDistance: -45, lookBack: 0, pushing: false, firing: false, fireCooldown: 0,
  hits: 0, shots: 0, breaks: 0, downs: 0, speed: 0, baseSpeed: 8.2,
};

/*
 * Phase B. On the roof the player moves freely: WASD relative to the camera
 * (which looks north, toward the helipad), the mouse aims, Space dodges -
 * a quick sidestep with a moment of invulnerability, which is also how you
 * make a charging patient miss and carry on over the ledge.
 */
let phase = "run"; // run | fade | roof | ending | over
let roof = null;
let roofAssets = null;
let roofAssetsPromise = null;
/** Dev/test overrides for the roof, e.g. { heliSeconds: 10 }. */
let roofOptions = {};
const ROOF_SPEED = 6.4;
const DODGE_SPEED = 13;
const DODGE_SECONDS = 0.24;
const hero = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  knock: new THREE.Vector3(),
  dodge: 0,
  dodgeCooldown: 0,
  dodgeDir: new THREE.Vector3(),
  yaw: 0,
  lastShot: 99,
  aim: new THREE.Vector3(),
  roofStart: 0,
  runStart: 0,
};
const held = new Set();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.15);

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

/* ------------------------------------------------------------------ */
/* Launcher (the supplied Javelin model)                                */
/* ------------------------------------------------------------------ */

const launcher = {
  rig: new THREE.Group(),
  muzzle: new THREE.Object3D(),
  model: null,
  heatMaterials: [],
  recoil: 0,
};
launcher.rig.add(launcher.muzzle);
// Stand-in until the model loads: a simple tube.
const standIn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0x3d4a3a, metalness: 0.6, roughness: 0.5 }));
standIn.rotation.x = Math.PI / 2;
launcher.rig.add(standIn);
launcher.muzzle.position.set(0, 0.02, -0.66);

function mountLauncherModel(assets) {
  const asset = assets.get("launcher");
  if (!asset || launcher.model) return;
  const model = asset.template.clone(true);
  // The source model's long axis is X; turn it to point down -Z and scale it
  // to a ~1.25 m shoulder launcher.
  const length = Math.max(asset.size.x, asset.size.z);
  model.scale.setScalar(1.25 / length);
  model.rotation.y = Math.PI / 2;
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  model.position.sub(centre);
  // Heat glow: the viewmodel gets its own material copies.
  model.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      o.material.emissive = new THREE.Color(0xff3a10);
      o.material.emissiveIntensity = 0;
      launcher.heatMaterials.push(o.material);
    }
  });
  standIn.visible = false;
  launcher.model = model;
  launcher.rig.add(model);
}

function placeLauncher(firstPerson) {
  if (firstPerson) {
    if (launcher.rig.parent !== camera) camera.add(launcher.rig);
    // A little sway with the stride, so the viewmodel is carried, not glued.
    const bob = reducedMotion ? 0 : runner.speed > 0 && runner.height <= 0.01 ? Math.sin(avatar.phase) : 0;
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
  const glow = runner.lockout > 0 ? 1.2 : runner.heat / 100;
  for (const m of launcher.heatMaterials) m.emissiveIntensity = glow * 1.4;
}
scene.add(camera);

/* ------------------------------------------------------------------ */
/* Cameras                                                              */
/* ------------------------------------------------------------------ */

const CAMERA_MODES = ["CHASE", "FIRST PERSON", "CINEMATIC", "ORBIT"];
let cameraMode = 0;
let trauma = 0;
let hitFlash = 0;
let warp = { active: false, t: 0 };

const cameraDesired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const smoothedLook = new THREE.Vector3();
const behind = new THREE.Vector3();
const camVelocity = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const warpUp = new THREE.Vector3();
let snapCamera = true;
let landingDip = 0;
let cameraRoll = 0;

/**
 * Spring-follow the desired position. A critically damped spring (not a
 * lerp) keeps the camera's own velocity, so it glides through the 90-degree
 * turns instead of cutting the corner and never jerks when the runner
 * changes lanes mid-turn.
 */
function follow(target, stiffness, dt) {
  if (snapCamera) {
    camera.position.copy(target);
    camVelocity.set(0, 0, 0);
    return;
  }
  const omega = Math.sqrt(stiffness);
  for (const axis of ["x", "y", "z"]) {
    [camera.position[axis], camVelocity[axis]] = spring(camera.position[axis], camVelocity[axis], target[axis], omega, dt);
  }
}

function updateCamera(dt, time) {
  const mode = CAMERA_MODES[cameraMode];
  const r = runner;
  landingDip = Math.max(0, landingDip - dt * 3.2);
  const dip = reducedMotion ? 0 : Math.sin(Math.min(1, landingDip) * Math.PI) * 0.18;

  if (mode === "FIRST PERSON") {
    const bob = reducedMotion || r.height > 0.01 || r.speed <= 0 ? 0 : Math.abs(Math.sin(avatar.phase)) * 0.045;
    level.route.sample(r.distance + 0.3, r.lateral, 1.65 + r.height - avatar.crouch * 0.8 + bob - dip, cameraDesired);
    level.route.sample(r.distance + 14, r.lateral * 0.4, 1.5, lookTarget);
    follow(cameraDesired, 900, dt);
  } else if (mode === "CINEMATIC") {
    level.route.sample(r.distance + 8, 5.2, 3.2, cameraDesired);
    level.route.sample(r.distance, r.lateral, 1.4, lookTarget);
    follow(cameraDesired, 14, dt);
  } else if (mode === "ORBIT") {
    level.route.sample(r.distance, 0, 0, cameraDesired);
    cameraDesired.x += Math.cos(time * 0.25) * 16;
    cameraDesired.z += Math.sin(time * 0.25) * 16;
    cameraDesired.y += 9;
    level.route.sample(r.distance, 0, 2, lookTarget);
    follow(cameraDesired, 16, dt);
  } else {
    // Chase: pulled back a touch as speed rises, trailing the lateral move.
    const back = 6.4 + r.speed * 0.05;
    level.route.sample(r.distance - back, r.lateral * 0.62, 2.8 + r.height * 0.55 - dip, cameraDesired);
    level.route.sample(r.distance + 12, r.lateral * 0.3, 1.6, lookTarget);
    follow(cameraDesired, 70, dt);
  }

  // A stumble makes you look back at the fire gaining on you - the moment
  // the brief describes. Lasts under a second; reduced motion skips it.
  if (r.lookBack > 0 && !reducedMotion && mode !== "ORBIT") {
    const k = Math.sin(Math.min(1, r.lookBack / 0.9) * Math.PI);
    level.route.sample(Math.max(0, r.fireDistance), 0, 2.5, behind);
    lookTarget.lerp(behind, k);
  }

  if (snapCamera) smoothedLook.copy(lookTarget);
  else smoothedLook.lerp(lookTarget, 1 - Math.exp(-dt * (r.lookBack > 0 ? 6 : 12)));
  camera.lookAt(smoothedLook);

  // Lean the view slightly into lane changes.
  const rollTarget = reducedMotion || mode === "ORBIT" ? 0 : THREE.MathUtils.clamp(-r.lateralVel * 0.006, -0.05, 0.05);
  cameraRoll += (rollTarget - cameraRoll) * Math.min(1, dt * 8);
  camera.rotateZ(cameraRoll);

  // Speed widens the view: 72 degrees at a jog, ~79 flat out.
  let fov = BASE_FOV + (reducedMotion ? 0 : THREE.MathUtils.clamp((r.speed - 8) * 1.1, 0, 7));
  // Reality warp: roll and up-vector drift, scaled down under reduced motion.
  if (warp.active) {
    const s = Math.sin(Math.min(1, warp.t) * Math.PI) * (reducedMotion ? 0.3 : 1);
    camera.up.lerp(warpUp.set(Math.sin(time * 1.3) * 0.55 * s, 1, Math.cos(time * 0.9) * 0.3 * s).normalize(), Math.min(1, dt * 2));
    camera.rotateZ(Math.sin(time * 2.1) * 0.18 * s);
    fov += Math.sin(time * 1.7) * 9 * s;
  } else {
    camera.up.lerp(UP, Math.min(1, dt * 3));
  }
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  // Trauma shake, squared so big hits are violent and the tail settles fast.
  trauma = Math.max(0, trauma - dt * 1.5);
  if (trauma > 0.001) {
    const amount = trauma * trauma * (reducedMotion ? 0.25 : 1);
    camera.position.x += (Math.random() * 2 - 1) * amount * 0.5;
    camera.position.y += (Math.random() * 2 - 1) * amount * 0.4;
    camera.rotateZ((Math.random() * 2 - 1) * amount * 0.06);
  }
  snapCamera = false;
}

/* ------------------------------------------------------------------ */
/* Shooting                                                             */
/* ------------------------------------------------------------------ */

const aim = new THREE.Vector3();
const muzzleWorld = new THREE.Vector3();
const fireDir = new THREE.Vector3();
const forwardVel = new THREE.Vector3();
const laneRight = new THREE.Vector3();
const beamTarget = new THREE.Vector3();

function currentPower() {
  if (runner.overchargeShots > 0) return 99;
  return runner.weakened > 0 ? 0.5 : 1;
}

function shoot() {
  if (!runner.alive || !level) return;
  if (phase === "run" && runner.finished) return;
  if (runner.lockout > 0) return;
  if (runner.balls <= 0) {
    audio.dry();
    return;
  }
  runner.balls -= 1;
  runner.shots += 1;

  if (runner.coolant <= 0) {
    runner.heat = Math.min(100, runner.heat + HEAT_PER_SHOT);
    if (runner.heat >= 100) {
      runner.lockout = HEAT_LOCKOUT_SECONDS;
      hud.toast("LAUNCHER OVERHEATED", "", "warn");
      audio.overheat();
      debris.sparks(launcher.muzzle.getWorldPosition(muzzleWorld), { count: 30, speed: 4 });
    }
  }

  // Aim where the reticle points: the first breakable or hazard under it,
  // or 60 m out. The ball then flies from the muzzle toward that point.
  raycaster.setFromCamera(pointer, camera);
  if (phase === "run") {
    const hit = raycaster.intersectObjects(level.breakables, false)[0];
    if (hit) aim.copy(hit.point);
    else aim.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 60);
  } else {
    aim.copy(hero.aim);
  }

  launcher.muzzle.getWorldPosition(muzzleWorld);
  fireDir.copy(aim).sub(muzzleWorld).normalize();
  if (phase === "run") {
    const sample = level.route.sample(runner.distance);
    forwardVel.set(-Math.sin(sample.heading), 0, -Math.cos(sample.heading)).multiplyScalar(runner.speed);
  } else {
    forwardVel.copy(hero.velocity).multiplyScalar(0.5);
    hero.lastShot = 0;
  }
  projectiles.fire(muzzleWorld, fireDir, BALL_SPEED, { power: currentPower(), inherit: forwardVel });
  if (runner.overchargeShots > 0) runner.overchargeShots -= 1;
  launcher.recoil = 1;
  audio.shot(runner.weakened > 0);
}

const POWERUP_LABELS = { coolant: "COOLANT", adrenaline: "ADRENALINE", overcharge: "OVERCHARGE", barrier: "BARRIER" };

function applyPowerup(kind) {
  if (kind === "coolant") {
    runner.heat = 0;
    runner.lockout = 0;
    runner.weakened = 0;
    runner.coolant = 4;
  } else if (kind === "adrenaline") runner.adrenaline = 6;
  else if (kind === "overcharge") runner.overchargeShots = 6;
  else if (kind === "barrier") runner.barrierShield = 5;
}

function onBallBreakable(object, point, ball) {
  if (phase !== "run") return onRoofBreakable(object, point, ball);
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
  runner.breaks += 1;
  if (result.kind === "glass") {
    const sample = level.route.sample(object.userData.routeDistance ?? runner.distance);
    laneRight.set(Math.cos(sample.heading), 0, -Math.sin(sample.heading));
    debris.burst(result.position, { kind: "glass", count: 70, speed: 5.5, area: [3.0, 3.4], right: laneRight, push: ball.velocity.clone().multiplyScalar(0.15) });
    audio.glassShatter(true);
    trauma = Math.min(1, trauma + 0.15);
  } else if (result.kind === "sack") {
    runner.balls = Math.min(MAX_BALLS, runner.balls + (result.spheres ?? 0));
    debris.burst(result.position, { kind: "sack", count: 26, speed: 4 });
    debris.burst(result.position, { kind: "ball", count: 6, speed: 3, up: 2 });
    hud.toast("BALLS", `+${result.spheres}`);
    audio.glassShatter(false);
    audio.pickup();
  } else if (result.kind === "patient") {
    runner.downs += 1;
    debris.burst(point, { kind: "concrete", count: 10, speed: 3, size: 0.12 });
    debris.dust(point, { size: 2, life: 0.9, color: 0x5a2a22 });
    audio.thud();
    audio.bodyFall();
  } else if (result.kind === "powerup") {
    applyPowerup(result.powerupKind);
    debris.burst(result.position, { kind: "power", count: 30, speed: 5 });
    debris.sparks(result.position, { count: 30 });
    hud.toast(POWERUP_LABELS[result.powerupKind] ?? "POWER-UP", "", "power");
    audio.powerup();
  }
  return true;
}

function onBallSolid(object, point) {
  debris.sparks(point, { count: 14, speed: 5 });
  audio.clang();
}

/* ------------------------------------------------------------------ */
/* Collision, vitality                                                  */
/* ------------------------------------------------------------------ */

const playerBox = new THREE.Box3();
const playerCentre = new THREE.Vector3();
const playerSize = new THREE.Vector3();

function updatePlayerBox() {
  const crouched = runner.sliding > 0;
  const height = crouched ? 1.0 : 1.9;
  level.route.sample(runner.distance, runner.lateral, runner.height, playerCentre);
  playerCentre.y += 0.18 + height / 2;
  playerSize.set(0.9, height, 0.9);
  playerBox.setFromCenterAndSize(playerCentre, playerSize);
}

function checkHazards(dt) {
  runner.invulnerable = Math.max(0, runner.invulnerable - dt);
  runner.slow = Math.max(0, runner.slow - dt);
  if (!runner.alive || runner.finished) return;

  updatePlayerBox();
  const hits = level.collide(playerBox, runner.distance);
  if (!hits.length || runner.invulnerable > 0) return;

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
  if (runner.barrierShield > 0) {
    debris.sparks(playerCentre, { count: 20 });
    return;
  }

  runner.vitality = Math.max(0, runner.vitality - HIT_VITALITY - HIT_FIRE_BURST);
  const dropped = Math.min(runner.balls, Math.max(runner.balls > 0 ? 1 : 0, Math.round(runner.balls * HIT_BALL_DROP_RATIO)));
  runner.balls -= dropped;
  runner.hits += 1;
  runner.invulnerable = 1.1;
  runner.slow = 0.55;
  runner.lookBack = 0.9;
  trauma = Math.min(1, trauma + 0.85);
  hitFlash = 1;
  level.impact(1);
  hud.flashDamage();
  hud.toast("HIT", dropped ? `-${dropped} BALLS` : "", "warn");
  audio.stumble();
  // The dropped balls physically spill out behind you.
  if (dropped) debris.burst(playerCentre, { kind: "ball", count: Math.min(12, dropped), speed: 3, up: 3 });

  if (runner.vitality <= 0) {
    runner.alive = false;
    trauma = 1;
    finishRun(false, "CAUGHT BY THE FIRE");
  }
}

/* ------------------------------------------------------------------ */
/* End of run                                                           */
/* ------------------------------------------------------------------ */

function finishRun(survived, title) {
  if (runner.finished) return;
  runner.finished = true;
  runner.alive = false;
  runner.firing = false;
  if (survived) {
    hud.showBanner("SECTOR 03 CLEARED", "ROOF ACCESS", 6000);
    return;
  }
  const seconds = (performance.now() - runner.startedAt) / 1000;
  hud.showSummary({
    title,
    failed: true,
    rows: [
      ["Time", `${seconds.toFixed(1)}s`],
      ["Distance", `${Math.round(runner.distance)} / ${Math.round(level.route.totalLength)}m`],
      ["Hits taken", runner.hits],
      ["Shots / breaks", `${runner.shots} / ${runner.breaks}`],
      ["Patients downed", runner.downs],
      ["Balls left", runner.balls, true],
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Level lifecycle                                                      */
/* ------------------------------------------------------------------ */

const ASSET_BASE = new URL("../assets/meltdown/", import.meta.url).href;
let assetsReady = false;

async function loadCharacter(name) {
  const loaded = await loadMeltdownAssets(ASSET_BASE, { names: [name] });
  const asset = loaded.get(name);
  if (asset && name === character) avatar.setModel(asset.template);
}

async function loadLevel() {
  if (level) {
    hud.unbind();
    level.dispose();
  }
  if (roof) {
    roof.dispose();
    roof = null;
  }
  phase = "run";
  fade(false);
  ui.letterbox?.classList.remove("on");
  hud.vitals.style.visibility = "";
  avatar.hold = 1;
  avatar.reachUp = 0;
  audio.setRotor(0);
  avatar.setVisible(true);
  scene.fog.density = 0.012;
  renderer.toneMappingExposure = BASE_EXPOSURE;
  projectiles.clear();
  debris.clear();
  assetsReady = false;

  level = new MeltdownLevel({ origin: new THREE.Vector3(0, 0, 0) });
  level.addTo(scene);
  hud.bind(level);
  hud.hideSummary();
  hud.show();

  level.events.on("complete", () => startRoof());
  level.events.on("timer-expired", () => {
    finishRun(false, "THE BUILDING WENT UP");
    runner.vitality = 0;
  });
  level.events.on("warp-start", () => {
    warp = { active: true, t: 0 };
    audio.warp();
  });
  level.events.on("warp-tick", ({ t }) => (warp.t = t));
  level.events.on("warp-end", () => (warp.active = false));
  level.events.on("hazard-land", ({ kind, position }) => {
    debris.burst(position, { kind: kind === "duct" ? "metal" : "concrete", count: 30, speed: 5 });
    debris.dust(position, { size: kind === "shelf" ? 6 : 5 });
    debris.sparks(position, { count: 16 });
    const near = Math.max(0, 1 - position.distanceTo(avatar.root.position) / 30);
    trauma = Math.min(1, trauma + near * 0.5);
    audio.crash(0.5 + near * 0.5);
  });
  level.events.on("duct-cleared", () => audio.clang());
  level.events.on("patient-lurch", ({ position }) => {
    const near = Math.max(0.3, 1 - position.distanceTo(avatar.root.position) / 30);
    audio.groan(near);
  });
  level.events.on("patient-seen", () => audio.stinger());
  level.events.on("beat", ({ key }) => {
    const beat = BEATS.find((b) => b.key === key);
    if (beat?.dark) {
      audio.powerDown();
      setTimeout(() => {
        audio.beamOn();
        hud.showBanner("POWER FAILURE", "YOUR LAUNCHER HAS A LIGHT", 3200);
      }, 900);
    } else if (key === "stairwell") {
      audio.powerUp();
    }
  });

  Object.assign(runner, {
    distance: 0, lane: 1, lateral: 0, lateralVel: 0, height: 0, verticalVelocity: 0, sliding: 0,
    jumpBuffer: 0, slideBuffer: 0, landed: 0,
    vitality: START_VITALITY, balls: START_BALLS, alive: true, invulnerable: 0, slow: 0,
    finished: false, heat: 0, lockout: 0, weakened: 0, coolant: 0, adrenaline: 0,
    overchargeShots: 0, barrierShield: 0, fireDistance: -45, lookBack: 0, pushing: false,
    firing: false, fireCooldown: 0, hits: 0, shots: 0, breaks: 0, downs: 0, speed: 0,
    baseSpeed: level.speedAt(0), startedAt: performance.now(),
  });
  trauma = 0;
  hitFlash = 0;
  warp = { active: false, t: 0 };
  snapCamera = true;
  hud.setVitality(START_VITALITY);
  hud.setBalls(START_BALLS);
  hud.setDanger(0);
  smoothedLook.copy(level.route.sample(14, 0, 1.5).position);

  // Models stream in; the level is playable with stand-ins meanwhile.
  hud.setLoading(0);
  const current = level;
  const [loaded] = await Promise.all([level.loadAssets(ASSET_BASE, { onProgress: (r) => hud.setLoading(r) }), loadCharacter(character)]);
  if (current !== level) return;
  hud.setLoading(null);
  mountLauncherModel(loaded);
  // Compile and upload everything now rather than on first sight mid-run.
  level.prewarm(renderer, camera);
  environment.refresh();
  assetsReady = true;
  // The roof's models stream in behind Phase A.
  loadRoofAssets();
}

/* ------------------------------------------------------------------ */
/* Input                                                                */
/* ------------------------------------------------------------------ */

let started = false;
function begin() {
  if (started) return;
  started = true;
  audio.start();
  ui.start?.remove();
  runner.startedAt = performance.now();
}

function pickCharacter(name) {
  if (!CHARACTERS[name]) return;
  character = name;
  try {
    localStorage.setItem("meltdown.character", name);
  } catch {
    /* ignore */
  }
  for (const button of ui.picks) button.classList.toggle("picked", button.dataset.character === name);
  loadCharacter(name);
}
for (const button of ui.picks) {
  button.classList.toggle("picked", button.dataset.character === character);
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    pickCharacter(button.dataset.character);
  });
}

addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  ui.reticle.style.left = `${event.clientX}px`;
  ui.reticle.style.top = `${event.clientY}px`;
});

document.querySelector("#creditsButton")?.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  credits.toggle(true);
});

addEventListener("pointerdown", (event) => {
  if (event.target.closest?.("[data-character]") || event.target.closest?.(".mlt-credits")) return;
  begin();
  if (event.button === 0) {
    runner.firing = true;
    runner.fireCooldown = 0;
  }
});
addEventListener("pointerup", (event) => {
  if (event.button === 0) runner.firing = false;
});

function jump() {
  const push = level?.pushNearby(runner.distance);
  if (push) {
    audio.ductPush(push.progress);
    trauma = Math.min(1, trauma + 0.12);
    debris.sparks(avatar.root.position.clone().setY(1.4), { count: 6, speed: 3 });
    return;
  }
  runner.jumpBuffer = INPUT_BUFFER;
}

function slide() {
  runner.slideBuffer = INPUT_BUFFER;
}

addEventListener("keyup", (event) => held.delete(event.code));
addEventListener("blur", () => held.clear());

addEventListener("keydown", (event) => {
  held.add(event.code);
  if (event.repeat && event.code !== "Space") return;
  if (event.code === "KeyK") {
    credits.toggle();
    return;
  }
  begin();
  if (event.code === "KeyR") {
    loadLevel();
    return;
  }
  if (event.code === "KeyP" && phase === "run") {
    startRoof();
    return;
  }
  if (phase !== "run") {
    // The roof: WASD is movement (read from `held` each frame); Space dodges.
    if (event.code === "Space" && phase === "roof") {
      event.preventDefault();
      // At the ledge with the ladder in reach, Space is the jump for it.
      if (roof?.grab(hero.position)) return;
      if (hero.dodgeCooldown <= 0) {
        const dir = hero.velocity.lengthSq() > 0.5 ? hero.velocity.clone() : hero.aim.clone().sub(hero.position).setY(0);
        hero.dodgeDir.copy(dir.normalize());
        hero.dodge = DODGE_SECONDS;
        hero.dodgeCooldown = 0.75;
        runner.invulnerable = Math.max(runner.invulnerable, 0.32);
        audio.whoosh();
      }
    }
    if (event.code === "KeyB") bloom.enabled = !bloom.enabled;
    if (event.code === "KeyF") hud.setDevVisible(hud.dev.hidden);
    return;
  }
  if (event.code === "KeyA" || event.code === "ArrowLeft") runner.lane = Math.max(0, runner.lane - 1);
  if (event.code === "KeyD" || event.code === "ArrowRight") runner.lane = Math.min(2, runner.lane + 1);
  if (event.code === "Space" || event.code === "KeyW" || event.code === "ArrowUp") {
    event.preventDefault();
    jump();
  }
  if (event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyS" || event.code === "ArrowDown") slide();
  if (event.code === "KeyC") {
    cameraMode = (cameraMode + 1) % CAMERA_MODES.length;
    ui.cameraName.textContent = CAMERA_MODES[cameraMode];
  }
  if (event.code === "KeyB") {
    bloom.enabled = !bloom.enabled;
    hud.toast("BLOOM", bloom.enabled ? "ON" : "OFF", "", 900);
  }
  if (event.code === "KeyF") {
    hud.setDevVisible(hud.dev.hidden);
    if (ui.heatBar) ui.heatBar.hidden = hud.dev.hidden;
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  grade.uniforms.uResolution.value.set(innerWidth, innerHeight);
});

/* ------------------------------------------------------------------ */
/* Movement                                                             */
/* ------------------------------------------------------------------ */

function updateMovement(dt, playing) {
  const r = runner;
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
      landingDip = Math.min(1, -r.verticalVelocity / 14);
      if (r.slideBuffer > 0) {
        r.sliding = SLIDE_SECONDS;
        r.slideBuffer = 0;
      }
    }
    r.verticalVelocity = 0;
  }
  r.sliding = Math.max(0, r.sliding - dt);
}

/* ------------------------------------------------------------------ */
/* Phase B - the roof                                                   */
/* ------------------------------------------------------------------ */

const ROOF_NAMES = ["scientistRadioman", "scientistRust", "patient", "helicopter", "gadgetBrass", "gadgetCoil", "ventFan", "utilityBox", "alarmLight"];
const FOG_ROOF = new THREE.Color(0x0c0d12);

/** Roof models load in the background while Phase A is being played. */
function loadRoofAssets() {
  roofAssetsPromise ??= loadMeltdownAssets(ASSET_BASE, { names: ROOF_NAMES }).then((map) => (roofAssets = map));
  return roofAssetsPromise;
}

function fade(on) {
  ui.fade?.classList.toggle("on", on);
}

/**
 * Up the stairs: fade out, swap the corridor for the roof, compile its
 * shaders while the screen is black (the scene's light count changes, so
 * everything recompiles once - better here than mid-fight), fade back in.
 */
async function startRoof() {
  if (phase !== "run") return;
  phase = "fade";
  runner.firing = false;
  fade(true);
  const wait = new Promise((resolve) => setTimeout(resolve, 650));
  await Promise.all([wait, loadRoofAssets()]);

  level.root.visible = false;
  projectiles.clear();
  debris.clear();
  roof?.dispose();
  roof = new RoofLevel({ assets: roofAssets, ...roofOptions });
  roof.addTo(scene);
  bindRoofEvents();

  hero.position.copy(ROOF_SPAWN);
  hero.velocity.set(0, 0, 0);
  hero.knock.set(0, 0, 0);
  hero.yaw = 0;
  hero.roofStart = performance.now();
  avatar.root.position.copy(hero.position);
  avatar.root.rotation.y = 0;
  avatar.setVisible(true);
  avatar.shadow.visible = true;
  // A breath at the top of the stairs: a partial refill, not a reset.
  runner.vitality = Math.min(START_VITALITY, runner.vitality + 25);
  runner.alive = true;
  runner.finished = false;
  runner.invulnerable = 1.5;
  runner.heat = 0;
  runner.lockout = 0;

  scene.fog.color.copy(FOG_ROOF);
  // Night haze: enough that the city recedes instead of standing around you.
  scene.fog.density = 0.0105;
  scene.background.copy(FOG_ROOF);
  renderer.toneMappingExposure = 1.0;
  environment.refresh();
  environment.set(0.8);
  snapCamera = true;
  updateRoofCamera(0.016);
  roof.prewarm(renderer, camera);

  phase = "roof";
  fade(false);
  hud.showBanner("SECTOR 03 // THE ROOF", "HOLD ON", 3200);
  setTimeout(() => hud.toast("WASD MOVE", "SPACE DODGE", "", 4200), 1200);
  setTimeout(() => hud.toast("LURE THEM", "OFF THE EDGE", "", 4200), 3000);
}

function bindRoofEvents() {
  roof.events.on("wave", ({ index }) => {
    hud.showBanner(index === 1 ? "THEY WERE WAITING" : "MORE OF THEM", index === 1 ? "THEY'RE LETTING THEM OUT" : "THE MACHINE ROOM", 2600);
    audio.groan(1);
  });
  roof.events.on("patient-windup", () => audio.growl());
  roof.events.on("patient-stunned", ({ position }) => {
    debris.dust(position.clone().setY(1), { size: 2 });
    audio.clang();
  });
  roof.events.on("enemy-fall", () => {
    audio.scream();
    hud.toast("OVER THE EDGE", "");
  });
  roof.events.on("enemy-down", ({ enemy }) => {
    audio.bodyFall();
    hud.toast("DOWN", enemy.kind === "scientist" ? "SCIENTIST" : "");
  });
  roof.events.on("orb-fired", () => audio.zap());
  roof.events.on("orb-burst", ({ position }) => debris.sparks(position, { count: 22, speed: 5 }));
  roof.events.on("clear", () => hud.showBanner("ROOF CLEAR", "HERE IT COMES", 3000));
  roof.events.on("heli-arrived", ({ ending }) => {
    if (ending === "victory") {
      roof.beginEnding(hero.position);
      startCutscene();
      hud.showBanner("EXTRACTION", "CLIMB THE LADDER", 3000);
    } else {
      // Not a cutscene: it waits off the east ledge and you have to get there.
      hud.showBanner("IT CAN'T LAND", "JUMP FOR THE LADDER", 3200);
      audio.stinger();
    }
  });
  roof.events.on("ladder-grab", () => {
    startCutscene();
    audio.whoosh();
  });
  roof.events.on("heli-left", () => {
    hud.showBanner("IT COULDN'T WAIT", "LEFT BEHIND", 3000);
    runner.firing = false;
    setTimeout(() => {
      if (phase !== "roof" || !roof) return;
      phase = "over";
      showRoofSummary(false, "LEFT BEHIND");
    }, 3000);
  });
  // The roof coming apart.
  roof.events.on("explosion", ({ position, strength }) => {
    debris.burst(position.clone().setY(Math.max(0.3, position.y + 2)), { kind: "concrete", count: 24, speed: 7, up: 5 });
    debris.sparks(position.clone().setY(0.5), { count: 40, speed: 9 });
    debris.dust(position.clone().setY(1), { size: 7, life: 2.2, color: 0x3a2e28 });
    const near = Math.max(0.2, 1 - position.distanceTo(hero.position) / 30);
    trauma = Math.min(1, trauma + strength * near * 0.7);
    audio.crash(0.4 + near * strength * 0.6);
  });
  roof.events.on("tremor", ({ strength }) => {
    trauma = Math.min(1, trauma + strength * 0.55);
    audio.crash(0.25 + strength * 0.3);
    hud.toast("THE BUILDING IS GOING", "", "warn", 1400);
  });
  roof.events.on("roof-fire", ({ position }) => {
    debris.sparks(position.clone().setY(0.3), { count: 20, speed: 4 });
    audio.crash(0.15);
  });
}

function startCutscene() {
  phase = "ending";
  runner.firing = false;
  ui.letterbox?.classList.add("on");
  hud.vitals.style.visibility = "hidden";
  hud.setPrompt(null);
}

function onRoofBreakable(object, point, ball) {
  const result = roof.breakTarget(object, ball.power, avatar.root.position);
  if (!result) return true;
  if (result.kind === "sack") {
    if (result.partial) return true;
    runner.balls = Math.min(MAX_BALLS, runner.balls + (result.spheres ?? 0));
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
  runner.breaks += result.partial ? 0 : 1;
  if (!result.partial) runner.downs += 1;
  return true;
}

function updateRoofCamera(dt) {
  // High and behind (south of) the player, looking north over their head,
  // leaning a little toward where they aim.
  cameraDesired.copy(hero.position).add(new THREE.Vector3(0, 11.5, 8.5));
  lookTarget.copy(hero.position).add(new THREE.Vector3(0, 0.6, -3.4)).lerp(hero.aim, 0.16);
  follow(cameraDesired, 60, dt);
  if (snapCamera) smoothedLook.copy(lookTarget);
  else smoothedLook.lerp(lookTarget, 1 - Math.exp(-dt * 10));
  camera.up.copy(UP);
  camera.lookAt(smoothedLook);
  if (Math.abs(camera.fov - BASE_FOV) > 0.01) {
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
  }
  trauma = Math.max(0, trauma - dt * 1.5);
  if (trauma > 0.001) {
    const amount = trauma * trauma * (reducedMotion ? 0.25 : 1);
    camera.position.x += (Math.random() * 2 - 1) * amount * 0.4;
    camera.position.y += (Math.random() * 2 - 1) * amount * 0.3;
  }
  snapCamera = false;
}

function roofHit(hit) {
  if (runner.invulnerable > 0 || phase !== "roof") return;
  runner.vitality = Math.max(0, runner.vitality - hit.damage);
  runner.hits += 1;
  runner.invulnerable = 1.0;
  hero.knock.subVectors(hero.position, hit.from).setY(0).normalize().multiplyScalar(hit.knock);
  trauma = Math.min(1, trauma + (hit.source === "patient" ? 0.8 : 0.45));
  hitFlash = 1;
  hud.flashDamage();
  hud.toast(hit.source === "fire" ? "BURNING" : "HIT", "", "warn");
  audio.stumble();
  debris.sparks(avatar.root.position.clone().setY(1.2), { count: 16 });
  if (runner.vitality <= 0) {
    runner.alive = false;
    phase = "over";
    showRoofSummary(false, "THEY GOT YOU");
  }
}

function showRoofSummary(escaped, title) {
  hud.vitals.style.visibility = "";
  const total = (performance.now() - runner.startedAt) / 1000;
  const onRoof = (performance.now() - hero.roofStart) / 1000;
  hud.showSummary({
    title,
    eyebrow: escaped ? "LEVEL 3 COMPLETE" : "SECTOR 03 // THE ROOF",
    failed: !escaped,
    rows: [
      ["Total time", `${total.toFixed(1)}s`],
      ["On the roof", `${onRoof.toFixed(1)}s`],
      ["Shot down (both phases)", runner.downs],
      ["Sent over the edge", roof ? roof.state.falls : 0],
      ["Hits taken", runner.hits],
      ["Balls left", runner.balls, true],
    ],
  });
}

function updateRoofFrame(dt, time) {
  const cut = roof.cutscene;
  const slow = phase === "ending" && cut ? cut.timeScale : 1;
  const sdt = dt * slow;

  if (phase === "roof") {
    // Movement, camera-relative (the camera looks down -Z).
    const ix = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
    const iz = (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0) - (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0);
    const input = new THREE.Vector3(ix, 0, iz);
    if (input.lengthSq() > 1) input.normalize();
    const k = 1 - Math.exp(-dt * 12);
    hero.velocity.lerp(input.multiplyScalar(ROOF_SPEED), k);
    hero.dodge = Math.max(0, hero.dodge - dt);
    hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
    hero.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
    hero.position.addScaledVector(hero.velocity, dt).addScaledVector(hero.knock, dt);
    if (hero.dodge > 0) hero.position.addScaledVector(hero.dodgeDir, DODGE_SPEED * dt);
    roof.clampPlayer(hero.position);
    hero.position.y = 0;

    // Aim: an enemy or sack under the cursor, else a point at chest height.
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(roof.breakables, false)[0];
    if (hit) hero.aim.copy(hit.point);
    else if (!raycaster.ray.intersectPlane(aimPlane, hero.aim)) hero.aim.copy(hero.position).add(new THREE.Vector3(0, 1.15, -10));
    ui.reticle.classList.toggle("hot", Boolean(hit));

    // Face the aim while shooting, otherwise the way you move.
    hero.lastShot += dt;
    const face = hero.lastShot < 0.6 || runner.firing ? hero.aim.clone().sub(hero.position) : hero.velocity.lengthSq() > 0.5 ? hero.velocity.clone() : null;
    if (face) {
      const want = Math.atan2(-face.x, -face.z);
      let delta = want - hero.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      hero.yaw += delta * Math.min(1, dt * 14);
    }
    avatar.root.position.copy(hero.position);
    avatar.root.rotation.y = hero.yaw;
    const speed = hero.velocity.length() + (hero.dodge > 0 ? DODGE_SPEED : 0);
    avatar.update(dt, { speed, lateralVel: 0, height: 0, sliding: hero.dodge > 0, aiming: runner.firing });

    const hits = roof.update({ dt, time, player: hero.position, playerVelocity: hero.velocity });
    for (const h of hits) roofHit(h);
    updateRoofCamera(dt);
  } else if (phase === "ending" || phase === "over") {
    roof.update({ dt: sdt, time, player: hero.position, playerVelocity: hero.velocity });
    if (cut) {
      avatar.root.position.copy(cut.player);
      avatar.root.rotation.y = cut.playerYaw;
      avatar.setVisible(!cut.hidePlayer);
      avatar.shadow.visible = !cut.hidePlayer && cut.action !== "jump" && cut.action !== "hang";
      avatar.hold = cut.hold ?? 1;
      avatar.reachUp = cut.reachUp ?? 0;
      avatar.update(sdt, { speed: cut.action === "run" ? 9 : cut.action === "climb" ? 2.5 : 0, height: cut.action === "jump" ? 1 : 0, aiming: false });
      if (snapCamera) camera.position.copy(cut.camera);
      else camera.position.lerp(cut.camera, 1 - Math.exp(-dt * 3));
      smoothedLook.lerp(cut.look, 1 - Math.exp(-dt * 4));
      camera.lookAt(smoothedLook);
      snapCamera = false;
      if (cut.done && phase === "ending") {
        phase = "over";
        const escaped = roof.state.ending;
        ui.letterbox?.classList.remove("on");
        showRoofSummary(true, escaped === "victory" ? "EXTRACTED" : "BARELY OUT");
        avatar.hold = 1;
        avatar.reachUp = 0;
      }
    } else {
      updateRoofCamera(dt);
    }
  }

  placeLauncher(false);
  // Balls fly through the cutscene's slow motion too.
  projectiles.update(sdt, { breakables: roof.breakables, solids: roof.solids, onBreakable: onBallBreakable, onSolid: onBallSolid });
  debris.update(sdt);
  launcher.muzzle.getWorldPosition(muzzleWorld);
  beam.update(dt, { origin: muzzleWorld, target: hero.aim, darkness: 0, time, projectiles });
  audio.setRotor(roof.rotorLevel);
}

/* ------------------------------------------------------------------ */
/* Loop                                                                 */
/* ------------------------------------------------------------------ */

let fps = 0;
let fpsAccumulator = 0;
let fpsFrames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  fpsAccumulator += dt;
  fpsFrames += 1;
  if (fpsAccumulator >= 0.5) {
    fps = fpsFrames / fpsAccumulator;
    fpsAccumulator = 0;
    fpsFrames = 0;
  }
  if (!level) return;

  const onRoof = phase !== "run";
  const playing = onRoof ? phase === "roof" && runner.alive : started && runner.alive && !runner.finished;
  if (!onRoof) updateMovement(dt, playing);

  // Launcher: held trigger, heat, lockout, weakened window.
  launcher.recoil = Math.max(0, launcher.recoil - dt * 7);
  runner.fireCooldown -= dt;
  if (playing && runner.firing && runner.fireCooldown <= 0) {
    shoot();
    runner.fireCooldown = FIRE_INTERVAL;
  }
  const wasLocked = runner.lockout > 0;
  runner.lockout = Math.max(0, runner.lockout - dt);
  if (wasLocked && runner.lockout <= 0) {
    runner.heat = 0;
    runner.weakened = WEAKENED_SECONDS;
    hud.toast("LAUNCHER WEAKENED", "", "warn", 1600);
  }
  if (runner.lockout <= 0 && !(runner.firing && playing)) runner.heat = Math.max(0, runner.heat - HEAT_COOL_RATE * dt);
  else if (runner.lockout <= 0) runner.heat = Math.max(0, runner.heat - HEAT_COOL_RATE * 0.3 * dt);
  runner.weakened = Math.max(0, runner.weakened - dt);
  runner.coolant = Math.max(0, runner.coolant - dt);
  runner.adrenaline = Math.max(0, runner.adrenaline - dt);
  runner.barrierShield = Math.max(0, runner.barrierShield - dt);
  runner.lookBack = Math.max(0, runner.lookBack - dt);

  if (onRoof) {
    runner.invulnerable = Math.max(0, runner.invulnerable - dt);
    if (roof) updateRoofFrame(dt, time);
    const danger = 1 - runner.vitality / START_VITALITY;
    hud.setDanger(danger);
    // The roof coming apart: thicker smoke, heat haze, louder everything.
    const chaos = roof?.state.chaos ?? 0;
    scene.fog.density = 0.0105 + chaos * 0.011;
    audio.setFireProximity(0.25 + chaos * 0.5);
    audio.setDanger(Math.max(danger * 0.8, chaos * 0.65));
    hitFlash = Math.max(0, hitFlash - dt * 3);
    const g = grade.uniforms;
    g.uTime.value = time;
    g.uDanger.value = danger;
    g.uDark.value = 0.15 + (roof?.state.chaos ?? 0) * 0.1;
    g.uHeat.value = reducedMotion ? 0 : (roof?.state.chaos ?? 0) * 0.35;
    g.uHit.value = reducedMotion ? hitFlash * 0.3 : hitFlash;
    ui.reticle.classList.toggle("overheated", runner.lockout > 0);
    ui.reticle.classList.toggle("weak", runner.weakened > 0);
    hud.setVitality(runner.vitality, START_VITALITY);
    hud.setBalls(runner.balls);
    const hint = phase === "roof" ? roof?.extractionHint(hero.position) : null;
    hud.setPrompt(hint === "jump" ? "SPACE - JUMP FOR THE LADDER!" : hint === "go" ? "GET TO THE EAST LEDGE" : runner.balls <= 0 && playing ? "NO BALLS" : null);
    hud.update({ fps, renderer });
    ui.beatName.textContent = "THE ROOF";
    composer.render();
    return;
  }

  // The fire: vitality drains steadily, and the fire front's distance
  // behind you is that vitality made visible.
  if (playing && runner.adrenaline <= 0) {
    runner.vitality = Math.max(0, runner.vitality - level.drainRateAt(runner.distance) * dt);
    if (runner.vitality <= 0) {
      runner.alive = false;
      finishRun(false, "CAUGHT BY THE FIRE");
    }
  }
  const gap = 4 + runner.vitality * 0.42;
  const target = runner.distance - gap;
  runner.fireDistance += (target - runner.fireDistance) * Math.min(1, dt * (target > runner.fireDistance ? 0.9 : 3));
  level.setFireFront(runner.fireDistance);

  // The body.
  const placement = level.route.sample(runner.distance, runner.lateral, runner.height);
  avatar.root.position.copy(placement.position);
  avatar.root.rotation.y = placement.heading;
  avatar.update(dt, {
    speed: runner.speed,
    lateralVel: runner.lateralVel,
    height: runner.height,
    sliding: runner.sliding > 0,
    pushing: runner.pushing,
    stumble: runner.lookBack > 0.5 ? 1 : 0,
    aiming: runner.firing,
  });
  // Blink through the mercy window after a hit (not the long "invulnerable"
  // a test or demo teleport sets).
  const blinking = runner.invulnerable > 0 && runner.invulnerable < 2 && Math.floor(time * 14) % 2 === 0;
  const firstPerson = CAMERA_MODES[cameraMode] === "FIRST PERSON";
  avatar.setVisible(!firstPerson && !blinking);
  avatar.shadow.visible = !firstPerson;

  level.update({ dt, time, distance: runner.distance, playerPosition: avatar.root.position });
  if (playing) checkHazards(dt);
  updateCamera(dt, time);
  placeLauncher(firstPerson);
  projectiles.update(dt, { breakables: level.breakables, solids: level.obstacles, onBreakable: onBallBreakable, onSolid: onBallSolid });
  debris.update(dt);

  // The launcher's light: from the muzzle toward what the reticle is on.
  const darkness = level.state.darkness;
  raycaster.setFromCamera(pointer, camera);
  // Held like a weapon light: it follows the reticle but sits a little low,
  // so aiming at the corridor ahead also lights the floor you are about to
  // run on.
  beamTarget.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 24);
  beamTarget.y -= 1.3;
  launcher.muzzle.getWorldPosition(muzzleWorld);
  beam.update(dt, { origin: muzzleWorld, target: beamTarget, darkness, time, projectiles });
  level.setFlashlight({ active: beam.power > 0.2, position: muzzleWorld, direction: beam.direction(), cos: Math.cos(beam.angle * 0.8), range: 28 });

  // Danger: red tint, darker thicker smoke, louder fire and siren. The dark
  // beat pulls the fog to black smoke instead.
  const danger = 1 - runner.vitality / START_VITALITY;
  const fireNear = THREE.MathUtils.clamp(1 - (runner.distance - runner.fireDistance) / 45, 0, 1);
  level.setDanger(danger);
  hud.setDanger(Math.max(danger, fireNear * 0.8));
  scene.fog.color.copy(FOG_CALM).lerp(FOG_DANGER, danger).lerp(FOG_DARK, darkness * 0.9);
  environment.set(1 - darkness * 0.92);
  scene.background.copy(scene.fog.color);
  scene.fog.density = 0.011 + danger * 0.018 + (warp.active ? 0.01 : 0) + darkness * 0.022;
  renderer.toneMappingExposure = BASE_EXPOSURE - danger * 0.25 + darkness * 0.12;
  audio.setFireProximity(fireNear);
  audio.setDanger(danger);

  hitFlash = Math.max(0, hitFlash - dt * 3);
  const g = grade.uniforms;
  g.uTime.value = time;
  g.uDanger.value = danger;
  g.uDark.value = darkness;
  g.uHeat.value = reducedMotion ? 0 : Math.max(fireNear * fireNear, warp.active ? 0.5 : 0);
  g.uHit.value = reducedMotion ? hitFlash * 0.3 : hitFlash;

  // Reticle: hot over a target, red and pulsing when overheated.
  ui.reticle.classList.toggle("hot", raycaster.intersectObjects(level.breakables, false).length > 0);
  ui.reticle.classList.toggle("overheated", runner.lockout > 0);
  ui.reticle.classList.toggle("weak", runner.weakened > 0);
  if (ui.heat) ui.heat.style.transform = `scaleX(${runner.heat / 100})`;

  hud.setVitality(runner.vitality, START_VITALITY);
  hud.setBalls(runner.balls);
  hud.setPrompt(runner.pushing || level.ductAhead(runner.distance, 3.5) ? "MASH SPACE TO PUSH" : runner.balls <= 0 && playing ? "NO BALLS" : null);
  hud.update({ fps, renderer });
  const beat = level.beatAt(runner.distance);
  ui.beatName.textContent = level.hallAt(runner.distance)?.name ?? beat.name;

  composer.render();
}

loadLevel();
ui.cameraName.textContent = CAMERA_MODES[cameraMode];
animate();

globalThis.__meltdown = {
  get level() {
    return level;
  },
  get assetsReady() {
    return assetsReady;
  },
  runner,
  avatar,
  hud,
  scene,
  renderer,
  camera,
  audio,
  projectiles,
  debris,
  beam,
  THREE,
  BEATS,
  begin,
  snapCamera: () => {
    snapCamera = true;
  },
  /** Jump the run to a route distance (tests, screenshots, demos). */
  teleport(distance, { camera: mode = cameraMode, invulnerable = 999 } = {}) {
    runner.distance = distance;
    runner.fireDistance = distance - 30;
    runner.invulnerable = invulnerable;
    cameraMode = mode;
    ui.cameraName.textContent = CAMERA_MODES[cameraMode];
    snapCamera = true;
  },
  pickCharacter,
  get roof() {
    return roof;
  },
  get phase() {
    return phase;
  },
  hero,
  startRoof,
  set roofOptions(value) {
    roofOptions = value ?? {};
  },
  loadRoofAssets,
};

// ?roof in the URL starts on the roof (demos, testing Phase B on its own).
if (new URLSearchParams(location.search).has("roof")) {
  const go = () => (assetsReady ? startRoof() : setTimeout(go, 300));
  go();
}
