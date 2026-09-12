/**
 * Standalone preview harness for Level 2 - The Shifting Foundry.
 *
 * This exists so the foundry can be built, reviewed, and demonstrated without
 * waiting for the player controller, camera controller, or destruction system
 * to land. Everything in this file is scaffolding: a dummy runner, four camera
 * rigs, and a proximity check standing in for real collision. None of it ships
 * with the level - the level itself is src/levels/foundry/, and the HUD is
 * src/ui/foundry-hud.js.
 *
 * Serve the repository over HTTP and open /preview/foundry.html.
 */

import * as THREE from "../src/three.js";
import { FoundryLevel, BEATS } from "../src/levels/foundry/index.js";
import { FoundryHud } from "../src/ui/foundry-hud.js";

/* ------------------------------------------------------------------ */
/* Renderer and scene                                                   */
/* ------------------------------------------------------------------ */

const canvas = document.querySelector("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
// Cap the render resolution at 1 device pixel per CSS pixel.
//
// Measured on an AMD Radeon integrated GPU at 1280x720: the level is
// fill-rate bound, not geometry bound - frame rate barely moved between a
// 238-draw-call scene and an 82-draw-call one, but tracked resolution almost
// exactly. At devicePixelRatio 1.25 it ran at 31 fps; at 1.0 it runs at 41-49.
// On a HiDPI laptop the uncapped ratio would be 2, which is four times the
// pixels of this test for no visible gain at running speed.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
// Fog thinned from 0.017: at the old density the corridor faded to black about
// 40m out, which hid the gates and junctions the player needs to read early.
scene.background = new THREE.Color(0x121a20);
scene.fog = new THREE.FogExp2(0x141d23, 0.0115);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 320);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/* ------------------------------------------------------------------ */
/* Level and HUD                                                        */
/* ------------------------------------------------------------------ */

let level = null;
const hud = new FoundryHud({ dev: true });

/**
 * Overall light level, adjustable live with [ and ]. Persisted per browser so
 * a value you like survives a reload while you are tuning the sector.
 */
let brightness = 1.6;
try {
  const saved = Number(localStorage.getItem("foundry-brightness"));
  if (Number.isFinite(saved) && saved > 0) brightness = saved;
} catch {
  /* private window or blocked storage - the default is fine */
}

function setBrightness(value) {
  brightness = Math.max(0.4, Math.min(2.6, Number(value.toFixed(2))));
  level?.setBrightness(brightness);
  try {
    localStorage.setItem("foundry-brightness", String(brightness));
  } catch {
    /* ignore */
  }
  hud.toast("BRIGHTNESS", brightness.toFixed(1));
}

const ui = {
  cameraName: document.querySelector("#cameraName"),
  beatName: document.querySelector("#beatName"),
  reticle: document.querySelector("#reticle"),
};

/* ------------------------------------------------------------------ */
/* Dummy runner                                                         */
/* ------------------------------------------------------------------ */

const LANES = [-3.2, 0, 3.2];

/**
 * Speed is set in three zones rather than one continuous ramp.
 *
 *   first half        6.8 m/s   room to read the corridor and learn it
 *   to three quarters 9.0 m/s   pressure comes on
 *   final quarter    11.6 m/s   the escape, and the fastest the level gets
 *
 * Blended over a short distance at each boundary so the change is felt as
 * acceleration rather than a gear shift. The top speed sits just under the
 * old flat-out 13.2, which was too quick to read the lane ahead.
 */
const SPEED_ZONES = [
  { until: 0.5, speed: 6.8 },
  { until: 0.75, speed: 9.0 },
  { until: 1.01, speed: 11.6 },
];
const SPEED_BLEND = 0.04;

function speedAt(progress) {
  let previous = SPEED_ZONES[0].speed;
  let from = 0;

  for (const zone of SPEED_ZONES) {
    if (progress < zone.until) {
      // ease in over the first slice of the zone
      const into = (progress - from) / SPEED_BLEND;
      if (into < 1 && from > 0) {
        const t = THREE.MathUtils.smoothstep(into, 0, 1);
        return THREE.MathUtils.lerp(previous, zone.speed, t);
      }
      return zone.speed;
    }
    previous = zone.speed;
    from = zone.until;
  }
  return SPEED_ZONES[SPEED_ZONES.length - 1].speed;
}

