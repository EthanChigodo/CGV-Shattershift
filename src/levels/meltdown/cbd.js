/**
 * The old downtown right round the roof: the buildings the roof camera
 * sees all fight, in place of the generic dark towers with lit windows -
 * several sets of them (CBD_SETS), each building optional in a set.
 *
 *   Art Deco tower    pale sandstone, pilasters and chevron spandrels,
 *                     stepped crowns floodlit from their setbacks, a spire
 *   Tower flats       painted concrete, real balconies, washing out,
 *                     curtains in every colour, dishes, a shack on the roof
 *   Red-brick block   brick with white stone trim and sash windows, a
 *                     painted billboard on the roof
 *   Civic building    on the street by the bridge: sandstone, a colonnade,
 *                     arched windows, a clock tower (telling the real time)
 *                     under a green copper dome, palms along the front
 *
 * "Inspired by" the city's architecture, not copies of particular
 * buildings; the billboard's company is made up. Lit the way the old CBD is
 * at night: warm floodlights washing the stone up from the street and from
 * each setback, rather than a dark box of lit windows.
 *
 * One shader, in six modes, draws every facade. Facade patterns are laid
 * out in each building's own frame (uToBuilding), so they stay put however
 * the building is turned.
 *
 *   const cbd = new CbdBuildings({ streetY: -160 });
 *   scene.add(cbd.root);
 *   new CityAtNight({ ..., clear: cbd.footprints });
 *   cbd.update(dt, time);
 *   cbd.dispose();
 */

import * as THREE from "../../three.js";
import { BufferGeometryUtils } from "../../three-addons.js";
import { ROOMS_GLSL } from "./rooms.js";

/** Where they stand, from the tower you're on (x east, -z north), metres; yaw in radians. */
export const CBD = {
  deco: { x: 36, z: -28, yaw: 0 },
  flats: { x: -40, z: -48, yaw: 0.69 },   // its balconies face the roof
  brick: { x: -8, z: -66, yaw: 0.1 },
  civic: { x: -60, z: 35, yaw: Math.PI / 2 }, // its front faces east, to the tower
};

/**
 * More of them, further out (round the towers that come down, roof.js
 * COLLAPSES / CONDEMNED): the roof's own view and the Skyline's backdrop.
 */
export const CBD_SETS = [
  CBD,
  { deco: { x: 70, z: -112, yaw: 0.4 }, flats: { x: 96, z: -40, yaw: -0.6 }, brick: { x: 42, z: -140, yaw: 0.25 }, civic: { x: -118, z: -62, yaw: 0.9 } },
  { deco: { x: -112, z: 10, yaw: -0.3 }, flats: { x: 12, z: -205, yaw: 0.1 }, brick: { x: 112, z: 22, yaw: 1.2 } },
];

/** A building's meshes merged into one per material (in the group's frame). */
function mergeByMaterial(group, own) {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMaterial = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    const mode = o.material.uniforms?.uMode?.value;
    if (mode === MODE.clock || mode === MODE.copper) return;
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(o);
  });
  const m = new THREE.Matrix4();
  for (const [material, meshes] of byMaterial) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((mesh) => {
      const g = mesh.geometry.clone().applyMatrix4(m.multiplyMatrices(inverse, mesh.matrixWorld));
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      for (const name of Object.keys(flat.attributes)) if (!["position", "normal", "uv"].includes(name)) flat.deleteAttribute(name);
      return flat;
    });
    const merged = BufferGeometryUtils.mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(own(merged), material);
    group.add(mesh);
    for (const old of meshes) old.removeFromParent();
  }
}

/** A made-up company for the painted billboard. */
export const BILLBOARD = ["ASCENSION MILLING CO.", "FLOUR SINCE 1936"];

const MODE = { deco: 0, civic: 1, flats: 2, brick: 3, copper: 4, clock: 5 };

