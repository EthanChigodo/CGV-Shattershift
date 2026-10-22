/**
 * Rigged, animated people: the team's Mixamo characters (docs/characters-for-the-team.md),
 * converted by tools/characters/build.py into assets/characters/<role>.glb.
 *
 * Until a role's file is listed in assets/characters/manifest.json the game
 * keeps today's model and procedural animation for it, exactly as before.
 * Once it is listed, the same call sites get:
 *
 *   ClipRig     - in place of HumanoidRig (characters.js). Same calls:
 *                 pose(), rotate(), rotateQ(), reset(), apply(), bones,
 *                 hipHeight. pose() picks a clip instead of bending limbs:
 *                 `clip` names it (a list = fallbacks), `speed` (m/s) syncs a
 *                 walk or run to how fast the body really moves, `dt` advances
 *                 it. A pose with no clip for it is done the old way, by a
 *                 HumanoidRig on the same skeleton, blended in. rotate() adds
 *                 a model-space rotation on top of the clip (a look, a flinch).
 *                 react() plays a hit over the motion, die() a death that
 *                 holds its last frame.
 *   RiggedBody  - the player's rigged body inside PlayerAvatar (player.js):
 *                 reads the same state the shader rig gets and picks run,
 *                 jump, slide, strafe, fall, hang, climb...; keeps both hands
 *                 on the launcher with two-bone IK; tints skin and hair.
 *
 * Materials are re-shaded for people (figureMaterial): skin gets wrap lighting
 * with a warm scatter band at the terminator (a subsurface approximation) and
 * softer specular, hair a pair of Kajiya-Kay highlights along the strands,
 * cloth stays rough with a faint sheen. The player's skin tone and hair dye
 * (SKIN_TONES / HAIR_COLOURS from look.js) recolour by material name - a
 * material called "Skin" or "Hair" - or, for one-material AI models, per
 * texel: warm texels are skin, dark ones on the head are hair.
 *
 * Where the files come from (dev override, for checking stand-ins):
 *   ?characters=dev                    assets/characters/dev/ (git-ignored)
 *   ?characters=<same-origin folder>   a folder holding manifest.json + GLBs
 *   ?characters=off                    force today's models
 *   localStorage["fractureRun.characters"] the same, remembered
 */

import * as THREE from "../three.js";
import { GLTFLoader, SkeletonUtils } from "../three-addons.js";
import { SKIN_TONES, HAIR_COLOURS } from "./look.js";

/* ------------------------------------------------------------------ */
/* The cast: game slots -> roles                                         */
/* ------------------------------------------------------------------ */

/**
 * Which roles (docs/characters-for-the-team.md) can stand in for each of the
 * game's character slots (assets.js CHARACTER_ASSETS). The first role listed
 * in the manifest wins; patients take every listed variant, round-robin.
 */
export const ROLE_SLOTS = {
  playerFemale: ["subject07_female"],
  playerMale: ["subject07_male"],
  scientistGood: ["okoro"],
  scientistEvil: ["vale"],
  patient: ["patient_a", "patient_b"],
  brute: ["patient_brute"],
  scientistRadioman: ["scientist_labcoat", "scientist_hazmat"],
  scientistRust: ["scientist_hazmat", "scientist_labcoat"],
};
/** Slots that take every listed role as a variant (a crowd, not clones). */
const VARIANT_SLOTS = new Set(["patient"]);

/** Clip names (the brief's tables). Anything else in a file is kept too. */
export const CLIP_NAMES = [
  "idle", "run", "jump", "slide", "strafe_left", "strafe_right", "hit", "throw", "die", "fall", "dodge", "aim",
  "climb", "hang", "kneel", "wake", "cheer", "talk", "walk", "point", "sit", "laugh", "attack", "scream", "crawl", "shoot",
];

/** Rough ground speeds (m/s) for locomotion clips without a measured one. */
const DEFAULT_SPEED = { walk: 1.3, run: 3.8, crawl: 0.5, strafe_left: 2.2, strafe_right: 2.2, climb: 0.6 };
/** Clips that loop; everything else plays once. */
const LOOPS = /^(idle|run|walk|strafe_left|strafe_right|fall|aim|climb|hang|talk|sit|crawl|kneel)(_?\d+)?$/;
/** Deaths keep the body's travel (it falls where the blow sends it). */
const KEEP_ROOT = /^(die|fall)(_?\d+)?$/;

/* ------------------------------------------------------------------ */
/* Manifest                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_BASE = new URL("../../assets/characters/", import.meta.url).href;
const OVERRIDE_KEY = "fractureRun.characters";

/** The folder the characters come from (null: rigged characters switched off). */
export function charactersBase() {
  let value = null;
  try {
    value = new URLSearchParams(globalThis.location?.search ?? "").get("characters");
  } catch {
    /* no location */
  }
  if (value === null) {
    try {
      value = globalThis.localStorage?.getItem(OVERRIDE_KEY) ?? null;
    } catch {
      /* storage blocked */
    }
  }
  if (!value) return DEFAULT_BASE;
  if (/^(off|none|0|false)$/i.test(value)) return null;
  // A bare name is a folder beside the real ones: ?characters=dev ->
  // assets/characters/dev/ (git-ignored; for checking a build before it ships).
  if (/^[\w-]+$/.test(value)) return new URL(`${value}/`, DEFAULT_BASE).href;
  try {
    const url = new URL(value.endsWith("/") ? value : `${value}/`, globalThis.location?.href ?? DEFAULT_BASE);
    // Same origin only: an override is for checking files on this server.
    if (globalThis.location && url.origin !== globalThis.location.origin) {
      console.warn(`[characters] ignoring off-site override ${url.href}`);
      return DEFAULT_BASE;
    }
    return url.href;
  } catch {
    return DEFAULT_BASE;
  }
}

let manifestPromise = null;

/** The manifest ({ base, roles }); an empty one if missing or switched off. */
export function loadCharacterManifest() {
  if (manifestPromise) return manifestPromise;
  const base = charactersBase();
  manifestPromise = (async () => {
    if (!base) return { base: null, roles: {} };
    try {
      const response = await fetch(new URL("manifest.json", base).href, { cache: "no-cache" });
      if (!response.ok) return { base, roles: {} };
      const json = await response.json();
      return { base, roles: json?.roles && typeof json.roles === "object" ? json.roles : {} };
    } catch (error) {
      console.warn("[characters] no manifest, keeping today's models", error);
      return { base, roles: {} };
    }
  })();
  return manifestPromise;
}

/** The roles available for a game slot (empty: keep today's model). */
export async function rolesFor(slot) {
  const { roles } = await loadCharacterManifest();
  const wanted = ROLE_SLOTS[slot] ?? [];
  const present = wanted.filter((role) => roles[role]?.file);
  return VARIANT_SLOTS.has(slot) ? present : present.slice(0, 1);
}

/** The game slots that have a rigged role (sync once the manifest is in). */
export async function riggedSlots() {
  const { roles } = await loadCharacterManifest();
  return new Set(Object.keys(ROLE_SLOTS).filter((slot) => ROLE_SLOTS[slot].some((role) => roles[role]?.file)));
}

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

const templates = new Map();
let loader = null;
/** Per role: { clips, meta, body, height, variants } (kept out of userData). */
const INFO = new Map();
/** A model's own material copies (the player's), for dispose(). */
const OWN = new WeakMap();