/** A miss breaks the chain, so spheres are worth spending carefully. */
const COMBO_WINDOW = 2.6;
const START_SPHERES = 20;
const MAX_SPHERES = 25;

/**
 * At zero spheres, one is issued every few seconds.
 *
 * Without it a player with poor aim can arrive at a mandatory route switch
 * with nothing to shoot it with, and the level becomes literally impossible -
 * not hard, unfinishable. The trickle is slow enough to still hurt.
 */
const SPHERE_RECHARGE = 4;

const avatar = new THREE.Group();
const avatarBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.42, 1.05, 6, 12),
  new THREE.MeshStandardMaterial({ color: 0xe7f9fa, roughness: 0.3, metalness: 0.45 })
);
avatarBody.position.y = 1.1;
avatarBody.castShadow = true;
avatar.add(avatarBody);
const avatarPack = new THREE.Mesh(
  new THREE.BoxGeometry(0.65, 0.8, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x254854, metalness: 0.75, roughness: 0.26 })
);
avatarPack.position.set(0, 1.2, 0.42);
avatar.add(avatarPack);
scene.add(avatar);

const runner = {
  distance: 0,
  lane: 1,
  lateral: 0,
  height: 0,
  verticalVelocity: 0,
  sliding: 0,
  integrity: 100,
  score: 0,
  alive: true,
  invulnerable: 0,
  slow: 0,
  spheres: START_SPHERES,
  combo: 1,
  comboTimer: 0,
  maxCombo: 1,
  cells: 0,
  nearMisses: 0,
  shots: 0,
  breaks: 0,
  startedAt: 0,
  finished: false,
  rechargeTimer: 0,
};

/** Meshes recently credited as a near miss, so one gap pays out once. */
const grazeCooldown = new Map();

/* ------------------------------------------------------------------ */
/* Cameras                                                              */
/* ------------------------------------------------------------------ */

const CAMERA_MODES = ["CHASE", "FIRST PERSON", "CINEMATIC", "ORBIT"];
let cameraMode = 0;

/**
 * Camera shake, trauma-style: hits add trauma, trauma decays on its own, and
 * the actual shake is trauma squared. Squaring is what makes a big hit feel
 * violent and the tail end settle quickly instead of buzzing.
 */
let trauma = 0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function applyShake(dt) {
  trauma = Math.max(0, trauma - dt * 1.5);
  if (trauma <= 0.001) return;
  const amount = trauma * trauma * (reducedMotion ? 0.25 : 1);
  camera.position.x += (Math.random() * 2 - 1) * amount * 0.6;
  camera.position.y += (Math.random() * 2 - 1) * amount * 0.5;
  camera.position.z += (Math.random() * 2 - 1) * amount * 0.3;
  camera.rotateZ((Math.random() * 2 - 1) * amount * 0.07);
}

const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const smoothedLook = new THREE.Vector3();
const swingSample = new THREE.Vector3();

/** Lateral offset that pushes the chase camera to the outside of a turn. */
let swing = 0;

/**
 * Set to skip the camera's smoothing for one frame.
 *
 * The rig eases toward its target, which is right during play and wrong after
 * a jump: on a restart, or when a tool drops the runner somewhere else, the
 * camera crawls across the level from wherever it was. On a slow machine that
 * takes long enough to leave it outside the corridor entirely.
 */
let snapCamera = true;

/** Current chase boom length, shortened when the view is obstructed. */
let boomLength = 7.5;
const BOOM_MAX = 7.5;
const BOOM_MIN = 2.2;
const boomRay = new THREE.Raycaster();
const boomFrom = new THREE.Vector3();
const boomTo = new THREE.Vector3();
const boomDir = new THREE.Vector3();

/**
 * Cast back along the boom from the player. If a hazard is in the way - most
 * often one of Beat C's closing gates as the player passes through it - pull
 * the camera in front of it instead of letting it end up inside the slab.
 * Snaps in quickly, eases back out slowly, which is the standard behaviour and
 * avoids the camera pumping in and out around thin geometry.
 */
