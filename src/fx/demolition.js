/**
 * Buildings coming down: Dr. Vale's demolition charges flash floor by floor,
 * a blast cuts the core and blows the facade out (slabs, glass, fireballs,
 * smoke), then the collapse runs down the tower - the top drops and leans,
 * crushing the floors under it one at a time, and sinks into the dust cloud
 * rolling out of every floor it takes. Shared by the Skyline (Tower C, the
 * story's blast) and the Roof (the towers round Ascension), and by the
 * helicopter crash (heli-crash.js), which punches a burning hole in one.
 *
 *   const fx = new DemolitionFX({ quality: "high" });   // one per scene
 *   scene.add(fx.root);
 *   const tower = new DemolitionBuilding({ fx, position, top: 12, floors: 18 });
 *   scene.add(tower.root);
 *   tower.onEvent = (name, info) => {};   // charges, charge, blast, collapse, crush, down
 *   tower.detonate({ viewer: camera.position });
 *   tower.update(dt);  fx.update(dt, camera);   // every frame
 *
 * The building is breakable chunks: every floor a grid of slabs, the whole
 * tower one InstancedMesh, its windows drawn by the shader in the building's
 * own frame (so they stay on the pieces that fall). Below the chunks a
 * single stump runs down into the haze. The dust, the fire and the small
 * debris are GPU particles: written once when born (where, how fast, how
 * long), then the vertex shader works out where each one is - the CPU never
 * touches it again. Nothing here is a light or casts a shadow: flashes and
 * fire are additive and bright enough to bloom; the dust is lit by uniforms.
 */

import * as THREE from "../three.js";

/** Particles and debris pieces alive at once (and how much of each burst), by quality. */
const BUDGET = {
  high: { dust: 260, fire: 340, shards: 320, octaves: 4, scale: 1 },
  medium: { dust: 170, fire: 230, shards: 200, octaves: 3, scale: 0.7 },
  low: { dust: 90, fire: 130, shards: 110, octaves: 2, scale: 0.45 },
};
const GRAVITY = 9.8;
/**
 * The night it's all lit by (linear RGB): a dim sky, the moon from above,
 * and the city's fires from below.
 */
const LIGHT = { ambient: [0.05, 0.055, 0.07], key: [0.16, 0.18, 0.24], keyDir: new THREE.Vector3(-0.42, 0.84, -0.28), fire: [0.55, 0.24, 0.08] };
/** The falling top accelerates at this share of g (the floors under it resist). */
const FALL_ACCEL = 0.62;
/** ...and keeps this much of its speed through each floor it crushes. */
const CRUSH_KEEP = 0.86;
const FALL_MAX_SPEED = 22;
/** Seconds from the last charge to the blast that cuts the core, and from that to the drop. */
export const BLAST_DELAY = 0.3;
const FALL_DELAY = 0.35;
/** Seconds the ruin smokes on afterwards. */
const SMOULDER = 26;
/** A fallen slab is gone this far below the bottom of the chunks (it's in the haze), or after this long. */
const VANISH_BELOW = 70;
const DEBRIS_LIFE = 11;
/** Fire particle kinds (the fire shader's branches). */
const FIRE = { ball: 0, flash: 1, glitter: 2, ember: 3 };
/** Shard kinds (the shard shader's branches). */
export const SHARD = { concrete: 0, glass: 1, metal: 2 };
/** Chunk modes. */
const STATIC = 0;
const UPPER = 1;
const DEBRIS = 2;
const GONE = 3;
/** The four facades, outward: +x, +z, -x, -z. */
const FACES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1)];

const rand = (a, b) => a + Math.random() * (b - a);

/* ==================================================================== */
/* Shaders                                                               */
/* ==================================================================== */

/** Value noise and fbm (OCTAVES is defined per quality). */
const NOISE_GLSL = /* glsl */ `
float dHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float dNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), u.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float dFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    v += a * dNoise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return v;
}
`;

/**
 * Exponential-squared fog by hand, with a scale: a burning tower is bright
 * enough to be seen further into the haze than the scene's own fog allows
 * (the Skyline's is thick). 0 = clear, 1 = all fog.
 */
const FOG_GLSL = /* glsl */ `
uniform float uFogScale;
float demoFog() {
  #ifdef USE_FOG
    float d = vFogDepth * uFogScale;
    #ifdef FOG_EXP2
      return 1.0 - exp(-fogDensity * fogDensity * d * d);
    #else
      return smoothstep(fogNear, fogFar, d);
    #endif
  #else
    return 0.0;
  #endif
}
`;

/** Rodrigues rotation of v about a unit axis (the debris tumbling). */
const ROTATE_GLSL = /* glsl */ `
vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
`;

