/**
 * The Causeway's glass - a per-pixel ray-traced glass shader.
 *
 * For every fragment of a pane the shader traces the view ray through the
 * glass analytically instead of faking it with a flat transparency value:
 *
 *   1. REFLECTION   reflect() the view ray about the normal and look it up in a
 *                   live cube-map reflection probe (probe.js). The Schlick
 *                   approximation of the Fresnel equations decides how much
 *                   of the pixel is reflection: little head-on, almost all at
 *                   grazing angles - exactly what real glass does.
 *
 *   2. REFRACTION   refract() the ray with Snell's law, once per colour channel
 *                   with a slightly different index of refraction (IOR). The
 *                   spread between the three rays is chromatic dispersion; it
 *                   shows as rainbow fringes at glancing angles and in cracks.
 *                   Each refracted ray is projected into screen space and used
 *                   to sample a snapshot of the scene behind the glass
 *                   (screen-space refraction, see postfx.js).
 *
 *   3. ABSORPTION   The refracted ray's path length through the slab is
 *                   thickness / cos(theta_t). Beer-Lambert law turns that length
 *                   into per-channel absorption, so thick reinforced glass and
 *                   glass seen edge-on are visibly greener/darker than thin
 *                   glass seen head-on.
 *
 *   5. GRIME        Dust, smudges and smoke staining from fbm noise. It is what
 *                   lets you *see* clean glass in a dark, smoky lab: real glass
 *                   is visible mostly by what is on it and what it reflects.
 *
 *   4. DAMAGE       A procedural crack field (radial spokes + broken concentric
 *                   rings around the impact point) perturbs the normal, so the
 *                   reflections and refractions shatter along the cracks.
 *
 * When the post pipeline is off (low quality) there is no scene snapshot, so
 * the shader falls back to ordinary alpha blending with the same Fresnel term.
 *
 * All glass shares one `shared` uniform object (probe cube map, scene
 * snapshot, resolution, time), so the pipeline updates one place per frame and
 * every pane sees it.
 */

import * as THREE from "../../../three.js";
import { NOISE_GLSL } from "./common.js";

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocal;
varying float vViewDepth;

void main() {
  vLocal = position;
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 world = m * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(m) * normal);
  vec4 mvPosition = viewMatrix * world;
  vViewDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}

uniform samplerCube uEnv;
uniform sampler2D uSceneTex;
uniform float uHasScene;
uniform vec2 uResolution;
uniform float uTime;
uniform float uEnvIntensity;

uniform vec3 uTint;
uniform vec3 uAbsorb;
uniform vec3 uEdge;
uniform float uIor;
uniform float uDispersion;
uniform float uThickness;
uniform float uRefract;
uniform float uCrack;
uniform vec2 uImpact;
uniform vec2 uSize;
uniform float uHighlight;
uniform float uMirror;
uniform float uFrost;
uniform float uOpacity;
uniform float uEdgeWidth;
uniform float uGrime;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocal;
varying float vViewDepth;

