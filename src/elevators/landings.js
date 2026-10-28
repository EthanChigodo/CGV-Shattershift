/**
 * The quiet ride's two landings (quiet-ride.js), as the levels themselves
 * look - not painted on the tower's face:
 *
 *   the Labs        white tiled walls, black pillars, the red floor lines,
 *                   fluorescent strips failing, a specimen tank, and fire -
 *                   the floor the lift leaves, burning
 *   the skybridge   the Skyline's corridor: cream panels with the teal
 *                   band, the ceiling tile grid, cyan floor strips, EXIT
 *
 * And the tower's face with real doorways in it (towerWithOpenings): the
 * single box of kit.js is solid, so a corridor behind a doorway wouldn't
 * show; here it is blocks round two door-height openings, drawn with the
 * same (world-space) window shader, so the seams don't show.
 *
 * Frame as kit.js: the doors open toward +Z onto the tower's face at
 * z = TOWER_FACE; a landing's floor is at its y = 0, its corridor running
 * into the tower (+Z).
 */

import * as THREE from "../three.js";
import { TOWER_FACE, CITY_Y, TOWER_TOP } from "./kit.js";

/** A doorway: this wide and high; the corridor behind it this deep. */
export const LANDING = { width: 3.2, height: 3.4, depth: 11.6 };

function canvasTexture(owned, w, h, draw, repeat = [1, 1]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = owned.add(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}

function box(owned, geo, mat, [sx, sy, sz], [x, y, z]) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

/**
 * The tower: its back, and the front blocks round the lift's column, which
 * leave a door-height opening at each landing (`openings`: floor heights).
 */
export function towerWithOpenings(material, owned, openings) {
  const root = new THREE.Group();
  root.name = "AscensionTowerFaced";
  const geo = owned.add(new THREE.BoxGeometry(1, 1, 1));
  const W = 46, D = 40, front = LANDING.depth + 0.4, half = LANDING.width / 2;
  const H = TOWER_TOP - CITY_Y;
  root.add(box(owned, geo, material, [W, H, D - front], [0, CITY_Y + H / 2, TOWER_FACE + front + (D - front) / 2]));
  for (const side of [-1, 1]) {
    const w = W / 2 - half;
    root.add(box(owned, geo, material, [w, H, front], [side * (half + w / 2), CITY_Y + H / 2, TOWER_FACE + front / 2]));
  }
  // The lift's column: solid but for the openings.
  let from = CITY_Y;
  for (const y of [...openings].sort((a, b) => a - b)) {
    if (y > from) root.add(box(owned, geo, material, [LANDING.width, y - from, front], [0, (from + y) / 2, TOWER_FACE + front / 2]));
    from = y + LANDING.height;
  }
  root.add(box(owned, geo, material, [LANDING.width, TOWER_TOP - from, front], [0, (from + TOWER_TOP) / 2, TOWER_FACE + front / 2]));
  return root;
}

/** The corridor's shell: floor, walls, ceiling, end wall - textures and colours per level. */
function corridor(owned, { floor, wall, ceiling, end }) {
  const root = new THREE.Group();
  const { width: w, height: h, depth: d } = LANDING;
  const plane = owned.add(new THREE.PlaneGeometry(1, 1));
  const at = (mat, sx, sy, pos, rot) => {
    const m = new THREE.Mesh(plane, mat);
    m.scale.set(sx, sy, 1);
    m.position.set(...pos);
    m.rotation.set(...rot);
    root.add(m);
    return m;
  };
  at(floor, w, d, [0, 0.01, TOWER_FACE + d / 2], [-Math.PI / 2, 0, 0]);
  at(ceiling, w, d, [0, h - 0.01, TOWER_FACE + d / 2], [Math.PI / 2, 0, 0]);
  at(wall, d, h, [-w / 2 + 0.01, h / 2, TOWER_FACE + d / 2], [0, Math.PI / 2, 0]);
  at(wall, d, h, [w / 2 - 0.01, h / 2, TOWER_FACE + d / 2], [0, -Math.PI / 2, 0]);
  at(end ?? wall, w, h, [0, h / 2, TOWER_FACE + d - 0.01], [0, Math.PI, 0]);
  return root;
}

/** A flame: an additive sprite-like plane that flickers (update). */
function flameTexture(owned) {
  return canvasTexture(owned, 64, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h * 0.78, 2, w / 2, h * 0.7, h * 0.62);
    grad.addColorStop(0, "rgba(255,240,190,1)");
    grad.addColorStop(0.25, "rgba(255,170,60,0.95)");
    grad.addColorStop(0.6, "rgba(230,70,15,0.55)");
    grad.addColorStop(1, "rgba(120,20,0,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(w * 0.1, h);
    g.bezierCurveTo(w * 0.05, h * 0.5, w * 0.45, h * 0.35, w * 0.5, 0);
    g.bezierCurveTo(w * 0.55, h * 0.35, w * 0.95, h * 0.5, w * 0.9, h);
    g.fill();
  });
}

