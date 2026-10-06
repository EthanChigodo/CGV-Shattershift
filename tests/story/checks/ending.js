/**
 * Phase 6, the ending (index.html via __dbg.story): the cabin, the pilot's
 * back, the reveal on cue (facing Vale within "Hello, Seven"), the laugh, the
 * flight away, the title alone on black for at least 3 s, the credits (which
 * cover every model the game loaded), then the end screen. Skipping the
 * ending goes to the title; skipping the credits goes to the end screen. A
 * roof death never shows it.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

export const name = "ending";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };
  const dir = path.join(shots, "phase6");
  await mkdir(dir, { recursive: true });
  const shot = async (file) => {
    await page.evaluate(() => __dbg.render());
    await page.screenshot({ path: path.join(dir, `${file}.jpg`), type: "jpeg", quality: 70 });
  };

  await page.evaluate(() => {
    __dbg.manual = true;
    window.__t = {
      key(code, type = "both") {
        if (type !== "up") dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
        if (type !== "down") dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      },
      step(n = 1) { for (let i = 0; i < n; i += 1) __dbg.step(1, 1 / 30); },
      until(fn, max = 3000) { let i = 0; while (!fn() && i++ < max) __dbg.step(1, 1 / 30); return fn(); },
      async wait(fn, ms = 120000) {
        const t0 = performance.now();
        while (!fn() && performance.now() - t0 < ms) { __dbg.step(1, 1 / 30); await new Promise((r) => setTimeout(r, 30)); }
        return fn();
      },
      get L() { return __dbg.story.layer; },
      get m() { return __dbg.story.getMeltdown(); },
      get f() { return __dbg.story.getMeltdown().finale; },
      fade() { return Number(document.querySelector(".story-fade").style.opacity || 0); },
    };
  });

  await page.evaluate(() => __dbg.story.jump("ending"));
  const started = await page.evaluate(async () => {
    const ok = await __t.wait(() => __t.L.sceneId === "ending", 120000);
    return { ok, phase: __t.m.phase, vale: !!__t.f?.vale.model };
  });
  check("the story's roof victory runs the ending", started.ok && started.phase === "finale", JSON.stringify(started));

  await page.evaluate(() => __t.until(() => __t.L.player.t > 1.6, 200));
  await shot("01-the-cabin");
  const meta = await page.evaluate(() => __t.f.scene.meta);
  await page.evaluate((m) => __t.until(() => __t.L.player.t > m.tHello - 1.5, 2000), meta);
  await shot("02-the-pilot-from-behind");
  const reveal = await page.evaluate((m) => {
    // Within the line: the camera faces Vale, and he faces you.
    const THREE = __dbg.THREE;
    const hold = __t.L.player.scene.lines.find((l) => /Hello, Seven/.test(l.text)).hold;
    __t.until(() => __t.L.player.t > m.tHello + Math.min(hold - 0.3, 1.6), 600);
    const cam = __dbg.story.getMeltdown().camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const face = __t.f.vale.headPosition(new THREE.Vector3());
    const to = face.clone().sub(cam.position).normalize();
    const valeFacing = new THREE.Vector3(0, 0, -1).applyQuaternion(__t.f.vale.root.getWorldQuaternion(new THREE.Quaternion()));
    const toCam = cam.position.clone().sub(face).setY(0).normalize();
    return {
      t: __t.L.player.t, sub: document.querySelector(".story-sub .line").textContent,
      facing: +dir.dot(to).toFixed(3), valeFacing: +valeFacing.setY(0).normalize().dot(toCam).toFixed(3),
    };
  }, meta);
  check("the reveal lands within 'Hello, Seven' (camera on Vale)", /Hello, Seven/.test(reveal.sub) && reveal.facing > 0.9, JSON.stringify(reveal));
  check("...and he has turned to face you", reveal.valeFacing > 0.5, JSON.stringify(reveal));
  await shot("03-the-reveal");
  await page.evaluate((m) => __t.until(() => __t.L.player.t > m.tLaugh + 0.6, 1500), meta);
  await shot("04-the-laugh");
  await page.evaluate((m) => __t.until(() => __t.L.player.t > m.tOutside + 1.6, 800), meta);
  await shot("05-flying-away");

  // ---- The title, alone on black -----------------------------------------------
  const title = await page.evaluate(() => {
    __t.until(() => __t.L.sceneId === "title", 600);
    let on = null;
    let off = null;
    let darkThroughout = true;
    let guard = 0;
    while (__t.L.sceneId === "title" && guard++ < 400) {
      __t.step(1);
      const shown = document.querySelector(".story-layer .story-title").classList.contains("show");
      const t = __t.L.player.t;
      if (shown && on === null) on = t;
      if (!shown && on !== null && off === null) off = t;
      if (shown && __t.fade() < 0.99) darkThroughout = false;
    }
    return { on, off, darkThroughout, text: document.querySelector(".story-layer .story-title h1").textContent, next: __t.L.sceneId };
  });
  check("the title shows on black for at least 3 s", title.on !== null && (title.off ?? 99) - title.on >= 3 && title.darkThroughout, JSON.stringify(title));
  check("the title is the game's name", title.text === "FRACTURE RUN", title.text);
  await page.evaluate(() => __t.until(() => __t.L.sceneId === "credits" && __t.L.player.t > 6, 400));
  await shot("06-credits");

  // ---- The credits cover every model the game loaded ---------------------------
  const credits = await page.evaluate(async () => {
    const { loadedAssetNames } = await import("/src/levels/meltdown/assets.js");
    const { creditedAssets } = await import("/src/story/credits-roll.js");
    const loaded = loadedAssetNames();
    const credited = new Set(creditedAssets());
    const missing = loaded.filter((n) => !credited.has(n));
    const html = document.querySelector(".story-credits .roll").textContent;
    return { loaded: loaded.length, missing, models: /Hind Attack Helicopter/.test(html) && /many-bees/.test(html) };
  });
  notes.loadedModels = credits.loaded;
  check("the credits include every model the game loads", credits.missing.length === 0 && credits.models, JSON.stringify(credits));

  // ---- Credits to the end screen ------------------------------------------------
  const end = await page.evaluate(() => {
    __t.until(() => __t.L.sceneId !== "credits", 1800);
    __t.step(3);
    return { state: __dbg.state, end: document.querySelector("#endScreen").classList.contains("active"), title: document.querySelector("#endTitle").textContent };
  });
  check("after the credits: the end screen", end.state === "ended" && end.end, JSON.stringify(end));

  // ---- Skips -------------------------------------------------------------------------
  const skips = await page.evaluate(async () => {
    __dbg.story.jump("ending");
    await __t.wait(() => __t.L.sceneId === "ending", 120000);
    __t.step(40);
    __t.key("Escape", "down");
    __t.until(() => __t.L.sceneId !== "ending", 60);
    __t.key("Escape", "up");
    const afterEnding = __t.L.sceneId;
    __t.until(() => __t.L.sceneId === "credits", 300);
    __t.step(30);
    __t.key("Escape", "down");
    __t.until(() => __t.L.sceneId !== "credits", 60);
    __t.key("Escape", "up");
    __t.step(3);
    return { afterEnding, state: __dbg.state, end: document.querySelector("#endScreen").classList.contains("active") };
  });
  check("skipping the ending goes to the title", skips.afterEnding === "title", JSON.stringify(skips));
  check("skipping the credits goes to the end screen", skips.state === "ended" && skips.end, JSON.stringify(skips));

  // ---- A roof death never shows it ----------------------------------------------------
  const death = await page.evaluate(async () => {
    __dbg.story.jump("roof");
    // Read the game after the jump: it may be a new one.
    await __t.wait(() => __t.m?.phase === "roof", 240000);
    const m = __t.m;
    m.runner.vitality = 1;
    m.runner.invulnerable = 0;
    // A shield serum carried up from earlier would (rightly) absorb the hit.
    __dbg.arsenal?.reset();
    m.arsenal?.reset();
    m._roofHit({ damage: 50, from: m.hero.position.clone().add(new __dbg.THREE.Vector3(1, 0, 0)), knock: 1, source: "patient" });
    __t.step(30);
    return { phase: m.phase, finale: !!m.finale, scene: __t.L.sceneId, state: __dbg.state };
  });
  check("a roof death never shows the ending", death.phase === "over" && !death.finale && death.scene !== "ending", JSON.stringify(death));

  return { failures, notes };
}
