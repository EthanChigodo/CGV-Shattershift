/**
 * The helicopter's cabin, inside (Phase 6, the ending): built in code to
 * match helicopter.glb's exterior - olive drab, worn steel, red webbing - with
 * the side door open on the burning tower and a cockpit through the bulkhead
 * where the pilot sits with his back to you.
 *
 * Local frame: the nose is -Z (the cockpit), the open door is on the left
 * (-X) side of the cabin, the floor at y = 0. Lit by the scene it sits in
 * (the roof's) plus unlit glowing instruments - no lights of its own.
 *
 *   const cabin = new CabinStage();
 *   scene.add(cabin.root);
 *   cabin.anchors.seatEye / pilotSeat / doorLook ... (local; cabin.world(v))
 */

import * as THREE from "../../three.js";

function panelTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CabinStage {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = "CabinStage";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const mat = {
      olive: own(new THREE.MeshStandardMaterial({ color: 0x48502f, roughness: 0.78, metalness: 0.25 })),
      steel: own(new THREE.MeshStandardMaterial({ color: 0x5d6266, roughness: 0.5, metalness: 0.75 })),
      floor: own(new THREE.MeshStandardMaterial({ color: 0x2e3130, roughness: 0.7, metalness: 0.6 })),
      webbing: own(new THREE.MeshStandardMaterial({ color: 0x7a1d18, roughness: 0.9 })),
      seat: own(new THREE.MeshStandardMaterial({ color: 0x2b2f24, roughness: 0.85 })),
      glass: own(new THREE.MeshStandardMaterial({ color: 0x9fb8c0, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide })),
      strip: own(new THREE.MeshBasicMaterial({ color: 0xff3a24 })),
      panel: own(new THREE.MeshBasicMaterial({ map: own(panelTexture()) })),
    };
    const box = own(new THREE.BoxGeometry(1, 1, 1));
    const cyl = own(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
    const part = (m, sx, sy, sz, x, y, z, parent = this.root) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // The hull: 2.4 m wide, 1.9 m tall, from the bulkhead (-1.6) to the tail (2.6).
    const W = 1.2;
    const H = 1.9;
    part(mat.floor, W * 2, 0.08, 4.4, 0, -0.04, 0.5);
    part(mat.olive, W * 2, 0.08, 4.4, 0, H, 0.5);
    // Right wall, whole.
    part(mat.olive, 0.08, H, 4.4, W, H / 2, 0.5);
    // Left wall: the open door between z = -0.6 and 1.6.
    part(mat.olive, 0.08, H, 1.0, -W, H / 2, -1.1);
    part(mat.olive, 0.08, H, 1.0, -W, H / 2, 2.2);
    part(mat.olive, 0.08, 0.3, 2.2, -W, H - 0.15, 0.5);
    // The door's rail, slid back along the hull.
    part(mat.steel, 0.06, 0.05, 2.6, -W - 0.05, H - 0.32, 1.9);
    part(mat.olive, 0.05, H - 0.3, 2.2, -W - 0.09, (H - 0.3) / 2, 2.9);
    // Tail wall.
    part(mat.olive, W * 2, H, 0.08, 0, H / 2, 2.7);
    // Ribs and a grab rail along the roof.
    for (let z = -1.2; z <= 2.4; z += 0.6) {
      part(mat.steel, W * 2, 0.06, 0.06, 0, H - 0.05, z);
      part(mat.steel, 0.06, H, 0.06, W - 0.04, H / 2, z);
    }
    part(mat.steel, 0.04, 0.04, 3.6, 0.6, H - 0.22, 0.6);
    part(mat.steel, 0.04, 0.04, 3.6, -0.6, H - 0.22, 0.6);
    // Red emergency strip lights.
    part(mat.strip, 0.04, 0.03, 3.4, 0.9, H - 0.08, 0.6);
    part(mat.strip, 0.04, 0.03, 3.4, -0.9, H - 0.08, 0.6);
    // A bench of webbing seats along the right wall (yours), and one on the left aft.
    const bench = (x, z0, z1, side) => {
      part(mat.seat, 0.45, 0.06, z1 - z0, x, 0.45, (z0 + z1) / 2);
      part(mat.webbing, 0.05, 0.5, z1 - z0, x + side * 0.22, 0.75, (z0 + z1) / 2);
      for (let z = z0; z <= z1 + 1e-3; z += 0.55) part(mat.steel, 0.04, 0.45, 0.04, x - side * 0.15, 0.22, z);
    };
    bench(W - 0.3, -0.4, 2.3, 1);
    bench(-W + 0.3, 1.7, 2.4, -1);

    // The bulkhead, with a gap through to the cockpit.
    part(mat.olive, 0.7, H, 0.08, -0.85, H / 2, -1.6);
    part(mat.olive, 0.7, H, 0.08, 0.85, H / 2, -1.6);
    part(mat.olive, 1.0, 0.45, 0.08, 0, H - 0.22, -1.6);
    // Cockpit: floor, the pilot's seat (back to you), the panel, the screen.
    part(mat.floor, 2.0, 0.08, 1.8, 0, -0.04, -2.5);
    const seat = new THREE.Group();
    seat.position.set(0, 0, -2.45);
    this.root.add(seat);
    // A low back, so the pilot's head and helmet show over it.
    part(mat.seat, 0.6, 0.12, 0.55, 0, 0.5, 0, seat);
    part(mat.seat, 0.6, 0.42, 0.12, 0, 0.74, 0.3, seat);
    part(mat.steel, 0.08, 0.5, 0.08, 0, 0.25, 0, seat);
    this.seat = seat;
    const panel = part(mat.olive, 1.8, 0.5, 0.35, 0, 0.95, -3.25);
    panel.rotation.x = -0.4;
    const screen = new THREE.Mesh(own(new THREE.PlaneGeometry(1.6, 0.42)), mat.panel);
    screen.position.set(0, 1.07, -3.06);
    screen.rotation.x = -0.4;
    this.root.add(screen);
    // Windscreen frame and glass.
    part(mat.steel, 0.06, 1.0, 0.06, -0.8, 1.6, -3.25);
    part(mat.steel, 0.06, 1.0, 0.06, 0.8, 1.6, -3.25);
    part(mat.steel, 1.7, 0.06, 0.06, 0, 2.05, -3.2);
    const glass = new THREE.Mesh(own(new THREE.PlaneGeometry(1.6, 0.95)), mat.glass);
    glass.position.set(0, 1.6, -3.3);
    glass.rotation.x = 0.25;
    this.root.add(glass);
    part(mat.olive, 2.0, 0.08, 1.8, 0, 2.1, -2.5);

    // The pilot's helmet (Dr. Vale keeps it on): open-faced, so when he turns
    // round you see who it is.
    const helmet = new THREE.Group();
    const shell = new THREE.Mesh(own(new THREE.SphereGeometry(0.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)), mat.olive);
    shell.scale.set(1, 1.05, 1.12);
    const boom = new THREE.Mesh(cyl, mat.steel);
    boom.scale.set(0.012, 0.16, 0.012);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0.11, -0.12, -0.08);
    helmet.add(shell, boom);
    this.root.add(helmet);
    this.helmet = helmet;

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
