/**
 * People for Level 3: the player, the test-subject patients, and the
 * scientists on the roof.
 *
 * The supplied character models arrive in four different conventions (Z-up
 * and Y-up, metres and centimetres, T-pose and A-pose, Mixamo / Valve biped /
 * custom skeletons, one to eleven materials each) and none of them has an
 * animation clip. This file turns each one into the same thing:
 *
 *   1. `prepareCharacter` - stands the model up, faces it down +Z, scales it
 *      to a real height with its feet on y = 0, and repairs broken bones.
 *   2. `atlasMerge` - bakes every material's colour texture into one runtime
 *      atlas and merges every mesh into ONE (skinned or static) mesh, so a
 *      character costs one draw call instead of up to eleven. The player's
 *      patient-scrubs recolour happens here, on the atlas canvas.
 *   3. `HumanoidRig` - procedural animation for any skeleton. Bones are found
 *      by name, and every rotation is authored in *model space* then converted
 *      into each bone's own local frame, so one run cycle drives a Mixamo rig
 *      and a Valve biped alike without per-rig tuning.
 *   4. `playerBodyMaterial` - the player models are not rigged at all, so
 *      their "skeleton" lives in the vertex shader instead: legs, arms and
 *      torso are rotated about hip/knee/shoulder pivots measured from the
 *      mesh itself.
 */

import * as THREE from "../../three.js";
import { BufferGeometryUtils, SkeletonUtils } from "../../three-addons.js";

/* ------------------------------------------------------------------ */
/* Profiles                                                             */
/* ------------------------------------------------------------------ */

const SCRUBS = "#3f8f88";

/**
 * Per-model corrections. `rotateX` stands a Z-up export upright; `height` is
 * the real standing height in metres (the source files' units are not
 * trustworthy); `recolor` maps source material names to atlas painters.
 */
export const CHARACTER_PROFILES = {
  patient: { rotateX: Math.PI / 2, height: 1.74, repairBones: true },
  scientistRadioman: { rotateX: Math.PI / 2, height: 1.82 },
  scientistRust: { rotateX: 0, height: 1.84 },
  playerFemale: {
    rotateX: 0,
    height: 1.68,
    static: true,
    recolor: { material: "scrubTop", Bottom: "scrubTrousers", Shoes: "clogs" },
  },
  playerMale: {
    rotateX: 0,
    height: 1.8,
    static: true,
    recolor: { material: "scrubTop", Bottom: "scrubTrousers", Shoes: "clogs" },
  },
};

/** Canvas painters applied over a material's atlas cell. */
const PAINTERS = {
  // The shirt texture is near-white with fabric shading, so a multiply turns
  // it into dyed cotton and keeps every fold.
  scrubTop(ctx, x, y, w, h) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = SCRUBS;
    ctx.fillRect(x, y, w, h);
  },
  // The trousers are near-black: lift them to a mid grey first (screen keeps
  // the seams), then dye them to match the top.
  scrubTrousers(ctx, x, y, w, h) {
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "#b8b8b8";
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = SCRUBS;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(x, y, w, h);
  },
  // Office shoes become pale hospital clogs.
  clogs(ctx, x, y, w, h) {
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "#8a9a98";
    ctx.fillRect(x, y, w, h);
  },
};

/* ------------------------------------------------------------------ */
/* Preparation                                                          */
/* ------------------------------------------------------------------ */

function collectBones(root) {
  const bones = [];
  root.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  return bones;
}

/**
 * Some exports carry a handful of bones in the wrong unit (the patient's
 * hands sit 200 m from their wrists). A bone whose offset from its parent is
 * twenty times the typical offset is scaled back down by 100.
 */
function repairBones(root) {
  const bones = collectBones(root);
  const lengths = bones.map((b) => b.position.length()).filter((v) => v > 0).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] || 1;
  let fixed = 0;
  for (const bone of bones) {
    if (bone.position.length() > median * 20) {
      bone.position.multiplyScalar(0.01);
      fixed += 1;
    }
  }
  // The bind inverses already expect the corrected offsets (the export
  // wrote the bad unit into these bones' local positions only), so there is
  // nothing to rebind.
  return fixed;
}

