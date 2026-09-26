/**
 * Shaders for the Causeway's interactive objects.
 *
 *   createSerumMaterial   power-up capsule: analytic ray/sphere intersection
 *                         for the glass shell, then a signed-distance-field
 *                         (SDF) ray march for the living serum inside.
 *   createCrystalMaterial sphere cache: faceted crystal with an inner pulse.
 *   createHologramMaterial case files: scan lines, flicker, text texture.
 *   createShieldMaterial  kinetic shield bubble: Fresnel + hex cells + ripple.
 *   createConduitMaterial energy conduits on the lift and gate, the team's
 *                         energy-shader idea from the project guide, re-done
 *                         with flowing bands and game-state uniforms.
 */

import * as THREE from "../../../three.js";
import { NOISE_GLSL, FOG_FADE_GLSL } from "./common.js";

/* ------------------------------------------------------------------ */
/* Serum capsule - ray marched signed distance field                    */
/* ------------------------------------------------------------------ */

const serumVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vObj;
varying vec3 vCamObj;
void main() {
  vObj = position;
  vCamObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const serumFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
uniform float uTime;
uniform vec3 uColor;
uniform float uMode;      // 0 prism, 1 thermal, 2 shield, 3 overdrive
varying vec3 vObj;
varying vec3 vCamObj;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// The serum: blobs orbiting inside the capsule, melted together with a
// smooth minimum. Each power-up gets its own shape so they read apart.
float serum(vec3 p) {
  float t = uTime * 1.3;
  float d = 1e5;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec3 c = vec3(sin(t + fi * 2.1), cos(t * 1.3 + fi * 1.7), sin(t * 0.8 + fi * 2.9)) * 0.14;
    d = smin(d, length(p - c) - 0.1, 0.12);
  }
  if (uMode < 0.5) {                                  // prism: a spinning octahedron
    float a = uTime;
    vec3 q = vec3(p.x * cos(a) - p.z * sin(a), p.y, p.x * sin(a) + p.z * cos(a));
    d = smin(d, (abs(q.x) + abs(q.y) + abs(q.z) - 0.22) * 0.577, 0.05);
  } else if (uMode < 1.5) {                           // thermal: gyroid lattice
    float g = abs(dot(sin(p * 22.0 + uTime), cos(p.zxy * 22.0))) / 22.0 - 0.012;
    d = min(d, max(g, length(p) - 0.3));
  } else if (uMode < 2.5) {                           // shield: hollow shell
    d = min(d, abs(length(p) - 0.27) - 0.012);
  } else {                                            // overdrive: spikes
    vec3 q = normalize(p + 1e-4);
    float spikes = pow(abs(sin(q.x * 9.0 + uTime * 3.0) * sin(q.y * 9.0) * sin(q.z * 9.0)), 2.0);
    d = smin(d, length(p) - 0.16 - spikes * 0.12, 0.05);
  }
  return d;
}

vec3 serumNormal(vec3 p) {
  const vec2 e = vec2(0.002, -0.002);
  return normalize(
    e.xyy * serum(p + e.xyy) + e.yyx * serum(p + e.yyx) +
    e.yxy * serum(p + e.yxy) + e.xxx * serum(p + e.xxx));
}

