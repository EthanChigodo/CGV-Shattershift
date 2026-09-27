/**
 * Building blocks for the elevator rides: the world outside (sky, city,
 * skyline, the tower and its open lift shaft) and the glass cabin.
 *
 * Frame: the cabin rides up the +Y axis at x = z = 0. The tower's face is
 * behind it at z = +TOWER_FACE (the cabin doors open onto it) and the drop,
 * the city and the view are toward -Z. One world unit is one metre; a storey
 * is STOREY metres.
 *
 * Everything returned here is plain Three.js objects plus `dispose()`; the
 * ride (gravity-fault.js) decides what moves.
 */

import * as THREE from "../three.js";
import { createFacadeMaterial, createSkyMaterial, createCityMaterial, createEnergyMaterial } from "./shaders.js";

export const STOREY = 4;
/** Half the cabin's inside width and depth, and its inside height. */
export const CABIN = { half: 2, height: 3.2 };
export const TOWER_FACE = 3.4;
/** The ground, far below the lift's starting floor. */
export const CITY_Y = -460;
/** Tower top: comfortably above the highest point the ride reaches. */
export const TOWER_TOP = 520;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Collects geometries, materials and textures so one call frees them all. */
export class Owned {
  constructor() {
    this.items = [];
  }
  add(item) {
    this.items.push(item);
    return item;
  }
  dispose() {
    for (const item of this.items) item.dispose?.();
    this.items.length = 0;
  }
}

/* ------------------------------------------------------------------ world */

/**
 * Sky, city, skyline and the tower itself.
 * @param {object} shared  createRideUniforms()
 */
export function buildWorld(shared, owned) {
  const root = new THREE.Group();
  root.name = "RideWorld";
  const rand = seeded(212);

  const sky = new THREE.Mesh(owned.add(new THREE.SphereGeometry(2400, 32, 16)), owned.add(createSkyMaterial(shared)));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = "Sky";
  root.add(sky);

  const city = new THREE.Mesh(owned.add(new THREE.PlaneGeometry(6000, 6000)), owned.add(createCityMaterial(shared)));
  city.rotation.x = -Math.PI / 2;
  city.position.y = CITY_Y;
  city.name = "City";
  root.add(city);

  // The skyline: instanced boxes around the tower, all with the window shader.
  const skylineMat = owned.add(createFacadeMaterial(shared, { fireLine: CITY_Y + 120, seed: 11 }));
  const count = 70;
  const skyline = new THREE.InstancedMesh(owned.add(new THREE.BoxGeometry(1, 1, 1)), skylineMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2;
    // Keep the space behind the tower (toward +Z) clear of close buildings.
    const radius = 140 + rand() * 700;
    const x = Math.sin(angle) * radius;
    let z = -Math.cos(angle) * radius;
    if (z > -60 && Math.abs(x) < 120) z -= 200;
    const w = 26 + rand() * 40;
    const d = 26 + rand() * 40;
    const h = 180 + rand() * rand() * 700;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.floor(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.3);
    m.compose(new THREE.Vector3(x, CITY_Y + h / 2, z), q, new THREE.Vector3(w, h, d));
    skyline.setMatrixAt(i, m);
  }
  skyline.name = "Skyline";
  skyline.frustumCulled = false;
  root.add(skyline);

  // Ascension Tower. Burning below the lift's starting floor.
  const towerMat = owned.add(createFacadeMaterial(shared, { fireLine: -30, seed: 3, lit: 0.74 }));
  const towerH = TOWER_TOP - CITY_Y;
  const tower = new THREE.Mesh(owned.add(new THREE.BoxGeometry(46, towerH, 40)), towerMat);
  tower.position.set(0, CITY_Y + towerH / 2, TOWER_FACE + 20);
  tower.name = "AscensionTower";
  root.add(tower);

  // The Foundry's service door the lift leaves from (orange, lit, open).
  const doorGlow = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.62, 0.2) }));
  const door = new THREE.Mesh(owned.add(new THREE.PlaneGeometry(3.4, 3.6)), doorGlow);
  door.position.set(0, 1.8, TOWER_FACE - 0.02);
  door.rotation.y = Math.PI;
  root.add(door);

  return { root, sky, tower, towerMat, skylineMat };
}

