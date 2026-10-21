// Dependency-free logic/integration checks. Run: node --test tests/ammo-recovery.test.mjs
// Node 22.15+ / 24: resolve the browser import map to the vendored Three.js.
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../src/three.js";
import { AmmoRecovery, canAffordThrow, gateRecoveryWaiting } from "../src/systems/ammo-recovery.js";
import { Arsenal } from "../src/systems/arsenal.js";
import { AmmoRecoveryHint } from "../src/ui/ammo-recovery.js";

const root = new URL("../", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "three") return next(new URL("src/three.js", root).href, context);
  if (specifier.startsWith("three/addons/")) return next(new URL(`lib/three/examples/jsm/${specifier.slice(13)}`, root).href, context);
  return next(specifier, context);
} });
const { MeltdownGame } = await import("../src/levels/meltdown/game.js");
const { MeltdownLevel } = await import("../src/levels/meltdown/index.js");
const { CausewayLevel, ROUTE } = await import("../src/levels/causeway/index.js");
const { RoofLevel } = await import("../src/levels/meltdown/roof.js");
const noop = () => {};

test("emergency reserve: 2.5 active seconds gives one; cannot stockpile or overflow", () => {
  const recovery = new AmmoRecovery();
  assert.equal(recovery.update(2.49, 0), 0);
  assert.equal(recovery.update(0.01, 0), 1);
  assert.equal(recovery.update(100, 1), 1);
  assert.equal(recovery.update(100, 45), 45);
  assert.equal(recovery.update(100, 0), 1);
  assert.equal(recovery.elapsed, 0);
  assert.equal(recovery.update(0, 0), 0);
});

test("pause/death do not charge; pickups and restart discard partial recharge", () => {
  const recovery = new AmmoRecovery();
  recovery.update(1, 0);
  assert.equal(recovery.update(30, 0, false), 0);
  assert.equal(recovery.elapsed, 1);
  assert.equal(recovery.update(1.5, 0), 1);
  recovery.update(2, 0);
  recovery.update(0, 5);
  assert.equal(recovery.update(0.5, 0), 0);
  recovery.reset();
  assert.equal(recovery.update(2, 0), 0);
});

function updateHarness(phase) {
  return Object.assign(Object.create(MeltdownGame.prototype), {
    phase, paused: false, clock: 0, _timers: [],
    level: { breakables: [], obstacles: [], route: { sample: () => ({ heading: 0 }) }, speedAt: () => 8 },
    roof: phase === "roof" ? { breakables: [], solids: [] } : null,
    runner: { balls: 0, alive: true, finished: false, distance: 0, invulnerable: 0 },
    avatar: { root: new THREE.Object3D() }, hero: { position: new THREE.Vector3() },
    arsenal: new Arsenal(), ammoRecovery: new AmmoRecovery(), ammoHint: { update: noop, hide: noop },
    hud: { toast: noop }, _updateFade: noop, _updateLauncher: noop, _updateRunFrame: noop,
    _updateRoofFrame: noop, _updateRoofPresentation: noop,
  });
}

for (const phase of ["run", "roof"]) {
  test(`${phase}: actual Meltdown update recovers, pauses, suppresses dead recharge and resets`, () => {
    const game = updateHarness(phase);
    for (let i = 0; i < 49; i++) game.update(0.05, i);
    assert.equal(game.runner.balls, 0);
    game.paused = true;
    for (let i = 0; i < 100; i++) game.update(0.05, i);
    assert.equal(game.runner.balls, 0);
    game.paused = false;
    game.update(0.05, 0);
    assert.equal(game.runner.balls, 1);
    game.runner.balls = 0;
    game.runner.alive = false;
    for (let i = 0; i < 100; i++) game.update(0.05, i);
    assert.equal(game.runner.balls, 0);
    game._resetRunner();
    assert.equal(game.ammoRecovery.elapsed, 0);
    assert.equal(game.runner.balls, 26);
  });
}

test("Labs non-playing phases cannot charge", () => {
  for (const phase of ["idle", "arrive", "story", "respawn", "depart", "over"]) {
    const game = updateHarness(phase);
    for (let i = 0; i < 100; i++) game.update(0.05, i);
    assert.equal(game.runner.balls, 0, phase);
  }
});

function sackHarness({ hp = 3, balls = 0, lateral = 3.2 } = {}) {
  const sack = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.65), new THREE.MeshBasicMaterial());
  sack.position.set(3.2, 1.35, -10);
  sack.userData = { alive: true, kind: "sack", spheres: 7, hp, routeDistance: 10, node: { userData: {} } };
  sack.userData.node.userData.hit = (power) => {
    sack.userData.hp -= power;
    if (sack.userData.hp > 0) return false;
    sack.userData.alive = false;
    return true;
  };
  const level = Object.assign(Object.create(MeltdownLevel.prototype), {
    breakables: [sack], events: { emit: noop }, route: {
      sample: (d, x = 0, y = 0, target = new THREE.Vector3()) => target.set(x, y, -d),
    },
  });
  let rewards = 0;
  const game = Object.assign(Object.create(MeltdownGame.prototype), {
    level, phase: "run", ammoRecovery: new AmmoRecovery(), runner: { alive: true, balls, distance: 10, lateral, height: 0, sliding: 0, breaks: 0 },
    _v: { boxCentre: new THREE.Vector3(), boxSize: new THREE.Vector3(), sfxPos: new THREE.Vector3(), crash: new THREE.Vector3() },
    playerBox: new THREE.Box3(), _sackBox: new THREE.Box3(),
    debris: { burst: noop }, _chunks: noop, audio: { glassShatter: noop, pickup: noop },
    hud: { toast: noop }, sfx: { glassBreak: noop, sphereCollected: () => rewards++ },
  });
  return { game, sack, rewards: () => rewards };
}

