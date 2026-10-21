/**
 * The menu stage's air: one haze model shared by every surface, the night
 * sky, and the noise texture all the effects animate with.
 *
 * Haze. Every custom shader on the stage (and the stock materials, patched
 * with `hazeMaterial`) ends with the same `applyHaze(colour, worldPos)`:
 * exponential height fog, integrated along the view ray, so the streets 96 m
 * below sink into a warm sodium murk while the sky above the roofs stays a
 * cold, clean navy. The fire adds its own in-scatter (the air round the
 * burning floors glows orange from wherever you look toward it) and the moon
 * a faint halo. Because the sky dome uses the very same colours at the
 * horizon, distant towers melt into the sky instead of standing in front of
 * it - that, more than any one effect, is what gives the shot its depth.
 *
 * Noise. One 256x256 tileable texture, generated once per page: R and G two
 * independent fbm fields, B cellular (billowy, for smoke and clouds), A a
 * finer fbm. Flames, smoke, cloud, fog banks, beams all read it - a texture
 * fetch is far cheaper than procedural noise on a laptop GPU.
 */

import * as THREE from "../three.js";

/* ------------------------------------------------------------------ */
/* Noise                                                                */
/* ------------------------------------------------------------------ */

let noiseCache = null;

function lattice(seed, period) {
  const n = period * period;
  const v = new Float32Array(n);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < n; i += 1) {
    s = (s * 16807) % 2147483647;
    v[i] = (s - 1) / 2147483646;
  }
  return v;
}

/** Tileable value-noise fbm over a size x size grid, periods dividing size. */
function fbmField(size, seed, base, octaves) {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    const period = base << o;
    const lat = lattice(seed + o * 13, period);
    const step = period / size;
    for (let y = 0; y < size; y += 1) {
      const fy = y * step;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % period) * period;
      const r1 = ((y0 + 1) % period) * period;
      for (let x = 0; x < size; x += 1) {
        const fx = x * step;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % period;
        const c1 = (x0 + 1) % period;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= total;
  return out;
}

/** Tileable cellular noise (1 - distance to the nearest feature point), billowy. */
function cellField(size, seed, period) {
  const pts = lattice(seed, period * 2);
  const out = new Float32Array(size * size);
  const cell = size / period;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let best = 9;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const gx = cx + ox;
          const gy = cy + oy;
          const wx = ((gx % period) + period) % period;
          const wy = ((gy % period) + period) % period;
          const i = (wy * period + wx) * 2;
          const px = (gx + pts[i % pts.length]) * cell;
          const py = (gy + pts[(i + 1) % pts.length]) * cell;
          const d = Math.hypot(px - x, py - y) / cell;
          if (d < best) best = d;
        }
      }
      out[y * size + x] = Math.max(0, 1 - best);
    }
  }
  return out;
}

/** The shared noise texture (generated once per page). */
export function noiseTexture() {
  if (noiseCache) return noiseCache;
  const size = 256;
  const r = fbmField(size, 11, 4, 5);
  const g = fbmField(size, 37, 4, 5);
  const c1 = cellField(size, 5, 8);
  const c2 = cellField(size, 9, 16);
  const a = fbmField(size, 71, 16, 4);
  const data = new Uint8Array(size * size * 4);
  const stretch = (v) => Math.max(0, Math.min(255, Math.round(((v - 0.5) * 1.7 + 0.5) * 255)));
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = stretch(r[i]);
    data[i * 4 + 1] = stretch(g[i]);
    data[i * 4 + 2] = Math.round(Math.min(1, c1[i] * 0.65 + c2[i] * 0.35) * 255);
    data[i * 4 + 3] = stretch(a[i]);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  // (Shared by every stage instance: never disposed with one.)
  t.userData.shared = true;
  noiseCache = t;
  return t;
}

/* ------------------------------------------------------------------ */
/* Haze                                                                 */
/* ------------------------------------------------------------------ */

