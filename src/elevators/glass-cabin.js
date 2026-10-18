/**
 * The glass cabin - the one look every lift in Ascension Tower has, inside
 * and out (playtest round 4: "Outside it looks like glass but inside it is
 * steel. Choose one layout for all the elevators.").
 *
 * The design (the Calibration Lift's, docs/elevators.md):
 *
 *   - walls of clear glass in steel mullions: a sill, a head, a transom at
 *     TRANSOM of the height, a mullion at every joint;
 *   - steel corner posts, each carrying a glowing conduit (the accent);
 *   - two glass door leaves with a lit inner edge, in a steel door frame
 *     (jambs, header, a hazard-striped threshold), the floor display on the
 *     header and the button panel on a jamb - both on the inside;
 *   - a matte tread-plate deck; two light bars under the ceiling; a brushed
 *     handrail on stand-offs round the glass walls.
 *
 * Every lift builds its cabin from these parts and these materials - the
 * Gravity Fault / quiet ride cabin (kit.js), the Calibration Lift (Level 1's
 * and the shared one, calibration-lift.js `buildCalibrationCabin`) and Level
 * 3's lifts (meltdown/elevator.js) - so they cannot drift apart again. Sizes
 * differ (a freight lift for three lanes, a passenger lift on the roof); the
 * parts do not. A lift with a glass of its own (Level 1's refraction glass)
 * passes it in, and `onGlass`/`onConduit` to put those meshes on its layers.
 *
 *   const kit = createGlassCabinKit(own);           // own(x) registers x for disposal
 *   kit.deck(parent, 4, 4);
 *   kit.glassWall(parent, [-2, -2], [2, -2], 3.2);  // a run of glass, mullioned
 *   kit.post(parent, -2, -2, 3.2, [1, 1]);          // a corner post and its conduit
 *   const { leaves } = kit.doors(parent, { width: 1.7, height: 2.9, z: 2 });
 *   kit.doorFrame(parent, { width: 1.7, height: 2.9, z: 2, inward: -1 });
 *   kit.lightBars(parent, { span: 1.6, length: 3.4, y: 3.1, material: kit.lightMaterial() });
 *   kit.handrail(parent, [-1.9, -1.8], [1.9, -1.8]);
 *
 * Local frames are the caller's: one unit is one metre, floor at y = 0.
 */

import * as THREE from "../three.js";

/** The design's numbers, shared by every cabin. */
export const GLASS_CABIN = {
  accent: 0x7ef4f1,
  /** The transom: a horizontal mullion this far up the glass. */
  transom: 0.68,
  /** Mullion, sill/head and post sections (metres). */
  mullion: 0.06,
  rail: 0.08,
  post: 0.16,
  /** A glass panel is at most this wide between mullions. */
  panel: 1.4,
  /** The handrail: height, tube radius, how far in from the glass. */
  handrail: { height: 1.0, radius: 0.025, inset: 0.1 },
  /** The lit inner edge of a door leaf. */
  doorEdge: 0.045,
  /** Ceiling light bars: width, and their warm white. */
  lightBar: 0.16,
  light: new THREE.Color(1.5, 1.45, 1.32),
  /** One tread-plate tile, metres. */
  deckTile: 1.2,
};

function canvasTexture(own, w, h, draw, repeat = false) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = own(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Dark tread plate, matte (a polished floor mirrored whole skies). */
function deckCanvas(g, s) {
  g.fillStyle = "#24272b";
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 16) {
    for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) {
      g.fillStyle = "#363a3f";
      g.fillRect(x + 3, y + 6, 9, 3);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x + 3, y + 6, 9, 1);
    }
  }
}

