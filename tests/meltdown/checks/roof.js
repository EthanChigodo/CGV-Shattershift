/**
 * Phase B (the roof), simulated without the host: the AI, the ledges, and
 * both endings.
 *
 *  - Waves: both spawn (a scientist and two patients each).
 *  - Ledges: a player who sidesteps every charge near the east ledge sends
 *    patients over it (the "lure them off the edge" rule works at all).
 *  - Endings: clearing the roof early brings the helicopter in and ends in
 *    "victory"; the hidden timer running out with enemies alive ends in
 *    "survive". Both cutscenes run to completion.
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
      if (roof.state.wave !== 2) failures.push(`only ${roof.state.wave} wave(s) spawned in 30 s`);
      if (roof.enemies.length !== 6) failures.push(`expected 6 enemies, got ${roof.enemies.length}`);
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

    // 3. Victory: clear everything, the helicopter comes in early.
    {
      const roof = new RoofLevel({ heliSeconds: 44 });
      const { t } = simulate(roof, 60, (r) => {
        for (const e of r.enemies) if (e.alive && e.state !== "emerge") r.breakTarget(e.hurt, 9);
      });
      notes.victoryAt = Math.round(t);
      if (roof.state.ending !== "victory") failures.push(`clearing the roof ended in "${roof.state.ending}", not victory`);
      if (!roof.cutscene?.done) failures.push("the victory cutscene never finished");
      if (t > 40) failures.push(`the helicopter took ${Math.round(t)} s to come for a cleared roof`);
      roof.dispose();
    }

    // 4. Survive: the timer runs out with enemies alive.
    {
      const roof = new RoofLevel({ heliSeconds: 12 });
      simulate(roof, 30);
      if (roof.state.ending !== "survive") failures.push(`timer expiry ended in "${roof.state.ending}", not survive`);
      if (!roof.cutscene?.done) failures.push("the survive cutscene never finished");
      if (roof.state.wave > 1 && roof.state.time < 19) failures.push("a wave spawned during the ending");
      roof.dispose();
    }

    // 5. The hidden timer really is random, within 25-45 s.
    const times = [1, 2, 3, 4, 5, 6].map((seed) => {
      const r = new RoofLevel({ seed: seed * 7919 });
      const at = r.state.heliAt;
      r.dispose();
      return at;
    });
    notes.heliTimes = times.map((x) => Math.round(x));
    if (times.some((x) => x < 25 || x > 45)) failures.push("helicopter timer outside 25-45 s");
    if (new Set(times.map((x) => Math.round(x))).size < 3) failures.push("helicopter timer is not varying between attempts");

    return { failures, notes };
  });
}
