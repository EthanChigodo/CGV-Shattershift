/**
 * The recovery ward: where Subject 07 wakes (Phase 2, docs/story-phases-plan.md).
 *
 * A small set built in code just behind the start of the Foundry, in the
 * main scene: a ward with two beds, curtains, an IV stand and a heart
 * monitor, a door, and a short service passage through a bulkhead into the
 * Foundry's first stretch - so the wake-up walks straight into the level with
 * no cut. The game runs down -Z from `startZ` along x = 0; the ward sits at
 * larger Z, behind the run's start.
 *
 *   const ward = new WardStage({ startZ: FOUNDRY_ORIGIN_Z });
 *   scene.add(ward.root);
 *   wakeScene({ ...ward.anchors, okoro });   // scenes.js
 *   walkOutScene({ ...ward.walkAnchors(), okoro });
 *   ward.update(dt, time);                   // the monitor, the alarm strip
 *   ward.dispose();                          // once the run is under way
 *
 * Lit by the scene's own hemisphere/sun (the host brightens them for the
 * ward and eases them back to the Foundry's values on the way out), plus
 * unlit ceiling panels and an alarm strip - adding real lights would
 * recompile every material in the scene twice.
 */

import * as THREE from "../../three.js";

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Hospital tiles: a pale base, grime, grout lines. */
function tileTexture(base, line, cells = 8, seed = 1) {
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return canvasTexture(512, (g, size) => {
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 1600; i += 1) {
      g.fillStyle = `rgba(30,24,18,${random() * 0.06})`;
      g.fillRect(random() * size, random() * size, 2 + random() * 7, 2 + random() * 7);
    }
    g.strokeStyle = line;
    g.lineWidth = 3;
    const step = size / cells;
    for (let i = 0; i <= cells; i += 1) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
    }
  });
}

/** Room dimensions (metres). */
const ROOM = { width: 9, depth: 9, height: 3.2 };
const PASSAGE = { width: 2.4, height: 2.8, length: 6 };
/** The door out of the ward (and the passage) is off-centre, clear of the bed. */
const DOOR_X = 0.8;
const BED_X = -1.4;

export class WardStage {
  /**
   * @param {object} o
   * @param {number} o.startZ  where the run starts (the Foundry's distance 0)
   */
  constructor({ startZ }) {
    this.startZ = startZ;
    this.root = new THREE.Group();
    this.root.name = "WardStage";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);

    // Bulkhead (closes the back of the Foundry) at startZ + 9, passage to
    // startZ + 15, ward from there to startZ + 24.
    this.bulkheadZ = startZ + 9;
    this.wardNear = this.bulkheadZ + PASSAGE.length;
    this.centreZ = this.wardNear + ROOM.depth / 2;
    const C = this.centreZ;

