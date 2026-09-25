/**
 * Standalone preview harness for Level 3 - The Meltdown (Phase A).
 *
 * Scaffolding around the real level (src/levels/meltdown/) and HUD
 * (src/ui/meltdown-hud.js): a dummy runner, four camera rigs, the launcher,
 * and the player-side rules (vitality, balls, overheat, power-ups). The main
 * game's player/camera controllers replace this on integration; everything
 * reusable - projectiles, debris, audio - lives in src/ already.
 *
 * Serve the repository over HTTP and open /preview/meltdown.html.
 */

import * as THREE from "../src/three.js";
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment } from "../src/three-addons.js";
import { MeltdownLevel, BEATS, LANES } from "../src/levels/meltdown/index.js";
import { Projectiles, Debris } from "../src/levels/meltdown/effects.js";
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
renderer.toneMappingExposure = 0.95;
const BASE_EXPOSURE = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG_CALM = new THREE.Color(0x1a120d);
const FOG_DANGER = new THREE.Color(0x2a0804);
scene.background = FOG_CALM.clone();
scene.fog = new THREE.FogExp2(FOG_CALM.clone(), 0.012);
// A pre-filtered environment for reflections. Without one, every metallic
// PBR surface - steel walls, the imported props, the launcher - renders
// close to black, because metal only shows what it reflects.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 320);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Bloom is what sells fire, lasers and emissive glass. Run at half
// resolution - a full-res bloom chain would double the fill-rate cost.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// High threshold: only genuinely hot things (fire, lasers, energy) bloom -
// lit walls and ceiling tubes should not.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.6, 0.45, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let bloomOn = true;

/* ------------------------------------------------------------------ */
/* Level, HUD, audio, effects                                           */
/* ------------------------------------------------------------------ */

let level = null;
const hud = new MeltdownHud({ dev: false });
const audio = new MeltdownAudio({ volume: 0.8 });
const projectiles = new Projectiles(scene);
const debris = new Debris(scene);

const ui = {
  cameraName: document.querySelector("#cameraName"),
  beatName: document.querySelector("#beatName"),
  reticle: document.querySelector("#reticle"),
  heat: document.querySelector("#heatFill"),
  heatBar: document.querySelector("#heatBar"),
  start: document.querySelector("#startOverlay"),
};

/* ------------------------------------------------------------------ */
/* Runner rules                                                         */
/* ------------------------------------------------------------------ */

const SPEED_ZONES = [
  { until: 0.4, speed: 8.2 },
  { until: 0.7, speed: 11.0 },
  { until: 1.01, speed: 14.0 },
];

function speedAt(progress) {
  let previous = SPEED_ZONES[0].speed;
  let from = 0;
  for (const zone of SPEED_ZONES) {
    if (progress < zone.until) {
      const into = (progress - from) / 0.04;
      if (into < 1 && from > 0) return THREE.MathUtils.lerp(previous, zone.speed, THREE.MathUtils.smoothstep(into, 0, 1));
      return zone.speed;
    }
    previous = zone.speed;
    from = zone.until;
  }
  return SPEED_ZONES[SPEED_ZONES.length - 1].speed;
}

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

const avatar = new THREE.Group();
const avatarBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1.05, 6, 12),
  new THREE.MeshStandardMaterial({ color: 0x8f877c, roughness: 0.85, metalness: 0.05 })
);
avatarBody.position.y = 1.1;
avatar.add(avatarBody);
const avatarGown = new THREE.Mesh(
  new THREE.CylinderGeometry(0.46, 0.5, 0.9, 12),
  new THREE.MeshStandardMaterial({ color: 0x6f8f86, roughness: 0.9 })
);
avatarGown.position.y = 0.95;
avatar.add(avatarGown);
scene.add(avatar);

