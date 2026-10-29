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
import { buildCharacterTemplate, cloneCharacter } from "./characters.js";
import { buildHelicopterTemplate } from "./helicopter.js";
import { loadRiggedFor, riggedSlots } from "../../figure/rigged.js";
import { isTouch } from "../../ui/phone.js";

/**
 * How many models a phone or tablet loads at once. Every one unpacks its
 * pictures as it comes in; all of them at once is a spike of memory that a
 * phone can answer by taking the graphics away. Two at a time is barely
 * slower: the files still download in parallel with the unpacking. A
 * computer loads them all at once, as before.
 */
const PHONE_AT_ONCE = 2;

/**
 * Models that arrive as many small meshes sharing a few materials. Every mesh
 * is a draw call; the ventilation network alone is 79 of them. Merging by
 * material collapses each of these to a handful.
 */
/** Per model: names of nodes that are the exporter's helpers, not the model. */
const EXPORT_HELPERS = {
  launcher: /^(Box0\d+|Circle0\d+|camera\d*)$/,
};
const MERGE_BY_MATERIAL = new Set(["officeDesk", "launcher", "ventFan", "gadgetBrass", "gadgetCoil"]);

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
  // The duffel beside each sphere cache.
  duffelBag: "duffel_bag.glb",
  // People (see characters.js): normalised, atlas-merged, and rigged.
  patient: "patient.glb",
};

/**
 * Characters, and the profile each is prepared with. A slot whose role is in
 * assets/characters/manifest.json loads the team's rigged, animated model
 * instead (src/figure/rigged.js ROLE_SLOTS); `brute` exists only that way
 * (without it the roof's brute is a patient, scaled up).
 */
export const CHARACTER_ASSETS = {
  patient: { file: "patient.glb", profile: "patient" },
  playerFemale: { file: "player_female.glb", profile: "playerFemale" },
  playerMale: { file: "player_male.glb", profile: "playerMale" },
  scientistRadioman: { file: "scientist_radioman.glb", profile: "scientistRadioman" },
  scientistRust: { file: "scientist_rust.glb", profile: "scientistRust" },
  scientistGood: { file: "scientist_good.glb", profile: "scientistGood" },
  scientistEvil: { file: "scientist_evil.glb", profile: "scientistEvil" },
  brute: { file: null, profile: null },
};

/**
 * Phase B (the roof) only: the rescue helicopter and the scientists'
 * gadgets. Loaded in the background during Phase A.
 */
export const ROOF_ASSETS = {
  helicopter: "helicopter.glb",
  gadgetBrass: "steampunk_weapon.glb",
  gadgetCoil: "weapon.glb",
};

/**
 * The second batch of supplied models (tools/assets/README.md): props and
 * sets for the story and the later levels, loaded by name where they're used.
 */
export const EXTRA_ASSETS = {
  // The sphere bag Dr. Okoro hands over in the Foundry; worn from then on.
  backpack: "backpack.glb",
  // Police helicopters over the Skyline, and the prologue.
  policeHelicopter: "police_helicopter.glb",
  // The city skyline at night (the prologue, the Skyline's backdrop).
  cityNight: "city_night.glb",
  // The operating theatre (the prologue).
  operatingRoom: "operating_room.glb",
};

/** Loaded once per page and shared by every level instance (and a restart). */
const cache = new Map();

/** Every asset key requested so far this page (for the credits check). */
export function loadedAssetNames() {
  return [...cache.keys()];
}

/**
 * Load every asset. Each result is a template Group whose origin sits at the
 * model's bottom-centre, plus its size, so slots can fit it without caring
 * where the source file put its pivot.
 * @returns {Promise<Map<string, {template: THREE.Group, size: THREE.Vector3}>>}
 */
/**
 * Takes the pieces of a mesh that touch nothing else (islands: triangles
 * sharing no corner with the rest) out of it when they are smaller than
 * `size` (the longest side of their box, in the model's world units).
 */
function dropSmallIslands(mesh, size) {
  const geometry = mesh.geometry, pos = geometry.attributes.position;
  // (Unindexed: every three vertices a triangle - indexed in order.)
  if (!geometry.index) geometry.setIndex([...Array(pos.count).keys()]);
  const index = geometry.index;
  // Corners by where they are (a model's seams split vertices that touch).
  const at = new Map(), parent = [];
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const corner = (i) => {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!at.has(key)) { at.set(key, parent.length); parent.push(parent.length); }
    return at.get(key);
  };
  const ids = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) ids[i] = corner(i);
  for (let t = 0; t < index.count; t += 3) {
    const a = find(ids[index.getX(t)]);
    parent[find(ids[index.getX(t + 1)])] = a;
    parent[find(ids[index.getX(t + 2)])] = a;
  }
  const boxes = new Map(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    const root = find(ids[i]);
    if (!boxes.has(root)) boxes.set(root, new THREE.Box3());
    boxes.get(root).expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  }
  const small = new Set();
  for (const [root, box] of boxes) {
    box.getSize(v);
    if (Math.max(v.x, v.y, v.z) < size) small.add(root);
  }
  if (!small.size || small.size === boxes.size) return;
  const kept = [];
  for (let t = 0; t < index.count; t += 3) {
    if (small.has(find(ids[index.getX(t)]))) continue;
    kept.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
  }
  geometry.setIndex(kept);
}