function chaseBoom(dt) {
  level.route.sample(runner.distance, runner.lateral, 1.6, boomFrom);
  level.route.sample(runner.distance - BOOM_MAX, runner.lateral * 0.55 + swing, 3.1, boomTo);
  boomDir.copy(boomTo).sub(boomFrom);
  const span = boomDir.length();
  boomDir.normalize();

  boomRay.set(boomFrom, boomDir);
  boomRay.far = span;
  const blockers = boomRay.intersectObjects(level.obstacles, false);

  const wanted = blockers.length
    ? Math.max(BOOM_MIN, Math.min(BOOM_MAX, blockers[0].distance - 0.5))
    : BOOM_MAX;

  const rate = wanted < boomLength ? 18 : 2.5;
  boomLength += (wanted - boomLength) * Math.min(1, dt * rate);
  return boomLength;
}

/**
 * Ease the camera toward a target, or jump straight to it when `snapCamera` is
 * set. `rate` is the exponential rate, so the easing is frame-rate independent.
 */
function approach(target, rate) {
  if (snapCamera) camera.position.copy(target);
  else camera.position.lerp(target, 1 - Math.exp(-lastDelta * rate));
}

let lastDelta = 1 / 60;

function updateCamera(dt, time) {
  lastDelta = dt;
  const mode = CAMERA_MODES[cameraMode];
  const here = level.route.sample(runner.distance, runner.lateral, 0);

  if (mode === "FIRST PERSON") {
    level.route.sample(runner.distance + 0.4, runner.lateral, 1.65 + runner.height, cameraDesired);
    level.route.sample(runner.distance + 14, runner.lateral * 0.4, 1.5, lookTarget);
    approach(cameraDesired, 18);
  } else if (mode === "CINEMATIC") {
    // A corner camera that tracks the runner past the set piece, easing around
    // junctions because it is sampled from the route, not from -Z. Kept inside
    // the corridor wall so it never cuts away to the outside of the level.
    level.route.sample(runner.distance + 7, 4.3, 2.9, cameraDesired);
    lookTarget.copy(here.position).setY(1.4);
    approach(cameraDesired, 3.2);
  } else if (mode === "ORBIT") {
    const radius = 16;
    level.route.sample(runner.distance, 0, 0, cameraDesired);
    cameraDesired.x += Math.cos(time * 0.25) * radius;
    cameraDesired.z += Math.sin(time * 0.25) * radius;
    cameraDesired.y += 9;
    lookTarget.copy(here.position).setY(2);
    approach(cameraDesired, 4);
  } else {
    // CHASE. Sampling the camera from a point behind the runner on the same
    // curve is what makes the 90-degree junctions ease instead of snapping.
    //
    // Two corrections on top of that:
    //
    // 1. Swing wide through turns. A boom straight back from the player cuts
    //    the corner on a 9m-radius arc and ends up pressed against the inside
    //    wall, which fills half the frame with unlit metal.
    const behind = level.route.sample(runner.distance - 7.5, 0, 0, swingSample).heading;
    const ahead = level.route.sample(runner.distance, 0, 0, swingSample).heading;
    let turn = ahead - behind;
    // positive heading change = turning left, so the outside of the curve is
    // to the player's right, which is positive lateral
    swing += (Math.sign(turn) * Math.min(1, Math.abs(turn) * 2.4) * 2.8 - swing) * Math.min(1, dt * 3);

    // 2. Shorten the boom when something solid is between camera and player,
    //    or a closing gate swallows the camera as the player passes through it.
    const boom = chaseBoom(dt);

    level.route.sample(runner.distance - boom, runner.lateral * 0.55 + swing, 3.1 + runner.height * 0.6, cameraDesired);
    level.route.sample(runner.distance + 12, runner.lateral * 0.3, 1.6, lookTarget);
    approach(cameraDesired, 7);
  }

  if (snapCamera) smoothedLook.copy(lookTarget);
  else smoothedLook.lerp(lookTarget, 1 - Math.exp(-dt * 9));

  camera.lookAt(smoothedLook);
  applyShake(dt);
  snapCamera = false;
}

/* ------------------------------------------------------------------ */
/* Shooting                                                             */
/* ------------------------------------------------------------------ */

const flashes = [];
const flashGeometry = new THREE.RingGeometry(0.3, 0.55, 18);

function spawnFlash(position) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x7ef4f1,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(flashGeometry, material);
  ring.position.copy(position);
  ring.lookAt(camera.position);
  scene.add(ring);
  flashes.push({ ring, material, life: 0 });
}

