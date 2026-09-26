/**
 * Dynamic sky and distant skyline.
 *
 * The level is set at 03:47 - the resonance trial ran overnight. At night
 * the burning city and the fires inside are the main light sources, which is
 * what makes the scene read as a disaster rather than a lit set.
 *
 * SKY - drawn on a sphere that follows the camera, forced to the far plane
 * (gl_Position.z = w), so it never clips and never occludes anything.
 *   - Night atmosphere: deep navy zenith, and an orange glow band on the
 *     horizon from the city burning below the clouds.
 *   - Stars: a 3D cell hash of the view direction; one star per rare cell,
 *     twinkling, hidden by cloud and smoke.
 *   - Moon: a disc and halo along uMoonDir.
 *   - Cloud deck above: a short ray march (CLOUD_STEPS) through a slab of sky
 *     between two heights, accumulating opacity front to back. Clouds are dark
 *     silhouettes whose undersides catch the orange fire glow.
 *   - Cloud sea below: the lab is above the low cloud. Rays that point down
 *     hit a noise-shaded cloud floor with patches lit orange from beneath by
 *     fires in the city.
 *   - uBurn (0..1) is driven by the fires and the demolition: a stronger glow,
 *     thicker smoke plumes over the horizon behind the player.
 *   - uFlash adds the warm pulse of a detonation.
 *
 * SKYLINE - one InstancedMesh of tower boxes (one draw call). Windows are
 * generated in the fragment shader from world position, no textures. Each
 * tower's z is wrapped around the camera with mod(), so the skyline is
 * infinite for endless mode with zero CPU cost.
 */

