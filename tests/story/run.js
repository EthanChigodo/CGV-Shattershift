/**
 * Story systems checks (Phase 1: reactions, cutscenes, the companion).
 *
 *   node tests/story/run.js
 *
 * Drives preview/story.html through window.__story, frame by frame. Uses the
 * Level 3 harness's server and browser setup (tests/meltdown/lib.js).
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { serve, launch, openPage } from "../meltdown/lib.js";
import * as reactions from "./checks/reactions.js";
import * as cutscene from "./checks/cutscene.js";
import * as companion from "./checks/companion.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CHECKS = [reactions, cutscene, companion];

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }
  const server = await serve(ROOT);
  const url = `${server.origin}/preview/story.html`;
  console.log(`serving ${ROOT}\nchecking ${url}\n`);
  const browser = await launch(chromium);
  const errors = [];
  let failed = 0;

  for (const check of CHECKS) {
    process.stdout.write(`${check.name} ... `);
    const tab = await openPage(browser);
    const page = tab.page;
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__story?.ready, null, { timeout: 60000 });
      await page.evaluate(() => { __story.manual = true; });
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
    errors.push(...tab.errors);
    await page.close();
    console.log();
  }

  await browser.close();
  await server.close();
  const real = errors.filter((e) => !/toNonIndexed/.test(e));
  if (real.length) {
    console.log(`page errors (${real.length}):`);
    for (const e of real.slice(0, 10)) console.log(`  ${e}`);
    failed += real.length;
  }
  console.log(failed ? `\n${failed} problem(s).` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
