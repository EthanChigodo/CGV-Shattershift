/**
 * GLSL for the elevator rides.
 *
 * Everything outside the cabin is drawn procedurally - no textures to load
 * while Level 3 streams its models in the background:
 *
 *   facade   Tower walls. Windows are a grid in world space, so any box (the
 *            main tower or an instanced skyline tower) gets lit offices,
 *            dark glass, and burning floors below a "fire line" for free.
 *   sky      Night storm sky: gradient, fire glow on the horizon, drifting
 *            fbm clouds lit from below, lightning flashes (uFlash).
 *   city     The ground far below: street grid, lit windows, fires.
 *   energy   The tower's energy material from the project brief (bands and
 *            edge glow driven by time), used on the cabin conduits. uFault
 *            turns it red and makes it stutter.
 *
 * All of them do their own exponential fog (so they match the scene fog) and
 * include Three's tone-mapping and colour-space chunks, so they sit in the
 * same ACES pipeline as the standard materials.
 */

import * as THREE from "../three.js";

const NOISE = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
`;

const FOG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  vec3 applyFog(vec3 col, vec3 world) {
    float d = length(world - cameraPosition);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    return mix(col, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/** Shared uniforms: one clock and one fog for every ride shader. */
export function createRideUniforms() {
  return {
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFogColor: { value: new THREE.Color(0x1a0f10) },
    uFogDensity: { value: 0.0021 },
  };
}

/* ---------------------------------------------------------------- facade */

export function createFacadeMaterial(shared, { fireLine = -60, power = 1, seed = 0, lit = 0.6 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uFireLine: { value: fireLine },
      uPower: { value: power },
      uSeed: { value: seed },
      uLit: { value: lit },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vInstance;
      void main() {
        vec4 local = vec4(position, 1.0);
        vec3 n = normal;
        vInstance = 0.0;
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
          n = mat3(instanceMatrix) * n;
          vInstance = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
        #endif
        vec4 world = modelMatrix * local;
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlash;
      uniform float uFireLine;
      uniform float uPower;
      uniform float uSeed;
      uniform float uLit;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vInstance;
      ${NOISE}
      ${FOG}
      void main() {
        vec3 n = normalize(vNormal);
        vec3 concrete = vec3(0.028, 0.03, 0.036);
        if (abs(n.y) > 0.5) {
          // Roofs: dark, with a few red aircraft lights.
          vec3 col = concrete * 0.7;
          gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
          ${OUTPUT}
          return;
        }
        // Along-the-wall coordinate for whichever way this face points.
        float along = abs(n.x) > 0.5 ? vWorld.z : vWorld.x;
        vec2 cell = vec2(along / 2.6, vWorld.y / 4.0);
        vec2 id = floor(cell) + vec2(vInstance + uSeed, 0.0);
        vec2 f = fract(cell);
        float pane = step(0.12, f.x) * step(f.x, 0.88) * step(0.2, f.y) * step(f.y, 0.9);
        float r = hash12(id);
        float floorOn = step(0.25, hash12(vec2(id.y, vInstance + uSeed + 3.0)));
        float lit = step(uLit, r) * floorOn * uPower;
        vec3 warm = mix(vec3(1.0, 0.66, 0.36), vec3(0.5, 0.72, 1.0), step(0.82, hash12(id + 7.0)));
        // An office behind the glass: brighter toward the ceiling, some blinds half down.
        float dim = (0.25 + 0.45 * hash12(id + 13.0)) * mix(0.45, 1.0, f.y);
        float blinds = step(0.6, hash12(id + 21.0)) * step(0.55, f.y) * (0.55 + 0.45 * step(0.5, fract(f.y * 14.0)));
        dim *= 1.0 - 0.7 * blinds;

        // Burning floors below the fire line, with soot creeping up.
        float below = smoothstep(uFireLine + 6.0, uFireLine - 24.0, vWorld.y);
        float burn = below * step(0.3, hash12(id + 3.1));
        float flick = 0.55 + 0.45 * sin(uTime * 9.0 + r * 40.0) * sin(uTime * 5.3 + r * 17.0);
        float soot = smoothstep(uFireLine + 40.0, uFireLine, vWorld.y) * (0.6 + 0.4 * noise(vWorld.xy * 0.2));

        // Dark glass reflecting the night sky, a little lighter at the top.
        vec3 glass = mix(vec3(0.018, 0.024, 0.04), vec3(0.05, 0.05, 0.075), f.y) + vec3(0.05, 0.03, 0.02) * below;
        vec3 col = mix(concrete, glass + warm * lit * dim, pane);
        col += pane * burn * vec3(2.2, 0.75, 0.18) * flick;
        col *= 1.0 - 0.75 * soot * (1.0 - burn);
        // Floor slabs catch the fire light from below.
        col += (1.0 - pane) * below * vec3(0.18, 0.06, 0.02) * step(f.y, 0.2);
        col += uFlash * 0.12 * vec3(0.7, 0.8, 1.0);
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
        ${OUTPUT}
      }
    `,
  });
}