/* ------------------------------------------------------------------ shaft */

/**
 * The open steel lattice the cabin climbs: four rails, ring beams every few
 * metres and red marker lamps. They stream past the camera, which is what
 * sells the speed.
 */
export function buildShaft(owned, { from = -120, to = TOWER_TOP - 20 } = {}) {
  const root = new THREE.Group();
  root.name = "LiftShaft";
  const steel = owned.add(new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.7, roughness: 0.45 }));
  const lampMat = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.08) }));
  const box = owned.add(new THREE.BoxGeometry(1, 1, 1));
  const R = CABIN.half + 0.42;
  const height = to - from;

  for (const x of [-R, R]) {
    for (const z of [-R, R]) {
      const rail = new THREE.Mesh(box, steel);
      rail.scale.set(0.22, height, 0.22);
      rail.position.set(x, from + height / 2, z);
      root.add(rail);
    }
  }
  // Ties back to the tower face.
  const spacing = 6;
  const rings = Math.floor(height / spacing);
  const beams = new THREE.InstancedMesh(box, steel, rings * 6);
  const lamps = new THREE.InstancedMesh(box, lampMat, Math.ceil(rings / 3) * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let b = 0;
  let l = 0;
  for (let i = 0; i < rings; i += 1) {
    const y = from + i * spacing;
    // Front and sides (thin) and two ties back into the tower.
    const parts = [
      [0, y, -R, 2 * R, 0.12, 0.12],
      [-R, y, 0, 0.12, 0.12, 2 * R],
      [R, y, 0, 0.12, 0.12, 2 * R],
      [0, y, R, 2 * R, 0.16, 0.16],
      [-R, y, (R + TOWER_FACE) / 2, 0.16, 0.16, TOWER_FACE - R],
      [R, y, (R + TOWER_FACE) / 2, 0.16, 0.16, TOWER_FACE - R],
    ];
    for (const [x, py, z, sx, sy, sz] of parts) {
      beams.setMatrixAt(b++, m.compose(p.set(x, py, z), q, s.set(sx, sy, sz)));
    }
    if (i % 3 === 0) {
      for (const x of [-R, R]) lamps.setMatrixAt(l++, m.compose(p.set(x, y + 0.3, -R - 0.14), q, s.set(0.12, 0.2, 0.06)));
    }
  }
  beams.count = b;
  lamps.count = l;
  beams.frustumCulled = false;
  lamps.frustumCulled = false;
  root.add(beams, lamps);
  return { root };
}

/* ------------------------------------------------------------------ cabin */

