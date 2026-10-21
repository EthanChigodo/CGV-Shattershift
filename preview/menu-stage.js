/**
 * The menu stage on its own (src/menu/stage.js), for working on it and for
 * the documentation shots.
 *
 *   preview/menu-stage.html?shot=title&quality=medium
 *   ...&clean        no buttons (screenshots)
 *   ...&manual       no animation loop: drive it from the console / a check
 *                    with __stage.step(seconds) and __stage.render()
 *   ...&character=playerMale&skin=brown&hair=blonde
 */

import * as THREE from "../src/three.js";
import { PostFX } from "../src/fx/postfx.js";
import { MenuStage, SHOTS } from "../src/menu/stage.js";

const params = new URLSearchParams(location.search);
const quality = params.get("quality") ?? "medium";
const manual = params.has("manual");
if (params.has("clean")) document.body.classList.add("clean");

const canvas = document.querySelector("#stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const postfx = new PostFX(renderer, { quality });
postfx.setScale(quality === "medium" ? 0.85 : 1);

const stage = new MenuStage({
  renderer,
  quality,
  reducedMotion: params.has("reduced"),
  assetBase: new URL("../assets/meltdown/", import.meta.url).href,
  figure: { character: params.get("character") ?? "playerFemale", skin: params.get("skin") ?? "light", hair: params.get("hair") ?? "natural" },
});
stage.setShot(params.get("shot") ?? "title");
stage.rig.cut(params.get("shot") ?? "title");
stage.fadeTarget = 0;

const bar = document.querySelector("#bar");
for (const name of Object.keys(SHOTS)) {
  const b = document.createElement("button");
  b.textContent = name;
  b.onclick = () => {
    stage.setShot(name);
    for (const x of bar.children) x.classList.toggle("on", x === b);
  };
  bar.appendChild(b);
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight, false);
  postfx.resize();
  stage.resize(innerWidth, innerHeight);
});
stage.resize(innerWidth, innerHeight);
postfx.resize();

const clock = new THREE.Clock();
function frame() {
  if (manual) return;
  requestAnimationFrame(frame);
  const dt = clock.getDelta();
  if (!stage.isReady) return;
  stage.update(dt, postfx);
  postfx.uniforms.uTime.value += dt;
  stage.render(postfx);
}

globalThis.__stage = {
  stage,
  postfx,
  renderer,
  get ready() { return stage.isReady; },
  /** Advance the stage `seconds` in steps of `dt` (no drawing). */
  step(seconds, dt = 1 / 30) {
    for (let t = 0; t < seconds - 1e-6; t += dt) {
      stage.update(dt, postfx);
      postfx.uniforms.uTime.value += dt;
    }
  },
  render() { stage.render(postfx); },
  shot(name) { stage.setShot(name); stage.rig.cut(name); },
  info() {
    const i = renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length, geometries: i.memory.geometries, textures: i.memory.textures };
  },
};
stage.ready.then(() => { stage.fade = 0; frame(); });