test("Labs contact collects intact multi-hit sack once, without spending ammunition", () => {
  const { game, sack, rewards } = sackHarness();
  game._collectLabsSacks();
  assert.equal(game.runner.balls, 7);
  assert.equal(game.level.breakables.length, 0);
  game._collectLabsSacks();
  game._onBallBreakable(sack, sack.position, { power: 1 });
  assert.equal(game.runner.balls, 7);
  assert.equal(rewards(), 1);
});

test("Labs outside/dead/non-run player cannot remotely collect", () => {
  const { game } = sackHarness({ lateral: 0 });
  game._collectLabsSacks();
  assert.equal(game.runner.balls, 0);
  game.runner.lateral = 3.2;
  game.runner.alive = false;
  game._collectLabsSacks();
  game.runner.alive = true;
  game.phase = "respawn";
  game._collectLabsSacks();
  assert.equal(game.runner.balls, 0);
});

test("Labs shooting still damages sacks; subsequent contact cannot duplicate or overflow", () => {
  const { game, sack, rewards } = sackHarness({ balls: 44 });
  game.debris.sparks = noop;
  game.audio.clang = noop;
  game._onBallBreakable(sack, sack.position, { power: 1 });
  assert.equal(sack.userData.hp, 2);
  assert.equal(game.runner.balls, 44);
  game._collectLabsSacks();
  game._onBallBreakable(sack, sack.position, { power: 99 });
  assert.equal(game.runner.balls, 45);
  assert.equal(rewards(), 1);
});

test("Labs projectile-only sack collection remains available", () => {
  const { game, sack, rewards } = sackHarness({ hp: 1 });
  game._onBallBreakable(sack, sack.position, { power: 1 });
  assert.equal(game.runner.balls, 7);
  assert.equal(rewards(), 1);
});

test("contact supply clears partial recharge immediately, even if spent before the next update", () => {
  const { game } = sackHarness();
  game.ammoRecovery.update(2, 0);
  game._collectLabsSacks();
  game.runner.balls = 0;
  assert.equal(game.ammoRecovery.update(0.5, game.runner.balls), 0);
});

test("Roof existing pickup reward path remains single-use and respects its cap", () => {
  const { game, sack, rewards } = sackHarness({ hp: 1, balls: 44 });
  game.avatar = { root: new THREE.Object3D() };
  game.roof = Object.assign(Object.create(RoofLevel.prototype), { breakables: [sack] });
  game._onRoofBreakable(sack, sack.position, { power: 99 });
  game._onRoofBreakable(sack, sack.position, { power: 1 });
  assert.equal(game.runner.balls, 45);
  assert.equal(rewards(), 1);
  assert.equal(game.roof.breakables.length, 0);
});

// The Labs' checkpoint is now one per level, resumed through resumeAt (main.js
// offers it on the death screen) - the per-section respawn is gone.
test("checkpoint resume resets only recovery state and restarts charging from zero", () => {
  const game = updateHarness("run");
  game.fade = {};
  game.projectiles = { clear: noop };
  game.hud.vitals = { style: {} };
  game.ammoRecovery.update(2, 0);
  game.resumeAt(100, 0);
  assert.equal(game.ammoRecovery.elapsed, 0);
  assert.equal(game.phase, "run");
  assert.equal(game.runner.balls, 0);
  for (let i = 0; i < 49; i++) game.update(0.05, i);
  assert.equal(game.runner.balls, 0);
  game.update(0.05, 0);
  assert.equal(game.runner.balls, 1);
});

for (const phase of ["run", "roof"]) {
  test(`${phase}: actual shooting accepts zero-ammo Overdrive without negative ammo`, () => {
    const game = updateHarness(phase);
    game.arsenal.activate("overdrive");
    let fired = 0;
    game.runner.shots = 0;
    game.runner.speed = 8;
    game._v = Object.fromEntries(["aim", "muzzle", "fireDir", "forwardVel"].map((key) => [key, new THREE.Vector3()]));
    game.pointer = new THREE.Vector2();
    game.camera = new THREE.PerspectiveCamera();
    game.raycaster = new THREE.Raycaster();
    game.hero.aim = new THREE.Vector3(0, 1, -10);
    game.hero.velocity = new THREE.Vector3();
    game.launcher = { muzzle: new THREE.Object3D() };
    game.projectiles = { fire: () => fired++ };
    game._currentPower = () => 1;
    game.audio = { shot: noop, dry: noop };
    game._shoot();
    assert.equal(fired, 1);
    assert.equal(game.runner.balls, 0);
    game.arsenal.reset();
    game._shoot();
    assert.equal(fired, 1);
  });
}

