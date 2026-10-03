/**
 * Screen-space ambient occlusion for Level 3 at "High" quality (Phase 7).
 *
 * The composer's first target carries a depth texture; this pass rebuilds
 * view-space positions and normals from it and darkens each pixel by how
 * much of a small hemisphere around it is inside nearby geometry - the
 * contact darkness where a barrier meets the floor, in the corners of a
 * room, under a desk. 12 samples, rotated per pixel (the grading pass's
 * grain hides the rotation noise, so there is no blur pass to pay for).
 *
 *   const ao = new AOPass(camera);
 *   composer.insertPass(ao, 1);   // straight after the RenderPass
 *   ao.enabled = quality === "high";
 */

import * as THREE from "../../three.js";
import { Pass, FullScreenQuad } from "../../three-addons.js";

const SAMPLES = 12;

function kernel() {
  // Points in a unit hemisphere (+Z), packed toward the centre.
  const out = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const a = i * 2.39996; // golden angle
    const r = Math.sqrt((i + 0.5) / SAMPLES);
    const z = Math.sqrt(Math.max(0.05, 1 - r * r));
    const v = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z).normalize();
    const scale = 0.25 + 0.75 * ((i + 1) / SAMPLES) ** 2;
    out.push(v.multiplyScalar(scale));
  }
  return out;
}

export class AOPass extends Pass {
  constructor(camera, { radius = 0.55, intensity = 0.85 } = {}) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uKernel: { value: kernel() },
        uRadius: { value: radius },
        uIntensity: { value: intensity },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform mat4 uProj;
        uniform mat4 uProjInv;
        uniform vec3 uKernel[${SAMPLES}];
        uniform float uRadius;
        uniform float uIntensity;
        varying vec2 vUv;

        vec3 viewAt(vec2 uv, float depth) {
          vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          vec4 colour = texture2D(tDiffuse, vUv);
          float depth = texture2D(tDepth, vUv).x;
          if (depth >= 0.9999) { gl_FragColor = colour; return; }
          vec3 p = viewAt(vUv, depth);
          vec3 n = normalize(cross(dFdx(p), dFdy(p)));
          // A per-pixel rotation of the kernel about the normal.
          float a = hash(gl_FragCoord.xy) * 6.2831853;
          vec3 r = vec3(cos(a), sin(a), 0.0);
          vec3 t = normalize(r - n * dot(r, n));
          vec3 b = cross(n, t);
          mat3 tbn = mat3(t, b, n);
          // Wider in the distance (in pixels it shrinks anyway), capped.
          float radius = uRadius * clamp(-p.z / 6.0, 0.6, 2.2);
          float occluded = 0.0;
          for (int i = 0; i < ${SAMPLES}; i++) {
            vec3 s = p + tbn * uKernel[i] * radius;
            vec4 q = uProj * vec4(s, 1.0);
            vec2 uv = q.xy / q.w * 0.5 + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
            float sceneZ = viewAt(uv, texture2D(tDepth, uv).x).z;
            // Something in front of the sample (and near enough to matter).
            float range = smoothstep(0.0, 1.0, radius / abs(p.z - sceneZ));
            occluded += (sceneZ >= s.z + 0.03 ? 1.0 : 0.0) * range;
          }
          float ao = occluded / float(${SAMPLES});
          colour.rgb *= 1.0 - uIntensity * ao;
          gl_FragColor = colour;
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProj.value.copy(this.camera.projectionMatrix);
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
