/**
 * Elevator check harness.
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node tests/elevators/run.js
 *
 * Add --shots to also regenerate the screenshots in docs/images/elevators/,
 * or --shots-only to skip the checks and only take them.
 *
 * Serves the repository on a spare port, drives the real game (index.html)
 * in headless Chromium and runs the checks in checks/. Exits non-zero on
 * failure. Software GL is slow, so the ride is advanced with __dbg.step(),
 * which runs the same update code without rendering.
 *
 * Environment variables (the same as the Level 1 harness):
 *   CAUSEWAY_CHROMIUM     path to a Chromium binary
 *   CAUSEWAY_SOFTWARE_GL  set to 0 to use the real GPU
 *   CAUSEWAY_THREE_LOCAL  path to three.module.js to serve instead of the CDN
 *                         (<package>/build/three.module.js of three@0.160.0;
 *                         its examples/jsm/ add-ons are served too)
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { serve } from "../foundry/lib/server.js";
import * as gravityChecks from "./checks/gravity-lift.js";
import * as figureChecks from "./checks/figure.js";
import * as quietChecks from "./checks/quiet-ride.js";

const checks = { ...gravityChecks, ...figureChecks, ...quietChecks };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

/** Documentation shots: [file name, seconds into the ride, pointer]. */
const SHOTS = [
  ["gravity-lift-doors", 1.0, [0, 0]],
  ["gravity-lift-exterior", 3.8, [0, 0]],
  ["gravity-lift-tremor", 7.0, [0, 0]],
  ["gravity-lift-freefall", 9.9, [0, 0]],
  ["gravity-lift-brakes", 10.35, [0, 0]],
  ["gravity-lift-slam", 11.0, [0, 0]],
  ["gravity-lift-launcher", 12.55, [0, 0]],
  ["gravity-lift-pickup", 14.3, [0, 0]],
  ["gravity-lift-rising", 28.0, [0, 0]],
];

/** The quiet ride (cutscene 7): [file name, seconds into it]. */
const QUIET_SHOTS = [
  ["quiet-ride-corner", 3.6],
  ["quiet-ride-low", 5.2],
  ["quiet-ride-radio", 7.0],
  ["quiet-ride-sitting", 12.0],
  ["quiet-ride-standing", 15.0],
  ["quiet-ride-doors", 19.2],
];

/** The clamps: [file name, clamps to lock first] - one shot per camera. */
const CLAMP_SHOTS = [
  ["gravity-lift-clamps-aim", 0],
  ["gravity-lift-clamps-front", 1],
  ["gravity-lift-clamps-diagnostic", 2],
];

