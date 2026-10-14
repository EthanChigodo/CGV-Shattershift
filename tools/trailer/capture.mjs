/**
 * Render the trailer's shots from the game itself.
 *
 *   FFMPEG=path/to/ffmpeg node tools/trailer/capture.mjs              every shot
 *   node tools/trailer/capture.mjs --only foundry-front,labs-fire     some of them
 *   node tools/trailer/capture.mjs --scout                            three stills per shot, to frame them
 *
 * Opens the game with `?trailer` on the machine's GPU at 1920x1080, sets
 * each shot up (shots.mjs), steps the game frame by frame and streams every
 * frame into ffmpeg: dist/trailer/clips/<name>.mp4.
 *   --deglitch   paint over frames with a block gone black, in the clips there
 * Needs playwright (as the tests do) and ffmpeg.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { serve, launch, deglitch } from "./lib.mjs";
import { SHOTS, FPS } from "./shots.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = path.join(ROOT, "dist", "trailer");

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
const scout = argv.includes("--scout");

/** In-page helpers: stepping until something is true, and the frame capture itself. */
const HELPERS = String.raw`
window.__cap = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  /** Real time (models load in real time), until cond() or the timeout. */
  async wait(cond, ms = 60000) {
    const t0 = performance.now();
    while (!cond() && performance.now() - t0 < ms) await this.sleep(100);
    return cond();
  },
  /** Simulated time, frame by frame, until cond() or the limit. */
  until(cond, seconds = 60, dt = 1 / 30) {
    for (let n = 0; n < seconds / dt && !cond(); n += 1) __dbg.step(1, dt);
    return cond();
  },
  run(seconds, dt = 1 / 30) { __dbg.step(Math.max(1, Math.round(seconds / dt)), dt); },
  /**
   * Frame by frame: step, render, read the pixels straight back from WebGL
   * (readPixels waits for the GPU) and post them raw to the server, which
   * pipes them into ffmpeg. Nothing else draws while it runs.
   */
  async capture(name, frames, dt) {
    const gl = __dbg.renderer.getContext();
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const pixels = new Uint8Array(W * H * 4);
    await fetch("/__clip/" + name + "/start?w=" + W + "&h=" + H + "&fps=" + Math.round(1 / dt), { method: "POST" });
    __dbg.trailer.holdRender = true;
    for (let i = 0; i < frames; i += 1) {
      __dbg.step(1, dt);
      __dbg.render();
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      await fetch("/__clip/" + name + "/frame", { method: "POST", body: pixels });
    }
    __dbg.trailer.holdRender = false;
    return (await fetch("/__clip/" + name + "/end", { method: "POST" })).json();
  },
  /** One still now, as a data URL (scouting). */
  still() { __dbg.render(); return __dbg.renderer.domElement.toDataURL("image/jpeg", 0.8); },
};
`;

async function main() {
  if (argv.includes("--deglitch")) {
    for (const shot of SHOTS.filter((s) => !only || only.includes(s.name))) {
      const bad = await deglitch(path.join(OUT, "clips", `${shot.name}.mp4`));
      console.log(`${shot.name}: ${bad.length ? bad.join(", ") : "clean"}`);
    }
    return;
  }
  const { chromium } = await import("playwright");
  await mkdir(path.join(OUT, "clips"), { recursive: true });
  await mkdir(path.join(OUT, "scout"), { recursive: true });
  const server = await serve(ROOT, OUT);
  const browser = await launch(chromium);
  const list = SHOTS.filter((s) => !only || only.includes(s.name));
  console.log(`${list.length} shot(s), ${scout ? "scouting" : "capturing"} at ${FPS} fps\n`);

  for (const shot of list) {
    const t0 = Date.now();
    // A fresh page per shot: every shot starts from the same clean game.
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on("pageerror", (e) => console.log(`  ! ${shot.name}: ${e.message}`));
    await page.addInitScript(({ difficulty }) => {
      localStorage.setItem("fractureRunSettings", JSON.stringify({ quality: "high", shadows: true, effects: true, resolution: 1, subtitleSize: "large" }));
      localStorage.setItem("fractureRun.serumsSeen", JSON.stringify(["prism", "thermal", "shield", "overdrive", "infinite", "restore"]));
      localStorage.setItem("fractureRun.difficulty", difficulty);
    }, { difficulty: shot.difficulty ?? "normal" });
    await page.goto(`${server.origin}/index.html?trailer`);
    await page.waitForFunction(() => globalThis.__dbg, null, { timeout: 90000 });
    await page.evaluate(HELPERS);
    // The characters' models first: a shot started before they're in shows stand-ins.
    await page.evaluate(() => Promise.race([__dbg.story.ready, new Promise((r) => setTimeout(r, 90000))]));
    await page.waitForFunction(() => !!__dbg.playerBodyTemplate, null, { timeout: 90000 }).catch(() => console.log("  ! player model not loaded"));
    // The set-up: jump to the scene, fast-forward to the moment, pick the shot.
    await page.evaluate(`(async () => { ${shot.setup} })()`);
    await page.evaluate((s) => __dbg.trailer.set({ shot: s.camera ?? "game", timeScale: s.timeScale ?? 1, clean: true, autopilot: s.autopilot ?? true, god: s.god ?? true, orbit: s.orbit ?? { radius: 5, height: 1.1 } }), shot);
    const frames = Math.round(shot.seconds * FPS);
    const dt = 1 / FPS;
    if (scout) {
      // Stills at these simulated seconds into the shot (default: start, middle, end).
      const times = shot.scoutAt ?? [0, shot.seconds / 2, shot.seconds];
      let now = 0;
      for (const [i, at] of times.entries()) {
        if (at > now) await page.evaluate(([n, d]) => __cap.run(n, d), [at - now, dt]);
        now = at;
        const url = await page.evaluate(() => __cap.still());
        if (argv.includes("--debug")) console.log("   ", at, await page.evaluate(() => JSON.stringify({ state: __dbg.state, level: __dbg.currentLevel, shot: __dbg.trailer.shot, phase: __dbg.meltdown?.phase, cam: __dbg.camera.position.toArray().map((v) => +v.toFixed(1)), runZ: +__dbg.runZ.toFixed(1), chase: __dbg.causeway?.state.chase.active, story: __dbg.story.layer.player?.active })));
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path.join(OUT, "scout", `${shot.name}-${i}.jpg`), Buffer.from(url.split(",")[1], "base64"));
      }
      console.log(`${shot.name}: scouted (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } else {
      const result = await page.evaluate(([n, f, d]) => __cap.capture(n, f, d), [shot.name, frames, dt]);
      const got = result.frames;
      // A check, not a fix: frames with a block gone black (painted over only with --deglitch).
      const glitches = await deglitch(path.join(OUT, "clips", `${shot.name}.mp4`), { fix: false });
      if (glitches.length) console.log(`  ! ${glitches.length} frame(s) look glitched: ${glitches.join(", ")}`);
      console.log(`${shot.name}: ${got}/${frames} frames -> clips/${shot.name}.mp4 (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    await page.close();
  }
  await browser.close();
  await server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