/** The haze's uniforms: one object, shared by reference by every material. */
export function createHazeUniforms() {
  return {
    uHazeLow: { value: new THREE.Color(0.042, 0.03, 0.028) },
    uHazeHigh: { value: new THREE.Color(0.01, 0.016, 0.038) },
    uHazeDensity: { value: 0.0042 },
    uHazeFalloff: { value: 0.011 },
    uHazeFloor: { value: -96 },
    uFirePos: { value: new THREE.Vector3() },
    uFireGlow: { value: new THREE.Color(0.9, 0.32, 0.08) },
    uMoonDir: { value: new THREE.Vector3(-0.32, 0.6, 0.74).normalize() },
    uMoonGlow: { value: new THREE.Color(0.32, 0.38, 0.5) },
    uDim: { value: 0 },
  };
}

/** GLSL: the haze uniforms and functions (needs `cameraPosition`). */
export const HAZE_GLSL = /* glsl */ `
  uniform vec3 uHazeLow;
  uniform vec3 uHazeHigh;
  uniform float uHazeDensity;
  uniform float uHazeFalloff;
  uniform float uHazeFloor;
  uniform vec3 uFirePos;
  uniform vec3 uFireGlow;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonGlow;

  // Optical depth of exponential height fog between the eye and p.
  float hazeAmount(vec3 ro, vec3 p) {
    vec3 d = p - ro;
    float dist = length(d);
    float k = uHazeFalloff;
    float a = uHazeDensity * exp(-k * (ro.y - uHazeFloor));
    float dy = d.y;
    float avg = abs(dy) > 0.05 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
    return 1.0 - exp(-a * avg * dist);
  }

  // What the haze itself looks like in direction rd: warm and murky low down
  // (the city's sodium light), cold navy higher up, glowing toward the fire.
  vec3 hazeColour(vec3 ro, vec3 rd) {
    float up = clamp(rd.y * 4.0 + 0.25, 0.0, 1.0);
    vec3 c = mix(uHazeLow, uHazeHigh, up);
    vec3 tf = uFirePos - ro;
    float mf = max(dot(rd, normalize(tf)), 0.0);
    c += uFireGlow * (0.018 * pow(mf, 3.0) + 0.1 * pow(mf, 16.0) + 0.32 * pow(mf, 70.0));
    float mm = max(dot(rd, uMoonDir), 0.0);
    c += uMoonGlow * (0.08 * pow(mm, 6.0) + 0.25 * pow(mm, 40.0));
    return c;
  }

  vec3 applyHaze(vec3 col, vec3 worldPos) {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(worldPos - ro);
    return mix(col, hazeColour(ro, rd), hazeAmount(ro, worldPos));
  }
`;

/**
 * Give a stock material (Standard, Lambert, Basic...) the stage's haze in
 * place of three's fog. Chains onto any onBeforeCompile already there.
 */