/** A rigged template's or clone's clips and measurements. */
export function riggedInfo(object) {
  return INFO.get(object?.userData?.character?.role) ?? null;
}

/** Load one role's template (cached). */
export function loadRole(role) {
  if (!templates.has(role)) {
    templates.set(
      role,
      (async () => {
        const manifest = await loadCharacterManifest();
        const entry = manifest.roles[role];
        if (!entry?.file || !manifest.base) throw new Error(`role "${role}" is not in the manifest`);
        loader ??= new GLTFLoader();
        const gltf = await loader.loadAsync(new URL(entry.file, manifest.base).href);
        return buildRiggedTemplate(gltf, role, entry);
      })().catch((error) => {
        templates.delete(role);
        throw error;
      })
    );
  }
  return templates.get(role);
}

/**
 * The rigged template for a game slot, or null (keep today's model). Variant
 * slots return the first template carrying the others in
 * riggedInfo(first).variants; cloneRigged() deals them out in turn.
 */
export async function loadRiggedFor(slot) {
  const roles = await rolesFor(slot);
  if (!roles.length) return null;
  const loaded = [];
  for (const role of roles) {
    try {
      loaded.push(await loadRole(role));
    } catch (error) {
      console.warn(`[characters] "${role}" failed to load, keeping today's model`, error);
    }
  }
  if (!loaded.length) return null;
  const first = loaded[0];
  riggedInfo(first).variants = loaded;
  return first;
}

/* ------------------------------------------------------------------ */
/* Bones                                                                */
/* ------------------------------------------------------------------ */

const MIXAMO = {
  hips: "hips", spineLow: "spine", spineMid: "spine1", chest: "spine2", neck: "neck", head: "head",
  clavicleL: "leftshoulder", armL: "leftarm", forearmL: "leftforearm", handL: "lefthand",
  clavicleR: "rightshoulder", armR: "rightarm", forearmR: "rightforearm", handR: "righthand",
  thighL: "leftupleg", calfL: "leftleg", footL: "leftfoot", toeL: "lefttoebase",
  thighR: "rightupleg", calfR: "rightleg", footR: "rightfoot", toeR: "righttoebase",
};
const GENERIC = [
  ["hips", /^(hips?|pelvis|root_?hips)$/],
  ["neck", /^neck$/],
  ["head", /^head$/],
  ["clavicle", /^(clavicle|shoulder|collar)/],
  ["forearm", /^(forearm|lowerarm|elbow|arm2)/],
  ["arm", /^(upperarm|arm1?|uparm)$/],
  ["hand", /^(hand|palm|wrist)$/],
  ["thigh", /^(thigh|upperleg|upleg|leg1)$/],
  ["calf", /^(calf|lowerleg|shin|knee|leg2|leg)$/],
  ["foot", /^(foot|ankle)$/],
  ["toe", /^(toe|toes|toebase|ball)$/],
];

function plain(name) {
  return name.toLowerCase().replace(/^mixamorig\d*[:_]?/, "").replace(/^(bip01|valvebiped\.?bip01)[_ ]?/, "").replace(/[\s.:-]/g, "");
}

/** Find the standard humanoid bones (HumanoidRig's keys), Mixamo first. */
export function mapRigBones(root) {
  const bones = [];
  root.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  const byName = new Map(bones.map((b) => [plain(b.name), b]));
  const map = {};
  for (const [key, name] of Object.entries(MIXAMO)) if (byName.has(name)) map[key] = byName.get(name);
  if (!map.hips) {
    for (const bone of bones) {
      let n = plain(bone.name).replace(/_/g, "");
      let side = null;
      const m = n.match(/^(left|right|l|r)(?=[a-z]{3})/) ?? null;
      if (m && /^(left|right)/.test(m[1])) {
        side = m[1][0] === "l" ? "L" : "R";
        n = n.slice(m[1].length);
      } else {
        const s = n.match(/(left|right|l|r)$/);
        if (s && n.length > s[1].length + 2) {
          side = s[1][0] === "l" ? "L" : "R";
          n = n.slice(0, -s[1].length);
        }
      }
      for (const [key, re] of GENERIC) {
        if (!re.test(n)) continue;
        const k = ["hips", "neck", "head"].includes(key) ? key : side ? `${key}${side}` : null;
        if (k && !map[k]) map[k] = bone;
        break;
      }
    }
    const spines = bones.filter((b) => /spine|chest|torso|abdomen/.test(plain(b.name)));
    if (spines.length) {
      map.spineLow ??= spines[0];
      map.chest ??= spines[spines.length - 1];
    }
  }
  map.chest ??= map.spineMid ?? map.spineLow;
  return map;
}

/* ------------------------------------------------------------------ */
/* Materials                                                            */
/* ------------------------------------------------------------------ */

/** RIG_SURFACE values. AUTO judges each texel (one-material AI models). */
const SURFACE = { auto: 0, skin: 1, hair: 2, cloth: 3, eyes: 4 };

function surfaceOf(material, entry) {
  const name = (material.name ?? "").toLowerCase();
  const listed = (kind) => (entry?.materials?.[kind] ?? []).some((n) => n.toLowerCase() === name);
  for (const kind of ["skin", "hair", "cloth", "eyes"]) if (listed(kind)) return kind;
  if (/skin/.test(name)) return "skin";
  if (/hair|brow|lash|beard|scalp/.test(name)) return "hair";
  if (/eye|cornea|iris|teeth|tooth|tongue/.test(name)) return "eyes";
  if (/cloth|shirt|pant|trouser|coat|scrub|gown|shoe|boot|jacket|suit|glove|vest|sock|tee|dress|skirt|apron|belt|mask|tank|helmet|cap|top|bottom|tie/.test(name)) return "cloth";
  return "auto";
}

const FIGURE_VERTEX_HEAD = /* glsl */ `
varying vec3 vRigRest;
varying vec3 vRigUp;
`;

