/**
 * Phase B (the roof), simulated without the host: the AI, the ledges, and
 * both endings.
 *
 *  - Waves: both spawn (a scientist and two patients each).
 *  - Ledges: a player who sidesteps every charge near the east ledge sends
 *    patients over it (the "lure them off the edge" rule works at all).
 *  - Endings: clearing the roof early brings the helicopter in and ends in
 *    "victory" (climbing the ladder). The hidden timer running out with
 *    enemies alive brings it to the east ledge: jumping for the ladder from
 *    the edge ends in "survive"; not jumping in time ends "left" behind.
 *    Every cutscene runs to completion.
 *  - Chaos: fire patches, explosions and tremors all happen, and ramp up.
 *  - Scientists' orbs can actually reach a player who stands still.
 */

export const name = "roof";

export async function run(page) {
  return page.evaluate(async () => {
    const { RoofLevel } = await import("/src/levels/meltdown/roof.js");
    const THREE = await import("/src/three.js");
    const failures = [];
    const notes = {};
    const dt = 1 / 30;

    const simulate = (roof, seconds, brain) => {
      const player = new THREE.Vector3(0, 0, 8);
      const velocity = new THREE.Vector3();
      let hits = [];
      let t = 0;
      for (let i = 0; i < seconds / dt && !roof.cutscene?.done; i += 1) {
        t += dt;
        brain?.(roof, player, t);
        hits = hits.concat(roof.update({ dt, time: t, player, playerVelocity: velocity }));
      }
      return { hits, t };
    };

    // 1. Lure: stand by the east ledge, sidestep every committed charge.
    {
      const roof = new RoofLevel({ heliSeconds: 999 });
      let dodged = false;
      simulate(roof, 30, (r, p) => {
        const charging = r.enemies.some((e) => e.kind === "patient" && e.state === "charge");
        if (charging && !dodged) {
          p.set(12, 0, -5);
          dodged = true;
        } else if (!charging && dodged) {
          p.set(14.5, 0, 0);
          dodged = false;
        } else if (!dodged) p.set(14.5, 0, 0);
      });
      notes.waves = roof.state.wave;
      notes.falls = roof.state.falls;
      if (roof.state.wave < 2) failures.push(`only ${roof.state.wave} wave(s) spawned in 30 s`);
      if (roof.state.falls < 1) failures.push("no patient could be lured off the ledge");
      roof.dispose();
    }

    // 2. Standing still in the open gets you shot.
    {
      const roof = new RoofLevel({ heliSeconds: 999 });
      const { hits } = simulate(roof, 14);
      notes.hitsStandingStill = hits.length;
      notes.hitSources = [...new Set(hits.map((h) => h.source))];
      if (!hits.some((h) => h.source === "orb")) failures.push("no scientist orb ever reached a stationary player");
      roof.dispose();
    }

    // 3. Victory: clear everything (all three waves); the helicopter comes
    // in early and the player climbs its ladder.
    {
      const roof = new RoofLevel({ heliSeconds: 57 });
      const { t } = simulate(roof, 80, (r) => {
        for (const e of r.enemies) if (e.alive && e.state !== "emerge") r.breakTarget(e.hurt, 9);
      });
      notes.victoryAt = Math.round(t);
      notes.wavesToVictory = roof.state.wave;
      if (roof.state.ending !== "victory") failures.push(`clearing the roof ended in "${roof.state.ending}", not victory`);
      if (!roof.cutscene?.done) failures.push("the victory cutscene never finished");
      if (roof.state.heliAt >= 57) failures.push("the helicopter did not come early for a cleared roof");
      roof.dispose();
    }

    // 4. Survive: the timer runs out with enemies alive; get to the ledge
    // and jump for the ladder.
    {
      const roof = new RoofLevel({ heliSeconds: 12 });
      let prompted = false;
      simulate(roof, 40, (r, p) => {
        if (r.state.ending !== "extraction") return;
        p.set(14.8, 0, -1.3);
        if (r.extractionHint(p) === "jump") {
          prompted = true;
          r.grab(p);
        }
      });
      if (!prompted) failures.push("standing at the ledge never offered the ladder jump");
      if (roof.state.ending !== "survive") failures.push(`jumping for the ladder ended in "${roof.state.ending}", not survive`);
      if (!roof.cutscene?.done) failures.push("the survive cutscene never finished");
      roof.dispose();
    }

    // 4b. Too far from the ladder: you cannot grab it from mid-roof, and if
    // you never get there the helicopter leaves without you.
    {
      const roof = new RoofLevel({ heliSeconds: 10 });
      let grabbedFromMiddle = false;
      simulate(roof, 40, (r, p) => {
        p.set(0, 0, 4);
        if (r.state.ending === "extraction" && r.grab(p)) grabbedFromMiddle = true;
      });
      if (grabbedFromMiddle) failures.push("the ladder could be grabbed from the middle of the roof");
      if (roof.state.ending !== "left") failures.push(`never reaching the ladder ended in "${roof.state.ending}", not left behind`);
      roof.dispose();
    }

    // 4c. Chaos ramps up.
    {
      const roof = new RoofLevel({ heliSeconds: 58 });
      const counts = { explosion: 0, tremor: 0, "roof-fire": 0 };
      for (const name of Object.keys(counts)) roof.events.on(name, () => (counts[name] += 1));
      const { hits } = simulate(roof, 55, (r, p) => p.set(0, 0, 8));
      notes.chaos = counts;
      notes.fireHits = hits.filter((h) => h.source === "fire").length;
      if (counts.explosion < 4) failures.push(`only ${counts.explosion} explosions in 55 s`);
      if (counts["roof-fire"] < 3) failures.push(`only ${counts["roof-fire"]} roof fires in 55 s`);
      if (counts.tremor < 2) failures.push(`only ${counts.tremor} tremors in 55 s`);
      if (roof.state.chaos < 0.9) failures.push("chaos never ramped up");
      roof.dispose();
    }

    // 5. The hidden timer really is random, within 40-58 s.
    const times = [1, 2, 3, 4, 5, 6].map((seed) => {
      const r = new RoofLevel({ seed: seed * 7919 });
      const at = r.state.heliAt;
      r.dispose();
      return at;
    });
    notes.heliTimes = times.map((x) => Math.round(x));
    if (times.some((x) => x < 40 || x > 58)) failures.push("helicopter timer outside 40-58 s");
    if (new Set(times.map((x) => Math.round(x))).size < 3) failures.push("helicopter timer is not varying between attempts");

    return { failures, notes };
  });
}
