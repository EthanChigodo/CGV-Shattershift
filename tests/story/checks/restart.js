/**
 * Dying in the story restarts the sector you died in, from its start and
 * with its cutscenes (index.html via __dbg.story): the Labs (the breach plays
 * again), the Skyline (the blast plays again) and the Roof - with the score
 * and what you carried in as it was when you arrived. "Restart run" on the
 * pause menu still starts the whole run over. Okoro's run plants his feet.
 */

export const name = "restart";
export const page = "game";

export async function run(page) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };

  await page.evaluate(() => {
    __dbg.manual = true;
    window.__t = {
      step(n = 1) { for (let i = 0; i < n; i += 1) __dbg.step(1, 1 / 30); },
      until(fn, max = 3000) { let i = 0; while (!fn() && i++ < max) __dbg.step(1, 1 / 30); return fn(); },
      async wait(fn, ms = 120000) {
        const t0 = performance.now();
        while (!fn() && performance.now() - t0 < ms) { __dbg.step(1, 1 / 30); await new Promise((r) => setTimeout(r, 30)); }
        return fn();
      },
      get L() { return __dbg.story.layer; },
      get m() { return __dbg.story.getMeltdown(); },
    };
  });

  // Software GL in the checks renders the Labs' arrival at ~1.5 s a frame, with
  // the roof's models loading alongside: rebuilding a stage takes minutes here.

  // ---- The Labs --------------------------------------------------------------------
  const labs = await page.evaluate(async () => {
    __dbg.story.jump("labs");
    await __t.wait(() => __t.L.sceneId === "breach", 400000);
    __t.until(() => __t.m.phase === "run", 2000);
    const cp = { ...__dbg.story.checkpoint };
    // Die in the Labs.
    __t.m.runner.vitality = 0;
    __t.m._finishRun(false, "CAUGHT BY THE FIRE");
    __t.step(2);
    const ended = __dbg.state;
    const label = document.querySelector("#restartButton").textContent;
    __dbg.restartRun();
    const again = await __t.wait(() => __t.L.sceneId === "breach", 400000);
    return { cp, ended, label, again, level: __dbg.currentLevel, score: __dbg.score };
  });
  check("a death in the Labs ends the run", labs.ended === "ended", labs.ended);
  check("...and the end screen offers Sector 02 again", labs.label === "RETRY SECTOR 02", labs.label);
  check("the restart is the Labs again, with the breach", labs.again && labs.level === 3 && labs.cp.stage === "labs", JSON.stringify(labs));
  check("...with the score you arrived with", labs.score === labs.cp.score, `${labs.score} vs ${labs.cp.score}`);

  // ---- The Skyline -------------------------------------------------------------------
  const sky = await page.evaluate(async () => {
    __dbg.story.jump("skyline");
    __t.until(() => __t.L.sceneId === "blast", 600);
    __t.until(() => __dbg.state === "playing" || __t.L.reactions.running, 200);
    // Die on the bridge.
    __dbg.endRun(false, "fell");
    const label = document.querySelector("#restartButton").textContent;
    __dbg.restartRun();
    __t.until(() => __dbg.state === "playing", 200);
    const level = __dbg.currentLevel;
    const d0 = __dbg.causewayDistance();
    const built = !!__dbg.story.skyline && !__dbg.story.skyline.done;
    __dbg.setCausewayDistance(495);
    const blastAgain = __t.until(() => __t.L.sceneId === "blast", 400);
    return { label, level, d0, built, blastAgain };
  });
  check("a death on the Skyline offers Sector 03 again", sky.label === "RETRY SECTOR 03", sky.label);
  check("the restart is the Skyline from its start, the blast set up again", sky.level === 1 && sky.d0 < 20 && sky.built && sky.blastAgain, JSON.stringify(sky));

  // ---- The Roof ------------------------------------------------------------------------
  const roof = await page.evaluate(async () => {
    __dbg.story.jump("roof");
    await __t.wait(() => __t.m.phase === "roof", 400000);
    __t.m.runner.vitality = 1;
    __t.m.runner.invulnerable = 0;
    __t.m._roofHit({ damage: 50, from: __t.m.hero.position.clone().add(new __dbg.THREE.Vector3(1, 0, 0)), knock: 1, source: "patient" });
    __t.step(3);
    const label = document.querySelector("#restartButton").textContent;
    __dbg.restartRun();
    const again = await __t.wait(() => __t.m.phase === "roofArrive" || __t.m.phase === "roof", 400000);
    return { label, again, level: __dbg.currentLevel, vitality: __t.m.runner.vitality };
  });
  check("a death on the roof offers the roof again", roof.label === "RETRY THE ROOF", roof.label);
  check("the restart is the roof, from its lift", roof.again && roof.level === 3 && roof.vitality > 50, JSON.stringify(roof));

  // ---- "Restart run" from the pause menu: the whole run ----------------------------------
  const top = await page.evaluate(() => {
    __dbg.openPause();
    document.querySelector("#restartRunButton").click();
    __t.step(3);
    return { level: __dbg.currentLevel, state: __dbg.state, stage: __dbg.story.checkpoint?.stage };
  });
  check("'Restart run' on the pause menu starts the whole run over", top.level === 2 && top.stage === "foundry", JSON.stringify(top));

  // ---- Okoro's run: planted feet, cadence from speed ---------------------------------------
  const gait = await page.evaluate(() => {
    const THREE = __dbg.THREE;
    const o = __dbg.story.okoro;
    const out = {};
    for (const v of [3, 8, 12]) {
      o.act("run");
      o.root.position.set(0, 0, -1000);
      o.root.rotation.y = 0;
      const slides = [];
      const cur = { R: null, L: null };
      let nan = false;
      for (let i = 0; i < 180; i += 1) {
        o.root.position.z -= v / 60;
        o.update(1 / 60, { speed: v });
        const g = o.gait.out;
        if (![g.hipR, g.kneeR, g.hipL, g.kneeL, g.bob].every(Number.isFinite)) nan = true;
        for (const side of ["R", "L"]) {
          const planted = side === "R" ? g.contactR : g.contactL;
          const p = o.rig.bones[`foot${side}`].getWorldPosition(new THREE.Vector3());
          if (planted) {
            if (!cur[side]) cur[side] = { min: p.clone(), max: p.clone() };
            cur[side].min.min(p);
            cur[side].max.max(p);
          } else if (cur[side]) {
            slides.push(cur[side].max.clone().sub(cur[side].min).setY(0).length());
            cur[side] = null;
          }
        }
      }
      out[v] = { slide: Math.max(...slides), contacts: slides.length, cadence: o.gait.out.cadence, nan };
    }
    return out;
  });
  notes.okoroGait = Object.fromEntries(Object.entries(gait).map(([v, g]) => [v, `${(g.slide * 100).toFixed(1)} cm, ${g.cadence.toFixed(2)} steps/s`]));
  for (const [v, g] of Object.entries(gait)) {
    check(`Okoro at ${v} m/s: planted feet slide under 3 cm`, g.contacts > 3 && g.slide < 0.03 && !g.nan, JSON.stringify(g));
  }
  check("his cadence rises with speed, 2.6-3.2 steps/s when running", gait[8].cadence >= 2.6 && gait[12].cadence <= 3.2 && gait[12].cadence > gait[8].cadence, JSON.stringify(gait));

  // ---- The player's run (the shader rig, Phase 7): the same tests ---------------------------
  const player = await page.evaluate(() => {
    const a = __dbg.story.getMeltdown().avatar;
    const out = {};
    for (const v of [3, 8, 12]) {
      a.root.position.set(0, 0, -2000);
      a.root.rotation.y = 0;
      const slides = [];
      const cur = { R: null, L: null };
      let nan = false;
      for (let i = 0; i < 180; i += 1) {
        a.root.position.z -= v / 60;
        a.update(1 / 60, { speed: v });
        const f = a.footPositions();
        const g = a.gait.out;
        if (![g.hipR, g.kneeR, g.hipL, g.kneeL, g.bob].every(Number.isFinite)) nan = true;
        for (const [side, p, planted] of [["R", f.right, f.contactR], ["L", f.left, f.contactL]]) {
          if (planted) {
            if (!cur[side]) cur[side] = { min: p.clone(), max: p.clone() };
            cur[side].min.min(p);
            cur[side].max.max(p);
          } else if (cur[side]) {
            slides.push(cur[side].max.clone().sub(cur[side].min).length());
            cur[side] = null;
          }
        }
      }
      out[v] = { slide: Math.max(...slides), contacts: slides.length, cadence: a.gait.out.cadence, nan };
    }
    return out;
  });
  notes.playerGait = Object.fromEntries(Object.entries(player).map(([v, g]) => [v, `${(g.slide * 100).toFixed(1)} cm, ${g.cadence.toFixed(2)} steps/s`]));
  for (const [v, g] of Object.entries(player)) {
    check(`the player at ${v} m/s: planted feet slide under 3 cm, no NaN`, g.contacts > 3 && g.slide < 0.03 && !g.nan, JSON.stringify(g));
  }

  // ---- High quality: shadows and ambient occlusion switch on, and off ------------------------
  const quality = await page.evaluate(() => {
    const m = __dbg.story.getMeltdown();
    m.setQuality({ shadows: true, ao: true });
    const on = { key: m.keyLight.visible && m.keyLight.castShadow, ao: m.ao.enabled, casters: 0 };
    m.avatar.root.traverse((o) => { if (o.isMesh && o.castShadow) on.casters += 1; });
    __dbg.render();
    m.setQuality({ shadows: false, ao: false });
    const off = { key: m.keyLight.visible, ao: m.ao.enabled };
    return { on, off, memory: m.textureMemory };
  });
  notes.textureMemory = quality.memory;
  check("High switches the key light's shadows and the AO on", quality.on.key && quality.on.ao && quality.on.casters > 0, JSON.stringify(quality));
  check("...and below High they are off", !quality.off.key && !quality.off.ao, JSON.stringify(quality));
  check("the texture memory of the stage is logged", quality.memory?.megabytes > 0, JSON.stringify(quality.memory));

  return { failures, notes };
}