function updateFlashes(dt) {
  for (let i = flashes.length - 1; i >= 0; i -= 1) {
    const flash = flashes[i];
    flash.life += dt;
    const t = flash.life / 0.45;
    flash.ring.scale.setScalar(1 + t * 4);
    flash.material.opacity = Math.max(0, 1 - t);
    if (t >= 1) {
      scene.remove(flash.ring);
      flash.material.dispose();
      flashes.splice(i, 1);
    }
  }
}

function bumpCombo() {
  runner.combo = Math.min(9, runner.combo + 1);
  runner.maxCombo = Math.max(runner.maxCombo, runner.combo);
  runner.comboTimer = COMBO_WINDOW;
}

function shoot() {
  if (!runner.alive || runner.finished || !level) return;

  if (runner.spheres <= 0) {
    hud.toast("NO SPHERES", "");
    return;
  }

  runner.spheres -= 1;
  runner.shots += 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(level.breakables, false);
  const result = hits.length ? level.breakTarget(hits[0].object) : null;

  if (!result) {
    // A miss costs the sphere and the chain. That is what gives each shot
    // weight - without it, spraying at the corridor is free.
    runner.combo = 1;
    runner.comboTimer = 0;
    return;
  }

  runner.score += result.points * runner.combo;
  runner.spheres = Math.min(MAX_SPHERES, runner.spheres + (result.spheres ?? 0));
  runner.breaks += 1;
  if (result.kind === "cell") runner.cells += 1;
  bumpCombo();
  spawnFlash(result.position);
}

/** Reticle turns cyan when a breakable switch is under the cursor. */
function updateReticle() {
  if (!level) return;
  raycaster.setFromCamera(pointer, camera);
  const hot = raycaster.intersectObjects(level.breakables, false).length > 0;
  ui.reticle.classList.toggle("hot", hot);
}

/* ------------------------------------------------------------------ */
/* Stand-in collision                                                   */
/* ------------------------------------------------------------------ */

const playerBox = new THREE.Box3();
const playerCentre = new THREE.Vector3();
const playerSize = new THREE.Vector3();

/** Player bounds: a box roughly the size of the avatar, shorter while sliding. */
function updatePlayerBox() {
  const crouched = runner.sliding > 0;
  const height = crouched ? 1.0 : 1.9;
  // Start the box just above the floor. A box sitting flat on y=0 collides
  // with anything flush with the floor, including a retracted floor piston.
  const FOOT = 0.18;
  level.route.sample(runner.distance, runner.lateral, runner.height, playerCentre);
  playerCentre.y += FOOT + height / 2;
  playerSize.set(0.9, height, 0.9);
  playerBox.setFromCenterAndSize(playerCentre, playerSize);
}

const HAZARD_NAMES = { low: "BARRIER", high: "LOW CLEARANCE" };

/**
 * Collision against the level's own hazards.
 *
 * The level does the geometry (see FoundryLevel.collide); the preview decides
 * what a hit costs, because damage and integrity belong to the player
 * workstream, not to the environment. When the real physics library lands this
 * function is what gets replaced - the level side stays as it is.
 */
function checkHazards(dt) {
  runner.invulnerable = Math.max(0, runner.invulnerable - dt);
  runner.slow = Math.max(0, runner.slow - dt);
  for (const [mesh, left] of grazeCooldown) {
    if (left - dt <= 0) grazeCooldown.delete(mesh);
    else grazeCooldown.set(mesh, left - dt);
  }
  if (!runner.alive || runner.finished) return;

  updatePlayerBox();
  const { hits, grazes } = level.probe(playerBox, runner.distance);

  // Near miss: threading a gap pays, so cutting it fine is a decision rather
  // than just a thing that did not go wrong.
  for (const mesh of grazes) {
    if (grazeCooldown.has(mesh)) continue;
    grazeCooldown.set(mesh, 1.4);
    runner.nearMisses += 1;
    runner.score += 25 * runner.combo;
    if (runner.combo > 1) runner.comboTimer = COMBO_WINDOW;
    hud.toast("NEAR MISS", `+${25 * runner.combo}`, 1100);
  }

  if (!hits.length || runner.invulnerable > 0) return;

  const hazard = hits[0];
  runner.integrity = Math.max(0, runner.integrity - 18);

  // A mercy window, so brushing along one long gate is a single hit rather
  // than a death sentence, and a moment of lost speed so the hit costs
  // something beyond a number.
  runner.invulnerable = 1.1;
  runner.slow = 0.55;

  trauma = Math.min(1, trauma + 0.8);
  level.impact(1);
  hud.setIntegrity(runner.integrity);

  // An impact breaks the chain too, so the combo is a record of a clean run,
  // not just of accurate shooting.
  runner.combo = 1;
  runner.comboTimer = 0;

  const label = HAZARD_NAMES[hazard.userData.barrier] ?? (hazard.userData.piston ? "PISTON" : "GATE");
  hud.toast(label, "-18");

  if (runner.integrity <= 0) {
    runner.alive = false;
    trauma = 1;
    finishRun(false, "HULL BREACHED");
  }
}

