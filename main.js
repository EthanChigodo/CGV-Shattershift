import * as THREE from "./src/three.js";
import { FoundryLevel } from "./src/levels/foundry/index.js";
import { FoundryHud } from "./src/ui/foundry-hud.js";
import { CausewayLevel, LAYERS, ROUTE as CAUSEWAY_ROUTE } from "./src/levels/causeway/index.js";
import { CausewayHud, HUD_PANELS, applyHudPanels } from "./src/ui/causeway-hud.js";
import { PostFX } from "./src/fx/postfx.js";
import { Minimap } from "./src/fx/minimap.js";
import { PhotoMode } from "./src/fx/photo-mode.js";
import { Arsenal, BALLS, SERUMS } from "./src/systems/arsenal.js";
import { MissionTracker, loadProgress } from "./src/systems/missions.js";

const canvas = document.querySelector("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
// Shadows: one map, rendered once per frame by the post pipeline rather than
// once per render call (the reflection probe and minimap render too).
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
// Draw calls are summed across every render call in a frame, then reset.
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x140b09);
scene.fog = new THREE.FogExp2(0x140b09, 0.032);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 150);
// The main camera sees the world, glass, and effects layers - never the
// minimap icons.
camera.layers.enable(LAYERS.GLASS);
camera.layers.enable(LAYERS.FX);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
raycaster.layers.enableAll();
const pointer = new THREE.Vector2();
const lanes = [-3.2, 0, 3.2];
const breakables = [];
const structural = [];
const RENDER_AHEAD = 95;
const RENDER_BEHIND = 15;
const projectiles = [];
const shards = [];
const obstacles = [];
let state = "intro";
let lane = 1;
let playerX = 0;
let runZ = 7;
let ammo = 12;
let health = 100;
let score = 0;
let cameraThird = false;
let liftTimer = 0;
let messageTimer = 0;
let currentLevel = 1;
let transitionTarget = 0;
let heightLane = 0;
let playerY = 0;
let paused = false;
let launchTimer = 0;
let captionIndex = -1;
let settingsFrom = null;
let shake = 0;
// Jump and slide. Level 2's barriers need them: a low barrier is hurdled and a
// high one is slid under, and each is cleared by exactly one of the two.
let jumpVelocity = 0;
let jumpHeight = 0;
let sliding = 0;
/**
 * Set when the player is teleported - a demo jump, or arriving in a sector that
 * lives elsewhere in world space. The chase camera eases toward its target,
 * which crawls across hundreds of metres after a jump and leaves the player
 * staring at the level from outside it.
 */
let snapCamera = true;


const settingsDefaults = {
  sensitivity: 100, aimAssist: true, reducedMotion: false, quality: "auto",
  // Which HUD panels are shown. See HUD_PANELS in src/ui/causeway-hud.js.
  hud: Object.fromEntries(HUD_PANELS.map((p) => [p.key, p.on])),
};
let settings = { ...settingsDefaults };
try {
  const saved = JSON.parse(localStorage.getItem("fractureRunSettings"));
  if (saved) settings = { ...settingsDefaults, ...saved, hud: { ...settingsDefaults.hud, ...(saved.hud ?? {}) } };
} catch (error) {}

function saveSettings() {
  try { localStorage.setItem("fractureRunSettings", JSON.stringify(settings)); } catch (error) {}
}

// Sound and voice are out of scope for this build (another team member owns
// audio). Levels emit events - "explosion", "lock", "lift-enter", ... - for the
// audio workstream to hook into.

const $ = (selector) => document.querySelector(selector);
const ui = {
  level: $("#level"), ammo: $("#ammo"), health: $("#health"), score: $("#score"),
  camera: $("#cameraMode"), reticle: $("#reticle"), message: $("#message"), caption: $("#caption"),
  launchControls: $("#launchControls"),
  story: $("#storyScreen"), storyLine: $("#storyLine"),
  storyPrompt: $("#storyPrompt"), storyPlayer: $("#storyPlayer"),
  storyDots: $("#storyDots"), storySkipButton: $("#storySkipButton"),
  start: $("#startScreen"), end: $("#endScreen"), final: $("#finalScore"),
  endEyebrow: $("#endEyebrow"), endTitle: $("#endTitle"), endText: $("#endText"), endStats: $("#endStats"),
  pause: $("#pauseScreen"), pauseLevel: $("#pauseLevel"), pauseScore: $("#pauseScore"),
  pauseAmmo: $("#pauseAmmo"), pauseHealth: $("#pauseHealth"), pauseMissions: $("#pauseMissions"),
  settings: $("#settingsScreen"),
  settingsBackButton: $("#settingsBackButton"),
  sensitivitySlider: $("#sensitivitySlider"), reducedMotionToggle: $("#reducedMotionToggle"),
  aimAssistToggle: $("#aimAssistToggle"),
  viewButton: $("#viewButton"), viewMenu: $("#viewMenu"), briefing: $("#briefingMissions"),
  qualitySelect: $("#qualitySelect"),
  manual: $("#manualScreen"), previewBar: $("#previewBar"), fade: $("#fadeOverlay"),
  endlessButton: $("#endlessButton"), progressLine: $("#progressLine"),
};

function applySettingsToControls() {
  ui.sensitivitySlider.value = settings.sensitivity;
  ui.aimAssistToggle.checked = settings.aimAssist;
  ui.reducedMotionToggle.checked = settings.reducedMotion;
  ui.qualitySelect.value = settings.quality;
  for (const input of document.querySelectorAll("[data-hud-key]")) input.checked = !!settings.hud[input.dataset.hudKey];
  applyHudPanels(settings.hud);
}

/** Build the HUD panel checkboxes into every [data-hud-toggles] container. */
function buildHudToggles() {
  for (const container of document.querySelectorAll("[data-hud-toggles]")) {
    container.innerHTML = HUD_PANELS.map((p) => `
      <label class="setting-row toggle-row"><span>${p.label}</span><input type="checkbox" data-hud-key="${p.key}" /></label>`).join("");
  }
  for (const input of document.querySelectorAll("[data-hud-key]")) {
    input.addEventListener("change", () => {
      settings.hud[input.dataset.hudKey] = input.checked;
      saveSettings();
      applySettingsToControls();
    });
  }
}
buildHudToggles();
applySettingsToControls();

// Named so Level 2 can dim it - the foundry brings its own lighting.
const hemi = new THREE.HemisphereLight(0xffd0a0, 0x2a1510, 1.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe4c4, 2.5);
sun.position.set(-8, 16, 12);
scene.add(sun);

/* -------------------------------------------------------------------- */
/* Shared route geometry (Level 3 runs on it)                            */
/* -------------------------------------------------------------------- */
// Level 1's old greybox panes, walls, and lift lived here. Level 1 is now
// src/levels/causeway/, built in its own world space, so only the pieces
// Level 3 still uses remain.

const floorMaterial = new THREE.MeshPhysicalMaterial({ color: 0x4a2318, roughness: 0.25, metalness: 0.45, transparent: true, opacity: 0.72 });
const slabGeo = new THREE.BoxGeometry(10.8, 0.2, 7.3);
const slabEdgeGeo = new THREE.EdgesGeometry(slabGeo);
const slabEdgeMat = new THREE.LineBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.32 });
for (let z = 4; z > -438; z -= 8) {
  const slab = new THREE.Mesh(slabGeo, floorMaterial);
  slab.position.set(0, -0.2, z);
  scene.add(slab); structural.push(slab);
  const edge = new THREE.LineSegments(slabEdgeGeo, slabEdgeMat);
  edge.position.copy(slab.position); scene.add(edge); structural.push(edge);
}

const railMat = new THREE.MeshStandardMaterial({ color: 0x35241c, metalness: 0.75, roughness: 0.26 });
for (const side of [-5.2, 5.2]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 442), railMat);
  rail.position.set(side, 1.1, -216); scene.add(rail);
}

const archGeo = new THREE.BoxGeometry(0.24, 6, 0.24);
const archTopGeo = new THREE.BoxGeometry(10.4, .24, .24);
for (let z = 0; z > -438; z -= 12) {
  for (const x of [-5.1, 5.1]) { const p = new THREE.Mesh(archGeo, railMat); p.position.set(x, 2.8, z); scene.add(p); structural.push(p); }
  const top = new THREE.Mesh(archTopGeo, railMat); top.position.set(0, 5.7, z); scene.add(top); structural.push(top);
}

const starGeo = new THREE.BufferGeometry();
const starData = new Float32Array(900);
for (let i = 0; i < starData.length; i += 3) { starData[i] = (Math.random() - .5) * 90; starData[i+1] = Math.random() * 40; starData[i+2] = -Math.random() * 210; }
starGeo.setAttribute("position", new THREE.BufferAttribute(starData, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffcf9a, size: .08, transparent: true, opacity: .5 })));

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffb26b, transparent: true, opacity: .58, roughness: .06, metalness: .05, emissive: 0x4a1d0a, emissiveIntensity: .55 });
const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xffb04a, roughness: .15, metalness: .1, emissive: 0xb35a10, emissiveIntensity: 1.2 });
const hazardMat = new THREE.MeshStandardMaterial({ color: 0x8a2f2f, roughness: .28, metalness: .68, emissive: 0x4a0f0f, emissiveIntensity: .6 });

const paneGeo = new THREE.BoxGeometry(2.25, 3.8, .18);
const paneWideGeo = new THREE.BoxGeometry(2.8, 3.8, .18);
const crystalGeo = new THREE.OctahedronGeometry(.65, 0);
const hazardGeo = new THREE.BoxGeometry(2.4, 2.7, 1);
let buildLevel = 3;

function addPane(x, z, wide = false) {
  const mesh = new THREE.Mesh(wide ? paneWideGeo : paneGeo, glassMat.clone());
  mesh.position.set(x, 1.9, z); mesh.userData = { kind: "pane", alive: true, points: 150, level: buildLevel };
  scene.add(mesh); breakables.push(mesh); obstacles.push(mesh); return mesh;
}

function addCrystal(x, y, z) {
  const mesh = new THREE.Mesh(crystalGeo, crystalMat.clone());
  mesh.position.set(x, y, z); mesh.rotation.z = Math.PI / 4; mesh.userData = { kind: "crystal", alive: true, points: 250, level: buildLevel };
  scene.add(mesh); breakables.push(mesh); return mesh;
}

function addHazard(x, z) {
  const mesh = new THREE.Mesh(hazardGeo, hazardMat);
  mesh.position.set(x, 1.35, z); mesh.userData = { kind: "hazard", hit: false, level: buildLevel };
  scene.add(mesh); obstacles.push(mesh);
  return mesh;
}

function addLift(z) {
  const group = new THREE.Group(); group.position.z = z;
  const liftFloor = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, .4, 8), railMat); liftFloor.position.y = .05; group.add(liftFloor);
  for (const x of [-4.3, 4.3]) { const wall = new THREE.Mesh(new THREE.BoxGeometry(.22, 6.8, 8.4), glassMat); wall.position.set(x, 3.4, 0); group.add(wall); }
  const gate = new THREE.Mesh(new THREE.BoxGeometry(6.5, 5.5, .24), glassMat); gate.position.set(0, 2.75, -3.8); group.add(gate);
  scene.add(group); structural.push(group); return group;
}
// The Level 2 -> 3 lift. The Level 1 -> 2 lift is part of the Causeway.
addLift(-282);

const energyUniforms = { uTime: { value: 0 }, uLift: { value: 0 } };
const energyMat = new THREE.ShaderMaterial({
  uniforms: energyUniforms, transparent: true, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vUv; varying float vWave; uniform float uTime; void main(){vUv=uv; vec3 p=position; vWave=sin(p.y*3.0+uTime*4.0)*0.06; p.x+=vWave; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
  fragmentShader: `varying vec2 vUv; varying float vWave; uniform float uTime; uniform float uLift; void main(){float band=0.45+0.45*sin(vUv.y*28.0-uTime*5.0); float edge=pow(abs(vUv.x-.5)*2.0,3.0); vec3 col=mix(vec3(.45,.12,.04),vec3(1.0,.62,.25),band+uLift*.25); gl_FragColor=vec4(col,(.18+band*.42+edge*.25));}`
});
for (const z of [-282, -430]) { const core = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, 7, 20, 1, true), energyMat); core.position.set(0, 3.5, z); scene.add(core); structural.push(core); }

