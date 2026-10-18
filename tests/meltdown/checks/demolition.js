/**
 * The roof's demolitions (roof-demolitions.js, src/fx/demolition.js,
 * src/fx/heli-crash.js), simulated without the host.
 *
 *  - A tower comes down in order: a charge on every floor, bottom to top,
 *    the blast, the top falling and crushing floors, then the ruin - and
 *    every slab's matrix stays finite.
 *  - Particle budgets shrink with the quality setting.
 *  - The schedule: with the helicopter at 48 s, the three towers go early,
 *    mid-fight and as it comes in; the mid blast downs a police helicopter,
 *    which goes into the target tower's facade; disposing gives the
 *    helicopter back to the police.
 *  - Nothing added is a light or casts a shadow.
 *  - In view: every tower's blast and the crash point are in the top band
 *    of the roof camera for a player in the middle of the roof.
 */

export const name = "demolition";

export async function run(page) {
  return page.evaluate(async () => {
    const THREE = await import("/src/three.js");
    const { DemolitionFX, DemolitionBuilding } = await import("/src/fx/demolition.js");
    const { RoofDemolitions } = await import("/src/levels/meltdown/roof-demolitions.js");
    const { PoliceHelicopters } = await import("/src/fx/police-helicopters.js");
    const failures = [];
    const notes = {};
    const dt = 1 / 30;

    // 1. One tower, start to finish.
    {
      const fx = new DemolitionFX({ quality: "high" });
      const b = new DemolitionBuilding({ fx, position: new THREE.Vector3(0, 0, -100), top: 10, floors: 16 });
      const log = [];
      b.onEvent = (n, info) => log.push(n === "charge" ? `charge${info.floor}` : n);
      b.detonate({ viewer: new THREE.Vector3(0, 10, 10) });
      let t = 0;
      for (; t < 20 && !b.state.down; t += dt) { b.update(dt); fx.update(dt); }
      const charges = log.filter((n) => n.startsWith("charge") && n !== "charges").map((n) => Number(n.slice(6)));
      const order = ["charges", "blast", "collapse", "down"].map((n) => log.indexOf(n));
      notes.tower = { downAfter: Number(t.toFixed(1)), crushes: log.filter((n) => n === "crush").length, charges: charges.length };
      if (charges.length !== 16 || charges.some((f, i) => f !== i)) failures.push(`charges not one per floor bottom to top: ${charges.join(",")}`);
      if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i < order[k - 1])) failures.push(`sequence out of order: ${log.filter((n) => !n.startsWith("charge")).join(",")}`);
      if (!b.state.down || t > 14) failures.push(`the tower took ${t.toFixed(1)} s to come down`);
      if (notes.tower.crushes < 5) failures.push(`only ${notes.tower.crushes} floors crushed`);
      if (b.mesh.instanceMatrix.array.some((v) => !Number.isFinite(v))) failures.push("a slab matrix went NaN");
      b.dispose();
      fx.dispose();
    }

    // 2. Budgets by quality.
    {
      const sizes = Object.fromEntries(["high", "medium", "low"].map((q) => {
        const fx = new DemolitionFX({ quality: q });
        const n = fx.dustPool.count + fx.firePool.count + fx.shardPool.count;
        fx.dispose();
        return [q, n];
      }));
      notes.particles = sizes;
      if (!(sizes.high > sizes.medium && sizes.medium > sizes.low)) failures.push(`particle budgets don't shrink with quality: ${JSON.stringify(sizes)}`);
    }

    // 3-4. The roof's schedule, the crash, and what's in the scene.
    {
      const police = new PoliceHelicopters({ count: 2, seed: 4 });
      const show = new RoofDemolitions({ police, quality: "medium" });
      const crash = [];
      const state = { time: 0, heliAt: 48, heliArrived: false, ending: null };
      const went = {};
      let impactAt = null;
      for (; state.time < 60; state.time += dt) {
        police.update(dt, state.time, { worldZ: (d) => 70 - d, distance: 0 });
        show.update(dt, state.time, state);
        for (const [key, b] of Object.entries(show.towers)) if (b.started && went[key] === undefined) went[key] = Number(state.time.toFixed(1));
        if (show.crash && !crash.includes(show.crash.phase)) crash.push(show.crash.phase);
        if (show.crash?.phase === "done" && impactAt === null) impactAt = Number(state.time.toFixed(1));
      }
      notes.schedule = { ...went, crash: crash.join(">"), impactAt };
      if (!(went.early < 15 && went.mid > went.early && went.late > went.mid && went.late < 48)) failures.push(`towers went at ${JSON.stringify(went)} (helicopter at 48 s)`);
      if (went.target !== undefined) failures.push("the crash target was demolished");
      if (crash.join(">") !== "approach>hold>spin>done") failures.push(`the helicopter crash went ${crash.join(">")}`);
      if (!(impactAt > went.mid)) failures.push(`the crash (${impactAt}) came before the mid tower's blast (${went.mid})`);
      if (!show.towers.target._fires.length) failures.push("no fire left burning in the target tower");
      let lights = 0;
      let casters = 0;
      show.root.traverse((o) => { if (o.isLight) lights += 1; if (o.castShadow) casters += 1; });
      if (lights || casters) failures.push(`${lights} lights and ${casters} shadow casters added`);
      if (!police.craft[1].released) failures.push("the crashed helicopter was never taken off its circuit");
      show.dispose();
      if (police.craft[1].released) failures.push("the helicopter wasn't given back to the police on dispose");
      police.dispose();
    }

    // 5. In the roof camera's view (game.js: _roofCam, _roofLook, BASE_FOV).
    {
      const show = new RoofDemolitions({ quality: "low" });
      const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.1, 2000);
      camera.position.set(0, 9.9, 2 + 7.3);
      camera.lookAt(0, 0.6, 2 - 3.4);
      camera.updateMatrixWorld();
      const out = [];
      for (const [key, b] of Object.entries(show.towers)) {
        if (key === "target") continue;
        const cut = Math.round(b.floors * b.spec.cut);
        const p = b.root.localToWorld(new THREE.Vector3(0, b.base + (cut + 1) * b.floorHeight, b.depth / 2)).project(camera);
        if (!(Math.abs(p.x) < 0.75 && p.y > 0.5 && p.y < 1)) out.push(`${key} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
      }
      const crash = show.crashPoint.project(camera);
      if (!(Math.abs(crash.x) < 0.75 && crash.y > 0.5 && crash.y < 1)) out.push(`the crash (${crash.x.toFixed(2)}, ${crash.y.toFixed(2)})`);
      if (out.length) failures.push(`out of the roof camera's top band: ${out.join(", ")}`);
      show.dispose();
    }

    return { failures, notes };
  });
}
