/**
 * Render the trailer's title cards (cards.html) to transparent PNGs:
 * dist/trailer/cards/<id>.png, 1920x1080.
 *
 *   node tools/trailer/cards.mjs
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { serve } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = path.join(ROOT, "dist", "trailer", "cards");

const { chromium } = await import("playwright");
await mkdir(OUT, { recursive: true });
const server = await serve(ROOT, path.join(ROOT, "dist", "trailer"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${server.origin}/tools/trailer/cards.html`);
const ids = await page.evaluate(() => [...document.querySelectorAll(".card")].map((c) => c.id));
for (const id of ids) {
  await page.goto(`${server.origin}/tools/trailer/cards.html?card=${id}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${id}.png`), omitBackground: true });
  console.log(`cards/${id}.png`);
}
await browser.close();
await server.close();
