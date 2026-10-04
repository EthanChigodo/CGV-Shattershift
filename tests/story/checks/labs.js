/**
 * Phase 4, the Labs in the story (index.html via __dbg.story): the breach
 * (every incubator bursts once, Vale on the monitor, nothing can hit you),
 * Okoro running ahead and never in your lane close to you, his pistol never
 * changing anything, the bend attack (waits for you to land; a failure costs
 * vitality and retries; success costs nothing), the desk (the bag, Okoro
 * gone, the doors shut on him), then the quiet ride up (src/elevators/
 * quiet-ride.js) and the hand-over to the Skyline.
 * Endless Labs has none of it.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

export const name = "labs";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };
  const dir = path.join(shots, "phase4");
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
      /** Real time passes (async loads) while the game steps. */
      async wait(fn, ms = 120000) {
        const t0 = performance.now();
        while (!fn() && performance.now() - t0 < ms) { __dbg.step(1, 1 / 30); await new Promise((r) => setTimeout(r, 30)); }
        return fn();
      },
      get m() { return __dbg.meltdown; },
      get d() { return __dbg.meltdown?.director; },
      get L() { return __dbg.story.layer; },
    };
  });

  await page.evaluate(() => __dbg.story.jump("labs"));
  const arrived = await page.evaluate(async () => {
    const ok = await __t.wait(() => __t.m?.phase === "arrive" || __t.m?.phase === "story", 180000);
    return { ok, phase: __t.m?.phase, director: !!__t.d, okoro: __t.d?.okoro.root.visible };
  });
  check("the story's Labs build the director", arrived.ok && arrived.director, JSON.stringify(arrived));

  // ---- 4a: the breach -------------------------------------------------------
  const breach = await page.evaluate(() => {
    const ok = __t.until(() => __t.L.sceneId === "breach", 600);
    return { ok, okoroBeside: __t.d.okoro.root.position.distanceTo(__t.m.avatar.root.position) < 4 };
  });
  check("the breach plays after the arrival, Okoro beside you", breach.ok && breach.okoroBeside, JSON.stringify(breach));
  const before = await page.evaluate(() => ({ v: __t.m.runner.vitality, hits: __t.m.runner.hits }));
  await page.evaluate(() => __t.until(() => __t.d.log.filter((e) => e[0] === "burst").length >= 3, 900));
  await shot("01-incubators-burst");
  const vale = await page.evaluate(() => {
    const ok = __t.until(() => __t.d.monitorOn && __t.L.player.t > 0 && /Elias/.test(document.querySelector(".story-sub .line")?.textContent ?? ""), 1500);
    return { ok, rt: __t.d.screenMat.map === __t.d.monitorRT.texture, valeModel: !!__t.d.vale.model };
  });
  check("Vale appears on the monitor (rendered to a texture)", vale.ok && vale.rt, JSON.stringify(vale));
  await shot("02-vale-on-the-monitor");
  const breachEnd = await page.evaluate(() => {
    __t.until(() => __t.m.phase === "run", 1500);
    const bursts = __t.d.log.filter((e) => e[0] === "burst").map((e) => e[1]);
    return { phase: __t.m.phase, bursts, tanks: __t.d.tanks.length, v: __t.m.runner.vitality, hits: __t.m.runner.hits };
  });
  check("every incubator bursts once", breachEnd.bursts.length === breachEnd.tanks && new Set(breachEnd.bursts).size === breachEnd.tanks, JSON.stringify(breachEnd.bursts));
  check("nothing can hit you during the breach", breachEnd.v === before.v && breachEnd.hits === before.hits, `${before.v}->${breachEnd.v}`);
  check("the breach hands over to the run", breachEnd.phase === "run", breachEnd.phase);

  // ---- 4b: Okoro runs; 4c: the bend ----------------------------------------
  const runToBend = await page.evaluate(() => {
    const m = __t.m;
    const r = m.runner;
    const g = __t.d.guide;
    const breakables = m.level.breakables.filter((b) => b.userData.alive !== false).length;
    let laneViolations = [];
    let airborneHeld = false;
    let guard = 0;
    const startBreaks = r.breaks;
    while (m.phase === "run" && guard++ < 4000) {
      r.invulnerable = 999;
      // A fallen duct: mash to push it, as a player would.
      if (r.pushing) m._jump();
      // Jump just before the bend: it must wait for you to land.
      if (r.distance > 228 && r.distance < 232 && r.height <= 0.001 && !airborneHeld) { r.verticalVelocity = 7.6; airborneHeld = true; }
      __t.step(1);
      if (m.phase !== "run") break;
      const gap = g.d - r.distance;
      if (gap < 6 && Math.abs(g.lateral - r.lateral) < 1.4) laneViolations.push(+r.distance.toFixed(1));
      if (airborneHeld && r.height > 0.05 && __t.L.sceneId === "bendAttack") return { early: true, d: r.distance };
    }
    const pistol = __t.d.log.filter((e) => e[0] === "pistol").length;
    return {
      phase: m.phase, scene: __t.L.sceneId, d: +r.distance.toFixed(1), height: r.height,
      laneViolations: laneViolations.slice(0, 6), violations: laneViolations.length,
      pistol, breaksByPistol: r.breaks - startBreaks,
      breakablesAfter: m.level.breakables.filter((b) => b.userData.alive !== false).length, breakablesBefore: breakables,
    };
  });
  notes.pistolShots = runToBend.pistol;
  check("the bend waits for you to land", !runToBend.early, JSON.stringify(runToBend));
  check("Okoro never enters your lane within 6 m of you", runToBend.violations === 0, JSON.stringify(runToBend.laneViolations));
  check("his pistol never breaks a breakable or changes your stats", runToBend.breaksByPistol === 0, JSON.stringify(runToBend));
  check("the bend attack starts at the first turn", runToBend.scene === "bendAttack" && runToBend.d > 225 && runToBend.d < 245, JSON.stringify(runToBend));

  const bend = await page.evaluate(() => {
    const m = __t.m;
    const r = m.runner;
    const v0 = r.vitality;
    __t.until(() => __t.L.reactions.running, 300);
    // First, let it win.
    __t.until(() => !__t.L.reactions.running, 400);
    __t.step(2);
    const afterFail = r.vitality;
    const retried = __t.until(() => __t.L.reactions.running, 400);
    return { v0, afterFail, retried, alive: r.alive };
  });
  check("a lost struggle costs vitality, not your life", bend.afterFail === bend.v0 - 30 && bend.alive, JSON.stringify(bend));
  check("...and the struggle comes round again", bend.retried, JSON.stringify(bend));
  await shot("03-bend-attack");
  const bendWin = await page.evaluate(() => {
    const m = __t.m;
    const r = m.runner;
    const v1 = r.vitality;
    let n = 0;
    while (__t.L.reactions.running && n++ < 300) { __t.key("Space"); __t.step(1); }
    const won = __t.L.reactions.state === "success";
    __t.until(() => m.phase === "run", 900);
    return { won, v1, v2: r.vitality, phase: m.phase };
  });
  // (A frame of the fire's slow drain is all that may come off.)
  check("pushing it off costs nothing, and the run goes on", bendWin.won && Math.abs(bendWin.v2 - bendWin.v1) < 0.5 && bendWin.phase === "run", JSON.stringify(bendWin));

  // On through the containment corridor and into the blackout, where
  // patients lurch into the lanes: his pistol fires at the side lanes and
  // changes nothing.
  const pistol = await page.evaluate(() => {
    const m = __t.m;
    const r = m.runner;
    const g = __t.d.guide;
    const startBreaks = r.breaks;
    const startDowns = r.downs;
    const alive = () => m.level.breakables.filter((b) => b.userData.alive !== false).length;
    const before = alive();
    const violations = [];
    let guard = 0;
    while (m.phase === "run" && r.distance < 700 && guard++ < 4000) {
      r.invulnerable = 999;
      if (r.pushing) m._jump();
      __t.step(1);
      if (g.d - r.distance < 6 && Math.abs(g.lateral - r.lateral) < 1.4) violations.push(+r.distance.toFixed(1));
    }
    return { d: r.distance, shots: __t.d.log.filter((e) => e[0] === "pistol").length, breaks: r.breaks - startBreaks, downs: r.downs - startDowns, alive: alive(), before, violations: violations.length };
  });
  notes.pistolShots = pistol.shots;
  check("his pistol fires in the containment corridor", pistol.shots > 0, JSON.stringify(pistol));
  check("...and never breaks a breakable or changes your stats", pistol.breaks === 0 && pistol.downs === 0 && pistol.alive === pistol.before, JSON.stringify(pistol));
  check("he stays out of your lane close to you there too", pistol.violations === 0, JSON.stringify(pistol));

  // ---- 4d: the desk, 4e: grief ------------------------------------------------
  const desk = await page.evaluate(() => {
    const m = __t.m;
    m.teleport(m.level.route.totalLength - 25, { camera: 0 });
    m.phase = "run";
    const ok = __t.until(() => __t.L.sceneId === "hide", 900);
    return { ok, phase: m.phase };
  });
  check("the end of the Labs plays the desk scene instead of the run in", desk.ok && desk.phase === "story", JSON.stringify(desk));
  await page.evaluate(() => __t.until(() => __t.L.player.t > 6, 900));
  await shot("04-behind-the-desk");
  const bag = await page.evaluate(() => {
    __t.until(() => __t.d.log.some((e) => e[1] === "okoro-run"), 2400);
    __t.step(25);
    return { bag: __t.m.storyBag, okoroBag: __t.d.okoro.bag?.visible };
  });
  check("the bag goes from Okoro to you", bag.bag && bag.okoroBag === false, JSON.stringify(bag));
  await shot("05-okoro-runs-off");
  await page.evaluate(() => __t.until(() => __t.d.log.some((e) => e[1] === "doors"), 900));
  await page.evaluate(() => __t.step(15));
  await shot("06-doors-closing");
  const ride = await page.evaluate(() => {
    // The hide scene ends on the shut doors; the quiet ride takes over.
    const ok = __t.until(() => !!__dbg.gravityLift?.cutscene, 900);
    return { ok, okoro: __t.d?.okoro.root.visible ?? false, level: __dbg.currentLevel, state: __dbg.state };
  });
  check("Okoro is gone from the corridor afterwards", !ride.okoro, JSON.stringify(ride));
  check("the quiet ride plays after the doors shut", ride.ok, JSON.stringify(ride));
  await page.evaluate(() => __t.step(150));
  await shot("07-quiet-ride");
  const up = await page.evaluate(async () => {
    // Step the rest of the ride (~20 s) without waiting on the wall clock -
    // software GL renders each step slowly - then let any async handover land.
    __t.until(() => __dbg.currentLevel === 1 && !__dbg.gravityLift, 1200);
    const ok = await __t.wait(() => __dbg.currentLevel === 1 && !__dbg.gravityLift, 120000);
    return { ok, level: __dbg.currentLevel, state: __dbg.state, fade: document.querySelector(".story-fade").style.opacity };
  });
  check("the quiet ride hands over to the Skyline", up.ok && up.level === 1, JSON.stringify(up));
  check("the story layer's black is cleared for the Skyline", up.fade === "0" || up.fade === "", JSON.stringify(up));

  // ---- Endless Labs: none of it ------------------------------------------------
  const endless = await page.evaluate(async () => {
    const before = __t.L.log.length;
    __dbg.startEndless("labs");
    await __t.wait(() => __t.m?.phase === "run", 180000);
    __t.step(120);
    return { director: !!__t.m.director, entries: __t.L.log.length - before, phase: __t.m.phase };
  });
  check("Endless Labs has no cutscenes and no Okoro", !endless.director && endless.entries === 0, JSON.stringify(endless));

  return { failures, notes };
}
