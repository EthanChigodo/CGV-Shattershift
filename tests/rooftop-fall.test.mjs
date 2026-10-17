// Node 22.15+ / 24; no browser, downloads or DOM emulation required.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "../src/three.js";
import { RoofFall, ROOF_FALL, exteriorFallEstablished } from "../src/levels/meltdown/roof-fall.js";
import { createRoofFacade } from "../src/levels/meltdown/roof-facade.js";
import { Level1Audio } from "../src/audio/level1-audio.js";
const root = new URL("../", import.meta.url);
registerHooks({ resolve(s, c, next) {
  if (s === "three") return next(new URL("src/three.js", root).href, c);
  if (s.startsWith("three/addons/")) return next(new URL(`lib/three/examples/jsm/${s.slice(13)}`, root).href, c);
  return next(s, c);
} });
const { PlayerAvatar } = await import("../src/levels/meltdown/player.js");
const { RoofLevel, EDGE } = await import("../src/levels/meltdown/roof.js");
const { MeltdownGame } = await import("../src/levels/meltdown/game.js");
const noop = () => {};
const roof = () => Object.assign(Object.create(RoofLevel.prototype), { cover: [], state: { falls: 0 }, breakables: [], solids: [] });
function shot(side = 1) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 650);
  camera.position.set(side * EDGE, 10, 7); camera.lookAt(side * EDGE, 0, 0);
  return new RoofFall({ position: new THREE.Vector3(side * (EDGE + 0.3), -0.7, 0),
    velocity: new THREE.Vector3(side * 5, 0, 1), vy: -4, yaw: 0, camera,
    normal: new THREE.Vector3(side, 0, 0), edge: EDGE });
}

for (const [x, z] of [[-16.2, 0], [16.2, 0], [0, -16.2], [0, 16.2], [16.2, 16.2]]) {
  test(`actual outer footprint (${x}, ${z}): only established exterior descents trigger`, () => {
    const r = roof(), p = new THREE.Vector3(x, -0.7, z);
    assert.equal(r.groundAt(p), null);
    assert.ok(r.exteriorAt(p));
    assert.equal(exteriorFallEstablished(r, p, -4, "exterior"), true);
    assert.equal(exteriorFallEstablished(r, p, 4, "exterior"), false);
    assert.equal(exteriorFallEstablished(r, p.clone().setY(1), -4, "exterior"), false);
    assert.equal(exteriorFallEstablished(r, p, -4, "internal"), false);
  });
}

test("ordinary jumps, safe landings, and internal hatch descents never qualify", () => {
  const r = roof();
  for (const p of [new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-10, -20, 3)]) {
    assert.equal(r.exteriorAt(p), null);
    assert.equal(exteriorFallEstablished(r, p, -5, "exterior"), false);
  }
  const p = new THREE.Vector3(0, 0, 50); r.clampPlayer(p);
  assert.ok(p.z < EDGE, "the original north/south parapet rules remain intact");
});

for (const side of [-1, 1]) test(`camera brakes and stays absolutely fixed while body continues: side ${side}`, () => {
  const s = shot(side);
  let oldY = s.position.y;
  while (s.time < ROOF_FALL.cameraStop + 0.05) {
    s.update(1 / 60);
    assert.ok(s.position.y < oldY); oldY = s.position.y;
    if (s.cameraPosition.y < 0.4) assert.ok(s.cameraPosition.x * side >= EDGE + 2.5);
  }
  const fixedCamera = s.cameraPosition.clone(), fixedLook = s.look.clone(), bodyY = s.position.y;
  const volume = s.audio;
  for (let i = 0; i < 600 && !s.done; i++) s.update(1 / 60);
  assert.deepEqual(s.cameraPosition, fixedCamera);
  assert.deepEqual(s.look, fixedLook);
  assert.ok(s.position.y < bodyY - 10);
  assert.ok(s.exitTime >= ROOF_FALL.cameraStop, "exit is observed after camera lock");
  assert.ok(s.playerFrame.top < -1.05, "the entire player envelope crossed the bottom of frame");
  assert.ok(s.weaponExitTime < s.exitTime, "bazooka leaves the bottom first");
  assert.ok(s.weaponPosition.y < s.position.y - 5);
  assert.ok(s.time - s.exitTime >= ROOF_FALL.afterExitHold + ROOF_FALL.fadeSeconds);
  assert.ok(s.audio < volume); assert.equal(s.audio, 0); assert.equal(s.wind, 0);
  assert.equal(s.hidden, true); assert.equal(s.fade, 1);
  assert.ok(s.done && s.time < 7.2, "bounded Game Over, even when no world event arrives");
});

