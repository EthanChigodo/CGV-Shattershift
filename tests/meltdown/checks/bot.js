/**
 * A scripted player for Level 3, Phase A, for the playthrough check.
 *
 * Plays through the real MeltdownGame (the preview page's `__meltdown.game`)
 * one fixed step at a time, with the same inputs a person has: lanes, jump,
 * slide, the trigger, and mashing at ducts. It sees what a careful player
 * sees - it tests where its body will be over the next second against the
 * level's own collide() - and aims at glass by projecting it to the screen.
 *
 * Returns a log of every hit (what, where) and why the run ended.
 *
 * Kept as source text: run.js injects it into the page with evaluate().
 */

export const BOT_SOURCE = `
(async ({ seconds = 200, dt = 1 / 30, immortal = false } = {}) => {
  const m = globalThis.__meltdown;
  const g = m.game;
  const THREE = m.THREE;
  const { LANES } = await import("/src/levels/meltdown/index.js");
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();
  const p = new THREE.Vector3();
  const log = { hits: [], vitality: [], end: null, pushes: 0, shots: 0 };
  let t = 0;
  let lastHits = 0;
  let lastCollide = [];
  const collide = g.level.collide.bind(g.level);
  const hitBox = new THREE.Box3();
  g.level.collide = (b, d) => {
    const hits = collide(b, d);
    if (b === g.playerBox) lastCollide = hits.map((m) => {
      hitBox.setFromObject(m);
      const finite = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
      let name = m.name;
      for (let o = m.parent; !name && o; o = o.parent) name = o.name;
      return { name, genuine: finite && hitBox.intersectsBox(b) };
    });
    return hits;
  };
  let plan = null;

  // Where the body is at time s into an action, and whether it collides.
  const clear = (lane, action, horizon, fromLateral) => {
    const r = g.runner;
    for (let s = 0.05; s <= horizon; s += 0.05) {
      const d = r.distance + Math.max(r.speed, 6) * s;
      const k = Math.min(1, s / 0.28);
      const lateral = fromLateral + (LANES[lane] - fromLateral) * k;
      let h = r.height;
      if (action === "jump") {
        const up = 7.6 / 19;
        h = s < up ? 7.6 * s - 9.5 * s * s : Math.max(0, 7.6 * up - 9.5 * up * up - 13.5 * (s - up) * (s - up));
      }
      const crouch = action === "slide" && s < 0.68;
      const height = crouch ? 1.0 : 1.9;
      g.level.route.sample(d, lateral, h, centre);
      centre.y += 0.18 + height / 2;
      box.setFromCenterAndSize(centre, size.set(0.9, height, 0.9));
      if (g.level.collide(box, d).length) return s;
    }
    return Infinity;
  };

  for (let i = 0; i < seconds / dt; i += 1) {
    t += dt;
    const r = g.runner;
    if (g.phase === "run" && r.alive) {
      // Mash at a duct.
      if (r.pushing || g.level.ductAhead(r.distance, 3.5)) {
        if (i % 3 === 0) { g._jump(); log.pushes += 1; }
      } else if (r.height <= 0.001 && r.sliding <= 0) {
        const straight = clear(r.lane, "run", 0.9, r.lateral);
        if (straight < 0.5 && (!plan || plan.until < t || straight < 0.25)) {
          let best = null;
          for (const lane of [r.lane, r.lane - 1, r.lane + 1].filter((l) => l >= 0 && l <= 2)) {
            if (Math.abs(lane - r.lane) > 1) continue;
            for (const action of ["run", "jump", "slide"]) {
              const s = clear(lane, action, 1.0, r.lateral);
              const score = s + (lane === r.lane ? 0.01 : 0) + (action === "run" ? 0.005 : 0);
              if (!best || score > best.score) best = { lane, action, score };
            }
          }
          if (best) {
            r.lane = best.lane;
            if (best.action === "jump") r.jumpBuffer = 0.16;
            if (best.action === "slide") r.slideBuffer = 0.16;
            plan = { until: t + 0.25 };
          }
        }
      }
      // Shoot glass, sacks, vials and patients ahead: aim by projecting them.
      let target = null;
      for (const b of g.level.breakables) {
        const d = (b.userData.routeDistance ?? 0) - r.distance;
        if (!b.visible || d < 6 || d > 34) continue;
        if (!target || d < target.d) target = { b, d };
      }
      r.firing = Boolean(target) && (r.lockout ?? 0) <= 0;
      if (target) {
        target.b.getWorldPosition(p).project(g.camera);
        g.pointer.set(p.x, p.y);
      } else g.pointer.set(0, -0.1);
    } else r.firing = false;

    g.update(dt, 100 + t);
    if (immortal) g.runner.vitality = Math.max(g.runner.vitality, 60);

    if (r.hits > lastHits) {
      lastHits = r.hits;
      log.hits.push({ t: +t.toFixed(1), d: +r.distance.toFixed(1), lane: r.lane, height: +r.height.toFixed(2), sliding: r.sliding > 0, what: lastCollide.map((h) => h.name).join("+"), genuine: lastCollide.length > 0 && lastCollide.every((h) => h.genuine) });
    }
    if (i % 60 === 0) log.vitality.push([+t.toFixed(0), Math.round(r.distance), +r.vitality.toFixed(1), +g.level.state.timeRemaining.toFixed(0)]);
    if (g.phase === "over") { log.end = { phase: g.phase, t: +t.toFixed(1), d: +r.distance.toFixed(1), vitality: r.vitality, timer: g.level.state.timeRemaining }; break; }
    if (g.phase === "depart" || g.phase === "fade" || g.roof) { log.end = { phase: g.phase, t: +t.toFixed(1), d: +r.distance.toFixed(1), vitality: +r.vitality.toFixed(1), timer: +g.level.state.timeRemaining.toFixed(1), shots: r.shots, breaks: r.breaks }; break; }
  }
  return log;
})
`;
