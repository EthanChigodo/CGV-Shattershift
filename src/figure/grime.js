/**
 * The patients' filth: months locked in a lab, then loose in a burning
 * tower. Their own textures are small (256-512 px) and read pale and clean
 * in the game's light, so a shader is laid over them:
 *
 *   gown      a torn hospital gown painted over the torso, hips and shoulders:
 *             faded, printed, folded, stained, ragged at the hem, holed
 *   skin      darker, colour drained toward a sick grey-green, mottled, with
 *             bruises and dark veins
 *   dirt      climbing from the feet, in patches everywhere, the hands black
 *             with it, and a fine grime in every pore
 *   blood     dried brown and wet red: round the mouth and dribbled down the
 *             chest, on the forearms and hands, spattered
 *   surface   a fine bump so skin is not plastic; wet blood and sweat shine,
 *             dirt goes matte
 *
 * Every mark is placed by where it is on the body at rest (a baked
 * attribute, `grimePos`: the rest pose in the model's frame, scaled by its
 * height: y 0 feet .. 1 crown, x out to the hands, +z the front), so it stays
 * on the body however the rig moves it. A handful of variants with their own
 * seeds are dealt out in turn, so no two patients beside each other match.
 *
 *   dirtyClone(model);   // a cloned patient (characters.js cloneCharacter)
 *   regrime(copy, from); // a material copied from a dirty one (ash.js)
 *
 * The program cache key carries "grime", and the other layers chained onto
 * these materials (kit.js heatSignature, ash.js) add theirs to it.
 */

import * as THREE from "../three.js";
import { NOISE_GLSL, noiseTexture } from "./noise.js";

/** How many differently-seeded variants of each material are dealt out. */
const VARIANTS = 6;

const GRIME_VERTEX_HEAD = /* glsl */ `
attribute vec3 grimePos;
varying vec3 vGrimeP;
`;

