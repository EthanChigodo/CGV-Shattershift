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
import { createGlassCabinKit, GLASS_CABIN } from "./glass-cabin.js";

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
 * The glass cabin - the tower's one cabin design (glass-cabin.js), glass on
 * every side: the front and side walls single panes in their mullions (each
 * can crack and blow out, glass.js), a glass roof (the launcher comes
 * through it), and the door wall glass too - glass doors with lit edges in
 * a steel frame, the floor display on its header and the buttons on a jamb,
 * so from inside you see the shaft and the tower through it, as from
 * outside. Local frame: floor at y = 0, centred on x = z = 0, the doors on
 * the +Z side (toward the tower).
 */
export function buildCabin(shared, owned) {
  const root = new THREE.Group();
  root.name = "GravityLiftCabin";
  const H = CABIN.height;
  const W = CABIN.half;
  // Its conduits carry the ride's energy shader (red when the power stutters).
  const energy = owned.add(createEnergyMaterial(shared));
  const kit = createGlassCabinKit((x) => owned.add(x), { conduit: energy });
  const { steel: frame, darkSteel: dark, glass } = kit.materials;
  // One material per light bar, so each can flicker and die on its own.
  const STRIP = GLASS_CABIN.light;
  const strips = [0, 1].map(() => kit.lightMaterial());
  const display = displayTexture(owned);
  const displayMat = owned.add(new THREE.MeshBasicMaterial({ map: display }));

  const add = (material, sx, sy, sz, x, y, z, parent = root) => kit.box(parent, material, sx, sy, sz, x, y, z);

  // Deck, and the frame under it; the roof frame.
  kit.deck(root, 2 * W + 0.2, 2 * W + 0.2, 0.22);
  add(dark, 2 * W + 0.3, 0.2, 2 * W + 0.3, 0, -0.32, 0);
  for (const s of [-1, 1]) {
    add(frame, 2 * W + 0.2, 0.14, 0.14, 0, H, s * W);
    add(frame, 0.14, 0.14, 2 * W + 0.2, s * W, H, 0);
  }
  add(frame, 0.1, 0.1, 2 * W, 0, H, 0);
  // Corner posts, each carrying its conduit.
  for (const x of [-W, W]) for (const z of [-W, W]) kit.post(root, x, z, H, [-x, -z]);
  kit.lightBars(root, { span: W - 0.25, length: 2 * W - 0.4, y: H - 0.08, materials: strips });

  // Glass: front, sides (named, so they can crack and blow out one by one:
  // glass.js), the roof. Each pane's +Z faces into the cabin.
  const panes = {
    front: kit.glassWall(root, [-W, -W], [W, -W], H, { inward: [0, 1], single: true })[0],
    left: kit.glassWall(root, [-W, W], [-W, -W], H, { inward: [1, 0], single: true })[0],
    right: kit.glassWall(root, [W, -W], [W, W], H, { inward: [-1, 0], single: true })[0],
  };
  const roofPane = new THREE.Mesh(kit.geometries.plane, glass);
  roofPane.scale.set(2 * W, 2 * W, 1);
  roofPane.position.set(0, H, 0);
  roofPane.rotation.x = -Math.PI / 2;
  roofPane.renderOrder = 2;
  root.add(roofPane);
  panes.roof = roofPane;
  // A handrail round the three glass walls.
  const r = W - 0.12;
  kit.handrail(root, [-r + 0.15, -r], [r - 0.15, -r], [0, -1]);
  kit.handrail(root, [-r, r - 0.3], [-r, -r + 0.15], [-1, 0]);
  kit.handrail(root, [r, -r + 0.15], [r, r - 0.3], [1, 0]);

  // The door wall: glass either side of a steel door frame, two glass leaves
  // sliding apart along X, the floor display on the header inside.
  const doorW = 1.7;
  const doorH = 2.65;
  const jamb = doorW / 2 + GLASS_CABIN.post;
  for (const s of [-1, 1]) kit.glassWall(root, [s * W, W], [s * jamb, W], H, { inward: [0, -1] });
  kit.doorFrame(root, { width: doorW, height: doorH, z: W, inward: -1, depth: 0.22, ceiling: H });
  const doors = kit.doors(root, { width: doorW, height: doorH, z: W - 0.04 });
  const leaves = doors.leaves;
  const screen = new THREE.Mesh(kit.geometries.plane, displayMat);
  screen.scale.set(0.9, 0.34, 1);
  screen.position.set(0, (doorH + H) / 2, W - 0.115);
  screen.rotation.y = Math.PI;
  root.add(screen);

  // What it hangs from: a crosshead over the roof, a sheave, and the hoist
  // ropes running up the shaft to the machine room at the top of the tower.
  add(dark, 2 * W + 0.5, 0.26, 0.34, 0, H + 0.24, 0.2);
  for (const s of [-1, 1]) add(frame, 0.2, 0.5, 0.2, s * (W + 0.12), H + 0.14, 0.2);
  const sheave = new THREE.Mesh(owned.add(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 20)), frame);
  sheave.rotation.z = Math.PI / 2;
  sheave.position.set(0, H + 0.62, 0.2);
  root.add(sheave);
  const cables = new THREE.Group();
  cables.name = "HoistRopes";
  const ropeGeo = owned.add(new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true));
  const rope = owned.add(new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.8, roughness: 0.45 }));
  const ROPE = 900;
  for (const x of [-0.12, -0.04, 0.04, 0.12]) {
    const r = new THREE.Mesh(ropeGeo, rope);
    r.scale.set(1, ROPE, 1);
    r.position.set(x, H + 0.62 + ROPE / 2, 0.2);
    r.frustumCulled = false;
    cables.add(r);
  }
  root.add(cables);

  // Cabin light, and the red emergency beacon that takes over in a blackout.
  const light = new THREE.PointLight(0xfff2de, 9, 9, 1.6);
  light.position.set(0, H - 0.4, 0);
  root.add(light);
  const beaconMat = owned.add(new THREE.MeshBasicMaterial({ color: 0x220000 }));
  const beacon = add(beaconMat, 0.22, 0.12, 0.22, -(W - 0.3), H - 0.12, W - 0.3);
  const emergency = new THREE.PointLight(0xff1a0a, 0, 10, 1.4);
  emergency.position.set(-(W - 0.4), H - 0.35, W - 0.4);
  root.add(emergency);

  // Brake shoes gripping the rails at the four bottom corners - where the
  // sparks come from when the emergency brakes bite.
  const R = W + 0.42;
  const brakePoints = [];
  for (const x of [-R, R]) {
    for (const z of [-R, R]) {
      add(dark, 0.36, 0.3, 0.36, x, 0.05, z);
      add(frame, 0.12, 0.3, 0.5, x - Math.sign(x) * 0.24, 0.05, z - Math.sign(z) * 0.1);
      brakePoints.push(new THREE.Vector3(x, 0.05, z));
    }
  }

  return {
    root,
    leaves,
    light,
    strips,
    panes,
    beacon,
    brakePoints,
    energy,
    display,
    doorWidth: doorW,
    cables,
    /** The hoist ropes part: they whip up the shaft and are gone. */
    snapCables() {
      cables.userData.snapped = 0.001;
    },
    updateCables(dt) {
      if (!cables.userData.snapped || !cables.visible) return;
      cables.userData.snapped += dt;
      cables.position.y += (20 + 60 * cables.userData.snapped) * dt;
      cables.rotation.z = Math.sin(cables.userData.snapped * 9) * 0.02;
      if (cables.userData.snapped > 2.5) cables.visible = false;
    },
    /**
     * Lights, each 0..1: the main light, the two strip lights, and the red
     * emergency beacon (which pulses on its own when on).
     */
    setLights(main, stripA, stripB, red, time = 0) {
      light.intensity = 9 * main;
      strips[0].color.copy(STRIP).multiplyScalar(stripA);
      strips[1].color.copy(STRIP).multiplyScalar(stripB);
      const pulse = red * (0.55 + 0.45 * Math.max(0, Math.sin(time * 7)));
      emergency.intensity = 14 * pulse;
      beaconMat.color.setRGB(0.15 + 2.2 * pulse, 0.02 + 0.1 * pulse, 0.02);
    },
    /** 0 = shut, 1 = open. Eased. */
    setDoors(t) {
      doors.set(t);
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
