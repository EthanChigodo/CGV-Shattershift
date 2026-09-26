/**
 * Fire and smoke for Level 3 - custom GLSL, not textures.
 *
 * Each fire is an InstancedMesh of camera-facing quads: one draw call no
 * matter how many flame tongues it has. The fragment shader builds the flame
 * from fractal noise scrolled upward, shaped into a teardrop and pushed
 * through a black-body colour ramp (deep red -> orange -> yellow-white core).
 * Additive blending means overlapping tongues brighten into a hot core the
 * way real fire does, with no sorting.
 *
 * Smoke uses the same instanced-billboard vertex stage with a slower,
 * normal-blended grey fragment stage.
 *
 * The supplied smoke .glb was considered and rejected: it is 3,459 separately
 * animated planes, i.e. ~3,500 draw calls a frame, on a game Level 2 already
 * measured as fill-rate bound. This is the same look for two draw calls.
 */

import * as THREE from "../../three.js";

const NOISE = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }
`;

/**
 * Camera-facing billboard around each instance's origin, with the instance's
 * scale taken from its matrix. The quad's bottom edge sits on the origin so a
 * flame grows up out of whatever it is placed on.
 */
const BILLBOARD_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uSway;
  uniform float uHeightScale;
  varying vec2 vUv;
  varying float vSeed;

  void main() {
    vUv = uv;
    vSeed = aSeed;
    // uHeightScale lets one fire grow/shrink as a unit (erupting vents)
    // without touching its instance matrices.
    vec3 scale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz))
               * vec3(mix(0.35, 1.0, uHeightScale), uHeightScale, 1.0);
    // Flicker the height per tongue so a fire never pulses in unison.
    float flicker = 0.85 + 0.15 * sin(uTime * (7.0 + aSeed * 5.0) + aSeed * 40.0)
                         + 0.08 * sin(uTime * 13.0 + aSeed * 17.0);
    vec4 centre = modelViewMatrix * vec4((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz * vec3(1.0, uHeightScale, 1.0), 1.0);
    vec2 corner = vec2(position.x, position.y + 0.5);
    // Tips sway more than the base.
    corner.x += sin(uTime * 2.3 + aSeed * 11.0) * uSway * corner.y * corner.y;
    centre.xy += corner * vec2(scale.x, scale.y * flicker);
    vUv.y = corner.y;
    gl_Position = projectionMatrix * centre;
  }
`;

const FIRE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  varying float vSeed;
  ${NOISE}

  vec3 ramp(float t) {
    vec3 ember = vec3(0.45, 0.03, 0.0);
    vec3 orange = vec3(1.0, 0.32, 0.02);
    vec3 yellow = vec3(1.0, 0.78, 0.25);
    vec3 core = vec3(1.0, 0.96, 0.82);
    // Most of a flame is orange; yellow only in the hottest part, and the
    // near-white core only right at the base. Overlapping tongues add up,
    // so a ramp that goes yellow early reads as a white blob once stacked.
    vec3 c = mix(ember, orange, smoothstep(0.05, 0.42, t));
    c = mix(c, yellow, smoothstep(0.55, 0.85, t));
    return mix(c, core, smoothstep(0.9, 1.0, t));
  }

  void main() {
    float x = (vUv.x - 0.5) * 2.0;
    float y = clamp(vUv.y, 0.0, 1.0);
    vec2 p = vec2(x * 1.4 + vSeed * 7.0, y * 2.2 - uTime * (1.9 + vSeed * 0.6));
    float n = fbm(p * 1.7);
    float n2 = fbm(vec2(x * 3.1 - vSeed * 3.0, y * 4.0 - uTime * 3.2));
    // Teardrop: rounded at the base, pinched at the tip, and licked sideways
    // by two octaves of scrolling noise so no two tongues share a silhouette.
    float width = mix(0.9, 0.1, pow(y, 1.15));
    float lick = (n - 0.5) * 0.9 * y + (n2 - 0.5) * 0.35 * y * y;
    float body = 1.0 - smoothstep(width * 0.2, width, abs(x + lick));
    float heat = body * (1.25 - y * 1.05) + (n - 0.5) * 0.9;
    heat *= smoothstep(0.0, 0.08, y);
    heat = clamp(heat, 0.0, 1.0);
    // Kept below ~1.0 so overlapping tongues build to a yellow core under
    // additive blending instead of clipping to white; bloom adds the glow.
    float alpha = smoothstep(0.08, 0.45, heat) * uIntensity * 0.55;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(ramp(heat) * (0.34 + heat * 0.46), alpha);
  }
