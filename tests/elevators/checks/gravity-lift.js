/**
 * Checks for the Gravity Fault lift (Level 2 -> 3).
 *
 * Each check gets a fresh page with the game loaded and the menus closed,
 * and returns { failures: string[], notes: object }.
 */

/** Level 2's real exit: the Foundry's `complete` event starts the lift. */
export const handover = {
  name: "handover from Level 2",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      d.resetGame("story");
      d.demoJump(2);
      d.step(10);
      const before = { level: d.currentLevel, state: d.state, foundry: !!d.foundry };
      d.foundry.events.emit("complete", { systemsOnline: d.foundry.state.systemsOnline });
      const afterComplete = d.state;
      // The Foundry fades out, then the ride is built.
      d.step(40, 1 / 30);
      const ride = d.gravityLift;
      return {
        before,
        afterComplete,
        rideBuilt: !!ride,
        foundryFreed: d.foundry === null,
        state: d.state,
        hudShown: !!document.querySelector(".elevator-ui:not([hidden])"),
      };
    });
    const failures = [];
    if (r.before.level !== 2 || !r.before.foundry) failures.push(`not in Level 2 before the exit: ${JSON.stringify(r.before)}`);
    if (r.afterComplete !== "lift") failures.push(`complete did not start the lift (state ${r.afterComplete})`);
    if (!r.rideBuilt) failures.push("the ride was not built after the fade");
    if (!r.foundryFreed) failures.push("Level 2 was not disposed when the ride started");
    if (!r.hudShown) failures.push("the lift HUD is not showing");
    return { failures, notes: { state: r.state } };
  },
};

/** The whole ride: it climbs, shows every shot, and hands over to Level 3. */
export const ride = {
  name: "ride to Level 3",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      d.resetGame("story");
      d.demoGravityLift();
      const ride = d.gravityLift;
      const shots = [];
      ride.events.on("shot", ({ shot }) => shots.push(shot));
      let departed = false;
      ride.events.on("depart", () => { departed = true; });
      let arrived = null;
      ride.events.on("arrive", (result) => { arrived = result; });
      let maxY = 0;
      for (let i = 0; i < 60 * 12 && d.gravityLift; i += 1) {
        maxY = Math.max(maxY, ride.state.cabinY);
        d.step(1, 1 / 60);
      }
      const fadeAtEnd = Number(document.querySelector("#fadeOverlay").style.opacity);
      // Level 3 loads asynchronously; wait for it to take over.
      const t0 = performance.now();
      while (performance.now() - t0 < 60000 && !(d.currentLevel === 3 && d.state === "playing")) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return {
        shots,
        departed,
        arrived,
        maxY,
        fadeAtEnd,
        rideGone: d.gravityLift === null,
        hudGone: !document.querySelector(".elevator-ui"),
        level: d.currentLevel,
        state: d.state,
        meltdownVisible: !!d.meltdown?.visible,
      };
    });
    const failures = [];
    for (const shot of ["doors", "exterior", "interior"]) if (!r.shots.includes(shot)) failures.push(`shot "${shot}" never played`);
    if (!r.departed) failures.push("the lift never departed");
    if (r.maxY < 40) failures.push(`the cabin only climbed ${r.maxY.toFixed(1)} m`);
    if (!r.arrived) failures.push("the ride never finished");
    if (!r.rideGone) failures.push("the ride was not disposed");
    if (!r.hudGone) failures.push("the lift HUD was left in the page");
    if (r.level !== 3 || r.state !== "playing" || !r.meltdownVisible) failures.push(`Level 3 did not start (level ${r.level}, state ${r.state})`);
    return { failures, notes: { shots: r.shots, climbed: `${r.maxY.toFixed(0)} m` } };
  },
};

/** Restarting mid-ride frees it, and repeated rides do not leak GPU memory. */
export const memory = {
  name: "restart and memory",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      const counts = [];
      for (let i = 0; i < 3; i += 1) {
        d.resetGame("story");
        d.demoGravityLift();
        d.step(90, 1 / 60);
        d.render();
        d.resetGame("story");
        d.step(5);
        d.render();
        const { geometries, textures } = d.renderer.info.memory;
        counts.push({ geometries, textures });
      }
      return { counts, rideGone: d.gravityLift === null, level: d.currentLevel, state: d.state };
    });
    const failures = [];
    if (!r.rideGone) failures.push("restart left the ride running");
    if (r.level !== 1 || r.state !== "playing") failures.push(`restart did not return to Level 1 (level ${r.level}, state ${r.state})`);
    const first = r.counts[0];
    const last = r.counts[r.counts.length - 1];
    if (last.geometries > first.geometries + 2 || last.textures > first.textures + 2) failures.push(`GPU memory grows per ride: ${JSON.stringify(r.counts)}`);
    return { failures, notes: { counts: r.counts } };
  },
};
