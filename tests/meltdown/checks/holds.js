/**
 * Cryo and shock on the roof's people (roof.js freeze, shock), simulated
 * without the host:
 *
 *  - Cryo: a patient in reach is frozen - it doesn't move while it's in the
 *    ice - and a sphere into it then shatters it (in ice, not ash). One
 *    left alone thaws out and moves again.
 *  - Shock: the charge jumps from the one the burst reached to the next
 *    within reach, and on - each stunned, standing still - but not to one
 *    too far from all of them.
 *  - The charge: a charged shock jumps further than a plain one; a cryo
 *    burst takes a body at the edge of its blast, and a charged one holds
 *    it longer.
 */

export const name = "holds";

export async function run(page) {
  return page.evaluate(async () => {
    const { RoofLevel, FREEZE, SHOCK, shockAt } = await import("/src/levels/meltdown/roof.js");
    const THREE = await import("/src/three.js");
    const failures = [];
    const notes = {};
    const dt = 1 / 30;
    const player = new THREE.Vector3(0, 0, 12);
    const velocity = new THREE.Vector3();
    let time = 0;
    const step = (roof, seconds) => {
      for (let i = 0; i < seconds / dt; i += 1) {
        time += dt;
        roof.update({ dt, time, player, playerVelocity: velocity });
      }
    };
    // A roof with its first wave out and stalking.
    const roofWithPatients = () => {
      const roof = new RoofLevel({ heliSeconds: 999 });
      for (let i = 0; i < 300 && roof.enemies.filter((e) => e.kind === "patient" && e.state === "stalk").length < 2; i += 1) step(roof, dt);
      return roof;
    };

    // 1. Cryo: frozen, held, shattered; another thaws.
    {
      const roof = roofWithPatients();
      const [a, b] = roof.enemies.filter((e) => e.kind === "patient" && e.state === "stalk");
      if (!a || !b) failures.push("the first wave's patients never came out");
      else {
        let shattered = 0;
        roof.events.on("enemy-shatter", () => (shattered += 1));
        let thawed = 0;
        roof.events.on("enemy-thaw", () => (thawed += 1));
        // Far apart, so one burst reaches only one of them.
        b.position.set(a.position.x > 0 ? -10 : 10, 0, a.position.z);
        const frozen = roof.freeze(a.position.clone(), 1.5);
        const at = a.position.clone();
        step(roof, 1);
        notes.frozen = frozen;
        if (frozen !== 1 || !(a.iced > 0)) failures.push("a cryo burst on a patient didn't freeze it");
        if (a.position.distanceTo(at) > 0.01) failures.push(`a frozen patient moved ${a.position.distanceTo(at).toFixed(2)} m`);
        if (b.iced) failures.push("a patient out of the burst's reach was frozen");
        // A glass sphere's hit (power 1): a patient has 2.
        const down = a.hit(1, player);
        step(roof, 0.2);
        if (!down || !shattered) failures.push("a sphere into a frozen patient didn't shatter it");
        if (!a.removed) failures.push("a shattered patient wasn't removed");
        // The other: frozen, then left alone to thaw.
        roof.freeze(b.position.clone(), 1.5);
        step(roof, FREEZE.seconds + 0.3);
        const thawAt = b.position.clone();
        step(roof, 1.5);
        notes.thawedAndMoved = +b.position.distanceTo(thawAt).toFixed(2);
        if (!thawed || b.iced) failures.push("a frozen patient never thawed");
        if (b.position.distanceTo(thawAt) < 0.2) failures.push("a thawed patient didn't move again");
      }
      roof.dispose();
    }

    // 2. Shock: the charge jumps along a line of them, and not to one too far.
    {
      const roof = roofWithPatients();
      const people = roof.enemies.filter((e) => e.alive && e.state !== "emerge");
      if (people.length < 3) failures.push(`only ${people.length} people out for the shock check`);
      else {
        // In a row 4 m apart (each within a jump of the next), the last far off.
        people.forEach((e, i) => e.position.set(-8 + i * 4, 0, 0));
        const far = people[people.length - 1];
        far.position.set(14, 0, 12);
        let jumps = 0;
        roof.events.on("shock-jump", () => (jumps += 1));
        const reached = roof.shock(people[0].position.clone(), 1);
        step(roof, SHOCK.delay * (people.length + 1));
        const chain = people.slice(0, -1);
        const stunned = chain.filter((e) => e.shocked > 0).length;
        notes.shock = { reached, jumps, stunned, of: chain.length };
        if (reached !== 1) failures.push(`the burst reached ${reached}, not the 1 in its reach`);
        if (stunned !== chain.length) failures.push(`the charge stunned ${stunned} of ${chain.length} in a row`);
        if (far.shocked) failures.push("the charge jumped to one further than SHOCK.jump from all of them");
        const at = chain.map((e) => e.position.clone());
        step(roof, 0.5);
        const moved = chain.filter((e, i) => e.shocked > 0 && e.position.distanceTo(at[i]) > 0.05).length;
        if (moved) failures.push(`${moved} stunned one(s) moved`);
      }
      roof.dispose();
    }

    // 3. The charge: a charged shock jumps further than a plain one, and a
    // cryo burst takes anyone whose body is inside it - longer, charged.
    {
      const roof = roofWithPatients();
      const [a, b] = roof.enemies.filter((e) => e.kind === "patient" && e.alive);
      if (!a || !b) failures.push("no patients for the charge check");
      else {
        const gap = (SHOCK.jump + SHOCK.full.jump) / 2;
        a.position.set(-gap / 2, 0, 0);
        b.position.set(gap / 2, 0, 0);
        roof.shock(a.position.clone(), 0.5, 0);
        step(roof, SHOCK.delay * 2);
        const plainReached = b.shocked > 0;
        step(roof, shockAt(1).stun + 0.5);
        a.position.set(-gap / 2, 0, 0);
        b.position.set(gap / 2, 0, 0);
        roof.shock(a.position.clone(), 0.5, 1);
        step(roof, SHOCK.delay * 2);
        const chargedReached = b.shocked > 0;
        notes.charge = { gap, plainReached, chargedReached, stun: [shockAt(0).stun, shockAt(1).stun] };
        if (plainReached) failures.push(`a plain shock jumped ${gap} m (its reach is ${SHOCK.jump})`);
        if (!chargedReached) failures.push(`a fully charged shock didn't jump ${gap} m`);
        step(roof, shockAt(1).stun + 0.5);
        // The body's edge in the blast, its middle just outside.
        a.position.set(0, 0, 0);
        b.position.set(30, 0, 0);
        roof.freeze(new THREE.Vector3(4.8 + 0.3, 0, 0), 4.8, 1);
        notes.chargedIce = +a.iced.toFixed(1);
        if (!a.iced) failures.push("a patient with its body in the cryo blast (its middle just outside) wasn't frozen");
        else if (a.iced <= FREEZE.seconds + 0.1) failures.push(`a fully charged freeze lasted ${a.iced.toFixed(1)} s, no longer than a plain one`);
      }
      roof.dispose();
    }

    return { failures, notes };
  });
}