/** Shared head of the two billboard shaders: one quad per particle, born at aTime.x, aTime.y long. */
const BILLBOARD_HEAD = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec2 aTime;
attribute vec3 aShape;
attribute vec4 aMisc;
uniform float uTime;
uniform float uPixel;
varying vec2 vUv;
varying float vK;
varying float vAge;
varying vec4 vMisc;
varying float vShape;
`;

/**
 * Dust and smoke: big soft puffs. Pushed out fast, slowed by the air
 * (aMisc.y drag), rising at a steady rate (aMisc.z), swelling as they go.
 * aShape = (start size, end size, shade: 0 black smoke .. 1 pale dust),
 * aMisc = (seed, drag, rise, how fire-lit).
 */
const DUST_VERTEX = BILLBOARD_HEAD + /* glsl */ `
varying float vNear;
void main() {
  float age = uTime - aTime.x;
  float k = age / aTime.y;
  if (k < 0.0 || k > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vK = k;
  vAge = age;
  vMisc = aMisc;
  vShape = aShape.z;
  vUv = position.xy * 2.0;
  float drag = aMisc.y;
  float travel = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = aOrigin + aVelocity * travel;
  p.y += aMisc.z * age;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  float size = mix(aShape.x, aShape.y, 1.0 - pow(1.0 - k, 2.2));
  float a = aMisc.x * 6.2831 + age * (aMisc.x - 0.5) * 0.25;
  vec2 c = vec2(cos(a) * position.x - sin(a) * position.y, sin(a) * position.x + cos(a) * position.y);
  mvPosition.xy += c * size;
  // A puff right on the camera would be a wall of grey: fade it out close up.
  vNear = smoothstep(1.5, 5.0, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const DUST_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uDust;
uniform vec3 uSmoke;
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform vec3 uFire;
uniform float uOpacity;
varying vec2 vUv;
varying float vK;
varying float vAge;
varying vec4 vMisc;
varying float vShape;
varying float vNear;
${NOISE_GLSL}
${FOG_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  vec2 q = vUv * 1.25 + vec2(vMisc.x * 31.7, vMisc.x * 17.3);
  float n = dFbm(q + vec2(vAge * 0.04, -vAge * 0.1));
  // Billowing: a ragged soft edge, denser lumps inside.
  float body = 1.0 - smoothstep(0.3, 1.0, r + (n - 0.5) * 0.95);
  float fade = smoothstep(0.0, 0.05, vK) * (1.0 - smoothstep(0.42, 1.0, vK));
  float alpha = body * fade * uOpacity * vNear * (0.6 + 0.6 * n);
  if (alpha < 0.004) discard;
  // Lit from above by the sky, from below by the fires.
  float top = clamp(vUv.y * 0.5 + 0.5 + (n - 0.5) * 0.4, 0.0, 1.0);
  vec3 base = mix(uSmoke, uDust, vShape);
  vec3 colour = base * (uAmbient * 3.0 + uKeyColor * (0.8 + top * 1.6)) * (0.7 + 0.6 * n);
  float warm = vMisc.w * exp(-vAge * 0.35) * (1.15 - top * 0.8);
  colour += uFire * warm * (0.8 + 1.2 * n);
  #ifdef USE_FOG
    colour = mix(colour, fogColor, demoFog());
  #endif
  gl_FragColor = vec4(colour, min(alpha, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Fire, flashes, glass glitter and embers: additive. Thrown out (drag
 * aMisc.y), pulled by aMisc.z (gravity down, buoyancy up), aShape.z the
 * kind, aMisc.w the intensity (or, for glitter, how fire-lit the glass is).
 */
const FIRE_VERTEX = BILLBOARD_HEAD + /* glsl */ `
void main() {
  float age = uTime - aTime.x;
  float k = age / aTime.y;
  if (k < 0.0 || k > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vK = k;
  vAge = age;
  vMisc = aMisc;
  vShape = aShape.z;
  vUv = position.xy * 2.0;
  float drag = aMisc.y;
  float travel = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = aOrigin + aVelocity * travel;
  p.y += 0.5 * aMisc.z * age * age;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  float grow = aShape.z < 0.5 ? 1.0 - pow(1.0 - k, 3.0) : k;
  float size = mix(aShape.x, aShape.y, grow);
  // Glints and embers stay a couple of pixels across however far off.
  if (aShape.z > 1.5) size = max(size, uPixel * -mvPosition.z * 2.5);
  float a = aMisc.x * 6.2831 + age * (aMisc.x - 0.5) * 0.8;
  vec2 c = vec2(cos(a) * position.x - sin(a) * position.y, sin(a) * position.x + cos(a) * position.y);
  mvPosition.xy += c * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FIRE_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec2 vUv;
varying float vK;
varying float vAge;
varying vec4 vMisc;
varying float vShape;
${NOISE_GLSL}
${FOG_GLSL}
/** Hot to cooling: white, yellow, orange, deep red. */
vec3 fireRamp(float h) {
  vec3 c = mix(vec3(0.3, 0.03, 0.01), vec3(1.0, 0.3, 0.04), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(1.0, 0.7, 0.24), smoothstep(0.35, 0.7, h));
  return mix(c, vec3(1.0, 0.95, 0.82), smoothstep(0.72, 1.0, h));
}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  vec3 colour;
  if (vShape < 0.5) {
    // A fireball: domain-warped noise boiling up and out, burning down
    // from white-hot to red as it cools.
    vec2 q = vUv * 1.6 + vMisc.x * 23.0;
    float n = dFbm(q + vec2(0.0, -vAge * 1.5));
    float m = dFbm(q * 2.2 + vec2(n * 1.7, -vAge * 2.4));
    float shape = 1.0 - smoothstep(0.2, 1.0, r * (0.75 + 0.65 * n));
    float heat = shape * (0.45 + 0.75 * m) * (1.0 - vK * 0.8);
    heat *= 1.0 - smoothstep(0.55, 1.0, vK);
    colour = fireRamp(clamp(heat * 1.2, 0.0, 1.0)) * smoothstep(0.05, 0.3, heat) * (0.6 + heat * 2.4) * vMisc.w;
  } else if (vShape < 1.5) {
    // A charge going off: a white-hot core, a halo and a star of rays.
    float core = exp(-r * r * 10.0);
    float halo = exp(-r * 3.5) * 0.35;
    float rays = max(0.0, 1.0 - abs(vUv.x) * 10.0) * (1.0 - abs(vUv.y)) + max(0.0, 1.0 - abs(vUv.y) * 10.0) * (1.0 - abs(vUv.x));
    float life = (1.0 - vK) * (1.0 - vK);
    colour = vec3(1.0, 0.86, 0.62) * (core * 2.5 + halo + rays * 0.5) * life * vMisc.w;
  } else if (vShape < 2.5) {
    // Glass: a glint that comes and goes as the piece tumbles.
    float tw = 0.5 + 0.5 * sin(vAge * (12.0 + vMisc.x * 30.0) + vMisc.x * 50.0);
    tw = tw * tw * tw * tw;
    float star = exp(-r * r * 7.0) + 0.45 * max(0.0, 1.0 - abs(vUv.x) * 7.0) * (1.0 - abs(vUv.y));
    vec3 tint = mix(vec3(0.75, 0.88, 1.0), vec3(1.0, 0.72, 0.45), vMisc.w);
    colour = tint * star * (0.12 + 2.6 * tw) * (1.0 - vK * vK);
  } else {
    float flick = 0.6 + 0.4 * sin(vAge * 23.0 + vMisc.x * 40.0);
    colour = vec3(1.0, 0.42, 0.1) * exp(-r * r * 5.0) * 2.2 * flick * (1.0 - vK);
  }
  colour *= 1.0 - demoFog();
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Small debris: concrete lumps, glass panes, metal panels - tumbling and
 * falling with air resistance (glass flutters, concrete drops), all on the
 * GPU. aScale = (size xyz, kind), aSpin = (axis, rad/s).
 */
const SHARD_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec2 aTime;
attribute vec4 aSpin;
attribute vec4 aScale;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vKind;
varying float vAge;
${ROTATE_GLSL}
void main() {
  float age = uTime - aTime.x;
  float k = age / aTime.y;
  if (k < 0.0 || k > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float drag = aScale.w > 0.5 && aScale.w < 1.5 ? 0.9 : 0.15;
  float travel = (1.0 - exp(-drag * age)) / drag;
  vec3 p = aOrigin + aVelocity * travel;
  p.y -= ${GRAVITY.toFixed(1)} / drag * (age - travel);
  vec3 axis = normalize(aSpin.xyz + vec3(1e-4));
  float angle = aSpin.w * age;
  vec3 local = rotateAxis(position * aScale.xyz, axis, angle);
  vNormalW = normalize(mat3(modelMatrix) * rotateAxis(normal / aScale.xyz, axis, angle));
  vec4 world = modelMatrix * vec4(p + local, 1.0);
  vWorld = world.xyz;
  vKind = aScale.w;
  vAge = age;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SHARD_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform vec3 uKeyDir;
uniform vec3 uFire;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vKind;
varying float vAge;
${FOG_GLSL}
void main() {
  vec3 n = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  float diff = max(dot(n, uKeyDir), 0.0);
  float under = max(-n.y, 0.0);
  vec3 colour;
  if (vKind < 0.5) {
    // Concrete, still glowing for a moment where it tore.
    colour = vec3(0.34, 0.32, 0.3) * (uAmbient * 2.0 + uKeyColor * diff * 1.4) + uFire * (0.25 + under * 0.6) * 0.5;
    colour += vec3(1.0, 0.36, 0.08) * exp(-vAge * 1.6) * 0.6;
  } else if (vKind < 1.5) {
    // Glass: dark, a fresnel sheen, and a hard glint when a face turns to a light.
    float glint = pow(clamp(dot(n, normalize(uKeyDir + V)), 0.0, 1.0), 60.0);
    float fireGlint = pow(clamp(dot(n, normalize(vec3(0.0, -1.0, 0.0) + V)), 0.0, 1.0), 24.0);
    float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);
    colour = vec3(0.04, 0.06, 0.08) + (uAmbient * 2.0 + uKeyColor) * fres * 1.5 + uKeyColor * glint * 9.0 + uFire * fireGlint * 4.0;
  } else {
    // Painted metal (a helicopter's panels), scorched.
    float spec = pow(clamp(dot(n, normalize(uKeyDir + V)), 0.0, 1.0), 30.0);
    colour = vec3(0.09, 0.11, 0.16) * (uAmbient * 2.0 + uKeyColor * diff * 1.5) + uKeyColor * spec * 2.0 + uFire * under * 0.3;
    colour += vec3(1.0, 0.4, 0.1) * exp(-vAge * 1.2) * 0.5;
  }
  #ifdef USE_FOG
    colour = mix(colour, fogColor, demoFog());
  #endif
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The building's slabs. Windows are laid out in building space - aRest is
 * the slab's place in the intact tower, aSize its size - so a slab carries
 * its own windows wherever it goes. aState = (heat, damage, interior):
 * heat > 1 is a charge's white flash, up to 1 fire inside; damage blacks
 * the windows out and scorches the concrete; an interior slab (the core)
 * has no windows.
 */
const BUILDING_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aRest;
attribute vec3 aSize;
attribute vec3 aState;
varying vec3 vB;
varying vec3 vN;
varying vec3 vNormalW;
varying vec3 vState;
void main() {
  vB = aRest + position * aSize;
  vN = normal;
  mat4 m = modelMatrix * instanceMatrix;
  vNormalW = normalize(mat3(m) * normal);
  vState = aState;
  vec4 mvPosition = viewMatrix * (m * vec4(position, 1.0));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BUILDING_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uConcrete;
uniform vec3 uGlass;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uLit;
uniform float uSeed;
uniform float uGlow;
uniform vec2 uGrid;
uniform vec3 uAmbient;
uniform vec3 uKeyColor;
uniform vec3 uKeyDir;
uniform vec3 uFire;
uniform float uTime;
varying vec3 vB;
varying vec3 vN;
varying vec3 vNormalW;
varying vec3 vState;
${NOISE_GLSL}
${FOG_GLSL}
void main() {
  vec3 n = normalize(vNormalW);
  float side = 1.0 - step(0.5, abs(vN.y));
  float onX = step(0.5, abs(vN.x));
  float along = mix(vB.x, vB.z, onX);
  float face = onX * (1.0 + step(0.0, vN.x)) + (1.0 - onX) * (3.0 + step(0.0, vN.z));
  vec2 cell = vec2(along / uGrid.x, vB.y / uGrid.y);
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  // A window between mullions, a spandrel under it; none on the core.
  float win = side * (1.0 - vState.z) * step(0.09, f.x) * step(f.x, 0.91) * step(0.26, f.y) * step(f.y, 0.9);
  float h = dHash(id + face * 41.3 + uSeed);
  float floorOn = step(0.16, dHash(vec2(id.y * 1.37, face + uSeed)));
  float lit = step(1.0 - uLit, h) * floorOn;
  vec3 lamp = mix(uWarm, uCool, step(0.8, dHash(id * 1.91 + 7.0 + uSeed)));
  // The frame: concrete lit by the sky, and warm from the fires below.
  float grain = 0.8 + 0.4 * dHash(floor(vB.xz * 0.5) + floor(vB.y * 0.5));
  float diff = max(dot(n, uKeyDir), 0.0);
  vec3 colour = uConcrete * grain * (uAmbient * 2.2 + uKeyColor * diff * 1.6 + uFire * (0.25 + max(-n.y, 0.0) * 0.8));
  // Glass: dark, the night sky faint in it, brighter toward each pane's head.
  vec3 glass = uGlass * (0.5 + 0.7 * f.y) * (0.7 + 0.6 * dHash(id + 3.0)) + uKeyColor * 0.08 * f.y;
  colour = mix(colour, glass, win);
  // Damage: blown windows go black, the concrete scorched.
  float damage = vState.y;
  colour *= 1.0 - 0.6 * damage;
  vec3 emissive = lamp * lit * win * uGlow * (0.7 + 0.6 * h) * (1.0 - damage);
  // Fire inside (a flicker per window), and the charge's white flash.
  float heat = vState.x;
  float flick = 0.65 + 0.35 * sin(uTime * (8.0 + h * 9.0) + h * 30.0);
  float inside = max(win, vState.z * 0.7) * mix(1.0, step(0.35, h), damage * 0.5);
  emissive += vec3(1.0, 0.38, 0.1) * min(heat, 1.0) * (inside * 2.4 + 0.2) * flick;
  emissive += vec3(1.0, 0.86, 0.62) * max(heat - 1.0, 0.0) * (win * 2.2 + 0.15);
  colour += emissive;
  #ifdef USE_FOG
    colour = mix(colour, fogColor, demoFog());
  #endif
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ==================================================================== */
/* GPU particle pools                                                    */
/* ==================================================================== */

/**
 * One instanced draw of `count` copies of `base`, with per-copy attributes
 * written round a ring: the oldest is overwritten when it's full. A copy is
 * dead until written (born a very long time ago).
 */
class Pool {
  constructor(base, count, layout, material) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const [name, attribute] of Object.entries(base.attributes)) g.setAttribute(name, attribute);
    this.attrs = {};
    for (const [name, size] of Object.entries(layout)) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.attrs[name] = a;
    }
    for (let i = 0; i < count; i += 1) this.attrs.aTime.array.set([-1e6, 1], i * 2);
    g.instanceCount = count;
    this.geometry = g;
    this.base = base;
    this.count = count;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.next = 0;
    this.dirty = false;
  }

  /** The next slot to write. */
  take() {
    const i = this.next;
    this.next = (i + 1) % this.count;
    this.dirty = true;
    return i;
  }

  set(name, i, a, b = 0, c = 0, d = 0) {
    const attribute = this.attrs[name];
    const o = i * attribute.itemSize;
    const array = attribute.array;
    array[o] = a;
    if (attribute.itemSize > 1) array[o + 1] = b;
    if (attribute.itemSize > 2) array[o + 2] = c;
    if (attribute.itemSize > 3) array[o + 3] = d;
  }

  flush() {
    if (!this.dirty) return;
    for (const a of Object.values(this.attrs)) a.needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.geometry.dispose();
    this.base.dispose();
    this.mesh.material.dispose();
  }
}

/** A rough lump: an icosahedron with its corners pushed about, flat-shaded. */
function lumpGeometry() {
  const g = new THREE.IcosahedronGeometry(0.6, 0);
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i += 1) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.7 + Math.random() * 0.55);
    const s = seen.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  g.deleteAttribute("uv");
  return g;
}

function fogUniforms(shared, own) {
  return Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), shared, own);
}

/* ==================================================================== */
/* The effects: dust, fire, debris - one set per scene                  */
/* ==================================================================== */

export class DemolitionFX {
  /**
   * @param {object} [o]
   * @param {"high"|"medium"|"low"} [o.quality]
   * @param {number} [o.fogScale]  < 1: seen further into the scene's fog than it allows
   * @param {object} [o.light]     { ambient, key, fire: [r, g, b] linear; keyDir } - the night these are lit by
   */
  constructor({ quality = "high", fogScale = 1, light = {} } = {}) {
    const budget = BUDGET[quality] ?? BUDGET.high;
    this.quality = BUDGET[quality] ? quality : "high";
    this.scale = budget.scale;
    this.root = new THREE.Group();
    this.root.name = "DemolitionFX";
    this.time = 0;
    this.shared = {
      uTime: { value: 0 },
      uPixel: { value: 0.002 },
      uFogScale: { value: fogScale },
      uAmbient: { value: new THREE.Color().setRGB(...(light.ambient ?? LIGHT.ambient)) },
      uKeyColor: { value: new THREE.Color().setRGB(...(light.key ?? LIGHT.key)) },
      uKeyDir: { value: (light.keyDir ?? LIGHT.keyDir).clone().normalize() },
      uFire: { value: new THREE.Color().setRGB(...(light.fire ?? LIGHT.fire)) },
    };
    const defines = { OCTAVES: budget.octaves };

    const quad = new THREE.PlaneGeometry(1, 1);
    const billboard = { aOrigin: 3, aVelocity: 3, aTime: 2, aShape: 3, aMisc: 4 };
    this.dustPool = new Pool(quad, budget.dust, billboard, new THREE.ShaderMaterial({
      name: "DemolitionDust",
      defines,
      uniforms: fogUniforms(this.shared, {
        uDust: { value: new THREE.Color(0.62, 0.58, 0.52) },
        uSmoke: { value: new THREE.Color(0.08, 0.075, 0.07) },
        uOpacity: { value: 0.85 },
      }),
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    }));
    this.firePool = new Pool(quad.clone(), budget.fire, billboard, new THREE.ShaderMaterial({
      name: "DemolitionFire",
      defines,
      uniforms: fogUniforms(this.shared, {}),
      vertexShader: FIRE_VERTEX,
      fragmentShader: FIRE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    }));
    this.shardPool = new Pool(lumpGeometry(), budget.shards, { aOrigin: 3, aVelocity: 3, aTime: 2, aSpin: 4, aScale: 4 }, new THREE.ShaderMaterial({
      name: "DemolitionShards",
      uniforms: fogUniforms(this.shared, {}),
      vertexShader: SHARD_VERTEX,
      fragmentShader: SHARD_FRAGMENT,
      fog: true,
    }));
    // Debris drawn first (opaque), the smoke over it, the fire over that.
    this.dustPool.mesh.renderOrder = 3;
    this.firePool.mesh.renderOrder = 4;
    this.root.add(this.shardPool.mesh, this.dustPool.mesh, this.firePool.mesh);

    /** Continuous emitters: burning holes, smoke trails, fallout round the camera. */
    this.emitters = [];
    this._inv = new THREE.Matrix4();
    this._invRot = new THREE.Matrix3();
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  /** How many of a burst to make at this quality (at least `min`). */
  n(count, min = 1) {
    return Math.max(min, Math.round(count * this.scale));
  }

  /* ---------------- Single particles (world space) ---------------- */

  _origin(pool, i, p, velocity) {
    const q = this._p.copy(p).applyMatrix4(this._inv);
    const v = this._v.copy(velocity).applyMatrix3(this._invRot);
    pool.set("aOrigin", i, q.x, q.y, q.z);
    pool.set("aVelocity", i, v.x, v.y, v.z);
  }

  /** A puff of dust (shade ~0.6) or smoke (shade ~0.1). */
  dust(p, { velocity = ZERO, size = [6, 20], life = 10, drag = 0.6, rise = 1.2, shade = 0.65, warm = 0 } = {}) {
    const pool = this.dustPool;
    const i = pool.take();
    this._origin(pool, i, p, velocity);
    pool.set("aTime", i, this.time, life * rand(0.85, 1.15));
    pool.set("aShape", i, size[0], size[1], shade);
    pool.set("aMisc", i, Math.random(), drag, rise, warm);
  }

  /** A fire particle: kind FIRE.ball / flash / glitter / ember. */
  fire(p, { velocity = ZERO, size = [2, 6], life = 1, drag = 0.8, gravity = 2, kind = FIRE.ball, intensity = 1 } = {}) {
    const pool = this.firePool;
    const i = pool.take();
    this._origin(pool, i, p, velocity);
    pool.set("aTime", i, this.time, life * rand(0.85, 1.15));
    pool.set("aShape", i, size[0], size[1], kind);
    pool.set("aMisc", i, Math.random(), drag, gravity, intensity);
  }

  /** A piece of debris: SHARD.concrete / glass / metal, `size` metres. */
  shard(p, { velocity = ZERO, size = 0.6, life = 6, spin = 4, kind = SHARD.concrete } = {}) {
    const pool = this.shardPool;
    const i = pool.take();
    this._origin(pool, i, p, velocity);
    pool.set("aTime", i, this.time, life * rand(0.8, 1.2));
    const axis = this._a.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    pool.set("aSpin", i, axis.x, axis.y, axis.z, spin * rand(0.4, 1.4));
    if (kind === SHARD.glass) pool.set("aScale", i, size * rand(0.9, 1.6), size * 0.06, size * rand(0.7, 1.3), kind);
    else if (kind === SHARD.metal) pool.set("aScale", i, size * rand(1, 1.8), size * 0.15, size * rand(0.6, 1.1), kind);
    else pool.set("aScale", i, size * rand(0.7, 1.2), size * rand(0.5, 1), size * rand(0.7, 1.2), kind);
  }

  /* ---------------- Bursts ---------------- */

  /** A charge or a blast going off: a white-hot point with rays. */
  flash(p, size = 6, intensity = 2.5, life = 0.22) {
    this.fire(p, { size: [size * 0.6, size], life, kind: FIRE.flash, intensity, gravity: 0 });
  }

  /** A fireball boiling up: `size` metres across at its biggest. */
  fireball(p, size = 12, { velocity = ZERO, life = 2, intensity = 1.2 } = {}) {
    this.fire(p, { velocity, size: [size * 0.3, size], life, drag: 1.2, gravity: 2.5, kind: FIRE.ball, intensity });
  }

  /** Glass thrown out along `dir` (a spread round it) and glittering as it falls. */
  glitter(p, dir, count = 20, speed = 9, { spread = 0.8, warm = 0.3, life = 4.5 } = {}) {
    const v = this._b;
    for (let k = 0; k < this.n(count); k += 1) {
      v.set(dir.x + rand(-spread, spread), dir.y + rand(-spread * 0.5, spread), dir.z + rand(-spread, spread)).normalize().multiplyScalar(speed * rand(0.4, 1.2));
      this.fire(this._a.copy(p).addScaledVector(v, 0.05), { velocity: v, size: [rand(0.12, 0.3), rand(0.1, 0.25)], life, drag: 0.5, gravity: -6, kind: FIRE.glitter, intensity: warm });
    }
  }

  /** Slabs of concrete, panes of glass (or metal) thrown along `dir`. */
  debris(p, dir, count = 12, speed = 8, { glass = 0.3, metal = 0, size = 0.7, spread = 0.7, up = 2 } = {}) {
    const v = this._b;
    for (let k = 0; k < this.n(count); k += 1) {
      v.set(dir.x + rand(-spread, spread), dir.y + rand(-spread * 0.3, spread), dir.z + rand(-spread, spread)).normalize().multiplyScalar(speed * rand(0.35, 1.1));
      v.y += up * rand(0, 1);
      const roll = Math.random();
      const kind = roll < metal ? SHARD.metal : roll < metal + glass ? SHARD.glass : SHARD.concrete;
      this.shard(p, { velocity: v, size: size * rand(0.5, 1.4), life: rand(5, 8), spin: rand(2, 7), kind });
    }
  }

  /** Embers sprayed out and drifting down. */
  embers(p, count = 10, speed = 5) {
    const v = this._b;
    for (let k = 0; k < this.n(count); k += 1) {
      v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      this.fire(p, { velocity: v, size: [0.25, 0.15], life: rand(1.5, 3), drag: 0.9, gravity: -1.2, kind: FIRE.ember });
    }
  }

  /* ---------------- Continuous emitters ---------------- */

  /**
   * A fire that keeps burning in a hole (`normal` points out of it):
   * flames licking out and up, black smoke, embers. Returns { stop() }.
   */
  burn(p, normal, { size = 1, seconds = Infinity } = {}) {
    const e = { kind: "burn", p: p.clone(), n: normal.clone().normalize(), size, left: seconds, flame: 0, smoke: 0, ember: 0 };
    this.emitters.push(e);
    return { stop: () => (e.left = 0), emitter: e };
  }

  /**
   * A trail behind something moving (a helicopter on fire): black smoke and
   * flame at `follow`'s world position (or a point given by a function).
   */
  trail(follow, { seconds = Infinity, fire = 1, smoke = 1, offset = null } = {}) {
    const e = { kind: "trail", follow, offset: offset?.clone() ?? null, left: seconds, fire, smoke, flame: 0, puff: 0, last: null };
    this.emitters.push(e);
    return { stop: () => (e.left = 0), emitter: e };
  }

  /**
   * Debris and glass raining past the camera, dust blowing across (from
   * `from`, a world direction): the blast's fallout round wherever you are.
   */
  fallout(follow, { seconds = 6, from = new THREE.Vector3(-1, 0, 0), strength = 1 } = {}) {
    const e = { kind: "fallout", follow, from: from.clone().setY(0).normalize(), left: seconds, total: seconds, strength, glint: 0, piece: 0, wisp: 0 };
    this.emitters.push(e);
    return { stop: () => (e.left = 0), emitter: e };
  }

  _where(e, out) {
    if (typeof e.follow === "function") return out.copy(e.follow());
    e.follow.getWorldPosition(out);
    if (e.offset) out.add(_e3.copy(e.offset).applyQuaternion(e.follow.getWorldQuaternion(_q)));
    return out;
  }

  _emit(e, dt) {
    const s = this.scale;
    if (e.kind === "burn") {
      const side = _e1.set(-e.n.z, 0, e.n.x).normalize();
      e.flame += dt * 10 * s;
      while (e.flame >= 1) {
        e.flame -= 1;
        const p = _e2.copy(e.p).addScaledVector(side, rand(-2.4, 2.4) * e.size).addScaledVector(_up, rand(-1.2, 1.4) * e.size).addScaledVector(e.n, 0.6);
        this.fire(p, { velocity: _tmp.copy(e.n).multiplyScalar(rand(0.8, 2)).setY(rand(1, 2.5)), size: [1.4 * e.size, rand(3.5, 6) * e.size], life: rand(0.8, 1.3), drag: 1, gravity: 4, intensity: 1.1 });
      }
      e.smoke += dt * 3 * s;
      while (e.smoke >= 1) {
        e.smoke -= 1;
        const p = _e2.copy(e.p).addScaledVector(e.n, 1.5).addScaledVector(side, rand(-2, 2) * e.size).setY(e.p.y + 2 * e.size);
        this.dust(p, { velocity: _tmp.copy(e.n).multiplyScalar(rand(1, 2.2)).add(_wind), size: [3 * e.size, rand(14, 22) * e.size], life: rand(8, 11), drag: 0.35, rise: rand(3, 4.5), shade: rand(0.05, 0.16), warm: 0.9 });
      }
      e.ember += dt * 6 * s;
      while (e.ember >= 1) {
        e.ember -= 1;
        const p = _e2.copy(e.p).addScaledVector(side, rand(-2, 2) * e.size).addScaledVector(e.n, 0.5);
        this.fire(p, { velocity: _tmp.copy(e.n).multiplyScalar(rand(1, 3)).setY(rand(1.5, 4)), size: [0.3, 0.15], life: rand(1.5, 3), drag: 0.6, gravity: 0.6, kind: FIRE.ember });
      }
    } else if (e.kind === "trail") {
      const p = this._where(e, _e2);
      e.flame += dt * 14 * s * e.fire;
      while (e.flame >= 1) {
        e.flame -= 1;
        this.fire(p, { velocity: _tmp.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1)), size: [0.8, rand(2, 3.2)], life: rand(0.25, 0.45), drag: 1, gravity: 3, intensity: 1.2 });
      }
      e.puff += dt * 16 * s * e.smoke;
      while (e.puff >= 1) {
        e.puff -= 1;
        this.dust(_tmp2.copy(p).add(_tmp.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4))), { velocity: _tmp.set(rand(-0.6, 0.6), rand(0, 0.6), rand(-0.6, 0.6)), size: [1.2, rand(6, 10)], life: rand(4, 6), drag: 1.5, rise: rand(0.8, 1.6), shade: rand(0.04, 0.12), warm: 0.6 });
      }
    } else if (e.kind === "fallout") {
      const at = this._where(e, _e2);
      const k = Math.min(1, e.left / Math.min(2, e.total)) * e.strength;
      const across = _e1.copy(e.from).negate();
      e.glint += dt * 55 * s * k;
      while (e.glint >= 1) {
        e.glint -= 1;
        const p = _tmp2.set(at.x + rand(-16, 16), at.y + rand(3, 14), at.z + rand(-16, 16)).addScaledVector(e.from, 6);
        this.fire(p, { velocity: _tmp.copy(across).multiplyScalar(rand(1, 4)).setY(rand(-6, -2)), size: [rand(0.06, 0.14), 0.08], life: rand(2.5, 3.5), drag: 0.3, gravity: -3, kind: FIRE.glitter, intensity: 0.5 });
      }
      e.piece += dt * 14 * s * k;
      while (e.piece >= 1) {
        e.piece -= 1;
        const p = _tmp2.set(at.x + rand(-12, 12), at.y + rand(5, 12), at.z + rand(-12, 12)).addScaledVector(e.from, 5);
        this.shard(p, { velocity: _tmp.copy(across).multiplyScalar(rand(1, 5)).setY(rand(-4, 0)), size: rand(0.08, 0.3), life: 3, spin: rand(4, 9), kind: Math.random() < 0.55 ? SHARD.glass : SHARD.concrete });
      }
      e.wisp += dt * 6 * s * k;
      while (e.wisp >= 1) {
        e.wisp -= 1;
        const p = _tmp2.set(at.x + rand(-10, 10), at.y + rand(-2, 4), at.z + rand(-10, 10)).addScaledVector(e.from, 14);
        this.dust(p, { velocity: _tmp.copy(across).multiplyScalar(rand(6, 10)), size: [3, rand(8, 13)], life: rand(3.5, 5), drag: 0.25, rise: 0.3, shade: 0.6, warm: 0.4 });
      }
    }
  }

  /* ---------------- Frame ---------------- */

  /**
   * @param {number} dt
   * @param {THREE.Camera} [camera]   for the glints' minimum size
   * @param {number} [height]         the drawing height in pixels
   */
  update(dt, camera = null, height = 720) {
    this.time += dt;
    this.shared.uTime.value = this.time;
    if (camera?.isPerspectiveCamera) this.shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height);
    this.root.updateWorldMatrix(true, false);
    this._inv.copy(this.root.matrixWorld).invert();
    this._invRot.setFromMatrix4(this._inv);
    for (let i = this.emitters.length - 1; i >= 0; i -= 1) {
      const e = this.emitters[i];
      e.left -= dt;
      if (e.left <= 0) { this.emitters.splice(i, 1); continue; }
      this._emit(e, dt);
    }
    this.dustPool.flush();
    this.firePool.flush();
    this.shardPool.flush();
  }

  /** Everything off at once (a restart). */
  clear() {
    this.emitters.length = 0;
    for (const pool of [this.dustPool, this.firePool, this.shardPool]) {
      for (let i = 0; i < pool.count; i += 1) pool.attrs.aTime.array.set([-1e6, 1], i * 2);
      pool.dirty = true;
      pool.flush();
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.dustPool.dispose();
    this.firePool.dispose();
    this.shardPool.dispose();
    this.emitters.length = 0;
  }
}

const ZERO = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _wind = new THREE.Vector3(1.2, 0, 0.4);
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
/** The emitters' own scratch vectors (the single-particle calls use the others). */
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _e3 = new THREE.Vector3();

/* ==================================================================== */
/* A building that comes down                                            */
/* ==================================================================== */

/** The slabs' material: lit windows in the building's own frame. */
function buildingMaterial(fx, { seed, lit, glow, concrete, glass, grid }) {
  return new THREE.ShaderMaterial({
    name: "DemolitionBuilding",
    defines: { OCTAVES: 1 },
    uniforms: fogUniforms(fx.shared, {
      uConcrete: { value: new THREE.Color(concrete) },
      uGlass: { value: new THREE.Color(glass) },
      uWarm: { value: new THREE.Color(1.0, 0.72, 0.42) },
      uCool: { value: new THREE.Color(0.62, 0.8, 1.0) },
      uLit: { value: lit },
      uSeed: { value: seed * 13.7 },
      uGlow: { value: glow },
      uGrid: { value: new THREE.Vector2(grid[0], grid[1]) },
    }),
    vertexShader: BUILDING_VERTEX,
    fragmentShader: BUILDING_FRAGMENT,
    fog: true,
  });
}

export class DemolitionBuilding {
  /**
   * @param {object} o
   * @param {DemolitionFX} o.fx
   * @param {THREE.Vector3} [o.position]  where it stands (x, z; y is ignored - heights are world y)
   * @param {number} [o.yaw]
   * @param {number} [o.width]    x, metres
   * @param {number} [o.depth]    z, metres
   * @param {number} [o.floors]   floors in slabs (the top of the tower); the stump below is one piece
   * @param {number} [o.floorHeight]
   * @param {number} [o.top]      world y of the roof
   * @param {number} [o.bottom]   world y the stump goes down to (into the haze)
   * @param {number} [o.columns]  slabs across x per floor
   * @param {number} [o.rows]     slabs across z per floor
   * @param {number} [o.seed]     which windows are lit
   * @param {number} [o.lit]      share of windows lit
   */
  constructor({
    fx, position = new THREE.Vector3(), yaw = 0, width = 24, depth = 20, floors = 18, floorHeight = 3.6,
    top = 0, bottom = -260, columns = 3, rows = 3, seed = 1, lit = 0.32, glow = 1,
    concrete = 0x3c3f45, glass = 0x1a2430, name = "DemolitionBuilding",
  }) {
    this.fx = fx;
    this.width = width;
    this.depth = depth;
    this.floors = floors;
    this.floorHeight = floorHeight;
    this.top = top;
    this.bottom = bottom;
    this.base = top - floors * floorHeight;
    this.root = new THREE.Group();
    this.root.name = name;
    this.root.position.set(position.x, 0, position.z);
    this.root.rotation.y = yaw;

    // The slabs: the stump first, then floor by floor, a plant room on top.
    const chunks = [];
    const cw = width / columns;
    const cd = depth / rows;
    chunks.push({ floor: -1, rest: new THREE.Vector3(0, (bottom + this.base) / 2, 0), size: new THREE.Vector3(width, this.base - bottom, depth), interior: 0 });
    for (let f = 0; f < floors; f += 1) {
      for (let ix = 0; ix < columns; ix += 1) {
        for (let iz = 0; iz < rows; iz += 1) {
          const inside = ix > 0 && ix < columns - 1 && iz > 0 && iz < rows - 1;
          chunks.push({
            floor: f,
            rest: new THREE.Vector3(-width / 2 + (ix + 0.5) * cw, this.base + (f + 0.5) * floorHeight, -depth / 2 + (iz + 0.5) * cd),
            size: new THREE.Vector3(cw, floorHeight, cd),
            interior: inside ? 1 : 0,
          });
        }
      }
    }
    chunks.push({ floor: floors - 1, rest: new THREE.Vector3(width * 0.12, top + 1.6, -depth * 0.08), size: new THREE.Vector3(width * 0.42, 3.2, depth * 0.38), interior: 1 });

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const count = chunks.length;
    this.attrRest = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.attrSize = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.attrState = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.attrState.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aRest", this.attrRest);
    geometry.setAttribute("aSize", this.attrSize);
    geometry.setAttribute("aState", this.attrState);
    this.material = buildingMaterial(fx, { seed, lit, glow, concrete, glass, grid: [2.3, floorHeight] });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
    this.mesh.name = `${name}Slabs`;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.byFloor = Array.from({ length: floors }, () => []);
    const m = new THREE.Matrix4();
    chunks.forEach((c, i) => {
      Object.assign(c, {
        i, mode: STATIC, pos: c.rest.clone(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(),
        axis: new THREE.Vector3(0, 1, 0), rate: 0, age: 0, heat: 0, heatTo: 0, damage: 0,
        // Which way is out: the facades it is on (an interior slab has none).
        out: new THREE.Vector3(c.rest.x / (width / 2), 0, c.rest.z / (depth / 2)),
      });
      if (c.out.lengthSq() < 0.01) c.out.set(0, 0, 0);
      else c.out.normalize();
      this.attrRest.setXYZ(i, c.rest.x, c.rest.y, c.rest.z);
      this.attrSize.setXYZ(i, c.size.x, c.size.y, c.size.z);
      this.attrState.setXYZ(i, 0, 0, c.interior);
      this.mesh.setMatrixAt(i, m.compose(c.rest, c.quat, c.size));
      if (c.floor >= 0) this.byFloor[c.floor].push(c);
    });
    this.chunks = chunks;
    this.stump = chunks[0];
    this.root.add(this.mesh);

    this.started = false;
    this.time = 0;
    this.state = { charged: 0, blown: false, falling: false, down: false, drop: 0, tilt: 0, sink: 0 };
    /** (name, info) => {} - "charges", "charge", "blast", "collapse", "crush", "down", "punch". */
    this.onEvent = null;
    this.viewer = null;
    this._block = new THREE.Matrix4();
    this._blockQuat = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._r = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._w = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._dq = new THREE.Quaternion();
    this._moving = false;
    this._smoulder = 0;
    this._fires = [];
  }

  /** World point of a building-local one. */
  _world(local, out = this._w) {
    return out.copy(local).applyMatrix4(this.root.matrixWorld);
  }

  /** World direction of a building-local one. */
  _worldDir(local, out = this._d) {
    return out.copy(local).applyQuaternion(this.root.quaternion);
  }

  /** The facades the viewer can see (all four if there's no viewer). */
  _faces() {
    if (!this.viewer) return [0, 1, 2, 3];
    const v = this.root.worldToLocal(_tmp.copy(this.viewer));
    const half = [this.width / 2, this.depth / 2, this.width / 2, this.depth / 2];
    const seen = [0, 1, 2, 3].filter((f) => FACES[f].dot(v) > half[f]);
    return seen.length ? seen : [0, 1, 2, 3];
  }

  /** A building-local point on facade `face` at height y, `along` -0.5..0.5 across it, `out` metres proud. */
  _facePoint(face, y, along, out = 0.6, target = new THREE.Vector3()) {
    const n = FACES[face];
    const half = face % 2 === 0 ? this.width / 2 : this.depth / 2;
    const span = face % 2 === 0 ? this.depth : this.width;
    return target.set(n.x * (half + out) + (face % 2 === 1 ? along * span : 0), y, n.z * (half + out) + (face % 2 === 0 ? along * span : 0));
  }

  _emit(name, info = {}) {
    this.onEvent?.(name, info);
  }

  /**
   * Light the charges.
   * @param {object} [o]
   * @param {number} [o.cut]       where the blast cuts the core (share of the floors up)
   * @param {number} [o.interval]  seconds between floors' charges
   * @param {number} [o.lean]      radians the falling top leans over by
   * @param {THREE.Vector3} [o.fall]    world direction it leans (default: away from the viewer, a little sideways)
   * @param {THREE.Vector3} [o.viewer]  where it's watched from (the bursts face that way)
   * @param {number} [o.delay]     seconds before the first charge
   * @param {number} [o.blowouts]  share of the facade slabs each floor's charges throw out
   */
  detonate({ cut = 0.3, interval = 0.085, lean = 0.3, fall = null, viewer = null, delay = 0, blowouts = 0.14 } = {}) {
    if (this.started) return;
    this.root.updateMatrixWorld();
    this.started = true;
    this.time = -delay;
    this.viewer = viewer ? viewer.clone() : null;
    this.cutFloor = THREE.MathUtils.clamp(Math.round(this.floors * cut), 1, this.floors - 4);
    this.interval = interval;
    this.blowouts = blowouts;
    this.blastAt = this.floors * interval + BLAST_DELAY;
    this.fallAt = this.blastAt + FALL_DELAY;
    this.lTop = this.cutFloor;
    this.uBottom = this.cutFloor + 2;
    this.speed = 0;
    this._fallT = 0;
    // Which way the top goes over: given, or across the viewer's line of sight.
    const dir = new THREE.Vector3();
    if (fall) dir.copy(fall).applyQuaternion(this.root.quaternion.clone().invert());
    else if (this.viewer) {
      const v = this.root.worldToLocal(this.viewer.clone()).setY(0).normalize();
      dir.set(v.z, 0, -v.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1).addScaledVector(v, -0.4);
    } else dir.set(1, 0, 0);
    dir.setY(0).normalize();
    this.lean = lean;
    this._axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    this._hinge = new THREE.Vector3(dir.x * this.width / 2, this.base + this.uBottom * this.floorHeight, dir.z * this.depth / 2);
    this._emit("charges", {});
  }

  /* ---------------- The sequence ---------------- */

  /** One floor's charges: a ring of white flashes, the windows flaring, glass out. */
  _charge(f) {
    const fh = this.floorHeight;
    const cutting = f >= this.cutFloor - 1 && f <= this.cutFloor + 2;
    const blown = [];
    for (const c of this.byFloor[f]) {
      if (c.mode !== STATIC && c.mode !== UPPER) continue;
      // Some of the facade goes with the charge (not under the cut: the top has to stand on it).
      if (!c.interior && !cutting && f > this.cutFloor && Math.random() < this.blowouts) blown.push(c);
      c.heat = 1.9;
      c.heatTo = cutting ? 0.95 : 0.2;
      c.damage = Math.max(c.damage, cutting ? 1 : 0.45);
      c.dirty = true;
    }
    const fx = this.fx;
    const y = this.base + (f + 0.55) * fh;
    const p = new THREE.Vector3();
    for (const c of blown) {
      this._release(c, c.out.clone().multiplyScalar(rand(5, 10)).setY(rand(0, 3)), rand(1, 3));
      const at = this._world(c.rest.clone().addScaledVector(c.out, 2)).clone();
      const n = this._worldDir(c.out).clone();
      fx.fireball(at, rand(7, 11), { velocity: n.clone().multiplyScalar(3), life: 1.4 });
      fx.debris(at, n, 6, 9, { glass: 0.45, size: 0.7 });
      fx.dust(at, { velocity: n.multiplyScalar(4), size: [4, 14], life: 8, drag: 0.6, rise: 2, shade: 0.25, warm: 0.9 });
    }
    for (const face of this._faces()) {
      for (let k = 0; k < fx.n(2); k += 1) {
        this._facePoint(face, y, rand(-0.42, 0.42), 0.6, p);
        fx.flash(this._world(p), rand(4, 7), 1.5, 0.2);
      }
      if (Math.random() < 0.5 * fx.scale + 0.2) {
        this._facePoint(face, y, rand(-0.4, 0.4), 1, p);
        const w = this._world(p).clone();
        fx.fireball(w, rand(4, 7), { life: 0.7, velocity: this._worldDir(FACES[face]).clone().multiplyScalar(2) });
        fx.glitter(w, this._worldDir(FACES[face]).clone(), 4, 7, { warm: 0.5 });
      }
    }
    this._emit("charge", { floor: f, y });
  }

  /** The blast: the cut floors' facades blown out, fire, glass, smoke. */
  _blast() {
    const fx = this.fx;
    const fh = this.floorHeight;
    this.state.blown = true;
    for (const f of [this.cutFloor, this.cutFloor + 1]) {
      for (const c of this.byFloor[f]) {
        const v = new THREE.Vector3().copy(c.out).multiplyScalar(c.interior ? rand(0, 1) : rand(7, 13));
        v.y = rand(0.5, 3.5);
        this._release(c, v, rand(0.8, 2.6));
      }
    }
    // The floors round the cut are burning now.
    for (let f = Math.max(0, this.cutFloor - 2); f <= Math.min(this.floors - 1, this.cutFloor + 3); f += 1) {
      for (const c of this.byFloor[f]) { c.heatTo = Math.max(c.heatTo, 0.9); c.damage = 1; c.dirty = true; }
    }
    const y = this.base + (this.cutFloor + 1) * fh;
    const p = new THREE.Vector3();
    const big = Math.max(this.width, this.depth);
    for (const face of this._faces()) {
      const n = this._worldDir(FACES[face]).clone();
      this._facePoint(face, y, 0, 1.5, p);
      const at = this._world(p).clone();
      fx.flash(at, big * 1.4, 2, 0.3);
      for (let k = 0; k < fx.n(3, 2); k += 1) {
        this._facePoint(face, y + rand(-fh, fh), rand(-0.45, 0.45), rand(1, 3), p);
        fx.fireball(this._world(p).clone(), rand(0.5, 0.85) * big, { velocity: n.clone().multiplyScalar(rand(2, 6)).setY(rand(0.5, 2.5)), life: rand(1.8, 2.8), intensity: 1.3 });
      }
      fx.glitter(at, n, 34, 13, { spread: 0.9, warm: 0.45, life: 5 });
      fx.debris(at, n, 24, 12, { glass: 0.35, size: 0.9, spread: 0.8, up: 3 });
      fx.embers(at, 12, 9);
      for (let k = 0; k < fx.n(5, 2); k += 1) {
        this._facePoint(face, y + rand(-fh, fh * 2), rand(-0.5, 0.5), 2, p);
        fx.dust(this._world(p), { velocity: n.clone().multiplyScalar(rand(3, 7)), size: [big * 0.3, big * rand(0.8, 1.2)], life: rand(9, 13), drag: 0.5, rise: rand(1.5, 3), shade: rand(0.12, 0.3), warm: 1 });
      }
    }
    this._emit("blast", { position: this._world(new THREE.Vector3(0, y, 0)).clone() });
  }

  /** A slab breaks away: falling, tumbling, `velocity` building-local. */
  _release(c, velocity, spin = 1.5) {
    if (c.mode === UPPER) {
      c.pos.copy(c.rest).applyMatrix4(this._block);
      c.quat.copy(this._blockQuat);
      c.vel.copy(velocity).add(_tmp.set(0, -this.speed, 0));
    } else {
      c.pos.copy(c.rest);
      c.quat.identity();
      c.vel.copy(velocity);
    }
    c.mode = DEBRIS;
    c.age = 0;
    c.axis.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize();
    c.rate = spin;
    c.heat = Math.max(c.heat, 0.6);
    c.heatTo = 0;
    c.damage = 1;
    c.dirty = true;
  }

  /** The top block: a hinge on the side it goes over, dropping. */
  _updateBlock() {
    const s = this.state;
    const h = this._hinge;
    this._r.makeRotationAxis(this._axis, s.tilt);
    this._block.makeTranslation(h.x, h.y - s.drop, h.z).multiply(this._r).multiply(this._m.makeTranslation(-h.x, -h.y, -h.z));
    this._blockQuat.setFromAxisAngle(this._axis, s.tilt);
  }

  _fall(dt) {
    const s = this.state;
    const fh = this.floorHeight;
    this._fallT += dt;
    this.speed = Math.min(FALL_MAX_SPEED, this.speed + GRAVITY * FALL_ACCEL * dt);
    s.drop += this.speed * dt;
    s.tilt = this.lean * THREE.MathUtils.smoothstep(this._fallT, 0, 3.4) * (0.6 + 0.4 * Math.min(1, s.drop / 40));
    s.sink = s.drop;
    this._updateBlock();
    // Where the falling top meets what's left standing, floors go - one of
    // each per contact - and the dust rolls out of the gap.
    for (let guard = 0; guard < 4 && this.uBottom < this.floors; guard += 1) {
      const standing = this.base + this.lTop * fh;
      const falling = this.base + this.uBottom * fh - s.drop;
      if (falling > standing) break;
      this._crush();
    }
    if (this.uBottom >= this.floors || s.drop > this.top - this.bottom) {
      s.falling = false;
      s.down = true;
      for (const c of this.chunks) {
        if (c.mode !== UPPER) continue;
        c.mode = GONE;
        this.mesh.setMatrixAt(c.i, this._zero);
      }
      this._moving = true;
      this._smoulder = SMOULDER;
      this._emit("down", {});
    }
  }

  _crush() {
    const fx = this.fx;
    const fh = this.floorHeight;
    // The floor below (while there are floors; then the stump shortens)...
    if (this.lTop > 0) {
      for (const c of this.byFloor[this.lTop - 1]) {
        if (c.mode !== STATIC) continue;
        const v = new THREE.Vector3().copy(c.out).multiplyScalar(rand(2, 6));
        v.y = rand(-4, 0);
        this._release(c, v, rand(0.5, 2));
      }
    }
    this.lTop -= 1;
    if (this.lTop < 0) {
      const top = this.base + this.lTop * fh;
      const st = this.stump;
      st.rest.y = (this.bottom + top) / 2;
      st.size.y = Math.max(0.1, top - this.bottom);
      this.attrRest.setXYZ(0, st.rest.x, st.rest.y, st.rest.z);
      this.attrSize.setXYZ(0, st.size.x, st.size.y, st.size.z);
      this.attrRest.needsUpdate = true;
      this.attrSize.needsUpdate = true;
      this.mesh.setMatrixAt(0, this._m.compose(st.rest, st.quat, st.size));
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    // ...and the floor at the bottom of the falling top.
    for (const c of this.byFloor[this.uBottom]) {
      if (c.mode !== UPPER) continue;
      const v = new THREE.Vector3().copy(c.out).multiplyScalar(rand(2, 7));
      v.y = rand(-2, 1);
      this._release(c, v, rand(0.5, 2.2));
    }
    this.uBottom += 1;
    this.speed *= CRUSH_KEEP;

    // Dust out of the gap, all the way round, and a cloud over it all.
    const y = this.base + (this.lTop + 0.5) * fh;
    const big = Math.max(this.width, this.depth);
    const ring = fx.n(8, 4);
    const p = new THREE.Vector3();
    const phase = Math.random() * Math.PI * 2;
    for (let k = 0; k < ring; k += 1) {
      const a = phase + (k / ring) * Math.PI * 2;
      const dir = _tmp2.set(Math.cos(a), 0, Math.sin(a));
      p.set(dir.x * this.width * 0.55, y + rand(-1, 2), dir.z * this.depth * 0.55);
      const w = this._world(p).clone();
      const v = this._worldDir(dir).clone().multiplyScalar(rand(6, 11));
      fx.dust(w, { velocity: v, size: [big * 0.4, big * rand(1.2, 1.7)], life: rand(10, 14), drag: 0.45, rise: rand(0.8, 2.2), shade: rand(0.55, 0.8), warm: 0.35 });
    }
    fx.dust(this._world(p.set(0, y + fh, 0)).clone(), { size: [big * 0.9, big * 2.2], life: rand(11, 15), drag: 0.5, rise: rand(1.2, 2), shade: 0.7, warm: 0.3 });
    // Pieces and glass out of the floors as they go.
    for (const face of this._faces()) {
      const n = this._worldDir(FACES[face]).clone();
      this._facePoint(face, y, rand(-0.3, 0.3), 1, p);
      const w = this._world(p).clone();
      fx.debris(w, n, 5, 6, { glass: 0.4, size: 0.8, spread: 1, up: 1 });
      fx.glitter(w, n, 6, 6, { warm: 0.3 });
    }
    this._emit("crush", { y, floor: this.lTop });
  }

  /** The ruin afterwards: smoke off the top of what's left, embers. */
  _smoulderTick(dt) {
    this._smoulder -= dt;
    const k = this._smoulder / SMOULDER;
    this._sm = (this._sm ?? 0) + dt * 2.2 * this.fx.scale * k;
    const y = this.base + Math.min(this.lTop, 0) * this.floorHeight;
    while (this._sm >= 1) {
      this._sm -= 1;
      const p = this._world(_tmp2.set(rand(-0.4, 0.4) * this.width, y, rand(-0.4, 0.4) * this.depth)).clone();
      this.fx.dust(p, { velocity: _tmp.set(rand(-1, 1), 0, rand(-1, 1)), size: [8, rand(22, 30)], life: rand(11, 14), drag: 0.4, rise: rand(2.5, 4), shade: rand(0.2, 0.45), warm: 0.7 });
      if (Math.random() < 0.6) this.fx.embers(p, 3, 4);
    }
  }

  /**
   * A hole knocked in the facade at `point` (world), burning on afterwards:
   * the slabs there blown out, the ones round it scorched and on fire, the
   * core behind glowing. For the helicopter crash.
   */
  punch(point, { radius = 5, burn = true, size = 1 } = {}) {
    this.root.updateMatrixWorld();
    const local = this.root.worldToLocal(point.clone());
    // Which facade it's in: the nearest.
    const dx = this.width / 2 - Math.abs(local.x);
    const dz = this.depth / 2 - Math.abs(local.z);
    const face = dx < dz ? (local.x > 0 ? 0 : 2) : (local.z > 0 ? 1 : 3);
    const n = FACES[face];
    for (const c of this.chunks) {
      if (c.floor < 0 || c.mode !== STATIC) continue;
      const d = _tmp.copy(c.rest).sub(local);
      const across = d.length();
      if (!c.interior && across < radius + 0.5 * Math.min(c.size.x, c.size.z) && c.out.dot(n) > 0.3) {
        this._release(c, n.clone().multiplyScalar(rand(2, 5)).setY(rand(-1, 2)), rand(1, 3));
      } else if (across < radius * 2.2) {
        c.damage = Math.max(c.damage, 1 - across / (radius * 2.6));
        c.heat = Math.max(c.heat, 1.2);
        c.heatTo = Math.max(c.heatTo, c.interior ? 1 : 0.7 * (1 - across / (radius * 2.4)));
        c.dirty = true;
      }
    }
    if (burn) {
      const at = this._world(local.clone().addScaledVector(n, -1.5)).clone();
      this._fires.push(this.fx.burn(at, this._worldDir(n).clone(), { size }));
    }
    this._moving = true;
    this._emit("punch", { position: point.clone() });
  }

  update(dt) {
    if (this.started) {
      this.time += dt;
      const t = this.time;
      const s = this.state;
      if (t >= 0) {
        this.root.updateMatrixWorld();
        while (s.charged < this.floors && t >= s.charged * this.interval) this._charge(s.charged++);
        if (!s.blown && t >= this.blastAt) this._blast();
        if (s.blown && !s.falling && !s.down && t >= this.fallAt) {
          s.falling = true;
          for (let f = this.uBottom; f < this.floors; f += 1) for (const c of this.byFloor[f]) if (c.mode === STATIC) c.mode = UPPER;
          this._updateBlock();
          this._emit("collapse", { position: this._world(new THREE.Vector3(0, this.top, 0)).clone() });
        }
        if (s.falling) this._fall(dt);
        if (s.down && this._smoulder > 0) this._smoulderTick(dt);
      }
    }
    this._writeSlabs(dt);
  }

  /** Slabs to the GPU: where each one is, how hot, how broken. */
  _writeSlabs(dt) {
    const vanish = this.base - VANISH_BELOW;
    let moved = false;
    let state = false;
    const m = this._m;
    for (const c of this.chunks) {
      if (c.mode === UPPER) {
        this.mesh.setMatrixAt(c.i, m.compose(c.rest, _q.identity(), c.size).premultiply(this._block));
        moved = true;
      } else if (c.mode === DEBRIS) {
        c.age += dt;
        c.vel.y -= GRAVITY * dt;
        c.pos.addScaledVector(c.vel, dt);
        c.quat.premultiply(this._dq.setFromAxisAngle(c.axis, c.rate * dt));
        if (c.pos.y < vanish || c.age > DEBRIS_LIFE) {
          c.mode = GONE;
          this.mesh.setMatrixAt(c.i, this._zero);
        } else this.mesh.setMatrixAt(c.i, m.compose(c.pos, c.quat, c.size));
        moved = true;
      }
      if (c.heat !== c.heatTo) {
        const rate = c.heat > c.heatTo ? 3.2 : 5;
        c.heat = c.heat > c.heatTo ? Math.max(c.heatTo, c.heat - rate * dt) : Math.min(c.heatTo, c.heat + rate * dt);
        c.dirty = true;
      }
      if (c.dirty) {
        this.attrState.setXYZ(c.i, c.heat, c.damage, c.interior);
        c.dirty = false;
        state = true;
      }
    }
    if (moved || this._moving) this.mesh.instanceMatrix.needsUpdate = true;
    if (state) this.attrState.needsUpdate = true;
    this._moving = false;
  }

  dispose() {
    for (const f of this._fires) f.stop();
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose?.();
  }
}