const FIGURE_FRAGMENT_HEAD = /* glsl */ `
varying vec3 vRigRest;
varying vec3 vRigUp;
uniform vec3 uRigSkinAvg;
uniform vec3 uRigTone;
uniform float uRigToneOn;
uniform vec3 uRigHair;
uniform float uRigHairOn;
uniform float uRigHairLum;
uniform float uRigNeckY;
uniform float uRigHeadSize;
uniform float uRigUnit;
uniform float uRigWear;
#ifdef RIG_MASK
uniform sampler2D uRigMask;
#endif
// What this texel is, for the lighting below (set after the colour map).
float gRigSkin = 0.0;
float gRigHair = 0.0;
float gRigCloth = 0.0;
vec3 gRigUp = vec3( 0.0, 1.0, 0.0 );
float rigHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float rigNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( rigHash( i ), rigHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( rigHash( i + vec3( 0, 1, 0 ) ), rigHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( rigHash( i + vec3( 0, 0, 1 ) ), rigHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( rigHash( i + vec3( 0, 1, 1 ) ), rigHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;

// Direct light for people. The standard GGX + Lambert first, then:
//  - skin: light wraps past the terminator (wrap lighting), and the band it
//    wraps into is warm - the red of blood under the skin, the cheapest
//    convincing subsurface scattering;
//  - hair: two Kajiya-Kay highlights along the strands (which run down the
//    head), a narrow pale one and a broader one in the hair's own colour,
//    shifted apart along the normal as on real hair;
//  - cloth: a faint sheen toward grazing angles (fibres catching the light).
const FIGURE_LIGHTS = /* glsl */ `
#include <lights_physical_pars_fragment>
void RE_Direct_Figure( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float nl = dot( geometryNormal, directLight.direction );
  float lambert = saturate( nl );
  if ( gRigSkin > 0.0 ) {
    float wrapped = saturate( ( nl + 0.5 ) / 1.5 );
    float bleed = max( 0.0, wrapped - lambert );
    reflectedLight.directDiffuse += gRigSkin * bleed * vec3( 1.0, 0.4, 0.28 ) * directLight.color * BRDF_Lambert( material.diffuseColor );
  }
  if ( gRigHair > 0.0 ) {
    vec3 T = normalize( gRigUp - geometryNormal * dot( geometryNormal, gRigUp ) + vec3( 1e-4 ) );
    vec3 H = normalize( directLight.direction + geometryViewDir );
    vec3 T1 = normalize( T + geometryNormal * 0.12 );
    vec3 T2 = normalize( T - geometryNormal * 0.1 );
    float d1 = dot( T1, H );
    float d2 = dot( T2, H );
    float s1 = pow( max( 0.0, 1.0 - d1 * d1 ), 40.0 );
    float s2 = pow( max( 0.0, 1.0 - d2 * d2 ), 10.0 );
    float lit = smoothstep( -0.15, 0.35, nl );
    reflectedLight.directSpecular += gRigHair * lit * directLight.color * ( vec3( 0.14 ) * s1 + material.diffuseColor * 0.5 * s2 );
  }
  if ( gRigCloth > 0.0 ) {
    float rim = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 );
    reflectedLight.directDiffuse += gRigCloth * 0.3 * rim * lambert * directLight.color * material.diffuseColor;
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Figure
`;

const FIGURE_SURFACE = /* glsl */ `
{
  vec3 rigCol = diffuseColor.rgb;
  float rigHi = max( rigCol.r, max( rigCol.g, rigCol.b ) );
  // Skin texels: red over green over blue, in skin's band of hue (orange,
  // not yellow or crimson) and saturation (not grey, not dyed cloth) -
  // judged on the colour's own proportions, so skin in shadow counts too.
  vec3 rigS = pow( max( rigCol, vec3( 0.0 ) ), vec3( 0.4545 ) );
  float rigSat = ( rigS.r - rigS.b ) / max( rigS.r, 0.02 );
  float rigHue = ( rigS.g - rigS.b ) / max( rigS.r - rigS.b, 0.02 );
  float rigWarm = smoothstep( 0.1, 0.18, rigSat ) * ( 1.0 - smoothstep( 0.72, 0.86, rigSat ) )
    * smoothstep( 0.0, 0.1, rigHue ) * ( 1.0 - smoothstep( 0.58, 0.7, rigHue ) )
    * step( rigS.g, rigS.r + 0.01 ) * smoothstep( 0.06, 0.14, rigS.r );
  float rigTint = 0.0;
  #if RIG_SURFACE == 1
    gRigSkin = 1.0;
    rigTint = rigWarm;
  #elif RIG_SURFACE == 2
    gRigHair = 1.0;
  #elif RIG_SURFACE == 3
    gRigCloth = 1.0;
  #elif RIG_SURFACE == 0
    // One material for everything: warm texels are skin; dark ones on the
    // head (above the neck, by the rest pose) are hair; the rest is cloth.
    gRigSkin = rigWarm;
    rigTint = rigWarm;
    float rigHead = smoothstep( uRigNeckY + uRigHeadSize * 0.15, uRigNeckY + uRigHeadSize * 0.45, vRigRest.y );
    gRigHair = rigHead * ( 1.0 - rigWarm ) * ( 1.0 - smoothstep( 0.06, 0.3, rigHi ) );
    gRigCloth = ( 1.0 - gRigSkin ) * ( 1.0 - gRigHair );
  #endif
  #if defined( RIG_MASK ) && defined( USE_MAP )
    vec4 rigMask = texture2D( uRigMask, vMapUv );
    gRigSkin = rigMask.r;
    rigTint = rigMask.r;
    gRigHair = rigMask.g;
    gRigCloth = ( 1.0 - rigMask.r ) * ( 1.0 - rigMask.g );
  #endif
  // The player's skin tone: each texel scaled by the new tone over the
  // model's own average skin, so lips, creases and shading carry across.
  if ( uRigToneOn > 0.5 ) {
    vec3 rigToned = rigCol * ( uRigTone / max( uRigSkinAvg, vec3( 0.02 ) ) );
    rigCol = mix( rigCol, clamp( rigToned, 0.0, 1.0 ), rigTint );
  }
  // Hair dye: the strand's brightness relative to the hair's average, the dye's colour.
  if ( uRigHairOn > 0.5 && gRigHair > 0.0 ) {
    vec3 rigLuma = vec3( 0.2126, 0.7152, 0.0722 );
    float rigRel = dot( rigCol, rigLuma ) / max( uRigHairLum, 0.002 );
    float rigContrast = mix( 0.95, 0.62, smoothstep( 0.02, 0.5, dot( uRigHair, rigLuma ) ) );
    rigCol = mix( rigCol, uRigHair * pow( max( rigRel, 0.0 ), rigContrast ), gRigHair );
  }
  // Wear (the story's stages): dust low on the body, then blood.
  if ( uRigWear > 0.001 ) {
    vec3 rigP = vRigRest * uRigUnit;
    float rigGrain = rigNoise( rigP * 7.0 ) * 0.6 + rigNoise( rigP * 23.0 ) * 0.4;
    float rigLow = 1.0 - smoothstep( 0.1, 1.3, rigP.y );
    float rigDusty = smoothstep( 0.0, 0.33, uRigWear ) * ( 1.0 - gRigHair );
    rigCol = mix( rigCol, rigCol * 0.6 + vec3( 0.09, 0.08, 0.07 ), rigDusty * smoothstep( 0.4, 0.75, rigGrain ) * ( 0.35 + 0.65 * rigLow ) );
    float rigSplat = smoothstep( 0.7, 0.78, rigNoise( rigP * 9.0 + 3.1 ) );
    rigCol = mix( rigCol, vec3( 0.13, 0.008, 0.006 ), smoothstep( 0.4, 0.66, uRigWear ) * rigSplat * 0.85 * ( 1.0 - gRigHair ) );
  }
  diffuseColor.rgb = rigCol;
  gRigUp = normalize( vRigUp );
}
`;

/** Give a material the figure shading. `info`: { surface, skinAvg, hairLum, neckY, headSize, unit, mask }. */
export function figureMaterial(material, info) {
  const surface = info.surface ?? "auto";
  const uniforms = {
    uRigSkinAvg: { value: (info.skinAvg ?? new THREE.Color(0.6, 0.38, 0.28)).clone() },
    uRigTone: { value: new THREE.Color(0.6, 0.38, 0.28) },
    uRigToneOn: { value: 0 },
    uRigHair: { value: new THREE.Color(0.05, 0.03, 0.02) },
    uRigHairOn: { value: 0 },
    uRigHairLum: { value: info.hairLum ?? 0.035 },
    uRigNeckY: { value: info.neckY ?? 1.5 },
    uRigHeadSize: { value: info.headSize ?? 0.25 },
    uRigUnit: { value: info.unit ?? 1 },
    uRigWear: { value: 0 },
    uRigMask: { value: info.mask ?? null },
  };
  material.defines = { ...(material.defines ?? {}), RIG_SURFACE: SURFACE[surface] ?? 0 };
  if (info.mask) material.defines.RIG_MASK = "";
  // People are not metal, whatever the generator's maps say.
  if (surface !== "auto" && surface !== "cloth") material.metalness = 0;
  else material.metalness = Math.min(material.metalness ?? 0, 0.15);
  if (surface === "skin") material.roughness = THREE.MathUtils.clamp(material.roughness ?? 0.5, 0.42, 0.6);
  if (surface === "cloth") material.roughness = Math.max(material.roughness ?? 0.85, 0.75);
  if (surface === "hair") material.roughness = THREE.MathUtils.clamp(material.roughness ?? 0.45, 0.35, 0.6);
  if (surface === "eyes") material.roughness = 0.12;
  // Hair cards: cut out, both sides, smooth edges where the target has MSAA.
  if (surface === "hair" && (material.transparent || material.alphaTest > 0 || material.map?.format === THREE.RGBAFormat && material.name.match(/card/i))) {
    material.transparent = false;
    material.depthWrite = true;
    material.alphaTest = Math.max(0.4, material.alphaTest);
    material.side = THREE.DoubleSide;
    material.alphaToCoverage = true;
  }
  material.envMapIntensity = 0.6;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${FIGURE_VERTEX_HEAD}`)
      .replace(
        "#include <skinnormal_vertex>",
        `#include <skinnormal_vertex>
#ifdef USE_SKINNING
  vRigUp = normalize( normalMatrix * ( skinMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
#else
  vRigUp = normalize( normalMatrix * vec3( 0.0, 1.0, 0.0 ) );
#endif`
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vRigRest = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FIGURE_FRAGMENT_HEAD}`)
      .replace("#include <lights_physical_pars_fragment>", FIGURE_LIGHTS)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FIGURE_SURFACE}`)
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, clamp( roughnessFactor, 0.42, 0.62 ), gRigSkin );
  roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.78 ), gRigCloth );
  roughnessFactor = mix( roughnessFactor, clamp( roughnessFactor, 0.35, 0.6 ), gRigHair );`
      )
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n  metalnessFactor *= 1.0 - max( gRigSkin, gRigHair );");
  };
  // The defines tell programs apart; heat-signature / ash keys built on top still differ by them.
  material.customProgramCacheKey = () => "rigged-figure";
  material.needsUpdate = true;
  material.userData.figure = { uniforms, info: { ...info, surface } };
  return uniforms;
}

/** Average colour of a texture's skin-like texels (linear), or null. */
function averageSkin(texture, all = false) {
  const image = texture?.image;
  if (!image || !(image.width > 0)) return null;
  try {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      const sat = (R - B) / Math.max(R, 1);
      const hue = (G - B) / Math.max(R - B, 1);
      const skin = R > 40 && R >= G && sat > 0.18 && sat < 0.72 && hue > 0.1 && hue < 0.6;
      if (skin || (all && R + G + B > 120)) {
        r += R;
        g += G;
        b += B;
        n += 1;
      }
    }
    if (n < 20) return null;
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    return null;
  }
}

/** Mean linear luminance of a texture (for the hair dye), or null. */
function averageLuminance(texture) {
  const image = texture?.image;
  if (!image || !(image.width > 0)) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const lin = (c) => {
      const s = c / 255;
      return s < 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 100) continue;
      sum += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
      n += 1;
    }
    return n ? sum / n : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Templates                                                            */
/* ------------------------------------------------------------------ */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Clip names as the game spells them: "Armature|Zombie Walk" -> "zombie_walk". */
export function clipKey(name) {
  return String(name)
    .replace(/^.*\|/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function modelPosition(root, object, out = new THREE.Vector3()) {
  return root.worldToLocal(object.getWorldPosition(out));
}

/**
 * Take a hips position track's horizontal travel out (the body goes where
 * the game puts it). Loops lose only their drift, so the sway stays; one-shots
 * are pinned to where they start. Deaths keep their travel.
 */
function stripRootMotion(clip, hipsName, toModel) {
  if (KEEP_ROOT.test(clip.name)) return;
  const track = clip.tracks.find((t) => t.name === `${hipsName}.position`);
  if (!track || track.times.length < 2) return;
  const v = track.values;
  const n = track.times.length;
  const from = toModel.clone();
  const back = toModel.clone().invert();
  const first = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix3(from);
  const last = new THREE.Vector3(v[(n - 1) * 3], v[(n - 1) * 3 + 1], v[(n - 1) * 3 + 2]).applyMatrix3(from);
  const drift = Math.hypot(last.x - first.x, last.z - first.z);
  // Measured against the hips' height: an in-place clip barely drifts.
  if (drift < Math.abs(first.y) * 0.08) return;
  const loop = LOOPS.test(clip.name);
  const t0 = track.times[0];
  const span = track.times[n - 1] - t0 || 1;
  for (let i = 0; i < n; i += 1) {
    const p = _v.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]).applyMatrix3(from);
    const k = loop ? (track.times[i] - t0) / span : 1;
    if (loop) {
      p.x -= (last.x - first.x) * k;
      p.z -= (last.z - first.z) * k;
    } else {
      p.x = first.x;
      p.z = first.z;
    }
    p.applyMatrix3(back);
    v[i * 3] = p.x;
    v[i * 3 + 1] = p.y;
    v[i * 3 + 2] = p.z;
  }
}

/**
 * Turn a loaded glTF into a template: normalised (feet on y = 0, centred,
 * facing +Z, a real height in metres - build.py already does this, it is
 * checked again here), clips keyed by game name, materials re-shaded.
 */
export function buildRiggedTemplate(gltf, role, entry = {}) {
  const scene = gltf.scene;
  let skinned = 0;
  scene.traverse((o) => {
    if (o.isSkinnedMesh) skinned += 1;
  });
  if (!skinned) throw new Error(`"${role}" has no skinned mesh`);

  const holder = new THREE.Group();
  holder.name = "RigHolder";
  holder.add(scene);
  const root = new THREE.Group();
  root.name = `Rigged_${role}`;
  root.add(holder);
  root.updateMatrixWorld(true);

  const bones = mapRigBones(root);
  // Facing: the character's left hand is on +X when it faces +Z.
  if (bones.handL && bones.handR) {
    const l = modelPosition(root, bones.handL, _v).x;
    const r = modelPosition(root, bones.handR, _v2).x;
    if (l < r) {
      holder.rotation.y = Math.PI;
      root.updateMatrixWorld(true);
    }
  }
  // Height and floor: from the meshes in their bind pose (T- or A-pose, so
  // the top is the crown, not a raised hand), centred on the hips.
  const measure = () => {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes.position) return;
      o.geometry.computeBoundingBox();
      part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(part);
    });
    return box;
  };
  const before = measure();
  const measured = before.max.y - before.min.y;
  const wanted = Number(entry.height) || (measured > 1.2 && measured < 2.4 ? measured : 1.75);
  const scale = measured > 1e-4 ? wanted / measured : 1;
  holder.scale.multiplyScalar(scale);
  const after = measure();
  const hipsAt = bones.hips ? modelPosition(root, bones.hips, _v).clone() : after.getCenter(new THREE.Vector3());
  holder.position.set(-hipsAt.x, -after.min.y, -hipsAt.z);
  root.updateMatrixWorld(true);

  // Clips, by game name. Variants ("walk_2") stay separate names.
  const clips = new Map();
  const hipsName = bones.hips?.name;
  const hipsParent = bones.hips?.parent;
  const toModel = new THREE.Matrix3();
  if (hipsParent) {
    _m.copy(root.matrixWorld).invert().multiply(hipsParent.matrixWorld);
    toModel.setFromMatrix4(_m);
  }
  for (const clip of gltf.animations ?? []) {
    const name = clipKey(clip.name);
    if (!name || /^t_?pose$/.test(name)) continue;
    const c = clip.clone();
    c.name = name;
    if (hipsName) stripRootMotion(c, hipsName, toModel);
    clips.set(name, c);
  }

  // Materials: one shading per material, shared by every NPC clone.
  const neck = bones.neck ?? bones.head;
  const info = { neckWorld: neck ? neck.getWorldPosition(new THREE.Vector3()) : null };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // skinned bounds don't follow the pose
    o.castShadow = true;
    o.receiveShadow = true;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of list) {
      if (!material || material.userData.figure) continue;
      const surface = surfaceOf(material, entry);
      const skinAvg = surface === "skin" ? averageSkin(material.map, true) : surface === "auto" ? averageSkin(material.map) : null;
      const hairLum = surface === "hair" ? averageLuminance(material.map) : null;
      // Geometry-space neck height and unit, for the per-texel hair test and wear.
      o.updateMatrixWorld(true);
      const local = info.neckWorld ? o.worldToLocal(info.neckWorld.clone()) : null;
      const unit = o.getWorldScale(new THREE.Vector3()).y / root.getWorldScale(new THREE.Vector3()).y;
      figureMaterial(material, {
        surface,
        skinAvg: skinAvg ?? material.color?.clone(),
        hairLum: hairLum ?? 0.035,
        neckY: local ? local.y : 1.5 / Math.max(unit, 1e-6),
        headSize: 0.25 / Math.max(unit, 1e-6),
        unit,
      });
    }
  });

  // The body's measurements, as the player's rig reports them (player.js).
  const at = (bone) => (bone ? modelPosition(root, bone, new THREE.Vector3()) : null);
  const armR = at(bones.armR);
  const handR = at(bones.handR);
  const forearmR = at(bones.forearmR);
  const bodyInfo = {
    height: wanted,
    hipY: at(bones.hips)?.y ?? wanted * 0.53,
    kneeY: at(bones.calfR)?.y ?? wanted * 0.285,
    shoulderX: armR ? Math.abs(armR.x) : 0.2,
    shoulderY: armR ? armR.y : wanted * 0.82,
    elbowX: forearmR ? Math.abs(forearmR.x) : 0.45,
    armLength: armR && handR ? armR.distanceTo(handR) : 0.55,
  };

  const meta = entry.clips ?? {};
  // userData stays plain JSON (Object3D.clone copies it that way); the
  // clips and measurements live here, by role.
  root.userData.character = { profile: role, role, rigged: true, skinned: true, height: wanted };
  INFO.set(role, { clips, meta, body: bodyInfo, height: wanted, variants: null, dealt: 0 });
  return root;
}

/**
 * A fresh, independently animated copy. Variant templates are dealt out in
 * turn. `own` gives it its own materials (the player: tints, team colours).
 */
export function cloneRigged(template, { own = false } = {}) {
  const info = riggedInfo(template);
  let source = template;
  if (info.variants?.length > 1) {
    source = info.variants[info.dealt % info.variants.length];
    info.dealt += 1;
  }
  const clone = SkeletonUtils.clone(source);
  clone.userData.character = { ...source.userData.character };
  if (own) {
    const copies = new Map();
    clone.traverse((o) => {
      if (!o.isMesh) return;
      const swap = (m) => {
        if (!m) return m;
        if (!copies.has(m)) {
          const c = m.clone();
          figureMaterial(c, m.userData.figure?.info ?? {});
          copies.set(m, c);
        }
        return copies.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    OWN.set(clone, [...copies.values()]);
  }
  return clone;
}

/** The figure uniforms of every material on a model (for tints). */
function figureUniforms(model) {
  const list = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m?.userData.figure) list.add(m.userData.figure.uniforms);
  });
  return [...list];
}

/** Skin tone, hair dye and wear controls for a rigged model (look.js's API). */
export function riggedLook(model) {
  const all = figureUniforms(model);
  let wear = 0;
  let gear = false;
  return {
    get wear() {
      return wear;
    },
    get gear() {
      return gear;
    },
    setWear(value) {
      wear = THREE.MathUtils.clamp(value, 0, 1);
      for (const u of all) u.uRigWear.value = wear;
    },
    // The vest and radio are drawn by the old model's shader; a rigged
    // Subject 07 keeps the flag for the story's checks.
    setGear(on) {
      gear = Boolean(on);
    },
    setSkinTone(name) {
      const tone = SKIN_TONES[name]?.color;
      for (const u of all) {
        u.uRigToneOn.value = tone ? 1 : 0;
        if (tone) u.uRigTone.value.set(tone);
      }
    },
    setHairColour(name) {
      const dye = HAIR_COLOURS[name]?.color;
      for (const u of all) {
        u.uRigHairOn.value = dye ? 1 : 0;
        if (dye) u.uRigHair.value.set(dye);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* ClipRig: HumanoidRig's calls, played with clips                      */
/* ------------------------------------------------------------------ */

/** Upper-body bones (overlays: a hit or a throw over the legs' motion). */
const UPPER = /spine|chest|neck|head|shoulder|clavicle|arm|hand|thumb|index|middle|ring|pinky|finger|collar|eye/i;
const LOWER_EXCEPTIONS = /upleg|leg|foot|toe|hips|pelvis/i;

const smoothstep = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

/** The clip a HumanoidRig.pose() call means, when the caller didn't name one. */
function guessClip(p) {
  if ((p.crouch ?? 0) >= 0.6) return ["kneel", "crawl"];
  if ((p.stride ?? 0) > 0.05) return (p.stride ?? 0) >= 0.6 ? ["run", "walk"] : ["walk", "run"];
  if ((p.aimR ?? 0) >= 0.9) return ["aim", "shoot", "point"];
  return ["idle"];
}

export class ClipRig {
  /**
   * @param {THREE.Object3D} root  a cloneRigged() model
   * @param {object} [o]
   * @param {(root) => object} [o.procedural]  makes a HumanoidRig for poses with no clip
   */
  constructor(root, { procedural = null } = {}) {
    const info = riggedInfo(root);
    this.isClipRig = true;
    this.valid = true;
    this.root = root;
    this.info = info;
    this.clips = info.clips;
    this.meta = info.meta ?? {};
    // Bind pose now: the procedural rig records it as its rest.
    root.updateMatrixWorld(true);
    let proc = null;
    try {
      proc = procedural ? procedural(root) : null;
    } catch {
      proc = null;
    }
    this.proc = proc?.valid ? proc : null;
    this.bones = mapRigBones(root);
    this.hipHeight = info.body?.hipY ?? 0.95;
    this.legSide = { L: 1, R: -1 };
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.seed = Math.random();
    // Variants of each clip ("walk", "walk_2" ...), for a crowd.
    this.variants = new Map();
    for (const name of this.clips.keys()) {
      const base = name.replace(/_?\d+$/, "");
      if (!this.variants.has(base)) this.variants.set(base, []);
      this.variants.get(base).push(name);
    }
    this.base = null; // { name, action } - the looping state
    this.shot = null; // { name, action, hold } - a full-body one-shot over it
    this.overlays = []; // upper-body layers
    this.add = new Map(); // bone key -> model-space Quaternion (additive)
    this.mode = "clip"; // or "proc"
    this.procW = 0;
    this.pending = 0;
    this.gotDt = false;
    this.wall = null;
    this.dead = false;
    this._kicks = 0;
    this._snap = new Map();
    this._procBones = this.proc ? [...this.proc.state.values()].map((s) => s.bone) : [];
    // Out of the bind pose (a T-pose) at once: someone the level hasn't
    // started animating yet stands in their idle, not with arms out.
    if (this.play(this.pick(["idle"]) ?? [...this.clips.keys()][0] ?? "", { fade: 0 })) this._evaluate(0);
  }

  /** Has a clip (or a variant of it). */
  has(name) {
    return this.variants.has(name) || this.clips.has(name);
  }

  /** The first of `names` this rig has (a string or a list), or null. */
  pick(names) {
    for (const n of [].concat(names ?? [])) if (n && this.has(n)) return n;
    return null;
  }

  _variant(name) {
    const list = this.variants.get(name);
    if (!list?.length) return this.clips.has(name) ? name : null;
    return list[Math.floor(this.seed * list.length) % list.length];
  }

  _action(name) {
    let action = this.actions.get(name);
    if (!action) {
      const clip = this.clips.get(name);
      if (!clip) return null;
      action = this.mixer.clipAction(clip);
      const loop = LOOPS.test(name);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      this.actions.set(name, action);
    }
    return action;
  }

  /** Ground speed (m/s) a locomotion clip was made at. */
  clipSpeed(name) {
    const m = this.meta[name]?.speed;
    if (m > 0.05) return m;
    return DEFAULT_SPEED[name.replace(/_?\d+$/, "")] ?? null;
  }

  /** Advance time (seconds). pose({ dt }) does the same. */
  update(dt) {
    if (dt > 0) this.pending += dt;
    this.gotDt = true;
    return this;
  }

  /**
   * Play `name` as the looping state. `speed` (m/s) syncs a locomotion
   * clip's rate; `rate` sets it directly. A change crossfades, in step.
   */
  play(name, { fade = 0.25, speed = null, rate = null, restart = false } = {}) {
    const clipName = this._variant(name);
    if (!clipName) return false;
    const action = this._action(clipName);
    if (this.base?.name !== clipName || restart) {
      const prev = this.base?.action;
      const loops = LOOPS.test(clipName);
      action.reset();
      action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loops;
      action.enabled = true;
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(1);
      if (prev && loops && LOOPS.test(this.base.name) && prev !== action) {
        // Keep the feet in step: the same point in the cycle.
        action.time = ((prev.time % prev.getClip().duration) / prev.getClip().duration) * action.getClip().duration;
      } else if (!prev && loops) {
        action.time = this.seed * action.getClip().duration;
      }
      action.play();
      if (!this.shot) {
        if (prev && prev !== action) prev.crossFadeTo(action, fade, false);
        else if (!prev && fade > 0) action.fadeIn(Math.min(fade, 0.1));
      } else {
        action.setEffectiveWeight(0);
        if (prev && prev !== action) prev.fadeOut(fade);
      }
      this.base = { name: clipName, action };
    }
    const s = this.clipSpeed(clipName);
    let r = rate ?? 1;
    if (speed !== null && s) r = clamp(speed / s, 0.55, 1.9);
    this.base.action.timeScale = r * (0.94 + this.seed * 0.12);
    return true;
  }

  /** A full-body one-shot over the loop; back to the loop as it ends (unless `hold`). */
  once(name, { fade = 0.15, hold = false, rate = 1 } = {}) {
    const clipName = this._variant(name);
    if (!clipName) return false;
    const action = this._action(clipName);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = rate;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    if (this.shot && this.shot.action !== action) this.shot.action.crossFadeTo(action, fade, false);
    else if (this.base && this.base.action !== action) this.base.action.crossFadeTo(action, fade, false);
    else action.fadeIn(fade);
    this.shot = { name: clipName, action, hold, fade };
    return true;
  }

  /** A one-shot on the upper body only (a hit while running, a throw). */
  overlay(name, { weight = 1, rate = 1, fade = 0.12 } = {}) {
    const clipName = this._variant(name);
    const clip = clipName && this.clips.get(clipName);
    if (!clip) return false;
    const tracks = [];
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf(".");
      const node = track.name.slice(0, dot);
      const prop = track.name.slice(dot + 1);
      if (prop !== "quaternion" || !UPPER.test(node) || LOWER_EXCEPTIONS.test(node)) continue;
      const bone = this.root.getObjectByName(node);
      if (!bone) continue;
      tracks.push({ bone, interpolant: track.createInterpolant(new Float32Array(4)) });
    }
    if (!tracks.length) return false;
    this.overlays = this.overlays.filter((o) => o.name !== clipName);
    this.overlays.push({ name: clipName, tracks, t: 0, duration: clip.duration, weight, rate, fade });
    return true;
  }

  /** A hit: its clip over whatever they're doing. Returns the flinch spring's share. */
  react(flinch = null) {
    if (flinch) {
      if (flinch.kicks === this._kicks) return this.has("hit") ? 0.45 : 1;
      this._kicks = flinch.kicks;
    }
    if (this.dead || !this.has("hit")) return 1;
    const moving = this.base && /^(walk|run|crawl|strafe)/.test(this.base.name);
    if (moving || this.shot) this.overlay("hit", { weight: 0.85 });
    else this.once("hit", { fade: 0.08 });
    return 0.45;
  }

  /** Death: the die clip, held on its last frame. False if there is none. */
  die({ fade = 0.12 } = {}) {
    if (!this.has("die")) return false;
    this.dead = true;
    this.overlays.length = 0;
    this.mode = "clip";
    this.once("die", { fade, hold: true });
    return true;
  }

  /** Give the skeleton to the procedural rig for good (a death with no clip). */
  procedural() {
    this.mode = "proc";
    this.procW = 1;
    this.dead = true;
    this.mixer.stopAllAction();
    return this.proc;
  }

  /* ---- HumanoidRig's interface ---- */

  reset() {
    this.add.clear();
    return this;
  }

  rotate(key, axis, angle) {
    if (!angle) return this;
    if (this.mode === "proc" && this.proc) {
      this.proc.rotate(key, axis, angle);
      return this;
    }
    if (!this.bones[key]) return this;
    _q.setFromAxisAngle(axis, angle);
    const r = this.add.get(key);
    if (r) r.premultiply(_q);
    else this.add.set(key, _q.clone());
    return this;
  }

  rotateQ(key, q) {
    if (this.mode === "proc" && this.proc) {
      this.proc.rotateQ(key, q);
      return this;
    }
    if (!this.bones[key]) return this;
    const r = this.add.get(key);
    if (r) r.premultiply(q);
    else this.add.set(key, q.clone());
    return this;
  }

  armsDown() {
    return this;
  }

  /**
   * HumanoidRig.pose()'s parameters, plus:
   *   clip    the clip to play (a list: the first this rig has)
   *   speed   m/s, to sync a walk or run
   *   rate    playback rate when there's no speed
   *   once    play it once and hold (a scream, a fall)
   *   dt      seconds to advance
   * No clip for it: the pose is done procedurally, as before, blended in.
   */
  pose(params = {}) {
    this.reset();
    if (params.dt) this.update(params.dt);
    if (this.dead) return this;
    const want = this.pick(params.clip ?? guessClip(params));
    if (want) {
      this.mode = "clip";
      if (params.once) {
        if (this.shot?.name !== this._variant(want)) this.once(want, { hold: true, rate: params.rate ?? 1 });
      } else {
        if (this.shot?.hold && !this.dead) this._release();
        this.play(want, { speed: params.speed ?? null, rate: params.rate ?? null });
      }
      // The expressive bits of a pose go on top: where the head hangs, a twist.
      const k = params.additive ?? 0.5;
      if (params.headNod) {
        this.rotate("neck", X, params.headNod * 0.35 * k);
        this.rotate("head", X, params.headNod * 0.4 * k);
      }
      if (params.headTilt) this.rotate("head", Z, params.headTilt * k);
      if (params.twist) this.rotate("chest", Y, params.twist * k);
      if (params.addLean) this.rotate("spineLow", X, params.addLean);
    } else if (this.proc) {
      this.mode = "proc";
      this.proc.pose(params);
    } else {
      this.mode = "clip";
      this.play(this.pick(["idle"]) ?? [...this.clips.keys()][0], {});
    }
    return this;
  }

  _release() {
    if (!this.shot) return;
    const base = this.base?.action;
    if (base) {
      base.enabled = true;
      base.play();
      this.shot.action.crossFadeTo(base, this.shot.fade ?? 0.2, false);
    } else this.shot.action.fadeOut(0.2);
    this.shot = null;
  }

  /** Write the pose into the bones. */
  apply() {
    let dt = this.pending;
    const now = (globalThis.performance?.now?.() ?? Date.now()) / 1000;
    if (!this.gotDt) dt = this.wall === null ? 0 : clamp(now - this.wall, 0, 0.1);
    this.wall = now;
    this.pending = 0;
    this.gotDt = false;
    this._evaluate(dt);
    return this;
  }

  _evaluate(dt) {
    // A one-shot that isn't held hands back to the loop as it ends.
    const shot = this.shot;
    if (shot && !shot.hold) {
      const a = shot.action;
      const left = (a.getClip().duration - a.time) / Math.max(0.01, Math.abs(a.timeScale));
      if (left <= (shot.fade ?? 0.15) + dt) this._release();
    }
    this.mixer.update(dt);

    // Upper-body overlays.
    if (this.overlays.length) {
      for (const o of this.overlays) {
        o.t += dt * o.rate;
        const w = o.weight * smoothstep(o.t, 0, o.fade) * (1 - smoothstep(o.t, o.duration - o.fade * 1.5, o.duration));
        for (const { bone, interpolant } of o.tracks) {
          const values = interpolant.evaluate(Math.min(o.t, o.duration));
          bone.quaternion.slerp(_q2.fromArray(values), w);
        }
      }
      this.overlays = this.overlays.filter((o) => o.t < o.duration);
    }

    // Procedural poses blend over the clip.
    const procTarget = this.mode === "proc" && this.proc ? 1 : 0;
    if (!this._evaluated) this.procW = procTarget;
    this._evaluated = true;
    this.procW += (procTarget - this.procW) * Math.min(1, dt / 0.2);
    if (procTarget === 0 && this.procW < 0.01) this.procW = 0;
    if (procTarget === 1 && this.procW > 0.99) this.procW = 1;
    if (this.proc && this.procW > 0) {
      const snap = this._snap;
      for (const bone of this._procBones) snap.set(bone, (snap.get(bone) ?? new THREE.Quaternion()).copy(bone.quaternion));
      this.proc.apply();
      if (this.procW < 1) for (const bone of this._procBones) bone.quaternion.copy(snap.get(bone)).slerp(_q2.copy(bone.quaternion), this.procW);
    }

    // Additive model-space rotations, about each bone's posed parent.
    if (this.add.size && this.mode === "clip") {
      this.root.updateMatrixWorld(true);
      this.root.getWorldQuaternion(_q3).invert();
      for (const [key, r] of this.add) {
        const bone = this.bones[key];
        if (!bone?.parent) continue;
        const p = bone.parent.getWorldQuaternion(_q).premultiply(_q3);
        bone.quaternion.premultiply(p).premultiply(r).premultiply(p.invert());
      }
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

/* ------------------------------------------------------------------ */
/* RiggedBody: the player                                               */
/* ------------------------------------------------------------------ */

/** Two-bone IK, in world space: point upper -> lower -> end at `target`, the elbow toward `pole`. */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _g = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

function turnBone(bone, from, to, weight) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _qa.setFromUnitVectors(from.normalize(), to.normalize());
  if (weight < 1) _qa.slerp(_qi.identity(), 1 - weight);
  bone.parent.getWorldQuaternion(_qb);
  bone.quaternion.premultiply(_qb).premultiply(_qa).premultiply(_qb.invert());
  bone.updateMatrixWorld(true);
}

export function solveTwoBone(upper, lower, end, target, pole, weight = 1) {
  if (!upper || !lower || !end || weight <= 0) return;
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _d.subVectors(target, _a);
  const dist = clamp(_d.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  _d.normalize();
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.subVectors(_b, _a).addScaledVector(_d, -_f.subVectors(_b, _a).dot(_d));
  _p.normalize();
  _e.copy(_a).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
  turnBone(upper, _f.subVectors(_b, _a), _g.subVectors(_e, _a), weight);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _t.copy(_a).addScaledVector(_d, dist);
  turnBone(lower, _f.subVectors(_c, _b), _g.subVectors(_t, _b), weight);
}

/**
 * The player's rigged body. PlayerAvatar (player.js) keeps doing what it does
 * - the lean, the contact shadow, the mounts - and hands this the state it
 * already computes; uniforms written by other hosts (the lift's Performer,
 * the prologue's sleeper) are read here too, so every scene works unchanged.
 */
export class RiggedBody {
  constructor(model) {
    this.model = model;
    this.rig = new ClipRig(model);
    this.look = riggedLook(model);
    this.bodyInfo = riggedInfo(model).body;
    // The shader rig's uniforms, kept as plain values: hosts write them.
    this.uniforms = {
      uPhase: { value: 0 }, uStride: { value: 0 }, uArmSwing: { value: 0 }, uLean: { value: 0 }, uCrouch: { value: 0 },
      uTuck: { value: 0 }, uHold: { value: 1 }, uReachUp: { value: 0 }, uRest: { value: 0 }, uHipY: { value: this.bodyInfo.hipY },
      uKneeY: { value: this.bodyInfo.kneeY }, uShoulderX: { value: this.bodyInfo.shoulderX }, uShoulderY: { value: this.bodyInfo.shoulderY },
      uElbowX: { value: this.bodyInfo.elbowX }, uArmDrop: { value: 1.32 }, uGait: { value: 0 }, uLegR: { value: new THREE.Vector2() },
      uLegL: { value: new THREE.Vector2() }, uTwist: { value: 0 }, uThrow: { value: new THREE.Vector4() },
    };
    this.hold = 1;
    this.reach = 0;
    this.state = "idle";
    this.airT = 0;
    this.lastStumble = 0;
    this.throwT = null;
    this.flailing = false;
    // The chest's rest orientation, to lean the launcher mount with the torso.
    model.updateMatrixWorld(true);
    const chest = this.rig.bones.chest;
    this.chestRest = chest ? model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(chest.getWorldQuaternion(new THREE.Quaternion())) : null;
  }

  /** The state, from the uniforms (hosts that drive those directly). */
  _fromUniforms() {
    const u = this.uniforms;
    return {
      speed: u.uStride.value > 0.05 ? 1 + u.uStride.value * 6 : 0,
      airborne: u.uTuck.value > 0.5,
      sliding: u.uCrouch.value > 0.6 || (u.uSlide?.value ?? 0) > 0.6,
      hold: u.uHold.value,
      reachUp: u.uReachUp.value,
      rest: u.uRest.value,
      lateral: 0,
      stumble: 0,
    };
  }

  /** Throw: the throw clip on the upper body (the shader rig's keys otherwise). */
  throw() {
    this.throwT = 0;
    if (!this.rig.overlay("throw", { rate: 1.2 })) this.throwT = 0;
  }

  /** Falling: the fall clip, every frame instead of update(). */
  flail(time, avatar) {
    const dt = this._flailT === undefined ? 0 : clamp(time - this._flailT, 0, 0.1);
    this._flailT = time;
    this.flailing = true;
    this.update(dt, avatar, { speed: 0, airborne: true, falling: true, hold: 0, reachUp: 0 });
  }

  /**
   * @param {number} dt
   * @param {object} avatar  the PlayerAvatar (mounts: shoulder, back, body)
   * @param {object} [s]     { speed, lateral, airborne, sliding, stumble, hold, reachUp, rest, falling }
   */
  update(dt, avatar, s = null) {
    s = s ?? this._fromUniforms();
    const rig = this.rig;
    const k = (rate) => 1 - Math.exp(-dt * rate);
    this.hold += ((s.hold ?? 1) - this.hold) * k(10);
    this.reach += ((s.reachUp ?? 0) - this.reach) * k(8);
    this.airT = s.airborne ? this.airT + dt : 0;
    if (!s.falling) this._flailT = undefined;

    // What the legs are doing.
    let want;
    let speed = null;
    let once = false;
    const lateral = s.lateral ?? 0;
    if (s.falling) want = ["fall", "jump", "idle"];
    else if (this.reach > 0.6) want = (s.speed ?? 0) > 0.3 ? ["climb", "hang", "idle"] : ["hang", "climb", "idle"];
    else if (s.sliding) {
      want = (s.speed ?? 0) > 9 && rig.has("dodge") && s.dodge ? ["dodge", "slide"] : ["slide", "dodge", "kneel", "idle"];
      once = true;
    } else if (s.airborne) {
      want = this.airT < 0.9 || !rig.has("fall") ? ["jump", "fall", "run", "idle"] : ["fall", "jump", "idle"];
      once = want[0] === "jump" || !rig.has("fall");
    } else if ((s.speed ?? 0) > 0.5) {
      speed = s.speed;
      if (Math.abs(lateral) > 3.5 && rig.has(lateral > 0 ? "strafe_right" : "strafe_left")) want = [lateral > 0 ? "strafe_right" : "strafe_left", "run"];
      else want = speed < 2.2 ? ["walk", "run"] : ["run", "walk"];
    } else if ((s.rest ?? 0) > 0.5) want = ["wake", "idle"];
    else want = ["idle"];

    const name = rig.pick(want);
    if (name) {
      if (once) {
        if (rig.shot?.name !== rig._variant(name)) rig.once(name, { hold: true, fade: 0.12, rate: name === "jump" ? 1.25 : 1 });
      } else {
        if (rig.shot) rig._release();
        rig.play(name, { speed, rate: (s.rest ?? 0) > 0.5 ? 0 : null });
      }
    }
    // A hit lands: the hit clip over the run.
    if ((s.stumble ?? 0) > 0.5 && this.lastStumble <= 0.5) rig.react();
    this.lastStumble = s.stumble ?? 0;

    rig.reset();
    rig.update(dt);
    rig.apply();
    if (this.throwT !== null) {
      this.throwT += dt;
      if (this.throwT > 0.6) this.throwT = null;
    }
    this._placeMounts(avatar);
    this._hands(avatar, s);
  }

  /** The launcher mount and the bag follow the shoulders and the torso's lean. */
  _placeMounts(avatar) {
    if (!avatar) return;
    const bones = this.rig.bones;
    const b = this.bodyInfo;
    avatar.body.updateMatrixWorld(true);
    if (bones.armR && avatar.shoulder) {
      avatar.body.worldToLocal(bones.armR.getWorldPosition(_v));
      avatar.shoulder.position.set(_v.x + 0.08, _v.y + 0.12, _v.z + 0.02);
      if (this.chestRest && bones.chest) {
        // The chest's turn from rest, in model space, applied to "up" -> body space (the model is turned by PI).
        this.model.getWorldQuaternion(_q).invert().multiply(bones.chest.getWorldQuaternion(_q2));
        _q.multiply(_q3.copy(this.chestRest).invert());
        const up = _v2.copy(Y).applyQuaternion(_q);
        avatar.shoulder.rotation.x = Math.atan2(-up.z, up.y) * 0.8 * (this.hold > 0.5 ? 1 : 0);
      }
    }
    if (bones.chest && avatar.back) {
      avatar.body.worldToLocal(bones.chest.getWorldPosition(_v));
      avatar.back.position.set(_v.x, _v.y - 0.05, _v.z + Math.max(0.14, b.shoulderX * 0.62));
      avatar.back.rotation.x = avatar.shoulder?.rotation.x ?? 0;
    }
  }

  /** Both hands on the launcher (hold), or up on the rungs (no hang clip). */
  _hands(avatar, s) {
    const bones = this.rig.bones;
    if (!avatar?.shoulder || !bones.armR || !bones.armL) return;
    const holding = this.hold * (1 - this.reach) * (s.falling ? 0 : 1);
    if (holding > 0.02) {
      avatar.shoulder.updateMatrixWorld(true);
      const m = avatar.shoulder;
      // Right hand on the grip under the tube; left further out along it.
      const right = m.localToWorld(_c.set(-0.05, -0.2, -0.3));
      const poleR = avatar.body.localToWorld(_v.set(0.9, -1, 0.6)).sub(avatar.body.getWorldPosition(_v2));
      solveTwoBone(bones.armR, bones.forearmR, bones.handR, right, poleR, holding);
      const left = m.localToWorld(_t.set(-0.12, -0.15, -0.62));
      const poleL = avatar.body.localToWorld(_v.set(-0.6, -1, 0.1)).sub(avatar.body.getWorldPosition(_v2));
      solveTwoBone(bones.armL, bones.forearmL, bones.handL, left, poleL, holding);
    }
    // Arms overhead for the ladder, when there's no clip for it.
    const reach = this.reach * (this.rig.has("hang") || this.rig.has("climb") ? 0 : 1);
    if (reach > 0.02) {
      for (const [arm, fore, hand, x] of [[bones.armR, bones.forearmR, bones.handR, 0.18], [bones.armL, bones.forearmL, bones.handL, -0.18]]) {
        const target = avatar.body.localToWorld(_t.set(x, this.bodyInfo.shoulderY + 0.62, -0.12));
        const pole = avatar.body.localToWorld(_v.set(x * 4, 0, 0.6)).sub(avatar.body.getWorldPosition(_v2));
        solveTwoBone(arm, fore, hand, target, pole, reach);
      }
    }
  }

  /** Where the right hand lets go of a throw, world space. */
  releasePoint(out) {
    const hand = this.rig.bones.handR;
    if (!hand) return null;
    return hand.getWorldPosition(out);
  }

  dispose() {
    this.rig.dispose();
    for (const m of OWN.get(this.model) ?? []) m.dispose();
  }
}
