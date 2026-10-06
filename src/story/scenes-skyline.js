/**
 * The Skyline's set piece (Phase 5): near the end of the skybridge the tower
 * behind is demolished - you look back as the charges go floor by floor,
 * bottom to top, then the whole building goes up and comes down. Its end of
 * the bridge goes with it: the deck swings down into a ramp. Sprint up it
 * (alternate A/D), jump off the broken tip, slow motion, grab the next
 * building's edge (two keys, fast). Miss either and you fall - and go again
 * from the sprint. Catch it: hands on the ledge, pull up, roll onto your
 * back, the sky, an exhale; up, and on into the atrium.
 *
 * Written against the Causeway's route (anchors from main.js): `at(d, x, y)`
 * gives a world point at route distance d; `deck(d)` is the tilted bridge's
 * height there.
 */

import * as THREE from "../three.js";
import { SCENES, timeLines, linesEnd } from "./script.js";
import { sprintReaction, latchReaction } from "./reaction.js";

/** When the charges start (the tower goes floor by floor from here). */
export const DETONATE_AT = 0.35;
/** The deck's final ramp angle before you run (radians) and while you run. */
const RAMP_ANGLE = 0.2;
const RAMP_ANGLE_RUN = 0.3;

/**
 * @param {object} a
 * @param {(d:number, x?:number, y?:number) => THREE.Vector3} a.at
 * @param {(d:number) => number} a.deck   the tilted deck's height at d
 * @param {number} a.startD      where it begins (~500 m)
 * @param {number} a.tipD        the broken tip of the bridge (the ramp's top)
 * @param {number} a.ledgeD      the far building's edge (the atrium)
 * @param {number} a.standD      where you're back on your feet
 * @param {number} a.wholeAt     seconds after DETONATE_AT that the whole tower goes
 * @param {(angle:number, drop:number) => void} a.setTilt  swing the deck down
 * @param {() => {active:boolean, bar:number, elapsed:number}} a.sprint
 * @param {() => number} a.dying  seconds into a fall (0 when not falling)
 * @param {() => THREE.Vector3} a.tower  where on the tower to look (the floor going now)
 */
