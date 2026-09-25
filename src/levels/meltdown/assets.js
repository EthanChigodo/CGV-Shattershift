/**
 * External models for Level 3.
 *
 * Every .glb in assets/meltdown/ was converted from the team's supplied
 * source files (Blender/FBX/OBJ) with textures cut to 512-1024 px and heavy
 * meshes decimated - see docs/credits.md for sources and licences.
 *
 * The level never waits on these. Kit pieces are built synchronously with a
 * procedural stand-in plus an *asset slot* - an empty Object3D describing the
 * box the real model should fill. `fillAssetSlots` runs once loading finishes,
 * swaps each stand-in for a scaled clone of the model, and leaves the
 * collider untouched. If a file fails to load, the stand-in simply stays.
 */

import * as THREE from "../../three.js";
import { GLTFLoader, BufferGeometryUtils } from "../../three-addons.js";

/**
 * Models that arrive as many small meshes sharing a few materials. Every mesh
 * is a draw call; the ventilation network alone is 79 of them. Merging by
 * material collapses each of these to a handful.
 */
const MERGE_BY_MATERIAL = new Set(["officeDesk", "launcher", "ventFan"]);

/**
 * Models whose source scene gave them a glow that makes no sense here. The
 * geothermal pipes were lava conduits in their original volcano scene and
 * export with a red emission at strength ~83 - in a lab corridor that reads
 * as neon strip lighting, so it is switched off.
 */
const KILL_EMISSIVE = new Set(["industrialPipes"]);

function mergeByMaterial(scene) {
  scene.updateMatrixWorld(true);
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const key = o.material;
    if (!groups.has(key)) groups.set(key, []);
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    // mergeGeometries needs matching attribute sets.
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    groups.get(key).push(g.index ? g.toNonIndexed() : g);
  });
  const merged = new THREE.Group();
  for (const [material, geometries] of groups) {
    const geometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    if (geometry) merged.add(new THREE.Mesh(geometry, material));
  }
  return merged;
}

export const MELTDOWN_ASSETS = {
  concreteBarrier: "concrete_barrier.glb",
  officeDesk: "office_desk.glb",
  steelShelves: "steel_shelves.glb",
  chainlinkFence: "chainlink_fence.glb",
  ceilingFan: "ceiling_fan.glb",
  microscope: "microscope.glb",
  securityCamera: "security_camera.glb",
  utilityBox: "utility_box.glb",
  // The supplied ventilation system is a modular kit laid out side by side,
  // not an assembled network, so its pieces were exported separately and
  // are assembled into duct runs in kit.js.
  ductStraight: "duct_straight.glb",
  ventGrille: "vent_grille.glb",
  ventFan: "vent_fan.glb",
  alarmLight: "alarm_light.glb",
  industrialPipes: "industrial_pipes.glb",
  experimentRing: "experiment_ring.glb",
  launcher: "launcher.glb",
};

/**
 * Load every asset. Each result is a template Group whose origin sits at the
 * model's bottom-centre, plus its size, so slots can fit it without caring
 * where the source file put its pivot.
 * @returns {Promise<Map<string, {template: THREE.Group, size: THREE.Vector3}>>}
 */
export async function loadMeltdownAssets(baseUrl, { onProgress } = {}) {
  const loader = new GLTFLoader();
  const entries = Object.entries(MELTDOWN_ASSETS);
  const assets = new Map();
  let done = 0;

  await Promise.all(
    entries.map(async ([name, file]) => {
      try {
        const gltf = await loader.loadAsync(new URL(file, baseUrl).href);
        let scene = gltf.scene;
        if (MERGE_BY_MATERIAL.has(name)) {
          try {
            scene = mergeByMaterial(scene);
          } catch (error) {
            console.warn(`[meltdown] could not merge "${name}", using it as-is`, error);
          }
        }
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        scene.position.set(-centre.x, -box.min.y, -centre.z);
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            // Exported PBR materials default to fully rough; a touch of
            // metal response lets the fire and alarm lights read on them.
            if (o.material && o.material.isMeshStandardMaterial) {
              o.material.envMapIntensity = 0.6;
              if (KILL_EMISSIVE.has(name)) {
                o.material.emissive.setRGB(0, 0, 0);
                o.material.emissiveIntensity = 0;
              }
            }
          }
        });
        const template = new THREE.Group();
        template.name = `Asset_${name}`;
        template.add(scene);
        assets.set(name, { template, size });
      } catch (error) {
        console.warn(`[meltdown] asset "${name}" failed to load, keeping stand-in`, error);
      } finally {
        done += 1;
        onProgress?.(done / entries.length, name);
      }
    })
  );

  return assets;
}