test("quick side view shows the facade, rather than looking down after the player", () => {
  const s = shot();
  for (let i = 0; i < 60; i++) s.update(1 / 60);
  const direction = s.look.clone().sub(s.cameraPosition).normalize();
  assert.ok(direction.dot(s.normal) < -0.8, "looks back toward the building face");
  assert.ok(Math.abs(direction.y) < 0.4, "predominantly side-on during follow");
  assert.equal(s.cameraFov, ROOF_FALL.cinematicFov);
  assert.equal(s.playerFrame.shown, true); assert.equal(s.weaponFrame.shown, true);
});

test("Game Over waits for full bottom exit, a hold and fade, including viewport changes", () => {
  for (const aspect of [0.1, 0.5, 1, 16 / 9, 32 / 9]) {
    const s = shot();
    let previouslyExited = false;
    for (let i = 0; i < 600 && !s.done; i++) {
      s.update(1 / 60, i < 80 ? aspect : 1 / aspect);
      if (s.exitTime === null) { assert.equal(s.fade, 0); assert.equal(s.hidden, false); }
      else {
        if (!previouslyExited) assert.ok(s.playerFrame.top < -1.05);
        previouslyExited = true;
        if (s.time - s.exitTime < ROOF_FALL.afterExitHold) assert.equal(s.fade, 0);
      }
    }
    assert.ok(previouslyExited && s.done, `viewport aspect ${aspect} completes`);
  }
});

test("camera/fall agree at 30, 60 and 120 Hz", () => {
  const samples = [30, 60, 120].map((fps) => { const s = shot(); for (let i = 0; i < fps * 4; i++) s.update(1 / fps); return s; });
  for (const s of samples.slice(1)) {
    assert.ok(s.position.distanceTo(samples[0].position) < 0.001);
    assert.ok(s.cameraPosition.distanceTo(samples[0].cameraPosition) < 0.01);
  }
});

function avatar() {
  const a = Object.assign(Object.create(PlayerAvatar.prototype), { root: new THREE.Group(), body: new THREE.Group(), shadow: { visible: true }, hold: 1 });
  a.root.add(a.body);
  a.uniforms = Object.fromEntries(["uFalling", "uHold", "uReachUp", "uRest", "uGait", "uStride", "uTuck", "uCrouch", "uLean", "uTwist"].map((key) => [key, { value: 0 }]));
  for (const key of ["uFallArmR", "uFallArmL"]) a.uniforms[key] = { value: new THREE.Vector3() };
  for (const key of ["uLegR", "uLegL"]) a.uniforms[key] = { value: new THREE.Vector2() };
  a.uniforms.uThrow = { value: new THREE.Vector4() };
  return a;
}
test("actual avatar flails asymmetric arms/knees, changes posture, resets without altering appearance", () => {
  const a = avatar();
  a.updateFall(0); assert.equal(a.uniforms.uFalling.value, 0);
  a.updateFall(0.8);
  const arm = a.uniforms.uFallArmR.value.clone(), leg = a.uniforms.uLegL.value.clone(), pose = a.body.quaternion.clone();
  assert.notDeepEqual(arm, a.uniforms.uFallArmL.value);
  assert.notDeepEqual(a.uniforms.uLegR.value, leg);
  const torsoAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(a.body.quaternion);
  assert.ok(Math.abs(torsoAxis.y) < 0.35, "torso is laid out near horizontal, not upright");
  a.updateFall(2.1);
  assert.notDeepEqual(arm, a.uniforms.uFallArmR.value);
  assert.notDeepEqual(leg, a.uniforms.uLegL.value);
  assert.notDeepEqual(pose, a.body.quaternion);
  assert.equal(a.shadow.visible, false);
  a.resetFall();
  assert.equal(a.uniforms.uFalling.value, 0); assert.equal(a.hold, 1);
  assert.deepEqual(a.body.rotation.toArray().slice(0, 3), [0, 0, 0]);
  assert.equal(a.shadow.visible, true);
});

