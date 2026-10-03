/**
 * Phase 3, the Gravity Fault lift in the story (index.html via __dbg.story):
 * Okoro holds the launcher and drops it in the fall; picking it up is a
 * reaction; the four clamps are the reaction ladder in difficulty order;
 * a miss drops the cabin and retries at that clamp with the earlier ones
 * still locked (five misses in a row never softlock); a wrong key fails,
 * movement keys don't; the two settings work; success reaches the Labs.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

export const name = "lift";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };
  const dir = path.join(shots, "phase3");
  await mkdir(dir, { recursive: true });
  const shot = async (file) => {
    await page.evaluate(() => __dbg.render());
    await page.screenshot({ path: path.join(dir, `${file}.jpg`), type: "jpeg", quality: 70 });
  };

  // Helpers inside the page.
  await page.evaluate(() => {
    __dbg.manual = true;
    window.__t = {
      key(code, type = "both") {
        if (type !== "up") dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
        if (type !== "down") dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      },
      step(n = 1) { for (let i = 0; i < n; i += 1) __dbg.step(1, 1 / 30); },
      /** Step until fn() is true (or give up). */
      until(fn, max = 3000) {
        let i = 0;
        while (!fn() && i++ < max) __dbg.step(1, 1 / 30);
        return fn();
      },
      get ride() { return __dbg.gravityLift; },
      get dir() { return __dbg.gravityLift?.director; },
      get hits() { return __dbg.story.layer.reactions; },
      started(id) { return __t.dir?.log.some((e) => e[0] === "reaction-start" && e[1] === id); },
      /** Play the running reaction correctly, chained links included. */
      play() {
        const r = __t.hits;
        let guard = 0;
        while (r.running && guard++ < 400) {
          const s = r._s;
          if (s.kind === "press" || s.kind === "combo") for (const k of s.keys) __t.key(k);
          else if (s.kind === "sequence") __t.key(s.keys[s.index]);
          else if (s.kind === "mash") { __t.key(s.keys[s.presses % s.keys.length]); }
          else if (s.kind === "hold") __t.key(s.keys[0], "down");
          __t.step(1);
        }
        for (const k of ["Space"]) __t.key(k, "up");
      },
    };
  });

  await page.evaluate(() => __dbg.story.jump("lift"));
  const start = await page.evaluate(() => ({
    ride: !!__t.ride, director: !!__t.dir, holding: __t.dir?.holding, okoro: !!__t.dir?.okoro.model,
    aim: __t.ride?.wantsAim, level: __dbg.currentLevel, state: __dbg.state,
  }));
  check("story ride built with the director", start.ride && start.director, JSON.stringify(start));
  check("Okoro is in the cabin, holding the launcher", start.holding, JSON.stringify(start));

  await page.evaluate(() => __t.until(() => __t.ride.phase === "tremor" && __t.ride.state.pt > 0.6));
  await page.evaluate(() => { __t.ride.forceShot = "close"; });
  await shot("01-okoro-holding-the-launcher");
  await page.evaluate(() => { __t.ride.forceShot = null; });

  // ---- The drop -------------------------------------------------------------
  const drop = await page.evaluate(() => {
    __t.until(() => __t.ride.phase === "freefall" && __t.ride.state.pt > 0.5);
    return { dropped: __t.dir.log.some((e) => e[1] === "drop"), state: __t.ride.launcher.state, gEff: __t.ride.state.gEff };
  });
  check("he drops the launcher in the fall (it floats)", drop.dropped && drop.state === "falling", JSON.stringify(drop));
  await page.evaluate(() => { __t.ride.forceShot = "close"; });
  await shot("02-the-drop");
  await page.evaluate(() => { __t.ride.forceShot = null; });

  // ---- The pickup -----------------------------------------------------------
  const pickup = await page.evaluate(() => {
    const ok = __t.until(() => __t.started("pickup"));
    const s = __t.hits._s;
    return { ok, kind: s?.kind, keys: s?.keys.length, phase: __t.ride.phase, pt: __t.ride.state.pt };
  });
  check("picking it up is a one-key reaction", pickup.ok && pickup.kind === "press" && pickup.keys === 1, JSON.stringify(pickup));
  await shot("03-pickup-prompt");
  // A movement key is ignored; holding Esc doesn't skip it.
  const ignored = await page.evaluate(() => {
    __t.key("KeyA"); __t.key("KeyD"); __t.key("Space");
    __t.key("Escape", "down"); __t.step(25); __t.key("Escape", "up");
    const running = __t.hits.running;
    const paused = __dbg.paused;
    if (paused) __dbg.closePause();
    return { running, paused };
  });
  check("movement keys don't count during a reaction", ignored.running, JSON.stringify(ignored));
  const picked = await page.evaluate(() => {
    __t.play();
    __t.until(() => __t.ride.launcher.state === "held", 600);
    return { held: __t.ride.launcher.state, stage: __t.dir.stage };
  });
  check("the pickup succeeds and the player holds the launcher", picked.held === "held", JSON.stringify(picked));

  // ---- The clamps -------------------------------------------------------------
  const ladder = [];
  for (let i = 0; i < 4; i += 1) {
    const info = await page.evaluate((i) => {
      const ok = __t.until(() => __t.started(`clamp-${i}`) && __t.hits.running);
      const s = __t.hits._s;
      return { ok, kind: s?.kind, keys: s?.keys.length, window: s?.window, then: s?.spec.then?.kind ?? null, shot: __t.ride.currentShot() };
    }, i);
    ladder.push(info);
    await shot(`04-clamp-${i + 1}-prompt`);

    if (i === 2) {
      // Miss the third clamp, five times running.
      const misses = await page.evaluate(() => {
        const out = [];
        for (let n = 0; n < 5; n += 1) {
          const before = { y: __t.ride.state.cabinY, locked: __t.ride.clamps.clamps.map((c) => c.locked) };
          if (n === 0) {
            // A wrong key fails at once.
            const wrong = ["KeyQ", "KeyE", "KeyR", "KeyF", "KeyZ", "KeyX", "KeyC", "KeyV"].find((k) => !__t.hits._s.keys.includes(k));
            __t.key(wrong);
            __t.step(1);
          } else __t.until(() => __t.dir.stage === "fall", 400); // too slow
          const failed = __t.dir.stage === "fall";
          const reason = __t.dir.log.filter((e) => e[0] === "reaction-fail").pop()?.[2];
          __t.until(() => __t.dir.stage === "fall" && __t.dir.fall?.t > 0.9, 200);
          const fell = __t.ride.state.cabinY < before.y - 0.5;
          __t.until(() => __t.dir.stage === "clamp", 400);
          const after = { y: __t.ride.state.cabinY, locked: __t.ride.clamps.clamps.map((c) => c.locked) };
          const again = __t.until(() => __t.hits.running, 400);
          out.push({ failed, reason, fell, sameHeight: Math.abs(after.y - before.y) < 0.01, locked: after.locked, again });
        }
        return out;
      });
      notes.misses = misses.map((m) => m.reason);
      check("a wrong key fails", misses[0].failed && misses[0].reason === "wrong key", JSON.stringify(misses[0]));
      check("a miss drops the cabin", misses.every((m) => m.failed && m.fell), JSON.stringify(misses.map((m) => [m.failed, m.fell])));
      check("the retry is at that clamp: earlier ones locked, same height", misses.every((m) => m.sameHeight && m.locked[0] && m.locked[1] && !m.locked[2]), JSON.stringify(misses));
      check("five misses in a row never softlock", misses.every((m) => m.again), JSON.stringify(misses.map((m) => m.again)));
    }
    if (i === 3) {
      // The settings: longer windows, hold instead of mash (on a fresh start of this one).
      const opts = await page.evaluate(() => {
        const L = __dbg.story.layer;
        const base = __t.hits._s.window;
        document.querySelector("#longReactionsToggle").click();
        document.querySelector("#holdInsteadOfMashToggle").click();
        __t.hits.start(__t.hits._s.spec);
        const long = __t.hits._s.window;
        // Into the mash link: play the sequence.
        while (__t.hits._s.kind === "sequence") __t.key(__t.hits._s.keys[__t.hits._s.index]);
        const kind = __t.hits._s.kind;
        // Hold it.
        __t.key(__t.hits._s.keys[0], "down");
        __t.until(() => !__t.hits.running, 200);
        __t.key("Space", "up");
        document.querySelector("#longReactionsToggle").click();
        document.querySelector("#holdInsteadOfMashToggle").click();
        return { base, long, kind, result: __t.hits.state, options: { ...L.reactions.options } };
      });
      check("'Longer reaction windows' makes windows 1.6x", Math.abs(opts.long - opts.base * 1.6) < 1e-6, JSON.stringify(opts));
      check("'Hold instead of mash' turns the mash into a hold", opts.kind === "hold" && opts.result === "success", JSON.stringify(opts));
      check("the toggles switch back off", !opts.options.longWindows && !opts.options.holdInsteadOfMash, JSON.stringify(opts.options));
    } else {
      const lockedBefore = await page.evaluate(() => __t.ride.clamps.locked);
      await page.evaluate(() => { __t.play(); __t.step(20); });
      const lockedAfter = await page.evaluate(() => __t.ride.clamps.locked);
      check(`clamp ${i + 1}: success fires the launcher and locks it`, lockedAfter === lockedBefore + 1, `${lockedBefore} -> ${lockedAfter}`);
    }
  }
  notes.ladder = ladder.map((l) => `${l.kind}${l.then ? "+" + l.then : ""}/${l.keys}/${l.window?.toFixed(2)}`);
  const kinds = ladder.map((l) => l.kind).join();
  check("the clamps are press, combo, sequence, sequence+mash", kinds === "press,combo,sequence,sequence" && ladder[3].then === "mash", notes.ladder.join(" "));
  check("key counts 1, 2, 3, 4", ladder.map((l) => l.keys).join() === "1,2,3,4", ladder.map((l) => l.keys).join());
  check("windows shrink", ladder[0].window > ladder[1].window && ladder[1].window > ladder[2].window && ladder[2].window > ladder[3].window, notes.ladder.join(" "));
  check("each clamp changes the camera", new Set(ladder.map((l) => l.shot)).size >= 3, ladder.map((l) => l.shot).join());

  // ---- Saved, and on to the Labs ---------------------------------------------
  const saved = await page.evaluate(() => ({ saved: __t.dir.saved, stage: __t.dir.stage, lines: __t.dir.log.filter((e) => e[0] === "line").map((e) => e[2]) }));
  check("the brakes catch, and Okoro says keep it", saved.saved && saved.lines.some((l) => /Keep it/.test(l)), JSON.stringify(saved));
  await page.evaluate(() => __t.step(20));
  await shot("05-brakes-catch");
  const fallShot = await page.evaluate(() => {
    // For the screenshot only: what a miss looks like.
    return true;
  });
  const end = await page.evaluate(async () => {
    __t.until(() => !__dbg.gravityLift, 2400);
    const t0 = performance.now();
    while (performance.now() - t0 < 90000 && !(__dbg.currentLevel === 3 && __dbg.state === "playing")) {
      await new Promise((r) => setTimeout(r, 250));
      __t.step(1);
    }
    return { level: __dbg.currentLevel, state: __dbg.state, ride: !!__dbg.gravityLift };
  });
  check("playing every reaction right reaches the Labs", end.level === 3 && end.state === "playing" && !end.ride, JSON.stringify(end));
  void fallShot;

  // ---- The non-story ride is unchanged ----------------------------------------
  const classic = await page.evaluate(() => {
    __dbg.resetGame("story");
    __dbg.demoGravityLift();
    const ride = __dbg.gravityLift;
    const out = { director: !!ride?.director, phases: ride?.phases.map((p) => p.join(":")).join(" ") };
    __t.until(() => ride.phase === "clamps" && ride.state.pt > 0.5, 1200);
    out.aims = ride.wantsAim;
    return out;
  });
  check("the demo key still gives the shooting version", !classic.director && classic.aims, JSON.stringify(classic));

  return { failures, notes };
}
