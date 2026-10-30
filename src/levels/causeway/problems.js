/**
 * The Skyline's right-tool problems (src/systems/problems.js): shock's.
 *
 *   LASER GRID + JUNCTION BOX   A laser grid across all three lanes (low:
 *     jump it; high: slide under it), powered by a junction box hung in the
 *     middle of it, over the centre lane on a gantry between its posts -
 *     shock violet, where you're already looking (on a pylon off to the
 *     side, metres before the grid, it was too hard to hit at speed). A
 *     shock sphere on the box, or bursting near it - the floor under it will
 *     do - overloads it: a shower of sparks and the grid dies. Anything else
 *     fizzles off it. The grid can still be jumped or slid if you are good -
 *     the box is the clever way, and pays for it.
 *   SEALED SECURITY DOOR  The ward's security door, its electromagnetic
 *     seal lit violet. Glass (and cryo, and a charged glass burst) bounces
 *     off; one shock sphere overloads the seal and the door shatters. Out
 *     of shock? Crash through it - it gives, at a heavy cost.
 *
 * The pieces only; what breaks them is CausewayLevel.breakTarget's.
 */

import * as THREE from "../../three.js";
import { toolBadge, floorStripes, toolColour, fadeMark, disposeMark } from "../../fx/problem-marks.js";

/** Beam heights: low (jump it) and high (slide under it). */
const HEIGHTS = { low: [0.35, 0.7, 1.05], high: [1.6, 1.95, 2.3] };

/** Where the junction box hangs: high enough to jump the grid under it (camera and all). */
const BOX = { y: 3.9, width: 1.5, height: 0.9, depth: 0.55 };

/**
 * A laser grid `width` wide and its junction box in the middle of it, over
 * the centre lane. (`box` and `side`, where a pylon used to stand, are
 * no longer used.)
 */
export function laserGrid(kit, { mode = "low", width = 11.2 } = {}) {
  const owned = [];
  const own = (m) => (owned.push(m), m);
  const root = new THREE.Group();
  root.name = `SkyLaser_${mode}`;
  const beamMaterial = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.3, 0.18), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const glowMaterial = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.08), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const violet = own(new THREE.MeshBasicMaterial({ color: toolColour("shock", 2.2), toneMapped: false }));

  // The posts (tall enough to carry the gantry), and the beams between them.
  const half = width / 2;
  const top = BOX.y + BOX.height / 2 + 0.25;
  for (const s of [-1, 1]) {
    root.add(kit.block(kit.materials.darkSteel, 0.32, top, 0.32, s * half, top / 2, 0, { cast: true }));
    root.add(kit.block(kit.materials.lampRed, 0.06, 2.6, 0.34, s * (half - 0.17), 1.5, 0));
  }
  const beams = new THREE.Group();
  root.add(beams);
  for (const y of HEIGHTS[mode]) {
    beams.add(kit.block(beamMaterial, width, 0.035, 0.035, 0, y, 0));
    beams.add(kit.block(glowMaterial, width, 0.16, 0.16, 0, y, 0));
  }
  const collider = mode === "high" ? kit.collider(width, 1.05, 0.35, 0, 1.975, 0) : kit.collider(width, 1.15, 0.35, 0, 0.575, 0);
  collider.userData.laser = mode;
  root.add(collider);

  // The gantry between the posts, the junction box hung from it in the
  // middle, its violet face toward you (+Z, the way you come), and the
  // cable along the gantry down both posts to the beams.
  root.add(kit.block(kit.materials.darkSteel, width, 0.22, 0.26, 0, top - 0.11, 0, { cast: true }));
  const body = kit.block(kit.materials.casing, BOX.width, BOX.height, BOX.depth, 0, BOX.y, 0, { cast: true });
  root.add(body);
  const face = kit.block(violet, BOX.width - 0.2, BOX.height - 0.2, 0.08, 0, BOX.y, BOX.depth / 2 + 0.03);
  face.name = "JunctionBox";
  kit.target(face, "junction", 450);
  root.add(face);
  const badge = toolBadge("shock", 0.62);
  badge.position.set(0, BOX.y, BOX.depth / 2 + 0.09);
  root.add(badge);
  root.add(kit.block(violet, width - 0.4, 0.05, 0.05, 0, top - 0.26, 0.15));
  for (const s of [-1, 1]) root.add(kit.block(violet, 0.05, top - 0.3, 0.05, s * (half - 0.05), (top - 0.3) / 2, 0.18));
  const line = floorStripes("shock", width - 0.6, 0.7);
  line.position.z = 3.2;
  root.add(line);
  const marks = [badge, line];

  const state = { live: 1, dying: false };
  root.userData.owned = [...owned];
  root.userData.tick = (dt, time) => {
    if (state.dying) state.live = Math.max(0, state.live - dt * 3.5);
    const flicker = state.dying ? (Math.random() < 0.5 ? 0.2 : 1) : 1;
    beamMaterial.opacity = (0.82 + Math.sin(time * 47) * 0.13) * state.live * flicker;
    glowMaterial.opacity = 0.22 * state.live * flicker;
    beams.visible = state.live > 0.01;
    violet.color.copy(toolColour("shock", state.dying ? 0.25 : 1.8 + Math.sin(time * 6) * 0.5));
  };
  root.userData.tick(0, 0);
  const kill = () => {
    state.dying = true;
    collider.userData.disabled = true;
    for (const m of marks) fadeMark(m, 0);
  };
  root.userData.dispose = () => { for (const m of marks) disposeMark(m); };
  return { root, target: face, collider, state, kill, marks, body };
}

/**
 * Dress a security door (kit.door()) as sealed: violet seal bars across it,
 * shock's mark on it, a violet line on the floor before it.
 */
export function sealDoor(kit, door, { width = 10.8, height = 4.8 } = {}) {
  const violet = new THREE.MeshBasicMaterial({ color: toolColour("shock", 2.0), toneMapped: false });
  const seal = new THREE.Group();
  seal.name = "Seal";
  for (const y of [1.15, 2.4, 3.65]) seal.add(kit.block(violet, width - 0.2, 0.09, 0.05, 0, y, 0.12));
  for (const s of [-1, 1]) seal.add(kit.block(violet, 0.14, height, 0.6, s * (width / 2 + 0.25), height / 2, 0));
  const badge = toolBadge("shock", 1.25);
  badge.position.set(0, 2.4, 0.2);
  seal.add(badge);
  door.root.add(seal);
  const line = floorStripes("shock", width - 1, 0.8);
  line.position.z = 3.2;
  door.root.add(line);
  const marks = [badge, line];
  door.root.userData.owned = [...(door.root.userData.owned ?? []), violet];
  door.target.userData.sealed = true;
  door.target.userData.points = 600;
  return {
    seal,
    marks,
    open() {
      seal.visible = false;
      for (const m of marks) fadeMark(m, 0);
    },
    tick(time) {
      violet.color.copy(toolColour("shock", 1.6 + Math.sin(time * 5) * 0.5));
    },
    dispose() { for (const m of marks) disposeMark(m); },
  };
}