/** The standing box of a character: from its bones if skinned, else its mesh. */
function standingBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  const body = /hips|pelvis|spine|torso|neck|head|leg|thigh|calf|foot|toe/i;
  const bones = collectBones(root).filter((b) => body.test(b.name) && !/end/i.test(b.name));
  if (bones.length >= 6) {
    for (const bone of bones) box.expandByPoint(bone.getWorldPosition(p));
    // The head bone sits at the base of the skull, not the crown.
    box.max.y += (box.max.y - box.min.y) * 0.075;
    box.min.y -= (box.max.y - box.min.y) * 0.02;
    return box;
  }
  return box.setFromObject(root, true);
}

/**
 * Normalise a loaded glTF scene. Returns a Group whose local space is: feet
 * on y = 0, centred on x/z, facing +Z, `height` metres tall.
 */
export function prepareCharacter(scene, profile) {
  if (profile.repairBones) repairBones(scene);

  const inner = new THREE.Group();
  inner.add(scene);
  inner.rotation.x = profile.rotateX ?? 0;
  inner.rotation.y = profile.rotateY ?? 0;

  const holder = new THREE.Group();
  holder.add(inner);
  const box = standingBox(holder);
  const scale = profile.height / Math.max(1e-4, box.max.y - box.min.y);
  holder.scale.setScalar(scale);
  const scaled = standingBox(holder);
  const centre = scaled.getCenter(new THREE.Vector3());
  holder.position.set(-centre.x, -scaled.min.y, -centre.z);

  const root = new THREE.Group();
  root.add(holder);
  root.updateMatrixWorld(true);
  return root;
}

/* ------------------------------------------------------------------ */
/* Atlas merge                                                          */
/* ------------------------------------------------------------------ */

function linearToSrgbHex(color) {
  const c = color.clone();
  c.convertLinearToSRGB?.();
  return `#${c.getHexString()}`;
}

/**
 * Paint every source material into one canvas atlas and merge every mesh
 * into one. Returns the merged Mesh/SkinnedMesh (replacing the originals in
 * `root`), or null if the model cannot be merged (more than one skeleton).
 */
