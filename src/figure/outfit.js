/**
 * What the figure wears over the scrubs: the scrubs' colour, and something
 * on the head - so players can be told apart (in multiplayer each one is in
 * their controller's colour).
 *
 *   OUTFITS     the scrub colours (null: the model's own green-teal)
 *   HEADWEAR    none, cap, beanie, bandana, headband
 *   buildHeadwear(kind, colour, radius) -> a Group, centred on the head,
 *               facing -Z (the way the figure runs), built from primitives
 *
 * The colour itself is painted by the figure's look shader (src/figure/
 * look.js), so the folds, the dust and the blood stay; the headwear is real
 * geometry riding a mount that leans with the shader-posed body (player.js).
 */

import * as THREE from "../three.js";

/** Scrub colours. The first four are the controller colours (P1-P4). */
export const OUTFITS = {
  scrubs: { label: "Scrubs", color: null, swatch: "#3f8f88" },
  blue: { label: "Blue", color: "#2f7fd8", swatch: "#3aa0ff" },
  red: { label: "Red", color: "#c8323e", swatch: "#ff4d5a" },
  green: { label: "Green", color: "#2fae5f", swatch: "#4ade80" },
  yellow: { label: "Yellow", color: "#d9b11f", swatch: "#ffd23f" },
  purple: { label: "Purple", color: "#7c4fd6", swatch: "#9b6bff" },
  orange: { label: "Orange", color: "#e0701f", swatch: "#ff8a3d" },
  black: { label: "Black", color: "#24282e", swatch: "#2a2f36" },
  // Unlocked (src/figure/kits.js): the Escapee kit, the Fracture kit.
  ember: { label: "Ember", color: "#8a2e12", swatch: "linear-gradient(135deg,#ff8a3d,#8a2e12 55%,#2a0e06)", kit: "escapee" },
  platinum: { label: "Platinum", color: "#d3dce6", swatch: "linear-gradient(135deg,#ffffff,#bdeeff 40%,#a7b0ff 70%,#d6dde5)", kit: "fracture" },
};

export const HEADWEAR = {
  none: { label: "None" },
  cap: { label: "Cap" },
  beanie: { label: "Beanie" },
  bandana: { label: "Bandana" },
  headband: { label: "Headband" },
  visor: { label: "Visor", kit: "escapee" },
  halo: { label: "Halo", kit: "fracture" },
};

const OUTFIT_KEY = "fractureRun.outfit";
const HEAD_KEY = "fractureRun.headwear";

