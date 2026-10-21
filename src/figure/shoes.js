/**
 * Shoes: what the figure has on its feet - the models' own clogs, or one of
 * the downloaded shoes (assets/meltdown/shoes/, made light by
 * tools/shoes/build.py) - one of them for each kit (src/figure/kits.js).
 *
 *   SHOES                            the styles (label, file, kit)
 *   buildShoes(kind, mesh, uniforms) -> a Group (null for the clogs), to add
 *                                    beside the body mesh; it fills in when
 *                                    the shoe has streamed in
 *   disposeShoes(group)
 *   savedShoes() / saveShoes(kind)
 *
 * The body is posed in its vertex shader (characters.js), so a shoe can't
 * ride a bone. Instead each one is placed round the model's own foot in its
 * rest pose (measureFeet) - scaled to the foot's length, the right foot in
 * the model, the left in its mirror image, baked into the geometry (the rig
 * poses the body's own coordinates) - and drawn with the same rig and
 * the same uniforms (rigMaterial): it walks, slides and jumps exactly as
 * the foot does. The clogs under it are hidden (the look shader).
 *
 * A shoe file streams in the first time anyone picks it (never at boot) and
 * is shared from then on.
 */

import * as THREE from "../three.js";
import { GLTFLoader } from "../three-addons.js";
import { measureFeet, rigMaterial } from "../levels/meltdown/characters.js";

/**
 * The styles. `file` under assets/meltdown/shoes/; `kit` unlocks it
 * (kits.js); `yaw` (rad) and `scale` straighten and size a file that came
 * out of tools/shoes/build.py a little off; `left`: the file's shoe is a
 * left one (it goes on the left foot, its mirror image on the right).
 */
export const SHOES = {
  clogs: { label: "Clogs" },
  aj1: { label: "Court lows", file: "aj1.glb" },
  skate: { label: "Skate shoes", file: "skate.glb" },
  nb574: { label: "Suede runners", file: "nb574.glb" },
  // The Escapee kit (finish the story) and the Fracture kit (the platinum).
  jordan: { label: "Escape runners", file: "jordan.glb", kit: "escapee", left: true },
  adidas: { label: "Platinum trainers", file: "adidas.glb", kit: "fracture" },
};

const KEY = "fractureRun.shoes";
/** How much longer than the bare foot a shoe is. */
const FIT = 1.08;

export function savedShoes() {
  try {
    const v = localStorage.getItem(KEY);
    if (v && SHOES[v]) return v;
  } catch {
    /* storage unavailable */
  }
  return "clogs";
}

export function saveShoes(kind) {
  if (!SHOES[kind]) return;
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    /* ignore */
  }
}

const BASE = new URL("../../assets/meltdown/shoes/", import.meta.url).href;
const loads = new Map();
const loader = new GLTFLoader();

/**
 * A shoe file, once: [{ geometry, mirror, material }] - its parts, in the
 * file's frame (toe toward +Z, sole on y = 0, one unit long), each with a
 * mirrored copy for the other foot.
 */
function loadShoe(file) {
  if (!loads.has(file)) {
    loads.set(file, loader.loadAsync(BASE + file).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
        parts.push({ geometry, mirror: mirrored(geometry), material: standard(o.material, geometry) });
      });
      return parts;
    }).catch((error) => {
      console.warn(`[shoes] ${file} failed to load`, error);
      return [];
    }));
  }
  return loads.get(file);
}

/** The geometry in a mirror (x flipped), its triangles turned back the right way out. */
function mirrored(geometry) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes)) {
      const n = attr.itemSize;
      const a = attr.array;
      for (let t = 0; t < attr.count; t += 3) {
        for (let k = 0; k < n; k += 1) [a[(t + 1) * n + k], a[(t + 2) * n + k]] = [a[(t + 2) * n + k], a[(t + 1) * n + k]];
      }
      attr.needsUpdate = true;
    }
  }
  return g;
}

/**
 * The file's material as a plain standard one (an unlit or spec-gloss one
 * too): the rig hooks the standard shader's normal pass.
 */
function standard(source, geometry) {
  const m = new THREE.MeshStandardMaterial({
    color: source.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    roughnessMap: source.roughnessMap ?? null,
    metalnessMap: source.metalnessMap ?? null,
    aoMap: source.aoMap ?? null,
    roughness: source.roughness ?? 0.75,
    metalness: source.metalness ?? 0,
    vertexColors: Boolean(geometry.attributes.color),
    alphaTest: source.alphaTest || (source.transparent ? 0.5 : 0),
    side: source.side ?? THREE.FrontSide,
  });
  if (source.normalScale) m.normalScale.copy(source.normalScale);
  return m;
}

/**
 * The pair round one body's feet: [{ geometry, material }] with each part
 * placed on each foot in the body's own coordinates. Once per file and body
 * model (every figure of that model shares the geometry).
 */
const fitted = new Map();
function fitShoes(style, bodyGeometry) {
  const file = style.file;
  const key = `${file}|${bodyGeometry.uuid}`;
  if (!fitted.has(key)) {
    fitted.set(key, loadShoe(file).then((parts) => {
      const feet = measureFeet(bodyGeometry);
      const out = [];
      for (const [f, side] of [[feet.right, "right"], [feet.left, "left"]]) {
        const length = (f.maxZ - f.minZ) * FIT;
        const size = length * (style.scale ?? 1);
        // The file's own shoe on its own foot; the mirror image on the other
        // (and turned the other way).
        const own = (side === "left") === Boolean(style.left);
        const turn = (style.yaw ?? 0) * (own ? 1 : -1);
        const place = new THREE.Matrix4().compose(
          new THREE.Vector3((f.minX + f.maxX) / 2, 0, (f.minZ + f.maxZ) / 2),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
          new THREE.Vector3(size, size, size),
        );
        for (const part of parts) out.push({ geometry: (own ? part.geometry : part.mirror).clone().applyMatrix4(place), material: part.material });
      }
      return out;
    }));
  }
  return fitted.get(key);
}

/**
 * The pair, for the body mesh `mesh` (CharacterMerged) posed by `uniforms`.
 * Null for the clogs (the model's own). It fills in once the file is in.
 */
export function buildShoes(kind, mesh, uniforms) {
  const style = SHOES[kind];
  if (!style?.file || !mesh?.geometry || !uniforms) return null;
  const feet = measureFeet(mesh.geometry);
  if (!Number.isFinite(feet.left.minX) || !Number.isFinite(feet.right.minX)) return null;
  const group = new THREE.Group();
  group.name = `shoes:${kind}`;
  // Beside the body mesh, in its frame.
  group.position.copy(mesh.position);
  group.quaternion.copy(mesh.quaternion);
  group.scale.copy(mesh.scale);
  group.userData.ready = fitShoes(style, mesh.geometry).then((parts) => {
    if (group.userData.disposed) return;
    for (const part of parts) {
      // A material per figure (the rig's uniforms are this figure's).
      const shoe = new THREE.Mesh(part.geometry, rigMaterial(part.material.clone(), uniforms, "-shoe"));
      // (The rig moves the vertices outside the rest-pose bounds.)
      shoe.frustumCulled = false;
      shoe.castShadow = false;
      group.add(shoe);
    }
    // (Nothing in the file, or it didn't load: the clogs stay on.)
    if (group.children.length) group.userData.onReady?.();
  });
  return group;
}

export function disposeShoes(group) {
  if (!group) return;
  group.userData.disposed = true;
  // (The geometry and textures are the shared file's; only the per-figure materials go.)
  group.traverse((o) => {
    if (o.isMesh) o.material.dispose();
  });
}