export function atlasMerge(root, { recolor = {}, roughness = 0.78 } = {}) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes.position) meshes.push(o);
  });
  if (!meshes.length) return null;

  const skinned = meshes.filter((m) => m.isSkinnedMesh);
  if (skinned.length && skinned.length !== meshes.length) return null;
  const skeletons = new Set(skinned.map((m) => m.skeleton.bones[0]));
  if (skeletons.size > 1) return null;

  // One cell per distinct material.
  const materials = [];
  for (const m of meshes) {
    const material = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!materials.includes(material)) materials.push(material);
  }
  const n = materials.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = n <= 4 ? 512 : 256;
  const pad = 4;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d");
  let hasAlpha = false;

  const cellOf = new Map();
  materials.forEach((material, index) => {
    const cx = (index % cols) * cell;
    const cy = Math.floor(index / cols) * cell;
    cellOf.set(material, { cx, cy });
    ctx.globalCompositeOperation = "source-over";
    const image = material.map?.image;
    if (image && (image.width || image.videoWidth)) {
      // Bleed: the whole cell first, then the padded interior, so mip
      // filtering at a cell's edge samples its own colours, not a neighbour.
      ctx.drawImage(image, cx, cy, cell, cell);
      ctx.drawImage(image, cx + pad, cy + pad, cell - pad * 2, cell - pad * 2);
      const c = material.color;
      if (c && (c.r < 0.99 || c.g < 0.99 || c.b < 0.99)) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = linearToSrgbHex(c);
        ctx.fillRect(cx, cy, cell, cell);
      }
      if (material.alphaTest > 0 || material.transparent) hasAlpha = true;
    } else {
      ctx.fillStyle = material.color ? linearToSrgbHex(material.color) : "#808080";
      ctx.fillRect(cx, cy, cell, cell);
    }
    const painter = PAINTERS[recolor[material.name]];
    if (painter) painter(ctx, cx, cy, cell, cell);
    // Put the source alpha back: the multiply/screen fills above wrote
    // opaque pixels over what may have been cut-out hair strands.
    // destination-in clears everything outside what it draws, so clip it to
    // this cell or it wipes the rest of the atlas.
    if (image && hasAlpha) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cell, cell);
      ctx.clip();
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(image, cx, cy, cell, cell);
      ctx.drawImage(image, cx + pad, cy + pad, cell - pad * 2, cell - pad * 2);
      ctx.restore();
    }
  });
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // glTF UV convention
  texture.anisotropy = 4;

  // Geometry: bake every mesh into the reference mesh's frame.
  const reference = skinned[0] ?? null;
  const toReference = new THREE.Matrix4();
  const invReference = reference ? reference.bindMatrix.clone().invert() : root.matrixWorld.clone().invert();
  const parts = [];
  for (const m of meshes) {
    const material = Array.isArray(m.material) ? m.material[0] : m.material;
    const { cx, cy } = cellOf.get(material);
    let g = m.geometry.clone();
    if (reference) toReference.multiplyMatrices(invReference, m.bindMatrix);
    else toReference.multiplyMatrices(invReference, m.matrixWorld);
    g.applyMatrix4(toReference);

    const keep = reference ? ["position", "normal", "uv", "skinIndex", "skinWeight"] : ["position", "normal", "uv"];
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    for (const name of Object.keys(g.morphAttributes)) delete g.morphAttributes[name];
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = g.attributes.position.count;
    const uvIn = g.attributes.uv;
    const uv = new Float32Array(count * 2);
    let wraps = false;
    if (uvIn) {
      for (let i = 0; i < count; i += 1) {
        const u = uvIn.getX(i);
        const v = uvIn.getY(i);
        if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) wraps = true;
      }
    }
    const inner = cell - pad * 2;
    for (let i = 0; i < count; i += 1) {
      let u = uvIn ? uvIn.getX(i) : 0.5;
      let v = uvIn ? uvIn.getY(i) : 0.5;
      if (wraps) {
        u -= Math.floor(u);
        v -= Math.floor(v);
      } else {
        u = THREE.MathUtils.clamp(u, 0, 1);
        v = THREE.MathUtils.clamp(v, 0, 1);
      }
      uv[i * 2] = (cx + pad + u * inner) / canvas.width;
      uv[i * 2 + 1] = (cy + pad + v * inner) / canvas.height;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    if (reference) {
      const si = g.attributes.skinIndex;
      const sw = g.attributes.skinWeight;
      const index = new Uint16Array(count * 4);
      const weight = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        for (let k = 0; k < 4; k += 1) {
          index[i * 4 + k] = si ? si.getComponent(i, k) : 0;
          weight[i * 4 + k] = sw ? sw.getComponent(i, k) : k === 0 ? 1 : 0;
        }
      }
      g.setAttribute("skinIndex", new THREE.BufferAttribute(index, 4));
      g.setAttribute("skinWeight", new THREE.BufferAttribute(weight, 4));
    }
    if (!g.index) {
      const idx = new Uint32Array(count);
      for (let i = 0; i < count; i += 1) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    } else if (!(g.index.array instanceof Uint32Array)) {
      g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
    }
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      if (a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array || a.array instanceof Uint16Array)) {
        const array = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i += 1) for (let k = 0; k < a.itemSize; k += 1) array[i * a.itemSize + k] = a.getComponent(i, k);
        g.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize));
      }
    }
    parts.push(g);
  }
  const geometry = BufferGeometryUtils.mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!geometry) return null;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness,
    metalness: 0.02,
    alphaTest: hasAlpha ? 0.45 : 0,
    side: hasAlpha ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.envMapIntensity = 0.35;

  let merged;
  if (reference) {
    merged = new THREE.SkinnedMesh(geometry, material);
    reference.parent.add(merged);
    merged.position.copy(reference.position);
    merged.quaternion.copy(reference.quaternion);
    merged.scale.copy(reference.scale);
    merged.bind(reference.skeleton, reference.bindMatrix);
  } else {
    merged = new THREE.Mesh(geometry, material);
    root.add(merged);
  }
  merged.name = "CharacterMerged";
  merged.frustumCulled = !reference; // skinned bounds do not follow the pose
  for (const m of meshes) m.parent?.remove(m);
  for (const m of materials) m.dispose?.();
  merged.userData.atlas = texture;
  return merged;
}

