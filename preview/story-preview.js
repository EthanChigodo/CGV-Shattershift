/**
 * Story systems preview (preview/story.html): the Phase 1 pieces on their
 * own, in a test room - the wake-up cutscene with Dr. Okoro, the elevator's
 * reaction ladder, a walk-and-talk down a corridor, and the mash / sprint /
 * latch reactions. Also the page the story checks drive (tests/story/).
 *
 * window.__story exposes everything for tests: set `manual = true` and call
 * step(frames, dt) to run deterministically.
 */

import * as THREE from "../src/three.js";
import { RoomEnvironment } from "../src/three-addons.js";
import { StoryUI } from "../src/story/story-ui.js";
import { ReactionHits, struggleReaction, sprintReaction, latchReaction } from "../src/story/reaction.js";
import { CutscenePlayer } from "../src/story/cutscene.js";
import { Companion, loadStoryCharacter } from "../src/story/companion.js";
import { StoryVoice } from "../src/story/voice.js";
import { wakeScene, ladderScene } from "../src/story/scenes.js";
import { SCENES, readTime } from "../src/story/script.js";

const ASSET_BASE = new URL("../assets/meltdown/", import.meta.url).href;

/* ---- Renderer and a test recovery room -------------------------------- */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f10);
scene.fog = new THREE.Fog(0x0b0f10, 8, 40);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.03, 120);
camera.position.set(2.5, 1.7, 3);
camera.lookAt(0, 1, 0);

function tileTexture(base, line, size = 512, cells = 8) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i += 1) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
  g.strokeStyle = line;
  g.lineWidth = 3;
  const step = size / cells;
  for (let i = 0; i <= cells; i += 1) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const room = new THREE.Group();
scene.add(room);
{
  const floorTex = tileTexture("#c9cfcc", "#9aa3a0");
  floorTex.repeat.set(4, 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xa9b6b3, roughness: 0.85 });
  const wall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    room.add(m);
  };
  wall(9, 3.2, 0, 1.6, -4.5, 0);
  wall(9, 3.2, 4.5, 1.6, 0, -Math.PI / 2);
  wall(9, 3.2, -4.5, 1.6, 0, Math.PI / 2);
  wall(9, 3.2, 0, 1.6, 4.5, Math.PI);
  const ceilTex = tileTexture("#dfe5e3", "#b8c0bd", 512, 6);
  ceilTex.repeat.set(3, 3);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.2;
  room.add(ceil);
  // Ceiling light panels - what you see first, smeared, on your back.
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff });
  for (const [x, z] of [[0, -0.6], [0, 1.8], [-2.6, -0.6], [2.6, -0.6]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), panelMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(x, 3.19, z);
    room.add(p);
  }
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x2a2622, 0.65));
  const key = new THREE.PointLight(0xf1f8ff, 22, 9, 1.6);
  key.position.set(0, 3.0, -0.6);
  scene.add(key);
  const red = new THREE.PointLight(0xff3b2a, 6, 7, 1.8);
  red.position.set(3.6, 2.6, 3.6);
  scene.add(red);

  // The bed: frame, mattress, pillow, sheet.
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4a8, metalness: 0.8, roughness: 0.35 });
  const linen = new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.95 });
  const sheet = new THREE.MeshStandardMaterial({ color: 0x8fb7c4, roughness: 0.95 });
  const box = (mat, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    room.add(m);
    return m;
  };
  box(steel, 1.0, 0.08, 2.1, 0, 0.5, 0);
  for (const [x, z] of [[-0.45, -1], [0.45, -1], [-0.45, 1], [0.45, 1]]) box(steel, 0.05, 0.5, 0.05, x, 0.25, z);
  box(steel, 1.0, 0.55, 0.05, 0, 0.8, -1.05);
  box(linen, 0.92, 0.16, 2.0, 0, 0.62, 0);
  box(linen, 0.6, 0.12, 0.38, 0, 0.75, -0.8);
  box(sheet, 0.95, 0.06, 1.35, 0, 0.72, 0.35);
  // IV stand and a heart monitor.
  box(steel, 0.03, 1.9, 0.03, 0.7, 0.95, -0.9);
  const bag = box(new THREE.MeshStandardMaterial({ color: 0xd9f2ff, transparent: true, opacity: 0.6, roughness: 0.2 }), 0.14, 0.22, 0.05, 0.7, 1.75, -0.9);
  bag.name = "IV";
  box(new THREE.MeshStandardMaterial({ color: 0x1b2023, roughness: 0.5 }), 0.42, 0.3, 0.2, 0.85, 1.35, -1.1);
  const screen = box(new THREE.MeshBasicMaterial({ color: 0x0f3b2b }), 0.36, 0.22, 0.01, 0.85, 1.35, -0.995);
  screen.name = "MonitorScreen";
  // A door (where Okoro leads you).
  box(new THREE.MeshStandardMaterial({ color: 0x4b565a, metalness: 0.4, roughness: 0.5 }), 1.2, 2.2, 0.08, -3.2, 1.1, 4.46);
}

