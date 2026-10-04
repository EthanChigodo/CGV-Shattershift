/**
 * Phase B (the roof), simulated without the host: the AI, the ledges, and
 * both endings. Runs on the built-in roof (no scan heights passed).
 *
 *  - Waves: they spawn, and the patients come out of the hut's door.
 *  - Ledges: a player who sidesteps every charge near the east ledge sends
 *    patients over it (the "lure them off the edge" rule works at all).
 *  - Endings: clearing every wave brings the helicopter in early and ends in
 *    "victory". The hidden timer running out with enemies alive brings it to
 *    the east ledge: jumping for the ladder from the edge ends in "survive";
 *    not jumping in time ends "left" behind. Every cutscene runs to the end.
 *  - Chaos: explosions and tremors happen and ramp up - and no fire (the
 *    user's call: the fire is gone).
 *  - Scientists mix it up: lasers, grenades and orbs all get fired, and they
 *    reach a player who stands still.
 *  - The helicopter takes 165-190 s (the user: "way longer").
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
      const edge = roof.eastEdge;
      let doors = 0;
      roof.events.on("door-open", () => (doors += 1));
      let dodged = false;
      simulate(roof, 50, (r, p) => {
        const charging = r.enemies.some((e) => e.kind === "patient" && e.state === "charge");
        if (charging && !dodged) {
          p.set(edge - 1.5, 0, -9);
          dodged = true;
        } else if (!charging) {
          p.set(edge - 1.5, 0, -5);
          dodged = false;
        }
      });
      notes.waves = roof.state.wave;
      notes.falls = roof.state.falls;
      notes.doorOpenings = doors;
      if (roof.state.wave < 2) failures.push(`only ${roof.state.wave} wave(s) spawned in 50 s`);
      if (doors < 2) failures.push(`the hut door opened ${doors} time(s): patients aren't coming out of it`);
      if (roof.state.falls < 1) failures.push("no patient could be lured off the ledge");
      roof.dispose();
    }

    // 2. Standing still in the open gets you shot - by every kind of weapon.
    {
      const roof = new RoofLevel({ heliSeconds: 999, seed: 4242 });
      const fired = { "laser-fired": 0, "grenade-thrown": 0, "orb-fired": 0 };
      for (const n of Object.keys(fired)) roof.events.on(n, () => (fired[n] += 1));
      const { hits } = simulate(roof, 70);
      notes.weaponsFired = fired;
      notes.hitSources = [...new Set(hits.map((h) => h.source))];
      for (const [n, c] of Object.entries(fired)) if (c < 1) failures.push(`no "${n}" in 70 s`);
      if (!hits.some((h) => ["laser", "grenade", "orb"].includes(h.source))) failures.push("no scientist weapon ever reached a stationary player");
      roof.dispose();
    }

    // 3. Victory: clear every wave; the helicopter comes in early.
    {
      const roof = new RoofLevel({ heliSeconds: 185 });
      const { t } = simulate(roof, 220, (r) => {
        for (const e of r.enemies) if (e.alive && e.state !== "emerge") r.breakTarget(e.hurt, 99);
      });
      notes.victoryAt = Math.round(t);
      notes.wavesToVictory = roof.state.wave;
      if (roof.state.ending !== "victory") failures.push(`clearing the roof ended in "${roof.state.ending}", not victory`);
      if (!roof.cutscene?.done) failures.push("the victory cutscene never finished");
      if (roof.state.heliAt >= 185) failures.push("the helicopter did not come early for a cleared roof");
      roof.dispose();
    }

    // 4. Survive: the timer runs out with enemies alive; get to the ledge
    // and jump for the ladder.
    {
      const roof = new RoofLevel({ heliSeconds: 12 });
      let prompted = false;
      const b = new THREE.Vector3();
      simulate(roof, 40, (r, p) => {
        if (r.state.ending !== "extraction") return;
        r.ladderBottom(b);
        p.set(Math.min(b.x, r.eastEdge - 0.8), 0, b.z);
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

    // 4c. Chaos ramps up - explosions and tremors, no fire.
    {
      const roof = new RoofLevel({ heliSeconds: 58 });
      const counts = { explosion: 0, tremor: 0, "roof-fire": 0 };
      for (const n of Object.keys(counts)) roof.events.on(n, () => (counts[n] += 1));
      const { hits } = simulate(roof, 55, (r, p) => p.set(0, 0, 8));
      notes.chaos = counts;
      if (counts.explosion < 4) failures.push(`only ${counts.explosion} explosions in 55 s`);
      if (counts.tremor < 2) failures.push(`only ${counts.tremor} tremors in 55 s`);
      if (counts["roof-fire"] > 0 || hits.some((h) => h.source === "fire")) failures.push("there is still fire on the roof");
      if (roof.state.chaos < 0.9) failures.push("chaos never ramped up");
      roof.dispose();
    }

    // 5. The hidden timer is random, within 165-190 s.
    const times = [1, 2, 3, 4, 5, 6].map((seed) => {
      const r = new RoofLevel({ seed: seed * 7919 });
      const at = r.state.heliAt;
      r.dispose();
      return at;
    });
    notes.heliTimes = times.map((x) => Math.round(x));
    if (times.some((x) => x < 165 || x > 190)) failures.push("helicopter timer outside 165-190 s");
    if (new Set(times.map((x) => Math.round(x))).size < 3) failures.push("helicopter timer is not varying between attempts");

    return { failures, notes };
  });
}