    const floorTex = own(tileTexture("#c4cbc8", "#949d9a", 8, 3));
    floorTex.repeat.set(3, 3);
    const wallTex = own(tileTexture("#a9b8b4", "#8e9c99", 6, 7));
    wallTex.repeat.set(3, 1);
    const ceilTex = own(tileTexture("#dfe5e3", "#b8c0bd", 6, 11));
    ceilTex.repeat.set(3, 3);
    const mat = {
      floor: own(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.05 })),
      wall: own(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 })),
      // Faces down, away from the sky light: a little self-light so the
      // tiles read around the light panels (they would be bounce-lit).
      ceiling: own(new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9, emissive: 0xffffff, emissiveMap: ceilTex, emissiveIntensity: 0.32 })),
      panel: own(new THREE.MeshBasicMaterial({ color: 0xeef8ff })),
      steel: own(new THREE.MeshStandardMaterial({ color: 0x9aa4a8, metalness: 0.75, roughness: 0.35 })),
      dark: own(new THREE.MeshStandardMaterial({ color: 0x23282b, metalness: 0.4, roughness: 0.55 })),
      linen: own(new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.95 })),
      sheet: own(new THREE.MeshStandardMaterial({ color: 0x8fb7c4, roughness: 0.95 })),
      curtain: own(new THREE.MeshStandardMaterial({ color: 0x7fa6a0, roughness: 0.95, side: THREE.DoubleSide })),
      iv: own(new THREE.MeshStandardMaterial({ color: 0xd9f2ff, transparent: true, opacity: 0.6, roughness: 0.2 })),
      alarm: own(new THREE.MeshBasicMaterial({ color: 0xff2a1a })),
      door: own(new THREE.MeshStandardMaterial({ color: 0x4b565a, metalness: 0.45, roughness: 0.5 })),
      bulkhead: own(new THREE.MeshStandardMaterial({ color: 0x3a3f3c, metalness: 0.6, roughness: 0.55 })),
      hazard: own(new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 })),
    };
    this.mat = mat;
    const box = own(new THREE.BoxGeometry(1, 1, 1));
    const plane = own(new THREE.PlaneGeometry(1, 1));
    const part = (material, sx, sy, sz, x, y, z, parent = this.root) => {
      const m = new THREE.Mesh(box, material);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const slab = (material, sx, sz, x, y, z, faceDown = false) => {
      const m = new THREE.Mesh(plane, material);
      m.scale.set(sx, sz, 1);
      m.rotation.x = faceDown ? Math.PI / 2 : -Math.PI / 2;
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };

    /* ---- The ward ---- */
    const W = ROOM.width / 2;
    const H = ROOM.height;
    slab(mat.floor, ROOM.width, ROOM.depth, 0, 0.01, C);
    slab(mat.ceiling, ROOM.width, ROOM.depth, 0, H, C, true);
    part(mat.wall, ROOM.width, H, 0.2, 0, H / 2, C + ROOM.depth / 2); // far wall
    part(mat.wall, 0.2, H, ROOM.depth, -W, H / 2, C); // sides
    part(mat.wall, 0.2, H, ROOM.depth, W, H / 2, C);
    // Near wall (toward the Foundry), with the door opening.
    const doorHalf = 0.65;
    const zNear = this.wardNear;
    part(mat.wall, W + DOOR_X - doorHalf, H, 0.2, (-W + DOOR_X - doorHalf) / 2, H / 2, zNear);
    part(mat.wall, W - DOOR_X - doorHalf, H, 0.2, (W + DOOR_X + doorHalf) / 2, H / 2, zNear);
    part(mat.wall, doorHalf * 2, H - 2.3, 0.2, DOOR_X, 2.3 + (H - 2.3) / 2, zNear);
    // The door leaf, swung open into the passage.
    const leaf = part(mat.door, 1.2, 2.25, 0.06, 0, 0, 0);
    const hinge = new THREE.Group();
    hinge.position.set(DOOR_X - doorHalf, 1.125, zNear - 0.05);
    leaf.position.set(0.6, 0, 0);
    hinge.add(leaf);
    hinge.rotation.y = 1.25;
    this.root.add(hinge);
    // Ceiling light panels - what you see first, smeared, on your back.
    for (const [x, z] of [[BED_X, 1.6], [BED_X, -1.4], [2.4, 1.6], [2.4, -1.4], [0.5, 3.4]]) {
      const p = new THREE.Mesh(plane, mat.panel);
      p.scale.set(1.2, 0.6, 1);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, H - 0.01, C + z);
      this.root.add(p);
    }
    // A red alarm strip over the door, pulsing (update()).
    this.alarm = part(mat.alarm, 1.4, 0.08, 0.06, DOOR_X, 2.55, zNear + 0.14);

    // The bed you wake in: frame, mattress, pillow, sheet - head to the far wall.
    const bedZ = C + 1.6;
    this._bed(part, BED_X, bedZ, true);
    // An empty bed across the ward, sheets thrown back.
    this._bed(part, 2.4, bedZ, false);
    // Curtain rails and curtains: round the far side and the foot of each bed.
    for (const x of [BED_X, 2.4]) {
      part(mat.steel, 0.03, 0.03, 2.6, x - 0.75, 2.55, bedZ);
      const curtain = new THREE.Mesh(plane, mat.curtain);
      curtain.scale.set(2.2, 2.0, 1);
      curtain.rotation.y = Math.PI / 2;
      curtain.position.set(x - 0.75, 1.55, bedZ + 0.1);
      this.root.add(curtain);
    }
    // IV stand and heart monitor at the head of your bed, on Okoro's side.
    part(mat.steel, 0.03, 1.9, 0.03, BED_X + 0.8, 0.95, bedZ + 1.0);
    part(mat.steel, 0.4, 0.03, 0.4, BED_X + 0.8, 0.02, bedZ + 1.0);
    part(mat.iv, 0.14, 0.22, 0.05, BED_X + 0.8, 1.75, bedZ + 1.0);
    part(mat.dark, 0.06, 1.2, 0.06, BED_X + 0.95, 0.6, bedZ + 1.35);
    // The monitor faces the bed (and the patient's turned head): local +Z
    // is its screen side, turned toward -X / -Z.
    const monitor = new THREE.Group();
    monitor.position.set(BED_X + 0.95, 1.35, bedZ + 1.35);
    monitor.rotation.y = -2.2;
    this.root.add(monitor);
    part(mat.dark, 0.42, 0.3, 0.2, 0, 0, 0, monitor);
    this.monitorCanvas = document.createElement("canvas");
    this.monitorCanvas.width = 128;
    this.monitorCanvas.height = 80;
    this.monitorTex = own(new THREE.CanvasTexture(this.monitorCanvas));
    this.monitorTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(plane, own(new THREE.MeshBasicMaterial({ map: this.monitorTex })));
    screen.scale.set(0.36, 0.22, 1);
    screen.position.z = 0.105;
    monitor.add(screen);
    this._trace = [];
    // A cabinet and a trolley, so the room is lived in.
    part(mat.steel, 0.6, 1.1, 0.5, -W + 0.4, 0.55, C - 2.6);
    part(mat.steel, 0.8, 0.04, 0.5, 2.9, 0.85, C - 2.2);
    part(mat.dark, 0.8, 0.04, 0.5, 2.9, 0.35, C - 2.2);

    /* ---- The service passage and the bulkhead ---- */
    const pw = PASSAGE.width / 2;
    const pz = (this.bulkheadZ + zNear) / 2;
    slab(mat.floor, PASSAGE.width, PASSAGE.length, DOOR_X, 0.01, pz);
    slab(mat.ceiling, PASSAGE.width, PASSAGE.length, DOOR_X, PASSAGE.height, pz, true);
    part(mat.wall, 0.15, PASSAGE.height, PASSAGE.length, DOOR_X - pw, PASSAGE.height / 2, pz);
    part(mat.wall, 0.15, PASSAGE.height, PASSAGE.length, DOOR_X + pw, PASSAGE.height / 2, pz);
    // Strip lights down the passage.
    for (let i = 0; i < 3; i += 1) part(mat.panel, 0.3, 0.02, 1.0, DOOR_X, PASSAGE.height - 0.02, this.bulkheadZ + 1 + i * 2);
    // The bulkhead across the back of the Foundry, a doorway in it.
    const bw = 6.4;
    const bh = 8;
    const z = this.bulkheadZ;
    part(mat.bulkhead, bw + DOOR_X - pw, bh, 0.3, (-bw + DOOR_X - pw) / 2, bh / 2, z);
    part(mat.bulkhead, bw - DOOR_X - pw, bh, 0.3, (bw + DOOR_X + pw) / 2, bh / 2, z);
    part(mat.bulkhead, PASSAGE.width, bh - PASSAGE.height, 0.3, DOOR_X, PASSAGE.height + (bh - PASSAGE.height) / 2, z);
    // Hazard stripes round the doorway.
    part(mat.hazard, 0.12, PASSAGE.height, 0.32, DOOR_X - pw - 0.06, PASSAGE.height / 2, z);
    part(mat.hazard, 0.12, PASSAGE.height, 0.32, DOOR_X + pw + 0.06, PASSAGE.height / 2, z);
    part(mat.hazard, PASSAGE.width + 0.24, 0.12, 0.32, DOOR_X, PASSAGE.height + 0.06, z);

    /* ---- Anchors (world space) for the scenes ---- */
    this.anchors = {
      eye: new THREE.Vector3(BED_X, 0.98, bedZ + 0.82),
      up: new THREE.Vector3(0, 1, 0),
      // Head to the far wall (+Z), so the feet point at the door (-Z) and,
      // lying face up, the patient's right is +X - Okoro's side.
      feet: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      standEye: new THREE.Vector3(BED_X + 0.35, 1.6, bedZ - 0.55),
      door: new THREE.Vector3(DOOR_X, 1.3, zNear - 0.3),
    };
    /** Where Okoro stands at the bedside, and which way he faces (toward the bed, -X). */
    this.okoroStart = { position: new THREE.Vector3(BED_X + 0.85, 0, bedZ + 0.2), heading: Math.PI / 2 };
  }

  _bed(part, x, z, made) {
    const m = this.mat;
    part(m.steel, 1.0, 0.08, 2.1, x, 0.5, z);
    for (const [dx, dz] of [[-0.45, -1], [0.45, -1], [-0.45, 1], [0.45, 1]]) part(m.steel, 0.05, 0.5, 0.05, x + dx, 0.25, z + dz);
    part(m.steel, 1.0, 0.55, 0.05, x, 0.8, z + 1.05); // headboard (far wall side)
    part(m.linen, 0.92, 0.16, 2.0, x, 0.62, z);
    part(m.linen, 0.6, 0.12, 0.38, x, 0.75, z + 0.8);
    const sheet = part(m.sheet, 0.95, 0.06, made ? 1.35 : 0.8, x, 0.72, made ? z - 0.35 : z - 0.6);
    if (!made) sheet.rotation.z = 0.25;
  }

  /**
   * The walk out, in world space: from beside the bed, through the door,
   * down the passage, through the bulkhead and into the Foundry.
   */
  walkAnchors() {
    const a = this.anchors;
    const s = this.startZ;
    return {
      path: [
        a.standEye.clone().setY(0),
        new THREE.Vector3(DOOR_X, 0, this.wardNear + 0.6),
        new THREE.Vector3(DOOR_X, 0, this.wardNear - 0.6),
        new THREE.Vector3(DOOR_X, 0, this.bulkheadZ + 0.4),
        new THREE.Vector3(DOOR_X * 0.5, 0, this.bulkheadZ - 2.5),
        new THREE.Vector3(0, 0, s + 1),
        new THREE.Vector3(0, 0, s - 12),
      ],
      // Where the run's chase camera sits at the start (main.js), and looks.
      chase: new THREE.Vector3(0, 4.2, s + 8.5),
      chaseLook: new THREE.Vector3(0, 1.25, s - 12),
      startZ: s,
    };
  }

  /** The heart monitor's trace and the alarm strip's pulse. */
  update(dt, time) {
    const k = 0.5 + 0.5 * Math.sin(time * 5);
    this.mat.alarm.color.setRGB(0.35 + 0.65 * k, 0.06 * k, 0.03);
    // A green ECG trace, one beat a second.
    const c = this.monitorCanvas;
    const g = c.getContext("2d");
    const phase = time % 1;
    const y = phase < 0.08 ? -26 * Math.sin((phase / 0.08) * Math.PI) : phase < 0.14 ? 9 * Math.sin(((phase - 0.08) / 0.06) * Math.PI) : 0;
    this._trace.push(40 + y + Math.sin(time * 9) * 0.6);
    if (this._trace.length > 128) this._trace.shift();
    g.fillStyle = "#04140d";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#3cff9a";
    g.lineWidth = 2;
    g.beginPath();
    this._trace.forEach((v, i) => (i ? g.lineTo(i, v) : g.moveTo(i, v)));
    g.stroke();
    g.fillStyle = "#3cff9a";
    g.font = "bold 14px monospace";
    g.fillText("58", 100, 18);
    this.monitorTex.needsUpdate = true;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const x of this.owned) x.dispose();
    this.owned.length = 0;
  }
}