function game() {
  const events = [], audio = [];
  const a = avatar(), s = shot(); a.setVisible = noop;
  a.shoulder = new THREE.Group(); a.shoulder.position.set(0.3, 1.45, 0.05); a.body.add(a.shoulder);
  const rig = new THREE.Group(); rig.position.set(-0.04, -0.07, -0.18); a.shoulder.add(rig);
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0, 0.006); scene.add(a.root);
  const g = Object.assign(Object.create(MeltdownGame.prototype), {
    phase: "roof", paused: false, roof: roof(), level: null, _roofFallOrigin: "exterior",
    hero: { position: s.position.clone(), velocity: s.velocity.clone(), knock: new THREE.Vector3(), vy: -4, yaw: 0, dodge: 0 },
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 650), avatar: a,
    runner: { alive: true, vitality: 40, firing: true, balls: 2, shots: 3, breaks: 1, hits: 1 },
    held: new Set(["KeyD"]), projectiles: { clear: noop }, ammoHint: { hide: noop }, launcher: { rig },
    ui: { reticle: {}, letterbox: { classList: { add: noop, remove: noop } } },
    hud: { vitals: { style: {} }, setPrompt: noop, toast: noop, hideBanner: noop, toasts: { replaceChildren: noop } }, options: { summary: false },
    events: { emit: (name, value) => events.push({ name, value }) },
    sfx: { beginRoofFall: () => audio.push("start"), updateRoofFall: noop, stopRoofFall: () => audio.push("stop"), updateWind: noop, gameOver: noop, updateElevator: noop },
    scene, fade: { override: null, value: 0, target: 0 }, clock: 20, roofClock: 10,
    endless: { laps: 0, distance: 0 },
  });
  g.camera.position.copy(s.cameraStart); g.camera.lookAt(g.hero.position);
  return { g, events, audio };
}
test("real game entry is single-shot; inputs disabled; delayed Game Over uses existing failed event exactly once", () => {
  const { g, events, audio } = game();
  g._roofFell(); g._roofFell();
  assert.equal(g.phase, "roofFall"); assert.equal(g.runner.firing, false);
  assert.equal(g.runner.alive, false); assert.equal(g.launcher.rig.visible, true);
  assert.equal(g.launcher.rig.parent, g.scene, "original weapon is detached into world space");
  assert.equal(g.held.size, 0); assert.deepEqual(audio, ["start"]);
  g.onPointerDown({ button: 0 }); g.onKeyDown({ code: "KeyD" });
  assert.equal(g.runner.firing, false); assert.equal(g.held.size, 0);
  assert.equal(events.filter(e => e.name === "failed").length, 0);
  for (let i = 0; i < 450; i++) g._updateRoofFrame(1 / 60, i / 60);
  assert.equal(g.phase, "over");
  const ended = events.filter(e => e.name === "failed");
  assert.equal(ended.length, 1); assert.equal(ended[0].value.title, "YOU FELL");
  const fixed = g.camera.position.clone(); g._updateRoofFrame(1, 20);
  assert.deepEqual(g.camera.position, fixed);
  let restarted = false;
  g.options.devKeys = true; g.audio = { start: noop }; g.restart = () => { restarted = true; };
  g.onKeyDown({ code: "KeyR" });
  assert.equal(restarted, true, "the existing preview Game Over R key still works");
});

test("pause freezes cinematic; cleanup restores controls/rig/camera/launcher/fade before retry or menu", () => {
  const { g, audio } = game(); g._roofFell();
  g._updateRoofFrame(0.05, 0);
  const time = g._roofFall.time, p = g.hero.position.clone();
  g.paused = true; g._updateRoofFrame(0.05, 1);
  assert.equal(g._roofFall.time, time); assert.deepEqual(g.hero.position, p);
  g.paused = false; g._updateRoofFrame(0.05, 2);
  assert.ok(g._roofFall.time > time);
  g._clearRoofFall();
  assert.equal(g._roofFall, null); assert.equal(g._roofFallOrigin, null);
  assert.equal(g.launcher.rig.visible, true); assert.equal(g.avatar.uniforms.uFalling.value, 0);
  assert.equal(g.launcher.rig.parent, g.avatar.shoulder);
  assert.deepEqual(g.launcher.rig.position.toArray(), [-0.04, -0.07, -0.18]);
  assert.equal(g.camera.fov, 60); assert.equal(g.fade.override, null); assert.equal(g.fade.value, 0);
  assert.equal(g.scene.fog.density, 0.006); assert.ok(audio.includes("stop"));
});

test("release preserves the actual weapon pose/identity; repeated resets never clone or orphan it", () => {
  const { g } = game();
  const weapon = g.launcher.rig, parent = weapon.parent;
  weapon.quaternion.setFromEuler(new THREE.Euler(0.2, -0.3, 0.1));
  weapon.scale.set(0.9, 1.1, 0.95);
  const localRotation = weapon.quaternion.clone(), localScale = weapon.scale.clone();
  for (let retry = 0; retry < 3; retry++) {
    g.avatar.root.position.copy(g.hero.position);
    const world = weapon.getWorldPosition(new THREE.Vector3());
    const rotation = weapon.getWorldQuaternion(new THREE.Quaternion());
    g.phase = "roof"; g.runner.alive = true; g._roofFallOrigin = "exterior";
    g._startRoofFall();
    assert.equal(g.launcher.rig, weapon); assert.equal(weapon.parent, g.scene);
    assert.ok(weapon.getWorldPosition(new THREE.Vector3()).distanceTo(world) < 1e-8);
    assert.ok(weapon.getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation) < 1e-7);
    for (let i = 0; i < 120; i++) g._updateRoofFrame(1 / 60, i / 60);
    assert.ok(weapon.position.y < g.hero.position.y, "denser weapon is already below the person");
    g._clearRoofFall();
    assert.equal(weapon.parent, parent); assert.equal(parent.children.filter(o => o === weapon).length, 1);
    assert.deepEqual(weapon.quaternion.toArray(), localRotation.toArray()); assert.deepEqual(weapon.scale, localScale);
  }
});