/**
 * Full pipeline for one loaded glTF scene: normalise, merge, and (for the
 * unrigged player models) bake to a plain metres-space static geometry that
 * the vertex-shader rig can reason about.
 */
export function buildCharacterTemplate(scene, profileName) {
  const profile = CHARACTER_PROFILES[profileName];
  const root = prepareCharacter(scene, profile);
  const merged = atlasMerge(root, { recolor: profile.recolor ?? {} });
  if (profile.static && merged && !merged.isSkinnedMesh) {
    // Bake the whole normalising transform into the vertices: the player
    // shader measures hips and shoulders in metres, in this frame.
    root.updateMatrixWorld(true);
    merged.geometry.applyMatrix4(merged.matrixWorld);
    merged.geometry.computeBoundingBox();
    merged.geometry.computeBoundingSphere();
    const clean = new THREE.Group();
    const mesh = new THREE.Mesh(merged.geometry, merged.material);
    mesh.name = "CharacterMerged";
    mesh.userData.atlas = merged.userData.atlas;
    clean.add(mesh);
    clean.userData.character = { profile: profileName, skinned: false, height: profile.height };
    return clean;
  }
  root.userData.character = { profile: profileName, skinned: Boolean(merged?.isSkinnedMesh), height: profile.height };
  return root;
}

/** Clone a character template; skinned ones need their own skeleton. */
export function cloneCharacter(template) {
  const clone = template.userData.character?.skinned ? SkeletonUtils.clone(template) : template.clone(true);
  clone.userData.character = { ...template.userData.character };
  return clone;
}

/* ------------------------------------------------------------------ */
/* Procedural rig                                                       */
/* ------------------------------------------------------------------ */

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function cleanName(name) {
  return name
    .toLowerCase()
    .replace(/^mixamorig:?/, "")
    .replace(/^valvebiped\.?bip01_?/, "")
    .replace(/_\d+(_\d+)?$/, "");
}

function sideOf(name) {
  // GLTFLoader strips "." from node names, so "Leg1.L" arrives as "leg1l".
  const suffix = name.match(/^(leg1|leg2|foot|shoulder|arm1|arm2|hand|toes)(l|r)$/);
  if (suffix) return suffix[2].toUpperCase();
  if (/(^|[._])l([._]|$)|^left|_l_|\.l$|^l_/.test(name)) return "L";
  if (/(^|[._])r([._]|$)|^right|_r_|\.r$|^r_/.test(name)) return "R";
  return null;
}

/** Find the standard humanoid bones by name, whatever the rig's convention. */
function mapBones(root) {
  const map = {};
  const bones = collectBones(root);
  for (const bone of bones) {
    const n = cleanName(bone.name);
    if (/end$|_end|roll|twist|attachment|finger|thumb|index|middle|ring|pinky|toe|tie|jaw|eye|hair/.test(n)) continue;
    const side = sideOf(n);
    const set = (key) => {
      if (!map[key]) map[key] = bone;
    };
    if (/hips|pelvis/.test(n)) set("hips");
    else if (/spine|torso/.test(n)) (map.spine ??= []).push(bone);
    else if (/neck/.test(n)) set("neck");
    else if (/head/.test(n) && !/top/.test(n)) set("head");
    else if (side) {
      if (/upleg|thigh|leg1/.test(n)) set(`thigh${side}`);
      else if (/calf|leg2|(left|right)leg$|^leg$/.test(n) || /(^|[^p])leg$/.test(n)) set(`calf${side}`);
      else if (/foot/.test(n)) set(`foot${side}`);
      else if (/clavicle|shoulder/.test(n)) set(`clavicle${side}`);
      else if (/forearm|arm2/.test(n)) set(`forearm${side}`);
      else if (/upperarm|arm1|(left|right)arm$|^arm$|(^|_)arm$/.test(n)) set(`arm${side}`);
      else if (/hand/.test(n)) set(`hand${side}`);
    }
  }
  if (map.spine) {
    map.spineLow = map.spine[0];
    map.chest = map.spine[map.spine.length - 1];
  }
  return map;
}

