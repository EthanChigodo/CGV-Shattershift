/**
 * GLSL shared by every Causeway shader.
 *
 * NOISE_GLSL reads the lattice built by createNoiseTexture() in textures.js.
 * R and G hold the same random values offset by (37, 17) texels, so one
 * bilinear fetch returns two neighbouring z slices of a 3D lattice. mix() on
 * fract(z) completes trilinear value noise with a single texture read, which
 * is far cheaper than hashing eight lattice corners per call.
 */

export const NOISE_GLSL = /* glsl */ `
uniform sampler2D uNoise;

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);                 // smoothstep fade curve
  vec2 uv = (i.xy + vec2(37.0, 17.0) * i.z) + f.xy;
  vec2 rg = textureLod(uNoise, (uv + 0.5) / 256.0, 0.0).rg;
  return mix(rg.x, rg.y, f.z);                 // blend the two z slices
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}

float noise2(vec2 p) {
  return textureLod(uNoise, p / 256.0, 0.0).b;
}

float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = p * 2.07 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return v;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/**
 * Exponential-squared fog applied by hand. Additive effects (fire, embers)
 * cannot use Three's fog_fragment, which mixes toward the fog colour; an
 * additive light should instead fade to nothing with distance.
 */
export const FOG_FADE_GLSL = /* glsl */ `
float fogFade() {
  #ifdef USE_FOG
    return exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    return 1.0;
  #endif
}
`;

/** Rodrigues rotation of v about a unit axis. Used by the GPU shard physics. */
export const ROTATE_GLSL = /* glsl */ `
vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
`;
