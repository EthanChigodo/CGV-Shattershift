/**
 * The recovery ward: where Subject 07 wakes (Phase 2, docs/story-phases-plan.md).
 *
 * A small set built in code just behind the start of the Foundry, in the
 * main scene: a ward with two beds, curtains, an IV line and a heart
 * monitor, a door, and a service passage down to the Foundry - so the
 * wake-up walks straight into the level with no cut. The game runs down -Z
 * from `startZ` along x = 0; the ward sits at larger Z, behind the run's
 * start.
 *
 * The passage is the way down from the hospital floors to the plant: it
 * starts in the ward's white tiles, goes through a fire door into bare
 * concrete, pipes and caged lamps, each one dimmer than the last, and ends
 * at the Foundry's blast door, hauled half open - so the eye has adjusted
 * to the dark by the time it opens onto the machinery.
 *
 *   const ward = new WardStage({ startZ: FOUNDRY_ORIGIN_Z });
 *   scene.add(ward.root);
 *   wakeScene({ ...ward.anchors, okoro });   // scenes.js
 *   walkOutScene({ ...ward.walkAnchors(), okoro });
 *   ward.update(dt, time);                   // the monitor, the alarm, the lamps
 *   ward.dispose();                          // once the run is under way
 *
 * Lit by the scene's own hemisphere/sun (the host brightens them for the
 * ward and eases them back to the Foundry's values on the way out), plus
 * unlit light panels and lamps - adding real lights would recompile every
 * material in the scene twice. The furniture is src/story/stages/props.js.
 */

import * as THREE from "../../three.js";
import { createPropKit } from "./props.js";

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

/** The city at night through the ward window. */
function nightTexture() {
  return canvasTexture(256, (g, size) => {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, "#050914");
    grad.addColorStop(0.7, "#141c33");
    grad.addColorStop(1, "#2b2433");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    let s = 9;
    const random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 18; i += 1) {
      const w = 12 + random() * 30;
      const h = 60 + random() * 150;
      const x = random() * size;
      g.fillStyle = "#070a12";
      g.fillRect(x, size - h, w, h);
      for (let y = size - h + 6; y < size - 4; y += 7) {
        for (let xx = x + 3; xx < x + w - 3; xx += 6) {
          if (random() < 0.4) { g.fillStyle = `rgba(255,${200 + random() * 50},${120 + random() * 80},${0.5 + random() * 0.5})`; g.fillRect(xx, y, 3, 3); }
        }
      }
    }
  });
}

/** Room dimensions (metres). */
const ROOM = { width: 9, depth: 9, height: 3.2 };
/** The way down: 3 m of hospital, a fire door, 6 m of service passage. */
const PASSAGE = { width: 2.4, height: 2.8, length: 9, fireDoor: 3 };
/** The door out of the ward (and the passage) is off-centre, clear of the bed. */
const DOOR_X = 0.8;
const BED_X = -1.4;

