/**
 * The final full-screen pass for Level 3: a custom grading shader.
 *
 * Runs last, after bloom and tone mapping (display space), and does four
 * things that all used to be absent or faked with CSS:
 *
 *  - heat haze: the image ripples upward, strongest low on screen, scaled
 *    by how close the chasing fire is;
 *  - chromatic split on a hit, and a trace of it as you near death;
 *  - a vignette that closes in with danger and in the dark (tunnel vision);
 *  - film grain, re-seeded every frame, which also breaks up banding in
 *    the smoky near-black gradients this level is full of.
 *
 * One cheap pass, no extra render targets.
 */

import * as THREE from "../../three.js";
import { ShaderPass } from "../../three-addons.js";
import { CHARGE_GLSL, CHARGE_UNIFORMS } from "../../systems/charge.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDanger: { value: 0 },
    uDark: { value: 0 },
    uHeat: { value: 0 },
    uHit: { value: 0 },
    // Focus (bullet time, the host's): the Skyline's look - cool, desaturated, darker edges.
    uFocus: { value: 0 },
    uGrain: { value: 0.045 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    // The charged shot's (systems/charge.js): the same objects as the Skyline's.
    ...CHARGE_UNIFORMS,
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDanger;
    uniform float uDark;
    uniform float uHeat;
    uniform float uHit;
    uniform float uFocus;
    uniform float uGrain;
    uniform vec2 uResolution;
    varying vec2 vUv;
    ${CHARGE_GLSL}

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    void main() {
      vec2 uv = vUv;
      float haze = uHeat * (1.15 - uv.y) * 0.0065;
      uv += vec2(noise(uv * vec2(18.0, 9.0) + vec2(0.0, -uTime * 1.7)) - 0.5,
                 noise(uv * vec2(9.0, 16.0) + vec2(uTime * 0.6, -uTime * 2.3)) - 0.5) * haze;

      uv = chargeWarp(uv);
      vec2 d = uv - 0.5;
      float split = uHit * 0.014 + uDanger * uDanger * 0.003 + chargeSplit();
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * split).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * split).b;

      float r = length(d * vec2(1.0, 0.78));
      float inner = 0.22 - uDark * 0.06 - uDanger * 0.05;
      float outer = 0.82 - uDark * 0.14 - uDanger * 0.16;
      float vig = 1.0 - smoothstep(inner, outer, r);
      col *= mix(0.42 - uDark * 0.25, 1.0, vig);
      col = mix(col, col * vec3(1.14, 0.88, 0.82), uDanger * 0.55);
      // Focus: as in the Skyline (fx/postfx.js) - toward a cool grey, and tunnel vision.
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma) * vec3(0.8, 0.95, 1.1), uFocus * 0.55);
      col *= 1.0 - smoothstep(0.3, 0.85, r) * uFocus * 0.4;

      col = chargeColour(col, vUv, uTime);
      col += (hash(vUv * uResolution + fract(uTime * 7.31) * 311.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export function createGradePass() {
  const pass = new ShaderPass(GradeShader);
  pass.name = "MeltdownGrade";
  // (ShaderPass copies its uniforms: the charge's put back, shared.)
  Object.assign(pass.uniforms, CHARGE_UNIFORMS);
  return pass;
}