/**
 * Describe where a model should go. Kit pieces call this and add the result
 * as a child; `fillAssetSlots` finds it later.
 *
 * @param {string} name        key in MELTDOWN_ASSETS
 * @param {object} fit
 * @param {number[]} [fit.size]    target [x, y, z] box; 0 on an axis means "any"
 * @param {"x"|"z"} [fit.longAxis] turn the model so its longest side runs along this axis
 * @param {number} [fit.rotateX]  extra rotation, radians, applied before fitting
 * @param {number} [fit.rotateY]
 * @param {THREE.Object3D[]} [placeholders] stand-ins to hide once the model arrives
 */
export function assetSlot(name, fit = {}, placeholders = []) {
  const slot = new THREE.Object3D();
  slot.name = `Slot_${name}`;
  slot.userData.assetSlot = { name, ...fit };
  slot.userData.placeholders = placeholders;
  // Stand-ins get hidden later, so static-geometry baking must leave them be.
  for (const p of placeholders) p.userData.isPlaceholder = true;
  return slot;
}

/** Replace every stand-in under `root` with its loaded model. */
export function fillAssetSlots(root, assets) {
  const slots = [];
  root.traverse((o) => {
    if (o.userData.assetSlot && !o.userData.filled) slots.push(o);
  });

  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  let filled = 0;

  for (const slot of slots) {
    const spec = slot.userData.assetSlot;
    const asset = assets.get(spec.name);
    if (!asset) continue;

    const model = asset.template.clone(true);
    const inner = new THREE.Group();
    inner.add(model);
    if (spec.rotateX) inner.rotation.x = spec.rotateX;
    if (spec.rotateY) inner.rotation.y = spec.rotateY;

    // Measure after the fixed rotations so longAxis/fit see the real shape.
    inner.updateMatrixWorld(true);
    box.setFromObject(inner);
    box.getSize(size);
    if (spec.longAxis === "x" && size.z > size.x) {
      inner.rotation.y += Math.PI / 2;
    } else if (spec.longAxis === "z" && size.x > size.z) {
      inner.rotation.y += Math.PI / 2;
    }
    inner.updateMatrixWorld(true);
    box.setFromObject(inner);
    box.getSize(size);

    const target = spec.size ?? [0, 1, 0];
    const have = [size.x, size.y, size.z];
    const ratios = [];
    for (let axis = 0; axis < 3; axis += 1) {
      if (target[axis] > 0 && have[axis] > 1e-4) ratios.push(target[axis] / have[axis]);
    }
    const uniform = ratios.length ? Math.min(...ratios) : 1;

    const holder = new THREE.Group();
    holder.add(inner);
    if (spec.stretch) {
      // Non-uniform: fill the target box exactly on every axis given. Only
      // for simple box-like parts (duct sections), where it looks right.
      holder.scale.set(
        target[0] > 0 ? target[0] / have[0] : uniform,
        target[1] > 0 ? target[1] / have[1] : uniform,
        target[2] > 0 ? target[2] / have[2] : uniform
      );
    } else {
      holder.scale.setScalar(uniform);
    }
    // Re-seat on the floor and centre after rotation and scale.
    holder.updateMatrixWorld(true);
    box.setFromObject(holder);
    const centre = box.getCenter(new THREE.Vector3());
    holder.position.set(-centre.x, -box.min.y, -centre.z);
    if (spec.align === "top") holder.position.y = -box.max.y;
    if (spec.align === "centre") holder.position.y = -centre.y;

    slot.add(holder);
    slot.userData.filled = true;
    slot.userData.model = holder;
    for (const p of slot.userData.placeholders ?? []) p.visible = false;
    filled += 1;
  }

  return filled;
}