/** The button panel: a steel plate, a key slot, a column of floors (one lit). */
function buttonsCanvas(g, w, h) {
  g.fillStyle = "#7d868b";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.12)";
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  g.strokeStyle = "#3b4044";
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  const floors = ["R", "SB", "40", "30", "20", "10", "L", "B2"];
  g.textAlign = "center";
  g.textBaseline = "middle";
  floors.forEach((label, i) => {
    const y = 34 + i * ((h - 70) / (floors.length - 1));
    const lit = label === "R";
    g.fillStyle = "#2b2f33";
    g.beginPath();
    g.arc(w / 2, y, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = lit ? "#ffb03c" : "#c9d0d4";
    g.beginPath();
    g.arc(w / 2, y, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = lit ? "#3a1c00" : "#30363a";
    g.font = "bold 10px Arial, sans-serif";
    g.fillText(label, w / 2, y + 1);
  });
  // Alarm and door buttons at the foot.
  g.fillStyle = "#c0392b";
  g.beginPath();
  g.arc(w / 2 - 14, h - 22, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#7ef4f1";
  g.fillRect(w / 2 + 6, h - 30, 16, 16);
}

/** Black and yellow, for the door threshold. */
function hazardCanvas(g, w, h) {
  g.fillStyle = "#151412";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#e0ac16";
  for (let x = -h; x < w + h; x += 24) {
    g.beginPath();
    g.moveTo(x, h); g.lineTo(x + 12, h); g.lineTo(x + 12 + h, 0); g.lineTo(x + h, 0);
    g.closePath();
    g.fill();
  }
}

/** Planar UVs in metres (u along x, v along z) for a floor or a cap. */
function deckUVs(geometry) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, pos.getX(i) / GLASS_CABIN.deckTile, pos.getZ(i) / GLASS_CABIN.deckTile);
  return geometry;
}

/**
 * The parts and materials, made once per owner.
 * @param {(x: any) => any} own   registers a geometry/material/texture for disposal
 * @param {object} [o]
 * @param {THREE.Material} [o.glass]      the walls' glass (default: clear, faintly cyan)
 * @param {THREE.Material} [o.doorGlass]  the doors' glass
 * @param {THREE.Material} [o.conduit]    the posts' conduits (default: the accent, unlit)
 * @param {(mesh: THREE.Mesh) => void} [o.onGlass]    each glass mesh, once made
 * @param {(mesh: THREE.Mesh) => void} [o.onConduit]  each conduit, once made
 * @param {number} [o.accent]
 */
