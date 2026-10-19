/**
 * The menus' 3D stage (src/menu/), on the real game (index.html).
 *
 *   node tests/menu-stage/run.js           # the checks; screenshots in tests/menu-stage/shots/
 *   node tests/menu-stage/run.js --docs    # also the documentation shots (docs/menu-stage/),
 *                                          # from preview/menu-stage.html at 1366x768 and 1920x1080
 *
 * What is proved:
 *   - the game boots, the briefing is skipped to the menu, and the stage
 *     comes up live behind it - with no page errors;
 *   - every shot draws a lit picture (pixel statistics of the canvas), and
 *     the menu pages map to their shots (title, appearance, newgame,
 *     chapters, endless, dim) - Versus by request;
 *   - the loadout pickers re-dress Subject 07 (skin and hair at once, a new
 *     body swapped in) without errors;
 *   - starting an Endless run stops the stage (no updates, no draws) and the
 *     game draws its own picture; quitting to the menu brings the stage back.
 *
 * The game is stepped by hand (__dbg.manual / __dbg.step): software GL is
 * far too slow to run in real time. Uses the Level 3 harness's server and
 * browser (tests/meltdown/lib.js); set MELTDOWN_CHROMIUM to a Chromium
 * binary if Playwright's own is not installed.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { serve, launch, openPage } from "../meltdown/lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHOTS = path.join(HERE, "shots");
const DOCS = path.join(ROOT, "docs/menu-stage");

/** In the page: draw a frame and measure it (mean brightness, how much of it is not black). */
function measure() {
  __dbg.render();
  const src = document.querySelector("#game");
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 54;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  let lit = 0;
  let warm = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += l;
    if (l > 12) lit += 1;
    if (d[i] > 120 && d[i] > d[i + 2] * 1.6) warm += 1;
  }
  const n = d.length / 4;
  return { mean: +(sum / n).toFixed(1), lit: +(lit / n).toFixed(3), warm: +(warm / n).toFixed(3) };
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }
  await mkdir(SHOTS, { recursive: true });
  const server = await serve(ROOT);
  const browser = await launch(chromium);
  const failures = [];
  const check = (ok, message) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
    if (!ok) failures.push(message);
  };

  try {
    const { page, errors } = await openPage(browser, { width: 1366, height: 768 });
    page.setDefaultTimeout(240000);
    await page.goto(`${server.origin}/index.html`, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(() => globalThis.__dbg?.menuStage, null, { polling: 250 });

    // ---- To the menu, and the stage comes up ----
    await page.waitForFunction(() => document.querySelector("#storySkipToMenuButton") && !document.querySelector(".ld-root.show, .loading-screen.visible"), null, { polling: 500 }).catch(() => {});
    await page.evaluate(() => document.querySelector("#storySkipToMenuButton").click());
    await page.waitForFunction(() => document.querySelector("#startScreen.active"), null, { polling: 250 });
    const t0 = Date.now();
    await page.waitForFunction(() => __dbg.menuStage.live, null, { polling: 500 });
    console.log(`  · stage live ${((Date.now() - t0) / 1000).toFixed(1)} s after the menu`);
    await page.evaluate(() => { __dbg.manual = true; });
    await page.evaluate(() => __dbg.step(45));
    const live = await page.evaluate(() => ({ live: __dbg.menuStage.live, showing: __dbg.menuStage.showing, shot: __dbg.menuStage.shot, state: __dbg.state }));
    check(live.live && live.showing && live.shot === "title" && live.state === "intro", `stage up behind the main menu (${JSON.stringify(live)})`);
    check(errors.length === 0, `no page errors on the way (${errors.length})`);

    // ---- Each page of the menu, and its shot ----
    const pages = [
      ["startScreen", "title"],
      ["appearanceScreen", "appearance"],
      ["newGameScreen", "newgame"],
      ["chaptersScreen", "chapters"],
      ["endlessScreen", "endless"],
      ["settingsScreen", "dim"],
      [null, "versus"],
      ["startScreen", "title"],
    ];
    const seen = {};
    for (const [screen, shot] of pages) {
      await page.evaluate(([id, name]) => {
        if (id) {
          // (The Appearance page is new in index.html: stand one in if it is missing.)
          let el = document.getElementById(id);
          if (!el) {
            el = document.createElement("section");
            el.id = id;
            el.className = "screen";
            document.body.appendChild(el);
            __dbg.menuStage.observer.observe(el, { attributes: true, attributeFilter: ["class"] });
          }
          for (const s of document.querySelectorAll(".screen.active")) s.classList.remove("active");
          el.classList.add("active");
        } else dispatchEvent(new CustomEvent("menu:shot", { detail: { shot: name } }));
      }, [screen, shot]);
      await page.evaluate(() => __dbg.step(90)); // 3 s: past the 2.6 s move
      const r = await page.evaluate(measure);
      const now = await page.evaluate(() => ({ shot: __dbg.menuStage.shot, rig: __dbg.menuStage.stage.rig.name, moving: __dbg.menuStage.stage.rig.t < 1 }));
      seen[shot] = r;
      check(now.shot === shot && now.rig === shot && !now.moving, `${screen ?? "menu:shot"} -> "${shot}" (${JSON.stringify(now)})`);
      // A dim page is meant to be dark; the others well lit.
      const minMean = shot === "dim" ? 6 : 12;
      check(r.mean > minMean && r.lit > (shot === "dim" ? 0.15 : 0.35), `"${shot}" draws a picture (${JSON.stringify(r)})`);
      await page.screenshot({ path: path.join(SHOTS, `${shot}.jpg`), quality: 80 });
    }
    check(seen.title.warm > 0.003, `the fire shows in the title shot (warm ${seen.title.warm})`);
    check(seen.dim.mean < seen.title.mean, `"dim" is darker than "title" (${seen.dim.mean} < ${seen.title.mean})`);

    // ---- The loadout re-dresses Subject 07 ----
    await page.evaluate(() => {
      document.querySelector('[data-skin="dark"]')?.click();
      document.querySelector('[data-hair="blonde"]')?.click();
    });
    await page.evaluate(() => __dbg.step(2));
    const look = await page.evaluate(() => {
      const u = __dbg.menuStage.stage.figure?.look?.uniforms;
      return u ? { tone: u.uToneOn.value, hair: u.uHairOn?.value } : null;
    });
    check(look && look.tone === 1 && look.hair === 1, `skin and hair change at once (${JSON.stringify(look)})`);
    const before = await page.evaluate(() => __dbg.menuStage.stage.figure?.height);
    await page.evaluate(() => document.querySelector('[data-character="playerMale"]')?.click());
    await page.waitForFunction((h) => {
      __dbg.step(3);
      const f = __dbg.menuStage.stage.figure;
      return f && Math.abs(f.height - h) > 0.02 && !__dbg.menuStage.stage.swap;
    }, before, { polling: 500, timeout: 120000 });
    const after = await page.evaluate(() => ({ height: +__dbg.menuStage.stage.figure.height.toFixed(2), spec: __dbg.menuStage.stage.figureSpec }));
    check(after.spec.character === "playerMale" && after.spec.skin === "dark" && after.spec.hair === "blonde", `a new body swaps in, still dressed as picked (${JSON.stringify(after)})`);
    await page.evaluate(() => { document.querySelector('[data-character="playerFemale"]')?.click(); __dbg.step(2); });
    const r2 = await page.evaluate(measure);
    check(r2.lit > 0.3, `still drawing after the swaps (${JSON.stringify(r2)})`);
    await page.screenshot({ path: path.join(SHOTS, "loadout.jpg"), quality: 80 });
    check(errors.length === 0, `no page errors from the loadout (${errors.join(" | ").slice(0, 300)})`);

    // ---- A run stops the stage; the menu brings it back ----
    await page.evaluate(() => {
      const s = __dbg.menuStage.stage;
      s._draws = 0;
      const draw = s.render.bind(s);
      s.render = (p) => { s._draws += 1; draw(p); };
      s._time0 = s.time;
    });
    await page.evaluate(() => __dbg.startEndless("skyline"));
    await page.evaluate(() => __dbg.step(30));
    const run = await page.evaluate((m) => {
      const s = __dbg.menuStage.stage;
      s._draws = 0;
      const r = eval(`(${m})`)();
      return { state: __dbg.state, draws: s._draws, advanced: +(s.time - s._time0).toFixed(3), pregame: document.body.classList.contains("pregame"), picture: r };
    }, measure.toString());
    check(run.state === "playing" && !run.pregame, `an Endless run starts (${run.state})`);
    check(run.draws === 0 && run.advanced === 0, `the stage stands still during the run (draws ${run.draws}, time +${run.advanced})`);
    check(run.picture.lit > 0.2, `the game draws its own picture (${JSON.stringify(run.picture)})`);
    await page.screenshot({ path: path.join(SHOTS, "run.jpg"), quality: 80 });
    await page.evaluate(() => document.querySelector("#quitButton").click());
    await page.waitForFunction(() => { __dbg.step(2); return __dbg.state === "intro" && document.querySelector("#startScreen.active"); }, null, { polling: 500, timeout: 120000 });
    await page.evaluate(() => __dbg.step(60));
    const back = await page.evaluate((m) => {
      const s = __dbg.menuStage.stage;
      s._draws = 0;
      const r = eval(`(${m})`)();
      return { showing: __dbg.menuStage.showing, draws: s._draws, shot: s.rig.name, fade: +s.fade.toFixed(2), picture: r };
    }, measure.toString());
    check(back.showing && back.draws > 0 && back.shot === "title" && back.picture.lit > 0.3, `back on the menu, the stage is back (${JSON.stringify(back)})`);
    await page.screenshot({ path: path.join(SHOTS, "back.jpg"), quality: 80 });

    // ---- Optional: every level starts from the menu and comes back (slow) ----
    if (process.argv.includes("--levels")) {
      for (const env of ["foundry", "labs", "roof", "skyline"]) {
        await page.evaluate((e) => __dbg.startEndless(e), env);
        await page.waitForFunction(() => {
          __dbg.step(2);
          return __dbg.state === "playing" && !document.querySelector(".ld-root.show");
        }, null, { polling: 1000, timeout: 240000 });
        await page.evaluate(() => __dbg.step(20));
        const shown = await page.evaluate((m) => {
          const s = __dbg.menuStage.stage;
          s._draws = 0;
          return { state: __dbg.state, picture: eval(`(${m})`)(), draws: s._draws };
        }, measure.toString());
        check(shown.state === "playing" && shown.draws === 0 && shown.picture.lit > 0.15, `Endless ${env} runs, the stage stays out of it (${JSON.stringify(shown)})`);
        await page.screenshot({ path: path.join(SHOTS, `level-${env}.jpg`), quality: 70 });
        await page.evaluate(() => document.querySelector("#quitButton").click());
        await page.waitForFunction(() => { __dbg.step(2); return __dbg.state === "intro" && document.querySelector("#startScreen.active") && __dbg.menuStage.showing; }, null, { polling: 500, timeout: 240000 });
      }
      check(true, "every level started and returned to the menu");
    }
    check(errors.length === 0, `no page errors at all (${errors.join(" | ").slice(0, 300)})`);
    await page.close();

    // ---- Documentation shots: the stage alone ----
    if (process.argv.includes("--docs")) {
      await mkdir(DOCS, { recursive: true });
      for (const [w, h] of [[1366, 768], [1920, 1080]]) {
        const tab = await openPage(browser, { width: w, height: h });
        tab.page.setDefaultTimeout(240000);
        await tab.page.goto(`${server.origin}/preview/menu-stage.html?clean&manual&quality=high`, { waitUntil: "load", timeout: 120000 });
        await tab.page.waitForFunction(() => globalThis.__stage?.ready, null, { polling: 500 });
        for (const shot of ["title", "appearance", "newgame", "chapters", "endless", "dim"]) {
          await tab.page.evaluate((s) => { __stage.shot(s); __stage.step(s === "dim" ? 8 : 5); __stage.render(); }, shot);
          await tab.page.screenshot({ path: path.join(DOCS, `${shot}-${w}.jpg`), quality: w > 1500 ? 55 : 80 });
        }
        check(tab.errors.length === 0, `docs ${w}x${h}: no page errors`);
        await tab.page.close();
      }
    }
  } catch (error) {
    failures.push(error.message);
    console.log(`ERROR ${error.message}`);
  }
  await browser.close();
  await server.close();
  console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
  process.exit(failures.length ? 1 : 0);
}

main();