void main() {
  vec3 ro = vCamObj;
  vec3 rd = normalize(vObj - vCamObj);

  // Analytic ray/sphere intersection with the capsule shell (radius 0.5).
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 0.25;
  float h = b * b - c;
  if (h < 0.0) discard;
  float tEnter = max(-b - sqrt(h), 0.0);
  float tExit = -b + sqrt(h);
  vec3 nShell = normalize(ro + rd * tEnter);
  float fresnel = pow(1.0 - abs(dot(nShell, -rd)), 3.0);

  // Refract into the shell, then sphere-trace the SDF.
  vec3 rdIn = refract(rd, nShell, 1.0 / 1.33);
  vec3 pIn = ro + rd * tEnter;
  float t = 0.0;
  bool hit = false;
  vec3 p;
  for (int i = 0; i < 40; i++) {
    p = pIn + rdIn * t;
    float d = serum(p);
    if (d < 0.0015) { hit = true; break; }
    t += d;
    if (t > (tExit - tEnter)) break;
  }

  vec3 colour = vec3(0.0);
  float alpha = fresnel * 0.85 + 0.06;
  if (hit) {
    vec3 n = serumNormal(p);
    vec3 l = normalize(vec3(0.4, 0.8, 0.3));
    float diff = max(dot(n, l), 0.0);
    float rim = pow(1.0 - max(dot(n, -rdIn), 0.0), 2.0);
    float core = exp(-length(p) * 6.0);
    colour = uColor * (0.25 + diff * 0.9) + uColor * rim * 1.6 + vec3(1.0) * core * 0.8;
    alpha = 0.95;
  }
  colour += vec3(0.85, 0.95, 1.0) * fresnel * 1.2 + uColor * 0.15;
  gl_FragColor = vec4(colour * fogFade(), alpha);
}
`;

export const SERUM_COLOURS = {
  prism: new THREE.Color(0.7, 0.45, 1.0),
  thermal: new THREE.Color(1.0, 0.45, 0.12),
  shield: new THREE.Color(0.3, 0.9, 1.0),
  overdrive: new THREE.Color(1.0, 0.2, 0.55),
};
const SERUM_MODES = { prism: 0, thermal: 1, shield: 2, overdrive: 3 };

export function createSerumMaterial(type, time) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uTime: time,
    uColor: { value: SERUM_COLOURS[type].clone() },
    uMode: { value: SERUM_MODES[type] },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: serumVertex,
    fragmentShader: serumFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  material.name = "CausewaySerum";
  return material;
}

/* ------------------------------------------------------------------ */
/* Crystal (sphere cache)                                               */
/* ------------------------------------------------------------------ */

const crystalVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const crystalFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform samplerCube uEnv;
uniform float uTime;
uniform float uHighlight;
uniform vec3 uColor;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  // Flat facets: the face normal from screen-space derivatives.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(vWorld - cameraPosition);
  if (dot(n, V) > 0.0) n = -n;
  float fres = pow(1.0 - abs(dot(n, -V)), 2.5);
  vec3 env = texture(uEnv, reflect(V, n)).rgb;
  float pulse = 0.6 + 0.4 * sin(uTime * 4.0 - length(vLocal) * 10.0);
  vec3 colour = uColor * (0.35 + pulse * 0.9) + env * fres * 0.9 + vec3(1.0) * fres * 0.4;
  colour += uColor * uHighlight * 1.4;
  gl_FragColor = vec4(colour, 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createCrystalMaterial(shared, colour = 0x66f2ff) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uEnv: shared.uEnv,
    uTime: shared.uTime,
    uHighlight: { value: 0 },
    uColor: { value: new THREE.Color(colour) },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: crystalVertex,
    fragmentShader: crystalFragment,
    transparent: true,
    fog: true,
  });
  material.name = "CausewayCrystal";
  return material;
}

/* ------------------------------------------------------------------ */
/* Hologram (case files)                                                */
/* ------------------------------------------------------------------ */

const holoVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const holoFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
uniform sampler2D uMap;
uniform float uTime;
uniform float uHighlight;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float text = texture2D(uMap, vUv).a;
  float scan = 0.65 + 0.35 * sin(vWorld.y * 90.0 - uTime * 12.0);
  float band = smoothstep(0.0, 0.08, abs(fract(vUv.y - uTime * 0.35) - 0.5));
  float flicker = 0.85 + 0.15 * step(0.93, fract(sin(floor(uTime * 18.0)) * 4375.5));
  vec2 edge = min(vUv, 1.0 - vUv);
  float frame = 1.0 - smoothstep(0.0, 0.03, min(edge.x, edge.y));
  float a = (text * 0.9 + 0.12 + frame * 0.6) * scan * mix(0.6, 1.0, band) * flicker;
  vec3 colour = uColor * a * (1.4 + uHighlight * 1.5);
  gl_FragColor = vec4(colour * fogFade(), 1.0);
}
`;

export function createHologramMaterial(map, time, colour = 0x7ef4f1) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uMap: { value: map },
    uTime: time,
    uHighlight: { value: 0 },
    uColor: { value: new THREE.Color(colour) },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: holoVertex,
    fragmentShader: holoFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = "CausewayHologram";
  return material;
}