const runner = {
  distance: 0, lane: 1, lateral: 0, height: 0, verticalVelocity: 0, sliding: 0,
  vitality: START_VITALITY, balls: START_BALLS, alive: true, invulnerable: 0, slow: 0,
  finished: false, startedAt: 0, heat: 0, lockout: 0, weakened: 0,
  coolant: 0, adrenaline: 0, overchargeShots: 0, barrierShield: 0,
  fireDistance: -45, lookBack: 0, pushing: false, firing: false, fireCooldown: 0,
  hits: 0, shots: 0, breaks: 0,
};

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
  if (!asset) return;
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
    launcher.rig.position.set(0.36, -0.33, -0.62 + launcher.recoil * 0.12);
    launcher.rig.rotation.set(0.04 + launcher.recoil * 0.2, 0.05, 0);
  } else {
    if (launcher.rig.parent !== avatar) avatar.add(launcher.rig);
    launcher.rig.position.set(0.42, 1.62, 0.1 + launcher.recoil * 0.1);
    launcher.rig.rotation.set(launcher.recoil * 0.15, 0, 0);
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
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let warp = { active: false, t: 0 };

const cameraDesired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const smoothedLook = new THREE.Vector3();
const behind = new THREE.Vector3();
let snapCamera = true;
let lastDelta = 1 / 60;

function approach(target, rate) {
  if (snapCamera) camera.position.copy(target);
  else camera.position.lerp(target, 1 - Math.exp(-lastDelta * rate));
}

function updateCamera(dt, time) {
  lastDelta = dt;
  const mode = CAMERA_MODES[cameraMode];
  const r = runner;

  if (mode === "FIRST PERSON") {
    level.route.sample(r.distance + 0.3, r.lateral, 1.65 + r.height - (r.sliding > 0 ? 0.8 : 0), cameraDesired);
    level.route.sample(r.distance + 14, r.lateral * 0.4, 1.5, lookTarget);
    approach(cameraDesired, 22);
  } else if (mode === "CINEMATIC") {
    level.route.sample(r.distance + 8, 5.2, 3.2, cameraDesired);
    level.route.sample(r.distance, r.lateral, 1.4, lookTarget);
    approach(cameraDesired, 3.2);
  } else if (mode === "ORBIT") {
    level.route.sample(r.distance, 0, 0, cameraDesired);
    cameraDesired.x += Math.cos(time * 0.25) * 16;
    cameraDesired.z += Math.sin(time * 0.25) * 16;
    cameraDesired.y += 9;
    level.route.sample(r.distance, 0, 2, lookTarget);
    approach(cameraDesired, 4);
  } else {
    level.route.sample(r.distance - 6.8, r.lateral * 0.6, 2.9 + r.height * 0.6, cameraDesired);
    level.route.sample(r.distance + 12, r.lateral * 0.3, 1.7, lookTarget);
    approach(cameraDesired, 8);
  }

  // A stumble makes you look back at the fire gaining on you - the moment
  // the brief describes. Lasts under a second; reduced motion skips it.
  if (r.lookBack > 0 && !reducedMotion && mode !== "ORBIT") {
    const k = Math.sin(Math.min(1, r.lookBack / 0.9) * Math.PI);
    level.route.sample(Math.max(0, r.fireDistance), 0, 2.5, behind);
    lookTarget.lerp(behind, k);
  }

  if (snapCamera) smoothedLook.copy(lookTarget);
  else smoothedLook.lerp(lookTarget, 1 - Math.exp(-dt * (r.lookBack > 0 ? 6 : 10)));
  camera.lookAt(smoothedLook);

  // Reality warp: roll and up-vector drift, scaled down under reduced motion.
  if (warp.active) {
    const s = Math.sin(Math.min(1, warp.t) * Math.PI) * (reducedMotion ? 0.3 : 1);
    camera.up.lerp(new THREE.Vector3(Math.sin(time * 1.3) * 0.55 * s, 1, Math.cos(time * 0.9) * 0.3 * s).normalize(), Math.min(1, dt * 2));
    camera.rotateZ(Math.sin(time * 2.1) * 0.18 * s);
    camera.fov = 72 + Math.sin(time * 1.7) * 9 * s;
    camera.updateProjectionMatrix();
  } else {
    camera.up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 3));
    if (camera.fov !== 72) {
      camera.fov += (72 - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }
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

function currentPower() {
  if (runner.overchargeShots > 0) return 99;
  return runner.weakened > 0 ? 0.5 : 1;
}

function shoot() {
  if (!runner.alive || runner.finished || !level) return;
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
  const hit = raycaster.intersectObjects(level.breakables, false)[0];
  if (hit) aim.copy(hit.point);
  else aim.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 60);

  launcher.muzzle.getWorldPosition(muzzleWorld);
  fireDir.copy(aim).sub(muzzleWorld).normalize();
  const sample = level.route.sample(runner.distance);
  forwardVel.set(-Math.sin(sample.heading), 0, -Math.cos(sample.heading)).multiplyScalar(currentSpeed);
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
  const result = level.breakTarget(object, ball.power);
  if (!result) return true;
  if (result.partial) {
    if (result.kind === "glass") {
      debris.burst(point, { kind: "glass", count: 8, speed: 3, size: 0.18 });
      audio.glassCrack();
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
      ["Balls left", runner.balls, true],
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Level lifecycle                                                      */
/* ------------------------------------------------------------------ */

let assets = null;

async function loadLevel() {
  if (level) {
    hud.unbind();
    level.dispose();
  }
  projectiles.clear();
  debris.clear();

  level = new MeltdownLevel({ origin: new THREE.Vector3(0, 0, 0) });
  level.addTo(scene);
  hud.bind(level);
  hud.hideSummary();
  hud.show();

  level.events.on("complete", () => finishRun(true, "ROOF ACCESS"));
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
    const near = Math.max(0, 1 - position.distanceTo(avatar.position) / 30);
    trauma = Math.min(1, trauma + near * 0.5);
    audio.crash(0.5 + near * 0.5);
  });
  level.events.on("duct-cleared", () => audio.clang());

  Object.assign(runner, {
    distance: 0, lane: 1, lateral: 0, height: 0, verticalVelocity: 0, sliding: 0,
    vitality: START_VITALITY, balls: START_BALLS, alive: true, invulnerable: 0, slow: 0,
    finished: false, heat: 0, lockout: 0, weakened: 0, coolant: 0, adrenaline: 0,
    overchargeShots: 0, barrierShield: 0, fireDistance: -45, lookBack: 0, pushing: false,
    firing: false, fireCooldown: 0, hits: 0, shots: 0, breaks: 0,
    startedAt: performance.now(),
  });
  trauma = 0;
  warp = { active: false, t: 0 };
  snapCamera = true;
  hud.setVitality(START_VITALITY);
  hud.setBalls(START_BALLS);
  hud.setDanger(0);
  smoothedLook.copy(level.route.sample(14, 0, 1.5).position);

  // Models stream in; the level is playable with stand-ins meanwhile.
  hud.setLoading(0);
  const base = new URL("../assets/meltdown/", import.meta.url).href;
  const loaded = await level.loadAssets(base, { onProgress: (r) => hud.setLoading(r) });
  hud.setLoading(null);
  if (!assets) {
    assets = loaded;
    mountLauncherModel(assets);
  }
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

addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  ui.reticle.style.left = `${event.clientX}px`;
  ui.reticle.style.top = `${event.clientY}px`;
});

addEventListener("pointerdown", (event) => {
  begin();
  if (event.button === 0) {
    runner.firing = true;
    runner.fireCooldown = 0;
  }
});
addEventListener("pointerup", (event) => {
  if (event.button === 0) runner.firing = false;
});

addEventListener("keydown", (event) => {
  begin();
  if (event.code === "KeyA" || event.code === "ArrowLeft") runner.lane = Math.max(0, runner.lane - 1);
  if (event.code === "KeyD" || event.code === "ArrowRight") runner.lane = Math.min(2, runner.lane + 1);
  if (event.code === "Space") {
    event.preventDefault();
    const push = level?.pushNearby(runner.distance);
    if (push) {
      audio.ductPush(push.progress);
      trauma = Math.min(1, trauma + 0.12);
      debris.sparks(avatar.position.clone().setY(1.4), { count: 6, speed: 3 });
    } else if (runner.height <= 0.01) {
      runner.verticalVelocity = 7.6;
    }
  }
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") runner.sliding = 0.65;
  if (event.code === "KeyC") {
    cameraMode = (cameraMode + 1) % CAMERA_MODES.length;
    ui.cameraName.textContent = CAMERA_MODES[cameraMode];
  }
  if (event.code === "KeyB") {
    bloomOn = !bloomOn;
    hud.toast("BLOOM", bloomOn ? "ON" : "OFF", "", 900);
  }
  if (event.code === "KeyF") {
    hud.setDevVisible(hud.dev.hidden);
    if (ui.heatBar) ui.heatBar.hidden = hud.dev.hidden;
  }
  if (event.code === "KeyR") loadLevel();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
});

/* ------------------------------------------------------------------ */
/* Loop                                                                 */
/* ------------------------------------------------------------------ */

let fps = 0;
let fpsAccumulator = 0;
let fpsFrames = 0;
let currentSpeed = 0;

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

  const playing = started && runner.alive && !runner.finished;

  // Forward motion - halted by a fallen duct until it is pushed clear.
  currentSpeed = 0;
  runner.pushing = false;
  if (playing) {
    const progress = runner.distance / level.route.totalLength;
    currentSpeed = speedAt(progress) * (runner.slow > 0 ? 0.45 : 1);
    let next = Math.min(runner.distance + currentSpeed * dt, level.route.totalLength - 1);
    const duct = level.blockingDuctAhead(runner.distance, 4);
    if (duct !== null && next > duct - 1.7) {
      next = Math.max(runner.distance, duct - 1.7);
      runner.pushing = true;
      currentSpeed = 0;
    }
    runner.distance = next;
  }

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

  // Movement.
  runner.lateral += (LANES[runner.lane] - runner.lateral) * Math.min(1, dt * 10);
  runner.verticalVelocity -= 19 * dt;
  runner.height = Math.max(0, runner.height + runner.verticalVelocity * dt);
  if (runner.height <= 0) runner.verticalVelocity = 0;
  runner.sliding = Math.max(0, runner.sliding - dt);

  const placement = level.route.sample(runner.distance, runner.lateral, runner.height);
  avatar.position.copy(placement.position);
  avatar.rotation.y = placement.heading;
  const crouch = runner.sliding > 0;
  avatarBody.scale.y = crouch ? 0.55 : 1;
  avatarBody.position.y = crouch ? 0.62 : 1.1;
  avatarGown.position.y = crouch ? 0.5 : 0.95;
  avatarBody.rotation.z = Math.sin(time * 14) * 0.05 * (currentSpeed > 0 ? 1 : 0);
  const blinking = runner.invulnerable > 0 && Math.floor(time * 14) % 2 === 0;
  const firstPerson = CAMERA_MODES[cameraMode] === "FIRST PERSON";
  avatar.visible = !firstPerson && !blinking;

  level.update({ dt, time, distance: runner.distance, playerPosition: avatar.position });
  if (playing) checkHazards(dt);
  updateCamera(dt, time);
  placeLauncher(firstPerson);
  projectiles.update(dt, { breakables: level.breakables, solids: level.obstacles, onBreakable: onBallBreakable, onSolid: onBallSolid });
  debris.update(dt);

  // Danger: red tint, darker thicker smoke, louder fire and siren.
  const danger = 1 - runner.vitality / START_VITALITY;
  const fireNear = THREE.MathUtils.clamp(1 - (runner.distance - runner.fireDistance) / 45, 0, 1);
  level.setDanger(danger);
  hud.setDanger(Math.max(danger, fireNear * 0.8));
  scene.fog.color.copy(FOG_CALM).lerp(FOG_DANGER, danger);
  scene.background.copy(scene.fog.color);
  scene.fog.density = 0.011 + danger * 0.018 + (warp.active ? 0.01 : 0);
  renderer.toneMappingExposure = BASE_EXPOSURE - danger * 0.25;
  audio.setFireProximity(fireNear);
  audio.setDanger(danger);

  // Reticle: hot over a target, red and pulsing when overheated.
  raycaster.setFromCamera(pointer, camera);
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

  if (bloomOn) composer.render();
  else renderer.render(scene, camera);
}

loadLevel();
ui.cameraName.textContent = CAMERA_MODES[cameraMode];
animate();

globalThis.__meltdown = {
  get level() {
    return level;
  },
  runner,
  hud,
  scene,
  renderer,
  camera,
  audio,
  projectiles,
  debris,
  THREE,
  BEATS,
  begin,
  snapCamera: () => {
    snapCamera = true;
  },
};
