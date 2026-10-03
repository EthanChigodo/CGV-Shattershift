/**
 * The Skyline's set piece (Phase 5): near the end of the skybridge the
 * tower behind blows. Look back at the fireball; sprint (alternate A/D) as
 * the bridge comes down at your heels; jump off the broken end; slow motion;
 * grab the next building's edge (two keys, fast). Miss either and you fall -
 * and go again from the sprint. Catch it: hands on the ledge, pull up, roll
 * onto your back, the sky, an exhale; up, and on into the atrium.
 *
 * Written against the Causeway's route (anchors from main.js): `at(d, x, y)`
 * gives a world point at route distance d.
 */

import * as THREE from "../three.js";
import { SCENES, timeLines, linesEnd } from "./script.js";
import { sprintReaction, latchReaction } from "./reaction.js";

const SPRINT_AT = 3.0;
const LATCH_AT = 3.65;
/** The sprint's run, and the jump: route distances. */
const RUN = 35;

/**
 * @param {object} a
 * @param {(d:number, x?:number, y?:number) => THREE.Vector3} a.at
 * @param {number} a.startD      where it begins (~500 m)
 * @param {number} a.ledgeD      the far building's edge (the atrium, 540 m)
 * @param {number} a.standD      where you're back on your feet
 * @param {number} a.frontStart  where the collapse front is when it begins
 * @param {(front:number) => void} a.setCollapse  the bridge falls up to here
 * @param {() => {active:boolean, bar:number, elapsed:number}} a.sprint
 * @param {() => number} a.dying  seconds into a fall (0 when not falling)
 * @param {THREE.Vector3} a.fireball  where the tower goes up
 */
export function blastScene(a) {
  const blast = timeLines(SCENES.blast, 0.3);
  const latched = timeLines(SCENES.latched, LATCH_AT + 0.75);
  const lines = [...blast, ...latched];
  const end = Math.max(linesEnd(lines) + 1.8, 12);
  const d0 = a.startD;
  const jumpFrom = d0 + RUN;
  const lip = a.ledgeD;
  const v = () => new THREE.Vector3();
  const ahead = (d) => a.at(d + 14, 0, 1.6);
  const behind = a.fireball;
  let sprintD = d0 + 2;

  // The collapse front over time (before the sprint) - deterministic, so a
  // retry rebuilds the same bridge.
  const frontAt = (t) => a.frontStart + Math.max(0, t - 0.4) * 9;

  return {
    id: "blast",
    lines,
    duration: end,
    head: { breath: 2, bob: 0.4, bobRate: 9 },
    track: {
      vignette: [[0, 0.3], [SPRINT_AT, 0.55], [LATCH_AT + 0.5, 0.7], [7, 0.4], [end, 0]],
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
      if (t < SPRINT_AT) {
        // Still moving, looking back over your shoulder at it.
        d = d0 + t * 0.8;
        const back = THREE.MathUtils.smoothstep(t, 0.35, 0.75) * (1 - THREE.MathUtils.smoothstep(t, 2.2, 2.6));
        look = v().copy(ahead(d)).lerp(behind, back);
        pose.shake = t > 0.2 && t < 1.6 ? 0.7 : 0.25;
      } else if (s.active || (t <= SPRINT_AT + 1e-6)) {
        // The sprint: as far as you've got.
        d = d0 + 2.4 + (RUN - 2.4) * Math.min(1, s.bar);
        sprintD = d;
        look = ahead(d);
        pose.shake = 0.35;
      } else if (t < LATCH_AT + 0.45) {
        // The jump: off the end, over the gap.
        const k = THREE.MathUtils.clamp((t - SPRINT_AT) / (LATCH_AT + 0.45 - SPRINT_AT), 0, 1);
        d = THREE.MathUtils.lerp(jumpFrom, lip + 0.1, k);
        y = 1.72 + Math.sin(k * Math.PI) * 1.0 - k * 2.3;
        look = v().copy(a.at(lip + 1, 0, 0.3)).lerp(ahead(d), 0.3);
        pose.fov = 80;
      } else if (t < LATCH_AT + 0.9) {
        // Hands on the ledge: chin at the lip, your hands on it, the floor beyond.
        d = lip - 0.32;
        y = 0.06;
        look = a.at(lip + 1.4, 0, 0.0);
        pose.shake = 0.3;
      } else if (t < 6.0) {
        // Pull up over the lip.
        const k = THREE.MathUtils.smoothstep(t, LATCH_AT + 0.9, 6.0);
        d = lip - 0.32 + k * 1.77;
        y = 0.06 + k * 0.39;
        look = a.at(lip + 6, 0, 0.4 - k * 0.1);
      } else if (t < end - 1.9) {
        // Roll onto your back, head toward the drop: up into the open sky
        // where the bridge was, the smoke going over.
        const k = THREE.MathUtils.smoothstep(t, 6.0, 6.9);
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
      { at: 0.2, name: "blast" },
      { at: SPRINT_AT - 0.2, name: "sprint-ready" },
      { at: SPRINT_AT + 0.01, name: "jump" },
      { at: LATCH_AT + 0.46, name: "caught" },
      { at: 6.0, name: "up" },
      { at: end - 1.9, name: "stand" },
    ],
    onUpdate(t) {
      const s = a.sprint();
      if (t < SPRINT_AT) a.setCollapse(frontAt(t));
      else if (s.active) a.setCollapse(Math.min(sprintD - 1.5, frontAt(SPRINT_AT) + s.elapsed * 8.5));
      // Behind you as you jump: the end you jumped from goes too.
      else if (t < LATCH_AT + 0.45) a.setCollapse(Math.min(lip + 0.6, jumpFrom + (t - SPRINT_AT) * 14));
      else a.setCollapse(lip + 0.6);
    },
  };
}
