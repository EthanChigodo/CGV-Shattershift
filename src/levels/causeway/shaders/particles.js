/**
 * GPU-driven particles and debris. The CPU never touches a particle after it
 * is spawned: every system here writes its random seeds into vertex
 * attributes once, and the vertex shader computes each particle's position as
 * a closed-form function of time. That is why the level can throw hundreds of
 * glass shards and thousands of droplets without the frame rate moving.
 *
 *   createShardMaterial   fractured glass with rigid-body motion: ballistic
 *                         flight, Rodrigues-formula spin, and one analytic
 *                         floor bounce with restitution and friction.
 *   EmberSystem           sparks rising from the nearest six fires.
 *   WaterSystem           sprinkler spray under the nearest four open heads.
 *   SmokeSystem           ceiling smoke that is anchored in world space and
 *                         recycled around the player; its density comes from
 *                         the level's smoke field, so clearing a vent visibly
 *                         thins the smoke.
 *   createBurst           one-shot bursts: dust, steam, sparks, specimen fluid.
 */

import * as THREE from "../../../three.js";
import { NOISE_GLSL, FOG_FADE_GLSL, ROTATE_GLSL } from "./common.js";

/* ------------------------------------------------------------------ */
/* Glass shards                                                         */
/* ------------------------------------------------------------------ */

const shardVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${ROTATE_GLSL}
attribute vec3 aCentroid;
attribute vec3 aVelocity;
attribute vec4 aSpin;
uniform float uAge;
uniform float uGravity;
uniform float uFloor;
uniform float uFloorHalfWidth;
varying vec3 vNormalW;
varying vec3 vWorld;

