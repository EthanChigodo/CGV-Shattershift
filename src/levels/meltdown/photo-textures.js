/**
 * Photographed PBR textures for the Labs and the Roof (Poly Haven, CC0 -
 * docs/credits.md): colour, OpenGL-convention normal and roughness maps at
 * 1K, in assets/meltdown/textures/.
 *
 * They load in the background and replace the drawn textures (textures.js)
 * when they arrive; if a file is missing, the drawn texture stays. A
 * material that will take one is made with neutral stand-ins for the maps
 * it doesn't have yet (`photoReady`), so swapping the photos in never
 * changes its shader - no recompile, no hitch mid-run.
 *
 *   const m = new THREE.MeshStandardMaterial(photoReady({ map: drawn, ... }));
 *   applyPhotoSet(m, "metal_plate", { repeat: [2, 1] });
 */

import * as THREE from "../../three.js";

const BASE = new URL("../../../assets/meltdown/textures/", import.meta.url);

/** Which photographed set goes on which surface. */
export const PHOTO_SETS = {
  wardWall: "long_white_tiles",
  steelWall: "metal_plate",
  concreteWall: "painted_concrete",
  floor: "concrete_floor_painted",
  roofing: "tarred_gravel",
};

const loader = new THREE.TextureLoader();
const cache = new Map();

/** One image, loaded once per page (null if it can't be). */
function loadImage(file, srgb) {
  if (!cache.has(file)) {
    cache.set(file, new Promise((resolve) => {
      loader.load(
        new URL(file, BASE).href,
        (t) => {
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 4;
          resolve(t);
        },
        undefined,
        () => resolve(null),
      );
    }));
  }
  return cache.get(file);
}

let flatNormal = null;
let white = null;
const pixel = (r, g, b) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
};

/**
 * Material parameters with neutral stand-ins for a normal map and a
 * roughness map where they have none, so the photos can replace them later
 * without changing the shader.
 */
export function photoReady(params) {
  flatNormal ??= pixel(128, 128, 255);
  white ??= pixel(255, 255, 255);
  return { normalMap: flatNormal, roughnessMap: white, ...params };
}

/**
 * Put a photographed set on a material when its files arrive.
 * @param {THREE.MeshStandardMaterial} material
 * @param {string} set              a Poly Haven id (PHOTO_SETS)
 * @param {object} [o]
 * @param {number[]} [o.repeat]     tiling (default: the drawn map's)
 * @param {boolean} [o.roughness]   take the photo's roughness too (default true)
 * @param {number} [o.normalScale]
 * @returns {Promise<boolean>} whether it was applied
 */
export async function applyPhotoSet(material, set, { repeat = null, roughness = true, normalScale = 1 } = {}) {
  const [diff, nor, rough] = await Promise.all([
    loadImage(`${set}_diff_1k.jpg`, true),
    loadImage(`${set}_nor_gl_1k.jpg`, false),
    roughness ? loadImage(`${set}_rough_1k.jpg`, false) : Promise.resolve(null),
  ]);
  if (!diff || !nor) return false;
  const tiling = repeat ?? (material.map ? [material.map.repeat.x, material.map.repeat.y] : [1, 1]);
  // A clone shares the image (one upload) but tiles on its own.
  const use = (t) => {
    const c = t.clone();
    c.repeat.set(tiling[0], tiling[1]);
    c.needsUpdate = true;
    return c;
  };
  material.map = use(diff);
  material.normalMap = use(nor);
  material.normalScale.setScalar(normalScale);
  if (rough && material.roughnessMap) {
    material.roughnessMap = use(rough);
    material.roughness = 1;
  }
  return true;
}