import * as THREE from "../../../three.js";
import { NOISE_GLSL } from "./common.js";

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDir = world.xyz - cameraPosition;
  vec4 clip = projectionMatrix * viewMatrix * world;
  gl_Position = clip.xyww;            // pin to the far plane
}
`;

const skyFragment = /* glsl */ `
#include <common>
${NOISE_GLSL}
#ifndef CLOUD_STEPS
#define CLOUD_STEPS 6
#endif
uniform vec3 uSunDir;          // used as the moon direction at night
uniform float uTime;
uniform float uBurn;
uniform float uFlash;
uniform vec3 uHaze;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;

  // Night atmosphere and the fire glow of the city below the horizon.
  vec3 zenith = vec3(0.004, 0.006, 0.016);
  vec3 horizon = vec3(0.028, 0.03, 0.05);
  vec3 colour = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.35));
  vec3 fireGlow = vec3(0.62, 0.22, 0.06) * (0.35 + uBurn * 0.9);
  float band = exp(-abs(y) * 8.0);
  colour += fireGlow * band * 0.55;

  // Moon.
  float md = max(dot(dir, uSunDir), 0.0);
  colour += vec3(0.85, 0.9, 1.0) * smoothstep(0.99965, 0.99985, md) * 2.2;
  colour += vec3(0.35, 0.42, 0.6) * pow(md, 60.0) * 0.12;

  vec2 wind = vec2(uTime * 0.004, uTime * 0.0015);
  float cloudAlpha = 0.0;

  if (y > 0.0) {
    // Stars.
    vec3 sp = dir * 260.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    vec3 f = fract(sp) - 0.5;
    float star = step(0.9972, h) * smoothstep(0.32, 0.0, length(f));
    float twinkle = 0.6 + 0.4 * sin(uTime * (2.0 + h * 6.0) + h * 60.0);
    colour += vec3(0.85, 0.9, 1.0) * star * twinkle * 1.6 * smoothstep(0.04, 0.25, y) * (1.0 - uBurn * 0.6);

    // Cloud deck: dark silhouettes, undersides lit by the fires below.
    vec3 cloudLight = vec3(0.0);
    for (int i = 0; i < CLOUD_STEPS; i++) {
      float hgt = mix(1.0, 1.6, (float(i) + 0.5) / float(CLOUD_STEPS));
      float t = hgt / max(y, 0.02);
      vec2 p = dir.xz * t * 0.4 + wind;
      float d = fbm2(p * 6.0) - 0.47 + uBurn * 0.06;
      d *= exp(-t * 0.045);
      if (d > 0.0) {
        float a = clamp(d * 1.8, 0.0, 1.0) * (1.0 - cloudAlpha);
        float under = 1.0 - float(i) / float(CLOUD_STEPS);
        vec3 c = vec3(0.018, 0.019, 0.026) + fireGlow * 0.35 * under * exp(-y * 3.0) + vec3(0.06, 0.07, 0.09) * pow(md, 8.0);
        cloudLight += a * c;
        cloudAlpha += a;
      }
    }
    colour = colour * (1.0 - cloudAlpha) + cloudLight;
  } else {
    // Cloud sea below, lit in patches by the burning city under it.
    float t = 1.0 / max(-y, 0.02);
    vec2 p = dir.xz * t * 0.5 + wind * 2.0;
    float n = fbm2(p * 4.0);
    float lit = smoothstep(0.52, 0.78, fbm2(p * 1.6 + 11.0));
    vec3 top = vec3(0.02, 0.021, 0.028) * (0.6 + n) + fireGlow * lit * (0.25 + n * 0.35);
    float haze = 1.0 - exp(-t * 0.06);
    colour = mix(top, horizon + fireGlow * 0.3, haze);
  }

  // Smoke plumes rising over the horizon behind the runner, black against
  // the glow, with their bases lit orange.
  float behind = smoothstep(-0.4, 0.6, dir.z);
  float plume = fbm2(vec2(atan(dir.x, dir.z) * 9.0, y * 12.0 - uTime * 0.25));
  float plumeMask = smoothstep(0.42, 0.68, plume) * smoothstep(0.6, -0.02, y) * behind;
  vec3 plumeColour = mix(fireGlow * 0.35, vec3(0.01), smoothstep(0.0, 0.3, y));
  colour = mix(colour, plumeColour, plumeMask * (0.4 + uBurn * 0.6));

  colour += vec3(1.0, 0.5, 0.2) * uFlash;
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky(noiseTexture, { cloudSteps = 6 } = {}) {
  const uniforms = {
    uNoise: { value: noiseTexture },
    uSunDir: { value: new THREE.Vector3(0.45, 0.32, -0.83).normalize() },
    uTime: { value: 0 },
    uBurn: { value: 0 },
    uFlash: { value: 0 },
    uHaze: { value: new THREE.Color(0.03, 0.03, 0.045) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    defines: { CLOUD_STEPS: cloudSteps },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  material.name = "CausewaySky";
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  mesh.name = "Sky";
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */

const skylineVertex = /* glsl */ `
uniform float uSpan;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vTower;
void main() {
  vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  // Wrap each tower around the camera so the skyline never runs out.
  float wrapped = cameraPosition.z + mod(origin.z - cameraPosition.z + uSpan * 0.5, uSpan) - uSpan * 0.5;
  world.z += wrapped - origin.z;
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vTower = float(gl_InstanceID);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const skylineFragment = /* glsl */ `
#include <common>
uniform vec3 uHaze;
uniform float uBurn;
uniform float uTime;
uniform vec3 uSunDir;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vTower;

float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void main() {
  vec3 n = normalize(vNormalW);
  float tower = h21(vec2(vTower, 3.7));
  bool outage = tower < 0.3;                         // whole blocks have lost power
  vec2 facade = abs(n.x) > 0.5 ? vWorld.zy : vWorld.xy;
  vec2 cell = floor(facade / vec2(2.6, 3.8));
  vec2 f = fract(facade / vec2(2.6, 3.8));
  float window = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
  float r = h21(cell + vTower * 7.0);
  float lit = outage ? 0.0 : step(0.72, r);
  float burning = step(0.965 - uBurn * 0.05, h21(cell * 1.7 + vTower));

  vec3 V = normalize(vWorld - cameraPosition);
  float fres = pow(1.0 - abs(dot(-V, n)), 3.0);
  vec3 colour = vec3(0.012, 0.014, 0.02) + vec3(0.04, 0.05, 0.07) * fres;
  colour += vec3(0.05, 0.06, 0.09) * max(dot(n, uSunDir), 0.0) * 0.4;
  vec3 warm = mix(vec3(1.0, 0.78, 0.45), vec3(0.7, 0.85, 1.0), step(0.86, r));
  colour += window * lit * warm * 0.55;
  colour += window * burning * vec3(1.0, 0.32, 0.06) * (1.4 + sin(uTime * 9.0 + cell.x * 3.0) * 0.5);
  // Fire glow from the streets washes up the lower facades.
  colour += vec3(0.5, 0.18, 0.05) * smoothstep(-10.0, -80.0, vWorld.y) * (0.25 + uBurn * 0.5);
  // Aircraft warning light on each roof.
  if (n.y > 0.5) colour = vec3(0.015);

  float dist = length(vWorld - cameraPosition);
  colour = mix(colour, uHaze, 1.0 - exp(-dist * 0.0018));
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSkyline(skyUniforms, { count = 46, span = 1500, seed = 3 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSpan: { value: span },
      uHaze: skyUniforms.uHaze,
      uBurn: skyUniforms.uBurn,
      uTime: skyUniforms.uTime,
      uSunDir: skyUniforms.uSunDir,
    },
    vertexShader: skylineVertex,
    fragmentShader: skylineFragment,
    fog: false,
  });
  material.name = "CausewaySkyline";
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "Skyline";
  mesh.frustumCulled = false;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const towers = [];
  for (let i = 0; i < count; i += 1) {
    const side = i % 2 ? 1 : -1;
    const x = side * (120 + r() * 380);
    const z = -r() * span;
    const w = 18 + r() * 30;
    const h = 60 + r() * 150;
    const base = -120;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.4);
    m.compose(new THREE.Vector3(x, base, z), q, new THREE.Vector3(w, h, w * (0.8 + r() * 0.6)));
    mesh.setMatrixAt(i, m);
    towers.push({ x, z, w, h, base });
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.towers = towers;
  return mesh;
}