/* ------------------------------------------------------------------ */
/* Kinetic shield bubble                                                */
/* ------------------------------------------------------------------ */

const shieldVertex = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const shieldFragment = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uRipple;
uniform vec3 uRippleDir;
uniform vec3 uColor;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocal;

// Distance to the nearest hexagon edge on a 2D hex grid.
float hexEdge(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, s * 0.5), q.x);
}

void main() {
  vec3 V = normalize(vWorld - cameraPosition);
  vec3 n = normalize(vNormalW);
  float fres = pow(1.0 - abs(dot(n, -V)), 2.5);
  vec3 d = normalize(vLocal);
  vec2 uv = vec2(atan(d.z, d.x) * 3.0, d.y * 6.0);
  float hex = 1.0 - smoothstep(0.0, 0.07, hexEdge(uv));
  float along = dot(d, normalize(uRippleDir));
  float ripple = uRipple * smoothstep(0.25, 0.0, abs(along - (1.0 - uRipple * 2.0)));
  float a = (fres * 0.8 + hex * 0.25 * (0.5 + 0.5 * sin(uTime * 3.0 + d.y * 8.0)) + ripple) * uStrength;
  gl_FragColor = vec4(uColor * (1.2 + ripple * 3.0), a);
}
`;

export function createShieldMaterial(time) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uStrength: { value: 0 },
      uRipple: { value: 0 },
      uRippleDir: { value: new THREE.Vector3(0, 0, -1) },
      uColor: { value: new THREE.Color(0x4fe8ff) },
    },
    vertexShader: shieldVertex,
    fragmentShader: shieldFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.name = "CausewayShield";
  return material;
}

/* ------------------------------------------------------------------ */
/* Energy conduit                                                       */
/* ------------------------------------------------------------------ */

const conduitVertex = /* glsl */ `
uniform float uTime;
uniform float uCharge;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // A travelling bulge: the vertex stage animates geometry, the fragment
  // stage animates colour. Both read the same time and charge uniforms.
  p += normal * sin(uv.y * 30.0 - uTime * 6.0) * 0.02 * (0.3 + uCharge);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const conduitFragment = /* glsl */ `
uniform float uTime;
uniform float uCharge;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float band = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * (4.0 + uCharge * 8.0));
  float edge = pow(abs(vUv.x - 0.5) * 2.0, 3.0);
  vec3 colour = uColor * (0.4 + band * (0.8 + uCharge * 1.6)) + vec3(1.0) * edge * 0.3;
  gl_FragColor = vec4(colour, 0.35 + band * 0.4 + edge * 0.2);
}
`;

export function createConduitMaterial(time, colour = 0x7ef4f1) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uCharge: { value: 0 }, uColor: { value: new THREE.Color(colour) } },
    vertexShader: conduitVertex,
    fragmentShader: conduitFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.name = "CausewayConduit";
  return material;
}

/* ------------------------------------------------------------------ */
/* Beacon column (case files)                                           */
/* ------------------------------------------------------------------ */

/**
 * A soft column of light rising from the floor, so a collectible can be seen
 * from far down a dark corridor. Drawn on an open cylinder, additive. The
 * column is brightest at the floor and fades upward (uv.y is 0 at the bottom
 * of a CylinderGeometry, 1 at the top); it is brightest where the surface faces
 * the viewer, which makes the thin tube read as a volume of light rather than
 * a hollow pipe; and bands scroll upward so it reads as "active".
 */
export function createBeaconMaterial(time, colour = 0xffc45a) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, { uTime: time, uColor: { value: new THREE.Color(colour) } });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      ${FOG_FADE_GLSL}
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float facing = abs(dot(normalize(vNormalW), V));
        float fade = pow(1.0 - vUv.y, 1.4);
        float bands = 0.7 + 0.3 * sin(vUv.y * 28.0 - uTime * 3.0);
        float a = fade * facing * facing * bands;
        gl_FragColor = vec4(uColor * a * 1.1 * fogFade(), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = "CausewayBeacon";
  return material;
}
