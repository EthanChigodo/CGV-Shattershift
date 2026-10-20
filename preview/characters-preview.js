/**
 * The characters preview (preview/characters.html): every role in the
 * manifest on a turntable, a button per clip, the hit and death layers, the
 * player's skin and hair swatches - for the team to check a converted
 * character before it goes in the game.
 *
 *   preview/characters.html                  assets/characters/manifest.json
 *   preview/characters.html?characters=dev   assets/characters/dev/ (a build being checked)
 *
 * Runs the game's own runtime (src/figure/rigged.js), so what plays here is
 * what plays in the game. globalThis.__chars is for the checks
 * (tests/characters/run.js).
 */

import * as THREE from "../src/three.js";
import { RoomEnvironment } from "../src/three-addons.js";
import { loadCharacterManifest, loadRole, cloneRigged, riggedLook, riggedInfo, CLIP_NAMES } from "../src/figure/rigged.js";
import { createRig } from "../src/levels/meltdown/characters.js";
import { SKIN_TONES, HAIR_COLOURS } from "../src/figure/look.js";

const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1213);
scene.fog = new THREE.Fog(0x0e1213, 9, 22);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 60);
camera.position.set(-0.5, 1.3, 4.4);
const target = new THREE.Vector3(-0.62, 0.92, 0);

// Lighting like the Labs: a warm key, a cool rim, a dim fill from below.
const key = new THREE.DirectionalLight(0xfff0e0, 2.6);
key.position.set(2.5, 4, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -3;
key.shadow.camera.right = key.shadow.camera.top = 3;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fd8ff, 1.6);
rim.position.set(-3, 2.5, -3);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xb8c8d0, 0x1a1512, 0.45));

const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: 0x1c2223, roughness: 0.92 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(16, 32, 0x2c3a3b, 0x1f2829);
grid.position.y = 0.002;
scene.add(grid);

const stage = new THREE.Group();
scene.add(stage);

const state = { role: null, model: null, rig: null, look: null, clip: "idle", turn: true, walkabout: false, speed: 0, angle: 0, roles: {}, essential: {}, errors: [] };
addEventListener("error", (e) => state.errors.push(String(e.message)));

/** The brief's essential clips, by role prefix (tools/characters/clips.json). */
async function loadEssential() {
  try {
    const cfg = await (await fetch("../tools/characters/clips.json")).json();
    state.essential = cfg.essential ?? {};
  } catch {
    state.essential = {};
  }
}

function essentialFor(role) {
  for (const [prefix, clips] of Object.entries(state.essential)) if (role.startsWith(prefix)) return clips;
  return [];
}

function button(label, onClick, parent) {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", onClick);
  parent.append(b);
  return b;
}

async function select(role) {
  for (const b of $("roles").children) b.classList.toggle("on", b.textContent === role);
  const template = await loadRole(role);
  if (state.model) {
    stage.remove(state.model);
    state.rig?.dispose?.();
  }
  const model = cloneRigged(template, { own: true });
  stage.add(model);
  state.role = role;
  state.model = model;
  state.rig = createRig(model);
  state.look = riggedLook(model);
  state.look.setSkinTone(state.skin ?? "light");
  state.look.setHairColour(state.hair ?? "natural");
  state.look.setWear(Number($("wear").value));
  // Clip buttons: the brief's names first (dashed if this role lacks one), then any extras.
  const info = riggedInfo(template);
  const clips = $("clips");
  clips.replaceChildren();
  const names = [...new Set([...CLIP_NAMES.filter((n) => info.clips.has(n) || essentialFor(role).includes(n)), ...info.clips.keys()])];
  for (const name of names) {
    const b = button(name, () => play(name), clips);
    if (!info.clips.has(name)) {
      b.classList.add("missing");
      b.title = "No clip: the game poses this procedurally";
    }
  }
  play(info.clips.has("idle") ? "idle" : [...info.clips.keys()][0]);
  describe();
  return model;
}

function play(name) {
  state.clip = name;
  for (const b of $("clips").children) b.classList.toggle("on", b.textContent === name);
  state.rig.dead = false;
  if (state.rig.mode === "proc") state.rig.mode = "clip";
}

