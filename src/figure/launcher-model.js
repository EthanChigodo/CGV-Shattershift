/**
 * A launcher for a figure's shoulder (the menus' line-ups, the Arena, the
 * Race): the game's launcher model (assets/meltdown/launcher.glb) oriented
 * and sized as every level mounts it - long axis down -Z, ~1.25 m - in a
 * skin of its own.
 *
 *   const rig = buildLauncher(assets.get("launcher"), "tiger");
 *   mountLauncher(avatar, rig);     // both hands on it
 *   unmountLauncher(avatar, rig);   // arms free again
 */

import * as THREE from "../three.js";
import { applyLauncherSkin } from "./launcher-skins.js";

/**
 * Where the launcher sits in PlayerAvatar.shoulder for the two-handed hold
 * (HOLD_POSE, characters.js): on the shoulder, the tube a little low and its
 * front dipped, so the right hand is under it on the grip and the left arm
 * cradles it further out. Every level and mode mounts it here.
 */
export const LAUNCHER_HELD = Object.freeze({ position: new THREE.Vector3(0.02, -0.14, -0.15), pitch: -0.05 });

export function buildLauncher(asset, skin = "factory") {
  const rig = new THREE.Group();
  rig.name = "LauncherRig";
  if (!asset) return rig;
  const model = asset.template.clone(true);
  model.scale.setScalar(1.25 / Math.max(asset.size.x, asset.size.z));
  model.rotation.y = Math.PI / 2;
  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  applyLauncherSkin(model, skin);
  rig.add(model);
  rig.userData.model = model;
  /** Where its spheres leave from (the muzzle, at the front). */
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.66);
  rig.add(muzzle);
  rig.userData.muzzle = muzzle;
  return rig;
}

/** On the figure's right shoulder, both hands on it - as the levels carry it. */
export function mountLauncher(avatar, rig) {
  if (!avatar || !rig) return;
  avatar.shoulder.add(rig);
  rig.position.copy(LAUNCHER_HELD.position);
  rig.rotation.set(LAUNCHER_HELD.pitch, 0, 0);
  avatar.hold = 1;
}

/**
 * Arms up (the winner on the podium, the ladder): the launcher slung across
 * the back, out of the hands - as the Labs carry it on the ladder.
 * slingLauncher(avatar, rig, false) puts it back on the shoulder.
 */
export function slingLauncher(avatar, rig, slung = true) {
  if (!avatar || !rig) return;
  if (!slung) { mountLauncher(avatar, rig); return; }
  avatar.shoulder.add(rig);
  rig.position.set(-0.3, -0.35, 0.2);
  rig.rotation.set(0, Math.PI / 2, 0.85);
  avatar.hold = 0;
}

export function unmountLauncher(avatar, rig) {
  rig?.parent?.remove(rig);
  if (avatar) avatar.hold = 0;
}

export function setLauncherSkin(rig, skin) {
  if (rig?.userData.model) applyLauncherSkin(rig.userData.model, skin);
}
