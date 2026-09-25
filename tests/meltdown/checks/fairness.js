/**
 * Fairness: every obstacle cluster has at least one way through.
 *
 * Hazards are grouped into clusters by route distance. Every falling piece is
 * forced to its landed state and every patient to standing in their lane (the
 * worst case), then each cluster is swept across 3 lanes x 3 poses (running,
 * jump apex, sliding) x 0-5 s of animation, using the level's own collide()
 * - the same test the game uses. A cluster passes if some lane and pose gets
 * a player box through its whole span at some moment. Glass that blocks
 * every otherwise-clear route is counted as "needs a shot", since the
 * launcher always has a way to break it.
 */

export const name = "fairness";

export async function run(page) {
  return page.evaluate(async () => {
    const { MeltdownLevel, LANES } = await import("/src/levels/meltdown/index.js");
    const THREE = await import("/src/three.js");
    const failures = [];
    const level = new MeltdownLevel();

    // Worst case: everything that falls has fallen, every patient is out.
    for (const e of level._fallingHazards) {
      e.group.userData.setFallen(1);
      if (e.kind === "duct") e.group.userData.blocking = true;
    }
    for (const e of level._lurchers) {
      e.group.userData.lurch();
      for (let i = 0; i < 60; i += 1) e.group.userData.tick(1 / 30, i / 30);
    }
    level.root.updateMatrixWorld(true);

    const ducts = new Set(level._pushables.map((p) => p.group.userData.hazardMesh));
    const entries = level._hazardIndex.filter((e) => !ducts.has(e.mesh)).sort((a, b) => a.distance - b.distance);
    const clusters = [];
    for (const e of entries) {
      const last = clusters[clusters.length - 1];
      if (last && e.distance - last.end < 4) {
        last.items.push(e);
        last.end = Math.max(last.end, e.distance);
      } else clusters.push({ start: e.distance, end: e.distance, items: [e] });
    }

    const POSES = [
      { name: "run", lift: 0, height: 1.9 },
      { name: "jump", lift: 1.45, height: 1.9 },
      { name: "slide", lift: 0, height: 1.0 },
    ];
    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    const tickers = level._animated;
    const tally = { lane: 0, jumpOrSlide: 0, timing: 0, shot: 0 };
    const bad = [];

    const blocked = (cluster, lane, pose, ignoreGlass) => {
      for (let d = cluster.start - 3; d <= cluster.end + 3; d += 0.3) {
        level.route.sample(d, lane, pose.lift, centre);
        centre.y += 0.18 + pose.height / 2;
        box.setFromCenterAndSize(centre, size.set(0.9, pose.height, 0.9));
        const hits = level.collide(box, d, 12).filter((m) => !(ignoreGlass && m.userData.glass));
        if (hits.length) return true;
      }
      return false;
    };

    for (const cluster of clusters) {
      let how = null;
      for (const ignoreGlass of [false, true]) {
        for (let t = 0; t <= 5 && !how; t += 0.1) {
          for (const e of tickers) {
            if (Math.abs(e.distance - cluster.start) < 20 && !e.piece.name.startsWith("Lurcher")) e.piece.userData.tick?.(0, t);
          }
          level.root.updateMatrixWorld(true);
          for (const lane of LANES) {
            for (const pose of POSES) {
              if (!blocked(cluster, lane, pose, ignoreGlass)) {
                how = ignoreGlass ? "shot" : pose.name !== "run" ? "jumpOrSlide" : t > 0 ? "timing" : "lane";
                break;
              }
            }
            if (how) break;
          }
        }
        if (how) break;
      }
      if (how) tally[how] += 1;
      else bad.push(`${Math.round(cluster.start)}-${Math.round(cluster.end)}m (${cluster.items.map((i) => i.mesh.parent?.name || i.mesh.userData.barrier || "hazard").join(", ")})`);
    }
    for (const b of bad) failures.push(`impassable cluster at ${b}`);
    const notes = { clusters: clusters.length, ...tally, impassable: bad.length };
    level.dispose();
    return { failures, notes };
  });
}
