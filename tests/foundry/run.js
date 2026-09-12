/**
 * Level 2 check harness.
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node tests/foundry/run.js
 *
 * Add --shots to also regenerate the screenshots in docs/images/.
 *
 * The harness serves the repository itself on a spare port, drives the Level 2
 * preview in headless Chromium, and runs three groups of checks. It exits
 * non-zero if any fail, so it can go straight into CI later.
 *
 * Every check corresponds to a bug that actually happened - see
 * docs/test-plan-level-2.md for the log.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { serve } from "./lib/server.js";
import * as geometry from "./checks/geometry.js";
import * as balance from "./checks/balance.js";
import * as performance from "./checks/performance.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CHECKS = [geometry, balance, performance];

/**
 * Documentation screenshots, written as JPEG.
 *
 * PNG at this size is ~800KB each, and quantising it down to fit a repository
 * bands the dark gradients badly - which for a level this dark is most of the
 * image. JPEG at quality 82 is a fifth of the size with no visible banding.
 */
const SHOTS = [
  { name: "beat-a-intake", distance: 0.06 },
  { name: "beat-a-gate", distance: 0.155 },
  { name: "junction-one", distance: 0.345 },
  { name: "beat-b-walls", distance: 0.45 },
  { name: "beat-c-escape", distance: 0.715 },
];

async function main() {
  const wantShots = process.argv.includes("--shots");

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }

  const server = await serve(ROOT);
  const url = `${server.origin}/preview/foundry.html`;
  console.log(`serving ${ROOT}\nchecking ${url}\n`);

  const launch = { args: ["--no-sandbox"] };
  // Software rendering is fine for correctness checks and works on machines
  // and CI runners with no GPU.
  if (process.env.FOUNDRY_SOFTWARE_GL !== "0") {
    launch.args.push("--use-gl=swiftshader", "--enable-unsafe-swiftshader");
  }
  if (process.env.FOUNDRY_CHROMIUM) launch.executablePath = process.env.FOUNDRY_CHROMIUM;

  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) pageErrors.push(message.text());
  });

  let failed = 0;

  for (const check of CHECKS) {
    process.stdout.write(`${check.name} ... `);
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__foundry?.level, null, { timeout: 20000 });
      const { failures, notes } = await check.run(page, { url });

      if (failures.length) {
        failed += failures.length;
        console.log(`FAIL (${failures.length})`);
        for (const failure of failures) console.log(`  x ${failure}`);
      } else {
        console.log("ok");
      }
      for (const [key, value] of Object.entries(notes ?? {})) {
        console.log(`  · ${key}: ${JSON.stringify(value)}`);
      }
    } catch (error) {
      failed += 1;
      console.log("ERROR");
      console.log(`  x ${error.message}`);
    }
    console.log();
  }

  if (wantShots) {
    const dir = path.join(ROOT, "docs/images");
    await mkdir(dir, { recursive: true });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__foundry?.level, null, { timeout: 20000 });
    await page.evaluate(() => {
      const f = globalThis.__foundry;
      f.runner.spheres = 16;
      f.runner.score = 4820;
      f.runner.combo = 4;
      f.runner.comboTimer = 2;
      f.runner.integrity = 82;
      f.hud.setIntegrity(82);
    });

    for (const shot of SHOTS) {
      await page.evaluate((fraction) => {
        const f = globalThis.__foundry;
        f.runner.distance = f.level.route.totalLength * fraction;
        f.runner.invulnerable = 999;
        // Jump the camera rather than letting it ease across the level. Under
        // software rendering the page gets only a handful of frames a second,
        // so the easing never catches a teleport and the shot ends up taken
        // from outside the corridor.
        f.snapCamera();
      }, shot.distance);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: path.join(dir, `${shot.name}.jpg`), type: "jpeg", quality: 82 });
      console.log(`shot docs/images/${shot.name}.jpg`);
    }
    console.log();
  }

  if (pageErrors.length) {
    failed += pageErrors.length;
    console.log(`console errors (${pageErrors.length}):`);
    for (const error of pageErrors.slice(0, 10)) console.log(`  x ${error}`);
    console.log();
  }

  await browser.close();
  await server.close();

  console.log(failed ? `FAILED - ${failed} problem(s)` : "All checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