function load(key, table, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v && table[v]) return v;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}
function save(key, table, v) {
  if (!table[v]) return;
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export const savedOutfit = () => load(OUTFIT_KEY, OUTFITS, "scrubs");
export const saveOutfit = (v) => save(OUTFIT_KEY, OUTFITS, v);
export const savedHeadwear = () => load(HEAD_KEY, HEADWEAR, "none");
export const saveHeadwear = (v) => save(HEAD_KEY, HEADWEAR, v);

/** The colour headwear is made in, for an outfit (the scrubs' own: a dark slate). */
export function headwearColour(outfit) {
  return OUTFITS[outfit]?.color ?? "#2c3640";
}

/**
 * A hat, sized to the head it goes on.
 * @param {string} kind     a HEADWEAR key
 * @param {string} colour
 * @param {object} head     measured from the model (player.js): rx, rz = the
 *   head's half-width and half-depth (hair included), h = from the brow line
 *   (the group's origin) up to the crown. -Z is the face.
 */
export function buildHeadwear(kind, colour = "#2c3640", head = {}) {
  const group = new THREE.Group();
  group.name = `Headwear:${kind}`;
  if (!HEADWEAR[kind] || kind === "none") return group;
  const rx = head.rx ?? 0.095;
  const rz = head.rz ?? 0.11;
  const h = head.h ?? 0.13;
  // Built round, then squashed to the head's own depth.
  const r = rx;
  group.scale.z = rz / rx;
  const base = new THREE.Color(colour);
  const cloth = new THREE.MeshStandardMaterial({ color: base, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.55), roughness: 0.9 });
  const light = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color(1, 1, 1), 0.75), roughness: 0.8 });
  const doubleSided = (m) => { const c = m.clone(); c.side = THREE.DoubleSide; return c; };
  const add = (geometry, material, x = 0, y = 0, z = 0, rx_ = 0, ry = 0, rz_ = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx_, ry, rz_);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  // A dome from the brow line up over the crown.
  const dome = (radius, top, material, y0 = 0) => {
    const m = add(new THREE.SphereGeometry(radius, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), material, 0, y0, 0);
    m.scale.y = (top - y0) / radius;
    return m;
  };

  if (kind === "cap") {
    // A crown, a button on top, a curved brim forward, a sweatband line.
    const R = r * 1.12;
    dome(R, h + 0.012, cloth, -0.004);
    add(new THREE.SphereGeometry(0.009, 8, 6), dark, 0, h + 0.012, 0);
    const brim = add(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.008, 24, 1, false, -Math.PI * 0.32, Math.PI * 0.64), cloth, 0, 0.002, -R * 0.45, -0.18, Math.PI, 0);
    brim.scale.z = 1.05;
    add(new THREE.TorusGeometry(R * 1.0, 0.004, 6, 32), dark, 0, 0.0, 0, Math.PI / 2, 0, 0);
  } else if (kind === "beanie") {
    // A knit dome pulled down to just above the brow, a turned-up ribbed cuff, a pompom.
    const R = r * 1.1;
    dome(R, h + 0.03, cloth, 0.0);
    add(new THREE.CylinderGeometry(R * 1.04, R * 1.05, 0.05, 32, 1, true), doubleSided(dark), 0, 0.02, 0);
    for (let i = 0; i < 28; i += 1) {
      const a = (i / 28) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.004, 0.046, 0.004), cloth, Math.sin(a) * R * 1.055, 0.02, Math.cos(a) * R * 1.055, 0, a, 0);
    }
    add(new THREE.IcosahedronGeometry(0.03, 1), light, 0, h + 0.045, 0);
  } else if (kind === "bandana") {
    // A cloth band tied round the forehead, the knot at the back and two tails.
    const R = r * 1.05;
    add(new THREE.CylinderGeometry(R, R * 1.01, 0.045, 32, 1, true), doubleSided(cloth), 0, 0.012, 0);
    add(new THREE.SphereGeometry(0.017, 10, 8), dark, 0, 0.012, R * 1.02);
    add(new THREE.BoxGeometry(0.024, 0.08, 0.004), cloth, -0.012, -0.03, R * 1.07, 0.35, 0, 0.35);
    add(new THREE.BoxGeometry(0.022, 0.07, 0.004), cloth, 0.014, -0.025, R * 1.07, 0.3, 0, -0.3);
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      add(new THREE.CircleGeometry(0.005, 8), light, Math.sin(a) * R * 1.003, 0.012 + (i % 2 ? 0.01 : -0.01), Math.cos(a) * R * 1.003, 0, a, 0);
    }
  } else if (kind === "headband") {
    // A sports sweatband: a thick terry ring with a stripe.
    const R = r * 1.04;
    add(new THREE.TorusGeometry(R, 0.012, 8, 36), cloth, 0, 0.018, 0, Math.PI / 2, 0, 0);
    add(new THREE.TorusGeometry(R * 1.012, 0.0045, 6, 36), light, 0, 0.018, 0, Math.PI / 2, 0, 0);
  } else if (kind === "visor") {
    // The Escapee's: a steel band round the head, and a glowing orange visor
    // across the eyes (-Z is the face), pods at the temples.
    const R = r * 1.06;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.35, metalness: 0.8 });
    add(new THREE.TorusGeometry(R, 0.009, 8, 40), steel, 0, 0.012, 0, Math.PI / 2, 0, 0);
    // Smoked orange glass, lit from within; a hot line along its middle.
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a0702, emissive: new THREE.Color(1, 0.32, 0.04), emissiveIntensity: 0.75, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
    add(new THREE.CylinderGeometry(R * 1.1, R * 1.06, 0.03, 28, 1, true, Math.PI - 0.95, 1.9), glass, 0, -0.03, 0);
    const line = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.8, 0.15), side: THREE.DoubleSide });
    add(new THREE.CylinderGeometry(R * 1.105, R * 1.105, 0.004, 28, 1, true, Math.PI - 0.85, 1.7), line, 0, -0.03, 0);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.016, 12, 8), steel, s * R * 1.04, -0.02, -R * 0.15);
  } else if (kind === "halo") {
    // The platinum's: a ring of light over the head, crystal shards round it.
    const R = r * 0.95;
    const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.5, 2.8) });
    const ring = add(new THREE.TorusGeometry(R, 0.0075, 10, 48), light, 0, h + 0.075, 0, Math.PI / 2 + 0.14, 0, 0);
    ring.castShadow = false;
    const prism = [new THREE.Color(1.6, 2.2, 2.8), new THREE.Color(2.4, 1.6, 2.6), new THREE.Color(2.6, 2.4, 1.4)];
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const shard = add(new THREE.OctahedronGeometry(0.013, 0), new THREE.MeshBasicMaterial({ color: prism[i % 3] }), Math.sin(a) * R * 1.3, h + 0.04 + (i % 2) * 0.03, Math.cos(a) * R * 1.3, a, a * 2, 0);
      shard.scale.y = 1.8;
      shard.castShadow = false;
    }
  }
  return group;
}

/** Free a hat's geometry and materials. */
export function disposeHeadwear(group) {
  const seen = new Set();
  group?.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (!seen.has(o.material)) {
      seen.add(o.material);
      o.material.dispose();
    }
  });
}
