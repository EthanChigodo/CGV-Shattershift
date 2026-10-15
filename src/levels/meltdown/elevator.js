/**
 * Level 3's lifts: glass, like every lift in the tower (the Calibration
 * Lift's look - glass doors with a lit edge, glass walls between steel posts
 * carrying cyan conduits; frosted, standing in from the walls around it).
 *
 * Level 3 opens with the player stepping out of a freight lift (arriving from
 * Level 2), ends Phase A by running into another one as the fire catches up,
 * and Phase B starts with the doors of the roof's lift housing opening.
 * A teammate is building the real elevator and its cutscenes; this file is
 * the stand-in and the seam:
 *
 *   - `createLift(kit, options)` builds the lift: a door surround, two sliding
 *     leaves, the cabin behind them, a floor indicator. Swap in the real model
 *     here and keep the returned API (`setDoors`, `setLight`, `setIndicator`,
 *     `dispose`) and nothing else has to change.
 *   - The cutscenes are plain data - where the camera is and looks, where the
 *     player is and what they are doing - produced by `arrivalCutscene` /
 *     `departureCutscene` in MeltdownLevel and `_updateArrival` in RoofLevel,
 *     and applied by the host (src/levels/meltdown/game.js). Replace those
 *     timelines to restage them.
 *   - Both levels emit events at each step ("lift-arrived", "lift-open",
 *     "lift-exit", "lift-close", "lift-depart"), for sound and for hooking a
 *     real cutscene in.
 *
 * Local frame: the doorway is the plane z = 0, the floor is y = 0, the cabin
 * is behind the doors toward +Z and the corridor side is -Z (the way the
 * player faces when walking out). `cabinAhead: true` turns the cabin round,
 * for a lift at the end of a corridor that the player walks *into*.
 */

import * as THREE from "../../three.js";

/** Freight lift: wide enough for all three lanes, tall enough for the chase camera. */
export const FREIGHT_LIFT = { width: 6.6, height: 4.6, depth: 8 };
/** The roof's lift housing: an ordinary passenger lift. */
export const ROOF_LIFT = { width: 2.4, height: 2.5, depth: 2.3 };

function indicatorTexture(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const draw = (label, arrow) => {
    ctx.fillStyle = "#070504";
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = "#3a2a1c";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 122);
    ctx.fillStyle = "#ffb03c";
    ctx.font = "bold 72px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 150, 68);
    if (arrow) {
      ctx.beginPath();
      ctx.moveTo(48, 36);
      ctx.lineTo(78, 76);
      ctx.lineTo(18, 76);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(38, 76, 20, 20);
    }
    texture.needsUpdate = true;
  };
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.draw = draw;
  draw(text, true);
  return texture;
}

/**
 * @param {object} kit   createMeltdownKit() - supplies shared geometry and materials
 * @param {object} [o]
 * @param {number} [o.width]  doorway / cabin width  (default: freight lift)
 * @param {number} [o.height]
 * @param {number} [o.depth]  cabin depth behind the doors
 * @param {number} [o.wallHalfWidth]  half-width of the wall around the doorway (0 = no wall)
 * @param {number} [o.wallHeight]
 * @param {boolean} [o.cabinAhead]  cabin toward -Z instead of +Z
 * @param {string} [o.label]  floor indicator text
 */
