/**
 * The corridor shell as an instanced treadmill.
 *
 * Level 2 builds its whole shell up front as InstancedMesh sets. Level 1 has
 * to support an endless mode, so it goes one step further: the shell is a
 * ring buffer of SEGMENTS eight-metre slots. Each piece type (floor, wall,
 * window, octagonal frame, ...) is one InstancedMesh with one instance per
 * slot. As the player runs, slots that fall behind are re-stamped ahead of
 * them by rewriting their instance matrices. The level can be any length -
 * including infinite - and the shell still costs one draw call per piece type
 * and a fixed amount of GPU memory.
 *
 * Themes: each slot asks the layout which theme owns its distance (ward,
 * bridge, atrium) and pieces from other themes are written as zero-scale
 * matrices, which the GPU discards before rasterising.
 *
 * Collapse: slots behind the bridge's collapse front fall away with gravity
 * and tumble. That is the skybridge chase - the floor you just ran over is
 * dropping into the clouds.
 *
 * Set dressing: specs with a `place(k, j)` function decide per segment (from a
 * hash of the segment index k, so it is the same every run) whether an item
 * appears and where. That is how every segment of the lab is wrecked
 * differently - a bench knocked askew here, a ceiling tile hanging there -
 * while each item type is still one InstancedMesh and one draw call.
 *
 * Fixtures: the ceiling fluorescents use per-instance colour. Each one is
 * dead, flickering or on (decided per segment), and during a tremor they all
 * stutter.
 */

import * as THREE from "../../three.js";
import { LAYERS } from "./layers.js";

const SEGMENT = 8;