/**
 * Procedural animation for any humanoid skeleton.
 *
 * Every rotation is written in the character's rest *model* frame (x = the
 * character's left-to-right... specifically +X, y up, +Z forward), then
 * converted to the bone's local frame with that bone's rest parent rotation:
 *
 *   local = restParent^-1 * R * restParent * restLocal
 *
 * which makes R act on the bone exactly as a model-space rotation would. So
 * "swing the thigh forward about X" means the same thing on every rig.
 */
export class HumanoidRig {
  constructor(root) {
    this.root = root;
    this.bones = mapBones(root);
    this.valid = Boolean(this.bones.hips && this.bones.thighL && this.bones.thighR);
    this.state = new Map();
    root.updateMatrixWorld(true);
    const rootInverse = new THREE.Quaternion();
    root.getWorldQuaternion(rootInverse).invert();

    const restWorld = (object) => object.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInverse);
    for (const [key, value] of Object.entries(this.bones)) {
      if (!value || Array.isArray(value)) continue;
      const bone = value;
      const parentRest = bone.parent ? restWorld(bone.parent) : new THREE.Quaternion();
      this.state.set(key, {
        bone,
        restLocal: bone.quaternion.clone(),
        restPosition: bone.position.clone(),
        parentRest,
        parentRestInverse: parentRest.clone().invert(),
        R: new THREE.Quaternion(),
      });
    }