// Level 3: fractured rings, vertical lanes, and a reactor suspended in an open storm sky.
const ringMat = new THREE.MeshStandardMaterial({ color: 0x1c1512, metalness: .92, roughness: .18, emissive: 0x5c2410, emissiveIntensity: .75 });
const gravityRings = [];
for (let z = -302; z > -426; z -= 18) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, .22, 10, 42), ringMat); ring.position.set(0, 3, z); ring.userData.spin = (z % 36 ? 1 : -1) * (.22 + Math.random() * .22); scene.add(ring); gravityRings.push(ring);
}
addCrystal(0, 1.2, -310); addPane(-3.2, -323); addHazard(3.2, -336);
addCrystal(3.2, 3.4, -349); addPane(0, -362, true); addHazard(-3.2, -375);
addCrystal(-3.2, 5.1, -388); addPane(3.2, -401); addPane(0, -414, true);

function makeSmokeTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,170,110,0.45)");
  gradient.addColorStop(1, "rgba(255,170,110,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

const smokeTexture = makeSmokeTexture();
const smokeSprites = [];
for (let i = 0; i < 12; i++) {
  const material = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: .4, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(7 + Math.random() * 6);
  sprite.userData = { speed: .3 + Math.random() * .4, phase: Math.random() * Math.PI * 2 };
  sprite.position.set((Math.random() - .5) * 8, .5 + Math.random() * 4, 4 - i * 8);
  scene.add(sprite); smokeSprites.push(sprite);
}

function updateSmoke(dt, time) {
  for (const sprite of smokeSprites) {
    sprite.visible = currentLevel !== 1;
    sprite.position.x += Math.sin(time * sprite.userData.speed + sprite.userData.phase) * dt * .4;
    if (sprite.position.z > runZ + 8 || sprite.position.z < runZ - RENDER_AHEAD) {
      sprite.position.set((Math.random() - .5) * 8, .5 + Math.random() * 4, runZ - 25 - Math.random() * (RENDER_AHEAD - 25));
    }
  }
}

const avatar = new THREE.Group();
const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42, 1.05, 6, 12), new THREE.MeshStandardMaterial({ color: 0xffece0, roughness: .3, metalness: .45 })); body.position.y = 1.1; avatar.add(body);
const pack = new THREE.Mesh(new THREE.BoxGeometry(.65, .8, .3), railMat); pack.position.set(0, 1.2, .42); avatar.add(pack); scene.add(avatar);
// The figure is unchanged; it only casts a shadow now that Level 1 has sun shadows.
avatar.traverse((o) => { if (o.isMesh) o.castShadow = true; });

function updateUI() {
  ui.level.textContent = `0${currentLevel} / 03`;
  ui.ammo.textContent = ammo; ui.health.textContent = Math.max(0, Math.round(health)); ui.score.textContent = String(Math.floor(score)).padStart(6, "0");
  ui.camera.textContent = currentLevel === 3 ? "CORE ORBIT" : cameraThird ? "CHASE VIEW" : "FIRST PERSON";
}

function showMessage(text) { ui.message.textContent = text; ui.message.classList.add("show"); messageTimer = 1.2; }

/* ==================================================================== */
/* FOUNDRY INTEGRATION - Level 2                                         */
/* ==================================================================== */

/**
 * The foundry is 764m long and the old Level 2 slot was about 128m, so it is
 * built far out in unused world space and the player is teleported there when
 * Level 2 begins. Level 3's geometry keeps its original position, and the
 * existing per-level culling already hides everything that is not the current
 * sector.
 */
const FOUNDRY_ORIGIN_Z = -1200;

/** Matches the pacing tuned in the level design sheet. */
const FOUNDRY_SPEED_ZONES = [
  { until: 0.5, speed: 6.8 },
  { until: 0.75, speed: 9.0 },
  { until: 1.01, speed: 11.6 },
];

let foundry = null;
const foundryHud = new FoundryHud({ dev: false, reducedMotion: settings.reducedMotion });
// Sits alongside the game's own HUD rather than owning the screen.
foundryHud.root.classList.add("embedded");
const foundryBox = new THREE.Box3();
const foundryCentre = new THREE.Vector3();
const foundrySize = new THREE.Vector3();
const foundryGrazed = new Map();
let foundryInvulnerable = 0;
let foundrySlow = 0;
let combo = 1;
let comboTimer = 0;

/** Distance along the foundry route, derived from the game's own runZ. */
function foundryDistance() {
  return FOUNDRY_ORIGIN_Z - runZ;
}

function foundrySpeed() {
  if (!foundry) return 9.2;
  const progress = foundryDistance() / foundry.route.totalLength;
  return (FOUNDRY_SPEED_ZONES.find((zone) => progress < zone.until) ?? FOUNDRY_SPEED_ZONES[2]).speed;
}

function buildFoundry() {
  if (foundry) {
    foundryHud.unbind();
    foundry.dispose();
  }

  foundry = new FoundryLevel({
    origin: new THREE.Vector3(0, 0, FOUNDRY_ORIGIN_Z),
    // The game's player moves along -Z and does not follow a curve yet, so the
    // junctions are off. Flip this to false once PlayerController follows
    // route.sample(distance) - see the level design sheet.
    straightRoute: true,
    shadows: false,
    brightness: 1.6,
    runSpeed: FOUNDRY_SPEED_ZONES[2].speed,
  });
  foundry.addTo(scene);
  foundry.root.visible = false;

  foundryHud.bind(foundry);
  foundry.events.on("complete", () => {
    if (currentLevel !== 2 || state !== "playing") return;
    score += Math.max(0, foundry.state.systemsOnline * 500 + health * 10);
    state = "lift"; liftTimer = 0; transitionTarget = 3;
    showMessage("GRAVITY LIFT // CORE");
    updateUI();
  });
  foundry.events.on("escape-end", ({ survived }) => {
    if (survived || currentLevel !== 2) return;
    health = 0; updateUI(); endRun(false);
  });

  foundryGrazed.clear();
  foundryInvulnerable = 0;
  foundrySlow = 0;
}

/** Called when the player enters or leaves Level 2. */
function setFoundryActive(active) {
  if (!foundry) return;
  foundry.root.visible = active;
  if (active) {
    foundryHud.show();
    foundryHud.setIntegrity(health);
    // The global sun and hemisphere are tuned for the causeway and wash the
    // foundry flat; the level brings its own lighting.
    sun.intensity = 0.35;
    hemi.intensity = 0.35;
    scene.fog.density = 0.0115;
    scene.fog.color.set(0x141d23);
    scene.background.set(0x121a20);
  } else {
    foundryHud.hide();
    sun.intensity = 2.5;
    hemi.intensity = 1.8;
    scene.fog.density = 0.032;
    scene.fog.color.set(0x140b09);
    scene.background.set(0x140b09);
  }
}

/** Player bounds for the foundry's own collision test. */
function updateFoundryBox() {
  const height = sliding > 0 ? 1.0 : 1.9;
  foundryCentre.set(playerX, 0.18 + playerY + jumpHeight + height / 2, runZ);
  foundrySize.set(0.9, height, 0.9);
  foundryBox.setFromCenterAndSize(foundryCentre, foundrySize);
}

function updateFoundry(dt, time) {
  const distance = foundryDistance();

  foundryInvulnerable = Math.max(0, foundryInvulnerable - dt);
  foundrySlow = Math.max(0, foundrySlow - dt);
  for (const [mesh, left] of foundryGrazed) {
    if (left - dt <= 0) foundryGrazed.delete(mesh);
    else foundryGrazed.set(mesh, left - dt);
  }

  updateFoundryBox();
  foundry.update({ dt, time, distance, playerPosition: foundryCentre });

  if (state !== "playing" || paused) return;

  const { hits, grazes } = foundry.probe(foundryBox, distance);

  for (const mesh of grazes) {
    if (foundryGrazed.has(mesh)) continue;
    foundryGrazed.set(mesh, 1.4);
    score += 25 * combo;
    updateUI();
  }

  if (hits.length && foundryInvulnerable <= 0) {
    const hazard = hits[0];
    health -= 18;
    foundryInvulnerable = 1.1;
    foundrySlow = 0.55;
    combo = 1; comboTimer = 0;
    foundry.impact(1);
    foundryHud.setIntegrity(Math.max(0, health));
    triggerShake(0.45);
    showMessage(hazard.userData.barrier === "high" ? "LOW CLEARANCE" : "INTEGRITY DAMAGED");
    updateUI();
    if (health <= 0) endRun(false);
  }

  foundryHud.update({ distance, level: foundry });
  foundryHud.setRun({ score, combo, spheres: ammo, comboRatio: comboTimer / 2.6 });
}


/* ==================================================================== */
/* CAUSEWAY INTEGRATION - Level 1                                        */
/* ==================================================================== */

/**
 * Level 1 is built in its own stretch of world space, like the Foundry, so
 * it never overlaps Level 3's geometry. The route runs from z = 4000 toward
 * -Z; endless mode keeps going from there.
 *
 * Everything Level-1 specific is in this block. The level itself lives in
 * src/levels/causeway/ and follows the same contract as the Foundry.
 */
const CAUSEWAY_ORIGIN_Z = 4000;
const CAUSEWAY_SPEED = { base: 10.2, sprint: 14.6, brake: 5.2 };

/**
 * Level 1 pace. Subject 07 has just been woken from a sedated pod, so the run
 * starts at a groggy 6 m/s and builds as the sedative wears off and adrenaline
 * takes over (full pace by the end of the ward), peaks while the skybridge
 * collapses behind the player, and settles slightly in the atrium so the
 * lock finale stays about aiming. Sprint and brake work relative to it.
 *
 * Returns { pace, sedation, drowsy }:
 *   sedation  1 at the pod, 0 at the end of the ward - drives speed and pulse.
 *   drowsy    1 at the pod, 0 by 40 m (about six seconds) - drives the blurred,
 *             swaying vision. Kept short on purpose: the body takes a while to
 *             reach full speed, but the eyes clear quickly so the player gets
 *             sharp, realistic vision for the rest of the run.
 */
function causewayPace(distance) {
  const smooth = THREE.MathUtils.smoothstep;
  const wake = smooth(distance, 20, 230);
  let pace = THREE.MathUtils.lerp(6.0, CAUSEWAY_SPEED.base, wake);
  pace += 0.8 * smooth(distance, 240, 300) * (1 - smooth(distance, 520, 560));
  return { pace, sedation: 1 - wake, drowsy: 1 - smooth(distance, 4, 40) };
}
const START_SPHERES = 20;

let causeway = null;
let causewayMode = "story";
let simTime = 0;
let photoActive = false;
let autoLow = false;
const keysDown = new Set();

const causewayHud = new CausewayHud();
const arsenal = new Arsenal();
const progress = loadProgress();
const missions = new MissionTracker(progress);
const postfx = new PostFX(renderer, { quality: resolvedQuality() });
const minimap = new Minimap(renderer, causewayHud.mapFrame);
minimap.attach(scene);
const photo = new PhotoMode({ renderer, root: causewayHud.photoEl });

/** Per-run state for Level 1. Reset by resetRun(). */
const run = {};
function resetRun() {
  Object.assign(run, {
    speed: CAUSEWAY_SPEED.base, slow: 0, invulnerable: 0, focus: 1, focusing: false,
    timeScale: 1, hitStop: 0, recharge: 0, damage: 0, heat: 0, flash: 0,
    shots: 0, hits: 0, nearMisses: 0, fireDamage: 0, time: 0, finished: false,
    grazed: new Map(), stepPhase: 0, lean: 0, preview: 0, fadeOut: 0, liftFrom: new THREE.Vector3(),
    missionTimer: 0, ripple: 0, chaseWarned: false,
    rumble: null, heartPhase: 0, lens: 0,
    surge: 0, sedation: 1, drowsy: 1, awakeHinted: false, clearHinted: false,
    lookX: 0, lookY: 0,
  });
}
resetRun();