// (The noise from a texture, noise.js: hashed, ~70 calls of it took
// Direct3D's compiler 12 s for one program and froze the Roof.)
const GRIME_FRAGMENT_HEAD = /* glsl */ `
uniform float uGrimeSeed;
uniform float uGrimeAmount;
varying vec3 vGrimeP;
${NOISE_GLSL}
float gNoise(vec3 x) { return noise3(x); }
float gFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * gNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
// A bump from a height's screen-space slope (three's perturbNormalArb).
vec3 gPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos)); vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const GRIME_COLOUR = /* glsl */ `
  vec3 gp = vGrimeP + uGrimeSeed * vec3(13.1, 7.7, 21.3);
  float gh = vGrimeP.y;
  float gx = abs(vGrimeP.x);
  float gFront = smoothstep(0.0, 0.07, vGrimeP.z);
  vec3 gCol = diffuseColor.rgb;
  float gLum = dot(gCol, vec3(0.299, 0.587, 0.114));
  // Sick: darker, the colour drained toward grey-green, more contrast.
  gCol = mix(vec3(gLum), gCol, 0.68) * vec3(0.8, 0.82, 0.68) * mix(1.0, 0.34, uGrimeAmount);
  gCol = pow(gCol, vec3(1.18));
  // Mottled, with bruises.
  float gMott = gFbm(gp * 5.0);
  gCol *= mix(vec3(1.08, 1.02, 0.95), vec3(0.78, 0.76, 0.9), smoothstep(0.32, 0.68, gMott));
  float gBruise = smoothstep(0.6, 0.76, gFbm(gp * 3.1 + 4.0)) * uGrimeAmount;
  gCol = mix(gCol, gCol * vec3(0.48, 0.38, 0.56), gBruise * 0.75);
  // Veins: thin dark threads where the noise crosses its middle.
  float gVn = 1.0 - abs(gNoise(gp * vec3(17.0, 8.0, 17.0)) * 2.0 - 1.0);
  float gVein = pow(gVn, 16.0) * smoothstep(0.42, 0.72, gFbm(gp * 2.2 + 8.0)) * uGrimeAmount;
  gCol = mix(gCol, gCol * vec3(0.36, 0.44, 0.55), gVein * 0.6);
  // A torn hospital gown over the torso, hips and shoulders: faded, a small
  // print, folds, old stains; ragged at the hem, holed, frayed round the holes.
  float gHem = 0.45 + 0.04 * gNoise(vec3(vGrimeP.x * 40.0, 1.0, vGrimeP.z * 40.0) + uGrimeSeed * 9.0) + 0.018 * gNoise(gp * 80.0);
  float gNeck = 0.8 - 0.04 * gFront * (1.0 - smoothstep(0.0, 0.08, gx));
  float gBody = step(gHem, gh) * step(gh, gNeck) * (1.0 - smoothstep(0.15, 0.17, gx));
  float gSleeve = (1.0 - smoothstep(0.21, 0.235, gx + 0.012 * gNoise(gp * 60.0))) * smoothstep(0.73, 0.745, gh) * (1.0 - smoothstep(0.845, 0.86, gh)) * step(0.13, gx);
  float gTearN = gFbm(gp * 5.0 + 40.0);
  float gGown = max(gBody, gSleeve) * (1.0 - smoothstep(0.64, 0.68, gTearN));
  float gFray = max(gBody, gSleeve) * smoothstep(0.58, 0.64, gTearN) * (1.0 - smoothstep(0.64, 0.68, gTearN));
  float gFold = gNoise(gp * vec3(16.0, 3.5, 16.0));
  vec3 gCloth = mix(vec3(0.17, 0.3, 0.34), vec3(0.3, 0.33, 0.3), fract(uGrimeSeed * 3.7));
  float gDots = 1.0 - smoothstep(0.18, 0.3, length(fract(vec2(vGrimeP.x + vGrimeP.z, vGrimeP.y) * 70.0) - 0.5));
  gCloth = mix(gCloth, gCloth * vec3(0.5, 0.6, 0.82), gDots * 0.6);
  gCloth *= 0.55 + 0.55 * gFold;
  gCloth = mix(gCloth, vec3(0.13, 0.1, 0.035), smoothstep(0.4, 0.66, gFbm(gp * 4.0 + 50.0)) * 0.9);
  gCloth = mix(gCloth, vec3(0.05, 0.042, 0.03), smoothstep(0.45, 0.7, gFbm(gp * 9.0 + 70.0)) * 0.6);
  gCloth = mix(gCloth, vec3(0.012, 0.01, 0.007), (1.0 - smoothstep(gHem, gHem + 0.1, gh)) * 0.8);
  gCol = mix(gCol, gCloth, gGown);
  gCol *= 1.0 - 0.55 * gFray;
  // Dirt: up from the feet, in patches, the hands (out along the arms at rest).
  float gHands = smoothstep(0.36, 0.44, gx);
  float gForearm = smoothstep(0.24, 0.34, gx);
  float gFromFeet = 1.0 - smoothstep(0.02, 0.48, gh);
  float gDirtN = gFbm(gp * 9.0 + 2.0);
  // Filth run down the body in streaks.
  // (Colours here are linear and the levels' lights are strong: real albedos,
  // so skin sits near 0.1, dirt and old blood near black.)
  float gStreak = smoothstep(0.52, 0.7, gNoise(gp * vec3(30.0, 1.6, 30.0))) * smoothstep(0.3, 0.55, gFbm(gp * 2.5 + 21.0));
  float gDirt = clamp(gFromFeet * 0.95 + gHands * 0.8 + (gDirtN - 0.42) * 1.3 + gStreak * 0.7, 0.0, 1.0) * uGrimeAmount;
  gCol = mix(gCol, vec3(0.012, 0.0095, 0.007), gDirt * 0.86);
  // A fine grime in every pore.
  float gPore = gNoise(gp * 52.0);
  gCol *= mix(1.0, 0.72 + 0.4 * gPore, uGrimeAmount);
  // Blood: round the mouth and down the chest, the forearms, spatter.
  float gMouth = (1.0 - smoothstep(0.02, 0.07, gx)) * smoothstep(0.845, 0.865, gh) * (1.0 - smoothstep(0.895, 0.915, gh)) * gFront;
  float gDrip = (1.0 - smoothstep(0.05, 0.19, gx)) * smoothstep(0.42, 0.84, gh) * (1.0 - smoothstep(0.86, 0.9, gh)) * gFront
    * smoothstep(0.42, 0.58, gNoise(gp * vec3(24.0, 2.2, 24.0)));
  float gArms = gForearm * smoothstep(0.46, 0.62, gFbm(gp * 6.0 + 5.0));
  vec3 gWarp = gp * 38.0 + vec3(gFbm(gp * 7.0), gFbm(gp * 7.0 + 3.0), gFbm(gp * 7.0 + 6.0)) * 4.0;
  float gSpat = smoothstep(0.76, 0.83, gNoise(gWarp)) * smoothstep(0.3, 0.55, gFbm(gp * 3.0 + 13.0));
  float gBlood = clamp(gMouth * 1.2 + gDrip + gArms + gSpat, 0.0, 1.0) * uGrimeAmount;
  float gWet = smoothstep(0.48, 0.8, gNoise(gp * 7.0 + 31.0));
  vec3 gBloodCol = mix(vec3(0.03, 0.005, 0.003), vec3(0.085, 0.004, 0.003), gWet);
  // Soaked into cloth it dries brown, darker at the edge.
  gBloodCol = mix(gBloodCol, vec3(0.04, 0.011, 0.006), gGown * 0.7);
  gCol = mix(gCol, gBloodCol, gBlood * 0.9);
  gCol *= 1.0 - 0.35 * gGown * smoothstep(0.02, 0.2, gBlood) * (1.0 - smoothstep(0.2, 0.6, gBlood));
  float gSweat = (1.0 - gGown) * (1.0 - gDirt) * (1.0 - gBlood) * smoothstep(0.55, 0.82, gNoise(gp * 12.0 + 3.0)) * 0.7 * uGrimeAmount;
  // Sunken, bruised eyes.
  float gEyes = smoothstep(0.012, 0.03, gx) * (1.0 - smoothstep(0.05, 0.075, gx)) * smoothstep(0.915, 0.925, gh) * (1.0 - smoothstep(0.94, 0.95, gh)) * gFront;
  gCol *= 1.0 - 0.6 * gEyes * uGrimeAmount;
  diffuseColor.rgb = gCol;