/* ------------------------------------------------------------------ */
/* End of run                                                           */
/* ------------------------------------------------------------------ */

function finishRun(survived, title) {
  if (runner.finished) return;
  runner.finished = true;
  runner.alive = false;

  // Clearing the sector shows no summary card. The player is meant to run
  // straight into the extraction lift and ride it to Level 3, so a card here
  // would interrupt the one transition the game is built around. The card is
  // kept for failure, where the run genuinely has ended and there is nothing
  // to carry forward.
  if (survived) {
    hud.showBanner("SECTOR 02 CLEARED", "EXTRACTION LIFT", 6000);
    return;
  }

  const seconds = (performance.now() - runner.startedAt) / 1000;
  const accuracy = runner.shots ? Math.round((runner.breaks / runner.shots) * 100) : 0;
  const total = Math.round(runner.score);

  hud.showSummary({
    title,
    failed: !survived,
    rows: [
      ["Time", `${seconds.toFixed(1)}s`],
      ["Cells broken", runner.cells],
      ["Near misses", runner.nearMisses],
      ["Best combo", `x${runner.maxCombo}`],
      ["Accuracy", `${Math.max(0, Math.min(100, accuracy))}%`],
      ["Systems restored", `${level.state.systemsOnline} / 3`],
      ["Distance", `${Math.round(runner.distance)} / ${Math.round(level.route.totalLength)}m`],
      ["Score", String(total).padStart(6, "0"), true],
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Level lifecycle                                                      */
/* ------------------------------------------------------------------ */

function loadLevel() {
  if (level) {
    hud.unbind();
    level.dispose();
  }

  level = new FoundryLevel({
    origin: new THREE.Vector3(0, 0, 0),
    shadows: true,
    brightness, // tune live with [ and ]
    // The escape countdown is derived from this. Beat C sits in the final
    // speed zone, so that is the speed the timer has to be fair against.
    runSpeed: SPEED_ZONES[SPEED_ZONES.length - 1].speed,
  });
  level.addTo(scene);
  hud.bind(level);
  hud.setSystems(0);
  hud.hideSummary();
  hud.show();

  level.events.on("complete", () => finishRun(true, "FOUNDRY CLEARED"));
  level.events.on("escape-end", ({ survived }) => {
    if (!survived) finishRun(false, "CONTAINMENT LOST");
  });

  runner.distance = 0;
  runner.lane = 1;
  runner.lateral = 0;
  runner.height = 0;
  runner.verticalVelocity = 0;
  runner.sliding = 0;
  runner.integrity = 100;
  runner.score = 0;
  runner.alive = true;
  runner.invulnerable = 0;
  runner.slow = 0;
  runner.spheres = START_SPHERES;
  runner.combo = 1;
  runner.comboTimer = 0;
  runner.maxCombo = 1;
  runner.cells = 0;
  runner.nearMisses = 0;
  runner.shots = 0;
  runner.breaks = 0;
  runner.finished = false;
  runner.rechargeTimer = 0;
  runner.startedAt = performance.now();
  grazeCooldown.clear();
  trauma = 0;
  swing = 0;
  boomLength = BOOM_MAX;
  snapCamera = true;
  hud.setIntegrity(100);
  hud.setRun({ score: 0, combo: 1, spheres: START_SPHERES, comboRatio: 0 });

  smoothedLook.copy(level.route.sample(14, 0, 1.5).position);
}

/* ------------------------------------------------------------------ */
/* Input                                                                */
/* ------------------------------------------------------------------ */

addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  ui.reticle.style.left = `${event.clientX}px`;
  ui.reticle.style.top = `${event.clientY}px`;
});

addEventListener("pointerdown", (event) => {
  if (event.button === 0) shoot();
});

addEventListener("keydown", (event) => {
  if (event.code === "KeyA" || event.code === "ArrowLeft") runner.lane = Math.max(0, runner.lane - 1);
  if (event.code === "KeyD" || event.code === "ArrowRight") runner.lane = Math.min(2, runner.lane + 1);
  if (event.code === "Space" && runner.height <= 0.01) {
    runner.verticalVelocity = 7.4;
    event.preventDefault();
  }
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") runner.sliding = 0.65;
  if (event.code === "KeyC") {
    cameraMode = (cameraMode + 1) % CAMERA_MODES.length;
    ui.cameraName.textContent = CAMERA_MODES[cameraMode];
  }
  if (event.code === "KeyF") hud.setDevVisible(hud.dev.hidden);
  if (event.code === "KeyR") loadLevel();
  if (event.code === "BracketRight") setBrightness(brightness + 0.2);
  if (event.code === "BracketLeft") setBrightness(brightness - 0.2);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

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

  // FPS, averaged over half a second so the number is readable.
  fpsAccumulator += dt;
  fpsFrames += 1;
  if (fpsAccumulator >= 0.5) {
    fps = fpsFrames / fpsAccumulator;
    fpsAccumulator = 0;
    fpsFrames = 0;
  }

  if (runner.alive) {
    const progress = runner.distance / level.route.totalLength;
    const speed = speedAt(progress) * (runner.slow > 0 ? 0.45 : 1);
    runner.distance = Math.min(runner.distance + speed * dt, level.route.totalLength - 1);
  }

  // Combo decays on its own; the bar under it shows the window closing.
  if (runner.comboTimer > 0) {
    runner.comboTimer = Math.max(0, runner.comboTimer - dt);
    if (runner.comboTimer === 0) runner.combo = 1;
  }

  // Emergency sphere trickle, so a dry player is never stuck at a switch.
  if (runner.alive && !runner.finished && runner.spheres <= 0) {
    runner.rechargeTimer += dt;
    if (runner.rechargeTimer >= SPHERE_RECHARGE) {
      runner.rechargeTimer = 0;
      runner.spheres += 1;
      hud.toast("SPHERE RECHARGED", "+1", 1400);
    }
  } else {
    runner.rechargeTimer = 0;
  }

  // Lane easing, jump arc, and slide crouch.
  runner.lateral += (LANES[runner.lane] - runner.lateral) * Math.min(1, dt * 9);
  runner.verticalVelocity -= 19 * dt;
  runner.height = Math.max(0, runner.height + runner.verticalVelocity * dt);
  if (runner.height <= 0) runner.verticalVelocity = 0;
  runner.sliding = Math.max(0, runner.sliding - dt);

  const placement = level.route.sample(runner.distance, runner.lateral, runner.height);
  avatar.position.copy(placement.position);
  avatar.rotation.y = placement.heading;
  avatarBody.scale.y = runner.sliding > 0 ? 0.55 : 1;
  avatarBody.position.y = runner.sliding > 0 ? 0.62 : 1.1;
  // Blink through the mercy window so the player can see they are briefly safe.
  const blinking = runner.invulnerable > 0 && Math.floor(time * 14) % 2 === 0;
  avatar.visible = CAMERA_MODES[cameraMode] !== "FIRST PERSON" && !blinking;

  level.update({ dt, time, distance: runner.distance, playerPosition: avatar.position });
  checkHazards(dt);
  updateCamera(dt, time);
  updateFlashes(dt);
  updateReticle();

  hud.update({ distance: runner.distance, fps, renderer, level });
  hud.setRun({
    score: runner.score,
    combo: runner.combo,
    spheres: runner.spheres,
    comboRatio: runner.comboTimer / COMBO_WINDOW,
  });

  const beat = level.beatAt(runner.distance);
  ui.beatName.textContent = beat ? beat.name : "JUNCTION";

  renderer.render(scene, camera);
}

loadLevel();
ui.cameraName.textContent = CAMERA_MODES[cameraMode];
animate();

// Exposed for console poking during review: __foundry.level, __foundry.runner
globalThis.__foundry = {
  get level() { return level; },
  runner, hud, scene, renderer, camera, THREE, BEATS,
  /** Jump the camera to its target instead of easing - used after a teleport. */
  snapCamera: () => { snapCamera = true; },
};
