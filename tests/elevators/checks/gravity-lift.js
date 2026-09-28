/**
 * Checks for the Gravity Fault lift (Level 2 -> 3).
 *
 * Each check gets a fresh page with the game loaded and the menus closed,
 * and returns { failures: string[], notes: object }.
 */

/**
 * Level 2's real exit: the Foundry's `complete` event sends the player across
 * the landing into the Calibration Lift, which fades into the Gravity Fault
 * ride once it is climbing.
 */
export const handover = {
  name: "handover from Level 2",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      d.resetGame("story");
      d.demoJump(2);
      d.step(10);
      const before = { level: d.currentLevel, state: d.state, foundry: !!d.foundry };
      // Stand just short of the end of the Foundry, where the extraction valve is.
      d.setRunZ(-1200 - d.foundry.route.totalLength + 6); // FOUNDRY_ORIGIN_Z in main.js
      d.step(2);
      d.foundry.events.emit("complete", { systemsOnline: d.foundry.state.systemsOnline });
      const states = new Set();
      let steps = 0;
      // Run to the lift, board it, ride until the hand-off (at most 30 s).
      while (!d.gravityLift && steps < 30 * 30) {
        d.step(1, 1 / 30);
        states.add(d.state);
        steps += 1;
      }
      const ride = d.gravityLift;
      const firstShot = ride ? ride.currentShot() : null;
      return {
        before,
        states: [...states],
        seconds: steps / 30,
        rideBuilt: !!ride,
        boarded: !!ride?.boarded,
        firstShot,
        foundryFreed: d.foundry === null,
        hudShown: !!document.querySelector(".elevator-ui:not([hidden])"),
      };
    });
    const failures = [];
    if (r.before.level !== 2 || !r.before.foundry) failures.push(`not in Level 2 before the exit: ${JSON.stringify(r.before)}`);
    if (!r.states.includes("lift")) failures.push(`the player never boarded the Calibration Lift (states ${r.states})`);
    if (!r.rideBuilt) failures.push(`the Gravity Fault ride did not start within ${r.seconds.toFixed(0)} s`);
    if (!r.boarded) failures.push("the ride replayed its own boarding after the Calibration Lift");
    if (r.firstShot !== "exterior") failures.push(`the ride opened on "${r.firstShot}", not the exterior shot`);
    if (!r.foundryFreed) failures.push("Level 2 was not disposed when the ride started");
    if (!r.hudShown) failures.push("the lift HUD is not showing");
    return { failures, notes: { toRide: `${r.seconds.toFixed(1)} s`, states: r.states } };
  },
};

/** The whole ride: it climbs, shows every shot, and hands over to Level 3. */
export const ride = {
  name: "ride to Level 3",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      // The chosen character loads in the background; the ride should show it.
      const w0 = performance.now();
      while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      d.resetGame("story");
      d.demoGravityLift();
      const ride = d.gravityLift;
      const character = !!ride._avatar?.model;
      const shots = [];
      ride.events.on("shot", ({ shot }) => shots.push(shot));
      let departed = false;
      ride.events.on("depart", () => { departed = true; });
      let arrived = null;
      ride.events.on("arrive", (result) => { arrived = result; });
      let maxY = 0;
      for (let i = 0; i < 60 * 60 && d.gravityLift; i += 1) {
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
        character,
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
    for (const shot of ["doors", "exterior", "interior", "close", "falling", "rising"]) if (!r.shots.includes(shot)) failures.push(`shot "${shot}" never played`);
    if (!r.character) failures.push("the ride does not show the character picked on the start screen");
    if (!r.departed) failures.push("the lift never departed");
    if (r.maxY < 40) failures.push(`the cabin only climbed ${r.maxY.toFixed(1)} m`);
    if (!r.arrived) failures.push("the ride never finished");
    if (!r.rideGone) failures.push("the ride was not disposed");
    if (!r.hudGone) failures.push("the lift HUD was left in the page");
    if (r.level !== 3 || r.state !== "playing" || !r.meltdownVisible) failures.push(`Level 3 did not start (level ${r.level}, state ${r.state})`);
    return { failures, notes: { shots: r.shots, climbed: `${r.maxY.toFixed(0)} m` } };
  },
};

/**
 * The disaster: tremors stall the lift, the cable snaps into a real free
 * fall (weightless inside), and the brakes stop it hard before it climbs on.
 */