async function main() {
  const wantShots = process.argv.includes("--shots") || process.argv.includes("--shots-only");
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }

  const server = await serve(ROOT);
  const url = `${server.origin}/index.html`;
  console.log(`serving ${ROOT}\nchecking ${url}\n`);

  const launch = { args: ["--no-sandbox"] };
  if (process.env.CAUSEWAY_SOFTWARE_GL !== "0") launch.args.push("--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
  if (process.env.CAUSEWAY_CHROMIUM) launch.executablePath = process.env.CAUSEWAY_CHROMIUM;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(() => localStorage.setItem("fractureRunSettings", JSON.stringify({ quality: "high" })));
  if (process.env.CAUSEWAY_THREE_LOCAL) {
    const body = await readFile(process.env.CAUSEWAY_THREE_LOCAL);
    await page.route("**/three.module.js", (route) => route.fulfill({ body, contentType: "text/javascript" }));
    const pkg = path.resolve(path.dirname(process.env.CAUSEWAY_THREE_LOCAL), "..");
    await page.route("**/three@0.160.0/examples/jsm/**", (route) => {
      const rel = new URL(route.request().url()).pathname.replace(/^.*\/three@0\.160\.0\//, "");
      route.fulfill({ path: path.join(pkg, rel), contentType: "text/javascript" });
    });
  }

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) pageErrors.push(message.text());
  });

  const open = async () => {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__dbg?.causeway, null, { timeout: 30000 });
    await page.evaluate(() => document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active")));
  };

  let failed = 0;
  const shotsOnly = process.argv.includes("--shots-only");
  // --only "brake clamps" runs just the checks whose name contains it.
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] ?? "" : null;
  for (const check of shotsOnly ? [] : Object.values(checks).filter((c) => only === null || c.name.includes(only))) {
    process.stdout.write(`${check.name} ... `);
    try {
      await open();
      const { failures, notes } = await check.run(page);
      if (failures.length) {
        failed += failures.length;
        console.log(`FAIL (${failures.length})`);
        for (const f of failures) console.log(`  x ${f}`);
      } else console.log("ok");
      for (const [key, value] of Object.entries(notes ?? {})) console.log(`  · ${key}: ${JSON.stringify(value)}`);
    } catch (error) {
      failed += 1;
      console.log("ERROR");
      console.log(`  x ${error.message}`);
    }
    console.log();
  }

  if (wantShots) {
    const dir = path.join(ROOT, "docs/images/elevators");
    await mkdir(dir, { recursive: true });
    for (const [name, at, pointer] of SHOTS) {
      await open();
      await page.evaluate(async ([seconds, p]) => {
        const d = globalThis.__dbg;
        const w0 = performance.now();
        while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
        d.resetGame("story");
        d.demoGravityLift();
        d.setPointer(...p);
        d.gravityLift.onPointerMove(...p);
        d.step(Math.round(seconds * 60), 1 / 60);
        d.render();
      }, [at, pointer]);
      await page.evaluate(() => globalThis.__dbg.render());
      await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 84 });
      console.log(`shot docs/images/elevators/${name}.jpg`);
    }
    for (const [name, at] of QUIET_SHOTS) {
      await open();
      await page.evaluate(async (seconds) => {
        const d = globalThis.__dbg;
        const w0 = performance.now();
        while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
        d.resetGame("story");
        d.demoQuietRide();
        d.step(Math.round(seconds * 60), 1 / 60);
        d.render();
      }, at);
      await page.evaluate(() => globalThis.__dbg.render());
      await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 84 });
      console.log(`shot docs/images/elevators/${name}.jpg`);
    }
    for (const [name, lockFirst] of CLAMP_SHOTS) {
      await open();
      await page.evaluate(async (n) => {
        const d = globalThis.__dbg;
        const w0 = performance.now();
        while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
        d.resetGame("story");
        d.demoGravityLift();
        const ride = d.gravityLift;
        for (let i = 0; i < 60 * 40 && ride.phase !== "clamps"; i += 1) d.step(1, 1 / 60);
        for (let k = 0; k < n; k += 1) ride.clamps.lock(ride.clamps.clamps[k]);
        // Aim at the next clamp, as a player would.
        const V = new d.THREE.Vector3();
        const target = ride.clamps.clamps[n];
        for (let k = 0; k < 4; k += 1) {
          const cam = ride.currentShot() === "diagnostic" ? ride.diag.camera : ride.camera;
          ride.clamps.worldPosition(target, V).project(cam);
          d.setPointer(V.x, V.y);
          ride.onPointerMove(V.x, V.y);
          d.step(15, 1 / 60);
        }
        d.render();
      }, lockFirst);
      await page.evaluate(() => globalThis.__dbg.render());
      await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 84 });
      console.log(`shot docs/images/elevators/${name}.jpg`);
    }
    // The figure's four wear stages, back and front (docs/figure-wear-shader.md).
    const figDir = path.join(ROOT, "docs/images/figure");
    await mkdir(figDir, { recursive: true });
    for (const who of ["playerFemale", "playerMale"]) {
      await open();
      await page.evaluate(async (name) => {
        const THREE = await import("/src/three.js");
        const { loadMeltdownAssets } = await import("/src/levels/meltdown/assets.js");
        const { PlayerAvatar } = await import("/src/levels/meltdown/player.js");
        const { figureStage } = await import("/src/figure/look.js");
        document.querySelectorAll("body > *").forEach((e) => { e.style.display = "none"; });
        const r = new THREE.WebGLRenderer({ antialias: true });
        r.setSize(960, 480);
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.domElement.style.cssText = "position:fixed;left:0;top:0;z-index:99";
        document.body.appendChild(r.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x3a4048);
        scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3024, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(1.5, 3, 4);
        scene.add(sun);
        const assets = await loadMeltdownAssets(new URL("./assets/meltdown/", location.href).href, { names: [name] });
        [0, 1, 2, 3].forEach((position, i) => {
          const { wear, gear } = figureStage(position);
          for (const back of [1, 0]) {
            const a = new PlayerAvatar();
            a.setWear(wear);
            a.setGear(gear);
            a.setModel(assets.get(name).template);
            a.uniforms.uHold.value = 0;
            a.root.position.set((i * 2 + (1 - back)) * 0.95 - 3.3, 0, 0);
            a.root.rotation.y = back ? 0 : Math.PI;
            scene.add(a.root);
          }
        });
        const cam = new THREE.PerspectiveCamera(26, 2, 0.1, 50);
        cam.position.set(0, 1.0, 9.8);
        cam.lookAt(0, 0.92, 0);
        r.render(scene, cam);
      }, who);
      await page.screenshot({ path: path.join(figDir, `wear-stages-${who === "playerFemale" ? "female" : "male"}.jpg`), type: "jpeg", quality: 86, clip: { x: 0, y: 60, width: 960, height: 400 } });
      console.log(`shot docs/images/figure/wear-stages-${who === "playerFemale" ? "female" : "male"}.jpg`);
    }
    // The four skin tones, both characters (docs/figure-wear-shader.md).
    await open();
    await page.evaluate(async () => {
      const THREE = await import("/src/three.js");
      const { loadMeltdownAssets } = await import("/src/levels/meltdown/assets.js");
      const { PlayerAvatar } = await import("/src/levels/meltdown/player.js");
      document.querySelectorAll("body > *").forEach((e) => { e.style.display = "none"; });
      const r = new THREE.WebGLRenderer({ antialias: true });
      r.setSize(960, 480);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.domElement.style.cssText = "position:fixed;left:0;top:0;z-index:99";
      document.body.appendChild(r.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x3a4048);
      scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3024, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(1.5, 3, 4);
      scene.add(sun);
      const assets = await loadMeltdownAssets(new URL("./assets/meltdown/", location.href).href, { names: ["playerFemale", "playerMale"] });
      ["light", "medium", "brown", "dark"].forEach((tone, i) => {
        ["playerFemale", "playerMale"].forEach((who, j) => {
          const a = new PlayerAvatar();
          a.setSkinTone(tone);
          a.setModel(assets.get(who).template);
          a.uniforms.uHold.value = 0;
          a.root.position.set((i * 2 + j) * 0.95 - 3.3, 0, 0);
          a.root.rotation.y = Math.PI;
          scene.add(a.root);
        });
      });
      const cam = new THREE.PerspectiveCamera(26, 2, 0.1, 50);
      cam.position.set(0, 1.0, 9.8);
      cam.lookAt(0, 0.92, 0);
      r.render(scene, cam);
    });
    await page.screenshot({ path: path.join(figDir, "skin-tones.jpg"), type: "jpeg", quality: 86, clip: { x: 0, y: 60, width: 960, height: 400 } });
    console.log("shot docs/images/figure/skin-tones.jpg");
    console.log();
  }

  if (pageErrors.length) {
    failed += pageErrors.length;
    console.log(`console errors (${pageErrors.length}):`);
    for (const e of pageErrors.slice(0, 10)) console.log(`  x ${e}`);
    console.log();
  }

  await browser.close();
  await server.close();
  console.log(failed ? `${failed} problem(s).` : "All checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
