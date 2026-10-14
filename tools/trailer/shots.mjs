/**
 * The trailer's shots, captured from the game (capture.mjs).
 *
 * Each shot: a `setup` run in the page (jump to a scene, fast-forward to the
 * moment - `__cap.until`, `__cap.run`), then `seconds` of footage through a
 * trailer `camera` (src/trailer/director.js), at `timeScale` (slow motion),
 * with the autopilot dodging, shooting and answering quick-time events, and
 * god mode on, unless switched off. `scoutAt`: the seconds `--scout` takes
 * stills at (default start, middle, end).
 */

export const FPS = 30;

/**
 * Into a story scene: real time while its models load, then simulated time
 * (frame by frame) until `until` - cutscenes and quick-time events play out.
 */
const jump = (scene, loaded, until = loaded) => `
  __dbg.manual = false;
  __dbg.story.jump("${scene}");
  await __cap.wait(() => ${loaded}, 90000);
  __dbg.manual = true;
  __dbg.trailer.set({ autopilot: true, god: true });
  __cap.until(() => ${until}, 120);
`;
const playing = `__dbg.state === "playing"`;
const labsLoaded = `!!__dbg.meltdown?.level && __dbg.meltdown.assetsReady`;
const labsRunning = `__dbg.meltdown?.phase === "run"`;
/** Run shots in the Labs skip its story beats (the breach, the bend attack): straight to running. */
const labsSkipStory = `__dbg.story.layer.markSeen("breach"); __dbg.story.layer.markSeen("bendAttack");`;
const labs = `${labsSkipStory} ${jump("labs", labsLoaded, labsRunning)}`;
const roofLoaded = `!!__dbg.meltdown?.roof && __dbg.meltdown.assetsReady`;
const onRoof = `__dbg.meltdown?.phase === "roof"`;
const roof = jump("roof", roofLoaded, onRoof);
/** The Skyline from the Calibration Lift's doors, awake (no sedation blur). */
const skyline = `
  __dbg.manual = false;
  __dbg.chapter("skyline");
  await __cap.wait(() => ${playing}, 60000);
  __dbg.manual = true;
  __dbg.run.skipWake = true;
  __dbg.trailer.set({ autopilot: true, god: true });
`;
const blast = `${jump("skyline", playing)} __cap.until(() => __dbg.state === "cutscene", 20);`;

export const SHOTS = [
  /* ---- The opening, and who's who --------------------------------------- */
  // The Gravity Fault: the glass lift outside the tower, Okoro with the launcher, the glass going.
  { name: "lift-ride", camera: "game", seconds: 20, scoutAt: [2, 5, 8, 11, 14, 17, 20],
    setup: `__dbg.manual = false; __dbg.story.jump("lift"); await __cap.wait(() => !!__dbg.gravityLift, 30000); await __cap.sleep(2000); __dbg.manual = true; __dbg.trailer.set({ autopilot: true, god: true });` },
  // Waking up: Okoro over the bed.
  { name: "char-okoro", camera: "game", autopilot: false, seconds: 7,
    setup: `__dbg.manual = false; __dbg.story.jump("wake"); await __cap.wait(() => __dbg.state === "cutscene", 30000); await __cap.sleep(1500); __dbg.manual = true; __cap.run(7);` },
  // The Labs breach: the tanks open.
  { name: "char-breach", camera: "game", autopilot: false, seconds: 9,
    setup: `${jump("labs", labsLoaded, `__dbg.meltdown?.phase === "story"`)}` },
  { name: "char-07", camera: "orbit", seconds: 5,
    setup: `${jump("foundry", playing)} __cap.run(10);` },

  /* ---- Sector 01: the Foundry (Hard: slag carts, more of everything) ---- */
  { name: "foundry-front", difficulty: "hard", camera: "front", seconds: 5,
    setup: `${jump("foundry", playing)} __cap.run(30);` },
  { name: "foundry-low", difficulty: "hard", camera: "low", seconds: 5,
    setup: `${jump("foundry", playing)} __cap.run(44);` },
  { name: "foundry-side", difficulty: "hard", camera: "side", seconds: 4,
    setup: `${jump("foundry", playing)} __cap.run(58);` },
  { name: "foundry-escape", difficulty: "hard", camera: "front", seconds: 5,
    setup: `${jump("foundry", playing)} __cap.run(64);` },
  { name: "foundry-drone", difficulty: "hard", camera: "drone", seconds: 4,
    setup: `${jump("foundry", playing)} __cap.run(70);` },

  /* ---- Sector 02: the Labs -------------------------------------------- */
  { name: "labs-front", difficulty: "hard", camera: "front", seconds: 5, setup: `${labs} __cap.run(12);` },
  { name: "labs-low", difficulty: "hard", camera: "low", seconds: 5, setup: `${labs} __cap.run(30);` },
  { name: "labs-fire", difficulty: "hard", camera: "front", seconds: 5, setup: `${labs} __cap.run(46);` },
  { name: "labs-blackout", difficulty: "hard", camera: "front", seconds: 6,
    setup: `${labs} __cap.until(() => __dbg.meltdown.level.beatAt(__dbg.meltdown.runner.distance).dark, 120); __cap.run(4);` },

  /* ---- Sector 03: the Skyline ------------------------------------------ */
  { name: "skyline-glass", difficulty: "hard", camera: "front", seconds: 5, setup: `${skyline} __cap.run(10);` },
  { name: "slowmo-shock", difficulty: "hard", camera: "side", timeScale: 0.25, seconds: 4,
    setup: `${skyline} __dbg.arsenal.select("shock"); __cap.run(12);` },
  // The blast, the sprint across the collapsing bridge, the latch: the story's own camera.
  { name: "skyline-blast", camera: "game", seconds: 18, scoutAt: [1, 4, 7, 10, 13, 16, 18], setup: blast },
  { name: "skyline-atrium", difficulty: "hard", camera: "front", seconds: 5,
    setup: `${blast} __cap.until(() => __dbg.state === "playing", 60); __cap.run(3);` },

  /* ---- The Roof ---------------------------------------------------------- */
  { name: "roof-orbit", difficulty: "hard", camera: "orbit", orbit: { radius: 7, height: 4.6 }, seconds: 6, setup: `${roof} __cap.run(22);` },
  { name: "roof-chaos", difficulty: "hard", camera: "orbit", orbit: { radius: 7, height: 4.6 }, seconds: 5, setup: `${roof} __cap.run(34);` },
  { name: "slowmo-cryo", difficulty: "hard", camera: "game", timeScale: 0.3, seconds: 4,
    setup: `${roof} __dbg.arsenal.select("cryo"); __cap.run(26);` },
  { name: "roof-heli", difficulty: "hard", camera: "game", seconds: 8, setup: `${roof} __cap.run(40);` },
];