function gateHarness() {
  const gate = { parts: { slab: { position: { y: 0 } }, collider: { userData: {} }, conduitMaterial: { uniforms: { uCharge: { value: 0 } } } } };
  gate.parts.locks = [0, 1, 2].map(() => ({ material: { uniforms: { uColor: { value: { set: noop } } } }, ring: { visible: true } }));
  const level = Object.assign(Object.create(CausewayLevel.prototype), {
    gate, lift: null, state: { finale: { open: false, sealed: false, nextLock: 0, opening: 0 } },
    events: { emit: (name) => { if (name === "crushed") level.crushed = true; } },
    _burst: noop, _chunks: noop, _flashAt: noop, worldZ: (d) => -d, stats: { locks: 0 },
  });
  const locks = [0, 1, 2].map((order) => {
    const mesh = new THREE.Mesh();
    mesh.userData = { alive: true, kind: "lock", order, record: gate };
    return mesh;
  });
  return { level, locks };
}

test("Skyline actual gate completes from zero with three spaced recharged Glass shots", () => {
  for (const initial of [0, 1, 2]) {
    const { level, locks } = gateHarness();
    const recovery = new AmmoRecovery();
    let ammo = initial, elapsed = 0, shot = 0, pending = null;
    while (!level.state.finale.open && elapsed < 15) {
      const dt = 1 / 60;
      ammo = recovery.update(dt, ammo);
      if (pending) {
        pending.time -= dt;
        if (pending.time <= 0) { level.breakTarget(locks[pending.order]); pending = null; }
      }
      if (!pending && ammo > 0 && shot < 3) { ammo--; pending = { order: shot++, time: 0.3 }; }
      level._updateFinale(dt, ROUTE.stopLine, true, ammo, 1);
      elapsed += dt;
      assert.ok(!level.crushed, `initial ammo ${initial}`);
    }
    assert.equal(level.state.finale.open, true);
    assert.equal(level.stats.locks, 3);
  }
});

test("Skyline gate still expires with usable ammunition; pause and free throws do not grant recovery exemption", () => {
  const { level } = gateHarness();
  level._updateFinale(1, ROUTE.stopLine, true, 3, 1);
  const remaining = level.state.finale.sealedTime;
  level._updateFinale(30, ROUTE.stopLine, false, 0, 1);
  assert.equal(level.state.finale.sealedTime, remaining);
  level._updateFinale(remaining + 0.1, ROUTE.stopLine, true, 3, 1);
  assert.equal(level.crushed, true);
  assert.equal(gateRecoveryWaiting(0, 0, true, false), false);
  assert.equal(gateRecoveryWaiting(1, 3, true, false), false);
  assert.equal(canAffordThrow(1, 1), true);
});

test("nearest-supply hint excludes behind, blocked, dead and distant targets, then clears", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ style: {}, setAttribute: noop, remove: noop }), body: { append: noop } };
  let hint;
  try {
    hint = new AmmoRecoveryHint(new THREE.Scene());
    const target = (d, x = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial());
      mesh.position.set(x, 1, -d);
      mesh.userData = { alive: true, routeDistance: d };
      mesh.updateMatrixWorld();
      return mesh;
    };
    const behind = target(-2), blocked = target(5), reachable = target(8, 4), dead = target(1), far = target(40);
    dead.userData.alive = false;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 0.2), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1, -3);
    wall.updateMatrixWorld();
    hint.update({ active: true, ammunition: 0, cost: 1, contact: true, targets: [behind, blocked, reachable, dead, far],
      player: new THREE.Vector3(0, 1, 0), routeDistance: 0, solids: [wall] });
    assert.equal(hint.marker.visible, true);
    assert.deepEqual(hint.marker.position.toArray(), reachable.position.toArray());
    assert.match(hint.status.textContent, /run through a sack/i);
    hint.update({ active: false });
    assert.equal(hint.marker.visible, false);
    assert.equal(hint.status.hidden, true);
  } finally { hint?.dispose(); globalThis.document = previousDocument; }
});

test("Foundry/Skyline host wiring shares recovery, passes gate ammo and removes old recharge", async () => {
  const source = await readFile(new URL("../main.js", import.meta.url), "utf8");
  assert.match(source, /ammo = ammoRecovery\.update\(simDt, ammo[,)]/); // (plus the story difficulty's pace)
  assert.match(source, /ammunition: ammo, throwCost: arsenal\.cost\(\)/);
  assert.match(source, /function resetRun\(\) \{\s*ammoRecovery\.reset\(\)/);
  assert.ok(!source.includes("run.recharge"));
  const host = source.slice(source.indexOf("function updateGame("));
  assert.ok(host.indexOf("if (paused) return") < host.indexOf("ammoRecovery.update"));
  assert.ok(host.indexOf("if (currentLevel === 3)") < host.indexOf("ammoRecovery.update"));
});
