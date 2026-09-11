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
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080c0f);
scene.fog = new THREE.FogExp2(0x0a1013, 0.017);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 320);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/* ------------------------------------------------------------------ */
/* Level and HUD                                                        */
/* ------------------------------------------------------------------ */

let level = null;
const hud = new FoundryHud({ dev: true });

const ui = {
  cameraName: document.querySelector("#cameraName"),
  beatName: document.querySelector("#beatName"),
  reticle: document.querySelector("#reticle"),
};

/* ------------------------------------------------------------------ */
/* Dummy runner                                                         */
/* ------------------------------------------------------------------ */

const LANES = [-3.2, 0, 3.2];
const RUN_SPEED = 9.2;

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
};

/* ------------------------------------------------------------------ */
/* Cameras                                                              */
/* ------------------------------------------------------------------ */

const CAMERA_MODES = ["CHASE", "FIRST PERSON", "CINEMATIC", "ORBIT"];
let cameraMode = 0;

const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const smoothedLook = new THREE.Vector3();

function updateCamera(dt, time) {
  const mode = CAMERA_MODES[cameraMode];
  const here = level.route.sample(runner.distance, runner.lateral, 0);

  if (mode === "FIRST PERSON") {
    level.route.sample(runner.distance + 0.4, runner.lateral, 1.65 + runner.height, cameraDesired);
    level.route.sample(runner.distance + 14, runner.lateral * 0.4, 1.5, lookTarget);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 18));
  } else if (mode === "CINEMATIC") {
    // A corner camera that tracks the runner past the set piece, easing around
    // junctions because it is sampled from the route, not from -Z. Kept inside
    // the corridor wall so it never cuts away to the outside of the level.
    level.route.sample(runner.distance + 7, 4.3, 2.9, cameraDesired);
    lookTarget.copy(here.position).setY(1.4);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 3.2));
  } else if (mode === "ORBIT") {
    const radius = 16;
    level.route.sample(runner.distance, 0, 0, cameraDesired);
    cameraDesired.x += Math.cos(time * 0.25) * radius;
    cameraDesired.z += Math.sin(time * 0.25) * radius;
    cameraDesired.y += 9;
    lookTarget.copy(here.position).setY(2);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 4));
  } else {
    // CHASE. Sampling the camera from a point behind the runner on the same
    // curve is what makes the 90-degree junctions ease instead of snapping.
    level.route.sample(runner.distance - 7.5, runner.lateral * 0.55, 3.1 + runner.height * 0.6, cameraDesired);
    level.route.sample(runner.distance + 12, runner.lateral * 0.3, 1.6, lookTarget);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 7));
  }

  smoothedLook.lerp(lookTarget, 1 - Math.exp(-dt * 9));
  camera.lookAt(smoothedLook);
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

function shoot() {
  if (!runner.alive || !level) return;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(level.breakables, false);
  if (!hits.length) return;
  const result = level.breakTarget(hits[0].object);
  if (result) {
    runner.score += result.points;
    spawnFlash(result.position);
  }
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

const hazardWorld = new THREE.Vector3();
const runnerWorld = new THREE.Vector3();

/**
 * Preview-only proximity check. The real game will use the physics library
 * chosen in the Sprint 1 backlog; this is only here so hazards visibly matter
 * while the level is being tuned.
 */
function checkHazards(dt) {
  if (!runner.alive) return;
  level.route.sample(runner.distance, runner.lateral, 0.9 + runner.height, runnerWorld);

  for (const hazard of level.obstacles) {
    if (hazard.userData.disabled || !hazard.visible) continue;
    hazard.getWorldPosition(hazardWorld);
    if (Math.abs(hazardWorld.z - runnerWorld.z) > 30 && Math.abs(hazardWorld.x - runnerWorld.x) > 30) continue;

    const gap = hazardWorld.distanceTo(runnerWorld);
    const threshold = hazard.userData.barrier === "high" ? 1.5 : 1.7;
    if (gap < threshold && !hazard.userData.cooldown) {
      hazard.userData.cooldown = 0.9;
      runner.integrity -= 18;
      hud.toast("IMPACT", `-18`);
      if (runner.integrity <= 0) {
        runner.integrity = 0;
        runner.alive = false;
        hud.showBanner("RUN TERMINATED", "PRESS R TO RESTART", 6000);
      }
    }
    if (hazard.userData.cooldown) {
      hazard.userData.cooldown = Math.max(0, hazard.userData.cooldown - dt);
    }
  }
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
  });
  level.addTo(scene);
  hud.bind(level);
  hud.setSystems(0);
  hud.show();

  runner.distance = 0;
  runner.lane = 1;
  runner.lateral = 0;
  runner.height = 0;
  runner.verticalVelocity = 0;
  runner.sliding = 0;
  runner.integrity = 100;
  runner.score = 0;
  runner.alive = true;

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
    runner.distance = Math.min(runner.distance + RUN_SPEED * dt, level.route.totalLength - 1);
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
  avatar.visible = CAMERA_MODES[cameraMode] !== "FIRST PERSON";

  level.update({ dt, time, distance: runner.distance, playerPosition: avatar.position });
  checkHazards(dt);
  updateCamera(dt, time);
  updateFlashes(dt);
  updateReticle();

  hud.update({ distance: runner.distance, fps, renderer, level });

  const beat = level.beatAt(runner.distance);
  ui.beatName.textContent = beat ? beat.name : "JUNCTION";

  renderer.render(scene, camera);
}

loadLevel();
ui.cameraName.textContent = CAMERA_MODES[cameraMode];
animate();

// Exposed for console poking during review: __foundry.level, __foundry.runner
globalThis.__foundry = { get level() { return level; }, runner, hud, scene, renderer, BEATS };
