/**
 * Level 3 check harness.
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node tests/meltdown/run.js            # checks
 *   node tests/meltdown/run.js --shots    # also regenerate docs/images/meltdown-*.jpg
 *
 * See lib.js for running without access to the jsDelivr CDN.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { serve, openPage } from "./lib.js";
import * as route from "./checks/route.js";
import * as fairness from "./checks/fairness.js";
import * as roof from "./checks/roof.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CHECKS = [route, fairness, roof];

/** Documentation shots: [name, route distance, camera mode]. */
const SHOTS = [
  ["meltdown-ward", 30, 0],
  ["meltdown-lab", 196, 0],
  ["meltdown-experiment", 440, 0],
  ["meltdown-blackout-entry", 575, 0],
  ["meltdown-substation", 630, 0],
  ["meltdown-archive", 780, 0],
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
  const url = `${server.origin}/preview/meltdown.html`;
  console.log(`serving ${ROOT}\nchecking ${url}\n`);
  const { browser, page, errors } = await openPage(chromium);
  let failed = 0;

  for (const check of CHECKS) {
    process.stdout.write(`${check.name} ... `);
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__meltdown?.level, null, { timeout: 60000 });
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
    const dir = path.join(ROOT, "docs/images");
    await mkdir(dir, { recursive: true });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__meltdown?.assetsReady, null, { timeout: 120000 });
    await page.evaluate(() => globalThis.__meltdown.begin());
    for (const [name, distance, camera] of SHOTS) {
      await page.evaluate(({ distance, camera }) => globalThis.__meltdown.teleport(distance, { camera }), { distance, camera });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 82 });
      console.log(`shot docs/images/${name}.jpg`);
    }
    console.log();
  }

  if (errors.length) {
    failed += errors.length;
    console.log(`console errors (${errors.length}):`);
    for (const e of errors.slice(0, 10)) console.log(`  x ${e}`);
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