`;

const SMOKE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vSeed;
  ${NOISE}

  void main() {
    vec2 c = vUv - vec2(0.5);
    float r = length(c * vec2(1.0, 0.8)) * 2.0;
    float n = fbm(vec2(vUv.x * 2.0 + vSeed * 5.0, vUv.y * 1.6 - uTime * 0.35 - vSeed));
    float puff = (1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.7));
    float alpha = puff * n * uIntensity * smoothstep(0.0, 0.2, vUv.y);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor * (0.6 + n * 0.5), alpha);
  }
`;

/**
 * One shared material per kind, owned by the level, so a single uTime update
 * animates every fire in the building.
 */
export function createFireMaterials() {
  const shared = { uTime: { value: 0 } };

  const fire = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uIntensity: { value: 1 }, uSway: { value: 0.18 }, uHeightScale: { value: 1 } },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: FIRE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const smoke = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uIntensity: { value: 0.55 },
      uSway: { value: 0.05 },
      uHeightScale: { value: 1 },
      uColor: { value: new THREE.Color(0x2a2522) },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: SMOKE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const quad = new THREE.PlaneGeometry(1, 1);

  return {
    fire,
    smoke,
    quad,
    /** The shared clock uniform, for other shaders that animate with the fire. */
    time: shared.uTime,
    setTime(time) {
      shared.uTime.value = time;
    },
    dispose() {
      fire.dispose();
      smoke.dispose();
      quad.dispose();
    },
  };
}

/**
 * A patch of fire: `count` flame tongues scattered over a `width` x `depth`
 * footprint, each `height` tall (varied per tongue). Optional smoke rising
 * above it. Returns a Group; its `userData.emitter` feeds the pooled lights
 * a flickering orange light, so a fire lights the walls around it.
 */
export function createFire(materials, { width = 2, depth = 2, height = 2.2, count = 14, smoke = true, seed = 1, light = true } = {}) {
  const group = new THREE.Group();
  group.name = "Fire";

  let value = seed * 9301 + 49297;
  const random = () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };

  const flames = new THREE.InstancedMesh(materials.quad, materials.fire, count);
  const seeds = new Float32Array(count);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    // Tongues nearer the middle of the patch burn taller.
    const px = (random() - 0.5) * width;
    const pz = (random() - 0.5) * depth;
    const centrality = 1 - Math.min(1, Math.hypot(px / (width * 0.5 + 0.01), pz / (depth * 0.5 + 0.01)));
    const h = height * (0.45 + 0.55 * centrality) * (0.75 + random() * 0.5);
    position.set(px, 0, pz);
    scale.set(h * (0.55 + random() * 0.25), h, 1);
    matrix.compose(position, quaternion, scale);
    flames.setMatrixAt(i, matrix);
    seeds[i] = random();
  }
  flames.geometry = materials.quad.clone();
  flames.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  flames.frustumCulled = false;
  flames.renderOrder = 3;
  flames.userData.disposeGeometry = flames.geometry;
  group.add(flames);

  if (smoke) {
    const puffs = Math.max(3, Math.round(count / 3));
    const smokeMesh = new THREE.InstancedMesh(materials.quad, materials.smoke, puffs);
    const smokeSeeds = new Float32Array(puffs);
    for (let i = 0; i < puffs; i += 1) {
      const s = height * (1.4 + random() * 1.2);
      position.set((random() - 0.5) * width, height * (0.7 + random() * 0.9), (random() - 0.5) * depth);
      scale.set(s, s, 1);
      matrix.compose(position, quaternion, scale);
      smokeMesh.setMatrixAt(i, matrix);
      smokeSeeds[i] = random();
    }
    smokeMesh.geometry = materials.quad.clone();
    smokeMesh.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(smokeSeeds, 1));
    smokeMesh.frustumCulled = false;
    smokeMesh.renderOrder = 2;
    smokeMesh.userData.disposeGeometry = smokeMesh.geometry;
    group.add(smokeMesh);
  }

  if (light) {
    const anchor = new THREE.Object3D();
    anchor.position.y = height * 0.5;
    group.add(anchor);
    const phase = seed * 3.1;
    group.userData.emitter = {
      kind: "point",
      anchor,
      color: 0xff6a1c,
      base: 8,
      distance: 12 + width * 1.5,
      intensityAt: (time) => 5 + Math.sin(time * 11 + phase) * 1.6 + Math.sin(time * 23 + phase) * 0.9 + width * 0.8,
    };
  }

  return group;
}