export function hazeMaterial(material, uniforms, key = "") {
  const prior = material.onBeforeCompile;
  material.fog = false;
  material.onBeforeCompile = (shader, renderer) => {
    prior?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHazeWorld;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 hw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            hw = instanceMatrix * hw;
          #endif
          vHazeWorld = (modelMatrix * hw).xyz;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vHazeWorld;\n${HAZE_GLSL}`)
      .replace("#include <fog_fragment>", "gl_FragColor.rgb = applyHaze(gl_FragColor.rgb, vHazeWorld);");
  };
  const prev = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prev ? prev() : ""}+menuHaze${key}`;
  material.needsUpdate = true;
  return material;
}

/* ------------------------------------------------------------------ */
/* Sky                                                                  */
/* ------------------------------------------------------------------ */

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;   // on the far plane
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uNoise;
  uniform float uStars;
  uniform float uClouds;
  varying vec3 vDir;
  ${HAZE_GLSL}

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    vec3 rd = normalize(vDir);
    vec3 ro = cameraPosition;
    float h = rd.y;

    // The night: deep navy overhead, the city's light pollution low down.
    vec3 zenith = vec3(0.006, 0.009, 0.022);
    vec3 mid = vec3(0.016, 0.02, 0.04);
    vec3 col = mix(mid, zenith, smoothstep(0.05, 0.75, h));

    // Moon: a small, slightly overexposed disc in a wide soft halo.
    float mm = max(dot(rd, uMoonDir), 0.0);
    float disc = smoothstep(0.99955, 0.99975, mm);
    col += vec3(0.75, 0.82, 0.95) * disc * 5.0;
    col += uMoonGlow * (0.6 * pow(mm, 900.0) + 0.18 * pow(mm, 120.0) + 0.06 * pow(mm, 12.0));

    // Stars, in the clear sky only, fading into the haze.
    vec2 sp = rd.xz / max(0.12, rd.y + 0.12) * 260.0;
    vec2 cell = floor(sp);
    float star = hash12(cell);
    vec2 off = vec2(hash12(cell + 7.1), hash12(cell + 3.3)) - 0.5;
    float d = length(fract(sp) - 0.5 - off * 0.6);
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.0 + star * 3.0) + star * 40.0);
    float stars = step(0.985, star) * smoothstep(0.09, 0.0, d) * twinkle * pow(star, 30.0) * 1.4;
    stars *= smoothstep(0.08, 0.35, h) * uStars;

    // Clouds: a thin broken deck, lit from below by the city (sodium) and,
    // toward the tower, by the fire; their edges pick up the moon.
    float cl = 0.0;
    if (h > 0.0) {
      vec2 cp = rd.xz / (h + 0.06) * 0.07 + vec2(uTime * 0.0009, uTime * 0.0004);
      float n = texture2D(uNoise, cp).r * 0.6 + texture2D(uNoise, cp * 2.7 + 0.31).a * 0.3 + texture2D(uNoise, cp * 0.45).b * 0.35;
      cl = smoothstep(0.42, 0.82, n) * smoothstep(0.0, 0.18, h) * uClouds;
      float thick = smoothstep(0.55, 0.95, n);
      vec3 under = vec3(0.03, 0.026, 0.032) * (1.0 - smoothstep(0.0, 0.5, h) * 0.6);
      vec3 tf = normalize(uFirePos - ro);
      float towardFire = pow(max(dot(rd, tf), 0.0), 10.0);
      under += uFireGlow * towardFire * 0.2;
      under += uMoonGlow * pow(mm, 30.0) * (1.0 - thick) * 1.2;
      col = mix(col, under * (1.0 - thick * 0.45), cl * 0.85);
    }
    col += stars * (1.0 - cl);

    // The haze on the horizon (the same colours the towers fade into).
    float horizon = 1.0 - smoothstep(-0.02, 0.16, h);
    col = mix(col, hazeColour(ro, rd), clamp(horizon * 0.95 + (1.0 - smoothstep(-0.2, 0.0, h)), 0.0, 1.0));
    // A thin warm band right on the horizon: the city's light pollution.
    col += uHazeLow * 0.45 * exp(-abs(h - 0.01) * 26.0);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The sky dome: gradient, moon, stars, a thin cloud deck lit from below. */
export function createSky(hazeUniforms, noise) {
  const uniforms = {
    ...hazeUniforms,
    uTime: { value: 0 },
    uNoise: { value: noise },
    uStars: { value: 1 },
    uClouds: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), material);
  mesh.name = "MenuSky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  // Follows the camera (the sky is at infinity).
  mesh.onBeforeRender = (renderer, scene, camera) => {
    // (World position: a cube camera's faces sit at its origin.)
    mesh.position.setFromMatrixPosition(camera.matrixWorld);
    mesh.updateMatrixWorld();
  };
  return { mesh, uniforms, material };
}