export const cableSnap = {
  name: "cable snap and brakes",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      // The pickup needs the real character (the stand-in figure leaves the
      // launcher on the floor), which loads in the background.
      const w0 = performance.now();
      while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      d.resetGame("story");
      d.demoGravityLift();
      const ride = d.gravityLift;
      const events = [];
      for (const name of ["tremor", "flicker", "glass-crack", "glass-break", "cable-snap", "brake", "brake-slam", "launcher-thud", "launcher-land", "pickup", "resume"]) ride.events.on(name, (p) => events.push([name, p]));
      let launcherLanded = false;
      let held = null;
      let floating = 0;
      let restingAfter = null;
      let panesGone = [];
      const phases = [];
      let minG = Infinity;
      let maxG = -Infinity;
      let blackout = false;
      let sparks = 0;
      let snapY = null;
      let lowest = Infinity;
      for (let i = 0; i < 60 * 60 && d.gravityLift; i += 1) {
        d.step(1, 1 / 60);
        if (!d.gravityLift) break;
        const phase = ride.phase;
        if (phases[phases.length - 1] !== phase) phases.push(phase);
        if (phase === "freefall") {
          if (snapY === null) snapY = ride.state.cabinY;
          if (ride.state.pt > 0.1) minG = Math.min(minG, ride.state.gEff);
          if (ride.state.lights.main === 0 && ride.state.lights.red === 1) blackout = true;
          // Loose things off the floor (rest heights are all under 0.25 m).
          floating = Math.max(floating, ride.debris.items.filter((it) => it.object.position.y > it.rest + 0.3).length);
        }
        if (phase === "launcher" && ride.launcher.landed && ride.launcher.root.position.y < 0.2) launcherLanded = true;
        if (phase === "resume" && restingAfter === null) {
          restingAfter = ride.debris.items.filter((it) => it.object.position.y < it.rest + 0.05).length;
          panesGone = Object.entries(ride.glass.panes).filter(([, p]) => p.state === "gone").map(([n]) => n);
          held = { state: ride.launcher.state, on: ride.launcher.root.parent?.name ?? null, holding: ride.performer?.holding ?? null };
        }
        if (phase === "brake") maxG = Math.max(maxG, ride.state.gEff);
        lowest = Math.min(lowest, ride.state.cabinY);
        sparks = Math.max(sparks, ride.sparks.heat.filter((h) => h > 0).length);
      }
      const slam = events.find(([name]) => name === "brake-slam")?.[1];
      return { phases, events: events.map(([name]) => name), minG, maxG, blackout, sparks, dropped: slam?.dropped ?? 0, minVelocity: ride.state.minVelocity, floating, restingAfter, items: ride.debris.items.length, panesGone, launcherLanded, launcherState: held?.state, launcherOn: held?.on, holding: held?.holding };
    });
    const failures = [];
    const order = ["board", "climb", "tremor", "freefall", "brake", "launcher", "clamps", "resume"];
    if (r.phases.join() !== order.join()) failures.push(`phases ran ${r.phases.join(" > ")}`);
    for (const name of ["tremor", "flicker", "glass-crack", "glass-break", "cable-snap", "brake", "brake-slam", "launcher-thud", "launcher-land", "pickup", "resume"]) if (!r.events.includes(name)) failures.push(`no "${name}" event`);
    if (!r.launcherLanded) failures.push("the launcher never landed on the cabin floor");
    if (r.launcherState !== "held" || r.launcherOn !== "LauncherMount") failures.push(`the launcher is not in the hands (state ${r.launcherState}, on ${r.launcherOn})`);
    if (r.holding !== true) failures.push("Subject 07 is not holding the launcher at the end");
    if (r.floating < 3) failures.push(`only ${r.floating} loose objects floated in free fall`);
    if (r.restingAfter !== r.items) failures.push(`${r.items - r.restingAfter} loose objects still in the air after the brakes`);
    if (r.panesGone.join() !== "left,right,roof") failures.push(`panes gone: ${r.panesGone.join(", ") || "none"} (want left, right, roof)`);
    if (Math.abs(r.minG) > 0.5) failures.push(`not weightless in free fall (felt gravity ${r.minG.toFixed(2)})`);
    if (r.maxG < 30) failures.push(`the brakes did not slam (peak ${r.maxG.toFixed(1)} m/s²)`);
    if (r.dropped < 15 || r.dropped > 30) failures.push(`fell ${r.dropped.toFixed(1)} m (want about 20)`);
    if (!r.blackout) failures.push("the lights did not black out with the emergency light on");
    if (r.sparks < 50) failures.push(`only ${r.sparks} sparks at once`);
    return { failures, notes: { dropped: `${r.dropped.toFixed(1)} m`, fastest: `${(-r.minVelocity).toFixed(1)} m/s`, brakeG: `${(r.maxG / 9.8).toFixed(1)} g`, sparks: r.sparks, floated: r.floating } };
  },
};

