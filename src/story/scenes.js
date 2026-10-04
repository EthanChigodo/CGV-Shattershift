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

/** A polyline on the ground: arc length, and a point/heading at any distance along it. */
export class PathLine {
  constructor(points) {
    this.points = points.map((p) => p.clone());
    this.lengths = [0];
    for (let i = 1; i < this.points.length; i += 1) this.lengths.push(this.lengths[i - 1] + this.points[i].distanceTo(this.points[i - 1]));
    this.length = this.lengths[this.lengths.length - 1];
  }

  /** Arc length to point i. */
  at(i) {
    return this.lengths[i];
  }

  /** Point at distance s (clamped), and the heading (radians, -Z = 0) of that leg. */
  sample(s, out = new THREE.Vector3()) {
    const d = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i] < d) i += 1;
    const a = this.points[i - 1];
    const b = this.points[i];
    const span = this.lengths[i] - this.lengths[i - 1];
    out.lerpVectors(a, b, span > 0 ? (d - this.lengths[i - 1]) / span : 0);
    const heading = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    return { position: out, heading };
  }
}

/**
 * 1b. Out of the ward behind Okoro: through the door, down the passage,
 * through the bulkhead into the Foundry - and up into the run's chase camera,
 * so gameplay takes over with no cut.
 *
 * @param {object} a
 * @param {THREE.Vector3[]} a.path   ground points, beside the bed -> into the Foundry
 * @param {THREE.Vector3} a.chase    the chase camera's position at the run's start
 * @param {THREE.Vector3} a.chaseLook
 * @param {number} a.startZ          the run's start
 * @param {import("./companion.js").Companion} a.okoro
 * @param {(k:number) => void} [a.onProgress]  0 in the ward .. 1 in the Foundry
 */
export function walkOutScene(a) {
  const lines = timeLines(SCENES.walkOut);
  const path = new PathLine(a.path);
  const doorS = path.at(1);
  // The camera walks to just inside the Foundry, then rises into the chase view.
  const camEnd = path.at(path.points.length - 2) - 0.5;
  const SPEED = 3.0;
  const walkTime = 0.9 + camEnd / SPEED;
  const RISE = 1.8;
  const duration = walkTime + RISE;
  const v = () => new THREE.Vector3();
  const camS = (t) => {
    // Ease into a brisk walk.
    const ramp = 0.9;
    if (t < ramp) return (SPEED * t * t) / (2 * ramp);
    return Math.min(camEnd, (SPEED * ramp) / 2 + SPEED * (t - ramp));
  };
  const eye = (t) => {
    const p = path.sample(camS(t), v()).position;
    return p.setY(1.62);
  };
  const ahead = (t) => {
    const p = path.sample(camS(t) + 4, v()).position;
    return p.setY(1.45);
  };
  // Okoro ends ~5 m into the run, ahead of where the player will start.
  const okoroEnd = path.at(path.points.length - 2) + 5;
  let okoroS = doorS;
  const head = { bob: 0.9, bobRate: 7, breath: 0.6 };

  return {
    id: "walkOut",
    lines,
    duration,
    head,
    track: { vignette: [[0, 0.25], [walkTime, 0.1], [duration, 0]] },
    camera(t, pose) {
      // Walking behind him; then up and back into the run's chase camera.
      const k = THREE.MathUtils.smoothstep(t, walkTime, duration);
      pose.roll = 0;
      pose.position.copy(eye(Math.min(t, walkTime))).lerp(a.chase, k);
      pose.look.copy(ahead(Math.min(t, walkTime))).lerp(a.chaseLook, k);
      pose.fov = 66 + 2 * k;
      // The walking bob fades out as the camera leaves the body.
      head.bob = 0.9 * (1 - k);
      head.breath = 0.6 * (1 - k);
    },
    events: [
      { at: 0.1, name: "okoro-run" },
      { at: walkTime, name: "show-player" },
      { at: duration, name: "hand-over" },
    ],
    onUpdate(t, dt) {
      const o = a.okoro;
      const s = camS(t);
      a.onProgress?.(Math.min(1, s / camEnd));
      // He waits at the door until you are close, then leads; once you are
      // through the bulkhead he runs on to his place ahead of the run.
      const want = t >= walkTime ? okoroEnd : Math.max(doorS, s + 2.6);
      const speed = t >= walkTime ? 6.8 : SPEED + 0.6;
      const step = Math.min(Math.max(0, want - okoroS), speed * dt);
      okoroS += step;
      const p = path.sample(okoroS, v());
      o.root.position.copy(p.position);
      o.root.rotation.y = p.heading;
      o.speed = step > 1e-4 ? step / Math.max(1e-4, dt) : 0;
      o.act(o.speed > 0.3 ? (o.speed > 4.5 ? "run" : "walk") : "beckon");
      o.lookAt(o.speed > 0.3 ? null : eye(t));
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
