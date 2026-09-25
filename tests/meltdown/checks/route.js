/**
 * Route smoke test: build the level and run it end to end.
 *
 * Steps `level.update()` along the whole route at 30 fps with a stand-in
 * player (every patient is triggered on the way past), and checks each beat,
 * hall and set-piece event fires, that nothing throws, and that the dark beat
 * is actually dark and the others are not.
 */

export const name = "route";

export async function run(page) {
  return page.evaluate(async () => {
    const { MeltdownLevel, BEATS } = await import("/src/levels/meltdown/index.js");
    const THREE = await import("/src/three.js");
    const failures = [];
    const notes = {};
    const level = new MeltdownLevel();
    const counts = {};
    for (const name of ["beat", "hall", "sign", "hazard-fall", "hazard-land", "warp-start", "warp-end", "complete", "patient-lurch"]) {
      counts[name] = 0;
      level.events.on(name, () => (counts[name] += 1));
    }
    const dark = BEATS.find((b) => b.dark);
    let darkMin = 1;
    let litMax = 0;
    try {
      const dt = 1 / 30;
      let time = 0;
      for (let d = 0; d <= level.route.totalLength; d += level.speedAt(d) * dt) {
        time += dt;
        level.update({ dt, time, distance: d });
        const k = level.state.darkness;
        if (d > dark.start + 15 && d < dark.end - 12) darkMin = Math.min(darkMin, k);
        if (d < dark.start - 8 || d > dark.end + 14) litMax = Math.max(litMax, k);
      }
    } catch (error) {
      failures.push(`update threw: ${error.message}`);
    }
    notes.length = Math.round(level.route.totalLength);
    notes.events = counts;
    notes.hazards = level.obstacles.length;
    notes.breakables = level.breakables.length;
    notes.lurchers = level._lurchers.length;
    notes.watchers = level._watchers.length;
    if (counts.beat !== BEATS.length) failures.push(`expected ${BEATS.length} beat events, got ${counts.beat}`);
    if (counts.hall !== level.halls.length) failures.push(`expected ${level.halls.length} hall events, got ${counts.hall}`);
    if (counts["warp-start"] !== 1) failures.push("warp did not fire exactly once");
    if (counts.complete !== 1) failures.push("complete did not fire exactly once");
    if (counts["patient-lurch"] !== level._lurchers.length) failures.push(`only ${counts["patient-lurch"]} of ${level._lurchers.length} patients lurched`);
    if (darkMin < 0.95) failures.push(`the dark beat is not dark (min darkness ${darkMin.toFixed(2)})`);
    if (litMax > 0.02) failures.push(`darkness leaks outside the dark beat (${litMax.toFixed(2)})`);
    level.dispose();
    void THREE;
    return { failures, notes };
  });
}