function floorTexture(owned) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2a2d31";
  ctx.fillRect(0, 0, 256, 256);
  // Tread plate.
  ctx.fillStyle = "#3a3e43";
  for (let y = 0; y < 256; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < 256; x += 16) ctx.fillRect(x + 3, y + 6, 9, 3);
  // Hazard border.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 256, 256);
  ctx.rect(22, 22, 212, 212);
  ctx.clip("evenodd");
  for (let i = -256; i < 512; i += 28) {
    ctx.fillStyle = "#d8a21a";
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 14, 0);
    ctx.lineTo(i + 14 - 256, 256);
    ctx.lineTo(i - 256, 256);
    ctx.fill();
  }
  ctx.restore();
  const texture = owned.add(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The floor display over the doors: floor number and direction. */
function displayTexture(owned) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const texture = owned.add(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  let last = "";
  texture.userData.draw = (text, colour = "#7ef4f1") => {
    const key = text + colour;
    if (key === last) return;
    last = key;
    ctx.fillStyle = "#050708";
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = colour;
    ctx.font = "bold 58px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 52);
    texture.needsUpdate = true;
  };
  return texture;
}

/**
 * The glass cabin. Local frame: floor at y = 0, centred on x = z = 0, the
 * doors on the +Z side (toward the tower), glass on the other three sides
 * and the roof.
 */
export function buildCabin(shared, owned) {
  const root = new THREE.Group();
  root.name = "GravityLiftCabin";
  const H = CABIN.height;
  const W = CABIN.half;
  const box = owned.add(new THREE.BoxGeometry(1, 1, 1));
  const frame = owned.add(new THREE.MeshStandardMaterial({ color: 0x5b6269, metalness: 0.85, roughness: 0.32 }));
  const dark = owned.add(new THREE.MeshStandardMaterial({ color: 0x1d2024, metalness: 0.6, roughness: 0.5 }));
  const floor = owned.add(new THREE.MeshStandardMaterial({ map: floorTexture(owned), metalness: 0.5, roughness: 0.6 }));
  const glass = owned.add(new THREE.MeshStandardMaterial({
    color: 0xa8e4ee, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
  }));
  const lightStrip = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.55, 1.4) }));
  const energy = owned.add(createEnergyMaterial(shared));
  const display = displayTexture(owned);
  const displayMat = owned.add(new THREE.MeshBasicMaterial({ map: display }));

  const add = (material, sx, sy, sz, x, y, z, parent = root) => {
    const mesh = new THREE.Mesh(box, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Floor and roof frame.
  add(floor, 2 * W + 0.2, 0.22, 2 * W + 0.2, 0, -0.11, 0);
  add(dark, 2 * W + 0.3, 0.2, 2 * W + 0.3, 0, -0.32, 0);
  for (const s of [-1, 1]) {
    add(frame, 2 * W + 0.2, 0.14, 0.14, 0, H, s * W);
    add(frame, 0.14, 0.14, 2 * W + 0.2, s * W, H, 0);
    // Handrails on three sides.
    add(frame, 0.05, 0.05, 2 * W - 0.2, s * (W - 0.12), 1.0, 0);
  }
  add(frame, 2 * W - 0.2, 0.05, 0.05, 0, 1.0, -(W - 0.12));
  for (const x of [-W, W]) for (const z of [-W, W]) add(frame, 0.14, H, 0.14, x, H / 2, z);
  // Cross members on the roof, and the ceiling light strips under them.
  add(frame, 0.1, 0.1, 2 * W, 0, H, 0);
  for (const s of [-1, 1]) add(lightStrip, 0.08, 0.03, 2 * W - 0.4, s * (W - 0.25), H - 0.09, 0);

  // Glass: front, sides, roof.
  const plane = owned.add(new THREE.PlaneGeometry(1, 1));
  const pane = (sx, sy, x, y, z, rx, ry) => {
    const mesh = new THREE.Mesh(plane, glass);
    mesh.scale.set(sx, sy, 1);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    mesh.renderOrder = 2;
    root.add(mesh);
    return mesh;
  };
  pane(2 * W, H, 0, H / 2, -W, 0, 0);
  pane(2 * W, H, -W, H / 2, 0, 0, Math.PI / 2);
  pane(2 * W, H, W, H / 2, 0, 0, -Math.PI / 2);
  pane(2 * W, 2 * W, 0, H, 0, -Math.PI / 2, 0);

  // Back wall with the doors (two leaves that slide apart along X).
  const doorW = 1.7;
  for (const s of [-1, 1]) add(dark, W - doorW / 2, H, 0.12, s * (doorW / 2 + (W - doorW / 2) / 2), H / 2, W);
  add(dark, doorW, 0.3, 0.12, 0, H - 0.15, W);
  const leaves = [-1, 1].map((s) => {
    const leaf = add(frame, doorW / 2, H - 0.3, 0.06, (s * doorW) / 4, (H - 0.3) / 2, W - 0.04);
    leaf.userData.side = s;
    return leaf;
  });
  const screen = new THREE.Mesh(plane, displayMat);
  screen.scale.set(0.9, 0.34, 1);
  screen.position.set(0, H - 0.5, W - 0.08);
  screen.rotation.y = Math.PI;
  root.add(screen);

  // Energy conduits up the back corners (the brief's energy shader).
  const conduitGeo = owned.add(new THREE.CylinderGeometry(0.07, 0.07, H - 0.2, 12, 1, true));
  for (const s of [-1, 1]) {
    const conduit = new THREE.Mesh(conduitGeo, energy);
    conduit.position.set(s * (W - 0.14), H / 2, W - 0.14);
    root.add(conduit);
  }

  // Cabin light: one point light that goes red in the fault.
  const light = new THREE.PointLight(0xfff2de, 9, 9, 1.6);
  light.position.set(0, H - 0.4, 0);
  root.add(light);

  return {
    root,
    leaves,
    light,
    lightStrip,
    energy,
    display,
    doorWidth: doorW,
    /** 0 = shut, 1 = open. Eased. */
    setDoors(t) {
      const k = THREE.MathUtils.clamp(t, 0, 1);
      const e = k * k * (3 - 2 * k);
      for (const leaf of leaves) leaf.position.x = (leaf.userData.side * doorW) / 4 + leaf.userData.side * (doorW / 2 - 0.05) * e;
    },
  };
}

/* ----------------------------------------------------------------- figure */

/**
 * Subject 07, in patient scrubs: a simple jointed figure for the outside
 * shots (the first-person shots hide it). Joints are groups, so a pose is
 * just rotations - `pose()` blends standing and floating.
 */
export function buildFigure(owned) {
  const root = new THREE.Group();
  root.name = "Subject07";
  const scrubs = owned.add(new THREE.MeshStandardMaterial({ color: 0x5f8a8f, roughness: 0.85 }));
  const skin = owned.add(new THREE.MeshStandardMaterial({ color: 0xc79a80, roughness: 0.7 }));
  const hair = owned.add(new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.9 }));
  const limb = owned.add(new THREE.CapsuleGeometry(0.075, 0.62, 4, 8));
  const arm = owned.add(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8));
  const torsoGeo = owned.add(new THREE.CapsuleGeometry(0.19, 0.45, 4, 10));
  const headGeo = owned.add(new THREE.SphereGeometry(0.13, 16, 12));

  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);
  const torso = new THREE.Mesh(torsoGeo, scrubs);
  torso.position.y = 0.36;
  torso.scale.set(1, 1, 0.72);
  hips.add(torso);
  const neck = new THREE.Group();
  neck.position.y = 0.72;
  hips.add(neck);
  const head = new THREE.Mesh(headGeo, skin);
  head.position.y = 0.13;
  neck.add(head);
  const cap = new THREE.Mesh(headGeo, hair);
  cap.scale.set(1.04, 0.7, 1.04);
  // Hair sits toward the back of the head; the figure faces -Z.
  cap.position.set(0, 0.17, 0.03);
  neck.add(cap);

  const joint = (parent, x, y, geometry, material, length) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    parent.add(g);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -length / 2;
    g.add(mesh);
    return g;
  };
  const legs = [-1, 1].map((s) => joint(hips, s * 0.11, 0, limb, scrubs, 0.78));
  const arms = [-1, 1].map((s) => joint(hips, s * 0.27, 0.64, arm, scrubs, 0.62));
  for (const a of arms) {
    const hand = new THREE.Mesh(headGeo, skin);
    hand.scale.setScalar(0.38);
    hand.position.y = -0.66;
    a.add(hand);
  }

  return {
    root,
    /**
     * @param {number} float  0 = standing, 1 = drifting weightless
     * @param {number} time
     */
    pose(float, time) {
      const f = THREE.MathUtils.clamp(float, 0, 1);
      const sway = Math.sin(time * 1.3);
      for (let i = 0; i < 2; i += 1) {
        const s = i ? 1 : -1;
        arms[i].rotation.z = s * (0.12 + f * (1.1 + 0.2 * Math.sin(time * 1.7 + i)));
        arms[i].rotation.x = -f * 0.4 * sway * s;
        legs[i].rotation.x = f * (0.35 * Math.sin(time * 1.1 + i * 2.1) - 0.1);
        legs[i].rotation.z = s * f * 0.22;
      }
      neck.rotation.x = -0.1 * f + 0.05 * sway;
    },
  };
}