export async function loadMeltdownAssets(baseUrl, { onProgress, names } = {}) {
  const loader = new GLTFLoader();
  const wanted = names ?? Object.keys(MELTDOWN_ASSETS);
  // Rigged characters (an empty manifest: none, and nothing changes).
  const rigged = wanted.some((name) => CHARACTER_ASSETS[name]) ? await riggedSlots() : new Set();
  const entries = wanted
    .map((name) => [name, CHARACTER_ASSETS[name]?.file ?? MELTDOWN_ASSETS[name] ?? ROOF_ASSETS[name] ?? EXTRA_ASSETS[name] ?? (rigged.has(name) ? "(rigged)" : null)])
    .filter(([name, file]) => file || rigged.has(name));
  const assets = new Map();
  let done = 0;

  const queue = entries.slice();
  const worker = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) await loadEntry(entry);
  };
  const loadEntry = async ([name, file]) => {
    try {
      if (!cache.has(name)) cache.set(name, loadOne(loader, baseUrl, name, file));
      const asset = await cache.get(name);
      if (asset) assets.set(name, asset);
    } catch (error) {
      cache.delete(name);
      console.warn(`[meltdown] asset "${name}" failed to load, keeping stand-in`, error);
    } finally {
      done += 1;
      onProgress?.(done / entries.length, name);
    }
  };
  const atOnce = isTouch() ? PHONE_AT_ONCE : queue.length;
  await Promise.all(Array.from({ length: Math.min(atOnce, queue.length) }, worker));

  return assets;
}

async function loadOne(loader, baseUrl, name, file) {
  const character = CHARACTER_ASSETS[name];
  if (character) {
    // The team's rigged, animated version first; today's model if it isn't there.
    const template = await loadRiggedFor(name).catch((error) => {
      console.warn(`[meltdown] rigged "${name}" failed, keeping today's model`, error);
      return null;
    });
    if (template) {
      const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
      size.y = template.userData.character.height;
      return { template, size, character: true, rigged: true };
    }
    if (!character.file) return null;
  }
  const gltf = await loader.loadAsync(new URL(file, baseUrl).href);
  if (character) {
    const template = buildCharacterTemplate(gltf.scene, character.profile);
    template.name = `Character_${name}`;
    const size = new THREE.Box3().setFromObject(template, true).getSize(new THREE.Vector3());
    size.y = template.userData.character.height;
    return { template, size, character: true };
  }
  if (name === "helicopter") {
    const template = buildHelicopterTemplate(gltf.scene);
    return { template, size: template.userData.helicopter.size.clone() };
  }
  let scene = gltf.scene;
  // Helpers the modelling program exported along with the model (its
  // cameras' target circles, layout boxes): never part of it. They floated
  // round the launcher as squares and circles (lecturer's feedback).
  const helpers = EXPORT_HELPERS[name];
  if (helpers) {
    const strays = [];
    scene.traverse((o) => { if (o !== scene && helpers.test(o.name)) strays.push(o); });
    for (const o of strays) o.removeFromParent();
  }
  // The launcher: without the sight - its box, its cable and the little
  // brackets that held it, every "Material #3" piece - nor the knob and the
  // two thin discs by the rear ring (Object002, and the grip mesh's small
  // loose islands). They float beside the tube: the stray squares and
  // circles of the lecturer's feedback. The tube, its grip, straps and end
  // rings stay.
  if (name === "launcher") {
    const loose = [];
    scene.traverse((o) => { if (o.isMesh && (o.material?.name === "Material #3" || o.name === "Object002")) loose.push(o); });
    for (const o of loose) o.removeFromParent();
    scene.updateMatrixWorld(true);
    scene.traverse((o) => { if (o.isMesh && o.material?.name === "Material #2") dropSmallIslands(o, 0.4); });
  }
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
  return { template, size };
}

/** A fresh, independently posable copy of a loaded character. */
export function instantiateCharacter(asset) {
  return cloneCharacter(asset.template);
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

    if (asset.character) {
      // People keep their real height and their own skeleton; they are
      // placed feet-down at the slot, facing the slot's +Z.
      const person = cloneCharacter(asset.template);
      if (spec.rotateY) person.rotation.y = spec.rotateY;
      if (spec.size?.[1] > 0) person.scale.setScalar(spec.size[1] / asset.size.y);
      slot.add(person);
      slot.userData.filled = true;
      slot.userData.model = person;
      for (const p of slot.userData.placeholders ?? []) p.visible = false;
      slot.userData.onFilled?.(person);
      filled += 1;
      continue;
    }

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
    slot.userData.onFilled?.(holder);
    filled += 1;
  }

  return filled;
}