function resolvedQuality() {
  if (settings.quality === "auto") return autoLow ? "low" : "high";
  return settings.quality;
}

function applyQuality() {
  const q = resolvedQuality();
  const cap = q === "high" ? 1.5 : q === "medium" ? 1.25 : 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
  renderer.setSize(innerWidth, innerHeight);
  postfx.setQuality(q);
  postfx.setScale(q === "medium" ? 0.85 : 1);
  minimap.measure();
}

function causewayDistance() {
  return CAUSEWAY_ORIGIN_Z - runZ;
}

function buildCauseway(mode = "story") {
  if (causeway) causeway.dispose();
  causewayMode = mode;
  causeway = new CausewayLevel({
    origin: new THREE.Vector3(0, 0, CAUSEWAY_ORIGIN_Z),
    mode,
    quality: resolvedQuality(),
  });
  causeway.addTo(scene);
  if (perf.level >= 1) causeway.probe.interval = Math.max(causeway.probe.interval, 2);
  wireCausewayEvents(causeway);
  return causeway;
}

function wireCausewayEvents(level) {
  const on = (name, fn) => level.events.on(name, (payload) => { if (level === causeway) fn(payload); });
  on("radio", (p) => { causewayHud.radio(p); });
  on("title", (p) => causewayHud.title(`Sector 01 // Beat ${p.index + 1} of 3`, p.name));
  on("hint", (p) => causewayHud.hint(p.text));
  on("file", (p) => causewayHud.caseFile(p.lines, p.found, p.total));
  on("sprinkler", () => causewayHud.hint("Sprinkler open: fires below are going out"));
  on("vent", () => causewayHud.hint("Vent clear: the smoke is thinning"));
  on("extinguish", (p) => { if (p.by === "cryo") showMessage(`CRYO // ${p.count} FIRE${p.count > 1 ? "S" : ""} OUT`); });
  on("collapse-warning", () => causewayHud.hint("Ceiling giving way: watch the red ring"));
  on("collapse-landed", () => triggerShake(0.25));
  on("explosion", (p) => {
    triggerShake(0.55 * p.strength);
    run.flash = Math.max(run.flash, 0.35 * p.strength);
    // Fright: a blast behind you makes you run.
    if (state === "playing") run.surge = Math.min(1.5, run.surge + 0.9 * p.strength);
  });
  on("tower-collapse", () => { if (state === "playing") run.surge = Math.min(1.5, run.surge + 0.5); });
  on("pod-break", () => triggerShake(0.3));
  on("tremor", (p) => { run.rumble = { t: 0, duration: p.duration, strength: p.strength * (settings.reducedMotion ? 0.25 : 1) }; });
  on("chase-start", () => causewayHud.title("Structural failure", "Keep moving", 2.4));
  on("chase-end", () => { causewayHud.warning(null); causewayHud.hint("Bridge section secured behind you"); });
  on("gate-armed", () => causewayHud.hint("Lift gate ahead: locks I, II, III", 3.2));
  on("lock", (p) => showMessage(`LOCK ${["I", "II", "III"][p.index]} // NEXT: ${["II", "III", ""][p.index]}`));
  on("gate-open", () => { causewayHud.warning(null); showMessage("GATE OPEN // INTO THE LIFT"); });
  on("gate-sealed", () => causewayHud.warning("Gate sealed", "Break the locks before the atrium falls"));
  on("crushed", () => { if (state === "playing") endRun(false, "crushed"); });
  on("lift-enter", () => startCausewayLift());
}

/** Enter or leave Level 1's world, lighting, camera range, and HUD. */
function setCausewayActive(active) {
  if (!causeway) return;
  causeway.root.visible = active;
  if (active) {
    sun.intensity = 0;
    hemi.intensity = 0;
    camera.far = 1700;
    scene.fog.density = 0.012;
  } else {
    camera.far = 150;
    causewayHud.hide();
    document.body.classList.remove("cw-active");
  }
  camera.updateProjectionMatrix();
}

function playerWorld(target = new THREE.Vector3()) {
  return target.set(playerX, playerY + jumpHeight + 1.1, runZ);
}

function missionStats() {
  const s = causeway ? causeway.summary() : { sprinklers: 0, extinguished: 0, panes: 0, files: [], serums: 0, midair: 0, tanks: 0, vents: 0 };
  return { ...s, shots: run.shots, hits: run.hits, nearMisses: run.nearMisses, fireDamage: run.fireDamage, time: run.time, integrity: health, finished: run.finished };
}

function damage(amount, label) {
  health -= amount;
  combo = 1; comboTimer = 0;
  run.damage = 1;
  run.slow = 0.6;
  causeway?.impact(1);
  triggerShake(0.45);
  showMessage(label);
  updateUI();
  if (health <= 0) endRun(false);
}

function absorbWithShield(direction) {
  if (!arsenal.absorb()) return false;
  run.ripple = 1;
  if (causeway) causeway.shield.material.uniforms.uRippleDir.value.copy(direction);
  showMessage(arsenal.shieldCharges > 0 ? "SHIELD ABSORBED // 1 LEFT" : "SHIELD BROKEN");
  triggerShake(0.2);
  return true;
}

function activateSerum(type) {
  const def = SERUMS[type];
  if (!def) return;
  arsenal.activate(type);
  causewayHud.title("Serum injected", def.name, 2.2);
  causewayHud.hint(def.text, 3);
  run.flash = Math.max(run.flash, 0.25);
}

const _forward = new THREE.Vector3(0, 0, -1);

function updateCauseway(dt, time) {
  const distance = causewayDistance();
  run.time += dt;

  // ---- Speed: W sprints, S brakes, hits cost momentum ------------------
  let target;
  if (causewayMode === "endless") {
    target = CAUSEWAY_SPEED.base + Math.min(6, distance / 300);
    run.sedation = 0;
    run.drowsy = 0;
  } else {
    const { pace, sedation, drowsy } = causewayPace(distance);
    target = pace;
    run.sedation = sedation;
    run.drowsy = drowsy;
    if (!run.clearHinted && drowsy < 0.02) { run.clearHinted = true; causewayHud.hint("Your vision clears", 1.8); }
    if (!run.awakeHinted && sedation < 0.1) { run.awakeHinted = true; causewayHud.hint("Adrenaline: you can run now", 2.4); }
  }
  // Sprint and brake are relative to the current pace: sprint adds 4.4 m/s,
  // brake drops toward 5 m/s but never below 4.
  if (keysDown.has("up")) target += CAUSEWAY_SPEED.sprint - CAUSEWAY_SPEED.base;
  if (keysDown.has("down")) target = Math.max(4, Math.min(target, CAUSEWAY_SPEED.brake));
  if (arsenal.isActive("overdrive")) target += 3;
  // Explosion surge: up to +3 m/s, fading over about three seconds.
  target += run.surge * 2;
  run.surge = Math.max(0, run.surge - dt * 0.45);
  if (run.slow > 0) target *= 0.45;
  run.slow = Math.max(0, run.slow - dt);
  run.speed += (target - run.speed) * Math.min(1, dt * (run.slow > 0 ? 8 : 2.4));
  runZ -= run.speed * dt;
  const stop = causeway.stopDistance;
  if (causewayDistance() > stop) { runZ = CAUSEWAY_ORIGIN_Z - stop; run.speed = Math.min(run.speed, 0.5); }
  score += run.speed * dt * 2;

  updateFoundryBox();
  playerWorld(_playerPos);
  causeway.update({ dt, time, distance: causewayDistance(), player: _playerPos, playing: true });
  if (state !== "playing") return;

  // ---- Collisions -------------------------------------------------------
  run.invulnerable = Math.max(0, run.invulnerable - dt);
  const { hits, panes, grazes, pickups } = causeway.collide(foundryBox, causewayDistance());
  for (const target of pickups) shatter(target, { body: true });
  for (const pane of panes) {
    const result = causeway.breakTarget(pane, { body: true, direction: _forward });
    if (!result) continue;
    if (!absorbWithShield(_forward)) damage(result.kind === "door" ? 24 : 15, result.kind === "door" ? "CRASHED THROUGH THE DOOR" : "GLASS IMPACT");
    if (state !== "playing") return;
  }
  if (hits.length && run.invulnerable <= 0) {
    run.invulnerable = 1.1;
    if (!absorbWithShield(_forward)) damage(22, "INTEGRITY DAMAGED");
    else run.slow = 0.3;
    if (state !== "playing") return;
  }
  for (const [mesh, left] of run.grazed) {
    if (left - dt <= 0) run.grazed.delete(mesh); else run.grazed.set(mesh, left - dt);
  }
  if (!hits.length) {
    for (const mesh of grazes) {
      if (run.grazed.has(mesh)) continue;
      run.grazed.set(mesh, 2);
      run.nearMisses += 1;
      score += 25 * combo;
      causewayHud.hint("Near miss +" + 25 * combo, 0.9);
    }
  }

  // ---- Fire and smoke --------------------------------------------------
  const exposure = causeway.fireExposure(foundryBox);
  run.heat += ((exposure > 0 ? 1 : 0) - run.heat) * Math.min(1, dt * 5);
  if (exposure > 0 && !arsenal.isActive("shield")) {
    const burn = 18 * exposure * dt;
    health -= burn;
    run.fireDamage += burn;
    combo = 1;
  }
  const smoke = causeway.state.smoke;
  if (smoke > 0.55) health -= (smoke - 0.55) * 10 * dt;
  if (health <= 0) { updateUI(); endRun(false, exposure > 0 ? "fire" : "smoke"); return; }

  // ---- Bridge collapse chase -------------------------------------------
  const chase = causeway.state.chase;
  if (chase.active) {
    if (chase.gap < 0) { endRun(false, "fell"); return; }
    if (chase.gap < 22) causewayHud.warning("Bridge collapsing", `${Math.max(0, chase.gap).toFixed(0)} m behind you: sprint (W)`);
    else causewayHud.warning(null);
    if (chase.gap < 12) triggerShake(0.05);
  }
  const finale = causeway.state.finale;
  if (finale.sealed && !finale.open) causewayHud.warning("Gate sealed", `${finale.sealedTime.toFixed(1)} s: break the locks in order`);

  // ---- Sphere safety net: never soft-lock at the gate -------------------
  if (ammo < 1) {
    run.recharge += dt;
    if (run.recharge > 2.5) { run.recharge = 0; ammo += 1; showMessage("+1 SPHERE // RESONANCE RECHARGE"); }
  } else run.recharge = 0;

  // ---- Tools ------------------------------------------------------------
  arsenal.update(dt);
  run.focus = Math.min(1, run.focus + dt * 0.09);
  run.damage = Math.max(0, run.damage - dt * 1.6);

  run.missionTimer -= dt;
  if (causewayMode === "story" && run.missionTimer <= 0) {
    run.missionTimer = 0.25;
    for (const m of missions.update(missionStats())) {
      causewayHud.title("Mission complete", m.def.text, 2.2);
      score += 750;
    }
    causewayHud.setMissions(missions.active);
  }
}
const _playerPos = new THREE.Vector3();

/** Apply what breaking a Level 1 target did to score, spheres and combo. */
function shatterCauseway(target, hit) {
  const result = causeway.breakTarget(target, hit);
  if (!result) return null;
  if (result.rejected) {
    combo = 1; comboTimer = 0;
    showMessage(result.label);
    return result;
  }
  const bodyHit = !!hit.body;
  // Running into a pickup (serum, case file) scores like shooting it.
  if (!bodyHit || result.kind === "serum" || result.kind === "file") {
    score += result.points * combo;
    if (!result.cracked) { combo = Math.min(9, combo + 1); comboTimer = 2.6; }
    run.focus = Math.min(1, run.focus + 0.08);
  }
  if (result.spheres) { ammo += result.spheres; causewayHud.bump(".cw-spheres"); }
  if (result.serum) activateSerum(result.serum);
  if (result.label) showMessage(result.label);
  if (!settings.reducedMotion && ["door", "lock", "falling", "file"].includes(result.kind) && !bodyHit) run.hitStop = 0.09;
  causewayHud.bump(".cw-score");
  updateUI();
  return result;
}

