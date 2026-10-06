/**
 * The helicopter's cabin, inside (Phase 6, the ending): built in code to
 * match helicopter.glb's exterior - quilted soundproofing over the hull,
 * worn steel frames, ribbed floor plate, red webbing troop seats - with the
 * side door open on the burning tower and a cockpit through the bulkhead
 * where the pilot sits in his bucket seat with his back to you.
 *
 * Local frame: the nose is -Z (the cockpit), the open door is on the left
 * (-X) side of the cabin, the floor at y = 0. Lit by the scene it sits in
 * (the roof's) plus unlit glowing instruments and the red night lights -
 * no lights of its own. Every texture is drawn here, on canvases.
 *
 *   const cabin = new CabinStage();
 *   scene.add(cabin.root);
 *   cabin.anchors.seatEye / pilot / doorLook / pilotBack (local; cabin.world(v))
 */

import * as THREE from "../../three.js";

const canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
};

const colourTexture = (c, repeat = [1, 1]) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
};

const dataTexture = (c, repeat = [1, 1]) => {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  return t;
};

function panelTexture() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = "#06100c";
  g.fillRect(0, 0, 256, 128);
  // A few glowing instruments: dials and a radar sweep.
  for (let i = 0; i < 6; i += 1) {
    const x = 26 + i * 40;
    g.strokeStyle = i % 2 ? "#47ff9a" : "#ffb547";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, 44, 15, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(x, 44);
    g.lineTo(x + Math.cos(i * 1.7) * 13, 44 + Math.sin(i * 1.7) * 13);
    g.stroke();
  }
  g.fillStyle = "#1d5a3a";
  g.fillRect(16, 82, 224, 30);
  g.fillStyle = "#6bffb0";
  g.font = "bold 14px monospace";
  g.fillText("ALT 0420  HDG 090  FUEL 61", 22, 102);
  return colourTexture(c);
}

/**
 * Quilted soundproofing blanket (the grey-green padding lining a military
 * cabin): diamond stitching, each quilt puffed out, a little grime. Returns
 * the colour map and a matching bump map.
 */
function quiltTextures() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const [b, gb] = canvas(S, S);
  g.fillStyle = "#4c5344";
  g.fillRect(0, 0, S, S);
  gb.fillStyle = "#000";
  gb.fillRect(0, 0, S, S);
  const step = S / 4;
  for (let y = -1; y <= 4; y += 1) {
    for (let x = -1; x <= 4; x += 1) {
      const cx = x * step + (y % 2 ? step / 2 : 0);
      const cy = y * step;
      // A puffed diamond: lighter in the middle (colour) and raised (bump).
      for (const [ctx, inner, outer] of [[g, "rgba(104,112,94,0.4)", "rgba(40,44,36,0.0)"], [gb, "rgba(255,255,255,1)", "rgba(0,0,0,0)"]]) {
        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, step * 0.62);
        grad.addColorStop(0, inner);
        grad.addColorStop(1, outer);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy - step / 2);
        ctx.lineTo(cx + step / 2, cy);
        ctx.lineTo(cx, cy + step / 2);
        ctx.lineTo(cx - step / 2, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // The stitching: dark diagonal seams.
  for (const [ctx, colour, width] of [[g, "rgba(30,33,27,0.55)", 1.5], [gb, "#000", 3]]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    for (let k = -S; k <= 2 * S; k += step) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + S, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(k, S);
      ctx.lineTo(k + S, 0);
      ctx.stroke();
    }
  }
  // Grime and wear.
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 420; i += 1) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "20,22,18" : "150,150,130"},${0.04 + rnd() * 0.07})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 6, 1 + rnd() * 6);
  }
  // Small diamonds (~12 cm), as on a real soundproofing blanket.
  return { map: colourTexture(c, [7, 4]), bump: dataTexture(b, [7, 4]) };
}