export function createLift(kit, { width, height, depth, wallHalfWidth = 0, wallHeight = 0, cabinAhead = false, label = "B2" } = {}) {
  const W = width ?? FREIGHT_LIFT.width;
  const H = height ?? FREIGHT_LIFT.height;
  const D = depth ?? FREIGHT_LIFT.depth;
  const { materials: mat, geometries: geo } = kit;

  const outer = new THREE.Group();
  outer.name = "Lift";
  const group = new THREE.Group();
  if (cabinAhead) group.rotation.y = Math.PI;
  outer.add(group);

  const owned = [];
  const own = (m) => (owned.push(m), m);
  // Glass, as the Calibration Lift's (src/levels/common/calibration-lift.js).
  const cabinWall = own(new THREE.MeshStandardMaterial({ color: 0xe8fbff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, emissive: 0x0b2a30, emissiveIntensity: 1, envMapIntensity: 0.4 }));
  const doorMat = own(new THREE.MeshStandardMaterial({ color: 0xdff8ff, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.5 }));
  const steel = own(new THREE.MeshStandardMaterial({ color: 0x737c80, metalness: 0.75, roughness: 0.4, envMapIntensity: 0.45 }));
  const conduit = own(new THREE.MeshBasicMaterial({ color: 0x7ef4f1 }));
  const lamp = own(new THREE.MeshBasicMaterial({ color: 0xfff0d6 }));
  const indicator = indicatorTexture(label);
  const indicatorMat = own(new THREE.MeshBasicMaterial({ map: indicator }));

  const box = (w, h, d, material, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo.unitBox, material);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // The wall the doors are set into (optional: the roof housing has its own).
  const T = 0.5;
  if (wallHalfWidth > W / 2) {
    const side = wallHalfWidth - W / 2;
    for (const s of [-1, 1]) box(side, wallHeight, T, mat.darkMetal, s * (W / 2 + side / 2), wallHeight / 2, 0);
    box(W, wallHeight - H, T, mat.darkMetal, 0, H + (wallHeight - H) / 2, 0);
  }
  // Frame, sill and hazard jambs on the corridor side.
  for (const s of [-1, 1]) {
    box(0.3, H + 0.3, 0.2, mat.trim, s * (W / 2 + 0.15), (H + 0.3) / 2, -T / 2 - 0.05);
    box(0.12, H, 0.04, mat.hazard, s * (W / 2 + 0.15), H / 2, -T / 2 - 0.17);
  }
  box(W + 0.6, 0.3, 0.2, mat.trim, 0, H + 0.15, -T / 2 - 0.05);
  box(W, 0.04, 0.6, mat.hazard, 0, 0.02, -0.1);

  // Floor indicator over the doors.
  const panel = new THREE.Mesh(geo.unitPlane, indicatorMat);
  panel.scale.set(Math.min(1.4, W * 0.4), Math.min(0.7, W * 0.2), 1);
  panel.position.set(0, H + 0.3 + panel.scale.y / 2 + 0.1, -T / 2 - 0.16);
  panel.rotation.y = Math.PI;
  group.add(panel);

  // Doors: two glass leaves meeting in the middle, a lit inner edge on each.
  const leaves = [-1, 1].map((s) => {
    const leaf = box(W / 2 + 0.02, H, 0.06, doorMat, (s * W) / 4, H / 2, 0);
    box(0.05 / (W / 2 + 0.02), 1, 1.4, conduit, -s * 0.49, 0, 0, leaf);
    leaf.userData.side = s;
    return leaf;
  });

  // The cabin: a steel floor and roof, glass walls between steel posts with
  // conduits. The glass stands in from whatever is around the lift (the
  // Labs' start room, the roof's hut) - flush against those walls, the two
  // surfaces flickered through each other - and is frosted, so it reads as
  // a cabin rather than as the room's own wall.
  const Z = D / 2 + T / 2;
  const IN = W / 2 - 0.18;
  const BACK = D + T / 2 - 0.18;
  box(W, 0.2, D, steel, 0, -0.1, Z);
  box(W, 0.2, D, steel, 0, H + 0.1, Z);
  for (const s of [-1, 1]) {
    box(0.03, H, D - 0.36, cabinWall, s * IN, H / 2, Z - 0.18);
    box(0.06, 0.06, D * 0.8, mat.trim, s * (IN - 0.07), 1.0, Z);
    for (const z of [T / 2 + 0.1, BACK]) {
      box(0.16, H, 0.16, steel, s * IN, H / 2, z);
      box(0.06, H - 0.1, 0.06, conduit, s * (IN - 0.14), H / 2, z + (z < Z ? 0.12 : -0.12));
    }
  }
  box(2 * IN, H, 0.03, cabinWall, 0, H / 2, BACK);
  // Mullions: the glass in panels, so it reads as glass.
  const panels = Math.max(1, Math.round(D / 2));
  for (const s of [-1, 1]) {
    box(0.05, 0.07, D - 0.36, steel, s * IN, H * 0.68, Z - 0.18);
    for (let i = 1; i < panels; i += 1) box(0.05, H, 0.07, steel, s * IN, H / 2, T / 2 + ((D - 0.36) * i) / panels);
  }
  for (let i = 1; i < Math.round(W / 2); i += 1) box(0.07, H, 0.05, steel, -IN + (2 * IN * i) / Math.round(W / 2), H / 2, BACK);
  box(2 * IN, 0.07, 0.05, steel, 0, H * 0.68, BACK);
  box(2 * IN - 0.2, 0.05, 0.08, conduit, 0, H - 0.03, Z);
  box(0.08, 0.05, D - 0.4, conduit, 0, H - 0.03, Z);
  const light = new THREE.Mesh(geo.unitPlane, lamp);
  light.scale.set(W * 0.3, D * 0.5, 1);
  light.rotation.x = Math.PI / 2;
  light.position.set(0, H - 0.02, D / 2 + T / 2);
  group.add(light);

  const api = {
    width: W,
    height: H,
    depth: D,
    /** Where to stand in the cabin, in the lift's outer local space. */
    cabinCentre: new THREE.Vector3(0, 0, (cabinAhead ? -1 : 1) * (D / 2 + T / 2)),
    open: 0,
    /** 0 = shut, 1 = fully open. Eased here, so callers can pass a linear ramp. */
    setDoors(t) {
      const k = THREE.MathUtils.clamp(t, 0, 1);
      api.open = k;
      const e = k * k * (3 - 2 * k);
      for (const leaf of leaves) leaf.position.x = (leaf.userData.side * W) / 4 + leaf.userData.side * (W / 2) * e;
    },
    /** Cabin light, 0..1 (flicker it for a lift that has just stopped hard). */
    setLight(v) {
      lamp.color.setRGB(0.78, 0.73, 0.65).multiplyScalar(0.15 + 0.85 * THREE.MathUtils.clamp(v, 0, 1));
      cabinWall.emissiveIntensity = 0.2 + 0.8 * v;
      conduit.color.setHex(0x7ef4f1).multiplyScalar(0.25 + 0.75 * THREE.MathUtils.clamp(v, 0, 1));
    },
    setIndicator(text, arrow = true) {
      indicator.userData.draw(text, arrow);
    },
    dispose() {
      for (const m of owned) m.dispose();
      indicator.dispose();
    },
  };
  api.setDoors(0);
  outer.userData.lift = api;
  outer.userData.dispose = api.dispose;
  return outer;
}
