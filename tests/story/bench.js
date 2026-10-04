/**
 * Frame-time benchmark for the graphics pass (Phase 7): the Labs in
 * preview/meltdown.html, a fixed spot, N frames of update + render, at the
 * default (Auto-equivalent: no shadows, no AO) and at High.
 *
 *   node tests/story/bench.js [repo root to serve] [frames]
 *
 * Point it at another checkout (a git worktree of an earlier commit) to
 * compare: software GL is slow and noisy, so compare runs, not absolutes.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, launch, openPage } from "../meltdown/lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.resolve(HERE, "../.."));
const frames = Number(process.argv[3] ?? 40);

const { chromium } = await import("playwright");
const server = await serve(root);
const browser = await launch(chromium);
const { page } = await openPage(browser, { width: 960, height: 540 });
page.setDefaultTimeout(240000);
await page.goto(`${server.origin}/preview/meltdown.html`, { waitUntil: "load" });
await page.waitForFunction(() => globalThis.__meltdown?.game, null, { timeout: 240000 });
const result = await page.evaluate(async (frames) => {
  const M = globalThis.__meltdown;
  M.begin?.();
  const t0 = performance.now();
  while (!M.assetsReady && performance.now() - t0 < 180000) await new Promise((r) => setTimeout(r, 200));
  M.teleport(60, { camera: 0 });
  M.runner.invulnerable = 1e9;
  const game = M.game;
  const run = () => {
    // The same stretch of corridor every time (update moves the runner on).
    M.teleport(60, { camera: 0 });
    M.runner.invulnerable = 1e9;
    // Warm up (shader compiles), then time.
    for (let i = 0; i < 5; i += 1) { game.update(1 / 60, i / 60); game.render(); }
    M.teleport(60, { camera: 0 });
    const gl = M.renderer.getContext();
    gl.finish();
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) { game.update(1 / 60, i / 60); game.render(); }
    gl.finish();
    return +((performance.now() - start) / frames).toFixed(2);
  };
  const out = { auto: run() };
  if (game.setQuality) {
    game.setQuality({ shadows: true, ao: true });
    out.high = run();
    game.setQuality({ shadows: false, ao: false });
    out.autoAgain = run();
  }
  return out;
}, frames);
console.log(JSON.stringify({ root, frames, msPerFrame: result }));
await browser.close();
await server.close();
