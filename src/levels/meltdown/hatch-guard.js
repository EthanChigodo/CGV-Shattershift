/**
 * Site-safety gear round the roof's open hatches (roof.js HATCHES).
 *
 * Playtest round 4: a tester walked into a hatch without realising the
 * openings were dangerous - from the fight camera a dark square on a dark
 * deck reads as a vent, not a hole. So each one is marked the way a real
 * site marks a hole in a deck:
 *
 *   - yellow/black barrier rails (two striped boards on posts) on three
 *     sides; the fourth, the mouth, faces into the roof - the patients
 *     climb out that way, and it is where you can still step in;
 *   - hazard striping painted on the deck round the curb, and on the curb's
 *     own rim round the hole (flat decals, polygonOffset over the slab);
 *   - an amber LED strip on the curb that pulses slowly (emissive only -
 *     the roof's lights are pooled, so no new lights: bloom does the glow);
 *   - a sign on the back rail facing over the hole: a yellow triangle with
 *     a falling-figure pictogram, DANGER, KEEP CLEAR.
 *
 * All four hatches share a handful of draw calls: the boards, the posts and
 * the signs are InstancedMeshes, the striping and the LED strip one merged
 * geometry each. The rails are cover (`fences`, Box3s marked `fence`): you
 * and the patients walk round them; balls fly over (they are not solids).
 *
 *   const guard = buildHatchGuards({ hatches, mouths, own });
 *   roof.add(guard.group); cover.push(...guard.fences); // guard.group.userData.tick(dt, time)
 */

import * as THREE from "../../three.js";

/** Half the hatch's curb (roof.js builds it 1.6 m square, 0.35 m high). */
const CURB = 0.8;
const CURB_TOP = 0.35;
/** Half the hole itself (1.2 m square). */
const HOLE = 0.6;
/** The striped band painted on the deck round the curb, metres wide. */
const DECK_BAND = 0.36;
/** The amber strip along the curb's outer edge, metres wide. */
const LED_WIDTH = 0.06;
/** Half the square the barrier rails stand on. */
const RAIL = 1.32;
/** The two boards' centres above the deck. */
const BOARD_HEIGHTS = [0.44, 0.88];
const BOARD = { height: 0.15, depth: 0.035 };
const POST = { width: 0.07, height: 0.98 };
/** The sign: plate size, how high its bottom edge is, how far it leans back. */
const SIGN = { width: 0.62, height: 0.78, bottom: 1.02, lean: 0.32 };
/** Metres per stripe tile (one yellow and one black band, at 45 degrees). */
const STRIPE_TILE = 0.42;
/** The LED strip's slow pulse: seconds a cycle, and its emissive range. */
const PULSE = { period: 1.7, low: 0.35, high: 2.8 };
/** Decal heights over the deck and over the curb (with polygonOffset). */
const DECK_Y = 0.004;
const RIM_Y = CURB_TOP + 0.003;

const YELLOW = "#f2c21a";
const BLACK = "#16140f";