// A corridor for the walk-and-talk, off to one side.
const CORRIDOR_X = 30;
{
  const floorTex = tileTexture("#7d8582", "#5c6461");
  floorTex.repeat.set(1, 20);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 90), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(CORRIDOR_X, 0, -40);
  scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5d6866, roughness: 0.85 });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(90, 3), wallMat);
    w.position.set(CORRIDOR_X + s * 2, 1.5, -40);
    w.rotation.y = -s * Math.PI / 2;
    scene.add(w);
  }
  for (let z = 0; z > -85; z -= 7) {
    const l = new THREE.PointLight(0xffe2b8, 5, 9, 1.8);
    l.position.set(CORRIDOR_X, 2.7, z);
    scene.add(l);
  }
}
/** A straight route down the corridor (the levels' route.sample contract). */
const corridorRoute = {
  totalLength: 80,
  sample(d, lateral = 0, height = 0, target = new THREE.Vector3()) {
    target.set(CORRIDOR_X + lateral, height, -d);
    return { position: target, heading: 0 };
  },
};

/* ---- Story systems ------------------------------------------------------ */

let audioCtx = null;
const ui = new StoryUI({ blurTargets: [renderer.domElement] });
const reactions = new ReactionHits(ui);
reactions.listen();
const voice = new StoryVoice(() => audioCtx);
const player = new CutscenePlayer({ ui, reactions, camera, voice });
player.listen();

const okoro = new Companion({ bag: true });
okoro.root.position.set(-0.85, 0, -0.4);
okoro.root.rotation.y = -Math.PI / 2; // facing the bed (+X)
scene.add(okoro.root);

// A pistol for him to hold (a stand-in prop).
const pistol = new THREE.Group();
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0.6, roughness: 0.4 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.2), mat);
  slide.position.set(0, 0.03, -0.06);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), mat);
  grip.rotation.x = 0.25;
  pistol.add(slide, grip);
}

const status = document.getElementById("status");
const log = [];
player.on("event", (name, data) => log.push(["event", name, !!data.skipped]));
player.on("reaction-start", ({ id }) => log.push(["reaction-start", id]));
player.on("reaction-success", ({ id }) => log.push(["reaction-success", id]));
player.on("reaction-fail", ({ id, reason }) => {
  log.push(["reaction-fail", id, reason]);
  // The preview's "death": a red flash, then try again from just before it.
  ui.setTint(0.8);
  ui.setFade(0.6);
  setTimeout(() => {
    ui.setTint(0);
    ui.setFade(0);
    player.retry();
  }, (window.__story?.manual ? 0 : 900));
});
player.on("done", ({ id, skipped }) => log.push(["done", id, skipped]));
player.on("line", (line) => log.push(["line", line.who, line.text]));

const bedAnchors = {
  eye: new THREE.Vector3(0, 0.98, -0.78),
  up: new THREE.Vector3(0, 1, 0),
  feet: new THREE.Vector3(0, 0, 1),
  right: new THREE.Vector3(-1, 0, 0),
  standEye: new THREE.Vector3(-0.35, 1.6, 0.55),
  door: new THREE.Vector3(-3.2, 1.3, 4.4),
  okoro,
};

let mode = null;
let walk = null;

function resetOkoro() {
  okoro.drop(pistol);
  okoro.root.position.set(-0.85, 0, -0.4);
  okoro.root.rotation.y = -Math.PI / 2;
  okoro.act("idle").lookAt(null);
  okoro.speed = 0;
}

