/**
 * Checks for the quiet ride (cutscene 7, src/elevators/quiet-ride.js).
 *
 * Each check gets a fresh page with the game loaded and the menus closed,
 * and returns { failures: string[], notes: object }.
 */

/**
 * The story's trigger: the Labs' corridor is complete (the lift where the
 * scientist stays behind), and the quiet ride starts.
 */
export const quietHandover = {
  name: "handover from the Labs",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      const w0 = performance.now();
      while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      d.resetGame("story");
      d.demoJump(2);
      const t0 = performance.now();
      while (performance.now() - t0 < 60000 && !(d.currentLevel === 3 && d.state === "playing")) await new Promise((resolve) => setTimeout(resolve, 100));
      const inLabs = d.currentLevel === 3 && d.state === "playing";
      // A moment in the Labs first, as a player would have.
      for (let i = 0; i < 20; i += 1) {
        d.step(3, 1 / 60);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      d.meltdown.events.emit("corridor-complete", { stats: { breaks: 0, downs: 0, falls: 0, vitality: 80, balls: 6 } });
      d.step(2, 1 / 60);
      const ride = d.gravityLift;
      return {
        inLabs,
        quiet: !!ride?.cutscene,
        labsFreed: !d.meltdown?.visible,
        cutsceneClass: document.body.classList.contains("cutscene"),
        hudHidden: getComputedStyle(document.querySelector("#hud")).display === "none",
      };
    });
    const failures = [];
    if (!r.inLabs) failures.push("the Labs did not start");
    if (!r.quiet) failures.push("the end of the Labs did not start the quiet ride");
    if (!r.labsFreed) failures.push("the Labs were not unloaded for the ride");
    if (!r.cutsceneClass || !r.hudHidden) failures.push("the game's HUD is not hidden during the cutscene");
    return { failures, notes: {} };
  },
};

/** The whole cutscene: every beat and shot, the radio lines, then the Skyline. */
export const quietRide = {
  name: "quiet ride (cutscene 7) to the Skyline",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      const w0 = performance.now();
      while (!d.playerBodyTemplate && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      d.resetGame("story");
      d.demoQuietRide();
      const ride = d.gravityLift;
      const seen = { shots: [], events: [], captions: [] };
      ride.events.on("shot", ({ shot }) => seen.shots.push(shot));
      for (const name of ["depart", "radio", "tremor", "chime", "doors", "arrive"]) ride.events.on(name, () => seen.events.push(name));
      const figure = {
        character: !!ride._avatar?.model,
        gear: ride._avatar?.look?.uniforms.uGear.value,
        launcherAtStart: ride.launcher.state,
        letterbox: !!document.querySelector(".elv-bar.on"),
      };
      let maxSit = 0;
      let launcherAtEnd = null;
      let lastCaption = "";
      let doorsOpen = 0;
      const start = performance.now();
      for (let i = 0; i < 60 * 40 && d.gravityLift; i += 1) {
        d.step(1, 1 / 60);
        const caption = document.querySelector(".elv-caption")?.textContent ?? "";
        if (caption && caption !== lastCaption) seen.captions.push(caption);
        lastCaption = caption;
        if (d.gravityLift) {
          doorsOpen = Math.max(doorsOpen, ride.cabin.open);
          maxSit = Math.max(maxSit, ride.sit);
          launcherAtEnd = ride.launcher.state;
        }
        // At the game's own pace (Level 3 is built in real time while the
        // cutscene plays), never faster than the clock.
        if (i % 20 === 0) {
          const ahead = (i / 60) * 1000 - (performance.now() - start);
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, ahead)));
        }
      }
      const t0 = performance.now();
      while (performance.now() - t0 < 60000 && !(d.currentLevel === 1 && (d.state === "launch" || d.state === "playing"))) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        seen,
        figure,
        slid: maxSit > 0.9,
        launcherAtEnd,
        doorsOpen,
        rideGone: d.gravityLift === null,
        hudGone: !document.querySelector(".elevator-ui") && !document.body.classList.contains("cutscene"),
        level: d.currentLevel,
        state: d.state,
        blackMs: Math.round(performance.now() - t0),
      };
    });
    const failures = [];
    for (const shot of ["corner", "low", "radio", "side", "shoulder"]) if (!r.seen.shots.includes(shot)) failures.push(`shot "${shot}" never played`);
    for (const event of ["depart", "radio", "tremor", "chime", "doors", "arrive"]) if (!r.seen.events.includes(event)) failures.push(`"${event}" never happened`);
    if (r.seen.captions.filter((c) => /RADIO/.test(c)).length < 2) failures.push(`the pilot's two radio lines were not captioned (${JSON.stringify(r.seen.captions)})`);
    if (!r.figure.character) failures.push("the cutscene does not show the chosen character");
    if (r.figure.gear !== 1) failures.push("the character is not wearing the scientist's gear");
    if (r.figure.launcherAtStart !== "resting") failures.push(`the launcher does not start leaning on the wall (${r.figure.launcherAtStart})`);
    if (r.launcherAtEnd !== "held") failures.push(`they did not pick the launcher up (${r.launcherAtEnd})`);
    if (!r.figure.letterbox) failures.push("no letterbox bars during the cutscene");
    if (!r.slid) failures.push("they never slid down the wall to sit");
    if (r.doorsOpen < 0.9) failures.push(`the doors only opened to ${r.doorsOpen.toFixed(2)}`);
    if (!r.rideGone || !r.hudGone) failures.push("the cutscene or its HUD was not cleaned up");
    if (r.level !== 1 || !["launch", "playing"].includes(r.state)) failures.push(`the Skyline did not start (level ${r.level}, state ${r.state})`);
    if (r.blackMs > 1500) failures.push(`${(r.blackMs / 1000).toFixed(1)} s of black between the cutscene and the Skyline`);
    return { failures, notes: { shots: r.seen.shots, blackAfterRide: `${r.blackMs} ms` } };
  },
};
