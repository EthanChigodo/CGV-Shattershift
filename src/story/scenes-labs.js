/**
 * The Labs' cutscenes (Phase 4): the breach, the bend attack, the hiding
 * place and Okoro's sacrifice, and the grief in the lift up. Written against
 * anchors the Labs director (labs-director.js) works out from the level's
 * route and lifts - never against fixed coordinates.
 *
 * Every scene ends where gameplay picks up (the chase camera's own pose), so
 * control hands over with no cut.
 */

import * as THREE from "../three.js";
import { SCENES, timeLines, linesEnd } from "./script.js";
import { struggleReaction } from "./reaction.js";
import { cue } from "./scenes.js";

const v = () => new THREE.Vector3();

/**
 * 4a. The breach: the lift opens, the incubators along the ward burst one
 * after another, the patients spill out; Vale on a wall monitor; "Go!".
 *
 * @param {object} a
 * @param {{pos:THREE.Vector3, look:THREE.Vector3}} a.from  the camera when it starts
 * @param {THREE.Vector3} a.eye        your eyes, just out of the lift
 * @param {THREE.Vector3} a.ahead      a point down the corridor at eye height
 * @param {THREE.Vector3[]} a.tanks    each incubator's centre, in burst order
 * @param {THREE.Vector3} a.monitor    the wall monitor's centre
 * @param {() => {pos, look}} a.chase  the run's chase camera at the start
 * @param {import("./companion.js").Companion} a.okoro
 */
export function breachScene(a) {
  const lines = timeLines(SCENES.breach, 0.8);
  const tNo = cue(lines, "No. No, no", 4);
  const tGlass = cue(lines, "[glass", 7);
  const tOut = cue(lines, "They're out", 9);
  const tVale = cue(lines, "Elias. You always", 13);
  const tGo = cue(lines, "The lift's at the far end", 20);
  const end = linesEnd(lines) + 1.4;
  const okoroFace = () => a.okoro.headPosition(v());
  const tankMid = a.tanks[Math.min(2, a.tanks.length - 1)] ?? a.ahead;
  const bursts = a.tanks.map((_, i) => ({ at: tGlass - 0.7 + i * 0.3, name: "burst", data: { index: i } }));
  const burstEnd = tGlass - 0.7 + a.tanks.length * 0.3;
  const chase = () => a.chase();

  return {
    id: "breach",
    lines,
    duration: end,
    head: { breath: 1.1, sway: 0.6 },
    track: { vignette: [[0, 0.2], [tGlass, 0.55], [tGo, 0.3], [end, 0]] },
    shots: [
      { at: 0, dur: 1.2, ease: "inOut", from: { pos: a.from.pos, look: a.from.look, fov: 72 }, to: { pos: a.eye, look: a.ahead, fov: 70 } },
      { at: tNo - 0.3, dur: 0.8, ease: "inOut", from: { pos: a.eye, look: a.ahead, fov: 70 }, to: { look: okoroFace } },
      { at: tGlass - 0.8, dur: 0.35, whip: true, from: { pos: a.eye, look: okoroFace, fov: 70 }, to: { look: tankMid, fov: 74 } },
      { at: burstEnd, dur: 1.4, from: { pos: a.eye, look: tankMid, fov: 74 }, to: { look: a.tanks[a.tanks.length - 1] ?? a.ahead } },
      { at: tOut, dur: 0.8, ease: "inOut", from: { pos: a.eye, look: a.tanks[a.tanks.length - 1] ?? a.ahead, fov: 74 }, to: { look: okoroFace, fov: 70 } },
      { at: tVale - 0.7, dur: 1.0, ease: "inOut", from: { pos: a.eye, look: okoroFace, fov: 70 }, to: { look: a.monitor, fov: 30 } },
      { at: tGo - 0.3, dur: 0.6, ease: "inOut", from: { pos: a.eye, look: a.monitor, fov: 30 }, to: { look: okoroFace, fov: 70 } },
      { at: end - 1.3, dur: 1.3, ease: "inOut", from: { pos: a.eye, look: okoroFace, fov: 70 }, to: { pos: () => chase().pos, look: () => chase().look, fov: 72 } },
    ],
    camera(t, pose) {
      // The bursts shake the floor.
      if (t > tGlass - 0.7 && t < burstEnd + 0.4) pose.shake = 0.55;
    },
    events: [
      { at: 0.3, name: "alarm" },
      ...bursts,
      { at: tVale - 0.5, name: "monitor-on" },
      { at: tGo - 0.1, name: "monitor-off" },
      { at: end - 1.0, name: "okoro-go" },
    ],
    onUpdate(t) {
      const o = a.okoro;
      if (t < tNo - 0.4) o.act("idle").lookAt(tankMid, 0.7);
      else if (t < tGlass - 0.7) o.act("talk").lookAt(a.eye, 0.8);
      else if (t < tOut) o.act("crouch").lookAt(tankMid, 0.9);
      else if (t < tVale - 0.5) o.act("talk").lookAt(a.eye, 0.8);
      else if (t < tGo) o.act("idle").lookAt(a.monitor, 0.9);
      else if (t < end - 1.0) o.act("point").lookAt(a.ahead, 0.6);
      else o.act("run").lookAt(null);
    },
  };
}