/** Ribbed aluminium floor plate with tie-down tracks, scuffed. */
function floorTextures() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const [b, gb] = canvas(S, S);
  g.fillStyle = "#3a3d3c";
  g.fillRect(0, 0, S, S);
  gb.fillStyle = "#808080";
  gb.fillRect(0, 0, S, S);
  // Raised diamond treads.
  for (let y = 0; y < S; y += 16) {
    for (let x = (y / 16) % 2 ? 8 : 0; x < S; x += 16) {
      for (const [ctx, colour] of [[g, "#4f5352"], [gb, "#e0e0e0"]]) {
        ctx.save();
        ctx.translate(x + 4, y + 8);
        ctx.rotate((y / 16) % 2 ? 0.6 : -0.6);
        ctx.fillStyle = colour;
        ctx.fillRect(-6, -1.5, 12, 3);
        ctx.restore();
      }
    }
  }
  // Two tie-down tracks, with their holes.
  for (const x of [S * 0.25, S * 0.75]) {
    g.fillStyle = "#222524";
    g.fillRect(x - 6, 0, 12, S);
    gb.fillStyle = "#202020";
    gb.fillRect(x - 6, 0, 12, S);
    for (let y = 8; y < S; y += 21) {
      g.fillStyle = "#0e0f0f";
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 260; i += 1) {
    g.fillStyle = `rgba(${rnd() < 0.6 ? "10,10,10" : "170,170,160"},${0.05 + rnd() * 0.08})`;
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 20, 1 + rnd() * 2);
  }
  return { map: colourTexture(c, [2, 4]), bump: dataTexture(b, [2, 4]) };
}

/** Woven seat webbing: red nylon strips, over and under. */
function webbingTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#4a100d";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      const over = (i + j) % 2 === 0;
      g.fillStyle = over ? "#8e2219" : "#6e1913";
      g.fillRect(i * 16 + 1, j * 16 + (over ? 1 : 4), 14, over ? 14 : 8);
      g.fillStyle = over ? "#6a1812" : "#8a2118";
      g.fillRect(i * 16 + (over ? 4 : 1), j * 16 + 1, over ? 8 : 14, 14);
    }
  }
  return colourTexture(c, [2, 2]);
}

/** A stencilled placard: white on dark, or red-cross white. */
function placardTexture(text, { bg = "#151816", fg = "#e8e4d6", cross = false } = {}) {
  const [c, g] = canvas(256, 96);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 96);
  if (cross) {
    g.fillStyle = "#c42020";
    g.fillRect(108, 14, 40, 68);
    g.fillRect(94, 28, 68, 40);
  } else {
    g.fillStyle = fg;
    g.font = "bold 40px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 50);
    g.strokeStyle = fg;
    g.lineWidth = 4;
    g.strokeRect(8, 8, 240, 80);
  }
  return colourTexture(c);
}