function startCausewayLift() {
  if (state !== "playing" || currentLevel !== 1) return;
  state = "lift";
  liftTimer = 0;
  transitionTarget = 2;
  run.finished = true;
  run.liftFrom.copy(camera.position);
  causewayHud.warning(null);
  const files = causeway.stats.files.length;
  const bonus = ammo * 50 + Math.max(0, Math.round(health)) * 10 + files * 250;
  score += bonus;
  const stats = missionStats();
  missions.update(stats);
  const accuracy = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
  causewayHud.liftReport([
    ["Score", String(Math.floor(score)).padStart(6, "0")],
    ["Time", `${run.time.toFixed(1)} s`],
    ["Accuracy", `${accuracy}%`],
    ["Glass shattered", stats.panes],
    ["Fires put out", stats.extinguished],
    ["Case files", `${files} / 5`],
    ["Carry-over spheres", ammo + 4],
    ["End bonus", `+${bonus}`],
  ], missions.active);
  missions.commit({ mode: "story", score, files: causeway.stats.files, cleared: true });
  refreshMenuProgress();
  updateUI();
}

function updateCausewayLift(dt) {
  const result = causeway.updateLift(dt, camera, run.liftFrom, settings.reducedMotion);
  avatar.visible = true;
  avatar.position.set(0, result.cabinY, causeway.worldZ(CAUSEWAY_ROUTE.lift));
  const end = settings.reducedMotion ? 6.2 : 7.4;
  ui.fade.style.opacity = THREE.MathUtils.clamp((result.t - (end - 0.9)) / 0.9, 0, 1).toFixed(3);
  if (result.done) finishCausewayLift();
}

/** Hand-off to Level 2. Mirrors the old prototype's lift exit exactly. */
function finishCausewayLift() {
  currentLevel = 2;
  state = "playing";
  liftTimer = 0; playerY = 0; heightLane = 0; snapCamera = true;
  health = 100; ammo += 4;
  lane = 1; playerX = 0;
  camera.fov = 68; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
  runZ = FOUNDRY_ORIGIN_Z; cameraThird = true;
  causewayHud.hideReport();
  setCausewayActive(false);
  // Free Level 1's GPU resources - the guide's "level changes leak memory" risk.
  causeway.dispose();
  causeway = null;
  setFoundryActive(true);
  run.fadeOut = 1;
  showMessage("LEVEL 2 // SHIFTING FOUNDRY");
  updateUI();
}

/* ---- Level 1 camera --------------------------------------------------- */

const _look = new THREE.Vector3();
const _desired = new THREE.Vector3();

function causewayCamera(dt, time) {
  const reduced = settings.reducedMotion;
  run.stepPhase += dt * run.speed * 0.95;
  // Groggy steps: a heavier, uneven bob and a slow drift while the eyes are
  // still drowsy (the first ~40 m only).
  const sedation = run.drowsy ?? 0;
  const bob = reduced ? 0 : Math.sin(run.stepPhase * 2) * (0.035 + sedation * 0.05) * Math.min(1, run.speed / 8)
    + Math.sin(run.stepPhase * 0.9) * sedation * 0.03;
  const crouch = sliding > 0 ? 0.65 : 0;
  if (cameraThird) {
    _desired.set(playerX * 0.85, 4.0 + jumpHeight * 0.5, runZ + 8.2);
    _look.set(playerX * 0.6 + pointer.x * 1.5, 1.4 + pointer.y, runZ - 12);
    if (snapCamera) { camera.position.copy(_desired); snapCamera = false; }
    else camera.position.lerp(_desired, 1 - Math.exp(-dt * 7));
  } else {
    // First person: lateral motion eased, forward motion exact (no lag at speed).
    const x = snapCamera ? playerX : THREE.MathUtils.lerp(camera.position.x, playerX, 1 - Math.exp(-dt * 16));
    camera.position.set(x, 1.72 + jumpHeight + bob - crouch, runZ + 0.15);
    snapCamera = false;
    // The view drifts gently toward the aim, but little and smoothly: turning
    // the camera hard toward the pointer slides the world under the crosshair
    // and makes targets harder to hit.
    run.lookX += (pointer.x * 1.0 - run.lookX) * Math.min(1, dt * 4);
    run.lookY += (pointer.y * 0.55 - run.lookY) * Math.min(1, dt * 4);
    _look.set(playerX + run.lookX, 1.55 + run.lookY - crouch, runZ - 14);
    if (!reduced && sedation > 0.01) {
      camera.position.x += Math.sin(time * 0.8) * 0.08 * sedation;
      _look.x += Math.sin(time * 0.55) * 0.6 * sedation;
      _look.y += Math.sin(time * 0.43) * 0.25 * sedation;
    }
  }
  // Fear: shallow, fast breathing sways the view; faster when hurt or choking.
  const fear = THREE.MathUtils.clamp((100 - health) / 70 + causeway.state.smoke * 0.6 + run.heat * 0.5, 0, 1);
  if (!reduced && !cameraThird) {
    camera.position.y += Math.sin(time * (1.6 + fear * 1.4)) * (0.012 + fear * 0.018);
  }
  // Tremor: a low rumble rather than random jitter - two sines at different
  // frequencies, enveloped over the tremor's duration.
  let rumbleRoll = 0;
  if (run.rumble) {
    const r = run.rumble;
    r.t += dt;
    const env = Math.sin(Math.PI * Math.min(1, r.t / r.duration)) * r.strength;
    camera.position.x += (Math.sin(r.t * 23) + Math.sin(r.t * 37) * 0.5) * 0.035 * env;
    camera.position.y += (Math.sin(r.t * 29) + Math.sin(r.t * 17) * 0.6) * 0.03 * env;
    rumbleRoll = Math.sin(r.t * 11) * 0.012 * env;
    if (r.t >= r.duration) run.rumble = null;
  }

  // Lean into lane changes.
  const leanTarget = reduced ? 0 : THREE.MathUtils.clamp((lanes[lane] - playerX) * -0.03, -0.06, 0.06);
  run.lean += (leanTarget - run.lean) * Math.min(1, dt * 8);
  camera.up.set(Math.sin(run.lean + rumbleRoll), Math.cos(run.lean + rumbleRoll), 0);
  camera.lookAt(_look);

  const fov = 70 + Math.max(0, run.speed - 10) * 1.3 + arsenal.level("overdrive") * 8 - (run.timeScale < 0.9 ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
  if (shake > .001) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 2.4); }
}

/** Post-processing and HUD inputs for Level 1, once per frame. */
function updateCausewayPresentation(dt) {
  const u = postfx.uniforms;
  const thermal = arsenal.level("thermal");
  const smoke = causeway.state.smoke;
  // Thermal vision sees through smoke: thin the fog and the ceiling smoke.
  for (let i = 0; i < 16; i += 1) causeway.smoke.profile[i] *= 1 - thermal * 0.8;
  scene.fog.color.copy(causeway.fogColor);
  scene.fog.density = causeway.fogDensity * (1 - thermal * 0.7);
  scene.background.copy(causeway.hazeColor);

  u.uSmoke.value = smoke * 0.85;
  u.uDamage.value = run.damage;
  u.uHeat.value = run.heat;
  u.uThermal.value = thermal;
  u.uOverdrive.value = arsenal.level("overdrive");
  u.uPrism.value = arsenal.level("prism") * 0.7;
  u.uFocus.value = 1 - run.timeScale;
  u.uSpeed.value = Math.max(0, (run.speed - 11.5) / 5);
  u.uSedation.value = run.drowsy * (settings.reducedMotion ? 0.5 : 1);
  run.flash = Math.max(0, run.flash - dt * 1.5);

  // Heartbeat in the vignette, at the ECG's rate, stronger the more afraid.
  const fear = THREE.MathUtils.clamp((100 - health) / 70 + smoke * 0.6 + run.heat * 0.5, 0, 1);
  const bpm = 70 + fear * 80 - run.sedation * 16;
  run.heartPhase = (run.heartPhase + dt * bpm / 60) % 1;
  const beat = Math.exp(-((run.heartPhase - 0.08) ** 2) / 0.002) + 0.6 * Math.exp(-((run.heartPhase - 0.26) ** 2) / 0.002);
  u.uPulse.value = beat * (0.15 + fear * 0.85);
  // Sprinkler water on the lens: a few drops while you are right under a
  // shower, gone within about a second of leaving it.
  const wet = causeway.wetExposure(playerWorld(_playerPos)) * 0.6;
  run.lens = wet > run.lens ? run.lens + (wet - run.lens) * Math.min(1, dt * 4) : Math.max(0, run.lens - dt * 1.1);
  u.uLens.value = run.lens;
  u.uFlash.value = Math.min(0.3, run.flash * 0.4 + causeway.state.flash * 0.25);

  // Heat haze just above the nearest gameplay fires (not the wall fires),
  // kept small so it shimmers the air over the flames rather than the screen.
  const fires = causeway.live.filter((r) => r.kind === "fire" && !r.decor && r.intensity > 0.1)
    .sort((a, b) => a.world.distanceToSquared(camera.position) - b.world.distanceToSquared(camera.position));
  u.uHaze.value.forEach((slot, i) => {
    const f = fires[i];
    if (!f) { slot.w = 0; return; }
    const p = _look.copy(f.world).setY(f.size.y * 1.05).project(camera);
    const dist = f.world.distanceTo(camera.position);
    const near = 1 - THREE.MathUtils.smoothstep(dist, 14, 26);
    slot.set((p.x + 1) / 2, (p.y + 1) / 2, THREE.MathUtils.clamp(3.2 / dist, 0.04, 0.2), p.z < 1 ? f.intensity * 0.6 * near : 0);
  });

  // Shield bubble.
  const shieldOn = arsenal.isActive("shield");
  causeway.shield.visible = shieldOn && (cameraThird || state === "lift");
  run.ripple = Math.max(0, run.ripple - dt * 1.5);
  causeway.shield.material.uniforms.uStrength.value = arsenal.level("shield");
  causeway.shield.material.uniforms.uRipple.value = run.ripple;

  const ball = arsenal.current;
  const cost = arsenal.cost();
  causewayHud.setCore({
    spheres: ammo, score, combo, comboRatio: comboTimer / 2.6,
    camera: cameraThird ? "Chase" : "First person", low: ammo < 4,
  });
  causewayHud.setTools({
    ball: ball.key, spheres: ammo, cost, speed: run.speed,
    speedRatio: THREE.MathUtils.clamp(run.speed / 18, 0, 1), focus: run.focus,
  });
  causewayHud.setVitals({ integrity: health, smoke, heat: run.heat, sedation: run.sedation });
  causewayHud.setSerums(arsenal.list());
  if (smoke > 0.55 && !causeway.state.chase.active && !causeway.state.finale.sealed) {
    causewayHud.warning("Toxic smoke", "Break a vent cover to clear the air", "amber");
  } else if (!causeway.state.chase.active && !causeway.state.finale.sealed) causewayHud.warning(null);
  ui.reticle.style.setProperty("--ball", `#${ball.colour.toString(16).padStart(6, "0")}`);
}

/** Level preview: a guided flythrough with world-attached labels. */
function startPreview() {
  resetStats("story");
  state = "preview";
  run.preview = 0;
  ui.start.classList.remove("active");
  ui.previewBar.hidden = false;
  document.body.classList.add("cw-preview");
  causewayHud.show();
}

function endPreview() {
  causewayHud.clearLabels();
  causewayHud.hide();
  ui.previewBar.hidden = true;
  document.body.classList.remove("cw-preview");
  resetStats("story");
  state = "intro";
  ui.start.classList.add("active");
}

function updatePreview(dt, time) {
  run.preview += dt;
  const d = causeway.previewCamera(run.preview, camera);
  causeway.update({ dt, time, distance: d, playing: false });
  scene.fog.color.copy(causeway.fogColor);
  scene.fog.density = causeway.fogDensity;
  causewayHud.labels(causeway.landmarks(d), camera);
  if (d >= CAUSEWAY_ROUTE.length - 31) endPreview();
}