export function createGlassCabinKit(own, { glass = null, doorGlass = null, conduit = null, onGlass = null, onConduit = null, accent = GLASS_CABIN.accent } = {}) {
  const G = GLASS_CABIN;
  const materials = {
    glass: glass ?? own(new THREE.MeshStandardMaterial({
      color: 0xd8f4fb, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.14,
      depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.45,
    })),
    doorGlass: doorGlass ?? own(new THREE.MeshStandardMaterial({
      color: 0xdff8ff, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.22,
      depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.5,
    })),
    steel: own(new THREE.MeshStandardMaterial({ color: 0x6f787d, metalness: 0.78, roughness: 0.38, envMapIntensity: 0.45 })),
    darkSteel: own(new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.35 })),
    rail: own(new THREE.MeshStandardMaterial({ color: 0xa3acb1, metalness: 0.9, roughness: 0.28, envMapIntensity: 0.6 })),
    deck: own(new THREE.MeshStandardMaterial({ map: canvasTexture(own, 128, 128, (g, s) => deckCanvas(g, s), true), metalness: 0.35, roughness: 0.82, envMapIntensity: 0.25 })),
    threshold: own(new THREE.MeshStandardMaterial({ map: canvasTexture(own, 256, 32, hazardCanvas), metalness: 0.3, roughness: 0.7 })),
    conduit: conduit ?? own(new THREE.MeshBasicMaterial({ color: accent })),
    edge: own(new THREE.MeshBasicMaterial({ color: accent })),
    buttons: null,
  };
  const buttonsMap = canvasTexture(own, 96, 256, buttonsCanvas);
  materials.buttons = own(new THREE.MeshStandardMaterial({ map: buttonsMap, emissiveMap: buttonsMap, emissive: 0xffffff, emissiveIntensity: 0.25, metalness: 0.6, roughness: 0.4 }));
  const geometries = {
    box: own(new THREE.BoxGeometry(1, 1, 1)),
    plane: own(new THREE.PlaneGeometry(1, 1)),
    tube: own(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)),
  };
  const box = (parent, material, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(geometries.box, material);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const glassMade = (mesh) => {
    mesh.renderOrder = 2;
    onGlass?.(mesh);
    return mesh;
  };

  const kit = {
    materials,
    geometries,
    box,

    /** A fresh warm-white diffuser material: one per light bar that dims or flickers on its own. */
    lightMaterial() {
      return own(new THREE.MeshBasicMaterial({ color: G.light.clone() }));
    },

    /** The deck: a slab, its top at y = 0, matte tread plate in metre-true tiles. */
    deck(parent, width, depth, thickness = 0.2) {
      const geometry = own(deckUVs(new THREE.BoxGeometry(width, thickness, depth)));
      const m = new THREE.Mesh(geometry, materials.deck);
      m.name = "CabinDeck";
      m.position.y = -thickness / 2;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    },

    /** An octagonal deck (the Calibration Lift's), corners at `radius`. */
    octagonDeck(parent, radius, thickness = 0.4) {
      const geometry = own(deckUVs(new THREE.CylinderGeometry(radius, radius, thickness, 8).rotateY(Math.PI / 8)));
      const m = new THREE.Mesh(geometry, materials.deck);
      m.name = "CabinDeck";
      m.position.y = -thickness / 2 + 0.05;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    },

    /**
     * A straight run of glass from a to b ([x, z]), `height` tall from `y0`:
     * glass in panels no wider than GLASS_CABIN.panel, a mullion at every
     * joint, a sill and a head, a transom. `single`: one pane across (one
     * that can crack and blow out as a whole) with the mullions over it.
     * The pane's +Z faces `inward` ([x, z], into the cabin). Returns the panes.
     */
    glassWall(parent, a, b, height, { y0 = 0, inward = null, single = false, transom = true, material = materials.glass } = {}) {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dz, dx);
      const n = single ? 1 : Math.max(1, Math.ceil(length / G.panel - 0.05));
      // Facing: a plane's +Z after the yaw is (sin yaw, cos yaw)... turned to face inward.
      let face = yaw;
      if (inward && Math.sin(yaw) * inward[0] + Math.cos(yaw) * inward[1] < 0) face += Math.PI;
      const panes = [];
      for (let i = 0; i < n; i += 1) {
        const k = (i + 0.5) / n;
        const pane = new THREE.Mesh(geometries.plane, material);
        pane.name = "CabinGlass";
        pane.scale.set(length / n, height, 1);
        pane.position.set(a[0] + dx * k, y0 + height / 2, a[1] + dz * k);
        pane.rotation.y = face;
        parent.add(glassMade(pane));
        panes.push(pane);
      }
      const frame = (sy, y, along = length, at = 0.5) => {
        const m = box(parent, materials.steel, along, sy, G.mullion, a[0] + dx * at, y, a[1] + dz * at);
        m.name = "CabinMullion";
        m.rotation.y = yaw;
        return m;
      };
      frame(G.rail, y0 + G.rail / 2);
      frame(G.rail, y0 + height - G.rail / 2);
      if (transom) frame(G.mullion, y0 + height * G.transom);
      const joints = single ? Math.max(1, Math.ceil(length / G.panel - 0.05)) : n;
      for (let i = 1; i < joints; i += 1) {
        const m = box(parent, materials.steel, G.mullion, height, G.mullion, a[0] + (dx * i) / joints, y0 + height / 2, a[1] + (dz * i) / joints);
        m.name = "CabinMullion";
        m.rotation.y = yaw;
      }
      return panes;
    },

    /** A steel post at (x, z), its conduit on the side toward `inward` ([x, z]). */
    post(parent, x, z, height, inward = null, { conduit = true, steel = true } = {}) {
      if (steel) box(parent, materials.steel, G.post, height, G.post, x, height / 2, z).name = "CabinPost";
      if (!conduit) return null;
      const [ix, iz] = inward ?? [-x, -z];
      const l = Math.hypot(ix, iz) || 1;
      const c = new THREE.Mesh(geometries.tube, materials.conduit);
      c.name = "CabinConduit";
      c.scale.set(0.07, height - 0.2, 0.07);
      c.position.set(x + (ix / l) * 0.13, height / 2, z + (iz / l) * 0.13);
      parent.add(c);
      onConduit?.(c);
      return c;
    },

    /**
     * Two glass leaves meeting at `x`, in the plane z = `z`, sliding apart
     * along X; each with a lit inner edge. `set(t)` 0 shut .. 1 open (eased).
     * Each leaf's userData has `closedX` and `openX` for hosts that move them.
     */
    doors(parent, { width, height, x = 0, z = 0, y0 = 0, depth = 0.05, material = materials.doorGlass }) {
      const leafW = width / 2 + 0.02;
      const leaves = [-1, 1].map((s) => {
        const leaf = box(parent, material, leafW, height, depth, x + (s * width) / 4, y0 + height / 2, z);
        leaf.name = "CabinDoor";
        glassMade(leaf);
        // The lit edge where they meet, and a thin steel rail top and bottom.
        box(leaf, materials.edge, G.doorEdge / leafW, 1, 1.4, -s * (0.5 - G.doorEdge / leafW / 2), 0, 0).name = "CabinDoorEdge";
        for (const y of [-0.5, 0.5]) box(leaf, materials.steel, 1, 0.05 / height, 1.5, 0, y - Math.sign(y) * 0.025 / height, 0);
        leaf.userData.side = s;
        leaf.userData.closedX = x + (s * width) / 4;
        leaf.userData.openX = x + (s * width) / 4 + s * (width / 2 - 0.04);
        return leaf;
      });
      return {
        leaves,
        set(t) {
          const k = THREE.MathUtils.clamp(t, 0, 1);
          const e = k * k * (3 - 2 * k);
          for (const leaf of leaves) leaf.position.x = THREE.MathUtils.lerp(leaf.userData.closedX, leaf.userData.openX, e);
        },
      };
    },

    /**
     * The door frame in the plane z = `z`: steel jambs either side of a
     * `width` doorway, a header over it, a hazard threshold on the floor.
     * `inward` (+1/-1) is the side of the plane the cabin is on: the button
     * panel goes on the inside of the right-hand jamb (seen from inside).
     * Returns { header, panel } - the header is where a floor display goes.
     */
    doorFrame(parent, { width, height, x = 0, z = 0, inward = 1, depth = 0.22, ceiling = null, panel = true }) {
      const j = G.post;
      for (const s of [-1, 1]) box(parent, materials.steel, j, height, depth, x + s * (width / 2 + j / 2), height / 2, z).name = "CabinDoorFrame";
      const top = ceiling ?? height + 0.3;
      const header = box(parent, materials.steel, width + 2 * j, top - height, depth, x, height + (top - height) / 2, z);
      header.name = "CabinDoorFrame";
      box(parent, materials.threshold, width, 0.012, depth + 0.1, x, 0.006, z).name = "CabinThreshold";
      let buttons = null;
      if (panel) {
        // Inside, on the jamb to the right of someone facing the doors.
        const right = inward;
        buttons = new THREE.Mesh(geometries.plane, materials.buttons);
        buttons.name = "CabinButtons";
        buttons.scale.set(0.14, 0.42, 1);
        buttons.position.set(x + right * (width / 2 + j / 2), 1.25, z + inward * (depth / 2 + 0.004));
        buttons.rotation.y = inward > 0 ? 0 : Math.PI;
        parent.add(buttons);
      }
      return { header, panel: buttons };
    },

    /** Two light bars under the ceiling at y, ±span from x0 along X, `length` along Z. */
    lightBars(parent, { span, length, y, x0 = 0, z0 = 0, material = null, materials: perBar = null, alongX = false }) {
      return [-1, 1].map((s, i) => {
        const m = perBar?.[i] ?? material ?? kit.lightMaterial();
        const [sx, sz] = alongX ? [length, G.lightBar] : [G.lightBar, length];
        const [px, pz] = alongX ? [x0, z0 + s * span] : [x0 + s * span, z0];
        box(parent, materials.darkSteel, sx + 0.06, 0.05, sz + 0.06, px, y, pz);
        const bar = box(parent, m, sx, 0.02, sz, px, y - 0.035, pz);
        bar.name = "CabinLight";
        return bar;
      });
    },

    /** A handrail from a to b ([x, z]) at rail height, on stand-offs back to the glass (`toWall`, [x, z]). */
    handrail(parent, a, b, toWall = null) {
      const H = G.handrail;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      const rail = new THREE.Mesh(geometries.tube, materials.rail);
      rail.name = "CabinHandrail";
      rail.scale.set(H.radius * 2, length, H.radius * 2);
      rail.position.set((a[0] + b[0]) / 2, H.height, (a[1] + b[1]) / 2);
      rail.rotation.set(0, Math.atan2(-dz, dx), Math.PI / 2, "YXZ");
      parent.add(rail);
      if (toWall) {
        for (const k of [0.12, 0.88]) {
          const s = box(parent, materials.rail, 0.03, 0.03, H.inset, a[0] + dx * k + toWall[0] * H.inset / 2, H.height, a[1] + dz * k + toWall[1] * H.inset / 2);
          s.rotation.y = Math.atan2(toWall[0], toWall[1]);
        }
      }
      return rail;
    },

    /** The button panel on its own (a cabin with no door frame of the kit's). */
    buttonPanel(parent, x, y, z, ry) {
      const m = new THREE.Mesh(geometries.plane, materials.buttons);
      m.name = "CabinButtons";
      m.scale.set(0.14, 0.42, 1);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      parent.add(m);
      return m;
    },
  };
  return kit;
}
