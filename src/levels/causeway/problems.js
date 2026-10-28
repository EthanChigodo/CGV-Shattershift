/**
 * The Skyline's right-tool problems (src/systems/problems.js): shock's.
 *
 *   LASER GRID + JUNCTION BOX   A laser grid across all three lanes (low:
 *     jump it; high: slide under it), powered by a junction box on a pylon
 *     a few metres before it - shock violet, a cable running from it to the
 *     grid. A shock sphere on the box (or bursting by it) overloads it: a
 *     shower of sparks and the grid dies. Anything else fizzles off it. The
 *     grid can still be jumped or slid if you are good - the box is the
 *     clever way, and pays for it.
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

/**
 * A laser grid `width` wide and its junction box `box` metres before it, on
 * a pylon on the `side` (-1 left, 1 right).
 */
export function laserGrid(kit, { mode = "low", width = 11.2, box = 8, side = 1 } = {}) {
  const owned = [];
  const own = (m) => (owned.push(m), m);
  const root = new THREE.Group();
  root.name = `SkyLaser_${mode}`;
  const beamMaterial = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.3, 0.18), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const glowMaterial = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.08), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const violet = own(new THREE.MeshBasicMaterial({ color: toolColour("shock", 2.2), toneMapped: false }));

  // The posts, and the beams between them.
  const half = width / 2;
  for (const s of [-1, 1]) {
    root.add(kit.block(kit.materials.darkSteel, 0.32, 3.1, 0.32, s * half, 1.55, 0, { cast: true }));
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

  // The junction box on its pylon, the cable over to the grid's post.
  const x = side * 5.25;
  root.add(kit.block(kit.materials.darkSteel, 0.22, 3.4, 0.22, x, 1.7, box, { cast: true }));
  const body = kit.block(kit.materials.casing, 0.5, 0.95, 0.75, x - side * 0.2, 2.0, box, { cast: true });
  root.add(body);
  const face = kit.block(violet, 0.08, 0.72, 0.56, x - side * 0.47, 2.0, box);
  face.name = "JunctionBox";
  kit.target(face, "junction", 450);
  root.add(face);
  const badge = toolBadge("shock", 0.62);
  badge.position.set(x - side * 0.55, 2.95, box + 0.05);
  badge.rotation.y = -side * 0.7;
  root.add(badge);
  // Cable: up the pylon, along to the grid, down its post.
  root.add(kit.block(violet, 0.05, 0.75, 0.05, x, 2.85, box));
  root.add(kit.block(violet, 0.05, 0.05, box, x, 3.2, box / 2));
  root.add(kit.block(violet, Math.abs(side * half - x) + 0.05, 0.05, 0.05, (x + side * half) / 2, 3.2, 0));
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