/**
 * 4c. The bend attack: a patient lunges from the blind side of the bend and
 * knocks you down; mash to hold it off (the red grows as it wins) until
 * Okoro shoots it; he checks on you; up, and run.
 *
 * @param {object} b
 * @param {THREE.Vector3} b.eye        your eyes when it hits
 * @param {THREE.Vector3} b.forward    down the route (unit)
 * @param {THREE.Vector3} b.side       toward the blind side (unit)
 * @param {import("./companion.js").Companion} b.patient
 * @param {import("./companion.js").Companion} b.okoro
 * @param {() => number} b.struggle   0..1, how far you have pushed it off
 * @param {() => {pos, look}} b.chase  the chase camera after it
 */
export function bendScene(b) {
  const attack = timeLines(SCENES.bendAttack, 0.15);
  const REACT = 1.7;
  const saved = timeLines(SCENES.bendSaved, REACT + 0.35);
  const lines = [...attack, ...saved];
  const tDown = cue(saved, "Down!", REACT + 0.35);
  const tShot = cue(saved, "[a pistol shot]", tDown + 1);
  const tHurt = cue(saved, "Are you hurt", tShot + 1.4);
  const end = linesEnd(lines) + 1.2;
  const eye = b.eye.clone();
  // Slammed across the corridor and half down the wall, it on you.
  const floorEye = eye.clone().addScaledVector(b.side, -0.75).setY(eye.y - 0.4);
  const face = () => b.patient.headPosition(v());
  const okoroFace = () => b.okoro.headPosition(v());
  const ahead = eye.clone().addScaledVector(b.forward, 10);
  const chase = () => b.chase();
  // The patient: from the blind side, onto you.
  const lungeFrom = eye.clone().setY(0).addScaledVector(b.side, 3.2).addScaledVector(b.forward, 1.2);
  const onYou = eye.clone().setY(0).addScaledVector(b.side, 0.05).addScaledVector(b.forward, 0.1);

  return {
    id: "bendAttack",
    lines,
    duration: end,
    head: { breath: 1.6 },
    track: {
      vignette: [[0, 0.3], [0.5, 0.75], [tShot, 0.75], [end, 0]],
      tint: [[0, 0], [0.4, 0.35], [REACT, 0.35], [tShot, 0.35], [tShot + 0.6, 0]],
    },
    reactions: [{ at: REACT, id: "struggle", spec: struggleReaction(), lead: 0.9, slow: 0.06 }],
    shots: [
      { at: 0, dur: 0.3, whip: true, from: { pos: eye, look: ahead, fov: 72 }, to: { look: face } },
      // Knocked down: on your back, it over you.
      { at: 0.3, dur: 0.45, ease: "in", from: { pos: eye, look: face, fov: 72 }, to: { pos: floorEye, look: face, fov: 64, roll: 0.45 } },
      { at: 0.75, dur: tShot - 0.75, from: { pos: floorEye, look: face, fov: 64, roll: 0.45 }, to: { roll: 0.3 } },
      // The shot: it's off you; look to him.
      { at: tShot + 0.2, dur: 1.0, ease: "inOut", from: { pos: floorEye, look: face, fov: 64, roll: 0.3 }, to: { pos: floorEye, look: okoroFace, fov: 66, roll: 0.1 } },
      // Up.
      { at: tHurt + 0.6, dur: 1.2, ease: "inOut", from: { pos: floorEye, look: okoroFace, fov: 66, roll: 0.1 }, to: { pos: eye, look: okoroFace, fov: 70 } },
      { at: end - 1.1, dur: 1.1, ease: "inOut", from: { pos: eye, look: okoroFace, fov: 70 }, to: { pos: () => chase().pos, look: () => chase().look, fov: 72 } },
    ],
    camera(t, pose) {
      if (t < 0.8) pose.shake = 0.8;
      else if (t < tShot) {
        // It pushes; you push back. Closer as it wins.
        const k = 1 - b.struggle();
        pose.shake = 0.25 + 0.35 * k;
        pose.position.addScaledVector(b.forward, 0.08 * k);
      }
    },
    events: [
      { at: 0, name: "hit" },
      { at: REACT - 0.4, name: "okoro-turn" },
      { at: tShot, name: "shot" },
      { at: tHurt, name: "okoro-check" },
      { at: end - 0.9, name: "okoro-go" },
    ],
    onUpdate(t) {
      const p = b.patient;
      if (t < tShot) {
        // The lunge, then on top of you, arms out, leaning in.
        const k = THREE.MathUtils.smoothstep(t, 0, 0.45);
        p.root.position.lerpVectors(lungeFrom, onYou, k);
        const toYou = v().copy(floorEye).setY(0).sub(p.root.position);
        p.root.rotation.y = Math.atan2(-toYou.x, -toYou.z);
        p.act(t < 0.45 ? "run" : "idle");
        p.speed = t < 0.45 ? 6 : 0;
        // Arms out at you, leaning in harder as it wins.
        const push = 1 - b.struggle();
        Object.assign(p.adjust, { lean: 0.1 + 0.3 * push, aimR: 1, aimL: 1, headNod: 0.15 });
        p.lookAt(floorEye, 1);
      } else {
        // Shot: thrown back off you, down.
        p.adjust.aimR = p.adjust.aimL = 0;
        p.act("slump");
        p.root.position.addScaledVector(b.side, 0.02);
        p.lookAt(null);
      }
      const o = b.okoro;
      if (t < REACT - 0.4) o.act("run");
      else if (t < tHurt) o.act("aim").lookAt(face(), 1);
      else o.act("talk").lookAt(eye, 0.8);
    },
  };
}

