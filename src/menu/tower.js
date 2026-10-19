/**
 * Ascension Tower, burning, as seen across the city from the menu's roof.
 *
 * A chamfered-square glass tower (an octagon in plan: four 36 m faces and
 * four narrow corner faces), one draw call for the whole curtain wall. Its
 * shader, per pixel:
 *
 *  - splits the face into floors (4.2 m) and window columns (~1.5 m):
 *    mullions, a spandrel panel and slab edge at each floor, glass between;
 *  - looks through each pane into a room that is not there (interior
 *    mapping: the view ray is intersected with a box behind the glass, so a
 *    flat face shows ceilings, back walls and floors in true perspective).
 *    A lit office shows its ceiling panels and pale walls; a dark one just
 *    the night reflected in the glass;
 *  - reads the window's state from a small texture (one texel per window,
 *    see TowerCells): how hard it is burning, whether its glass is sooted
 *    or gone, whether its lights are on or flickering. Burning rooms are
 *    filled with fire under a ceiling of smoke; blown-out windows have no
 *    glass at all and flames come out of them (fire.js);
 *  - lights the frames and panels near the fire from the fire itself
 *    (warm, flickering, strongest just above a burning window, where the
 *    flames lick up the facade);
 *  - reflects the sky in the glass (Fresnel) and ends in the stage's haze.
 *
 * The CPU side (TowerCells) owns the windows' state: it spreads the fire,
 * very slowly, and now and then blows a window out - a flash in the shader,
 * a burst of glass and a new flame (the stage listens via `onBlowout`).
 */

import * as THREE from "../three.js";
import { HAZE_GLSL } from "./atmosphere.js";

export const FLOOR_H = 4.2;
const COLS = 32; // texels per face
const FLOORS = 64; // texel rows
const FACES = 8;

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * The octagon's faces in the tower's local frame, in order round the plan:
 * { a, b (XZ endpoints), normal (XZ), width, cols }. Face 0 faces +Z.
 */
function towerFaces(half, chamfer) {
  const s = half;
  const c = chamfer;
  const pts = [[-s + c, s], [s - c, s], [s, s - c], [s, -s + c], [s - c, -s], [-s + c, -s], [-s, -s + c], [-s, s - c]];
  const faces = [];
  for (let i = 0; i < 8; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 8];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const width = Math.hypot(dx, dz);
    // Outward: the edge direction turned a quarter (face 0, running +X, faces +Z).
    const normal = [-dz / width, dx / width];
    faces.push({ a, b, normal, width, cols: Math.max(2, Math.round(width / 1.5)) });
  }
  return faces;
}