test("internal hatch and hazard/other-phase deaths retain their previous immediate path", () => {
  const { g, events, audio } = game();
  g._roofFallOrigin = "internal"; g.hero.position.set(-10, -9, 3);
  g.sfx.fallScream = () => audio.push("hatch"); g._roofFell();
  assert.equal(g._roofFall, undefined); assert.equal(g.phase, "over");
  assert.equal(events.at(-1).value.title, "DOWN A HATCH"); assert.deepEqual(audio, ["hatch"]);
  for (const phase of ["run", "roofArrive", "fade", "ending", "over"]) {
    const { g: other } = game(); other.phase = phase; other._roofFell();
    assert.equal(other._roofFall, undefined); assert.equal(other.phase, phase);
  }
});

test("a lethal Roof collision uses THEY GOT YOU immediately, never the falling shot", () => {
  const { g, events } = game();
  g.runner.vitality = 1; g.runner.invulnerable = 0;
  g.arsenal = { absorb: () => false }; g.difficulty = { roof: { damage: 1 } };
  g.hero.knock = new THREE.Vector3(); g.debris = { sparks: noop };
  g.audio = { stumble: noop }; g.sfx.impact = g.sfx.hurt = noop;
  g.hud.flashDamage = noop; g.trauma = 0;
  g._roofHit({ damage: 15, from: new THREE.Vector3(), knock: 3, source: "patient" });
  assert.equal(g.phase, "over"); assert.equal(g._roofFall, undefined);
  assert.equal(events.at(-1).value.title, "THEY GOT YOU");
});

test("facade keeps standard lights/fog/environment; world-space varied glass uses no extra pass", () => {
  const m = createRoofFacade();
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  m.onBeforeCompile(shader);
  assert.ok(m.isMeshStandardMaterial); assert.equal(m.transparent, false);
  for (const code of ["towerGlass", "towerFresnel", "towerVariation", "roughnessFactor = mix", "fwidth", "#include <fog_fragment>", "#include <lights_fragment_maps>"]) assert.ok(shader.fragmentShader.includes(code), code);
  assert.ok(shader.vertexShader.includes("vTowerWorld ="));
  m.dispose();
});

test("late scream decode is cancelled on exit; one scream channel pauses/resumes and fades", async () => {
  const a = new Level1Audio(() => null), stops = [], ramps = [];
  let release;
  const channel = { source: { playbackRate: { value: 1 } }, gain: { gain: {} } };
  a._play = () => new Promise(resolve => { release = resolve; });
  a._stop = c => stops.push(c); a._fadeAndStop = c => stops.push(c); a._ramp = (p, v) => ramps.push(v);
  const pending = a.beginRoofFall(); a.stopRoofFall(); release(channel); await pending;
  assert.deepEqual(stops, [channel]); assert.equal(a.roofFall, null);
  a._play = async () => channel; await a.beginRoofFall();
  a.setPaused(true); assert.equal(channel.source.playbackRate.value, 0);
  a.setPaused(false); assert.equal(channel.source.playbackRate.value, 1);
  a.updateRoofFall(0.2); assert.ok(Math.abs(ramps.at(-1) - 0.18) < 1e-9);
  a.stopRoofFall(); assert.equal(a.roofFall, null);
});

test("sustained scream blends its loop without modifying the normal scream or allocating per retry", () => {
  const samples = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 0.01));
  const original = { length: samples.length, sampleRate: 1000, numberOfChannels: 1, getChannelData: () => samples };
  const copy = samples.slice(); let allocations = 0;
  const a = new Level1Audio(() => null);
  a.context = { createBuffer(channels, length, rate) { allocations++; const data = new Float32Array(length);
    return { length, sampleRate: rate, duration: length / rate, getChannelData: () => data }; } };
  const held = a._sustainScream("scream-f", original);
  assert.equal(a._sustainScream("scream-f", original), held); assert.equal(allocations, 1);
  assert.deepEqual(samples, copy);
  const data = held.buffer.getChannelData(0), loop = Math.round(held.start * original.sampleRate);
  assert.ok(Math.abs(data.at(-1) - data[loop]) < 0.011);
  assert.ok(held.start > 0 && held.start < held.buffer.duration);
});