/**
 * 4d. The lift is blocked: patients between you and it; behind a desk with
 * Okoro; he gives you the bag, goes left shouting, they follow him; you go
 * right, into the lift; the doors close as the shouting stops.
 *
 * @param {object} h
 * @param {THREE.Vector3} h.standEye     at the end of the corridor, looking at the landing
 * @param {THREE.Vector3} h.crowdCentre
 * @param {THREE.Vector3} h.deskEye      crouched behind the desk
 * @param {THREE.Vector3} h.runTo        where Okoro runs (left, off the landing)
 * @param {THREE.Vector3[]} h.runPath    your run, desk -> right -> into the lift
 * @param {THREE.Vector3} h.doors        the lift doors, from inside
 * @param {import("./companion.js").Companion} h.okoro
 */
export function hideScene(h) {
  const lines = timeLines(SCENES.hide, 2.2);
  const tBag = cue(lines, "Take the bag", 20);
  const tGo = cue(lines, "Now - GO!", 24);
  const tOver = cue(lines, "OVER HERE", 26);
  const tStops = cue(lines, "[the shouting stops]", 30);
  const end = linesEnd(lines) + 0.3;
  const okoroFace = () => h.okoro.headPosition(v());
  const path = h.runPath;
  const RUN = 2.6;
  const runPos = (t) => {
    // Along the path at a run, eased at the ends.
    const k = THREE.MathUtils.smoothstep(t, tOver, tOver + RUN);
    const s = k * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(s));
    return v().lerpVectors(path[i], path[i + 1], s - i).setY(1.55);
  };

  return {
    id: "hide",
    lines,
    duration: end,
    head: { breath: 1.8, sway: 0.4 },
    track: {
      vignette: [[0, 0.35], [2, 0.6], [tGo, 0.6], [end, 0.3]],
      fade: [[0, 0], [1.9, 0], [2.0, 1], [2.15, 0]],
    },
    shots: [
      // The landing: them, between you and the lift.
      { at: 0, dur: 1.9, from: { pos: h.standEye, look: h.crowdCentre, fov: 70 }, to: { look: h.crowdCentre.clone().setY(h.crowdCentre.y + 0.2), fov: 62 } },
      // Cut: down behind the desk, Okoro beside you.
      { at: 2.0, dur: tGo - 2.3, from: { pos: h.deskEye, look: okoroFace, fov: 62, roll: 0.03 }, to: { roll: -0.02 } },
      // He goes; you watch him.
      { at: tGo, dur: 0.8, ease: "inOut", from: { pos: h.deskEye, look: okoroFace, fov: 62 }, to: { look: h.runTo, fov: 68 } },
      { at: tGo + 0.8, dur: tOver - tGo - 0.8, from: { pos: h.deskEye, look: h.runTo, fov: 68 }, to: { look: () => h.okoro.headPosition(v()) } },
    ],
    camera(t, pose) {
      if (t < tOver) return;
      // Run: right, into the lift, and round to face the doors.
      pose.position.copy(runPos(t));
      const k = THREE.MathUtils.smoothstep(t, tOver + RUN - 0.6, tOver + RUN + 0.4);
      const along = v().copy(path[path.length - 1]).sub(path[0]).setY(0).normalize();
      pose.look.copy(pose.position).addScaledVector(along, 6).setY(1.4).lerp(h.doors, k);
      pose.fov = 70;
      pose.roll = 0;
      if (t < tOver + RUN) pose.shake = 0.3;
    },
    events: [
      { at: 0.2, name: "crowd-turn" },
      { at: 2.0, name: "crouch" },
      { at: tBag, name: "bag" },
      { at: tGo + 0.1, name: "okoro-run" },
      { at: tOver - 0.2, name: "player-run" },
      { at: tStops - 0.6, name: "doors" },
      { at: tStops, name: "silence" },
    ],
    onUpdate(t) {
      const o = h.okoro;
      if (t < 2.0) o.act("crouch").lookAt(h.crowdCentre, 0.8);
      else if (t < tBag) o.act("crouch").lookAt(h.deskEye, 0.9);
      else if (t < tGo) o.act("offer").lookAt(h.deskEye, 0.9);
      else o.lookAt(null);
    },
  };
}

