/**
 * Level 1 check harness.
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node tests/causeway/run.js
 *
 * Add --shots to also regenerate the screenshots in docs/images/causeway/,
 * or --shots-only to skip the checks and only take the screenshots.
 * --only=pace,playthrough runs just the named checks.
 *
 * Serves the repository on a spare port, drives the real game (index.html) in
 * headless Chromium, and runs the checks below. Exits non-zero on failure.
 * Software GL is slow, so gameplay is advanced with __dbg.step(), which runs
 * the exact same update code without rendering.
 *
 * Environment variables:
 *   CAUSEWAY_CHROMIUM     path to a Chromium binary
 *   CAUSEWAY_SOFTWARE_GL  set to 0 to use the real GPU
 *   CAUSEWAY_THREE_LOCAL  path to three.module.js to serve instead of the CDN
 *                         (for offline machines) - <package>/build/three.module.js
 *                         of an unpacked three@0.160.0, whose examples/jsm/
 *                         add-ons are served too (Level 3 uses them)
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { serve } from "../foundry/lib/server.js";
import * as checks from "./checks/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const SHOTS = [
  { name: "ward", d: 8, lane: 1, pointer: [0.05, 0] },
  { name: "fire-sprinkler", d: 56, lane: 1, pointer: [-0.25, 0.1] },
  { name: "skybridge", d: 266, lane: 1, pointer: [-0.1, 0.15] },
  { name: "sculpture", d: 300, lane: 0, pointer: [0.1, 0] },
  { name: "atrium", d: 548, lane: 1, pointer: [0, 0.2] },
  { name: "gate", d: 742, lane: 1, pointer: [0, 0.3] },
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
  if (process.env.CAUSEWAY_CHROMIUM) console.log(`chromium: ${process.env.CAUSEWAY_CHROMIUM}`);
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  // Pin High quality: software GL is slow enough that Auto would drop to Low.
  await page.addInitScript(() => localStorage.setItem("fractureRunSettings", JSON.stringify({ quality: "high", narration: false })));
  if (process.env.CAUSEWAY_THREE_LOCAL) {
    const body = await readFile(process.env.CAUSEWAY_THREE_LOCAL);
    await page.route("**/three.module.js", (route) => route.fulfill({ body, contentType: "text/javascript" }));
    // Level 3's add-ons (loaders, post-processing) come from the same package:
    // CAUSEWAY_THREE_LOCAL is <package>/build/three.module.js.
    const pkg = path.resolve(path.dirname(process.env.CAUSEWAY_THREE_LOCAL), "..");
    await page.route("**/three@0.160.0/examples/jsm/**", (route) => {
      const rel = new URL(route.request().url()).pathname.replace(/^.*\/three@0\.160\.0\//, "");
      route.fulfill({ path: path.join(pkg, rel), contentType: "text/javascript" });
    });
  }
  const bot = await readFile(path.join(HERE, "checks/bot.js"), "utf8");

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) pageErrors.push(message.text());
  });

  let failed = 0;
  const shotsOnly = process.argv.includes("--shots-only");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
  const selected = Object.entries(checks).filter(([key]) => !only || only.includes(key)).map(([, check]) => check);
  for (const check of shotsOnly ? [] : selected) {
    process.stdout.write(`${check.name} ... `);
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__dbg?.causeway, null, { timeout: 30000 });
      await page.addScriptTag({ content: bot });
      await page.evaluate(() => document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active")));
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
    const dir = path.join(ROOT, "docs/images/causeway");
    await mkdir(dir, { recursive: true });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__dbg?.causeway, null, { timeout: 30000 });
    await page.evaluate(() => { document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active")); document.body.classList.add("photo-hide-hud"); });
    for (const shot of SHOTS) {
      await page.evaluate((s) => {
        const d = globalThis.__dbg;
        d.resetGame("story");
        d.setCausewayDistance(s.d);
        d.setLane(s.lane);
        d.step(20);
        d.setHealth(1e6);
        d.run.damage = 0; d.run.flash = 0;
        d.setPointer(...s.pointer);
      }, shot);
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(dir, `${shot.name}.jpg`), type: "jpeg", quality: 82 });
      console.log(`shot docs/images/causeway/${shot.name}.jpg`);
    }
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
  console.log(failed ? `FAILED - ${failed} problem(s)` : "All checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