function refreshMenuProgress() {
  const p = missions.progress;
  ui.endlessButton.disabled = !p.cleared;
  ui.endlessButton.title = p.cleared ? "Randomised, endless, faster every 250 m" : "Clear Sector 1 once to unlock";
  ui.endlessButton.textContent = p.cleared ? "Endless lab" : "Endless lab (locked)";
  const bits = [];
  if (p.best.story) bits.push(`Best run ${String(p.best.story).padStart(6, "0")}`);
  if (p.bestDistance) bits.push(`Endless ${p.bestDistance} m`);
  bits.push(`Case files ${p.files.length}/5`);
  bits.push(`Missions ${p.completed.length}/13`);
  ui.progressLine.textContent = bits.join("   ");
  if (ui.briefing) ui.briefing.innerHTML = missions.active.map((m) => `<li class="${p.completed.includes(m.def.id) ? "done" : ""}">${m.def.text}</li>`).join("");
}

/* ==================================================================== */
/* Projectiles (all levels)                                             */
/* ==================================================================== */

const projectileGeometry = new THREE.SphereGeometry(1, 16, 12);
const projectileMaterials = Object.fromEntries(Object.values(BALLS).map((b) => [b.key, new THREE.MeshBasicMaterial({ color: new THREE.Color(...b.glow) })]));
const legacyProjectileMaterial = new THREE.MeshBasicMaterial({ color: 0xffcf9a });
const _aim = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _segment = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function aliveTargets() {
  if (currentLevel === 1 && causeway) return causeway.breakables;
  if (currentLevel === 2 && foundry) return foundry.breakables.filter((x) => x.userData.alive);
  return breakables.filter((x) => x.userData.alive);
}

/* ---- Aiming: direct hit, aim assist, and leading moving targets --------- */

const _sphere = new THREE.Sphere();
const _sv = new THREE.Vector3();
const targetMotion = new WeakMap();

/** A mesh's bounding sphere in world space. */
function worldSphere(mesh, out = _sphere) {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  mesh.updateWorldMatrix(true, false);
  return out.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
}

/**
 * Remember where each target is and how fast it is moving (falling glass,
 * sculpture blades, bobbing caches), smoothed over a few frames, so a throw
 * can lead it.
 */
function trackTargetMotion(targets, dt) {
  if (dt <= 0) return;
  for (const t of targets) {
    const centre = worldSphere(t).center;
    const m = targetMotion.get(t);
    if (!m) { targetMotion.set(t, { last: centre.clone(), velocity: new THREE.Vector3() }); continue; }
    _sv.copy(centre).sub(m.last).divideScalar(dt);
    m.velocity.lerp(_sv, 0.35);
    m.last.copy(centre);
  }
}

/**
 * What the crosshair is aiming at.
 *   1. A ray from the crosshair: the first breakable it hits, if it hits one
 *      before any solid.
 *   2. Aim assist: the breakable nearest the crosshair on screen, if it is
 *      within its catch radius - its own projected size plus a margin, so
 *      small targets (sprinkler bulbs, locks, vent covers, caches) are fair
 *      to hit while running. Nearer targets win ties.
 *   3. Otherwise the solid the ray hits, or a point 60 m out.
 * @returns {{target: THREE.Mesh|null, point: THREE.Vector3, assisted: boolean}}
 */
function resolveAim(targets, solids = []) {
  raycaster.setFromCamera(pointer, camera);
  raycaster.far = 120;
  const direct = raycaster.intersectObjects(targets, false)[0];
  const solid = solids.length ? raycaster.intersectObjects(solids, false)[0] : null;
  const fallback = solid ? solid.point.clone() : raycaster.ray.at(60, new THREE.Vector3());
  raycaster.far = Infinity;
  if (direct && (!solid || direct.distance <= solid.distance)) return { target: direct.object, point: direct.point.clone(), assisted: false };
  if (!settings.aimAssist) return { target: null, point: fallback, assisted: false };

  const halfW = innerWidth / 2;
  const halfH = innerHeight / 2;
  const px = pointer.x * halfW;
  const py = pointer.y * halfH;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let best = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const sphere = worldSphere(t);
    const depth = -_sv.copy(sphere.center).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth < 1.5 || depth > 70) continue;
    _sv.copy(sphere.center).project(camera);
    const radiusPx = Math.min((sphere.radius / (depth * tanHalf)) * halfH, 90);
    const reach = radiusPx + 30;
    const d = Math.hypot(_sv.x * halfW - px, _sv.y * halfH - py);
    if (d > reach) continue;
    const score = d / reach + depth * 0.004;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  if (!best) return { target: null, point: fallback, assisted: false };
  return { target: best, point: worldSphere(best).center.clone(), assisted: true };
}

/**
 * Lead a moving target: aim where it will be when the sphere arrives. Two
 * passes are enough - the flight time barely changes with the correction.
 */
function leadTarget(target, point, origin, speed, out) {
  out.copy(point);
  const motion = targetMotion.get(target);
  if (!motion || motion.velocity.lengthSq() < 0.04) return out;
  for (let i = 0; i < 2; i += 1) {
    const t = out.distanceTo(origin) / speed;
    out.copy(point).addScaledVector(motion.velocity, t);
  }
  return out;
}

function fire() {
  if (state !== "playing" || paused || photoActive) return;
  const inCauseway = currentLevel === 1 && causeway;
  const ball = inCauseway ? arsenal.current : null;
  const cost = inCauseway ? arsenal.cost() : 1;
  if (ammo < cost || ammo <= 0 && cost > 0) {
    showMessage(ammo <= 0 ? "NO SPHERES" : `${ball.name.toUpperCase()} NEEDS ${cost}`);
    return;
  }
  ammo -= cost;

  const speed = ball?.speed ?? 34;
  const gravity = inCauseway ? ball.gravity : 0;
  _origin.copy(camera.position);
  if (inCauseway && !cameraThird) {
    // Throw from the right hand rather than the eye.
    const right = _segment.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _origin.addScaledVector(right, 0.28).y -= 0.22;
  }

  // Aim at the target under (or, with aim assist, near) the crosshair, else
  // at whatever solid is there, else 60 m out.
  const aim = resolveAim(aliveTargets(), inCauseway ? causeway.solids : []);
  if (aim.target) leadTarget(aim.target, aim.point, _origin, speed, _aim);
  else _aim.copy(aim.point);
  const count = inCauseway && arsenal.isActive("prism") ? 3 : 1;
  for (let i = 0; i < count; i += 1) {
    const dir = _aim.clone().sub(_origin);
    const distance = dir.length();
    dir.normalize();
    if (count > 1) dir.applyAxisAngle(_up, (i - 1) * 0.07);
    // Ballistic compensation: aim high by exactly the drop over the flight
    // time, so the sphere arcs onto the reticle.
    const t = distance / speed;
    const velocity = dir.multiplyScalar(speed).addScaledVector(_up, 0.5 * gravity * t);
    const mesh = new THREE.Mesh(projectileGeometry, ball ? projectileMaterials[ball.key] : legacyProjectileMaterial);
    mesh.scale.setScalar(ball?.radius ?? 0.18);
    mesh.position.copy(_origin);
    mesh.layers.set(LAYERS.FX);
    scene.add(mesh);
    projectiles.push({ mesh, velocity, life: 3, gravity, ball: ball?.key ?? "glass", scored: false, bounces: 0 });
  }
  run.shots += count;
  updateUI();
}

/** A special sphere going off: cryo puts out fires, shock breaks everything nearby. */
function detonate(p, point) {
  if (!causeway || p.ball === "glass") return;
  const def = BALLS[p.ball];
  causeway.splash(point, def.splash, p.ball);
  if (p.ball === "shock") {
    for (const target of causeway.targetsNear(point, def.splash)) {
      const r = shatter(target, { point: target.getWorldPosition(new THREE.Vector3()), direction: p.velocity, ball: "shock" });
      if (r && !r.rejected) p.scored = true;
    }
    triggerShake(0.25);
  }
  if (p.ball === "cryo") p.scored = true;
}

const _seg = new THREE.Line3();
const _closest = new THREE.Vector3();
/** Nearest small target the segment a->b passes within `tolerance` of. */
function grazeTarget(targets, a, b, tolerance) {
  _seg.set(a, b);
  let best = null;
  let bestDistance = Infinity;
  for (const t of targets) {
    const sphere = worldSphere(t);
    if (sphere.radius > 1.1) continue;                    // panes and doors are big enough already
    _seg.closestPointToPoint(sphere.center, true, _closest);
    const d = _closest.distanceTo(sphere.center) - sphere.radius;
    if (d < tolerance && d < bestDistance) {
      bestDistance = d;
      best = { object: t, point: _closest.clone(), distance: a.distanceTo(_closest) };
    }
  }
  return best;
}