export function blastScene(a) {
  const WHOLE = DETONATE_AT + a.wholeAt;
  // Watch the whole tower go up and start to come down before the deck goes.
  const TILT_AT = WHOLE + 1.6;
  const SPRINT_AT = TILT_AT + 1.15;
  const LATCH_AT = SPRINT_AT + 0.65;
  const UP_AT = LATCH_AT + 2.35;
  const blast = timeLines(SCENES.blast, 0.3);
  const latched = timeLines(SCENES.latched, LATCH_AT + 0.75);
  const lines = [...blast, ...latched];
  const end = Math.max(linesEnd(lines) + 1.8, UP_AT + 6);
  const d0 = a.startD;
  const tip = a.tipD - 0.6;
  const lip = a.ledgeD;
  const v = () => new THREE.Vector3();
  // Up the ramp (the deck's own height 14 m on), or level beyond the tip.
  const ahead = (d, up = 1.6) => a.at(d + 14, 0, a.deck(d + 14) + up);
  let sprintD = d0 + 2;

  /** The ramp's angle and drop at scene time t (deterministic, for retries). */
  const tiltAt = (t, s) => {
    if (t < TILT_AT) return [0, 0];
    const k = THREE.MathUtils.smoothstep(t, TILT_AT, TILT_AT + 0.9);
    let angle = RAMP_ANGLE * k;
    // It keeps going as you run: steeper, and the tip sinks.
    if (s?.active) angle += (RAMP_ANGLE_RUN - RAMP_ANGLE) * Math.min(1, s.elapsed / 4.5);
    else if (t >= SPRINT_AT) angle = RAMP_ANGLE_RUN;
    return [angle, 0.4 + k * 0.6 + (angle - RAMP_ANGLE * k) * 4];
  };

  return {
    id: "blast",
    lines,
    duration: end,
    head: { breath: 2, bob: 0.4, bobRate: 9 },
    track: {
      vignette: [[0, 0.3], [SPRINT_AT, 0.55], [LATCH_AT + 0.5, 0.7], [UP_AT + 1, 0.4], [end, 0]],
    },
    reactions: [
      // The clock stops for the sprint: you are the clock.
      { at: SPRINT_AT, id: "sprint", spec: sprintReaction({ time: 4.5 }), lead: 1.2, slow: 0 },
      { at: LATCH_AT, id: "latch", spec: latchReaction(), lead: 0.6, slow: 0.12, retryFrom: "sprint" },
    ],
    camera(t, pose) {
      pose.roll = 0;
      pose.fov = 72;
      const dying = a.dying();
      const s = a.sprint();
      let d;
      let y = 1.72;
      let look;
      if (t < TILT_AT) {
        // Stopped dead, turned round to watch it: floor by floor, then all of it.
        d = d0 + Math.min(t, 0.4) * 1.2;
        const back = THREE.MathUtils.smoothstep(t, 0.2, 0.7) * (1 - THREE.MathUtils.smoothstep(t, TILT_AT - 0.2, TILT_AT + 0.2));
        // Follow the blasts up the building, floor by floor.
        look = v().copy(ahead(d)).lerp(a.tower(), back);
        y += a.deck(d);
        pose.shake = t > WHOLE - 0.1 && t < WHOLE + 0.8 ? 1 : t > DETONATE_AT ? 0.3 : 0.15;
        pose.fov = 72 - back * 8;
      } else if (t < SPRINT_AT || s.active || Math.abs(t - SPRINT_AT) < 1e-6) {
        // The deck drops away under you: thrown forward, then up the ramp.
        const k = THREE.MathUtils.smoothstep(t, TILT_AT, TILT_AT + 0.6);
        d = t < SPRINT_AT ? d0 + 0.48 + k * 1.6 : d0 + 2.1 + (tip - d0 - 2.1) * Math.min(1, s.bar);
        if (t >= SPRINT_AT) sprintD = d;
        y += a.deck(d) - (t < SPRINT_AT ? Math.sin(k * Math.PI) * 0.5 : 0);
        look = ahead(d);
        pose.shake = t < TILT_AT + 0.7 ? 0.9 : 0.35;
        pose.roll = t < TILT_AT + 0.7 ? Math.sin(k * Math.PI) * 0.12 : 0;
      } else if (t < LATCH_AT + 0.45) {
        // The jump: off the tip, over the gap, up at the ledge.
        const k = THREE.MathUtils.clamp((t - SPRINT_AT) / (LATCH_AT + 0.45 - SPRINT_AT), 0, 1);
        d = THREE.MathUtils.lerp(sprintD, lip + 0.1, k);
        const from = a.deck(sprintD) + 1.72;
        y = THREE.MathUtils.lerp(from, -0.4, k) + Math.sin(k * Math.PI) * 1.4;
        look = v().copy(a.at(lip + 1, 0, 0.3)).lerp(ahead(d), 0.3);
        pose.fov = 80;
      } else if (t < LATCH_AT + 0.9) {
        // Hands on the ledge: chin just over the lip, looking down at your
        // hands on it, the floor beyond.
        d = lip - 0.32;
        y = 0.17;
        look = a.at(lip + 1.1, 0, -0.25);
        pose.fov = 56; // close on your hands
        pose.shake = 0.3;
      } else if (t < UP_AT) {
        // Pull up over the lip.
        const k = THREE.MathUtils.smoothstep(t, LATCH_AT + 0.9, UP_AT);
        d = lip - 0.32 + k * 1.77;
        y = 0.17 + k * 0.28;
        look = a.at(lip + 6, 0, 0.4 - k * 0.1);
      } else if (t < end - 1.9) {
        // Roll onto your back, head toward the drop: up into the open sky
        // where the bridge was, the smoke going over.
        const k = THREE.MathUtils.smoothstep(t, UP_AT, UP_AT + 0.9);
        d = lip + 1.45 - k * 0.2;
        y = 0.45 - k * 0.15;
        look = v().copy(a.at(lip + 6, 0, 0.3)).lerp(a.at(lip - 7, 0, 14), k);
        pose.roll = 0.15 * k;
      } else {
        // Up, and on.
        const k = THREE.MathUtils.smoothstep(t, end - 1.9, end);
        d = THREE.MathUtils.lerp(lip + 1.25, a.standD, k);
        y = THREE.MathUtils.lerp(0.3, 1.72, k);
        look = v().copy(a.at(lip - 7, 0, 14)).lerp(a.at(a.standD + 14, 0, 1.55), k);
        pose.roll = 0.15 * (1 - k);
      }
      pose.position.copy(a.at(d, 0, y));
      pose.look.copy(look);
      // A miss: down past the edge, the city coming up, the wind.
      if (dying > 0) {
        pose.position.y -= 4.9 * dying * dying;
        pose.look.copy(pose.position).add(v().set(0, -10, -3));
        pose.roll = dying * 0.6;
        pose.shake = 0.4;
      }
    },
    events: [
      { at: DETONATE_AT, name: "detonate" },
      { at: WHOLE, name: "whole" },
      { at: TILT_AT, name: "tilt" },
      { at: SPRINT_AT - 0.2, name: "sprint-ready" },
      { at: SPRINT_AT + 0.01, name: "jump" },
      { at: LATCH_AT + 0.46, name: "caught" },
      { at: UP_AT, name: "up" },
      { at: end - 1.9, name: "stand" },
    ],
    onUpdate(t) {
      const [angle, drop] = tiltAt(t, a.sprint());
      a.setTilt(angle, drop);
    },
  };
}
