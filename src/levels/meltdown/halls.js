/**
 * Halls - the big rooms the route runs through.
 *
 * The corridor is where obstacles come thick and fast; the halls are where
 * the level shows what this building was. Each one is a large room (about
 * 32 m wide and 12-16 m tall against the corridor's 14 x 8.4) with its own
 * identity, entered and left through doorways in its end walls. The route,
 * and so the lanes and every hazard on them, carries straight through.
 *
 * Local space: origin on the floor at the hall's centre, -Z is the direction
 * of travel (the same convention as every kit piece, so `route.place` puts a
 * hall down correctly).
 *
 * Draw calls: a hall is hundreds of small meshes. `bakeStatic` merges every
 * non-moving, non-swappable mesh by material afterwards, which is what keeps
 * a hall to a few dozen draw calls instead of several hundred.
 */

import * as THREE from "../../three.js";
import { BufferGeometryUtils } from "../../three-addons.js";

export const HALL_THEMES = {
  ward: { name: "RECOVERY WARD", wall: "wardWall", height: 11, pillars: true, vents: false, fans: true },
  lab: { name: "RESEARCH LAB", wall: "wardWall", height: 12, pillars: true, vents: true, fans: false },
  containment: { name: "CONTAINMENT BLOCK", wall: "steelWall", height: 12, pillars: true, vents: true, fans: false },
  experiment: { name: "EXPERIMENT CHAMBER", wall: "steelWall", height: 17, pillars: false, vents: false, fans: false },
  archive: { name: "RECORDS ARCHIVE", wall: "concreteWall", height: 12, pillars: true, vents: false, fans: true },
  boiler: { name: "BOILER HALL", wall: "concreteWall", height: 14, pillars: true, vents: true, fans: false },
};

/**
 * @param kit           the level's kit
 * @param {object} spec
 * @param {string} spec.theme          key of HALL_THEMES
 * @param {number} spec.length         along the route
 * @param {number} spec.halfWidth
 * @param {number} spec.corridorHalf   half-width of the doorways
 * @param {number} spec.corridorHeight height of the doorways
 * @param {number} spec.seed
 */
