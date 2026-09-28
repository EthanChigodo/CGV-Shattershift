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
import { CalibrationLift, LIFT_RADIUS } from "./src/levels/common/calibration-lift.js";
import { PlayerAvatar } from "./src/levels/meltdown/player.js";
import { loadMeltdownAssets } from "./src/levels/meltdown/assets.js";
import { MeltdownGame, CHARACTERS, START_BALLS as MELTDOWN_START_BALLS, savedCharacter, saveCharacter } from "./src/levels/meltdown/game.js";
import { MusicManager } from "./src/audio/music-manager.js";
import { Level1Audio } from "./src/audio/level1-audio.js";

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
const RENDER_AHEAD = 95;
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
/** Level 3 (src/levels/meltdown/game.js), built on the way into it. */
let meltdown = null;
/**
 * The story runs Foundry (sector 1) -> Labs (sector 2) -> Skyline (sector 3)
 * -> Roof (the finale), riding a lift up between each. `currentLevel` still
 * names the *environment* - 1 Causeway (the Skyline), 2 Foundry, 3 Meltdown
 * (the Labs and the Roof) - so each level's own code keeps its id;
 * `sectorNumber()` is the order the player sees. Endless mode is separate:
 * pick any one environment and run it until you go down.
 */
let runKind = "story"; // "story" | "endless"
let endlessEnv = null; // "foundry" | "labs" | "skyline" | "roof"
const endlessRun = { laps: 0, distance: 0 };
let foundrySpeedScale = 1;
/** Launcher balls carried from the Labs up to the Roof. */
let storyBalls = null;
/** Level 3's module is running the Roof (not the Labs). */
let onRoofStage = false;


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

// Music belongs to the application shell, not a level: Level 1 can be rebuilt
// by Play Again while its soundtrack and playback position remain untouched.
// Level 3's existing synthesized effects remain independent.
const music = new MusicManager();
const level1Audio = new Level1Audio(() => music.context);
music.showMenu();
const unlockMusic = async (event) => {
  // Set the briefing intent before unlocking on the same pointer/key gesture,
  // so the menu track cannot briefly start while the piano is loading.
  if (event.target?.closest?.("#storyBeginButton, #replayStoryButton")) music.showStory();
  const ready = music.unlock(); // Creates the shared context synchronously.
  level1Audio.unlock();
  if (await ready) level1Audio.unlock();
};
addEventListener("pointerdown", unlockMusic, { passive: true });
addEventListener("keydown", unlockMusic);

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
  endlessButton: $("#endlessButton"), progressLine: $("#progressLine"), endless: $("#endlessScreen"),
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

// Level 3's old prototype (the "Inverted Core": slabs, gravity rings, panes
// and crystals along z = 0..-438, and the Level 2 -> 3 lift at z = -282)
// was removed when the real Level 3 - The Meltdown - was integrated. It
// lives in src/levels/meltdown/ with its own scene; see the MELTDOWN
// INTEGRATION block below.

const railMat = new THREE.MeshStandardMaterial({ color: 0x35241c, metalness: 0.75, roughness: 0.26 });

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

/**
 * The player's body in Levels 1 and 2 is the same character as in Level 3:
 * the patient picked on the start screen ("Play as"), animated by Level 3's
 * body rig (src/levels/meltdown/player.js) from the run's real speed, lane
 * changes, jumps and slides. Subject 07 throws spheres by hand, so there is
 * no launcher to hold here. The capsule above stays as a stand-in until the
 * model has loaded (or if it cannot load).
 */
const playerBody = new PlayerAvatar();
playerBody.hold = 0;
let playerBodyReady = false;
let playerBodyX = 0;
const playerBodyMaterials = [];
async function loadPlayerBody(name = savedCharacter()) {
  const assets = await loadMeltdownAssets(MELTDOWN_ASSET_BASE, { names: [name] });
  const asset = assets.get(name);
  if (!asset || name !== savedCharacter()) return;
  playerBody.setModel(asset.template);
  playerBodyMaterials.length = 0;
  // A touch of self-light, so the body reads in Level 1's dark, fire-lit
  // halls (Level 1 turns the global lights off). Set once; the per-level
  // strength is a uniform, so changing it costs nothing.
  playerBody.model?.traverse((o) => {
    if (!o.isMesh || !o.material?.map) return;
    o.material.emissiveMap = o.material.map;
    o.material.emissive.setRGB(1, 1, 1);
    o.material.needsUpdate = true;
    playerBodyMaterials.push(o.material);
  });
  if (!playerBodyReady) {
    avatar.add(playerBody.root);
    body.visible = false;
    pack.visible = false;
    playerBodyReady = true;
  }
}

function updatePlayerBody(dt) {
  if (!playerBodyReady) return;
  const moving = state === "playing" && !paused;
  const speed = !moving ? 0 : currentLevel === 1 ? run.speed : currentLevel === 2 ? foundrySpeed() * (foundrySlow > 0 ? 0.45 : 1) : 0;
  const lateralVel = dt > 0 ? (playerX - playerBodyX) / dt : 0;
  playerBodyX = playerX;
  const glow = currentLevel === 1 ? 0.32 : 0.06;
  for (const m of playerBodyMaterials) m.emissiveIntensity = glow;
  playerBody.update(dt, {
    speed,
    lateralVel,
    height: jumpHeight,
    sliding: sliding > 0,
    stumble: run.damage > 0.5 || foundrySlow > 0.3 ? 1 : 0,
  });
}

/** The sector the player is in, in story order (1 Foundry, 2 Labs, 3 Skyline and the Roof). */
function sectorNumber(level = currentLevel) {
  if (level === 2) return 1;
  if (level === 3) return onRoofStage ? 3 : 2;
  return 3;
}

function updateUI() {
  ui.level.textContent = `0${sectorNumber()} / 03`;
  ui.ammo.textContent = ammo; ui.health.textContent = Math.max(0, Math.round(health)); ui.score.textContent = String(Math.floor(score)).padStart(6, "0");
  ui.camera.textContent = currentLevel === 3 && meltdown ? meltdown.cameraModeName : cameraThird ? "CHASE VIEW" : "FIRST PERSON";
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
/**
 * Level 2 ends the way Level 1 does: past the extraction valve the corridor
 * opens onto a landing and the Calibration Lift (Level 1's glass elevator,
 * src/levels/common/calibration-lift.js) takes the player up to Level 3.
 */
let foundryLift = null;
let foundryExit = false;
const FOUNDRY_LANDING = 12;
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
  return (FOUNDRY_SPEED_ZONES.find((zone) => progress < zone.until) ?? FOUNDRY_SPEED_ZONES[2]).speed * foundrySpeedScale;
}