    // Rest directions of the limbs in model space, to lower T/A-posed arms
    // and to find each hinge's bending axis whatever the rest pose.
    const worldPos = (bone) => {
      const p = bone.getWorldPosition(new THREE.Vector3());
      return root.worldToLocal(p);
    };
    this.lower = {};
    this.hinge = {};
    for (const side of ["L", "R"]) {
      const arm = this.bones[`arm${side}`];
      const fore = this.bones[`forearm${side}`];
      const hand = this.bones[`hand${side}`];
      if (arm && fore) {
        const dir = worldPos(fore).sub(worldPos(arm)).normalize();
        const out = Math.sign(dir.x) || (side === "L" ? 1 : -1);
        const target = new THREE.Vector3(out * 0.2, -1, 0.04).normalize();
        this.lower[side] = new THREE.Quaternion().setFromUnitVectors(dir, target);
        this.armOut = this.armOut ?? {};
        this.armOut[side] = out;
        if (hand) {
          const foreDir = worldPos(hand).sub(worldPos(fore)).normalize();
          this.hinge[`elbow${side}`] = new THREE.Vector3().crossVectors(foreDir, Z).normalize();
        }
      }
      const thigh = this.bones[`thigh${side}`];
      const calf = this.bones[`calf${side}`];
      if (thigh && calf) {
        this.hinge[`knee${side}`] = X.clone();
      }
    }
    // Legs: which way is "left" in model space for this rig.
    this.legSide = {};
    for (const side of ["L", "R"]) {
      const thigh = this.bones[`thigh${side}`];
      if (thigh) this.legSide[side] = Math.sign(worldPos(thigh).x) || (side === "L" ? 1 : -1);
    }
    this.hipHeight = this.bones.hips ? worldPos(this.bones.hips).y : 1;
  }

  /** Reset every bone's model-space rotation to identity (the rest pose). */
  reset() {
    for (const s of this.state.values()) s.R.identity();
    return this;
  }

  /** Pre-multiply a model-space rotation onto a bone. */
  rotate(key, axis, angle) {
    const s = this.state.get(key);
    if (!s || !angle) return this;
    _q.setFromAxisAngle(axis, angle);
    s.R.premultiply(_q);
    return this;
  }

  rotateQ(key, q) {
    const s = this.state.get(key);
    if (s) s.R.premultiply(q);
    return this;
  }

  /** Write the accumulated rotations into the bones. */
  apply() {
    for (const s of this.state.values()) {
      s.bone.quaternion.copy(s.parentRestInverse).multiply(s.R).multiply(s.parentRest).multiply(s.restLocal);
    }
    return this;
  }

  /** Arms hanging at the sides (from T or A pose). */
  armsDown(amount = 1) {
    for (const side of ["L", "R"]) {
      const q = this.lower[side];
      if (!q) continue;
      _q2.identity().slerp(q, amount);
      this.rotateQ(`arm${side}`, _q2);
    }
    return this;
  }

  /**
   * One pose from a small set of parameters, all angles in radians:
   *   stride    thigh swing amplitude, phase drives it
   *   knee      extra knee bend on the back-swing
   *   armSwing  arm swing amplitude (opposite to the legs)
   *   lean      whole-torso forward lean
   *   reach     arms raised forward (the patients' lurch)
   *   aimR      right arm raised to point forward (a scientist firing)
   *   headTilt  head roll, headNod forward nod
   *   crouch    hips down + knees bent
   */
  pose({ phase = 0, stride = 0, knee = 0, armSwing = 0, lean = 0, reach = 0, aimR = 0, aimL = 0, headTilt = 0, headNod = 0, crouch = 0, elbow = 0.25, twist = 0, spread = 0 } = {}) {
    this.reset();
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    for (const side of ["L", "R"]) {
      const sign = side === "L" ? 1 : -1;
      const swing = s * sign;
      // Thigh swings about X; the knee folds on the back-swing and when crouched.
      this.rotate(`thigh${side}`, X, -swing * stride - crouch * 0.9);
      const bend = Math.max(0, -Math.sin(phase * 1 + (side === "L" ? 0 : Math.PI) + 0.9)) * knee + crouch * 1.6;
      this.rotate(`calf${side}`, X, bend);
      this.rotate(`foot${side}`, X, -crouch * 0.6);
      this.rotate(`thigh${side}`, Z, (this.legSide[side] ?? sign) * spread);

      // Arms: lower from the rest pose, then swing/reach/aim about X. An arm
      // swings against its own side's leg.
      const q = this.lower[side];
      if (q) this.rotateQ(`arm${side}`, q);
      const aim = side === "R" ? aimR : aimL;
      const armPitch = -swing * armSwing + reach * 1.35 + aim * 1.45;
      this.rotate(`arm${side}`, X, -armPitch);
      const hinge = this.hinge[`elbow${side}`];
      if (hinge) this.rotate(`forearm${side}`, hinge, (elbow + Math.max(0, -swing) * armSwing * 0.6) * (aim > 0.5 ? 0.2 : 1));
    }
    this.rotate("spineLow", X, lean * 0.45 + crouch * 0.2);
    this.rotate("chest", X, lean * 0.35);
    this.rotate("chest", Y, twist + c * armSwing * 0.12);
    this.rotate("neck", X, headNod * 0.5 - lean * 0.3);
    this.rotate("head", X, headNod * 0.5 - lean * 0.2);
    this.rotate("head", Z, headTilt);
    return this.apply();
  }
}

/* ------------------------------------------------------------------ */
/* The player: a vertex-shader rig for an unrigged mesh                 */
/* ------------------------------------------------------------------ */

/**
 * Measure the joints of a T-posed static body (metres, feet on y = 0,
 * facing +Z): shoulder and hip pivots come from the mesh's own silhouette.
 */