export class CabinStage {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = "CabinStage";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const quilt = quiltTextures();
    const plate = floorTextures();
    for (const t of [quilt.map, quilt.bump, plate.map, plate.bump]) own(t);
    const mat = {
      quilt: own(new THREE.MeshStandardMaterial({ map: quilt.map, bumpMap: quilt.bump, bumpScale: 1.2, roughness: 0.95, metalness: 0 })),
      olive: own(new THREE.MeshStandardMaterial({ color: 0x4b5332, roughness: 0.72, metalness: 0.3 })),
      steel: own(new THREE.MeshStandardMaterial({ color: 0x70767a, roughness: 0.42, metalness: 0.8 })),
      dark: own(new THREE.MeshStandardMaterial({ color: 0x1c1e1d, roughness: 0.6, metalness: 0.4 })),
      rubber: own(new THREE.MeshStandardMaterial({ color: 0x101111, roughness: 0.95 })),
      floor: own(new THREE.MeshStandardMaterial({ map: plate.map, bumpMap: plate.bump, bumpScale: 1.4, roughness: 0.55, metalness: 0.65 })),
      webbing: own(new THREE.MeshStandardMaterial({ map: own(webbingTexture()), roughness: 0.92, side: THREE.DoubleSide })),
      cushion: own(new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.82 })),
      red: own(new THREE.MeshStandardMaterial({ color: 0xa8140f, roughness: 0.45, metalness: 0.3 })),
      buckle: own(new THREE.MeshStandardMaterial({ color: 0xb7bcbf, roughness: 0.3, metalness: 0.9 })),
      glass: own(new THREE.MeshStandardMaterial({ color: 0x9fb8c0, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide })),
      strip: own(new THREE.MeshBasicMaterial({ color: 0xff3a24 })),
      nightLight: own(new THREE.MeshBasicMaterial({ color: 0xff2a18 })),
      panel: own(new THREE.MeshBasicMaterial({ map: own(panelTexture()) })),
    };
    const box = own(new THREE.BoxGeometry(1, 1, 1));
    const tube = own(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
    const part = (m, sx, sy, sz, x, y, z, parent = this.root) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    /** A tube from a to b (frames, rails). */
    const rod = (m, r, a, b, parent = this.root) => {
      const from = new THREE.Vector3(...a);
      const to = new THREE.Vector3(...b);
      const mesh = new THREE.Mesh(tube, m);
      mesh.position.copy(from).lerp(to, 0.5);
      mesh.scale.set(r * 2, from.distanceTo(to), r * 2);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
      parent.add(mesh);
      return mesh;
    };
    /** A flat, textured plane (placards, webbing). */
    const sheet = (material, w, h, x, y, z, ry = 0, parent = this.root) => {
      const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      parent.add(mesh);
      return mesh;
    };

    // ---- The hull: 2.4 m wide, walls 1.55 m then a rounded roof to 1.9 m,
    // from the bulkhead (-1.6) to the tail (2.7).
    const W = 1.2;
    const H = 1.9;
    const WALL = 1.55;
    const L = 4.4;
    const Z0 = 0.5;
    part(mat.floor, W * 2, 0.08, L, 0, -0.04, Z0);
    // The roof: the top half of a cylinder along the cabin, flattened to the
    // roof's rise, quilted on the inside.
    const roofGeo = own(new THREE.CylinderGeometry(W, W, L, 24, 1, true, Math.PI / 2, Math.PI));
    roofGeo.rotateX(Math.PI / 2); // axis along z; theta pi/2..3pi/2 is the upper half
    const roofMat = own(mat.quilt.clone());
    roofMat.side = THREE.BackSide;
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.scale.set(1, (H - WALL) / W, 1);
    roof.position.set(0, WALL, Z0);
    this.root.add(roof);
    // Right wall, whole, padded.
    part(mat.quilt, 0.06, WALL, L, W, WALL / 2, Z0);
    // Left wall: the open door between z = -0.6 and 1.6.
    part(mat.quilt, 0.06, WALL, 1.0, -W, WALL / 2, -1.1);
    part(mat.quilt, 0.06, WALL, 1.1, -W, WALL / 2, 2.15);
    // The door frame: black rubber seal round the opening, the sill plate.
    part(mat.rubber, 0.1, WALL, 0.07, -W, WALL / 2, -0.6);
    part(mat.rubber, 0.1, WALL, 0.07, -W, WALL / 2, 1.6);
    part(mat.steel, 0.12, 0.04, 2.2, -W, 0.02, 0.5);
    // The door's rail, the door slid back along the hull.
    rod(mat.steel, 0.025, [-W - 0.06, WALL - 0.08, -0.6], [-W - 0.06, WALL - 0.08, 2.7]);
    part(mat.olive, 0.05, WALL - 0.1, 2.2, -W - 0.1, (WALL - 0.1) / 2, 2.9);
    // Tail wall, with a cargo net over it.
    part(mat.quilt, W * 2, H, 0.06, 0, H / 2, 2.7);
    for (let i = 0; i <= 8; i += 1) {
      rod(mat.cushion, 0.008, [-W + 0.15 + i * 0.26, 0.15, 2.64], [-W + 0.15 + i * 0.26, 1.55, 2.64]);
      rod(mat.cushion, 0.008, [-W + 0.15, 0.15 + i * 0.175, 2.64], [W - 0.15, 0.15 + i * 0.175, 2.64]);
    }
    // Frames: steel ribs round the hull every 0.6 m, and the stringers.
    const ribGeo = own(new THREE.TorusGeometry(W - 0.03, 0.03, 6, 24, Math.PI));
    for (let z = -1.2; z <= 2.4; z += 0.6) {
      const rib = new THREE.Mesh(ribGeo, mat.steel);
      rib.scale.set(1, (H - WALL) / W, 1);
      rib.position.set(0, WALL, z);
      this.root.add(rib);
      rod(mat.steel, 0.03, [W - 0.05, 0, z], [W - 0.05, WALL, z]);
    }
    // Grab rails along the roof; red night-light strips beside them.
    rod(mat.steel, 0.018, [0.55, H - 0.2, -1.4], [0.55, H - 0.2, 2.6]);
    rod(mat.steel, 0.018, [-0.55, H - 0.2, -1.4], [-0.55, H - 0.2, 2.6]);
    part(mat.strip, 0.035, 0.02, 3.4, 0.85, H - 0.12, 0.6);
    part(mat.strip, 0.035, 0.02, 3.4, -0.85, H - 0.12, 0.6);
    for (const z of [-0.9, 0.5, 1.9]) {
      const dome = new THREE.Mesh(own(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), mat.nightLight);
      dome.position.set(0, H - 0.01, z);
      this.root.add(dome);
    }

    // ---- Troop seats: tube frames, red webbing seat and back, harness straps.
    const seatRow = (x, z0, count, side) => {
      for (let i = 0; i < count; i += 1) {
        const z = z0 + i * 0.52;
        // Frame: two legs, a front rail, the back posts to the wall.
        rod(mat.steel, 0.016, [x - side * 0.2, 0, z - 0.22], [x - side * 0.2, 0.44, z - 0.22]);
        rod(mat.steel, 0.016, [x - side * 0.2, 0, z + 0.22], [x - side * 0.2, 0.44, z + 0.22]);
        rod(mat.steel, 0.018, [x - side * 0.2, 0.44, z - 0.25], [x - side * 0.2, 0.44, z + 0.25]);
        rod(mat.steel, 0.018, [x + side * 0.2, 0.44, z - 0.25], [x + side * 0.2, 0.44, z + 0.25]);
        // The seat (webbing slung between the rails, sagging a little).
        const pan = sheet(mat.webbing, 0.4, 0.46, x, 0.43, z);
        pan.rotation.set(-Math.PI / 2, 0, 0);
        // The back (webbing against the wall).
        const back = sheet(mat.webbing, 0.46, 0.5, x + side * 0.215, 0.78, z, -side * Math.PI / 2);
        back.rotation.z = 0;
        // Shoulder straps and a buckle.
        for (const dz of [-0.09, 0.09]) part(mat.dark, 0.012, 0.42, 0.045, x + side * 0.2, 0.72, z + dz);
        part(mat.buckle, 0.02, 0.05, 0.07, x + side * 0.19, 0.52, z);
      }
    };
    seatRow(W - 0.27, -0.35, 5, 1);
    seatRow(-W + 0.27, 1.95, 1, -1);

    // ---- Kit on the walls.
    // A fire extinguisher on the bulkhead.
    const ext = new THREE.Mesh(tube, mat.red);
    ext.scale.set(0.11, 0.42, 0.11);
    ext.position.set(0.95, 0.42, -1.53);
    this.root.add(ext);
    rod(mat.dark, 0.012, [0.95, 0.66, -1.53], [0.95, 0.72, -1.48]);
    part(mat.steel, 0.14, 0.02, 0.05, 0.95, 0.3, -1.55);
    // The first-aid kit (white, red cross), on the right wall aft.
    const kit = part(own(new THREE.MeshStandardMaterial({ color: 0xe9e7df, roughness: 0.6 })), 0.08, 0.26, 0.34, W - 0.07, 1.25, 2.35);
    kit.name = "FirstAid";
    sheet(own(new THREE.MeshBasicMaterial({ map: own(placardTexture("", { bg: "#e9e7df", cross: true })) })), 0.3, 0.22, W - 0.115, 1.25, 2.35, -Math.PI / 2);
    // Headsets on hooks above the seats.
    const cupGeo = own(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14));
    const bandGeo = own(new THREE.TorusGeometry(0.09, 0.008, 6, 16, Math.PI));
    for (const z of [-0.1, 0.95]) {
      const set = new THREE.Group();
      set.position.set(W - 0.1, 1.32, z);
      set.rotation.y = Math.PI / 2;
      const band = new THREE.Mesh(bandGeo, mat.dark);
      for (const dx of [-0.09, 0.09]) {
        const cup = new THREE.Mesh(cupGeo, mat.rubber);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(dx, -0.02, 0);
        set.add(cup);
      }
      set.add(band);
      this.root.add(set);
      rod(mat.steel, 0.006, [W - 0.04, 1.42, z], [W - 0.1, 1.41, z]);
    }
    // Placards: the exit, and no step on the sill.
    sheet(own(new THREE.MeshBasicMaterial({ map: own(placardTexture("EXIT", { fg: "#ff5a4a" })) })), 0.32, 0.12, -W + 0.04, 1.38, -0.8, Math.PI / 2);
    sheet(own(new THREE.MeshBasicMaterial({ map: own(placardTexture("NO STEP")) })), 0.24, 0.09, 0.45, 0.012, -1.4, 0).rotation.x = -Math.PI / 2;

    // ---- The bulkhead, with a gap through to the cockpit.
    // (Painted metal, as bulkheads are: the hull's quilting on these narrow
    // panels shaded like curved walls.)
    part(mat.olive, 0.7, H, 0.06, -0.85, H / 2, -1.6);
    part(mat.olive, 0.7, H, 0.06, 0.85, H / 2, -1.6);
    part(mat.olive, 1.0, 0.45, 0.06, 0, H - 0.22, -1.6);
    // Rivet lines down the bulkhead's seams.
    for (const x of [-1.15, -0.55, 0.55, 1.15]) rod(mat.dark, 0.006, [x, 0.05, -1.565], [x, H - 0.05, -1.565]);
    part(mat.rubber, 1.04, 0.05, 0.1, 0, H - 0.45, -1.6);
    rod(mat.rubber, 0.03, [-0.5, 0, -1.6], [-0.5, H - 0.45, -1.6]);
    rod(mat.rubber, 0.03, [0.5, 0, -1.6], [0.5, H - 0.45, -1.6]);

    // ---- Cockpit: floor, the pilot's bucket seat (back to you), the panel.
    part(mat.floor, 2.0, 0.08, 1.8, 0, -0.04, -2.5);
    const seat = new THREE.Group();
    seat.position.set(0, 0, -2.45);
    this.root.add(seat);
    // Pedestal and rails.
    part(mat.dark, 0.36, 0.3, 0.36, 0, 0.15, 0, seat);
    rod(mat.steel, 0.015, [-0.2, 0.02, -0.3], [-0.2, 0.02, 0.3], seat);
    rod(mat.steel, 0.015, [0.2, 0.02, -0.3], [0.2, 0.02, 0.3], seat);
    // The bucket: a cushioned pan, side bolsters, a low back (his head shows over it).
    part(mat.cushion, 0.5, 0.1, 0.5, 0, 0.36, -0.02, seat);
    for (const sx of [-0.27, 0.27]) {
      part(mat.olive, 0.06, 0.2, 0.52, sx, 0.42, -0.02, seat);
      part(mat.olive, 0.06, 0.5, 0.1, sx, 0.66, 0.26, seat);
      // Armrests.
      part(mat.cushion, 0.07, 0.05, 0.3, sx * 1.12, 0.58, 0.02, seat);
      rod(mat.steel, 0.012, [sx * 1.12, 0.42, 0.02], [sx * 1.12, 0.56, 0.02], seat);
    }
    const back = part(mat.cushion, 0.5, 0.62, 0.1, 0, 0.72, 0.28, seat);
    back.rotation.x = -0.12;
    part(mat.olive, 0.54, 0.06, 0.12, 0, 1.03, 0.31, seat);
    // His harness: shoulder straps over the top of the back, a lap belt.
    for (const sx of [-0.1, 0.1]) part(mat.dark, 0.05, 0.4, 0.012, sx, 0.86, 0.226, seat);
    part(mat.buckle, 0.07, 0.07, 0.02, 0, 0.47, 0.25, seat);
    this.seat = seat;
    const panel = part(mat.olive, 1.8, 0.5, 0.35, 0, 0.95, -3.25);
    panel.rotation.x = -0.4;
    // A glare shield over the instruments.
    const shield = part(mat.dark, 1.85, 0.05, 0.3, 0, 1.24, -3.15);
    shield.rotation.x = -0.1;
    const screen = new THREE.Mesh(own(new THREE.PlaneGeometry(1.6, 0.42)), mat.panel);
    screen.position.set(0, 1.07, -3.06);
    screen.rotation.x = -0.4;
    this.root.add(screen);
    // The centre console between the seats.
    part(mat.dark, 0.3, 0.55, 0.6, 0.48, 0.3, -2.7);
    // Windscreen frame and glass.
    rod(mat.steel, 0.03, [-0.8, 1.1, -3.25], [-0.8, 2.08, -3.2]);
    rod(mat.steel, 0.03, [0.8, 1.1, -3.25], [0.8, 2.08, -3.2]);
    rod(mat.steel, 0.03, [0, 1.15, -3.3], [0, 2.05, -3.22]);
    rod(mat.steel, 0.03, [-0.85, 2.05, -3.2], [0.85, 2.05, -3.2]);
    const glass = new THREE.Mesh(own(new THREE.PlaneGeometry(1.6, 0.95)), mat.glass);
    glass.position.set(0, 1.6, -3.3);
    glass.rotation.x = 0.25;
    this.root.add(glass);
    part(mat.quilt, 2.0, 0.06, 1.8, 0, 2.1, -2.5);

    this.anchors = {
      /** You, on the bench by the open door. */
      seatEye: new THREE.Vector3(W - 0.35, 1.18, 0.75),
      /** Where the pilot sits (his root), facing -Z (the nose). */
      pilot: new THREE.Vector3(0, 0, -2.42),
      /** Out of the door, down at the city. */
      doorLook: new THREE.Vector3(-6, -2.5, 0.4),
      /** Through the bulkhead, the back of the pilot's head. */
      pilotBack: new THREE.Vector3(0, 1.45, -2.3),
    };
  }

  /** A local point in world space. */
  world(local, out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(out.copy(local));
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose();
    this.owned.length = 0;
  }
}
