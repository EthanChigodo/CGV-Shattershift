/**
 * Going off the roof, in 3D (src/levels/meltdown/fall-scene.js), as the real
 * game plays it (index.html via __dbg.story):
 *
 *  - Off the east ledge: the fall scene plays before anything else - the run
 *    is not over yet, no 2D death effect, the HUD is off, the body flails.
 *    The camera chases the body (close to it, dropping with it), then stops
 *    dead while the body falls on; then the end screen ("YOU FELL"), with
 *    no 2D effect over it.
 *  - Retry: the roof again, the body upright, the camera free, the scene gone.
 *  - Down a hatch: the same scene in its shaft ("DOWN A HATCH"); a key
 *    before SKIP_AFTER does nothing, one after it skips to the end screen.
 *  - The story's missed jump for the ladder: the same fall, then back on
 *    the roof at the jump (the retry), upright.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

export const name = "fall";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };
  const dir = path.join(shots, "fall");
  await mkdir(dir, { recursive: true });
  const shot = async (file) => {
    await page.evaluate(() => __dbg.render());
    await page.screenshot({ path: path.join(dir, `${file}.jpg`), type: "jpeg", quality: 70 });
  };

  await page.evaluate(() => {
    __dbg.manual = true;
    window.__t = {
      step(n = 1) { for (let i = 0; i < n; i += 1) __dbg.step(1, 1 / 30); },
      until(fn, max = 3000) { let i = 0; while (!fn() && i++ < max) __dbg.step(1, 1 / 30); return fn(); },
      async wait(fn, ms = 120000) {
        const t0 = performance.now();
        while (!fn() && performance.now() - t0 < ms) { __dbg.step(1, 1 / 30); await new Promise((r) => setTimeout(r, 30)); }
        return fn();
      },
      key(code) {
        dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
        dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      },
      get L() { return __dbg.story.layer; },
      get m() { return __dbg.story.getMeltdown(); },
      get f() { return __dbg.story.getMeltdown()._fall; },
      /** Walk off from `at` with `vel` until the fall starts. */
      walkOff(at, vel) {
        const m = __t.m;
        m.hero.position.set(...at);
        for (let i = 0; i < 90 && m.phase === "roof"; i += 1) {
          m.hero.velocity.set(...vel);
          __dbg.step(1, 1 / 30);
        }
        return m.phase;
      },
      ended() {
        return { state: __dbg.state, end: document.querySelector("#endScreen").classList.contains("active"), title: document.querySelector("#endTitle").textContent, fx: __dbg.deathFx.playing };
      },
    };
  });

  // ---- Off the east ledge ----------------------------------------------------------
  const ready = await page.evaluate(async () => {
    __dbg.story.jump("roof");
    return __t.wait(() => __t.m?.phase === "roof", 400000);
  });
  check("the story reaches the roof", ready);
  const ledge = await page.evaluate(() => {
    const m = __t.m;
    const phase = __t.walkOff([15.6, 0, 2], [4, 0, 0]);
    const f = __t.f;
    const out = { phase, active: !!f?.active, kind: f?.kind, state: __dbg.state, fx: __dbg.deathFx.playing, cutscene: document.body.classList.contains("story-cutscene") };
    // The chase: close to the body and dropping with it.
    // (The arms windmill: their reach swings 0..0.8, so take its peak over the frames.)
    const u = m.avatar.uniforms;
    let reach = 0;
    for (let i = 0; i < 24; i += 1) { __t.step(1); if (u) reach = Math.max(reach, u.uReachUp.value); }
    out.flail = u ? { hold: u.uHold.value, reach: +reach.toFixed(2), gait: u.uGait.value } : null;
    out.chaseGap = +m.camera.position.distanceTo(f.body.p).toFixed(2);
    out.camY = +m.camera.position.y.toFixed(1);
    out.facade = f.facade.visible;
    // Past the freeze: the camera holds, the body goes on down.
    __t.until(() => f.t > 1.7, 60);
    const cam = m.camera.position.clone();
    const bodyY = f.body.p.y;
    __t.step(15);
    out.camMoved = +m.camera.position.distanceTo(cam).toFixed(3);
    out.bodyDrop = +(bodyY - f.body.p.y).toFixed(1);
    out.frozen = f.frozen;
    out.stillPlaying = __dbg.state;
    return out;
  });
  notes.ledge = ledge;
  await shot("01-ledge-falling-away");
  check("off the ledge: the fall scene plays", ledge.phase === "roofFall" && ledge.active && ledge.kind === "ledge", JSON.stringify(ledge));
  check("...before the run ends, with no 2D effect and no HUD", ledge.state === "playing" && !ledge.fx && ledge.cutscene, JSON.stringify(ledge));
  check("...the body flails (arms free and up, legs kicking)", ledge.flail && ledge.flail.hold === 0 && ledge.flail.reach > 0.05 && ledge.flail.gait === 1, JSON.stringify(ledge.flail));
  check("...the camera chases it down, close", ledge.chaseGap < 7 && ledge.camY < -2 && ledge.facade, JSON.stringify(ledge));
  check("...then stops dead while the body falls on", ledge.frozen && ledge.camMoved < 0.001 && ledge.bodyDrop > 8 && ledge.stillPlaying === "playing", JSON.stringify(ledge));
  const ledgeEnd = await page.evaluate(() => {
    __t.until(() => __dbg.state === "ended", 150);
    __t.step(2);
    return { ...__t.ended(), cutscene: document.body.classList.contains("story-cutscene"), label: document.querySelector("#restartButton").textContent };
  });
  notes.ledgeEnd = ledgeEnd;
  check("...then the end screen: YOU FELL, no 2D effect", ledgeEnd.state === "ended" && ledgeEnd.end && ledgeEnd.title === "YOU FELL" && !ledgeEnd.fx && !ledgeEnd.cutscene, JSON.stringify(ledgeEnd));
  check("...which offers the roof again", ledgeEnd.label === "RETRY THE ROOF", ledgeEnd.label);

  // ---- Retry, then down a hatch (and the skip) ----------------------------------------
  const retry = await page.evaluate(async () => {
    __dbg.restartRun();
    const back = await __t.wait(() => __t.m.phase === "roof", 400000);
    const m = __t.m;
    __t.step(2);
    return {
      back, sceneShown: !!__t.f?.group?.visible, holds: !!__t.f?.holdsCamera, shadow: m.avatar.shadow.visible,
      tilt: +(Math.abs(m.avatar.root.rotation.x) + Math.abs(m.avatar.root.rotation.z)).toFixed(3), hold: m.avatar.hold,
    };
  });
  notes.retry = retry;
  check("retry: back on the roof, upright, the scene put away", retry.back && !retry.sceneShown && !retry.holds && retry.shadow && retry.tilt < 0.01 && retry.hold === 1, JSON.stringify(retry));
  const hatch = await page.evaluate(async () => {
    const { HATCHES, HATCH_MOUTHS } = await import("/src/levels/meltdown/roof.js");
    // In through hatch 3's open side.
    const h = HATCHES[3];
    const mouth = HATCH_MOUTHS[3];
    const phase = __t.walkOff([h.x + mouth.x * 1.8, 0, h.z + mouth.z * 1.8], [-mouth.x * 2.5, 0, -mouth.z * 2.5]);
    const f = __t.f;
    const out = { phase, kind: f?.kind, shaft: f?.shaft.visible };
    __t.step(5);
    __t.key("KeyX");
    __t.step(2);
    out.earlySkip = !f.active;
    __t.until(() => f.t > 0.7, 30);
    __t.key("KeyX");
    __t.step(3);
    out.skipped = f.skipped;
    out.at = +f.t.toFixed(2);
    return { ...out, ...__t.ended() };
  });
  notes.hatch = hatch;
  check("down a hatch: the fall scene, in its shaft", hatch.phase === "roofFall" && hatch.kind === "hatch" && hatch.shaft, JSON.stringify(hatch));
  check("...a key before half a second does not skip it", !hatch.earlySkip, JSON.stringify(hatch));
  check("...one after it does: straight to the end screen (DOWN A HATCH)", hatch.skipped && hatch.at < 1 && hatch.state === "ended" && hatch.end && hatch.title === "DOWN A HATCH" && !hatch.fx, JSON.stringify(hatch));

  // ---- The missed jump for the ladder ---------------------------------------------------
  const latch = await page.evaluate(async () => {
    __dbg.restartRun();
    await __t.wait(() => __t.m.phase === "roof", 400000);
    const m = __t.m;
    m.hero.position.set(15.2, 0, -1.3);
    m._startLadderLatch();
    // No keys: the reaction runs out and you fall.
    const fell = __t.until(() => __t.f?.active, 200);
    const out = { fell, phase: m.phase, fx: __dbg.deathFx.playing };
    __t.until(() => !__t.f.active, 200);
    __t.step(3);
    return { ...out, after: m.phase, state: __dbg.state, holds: !!__t.f?.holdsCamera, x: +m.hero.position.x.toFixed(2), tilt: +Math.abs(m.avatar.root.rotation.x).toFixed(3) };
  });
  notes.latch = latch;
  check("a missed jump for the ladder: the same fall (no 2D effect)", latch.fell && latch.phase === "latch" && !latch.fx, JSON.stringify(latch));
  check("...then back on the roof at the jump, upright", latch.after === "roof" && latch.state === "playing" && !latch.holds && latch.x < 16 && latch.tilt < 0.01, JSON.stringify(latch));
  return { failures, notes };
}