function updateProjectiles(dt) {
  const targets = aliveTargets();
  const solids = currentLevel === 1 && causeway ? causeway.solids : [];
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const old = p.mesh.position.clone();
    p.velocity.y -= p.gravity * dt;
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.life -= dt;
    _segment.copy(p.mesh.position).sub(old);
    const length = _segment.length();
    if (length > 1e-5) {
      raycaster.set(old, _segment.divideScalar(length));
      raycaster.far = length + p.mesh.scale.x;
      let hit = raycaster.intersectObjects(targets, false)[0];
      const solid = solids.length ? raycaster.intersectObjects(solids, false)[0] : null;
      raycaster.far = Infinity;
      // Near miss on a small target counts: a sphere passing within its own
      // radius plus 0.25 m of a small target's bounding sphere hits it.
      if (!hit && currentLevel === 1) hit = grazeTarget(targets, old, p.mesh.position, p.mesh.scale.x + 0.25);
      if (hit && (!solid || hit.distance <= solid.distance)) {
        const result = shatter(hit.object, { point: hit.point, direction: p.velocity, ball: p.ball });
        if (result && !result.rejected) { p.scored = true; run.hits += 1; }
        if (p.ball !== "glass") { detonate(p, hit.point); p.life = 0; }
        else if (!result || result.cracked || result.rejected || !["pane", "blade", "falling", "tank", "door"].includes(result.kind) || currentLevel !== 1) p.life = 0;
        else p.velocity.multiplyScalar(0.82); // glass spheres punch through and keep going
      } else if (solid) {
        if (p.ball !== "glass") { detonate(p, solid.point); p.life = 0; }
        else {
          // Ricochet off solid hazards: reflect about the face normal.
          const n = solid.face ? solid.face.normal.clone().transformDirection(solid.object.matrixWorld) : _forward.clone().negate();
          p.velocity.reflect(n).multiplyScalar(0.45);
          p.mesh.position.copy(solid.point).addScaledVector(n, 0.2);
          causeway.ricochet(solid.point);
          if (++p.bounces > 2) p.life = 0;
        }
      }
    }
    // Floor bounce in Level 1.
    if (currentLevel === 1 && p.life > 0 && p.mesh.position.y < p.mesh.scale.x && p.velocity.y < 0) {
      if (p.ball !== "glass") { detonate(p, p.mesh.position); p.life = 0; }
      else { p.velocity.y *= -0.42; p.velocity.x *= 0.75; p.velocity.z *= 0.75; p.mesh.position.y = p.mesh.scale.x; }
    }
    if (p.life <= 0) {
      if (!p.scored && (currentLevel === 2 || currentLevel === 1)) { combo = 1; comboTimer = 0; }
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

/* ==================================================================== */
/* Game flow                                                            */
/* ==================================================================== */

function resetStats(mode = causewayMode) {
  ammo = START_SPHERES; health = 100; score = 0; lane = 1; playerX = 0; playerY = 0; heightLane = 0;
  cameraThird = false; liftTimer = 0; currentLevel = 1; transitionTarget = 0; shake = 0;
  jumpHeight = 0; jumpVelocity = 0; sliding = 0; combo = 1; comboTimer = 0; snapCamera = true;
  simTime = 0;
  keysDown.clear();
  resetRun();
  arsenal.reset();
  if (mode === "story") missions.start(); else missions.active = [];
  // Rebuild the foundry from scratch so a restart gets a fresh set of switches
  // and gates. dispose() frees the old one's GPU resources.
  buildFoundry();
  setFoundryActive(false);
  buildCauseway(mode);
  runZ = CAUSEWAY_ORIGIN_Z;
  setCausewayActive(true);
  camera.fov = 68; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
  causewayHud.reset();
  causewayHud.setMissions(missions.active);
  ui.fade.style.opacity = 0;
  for (const mesh of breakables) { mesh.visible = true; mesh.userData.alive = true; mesh.scale.setScalar(1); }
  for (const mesh of obstacles) mesh.userData.hit = false;
  for (const p of projectiles) scene.remove(p.mesh); projectiles.length = 0;
  for (const s of shards) { scene.remove(s.mesh); s.mesh.material.dispose(); } shards.length = 0;
  ui.end.classList.remove("active"); updateUI();
}

function resetGame(mode = causewayMode) {
  resetStats(mode); state = "playing";
  causewayHud.show();
  if (mode === "endless") causewayHud.title("Endless lab", "Randomised. Faster every 250 m.", 2.2);
}

/**
 * Start pressed: a 2.5 s wake-up (pod shatters, camera drops into the eyes),
 * skippable with any key or click. The briefing and missions were on the
 * start screen, so nothing blocks the view once the run begins.
 */
function beginLaunch() {
  resetStats("story"); state = "launch"; launchTimer = 0;
}

function startEndless() {
  ui.start.classList.remove("active");
  resetGame("endless");
}


function triggerShake(amount) { shake = Math.max(shake, amount * (settings.reducedMotion ? 0.25 : 1)); }

const shatterAt = new THREE.Vector3();
const legacyShardGeometry = new THREE.TetrahedronGeometry(1);

function shatter(target, hit = {}) {
  if (!target.userData.alive) return null;
  if (target.userData.causeway) return causeway ? shatterCauseway(target, hit) : null;

  // Foundry targets must go through the level, because breaking a switch is
  // what opens a gate or restores a system - hiding the mesh here would break
  // the glass and leave the route shut.
  const isFoundry = target.userData.kind === "switch" || target.userData.kind === "cell";
  let gainedSpheres = 0;
  let result = { kind: target.userData.kind };

  if (isFoundry) {
    const foundryResult = foundry?.breakTarget(target);
    if (!foundryResult) return null;
    result = foundryResult;
    score += foundryResult.points * combo;
    gainedSpheres = foundryResult.spheres ?? 0;
    shatterAt.copy(foundryResult.position);
    combo = Math.min(9, combo + 1);
    comboTimer = 2.6;
    if (foundryResult.kind === "switch") showMessage(`${foundryResult.label} // ONLINE`);
  } else {
    target.userData.alive = false; target.visible = false;
    score += target.userData.points;
    shatterAt.copy(target.position);
    if (target.userData.kind === "crystal") gainedSpheres = 3;
    showMessage(gainedSpheres ? "+3 SPHERES" : "GLASS FRACTURED");
  }

  if (gainedSpheres) ammo += gainedSpheres;

  const crystal = target.userData.kind === "crystal";
  const count = crystal || target.userData.kind === "cell" ? 8 : 14;
  for (let i = 0; i < count; i++) {
    const material = new THREE.MeshBasicMaterial({ color: isFoundry ? 0x9ff4f0 : crystal ? 0xffb04a : 0xffb26b, transparent: true, opacity: .78 });
    const mesh = new THREE.Mesh(legacyShardGeometry, material);
    mesh.scale.setScalar(.08 + Math.random() * .14);
    mesh.position.copy(shatterAt); scene.add(mesh);
    shards.push({ mesh, velocity: new THREE.Vector3((Math.random()-.5)*6, Math.random()*5, (Math.random()-.5)*5), life: 1.4 });
  }
  updateUI();
  return result;
}

const sectorNames = { 1: "GLASS CAUSEWAY", 2: "SHIFTING FOUNDRY", 3: "INVERTED CORE" };
const sectorBriefings = {
  1: "Sector one. The Glass Causeway. Break the glass before it breaks you.",
  2: "Sector two. The Shifting Foundry. The machinery will not stop for you.",
  3: "Sector three. The Inverted Core. Gravity is only a suggestion here.",
};
const failReasons = {
  fell: "The skybridge gave way beneath you. Sprint with W when the collapse closes in.",
  crushed: "The atrium came down before the gate opened. Break locks I, II, III in order.",
  fire: "The fire took the last of your integrity. Open sprinklers or throw cryo spheres.",
  smoke: "The smoke was too thick. Break vent covers to clear the air.",
};

function endRun(won, reason = null) {
  if (state === "ended") return;
  state = "ended"; ui.final.textContent = String(Math.floor(score)).padStart(6, "0");
  causewayHud.warning(null);
  ui.endEyebrow.textContent = won ? "RUN COMPLETE" : `RUN TERMINATED // SECTOR 0${currentLevel}`;
  ui.endTitle.textContent = won ? "CONTROL CORE STABILISED" : `THE ${sectorNames[currentLevel]} CLAIMED YOU`;
  ui.endText.textContent = won
    ? "The Causeway, Foundry, and Inverted Core are stable. The tower holds."
    : failReasons[reason] ?? `Integrity failed in the ${sectorNames[currentLevel].toLowerCase()}. Shift lanes earlier and preserve your spheres.`;
  ui.endStats.textContent = "";
  if (currentLevel === 1 && causeway) {
    const distance = Math.max(0, Math.floor(causewayDistance()));
    const s = missionStats();
    const accuracy = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
    if (causewayMode === "endless") {
      ui.endTitle.textContent = `SIGNAL LOST AT ${distance} M`;
      ui.endText.textContent = `Best endless distance: ${Math.max(distance, missions.progress.bestDistance ?? 0)} m. The lab rebuilds itself differently every run.`;
    }
    ui.endStats.textContent = `${distance} m run   ${accuracy}% accuracy   ${s.panes} glass   ${s.extinguished} fires out   ${s.files.length} case files`;
    missions.commit({ mode: causewayMode, score: Math.floor(score), distance, files: s.files });
    refreshMenuProgress();
  }
  ui.end.classList.add("active");
}

function demoJump(level) {
  if (state !== "playing") return;
  if (level === 1 || level === 4) { resetGame(level === 4 ? "endless" : "story"); return; }
  if (currentLevel === 1 && causeway) setCausewayActive(false);
  currentLevel = level; playerY = 0; heightLane = 0; health = 100;
  jumpHeight = 0; jumpVelocity = 0; sliding = 0; snapCamera = true;
  camera.fov = 68; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
  if (level === 2) { runZ = FOUNDRY_ORIGIN_Z; cameraThird = true; setFoundryActive(true); }
  if (level === 3) { runZ = -296; cameraThird = true; setFoundryActive(false); }
  showMessage(`DEMO JUMP // LEVEL ${level}`); updateUI();
}

const _fp = new THREE.Vector3();
function firstPersonPoint() { return _fp.set(0, 1.72, CAUSEWAY_ORIGIN_Z + 0.15); }

function updateLaunch(dt, time) {
  launchTimer += dt;
  causeway.update({ dt, time, distance: 0, player: playerWorld(_playerPos), playing: false });
  scene.fog.color.copy(causeway.fogColor);
  scene.fog.density = causeway.fogDensity;
  const done = causeway.updateIntro(dt, camera, firstPersonPoint(), settings.reducedMotion);
  if (done) {
    state = "playing"; snapCamera = true;
    causewayHud.show();
    causewayHud.hint("Still sedated: your legs are waking up", 3);
  }
}

function isLevelVisible(level) {
  if (level === undefined) return true;
  if (state === "lift") return level === currentLevel || level === transitionTarget;
  return level === currentLevel;
}

function updateCulling() {
  for (const mesh of structural) mesh.visible = isLevelVisible(mesh.userData.level) && mesh.position.z <= runZ + RENDER_BEHIND && mesh.position.z >= runZ - RENDER_AHEAD;
  for (const ring of gravityRings) ring.visible = isLevelVisible(3) && ring.position.z <= runZ + RENDER_BEHIND && ring.position.z >= runZ - RENDER_AHEAD;
  for (const mesh of breakables) mesh.visible = mesh.userData.alive && isLevelVisible(mesh.userData.level) && mesh.position.z <= runZ + RENDER_BEHIND && mesh.position.z >= runZ - RENDER_AHEAD;
  for (const mesh of obstacles) if (mesh.userData.kind === "hazard") mesh.visible = isLevelVisible(mesh.userData.level) && mesh.position.z <= runZ + RENDER_BEHIND && mesh.position.z >= runZ - RENDER_AHEAD;
}

function clearPostLooks() {
  const u = postfx.uniforms;
  for (const key of ["uSmoke", "uDamage", "uHeat", "uThermal", "uOverdrive", "uPrism", "uFocus", "uSpeed", "uFlash", "uLens", "uPulse", "uSedation"]) u[key].value = 0;
  for (const slot of u.uHaze.value) slot.w = 0;
}

function updateGame(dt, time) {
  energyUniforms.uTime.value = time;
  const inCauseway = currentLevel === 1 && causeway && causeway.root.visible;
  document.body.classList.toggle("pregame", state === "intro" || state === "launch" || state === "preview");
  document.body.classList.toggle("paused", paused);
  document.body.classList.toggle("cw-active", !!inCauseway && (state === "playing" || state === "lift" || state === "ended"));
  // The foundry HUD is its own overlay, so it has to follow the game's menu
  // states too - otherwise it shows through the briefing and pause screens.
  if (foundry) {
    foundryHud.root.hidden = !(
      currentLevel === 2 && (state === "playing" || state === "lift") && !paused && !storyPlaying
    );
  }
  const hudWanted = inCauseway && ((state === "playing" && !paused && !photoActive) || state === "preview");
  if (hudWanted) causewayHud.show(); else if (state !== "preview") causewayHud.hide();
  causewayHud.update(dt);

  avatar.position.set(playerX, playerY + jumpHeight, runZ + .5);
  avatar.visible = cameraThird || currentLevel === 3 || state === "lift" || state === "launch" || photoActive;
  // Blink through the mercy window after an impact.
  if ((foundryInvulnerable > 0 || run.invulnerable > 0) && Math.floor(time * 14) % 2 === 0 && !photoActive) avatar.visible = false;
  body.scale.y = sliding > 0 ? 0.55 : 1;
  body.rotation.z = Math.sin(time * 9) * .035;
  for (const crystal of breakables) if (crystal.userData.kind === "crystal" && crystal.userData.alive) crystal.rotation.y += dt * 1.8;
  for (const ring of gravityRings) { ring.rotation.z += dt * ring.userData.spin; ring.rotation.x = Math.sin(time * .4 + ring.position.z) * .18; }
  if (messageTimer > 0) { messageTimer -= dt; if (messageTimer <= 0) ui.message.classList.remove("show"); }
  if (run.fadeOut > 0) { run.fadeOut = Math.max(0, run.fadeOut - dt * 1.4); ui.fade.style.opacity = run.fadeOut.toFixed(3); }
  if (!inCauseway) clearPostLooks();
  // Level 1 is a night scene lit by fire; Levels 2 and 3 keep their tuning.
  renderer.toneMappingExposure = inCauseway ? 1.0 : 1.08;

  if (photoActive) { photo.update(camera); return; }
  if (state === "intro") {
    if (causeway) {
      const d = causeway.menuCamera(time, camera, settings.reducedMotion);
      causeway.update({ dt, time, distance: d, playing: false });
      scene.fog.color.copy(causeway.fogColor);
      scene.fog.density = causeway.fogDensity;
    }
    return;
  }
  if (state === "preview") { updatePreview(dt, time); return; }
  if (state === "launch") { updateLaunch(dt, time); return; }
  if (paused) return;

  // Time dilation for Level 1: focus (bullet time) and hit-stop on big breaks.
  let simDt = dt;
  if (inCauseway && state === "playing") {
    const focusing = run.focusing && run.focus > 0.02;
    if (focusing) run.focus = Math.max(0, run.focus - dt * 0.38);
    let targetScale = focusing ? 0.38 : 1;
    if (run.hitStop > 0) { run.hitStop -= dt; targetScale = 0.2; }
    run.timeScale += (targetScale - run.timeScale) * Math.min(1, dt * 12);
    simDt = dt * run.timeScale;
  } else run.timeScale = 1;
  simTime += simDt;

  updateCulling();
  updateSmoke(dt, time);

  if (state === "playing") {
    // Lane changes are sluggish while Subject 07 is still sedated.
    const laneRate = currentLevel === 1 ? 9 - run.drowsy * 4 : 9;
    playerX += (lanes[lane] - playerX) * Math.min(1, simDt * laneRate);

    // Jump arc and slide timer.
    jumpVelocity -= 19 * simDt;
    jumpHeight = Math.max(0, jumpHeight + jumpVelocity * simDt);
    if (jumpHeight <= 0) jumpVelocity = 0;
    sliding = Math.max(0, sliding - simDt);

    // Combo decays on its own; a miss or an impact resets it elsewhere.
    if (comboTimer > 0) { comboTimer = Math.max(0, comboTimer - simDt); if (comboTimer === 0) combo = 1; }

    if (currentLevel === 1 && causeway) {
      updateCauseway(simDt, simTime);
    } else {
      const baseSpeed = currentLevel === 2 ? foundrySpeed() : 8.7;
      runZ -= dt * baseSpeed * (currentLevel === 2 && foundrySlow > 0 ? 0.45 : 1);

      // playerY is the lane height; the jump arc is added on top where it is
      // used, so Level 3's gravity lanes and the jump do not fight each other.
      const targetY = currentLevel === 3 ? [0, 2.1, 4.1][heightLane] : 0;
      playerY += (targetY - playerY) * Math.min(1, dt * 6);
      for (const item of obstacles) if (item.userData.mover) {
        const m = item.userData.mover; item.position.x = m.base + Math.sin(time * m.speed + m.phase) * m.range;
      }
      // Level 3 uses the simple distance check below. Level 2 runs its own
      // collision - the foundry's hazards are nested inside groups.
      for (const item of currentLevel === 3 ? obstacles : []) {
        const playerCentreY = playerY + 1.35;
        if (!item.userData.hit && Math.abs(item.position.z - runZ) < .65 && Math.abs(item.position.x - playerX) < 1.3 && Math.abs(item.position.y - playerCentreY) < 2.1) {
          item.userData.hit = true;
          if (item.userData.kind === "pane" && item.userData.alive) { health -= 18; shatter(item); triggerShake(.22); }
          if (item.userData.kind === "hazard") { health -= 30; showMessage("INTEGRITY DAMAGED"); triggerShake(.42); }
          updateUI(); if (health <= 0) endRun(false);
        }
      }
      if (currentLevel === 2) updateFoundry(dt, time);

      // Level 2 exits on the foundry's own `complete` event - breaking the
      // extraction valve - rather than on a hard-coded z. If the player somehow
      // runs past the end, fall through to the lift anyway.
      if (currentLevel === 2 && foundry && foundryDistance() > foundry.route.totalLength - 4) {
        state = "lift"; liftTimer = 0; transitionTarget = 3; showMessage("GRAVITY LIFT // CORE");
      }
      if (currentLevel === 3 && runZ < -422) { score += Math.max(0, ammo * 50 + health * 10); updateUI(); endRun(true); }
    }
  } else if (state === "lift" && transitionTarget === 2 && causeway) {
    causeway.update({ dt, time: simTime, distance: causewayDistance(), player: playerWorld(_playerPos), playing: false });
    updateCausewayLift(dt);
  } else if (state === "lift") {
    liftTimer += dt; energyUniforms.uLift.value = Math.min(1, liftTimer / 2);
    avatar.position.y = Math.min(6, liftTimer * 1.3);
    if (liftTimer > 3.6) {
      currentLevel = transitionTarget; state = "playing"; liftTimer = 0; playerY = 0; heightLane = 0; snapCamera = true;
      health = 100; ammo += 4;
      if (currentLevel === 3) { runZ = -296; cameraThird = true; setFoundryActive(false); showMessage("LEVEL 3 // INVERTED CORE"); }
      updateUI();
    }
  } else if (state === "ended" && inCauseway) {
    // Keep the world alive behind the end screen.
    causeway.update({ dt, time: simTime, distance: causewayDistance(), player: playerWorld(_playerPos), playing: false });
  }

  // The lift can hand over to Level 2 (and dispose Level 1) during this frame.
  const causewayLive = currentLevel === 1 && !!causeway && causeway.root.visible;

  // ---- Cameras ---------------------------------------------------------
  if (causewayLive && state !== "lift") {
    causewayCamera(dt, time);
  } else if (!(state === "lift" && transitionTarget === 2 && causewayLive)) {
    const forward = new THREE.Vector3(0, 1.25, runZ - 12);
    const desired = cameraThird ? new THREE.Vector3(playerX, 4.2, runZ + 8.5) : new THREE.Vector3(playerX, 1.8, runZ + .7);
    if (currentLevel === 3 && state === "playing") {
      desired.set(playerX + Math.sin(time * .55) * 6.5, playerY + 4.6 + Math.cos(time * .45), runZ + 7.2);
      forward.set(playerX, playerY + 1.5, runZ - 11);
      camera.up.lerp(new THREE.Vector3(Math.sin(runZ * .045) * .55, 1, 0).normalize(), Math.min(1, dt * 2));
    } else camera.up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 4));
    if (state === "lift") {
      const liftZ = -282;
      desired.set(Math.sin(liftTimer * .9) * 8, 4 + liftTimer * .5, liftZ + 8 + Math.cos(liftTimer * .9) * 4); forward.set(0, 3.5 + liftTimer, liftZ);
    }
    if (snapCamera) { camera.position.copy(desired); snapCamera = false; }
    else camera.position.lerp(desired, 1 - Math.exp(-dt * 7));
    camera.lookAt(forward);
    if (shake > .001) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 2.4); }
  }

  // ---- Aim feedback, projectiles, debris -------------------------------
  const aliveBreakables = aliveTargets();
  trackTargetMotion(aliveBreakables, simDt);
  const aim = resolveAim(aliveBreakables);
  ui.reticle.classList.toggle("hot", !!aim.target);
  ui.reticle.classList.toggle("assist", !!aim.target && aim.assisted);
  if (causewayLive) causeway.setHighlight(aim.target);
  document.body.classList.toggle("aiming", state === "playing" && !paused && !photoActive && !document.querySelector(".screen.active"));

  updateProjectiles(simDt);

  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i]; s.velocity.y -= dt * 5; s.mesh.position.addScaledVector(s.velocity, dt); s.mesh.rotation.x += dt * 4; s.life -= dt; s.mesh.material.opacity = Math.max(0, s.life / 1.4);
    if (s.life <= 0) { scene.remove(s.mesh); s.mesh.material.dispose(); shards.splice(i, 1); }
  }

  if (causewayLive && (state === "playing" || state === "lift")) updateCausewayPresentation(dt);
}