function measureBody(geometry) {
  const pos = geometry.attributes.position;
  let top = 0;
  for (let i = 0; i < pos.count; i += 1) top = Math.max(top, pos.getY(i));
  // Torso half-width just under the armpit: the widest point at 68% height
  // is the chest, because the T-posed arms are higher than that.
  let chest = 0;
  let armY = 0;
  let armN = 0;
  let reach = 0;
  for (let i = 0; i < pos.count; i += 1) {
    const x = Math.abs(pos.getX(i));
    const y = pos.getY(i);
    if (y > top * 0.64 && y < top * 0.7) chest = Math.max(chest, x);
    if (x > top * 0.3) {
      armY += y;
      armN += 1;
      reach = Math.max(reach, x);
    }
  }
  const shoulderX = Math.max(0.15, chest * 1.18);
  const shoulderY = armN ? armY / armN : top * 0.82;
  return {
    height: top,
    hipY: top * 0.53,
    kneeY: top * 0.285,
    shoulderX,
    shoulderY,
    elbowX: shoulderX + (reach - shoulderX) * 0.45,
    armLength: reach - shoulderX,
  };
}

const PLAYER_RIG_VERTEX = /* glsl */ `
  uniform float uPhase;
  uniform float uStride;
  uniform float uArmSwing;
  uniform float uLean;
  uniform float uCrouch;
  uniform float uTuck;
  uniform float uHold;
  uniform float uReachUp;
  uniform float uHipY;
  uniform float uKneeY;
  uniform float uShoulderX;
  uniform float uShoulderY;
  uniform float uElbowX;
  uniform float uArmDrop;

  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

  // Rotate point p (and its normal n) about a pivot.
  void turn(inout vec3 p, inout vec3 n, vec3 pivot, mat3 r) {
    p = r * (p - pivot) + pivot;
    n = r * n;
  }
`;

const PLAYER_RIG_MAIN = /* glsl */ `
  vec3 rigP = transformed;
  vec3 rigN = objectNormal;
  float ax = abs(rigP.x);
  float side = rigP.x >= 0.0 ? 1.0 : -1.0;

  // ---- Arms (T-pose): elbow bend, lower to the sides, then swing. ----
  // Arm vertices are outboard of the shoulder AND at shoulder height: the
  // height gate keeps the chest from being dragged along with the arm.
  float armW = smoothstep(uShoulderX - 0.03, uShoulderX + 0.07, ax) * smoothstep(uShoulderY - 0.2, uShoulderY - 0.09, rigP.y);
  if (armW > 0.0) {
    // Two-handed shoulder-launcher hold: the right hand (model -X) on the
    // grip just under the tube, elbow tucked; the left arm reaching forward
    // and across to cradle the tube further out. uReachUp raises both arms
    // overhead (hanging from, and climbing, the ladder).
    bool right = side < 0.0;
    float free = (1.0 - uHold) * (1.0 - uReachUp);
    float swing = -sin(uPhase) * side * uArmSwing * free;
    float fold = right ? 0.35 + uHold * 1.5 : 0.35 + uHold * 0.2;
    float pitch = right ? uHold * 0.95 : uHold * 1.5;
    float inward = right ? uHold * 0.12 : uHold * 0.42;
    fold = fold * (1.0 - uReachUp * 0.85) + max(0.0, swing) * 0.5;
    pitch += uReachUp * 2.75;
    float elbowW = smoothstep(uElbowX - 0.05, uElbowX + 0.05, ax);
    vec3 elbow = vec3(side * uElbowX, uShoulderY, 0.0);
    // Forearm folds forward (about Y in the T-pose frame).
    turn(rigP, rigN, elbow, rotY(-side * fold * elbowW));
    vec3 shoulder = vec3(side * uShoulderX, uShoulderY, 0.0);
    // Drop the arm to the side (about Z), weighted so the shoulder seam blends.
    turn(rigP, rigN, shoulder, rotZ(-side * uArmDrop * armW));
    // Swing / raise (about X), then bring the arm in across the body (about Y).
    turn(rigP, rigN, shoulder, rotX((-swing - pitch) * armW));
    turn(rigP, rigN, shoulder, rotY(-side * inward * armW));
  }

  // ---- Legs: knee then hip, per side, blended across the crotch. ----
  float legW = 1.0 - smoothstep(uHipY - 0.06, uHipY + 0.04, rigP.y);
  if (legW > 0.0) {
    // Blend across the crotch only near the hips; lower down the legs are
    // separate, so split them hard or the inner seams stretch into a skirt.
    float legSide = mix(clamp(rigP.x / 0.05, -1.0, 1.0), rigP.x >= 0.0 ? 1.0 : -1.0, smoothstep(uHipY - 0.08, uHipY - 0.2, rigP.y));
    float swing = sin(uPhase) * legSide;
    float kneeW = 1.0 - smoothstep(uKneeY - 0.04, uKneeY + 0.04, rigP.y);
    float back = max(0.0, -sin(uPhase + (legSide >= 0.0 ? 0.0 : 3.14159) + 0.9));
    float kneeBend = (back * 1.25 * uStride + uCrouch * 1.5 + uTuck * 1.6) * kneeW * abs(legSide);
    turn(rigP, rigN, vec3(rigP.x, uKneeY, 0.0), rotX(kneeBend));
    float hip = (-swing * uStride * 0.75 - uCrouch * 0.8 - uTuck * 1.1) * legW;
    turn(rigP, rigN, vec3(rigP.x, uHipY, 0.0), rotX(hip));
  }

  // ---- Torso lean from the hips, and the whole body dropping into a slide. ----
  float torsoW = smoothstep(uHipY - 0.05, uHipY + 0.1, rigP.y);
  // Positive lean tips the torso forward (+Z, the way the model faces).
  turn(rigP, rigN, vec3(0.0, uHipY, 0.0), rotX((uLean + uCrouch * 0.25) * torsoW));
  rigP.y -= uCrouch * 0.42 + uTuck * 0.15;

  transformed = rigP;
  objectNormal = rigN;
`;

