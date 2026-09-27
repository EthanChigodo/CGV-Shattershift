/**
 * Elevator check harness.
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node tests/elevators/run.js
 *
 * Add --shots to also regenerate the screenshots in docs/images/elevators/.
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
import * as checks from "./checks/gravity-lift.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

/** Documentation shots: [file name, seconds into the ride, pointer]. */
const SHOTS = [
  ["gravity-lift-doors", 1.0, [0, 0]],
  ["gravity-lift-exterior", 4.2, [0, 0]],
  ["gravity-lift-interior", 7.2, [-0.35, -0.2]],
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
  for (const check of Object.values(checks)) {
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