`;

const GRIME_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, 0.95, gGown);
  roughnessFactor = mix(roughnessFactor, 0.96, gDirt * 0.7);
  roughnessFactor = mix(roughnessFactor, 0.5, gSweat);
  roughnessFactor = mix(roughnessFactor, 0.24, gBlood * gWet);
`;

const GRIME_NORMAL = /* glsl */ `
  {
    float gHgt = mix(gFbm(gp * 30.0) * 0.55 + gPore * 0.3 + gVein * 0.25, gFold * 1.4 + gDots * 0.08, gGown) + gBlood * 0.35 * (1.0 - gWet) + gFray * 0.4;
    normal = gPerturb(-vViewPosition, normal, vec2(dFdx(gHgt), dFdy(gHgt)) * 0.9 * uGrimeAmount, faceDirection);
  }
`;

/** Chain the grime onto a material (once). */
function grimeMaterial(material, seed, amount) {
  material.userData.grime = { seed, amount };
  const uniforms = { uGrimeSeed: { value: seed }, uGrimeAmount: { value: amount }, uNoise: { value: noiseTexture() } };
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${GRIME_VERTEX_HEAD}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGrimeP = grimePos;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRIME_FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${GRIME_COLOUR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${GRIME_ROUGHNESS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${GRIME_NORMAL}`);
  };
  material.customProgramCacheKey = () => "grime";
  material.needsUpdate = true;
  return material;
}

/**
 * Bake `grimePos` into a mesh's geometry from the pose it is in now (a fresh
 * clone: the rest pose), in the frame of `root`, scaled by the body's height.
 * Geometry is shared between clones, so this runs once per template.
 */
function bakeRestPositions(root, meshes) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  const raw = new Map();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    if (g.attributes.grimePos) continue;
    mesh.skeleton?.update();
    const count = g.attributes.position.count;
    const out = new Float32Array(count * 3);
    const toModel = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    for (let i = 0; i < count; i += 1) {
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, v);
      else v.fromBufferAttribute(g.attributes.position, i);
      v.applyMatrix4(toModel);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    raw.set(g, out);
  }
  const height = Math.max(1e-3, maxY - minY);
  for (const [g, out] of raw) {
    for (let i = 0; i < out.length; i += 3) {
      out[i] /= height;
      out[i + 1] = (out[i + 1] - minY) / height;
      out[i + 2] /= height;
    }
    g.setAttribute("grimePos", new THREE.BufferAttribute(out, 3));
  }
}

/** Each source material's dirty variants, and whose turn it is. */
const variantsOf = new WeakMap();
let dealt = 0;

/**
 * Make a freshly cloned patient filthy: bake its rest pose (once per
 * template) and give its meshes the next variant of their material.
 */
export function dirtyClone(model, { amount = 1 } = {}) {
  const meshes = [];
  model.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes.position && o.material && !Array.isArray(o.material)) meshes.push(o);
  });
  if (!meshes.length) return model;
  bakeRestPositions(model, meshes);
  const turn = dealt++ % VARIANTS;
  for (const mesh of meshes) {
    const source = mesh.material;
    if (source.userData.grime) continue;
    let list = variantsOf.get(source);
    if (!list) {
      list = Array.from({ length: VARIANTS }, (_, k) => {
        const c = source.clone();
        delete c.userData.heat;
        return grimeMaterial(c, (k * 0.618034 + 0.137) % 1, amount);
      });
      variantsOf.set(source, list);
    }
    mesh.material = list[turn];
  }
  return model;
}

/** A material copied from a dirty one (a copy loses its shader hooks): dirty it the same way. */
export function regrime(copy, from) {
  const g = from?.userData?.grime;
  if (!g) return copy;
  delete copy.userData.grime;
  return grimeMaterial(copy, g.seed, g.amount);
}