const DEMOS = {
  wake() {
    resetOkoro();
    player.play(wakeScene(bedAnchors));
  },
  ladder() {
    resetOkoro();
    okoro.act("hold");
    camera.position.set(0.9, 1.6, 1.6);
    camera.lookAt(-0.85, 1.4, -0.4);
    player.play({ ...ladderScene(), camera: (t, pose) => { pose.position.set(0.9, 1.6, 1.6); pose.look.set(-0.85, 1.3, -0.4); } });
  },
  walk() {
    resetOkoro();
    player.stop();
    // Okoro runs a few metres ahead and talks; lines fire by route progress.
    walk = { d: 0, said: new Set(), line: null, until: 0 };
    okoro.act("walk");
    okoro.hold(pistol, { hand: "R" });
    ui.show();
    ui.setGameplay(true);
  },
  reactions() {
    resetOkoro();
    okoro.act("aim");
    okoro.hold(pistol, { hand: "R" });
    const lines = [
      { who: "okoro", text: "SEVEN! Push it off - push!", at: 0.2, hold: 1.4 },
      { who: "halcyon", text: "Detonation, lower tower.", at: 5, hold: 1.4 },
      { who: "sfx", text: "[the bridge starts to go]", at: 9, hold: 1.4 },
    ];
    player.play({
      id: "reactions",
      lines,
      duration: 14,
      head: { breath: 1.2, bob: 0.4 },
      camera: (t, pose) => { pose.position.set(0.9, 1.6, 1.6); pose.look.set(-0.85, 1.3, -0.4); },
      reactions: [
        { at: 1, id: "struggle", spec: struggleReaction(), lead: 0.8 },
        { at: 6, id: "sprint", spec: sprintReaction(), lead: 0.8 },
        { at: 10.5, id: "latch", spec: latchReaction(), lead: 0.8 },
      ],
    });
  },
};

function start(name) {
  mode = name;
  walk = null;
  player.stop();
  DEMOS[name]();
}

addEventListener("keydown", (e) => {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    audioCtx.resume();
  }
  const map = { Digit1: "wake", Digit2: "ladder", Digit3: "walk", Digit4: "reactions" };
  if (map[e.code]) start(map[e.code]);
});
document.getElementById("optLong").addEventListener("change", (e) => reactions.setOptions({ longWindows: e.target.checked }));
document.getElementById("optHold").addEventListener("change", (e) => reactions.setOptions({ holdInsteadOfMash: e.target.checked }));

/* ---- Frame loop --------------------------------------------------------- */

const _look = new THREE.Vector3();
function updateWalk(dt) {
  const w = walk;
  w.d = Math.min(corridorRoute.totalLength - 4, w.d + dt * 1.7);
  okoro.follow(corridorRoute, w.d + 3.2, -0.5);
  okoro.update(dt, { speed: 1.7 });
  okoro.lookAt(camera.position, w.line ? 0.5 : 0);
  // First person behind him, walking.
  const t = performance.now() / 1000;
  camera.position.set(CORRIDOR_X + 0.3 + Math.sin(t * 2.4) * 0.03, 1.62 + Math.abs(Math.sin(t * 4.8)) * 0.035, -w.d);
  okoro.headPosition(_look).y -= 0.25;
  camera.up.set(0, 1, 0);
  camera.lookAt(_look);
  const progress = w.d / corridorRoute.totalLength;
  for (const line of SCENES.foundryTalk) {
    if (progress >= line.atRoute && !w.said.has(line)) {
      w.said.add(line);
      w.line = line;
      w.until = w.d + readTime(line.text) * 1.7;
      ui.say(line.who, line.text);
      voice.blip(line.who);
      log.push(["line", line.who, line.text]);
    }
  }
  if (w.line && w.d > w.until) {
    w.line = null;
    ui.say(null);
  }
}

function frame(dt, render = true) {
  if (walk) updateWalk(dt);
  else {
    player.update(dt);
    okoro.update(dt);
  }
  status.textContent = `${mode ?? "-"} · ${player.state} · t ${player.t.toFixed(1)}${reactions.running ? " · REACT" : ""}`;
  if (render) renderer.render(scene, camera);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!window.__story.manual) frame(dt);
  requestAnimationFrame(loop);
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

window.__story = {
  THREE, scene, camera, renderer, ui, reactions, player, okoro, pistol, log, corridorRoute,
  manual: false,
  ready: false,
  start,
  get mode() { return mode; },
  get walk() { return walk; },
  /** Run n frames of dt seconds (set manual = true first). */
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i += 1) frame(dt, i === n - 1);
  },
  /** Press (and release) a key as the player would. */
  press(code) {
    dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  },
};

requestAnimationFrame(loop);
loadStoryCharacter(ASSET_BASE, "scientistGood")
  .then((template) => okoro.setModel(template))
  .catch((error) => console.warn("[story] Okoro's model failed to load; stand-in kept", error))
  .finally(() => {
    window.__story.ready = true;
    window.DONE = true;
  });