/**
 * 4e. The lift up, alone: low on the floor of the cabin, breathing, slow
 * blinks - "...Elias" - then the ride's own camera takes the cabin away up
 * the shaft and it fades to black.
 *
 * @param {object} g
 * @param {() => THREE.Vector3} g.floorEye   sat against the cabin wall (it rises)
 * @param {() => THREE.Vector3} g.doors
 * @param {(t:number, pos:THREE.Vector3, look:THREE.Vector3) => boolean} g.ride
 *   the ride camera from `RIDE_AT` (returns false while it hasn't started)
 */
export function griefScene(g) {
  const lines = timeLines(SCENES.grief);
  const end = Math.max(linesEnd(lines) + 1.5, 9.5);
  const RIDE_AT = 4.2;
  return {
    id: "grief",
    lines,
    duration: end,
    keepFade: true,
    head: { breath: 2.4, sway: 0.8 },
    track: {
      lids: [[0, 0], [1.6, 0], [2.0, 0.85], [2.6, 0.1], [4.2, 0.1], [4.6, 0.9], [5.3, 0]],
      vignette: [[0, 0.7], [end, 0.5]],
      fade: [[0, 0], [end - 1.0, 0], [end, 1]],
    },
    camera(t, pose) {
      if (t < RIDE_AT) {
        // On the floor, head low, eyes on the shut doors.
        const k = Math.min(1, t / RIDE_AT);
        pose.position.copy(g.floorEye());
        pose.look.copy(g.doors());
        pose.look.y += 0.15 - 0.2 * k;
        pose.fov = 64;
        pose.roll = 0.06 - 0.03 * k;
        return;
      }
      if (g.ride(t - RIDE_AT, pose.position, pose.look)) {
        pose.roll = 0;
        pose.fov = 66;
      }
    },
    events: [
      { at: 0, name: "ride" },
      { at: end - 0.2, name: "black" },
    ],
  };
}
