/**
 * The ending (Phase 6): in the helicopter, the city burning below; the
 * pilot's back, the small talk; "I'm only here to collect"; the
 * pilot turns - it's Dr. Vale; his lines, the joke, the laugh; outside as the
 * helicopter flies away from the burning tower; black. Then the title card
 * and the credits (title and credits are their own short scenes, so the
 * title can't be skipped past and the credits can).
 */

import * as THREE from "../three.js";
import { SCENES, GAME_TITLE, timeLines, linesEnd } from "./script.js";
import { cue } from "./scenes.js";

/**
 * @param {object} e  world-space anchors (functions: the cabin is flying)
 * @param {() => THREE.Vector3} e.seatEye    you, on the bench by the open door
 * @param {() => THREE.Vector3} e.doorLook   out of the door, down at the city
 * @param {() => THREE.Vector3} e.pilotBack  the back of the pilot's head
 * @param {() => THREE.Vector3} e.pilotFace  his face (after he turns)
 * @param {() => {pos:THREE.Vector3, look:THREE.Vector3}} e.outside  the shot of it flying away
 * @param {(k:number) => void} e.turn         the pilot turning round, 0..1
 */
export function endingScene(e) {
  const lines = timeLines(SCENES.ending, 2.4);
  const tPilot = cue(lines, "Hold on back there", 2.4);
  const tCollect = cue(lines, "only here to collect", 8);
  const tHello = cue(lines, "Hello, Seven", 11);
  const tLaugh = cue(lines, "[laughs]", 22);
  const tOutside = linesEnd(lines) + 0.4;
  const end = tOutside + 4.5;
  const v = () => new THREE.Vector3();
  // A little closer to him for the reveal.
  const closer = () => v().copy(e.seatEye()).lerp(e.pilotFace(), 0.22);
  const outPos = () => e.outside().pos;
  const outLook = () => e.outside().look;

  return {
    id: "ending",
    lines,
    duration: end,
    keepFade: true,
    head: { breath: 0.8, sway: 0.7 },
    track: {
      fade: [[0, 1], [1.2, 0], [end - 2.2, 0], [end, 1]],
      vignette: [[0, 0.45], [tHello, 0.55], [tLaugh, 0.75], [tOutside, 0.2]],
    },
    shots: [
      // The city burning below, through the open door.
      { at: 0, dur: tPilot, from: { pos: e.seatEye, look: e.doorLook, fov: 64 }, to: { look: () => v().copy(e.doorLook()).add(v().set(0, 1.4, -1.5)) } },
      // The cockpit: his back and the back of his head.
      { at: tPilot - 0.2, dur: 1.4, ease: "inOut", from: { pos: e.seatEye, look: () => v().copy(e.doorLook()).add(v().set(0, 1.4, -1.5)), fov: 64 }, to: { look: e.pilotBack, fov: 58 } },
      { at: tPilot + 1.2, dur: tHello - tPilot - 1.4, from: { pos: e.seatEye, look: e.pilotBack, fov: 58 }, to: { fov: 54 } },
      // The turn: he swings round; you're facing him.
      { at: tHello - 0.2, dur: 1.2, ease: "inOut", from: { pos: e.seatEye, look: e.pilotBack, fov: 54 }, to: { pos: closer, look: e.pilotFace, fov: 50 } },
      { at: tHello + 1.0, dur: tLaugh - tHello - 1.0, from: { pos: closer, look: e.pilotFace, fov: 50 }, to: { fov: 40 } },
      { at: tLaugh, dur: tOutside - tLaugh, from: { pos: closer, look: e.pilotFace, fov: 40 }, to: { fov: 34 } },
      // Outside: it flies off from the burning tower.
      { at: tOutside, dur: end - tOutside, from: { pos: outPos, look: outLook, fov: 55 } },
    ],
    camera(t, pose) {
      if (t >= tOutside) pose.roll = 0;
    },
    events: [
      { at: tCollect + 0.8, name: "collect" },
      { at: tHello - 0.25, name: "reveal" },
      { at: tLaugh, name: "laugh" },
      { at: tOutside, name: "outside" },
      { at: end - 0.1, name: "black" },
    ],
    onUpdate(t) {
      e.turn(THREE.MathUtils.smoothstep(t, tHello - 0.25, tHello + 0.9));
    },
    /** For the check: when the reveal must have landed. */
    meta: { tHello, tLaugh, tOutside },
  };
}

/** The title on black: at least 3 s, not skippable. */
export function titleScene(ui, title = GAME_TITLE) {
  return {
    id: "title",
    skippable: false,
    keepFade: true,
    duration: 4.4,
    track: { fade: [[0, 1], [4.4, 1]] },
    events: [
      { at: 0.4, name: "title-on" },
      { at: 4.0, name: "title-off" },
    ],
    onUpdate(t) {
      if (t >= 0.4 && t < 4.0) ui.title(title, "");
      else ui.title(null);
    },
  };
}

/** The credits rolling up over black (hold Esc to skip). */
export function creditsScene(ui, html, seconds = 38) {
  return {
    id: "credits",
    keepFade: true,
    duration: seconds + 1,
    track: { fade: [[0, 1], [seconds + 1, 1]] },
    events: [{ at: 0, name: "credits-on" }],
    onUpdate(t) {
      if (t < 0.05) ui.credits(html);
      ui.setCreditsScroll(t / seconds);
    },
  };
}
