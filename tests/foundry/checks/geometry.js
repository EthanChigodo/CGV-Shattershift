/**
 * Geometry checks - do the obstacles physically do what they look like?
 *
 * Every failure this file guards against was a real bug, and none of them were
 * visible by looking at the level:
 *
 *  - ceiling pistons bottomed out at 2.4m over a 1.9m player and could never
 *    hit anything
 *  - floor pistons rested at 0.9m and so overlapped the player permanently
 *  - "slide under" barriers sat at 3.1-4.0m and were cleared standing up
 *  - the Beat A half-gate was never added to level.obstacles, so the host
 *    game's collision would have ignored it
 */

export const name = "geometry";

export async function run(page) {
  return page.evaluate(() => {
    const f = globalThis.__foundry;
    const THREE = f.THREE;
    const L = f.level;
    const failures = [];
    const notes = {};

    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();

    const probe = (distance, lane, { standing = true, lift = 0 } = {}) => {
      const height = standing ? 1.9 : 1.0;
      L.route.sample(distance, lane, lift, centre);
      centre.y += 0.18 + height / 2;
      box.setFromCenterAndSize(centre, size.set(0.9, height, 0.9));
      return L.collide(box, distance);
    };

    /* -- 1. Every indexed hazard is also in the host-facing obstacle list -- */
    const indexed = new Set(L._hazardIndex.map((e) => e.mesh));
    const exposed = new Set(L.obstacles);
    const missing = [...indexed].filter((m) => !exposed.has(m));
    notes.hazards = indexed.size;
    if (missing.length) {
      failures.push(`${missing.length} hazard(s) are collidable but missing from level.obstacles`);
    }

    /* -- 2. Barriers block a standing player, and one input clears each ---- */
    const barriers = [];
    L.groups.hazards.traverse((o) => {
      if (o.name && o.name.startsWith("Barrier") && o.userData.hazardMesh) barriers.push(o);
    });
    notes.barriers = barriers.length;

    for (const barrier of barriers) {
      const mesh = barrier.userData.hazardMesh;
      const distance = barrier.userData.routeDistance;
      const kind = mesh.userData.barrier;
      const lane = [-3.2, 0, 3.2].find((l) => probe(distance, l).includes(mesh));

      if (lane === undefined) {
        failures.push(`${kind} barrier at ${Math.round(distance)}m does not block a standing player`);
        continue;
      }

      const clearedByJump = !probe(distance, lane, { lift: 1.44 }).includes(mesh);
      const clearedBySlide = !probe(distance, lane, { standing: false }).includes(mesh);

      if (kind === "low" && !clearedByJump) {
        failures.push(`low barrier at ${Math.round(distance)}m cannot be jumped`);
      }
      if (kind === "low" && clearedBySlide) {
        failures.push(`low barrier at ${Math.round(distance)}m can be slid under - it should need a jump`);
      }
      if (kind === "high" && !clearedBySlide) {
        failures.push(`high barrier at ${Math.round(distance)}m cannot be slid under`);
      }
      if (kind === "high" && clearedByJump) {
        failures.push(`high barrier at ${Math.round(distance)}m can be jumped - it should need a slide`);
      }
    }

    /* -- 3. Pistons cycle between lethal and safe, rather than being walls -- */
    const pistons = [];
    L.groups.hazards.traverse((o) => {
      if (o.name === "PistonBank" && o.userData.hazardMesh) pistons.push(o);
    });
    notes.pistons = pistons.length;
    const duty = [];

    for (const piston of pistons) {
      const mesh = piston.userData.hazardMesh;
      const distance = piston.userData.routeDistance;
      let lethal = 0;
      let steps = 0;

      for (let t = 0; t < 14; t += 0.04) {
        piston.userData.tick(0, t);
        piston.updateWorldMatrix(true, true);
        steps += 1;
        if ([-3.2, 0, 3.2].some((l) => probe(distance, l).includes(mesh))) lethal += 1;
      }

      const pct = Math.round((lethal / steps) * 100);
      duty.push({ at: Math.round(distance), pct });

      if (pct === 0) {
        failures.push(`piston at ${Math.round(distance)}m never reaches the player - it is decorative`);
      } else if (pct > 70) {
        failures.push(`piston at ${Math.round(distance)}m is lethal ${pct}% of its cycle - effectively a wall`);
      }
    }
    notes.pistonDutyCycle = duty;

    /* -- 4. Only the mandatory gate blocks all three lanes at once --------- */
    const blockedEverywhere = [];
    // 1m steps, not 3m. A gate slab is 0.7m deep and the player box 0.9m, so a
    // 3m sweep steps clean over a fully closed gate and the check passes
    // without ever having looked at one.
    for (let d = 2; d < L.route.totalLength - 2; d += 1) {
      const blocked = [-3.2, 0, 3.2].every((lane) => probe(d, lane).length > 0);
      if (blocked) blockedEverywhere.push(Math.round(d));
    }
    notes.allLanesBlockedAt = blockedEverywhere;

    // Consecutive samples through one gate are expected; separate positions
    // are not. Collapse runs before judging.
    const clusters = blockedEverywhere.reduce((acc, d) => {
      if (!acc.length || d - acc[acc.length - 1][1] > 12) acc.push([d, d]);
      else acc[acc.length - 1][1] = d;
      return acc;
    }, []);
    notes.blockingClusters = clusters.map((c) => `${c[0]}-${c[1]}m`);

    // Asserted in both directions. Exactly one place should block every lane:
    // the ROUTE GATE, which is the whole point of the first switch. More than
    // one is a dead end; none means the teaching gate is not actually blocking
    // and the player can walk past the lesson.
    if (clusters.length > 1) {
      failures.push(
        `${clusters.length} places block all three lanes (${clusters.map((c) => c[0] + "m").join(", ")}) - only the mandatory ROUTE GATE should`
      );
    } else if (clusters.length === 0) {
      failures.push("nothing blocks all three lanes - the mandatory ROUTE GATE is not blocking the corridor");
    }

    return { failures, notes };
  });
}