/**
 * The clamps, played: aim at each one on screen and fire. Each lock changes
 * the camera (first person, outside, top-down diagnostic); all three earns
 * the bonus. Left alone, they force-lock with no bonus and the ride still
 * finishes - it can never trap the player.
 */
export const clamps = {
  name: "brake clamps",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      const w0 = performance.now();
      while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      const toClamps = () => {
        d.resetGame("story");
        d.demoGravityLift();
        const ride = d.gravityLift;
        for (let i = 0; i < 60 * 40 && ride.phase !== "clamps"; i += 1) d.step(1, 1 / 60);
        return ride;
      };

      // Played: aim at each clamp and fire.
      let ride = toClamps();
      const shots = [];
      const events = [];
      for (const name of ["clamp-shot", "clamp-lock", "clamps-locked", "clamps-forced"]) ride.events.on(name, (p) => events.push(name));
      const V = new d.THREE.Vector3();
      for (let n = 0; n < 3; n += 1) {
        const target = ride.clamps.clamps.find((c) => !c.locked);
        shots.push(ride.currentShot());
        for (let k = 0; k < 4; k += 1) {
          const cam = ride.currentShot() === "diagnostic" ? ride.diag.camera : ride.camera;
          ride.clamps.worldPosition(target, V).project(cam);
          const x = Math.max(-1, Math.min(1, V.x));
          const y = Math.max(-1, Math.min(1, V.y));
          d.setPointer(x, y);
          ride.onPointerMove(x, y);
          d.step(20, 1 / 60);
        }
        const fired = ride.fire();
        d.step(30, 1 / 60);
        if (!fired || !target.locked) return { error: `clamp ${n} (${ride.currentShot()}) did not lock: fired ${fired}` };
      }
      const played = { shots, events, stabilised: ride.result.stabilised, bonus: ride.result.bonus };
      for (let i = 0; i < 60 * 20 && d.gravityLift; i += 1) d.step(1, 1 / 60);
      played.finished = !d.gravityLift;

      // Left alone.
      ride = toClamps();
      const idleEvents = [];
      ride.events.on("clamps-forced", () => idleEvents.push("clamps-forced"));
      let secs = 0;
      while (d.gravityLift === ride && ride.phase === "clamps" && secs < 20) {
        d.step(6, 1 / 60);
        secs += 0.1;
      }
      const idle = { events: idleEvents, stabilised: ride.result.stabilised, bonus: ride.result.bonus, seconds: secs };
      for (let i = 0; i < 60 * 20 && d.gravityLift; i += 1) d.step(1, 1 / 60);
      idle.finished = !d.gravityLift;
      return { played, idle };
    });
    const failures = [];
    if (r.error) return { failures: [r.error], notes: {} };
    const { played, idle } = r;
    if (played.shots.join() !== "interior,front,diagnostic") failures.push(`cameras per clamp: ${played.shots.join(", ")} (want interior, front, diagnostic)`);
    if (played.stabilised !== 3 || !played.events.includes("clamps-locked")) failures.push(`played: ${played.stabilised}/3 locked`);
    if (!(played.bonus > 0)) failures.push("no bonus for locking all three");
    if (!played.finished) failures.push("the ride did not finish after the clamps");
    if (!idle.events.includes("clamps-forced") || idle.stabilised !== 0 || idle.bonus !== 0) failures.push(`left alone: ${JSON.stringify(idle)}`);
    if (!idle.finished) failures.push("left alone, the ride did not finish");
    return { failures, notes: { bonus: played.bonus, forcedAfter: `${idle.seconds.toFixed(1)} s` } };
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