/**
 * Give a static player mesh its shader rig. Returns the uniforms the host
 * drives each frame: uPhase (run cycle), uStride, uArmSwing, uLean, uCrouch
 * (slide), uTuck (jump), uHold (both hands on the launcher), uReachUp
 * (arms overhead: hanging from or climbing the ladder).
 */
export function rigPlayerMesh(mesh) {
  const body = measureBody(mesh.geometry);
  const uniforms = {
    uPhase: { value: 0 },
    uStride: { value: 0 },
    uArmSwing: { value: 0 },
    uLean: { value: 0 },
    uCrouch: { value: 0 },
    uTuck: { value: 0 },
    uHold: { value: 1 },
    uReachUp: { value: 0 },
    uHipY: { value: body.hipY },
    uKneeY: { value: body.kneeY },
    uShoulderX: { value: body.shoulderX },
    uShoulderY: { value: body.shoulderY },
    uElbowX: { value: body.elbowX },
    uArmDrop: { value: 1.32 },
  };
  const material = mesh.material.clone();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PLAYER_RIG_VERTEX}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>")
      .replace(
        "#include <defaultnormal_vertex>",
        // Normals and positions must be moved together, so the rig runs here,
        // after both exist and before either is transformed to view space.
        `${PLAYER_RIG_MAIN}\n#include <defaultnormal_vertex>`
      );
    // begin_vertex runs after beginnormal/defaultnormal in three's standard
    // shader, so declare 'transformed' early: move begin_vertex up.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      "#include <beginnormal_vertex>\n#include <begin_vertex>"
    );
    shader.vertexShader = shader.vertexShader.replace(/(#include <defaultnormal_vertex>[\s\S]*?)#include <begin_vertex>/, "$1");
  };
  material.customProgramCacheKey = () => "meltdown-player-rig";
  mesh.material = material;
  // The rig moves vertices outside the rest-pose bounds.
  mesh.frustumCulled = false;
  return { uniforms, body };
}
