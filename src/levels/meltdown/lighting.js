/**
 * Lighting for Level 3 - The Meltdown.
 *
 * The pooled-light problem is identical to Level 2's (see docs/level-2-foundry
 * .md's performance section: dynamic light *count* forces a shader recompile,
 * so the level must bind a fixed pool to whichever emitters are nearest the
 * player rather than creating a light per vent/sign/fire). That pooling logic
 * has nothing Foundry-specific in it, so it is reused directly rather than
 * re-implemented.
 *
 * What is specific to this level is the ambience: it does not just have one
 * fixed mood, it reads redder and darker as the player's vitality falls. That
 * is `setDanger`, this file's equivalent of Foundry's `setBrightness`.
 */

import * as THREE from "../../three.js";
export { LightPool } from "../foundry/lighting.js";

/**
 * Ambient fill for the meltdown: starts close to the foundry's cool industrial
 * fill, then `setDanger(0..1)` pushes the hemisphere and key light toward a
 * fire-lit red/orange as the player's buffer over the fire runs out. Called
 * every frame from the host with the player's vitality ratio - cheap, because
 * it only touches existing light colour/intensity uniforms.
 */
export function createMeltdownAmbience({ brightness = 1.5 } = {}) {
  const group = new THREE.Group();
  group.name = "MeltdownAmbience";

  const coolFill = new THREE.Color(0x3d4a52);
  const dangerFill = new THREE.Color(0x3a1108);
  const coolGround = new THREE.Color(0x1c1712);
  const dangerGround = new THREE.Color(0x2a0803);
  const coolKey = new THREE.Color(0xb8c8d8);
  const dangerKey = new THREE.Color(0xff6a3a);

  const hemisphere = new THREE.HemisphereLight(coolFill.getHex(), coolGround.getHex(), 0.68 * Math.sqrt(brightness));
  group.add(hemisphere);

  const key = new THREE.DirectionalLight(coolKey.getHex(), 0.9 * brightness);
  key.position.set(3, 13, 4);
  group.add(key);

  let danger = 0;
  let currentBrightness = brightness;

  const apply = () => {
    hemisphere.color.copy(coolFill).lerp(dangerFill, danger);
    hemisphere.groundColor.copy(coolGround).lerp(dangerGround, danger);
    hemisphere.intensity = 0.68 * Math.sqrt(currentBrightness);
    key.color.copy(coolKey).lerp(dangerKey, danger);
    key.intensity = (0.9 - danger * 0.25) * currentBrightness;
  };
  apply();

  group.userData.setBrightness = (value) => {
    currentBrightness = value;
    apply();
  };

  group.userData.setDanger = (value) => {
    danger = THREE.MathUtils.clamp(value, 0, 1);
    apply();
  };

  group.userData.dispose = () => {
    hemisphere.dispose?.();
    key.dispose?.();
  };

  return group;
}