/** @param {number} [variant]  0 = the authored layout; endless laps reshuffle it */
function buildFoundry(variant = 0) {
  if (foundry) {
    foundryHud.unbind();
    foundry.dispose();
  }
  foundryLift?.dispose();

  foundry = new FoundryLevel({
    origin: new THREE.Vector3(0, 0, FOUNDRY_ORIGIN_Z),
    // The game's player moves along -Z and does not follow a curve yet, so the
    // junctions are off. Flip this to false once PlayerController follows
    // route.sample(distance) - see the level design sheet.
    straightRoute: true,
    shadows: false,
    brightness: 1.6,
    runSpeed: FOUNDRY_SPEED_ZONES[2].speed,
    variant,
  });
  foundry.addTo(scene);
  foundry.root.visible = false;
  foundryExit = false;
  foundryLift = new CalibrationLift({ landing: FOUNDRY_LANDING, landingWidth: 11.2 });
  foundryLift.root.position.set(0, 0, FOUNDRY_ORIGIN_Z - foundry.route.totalLength - FOUNDRY_LANDING - LIFT_RADIUS);
  foundryLift.root.visible = false;
  scene.add(foundryLift.root);

  foundryHud.bind(foundry);
  foundry.events.on("complete", () => {
    if (currentLevel !== 2 || state !== "playing") return;
    score += Math.max(0, foundry.state.systemsOnline * 500 + health * 10);
    // Keep running: out of the furnace, across the landing, into the lift.
    foundryExit = true;
    showMessage("EXTRACTION VALVE // TO THE LIFT");
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
  if (foundryLift) foundryLift.root.visible = active;
  if (active) {
    preloadMeltdown();
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
function causewayPace(distance, awake = false) {
  const smooth = THREE.MathUtils.smoothstep;
  // Arriving by lift (the story's Skyline), you are awake from the first step.
  const wake = awake ? 1 : smooth(distance, 20, 230);
  let pace = THREE.MathUtils.lerp(6.0, CAUSEWAY_SPEED.base, wake);
  pace += 0.8 * smooth(distance, 240, 300) * (1 - smooth(distance, 520, 560));
  return { pace, sedation: 1 - wake, drowsy: awake ? 0 : 1 - smooth(distance, 4, 40) };
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
    lookX: 0, lookY: 0, skipWake: false,
  });
}
resetRun();

function resolvedQuality() {
  if (settings.quality === "auto") return autoLow ? "low" : "high";
  return settings.quality;
}

function applyQuality() {
  const q = resolvedQuality();
  // Level 3 is fill-rate bound (measured): it always renders at ratio 1.
  const cap = currentLevel === 3 ? 1 : q === "high" ? 1.5 : q === "medium" ? 1.25 : 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
  renderer.setSize(innerWidth, innerHeight);
  postfx.setQuality(q);
  postfx.setScale(q === "medium" ? 0.85 : 1);
  minimap.measure();
  if (meltdown) {
    meltdown.setBloom(q !== "low");
    if (meltdown.visible) meltdown.syncRenderer();
  }
}

function causewayDistance() {
  return CAUSEWAY_ORIGIN_Z - runZ;
}

function buildCauseway(mode = "story") {
  if (causeway) causeway.dispose();
  buildSkylineLift();
  causewayMode = mode;
  causeway = new CausewayLevel({
    origin: new THREE.Vector3(0, 0, CAUSEWAY_ORIGIN_Z),
    mode,
    quality: resolvedQuality(),
  });
  causeway.addTo(scene);
  // The Skyline is reached by lift now, not woken into: no containment pod.
  // (Level 1 streams its props and resets their roots' visibility, so hide the parts.)
  causeway.pod?.root?.traverse((o) => { if (o !== causeway.pod.root) o.visible = false; });
  if (perf.level >= 1) causeway.probe.interval = Math.max(causeway.probe.interval, 2);
  wireCausewayEvents(causeway);
  return causeway;
}

function wireCausewayEvents(level) {
  const on = (name, fn) => level.events.on(name, (payload) => { if (level === causeway) fn(payload); });
  on("radio", (p) => { causewayHud.radio(p); });
  on("title", (p) => causewayHud.title(`Sector 03 // Beat ${p.index + 1} of 3`, p.name));
  on("hint", (p) => causewayHud.hint(p.text));
  on("file", (p) => causewayHud.caseFile(p.lines, p.found, p.total));
  on("sprinkler", () => causewayHud.hint("Sprinkler open: fires below are going out"));
  on("serum", () => level1Audio.serumCollected());
  on("sphere-cache", () => level1Audio.sphereCollected());
  on("vent", () => causewayHud.hint("Vent clear: the smoke is thinning"));
  on("extinguish", (p) => { if (p.by === "cryo") showMessage(`CRYO // ${p.count} FIRE${p.count > 1 ? "S" : ""} OUT`); });
  on("collapse-warning", () => causewayHud.hint("Ceiling giving way: watch the red ring"));
  on("collapse-start", (p) => level1Audio.startFalling(p.id));
  on("collapse-landed", (p) => { level1Audio.stopFalling(p.id); level1Audio.impact(0.9); triggerShake(0.25); });
  on("glass-break", (p) => { level1Audio.glassBreak(); level1Audio.addGlassDebris(p.position, p.radius); });
  on("pod-break", () => level1Audio.podBreak());
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
  if (skylineLift) skylineLift.root.visible = active;
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
    const { pace, sedation, drowsy } = causewayPace(distance, run.skipWake);
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
    const shielded = absorbWithShield(_forward);
    if (!shielded) damage(22, "INTEGRITY DAMAGED");
    else run.slow = 0.3;
    level1Audio.impact(shielded ? 0.65 : 1);
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
  level1Audio.updateEnvironment(causeway.audioEnvironment(_playerPos));
  level1Audio.updateBrokenGlass(_playerPos, run.speed > 1 && jumpHeight < 0.12);

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
  if (result.spheres) {
    ammo += result.spheres;
    causewayHud.bump(".cw-spheres");
  }
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
  level1Audio.updateElevator(causeway.state.lift.velocity, !result.done);
  avatar.visible = true;
  avatar.position.set(0, result.cabinY, causeway.worldZ(CAUSEWAY_ROUTE.lift));
  const end = settings.reducedMotion ? 6.2 : 7.4;
  ui.fade.style.opacity = THREE.MathUtils.clamp((result.t - (end - 0.9)) / 0.9, 0, 1).toFixed(3);
  if (result.done) finishCausewayLift();
}

/** The Skyline's lift reaches the top: on to the Roof, the finale. */
function finishCausewayLift() {
  level1Audio.cleanupLevel();
  music.fadeOut();
  causewayHud.hideReport();
  setCausewayActive(false);
  // Free the Causeway's GPU resources - the guide's "level changes leak memory" risk.
  causeway.dispose();
  causeway = null;
  enterRoof();
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
  ui.endlessButton.disabled = false;
  ui.endlessButton.title = "Pick any environment and run it until you go down";
  ui.endlessButton.textContent = "Endless";
  const bits = [];
  if (p.best.story) bits.push(`Best run ${String(p.best.story).padStart(6, "0")}`);
  for (const env of ["foundry", "labs", "skyline", "roof"]) {
    const best = env === "skyline" ? Math.max(endlessBest.skyline ?? 0, p.bestDistance ?? 0) : endlessBest[env];
    if (best) bits.push(`${ENDLESS_NAMES[env]} ${best} ${endlessUnit(env)}`);
  }
  bits.push(`Case files ${p.files.length}/5`);
  bits.push(`Missions ${p.completed.length}/13`);
  ui.progressLine.textContent = bits.join("   ");
  if (ui.briefing) ui.briefing.innerHTML = missions.active.map((m) => `<li class="${p.completed.includes(m.def.id) ? "done" : ""}">${m.def.text}</li>`).join("");
}

/* ==================================================================== */
/* MELTDOWN INTEGRATION - Level 3                                        */
/* ==================================================================== */

/**
 * Level 3 is a self-contained module with its own scene, camera,
 * post-processing, HUD and input rules - src/levels/meltdown/game.js, the
 * same module preview/meltdown.html runs on its own. This block builds it
 * on the way into Level 3, forwards input to it, renders it instead of the
 * main scene while it is up, and turns its result into this game's score
 * and end screen. Level 3 opens and closes in lifts (placeholders a teammate
 * is replacing - see src/levels/meltdown/elevator.js).
 *
 * Level 3 synthesises its own sound. The team removed sound from Levels 1
 * and 2 (audio is its own workstream); set MELTDOWN_AUDIO to false to
 * silence Level 3 as well.
 */
const MELTDOWN_AUDIO = true;
const MELTDOWN_ASSET_BASE = new URL("./assets/meltdown/", import.meta.url).href;
let meltdownEntering = false;

function getMeltdown() {
  if (meltdown) return meltdown;
  meltdown = new MeltdownGame({
    renderer,
    assetBase: MELTDOWN_ASSET_BASE,
    character: savedCharacter(),
    audio: MELTDOWN_AUDIO,
    reducedMotion: settings.reducedMotion,
  });
  meltdown.setBloom(resolvedQuality() !== "low");
  meltdown.events.on("complete", (result) => finishMeltdown(true, result));
  meltdown.events.on("failed", (result) => finishMeltdown(false, result));
  // The story: through the lift at the end of the Labs, up to the Skyline.
  meltdown.events.on("corridor-complete", ({ stats }) => {
    if (currentLevel !== 3 || state !== "playing") return;
    score += meltdownScore(stats, false) + 2000 + Math.round(stats.vitality) * 10;
    storyBalls = stats.balls;
    // Not from inside Level 3's own update: hand over once it has returned.
    pendingSkyline = true;
  });
  meltdown.events.on("lap", ({ laps }) => showMessage(`LAP ${laps + 1} // NEW LAYOUT`));
  return meltdown;
}

/** Level 2's end: the player is in the Calibration Lift; the doors close and it rides up. */
function startFoundryLift() {
  if (state !== "playing" || currentLevel !== 2) return;
  state = "lift"; liftTimer = 0; transitionTarget = 3;
  run.liftFrom.copy(camera.position);
  foundryLift.start();
  showMessage("CALIBRATION LIFT // SECTOR 02");
  updateUI();
}

/** Start streaming Level 3's models early - called when Level 2 starts. */
function preloadMeltdown() {
  getMeltdown().preload();
}

/**
 * Into Level 3: black, build it (models are usually in already - they load
 * during Level 2 - and its shaders compile while the screen is black), then
 * fade up inside the arrival lift and open the doors.
 */
async function enterMeltdown() {
  if (meltdownEntering) return;
  meltdownEntering = true;
  const game = getMeltdown();
  game.setMode(runKind === "endless" ? "endless-labs" : "corridor");
  onRoofStage = false;
  ui.fade.style.opacity = "1";
  run.fadeOut = 0;
  setFoundryActive(false);
  // Free Level 2's GPU resources, as Level 1's are freed on the way into
  // Level 2 (a demo jump back rebuilds it).
  if (foundry) { foundryHud.unbind(); foundry.dispose(); foundry = null; }
  foundryLift?.dispose();
  foundryLift = null;
  currentLevel = 3; state = "lift"; transitionTarget = 3; liftTimer = 0;
  health = 100; shake = 0;
  // Spheres left over from the foundry become a few extra balls.
  const balls = MELTDOWN_START_BALLS + Math.min(8, Math.floor(ammo / 4));
  applyQuality();
  game.show();
  updateUI();
  try {
    await game.load({ balls });
  } finally {
    meltdownEntering = false;
  }
  if (currentLevel !== 3 || state !== "lift" || meltdown !== game) return; // quit while loading
  state = "playing";
  run.fadeOut = 1;
  game.begin();
}

/** Out of Level 3 (restart, quit, demo jump): free it and give the renderer back. */
function leaveMeltdown(nextLevel) {
  pendingSkyline = false;
  meltdown?.unload();
  meltdownEntering = false;
  currentLevel = nextLevel;
  applyQuality();
}

let pendingSkyline = false;
function updateMeltdownFrame(dt, time) {
  if (!meltdown) return;
  meltdown.update(dt, time);
  if (pendingSkyline) {
    pendingSkyline = false;
    enterSkyline();
    return;
  }
  // Mirror Level 3's numbers into the game's own (pause screen, end screen).
  if (meltdown.level && state === "playing") {
    health = meltdown.runner.vitality;
    ammo = meltdown.runner.balls;
  }
  document.body.classList.toggle("aiming", state === "playing" && !photoActive && !document.querySelector(".screen.active"));
}

function meltdownScore(s, escaped) {
  let points = s.breaks * 100 + s.downs * 150 + s.falls * 250;
  if (escaped) points += 5000 + Math.round(s.vitality) * 20 + s.balls * 25 + (s.ending === "victory" ? 2500 : 0);
  return points;
}

const MELTDOWN_ENDINGS = {
  EXTRACTED: "You cleared the roof and climbed out on the rescue ladder. Ascension Tower burns behind you.",
  "BARELY OUT": "You jumped for the ladder with them still on the roof, and it held. Ascension Tower burns behind you.",
  "CAUGHT BY THE FIRE": "The fire caught up. Shoot what blocks you, grab ball sacks and power-up vials, and do not stop.",
  "THE BUILDING WENT UP": "The building went up before you reached the lift. The evac signs count down - keep moving.",
  "THEY GOT YOU": "The roof was too much. Keep moving, dodge (SPACE) through their charges, and lure them off the open ledges.",
  "LEFT BEHIND": "The helicopter could not wait. When it hangs off the east ledge, get to the edge and jump (SPACE) for the ladder.",
};

/** Level 3 finished: its numbers into the game's score, and the end screen. */
function finishMeltdown(escaped, result) {
  if (currentLevel !== 3 || state !== "playing") return;
  const s = result.stats;
  score += meltdownScore(s, escaped);
  health = s.vitality;
  ammo = s.balls;
  updateUI();
  if (runKind === "endless") { endRun(false, null, endlessResult()); return; }
  endRun(escaped, null, {
    eyebrow: escaped ? "RUN COMPLETE // ALL THREE SECTORS" : "RUN TERMINATED // SECTOR 03",
    title: result.title,
    text: MELTDOWN_ENDINGS[result.title],
    stats: `${Math.round(s.time)} s on the roof   ${s.breaks} broken   ${s.downs} downed   ${s.falls} over the edge   ${s.hits} hits taken`,
  });
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
const BALL_CORRIDOR_RESTITUTION = 1.0;

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
    projectiles.push({ mesh, velocity, life: 3, gravity, ball: ball?.key ?? "glass", scored: false, bounces: 0, wallBounces: 0, ceilingBounces: 0 });
  }
  run.shots += count;
  if (inCauseway) level1Audio.throwBall();
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
      const surface = currentLevel === 1 && causeway ? causeway.corridorSurfaceHit(old, p.mesh.position, p.mesh.scale.x) : null;
      raycaster.far = Infinity;
      // Near miss on a small target counts: a sphere passing within its own
      // radius plus 0.25 m of a small target's bounding sphere hits it.
      if (!hit && currentLevel === 1) hit = grazeTarget(targets, old, p.mesh.position, p.mesh.scale.x + 0.25);
      if (hit && (!solid || hit.distance <= solid.distance) && (!surface || hit.distance <= surface.distance)) {
        const result = shatter(hit.object, { point: hit.point, direction: p.velocity, ball: p.ball });
        if (result && !result.rejected) { p.scored = true; run.hits += 1; }
        if (p.ball !== "glass") { detonate(p, hit.point); p.life = 0; }
        else if (!result || result.cracked || result.rejected || !["pane", "blade", "falling", "tank", "door"].includes(result.kind) || currentLevel !== 1) p.life = 0;
        else p.velocity.multiplyScalar(0.82); // glass spheres punch through and keep going
      } else if (surface && (!solid || surface.distance <= solid.distance)) {
        const speed = p.velocity.length();
        p.velocity.reflect(surface.normal).normalize().multiplyScalar(speed * BALL_CORRIDOR_RESTITUTION);
        p.mesh.position.copy(surface.position);
        if (surface.surface === "ceiling") p.ceilingBounces += 1;
        else p.wallBounces += 1;
        level1Audio.surfaceRicochet();
        causeway.ricochet(surface.point);
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
  if (currentLevel === 3 || meltdown?.visible) leaveMeltdown(1);
  foundrySpeedScale = 1; endlessRun.laps = 0; endlessRun.distance = 0;
  ammo = START_SPHERES; health = 100; score = 0; lane = 1; playerX = 0; playerY = 0;
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

/**
 * Play the Causeway (the Skyline) straight away, in its own "story" or
 * "endless" mode - the test harness and dev tools use this; the menus go
 * through startCampaign() / startEndless().
 */
function resetGame(mode = causewayMode) {
  runKind = mode === "endless" ? "endless" : "story";
  endlessEnv = mode === "endless" ? "skyline" : null;
  resetStats(mode); state = "playing";
  level1Audio.startLevel();
  music.playRound1();
  causewayHud.show();
  if (mode === "endless") causewayHud.title("Endless lab", "Randomised. Faster every 250 m.", 2.2);
}

/* ---- The story and endless runs ----------------------------------------- */

/** The Calibration Lift the player arrives in at the start of the Skyline. */
let skylineLift = null;
function buildSkylineLift() {
  skylineLift?.dispose();
  skylineLift = new CalibrationLift();
  // Behind the start line, doors facing down the ward (local +Z -> world -Z).
  skylineLift.root.position.set(0, 0, CAUSEWAY_ORIGIN_Z + LIFT_RADIUS + 0.9);
  skylineLift.root.rotation.y = Math.PI;
  skylineLift.setDoorsOpen(0);
  skylineLift.root.visible = false;
  scene.add(skylineLift.root);
}

/** Common reset for arriving in a runner level. */
function resetRunner() {
  lane = 1; playerX = 0; playerY = 0; jumpHeight = 0; jumpVelocity = 0; sliding = 0;
  shake = 0; snapCamera = true; liftTimer = 0;
  camera.fov = 68; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
}

/** Start pressed: the story, from the basement up. */
function startCampaign() {
  resetStats("story");
  runKind = "story"; endlessEnv = null; storyBalls = null;
  music.playRound1();
  enterFoundry();
}

/** Sector 1 - the Shifting Foundry, in the basement. */
function enterFoundry() {
  if (currentLevel === 1 && causeway) setCausewayActive(false);
  currentLevel = 2; state = "playing"; health = 100;
  resetRunner();
  runZ = FOUNDRY_ORIGIN_Z; cameraThird = true;
  if (!foundry) buildFoundry();
  foundryExit = false;
  setFoundryActive(true);
  ui.fade.style.opacity = "1";
  run.fadeOut = 1;
  showMessage(runKind === "endless" ? "ENDLESS // THE FOUNDRY" : "SECTOR 01 // THE SHIFTING FOUNDRY");
  updateUI();
}

/** Endless Foundry: past the end, a new layout, a little faster each lap. */
function foundryLap() {
  endlessRun.laps += 1;
  endlessRun.distance += foundry.route.totalLength;
  foundrySpeedScale = 1 + 0.07 * endlessRun.laps;
  ui.fade.style.opacity = "1";
  run.fadeOut = 1;
  buildFoundry(endlessRun.laps);
  setFoundryActive(true);
  runZ = FOUNDRY_ORIGIN_Z; lane = 1; snapCamera = true;
  health = Math.min(100, health + 15);
  showMessage(`LAP ${endlessRun.laps + 1} // FASTER`);
  updateUI();
}

/**
 * Sector 3 - the Skyline (the Glass Causeway). The Labs' lift has carried
 * you up; you step out of the Calibration Lift at the start of the ward.
 */
function enterSkyline() {
  if (currentLevel === 3) leaveMeltdown(1);
  if (!causeway) buildCauseway("story");
  currentLevel = 1; causewayMode = "story";
  resetRun();
  // Awake and running from the first step: no sedation (that was the pod's).
  run.skipWake = true;
  run.sedation = 0; run.drowsy = 0; run.clearHinted = true; run.awakeHinted = true;
  health = 100; ammo = START_SPHERES;
  resetRunner();
  cameraThird = false;
  runZ = CAUSEWAY_ORIGIN_Z;
  setFoundryActive(false);
  setCausewayActive(true);
  causewayHud.reset();
  causewayHud.setMissions(missions.active);
  applyQuality();
  skylineLift?.setDoorsOpen(0);
  state = "launch"; launchTimer = 0;
  level1Audio.startLevel();
  ui.fade.style.opacity = "1";
  run.fadeOut = 1;
  updateUI();
}

/** The Roof - the finale (and endless Roof). */
async function enterRoof() {
  if (meltdownEntering) return;
  meltdownEntering = true;
  const game = getMeltdown();
  game.setMode(runKind === "endless" ? "endless-roof" : "full");
  onRoofStage = true;
  ui.fade.style.opacity = "1";
  run.fadeOut = 0;
  if (currentLevel === 1 && causeway) setCausewayActive(false);
  setFoundryActive(false);
  currentLevel = 3; state = "lift"; transitionTarget = 3; liftTimer = 0;
  health = 100; shake = 0;
  applyQuality();
  game.show();
  updateUI();
  try {
    await game.enterRoof({ balls: storyBalls ?? MELTDOWN_START_BALLS, vitality: 100 });
  } finally {
    meltdownEntering = false;
  }
  if (currentLevel !== 3 || state !== "lift" || meltdown !== game) return; // quit while loading
  state = "playing";
  run.fadeOut = 1;
  updateUI();
}

/** Endless: one environment, until you go down. */
function startEndless(env) {
  resetStats(env === "skyline" ? "endless" : "story");
  missions.active = [];
  runKind = "endless"; endlessEnv = env; storyBalls = null;
  endlessRun.laps = 0; endlessRun.distance = 0; foundrySpeedScale = 1;
  ui.start.classList.remove("active");
  ui.endless.classList.remove("active");
  music.playRound1();
  if (env === "skyline") {
    state = "playing";
    level1Audio.startLevel();
    causewayHud.show();
    causewayHud.title("Endless // The Skyline", "Randomised. Faster every 250 m.", 2.2);
    return;
  }
  setCausewayActive(false);
  if (env === "foundry") enterFoundry();
  else if (env === "labs") enterMeltdown();
  else if (env === "roof") enterRoof();
}

/** "Run again" / "Restart run" / R: the same kind of run, from the top. */
function restartRun() {
  if (runKind === "endless" && endlessEnv) startEndless(endlessEnv);
  else startCampaign();
}

/* ---- Endless records ------------------------------------------------------ */

const ENDLESS_NAMES = { foundry: "The Foundry", labs: "The Labs", skyline: "The Skyline", roof: "The Roof" };
function loadEndlessBest() {
  try {
    return JSON.parse(localStorage.getItem("fractureRunEndlessBest")) ?? {};
  } catch (error) {
    return {};
  }
}
const endlessBest = loadEndlessBest();
function recordEndless(env, value) {
  endlessBest[env] = Math.max(endlessBest[env] ?? 0, value);
  try { localStorage.setItem("fractureRunEndlessBest", JSON.stringify(endlessBest)); } catch (error) {}
  return endlessBest[env];
}
function endlessUnit(env) { return env === "roof" ? "s" : "m"; }

/** How far this endless run got, for the end screen and the records. */
function endlessResult() {
  const env = endlessEnv;
  let value = 0;
  if (env === "foundry") value = Math.floor(endlessRun.distance + (foundry ? foundryDistance() : 0));
  else if (env === "labs") value = Math.floor(meltdown?.stats.endlessDistance ?? 0);
  else if (env === "roof") value = Math.floor(meltdown?.stats.roofTime ?? 0);
  else if (env === "skyline") value = Math.floor(causeway ? causewayDistance() : 0);
  const best = recordEndless(env, value);
  const unit = endlessUnit(env);
  return {
    eyebrow: `ENDLESS // ${ENDLESS_NAMES[env].toUpperCase()}`,
    title: env === "roof" ? `SURVIVED ${value} S` : `${value} M`,
    text: `Best in ${ENDLESS_NAMES[env]}: ${best} ${unit}.${env === "foundry" || env === "labs" ? " Every lap is a new layout, and faster." : env === "roof" ? " The waves never stop coming." : ""}`,
  };
}

function refreshEndlessMenu() {
  for (const button of document.querySelectorAll("[data-endless]")) {
    const env = button.dataset.endless;
    const best = endlessBest[env];
    button.querySelector("small").textContent = best ? `Best ${best} ${endlessUnit(env)}` : "No record yet";
  }
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

const sectorNames = { 1: "GLASS CAUSEWAY", 2: "SHIFTING FOUNDRY", 3: "MELTDOWN" };
const sectorBriefings = {
  1: "Sector one. The Glass Causeway. Break the glass before it breaks you.",
  2: "Sector two. The Shifting Foundry. The machinery will not stop for you.",
  3: "Sector three. The Meltdown. They are burning the evidence. Get to the roof.",
};
const failReasons = {
  fell: "The skybridge gave way beneath you. Sprint with W when the collapse closes in.",
  crushed: "The atrium came down before the gate opened. Break locks I, II, III in order.",
  fire: "The fire took the last of your integrity. Open sprinklers or throw cryo spheres.",
  smoke: "The smoke was too thick. Break vent covers to clear the air.",
};

/**
 * @param {boolean} won
 * @param {string} [reason]  key into failReasons
 * @param {object} [detail]  overrides from the level: { eyebrow, title, text, stats }
 */
function endRun(won, reason = null, detail = null) {
  if (state === "ended") return;
  state = "ended"; ui.final.textContent = String(Math.floor(score)).padStart(6, "0");
  if (currentLevel === 1) { music.gameOverDuck(); level1Audio.gameOver(); }
  causewayHud.warning(null);
  if (runKind === "endless" && endlessEnv && !detail && endlessEnv !== "skyline") detail = endlessResult();
  ui.endEyebrow.textContent = won ? "RUN COMPLETE" : `RUN TERMINATED // SECTOR 0${sectorNumber()}`;
  ui.endTitle.textContent = won ? "CONTROL CORE STABILISED" : `THE ${sectorNames[currentLevel]} CLAIMED YOU`;
  ui.endText.textContent = won
    ? "The Causeway, Foundry, and Inverted Core are stable. The tower holds."
    : failReasons[reason] ?? `Integrity failed in the ${sectorNames[currentLevel].toLowerCase()}. Shift lanes earlier and preserve your spheres.`;
  ui.endStats.textContent = "";
  if (detail) {
    if (detail.eyebrow) ui.endEyebrow.textContent = detail.eyebrow;
    if (detail.title) ui.endTitle.textContent = detail.title;
    if (detail.text) ui.endText.textContent = detail.text;
    if (detail.stats) ui.endStats.textContent = detail.stats;
  }
  if (currentLevel === 1 && causeway) {
    const distance = Math.max(0, Math.floor(causewayDistance()));
    const s = missionStats();
    const accuracy = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
    if (causewayMode === "endless") {
      if (runKind === "endless") recordEndless("skyline", distance);
      ui.endTitle.textContent = `SIGNAL LOST AT ${distance} M`;
      ui.endText.textContent = `Best endless distance: ${Math.max(distance, missions.progress.bestDistance ?? 0)} m. The lab rebuilds itself differently every run.`;
    }
    ui.endStats.textContent = `${distance} m run   ${accuracy}% accuracy   ${s.panes} glass   ${s.extinguished} fires out   ${s.files.length} case files`;
    missions.commit({ mode: causewayMode, score: Math.floor(score), distance, files: s.files });
    refreshMenuProgress();
  }
  ui.end.classList.add("active");
}

/**
 * Demo keys 1-4 jump to a stage of the story: 1 Foundry, 2 Labs, 3 Skyline,
 * 4 Roof. (Endless is on the menu.)
 */
function demoJump(stage) {
  if (state !== "playing") return;
  music.fadeOut();
  runKind = "story"; endlessEnv = null;
  if (currentLevel === 1 && causeway) { setCausewayActive(false); level1Audio.cleanupLevel(); }
  if (currentLevel === 3) leaveMeltdown(stage === 2 ? 3 : 2);
  showMessage(`DEMO JUMP // ${["", "SECTOR 01", "SECTOR 02", "SECTOR 03", "THE ROOF"][stage]}`);
  if (stage === 1) { setFoundryActive(false); if (foundry) buildFoundry(); enterFoundry(); }
  else if (stage === 2) { setFoundryActive(false); enterMeltdown(); }
  else if (stage === 3) { setFoundryActive(false); if (!causeway) buildCauseway("story"); enterSkyline(); }
  else if (stage === 4) { setFoundryActive(false); enterRoof(); }
}


/**
 * The Skyline begins in the Calibration Lift the Labs' lift carried you up
 * in: the doors open onto the ward and you step out (first person), then the
 * run begins. Any key or click skips to the end.
 */
function updateLaunch(dt, time) {
  launchTimer += dt;
  causeway.update({ dt, time, distance: 0, player: playerWorld(_playerPos), playing: false });
  scene.fog.color.copy(causeway.fogColor);
  scene.fog.density = causeway.fogDensity;
  const t = launchTimer;
  skylineLift?.update(dt, time);
  skylineLift?.setDoorsOpen((t - 0.5) / 0.8);
  // From the middle of the cabin to the start line, speeding up.
  const u = THREE.MathUtils.clamp((t - 1.3) / 0.9, 0, 1);
  const cabinZ = skylineLift ? skylineLift.root.position.z : CAUSEWAY_ORIGIN_Z + 6;
  const z = THREE.MathUtils.lerp(cabinZ, CAUSEWAY_ORIGIN_Z + 0.15, u * u);
  camera.position.set(0, 1.72 + Math.sin(t * 9) * 0.015 * u, z);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 1.6, z - 12);
  avatar.visible = false;
  if (t >= 2.2) {
    state = "playing"; snapCamera = true;
    skylineLift?.setDoorsOpen(1);
    causewayHud.show();
    causewayHud.title("Sector 03 of 03", "The Glass Causeway", 2.4);
  }
}

function skipLaunch() {
  launchTimer = Math.max(launchTimer, 2.15);
}

function clearPostLooks() {
  const u = postfx.uniforms;
  for (const key of ["uSmoke", "uDamage", "uHeat", "uThermal", "uOverdrive", "uPrism", "uFocus", "uSpeed", "uFlash", "uLens", "uPulse", "uSedation"]) u[key].value = 0;
  for (const slot of u.uHaze.value) slot.w = 0;
}

function updateGame(dt, time) {
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
  avatar.visible = cameraThird || state === "lift" || state === "launch" || photoActive;
  // Blink through the mercy window after an impact.
  if ((foundryInvulnerable > 0 || run.invulnerable > 0) && Math.floor(time * 14) % 2 === 0 && !photoActive) avatar.visible = false;
  body.scale.y = sliding > 0 ? 0.55 : 1;
  body.rotation.z = Math.sin(time * 9) * .035;
  updatePlayerBody(paused ? 0 : dt);
  for (const crystal of breakables) if (crystal.userData.kind === "crystal" && crystal.userData.alive) crystal.rotation.y += dt * 1.8;
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
  // Level 3 runs its own world, camera and HUD (src/levels/meltdown/game.js).
  if (currentLevel === 3) { updateMeltdownFrame(dt, time); return; }

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
    } else if (currentLevel === 2) {
      runZ -= dt * foundrySpeed() * (foundrySlow > 0 ? 0.45 : 1);
      // Level 2 runs its own collision - the foundry's hazards are nested
      // inside groups.
      updateFoundry(dt, time);

      // Level 2 exits on the foundry's own `complete` event - breaking the
      // extraction valve - rather than on a hard-coded z. If the player somehow
      // runs past the end, fall through to the lift anyway. Either way they
      // run on, centre lane, into the Calibration Lift.
      if (runKind === "endless") {
        // Endless: no lift - at the end of the foundry, a new layout, faster.
        if (foundry && foundryDistance() > foundry.route.totalLength - 4) foundryLap();
      } else if (foundry && (foundryExit || foundryDistance() > foundry.route.totalLength - 4)) {
        foundryExit = true;
        lane = 1;
        if (foundryLift && runZ <= foundryLift.root.position.z) {
          runZ = foundryLift.root.position.z;
          startFoundryLift();
        } else if (!foundryLift) {
          state = "lift"; liftTimer = 0; transitionTarget = 3;
        }
      }
    }
  } else if (state === "lift" && transitionTarget === 2 && causeway) {
    causeway.update({ dt, time: simTime, distance: causewayDistance(), player: playerWorld(_playerPos), playing: false });
    updateCausewayLift(dt);
  } else if (state === "lift" && transitionTarget === 3 && foundryLift?.state.riding) {
    // Level 2 -> 3: Level 1's lift ride, then Level 3 opens with the player
    // stepping out of its own lift (see enterMeltdown).
    const ride = foundryLift.update(dt, time, settings.reducedMotion);
    foundryLift.cameraPose(ride.t, run.liftFrom, camera.position, _look, settings.reducedMotion);
    camera.up.set(0, 1, 0);
    camera.lookAt(_look);
    foundryLift.floorPoint(avatar.position);
    avatar.visible = true;
    if (currentLevel === 2 && foundry) updateFoundry(dt, time);
    ui.fade.style.opacity = ride.fade.toFixed(3);
    if (ride.done) enterMeltdown();
  } else if (state === "lift" && transitionTarget === 3) {
    // No lift to ride (e.g. it failed to build): just fade across.
    liftTimer += dt;
    ui.fade.style.opacity = Math.min(1, liftTimer / 1.1).toFixed(3);
    if (liftTimer > 1.2) enterMeltdown();
  } else if (state === "ended" && inCauseway) {
    // Keep the world alive behind the end screen.
    causeway.update({ dt, time: simTime, distance: causewayDistance(), player: playerWorld(_playerPos), playing: false });
  }

  // The lift can hand over to Level 2 (and dispose Level 1) during this frame.
  const causewayLive = currentLevel === 1 && !!causeway && causeway.root.visible;

  // ---- Cameras ---------------------------------------------------------
  if (causewayLive && state !== "lift") {
    causewayCamera(dt, time);
  } else if (!(state === "lift" && transitionTarget === 2 && causewayLive) && !(state === "lift" && transitionTarget === 3 && foundryLift?.state.riding)) {
    const forward = new THREE.Vector3(0, 1.25, runZ - 12);
    const desired = cameraThird ? new THREE.Vector3(playerX, 4.2, runZ + 8.5) : new THREE.Vector3(playerX, 1.8, runZ + .7);
    camera.up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 4));
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
  if (settings.quality === "auto" && state === "playing" && currentLevel !== 3 && !paused && document.visibilityState === "visible") {
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
  if (currentLevel === 3 && meltdown?.visible) { meltdown.render(); return; }
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
  music.pauseDuck();
  if (currentLevel === 1) level1Audio.setPaused(true);
  if (currentLevel === 3) meltdown?.setPaused(true);
  ui.pauseLevel.textContent = `0${sectorNumber()} / 03`;
  ui.pauseScore.textContent = String(Math.floor(score)).padStart(6, "0");
  ui.pauseAmmo.textContent = ammo;
  ui.pauseHealth.textContent = Math.max(0, Math.round(health));
  ui.pauseMissions.innerHTML = currentLevel === 1 && missions.active.length
    ? missions.active.map((m) => `<li class="${m.done ? "done" : ""}">${m.def.text}${m.def.goal > 1 ? ` <b>${m.value}/${m.def.goal}</b>` : ""}</li>`).join("")
    : "";
  ui.pause.classList.add("active");
}

function closePause() {
  const wasPaused = paused;
  ui.pause.classList.remove("active");
  paused = false;
  if (wasPaused) music.restore();
  if (wasPaused && currentLevel === 1) level1Audio.setPaused(false);
  if (currentLevel === 3) meltdown?.setPaused(false);
}

function togglePhoto() {
  if (photoActive) {
    photoActive = false;
    photo.exit(camera);
    document.body.classList.remove("photo-hide-hud");
    return;
  }
  if (state !== "playing" && state !== "lift") return;
  if (paused || currentLevel === 3) return;
  photoActive = true;
  run.focusing = false;
  photo.enter(camera, avatar.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
  document.body.classList.add("photo-hide-hud");
}

function quitToMenu() {
  closePause(); cancelStory();
  level1Audio.cleanupLevel();
  if (photoActive) togglePhoto();
  ui.caption.classList.remove("show"); ui.launchControls.classList.remove("show");
  ui.settings.classList.remove("active"); ui.end.classList.remove("active"); ui.manual.classList.remove("active");
  resetStats("story"); state = "intro"; settingsFrom = null;
  refreshMenuProgress();
  ui.story.classList.remove("active");
  ui.start.classList.add("active");
  music.showMenu();
}

const storyBeats = [
  "Ascension Tower. Level 212. The Meridian resonance laboratory. 03:47.",
  "Trial seven ran through the night. It failed. The subject did not die.",
  "Doctor Vale armed the demolition charges to bury what she made.",
  "You are Subject Seven. You wake in the basement, and someone is on your side.",
  "The foundry, the labs, the skyline. A helicopter waits on the roof. Get out.",
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
  music.showStory();
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
  music.showMenu();
}

ui.storySkipButton.addEventListener("click", finishStory);
$("#storyBeginButton").addEventListener("click", startStory);
$("#storySkipToMenuButton").addEventListener("click", finishStory);
$("#replayStoryButton").addEventListener("click", startStory);

// Character choice: who you play as (Level 3 shows them; saved for next time).
const characterButtons = [...document.querySelectorAll("[data-character]")];
function showCharacterChoice() {
  const chosen = savedCharacter();
  for (const button of characterButtons) {
    const on = button.dataset.character === chosen;
    button.classList.toggle("picked", on);
    button.setAttribute("aria-pressed", String(on));
  }
}
for (const button of characterButtons) {
  button.addEventListener("click", () => {
    if (!CHARACTERS[button.dataset.character]) return;
    saveCharacter(button.dataset.character);
    loadPlayerBody(button.dataset.character);
    meltdown?.setCharacter(button.dataset.character);
    showCharacterChoice();
  });
}
showCharacterChoice();
loadPlayerBody();

$("#startButton").addEventListener("click", () => { ui.start.classList.remove("active"); startCampaign(); });
ui.endlessButton.addEventListener("click", () => { ui.start.classList.remove("active"); refreshEndlessMenu(); ui.endless.classList.add("active"); });
for (const button of document.querySelectorAll("[data-endless]")) {
  button.addEventListener("click", () => startEndless(button.dataset.endless));
}
$("#endlessBackButton").addEventListener("click", () => { ui.endless.classList.remove("active"); ui.start.classList.add("active"); });
$("#previewButton").addEventListener("click", startPreview);
$("#manualButton").addEventListener("click", () => { ui.start.classList.remove("active"); ui.manual.classList.add("active"); });
$("#manualBackButton").addEventListener("click", () => { ui.manual.classList.remove("active"); ui.start.classList.add("active"); });
$("#previewExitButton").addEventListener("click", endPreview);
$("#settingsButton").addEventListener("click", () => openSettings("intro"));
$("#settingsBackButton").addEventListener("click", closeSettings);
$("#pauseButton").addEventListener("click", () => { paused ? closePause() : openPause(); });
$("#resumeButton").addEventListener("click", closePause);
$("#pauseSettingsButton").addEventListener("click", () => openSettings("pause"));
$("#restartRunButton").addEventListener("click", () => { closePause(); restartRun(); });
$("#quitButton").addEventListener("click", quitToMenu);
$("#restartButton").addEventListener("click", () => { restartRun(); });
$("#endMenuButton").addEventListener("click", quitToMenu);
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button && !button.disabled) level1Audio.uiClick();
});
ui.viewButton.addEventListener("click", (event) => {
  event.stopPropagation();
  ui.viewMenu.hidden = !ui.viewMenu.hidden;
});
addEventListener("click", (event) => {
  if (!ui.viewMenu.hidden && !event.target.closest("#viewMenu, #viewButton")) ui.viewMenu.hidden = true;
});
ui.sensitivitySlider.addEventListener("input", (event) => { settings.sensitivity = Number(event.target.value); saveSettings(); });
ui.aimAssistToggle.addEventListener("change", (event) => { settings.aimAssist = event.target.checked; saveSettings(); });
ui.reducedMotionToggle.addEventListener("change", (event) => { settings.reducedMotion = event.target.checked; saveSettings(); meltdown?.setReducedMotion(settings.reducedMotion); });
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
  meltdown?.onPointerMove(event.clientX, event.clientY);
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
  if (state === "launch" && causeway) { skipLaunch(); return; }
  if (event.target.closest("button, input, select, label, .screen.active, .cw-photo, .view-menu, .mlt-credits")) return;
  if (currentLevel === 3) {
    if (meltdown && state === "playing" && !paused) meltdown.onPointerDown(event);
    return;
  }
  if (event.button === 0) fire();
  if (event.button === 2 && state === "playing" && currentLevel === 1) run.focusing = true;
});
addEventListener("pointerup", (event) => {
  if (event.button === 2) run.focusing = false;
  meltdown?.onPointerUp(event);
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("wheel", (event) => {
  if (photoActive || state !== "playing" || currentLevel !== 1 || paused) return;
  const ball = arsenal.cycle(event.deltaY > 0 ? 1 : -1);
  showMessage(`${ball.name.toUpperCase()} SPHERE // ${ball.cost} PER THROW`);
}, { passive: true });

addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    if (event.repeat) return;
    level1Audio.uiClick();
    if (photoActive) togglePhoto();
    else if (state === "preview") endPreview();
    else if (ui.manual.classList.contains("active")) { ui.manual.classList.remove("active"); ui.start.classList.add("active"); }
    else if (ui.endless.classList.contains("active")) { ui.endless.classList.remove("active"); ui.start.classList.add("active"); }
    else if (ui.settings.classList.contains("active")) closeSettings();
    else if (storyPlaying) finishStory();
    else if (paused) closePause();
    else openPause();
    return;
  }
  if (state === "launch" && causeway) { skipLaunch(); return; }
  // Level 3 has its own controls; the keys it uses are not also acted on
  // here (Esc, the demo jumps, H and V still are).
  if (currentLevel === 3 && meltdown && state === "playing" && !paused && meltdown.onKeyDown(event)) return;
  if (event.code === "KeyP") { togglePhoto(); return; }
  if (photoActive) return;
  if (event.code === "Space" && storyPlaying) { event.preventDefault(); finishStory(); return; }
  if (event.code === "KeyR" && state === "ended") { level1Audio.uiClick(); restartRun(); return; }
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
    if (currentLevel === 1) { keysDown.add("up"); event.preventDefault(); }
  }
  if (event.code === "KeyS" || event.code === "ArrowDown") {
    if (currentLevel === 1) { keysDown.add("down"); event.preventDefault(); }
  }
  if ((event.code === "KeyQ" || event.code === "KeyE") && state === "playing" && currentLevel === 1 && !event.repeat) {
    const ball = arsenal.cycle(event.code === "KeyE" ? 1 : -1);
    showMessage(`${ball.name.toUpperCase()} SPHERE // ${ball.cost} PER THROW`);
  }
  if (event.code === "KeyC" && (state === "playing" || state === "lift")) { cameraThird = !cameraThird; updateUI(); showMessage(cameraThird ? "CHASE CAMERA" : "FIRST-PERSON CAMERA"); }
});
addEventListener("keyup", (event) => {
  meltdown?.onKeyUp(event);
  if (event.code === "KeyW" || event.code === "ArrowUp") keysDown.delete("up");
  if (event.code === "KeyS" || event.code === "ArrowDown") keysDown.delete("down");
});
addEventListener("blur", () => { keysDown.clear(); run.focusing = false; meltdown?.onBlur(); });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  postfx.resize();
  minimap.measure();
  placeReticle();
  meltdown?.resize(innerWidth, innerHeight);
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
  get meltdown() { return meltdown; },
  enterMeltdown,
  get run() { return run; },
  causewayPace,
  resolveAim: () => resolveAim(aliveTargets(), currentLevel === 1 && causeway ? causeway.solids : []),
  aliveTargets: () => aliveTargets(),
  get projectiles() { return projectiles; },
  get arsenal() { return arsenal; },
  get missions() { return missions; },
  get postfx() { return postfx; },
  get music() { return music.snapshot(); },
  get level1Audio() { return level1Audio.snapshot(); },
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
