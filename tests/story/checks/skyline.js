/**
 * Phase 5 (index.html via __dbg.story): the Skyline's blast fires once near
 * the end of the bridge; the sprint (A/D) and the latch decide it - a miss
 * of either falls and retries from the sprint; the catch pulls you up, on
 * your back, then control returns in the atrium. Endless Skyline has no
 * blast. On the roof the ladder jump needs the latch; a miss retries while
 * the helicopter waits.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

export const name = "skyline";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };
  const dir = path.join(shots, "phase5");
  await mkdir(dir, { recursive: true });
  const shot = async (file) => {
    await page.evaluate(() => __dbg.render());
    await page.screenshot({ path: path.join(dir, `${file}.jpg`), type: "jpeg", quality: 70 });
  };

  await page.evaluate(() => {
    __dbg.manual = true;
    window.__t = {
      key(code, type = "both") {
        if (type !== "up") dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
        if (type !== "down") dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      },
      step(n = 1) { for (let i = 0; i < n; i += 1) __dbg.step(1, 1 / 30); },
      until(fn, max = 3000) { let i = 0; while (!fn() && i++ < max) __dbg.step(1, 1 / 30); return fn(); },
      async wait(fn, ms = 120000) {
        const t0 = performance.now();
        while (!fn() && performance.now() - t0 < ms) { __dbg.step(1, 1 / 30); await new Promise((r) => setTimeout(r, 30)); }
        return fn();
      },
      get L() { return __dbg.story.layer; },
      get R() { return __dbg.story.layer.reactions; },
      started(id) { return __t.L.log.filter((e) => e[0] === "reaction-start" && e[1] === id).length; },
      /** Play the running reaction correctly. */
      play() {
        const r = __t.R;
        let guard = 0;
        while (r.running && guard++ < 400) {
          const s = r._s;
          if (s.kind === "press" || s.kind === "combo") for (const k of s.keys) __t.key(k);
          else if (s.kind === "sequence") __t.key(s.keys[s.index]);
          else if (s.kind === "mash") __t.key(s.keys[s.presses % s.keys.length]);
          else if (s.kind === "hold") __t.key(s.keys[0], "down");
          __t.step(1);
        }
      },
    };
  });

  // ---- The Skyline -------------------------------------------------------------
  await page.evaluate(() => __dbg.story.jump("skyline"));
  const start = await page.evaluate(() => ({ state: __dbg.state, level: __dbg.currentLevel, d: __dbg.causewayDistance(), built: !!__dbg.story.skyline }));
  check("the story's Skyline is set up for the blast", start.level === 1 && start.state === "playing" && start.built, JSON.stringify(start));

  const blast = await page.evaluate(() => {
    const ok = __t.until(() => __t.L.sceneId === "blast", 600);
    return { ok, d: __dbg.causewayDistance(), state: __dbg.state };
  });
  check("the blast fires near the end of the bridge", blast.ok && blast.d >= 499 && blast.d < 503, JSON.stringify(blast));
  await page.evaluate(() => __t.until(() => __t.L.player.t > 1.6, 120));
  await shot("01-tower-floor-by-floor");
  const tower = await page.evaluate(() => {
    const t = __dbg.story.skyline.tower;
    const mid = t.state.floorsGone;
    __t.until(() => t.state.whole > 0, 200);
    return { mid, floors: t.floors, all: t.state.floorsGone, whole: t.state.whole };
  });
  check("the tower goes floor by floor, then all at once", tower.mid > 2 && tower.mid < tower.floors && tower.all === tower.floors && tower.whole > 0, JSON.stringify(tower));
  await shot("01b-the-whole-tower");
  const ramp = await page.evaluate(() => {
    __t.until(() => __t.R.running, 300);
    const shell = __dbg.causeway.shell;
    return { angle: shell.tilt?.angle ?? 0, low: shell.deckHeight(480), high: shell.deckHeight(530) };
  });
  check("the bridge swings down into a ramp up to the tip", ramp.angle > 0.15 && ramp.low < ramp.high - 5, JSON.stringify(ramp));
  // The prompt as it first comes up (fully faded in), before the miss below.
  await page.evaluate(() => __t.step(8));
  await shot("02-sprint-prompt");

  // Miss the sprint: the bridge takes you; back to the sprint.
  const sprintMiss = await page.evaluate(() => {
    __t.until(() => __t.R.running, 300);
    const kind = __t.R._s.kind;
    const keys = __t.R._s.keys.join();
    __t.until(() => !__t.R.running, 400);
    const failed = __t.R.state === "fail";
    __t.step(15);
    const falling = __t.L.deathTime > 0;
    __t.until(() => __t.L.deathTime === 0, 200);
    const t = __t.L.player.t;
    const again = __t.until(() => __t.R.running, 300) && __t.started("sprint") >= 2;
    return { kind, keys, failed, falling, t, again };
  });
  check("the sprint is a mash of A and D", sprintMiss.kind === "mash" && sprintMiss.keys === "KeyA,KeyD", JSON.stringify(sprintMiss));
  check("a missed sprint falls, then retries from the sprint", sprintMiss.failed && sprintMiss.falling && sprintMiss.again, JSON.stringify(sprintMiss));

  // Sprint right, then miss the latch: back to the sprint again.
  const latchMiss = await page.evaluate(() => {
    __t.play();
    const sprinted = __t.R.state === "success";
    const ok = __t.until(() => __t.R.running && __t.R._s.spec.label === "GRAB", 200);
    const keys = __t.R._s?.keys.length;
    const wrong = ["KeyR", "KeyF", "KeyZ", "KeyX", "KeyG", "KeyT"].find((k) => !__t.R._s.keys.includes(k));
    __t.key(wrong);
    __t.step(2);
    const falling = __t.L.deathTime > 0;
    __t.until(() => __t.L.deathTime === 0, 200);
    const back = __t.until(() => __t.R.running && __t.R._s.kind === "mash", 300);
    return { sprinted, ok, keys, falling, back, sprints: __t.started("sprint") };
  });
  check("the latch is two keys, fast", latchMiss.ok && latchMiss.keys === 2, JSON.stringify(latchMiss));
  check("a missed latch falls, then retries from the sprint", latchMiss.falling && latchMiss.back && latchMiss.sprints >= 3, JSON.stringify(latchMiss));

  // Now right: sprint, jump, latch.
  await page.evaluate(() => {
    __t.play();
    __t.until(() => __t.R.running && __t.R._s.spec.label === "GRAB", 200);
  });
  await shot("03-mid-air-latch-prompt");
  await page.evaluate(() => { __t.play(); __t.until(() => __t.L.player.t > 7.25, 200); });
  await shot("04-hands-on-the-ledge");
  await page.evaluate(() => __t.until(() => __t.L.player.t > 10.45, 300));
  await shot("05-on-your-back-the-sky");
  const after = await page.evaluate(() => {
    __t.until(() => __dbg.state === "playing", 600);
    const d0 = __dbg.causewayDistance();
    const lane0 = __dbg.playerX;
    __t.key("KeyD");
    __t.step(30);
    return { state: __dbg.state, d0, d1: __dbg.causewayDistance(), x0: lane0, x1: __dbg.playerX, done: __dbg.story.skyline?.done, health: __dbg.health };
  });
  check("the catch returns control in the atrium", after.state === "playing" && after.d0 > 540 && after.d0 < 552, JSON.stringify(after));
  check("...with input working (running, changing lanes)", after.d1 > after.d0 + 3 && after.x1 > after.x0 + 1, JSON.stringify(after));
  check("the blast plays once", after.done === true);
  const once = await page.evaluate(() => { __t.step(60); return __t.L.log.filter((e) => e[0] === "done" && e[1] === "blast").length; });
  check("...and only once", once === 1, String(once));

  // ---- Endless Skyline: no blast --------------------------------------------------
  const endless = await page.evaluate(() => {
    __dbg.startEndless("skyline");
    __dbg.setCausewayDistance(495);
    __t.step(150);
    return { state: __dbg.state, scene: __t.L.sceneId, built: !!__dbg.story.skyline, d: __dbg.causewayDistance() };
  });
  check("Endless Skyline has no blast", !endless.built && !endless.scene && endless.d > 505, JSON.stringify(endless));

  // ---- The roof: the ladder needs the latch ----------------------------------------
  const roof = await page.evaluate(async () => {
    const m = __dbg.story.getMeltdown();
    m.roofOptions = { heliSeconds: 3 };
    __dbg.story.jump("roof");
    // The roof is heavy (the scan, the brute, the kit): software GL takes a while.
    const ok = await __t.wait(() => m.phase === "roof", 240000);
    const r = m.roof;
    // Step to the hover without waiting on the wall clock (each software-GL frame is slow).
    __t.until(() => r.state.ending === "extraction" && r.state.extractT > 2.8, 900);
    await __t.wait(() => r.state.ending === "extraction" && r.state.extractT > 2.8, 60000);
    // Stand at the ledge, by the ladder - on the roof (past the ledge you'd fall).
    const THREE = __dbg.THREE;
    const bottom = r.ladderBottom(new THREE.Vector3());
    const spot = new THREE.Vector3(Math.min(bottom.x - 2.2, 15.4), 0, bottom.z);
    m.hero.position.copy(spot);
    if (m.hero.vy !== undefined) m.hero.vy = 0;
    m.runner.invulnerable = 999;
    __t.step(1);
    const canGrab = r.canGrab(m.hero.position);
    m.onKeyDown({ code: "Space", preventDefault() {} });
    __t.until(() => __t.R.running, 60);
    const latch = m.phase === "latch" && __t.R.running && __t.R._s.spec.label === "GRAB";
    if (!latch) return { ok, canGrab, latch, phase: m.phase };
    const from = m.hero.position.clone();
    const wrong = ["KeyR", "KeyF", "KeyZ", "KeyX", "KeyG", "KeyT"].find((k) => !__t.R._s.keys.includes(k));
    __t.key(wrong);
    __t.step(20);
    const fell = m.hero.position.y < from.y - 1;
    __t.until(() => m.phase === "roof", 200);
    const back = m.hero.position.distanceTo(from) < 1.5 && m.phase === "roof";
    const window = r.state.extractT;
    const stillThere = r.state.ending === "extraction";
    // Now properly.
    m.onKeyDown({ code: "Space", preventDefault() {} });
    __t.until(() => __t.R.running, 60);
    __t.play();
    __t.until(() => m.phase === "ending", 60);
    __t.step(5);
    return { ok, canGrab, latch, fell, back, window, stillThere, phase: m.phase, ending: r.state.ending };
  });
  check("the roof story starts", roof.ok, JSON.stringify(roof));
  check("the ladder jump needs the latch", roof.canGrab && roof.latch, JSON.stringify(roof));
  check("a missed latch falls, then retries from just before the jump", roof.fell && roof.back, JSON.stringify(roof));
  check("the helicopter waits through the retry", roof.stillThere && roof.window <= 2.75, JSON.stringify(roof));
  check("a caught latch plays the leap onto the ladder", roof.phase === "ending" && roof.ending === "survive", JSON.stringify(roof));
  await shot("06-ladder-latch");

  return { failures, notes };
}
