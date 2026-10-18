/**
 * Level 3's lifts: the tower's one glass cabin (src/elevators/glass-cabin.js,
 * the same parts and materials as every other lift) - glass walls in steel
 * mullions, posts carrying cyan conduits, glass doors with a lit edge in a
 * steel frame (the buttons and a floor display inside), a tread-plate deck,
 * light bars, a handrail. The glass stands in from the walls round the lift.
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
import { createGlassCabinKit, GLASS_CABIN } from "../../elevators/glass-cabin.js";

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
  // The tower's glass cabin: its parts and materials (one set per lift, so
  // each lift's light and conduits dim on their own).
  const cabinKit = createGlassCabinKit(own);
  const { steel, darkSteel, conduit } = cabinKit.materials;
  const lamp = cabinKit.lightMaterial();
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
  const doors = cabinKit.doors(group, { width: W, height: H, z: 0, depth: 0.06 });
  // (Open, they slide the whole way into the wall either side.)
  for (const leaf of doors.leaves) leaf.userData.openX = leaf.userData.closedX + leaf.userData.side * (W / 2);

  // The cabin behind them. The glass stands in from whatever is around the
  // lift (the Labs' start room, the roof's hut) - flush against those walls,
  // the two surfaces flickered through each other.
  const Z = D / 2 + T / 2;
  const IN = W / 2 - 0.18;
  const FRONT = T / 2 + 0.1;
  const BACK = D + T / 2 - 0.18;
  const deck = cabinKit.deck(group, W, D);
  deck.position.z = Z;
  box(W, 0.2, D, darkSteel, 0, H + 0.1, Z);
  for (const s of [-1, 1]) {
    cabinKit.glassWall(group, [s * IN, FRONT], [s * IN, BACK], H, { inward: [-s, 0] });
    cabinKit.post(group, s * IN, BACK, H, [-s, -1]);
    // The front posts are the door frame's jambs; their conduits.
    cabinKit.post(group, s * IN, FRONT, H, [-s, 1], { steel: false });
    cabinKit.handrail(group, [s * (IN - 0.12), FRONT + 0.4], [s * (IN - 0.12), BACK - 0.3], [s, 0]);
  }
  cabinKit.glassWall(group, [-IN, BACK], [IN, BACK], H, { inward: [0, -1] });
  cabinKit.handrail(group, [-IN + 0.3, BACK - 0.12], [IN - 0.3, BACK - 0.12], [0, 1]);
  // The door frame inside the doorway: jambs (the front posts), a header,
  // the threshold, the buttons on the right-hand jamb; the floor display.
  cabinKit.doorFrame(group, { width: 2 * IN - GLASS_CABIN.post, height: H, z: FRONT, inward: 1, depth: GLASS_CABIN.post, ceiling: H + 0.2 });
  const inside = new THREE.Mesh(geo.unitPlane, indicatorMat);
  inside.scale.set(Math.min(1.0, W * 0.3), Math.min(0.5, W * 0.15), 1);
  inside.position.set(0, H - inside.scale.y / 2 - 0.08, FRONT + GLASS_CABIN.post / 2 + 0.01);
  group.add(inside);
  cabinKit.lightBars(group, { span: Math.min(1.2, W * 0.25), length: D - 0.8, y: H - 0.02, z0: Z, material: lamp });

  const api = {
    width: W,
    height: H,
    depth: D,
    /** Where to stand in the cabin, in the lift's outer local space. */
    cabinCentre: new THREE.Vector3(0, 0, (cabinAhead ? -1 : 1) * (D / 2 + T / 2)),
    open: 0,
    /** 0 = shut, 1 = fully open. Eased here, so callers can pass a linear ramp. */
    setDoors(t) {
      api.open = THREE.MathUtils.clamp(t, 0, 1);
      doors.set(t);
    },
    /** Cabin light, 0..1 (flicker it for a lift that has just stopped hard). */
    setLight(v) {
      const k = THREE.MathUtils.clamp(v, 0, 1);
      lamp.color.copy(GLASS_CABIN.light).multiplyScalar(0.12 + 0.88 * k);
      conduit.color.setHex(GLASS_CABIN.accent).multiplyScalar(0.25 + 0.75 * k);
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