const VERTEX = /* glsl */ `
  uniform mat4 uToBuilding;
  varying vec3 vB;          // position in the building's frame (base at y = 0)
  varying vec3 vBN;         // normal in the building's frame
  varying vec3 vLocal;
  varying float vDepth;
  void main() {
    vLocal = position;
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif
    vec4 w = m * vec4(position, 1.0);
    vB = (uToBuilding * w).xyz;
    vBN = normalize(mat3(uToBuilding) * mat3(m) * normal);
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform int uMode;
  uniform vec3 uColour;
  uniform vec3 uTrim;
  uniform vec3 uGlass;
  uniform float uFloorH;
  uniform float uBayW;
  uniform float uLit;
  uniform vec3 uTiers;       // setbacks with floodlights on them (metres up)
  uniform float uFlood;      // the street floodlights' strength
  uniform float uPower;      // the grid (load-shedding.js): 0 off .. 1 on
  uniform mat4 uToBuilding;
  uniform float uSeed;
  uniform float uHour;
  uniform float uMinute;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec3 vB;
  varying vec3 vBN;
  varying vec3 vLocal;
  varying float vDepth;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  ${ROOMS_GLSL}
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  // Moon from above one side, the burning city's glow from below.
  vec3 ambient(vec3 n) {
    vec3 moon = vec3(0.6, 0.68, 0.84) * max(dot(n, normalize(vec3(-0.45, 0.8, -0.3))), 0.0) * 0.45;
    vec3 city = vec3(0.9, 0.45, 0.2) * (0.25 + 0.5 * max(-n.y, 0.0) + 0.2 * (1.0 - abs(n.y)));
    return moon + city * 0.35 + vec3(0.05, 0.055, 0.07);
  }
  // Warm floodlight up the walls: from the street, and from every setback.
  float flood(float h) {
    float w = uFlood * exp(-h / 45.0);
    for (int i = 0; i < 3; i++) {
      float t = uTiers[i];
      if (t > 0.0) w += step(t, h) * exp(-(h - t) / 9.0) * 0.9;
    }
    return w;
  }
  const vec3 SODIUM = vec3(1.0, 0.7, 0.4);

  void main() {
    vec3 n = normalize(vBN);
    float h = vB.y;
    vec3 albedo = uColour;
    vec3 glow = vec3(0.0);
    bool wall = abs(n.y) < 0.5;
    float along = abs(n.x) > 0.5 ? vB.z : vB.x;
    vec2 cell = vec2(along / uBayW, h / uFloorH);
    vec2 id = floor(cell) + vec2(uSeed * 31.0, 0.0);
    vec2 f = fract(cell);
    float r = hash(id);
    float lit = step(1.0 - uLit, r) * step(0.15, hash(vec2(id.y, uSeed)));
    float win = 0.0;

    if (uMode == ${MODE.clock}) {
      // A clock face: ticks, and hands at the real time.
      vec2 p = vLocal.xy / 2.6;
      float d = length(p);
      float a = atan(p.x, p.y);
      float ticks = step(0.82, d) * step(d, 0.95) * step(0.9, cos(a * 12.0));
      float ha = (uHour + uMinute / 60.0) / 12.0 * 6.2831853;
      float ma = uMinute / 60.0 * 6.2831853;
      vec2 hd = vec2(sin(ha), cos(ha)), md = vec2(sin(ma), cos(ma));
      float hourHand = step(abs(dot(p, vec2(hd.y, -hd.x))), 0.035) * step(0.0, dot(p, hd)) * step(dot(p, hd), 0.5);
      float minuteHand = step(abs(dot(p, vec2(md.y, -md.x))), 0.025) * step(0.0, dot(p, md)) * step(dot(p, md), 0.8);
      float ink = max(ticks, max(hourHand, minuteHand));
      vec3 face = mix(vec3(1.0, 0.92, 0.72) * 1.3, vec3(0.08, 0.06, 0.05), ink);
      float haze = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * 0.5);
      gl_FragColor = vec4(mix(face, fogColor, clamp(haze, 0.0, 1.0)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }

    if (!wall) {
      // Roofs: tar and gravel, patched.
      albedo = vec3(0.12, 0.115, 0.11) * (0.75 + 0.5 * noise(vB.xz * 0.7)) * (n.y < 0.0 ? 0.6 : 1.0);
      if (uMode == ${MODE.copper}) albedo = vec3(0.3, 0.52, 0.45);
    } else if (uMode == ${MODE.deco}) {
      // Pilasters between tall windows; chevrons on the spandrel panels.
      float pil = 1.0 - step(0.2, f.x) * step(f.x, 0.8);
      win = (1.0 - pil) * step(0.26, f.y) * step(f.y, 0.94);
      float spandrel = (1.0 - pil) * (1.0 - win);
      float chevron = step(0.5, fract(abs(f.x - 0.5) * 3.0 + f.y * 4.0));
      albedo = uColour * (1.0 + pil * 0.18) * (1.0 - smoothstep(0.17, 0.2, f.x) * (1.0 - smoothstep(0.2, 0.23, f.x)) * 0.5);
      albedo = mix(albedo, uTrim, spandrel * chevron * 0.6);
    } else if (uMode == ${MODE.civic}) {
      // Rusticated ground floor; arched windows above; a string course at each floor.
      if (h < 8.0) {
        albedo *= 0.82 + 0.18 * step(0.1, fract(h / 0.9));
        win = step(0.3, f.x) * step(f.x, 0.7) * step(1.2, h) * step(h, 6.2);
      } else {
        vec2 q = vec2((f.x - 0.5) * uBayW, f.y * uFloorH);
        float rect = step(abs(q.x), 0.8) * step(0.9, q.y) * step(q.y, 3.0);
        float arch = step(length(vec2(q.x, q.y - 3.0)), 0.8);
        win = max(rect, arch);
        float frame = max(step(abs(q.x), 1.05) * step(0.7, q.y) * step(q.y, 3.0), step(length(vec2(q.x, q.y - 3.0)), 1.05)) * (1.0 - win);
        albedo = mix(albedo, uTrim, frame * 0.7);
        albedo = mix(albedo, uTrim, step(f.y, 0.06));
      }
    } else if (uMode == ${MODE.flats}) {
      // Painted concrete, streaked by years of rain.
      albedo *= 0.82 + 0.25 * noise(vec2(along * 0.9, h * 0.04)) - 0.15 * noise(vec2(along * 3.0, h * 0.3));
      win = step(0.12, f.x) * step(f.x, 0.88) * step(0.22, f.y) * step(f.y, 0.9);
      // Curtains, every colour; some windows open (dark); washing on lines.
      vec3 curtain = vec3(hash(id + 1.0), hash(id + 2.0), hash(id + 3.0));
      curtain = mix(vec3(1.0, 0.75, 0.45), curtain, 0.55);
      lit *= step(0.08, hash(id + 9.0));
      float line = step(hash(id + 5.0), 0.3) * step(0.55, f.y) * step(f.y, 0.76) * step(0.5, fract(f.x * 7.0 + hash(id) * 3.0));
      vec3 cloth = vec3(hash(id + floor(f.x * 7.0)), hash(id + 4.0 + floor(f.x * 7.0)), hash(id + 8.0 + floor(f.x * 7.0)));
      float dish = step(0.88, hash(id + 6.0)) * step(length(vec2((f.x - 0.85) * uBayW, (f.y - 0.75) * uFloorH)), 0.35);
      albedo = mix(albedo, cloth * 0.9, line);
      albedo = mix(albedo, vec3(0.85), dish);
      glow += curtain * win * lit * (1.0 - line) * 0.6;
      win *= 1.0 - line;
    } else if (uMode == ${MODE.brick}) {
      // Red brick (by the metre, so it doesn't shimmer), white trim and sashes.
      albedo = uColour * (0.8 + 0.35 * hash(floor(vec2(along, h * 3.0))));
      win = step(0.3, f.x) * step(f.x, 0.7) * step(0.25, f.y) * step(f.y, 0.88);
      float frame = step(0.26, f.x) * step(f.x, 0.74) * step(0.2, f.y) * step(f.y, 0.92) * (1.0 - win);
      float sill = step(f.y, 0.06);
      albedo = mix(albedo, uTrim, max(frame, sill));
      win *= 1.0 - step(abs(f.y - 0.56), 0.02);   // the sash bar
    } else if (uMode == ${MODE.copper}) {
      // Verdigris, streaked paler where the rain runs.
      albedo = uColour * (0.85 + 0.3 * noise(vec2(atan(vLocal.z, vLocal.x) * 4.0, vLocal.y * 2.0)));
    }

    vec3 col = albedo * ambient(n);
    if (wall) col += albedo * SODIUM * flood(h) * uPower;
    // Glass: dark when off, lit by whoever is home.
    col = mix(col, col * 0.25, win);
    if (uMode != ${MODE.flats}) glow += mix(uGlass, uGlass * vec3(0.75, 0.88, 1.2), step(0.7, hash(id + 2.0))) * win * lit * (0.5 + 0.5 * r);
    // Load-shedding: the windows go out, but for a candle or an inverter here and there.
    glow *= mix(0.02, 1.0, uPower);
    glow += vec3(1.0, 0.62, 0.3) * win * (1.0 - uPower) * step(0.94, hash(id + 31.0)) * (0.12 + 0.08 * hash(id + 5.0));
    // Rooms behind the glass (rooms.js), 3.5 m deep, close up.
    if (wall && uMode != ${MODE.copper}) {
      vec3 axis = abs(n.x) > 0.5 ? vec3(sign(n.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(n.z));
      vec3 eye = (uToBuilding * vec4(cameraPosition, 1.0)).xyz;
      vec2 size = vec2(uBayW, uFloorH);
      float room = roomShade(vec3(along, h, dot(vB, axis)), vec3(abs(n.x) > 0.5 ? eye.z : eye.x, eye.y, dot(eye, axis)), floor(cell) * size, size, 3.5, hash(id + 17.0));
      float near = clamp(1.6 - length(fwidth(cell)) * 3.0, 0.0, 1.0);
      glow *= mix(1.0, room, near * step(0.5, win));
    }
    float haze = clamp(1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * 0.7), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, fogColor, haze) + glow * (1.0 - haze * 0.6), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function billboardTexture([line1, line2]) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const g = c.getContext("2d");
  // Hand-painted and sun-faded: cream ground, red and blue lettering.
  g.fillStyle = "#e8dcc0";
  g.fillRect(0, 0, 512, 192);
  g.fillStyle = "#b8321e";
  g.fillRect(0, 0, 512, 22);
  g.fillRect(0, 170, 512, 22);
  g.fillStyle = "#1f3f78";
  g.font = "bold 58px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(line1, 256, 78, 480);
  g.fillStyle = "#b8321e";
  g.font = "bold 30px Georgia, serif";
  g.fillText(line2, 256, 132, 470);
  // Weathering.
  for (let i = 0; i < 900; i += 1) {
    g.fillStyle = `rgba(80,60,40,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 192, 2 + Math.random() * 10, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A soft round glow for sprites (without one they draw as squares). */
function glowDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CbdBuildings {
  /**
   * @param {object} [o]
   * @param {number} [o.streetY]
   * @param {THREE.Vector3} [o.centre]  the tower you're standing on
   */
  constructor({ streetY = -160, centre = new THREE.Vector3(), sets = [CBD] } = {}) {
    this.sets = sets;
    this.frames = [];
    /** The billboards and their lamps: dark in load-shedding. */
    this.boards = [];
    this.root = new THREE.Group();
    this.root.name = "CbdBuildings";
    this.owned = [];
    this.uniforms = [];
    const own = (x) => (this.owned.push(x), x);

    const place = (name, { x, z, yaw }) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(centre.x + x, streetY, centre.z + z);
      g.rotation.y = yaw;
      g.updateMatrixWorld(true);
      this.root.add(g);
      return g;
    };
    const facade = (group, mode, o = {}) => {
      const uniforms = {
        uToBuilding: { value: new THREE.Matrix4().copy(group.matrixWorld).invert() },
        uMode: { value: mode },
        uColour: { value: new THREE.Color(o.colour ?? 0xc8b89a) },
        uTrim: { value: new THREE.Color(o.trim ?? 0xe6dcc8) },
        uGlass: { value: new THREE.Color(o.glass ?? 0xffc98a) },
        uFloorH: { value: o.floorH ?? 3.6 },
        uBayW: { value: o.bayW ?? 3 },
        uLit: { value: o.lit ?? 0.35 },
        uTiers: { value: new THREE.Vector3(...(o.tiers ?? [0, 0, 0])) },
        uFlood: { value: o.flood ?? 0.9 },
        uPower: { value: 1 },
        uSeed: { value: o.seed ?? 1 },
        uHour: { value: 0 },
        uMinute: { value: 0 },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      };
      this.uniforms.push(uniforms);
      this.frames.push({ uniforms, group });
      return own(new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, fog: true, side: o.side ?? THREE.FrontSide }));
    };
    /** A box from `y0` up, centred at (x, z) in the building's frame. */
    const box = (group, mat, w, h, d, x = 0, y0 = 0, z = 0) => {
      const g = own(new THREE.BoxGeometry(w, h, d));
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y0 + h / 2, z);
      group.add(mesh);
      return mesh;
    };
    const cylinder = (group, mat, rTop, rBottom, h, x = 0, y0 = 0, z = 0, segments = 16) => {
      const mesh = new THREE.Mesh(own(new THREE.CylinderGeometry(rTop, rBottom, h, segments)), mat);
      mesh.position.set(x, y0 + h / 2, z);
      group.add(mesh);
      return mesh;
    };
    // Rooftop clutter: lit by the scene's own lights.
    const metal = own(new THREE.MeshLambertMaterial({ color: 0x6d6f72 }));
    const rust = own(new THREE.MeshLambertMaterial({ color: 0x6a3a22 }));
    const white = own(new THREE.MeshLambertMaterial({ color: 0xd8d8d2 }));
    const waterTank = (group, x, y0, z, r = 2.2) => {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(group, metal, 0.25, 2.5, 0.25, x + dx * r * 0.6, y0, z + dz * r * 0.6);
      cylinder(group, metal, r, r, 3.2, x, y0 + 2.5, z, 14);
      cylinder(group, metal, 0.2, r * 1.02, 0.7, x, y0 + 5.7, z, 14);
    };
    const dish = (group, x, y0, z, yaw = 0, size = 0.9) => {
      const d = new THREE.Mesh(own(new THREE.CircleGeometry(size, 14)), white);
      d.position.set(x, y0 + size + 0.4, z);
      d.rotation.set(-0.5, yaw, 0);
      group.add(d);
      box(group, metal, 0.12, size + 0.4, 0.12, x, y0, z);
    };
    this.beacon = own(new THREE.SpriteMaterial({ map: own(glowDot()), color: 0xff2a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));

    for (const [set, at] of sets.entries()) {
      // ---- Art Deco tower ----
      if (at.deco) {
        const g = place("DecoTower", at.deco);
        const stone = facade(g, MODE.deco, { colour: 0xcdbb98, trim: 0x8f7a5c, glass: 0xffd29a, floorH: 3.8, bayW: 2.6, lit: 0.3, tiers: [140, 154, 162], seed: 3 + set * 17 });
        box(g, stone, 26, 140, 22);
        box(g, stone, 20, 14, 16, 0, 140);
        box(g, stone, 13, 8, 10, 0, 154);
        cylinder(g, metal, 0.15, 0.6, 15, 0, 162, 0, 8);
        const light = new THREE.Sprite(this.beacon);
        light.position.set(0, 177.5, 0);
        light.scale.setScalar(4);
        g.add(light);
        waterTank(g, -9, 140, 7);
        box(g, metal, 2.4, 1.4, 1.6, 8, 140, -8);
        box(g, metal, 2.4, 1.4, 1.6, 8, 140, -5);
        dish(g, 6, 154, 5, 0.6);
        dish(g, -6, 154, -5, -0.4, 0.7);
      }

      // ---- Tower flats ----
      if (at.flats) {
        const g = place("TowerFlats", at.flats);
        const top = 154;
        const concrete = facade(g, MODE.flats, { colour: 0xb9b3a6, floorH: 3.0, bayW: 3.6, lit: 0.55, flood: 0.35, seed: 5 + set * 17 });
        box(g, concrete, 36, top, 15);
        // Balconies on the side that faces the roof: one slab per floor, instanced.
        const floors = Math.floor(top / 3.0) - 1;
        const slab = own(new THREE.BoxGeometry(34, 0.25, 1.3));
        const balconies = new THREE.InstancedMesh(slab, concrete, floors);
        const m = new THREE.Matrix4();
        for (let i = 0; i < floors; i += 1) balconies.setMatrixAt(i, m.makeTranslation(0, 3 + i * 3.0, 7.5 + 0.65));
        g.add(balconies);
        // The roof: tanks, dishes, washing lines and a shack.
        waterTank(g, -12, top, -3);
        waterTank(g, -6.5, top, -3, 1.8);
        for (let i = 0; i < 5; i += 1) dish(g, -14 + i * 7, top, 6.5, 0.2 * i, 0.6 + (i % 2) * 0.3);
        box(g, rust, 4.5, 2.6, 3.2, 11, top, -2);
        const roofSheet = box(g, metal, 5, 0.1, 3.8, 11, top + 2.7, -2);
        roofSheet.rotation.x = 0.12;
        const lines = [];
        const clothes = [];
        for (let k = 0; k < 3; k += 1) {
          const z = -5 + k * 2.2;
          lines.push(-2, top + 1.8, z, 6, top + 1.8, z);
          for (let j = 0; j < 9; j += 1) clothes.push([-1.5 + j * 0.85, top + 1.3, z]);
        }
        const lineGeometry = own(new THREE.BufferGeometry());
        lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
        g.add(new THREE.LineSegments(lineGeometry, own(new THREE.LineBasicMaterial({ color: 0x9a9a9a }))));
        const cloth = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(0.6, 0.9)), own(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })), clothes.length);
        const colour = new THREE.Color();
        const palette = [0xc43b2e, 0x2f6fb5, 0xe9c33f, 0xf2f2f2, 0x3f9c5c, 0xd96aa0];
        clothes.forEach(([x, y, z], i) => {
          cloth.setMatrixAt(i, m.makeTranslation(x, y, z));
          cloth.setColorAt(i, colour.set(palette[(i * 7) % palette.length]));
        });
        g.add(cloth);
      }

      // ---- Red-brick block ----
      if (at.brick) {
        const g = place("BrickBlock", at.brick);
        const top = 148;
        const brick = facade(g, MODE.brick, { colour: 0x8a3a26, trim: 0xe9e2d2, glass: 0xffc17a, floorH: 3.9, bayW: 3.2, lit: 0.32, flood: 1.0, seed: 7 + set * 17 });
        const trim = facade(g, MODE.deco, { colour: 0xe2dccb, trim: 0xc9c0aa, lit: 0, flood: 1.0, tiers: [top - 2, 0, 0], seed: 8 + set * 17 });
        box(g, brick, 24, top, 20);
        box(g, trim, 25.6, 1.6, 21.6, 0, top - 1.6);           // the cornice
        waterTank(g, 7, top, 5);
        // The billboard: on two posts, lit by two lamps on arms.
        const board = new THREE.Mesh(own(new THREE.PlaneGeometry(14, 5.25)), own(new THREE.MeshBasicMaterial({ map: own(billboardTexture(BILLBOARD)), fog: true, color: 0xd8c8b0 })));
        board.position.set(-2, top + 6.5, 4.5);
        g.add(board);
        const back = box(g, metal, 14.2, 5.4, 0.2, -2, top + 3.8, 4.35);
        back.material = rust;
        for (const x of [-7, 3]) box(g, metal, 0.3, 4, 0.3, x, top, 4.2);
        const lamp = own(new THREE.SpriteMaterial({ map: own(glowDot()), color: 0xffe6b0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
        for (const x of [-6, 2]) {
          const s = new THREE.Sprite(lamp);
          s.position.set(x, top + 9.6, 5.6);
          s.scale.setScalar(1.4);
          g.add(s);
        }
        this.boards.push({ group: g, board: board.material, lamp, colour: board.material.color.clone() });
      }

      // ---- Civic building (sandstone, clock tower, copper dome) ----
      if (at.civic) {
        const g = place("CivicBuilding", at.civic);
        const stone = facade(g, MODE.civic, { colour: 0xd2bf98, trim: 0xeee2c8, glass: 0xffcf8e, floorH: 5.2, bayW: 4.2, lit: 0.4, flood: 1.4, tiers: [24, 0, 0], seed: 9 + set * 17 });
        const copper = facade(g, MODE.copper, { colour: 0x5f9c8a, flood: 1.1, tiers: [50, 0, 0] });
        box(g, stone, 54, 24, 28);
        box(g, stone, 56, 1.2, 30, 0, 24);                       // the cornice
        // The colonnade along the front (+z).
        for (let i = 0; i < 12; i += 1) cylinder(g, stone, 0.55, 0.65, 9, -22 + i * 4, 0, 15.2, 10);
        box(g, stone, 50, 1.6, 3.4, 0, 9, 15.2);                 // the entablature on them
        // The clock tower, rising from the middle of the front.
        box(g, stone, 11, 32, 11, 0, 25.2, 8);
        box(g, stone, 12.4, 1, 12.4, 0, 57.2, 8);
        for (const [x, z, yaw] of [[0, 13.55, 0], [0, 2.45, Math.PI], [5.55, 8, Math.PI / 2], [-5.55, 8, -Math.PI / 2]]) {
          const face = new THREE.Mesh(own(new THREE.CircleGeometry(2.6, 32)), facade(g, MODE.clock));
          face.position.set(x, 49, z);
          face.rotation.y = yaw;
          g.add(face);
        }
        // Cupola and dome, with a lantern and a finial.
        cylinder(g, stone, 4, 4, 4, 0, 58.2, 8, 20);
        const dome = new THREE.Mesh(own(new THREE.SphereGeometry(4.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), copper);
        dome.position.set(0, 62.2, 8);
        g.add(dome);
        cylinder(g, copper, 0.9, 1.1, 2.4, 0, 66.6, 8, 10);
        cylinder(g, metal, 0.05, 0.15, 3, 0, 69, 8, 6);
        // Small domes on the front corners.
        for (const x of [-24, 24]) {
          cylinder(g, stone, 2.6, 2.6, 3, x, 25.2, 12, 16);
          const small = new THREE.Mesh(own(new THREE.SphereGeometry(2.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), copper);
          small.position.set(x, 28.2, 12);
          g.add(small);
        }
        // Palms along the pavement in front.
        const trunk = own(new THREE.MeshLambertMaterial({ color: 0x5a4632 }));
        const frond = own(new THREE.MeshLambertMaterial({ color: 0x2f5a2a, side: THREE.DoubleSide }));
        const leaf = own(new THREE.PlaneGeometry(0.9, 4.2));
        leaf.translate(0, 2.1, 0);
        for (let i = 0; i < 6; i += 1) {
          const x = -25 + i * 10;
          cylinder(g, trunk, 0.25, 0.4, 11, x, 0, 21, 6);
          for (let k = 0; k < 8; k += 1) {
            const l = new THREE.Mesh(leaf, frond);
            l.position.set(x, 11, 21);
            l.rotation.set(1.15, (k / 8) * Math.PI * 2 + i, 0, "YXZ");
            g.add(l);
          }
        }
      }
    }
    // One draw per material per building, not one per column, palm leaf and
    // tank (178 draws of a roof frame were these): each building's meshes
    // merged by material, in the building's frame. Not the clock faces or the
    // copper (their shading reads each mesh's own coordinates).
    for (const g of this.root.children) mergeByMaterial(g, own);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    this._clockMinute = -1;
  }

  /**
   * After a building has moved (the Skyline wraps them along the route):
   * its facades' frame again, so the windows stay on the walls.
   */
  refresh(group) {
    group.updateMatrixWorld(true);
    for (const f of this.frames) if (f.group === group) f.uniforms.uToBuilding.value.copy(group.matrixWorld).invert();
  }

  /** Spots the generic city leaves empty (x, z from the centre; radius), metres. */
  get footprints() {
    const r = { deco: 18, flats: 24, brick: 16, civic: 34 };
    return this.sets.flatMap((at) => Object.keys(r).filter((k) => at[k]).map((k) => ({ ...at[k], r: r[k] })));
  }

  /**
   * @param {number} [dt]
   * @param {number} [time]
   * @param {(x:number, z:number) => number} [power]  the grid (LoadShedding.power)
   */
  update(dt, time, power = null) {
    // The grid: each building on or off as a whole. The civic building has
    // its own generator.
    if (power) {
      for (const { uniforms, group } of this.frames) {
        uniforms.uPower.value = group.name === "CivicBuilding" ? 1 : power(group.position.x, group.position.z);
      }
      for (const b of this.boards) {
        const on = power(b.group.position.x, b.group.position.z);
        b.board.color.copy(b.colour).multiplyScalar(0.08 + 0.92 * on);
        b.lamp.opacity = 0.8 * on;
      }
    }
    // The clock tells the real time (checked once a second is plenty).
    const now = new Date();
    if (now.getMinutes() !== this._clockMinute) {
      this._clockMinute = now.getMinutes();
      for (const u of this.uniforms) {
        u.uHour.value = now.getHours() % 12;
        u.uMinute.value = now.getMinutes();
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