export function buildHall(kit, { theme = "lab", length = 44, halfWidth = 16, corridorHalf = 7, corridorHeight = 8.4, seed = 1 } = {}) {
  const T = HALL_THEMES[theme] ?? HALL_THEMES.lab;
  const H = T.height;
  const W = halfWidth;
  const L = length;
  const c = corridorHalf;
  const { box, materials: mat } = kit;

  const hall = new THREE.Group();
  hall.name = `Hall_${theme}`;
  const ticking = [];
  const owned = { materials: [], textures: [] };

  let value = seed * 7919 + 17;
  const random = () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };

  /** Place a kit piece in hall space and remember it if it animates. */
  const put = (piece, x, z, { y = 0, rotY = 0 } = {}) => {
    piece.position.set(x, y, z);
    piece.rotation.y = rotY;
    hall.add(piece);
    if (typeof piece.userData.tick === "function") ticking.push(piece);
    return piece;
  };

  /** A material clone whose textures repeat per `tile` metres over a w x h face. */
  const tiled = (base, w, h, tile = 4) => {
    const m = base.clone();
    for (const key of ["map", "normalMap"]) {
      if (!base[key]) continue;
      const t = base[key].clone();
      t.repeat.set(Math.max(1, w / tile), Math.max(1, h / tile));
      t.needsUpdate = true;
      m[key] = t;
      owned.textures.push(t);
    }
    owned.materials.push(m);
    return m;
  };

  /* ---------------- Shell ---------------- */

  const floorMat = tiled(mat.floor, W * 2, L, 3.6);
  hall.add(box(W * 2, 0.3, L, floorMat, -0.31));
  hall.add(box(W * 2, 0.4, L, mat.trim, H));

  const wallMat = tiled(mat[T.wall], L, H, 7);
  for (const side of [-1, 1]) {
    hall.add(box(0.5, H, L, wallMat, 0, side * W));
    // Skirting and a mid-height service trim, so the long walls have lines.
    hall.add(box(0.2, 0.5, L, mat.trim, 0, side * (W - 0.3)));
    hall.add(box(0.15, 0.2, L, mat.trim, H * 0.55, side * (W - 0.3)));
  }

  const endMat = tiled(mat[T.wall], W - c, H, 7);
  for (const z of [-L / 2, L / 2]) {
    for (const side of [-1, 1]) {
      hall.add(box(W - c, H, 0.5, endMat, 0, side * (c + (W - c) / 2), z));
    }
    // Lintel over the doorway, with a hazard-striped header.
    hall.add(box(c * 2, H - corridorHeight, 0.5, endMat, corridorHeight, 0, z));
    hall.add(box(c * 2, 0.6, 0.6, mat.hazard, corridorHeight - 0.6, 0, z));
  }

  // Ceiling structure: cross beams and two longitudinal girders.
  for (let z = -L / 2 + 3; z < L / 2; z += 6) hall.add(box(W * 2, 0.6, 0.5, mat.darkMetal, H - 0.6, 0, z));
  for (const side of [-1, 1]) hall.add(box(0.6, 0.8, L, mat.darkMetal, H - 1.4, side * W * 0.45));

  // Hanging work lamps - real pooled-light emitters.
  for (let z = -L / 2 + 6; z < L / 2 - 2; z += 11) {
    for (const side of [-1, 1]) {
      const lamp = new THREE.Group();
      lamp.add(box(0.05, 2, 0.05, mat.trim, H - 2));
      const shade = box(1.2, 0.25, 1.2, mat.darkMetal, H - 2.25);
      lamp.add(shade);
      lamp.add(box(0.9, 0.05, 0.9, mat.lightTube, H - 2.3));
      const anchor = new THREE.Object3D();
      anchor.position.y = H - 2.6;
      lamp.add(anchor);
      const flicker = random() < 0.3;
      const phase = random() * 10;
      lamp.userData.emitter = {
        kind: "point", anchor, color: 0xffd8a8, base: 9, distance: 18,
        intensityAt: (t) => (flicker && Math.sin(t * 13 + phase) > 0.7 ? 1.5 : 8),
      };
      put(lamp, side * W * 0.45, z);
    }
  }

  if (T.pillars) {
    for (let z = -L / 2 + 5; z < L / 2 - 3; z += 9) {
      for (const side of [-1, 1]) {
        const x = side * (c + 1.5);
        hall.add(box(1.0, H, 1.0, mat.darkMetal, 0, x, z));
        hall.add(box(1.15, 1.3, 1.15, mat.hazard, 0, x, z));
        if (random() < 0.5) put(kit.alarmBeacon({ x: 0, y: 4.2, speed: 3 + random() * 2, phase: random() * 6 }), x - side * 0.6, z);
      }
    }
  }

  if (T.vents) put(kit.ventNetwork({ width: W * 2 - 6, length: L - 8 }), 0, 0, { y: H - 0.6 });

  if (T.fans) {
    for (let z = -L / 2 + 8; z < L / 2 - 4; z += 12) {
      for (const side of [-1, 1]) put(kit.ceilingFanUnit(), side * W * 0.7, z, { y: H - 0.5 });
    }
  }

  for (const side of [-1, 1]) {
    for (let z = -L / 2 + 4; z < L / 2; z += 16) {
      put(kit.securityCam({ side }), side * (W - 0.35), z + random() * 3, { y: H * 0.6 });
    }
  }

  /* ---------------- Theme dressing ---------------- */

  const sideZone = (side, depth) => side * (W - depth); // x measured in from a side wall

  const dress = {
    ward() {
      for (const side of [-1, 1]) {
        for (let z = -L / 2 + 4; z < L / 2 - 3; z += 4.6) {
          const tipped = random() < 0.35 ? (random() - 0.5) * 0.8 : 0;
          put(kit.labGurney({ tipped }), sideZone(side, 2.6), z, { rotY: Math.PI / 2 + (random() - 0.5) * 0.3 });
          put(kit.curtainRail({ length: 3.6 }), sideZone(side, 2.6), z + 2.3, { rotY: Math.PI / 2 });
          if (random() < 0.7) put(kit.ivStand(), sideZone(side, 1.2), z - 1.1);
        }
        put(kit.shelfUnit(), sideZone(side, 7.2), -L / 2 + 6, { rotY: Math.PI / 2 });
      }
      put(kit.consolePanel({ side: 1 }), c + 2.5, 2);
      put(kit.labBench({ scope: false }), c + 2.8, 5, { rotY: Math.PI / 2 });
    },

    lab() {
      for (const side of [-1, 1]) {
        for (let z = -L / 2 + 5; z < L / 2 - 4; z += 5) {
          for (const depth of [4.2, 8.2]) {
            put(kit.labBench({ scope: random() < 0.7 }), sideZone(side, depth), z, { rotY: (random() - 0.5) * 0.25 });
          }
        }
        for (let z = -L / 2 + 3; z < L / 2 - 2; z += 4) {
          put(kit.shelfUnit(), sideZone(side, 0.6), z, { rotY: side * Math.PI / 2 });
        }
      }
      for (let i = 0; i < 3; i += 1) {
        put(kit.specimenTank({ seed: i + seed, occupied: i === 1, broken: i === 2 }), -(c + 3 + i * 2.6), L / 2 - 7);
      }
      put(kit.consolePanel({ side: -1 }), -(c + 2), -2);
    },

    containment() {
      for (const side of [-1, 1]) {
        for (let z = -L / 2 + 4; z < L / 2 - 3; z += 5.2) {
          put(kit.labCell({ side, broken: random() < 0.3, seed: Math.round(z) + seed }), sideZone(side, 3.9), z);
        }
        put(kit.cagePanel({ length: L - 10 }), side * (c + 3.2), 0);
      }
      for (let i = 0; i < 4; i += 1) {
        put(kit.specimenTank({ seed: i + 3, broken: true }), (i % 2 ? 1 : -1) * (c + 5.5), -L / 2 + 8 + i * 8);
      }
    },

    experiment() {
      put(kit.experimentRing({ height: 15 }), 0, 0);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 3 - 0.5) * 1.6;
          put(kit.consolePanel({ side }), side * (c + 3 + Math.cos(a) * 3), Math.sin(a) * 7);
        }
        for (let z = -L / 2 + 4; z < L / 2 - 3; z += 7) {
          put(kit.specimenTank({ seed: Math.round(z), occupied: random() < 0.5, broken: random() < 0.4 }), sideZone(side, 2), z);
        }
        put(kit.pipeWall({ length: L - 6, height: 9 }), side * (W - 0.8), 0, { rotY: 0 });
        put(kit.hangingCables({ seed: seed + side }), side * (c + 2), -10);
        put(kit.hangingCables({ seed: seed + side * 3 }), side * (c + 4), 9);
      }
    },

    archive() {
      for (const side of [-1, 1]) {
        for (let z = -L / 2 + 4; z < L / 2 - 3; z += 3.2) {
          for (const depth of [2.5, 5.5]) {
            const shelf = kit.shelfUnit();
            shelf.scale.set(1, 1.6, 1);
            const toppled = random() < 0.12;
            if (toppled) shelf.rotation.z = side * 1.35;
            put(shelf, sideZone(side, depth), z, { rotY: Math.PI / 2 });
          }
        }
        for (let i = 0; i < 3; i += 1) {
          put(kit.fireSpot({ width: 2.2, depth: 1.8, height: 2.4 }), sideZone(side, 4 + random() * 3), -L / 2 + 8 + i * 13);
        }
      }
      put(kit.labBench({ scope: false }), c + 2, 0, { rotY: Math.PI / 2 });
      put(kit.labBench({ scope: false }), -(c + 2), 6, { rotY: Math.PI / 2 });
    },

    boiler() {
      for (const side of [-1, 1]) {
        put(kit.pipeWall({ length: L - 4, height: 11 }), side * (W - 0.9), 0);
        for (let z = -L / 2 + 6; z < L / 2 - 4; z += 9) {
          put(kit.ventFanUnit(), sideZone(side, 4), z, { rotY: side * Math.PI / 2 });
          put(kit.utilityBoxUnit(), sideZone(side, 0.5), z + 3, { rotY: side * Math.PI / 2 });
        }
        put(kit.cagePanel({ length: L - 12 }), side * (c + 2.4), 0);
        for (let i = 0; i < 4; i += 1) {
          put(kit.fireSpot({ width: 2.4, depth: 2, height: 3.2 }), sideZone(side, 6.5 + random() * 2), -L / 2 + 6 + i * 10);
        }
      }
    },
  };
  dress[theme]?.();

  // Every hall is on fire somewhere, and full of smoke up in the roof.
  const fires = theme === "boiler" || theme === "archive" ? 0 : 3;
  for (let i = 0; i < fires; i += 1) {
    const side = random() < 0.5 ? -1 : 1;
    put(kit.fireSpot({ width: 1.8 + random(), depth: 1.5, height: 2 + random() * 1.2 }), side * (c + 1 + random() * (W - c - 3)), -L / 2 + 5 + random() * (L - 10));
  }
  for (let i = 0; i < 4; i += 1) {
    const smoke = kit.smokeJet({ count: 12 });
    put(smoke, (random() - 0.5) * W * 1.4, -L / 2 + 5 + random() * (L - 10), { y: H * 0.55 });
  }

  bakeStatic(hall);

  hall.userData.tick = (dt, time) => {
    for (const piece of ticking) piece.userData.tick(dt, time);
  };
  hall.userData.dispose = () => {
    for (const m of owned.materials) m.dispose();
    for (const t of owned.textures) t.dispose();
  };
  hall.userData.hallName = T.name;
  return hall;
}

/**
 * Merge every static mesh under `root` into one mesh per material.
 *
 * Skips anything that has to stay a separate object: animated pieces (any
 * ancestor with a tick), asset slots and their stand-ins (swapped later),
 * instanced fire, particles, and invisible colliders.
 */
export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMaterial = new Map();
  const remove = [];

  const skip = (object) => {
    for (let o = object; o && o !== root; o = o.parent) {
      if (typeof o.userData.tick === "function" || o.userData.assetSlot || o.userData.isPlaceholder) return true;
    }
    return false;
  };

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (!o.material || Array.isArray(o.material) || o.material.isShaderMaterial || o.material.visible === false) return;
    if (skip(o)) return;
    const geometry = o.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, o.matrixWorld));
    for (const name of Object.keys(geometry.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) geometry.deleteAttribute(name);
    }
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(geometry.index ? geometry.toNonIndexed() : geometry);
    remove.push(o);
  });

  for (const o of remove) o.parent.remove(o);

  for (const [material, geometries] of byMaterial) {
    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.name = "Baked";
    m.userData.disposeGeometry = merged;
    root.add(m);
  }
}