const FACADE_VERTEX = /* glsl */ `
  attribute float aFace;
  attribute float aColW;
  varying vec2 vFacade;
  varying float vFace;
  varying float vColW;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vTangent;
  void main() {
    vFacade = uv;
    vFace = aFace;
    vColW = aColW;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vTangent = normalize(cross(vec3(0.0, 1.0, 0.0), vNormal));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FACADE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uCells;
  uniform sampler2D uNoise;
  uniform vec4 uBlast[2];        // (face*32 + col, floor, age, strength)
  uniform vec3 uFireLight;       // the fire's colour on nearby surfaces
  uniform float uFlicker;        // 0..1, the fire's overall flicker
  uniform float uDetail;         // 0 low .. 1 high
  varying vec2 vFacade;
  varying float vFace;
  varying float vColW;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vTangent;
  ${HAZE_GLSL}

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  vec4 cellAt(float col, float fl) {
    return texture2D(uCells, vec2((vFace * ${COLS}.0 + col + 0.5) / ${COLS * FACES}.0, (fl + 0.5) / ${FLOORS}.0));
  }

  // Incandescence: dark red through orange and yellow to near white (HDR).
  vec3 fireRamp(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c = mix(vec3(0.0), vec3(0.55, 0.05, 0.0), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3(2.6, 0.75, 0.08), smoothstep(0.2, 0.55, t));
    c = mix(c, vec3(6.0, 3.0, 0.7), smoothstep(0.5, 0.82, t));
    return mix(c, vec3(11.0, 8.5, 4.5), smoothstep(0.8, 1.0, t));
  }

  // The sky and the city as the glass reflects them.
  vec3 reflected(vec3 r) {
    vec3 c = hazeColour(cameraPosition, r);
    float up = smoothstep(0.0, 0.6, r.y);
    c = mix(c, vec3(0.006, 0.009, 0.02), up * 0.85);
    return c;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 T = normalize(vTangent);
    vec3 V = normalize(vWorld - cameraPosition);
    float colW = vColW;
    vec2 g = vec2(vFacade.x / colW, vFacade.y / ${FLOOR_H.toFixed(1)});
    vec2 cell = floor(g);
    vec2 f = fract(g);
    vec4 st = cellAt(cell.x, cell.y);
    float burn = st.r;
    float glassState = st.g;     // 0 intact, ~0.5 cracked/sooted, 1 blown out
    float soot = st.b;
    float light = st.a;
    float h = hash12(cell + vFace * 97.0);
    float h2 = hash12(cell.yx * 1.7 + vFace * 13.0);

    // Anti-aliased frame lines: mullions (vertical) and the floor's slab edge
    // and spandrel panel (horizontal band at the bottom of each floor).
    vec2 fw = fwidth(g) + 1e-4;
    float mull = 1.0 - smoothstep(0.035 - fw.x, 0.035 + fw.x, min(f.x, 1.0 - f.x));
    float spandrel = 1.0 - smoothstep(0.24 - fw.y, 0.24 + fw.y, f.y);
    float slab = 1.0 - smoothstep(0.05 - fw.y, 0.05 + fw.y, f.y);
    float transom = 1.0 - smoothstep(0.012, 0.012 + fw.y * 1.5, abs(f.y - 0.9));
    float frame = max(mull, transom);
    float isGlass = (1.0 - frame) * (1.0 - spandrel);

    // ---- The room behind the pane (interior mapping) --------------------
    // Pane-local position: x across the window (0..1 of colW metres), y up
    // from the sill. View ray into the building in (tangent, up, inward).
    vec3 rd = vec3(dot(V, T), V.y, -dot(V, N));
    float roomW = colW * (h2 < 0.6 ? 2.0 : 1.0);
    float roomH = ${FLOOR_H.toFixed(1)} * 0.76;
    float depth = 5.0 + h * 5.0;
    vec3 p = vec3((h2 < 0.6 ? (mod(cell.x, 2.0) + f.x) * colW : f.x * colW), (f.y - 0.24) / 0.76 * roomH, 0.0);
    vec3 inv = 1.0 / max(abs(rd), vec3(1e-4)) * sign(rd + 1e-6);
    float tx = ((rd.x > 0.0 ? roomW : 0.0) - p.x) * inv.x;
    float ty = ((rd.y > 0.0 ? roomH : 0.0) - p.y) * inv.y;
    float tz = (depth - p.z) * inv.z;
    float t = min(tx, min(ty, tz));
    vec3 hit = p + rd * t;
    float onCeil = step(ty, min(tx, tz)) * step(0.0, rd.y);
    float onFloor = step(ty, min(tx, tz)) * step(rd.y, 0.0);
    float onBack = step(tz, min(tx, ty));
    float onSide = 1.0 - max(max(onCeil, onFloor), onBack);
    float hy = hit.y / roomH;          // 0 floor .. 1 ceiling
    float hz = hit.z / depth;          // 0 window .. 1 back wall

    vec3 room = vec3(0.0);
    // An office with its lights on: ceiling panels, pale walls, dark carpet,
    // the tops of partitions against the back wall. Some flicker.
    if (light > 0.02) {
      float flick = light > 0.5 ? step(0.35, fract(sin(floor(uTime * 9.0 + h * 50.0) * 12.9898) * 43758.5)) * 0.85 + 0.15 : 1.0;
      float lvl = (light > 0.5 ? light - 0.5 : light) * 2.0 * flick;
      vec3 tint = h > 0.7 ? vec3(0.85, 0.95, 1.1) : vec3(1.1, 0.95, 0.75);
      vec2 panel = abs(fract(hit.xz / vec2(1.2, 1.8)) - 0.5);
      float panels = onCeil * step(panel.x, 0.3) * step(panel.y, 0.38);
      vec3 walls = vec3(0.32, 0.3, 0.28) * (0.55 + 0.45 * hy) * (1.0 - hz * 0.35);
      vec3 carpet = vec3(0.06, 0.06, 0.07) * (1.0 - hz * 0.5);
      room = onCeil * mix(vec3(0.18), vec3(2.6), panels) + onFloor * carpet + (onBack + onSide) * walls;
      // Desk partitions: a dark band low on the back wall.
      room *= 1.0 - onBack * step(hy, 0.3) * 0.75;
      room *= tint * lvl;
    } else {
      // Dark: the faint blue of the night, now and then a monitor left on.
      room = vec3(0.004, 0.005, 0.008) * (0.5 + hz);
      room += vec3(0.08, 0.16, 0.3) * step(0.93, h) * onBack * step(abs(hit.x - roomW * 0.5), 0.35) * step(abs(hy - 0.3), 0.06);
    }

    // A burning room: fire on the floor and up the walls, under a ceiling of
    // smoke that glows from below. The hot smoke layer hangs down from the
    // ceiling, thicker the further it is seen through.
    float fireN = 0.0;
    if (burn > 0.02) {
      vec2 nuv = vec2(hit.x * 0.13 + hit.z * 0.05 + h * 7.0, hit.y * 0.11 - uTime * 0.55);
      float n = texture2D(uNoise, nuv).r * 0.65 + texture2D(uNoise, nuv * 2.3 + vec2(0.0, -uTime * 0.4)).a * 0.35;
      fireN = n;
      float flame = clamp((1.0 - hy) * 1.25 - 0.15 + (n - 0.5) * 1.3, 0.0, 1.0);
      vec3 fire = fireRamp(flame * (0.65 + 0.35 * burn)) * (0.75 + 0.5 * uFlicker);
      vec3 smoke = vec3(0.32, 0.09, 0.02) * (0.4 + 0.8 * n) * burn;
      float layer = smoothstep(0.45, 0.95, hy + (n - 0.5) * 0.3) * (0.6 + 0.4 * hz);
      vec3 inside = mix(fire, smoke, layer);
      inside = mix(inside, smoke * 0.5, onCeil * 0.8);
      room = mix(room, inside, smoothstep(0.02, 0.35, burn));
    }

    // The pane: tinted glass in front of the room, the night in it. Sooted
    // glass passes less; blown-out windows have none (and no reflection).
    float cosV = max(dot(-V, N), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
    vec3 refl = reflected(reflect(V, N));
    // A faint wobble in the reflection: real curtain walls are never flat.
    refl *= 0.85 + 0.3 * texture2D(uNoise, vec2(cell.x * 0.37 + vFace, cell.y * 0.21)).g;
    float blown = step(0.75, glassState);
    float sooty = clamp(soot + (glassState > 0.3 && glassState < 0.75 ? 0.5 : 0.0), 0.0, 1.0);
    vec3 glassTint = vec3(0.55, 0.66, 0.7) * (1.0 - sooty * 0.75);
    vec3 pane = mix(room * glassTint + refl * fres * 1.3, room * 1.15, blown);
    // Cracks catch the firelight.
    if (glassState > 0.3 && glassState < 0.75) {
      float crack = smoothstep(0.92, 0.98, texture2D(uNoise, vFacade * vec2(0.9, 0.5)).b);
      pane += uFireLight * crack * 0.6 * burn;
    }

    // ---- Frames, panels and the fire's light on them ----------------------
    // Light from the windows round this one: strongest just above a fire
    // (the flames lick up the face), a little to the sides and below.
    float below = cellAt(cell.x, cell.y - 1.0).r;
    float below2 = cellAt(cell.x, cell.y - 2.0).r;
    float above = cellAt(cell.x, cell.y + 1.0).r;
    float side = max(cellAt(cell.x - 1.0, cell.y).r, cellAt(cell.x + 1.0, cell.y).r);
    float lick = below * (1.0 - f.y * 0.5) * 1.3 + below2 * 0.35 + above * 0.25 * f.y + side * 0.3 + burn * 0.8;
    float flick = 0.7 + 0.6 * texture2D(uNoise, vec2(cell.x * 0.11 + uTime * 0.21, cell.y * 0.07 + uTime * 0.13)).r;
    vec3 fireOn = uFireLight * lick * flick;
    vec3 moon = vec3(0.012, 0.016, 0.026) * (0.5 + 0.5 * max(dot(N, uMoonDir), 0.0));
    vec3 alu = vec3(0.16, 0.17, 0.18);
    vec3 frameCol = alu * (moon * 3.0 + fireOn * 0.9) + refl * 0.05;
    vec3 panelCol = vec3(0.025, 0.028, 0.032) * (moon * 8.0 + fireOn * 0.8) + refl * fres * 0.9;
    // Soot climbs the face above the fire.
    float faceSoot = clamp(soot * 0.9 + below * 0.6, 0.0, 1.0);
    panelCol *= 1.0 - faceSoot * 0.6;
    frameCol *= 1.0 - faceSoot * 0.5;
    panelCol = mix(panelCol, frameCol * 1.2, slab);

    vec3 col = mix(panelCol, pane, isGlass);
    col = mix(col, frameCol, frame * (1.0 - spandrel * 0.5));
    // The reflection of the fire on the glass just above and below it.
    col += uFireLight * lick * 0.08 * isGlass * (1.0 - blown);

    // A window blowing out: a white-hot flash through the whole pane.
    for (int i = 0; i < 2; i++) {
      vec4 b = uBlast[i];
      if (b.w <= 0.0) continue;
      float here = step(abs(vFace * ${COLS}.0 + cell.x - b.x), 0.5) * step(abs(cell.y - b.y), 0.5);
      float near = exp(-length(vec2(vFace * ${COLS}.0 + cell.x - b.x, (cell.y - b.y) * 2.8)) * 0.7);
      float k = exp(-b.z * 5.0) * b.w;
      col += vec3(14.0, 9.0, 5.0) * here * k + uFireLight * near * k * 2.5;
    }

    gl_FragColor = vec4(applyHaze(col, vWorld), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The windows' state, one texel each: R burning, G glass (0 intact, 128
 * sooted/cracked, 255 gone), B soot on the face, A lights (0 off, <128 on,
 * >=128 flickering). Faces x columns across, floors up.
 */
class TowerCells {
  constructor({ faces, floors, fireFloors, visible, seed = 3 }) {
    this.faces = faces;
    this.floors = floors;
    this.data = new Uint8Array(COLS * FACES * FLOORS * 4);
    this.texture = new THREE.DataTexture(this.data, COLS * FACES, FLOORS, THREE.RGBAFormat);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.fireFloors = fireFloors;
    this.visible = visible;
    this.r = rng(seed);
    const r = this.r;
    const [lo, hi] = fireFloors;
    // Floors lit after hours: a few whole floors (cleaners, a server room),
    // and scattered offices.
    const litFloor = Array.from({ length: floors }, () => (r() < 0.12 ? 0.75 + r() * 0.25 : 0));
    for (let fi = 0; fi < FACES; fi += 1) {
      const face = faces[fi];
      // The fire's ragged edges: each column's own bottom and top floor.
      let wobbleLo = 0;
      let wobbleHi = 0;
      for (let c = 0; c < face.cols; c += 1) {
        wobbleLo = THREE.MathUtils.clamp(wobbleLo + (r() - 0.5) * 1.6, -2, 2);
        wobbleHi = THREE.MathUtils.clamp(wobbleHi + (r() - 0.5) * 1.8, -2.5, 2.5);
        // The fire started on the side facing the city (face 0) and has
        // wrapped round most of the way; the back burns less.
        const reach = visible.includes(fi) ? 1 : 0.6;
        for (let f = 0; f < floors; f += 1) {
          const i = this._index(fi, c, f);
          const fireLo = lo + wobbleLo + (fi % 2 ? 1 : 0);
          const fireHi = hi + wobbleHi - (reach < 1 ? 2 : 0);
          let burn = 0;
          if (f >= fireLo && f <= fireHi) burn = (0.45 + r() * 0.55) * reach;
          if (burn > 0 && r() < 0.12) burn *= 0.3; // a room not yet fully alight
          let glass = 0;
          if (burn > 0.4) glass = r() < 0.3 ? 255 : r() < 0.5 ? 128 : 0;
          let soot = 0;
          if (f > fireHi && f < fireHi + 5) soot = Math.max(0, 1 - (f - fireHi) / 5) * (0.6 + r() * 0.4);
          if (burn > 0) soot = Math.max(soot, 0.3);
          let lights = 0;
          if (!burn && f < fireLo - 1) {
            const lit = litFloor[f] > 0 ? r() < 0.85 : r() < 0.16;
            if (lit) lights = r() < 0.08 ? 160 + Math.floor(r() * 80) : 30 + Math.floor((litFloor[f] || 0.5 + r() * 0.5) * 90);
          }
          this.data[i] = Math.round(burn * 255);
          this.data[i + 1] = glass;
          this.data[i + 2] = Math.round(soot * 255);
          this.data[i + 3] = lights;
        }
      }
    }
    this.spreadTimer = 0;
  }

  _index(face, col, floor) {
    return ((floor * COLS * FACES) + face * COLS + col) * 4;
  }

  burn(face, col, floor) {
    if (col < 0 || col >= this.faces[face].cols || floor < 0 || floor >= this.floors) return 0;
    return this.data[this._index(face, col, floor)] / 255;
  }

  glass(face, col, floor) {
    return this.data[this._index(face, col, floor) + 1];
  }

  /** Every blown-out, burning window on the faces we can see. */
  openWindows() {
    const out = [];
    for (const fi of this.visible) {
      for (let c = 0; c < this.faces[fi].cols; c += 1) {
        for (let f = this.fireFloors[0] - 3; f <= this.fireFloors[1] + 3; f += 1) {
          if (f < 0 || f >= this.floors) continue;
          const i = this._index(fi, c, f);
          if (this.data[i + 1] === 255 && this.data[i] > 90) out.push({ face: fi, col: c, floor: f, burn: this.data[i] / 255 });
        }
      }
    }
    return out;
  }

  /** Pick an intact burning window we can see, blow it out; null if none. */
  blowOne() {
    const candidates = [];
    for (const fi of this.visible) {
      for (let c = 0; c < this.faces[fi].cols; c += 1) {
        for (let f = this.fireFloors[0] - 3; f <= this.fireFloors[1] + 3; f += 1) {
          if (f < 0 || f >= this.floors) continue;
          const i = this._index(fi, c, f);
          if (this.data[i] > 110 && this.data[i + 1] !== 255) candidates.push([fi, c, f]);
        }
      }
    }
    if (!candidates.length) return null;
    const [face, col, floor] = candidates[Math.floor(this.r() * candidates.length)];
    const i = this._index(face, col, floor);
    this.data[i + 1] = 255;
    this.data[i] = Math.min(255, this.data[i] + 60);
    this.texture.needsUpdate = true;
    return { face, col, floor };
  }

  /** The fire creeps: now and then a neighbour of a burning room catches. */
  update(dt) {
    this.spreadTimer += dt;
    if (this.spreadTimer < 1.5) return;
    this.spreadTimer = 0;
    const r = this.r;
    for (let k = 0; k < 4; k += 1) {
      const fi = this.visible[Math.floor(r() * this.visible.length)];
      const c = Math.floor(r() * this.faces[fi].cols);
      const f = this.fireFloors[0] - 2 + Math.floor(r() * (this.fireFloors[1] - this.fireFloors[0] + 5));
      if (f < 0 || f >= this.floors) continue;
      const i = this._index(fi, c, f);
      const n = Math.max(this.burn(fi, c - 1, f), this.burn(fi, c + 1, f), this.burn(fi, c, f - 1) * 1.2);
      if (n > 0.5 && this.data[i] < 200) {
        this.data[i] = Math.min(255, this.data[i] + 50);
        this.data[i + 3] = 0;
        this.data[i + 2] = Math.max(this.data[i + 2], 80);
        this.texture.needsUpdate = true;
      }
    }
  }

  dispose() {
    this.texture.dispose();
  }
}

export class AscensionTower {
  /**
   * @param {object} o
   * @param {THREE.Vector3} o.position   centre of the base at street level
   * @param {number} o.rotation          about Y
   * @param {number} o.height            street to roof, metres
   * @param {object} o.haze              the stage's haze uniforms
   * @param {THREE.Texture} o.noise
   * @param {THREE.Vector3} o.viewFrom   where it is seen from (picks the visible faces)
   */
  constructor({ position, rotation = 0, height = 228, half = 22, chamfer = 4, fireFloors = [45, 51], haze, noise, viewFrom, quality = "medium" }) {
    this.root = new THREE.Group();
    this.root.name = "AscensionTower";
    this.root.position.copy(position);
    this.root.rotation.y = rotation;
    this.root.updateMatrixWorld(true);
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    this.height = height;
    this.half = half;
    this.faces = towerFaces(half, chamfer);
    const floors = Math.min(FLOORS, Math.floor(height / FLOOR_H));
    this.floors = floors;

    // Which faces look toward the viewer.
    const toView = viewFrom.clone().sub(position).setY(0).normalize();
    const visible = [];
    this.faces.forEach((face, i) => {
      const n = new THREE.Vector3(face.normal[0], 0, face.normal[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
      face.worldNormal = n;
      if (n.dot(toView) > -0.05) visible.push(i);
    });
    this.visible = visible;
    this.cells = new TowerCells({ faces: this.faces, floors, fireFloors, visible });

    // ---- The curtain wall: one mesh, eight faces ----
    const pos = [];
    const nrm = [];
    const uv = [];
    const faceAttr = [];
    const colW = [];
    const idx = [];
    const top = floors * FLOOR_H;
    this.faces.forEach((face, i) => {
      const base = pos.length / 3;
      const w = face.width;
      const cw = w / face.cols;
      for (const [x, z, u] of [[face.a[0], face.a[1], 0], [face.b[0], face.b[1], w]]) {
        for (const y of [0, top]) {
          pos.push(x, y, z);
          nrm.push(face.normal[0], 0, face.normal[1]);
          uv.push(u, y);
          faceAttr.push(i);
          colW.push(cw);
        }
      }
      // (a,0) (a,top) (b,0) (b,top)
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    });
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("aFace", new THREE.Float32BufferAttribute(faceAttr, 1));
    geo.setAttribute("aColW", new THREE.Float32BufferAttribute(colW, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    this.uniforms = {
      ...haze,
      uTime: { value: 0 },
      uCells: { value: this.cells.texture },
      uNoise: { value: noise },
      uBlast: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uFireLight: { value: new THREE.Color(1.6, 0.55, 0.14) },
      uFlicker: { value: 0.5 },
      uDetail: { value: quality === "high" ? 1 : quality === "medium" ? 0.6 : 0.2 },
    };
    const facade = own(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FACADE_VERTEX,
      fragmentShader: FACADE_FRAGMENT,
    }));
    this.facade = new THREE.Mesh(geo, facade);
    this.facade.name = "TowerFacade";
    this.root.add(this.facade);

    // ---- The crown: a dark plant floor, a lit glass lantern, the mast ----
    const dark = own(new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.55, metalness: 0.6 }));
    const roofShape = new THREE.Shape(this.faces.map((f) => new THREE.Vector2(f.a[0], -f.a[1])));
    const cap = own(new THREE.ExtrudeGeometry(roofShape, { depth: 0.6, bevelEnabled: false }));
    cap.rotateX(-Math.PI / 2);
    const capMesh = new THREE.Mesh(cap, dark);
    capMesh.position.y = top;
    this.root.add(capMesh);
    // Plant screen: louvres round a smaller octagon on the roof.
    const plantFaces = towerFaces(half - 3, chamfer - 1);
    const plantShape = new THREE.Shape(plantFaces.map((f) => new THREE.Vector2(f.a[0], -f.a[1])));
    const plantGeo = own(new THREE.ExtrudeGeometry(plantShape, { depth: 9, bevelEnabled: false }));
    plantGeo.rotateX(-Math.PI / 2);
    this.louvreUniforms = { ...haze, uFireLight: this.uniforms.uFireLight, uTime: this.uniforms.uTime, uNoise: { value: noise } };
    const louvreMat = own(new THREE.ShaderMaterial({
      uniforms: this.louvreUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorld; varying vec3 vLocal; varying vec3 vNormal;
        void main() {
          vLocal = position;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFireLight; uniform float uTime; uniform sampler2D uNoise;
        varying vec3 vWorld; varying vec3 vLocal; varying vec3 vNormal;
        ${HAZE_GLSL}
        void main() {
          float slats = smoothstep(0.35, 0.5, abs(fract(vLocal.y * 2.2) - 0.5) * 2.0);
          float lit = 0.55 + 0.45 * texture2D(uNoise, vec2(vWorld.x * 0.01 + uTime * 0.05, vWorld.z * 0.01)).r;
          vec3 c = vec3(0.04, 0.042, 0.048) * (0.4 + slats) + uFireLight * 0.07 * lit * (1.0 - vLocal.y / 10.0);
          c *= step(0.1, abs(vNormal.y)) * 0.6 + step(abs(vNormal.y), 0.1);
          gl_FragColor = vec4(applyHaze(c, vWorld), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    const plant = new THREE.Mesh(plantGeo, louvreMat);
    plant.position.y = top + 0.6;
    this.root.add(plant);
    // The mast, and its aircraft warning lights (blinking, red).
    const mastMat = own(new THREE.MeshStandardMaterial({ color: 0x202328, roughness: 0.6, metalness: 0.7 }));
    const mast = new THREE.Mesh(own(new THREE.CylinderGeometry(0.35, 1.1, 36, 8)), mastMat);
    mast.position.set(4, top + 9.6 + 18, -3);
    this.root.add(mast);
    const crane = new THREE.Mesh(own(new THREE.BoxGeometry(1, 1, 1)), mastMat);
    crane.scale.set(0.8, 0.8, 26);
    crane.position.set(-8, top + 14, 4);
    crane.rotation.y = 0.6;
    this.root.add(crane);
    const craneMast = new THREE.Mesh(crane.geometry, mastMat);
    craneMast.scale.set(0.9, 6, 0.9);
    craneMast.position.set(-8, top + 12.6, 4);
    this.root.add(craneMast);
    this.beaconTops = [
      new THREE.Vector3(4, top + 9.6 + 36.4, -3),
      new THREE.Vector3(half - 4, top + 10, half - 4),
      new THREE.Vector3(-half + 4, top + 10, half - 4),
    ];
    this.top = top;

    // Where the fire is, for everything that hangs off it (world space).
    this.fireCentre = this.toWorld(new THREE.Vector3(0, (fireFloors[0] + fireFloors[1] + 1) / 2 * FLOOR_H, 0));
    // ...and its face toward the viewer, a little out from the glass.
    const front = this.faces[visible.reduce((best, i) => (this.faces[i].worldNormal.dot(toView) > this.faces[best].worldNormal.dot(toView) ? i : best), visible[0])];
    this.fireFront = this.fireCentre.clone().addScaledVector(front.worldNormal, half + 1);
    this.blasts = [];
    this.onBlowout = null;
    this.blowTimer = 4;
  }

  /** Tower-local -> world. */
  toWorld(v) {
    return v.applyMatrix4(this.root.matrixWorld);
  }

  /**
   * A window's outside, in world space: the centre of the pane (y at the
   * window's middle), and the face's outward normal.
   */
  windowAt(face, col, floor, out = new THREE.Vector3()) {
    const f = this.faces[face];
    const t = (col + 0.5) / f.cols;
    const x = f.a[0] + (f.b[0] - f.a[0]) * t;
    const z = f.a[1] + (f.b[1] - f.a[1]) * t;
    out.set(x, (floor + 0.6) * FLOOR_H, z);
    return { position: this.toWorld(out), normal: f.worldNormal, width: f.width / f.cols };
  }

  /** Blow a window out now (the stage also does it on a timer). */
  blowout() {
    const cell = this.cells.blowOne();
    if (!cell) return null;
    const slot = this.uniforms.uBlast.value.find((b) => b.w <= 0) ?? this.uniforms.uBlast.value[0];
    slot.set(cell.face * COLS + cell.col, cell.floor, 0, 1);
    const at = this.windowAt(cell.face, cell.col, cell.floor);
    const event = { ...cell, ...at };
    this.onBlowout?.(event);
    return event;
  }

  update(dt, time, { flicker = 0.5, blowouts = true } = {}) {
    this.uniforms.uTime.value = time;
    this.uniforms.uFlicker.value = flicker;
    this.cells.update(dt);
    for (const b of this.uniforms.uBlast.value) {
      if (b.w <= 0) continue;
      b.z += dt;
      if (b.z > 2.5) b.w = 0;
    }
    if (blowouts) {
      this.blowTimer -= dt;
      if (this.blowTimer <= 0) {
        this.blowTimer = 7 + Math.random() * 9;
        this.blowout();
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.cells.dispose();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