/**
 * The Labs, burning: the floor the lift leaves. update(dt, time) flickers
 * the fire and the failing lights.
 */
export function buildLabsLanding(owned) {
  const tiles = canvasTexture(owned, 256, 256, (g, w, h) => {
    g.fillStyle = "#d9d6cf";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(90,90,86,0.55)";
    g.lineWidth = 2;
    for (let i = 0; i <= 8; i += 1) {
      g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke();
    }
    // Soot rising up the tiles.
    const soot = g.createLinearGradient(0, h, 0, 0);
    soot.addColorStop(0, "rgba(30,24,20,0.0)");
    soot.addColorStop(1, "rgba(30,24,20,0.45)");
    g.fillStyle = soot;
    g.fillRect(0, 0, w, h);
  }, [6, 2]);
  const grime = canvasTexture(owned, 256, 256, (g, w, h) => {
    g.fillStyle = "#2c2622";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i += 1) {
      g.fillStyle = `rgba(${120 + Math.random() * 60},${80 + Math.random() * 40},${50 + Math.random() * 30},${Math.random() * 0.25})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 1 + Math.random() * 3);
    }
  }, [1, 4]);
  const shell = corridor(owned, {
    floor: owned.add(new THREE.MeshStandardMaterial({ map: grime, roughness: 0.55, metalness: 0.1 })),
    wall: owned.add(new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.6 })),
    ceiling: owned.add(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 })),
  });
  const root = new THREE.Group();
  root.name = "LabsLanding";
  root.add(shell);
  const geo = owned.add(new THREE.BoxGeometry(1, 1, 1));
  const black = owned.add(new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.7 }));
  const red = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.07, 0.04) }));
  const { width: w, height: h, depth: d } = LANDING;
  // Black pillars down the walls, the red lines along the floor's edges.
  for (let z = 1.5; z < d; z += 3.6) for (const s of [-1, 1]) root.add(box(owned, geo, black, [0.22, h, 0.34], [s * (w / 2 - 0.1), h / 2, TOWER_FACE + z]));
  for (const s of [-1, 1]) root.add(box(owned, geo, red, [0.06, 0.012, d - 0.4], [s * (w / 2 - 0.42), 0.02, TOWER_FACE + d / 2]));
  // Fluorescent strips: some dead, one stuttering.
  const lamps = [];
  for (let i = 0; i < 4; i += 1) {
    const mat = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.4, 1.3) }));
    const strip = box(owned, geo, mat, [0.16, 0.04, 1.4], [0, h - 0.04, TOWER_FACE + 1.6 + i * 2.8]);
    root.add(strip);
    lamps.push({ mat, dead: i === 2, stutter: i === 1 });
  }
  // A specimen tank by the left wall, its green glow through the smoke.
  const tankGlass = owned.add(new THREE.MeshStandardMaterial({ color: 0x2bd46a, emissive: 0x1aa050, emissiveIntensity: 1.2, transparent: true, opacity: 0.55, roughness: 0.1 }));
  const tank = new THREE.Mesh(owned.add(new THREE.CylinderGeometry(0.42, 0.42, 1.9, 20)), tankGlass);
  tank.position.set(-w / 2 + 0.6, 1.25, TOWER_FACE + 6.3);
  const cap = new THREE.Mesh(owned.add(new THREE.CylinderGeometry(0.48, 0.48, 0.18, 20)), black);
  cap.position.set(tank.position.x, 2.28, tank.position.z);
  const base = cap.clone();
  base.position.y = 0.22;
  root.add(tank, cap, base);
  // Fallen ceiling and debris on the floor.
  const debris = owned.add(new THREE.MeshStandardMaterial({ color: 0x3a3532, roughness: 0.95 }));
  for (const [x, z, s, r] of [[0.7, 4.2, 0.5, 0.4], [-0.3, 7.9, 0.7, -0.6], [0.9, 9.8, 0.4, 1.1], [-0.9, 3.0, 0.35, 0.2]]) {
    const b = box(owned, geo, debris, [s, s * 0.35, s * 0.8], [x, s * 0.17, TOWER_FACE + z]);
    b.rotation.y = r;
    root.add(b);
  }
  // The fire: across the far end and up the right wall, flickering.
  const flame = flameTexture(owned);
  const flames = [];
  const plane = owned.add(new THREE.PlaneGeometry(1, 1));
  for (let i = 0; i < 9; i += 1) {
    const mat = owned.add(new THREE.MeshBasicMaterial({ map: flame, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
    const f = new THREE.Mesh(plane, mat);
    const far = i < 5;
    const x = far ? -1.2 + i * 0.6 : w / 2 - 0.35;
    const z = far ? d - 1.4 - (i % 2) * 0.5 : 4.5 + (i - 5) * 1.6;
    f.position.set(x, 0.9, TOWER_FACE + z);
    if (!far) f.rotation.y = Math.PI / 2;
    const size = far ? 1.3 + (i % 3) * 0.35 : 0.9 + (i % 2) * 0.4;
    f.scale.set(size * 0.7, size * 1.4, 1);
    f.position.y = size * 0.7;
    root.add(f);
    flames.push({ mesh: f, mat, size, phase: i * 1.7 });
  }
  // Smoke under the ceiling.
  const smokeMat = owned.add(new THREE.MeshBasicMaterial({ color: 0x120c09, transparent: true, opacity: 0.55, depthWrite: false }));
  const smoke = new THREE.Mesh(plane, smokeMat);
  smoke.rotation.x = Math.PI / 2;
  smoke.scale.set(w, d, 1);
  smoke.position.set(0, h - 0.45, TOWER_FACE + d / 2);
  root.add(smoke);
  // The fire's light down the corridor (and onto the cabin as the doors close).
  const light = new THREE.PointLight(0xff7a2e, 18, 16, 1.6);
  light.position.set(0, 1.6, TOWER_FACE + d - 2.5);
  root.add(light);

  const update = (dt, time) => {
    for (const f of flames) {
      const k = 0.85 + 0.15 * Math.sin(time * 9 + f.phase) * Math.sin(time * 5.3 + f.phase * 2);
      f.mesh.scale.y = f.size * 1.4 * k;
      f.mesh.position.y = f.size * 0.7 * k;
      f.mat.opacity = 0.75 + 0.25 * Math.sin(time * 13 + f.phase);
    }
    light.intensity = 14 + 6 * Math.sin(time * 11) * Math.sin(time * 4.1);
    for (const l of lamps) {
      const on = l.dead ? 0.04 : l.stutter ? (Math.sin(time * 37) + Math.sin(time * 23) > 0.6 ? 1 : 0.08) : 1;
      l.mat.color.setRGB(1.4 * on, 1.4 * on, 1.3 * on);
    }
  };
  return { root, update };
}

/**
 * The skybridge: the Skyline's own corridor, where the doors open. update()
 * takes how far open the doors are, for its light.
 */
export function buildSkybridgeLanding(owned) {
  const panels = canvasTexture(owned, 512, 256, (g, w, h) => {
    g.fillStyle = "#cbbfa8";
    g.fillRect(0, 0, w, h);
    // Panel seams, a streak or two down each, the teal band at hip height.
    for (let i = 0; i < 4; i += 1) {
      const x = i * w / 4;
      g.fillStyle = "rgba(60,50,40,0.6)";
      g.fillRect(x, 0, 3, h);
      g.fillStyle = "rgba(70,60,50,0.12)";
      g.fillRect(x + 30 + Math.random() * 40, 0, 6, h * (0.4 + Math.random() * 0.5));
    }
    g.fillStyle = "#2a8f86";
    g.fillRect(0, h * 0.7, w, h * 0.035);
    g.fillStyle = "#3a332c";
    g.fillRect(0, h * 0.93, w, h * 0.07);
    // Vent grilles low on the wall.
    g.fillStyle = "rgba(40,36,32,0.85)";
    for (let i = 0; i < 4; i += 1) for (let j = 0; j < 5; j += 1) g.fillRect(i * w / 4 + 40 + j * 9, h * 0.78, 5, h * 0.1);
  }, [3, 1]);
  const ceilingTiles = canvasTexture(owned, 256, 256, (g, w, h) => {
    g.fillStyle = "#8c8174";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#2c2824";
    g.lineWidth = 4;
    for (let i = 0; i <= 4; i += 1) {
      g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
    }
  }, [1, 4]);
  const floorTiles = canvasTexture(owned, 256, 256, (g, w, h) => {
    g.fillStyle = "#3b302b";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(20,16,14,0.9)";
    g.lineWidth = 3;
    for (let i = 0; i <= 2; i += 1) {
      g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke();
    }
  }, [2, 6]);
  const shell = corridor(owned, {
    floor: owned.add(new THREE.MeshStandardMaterial({ map: floorTiles, roughness: 0.45, metalness: 0.15 })),
    wall: owned.add(new THREE.MeshStandardMaterial({ map: panels, roughness: 0.7 })),
    ceiling: owned.add(new THREE.MeshStandardMaterial({ map: ceilingTiles, roughness: 0.9 })),
  });
  const root = new THREE.Group();
  root.name = "SkybridgeLanding";
  root.add(shell);
  const geo = owned.add(new THREE.BoxGeometry(1, 1, 1));
  const { width: w, height: h, depth: d } = LANDING;
  // The cyan floor strips: along both edges, dashes down the middle.
  const cyan = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 1.6, 1.5) }));
  for (const s of [-1, 1]) root.add(box(owned, geo, cyan, [0.07, 0.012, d - 0.4], [s * (w / 2 - 0.2), 0.02, TOWER_FACE + d / 2]));
  for (let z = 1; z < d - 1; z += 2.2) root.add(box(owned, geo, cyan, [0.05, 0.012, 0.9], [0, 0.02, TOWER_FACE + z]));
  // Fluorescent panels set in the ceiling grid.
  const lampMat = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5) }));
  for (let z = 1.8; z < d; z += 3) root.add(box(owned, geo, lampMat, [0.55, 0.02, 1.2], [0, h - 0.03, TOWER_FACE + z]));
  // The EXIT sign and the corridor's name over the far end.
  const sign = canvasTexture(owned, 512, 128, (g, cw, ch) => {
    g.fillStyle = "#101418";
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = "#e9e2d3";
    g.font = "600 38px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("SKYBRIDGE B  //  SECTOR 03", cw / 2, ch / 2 + 2);
  });
  const signMat = owned.add(new THREE.MeshBasicMaterial({ map: sign, color: new THREE.Color(1.3, 1.3, 1.3) }));
  const plane = owned.add(new THREE.PlaneGeometry(1, 1));
  const name = new THREE.Mesh(plane, signMat);
  name.scale.set(2.8, 0.7, 1);
  name.position.set(0, h - 0.6, TOWER_FACE + d - 0.03);
  name.rotation.y = Math.PI;
  const exitMat = owned.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.5, 0.45) }));
  const exit = box(owned, geo, exitMat, [0.5, 0.2, 0.05], [w / 2 - 0.5, h - 0.35, TOWER_FACE + 2.2]);
  root.add(name, exit);
  // A red gate frame part-way down, as the Skyline's are.
  const redSteel = owned.add(new THREE.MeshStandardMaterial({ color: 0x7a1c16, roughness: 0.6, metalness: 0.4 }));
  root.add(box(owned, geo, redSteel, [w - 0.1, 0.22, 0.22], [0, h - 0.2, TOWER_FACE + 6.5]));
  for (const s of [-1, 1]) root.add(box(owned, geo, redSteel, [0.22, h, 0.22], [s * (w / 2 - 0.12), h / 2, TOWER_FACE + 6.5]));
  const update = () => {};
  return { root, update };
}