/** Seamless 45-degree yellow/black stripes, a little worn. */
function stripeTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = BLACK;
  g.fillRect(0, 0, size, size);
  g.fillStyle = YELLOW;
  // Bands every 64 px across x; at 45 degrees they also tile down y.
  for (let x = -size * 2; x < size * 2; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 32 + size, size);
    g.lineTo(x + size, size);
    g.closePath();
    g.fill();
  }
  // Scuffs: boots and dragged kit.
  let seed = 9173;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "rgba(20, 16, 10, 0.32)";
  for (let i = 0; i < 40; i += 1) g.fillRect(r() * size, r() * size, 2 + r() * 14, 1 + r() * 3);
  g.fillStyle = "rgba(255, 245, 210, 0.08)";
  for (let i = 0; i < 30; i += 1) g.fillRect(r() * size, r() * size, 1 + r() * 6, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * The warning sign: an ISO-style yellow triangle with a figure falling into
 * an opening, then DANGER on a black bar and KEEP CLEAR under it.
 */
function signTexture() {
  const W = 256;
  const H = Math.round(W * (SIGN.height / SIGN.width));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#dcd6c4";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = BLACK;
  g.lineWidth = 8;
  g.strokeRect(4, 4, W - 8, H - 8);
  // The triangle.
  const top = 22;
  const base = 176;
  const half = 92;
  g.beginPath();
  g.moveTo(W / 2, top);
  g.lineTo(W / 2 + half, base);
  g.lineTo(W / 2 - half, base);
  g.closePath();
  g.fillStyle = YELLOW;
  g.fill();
  g.lineJoin = "round";
  g.lineWidth = 12;
  g.strokeStyle = BLACK;
  g.stroke();
  // The pictogram: the opening, and a figure going into it head first.
  g.fillStyle = BLACK;
  g.fillRect(W / 2 - 10, 142, 66, 18);
  g.fillRect(W / 2 - 58, 142, 30, 6);
  g.lineCap = "round";
  g.lineWidth = 9;
  g.beginPath();
  g.arc(W / 2 + 8, 126, 9, 0, Math.PI * 2); // head, low over the hole
  g.fill();
  g.beginPath();
  g.moveTo(W / 2 + 2, 116); g.lineTo(W / 2 - 18, 86); // body, tipping in
  g.moveTo(W / 2 - 18, 86); g.lineTo(W / 2 - 40, 74); // a leg up behind
  g.moveTo(W / 2 - 18, 86); g.lineTo(W / 2 - 30, 62); // the other
  g.moveTo(W / 2 - 4, 108); g.lineTo(W / 2 + 20, 98); // arms flung out
  g.moveTo(W / 2 - 4, 108); g.lineTo(W / 2 - 22, 120);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath(); // motion lines
  g.moveTo(W / 2 - 52, 96); g.lineTo(W / 2 - 66, 104);
  g.moveTo(W / 2 - 46, 108); g.lineTo(W / 2 - 60, 116);
  g.stroke();
  // DANGER on a black bar; KEEP CLEAR under it.
  g.fillStyle = BLACK;
  g.fillRect(14, 190, W - 28, 52);
  g.fillStyle = YELLOW;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "900 42px Arial, sans-serif";
  g.fillText("DANGER", W / 2, 217);
  g.fillStyle = BLACK;
  g.font = "900 30px Arial, sans-serif";
  g.fillText("KEEP CLEAR", W / 2, 270);
  g.font = "700 15px Arial, sans-serif";
  g.fillText("OPEN HATCH - FALL HAZARD", W / 2, 300);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Push a flat square ring (four rectangles, no overlap) at height y round
 * (cx, cz): inner and outer half-sizes. UVs are planar in world metres, so
 * the stripes run on unbroken from one rectangle to the next.
 */
function pushRing(out, cx, cz, inner, outer, y) {
  const rects = [
    [cx - outer, cz - outer, cx + outer, cz - inner], // north
    [cx - outer, cz + inner, cx + outer, cz + outer], // south
    [cx - outer, cz - inner, cx - inner, cz + inner], // west
    [cx + inner, cz - inner, cx + outer, cz + inner], // east
  ];
  for (const [x0, z0, x1, z1] of rects) {
    const base = out.positions.length / 3;
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]) {
      out.positions.push(x, y, z);
      out.normals.push(0, 1, 0);
      out.uvs.push(x / STRIPE_TILE, z / STRIPE_TILE);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function ringGeometry(out) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(out.normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(out.uvs, 2));
  geometry.setIndex(out.indices);
  return geometry;
}

/** A board whose stripes keep their size: UVs in metres along and up the faces. */
function boardGeometry(length) {
  const geometry = new THREE.BoxGeometry(length, BOARD.height, BOARD.depth);
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) {
    const sideways = Math.abs(nor.getY(i)) > 0.5 ? pos.getZ(i) : pos.getY(i);
    uv.setXY(i, pos.getX(i) / STRIPE_TILE, sideways / STRIPE_TILE);
  }
  return geometry;
}

/**
 * @param {object} o
 * @param {THREE.Vector3[]} o.hatches  hatch centres on the deck
 * @param {THREE.Vector3[]} o.mouths   for each, the open side (a unit +/-X or +/-Z)
 * @param {(x: any) => any} o.own      registers a material/texture/geometry for disposal
 * @returns {{ group: THREE.Group, fences: THREE.Box3[] }}
 */
export function buildHatchGuards({ hatches, mouths, own }) {
  const group = new THREE.Group();
  group.name = "HatchGuards";
  const stripes = own(stripeTexture());
  const signMap = own(signTexture());
  const stripePaint = own(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.62, metalness: 0.2 }));
  // Painted on the deck and the rim: pulled toward the camera so it never
  // fights the slab or the curb it lies on.
  const stripeDecal = own(new THREE.MeshStandardMaterial({
    map: stripes, roughness: 0.85, metalness: 0.05, color: 0xd8d2c4,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const postPaint = own(new THREE.MeshStandardMaterial({ color: 0xe0ac12, roughness: 0.55, metalness: 0.35 }));
  const backing = own(new THREE.MeshStandardMaterial({ color: 0x23241f, roughness: 0.6, metalness: 0.6 }));
  // Faintly self-lit so it reads on the dark deck from the fight camera
  // (well under the bloom threshold: a sign, not a lamp).
  const signFace = own(new THREE.MeshStandardMaterial({ map: signMap, emissiveMap: signMap, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.7, metalness: 0.05 }));
  const led = own(new THREE.MeshStandardMaterial({
    color: 0x2a1604, emissive: 0xff9a1c, emissiveIntensity: PULSE.low, roughness: 0.4, metalness: 0.2,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));

  // Decals: the deck band and the curb's rim (stripes), and the LED strip.
  const paint = { positions: [], normals: [], uvs: [], indices: [] };
  const strip = { positions: [], normals: [], uvs: [], indices: [] };
  for (const h of hatches) {
    pushRing(paint, h.x, h.z, CURB, CURB + DECK_BAND, DECK_Y);
    pushRing(paint, h.x, h.z, HOLE, CURB - LED_WIDTH, RIM_Y);
    pushRing(strip, h.x, h.z, CURB - LED_WIDTH, CURB, RIM_Y);
  }
  const painted = new THREE.Mesh(own(ringGeometry(paint)), stripeDecal);
  painted.name = "HatchStriping";
  painted.receiveShadow = true;
  const strips = new THREE.Mesh(own(ringGeometry(strip)), led);
  strips.name = "HatchLedStrip";
  group.add(painted, strips);

  // Rails: three closed sides a hatch, two boards a side, posts at the
  // corners (and one up the middle of the sign's side, carrying it).
  const boardLength = RAIL * 2 - POST.width;
  const sides = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  const boards = [];
  const posts = [];
  const signs = [];
  const fences = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  hatches.forEach((h, i) => {
    const mouth = mouths[i];
    // The sign goes on the north rail, facing the fight camera over the
    // hole - unless that is the mouth, then on the back rail.
    const signSide = mouth.z < -0.5 ? mouth.clone().negate() : sides[3];
    for (const n of sides) {
      if (n.dot(mouth) > 0.5) continue;
      const yaw = Math.abs(n.x) > 0.5 ? Math.PI / 2 : 0;
      for (const y of BOARD_HEIGHTS) {
        p.set(h.x + n.x * RAIL, y, h.z + n.z * RAIL);
        boards.push(m.compose(p, q.setFromEuler(e.set(0, yaw, 0)), s.set(1, 1, 1)).clone());
      }
      const box = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(h.x + n.x * RAIL, POST.height / 2, h.z + n.z * RAIL),
        new THREE.Vector3(Math.abs(n.x) > 0.5 ? 0.1 : RAIL * 2 + POST.width, POST.height, Math.abs(n.x) > 0.5 ? RAIL * 2 + POST.width : 0.1)
      );
      box.fence = true;
      fences.push(box);
    }
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      p.set(h.x + cx * RAIL, 0, h.z + cz * RAIL);
      posts.push(m.compose(p, q.identity(), s.set(1, 1, 1)).clone());
    }
    // The sign's post, up the middle of its rail, and the sign leaning back on it.
    const yaw = Math.atan2(-signSide.x, -signSide.z);
    p.set(h.x + signSide.x * RAIL, 0, h.z + signSide.z * RAIL);
    posts.push(m.compose(p, q.identity(), s.set(1, (SIGN.bottom + SIGN.height * 0.7) / POST.height, 1)).clone());
    q.setFromEuler(e.set(-SIGN.lean, yaw, 0, "YXZ"));
    // Its centre: up from the bottom edge along the leaning plate, just in front of the post.
    const up = new THREE.Vector3(0, SIGN.height / 2, 0).applyQuaternion(q);
    const front = new THREE.Vector3(0, 0, POST.width / 2 + 0.02).applyQuaternion(q);
    p.set(h.x + signSide.x * RAIL, SIGN.bottom, h.z + signSide.z * RAIL).add(up).add(front);
    signs.push(m.compose(p, q, s.set(1, 1, 1)).clone());
  });

  const instanced = (geometry, material, matrices, name) => {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((x, i) => mesh.setMatrixAt(i, x));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  instanced(own(boardGeometry(boardLength)), stripePaint, boards, "HatchRailBoards");
  instanced(own(new THREE.BoxGeometry(POST.width, POST.height, POST.width).translate(0, POST.height / 2, 0)), postPaint, posts, "HatchRailPosts");
  // A thin plate: the sign printed on its front (+Z) face, dark steel elsewhere.
  instanced(own(new THREE.BoxGeometry(SIGN.width, SIGN.height, 0.025)), [backing, backing, backing, backing, signFace, backing], signs, "HatchSigns");

  group.userData.tick = (dt, time) => {
    const k = 0.5 + 0.5 * Math.sin((time / PULSE.period) * Math.PI * 2);
    led.emissiveIntensity = PULSE.low + (PULSE.high - PULSE.low) * k * k;
  };
  group.userData.led = led;
  return { group, fences };
}
