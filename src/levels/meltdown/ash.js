/**
 * Burning away to ash: a dissolve patched onto copies of a model's own
 * materials (see ashify below). Used by the roof's enemies.
 */

import { heatSignature } from "./kit.js";
import { regrime } from "../../figure/grime.js";

const ASH_NOISE = /* glsl */ `
  uniform float uAsh;
  uniform float uAshBase;
  uniform float uAshHeight;
  varying vec3 vAshPos;
  float ashHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float ashNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(ashHash(i), ashHash(i + vec3(1, 0, 0)), f.x), mix(ashHash(i + vec3(0, 1, 0)), ashHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(ashHash(i + vec3(0, 0, 1)), ashHash(i + vec3(1, 0, 1)), f.x), mix(ashHash(i + vec3(0, 1, 1)), ashHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

/**
 * A body that burns away: its own copies of the model's materials (the
 * originals are shared by every enemy of that look), with a dissolve. From
 * the head down, through noise, the surface is gone; just ahead of the cut
 * it glows like embers, and the rest chars as it goes.
 *   uAsh 0 (whole) .. 1.2 (gone)
 * Returns { uniforms, dispose }.
 */
export function ashify(model, height) {
  const uniforms = { uAsh: { value: 0 }, uAshBase: { value: 0 }, uAshHeight: { value: height } };
  const copies = [];
  model.traverse((node) => {
    if (!node.isMesh) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    const next = list.map((m) => {
      if (!m) return m;
      // (A copy loses its shader hooks: the patients' grime goes back on.)
      const c = regrime(m.clone(), m);
      delete c.userData.heat;
      copies.push(c);
      return c;
    });
    node.material = Array.isArray(node.material) ? next : next[0];
  });
  // Still a heat signature through the Thermal Aegis, as it burns.
  heatSignature(model);
  for (const c of copies) {
    const before = c.onBeforeCompile;
    const key = c.customProgramCacheKey.call(c);
    c.onBeforeCompile = (shader, renderer) => {
      before?.call(c, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vAshPos;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvAshPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
${ASH_NOISE}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
          float ashH = clamp((vAshPos.y - uAshBase) / uAshHeight, 0.0, 1.0);
          float ashN = ashNoise(vAshPos * 9.0) * 0.5 + ashNoise(vAshPos * 23.0) * 0.25;
          float ashCut = uAsh * 1.45 - ((1.0 - ashH) * 0.9 + ashN);
          float ashEdge = smoothstep(-0.14, 0.0, ashCut) * step(0.001, uAsh);`)
        // The cut at the very end, not up front: a discard ahead of the
        // lighting (and the patients' grime, its noise and its slopes) took
        // Direct3D's compiler a minute for one program - the Roof froze.
        .replace("#include <dithering_fragment>", `#include <dithering_fragment>
          if (ashCut > 0.0) discard;`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          diffuseColor.rgb *= 1.0 - 0.8 * smoothstep(0.0, 0.55, uAsh);`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(5.0, 1.5, 0.3) * ashEdge;`);
    };
    c.customProgramCacheKey = () => `${key}+ash`;
    c.needsUpdate = true;
  }
  return { uniforms, dispose: () => copies.forEach((c) => c.dispose()) };
}

