/**
 * Phase B (the roof), simulated without the host: the AI, the ledges, and
 * both endings.
 *
 *  - Waves: both spawn (a scientist and two patients each).
 *  - Ledges: a player who sidesteps every charge near the east ledge sends
 *    patients over it (the "lure them off the edge" rule works at all).
 *  - Endings: clearing the roof early brings the helicopter in and ends in
 *    the ladder off the ledge (one ending, however many are left). The hidden timer running out with
 *    enemies alive brings it to the east ledge: jumping for the ladder from
 *    the edge ends in "survive"; not jumping in time ends "left" behind.
 *    Every cutscene runs to completion.
 *  - Chaos: explosions and tremors happen and ramp up - and no fire (the
 *    team's call).
 *  - The open ledges: there is no roof under you past one (you fall); the
 *    parapets hold you.
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

    // 3. Clear everything (all three waves): the helicopter comes in early -
    // and still can't land: the same ending as ever, the ladder off the ledge.
    {
      const roof = new RoofLevel({ heliSeconds: 57 });
      const { t } = simulate(roof, 80, (r) => {
        for (const e of r.enemies) if (e.alive && e.state !== "emerge") r.breakTarget(e.hurt, 9);
      });
      notes.clearedAt = Math.round(t);
      notes.wavesToClear = roof.state.wave;
      if (!roof.state.cleared) failures.push("the roof was never cleared");
      if (!["extraction", "left"].includes(roof.state.ending)) failures.push(`clearing the roof ended in "${roof.state.ending}", not the ladder`);
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
      if (counts["roof-fire"] > 0 || notes.fireHits > 0) failures.push("there is still fire on the roof");
      let flames = 0;
      roof.root.traverse((o) => { if (o.name === "Fire") flames += 1; });
      if (flames) failures.push(`${flames} fire(s) still built on the roof`);
      if (counts.tremor < 2) failures.push(`only ${counts.tremor} tremors in 55 s`);
      if (roof.state.chaos < 0.9) failures.push("chaos never ramped up");
      roof.dispose();
    }

    // 4d. Open ledges east and west (you fall past one); parapets north and south.
    {
      const roof = new RoofLevel({ heliSeconds: 58 });
      const onRoof = roof.groundAt(new THREE.Vector3(0, 0, 0));
      const pastEast = roof.groundAt(new THREE.Vector3(17, 0, 0));
      const pastWest = roof.groundAt(new THREE.Vector3(-17, 0, 0));
      // (Clear of the lift housing, which stands against the south parapet.)
      const p = new THREE.Vector3(8, 0, 40);
      roof.clampPlayer(p);
      notes.ledges = { onRoof, pastEast, pastWest, northClampedTo: +p.z.toFixed(2) };
      if (onRoof !== 0) failures.push("no roof under the middle of the roof");
      if (pastEast !== null || pastWest !== null) failures.push("there is roof under you past an open ledge");
      if (p.z > 16) failures.push("the parapet does not hold you");
      roof.dispose();
    }

    // 4e. The hatches are marked (rails, striping, a pulsing strip, a sign
    // each - a few instanced/merged meshes for all of them), the rails hold
    // you, the mouth still lets you in (the hole is still a hole), and the
    // patients walk out through the mouth rather than sticking in the pen.
    {
      const { HATCHES, HATCH_MOUTHS } = await import("/src/levels/meltdown/roof.js");
      const roof = new RoofLevel({ heliSeconds: 999 });
      const guard = roof.hatchGuard;
      const meshes = [];
      guard?.traverse((o) => { if (o.isMesh) meshes.push(o); });
      const instances = (name) => meshes.find((m) => m.name === name)?.count ?? 0;
      notes.hatchGuard = { meshes: meshes.length, signs: instances("HatchSigns"), boards: instances("HatchRailBoards"), fences: roof.cover.filter((b) => b.fence).length };
      if (!guard) failures.push("the hatches have no safety gear");
      else {
        if (meshes.length > 6) failures.push(`the hatch gear takes ${meshes.length} draw calls (instance/merge it)`);
        if (instances("HatchSigns") !== HATCHES.length) failures.push("not every hatch has a sign");
        if (instances("HatchRailBoards") !== HATCHES.length * 6) failures.push("not every hatch is railed on three sides");
        const led = guard.userData.led;
        guard.userData.tick(0, 0.2);
        const a = led.emissiveIntensity;
        guard.userData.tick(0, 1.05);
        if (Math.abs(led.emissiveIntensity - a) < 0.5) failures.push("the hatch strip does not pulse");
      }
      for (const [i, h] of HATCHES.entries()) {
        const mouth = HATCH_MOUTHS[i];
        // Walk at it from the back: the rail stops you outside it.
        const back = h.clone().addScaledVector(mouth, -1.6);
        roof.clampPlayer(back);
        if (roof.overHatch(back) || back.distanceTo(h) < 1.7) failures.push(`hatch ${i}: the back rail does not hold you (${back.distanceTo(h).toFixed(2)} m)`);
        // Through the mouth you can still step in.
        if (roof.groundAt(h.clone()) !== null) failures.push(`hatch ${i}: the hole is no longer a hole`);
      }
      // Patients: everyone out of their hatch and clear of its rails in 6 s.
      simulate(roof, 9, (r, p) => p.set(0, 0, 14));
      const penned = roof.enemies.filter((e) => e.kind === "patient" && e.alive && e.hatch && !e.climb
        && Math.abs(e.position.x - e.hatch.x) < 1.3 && Math.abs(e.position.z - e.hatch.z) < 1.3);
      notes.pennedPatients = penned.length;
      if (penned.length) failures.push(`${penned.length} patient(s) still inside a hatch's rails after 9 s`);
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
