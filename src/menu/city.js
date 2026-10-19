/**
 * The city around the menu's roof, at 3 a.m.
 *
 *  - Blocks: ~1,500 towers on a street grid, one instanced draw. Their
 *    shader maps windows in world space (so a 200 m tower has 200 m of
 *    windows), lights a sparse few warm or cool, puts lit crowns on some,
 *    and fades the window grid to its average where a window is smaller
 *    than a pixel (no shimmering moire on the far ones).
 *  - Streets: one plane 96 m below, a shader drawing the grid - sodium
 *    lamps, traffic both ways - sinking into the haze.
 *  - The supplied city model (assets/meltdown/city_night.glb), placed as a
 *    downtown cluster round the burning tower, its windows glowing.
 *  - Aircraft beacons on the tallest roofs, blinking together.
 *  - Two thin fog sheets between the streets and the roofs, lit from below,
 *    so the street light blooms through them.
 *
 * Every material ends in the stage's haze (atmosphere.js).
 */

import * as THREE from "../three.js";
import { HAZE_GLSL, hazeMaterial } from "./atmosphere.js";

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export const STREET_Y = -96;
const BLOCK = 80;
const STREET = 14;

const BLOCKS_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHash;
  varying float vTop;
  varying float vBase;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 w = m * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(m) * normal);
    vHash = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    vTop = (m * vec4(0.0, 1.0, 0.0, 1.0)).y;
    vBase = (m * vec4(0.0, 0.0, 0.0, 1.0)).y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BLOCKS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHash;
  varying float vTop;
  varying float vBase;
  ${HAZE_GLSL}
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 col;
    if (abs(N.y) > 0.5) {
      // Roofs: dark, a little plant on them catching the glow.
      col = vec3(0.012, 0.012, 0.014);
    } else {
      vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
      float u = dot(vWorld, T);
      // Three kinds of facade: office grid, glass bands, residential.
      float kind = floor(vHash * 3.0);
      vec2 size = kind < 1.0 ? vec2(1.9, 3.7) : kind < 2.0 ? vec2(1.5, 3.9) : vec2(2.6, 3.1);
      vec2 g = vec2(u / size.x, (vWorld.y - vBase) / size.y);
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float h = hash12(cell + vHash * 131.0);
      float floorLit = step(0.93, hash12(vec2(cell.y, vHash * 71.0)));
      float density = kind < 1.0 ? 0.13 : kind < 2.0 ? 0.09 : 0.22;
      float lit = max(step(1.0 - density, h), floorLit * step(0.15, h));
      vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.82, 0.55), hash12(cell * 1.3));
      vec3 cool = vec3(0.55, 0.75, 1.0);
      // Most lit windows are curtained or lit from deep inside: dim, a few bright.
      float level = 0.12 + 0.55 * pow(hash12(cell * 3.1), 2.2);
      vec3 light = mix(warm, cool, step(kind < 2.0 ? 0.7 : 0.92, hash12(cell * 2.7))) * level;
      float pane = step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.84);
      vec3 win = light * lit * pane;
      // Average it out where the windows are smaller than the pixels.
      vec2 fw = fwidth(g);
      float far = smoothstep(0.25, 0.7, max(fw.x, fw.y));
      vec3 average = mix(warm, cool, 0.25) * (density + floorLit * 0.06) * 0.35 * 0.28;
      win = mix(win, average, far);
      vec3 wall = vec3(0.012, 0.013, 0.016) + vec3(0.015, 0.012, 0.01) * smoothstep(60.0, 0.0, vWorld.y - vBase);
      col = wall + win;
      // A lit crown on some of the tall ones.
      float crown = step(0.86, fract(vHash * 7.13)) * step(vTop - vWorld.y, 1.6) * step(0.5, fract(u * 0.5));
      col += mix(vec3(1.0, 0.85, 0.6), vec3(0.6, 0.85, 1.0), step(0.5, fract(vHash * 3.7))) * crown * 0.22;
    }
    gl_FragColor = vec4(applyHaze(col, vWorld), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STREETS_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const STREETS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  ${HAZE_GLSL}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  vec3 street(float across, float along, float w, float period, float speed, float lane) {
    float road = 1.0 - smoothstep(w * 0.5, w * 0.5 + 2.0, abs(across));
    vec3 c = vec3(1.0, 0.5, 0.16) * road * 0.12;
    float lamps = (1.0 - smoothstep(0.0, 1.6, abs(mod(along, 26.0) - 13.0))) * (1.0 - smoothstep(0.0, 2.6, abs(abs(across) - w * 0.5)));
    c += vec3(1.0, 0.62, 0.28) * lamps * 1.1;
    float a = along + uTime * speed;
    float carA = step(0.6, hash(vec2(floor(a / period), lane))) * (1.0 - smoothstep(0.0, 2.2, abs(mod(a, period) - period * 0.5)));
    float b = along - uTime * speed * 0.8;
    float carB = step(0.6, hash(vec2(floor(b / period), lane + 7.0))) * (1.0 - smoothstep(0.0, 2.2, abs(mod(b, period) - period * 0.5)));
    float sideA = 1.0 - smoothstep(0.5, 1.5, abs(across - w * 0.22));
    float sideB = 1.0 - smoothstep(0.5, 1.5, abs(across + w * 0.22));
    c += vec3(1.0, 0.92, 0.75) * carA * sideA * 1.4 + vec3(1.0, 0.1, 0.05) * carB * sideB * 1.1;
    return c;
  }
  void main() {
    vec2 p = vWorld.xz;
    vec2 cell = p / ${BLOCK.toFixed(1)};
    vec2 local = (fract(cell) - 0.5) * ${BLOCK.toFixed(1)};
    vec2 id = floor(cell);
    // Streets run along the block edges (local = +-40 m from the centre).
    float ax = ${(BLOCK / 2).toFixed(1)} - abs(local.y);
    float az = ${(BLOCK / 2).toFixed(1)} - abs(local.x);
    bool avenueX = mod(id.y, 4.0) < 0.5;
    bool avenueZ = mod(id.x, 3.0) < 0.5;
    vec3 col = vec3(0.0);
    col += street(ax, p.x, avenueX ? 20.0 : 12.0, avenueX ? 24.0 : 38.0, avenueX ? 13.0 : 7.0, id.y);
    col += street(az, p.y, avenueZ ? 20.0 : 12.0, avenueZ ? 24.0 : 38.0, avenueZ ? 13.0 : 7.0, id.x + 50.0);
    col += vec3(1.0, 0.75, 0.45) * step(0.992, hash(floor(p / 5.0))) * 0.35;
    // Further out the city keeps glowing (the haze takes the detail).
    float d = length(vWorld - cameraPosition);
    col = mix(col, vec3(0.32, 0.17, 0.07) * 0.5, smoothstep(600.0, 2600.0, d));
    gl_FragColor = vec4(applyHaze(col, vWorld), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FOG_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uNoise;
  uniform float uDensity;
  uniform vec3 uCentre;
  varying vec3 vWorld;
  ${HAZE_GLSL}
  void main() {
    vec2 p = vWorld.xz * 0.0011 + vec2(uTime * 0.0016, uTime * 0.0007);
    float n = texture2D(uNoise, p).r * 0.6 + texture2D(uNoise, p * 3.1 + 0.4).a * 0.4;
    float a = smoothstep(0.38, 0.85, n) * uDensity;
    // Thin it where it is seen edge-on far away (the haze has that), and
    // round the camera (so you never see the sheet itself up close).
    float d = length(vWorld.xz - uCentre.xz);
    a *= smoothstep(120.0, 420.0, d) * (1.0 - smoothstep(2200.0, 3200.0, d));
    vec3 c = uHazeLow * 2.6 + uFireGlow * 0.12 * exp(-length(vWorld - uFirePos) / 400.0);
    c = applyHaze(c, vWorld);
    gl_FragColor = vec4(c * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class MenuCity {
  /**
   * @param {object} o
   * @param {object} o.haze
   * @param {THREE.Texture} o.noise
   * @param {THREE.Vector3} o.towerAt   the burning tower (kept clear)
   * @param {THREE.Box3} o.roof         our own building's footprint (kept clear)
   * @param {THREE.Vector3} o.eye       where the roof is (density falls off from here)
   * @param {number[][]} [o.buildings]   extra blocks [x, base y, z, width, height, depth]
   */
  constructor({ haze, noise, towerAt, roof, eye, quality = "medium", buildings = [] }) {
    this.root = new THREE.Group();
    this.root.name = "MenuCity";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    this.haze = haze;
    const r = rng(53);
    const q = { low: 0, medium: 1, high: 2 }[quality] ?? 1;

    // ---- Blocks on the grid ----
    const pieces = [];
    const beacons = [];
    const reach = [1600, 2400, 2800][q];
    const n = Math.ceil(reach / BLOCK);
    const clearTower = 70;
    for (let bz = -n; bz <= n; bz += 1) {
      for (let bx = -n; bx <= n; bx += 1) {
        const cx = bx * BLOCK + BLOCK / 2;
        const cz = bz * BLOCK + BLOCK / 2;
        const dx = cx - eye.x;
        const dz = cz - eye.z;
        const d = Math.hypot(dx, dz);
        if (d > reach) continue;
        // Behind the camera matters less (it's only seen in the appearance
        // and wide shots): thinner there.
        const behind = dz > 60;
        const keep = d < 500 ? 1 : d < 1200 ? 0.8 : 0.55;
        if (r() > keep * (behind ? 0.85 : 1)) continue;
        // Downtown: a cluster of tall ones behind and right of the tower.
        const downtown = Math.exp(-((cx - towerAt.x - 260) ** 2 + (cz - towerAt.z + 260) ** 2) / (2 * 380 ** 2));
        // The left of the shot stays low and calm (the menu text sits there).
        const leftCalm = cx < eye.x - 150 && cz < eye.z - 100 && cz > eye.z - 900 ? 0.45 : 1;
        const parts = d < 700 ? 1 + Math.floor(r() * 3) : 1;
        for (let k = 0; k < parts; k += 1) {
          const inner = BLOCK - STREET - 4;
          const w = parts === 1 ? inner * (0.55 + r() * 0.4) : inner * (0.3 + r() * 0.2);
          const depth = parts === 1 ? inner * (0.55 + r() * 0.4) : inner * (0.3 + r() * 0.25);
          const ox = parts === 1 ? (r() - 0.5) * (inner - w) : (k - (parts - 1) / 2) * (inner / parts) + (r() - 0.5) * 4;
          const oz = (r() - 0.5) * (inner - depth);
          const x = cx + ox;
          const z = cz + oz;
          // Keep the burning tower's plaza and our own roof clear.
          if (Math.hypot(x - towerAt.x, z - towerAt.z) < clearTower + Math.max(w, depth) / 2) continue;
          if (roof && x + w / 2 > roof.min.x - 6 && x - w / 2 < roof.max.x + 6 && z + depth / 2 > roof.min.z - 6 && z - depth / 2 < roof.max.z + 6) continue;
          // Mostly well below our roof (96 m up); further out a few reach
          // past it, and downtown (far, behind and right of the tower) rises.
          let height = 18 + r() * 42;
          if (r() < 0.14) height += 20 + r() * 45;
          if (d > 450 && r() < 0.12) height += 40 + r() * 70;
          height += downtown * (40 + r() * 170) * THREE.MathUtils.smoothstep(d, 500, 1100);
          height *= leftCalm;
          if (d < 300) height = Math.min(height, 72 + r() * 12); // neighbours stay below our roof
          const base = STREET_Y - 40;
          pieces.push([x, base, z, w, height + 40, depth]);
          // A setback tier on some.
          if (height > 90 && r() < 0.5) {
            const h2 = 12 + r() * 40;
            pieces.push([x, STREET_Y + height, z, w * 0.7, h2, depth * 0.7]);
            height += h2;
          }
          if (height > 110 && r() < 0.6) beacons.push(new THREE.Vector3(x + (r() - 0.5) * w * 0.4, STREET_Y + height + 3, z + (r() - 0.5) * depth * 0.4));
        }
      }
    }
    // Buildings the stage places itself (the one under our roof): [x, base, z, w, h, d].
    pieces.push(...buildings);
    const unit = own(new THREE.BoxGeometry(1, 1, 1));
    unit.translate(0, 0.5, 0);
    this.blockUniforms = { ...haze, uTime: { value: 0 } };
    const blockMat = own(new THREE.ShaderMaterial({ uniforms: this.blockUniforms, vertexShader: BLOCKS_VERTEX, fragmentShader: BLOCKS_FRAGMENT }));
    const blocks = new THREE.InstancedMesh(unit, blockMat, pieces.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const qn = new THREE.Quaternion();
    pieces.forEach(([x, y, z, sx, sy, sz], i) => {
      m.compose(p.set(x, y, z), qn, s.set(sx, sy, sz));
      blocks.setMatrixAt(i, m);
    });
    blocks.frustumCulled = false;
    blocks.name = "CityBlocks";
    this.root.add(blocks);
    this.blockCount = pieces.length;

    // ---- Streets ----
    this.streetUniforms = { ...haze, uTime: { value: 0 } };
    const streets = new THREE.Mesh(own(new THREE.PlaneGeometry(7000, 7000)), own(new THREE.ShaderMaterial({ uniforms: this.streetUniforms, vertexShader: STREETS_VERTEX, fragmentShader: STREETS_FRAGMENT })));
    streets.rotation.x = -Math.PI / 2;
    streets.position.set(eye.x, STREET_Y, eye.z);
    streets.name = "Streets";
    this.root.add(streets);

    // ---- Beacons ----
    const bGeo = own(new THREE.BufferGeometry().setFromPoints(beacons));
    this.beaconMat = own(new THREE.ShaderMaterial({
      uniforms: { uOn: { value: 1 }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        varying float vK;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float px = 2.2 * uScale / max(1.0, -mv.z);
          gl_PointSize = clamp(px, 2.0, 9.0);
          vK = min(1.0, px / 2.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOn;
        varying float vK;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r = dot(q, q);
          if (r > 1.0) discard;
          gl_FragColor = vec4(vec3(4.0, 0.35, 0.2) * exp(-r * 3.0) * uOn * vK, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const beaconPoints = new THREE.Points(bGeo, this.beaconMat);
    beaconPoints.frustumCulled = false;
    this.root.add(beaconPoints);

    // ---- Fog sheets between the streets and the roofs ----
    this.fogUniforms = { ...haze, uTime: { value: 0 }, uNoise: { value: noise }, uDensity: { value: 0.42 }, uCentre: { value: eye.clone() } };
    const fogMat = own(new THREE.ShaderMaterial({
      uniforms: this.fogUniforms,
      vertexShader: STREETS_VERTEX,
      fragmentShader: FOG_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    const fogGeo = own(new THREE.PlaneGeometry(7000, 7000));
    for (const y of q === 0 ? [-62] : [-70, -38]) {
      const sheet = new THREE.Mesh(fogGeo, fogMat);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(eye.x, y, eye.z);
      sheet.renderOrder = 2;
      this.root.add(sheet);
    }

    this.towerAt = towerAt.clone();
    this.model = null;
  }

  /** The supplied city model (a GLTF scene), as a downtown cluster. */
  addModel(scene, placements) {
    const own = (x) => (this.owned.push(x), x);
    // Its sky dome and ground sheet go; its windows glow; its materials take the haze.
    let windowsMap = null;
    scene.traverse((o) => {
      if (o.isMesh && o.material?.name === "Material.001") windowsMap = o.material.map;
    });
    const materials = new Map();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (/Sphere|^Plane/.test(o.name)) {
        o.visible = false;
        return;
      }
      if (!materials.has(o.material)) {
        const m = own(o.material.clone());
        if (m.name === "Material.005" && windowsMap) m.map = windowsMap;
        if ("emissive" in m) {
          m.emissiveMap = m.map;
          m.emissive = new THREE.Color(1, 0.9, 0.8);
          m.emissiveIntensity = 0.42;
        }
        if (m.color) m.color.multiplyScalar(0.35);
        m.envMapIntensity = 0.25;
        hazeMaterial(m, this.haze, "City");
        materials.set(o.material, m);
      }
      o.material = materials.get(o.material);
    });
    for (const { position, rotation = 0, scale = 26 } of placements) {
      const copy = scene.clone(true);
      copy.scale.setScalar(scale);
      copy.position.copy(position);
      copy.rotation.y = rotation;
      this.root.add(copy);
    }
    this.model = scene;
  }

  update(dt, time, pixelScale) {
    this.streetUniforms.uTime.value = time;
    this.fogUniforms.uTime.value = time;
    this.beaconMat.uniforms.uOn.value = Math.sin(time * 2.2) > 0.2 ? 1 : 0.05;
    this.beaconMat.uniforms.uScale.value = pixelScale;
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
