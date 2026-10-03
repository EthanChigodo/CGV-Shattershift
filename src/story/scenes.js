/**
 * Cutscene factories. Each takes the anchors of wherever it's staged and
 * returns a scene for CutscenePlayer (cutscene.js). The words come from
 * script.js; the timing of camera moves is tied to the lines, so editing a
 * line's length moves the camera with it.
 *
 * Phase 1 builds the wake-up (staged in preview/story.html's test room) and
 * the reaction ladder demo; later phases add the rest here.
 */

import * as THREE from "../three.js";
import { SCENES, timeLines } from "./script.js";
import { reactionLadder } from "./reaction.js";

/** Start time of the first line containing `text` (so shots can follow the script). */
export function cue(lines, text, fallback = 0) {
  return lines.find((l) => l.text.includes(text))?.at ?? fallback;
}

/**
 * 1. Waking from anaesthesia, on your back in a bed. Okoro is at your right.
 *
 * @param {object} a  anchors (world space)
 * @param {THREE.Vector3} a.eye        eyes, lying on the pillow
 * @param {THREE.Vector3} a.up         straight up from the face (to the ceiling)
 * @param {THREE.Vector3} a.feet       toward the foot of the bed (unit)
 * @param {THREE.Vector3} a.right      the patient's right (unit) - Okoro's side
 * @param {THREE.Vector3} a.standEye   eyes, standing beside the bed
 * @param {THREE.Vector3} a.door       where Okoro leads you
 * @param {import("./companion.js").Companion} a.okoro
 */
export function wakeScene(a) {
  const lines = timeLines(SCENES.wake);
  const firstWord = cue(lines, "can you hear me", 5);
  const feet = cue(lines, "on your feet", 22);
  const basement = cue(lines, "Basement first", 26);
  const end = basement + 4.2;

  const v = () => new THREE.Vector3();
  const ceiling = (k = 1) => () => v().copy(a.eye).addScaledVector(a.up, 2.5).addScaledVector(a.feet, 0.6 * k);
  const okoroFace = () => a.okoro.headPosition(v());
  // Head turned to the right on the pillow, looking up at him.
  const turned = () => v().copy(a.eye).addScaledVector(a.right, 0.06).addScaledVector(a.up, 0.02);
  const sitEye = () => v().copy(a.eye).addScaledVector(a.up, 0.62).addScaledVector(a.feet, 0.42);
  const standEye = () => a.standEye;
  // Watching him head for the door.
  const okoroBack = () => a.okoro.headPosition(v()).addScaledVector(a.up, -0.35);

  return {
    id: "wake",
    lines,
    duration: end,
    head: { breath: 1.6, sway: 1 },
    track: {
      fade: [[0, 1], [1.2, 1], [3.2, 0]],
      // Heavy lids: two failed tries, then open - and a long blink later.
      lids: [[0, 1], [2.6, 1], [3.1, 0.55], [3.5, 1], [4.6, 1], [5.1, 0.25], [5.6, 0.85], [6.3, 0.1], [9.5, 0.12], [9.7, 0.9], [10.0, 0.08], [feet, 0.04], [feet + 0.2, 0.7], [feet + 0.4, 0]],
      blur: [[0, 16], [4.5, 12], [8, 7], [13, 3.5], [feet, 1.4], [feet + 2.5, 0]],
      vignette: [[0, 0.9], [8, 0.65], [feet, 0.45], [end, 0.2]],
    },
    shots: [
      // On your back, the ceiling lights smeared.
      { at: 0, dur: firstWord, from: { pos: a.eye, look: ceiling(0.4), fov: 62, roll: 0.05 }, to: { look: ceiling(0.1), roll: 0.02 } },
      // His voice: the head rolls toward him.
      { at: firstWord, dur: 1.6, ease: "inOut", from: { pos: a.eye, look: ceiling(0.1), fov: 62 }, to: { pos: turned, look: okoroFace, fov: 55, roll: -0.12 } },
      { at: firstWord + 1.6, dur: feet - firstWord - 1.6, from: { pos: turned, look: okoroFace, fov: 55, roll: -0.12 }, to: { roll: -0.08 } },
      // Up: sitting.
      { at: feet + 0.4, dur: 1.7, ease: "inOut", from: { pos: turned, look: okoroFace, fov: 55, roll: -0.08 }, to: { pos: sitEye, look: okoroFace, fov: 60, roll: 0 } },
      // On your feet, a little unsteady.
      { at: basement - 0.2, dur: 1.6, ease: "inOut", from: { pos: sitEye, look: okoroFace, fov: 60 }, to: { pos: standEye, look: okoroBack, fov: 66, roll: 0.03 } },
    ],
    camera(t, pose) {
      // Unsteady on the anaesthetic: a slow wobble that fades as you wake.
      const woozy = Math.max(0, 1 - t / (feet + 4));
      pose.roll += Math.sin(t * 0.9) * 0.05 * woozy;
      pose.look.y += Math.sin(t * 0.63) * 0.08 * woozy;
    },
    events: [
      { at: 0.4, name: "monitor" },
      { at: firstWord - 0.4, name: "okoro-lean" },
      { at: feet, name: "sit-up" },
      { at: basement - 0.2, name: "stand" },
      { at: basement + 1.5, name: "okoro-go" },
    ],
    onUpdate(t, dt) {
      const o = a.okoro;
      // Leaning over the bed while you're down; upright once you sit up.
      o.adjust.lean = t > firstWord - 0.4 && t < feet + 0.8 ? 0.42 : 0;
      if (t < firstWord - 0.4) o.act("idle");
      else if (t < basement + 1.5) o.act(t > feet - 0.6 && t < feet + 1.2 ? "offer" : "talk");
      else {
        // Off to the door; a beckon over his shoulder on the way.
        const to = v().copy(a.door).sub(o.root.position).setY(0);
        const left = to.length();
        if (left > 0.6) {
          o.act("walk");
          o.speed = 1.5;
          o.root.position.addScaledVector(to.normalize(), Math.min(left, 1.5 * dt));
          o.root.rotation.y = Math.atan2(-to.x, -to.z);
        } else o.act("beckon");
      }
      if (t < basement + 1.5) o.lookAt(v().copy(a.eye).addScaledVector(a.up, t > feet ? 0.6 : 0));
      else o.lookAt(a.standEye, 0.6);
    },
  };
}

/**
 * The elevator's reaction ladder on its own (preview and tests): four break
 * points, each harder, with Okoro's shouts. Phase 3 stages this in the
 * Gravity Fault ride.
 */
export function ladderScene({ rng = Math.random, gap = 3.2 } = {}) {
  const shouts = SCENES.liftBreaks;
  const lines = [];
  const reactions = [];
  let t = 1;
  shouts.forEach((shout, i) => {
    lines.push({ ...shout, at: t - 0.9, hold: 1.6 });
    reactions.push({ at: t, id: `break-${i}`, spec: reactionLadder(i, rng), lead: 1.2, slow: 0.15 });
    t += gap;
  });
  return { id: "ladder", lines, reactions, duration: t, head: { breath: 0.8 } };
}