/* ---- Rendering and performance ---------------------------------------- */

const perf = { ema: 16, slowFor: 0, fastFor: 0, frames: 0, acc: 0, fps: 60, level: 0 };

function updatePerformance(rawDt) {
  const ms = rawDt * 1000;
  perf.ema = perf.ema * 0.94 + ms * 0.06;
  perf.frames += 1;
  perf.acc += rawDt;
  if (perf.acc >= 0.5) { perf.fps = Math.round(perf.frames / perf.acc); perf.frames = 0; perf.acc = 0; }

  // Dynamic resolution, then an automatic drop to low quality if needed.
  if (settings.quality === "auto" && state === "playing" && !paused && document.visibilityState === "visible") {
    perf.slowFor = perf.ema > 21 ? perf.slowFor + rawDt : 0;
    perf.fastFor = perf.ema < 14 ? perf.fastFor + rawDt : 0;
    // Degrade in order of how little it shows: first work nobody sees (the
    // reflection probe updates less often, the refraction snapshot and bloom
    // buffer shrink), then resolution - but never below 85%, and a sharpening
    // pass keeps that crisp. Only a machine far below 30 fps drops to Low.
    if (perf.slowFor > 1.2 && postfx.enabled) {
      perf.slowFor = 0;
      if (perf.level === 0) { perf.level = 1; if (causeway) causeway.probe.interval = 2; }
      else if (perf.level === 1) { perf.level = 2; postfx.setLite(true); }
      else if (postfx.scale > 0.86) postfx.setScale(postfx.scale - 0.075);
      else if (!autoLow && perf.ema > 34) { autoLow = true; applyQuality(); showMessage("GRAPHICS // AUTO LOW"); }
    }
    if (perf.fastFor > 4 && postfx.enabled) {
      perf.fastFor = 0;
      if (postfx.scale < 1) postfx.setScale(postfx.scale + 0.05);
      else if (perf.level === 2) { perf.level = 1; postfx.setLite(false); }
      else if (perf.level === 1) { perf.level = 0; if (causeway) causeway.probe.interval = causeway.quality === "low" ? 3 : 1; }
    }
  }

  if (settings.hud.fps) {
    const info = renderer.info;
    causewayHud.perf(
      `FPS ${perf.fps}   ${perf.ema.toFixed(1)} ms\n` +
      `Draw calls ${info.render.calls}   Triangles ${(info.render.triangles / 1000).toFixed(1)}k\n` +
      `Geometries ${info.memory.geometries}   Textures ${info.memory.textures}\n` +
      `Quality ${postfx.quality}${perf.level ? ` (auto step ${perf.level})` : ""}   Resolution ${Math.round(postfx.scale * 100)}%`,
    );
  } else causewayHud.perf(null);
}

function renderFrame() {
  const glass = causeway && causeway.root.visible ? causeway.glassShared : null;
  postfx.render(scene, camera, glass);
  if (glass && settings.hud.minimap && causewayHud.visible && !photoActive && state === "playing") {
    const chase = causeway.state.chase;
    minimap.render(scene, playerWorld(_playerPos), chase.active ? causeway.worldZ(chase.front) : null);
  }
  if (glass) causeway.renderProbe(renderer, scene);
}

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = Math.min(.033, rawDt);
  renderer.info.reset();
  updateGame(dt, clock.elapsedTime);
  renderFrame();
  updatePerformance(rawDt);
}

/* ---- Menus -------------------------------------------------------------- */

function openSettings(from) {
  settingsFrom = from;
  ui.settingsBackButton.textContent = from === "pause" ? "BACK TO PAUSE" : "BACK";
  if (from === "intro") ui.start.classList.remove("active");
  if (from === "pause") ui.pause.classList.remove("active");
  ui.settings.classList.add("active");
}

function closeSettings() {
  ui.settings.classList.remove("active");
  if (settingsFrom === "intro") ui.start.classList.add("active");
  if (settingsFrom === "pause") ui.pause.classList.add("active");
  settingsFrom = null;
}

function openPause() {
  if (state !== "playing" && state !== "lift") return;
  paused = true;  run.focusing = false;
  ui.pauseLevel.textContent = `0${currentLevel} / 03`;
  ui.pauseScore.textContent = String(Math.floor(score)).padStart(6, "0");
  ui.pauseAmmo.textContent = ammo;
  ui.pauseHealth.textContent = Math.max(0, Math.round(health));
  ui.pauseMissions.innerHTML = currentLevel === 1 && missions.active.length
    ? missions.active.map((m) => `<li class="${m.done ? "done" : ""}">${m.def.text}${m.def.goal > 1 ? ` <b>${m.value}/${m.def.goal}</b>` : ""}</li>`).join("")
    : "";
  ui.pause.classList.add("active");
}

function closePause() {
  ui.pause.classList.remove("active");
  paused = false;
}

