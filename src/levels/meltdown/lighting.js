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
  let power = 1;
  let currentBrightness = brightness;

  const apply = () => {
    hemisphere.color.copy(coolFill).lerp(dangerFill, danger);
    hemisphere.groundColor.copy(coolGround).lerp(dangerGround, danger);
    hemisphere.intensity = 0.68 * Math.sqrt(currentBrightness) * power;
    key.color.copy(coolKey).lerp(dangerKey, danger);
    key.intensity = (0.9 - danger * 0.25) * currentBrightness * power;
  };
  apply();

  group.userData.setBrightness = (value) => {
    currentBrightness = value;
    apply();
  };

  /** 1 = mains on; toward 0 in the blacked-out beat. Only touches intensities. */
  group.userData.setPower = (value) => {
    const next = THREE.MathUtils.clamp(value, 0, 1);
    if (Math.abs(next - power) < 1e-4) return;
    power = next;
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

/**
 * Dim the scene's environment reflections with the power.
 *
 * The environment map (RoomEnvironment) is what keeps metal from rendering
 * black - but it is image-based light, not a light, so it ignores the
 * blackout entirely: in the dark beat every steel wall and duct still shone
 * as if lit. Swapping `scene.environment` out would change every material's
 * shader and recompile mid-run, so instead each standard material's own
 * `envMapIntensity` is scaled (a uniform - free). Materials are collected
 * lazily and re-collected on `refresh()`, after models stream in.
 */
export function createEnvironmentDimmer(scene) {
  let entries = null;
  let level = 1;
  const collect = () => {
    entries = [];
    const seen = new Set();
    scene.traverse((o) => {
      const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of list) {
        if (!m || seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        entries.push({ material: m, base: m.userData.baseEnvIntensity ?? m.envMapIntensity });
        m.userData.baseEnvIntensity = m.userData.baseEnvIntensity ?? m.envMapIntensity;
      }
    });
  };
  return {
    refresh() {
      entries = null;
      const k = level;
      level = -1;
      this.set(k);
    },
    /** 1 = full reflections, 0 = none. Only touches materials when it changes. */
    set(value) {
      const k = THREE.MathUtils.clamp(value, 0, 1);
      if (Math.abs(k - level) < 0.01) return;
      level = k;
      if (!entries) collect();
      for (const e of entries) e.material.envMapIntensity = e.base * k;
    },
  };
}
