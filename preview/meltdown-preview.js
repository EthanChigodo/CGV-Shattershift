/**
 * Standalone preview of Level 3 - The Meltdown.
 *
 * The whole level - Phase A, the lifts, the roof - is MeltdownGame
 * (src/levels/meltdown/game.js), the same module main.js runs as Level 3.
 * This page only gives it a renderer, a start screen with the character
 * choice, a status line, and the dev keys: R restarts, P skips to the roof,
 * and `?roof` in the URL starts there.
 *
 * Serve the repository over HTTP and open /preview/meltdown.html.
 */

import * as THREE from "../src/three.js";
import { MeltdownGame, CHARACTERS, savedCharacter } from "../src/levels/meltdown/game.js";
import { BEATS } from "../src/levels/meltdown/index.js";

const canvas = document.querySelector("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
// Level 2 measured this game as fill-rate bound: cap the pixel ratio.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const game = new MeltdownGame({
  renderer,
  assetBase: new URL("../assets/meltdown/", import.meta.url).href,
  character: savedCharacter(),
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  devKeys: true,
  summary: true,
});

const ui = {
  cameraName: document.querySelector("#cameraName"),
  beatName: document.querySelector("#beatName"),
  start: document.querySelector("#startOverlay"),
  picks: [...document.querySelectorAll("[data-character]")],
};

/* ---- Start screen: pick a patient, click to wake up ---- */

let started = false;
function begin() {
  if (started) return;
  started = true;
  ui.start?.remove();
  game.begin();
}

function pickCharacter(name) {
  if (!CHARACTERS[name]) return;
  game.setCharacter(name);
  for (const button of ui.picks) button.classList.toggle("picked", button.dataset.character === name);
}
for (const button of ui.picks) {
  button.classList.toggle("picked", button.dataset.character === game.character);
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    pickCharacter(button.dataset.character);
  });
}
document.querySelector("#creditsButton")?.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  game.credits.toggle(true);
});

/* ---- Input: straight through to the game ---- */

addEventListener("pointermove", (event) => game.onPointerMove(event.clientX, event.clientY));
addEventListener("pointerdown", (event) => {
  if (event.target.closest?.("[data-character]") || event.target.closest?.(".mlt-credits")) return;
  begin();
  game.onPointerDown(event);
});
addEventListener("pointerup", (event) => game.onPointerUp(event));
addEventListener("keyup", (event) => game.onKeyUp(event));
addEventListener("blur", () => game.onBlur());
addEventListener("keydown", (event) => {
  if (event.code !== "KeyK") begin();
  game.onKeyDown(event);
});
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  game.resize(innerWidth, innerHeight);
});

/* ---- Loop ---- */

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.update(dt, clock.elapsedTime);
  game.render();
  ui.cameraName.textContent = game.cameraModeName;
  ui.beatName.textContent = game.locationName;
}

game.show();
game.load();
animate();

/* ---- Handle for the check harness and the console ---- */

globalThis.__meltdown = {
  game,
  get level() {
    return game.level;
  },
  get assetsReady() {
    return game.assetsReady;
  },
  get roof() {
    return game.roof;
  },
  get phase() {
    return game.phase;
  },
  runner: game.runner,
  hero: game.hero,
  avatar: game.avatar,
  hud: game.hud,
  scene: game.scene,
  camera: game.camera,
  audio: game.audio,
  projectiles: game.projectiles,
  debris: game.debris,
  beam: game.beam,
  renderer,
  THREE,
  BEATS,
  begin,
  snapCamera: () => (game.snapCamera = true),
  teleport: (distance, options) => game.teleport(distance, options),
  pickCharacter,
  startRoof: () => game.startRoof(),
  set roofOptions(value) {
    game.roofOptions = value ?? {};
  },
  loadRoofAssets: () => game.loadRoofAssets(),
};

// ?roof in the URL starts on the roof (demos, testing Phase B on its own).
if (new URLSearchParams(location.search).has("roof")) {
  const go = () => (game.assetsReady ? (begin(), game.startRoof()) : setTimeout(go, 300));
  go();
}