function togglePhoto() {
  if (photoActive) {
    photoActive = false;
    photo.exit(camera);
    document.body.classList.remove("photo-hide-hud");
    return;
  }
  if (state !== "playing" && state !== "lift") return;
  if (paused) return;
  photoActive = true;
  run.focusing = false;
  photo.enter(camera, avatar.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
  document.body.classList.add("photo-hide-hud");
}

function quitToMenu() {
  closePause(); cancelStory();
  if (photoActive) togglePhoto();
  ui.caption.classList.remove("show"); ui.launchControls.classList.remove("show");
  ui.settings.classList.remove("active"); ui.end.classList.remove("active"); ui.manual.classList.remove("active");
  resetStats("story"); state = "intro"; settingsFrom = null;
  refreshMenuProgress();
  ui.story.classList.remove("active");
  ui.start.classList.add("active");
}

const storyBeats = [
  "Ascension Tower. Level 212. The Meridian resonance laboratory. 03:47.",
  "Trial seven ran through the night. It failed. The subject did not die.",
  "Doctor Vale armed the demolition charges to bury what she made.",
  "You are Subject Seven. Glass shatters at your touch.",
  "Three sectors stand between you and the control core. Get out.",
];
let storyTimeouts = [];
let storyPlaying = false;

for (const _ of storyBeats) ui.storyDots.appendChild(document.createElement("i"));

function showStoryBeat(index) {
  if (index >= storyBeats.length) { finishStory(); return; }
  const text = storyBeats[index];
  ui.storyLine.textContent = text;
  ui.storyLine.classList.add("show");
  ui.storyDots.children[index].classList.add("on");
  const hold = Math.max(2800, text.length * 68);
  storyTimeouts.push(setTimeout(() => {
    ui.storyLine.classList.remove("show");
    storyTimeouts.push(setTimeout(() => showStoryBeat(index + 1), 520));
  }, hold));
}

function cancelStory() {
  storyTimeouts.forEach(clearTimeout); storyTimeouts = [];
  storyPlaying = false;
}

function startStory() {
  cancelStory();
  storyPlaying = true;
  ui.story.classList.add("active");
  ui.start.classList.remove("active");
  ui.storyPrompt.hidden = true;
  ui.storyPlayer.hidden = false;
  ui.storySkipButton.hidden = false;
  ui.storyLine.classList.remove("show");
  for (const dot of ui.storyDots.children) dot.classList.remove("on");
  showStoryBeat(0);
}

function finishStory() {
  cancelStory();
  ui.story.classList.remove("active");
  ui.start.classList.add("active");
}

ui.storySkipButton.addEventListener("click", finishStory);
$("#storyBeginButton").addEventListener("click", startStory);
$("#storySkipToMenuButton").addEventListener("click", finishStory);
$("#replayStoryButton").addEventListener("click", startStory);

$("#startButton").addEventListener("click", () => { ui.start.classList.remove("active"); beginLaunch(); });
ui.endlessButton.addEventListener("click", () => { if (!ui.endlessButton.disabled) startEndless(); });
$("#previewButton").addEventListener("click", startPreview);
$("#manualButton").addEventListener("click", () => { ui.start.classList.remove("active"); ui.manual.classList.add("active"); });
$("#manualBackButton").addEventListener("click", () => { ui.manual.classList.remove("active"); ui.start.classList.add("active"); });
$("#previewExitButton").addEventListener("click", endPreview);
$("#settingsButton").addEventListener("click", () => openSettings("intro"));
$("#settingsBackButton").addEventListener("click", closeSettings);
$("#pauseButton").addEventListener("click", () => { paused ? closePause() : openPause(); });
$("#resumeButton").addEventListener("click", closePause);
$("#pauseSettingsButton").addEventListener("click", () => openSettings("pause"));
$("#restartRunButton").addEventListener("click", () => { closePause(); resetGame(); });
$("#quitButton").addEventListener("click", quitToMenu);
$("#restartButton").addEventListener("click", () => { resetGame(); });
$("#endMenuButton").addEventListener("click", quitToMenu);
ui.viewButton.addEventListener("click", (event) => {
  event.stopPropagation();
  ui.viewMenu.hidden = !ui.viewMenu.hidden;
});
addEventListener("click", (event) => {
  if (!ui.viewMenu.hidden && !event.target.closest("#viewMenu, #viewButton")) ui.viewMenu.hidden = true;
});
ui.sensitivitySlider.addEventListener("input", (event) => { settings.sensitivity = Number(event.target.value); saveSettings(); });
ui.aimAssistToggle.addEventListener("change", (event) => { settings.aimAssist = event.target.checked; saveSettings(); });
ui.reducedMotionToggle.addEventListener("change", (event) => { settings.reducedMotion = event.target.checked; saveSettings(); });
ui.qualitySelect.addEventListener("change", (event) => {
  settings.quality = event.target.value;
  autoLow = false;
  saveSettings();
  applyQuality();
  showMessage("GRAPHICS UPDATED // LEVEL DETAIL APPLIES NEXT RUN");
});
$("#resetSettingsButton").addEventListener("click", () => {
  settings = { ...settingsDefaults, hud: { ...settingsDefaults.hud } };
  applySettingsToControls(); saveSettings(); applyQuality();
});

// Photo mode controls.
causewayHud.photoEl.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.filter !== undefined) {
    postfx.uniforms.uFilter.value = Number(button.dataset.filter);
    for (const b of causewayHud.photoEl.querySelectorAll("[data-filter]")) b.classList.toggle("on", b === button);
  }
  if (button.dataset.action === "exit") togglePhoto();
  if (button.dataset.action === "photo") {
    renderFrame();
    photo.capturePhoto(canvas);
    showMessage("PHOTO SAVED");
  }
  if (button.dataset.action === "360") {
    photo.capture360(scene, camera.position, causeway?.glassShared ?? null);
    showMessage("360 PANORAMA SAVED");
  }
});
causewayHud.photoEl.querySelector("[data-fov]").addEventListener("input", (event) => { photo.fov = Number(event.target.value); });

/* ---- Input ---------------------------------------------------------------- */

addEventListener("pointermove", (event) => {
  const factor = settings.sensitivity / 100;
  pointer.x = THREE.MathUtils.clamp(((event.clientX / innerWidth) * 2 - 1) * factor, -1, 1);
  pointer.y = THREE.MathUtils.clamp((-(event.clientY / innerHeight) * 2 + 1) * factor, -1, 1);
  placeReticle();
});

/**
 * The crosshair is drawn exactly where throws go: at the pointer's aim point
 * (which includes the sensitivity setting), not fixed in the middle of the
 * screen. The system cursor is hidden while aiming so only one marker shows.
 */
function placeReticle() {
  ui.reticle.style.left = `${((pointer.x + 1) / 2) * innerWidth}px`;
  ui.reticle.style.top = `${((1 - pointer.y) / 2) * innerHeight}px`;
}
addEventListener("pointerdown", (event) => {
  if (state === "launch" && causeway) { causeway.skipIntro(); return; }
  if (event.target.closest("button, input, select, label, .screen.active, .cw-photo, .view-menu")) return;
  if (event.button === 0) fire();
  if (event.button === 2 && state === "playing" && currentLevel === 1) run.focusing = true;
});
addEventListener("pointerup", (event) => { if (event.button === 2) run.focusing = false; });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("wheel", (event) => {
  if (photoActive || state !== "playing" || currentLevel !== 1 || paused) return;
  const ball = arsenal.cycle(event.deltaY > 0 ? 1 : -1);
  showMessage(`${ball.name.toUpperCase()} SPHERE // ${ball.cost} PER THROW`);
}, { passive: true });

addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    if (photoActive) togglePhoto();
    else if (state === "preview") endPreview();
    else if (ui.manual.classList.contains("active")) { ui.manual.classList.remove("active"); ui.start.classList.add("active"); }
    else if (ui.settings.classList.contains("active")) closeSettings();
    else if (storyPlaying) finishStory();
    else if (paused) closePause();
    else openPause();
    return;
  }
  if (state === "launch" && causeway) { causeway.skipIntro(); return; }
  if (event.code === "KeyP") { togglePhoto(); return; }
  if (photoActive) return;
  if (event.code === "Space" && storyPlaying) { event.preventDefault(); finishStory(); return; }
  if (event.code === "KeyR" && state === "ended") { resetGame(); return; }
  if (event.code === "KeyF" && !event.repeat) { settings.hud.fps = !settings.hud.fps; saveSettings(); applySettingsToControls(); }
  if (event.code === "KeyM" && !event.repeat) { settings.hud.minimap = !settings.hud.minimap; saveSettings(); applySettingsToControls(); }
  if (event.code === "KeyH" && !event.repeat) document.body.classList.toggle("hud-hidden");
  if (event.code === "KeyV" && !event.repeat) ui.viewMenu.hidden = !ui.viewMenu.hidden;
  if (event.code === "Space" && state === "playing" && !paused) {
    event.preventDefault();
    if (jumpHeight <= 0.01) jumpVelocity = 7.4;
  }
  if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && state === "playing" && !paused) sliding = 0.65;
  if (event.code === "Digit1") demoJump(1);
  if (event.code === "Digit2") demoJump(2);
  if (event.code === "Digit3") demoJump(3);
  if (event.code === "Digit4") demoJump(4);
  if (event.code === "KeyA" || event.code === "ArrowLeft") lane = Math.max(0, lane - 1);
  if (event.code === "KeyD" || event.code === "ArrowRight") lane = Math.min(2, lane + 1);
  if (event.code === "KeyW" || event.code === "ArrowUp") {
    if (currentLevel === 3) heightLane = Math.min(2, heightLane + 1);
    if (currentLevel === 1) { keysDown.add("up"); event.preventDefault(); }
  }
  if (event.code === "KeyS" || event.code === "ArrowDown") {
    if (currentLevel === 3) heightLane = Math.max(0, heightLane - 1);
    if (currentLevel === 1) { keysDown.add("down"); event.preventDefault(); }
  }
  if ((event.code === "KeyQ" || event.code === "KeyE") && state === "playing" && currentLevel === 1 && !event.repeat) {
    const ball = arsenal.cycle(event.code === "KeyE" ? 1 : -1);
    showMessage(`${ball.name.toUpperCase()} SPHERE // ${ball.cost} PER THROW`);
  }
  if (event.code === "KeyC" && (state === "playing" || state === "lift")) { cameraThird = !cameraThird; updateUI(); showMessage(cameraThird ? "CHASE CAMERA" : "FIRST-PERSON CAMERA"); }
});
addEventListener("keyup", (event) => {
  if (event.code === "KeyW" || event.code === "ArrowUp") keysDown.delete("up");
  if (event.code === "KeyS" || event.code === "ArrowDown") keysDown.delete("down");
});
addEventListener("blur", () => { keysDown.clear(); run.focusing = false; });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  postfx.resize();
  minimap.measure();
  placeReticle();
});

applyQuality();
resetStats("story");
refreshMenuProgress();
updateUI();
camera.position.set(0, 1.8, CAUSEWAY_ORIGIN_Z + 8);
requestAnimationFrame(() => minimap.measure());
animate();

/**
 * Read-only handle on game state, for the check harness and for poking at a
 * run from the console during a demo. Not used by the game itself.
 */
let stepTime = 0;
globalThis.__dbg = {
  get state() { return state; },
  get currentLevel() { return currentLevel; },
  get runZ() { return runZ; },
  get health() { return health; },
  get ammo() { return ammo; },
  get score() { return score; },
  get combo() { return combo; },
  get foundry() { return foundry; },
  get causeway() { return causeway; },
  get run() { return run; },
  causewayPace,
  resolveAim: () => resolveAim(aliveTargets(), currentLevel === 1 && causeway ? causeway.solids : []),
  aliveTargets: () => aliveTargets(),
  get projectiles() { return projectiles; },
  get arsenal() { return arsenal; },
  get missions() { return missions; },
  get postfx() { return postfx; },
  foundryDistance,
  causewayDistance,
  demoJump,
  shatter,
  fire,
  resetGame,
  setRunZ(z) { runZ = z; },
  setCausewayDistance(d) { runZ = CAUSEWAY_ORIGIN_Z - d; },
  setLane(index) { lane = index; playerX = lanes[index]; },
  setHealth(v) { health = v; },
  /**
   * Advance the simulation without rendering - for the check harness, which
   * runs in software GL where real frames are far too slow to play through.
   */
  step(frames = 1, dt = 1 / 30) {
    for (let i = 0; i < frames; i += 1) { stepTime += dt; updateGame(dt, clock.elapsedTime + stepTime); }
  },
  render: () => renderFrame(),
  keyDown(name) { keysDown.add(name); },
  keyUp(name) { keysDown.delete(name); },
  setPointer(x, y) { pointer.set(x, y); },
  setAmmo(v) { ammo = v; },
  get playerX() { return playerX; },
  renderer, scene, camera, THREE,
};