/* ------------------------------------------------------------------- sky */

export function createSkyMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlash;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 top = vec3(0.008, 0.01, 0.028);
        vec3 mid = vec3(0.045, 0.03, 0.055);
        vec3 col = mix(mid, top, smoothstep(0.0, 0.7, y));
        // The city is burning: orange glow on the horizon, all the way round.
        float glow = exp(-abs(y + 0.03) * 11.0);
        col += vec3(0.5, 0.16, 0.05) * glow;
        // Storm clouds, lit from below by the fires.
        if (y > -0.05) {
          vec2 uv = d.xz / (y + 0.18) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
          float c = fbm(uv);
          float cloud = smoothstep(0.42, 0.85, c) * smoothstep(-0.05, 0.25, y);
          vec3 lit = mix(vec3(0.12, 0.05, 0.04), vec3(0.03, 0.03, 0.05), smoothstep(0.0, 0.5, y));
          col = mix(col, lit + vec3(0.6, 0.65, 0.8) * uFlash * c, cloud * 0.85);
          // A few stars through the gaps.
          float star = step(0.9965, hash12(floor(d.xz / (y + 0.02) * 220.0)));
          col += star * (1.0 - cloud) * smoothstep(0.2, 0.6, y) * 0.8;
        }
        col += uFlash * 0.25 * vec3(0.55, 0.6, 0.8) * smoothstep(-0.1, 0.4, y);
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT}
      }
    `,
  });
}

/* ------------------------------------------------------------------ city */

export function createCityMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      ${NOISE}
      ${FOG}
      void main() {
        vec2 p = vWorld.xz / 22.0;
        vec2 f = fract(p);
        vec2 id = floor(p);
        float street = 1.0 - step(0.09, min(f.x, f.y));
        vec3 col = vec3(0.012, 0.012, 0.016);
        col += street * vec3(0.9, 0.45, 0.16) * 0.55;
        vec2 q = floor(vWorld.xz / 3.0);
        float win = step(0.93, hash12(q)) * (1.0 - street);
        col += win * mix(vec3(1.0, 0.75, 0.45), vec3(0.6, 0.8, 1.0), hash12(q + 5.0)) * 0.9;
        // Fires in some blocks.
        float fire = smoothstep(0.72, 0.9, noise(vWorld.xz * 0.004 + 3.0)) * step(0.6, hash12(id));
        float flick = 0.7 + 0.3 * sin(uTime * 7.0 + hash12(id) * 30.0);
        col += fire * vec3(2.0, 0.6, 0.12) * flick * (0.5 + 0.5 * noise(vWorld.xz * 0.2 + uTime));
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
        ${OUTPUT}
      }
    `,
  });
}

/* ---------------------------------------------------------------- energy */

/**
 * The brief's energy material: flowing bands and edge glow over a conduit.
 * uFault 0..1 turns it from resonance cyan to alarm red and makes it stutter.
 */
export function createEnergyMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uFault: { value: 0 }, uLevel: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uFault;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        // A faint pulse travelling up the conduit; jitters when faulted.
        p += normal * 0.012 * sin(uv.y * 30.0 - uTime * 6.0) * (1.0 + uFault * 2.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFault;
      uniform float uLevel;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float speed = mix(5.0, 11.0, uFault);
        float band = 0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * speed);
        float edge = pow(abs(vUv.x - 0.5) * 2.0, 3.0);
        vec3 calm = mix(vec3(0.1, 0.55, 0.7), vec3(0.55, 1.0, 1.0), band);
        vec3 alarm = mix(vec3(0.6, 0.05, 0.03), vec3(1.0, 0.35, 0.15), band);
        vec3 col = mix(calm, alarm, uFault);
        float stutter = mix(1.0, step(0.35, noise(vec2(uTime * 14.0, vUv.y * 3.0))), uFault);
        float a = (0.25 + band * 0.55 + edge * 0.3) * stutter * uLevel;
        gl_FragColor = vec4(col * a * 1.6, 1.0);
        ${OUTPUT}
      }
    `,
  });
}