// Crack field around the impact point, in metres on the pane face.
// Returns line intensity; also outputs a pseudo-gradient for the normal.
float crackField(vec2 p, out vec2 dir) {
  vec2 q = p - uImpact;
  float r = length(q) + 1e-4;
  dir = q / r;
  float a = atan(q.y, q.x);
  float reach = uCrack * 2.2;
  if (r > reach) return 0.0;

  // Radial spokes: wobble the angle with noise so the lines are not straight.
  float wobble = (noise2(vec2(r * 18.0, a * 3.0)) - 0.5) * 0.55;
  float k = (a + wobble) * 13.0 / 6.28318;
  float spokeDist = min(fract(k), 1.0 - fract(k)) * (6.28318 / 13.0) * r;
  float spokes = 1.0 - smoothstep(0.003, 0.011, spokeDist);

  // Concentric rings, broken into arcs by a per-cell hash.
  float ringCoord = r * 3.4 + (noise2(vec2(a * 9.0, 4.0)) - 0.5) * 0.7;
  float ringDist = abs(fract(ringCoord) - 0.5) / 3.4;
  float keep = step(0.45, hash12(vec2(floor(ringCoord), floor((a + 3.1416) * 4.0))));
  float rings = (1.0 - smoothstep(0.003, 0.009, abs(ringDist - 0.147))) * keep;

  float fade = 1.0 - smoothstep(reach * 0.55, reach, r);
  return clamp(spokes + rings, 0.0, 1.0) * fade;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(vWorldPos - cameraPosition);   // incident ray
  if (dot(N, V) > 0.0) N = -N;                      // two-sided glass

  // ---- 4. damage -------------------------------------------------------
  float crack = 0.0;
  float frost = uFrost;
  if (uCrack > 0.001) {
    vec2 dir;
    crack = crackField(vLocal.xy, dir);
    float nearImpact = 1.0 - smoothstep(0.0, 0.45 * uCrack, length(vLocal.xy - uImpact));
    frost = max(frost, nearImpact * 0.9);
    vec3 jitter = vec3(noise2(vLocal.xy * 40.0), noise2(vLocal.xy * 40.0 + 17.0), 0.5) - 0.5;
    N = normalize(N + (vec3(dir, 0.0) * crack + jitter * frost) * 0.6);
  }

  // ---- 1. reflection ---------------------------------------------------
  float cosi = clamp(dot(-V, N), 0.0, 1.0);
  float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
  float F = F0 + (1.0 - F0) * pow(1.0 - cosi, 5.0);  // Schlick
  F = mix(F, 1.0, uMirror);
  vec3 R = reflect(V, N);
  vec3 reflection = texture(uEnv, R).rgb * uEnvIntensity;

  // ---- 2 + 3. refraction and absorption --------------------------------
  vec3 Tg = refract(V, N, 1.0 / uIor);
  float cost = max(dot(Tg, -N), 0.2);
  float pathLength = uThickness / cost;             // ray-traced distance in glass
  vec3 absorb = exp(-uAbsorb * pathLength);         // Beer-Lambert

  // Edge of the pane: the cyan rim that says "this breaks".
  vec2 halfSize = uSize * 0.5;
  float edgeDist = min(halfSize.x - abs(vLocal.x), halfSize.y - abs(vLocal.y));
  float edge = 1.0 - smoothstep(0.0, uEdgeWidth, edgeDist);
  float pulse = 0.75 + 0.25 * sin(uTime * 3.0 + vWorldPos.z * 0.3);

  vec3 colour;
  float alpha;
  if (uHasScene > 0.5) {
    vec2 suv = gl_FragCoord.xy / uResolution;
    vec3 Tr = refract(V, N, 1.0 / (uIor - uDispersion));
    vec3 Tb = refract(V, N, 1.0 / (uIor + uDispersion));
    // Screen-space bend: how far each refracted ray has deviated from the
    // straight-through ray, projected into view space and scaled by depth.
    float s = uRefract * pathLength / max(vViewDepth, 0.5);
    vec2 offR = (viewMatrix * vec4(Tr - V, 0.0)).xy * s;
    vec2 offG = (viewMatrix * vec4(Tg - V, 0.0)).xy * s;
    vec2 offB = (viewMatrix * vec4(Tb - V, 0.0)).xy * s;
    vec3 behind;
    behind.r = texture(uSceneTex, suv + offR).r;
    behind.g = texture(uSceneTex, suv + offG).g;
    behind.b = texture(uSceneTex, suv + offB).b;
    if (frost > 0.01) {
      // Frosted glass: a small rotated tap pattern blurs what is behind.
      vec2 px = frost * 6.0 / uResolution;
      behind = behind * 0.4
        + texture(uSceneTex, suv + offG + vec2(px.x, px.y * 0.5)).rgb * 0.15
        + texture(uSceneTex, suv + offG - vec2(px.x * 0.5, px.y)).rgb * 0.15
        + texture(uSceneTex, suv + offG + vec2(-px.x, px.y)).rgb * 0.15
        + texture(uSceneTex, suv + offG + vec2(px.x * 0.5, -px.y)).rgb * 0.15;
      behind = mix(behind, vec3(0.8, 0.9, 0.95) * 0.6, frost * 0.35);
    }
    vec3 transmitted = behind * absorb * uTint;
    colour = mix(transmitted, reflection, F);
    alpha = uOpacity;
  } else {
    colour = reflection * F + uTint * absorb * 0.08;
    alpha = clamp(F * 0.9 + 0.14 + frost * 0.45, 0.0, 1.0) * uOpacity;
  }

  // ---- 5. grime: smudges, dust, and soot staining toward the top ------
  float smudge = smoothstep(0.42, 0.78, fbm2(vLocal.xy * vec2(9.0, 6.0) + vLocal.z * 3.0)) * uGrime;
  float heightFrac = clamp(vLocal.y / max(uSize.y, 0.01) + 0.5, 0.0, 1.0);
  float soot = smoothstep(0.35, 1.0, heightFrac) * uGrime;
  float reflLum = dot(reflection, vec3(0.3, 0.59, 0.11));
  colour = mix(colour, vec3(0.5, 0.5, 0.48) * (0.06 + reflLum * 0.7), smudge * 0.45);
  colour *= 1.0 - soot * 0.45;
  alpha = max(alpha, (smudge * 0.3 + soot * 0.25) * uOpacity);

  colour += uEdge * edge * (0.28 + uHighlight * 2.2) * pulse;
  colour += vec3(0.9, 0.97, 1.0) * crack * (0.5 + reflection * 0.8);
  alpha = max(alpha, (edge * 0.8 + crack * 0.7) * uOpacity);

  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Uniforms every glass material shares. Updated once per frame. */
export function createGlassShared(noiseTexture) {
  return {
    uEnv: { value: null },
    uSceneTex: { value: null },
    uHasScene: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uEnvIntensity: { value: 1.0 },
    uNoise: { value: noiseTexture },
  };
}

/**
 * @param {object} shared  from createGlassShared()
 * @param {object} params  per-material look
 */
export function createGlassMaterial(shared, {
  tint = 0xe8fbff,
  absorb = [0.9, 0.35, 0.3],
  edge = 0x39e6ff,
  ior = 1.5,
  dispersion = 0.035,
  thickness = 0.08,
  refract = 1.4,
  size = [2, 3],
  mirror = 0,
  frost = 0,
  opacity = 1,
  edgeWidth = 0.07,
  grime = 1,
} = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, shared, {
    uTint: { value: new THREE.Color(tint) },
    uAbsorb: { value: new THREE.Vector3(...absorb) },
    uEdge: { value: new THREE.Color(edge) },
    uIor: { value: ior },
    uDispersion: { value: dispersion },
    uThickness: { value: thickness },
    uRefract: { value: refract },
    uCrack: { value: 0 },
    uImpact: { value: new THREE.Vector2() },
    uSize: { value: new THREE.Vector2(size[0], size[1]) },
    uHighlight: { value: 0 },
    uMirror: { value: mirror },
    uFrost: { value: frost },
    uOpacity: { value: opacity },
    uEdgeWidth: { value: edgeWidth },
    uGrime: { value: grime },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = "CausewayGlass";
  material.userData.params = { tint, absorb, edge, ior, dispersion, thickness, refract, size, mirror, frost, opacity, edgeWidth, grime };
  return material;
}

/**
 * A fresh glass material for one breakable object, with the same look as
 * `material`. Built from the stored parameters rather than material.clone(),
 * because clone() would try to deep-copy the render-target textures in the
 * shared uniforms. Same shader source, so Three reuses the compiled program.
 */
export function cloneGlass(material, shared, overrides = {}) {
  return createGlassMaterial(shared, { ...material.userData.params, ...overrides });
}
