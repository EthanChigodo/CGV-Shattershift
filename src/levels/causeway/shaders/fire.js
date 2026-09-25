/**
 * Volumetric fire by ray marching.
 *
 * A fire is drawn on an ordinary unit box, but the box is only a bounding
 * volume. For every pixel the box covers, the fragment shader:
 *
 *   1. Builds the view ray in the box's OBJECT space. The vertex shader moves
 *      the camera into object space with inverse(modelMatrix), so the ray
 *      works for any position, rotation, or scale the level gives the fire.
 *   2. Intersects the ray with the box using the slab method, giving the
 *      entry and exit distances tNear and tFar.
 *   3. Marches STEPS samples from tNear to tFar. At each sample it evaluates a
 *      density field: a tapering flame shape distorted by 3D fbm noise that is
 *      stretched vertically and scrolls upward over time (licking tongues).
 *   4. Converts density and height into temperature, temperature into a
 *      black-body-like colour ramp (dark red -> orange -> yellow), and
 *      accumulates emission front to back with Beer-Lambert opacity, stopping
 *      early once the ray is nearly opaque.
 *
 * The box is rendered BackSide so the rasterised face is always the exit
 * face, which keeps the effect working when the camera is inside the fire.
 * A per-pixel random start offset (dither) hides the banding a low step count
 * would otherwise show.
 *
 * `uIntensity` is the gameplay link: sprinklers and cryo spheres drive it to
 * zero, and the shader's density scales with it, so an extinguished fire
 * visibly shrinks and gutters out rather than popping off.
 */

import * as THREE from "../../../three.js";
import { NOISE_GLSL, FOG_FADE_GLSL } from "./common.js";

const vertexShader = /* glsl */ `
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

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
${FOG_FADE_GLSL}

#ifndef STEPS
#define STEPS 18
#endif

uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
uniform vec3 uScale;
varying vec3 vObj;
varying vec3 vCamObj;

// Slab-method ray/box intersection for the unit box centred on the origin.
vec2 hitBox(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-0.5 - ro) * inv;
  vec3 t1 = ( 0.5 - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

float flameDensity(vec3 p) {
  float h = p.y + 0.5;                                  // 0 at the base, 1 at the top
  vec3 wp = p * uScale + vec3(uSeed);                   // noise in world-sized units
  // Noise stretched vertically and scrolled upward: licking tongues of flame.
  float n = fbm3(wp * vec3(1.6, 0.7, 1.6) - vec3(0.0, uTime * 2.6, 0.0));
  float n2 = noise3(wp * vec3(4.0, 2.0, 4.0) - vec3(0.0, uTime * 5.5, uTime * 0.7));
  vec2 xz = p.xz;
  xz.x += (n - 0.5) * 0.3 * h;                          // flames sway as they rise
  float radius = 0.5 * (1.0 - h * 0.55);
  float body = 1.0 - smoothstep(radius * 0.2, radius, length(xz));
  float d = body * (1.1 - h) * 2.2 * (n * 1.4 - 0.12) + (n2 - 0.5) * 0.35 * body;
  return clamp(d, 0.0, 1.0) * uIntensity;
}

vec3 fireRamp(float t) {
  vec3 c = mix(vec3(0.18, 0.01, 0.0), vec3(0.9, 0.12, 0.01), smoothstep(0.0, 0.3, t));
  c = mix(c, vec3(1.0, 0.42, 0.05), smoothstep(0.3, 0.65, t));
  return mix(c, vec3(1.0, 0.82, 0.45), smoothstep(0.65, 1.0, t));
}

void main() {
  if (uIntensity < 0.01) discard;
  vec3 ro = vCamObj;
  vec3 rd = normalize(vObj - vCamObj);
  vec2 t = hitBox(ro, rd);
  t.x = max(t.x, 0.0);
  if (t.x >= t.y) discard;

  float stepLength = (t.y - t.x) / float(STEPS);
  float dither = hash12(gl_FragCoord.xy + fract(uTime) * 91.0);
  vec3 light = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (t.x + (float(i) + dither) * stepLength);
    float d = flameDensity(p);
    if (d > 0.02) {
      float h = p.y + 0.5;
      float temperature = clamp(d * (1.05 - h * 0.9), 0.0, 1.0);
      float absorbed = 1.0 - exp(-d * stepLength * 7.0);
      light += transmittance * absorbed * fireRamp(temperature) * (1.3 + temperature * 2.4);
      transmittance *= 1.0 - absorbed * 0.7;
      if (transmittance < 0.04) break;
    }
  }
  gl_FragColor = vec4(light * fogFade(), 1.0);
}
`;

export function createFireMaterial(noiseTexture, { steps = 18 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uNoise: { value: noiseTexture },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uSeed: { value: 0 },
    uScale: { value: new THREE.Vector3(1, 1, 1) },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    defines: { STEPS: steps },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: true,
  });
  material.name = "CausewayFire";
  return material;
}

/**
 * A fire needs its own intensity/seed/scale uniforms but shares the noise
 * texture and time. Built fresh (not cloned) so Three reuses the program.
 */
export function makeFireInstance(template, time) {
  const material = createFireMaterial(template.uniforms.uNoise.value, { steps: template.defines.STEPS });
  material.uniforms.uTime = time;
  material.uniforms.uSeed.value = Math.random() * 40;
  return material;
}
