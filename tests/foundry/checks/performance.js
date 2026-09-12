/**
 * Performance and resource checks.
 *
 * The frame rate is deliberately NOT asserted here. It depends on the machine,
 * the window size, and whether the tab is focused - a threshold would either be
 * so loose it catches nothing or so tight it fails on a laptop. What is checked
 * is the structural cost, which is machine-independent: draw calls, the fixed
 * light count, and whether unloading a level actually frees its GPU memory.
 *
 * For a real frame rate, open preview/foundry.html and press F.
 */

export const name = "performance";

const MAX_DRAW_CALLS = 420;
const MAX_LIGHTS = 14;

export async function run(page, { url }) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => globalThis.__foundry?.level, null, { timeout: 20000 });

  const failures = [];
  const notes = {};

  /* -- Draw calls along the route ---------------------------------------- */
  const cost = await page.evaluate(() => {
    const f = globalThis.__foundry;
    const THREE = f.THREE;
    const L = f.level;
    const cam = f.camera;

    const eye = new THREE.Vector3();
    const look = new THREE.Vector3();
    const player = new THREE.Vector3();
    const samples = [];

    for (let fraction = 0.04; fraction < 1; fraction += 0.08) {
      const d = L.route.totalLength * fraction;
      L.route.sample(d - 7.5, 0, 3.1, eye);
      L.route.sample(d + 12, 0, 1.6, look);
      L.route.sample(d, 0, 0, player);
      cam.position.copy(eye);
      cam.lookAt(look);
      cam.updateMatrixWorld(true);
      L.update({ dt: 1 / 60, time: 10, distance: d, playerPosition: player });
      f.renderer.render(f.scene, cam);
      samples.push({
        at: Math.round(d),
        draws: f.renderer.info.render.calls,
        tris: f.renderer.info.render.triangles,
      });
    }

    return {
      samples,
      worstDraws: Math.max(...samples.map((s) => s.draws)),
      worstTris: Math.max(...samples.map((s) => s.tris)),
      lights: L.lights.pointLights.length + L.lights.spotLights.length + 1,
      emitters: L.lights.emitterCount,
    };
  });

  notes.worstDrawCalls = cost.worstDraws;
  notes.worstTriangles = cost.worstTris;
  notes.dynamicLights = cost.lights;
  notes.lightEmitters = cost.emitters;

  if (cost.worstDraws > MAX_DRAW_CALLS) {
    failures.push(`worst-case ${cost.worstDraws} draw calls, budget is ${MAX_DRAW_CALLS}`);
  }
  if (cost.lights > MAX_LIGHTS) {
    failures.push(
      `${cost.lights} dynamic lights - the pool is meant to stay fixed, and changing the count forces a shader recompile mid-run`
    );
  }

  /* -- Unloading a level frees what it allocated ------------------------- */
  const leak = await page.evaluate(async () => {
    const f = globalThis.__foundry;
    const readings = [];
    for (let i = 0; i < 4; i += 1) {
      f.hud.dispose ? null : null;
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" }));
      await new Promise((r) => setTimeout(r, 900));
      f.renderer.render(f.scene, f.camera);
      readings.push({
        geometries: f.renderer.info.memory.geometries,
        textures: f.renderer.info.memory.textures,
      });
    }
    return readings;
  });

  notes.reloadReadings = leak;
  const first = leak[1];
  const last = leak[leak.length - 1];

  if (last.textures > first.textures) {
    failures.push(
      `textures grew from ${first.textures} to ${last.textures} across level reloads - something is not being disposed`
    );
  }
  if (last.geometries > first.geometries + 4) {
    failures.push(
      `geometries grew from ${first.geometries} to ${last.geometries} across level reloads - something is not being disposed`
    );
  }

  return { failures, notes };
}
