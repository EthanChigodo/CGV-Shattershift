/**
 * 3D value noise for the figures' shaders (look.js, grime.js), read from a
 * texture instead of worked out from hashes:
 *
 *   uniforms.uNoise = { value: noiseTexture() };
 *   fragment head: NOISE_GLSL - float noise3(vec3 p) (0..1)
 *
 * The hashed kind is eight hashes a call, and these shaders call it dozens
 * of times: Direct3D's compiler inlines every one, and on a laptop's own
 * graphics that took 3 s for the player's program and 12 s for a patient's
 * (a minute with the ash dissolve on top) - the Roof froze on it. One
 * texture fetch a call compiles in no time and runs faster too.
 *
 * The texture (iq's trick): 256 px, red random, green the red shifted by
 * (37, 17) - so one bilinear fetch at (xy + (37, 17) z) gives slices z and
 * z + 1 together, and z is blended by hand.
 */

import * as THREE from "../three.js";

// (Guarded: a material can carry two layers that both use it.)
export const NOISE_GLSL = /* glsl */ `
#ifndef FIGURE_NOISE
#define FIGURE_NOISE
uniform sampler2D uNoise;
float noise3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  vec2 uv = i.xy + vec2(37.0, 17.0) * i.z + f.xy;
  vec2 rg = textureLod(uNoise, (uv + 0.5) / 256.0, 0.0).yx;
  return mix(rg.x, rg.y, f.z);
}
#endif
`;

let texture = null;

/** The one noise texture, shared by every material that uses NOISE_GLSL. */
export function noiseTexture() {
  if (texture) return texture;
  const N = 256;
  const red = new Uint8Array(N * N);
  let state = 0x2f6b9d13;
  for (let i = 0; i < red.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    red[i] = state >>> 24;
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const i = y * N + x;
      data[i * 4] = red[i];
      data[i * 4 + 1] = red[((y - 17) & (N - 1)) * N + ((x - 37) & (N - 1))];
      data[i * 4 + 3] = 255;
    }
  }
  texture = new THREE.DataTexture(data, N, N);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