function describe() {
  const t = riggedInfo(state.model);
  const entry = state.roles[state.role] ?? {};
  const lines = [
    `role      ${state.role}`,
    `height    ${t.height.toFixed(2)} m`,
    `triangles ${entry.triangles ?? "?"}`,
    `materials ${(entry.materialNames ?? []).join(", ") || "?"}`,
    "",
    ...[...t.clips.entries()].map(([n, c]) => {
      const m = t.meta?.[n] ?? {};
      return `${n.padEnd(13)} ${c.duration.toFixed(2)} s${m.speed ? `  ${m.speed} m/s` : ""}${m.loop ? "  loop" : ""}`;
    }),
  ];
  const missing = essentialFor(state.role).filter((n) => !t.clips.has(n));
  $("info").textContent = lines.join("\n");
  if (missing.length) {
    const w = document.createElement("div");
    w.className = "warn";
    w.textContent = `\nMissing essential: ${missing.join(", ")}`;
    $("info").append(w);
  }
}

function swatches() {
  for (const [key, tone] of Object.entries(SKIN_TONES)) {
    const b = button("", () => {
      state.skin = key;
      state.look?.setSkinTone(key);
      for (const c of $("skin").children) c.classList.toggle("on", c === b);
    }, $("skin"));
    b.className = "swatch";
    b.title = tone.label;
    b.style.background = tone.swatch;
  }
  for (const [key, hair] of Object.entries(HAIR_COLOURS)) {
    const b = button("", () => {
      state.hair = key;
      state.look?.setHairColour(key);
      for (const c of $("hair").children) c.classList.toggle("on", c === b);
    }, $("hair"));
    b.className = "swatch";
    b.title = hair.label;
    b.style.background = hair.swatch;
  }
}

$("hit").addEventListener("click", () => state.rig?.react());
$("die").addEventListener("click", () => {
  if (!state.rig?.die()) state.clip = "die";
});
$("turn").addEventListener("click", (e) => {
  state.turn = !state.turn;
  e.target.classList.toggle("on", state.turn);
});
$("walkabout").addEventListener("click", (e) => {
  state.walkabout = !state.walkabout;
  e.target.classList.toggle("on", state.walkabout);
  if (state.walkabout && state.speed < 0.5) $("speed").value = 1.5;
  $("speed").dispatchEvent(new Event("input"));
});
$("speed").addEventListener("input", (e) => {
  state.speed = Number(e.target.value);
  $("speedValue").textContent = state.speed > 0 ? `${state.speed.toFixed(1)} m/s` : "clip rate";
});
$("wear").addEventListener("input", (e) => state.look?.setWear(Number(e.target.value)));

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (state.rig) {
    const locomotion = /^(walk|run|strafe|crawl)/.test(state.clip);
    if (!state.rig.dead) state.rig.pose({ clip: [state.clip], speed: locomotion && state.speed > 0 ? state.speed : null, dt });
    else state.rig.update(dt);
    state.rig.apply();
    const m = state.model;
    if (state.walkabout && locomotion) {
      // Round a 1.6 m circle at the set speed: planted feet must not skate.
      state.angle += (state.speed / 1.6) * dt;
      m.position.set(Math.cos(state.angle) * 1.6, 0, Math.sin(state.angle) * 1.6);
      m.rotation.y = -state.angle;
    } else {
      m.position.set(0, 0, 0);
      if (state.turn) m.rotation.y += dt * 0.5;
    }
  }
  camera.lookAt(target);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const ready = (async () => {
  swatches();
  await loadEssential();
  const manifest = await loadCharacterManifest();
  state.roles = manifest.roles;
  $("source").textContent = manifest.base ? `from ${new URL(manifest.base).pathname}` : "rigged characters are switched off (?characters=off)";
  const names = Object.keys(manifest.roles);
  for (const role of names) button(role, () => select(role), $("roles"));
  if (!names.length) {
    $("empty").hidden = false;
    $("empty").textContent = "No characters in the manifest yet.\nBuild one with tools/characters/build.py, or open ?characters=dev.";
    return [];
  }
  const wanted = new URLSearchParams(location.search).get("role");
  await select(names.includes(wanted) ? wanted : names[0]);
  return names;
})();

/** For the checks (tests/characters/run.js). */
globalThis.__chars = {
  ready,
  state,
  select,
  play,
  renderer,
  scene,
  camera,
  THREE,
  /** Advance and draw n frames by hand (software GL is slow). */
  step(n = 1, dt = 1 / 30) {
    renderer.setAnimationLoop(null);
    for (let i = 0; i < n; i += 1) {
      if (state.rig) {
        if (!state.rig.dead) state.rig.pose({ clip: [state.clip], dt });
        else state.rig.update(dt);
        state.rig.apply();
      }
    }
    camera.lookAt(target);
    renderer.render(scene, camera);
  },
};
