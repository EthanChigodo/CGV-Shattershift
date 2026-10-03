/**
 * Phase 2, the opening, in the real game (index.html via __dbg.story):
 * the wake-up and the walk out play in a story run, hand over to the
 * Foundry with no cut, Okoro runs 3-8 m ahead on a free lane and talks in
 * order, the spheres arrive with him, he waits in the lift; hold Esc skips,
 * a tap pauses (and the clock stops); a restart skips the wake; Endless has
 * none of it.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

export const name = "opening";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };
  const dir = path.join(shots, "phase2");
  await mkdir(dir, { recursive: true });
  const shot = async (file) => {
    await page.evaluate(() => __dbg.render());
    await page.screenshot({ path: path.join(dir, `${file}.jpg`), type: "jpeg", quality: 70 });
  };

  await page.evaluate(() => {
    __dbg.manual = true;
    __dbg.story.jump("wake");
  });

  // ---- The wake-up ----------------------------------------------------------
  const start = await page.evaluate(() => ({
    state: __dbg.state, level: __dbg.currentLevel, scene: __dbg.story.layer.sceneId,
    ammo: __dbg.ammo, okoro: __dbg.story.okoro.root.visible, ward: !!__dbg.story.ward,
  }));
  check("story start plays the wake scene", start.state === "cutscene" && start.scene === "wake", JSON.stringify(start));
  check("...in the Foundry (currentLevel 2) with the ward and Okoro", start.level === 2 && start.ward && start.okoro, JSON.stringify(start));
  check("no spheres before the hand-off", start.ammo === 0, String(start.ammo));

  const stepTo = (scene, t) => page.evaluate(({ scene, t }) => {
    const L = __dbg.story.layer;
    let guard = 0;
    while (guard++ < 4000 && !(L.sceneId === scene && L.player.t >= t) && __dbg.state === "cutscene") __dbg.step(1, 1 / 30);
    return { scene: L.sceneId, t: L.player.t };
  }, { scene, t });

  await stepTo("wake", 3.3);
  await shot("01-lids-opening");
  await stepTo("wake", 13);
  await shot("02-okoro-over-the-bed");
  const lids = await page.evaluate(() => document.querySelector(".story-lid.top").style.height);
  check("the lids are open by the time he talks", parseFloat(lids) < 10, lids);
  await stepTo("wake", 31.5);
  await shot("03-standing");
  await stepTo("walkOut", 2.6);
  await shot("04-walk-out");

  // ---- Hand-over to the run -------------------------------------------------
  const handover = await page.evaluate(() => {
    let guard = 0;
    while (__dbg.state === "cutscene" && guard++ < 2000) __dbg.step(1, 1 / 30);
    const c = __dbg.camera.position;
    return { state: __dbg.state, cam: [c.x, c.y, c.z], runZ: __dbg.runZ, ammo: __dbg.ammo, ward: !!__dbg.story.ward };
  });
  check("the opening hands over to the run", handover.state === "playing", handover.state);
  check("...from the chase camera's own spot (no cut)", Math.abs(handover.cam[1] - 4.2) < 0.05 && Math.abs(handover.cam[2] - (handover.runZ + 8.5)) < 0.3, JSON.stringify(handover));
  check("the ward is disposed once the run starts", !handover.ward);
  await shot("05-first-foundry-frame");

  // ---- The run: hand-off, talk, lead, lanes ---------------------------------
  const runResult = await page.evaluate(() => {
    const L = __dbg.story.layer;
    const f = __dbg.foundry;
    const g = __dbg.story.guide;
    const THREE = __dbg.THREE;
    const total = f.route.totalLength;
    __dbg.setHealth(1e6);
    const ammoAt = [];
    let handoffAt = null;
    const inside = [];
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    const size = new THREE.Vector3(0.7, 1.6, 0.7);
    let guard = 0;
    let lastAmmo = __dbg.ammo;
    let shotHandoff = false;
    while (__dbg.state === "playing" && guard++ < 6000) {
      __dbg.step(1, 1 / 30);
      const d = __dbg.foundryDistance();
      if (__dbg.ammo !== lastAmmo && handoffAt === null && __dbg.ammo >= 12) handoffAt = d;
      lastAmmo = __dbg.ammo;
      // Play it straight: break each switch when it comes into range.
      for (const glass of f.breakables) {
        const at = glass.userData.routeDistance;
        if (glass.userData.alive && glass.userData.kind === "switch" && at !== undefined && at - d < 22 && at > d) __dbg.shatter(glass);
      }
      __dbg.setHealth(1e6);
      // Okoro must never be inside a hazard's box while he runs the route.
      if (g.mode === "run" && guard % 3 === 0) {
        c.copy(__dbg.story.okoro.root.position).setY(0.95);
        box.setFromCenterAndSize(c, size);
        if (f.collide(box, g.d, 10).length) inside.push(+g.d.toFixed(1));
      }
      if (handoffAt !== null && !shotHandoff) { shotHandoff = true; }
    }
    const talk = L.log.filter((x) => x[0] === "talk").map((x) => x[2]);
    const firstSwitch = Math.min(...f.breakables.filter((b) => b.userData.kind === "switch").map((b) => b.userData.routeDistance ?? Infinity));
    const leads = g.trace.filter(([p, o]) => o < total - 1.5 && p > 1).map(([p, o]) => o - p);
    return {
      state: __dbg.state, total, handoffAt, firstSwitch, talk, inside: inside.slice(0, 8), insideCount: inside.length,
      minLead: Math.min(...leads), maxLead: Math.max(...leads), samples: leads.length,
      mode: g.mode, okoro: __dbg.story.okoro.root.position.toArray(),
    };
  });
  notes.lead = `${runResult.minLead.toFixed(2)}-${runResult.maxLead.toFixed(2)} m over ${runResult.samples} samples`;
  check("Okoro stays 3-8 m ahead for the whole route", runResult.minLead >= 3 && runResult.maxLead <= 8, notes.lead);
  check("Okoro is never inside a hazard's box", runResult.insideCount === 0, JSON.stringify(runResult.inside));
  check("the spheres arrive with him (12)", runResult.handoffAt !== null, "no hand-off");
  check("no switch needs a sphere before the hand-off", runResult.handoffAt < runResult.firstSwitch, `${runResult.handoffAt} vs ${runResult.firstSwitch}`);
  const script = await page.evaluate(async () => (await import("/src/story/script.js")).SCENES.foundryTalk.map((l) => l.text));
  check("every Foundry line shows, once, in order", JSON.stringify(runResult.talk) === JSON.stringify(script), `${runResult.talk.length}/${script.length}`);
  check("the run reaches the lift", runResult.state === "lift", runResult.state);
  check("Okoro waits for you in the lift", runResult.mode === "inLift", runResult.mode);
  await shot("06-okoro-in-the-lift");

  // ---- Talk lines never overlap ---------------------------------------------
  // (the layer queues them: at most one is up at a time)
  const overlap = await page.evaluate(async () => {
    const L = __dbg.story.layer;
    L.stop();
    L.talk({ who: "okoro", text: "One." });
    L.talk({ who: "okoro", text: "Two." });
    const first = document.querySelector(".story-sub .line").textContent;
    __dbg.step(1, 1 / 30);
    const still = document.querySelector(".story-sub .line").textContent;
    for (let i = 0; i < 90; i += 1) __dbg.step(1, 1 / 30);
    const second = document.querySelector(".story-sub .line").textContent;
    L.stopTalk();
    return { first, still, second };
  });
  check("a line that comes due waits for the one that's up", overlap.first === "One." && overlap.still === "One." && overlap.second === "Two.", JSON.stringify(overlap));

  // ---- Esc: a hold skips, a tap pauses --------------------------------------
  const esc = await page.evaluate(() => {
    const L = __dbg.story.layer;
    const key = (type) => dispatchEvent(new KeyboardEvent(type, { code: "Escape", key: "Escape", bubbles: true }));
    __dbg.story.jump("wake");
    for (let i = 0; i < 30; i += 1) __dbg.step(1, 1 / 30);
    // Tap: pause; the cutscene clock stops.
    key("keydown");
    key("keyup");
    const paused = __dbg.paused;
    const t0 = L.player.t;
    for (let i = 0; i < 30; i += 1) __dbg.step(1, 1 / 30);
    const frozen = L.player.t === t0;
    key("keydown"); // the menu's Esc: resume
    key("keyup");
    const resumed = !__dbg.paused;
    for (let i = 0; i < 5; i += 1) __dbg.step(1, 1 / 30);
    const moving = L.player.t > t0;
    // Hold: skip the whole opening.
    key("keydown");
    for (let i = 0; i < 40 && __dbg.state === "cutscene"; i += 1) __dbg.step(1, 1 / 30);
    key("keyup");
    for (let i = 0; i < 3; i += 1) __dbg.step(1, 1 / 30);
    return { paused, frozen, resumed, moving, state: __dbg.state, guide: !!__dbg.story.guide, ward: !!__dbg.story.ward, ammo: __dbg.ammo, stillPaused: __dbg.paused };
  });
  check("a tap of Esc pauses", esc.paused, JSON.stringify(esc));
  check("...and the cutscene clock doesn't advance while paused", esc.frozen);
  check("...and Esc resumes it", esc.resumed && esc.moving, JSON.stringify(esc));
  check("holding Esc skips straight to Foundry control", esc.state === "playing" && esc.guide && !esc.ward && !esc.stillPaused, JSON.stringify(esc));

  // ---- A restart skips the wake ----------------------------------------------
  const restart = await page.evaluate(() => {
    __dbg.endRun(false);
    __dbg.restartRun();
    for (let i = 0; i < 5; i += 1) __dbg.step(1, 1 / 30);
    return { state: __dbg.state, scene: __dbg.story.layer.sceneId, guide: !!__dbg.story.guide, okoro: __dbg.story.okoro.root.visible };
  });
  check("death and restart in the Foundry skips the wake", restart.state === "playing" && !restart.scene && restart.guide && restart.okoro, JSON.stringify(restart));

  // ---- Endless: none of it ----------------------------------------------------
  const endless = await page.evaluate(() => {
    const before = __dbg.story.layer.log.length;
    __dbg.startEndless("foundry");
    for (let i = 0; i < 240; i += 1) __dbg.step(1, 1 / 30);
    const after = __dbg.story.layer.log.slice(before);
    return { state: __dbg.state, level: __dbg.currentLevel, okoro: __dbg.story.okoro.root.visible, guide: !!__dbg.story.guide, entries: after.length, ammo: __dbg.ammo };
  });
  check("Endless Foundry has no wake scene, no Okoro, no talk", endless.state === "playing" && endless.level === 2 && !endless.okoro && !endless.guide && endless.entries === 0, JSON.stringify(endless));

  return { failures, notes };
}
