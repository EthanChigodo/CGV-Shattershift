/**
 * The Race's checks: a real split-screen race, two runners, stepped by hand
 * (software rendering is far too slow to wait on), on each course asked for.
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node tests/race/run.js                 # the Labs and the Skyline
 *   node tests/race/run.js foundry labs    # any of foundry, labs, skyline
 *
 * On each course:
 *   - glass:   the ring lights on a pane 18 m ahead and a glass sphere
 *              breaks it (the Labs' panes used to bounce spheres off their
 *              own colliders; the Skyline's were on a layer the race's
 *              cameras and aim never saw);
 *   - body:    running into a pane breaks it, for a small hit - not a wall;
 *   - rival:   the ring locks onto the other runner, the throw leads them,
 *              and it lands - hurt, and a stumble;
 *   - pickup:  running into a sphere cache, a serum or a case file takes it
 *              (where the course has one in reach);
 *   - serums:  prism (three spheres for one), unlimited spheres (the race's
 *              specials kept), Overdrive (faster, glass free), the kinetic
 *              shield (two hits), restoration (at once), and wearing off.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { serve, launch, openPage } from "../meltdown/lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const COURSES = process.argv.slice(2).filter((a) => ["foundry", "labs", "skyline"].includes(a));
if (!COURSES.length) COURSES.push("labs", "skyline");

/** Everything on one course, in the page: { failures, notes }. */
function checkCourse() {
  const r = globalThis.__dbg.race;
  const T = globalThis.__dbg.THREE;
  const failures = [];
  const notes = {};
  const log = [];
  const wrap = (name, fn) => {
    const orig = r[name].bind(r);
    r[name] = (...a) => { const res = orig(...a); log.push(fn(a, res)); return res; };
  };
  wrap("_break", (a, res) => `break ${a[1].userData.kind ?? a[1].name} ${res && !res.rejected ? "ok" : "no"}`);
  wrap("_hurt", (a, res) => `hurt ${a[0].name} ${a[2]} ${res ? "landed" : "no"}`);
  const step = (n) => { for (let i = 0; i < n; i += 1) r.update(1 / 30); };
  for (let i = 0; i < 200 && r.state !== "racing"; i += 1) step(1);
  if (r.state !== "racing") return { failures: [`never started (state ${r.state})`], notes };
  const [p1, p2] = r.players;
  for (const p of r.players) p.hp = 1e6;
  const cam = r.cameras[0];
  const LANES = [-3.2, 0, 3.2];
  const laneOf = (x) => LANES.reduce((b, v, i) => (Math.abs(v - x) < Math.abs(LANES[b] - x) ? i : b), 0);
  const where = (m) => ({ d: m.userData.record?.entry.d ?? m.userData.routeDistance, lane: laneOf(m.getWorldPosition(new T.Vector3()).x) });
  // Both runners together at `d` (the race ends if one is left behind).
  const put = (d, lane) => {
    p1.distance = d; p1.lane = lane; p1.lateral = LANES[lane]; p1.height = 0; p1.vy = 0; p1.slide = 0;
    p2.distance = d - 2; p2.lane = (lane + 1) % 3; p2.lateral = LANES[p2.lane];
    step(3);
    for (const c of r.cameras) c.updateMatrixWorld(true);
  };
  const find = (kinds, after, within = 160) => {
    for (let k = 0; k < 30; k += 1) {
      let best = null;
      for (const m of r.course.breakables()) {
        if (!kinds.includes(m.userData.kind) || m.userData.alive === false) continue;
        const w = where(m);
        if (w.d === undefined || w.d < after || w.d > after + within) continue;
        if (!best || w.d < best.w.d) best = { m, w };
      }
      if (best) return best;
      // (Not past the finish: a finished runner stands still.)
      if (p1.distance + 60 > r.course.finish) return null;
      put(p1.distance + 40, p1.lane);
      after = p1.distance + 10;
    }
    return null;
  };
  const glass = ["pane", "glass", "door"];

  // Glass, thrown at.
  if (r.course.key !== "foundry") {
    const g = find(glass, p1.distance + 22);
    if (!g) failures.push("no glass found to throw at");
    else {
      put(g.w.d - 18, g.w.lane);
      p1.invuln = 99;
      r._aimTargets = r._breakableMeshes();
      const ndc = g.m.getWorldPosition(new T.Vector3()).project(cam);
      p1.aim.x = ndc.x; p1.aim.y = ndc.y;
      r._aimPoint(p1);
      const ring = p1.aimOn;
      p1.throwCd = 0; p1.ammo = 10; p1.ball = "glass";
      r._throw(p1);
      step(30);
      notes.glass = { kind: g.m.userData.kind, seen: cam.layers.test(g.m.layers), ring, broken: g.m.userData.alive === false };
      if (!notes.glass.seen) failures.push("the race's camera can't see the glass");
      if (!ring) failures.push("the ring doesn't light on glass");
      if (!notes.glass.broken) failures.push("a glass sphere didn't break the pane it was aimed at");
    }
    // Glass, run into.
    const h = find(glass.filter((k) => k !== "door"), p1.distance + 12);
    if (!h) failures.push("no glass found to run into");
    else {
      put(h.w.d - 4, h.w.lane);
      p1.invuln = 0;
      const before = log.length;
      step(25);
      const through = log.slice(before).some((l) => l.startsWith("hurt P1 THROUGH THE GLASS"));
      notes.body = { broken: h.m.userData.alive === false, through };
      if (!notes.body.broken) failures.push("running into a pane didn't break it");
      if (!through) failures.push("running into a pane wasn't the glass's small hit");
    }
  }

  // The rival.
  put(Math.min(p1.distance + 20, r.course.finish - 80), 0);
  p2.distance = p1.distance + 14; p2.lane = p1.lane; p2.lateral = p1.lateral;
  step(2);
  for (const c of r.cameras) c.updateMatrixWorld(true);
  const chest = p2.pos.clone().setY(p2.pos.y + 1);
  const ndc = chest.clone().project(cam);
  p1.aim.x = ndc.x; p1.aim.y = ndc.y;
  r._aimPoint(p1);
  const locked = p1.aimRival === p2;
  p1.throwCd = 0; p1.ammo = 10; p1.ball = "glass"; p1.invuln = 99; p2.invuln = 0; p2.stumble = 0;
  const hp = p2.hp;
  r._throw(p1);
  let stumbled = 0;
  for (let i = 0; i < 40; i += 1) { step(1); stumbled = Math.max(stumbled, p2.stumble); }
  notes.rival = { locked, hpLost: hp - p2.hp, stumbled: +stumbled.toFixed(2) };
  if (!locked) failures.push("the ring doesn't lock onto the rival");
  if (!(hp - p2.hp > 0)) failures.push("a glass sphere at the rival didn't land");
  if (!(stumbled >= 0.7)) failures.push("the rival hit didn't knock them into a stumble");

  // A pickup, run into.
  const pk = find(["serum", "file", "sack", "powerup"], p1.distance + 6, 140);
  if (pk) {
    put(pk.w.d - 4, pk.w.lane);
    p1.invuln = 99;
    step(20);
    notes.pickup = { kind: pk.m.userData.kind, taken: pk.m.userData.alive === false };
    if (!notes.pickup.taken) failures.push(`running into a ${pk.m.userData.kind} didn't take it`);
  } else notes.pickup = "none in reach";

  // The serums - mid-course, both still running.
  for (const p of r.players) { p.finished = false; p.out = null; }
  put(Math.min(p1.distance, r.course.finish - 120), 1);
  const active = () => r.balls.filter((b) => b.active).length;
  r._serum(p1, "prism");
  const a0 = active(); p1.throwCd = 0; p1.ammo = 10; p1.ball = "glass"; r._throw(p1);
  if (active() - a0 !== 3 || p1.ammo !== 9) failures.push(`prism: ${active() - a0} spheres for ${10 - p1.ammo}`);
  r._serum(p1, "infinite");
  const stock = p1.specials.cryo; p1.throwCd = 0; p1.ball = "cryo"; r._throw(p1);
  if (p1.specials.cryo !== stock) failures.push("unlimited spheres: a cryo throw used the race's stock");
  r._serum(p1, "overdrive");
  for (const p of r.players) { p.stumble = 0; p.frozen = 0; p.invuln = 99; }
  p2.distance = p1.distance - 1;
  const d0 = p1.distance, q0 = p2.distance;
  step(30);
  const ratio = (p1.distance - d0) / Math.max(1e-3, p2.distance - q0);
  p1.throwCd = 0; p1.ammo = 3; p1.ball = "glass"; r._throw(p1);
  if (!(ratio > 1.15)) failures.push(`overdrive: ran ${ratio.toFixed(2)}x the rival, not faster`);
  if (p1.ammo !== 3) failures.push("overdrive: a glass throw cost a sphere");
  r._serum(p1, "shield");
  const landed = [0, 1, 2].map(() => { p1.invuln = 0; return r._hurt(p1, 10, "TEST"); });
  if (landed.join() !== "false,false,true") failures.push(`kinetic shield: hits landed ${landed.join()}`);
  p1.hp = 30; p1.ammo = 0; r._serum(p1, "restore");
  if (p1.hp !== 100 || p1.ammo < 10) failures.push("restoration didn't refill at once");
  r._serum(p1, "prism"); p1.power.left = 0.05; step(4);
  if (p1.power) failures.push("a serum didn't wear off");
  return { failures, notes };
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }
  const server = await serve(ROOT);
  console.log(`serving ${ROOT}\n`);
  const browser = await launch(chromium);
  let failed = 0;
  for (const course of COURSES) {
    process.stdout.write(`${course} ... `);
    const { page, errors } = await openPage(browser);
    try {
      await page.setViewportSize({ width: 960, height: 480 });
      await page.addInitScript(() => localStorage.setItem("fractureRunSettings", JSON.stringify({ quality: "low", narration: false })));
      await page.goto(`${server.origin}/index.html`, { waitUntil: "load", timeout: 90000 });
      await page.waitForFunction(() => globalThis.__dbg, null, { timeout: 60000 });
      await page.evaluate(() => document.querySelector("#raceButton").click());
      await page.waitForFunction(() => globalThis.__dbg.race?.state === "lobby" && globalThis.__dbg.race.assets, null, { timeout: 120000 });
      await page.evaluate((key) => {
        const r = globalThis.__dbg.race;
        r.join({ type: "keyboard" });
        r.join({ type: "pad", index: 7 });
        r.courseKey = key;
        r.start();
      }, course);
      // (Building and compiling a course under software rendering takes a while.)
      await page.waitForFunction(() => ["countdown", "racing"].includes(globalThis.__dbg.race?.state), null, { timeout: 480000 });
      const { failures, notes } = await page.evaluate(checkCourse);
      failures.push(...errors);
      if (failures.length) {
        failed += failures.length;
        console.log(`FAIL (${failures.length})`);
        for (const f of failures) console.log(`  x ${f}`);
      } else console.log("ok");
      for (const [key, value] of Object.entries(notes)) console.log(`  · ${key}: ${JSON.stringify(value)}`);
    } catch (error) {
      failed += 1;
      console.log("ERROR");
      console.log(`  x ${error.message}`);
    }
    await page.close();
    console.log();
  }
  await browser.close();
  await server.close?.();
  console.log(failed ? `FAILED - ${failed} problem(s)` : "All checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