/** Deterministic 0..1 random from a segment index and a salt. */
function rand(k, salt, j = 0) {
  const x = Math.sin(k * 12.9898 + salt * 78.233 + j * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

/** Where (if anywhere) segment k has a lab bench. Shared by bench and monitor. */
function benchAt(k) {
  if (rand(k, 1) > 0.62) return null;
  return {
    side: rand(k, 2) < 0.5 ? -1 : 1,
    z: (rand(k, 3) - 0.5) * 3,
    yaw: (rand(k, 4) - 0.5) * 0.35,
    knocked: rand(k, 5) < 0.2,
  };
}

export class ShellTreadmill {
  constructor(kit, { segments = 30, behind = 40, themeAt }) {
    this.kit = kit;
    this.segments = segments;
    this.behind = behind;
    this.themeAt = themeAt;
    this.group = new THREE.Group();
    this.group.name = "Shell";
    this.slotK = new Array(segments).fill(null);
    this.collapseFront = -Infinity;
    this._m = new THREE.Matrix4();
    this._local = new THREE.Matrix4();
    this._seg = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._ownGeometries = [];
    this._laneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.55, 0.65) });

    const g = kit.geometries;
    const m = kit.materials;
    const gl = kit.glass;
    const frame = new THREE.TorusGeometry(7.2, 0.2, 6, 8);
    const frameGlow = new THREE.TorusGeometry(6.95, 0.04, 4, 8);
    this._ownGeometries.push(frame, frameGlow);

    const W = ["ward"];
    const B = ["bridge"];
    const A = ["atrium"];
    const WA = ["ward", "atrium"];
    const ALL = ["ward", "bridge", "atrium"];
    const oct = [0, 0, Math.PI / 8];
    this.specs = [
      { key: "laneL", geo: g.box, mat: this._laneMat, themes: ALL, o: [-1.6, 0.006, 0], s: [0.08, 0.012, 3.2] },
      { key: "laneR", geo: g.box, mat: this._laneMat, themes: ALL, o: [1.6, 0.006, 0], s: [0.08, 0.012, 3.2] },
      { key: "kerbL", geo: g.box, mat: m.stripCyan, themes: ALL, o: [-5.05, 0.02, 0], s: [0.1, 0.04, 8] },
      { key: "kerbR", geo: g.box, mat: m.stripCyan, themes: ALL, o: [5.05, 0.02, 0], s: [0.1, 0.04, 8] },

      { key: "floor", geo: g.box, mat: m.floor, themes: W, o: [0, -0.15, 0], s: [11.8, 0.3, 8.02], receive: true },
      { key: "wallL", geo: g.box, mat: m.wall, themes: W, o: [-5.95, 1.7, 0], s: [0.3, 3.4, 8.02], receive: true, cast: true },
      { key: "wallR", geo: g.box, mat: m.wall, themes: W, o: [5.95, 1.7, 0], s: [0.3, 3.4, 8.02], receive: true, cast: true },
      { key: "winL", geo: g.box, mat: gl.window, themes: W, o: [-5.95, 4.25, 0], s: [0.06, 1.7, 7.9], layer: LAYERS.GLASS },
      { key: "winR", geo: g.box, mat: gl.window, themes: W, o: [5.95, 4.25, 0], s: [0.06, 1.7, 7.9], layer: LAYERS.GLASS },
      { key: "sillL", geo: g.box, mat: m.steel, themes: W, o: [-5.85, 3.42, 0], s: [0.45, 0.1, 8], cast: true },
      { key: "sillR", geo: g.box, mat: m.steel, themes: W, o: [5.85, 3.42, 0], s: [0.45, 0.1, 8], cast: true },
      { key: "ceiling", geo: g.box, mat: m.ceiling, themes: W, o: [0, 5.35, 0], s: [12.2, 0.3, 8.02], cast: true },
      { key: "lightL", geo: g.box, mat: m.fixture, themes: W, o: [-2.6, 5.19, 0], s: [0.45, 0.04, 2.6], fixture: -1 },
      { key: "lightR", geo: g.box, mat: m.fixture, themes: W, o: [2.6, 5.19, 0], s: [0.45, 0.04, 2.6], fixture: 1 },
      { key: "postL", geo: g.box, mat: m.steel, themes: W, o: [-5.6, 2.6, -3.8], s: [0.4, 5.2, 0.4], every: 3, cast: true },
      { key: "postR", geo: g.box, mat: m.steel, themes: W, o: [5.6, 2.6, -3.8], s: [0.4, 5.2, 0.4], every: 3, cast: true },
      { key: "lintel", geo: g.box, mat: m.steel, themes: W, o: [0, 4.95, -3.8], s: [11.6, 0.4, 0.4], every: 3, cast: true },

      { key: "deck", geo: g.box, mat: m.deck, themes: B, o: [0, -0.15, 0], s: [11.8, 0.3, 8.02], receive: true },
      { key: "railL", geo: g.box, mat: gl.window, themes: B, o: [-5.7, 0.7, 0], s: [0.06, 1.25, 7.9], layer: LAYERS.GLASS, skip: 0.18 },
      { key: "railR", geo: g.box, mat: gl.window, themes: B, o: [5.7, 0.7, 0], s: [0.06, 1.25, 7.9], layer: LAYERS.GLASS, skip: 0.18 },
      { key: "handL", geo: g.box, mat: m.steel, themes: B, o: [-5.7, 1.36, 0], s: [0.12, 0.12, 8] },
      { key: "handR", geo: g.box, mat: m.steel, themes: B, o: [5.7, 1.36, 0], s: [0.12, 0.12, 8] },
      { key: "ledgeL", geo: g.box, mat: m.darkSteel, themes: B, o: [-5.95, -0.1, 0], s: [0.5, 0.45, 8.02], cast: true },
      { key: "ledgeR", geo: g.box, mat: m.darkSteel, themes: B, o: [5.95, -0.1, 0], s: [0.5, 0.45, 8.02], cast: true },
      { key: "underL", geo: g.box, mat: m.darkSteel, themes: B, o: [-3.2, -0.85, 0], s: [0.6, 1.1, 8.02] },
      { key: "underR", geo: g.box, mat: m.darkSteel, themes: B, o: [3.2, -0.85, 0], s: [0.6, 1.1, 8.02] },
      { key: "octFrame", geo: frame, mat: m.steel, themes: B, o: [0, 2.6, -3.8], r: oct, every: 2, cast: true },
      { key: "octGlow", geo: frameGlow, mat: m.stripCyan, themes: B, o: [0, 2.6, -3.55], r: oct, every: 2 },

      { key: "floorDark", geo: g.box, mat: m.floorDark, themes: A, o: [0, -0.15, 0], s: [11.8, 0.3, 8.02], receive: true },
      { key: "mirrorL", geo: g.box, mat: gl.wallMirror, themes: A, o: [-6.0, 5, 0], s: [0.1, 10, 7.9], layer: LAYERS.GLASS },
      { key: "mirrorR", geo: g.box, mat: gl.wallMirror, themes: A, o: [6.0, 5, 0], s: [0.1, 10, 7.9], layer: LAYERS.GLASS },
      { key: "colL", geo: g.box, mat: m.steel, themes: A, o: [-5.55, 5.5, -3.7], s: [0.7, 11, 0.7], cast: true },
      { key: "colR", geo: g.box, mat: m.steel, themes: A, o: [5.55, 5.5, -3.7], s: [0.7, 11, 0.7], cast: true },
      { key: "colGlowL", geo: g.box, mat: m.stripAmber, themes: A, o: [-5.16, 5.5, -3.7], s: [0.07, 10, 0.07] },
      { key: "colGlowR", geo: g.box, mat: m.stripAmber, themes: A, o: [5.16, 5.5, -3.7], s: [0.07, 10, 0.07] },
      { key: "skylight", geo: g.box, mat: gl.window, themes: A, o: [0, 11.1, 0], s: [12.2, 0.08, 7.9], layer: LAYERS.GLASS },
      { key: "roofBeam", geo: g.box, mat: m.darkSteel, themes: A, o: [0, 10.9, -3.7], s: [12.2, 0.5, 0.5], cast: true },
      { key: "balcL", geo: g.box, mat: m.darkSteel, themes: A, o: [-5.35, 6.2, 0], s: [1.1, 0.3, 8.02], cast: true },
      { key: "balcR", geo: g.box, mat: m.darkSteel, themes: A, o: [5.35, 6.2, 0], s: [1.1, 0.3, 8.02], cast: true },
      { key: "balcGlowL", geo: g.box, mat: m.stripAmber, themes: A, o: [-4.8, 6.38, 0], s: [0.05, 0.05, 8] },
      { key: "balcGlowR", geo: g.box, mat: m.stripAmber, themes: A, o: [4.8, 6.38, 0], s: [0.05, 0.05, 8] },

      /* ---- set dressing: a lab that has been evacuated, burned and shaken ---- */
      { key: "bench", geo: g.box, mat: m.laminate, themes: WA, cast: true, receive: true, place: (k) => {
        const b = benchAt(k); if (!b) return null;
        return { o: [b.side * 5.1, 0.47, b.z], r: [0, b.yaw, b.knocked ? 0.16 * b.side : 0], s: [1.0, 0.94, 2.6] };
      } },
      { key: "equipment", geo: g.box, mat: m.casing, themes: WA, perSlot: 2, cast: true, place: (k, j) => {
        const b = benchAt(k); if (!b || b.knocked) return null;
        const w = 0.3 + rand(k, 60, j) * 0.25;
        return { o: [b.side * 5.2, 0.94 + w * 0.5, b.z - 0.9 + j * 1.6], r: [0, rand(k, 61, j), 0], s: [w * 1.1, w, w] };
      } },
      { key: "monitor", geo: g.plane, mat: kit.monitor, themes: WA, place: (k) => {
        const b = benchAt(k); if (!b || b.knocked) return null;
        const fallen = rand(k, 7) < 0.25;
        return { o: [b.side * 5.05, fallen ? 1.0 : 1.2, b.z + 0.35], r: [fallen ? -1.2 : -0.05, b.side < 0 ? Math.PI / 2 : -Math.PI / 2, 0], s: [0.62, 0.4, 1] };
      } },
      { key: "gasGreen", geo: g.propCylinder, mat: m.cylinderGreen, themes: WA, perSlot: 2, cast: true, place: (k, j) => {
        if (rand(k, 10) > 0.35) return null;
        const side = benchAt(k) ? -benchAt(k).side : (rand(k, 11) < 0.5 ? -1 : 1);
        const z = (rand(k, 12) - 0.5) * 5 + j * 0.34;
        if (j === 1 && rand(k, 13) < 0.45) return { o: [side * 4.6, 0.12, z + 0.6], r: [0, 0.4, Math.PI / 2], s: [0.24, 1.4, 0.24] };
        return { o: [side * 5.45, 0.7, z], r: [0, 0, 0.04 * j], s: [0.24, 1.4, 0.24] };
      } },
      { key: "gasGrey", geo: g.propCylinder, mat: m.cylinderGrey, themes: WA, cast: true, place: (k) => {
        if (rand(k, 10) > 0.35) return null;
        const side = benchAt(k) ? -benchAt(k).side : (rand(k, 11) < 0.5 ? -1 : 1);
        return { o: [side * 5.45, 0.7, (rand(k, 12) - 0.5) * 5 - 0.36], s: [0.24, 1.4, 0.24] };
      } },
      { key: "extinguisher", geo: g.propCylinder, mat: m.extinguisher, themes: WA, place: (k) => {
        if (rand(k, 14) > 0.3) return null;
        const side = rand(k, 15) < 0.5 ? -1 : 1;
        return { o: [side * 5.7, 0.55, (rand(k, 16) - 0.5) * 6], s: [0.17, 0.55, 0.17] };
      } },
      { key: "bioBin", geo: g.box, mat: m.bioBin, themes: W, cast: true, place: (k) => {
        if (rand(k, 17) > 0.25) return null;
        const side = rand(k, 18) < 0.5 ? -1 : 1;
        return { o: [side * 5.4, 0.35, (rand(k, 19) - 0.5) * 6], r: [0, rand(k, 20), rand(k, 21) < 0.3 ? 1.4 : 0], s: [0.55, 0.7, 0.55] };
      } },
      { key: "cryoTank", geo: g.propCylinder, mat: m.frostTank, themes: A, perSlot: 2, cast: true, place: (k, j) => {
        if (rand(k, 22, j) > 0.45) return null;
        const side = j === 0 ? -1 : 1;
        return { o: [side * 4.95, 1.3, (rand(k, 23, j) - 0.5) * 5], s: [0.9, 2.6, 0.9] };
      } },
      { key: "papers", geo: g.plane, mat: m.paper, themes: ALL, perSlot: 7, place: (k, j) => ({
        o: [(rand(k, 30, j) - 0.5) * 10.4, 0.006 + j * 0.002, (rand(k, 31, j) - 0.5) * 7.6],
        r: [-Math.PI / 2, 0, rand(k, 32, j) * 6.28], s: [0.3, 0.41, 1],
      }) },
      { key: "rubble", geo: g.box, mat: m.rubble, themes: ALL, perSlot: 5, cast: true, place: (k, j) => {
        if (rand(k, 33, j) > 0.7) return null;
        const size = 0.12 + rand(k, 34, j) * 0.4;
        const side = rand(k, 35, j) < 0.5 ? -1 : 1;
        return { o: [side * (4.2 + rand(k, 36, j) * 1.3), size * 0.45, (rand(k, 37, j) - 0.5) * 7.6],
          r: [rand(k, 38, j) * 3, rand(k, 39, j) * 3, 0], s: [size * 1.4, size, size * 1.1] };
      } },
      { key: "ceilingTile", geo: g.plane, mat: m.ceiling, themes: W, perSlot: 2, cast: true, place: (k, j) => {
        if (rand(k, 40, j) > 0.38) return null;
        const side = j === 0 ? -1 : 1;
        return { o: [side * (1.8 + rand(k, 41, j) * 2.6), 4.75, (rand(k, 42, j) - 0.5) * 6],
          r: [Math.PI / 2 + (rand(k, 43, j) - 0.5) * 1.6, 0, (rand(k, 44, j) - 0.5) * 0.8], s: [1.2, 0.6, 1] };
      } },
      { key: "cable", geo: g.thinCylinder, mat: m.rubber, themes: W, perSlot: 3, place: (k, j) => {
        if (rand(k, 45, j) > 0.45) return null;
        const len = 0.9 + rand(k, 46, j) * 1.3;
        return { o: [(rand(k, 47, j) - 0.5) * 9, 5.2 - len / 2, (rand(k, 48, j) - 0.5) * 7], r: [(rand(k, 49, j) - 0.5) * 0.5, 0, (rand(k, 50, j) - 0.5) * 0.5], s: [0.04, len, 0.04] };
      } },
      { key: "deadFixture", geo: g.box, mat: m.darkSteel, themes: W, cast: true, place: (k) => {
        if (rand(k, 51) > 0.22) return null;
        const side = rand(k, 52) < 0.5 ? -1 : 1;
        return { o: [side * 2.6, 4.45, (rand(k, 53) - 0.5) * 3], r: [0.55 * (rand(k, 54) < 0.5 ? -1 : 1), 0, 0.1], s: [0.5, 0.06, 2.6] };
      } },
      { key: "scorchFloor", geo: g.plane, mat: m.crack, themes: ALL, perSlot: 2, place: (k, j) => {
        if (rand(k, 55, j) > 0.45) return null;
        const size = 1.6 + rand(k, 56, j) * 2.6;
        return { o: [(rand(k, 57, j) - 0.5) * 9, 0.012 + j * 0.001, (rand(k, 58, j) - 0.5) * 6], r: [-Math.PI / 2, 0, rand(k, 59, j) * 6.28], s: [size, size, 1] };
      } },
      { key: "scorchWall", geo: g.plane, mat: m.crack, themes: W, place: (k) => {
        if (rand(k, 62) > 0.45) return null;
        const side = rand(k, 63) < 0.5 ? -1 : 1;
        const size = 2.2 + rand(k, 64) * 2;
        return { o: [side * 5.78, 1.2 + rand(k, 65) * 1.2, (rand(k, 66) - 0.5) * 5], r: [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, rand(k, 67) * 6.28], s: [size, size, 1] };
      } },
      { key: "breachGlow", geo: g.plane, mat: m.emberGlow, themes: WA, layer: LAYERS.FX, place: (k) => {
        if (rand(k, 68) > 0.2) return null;
        const side = rand(k, 69) < 0.5 ? -1 : 1;
        return { o: [side * 5.78, 0.22, (rand(k, 70) - 0.5) * 5], r: [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0], s: [3.4, 0.55, 1] };
      } },
      { key: "emHousing", geo: g.box, mat: m.darkSteel, themes: WA, every: 2, place: (k, j, theme) => {
        const side = (k / 2) % 2 ? 1 : -1;
        return { o: [side * 5.7, theme === "atrium" ? 4.05 : 3.05, 0], s: [0.22, 0.2, 0.6] };
      } },
      { key: "emLamp", geo: g.box, mat: m.emergencyLamp, themes: WA, every: 2, place: (k, j, theme) => {
        const side = (k / 2) % 2 ? 1 : -1;
        return { o: [side * 5.58, theme === "atrium" ? 3.96 : 2.96, 0], s: [0.08, 0.07, 0.46] };
      } },
      { key: "exitSign", geo: g.plane, mat: m.exitSign, themes: W, every: 3, o: [0, 4.45, -3.55], s: [0.95, 0.36, 1] },
    ];

    this._colour = new THREE.Color();
    for (const [index, spec] of this.specs.entries()) {
      spec.perSlot = spec.perSlot ?? 1;
      spec.salt = index + 100;
      const mesh = new THREE.InstancedMesh(spec.geo, spec.mat, segments * spec.perSlot);
      mesh.name = `Shell_${spec.key}`;
      mesh.frustumCulled = false;
      mesh.castShadow = !!spec.cast;
      mesh.receiveShadow = !!spec.receive;
      mesh.layers.set(spec.layer ?? LAYERS.WORLD);
      for (let i = 0; i < segments * spec.perSlot; i += 1) mesh.setMatrixAt(i, this._zero);
      if (spec.fixture) for (let i = 0; i < segments; i += 1) mesh.setColorAt(i, this._colour.setRGB(0.03, 0.03, 0.035));
      spec.mesh = mesh;
      // Which instances currently hold a real (non-zero) transform.
      spec.used = new Uint8Array(segments * spec.perSlot);
      this.group.add(mesh);
    }
  }

  /** Force every slot to be re-stamped (after a restart). */
  reset() {
    this.slotK.fill(null);
    this.collapseFront = -Infinity;
  }

  _stamp(slot, k) {
    const centre = k * SEGMENT + SEGMENT / 2;
    const theme = this.themeAt(centre);
    let dropY = 0;
    let tilt = 0;
    let roll = 0;
    if (theme === "bridge" && centre + SEGMENT / 2 < this.collapseFront) {
      // Seconds since this slot let go, derived from the front's distance.
      const t = (this.collapseFront - (centre + SEGMENT / 2)) / 9;
      dropY = -4.9 * t * t;
      tilt = t * 0.35 * ((k % 2) * 2 - 1);
      roll = t * 0.22 * ((k % 3) - 1);
    }
    this._q.setFromEuler(this._e.set(tilt, 0, roll));
    this._seg.compose(this._p.set(0, dropY, -centre), this._q, this._s.set(1, 1, 1));
    for (const spec of this.specs) {
      for (let j = 0; j < spec.perSlot; j += 1) {
        let matrix = this._zero;
        const allowed = spec.themes.includes(theme) && !(spec.every && k % spec.every !== 0) && dropY > -120
          && !(spec.skip && rand(k, spec.salt) < spec.skip);
        const placed = allowed && spec.place ? spec.place(k, j, theme) : null;
        if (allowed && (!spec.place || placed)) {
          const [ox, oy, oz] = placed?.o ?? spec.o;
          const [rx, ry, rz] = placed?.r ?? spec.r ?? [0, 0, 0];
          const [sx, sy, sz] = placed?.s ?? spec.s ?? [1, 1, 1];
          this._q.setFromEuler(this._e.set(rx, ry, rz));
          this._local.compose(this._p.set(ox, oy, oz), this._q, this._s.set(sx, sy, sz));
          matrix = this._m.multiplyMatrices(this._seg, this._local);
        }
        const index = slot * spec.perSlot + j;
        spec.mesh.setMatrixAt(index, matrix);
        spec.used[index] = matrix === this._zero ? 0 : 1;
      }
      spec.mesh.instanceMatrix.needsUpdate = true;
    }
    this._dirty = true;
  }

  update(distance) {
    const firstK = Math.floor((distance - this.behind) / SEGMENT);
    for (let i = 0; i < this.segments; i += 1) {
      const k = firstK + i;
      const slot = ((k % this.segments) + this.segments) % this.segments;
      const falling = this.slotK[slot] === k && k * SEGMENT + SEGMENT < this.collapseFront && this.collapseFront - k * SEGMENT < 140;
      if (this.slotK[slot] !== k || falling) {
        this.slotK[slot] = k;
        this._stamp(slot, k);
      }
    }
    // A piece type with no live instances (e.g. atrium mirrors while on the
    // bridge) is hidden outright. Zero-scale instances are free to rasterise
    // but each InstancedMesh is still a draw call in every pass - world,
    // shadow map, and reflection probe - so this saves ~25 calls per pass.
    if (this._dirty) {
      this._dirty = false;
      for (const spec of this.specs) spec.mesh.visible = spec.used.some((u) => u === 1);
    }
  }

  /**
   * Animate the ceiling fluorescents. Each segment's pair is dead, flickering
   * or on, from a hash of its index; `tremor` (0..1) makes them all stutter.
   */
  updateFixtures(time, tremor = 0) {
    for (const spec of this.specs) {
      if (!spec.fixture) continue;
      for (let slot = 0; slot < this.segments; slot += 1) {
        const k = this.slotK[slot];
        if (k === null) continue;
        const state = rand(k, 50 + spec.fixture);
        let level;
        if (state < 0.42) level = 0.03;                                       // dead
        else if (state < 0.7) level = Math.sin(time * 31 + k * 7) * Math.sin(time * 13 + k) > 0.1 ? 1.1 : 0.12; // failing tube
        else level = 0.9 + 0.1 * Math.sin(time * 90 + k);                     // still on, humming
        if (tremor > 0.05 && Math.sin(time * 47 + k * 3 + spec.fixture) > 0.2 - tremor) level *= 0.08;
        spec.mesh.setColorAt(slot, this._colour.setRGB(level * 1.25, level * 1.3, level * 1.38));
      }
      spec.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** World-local positions of the nearest emergency lamps, for pooled lights. */
  emergencyLamps(distance, count, out = []) {
    out.length = 0;
    const k0 = Math.floor(distance / SEGMENT) - 1;
    for (let k = k0; k < k0 + 16 && out.length < count; k += 1) {
      if (k % 2 !== 0) continue;
      const theme = this.themeAt(k * SEGMENT + SEGMENT / 2);
      if (theme === "bridge") continue;
      const side = (k / 2) % 2 ? 1 : -1;
      out.push({ x: side * 5.2, y: theme === "atrium" ? 3.9 : 2.9, z: -(k * SEGMENT + SEGMENT / 2), k });
    }
    return out;
  }

  dispose() {
    for (const geometry of this._ownGeometries) geometry.dispose();
    this._laneMat.dispose();
    for (const spec of this.specs) spec.mesh.dispose?.();
    this.group.parent?.remove(this.group);
  }
}
