/**
 * The playtest bot, injected into the page as a script.
 *
 * It plays Level 1 the way a careful player would: it picks the lane with
 * the least danger in the next 26 m (solids, beams, burning fire, sculpture
 * poles), and throws at the most useful target in range - locks in order,
 * sprinkler bulbs, sphere caches, doors, then glass in its own lane - holding
 * back optional shots when spheres run low. It does not cheat: it uses the
 * same fire() and lane controls as the keyboard and mouse.
 */
window.__bot = async function (opts = {}) {
  const d = __dbg, T = d.THREE;
  const log = [];
  const events = [];
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  d.resetGame(opts.mode || "story");
  const lv = () => d.causeway;
  for (const n of ["radio","title","gate-open","gate-sealed","lift-enter","crushed","sequence-error","chase-start","chase-end","explosion","extinguish","vent","file","serum"])
    lv().events.on(n, (p) => events.push([n, Math.round(d.causewayDistance()), p && (p.text || p.name || p.type || p.index || p.count || "")]));
  let frames = 0, shotsFired = 0; const claimed = new Map();
  const ray = new T.Raycaster(); ray.layers.enableAll();
  while (frames < (opts.maxFrames || 6000)) {
    d.step(2, 1/30); frames += 2;
    if (d.state !== "playing") break;
    const L = lv(); if (!L) break;
    const dist = d.causewayDistance();
    if (opts.bot) {
      // Lane choice: avoid solids/fires within 25 m ahead.
      const danger = [0,0,0];
      for (const rec of L.live) {
        const gap = rec.entry.d - dist; if (gap < 0 || gap > 26) continue;
        const x = rec.entry.x ?? 0;
        const lane = x < -1.6 ? 0 : x > 1.6 ? 2 : 1;
        if (rec.kind === "hazard" || (rec.kind === "collapse" && rec.beam) || rec.kind === "sculpture") danger[lane] += 10 / (gap + 1);
        if (rec.kind === "sculpture") { danger[0] += 0.5; danger[2] += 0.5; }
        if (rec.kind === "fire" && rec.intensity > 0.2) { const w = (rec.entry.width||3)/2; for (let i=0;i<3;i++) if (Math.abs([-3.2,0,3.2][i]-x) < w+0.5) danger[i] += 6/(gap+1); }
      }
      const cur = [-3.2,0,3.2].indexOf([-3.2,0,3.2].reduce((a,b)=>Math.abs(b-d.playerX)<Math.abs(a-d.playerX)?b:a));
      let best = cur; for (let i=0;i<3;i++) if (danger[i] < danger[best] - 0.05) best = i;
      if (best !== cur) d.setLane(best);
      // Shoot: nearest alive target 8-40 m ahead, every ~0.25 s.
      if (frames % 8 === 0 && d.ammo > 0) {
        const cam = d.camera; let target = null, bestGap = 1e9;
        const priority = { lock: 0, sprinkler: 1, vent: 2, cache: 1, door: 1, pane: 3, blade: 3, falling: 2, serum: 2, file: 2, tank: 5 };
        for (const t of L.breakables) {
          const p = t.getWorldPosition(new T.Vector3()); const gap = cam.position.z - p.z;
          if (gap < 6 || gap > 40) continue;
          if (t.userData.kind === "lock" && t.userData.order !== L.state.finale.nextLock) continue;
          if ((claimed.get(t) ?? -1) > frames) continue;
          if (d.ammo < 6 && !["cache","lock","door","sprinkler"].includes(t.userData.kind) && !(t.userData.kind==="pane" && Math.abs(p.x - d.playerX) < 1.5)) continue;
          const score = gap + (priority[t.userData.kind] ?? 4) * 3;
          if (score < bestGap) { bestGap = score; target = p; target.__mesh = t; }
        }
        if (target) {
          const ndc = target.clone().project(cam);
          if (Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1) { d.setPointer(ndc.x, ndc.y); d.fire(); shotsFired++; claimed.set(target.__mesh, frames + 40); }
        }
      }
    }
    if (frames % 300 === 0) log.push(`f${frames} d=${dist.toFixed(0)} hp=${d.health.toFixed(0)} ammo=${d.ammo} score=${Math.floor(d.score)} live=${L.live.length} debris=${L.debris.length}`);
  }
  let lift = null;
  const statsBefore = lv()?.summary();
  if (opts.throughLift && d.state === "lift") {
    let n = 0;
    while (d.state === "lift" && n < 400) { d.step(1, 1/30); n++; }
    lift = { framesInLift: n, stateAfter: d.state, level: d.currentLevel, causewayDisposed: d.causeway === null,
      foundryVisible: d.foundry.root.visible, runZ: d.runZ, fd: d.foundryDistance(), hp: d.health, ammo: d.ammo, fog: d.scene.fog.density, far: d.camera.far };
    d.step(90, 1/30);
    lift.after3s = { state: d.state, fd: d.foundryDistance().toFixed(1), hp: d.health, fade: document.querySelector("#fadeOverlay").style.opacity };
    lift.geometries = d.renderer.info.memory.geometries; lift.textures = d.renderer.info.memory.textures;
  }
  const L = lv();
  return { lift, state: d.state, level: d.currentLevel, frames, dist: L ? d.causewayDistance() : null, hp: d.health, ammo: d.ammo, score: Math.floor(d.score), shotsFired, stats: L?.summary() ?? statsBefore, log, events: events.slice(0, 80), chase: L?.state.chase, finale: L?.state.finale, missions: d.missions.active.map(m=>[m.def.id,m.value,m.done]), endText: document.querySelector("#endText").textContent };
};