export class WardStage {
  /**
   * @param {object} o
   * @param {number} o.startZ  where the run starts (the Foundry's distance 0)
   * @param {object} [o.foundry]  the Foundry's kit materials (plating, grate,
   *   trim, hazard), so the stretch between the bulkhead and the run's start
   *   is built of the same stuff as the corridor it opens into
   */
  constructor({ startZ, foundry = null }) {
    this.startZ = startZ;
    this.root = new THREE.Group();
    this.root.name = "WardStage";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const kit = createPropKit(own);
    this.kit = kit;

    // Bulkhead (closes the back of the Foundry) at startZ + 9, the passage to
    // startZ + 18, the ward from there to startZ + 27.
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
    const passageWallTex = own(tileTexture("#a9b8b4", "#8e9c99", 6, 7));
    passageWallTex.repeat.set(1, 1);
    const mat = {
      floor: own(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.05 })),
      wall: own(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 })),
      passageWall: own(new THREE.MeshStandardMaterial({ map: passageWallTex, roughness: 0.85 })),
      // Faces down, away from the sky light: a little self-light so the
      // tiles read around the light panels (they would be bounce-lit).
      ceiling: own(new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9, emissive: 0xffffff, emissiveMap: ceilTex, emissiveIntensity: 0.32 })),
      panel: own(new THREE.MeshBasicMaterial({ color: 0xeef8ff })),
      steel: kit.M.steel,
      dark: kit.M.darkSteel,
      alarm: own(new THREE.MeshBasicMaterial({ color: 0xff2a1a })),
      door: own(new THREE.MeshStandardMaterial({ color: 0x4b565a, metalness: 0.45, roughness: 0.5 })),
      bulkhead: own(new THREE.MeshStandardMaterial({ color: 0x3a3f3c, metalness: 0.6, roughness: 0.55 })),
      hazard: kit.M.hazard,
      skirting: own(new THREE.MeshStandardMaterial({ color: 0x55605f, roughness: 0.6 })),
      concreteFloor: own(new THREE.MeshStandardMaterial({ color: 0x5c605f, roughness: 0.85, map: kit.M.concrete.map })),
      // The service passage's lamps, each dimmer than the last (update()).
      lamps: [0, 1, 2].map(() => own(new THREE.MeshBasicMaterial({ color: 0xfff0d0 }))),
      beacon: own(new THREE.MeshBasicMaterial({ color: 0xffa020 })),
      night: own(new THREE.MeshBasicMaterial({ map: own(nightTexture()) })),
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
    const place = (object, x, y, z, ry = 0) => {
      object.position.set(x, y, z);
      object.rotation.y = ry;
      this.root.add(object);
      return object;
    };

    /* ---- The ward ---- */
    const W = ROOM.width / 2;
    const H = ROOM.height;
    slab(mat.floor, ROOM.width, ROOM.depth, 0, 0.01, C);
    slab(mat.ceiling, ROOM.width, ROOM.depth, 0, H, C, true);
    part(mat.wall, ROOM.width, H, 0.2, 0, H / 2, C + ROOM.depth / 2); // far wall
    part(mat.wall, 0.2, H, ROOM.depth, -W, H / 2, C); // sides
    part(mat.wall, 0.2, H, ROOM.depth, W, H / 2, C);
    // Skirting round the floor.
    part(mat.skirting, ROOM.width, 0.12, 0.03, 0, 0.06, C + ROOM.depth / 2 - 0.115);
    for (const sx of [-1, 1]) part(mat.skirting, 0.03, 0.12, ROOM.depth, sx * (W - 0.115), 0.06, C);
    // Near wall (toward the Foundry), with the door opening.
    const doorHalf = 0.65;
    const zNear = this.wardNear;
    part(mat.wall, W + DOOR_X - doorHalf, H, 0.2, (-W + DOOR_X - doorHalf) / 2, H / 2, zNear);
    part(mat.wall, W - DOOR_X - doorHalf, H, 0.2, (W + DOOR_X + doorHalf) / 2, H / 2, zNear);
    part(mat.wall, doorHalf * 2, H - 2.3, 0.2, DOOR_X, 2.3 + (H - 2.3) / 2, zNear);
    // The door leaf, swung open into the passage, with its wired window and push plate.
    const hinge = new THREE.Group();
    hinge.position.set(DOOR_X - doorHalf, 1.125, zNear - 0.05);
    hinge.rotation.y = 1.25;
    this.root.add(hinge);
    part(mat.door, 1.2, 2.25, 0.06, 0.6, 0, 0, hinge);
    part(kit.M.glass, 0.3, 0.6, 0.065, 0.6, 0.45, 0, hinge);
    part(kit.M.chrome, 0.1, 0.3, 0.07, 1.05, 0, 0, hinge);
    // Ceiling light panels - what you see first, smeared, on your back.
    for (const [x, z] of [[BED_X, 1.6], [BED_X, -1.4], [2.4, 1.6], [2.4, -1.4], [0.5, 3.4]]) {
      const p = new THREE.Mesh(plane, mat.panel);
      p.scale.set(1.2, 0.6, 1);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, H - 0.01, C + z);
      this.root.add(p);
      part(mat.skirting, 1.26, 0.03, 0.66, x, H - 0.012, C + z);
    }
    // A red alarm strip over the door, pulsing (update()).
    this.alarm = part(mat.alarm, 1.4, 0.08, 0.06, DOOR_X, 2.55, zNear + 0.14);

    // The bed you wake in - head to the far wall - and an empty one across the ward.
    const bedZ = C + 1.6;
    const bed = kit.hospitalBed({ made: true, rails: [true, false], seed: 3 });
    place(bed.root, BED_X, 0, bedZ);
    this.bed = { x: BED_X, z: bedZ, mattressTop: bed.mattressTop, pillowTop: bed.pillow.top, pillowZ: bedZ + bed.pillow.z, root: bed.root };
    const other = kit.hospitalBed({ made: false, rails: [false, true], seed: 8 });
    place(other.root, 2.4, 0, bedZ);
    // Each bay: a services panel on a stub wall behind the bed, a curtain round it.
    for (const x of [BED_X, 2.4]) {
      part(mat.wall, 2.5, 2.4, 0.16, x, 1.2, bedZ + 1.3);
      place(kit.headwall(2.2), x, 0, bedZ + 1.22);
      const side = kit.curtain({ width: 2.6, height: 2.1, top: 2.55, folds: 12, seed: x > 0 ? 4 : 2 });
      place(side, x - 0.78, 0, bedZ, Math.PI / 2);
      const foot = kit.curtain({ width: 1.6, height: 2.1, top: 2.55, folds: 8, open: 0.85, seed: x > 0 ? 6 : 5 });
      place(foot, x - 0.2, 0, bedZ - 1.35);
    }
    // IV stand and line, and the heart monitor, at the head of your bed on Okoro's side.
    const iv = kit.ivStand();
    place(iv.root, BED_X + 0.8, 0, bedZ + 1.0);
    iv.root.updateMatrixWorld(true); // (the ward's own frame: the root isn't placed yet)
    const bag = iv.root.localToWorld(iv.line.clone());
    // The line, sagging, down to the cannula in the back of the right hand.
    const hand = new THREE.Vector3(BED_X + 0.28, bed.mattressTop + 0.05, bedZ - 0.15);
    kit.tube(this.root, kit.M.fluid, [bag, new THREE.Vector3(BED_X + 0.82, 1.1, bedZ + 0.85), new THREE.Vector3(BED_X + 0.62, 0.62, bedZ + 0.35), new THREE.Vector3(BED_X + 0.45, 0.8, bedZ + 0.0), hand], 0.005);
    kit.part(this.root, kit.M.plastic, 0.035, 0.012, 0.05, hand.x, hand.y + 0.008, hand.z);
    this.monitorCanvas = document.createElement("canvas");
    this.monitorCanvas.width = 128;
    this.monitorCanvas.height = 80;
    this.monitorTex = own(new THREE.CanvasTexture(this.monitorCanvas));
    this.monitorTex.colorSpace = THREE.SRGBColorSpace;
    const monitor = kit.monitorStand(own(new THREE.MeshBasicMaterial({ map: this.monitorTex })));
    place(monitor.root, BED_X + 0.95, 0, bedZ + 1.35);
    // The screen faces the bed (and the patient's turned head).
    monitor.head.rotation.y = -2.2;
    this._trace = [];
    // The other bed's cabinet; an over-bed table at the foot of yours.
    place(kit.bedsideCabinet(), 2.4 + 0.85, 0, bedZ + 0.9, -Math.PI / 2);
    const table = new THREE.Group();
    kit.part(table, kit.M.steel, 0.05, 0.85, 0.05, 0.35, 0.43, 0);
    kit.part(table, kit.M.steel, 0.7, 0.04, 0.45, 0.1, 0.03, 0);
    kit.part(table, kit.M.plastic, 0.85, 0.035, 0.4, 0, 0.87, 0, { r: 0.012 });
    place(table, BED_X + 0.15, 0, bedZ - 1.55);
    place(kit.mug(0xd9e4e6), BED_X + 0.0, 0.89, bedZ - 1.55);
    place(kit.papers(3, 2), BED_X + 0.25, 0.888, bedZ - 1.52, 0.3);
    // Round the room: a sink and mirror, a medicine trolley, a wheelchair, a clock, the window.
    place(kit.sink(), -W + 0.1, 0, C - 1.6, Math.PI / 2);
    const trolley = new THREE.Group();
    kit.part(trolley, kit.M.painted, 0.7, 0.9, 0.5, 0, 0.5, 0, { r: 0.02 });
    for (let i = 0; i < 4; i += 1) {
      kit.part(trolley, kit.M.plastic, 0.66, 0.18, 0.012, 0, 0.18 + i * 0.21, 0.255, { r: 0.004 });
      kit.part(trolley, kit.M.chrome, 0.18, 0.015, 0.02, 0, 0.24 + i * 0.21, 0.265);
    }
    kit.part(trolley, kit.M.chrome, 0.7, 0.02, 0.02, 0, 0.98, -0.27);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.part(trolley, kit.M.rubber, 0.04, 0.05, 0.05, sx * 0.3, 0.025, sz * 0.2);
    place(trolley, 2.9, 0, C - 2.2, Math.PI);
    place(kit.papers(4, 5), 2.9, 0.955, C - 2.2, 0.2);
    place(kit.wheelchair(), -W + 0.9, 0, C - 3.4, 0.9);
    place(kit.wallClock(), -2.4, 2.5, zNear + 0.11);
    place(kit.blindWindow({ width: 2.0, height: 1.2, night: mat.night }), 2.4, 1.65, C + ROOM.depth / 2 - 0.1, Math.PI);
    const notice = kit.sign([["RECOVERY 4", 54], ["NIL BY MOUTH", 30]], { width: 0.6, height: 0.3, bg: "#eef4f2", fg: "#20444a", stripe: "#3f8f88" });
    place(notice, -0.7, 1.75, zNear + 0.111);
    place(kit.plant({ height: 1.0, seed: 3 }), W - 0.45, 0, C + 3.9);

    /* ---- The way down: the passage, the fire door, the blast door ---- */
    const pw = PASSAGE.width / 2;
    const fireZ = zNear - PASSAGE.fireDoor;
    const hospital = (zNear + fireZ) / 2;
    const service = (fireZ + this.bulkheadZ) / 2;
    const serviceLen = fireZ - this.bulkheadZ;
    // The hospital end: tiles, a light panel.
    slab(mat.floor, PASSAGE.width, PASSAGE.fireDoor, DOOR_X, 0.01, hospital);
    slab(mat.ceiling, PASSAGE.width, PASSAGE.fireDoor, DOOR_X, PASSAGE.height, hospital, true);
    for (const sx of [-1, 1]) part(mat.passageWall, 0.15, PASSAGE.height, PASSAGE.fireDoor, DOOR_X + sx * pw, PASSAGE.height / 2, hospital);
    part(mat.panel, 0.3, 0.02, 1.2, DOOR_X, PASSAGE.height - 0.02, hospital);
    // The fire door: a frame, both leaves held open, wired glass.
    for (const sx of [-1, 1]) {
      part(mat.door, 0.12, PASSAGE.height, 0.2, DOOR_X + sx * (pw - 0.06), PASSAGE.height / 2, fireZ);
      const leafHinge = new THREE.Group();
      leafHinge.position.set(DOOR_X + sx * (pw - 0.12), 1.05, fireZ - 0.08);
      leafHinge.rotation.y = sx * -1.35;
      this.root.add(leafHinge);
      part(kit.M.paintedBlue, 1.0, 2.1, 0.05, -sx * 0.5, 0, 0, leafHinge);
      part(kit.M.glass, 0.28, 0.55, 0.055, -sx * 0.5, 0.4, 0, leafHinge);
    }
    part(mat.door, PASSAGE.width, 0.35, 0.2, DOOR_X, PASSAGE.height - 0.175, fireZ);
    const access = kit.sign([["SERVICE ACCESS", 40], ["AUTHORISED STAFF ONLY", 24]], { width: 1.0, height: 0.32, bg: "#1f4f8a", fg: "#ffffff" });
    place(access, DOOR_X, PASSAGE.height - 0.18, fireZ + 0.11);
    // The service end: concrete, pipes, a cable tray, caged lamps.
    slab(mat.concreteFloor, PASSAGE.width, serviceLen, DOOR_X, 0.01, service);
    slab(kit.M.concrete, PASSAGE.width, serviceLen, DOOR_X, PASSAGE.height, service, true);
    for (const sx of [-1, 1]) part(kit.M.concrete, 0.15, PASSAGE.height, serviceLen, DOOR_X + sx * pw, PASSAGE.height / 2, service);
    for (const sx of [-1, 1]) part(mat.hazard, 0.08, 0.005, serviceLen, DOOR_X + sx * (pw - 0.2), 0.015, service);
    this.root.add(kit.pipe([[DOOR_X - pw + 0.14, 2.45, fireZ], [DOOR_X - pw + 0.14, 2.45, this.bulkheadZ + 0.2]], { radius: 0.07, material: kit.M.pipeRed }));
    this.root.add(kit.pipe([[DOOR_X - pw + 0.32, 2.6, fireZ], [DOOR_X - pw + 0.32, 2.6, this.bulkheadZ + 0.2]], { radius: 0.045, material: kit.M.pipeGrey }));
    this.root.add(kit.pipe([[DOOR_X + pw - 0.14, 0.4, fireZ], [DOOR_X + pw - 0.14, 0.4, fireZ - 2.2], [DOOR_X + pw - 0.14, 2.3, fireZ - 2.6], [DOOR_X + pw - 0.14, 2.3, this.bulkheadZ + 0.2]], { radius: 0.05, material: kit.M.pipeYellow }));
    part(kit.M.darkSteel, 0.4, 0.04, serviceLen, DOOR_X + 0.5, PASSAGE.height - 0.2, service);
    kit.tube(this.root, kit.M.black, [[DOOR_X + 0.4, PASSAGE.height - 0.17, fireZ], [DOOR_X + 0.45, PASSAGE.height - 0.24, service], [DOOR_X + 0.38, PASSAGE.height - 0.17, this.bulkheadZ + 0.2]].map((p) => new THREE.Vector3(...p)), 0.018);
    this.passageLamps = [];
    [0.18, 0.5, 0.82].forEach((k, i) => {
      const lamp = kit.cagedLamp(mat.lamps[i]);
      lamp.root.rotation.x = Math.PI / 2;
      place(lamp.root, DOOR_X, PASSAGE.height - 0.04, fireZ - serviceLen * k);
      this.passageLamps.push(lamp);
    });
    const down = kit.sign([["LEVEL 141", 40], ["FOUNDRY  //  PLANT ROOMS", 24]], { width: 1.0, height: 0.32, bg: "#d6a520", fg: "#141414" });
    place(down, DOOR_X + pw - 0.08, 1.7, fireZ - serviceLen * 0.35, -Math.PI / 2);
    const warn = kit.sign([["DANGER", 46], ["MOVING MACHINERY", 26]], { width: 0.7, height: 0.32, bg: "#f2f2ec", fg: "#b81d12", stripe: "#b81d12" });
    place(warn, DOOR_X - pw + 0.08, 1.6, fireZ - serviceLen * 0.75, Math.PI / 2);
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
    // The blast door, hauled most of the way open; an amber beacon turning over it.
    const blast = kit.blastDoor({ width: PASSAGE.width, height: PASSAGE.height });
    blast.setOpen(0.78);
    place(blast.root, DOOR_X, 0, z - 0.3);
    this.beacon = new THREE.Group();
    kit.rod(this.beacon, mat.beacon, 0.07, 0.12, 0, 0, 0, { seg: 14 });
    kit.part(this.beacon, kit.M.black, 0.16, 0.1, 0.02, 0, 0, 0.04);
    place(this.beacon, DOOR_X + pw - 0.25, PASSAGE.height - 0.12, z + 0.2);
    const stencil = kit.sign([["FOUNDRY", 60]], { width: 1.2, height: 0.3, bg: "#2f3432", fg: "#d6a520" });
    place(stencil, DOOR_X, PASSAGE.height + 0.45, z - 0.16, Math.PI);

    /* ---- The Foundry's first nine metres: bulkhead to the run's start ---- */
    // The level's corridor starts where the run does; this joins it to the
    // bulkhead, so walking through the blast door you are already inside
    // the plant - walls, floor and ceiling all the way - not in the dark.
    const fm = {
      wall: foundry?.plating ?? kit.M.darkSteel,
      floor: foundry?.grate ?? kit.M.darkSteel,
      trim: foundry?.trim ?? kit.M.darkSteel,
      hazard: foundry?.hazard ?? kit.M.hazard,
    };
    const L = z - startZ + 0.02;
    const mid = startZ + L / 2;
    const HW = 5.6;
    const slabPart = (material, sx, sy, sz, x, y, zz) => {
      const m = new THREE.Mesh(own(new THREE.BoxGeometry(sx, sy, sz)), material);
      m.position.set(x, y, zz);
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    slabPart(fm.floor, HW * 2, 0.3, L, 0, -0.16, mid);
    slabPart(fm.wall, HW * 2, 0.3, L, 0, 7.62, mid);
    for (const sx of [-1, 1]) {
      slabPart(fm.wall, 0.42, 7.4, L, sx * HW, 3.7, mid);
      slabPart(fm.hazard, 0.37, 0.74, L, sx * (HW - 0.26), 0.62, mid);
      slabPart(fm.trim, 0.5, 0.44, L, sx * 5.2, 0.16, mid);
      for (const dz of [-L / 2 + 1.2, 0, L / 2 - 1.2]) slabPart(fm.trim, 0.62, 7.4, 0.34, sx * (HW - 0.22), 3.7, mid + dz);
    }
    // A beam across the ceiling, and a work lamp on it.
    slabPart(fm.trim, HW * 2, 0.42, 0.5, 0, 7.2, mid);
    const lamp = kit.cagedLamp(mat.lamps[2]);
    lamp.root.rotation.x = Math.PI / 2;
    place(lamp.root, 0, 6.95, mid);

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

  /** The heart monitor's trace, the alarm strip's pulse, the passage's lamps and beacon. */
  update(dt, time) {
    const k = 0.5 + 0.5 * Math.sin(time * 5);
    this.mat.alarm.color.setRGB(0.35 + 0.65 * k, 0.06 * k, 0.03);
    // Each lamp down the passage dimmer and warmer than the last; the middle one failing.
    const [a, b, c] = this.mat.lamps;
    a.color.setRGB(1, 0.94, 0.82);
    const flicker = Math.sin(time * 37) > 0.2 || Math.sin(time * 3.1) > 0.7 ? 0.75 : 0.12;
    b.color.setRGB(0.8 * flicker, 0.66 * flicker, 0.45 * flicker);
    c.color.setRGB(0.55, 0.38, 0.2);
    this.beacon.rotation.y = time * 5;
    // A green ECG trace, one beat a second.
    const canvas = this.monitorCanvas;
    const g = canvas.getContext("2d");
    const phase = time % 1;
    const y = phase < 0.08 ? -26 * Math.sin((phase / 0.08) * Math.PI) : phase < 0.14 ? 9 * Math.sin(((phase - 0.08) / 0.06) * Math.PI) : 0;
    this._trace.push(40 + y + Math.sin(time * 9) * 0.6);
    if (this._trace.length > 128) this._trace.shift();
    g.fillStyle = "#04140d";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = "#3cff9a";
    g.lineWidth = 2;
    g.beginPath();
    this._trace.forEach((v, i) => (i ? g.lineTo(i, v) : g.moveTo(i, v)));
    g.stroke();
    g.fillStyle = "#3cff9a";
    g.font = "bold 14px monospace";
    g.fillText("58", 100, 18);
    g.fillStyle = "#5fd0ff";
    g.font = "bold 10px monospace";
    g.fillText("SpO2 96", 4, 74);
    this.monitorTex.needsUpdate = true;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const x of this.owned) x.dispose();
    this.owned.length = 0;
  }
}