void main() {
  float t = uAge;
  float g = uGravity;
  vec3 c = aCentroid;
  vec3 v = aVelocity;
  vec3 pos;
  float spinTime = t;

  // Time until this shard reaches the floor: solve c.y + v.y t - g t^2/2 = floor.
  float drop = max(c.y - uFloor, 0.0);
  float tHit = (v.y + sqrt(v.y * v.y + 2.0 * g * drop)) / g;
  vec3 landing = c + v * tHit - vec3(0.0, 0.5 * g * tHit * tHit, 0.0);
  bool overFloor = abs(landing.x) < uFloorHalfWidth;

  if (t < tHit || !overFloor) {
    pos = c + v * t - vec3(0.0, 0.5 * g * t * t, 0.0);
  } else {
    // One bounce: restitution 0.28 vertically, friction 0.35 horizontally.
    float t2 = t - tHit;
    vec3 vHit = vec3(v.x, v.y - g * tHit, v.z);
    vec3 vOut = vec3(vHit.x * 0.35, -vHit.y * 0.28, vHit.z * 0.35);
    pos = landing + vOut * t2 - vec3(0.0, 0.5 * g * t2 * t2, 0.0);
    pos.y = max(pos.y, uFloor + 0.02);
    // Spin decays once the shard is sliding on the floor.
    spinTime = tHit + (1.0 - exp(-t2 * 3.0)) * 0.3;
  }

  float angle = aSpin.w * spinTime;
  vec3 local = rotateAxis(position, aSpin.xyz, angle);
  vec4 world = vec4(pos + local, 1.0);
  vWorld = world.xyz;
  vNormalW = rotateAxis(normal, aSpin.xyz, angle);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const shardFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform samplerCube uEnv;
uniform float uAge;
uniform float uLife;
uniform vec3 uTint;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 V = normalize(vWorld - cameraPosition);
  if (dot(n, V) > 0.0) n = -n;
  float F = 0.04 + 0.96 * pow(1.0 - abs(dot(n, -V)), 5.0);
  vec3 env = texture(uEnv, reflect(V, n)).rgb;
  float fade = 1.0 - smoothstep(uLife - 0.8, uLife, uAge);
  vec3 colour = mix(uTint * 0.35, env * 1.2, F) + uTint * 0.25;
  gl_FragColor = vec4(colour, (0.35 + F * 0.65) * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createShardMaterial(shared, tint = 0xcff8ff, life = 3.2) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uEnv: shared.uEnv,
    uAge: { value: 0 },
    uLife: { value: life },
    uGravity: { value: 14 },
    uFloor: { value: 0 },
    uFloorHalfWidth: { value: 5.6 },
    uTint: { value: new THREE.Color(tint) },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: shardVertex,
    fragmentShader: shardFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = "CausewayShards";
  return material;
}

/**
 * Fracture a rectangular pane into radial shards around the impact point.
 *
 * Cells are formed by `spokes` jittered rays from the impact point crossed
 * with `rings` jittered circles. Each cell is a quad clamped to the pane's
 * rectangle, extruded to the pane thickness, and given its own velocity:
 * outward from the impact in the pane plane, plus along the projectile's
 * direction, strongest near the impact. That is how real tempered glass
 * behaves - small fast pieces at the centre, large slow ones at the edge.
 *
 * @param {THREE.Matrix4} matrixWorld  the pane's world matrix
 * @param {{width:number,height:number,depth:number}} size
 * @param {THREE.Vector2} impact  local impact point on the pane face
 * @param {THREE.Vector3} push    world direction of the projectile
 */
export function buildFractureGeometry(matrixWorld, size, impact, push, { spokes = 11, rings = 4, power = 1 } = {}) {
  const hw = size.width / 2;
  const hh = size.height / 2;
  const hd = size.depth / 2;
  const angles = [];
  const a0 = Math.random() * Math.PI * 2;
  for (let i = 0; i < spokes; i += 1) angles.push(a0 + ((i + (Math.random() - 0.5) * 0.6) / spokes) * Math.PI * 2);
  const maxR = Math.hypot(size.width, size.height) * 1.05;
  const radii = [0];
  for (let j = 1; j <= rings; j += 1) radii.push(Math.pow(j / rings, 1.6) * maxR * (0.85 + Math.random() * 0.3));
  radii[rings] = maxR;

  const clampPoint = (x, y) => [Math.max(-hw, Math.min(hw, x)), Math.max(-hh, Math.min(hh, y))];
  const positions = [];
  const normals = [];
  const centroids = [];
  const velocities = [];
  const spins = [];

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const linear = new THREE.Matrix3().setFromMatrix4(matrixWorld);
  const v3 = new THREE.Vector3();
  const n3 = new THREE.Vector3();
  const centroidW = new THREE.Vector3();

  for (let i = 0; i < spokes; i += 1) {
    const aA = angles[i];
    const aB = angles[(i + 1) % spokes] + (i === spokes - 1 ? Math.PI * 2 : 0);
    for (let j = 0; j < rings; j += 1) {
      const r0 = radii[j];
      const r1 = radii[j + 1];
      const quad = [
        clampPoint(impact.x + Math.cos(aA) * r0, impact.y + Math.sin(aA) * r0),
        clampPoint(impact.x + Math.cos(aA) * r1, impact.y + Math.sin(aA) * r1),
        clampPoint(impact.x + Math.cos(aB) * r1, impact.y + Math.sin(aB) * r1),
        clampPoint(impact.x + Math.cos(aB) * r0, impact.y + Math.sin(aB) * r0),
      ];
      // Skip cells that collapsed onto the pane border.
      const area = Math.abs(
        (quad[0][0] * quad[1][1] - quad[1][0] * quad[0][1]) + (quad[1][0] * quad[2][1] - quad[2][0] * quad[1][1]) +
        (quad[2][0] * quad[3][1] - quad[3][0] * quad[2][1]) + (quad[3][0] * quad[0][1] - quad[0][0] * quad[3][1])) / 2;
      if (area < 0.004) continue;

      const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
      const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
      centroidW.set(cx, cy, 0).applyMatrix4(matrixWorld);

      // Prism: front cap, back cap, four sides - built in local space
      // relative to the centroid, then rotated into world orientation.
      const front = quad.map(([x, y]) => [x - cx, y - cy, hd]);
      const back = quad.map(([x, y]) => [x - cx, y - cy, -hd]);
      const tris = [];
      const pushTri = (a, b, c, n) => tris.push([a, b, c, n]);
      pushTri(front[0], front[1], front[2], [0, 0, 1]);
      pushTri(front[0], front[2], front[3], [0, 0, 1]);
      pushTri(back[0], back[2], back[1], [0, 0, -1]);
      pushTri(back[0], back[3], back[2], [0, 0, -1]);
      for (let k = 0; k < 4; k += 1) {
        const k2 = (k + 1) % 4;
        const ex = front[k2][0] - front[k][0];
        const ey = front[k2][1] - front[k][1];
        const len = Math.hypot(ex, ey) || 1;
        const sn = [ey / len, -ex / len, 0];
        pushTri(front[k], back[k], back[k2], sn);
        pushTri(front[k], back[k2], front[k2], sn);
      }

      const dist = Math.hypot(cx - impact.x, cy - impact.y);
      const nearness = Math.exp(-dist * 1.3);
      const radial = new THREE.Vector3(cx - impact.x, cy - impact.y, 0).normalize().transformDirection(matrixWorld);
      const velocity = new THREE.Vector3()
        .addScaledVector(radial, (1.2 + nearness * 3.5) * power)
        .addScaledVector(push, (1.5 + nearness * 7.0) * power)
        .add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 2.2, (Math.random() - 0.5) * 1.2));
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const spin = (2 + Math.random() * 8) * (0.5 + nearness);

      for (const [a, b, c, n] of tris) {
        n3.set(n[0], n[1], n[2]).applyMatrix3(normalMatrix).normalize();
        for (const p of [a, b, c]) {
          // Rotate the local offset into world orientation (no translation).
          v3.set(p[0], p[1], p[2]).applyMatrix3(linear);
          positions.push(v3.x, v3.y, v3.z);
          normals.push(n3.x, n3.y, n3.z);
          centroids.push(centroidW.x, centroidW.y, centroidW.z);
          velocities.push(velocity.x, velocity.y, velocity.z);
          spins.push(axis.x, axis.y, axis.z, spin);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aCentroid", new THREE.Float32BufferAttribute(centroids, 3));
  geometry.setAttribute("aVelocity", new THREE.Float32BufferAttribute(velocities, 3));
  geometry.setAttribute("aSpin", new THREE.Float32BufferAttribute(spins, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3().setFromMatrixPosition(matrixWorld), 60);
  return geometry;
}

/**
 * Small tumbling chunks for anything that is not a flat pane (crystals,
 * tanks, the containment pod). Same physics shader, random tetrahedra.
 */
export function buildChunkGeometry(centre, count, { radius = 0.5, speed = 4, size = 0.12, push = null } = {}) {
  const base = new THREE.TetrahedronGeometry(1, 0).toNonIndexed();
  const bp = base.getAttribute("position");
  const bn = base.getAttribute("normal");
  const positions = [];
  const normals = [];
  const centroids = [];
  const velocities = [];
  const spins = [];
  for (let i = 0; i < count; i += 1) {
    const s = size * (0.5 + Math.random());
    const offset = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(radius);
    const c = centre.clone().add(offset);
    const vel = offset.clone().normalize().multiplyScalar(speed * (0.5 + Math.random()));
    vel.y += Math.random() * speed * 0.6;
    if (push) vel.addScaledVector(push, speed * 0.5);
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const spin = 3 + Math.random() * 9;
    for (let k = 0; k < bp.count; k += 1) {
      positions.push(bp.getX(k) * s, bp.getY(k) * s, bp.getZ(k) * s);
      normals.push(bn.getX(k), bn.getY(k), bn.getZ(k));
      centroids.push(c.x, c.y, c.z);
      velocities.push(vel.x, vel.y, vel.z);
      spins.push(axis.x, axis.y, axis.z, spin);
    }
  }
  base.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aCentroid", new THREE.Float32BufferAttribute(centroids, 3));
  geometry.setAttribute("aVelocity", new THREE.Float32BufferAttribute(velocities, 3));
  geometry.setAttribute("aSpin", new THREE.Float32BufferAttribute(spins, 4));
  geometry.boundingSphere = new THREE.Sphere(centre.clone(), 60);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Slot-driven point systems (embers, water)                            */
/* ------------------------------------------------------------------ */

function seededPoints(count, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i += 1) seeds[i] = r();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geometry;
}

const emberVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform vec4 uSlots[6];         // xyz = fire base (world), w = intensity
uniform vec4 uSize[6];          // xyz = fire size, w unused
uniform float uTime;
uniform float uScale;
varying float vLife;
varying float vHeat;
void main() {
  int slot = int(mod(float(gl_VertexID), 6.0));
  vec4 fire = uSlots[slot];
  vec3 size = uSize[slot].xyz;
  float life = fract(uTime * (0.3 + aSeed.x * 0.5) + aSeed.y);
  vec3 p = fire.xyz + vec3((aSeed.z - 0.5) * size.x, 0.2, (aSeed.w - 0.5) * size.z);
  p.y += life * size.y * 1.8;
  p.x += sin(life * 9.0 + aSeed.x * 20.0) * 0.4 * life;
  p.z += cos(life * 7.0 + aSeed.y * 20.0) * 0.4 * life;
  vLife = life;
  vHeat = fire.w;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = fire.w < 0.05 ? 0.0 : (1.0 - life) * uScale * (2.0 + aSeed.z * 3.0) / max(-mvPosition.z, 0.5);
  #include <fog_vertex>
}
`;

const emberFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
varying float vLife;
varying float vHeat;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d));
  vec3 c = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.2, 0.02), vLife) * 3.0;
  gl_FragColor = vec4(c * a * vHeat * fogFade(), 1.0);
}
`;

export class EmberSystem {
  constructor(time, { count = 360, scale = 26 } = {}) {
    this.slots = Array.from({ length: 6 }, () => new THREE.Vector4());
    this.sizes = Array.from({ length: 6 }, () => new THREE.Vector4(1, 1, 1, 0));
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uSlots: { value: this.slots },
      uSize: { value: this.sizes },
      uTime: time,
      uScale: { value: scale },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: emberVertex, fragmentShader: emberFragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    this.points = new THREE.Points(seededPoints(count, 19), this.material);
    this.points.name = "Embers";
    this.points.frustumCulled = false;
  }

  /** Bind the six nearest burning fires. `fires` are world-space records. */
  bind(fires) {
    for (let i = 0; i < 6; i += 1) {
      const f = fires[i];
      if (f) {
        this.slots[i].set(f.world.x, f.world.y, f.world.z, f.intensity);
        this.sizes[i].set(f.size.x, f.size.y, f.size.z, 0);
      } else this.slots[i].w = 0;
    }
  }

  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}

/**
 * Sprinkler water as velocity-aligned streaks.
 *
 * Droplets falling fast are seen as streaks, not dots - that is what makes a
 * sprinkler read as a shower. Each droplet is an instanced quad. The vertex
 * shader computes the droplet's position p(t) and velocity v(t) in closed
 * form, projects p and a "tail" point p - v * shutter into view space, and
 * builds the quad along the line between them: a motion-blurred streak that
 * always faces the camera.
 */
const waterVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform vec4 uSlots[6];         // xyz = sprinkler head (world), w = flow 0..1
uniform float uTime;
varying float vAlpha;
varying float vAcross;
void main() {
  int slot = gl_InstanceID - 6 * (gl_InstanceID / 6);
  vec4 head = uSlots[slot];
  float life = fract(uTime * (0.75 + aSeed.x * 0.5) + aSeed.y);
  float t = life * 1.15;
  float angle = aSeed.z * 6.28318;
  float spread = 0.8 + aSeed.w * 3.6;
  vec3 v0 = vec3(cos(angle) * spread, -0.6 - aSeed.x * 1.8, sin(angle) * spread);
  vec3 g = vec3(0.0, -9.8, 0.0);
  vec3 p = head.xyz + v0 * t + 0.5 * g * t * t;
  vec3 v = v0 + g * t;
  vec3 tail = p - v * 0.07;
  float below = step(p.y, 0.03);

  vec4 vp = viewMatrix * vec4(p, 1.0);
  vec4 vt = viewMatrix * vec4(tail, 1.0);
  vec2 dir = vp.xy - vt.xy;
  dir = length(dir) > 1e-5 ? normalize(dir) : vec2(0.0, 1.0);
  // (dir.y, -dir.x) keeps the quad's winding facing the camera; the other
  // perpendicular mirrors it and back-face culling would drop every droplet.
  vec2 perp = vec2(dir.y, -dir.x);
  vec4 mvPosition = mix(vt, vp, position.y + 0.5);
  mvPosition.xy += perp * position.x * 0.034;
  vAcross = position.x * 2.0;
  vAlpha = head.w * (1.0 - below) * smoothstep(0.0, 0.08, life);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const waterFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
uniform vec3 uLight;
varying float vAlpha;
varying float vAcross;
void main() {
  float a = (1.0 - abs(vAcross) * 0.7) * vAlpha * 0.6 * fogFade();
  if (a < 0.004) discard;
  gl_FragColor = vec4(uLight, a);
}
`;

export class WaterSystem {
  constructor(time, { count = 2400 } = {}) {
    this.slots = Array.from({ length: 6 }, () => new THREE.Vector4());
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute("position", plane.getAttribute("position"));
    let s = 41;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = r();
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, { uSlots: { value: this.slots }, uTime: time, uLight: { value: new THREE.Color(0.75, 0.82, 0.9) } });
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: waterVertex, fragmentShader: waterFragment,
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.points = new THREE.Mesh(geometry, this.material);
    this.points.name = "SprinklerWater";
    this.points.frustumCulled = false;
    this._plane = plane;
  }

  bind(heads) {
    for (let i = 0; i < 6; i += 1) {
      const h = heads[i];
      if (h) this.slots[i].set(h.world.x, h.world.y, h.world.z, h.flow);
      else this.slots[i].w = 0;
    }
  }

  dispose() { this.points.geometry.dispose(); this._plane.dispose(); this.material.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Soot columns above fires                                             */
/* ------------------------------------------------------------------ */

const sootVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform vec4 uSlots[6];         // fire base + intensity (same slots as embers)
uniform vec4 uSize[6];
uniform float uTime;
uniform float uCeiling;
varying vec2 vUv;
varying float vLife;
varying float vAlpha;
void main() {
  vUv = uv;
  int slot = gl_InstanceID - 6 * (gl_InstanceID / 6);
  vec4 fire = uSlots[slot];
  vec3 size = uSize[slot].xyz;
  float life = fract(uTime * (0.16 + aSeed.x * 0.08) + aSeed.y);
  vLife = life;
  vec3 c = fire.xyz + vec3((aSeed.z - 0.5) * size.x * 0.5, size.y * 0.8 + life * 6.0, (aSeed.w - 0.5) * size.z * 0.5);
  // Smoke meets the ceiling and spreads along it.
  float over = max(0.0, c.y - (uCeiling - 0.4));
  c.y = min(c.y, uCeiling - 0.4);
  c.x += (aSeed.z - 0.5) * over * 1.6;
  c.z += (aSeed.w - 0.5) * over * 1.6;
  c.x += sin(uTime * 0.7 + aSeed.x * 20.0) * life * 0.6;
  float s = (0.9 + life * 3.2 + over * 0.6) * (0.7 + aSeed.w * 0.6);
  vAlpha = fire.w * smoothstep(0.0, 0.12, life) * (1.0 - life);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = c + (right * position.x + up * position.y) * s;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const sootFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
${FOG_FADE_GLSL}
uniform float uTime;
varying vec2 vUv;
varying float vLife;
varying float vAlpha;
void main() {
  float r = length(vUv - 0.5);
  float n = fbm2((vUv * 2.0 + vec2(vLife * 3.0, uTime * 0.04)) * 3.0);
  float a = smoothstep(0.5, 0.08, r) * smoothstep(0.2, 0.7, n) * vAlpha * 0.75 * fogFade();
  if (a < 0.004) discard;
  // Lit orange by the flames at the base, black soot above.
  vec3 colour = mix(vec3(0.55, 0.2, 0.05), vec3(0.025, 0.022, 0.02), smoothstep(0.0, 0.25, vLife));
  gl_FragColor = vec4(colour, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SootSystem {
  constructor(noise, ember, time, { count = 180 } = {}) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute("position", plane.getAttribute("position"));
    geometry.setAttribute("uv", plane.getAttribute("uv"));
    let s = 5;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = r();
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    // Shares the ember system's fire slots, so both follow the same fires.
    Object.assign(uniforms, {
      uNoise: { value: noise },
      uSlots: { value: ember.slots },
      uSize: { value: ember.sizes },
      uTime: time,
      uCeiling: { value: 5.2 },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: sootVertex, fragmentShader: sootFragment,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "FireSoot";
    this.mesh.frustumCulled = false;
    this._plane = plane;
  }

  dispose() { this.mesh.geometry.dispose(); this._plane.dispose(); this.material.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Vent suction                                                         */
/* ------------------------------------------------------------------ */

/**
 * Smoke being pulled into a broken vent. Each puff starts on a disc about
 * 3 m out in front of the vent and spirals in along the vent's normal,
 * speeding up (t^1.6) and shrinking as it goes, so the player can see the
 * vent is working. Slots are the four nearest venting vents.
 */
const ventVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform vec4 uVents[4];         // xyz = vent mouth (world), w = strength
uniform vec4 uNormals[4];       // xyz = outward normal (world)
uniform float uTime;
uniform float uScale;
varying float vAlpha;
void main() {
  int slot = int(mod(float(gl_VertexID), 4.0));
  vec4 vent = uVents[slot];
  vec3 n = normalize(uNormals[slot].xyz);
  vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
  vec3 t2 = cross(n, t1);
  float life = fract(uTime * (0.35 + aSeed.x * 0.25) + aSeed.y);
  float k = pow(life, 1.6);
  float angle = aSeed.z * 6.28318 + life * 5.0;
  float radius = (0.5 + aSeed.w * 1.3) * (1.0 - k);
  vec3 p = vent.xyz + n * (3.2 * (1.0 - k)) + (t1 * cos(angle) + t2 * sin(angle)) * radius;
  vAlpha = vent.w * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.85, 1.0, life));
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = vent.w < 0.02 ? 0.0 : uScale * (1.2 - k * 0.8) * (0.6 + aSeed.w) / max(-mvPosition.z, 0.5);
  #include <fog_vertex>
}
`;

const ventFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
varying float vAlpha;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vAlpha * 0.45 * fogFade();
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.42, 0.44, 0.46), a);
}
`;

export class VentFlowSystem {
  constructor(time, { count = 320, scale = 260 } = {}) {
    this.vents = Array.from({ length: 4 }, () => new THREE.Vector4());
    this.normals = Array.from({ length: 4 }, () => new THREE.Vector4(1, 0, 0, 0));
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uVents: { value: this.vents },
      uNormals: { value: this.normals },
      uTime: time,
      uScale: { value: scale },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: ventVertex, fragmentShader: ventFragment,
      transparent: true, depthWrite: false, fog: true,
    });
    this.points = new THREE.Points(seededPoints(count, 63), this.material);
    this.points.name = "VentSuction";
    this.points.frustumCulled = false;
  }

  /** @param {{world:THREE.Vector3, normal:THREE.Vector3, strength:number}[]} vents */
  bind(vents) {
    for (let i = 0; i < 4; i += 1) {
      const v = vents[i];
      if (v) {
        this.vents[i].set(v.world.x, v.world.y, v.world.z, v.strength);
        this.normals[i].set(v.normal.x, v.normal.y, v.normal.z, 0);
      } else this.vents[i].w = 0;
    }
  }

  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Ceiling smoke                                                        */
/* ------------------------------------------------------------------ */

const smokeVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float uAnchorZ;        // world z of the player
uniform float uProfile[16];    // smoke density every 10 m, from 20 m behind
uniform float uTime;
uniform float uCeiling;
uniform float uWindow;
varying vec2 vUv;
varying float vDensity;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed.x;
  // Anchor each puff in world space, then wrap it into a window around the
  // player: puffs stay put while you run past them, and are recycled ahead.
  float start = uAnchorZ + 20.0;
  float z = start - mod(start - (-aSeed.x * 4000.0), uWindow);
  float ahead = start - z;                         // metres from the back of the window
  float fi = clamp(ahead / 10.0, 0.0, 14.99);
  int i0 = int(floor(fi));
  float density = mix(uProfile[i0], uProfile[i0 + 1], fract(fi));
  vDensity = density;

  float drift = sin(uTime * 0.2 + aSeed.y * 30.0) * 0.8;
  vec3 centre = vec3((aSeed.y - 0.5) * 11.0 + drift, uCeiling - 0.6 - aSeed.z * (1.2 + density * 2.8), z);
  float size = (2.6 + aSeed.w * 3.4) * (0.6 + density);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = centre + (right * position.x + up * position.y) * size;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const smokeFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
${FOG_FADE_GLSL}
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying float vDensity;
varying float vSeed;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d);
  // Low-frequency fbm (a few lattice cells per puff) so the smoke reads as
  // soft billows rather than blocky texels.
  float n = fbm2((vUv * 2.5 + vec2(vSeed * 41.0, uTime * 0.05)) * 3.0);
  float a = smoothstep(0.5, 0.05, r) * smoothstep(0.15, 0.75, n) * vDensity * 0.55;
  // Smoke is not fogged toward the bright sky haze; it just thins with distance.
  a *= fogFade();
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * (0.75 + n * 0.5), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SmokeSystem {
  constructor(noise, time, { count = 90 } = {}) {
    this.profile = new Array(16).fill(0);
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute("position", plane.getAttribute("position"));
    geometry.setAttribute("uv", plane.getAttribute("uv"));
    let s = 77;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = r();
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uNoise: { value: noise },
      uAnchorZ: { value: 0 },
      uProfile: { value: this.profile },
      uTime: time,
      uCeiling: { value: 5.2 },
      uWindow: { value: 160 },
      uColor: { value: new THREE.Color(0.2, 0.19, 0.19) },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: smokeVertex, fragmentShader: smokeFragment,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "CeilingSmoke";
    this.mesh.frustumCulled = false;
    this._plane = plane;
  }

  dispose() { this.mesh.geometry.dispose(); this._plane.dispose(); this.material.dispose(); }
}

/* ------------------------------------------------------------------ */
/* One-shot bursts                                                      */
/* ------------------------------------------------------------------ */

const burstVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform vec3 uOrigin;
uniform float uAge;
uniform float uSpeed;
uniform float uGravity;
uniform float uSpread;
uniform float uScale;
uniform float uLife;
uniform float uRise;
varying float vFade;
void main() {
  float theta = aSeed.x * 6.28318;
  float phi = acos(2.0 * aSeed.y - 1.0);
  vec3 dir = vec3(sin(phi) * cos(theta), abs(cos(phi)) * uRise + cos(phi) * (1.0 - uRise), sin(phi) * sin(theta));
  float speed = uSpeed * (0.3 + aSeed.z);
  float t = uAge;
  float drag = (1.0 - exp(-t * 2.2)) / 2.2;     // velocity decays: closed-form drag
  vec3 p = uOrigin + dir * speed * drag * uSpread - vec3(0.0, 0.5 * uGravity * t * t, 0.0);
  p.y = max(p.y, 0.02);
  vFade = 1.0 - clamp(t / (uLife * (0.6 + aSeed.w * 0.4)), 0.0, 1.0);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uScale * (0.5 + aSeed.w) * (0.4 + (1.0 - vFade) * 0.9) / max(-mvPosition.z, 0.5);
  #include <fog_vertex>
}
`;

const burstFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
uniform vec3 uColor;
uniform float uAdditive;
varying float vFade;
void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vFade;
  if (a < 0.01) discard;
  if (uAdditive > 0.5) gl_FragColor = vec4(uColor * a * fogFade(), 1.0);
  else gl_FragColor = vec4(uColor, a * 0.55 * fogFade());
}
`;

export const BURSTS = {
  dust: { color: 0x9a9088, count: 90, speed: 3.2, gravity: 0.6, spread: 1.4, scale: 520, life: 2.6, rise: 0.4, additive: false },
  steam: { color: 0xe6eef2, count: 70, speed: 2.2, gravity: -1.2, spread: 1.2, scale: 700, life: 2.2, rise: 0.9, additive: false },
  sparks: { color: 0xffb347, count: 80, speed: 9, gravity: 9, spread: 1, scale: 70, life: 1.1, rise: 0.3, additive: true },
  fluid: { color: 0x7dff9a, count: 70, speed: 5, gravity: 9, spread: 1, scale: 140, life: 1.3, rise: 0.5, additive: true },
  cryo: { color: 0x9ff4ff, count: 110, speed: 6, gravity: 2, spread: 1.2, scale: 160, life: 1.6, rise: 0.2, additive: true },
  shock: { color: 0xd28bff, count: 120, speed: 11, gravity: 0, spread: 1, scale: 120, life: 0.9, rise: 0, additive: true },
  score: { color: 0x7ef4f1, count: 40, speed: 3, gravity: -2, spread: 1, scale: 90, life: 1.4, rise: 1, additive: true },
  fireball: { color: 0xff7a2a, count: 140, speed: 12, gravity: 1, spread: 1.4, scale: 900, life: 1.6, rise: 0.5, additive: true },
};

export function createBurst(kind, origin, overrides = {}) {
  const def = { ...BURSTS[kind], ...overrides };
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uOrigin: { value: origin.clone() },
    uAge: { value: 0 },
    uSpeed: { value: def.speed },
    uGravity: { value: def.gravity },
    uSpread: { value: def.spread },
    uScale: { value: def.scale },
    uLife: { value: def.life },
    uRise: { value: def.rise },
    uColor: { value: new THREE.Color(def.color) },
    uAdditive: { value: def.additive ? 1 : 0 },
  });
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: burstVertex, fragmentShader: burstFragment,
    transparent: true, depthWrite: false, fog: true,
    blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(seededPoints(def.count, Math.floor(Math.random() * 1e6) + 1), material);
  points.frustumCulled = false;
  points.userData.life = def.life;
  return points;
}
