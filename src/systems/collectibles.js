/**
 * Things to find in every level, like the Skyline's five case files: gold
 * holograms on floor projectors, each standing in a column of light so it
 * can be spotted from far off. Run through one to read it.
 *
 *   Foundry   plant logs        what the basement was really for
 *   Labs      patient records   who subjects 01-06 were, and what became of them
 *   Roof      flight records    how Vale meant to get away
 *
 * What you have found is remembered (localStorage), and the main menu counts
 * it. Same look as the case files (the Skyline's hologram and beacon shaders).
 *
 *   const set = new CollectibleSet("foundry", { positions: [...] });
 *   scene.add(set.root);
 *   set.update(dt, time, playerPosition, (found) => hud.caseFile(...));
 */

import * as THREE from "../three.js";
import { createHologramMaterial, createBeaconMaterial } from "../levels/causeway/shaders/objects.js";
import { hologramTexture } from "../levels/causeway/textures.js";

export const COLLECTIBLES = {
  foundry: {
    label: "Plant log",
    files: [
      ["PLANT LOG 01", "Night shift, level 141.", "Vale wants the furnaces", "kept hot all week.", "'Disposal,' he says."],
      ["PLANT LOG 02", "The service lift was", "refitted for 'specimen", "transport'. Nobody here", "asked what specimens."],
      ["PLANT LOG 03", "Okoro came down at 02:00", "with a bag of spheres.", "Said Seven would need", "them. Said run."],
      ["PLANT LOG 04", "Charges on every floor.", "The plant goes first.", "If you read this, take", "the Gravity Fault lift."],
    ],
  },
  labs: {
    label: "Patient record",
    files: [
      ["PATIENT 01", "Male, 54. Night shelter,", "Fifth Street. Consent:", "'sleep study'. Trial 1:", "field rejected. Sedated."],
      ["PATIENT 03", "Female, 29. Uninsured.", "Day 12: sees in the dark.", "Day 20: stopped speaking.", "Moved to containment."],
      ["PATIENT 04", "Male, 61. Free clinic.", "Bones re-forming. Pain", "constant. Vale: 'progress'.", "Restraints, level 2."],
      ["PATIENT 06", "Female, 19. Runaway.", "Strongest response before", "Seven. Broke her restraints", "day 33. Recaptured."],
      ["ORDER 212-B", "Signed: A. Vale.", "If containment fails,", "release nothing. The", "fire will see to it."],
    ],
  },
  roof: {
    label: "Flight record",
    files: [
      ["FLIGHT PLAN", "Pad 1, 04:10. Pilot:", "A. Vale. Cargo: field", "data - and Subject 07,", "if recovered alive."],
      ["RADIO LOG", "'Police inbound.' 'Then", "we lift before they land.", "The tower does the rest.", "No one walks out.'"],
      ["BOARD MEMO", "Ascension continues", "offshore. Vale brings the", "data. Officially, the", "tower never existed."],
    ],
  },
};

const STORE = "fractureRun.collectibles";

/** Found so far, per level: { foundry: [0, 2], ... }. */
export function loadFound() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch (error) {
    return {};
  }
}

function saveFound(found) {
  try { localStorage.setItem(STORE, JSON.stringify(found)); } catch (error) {}
}

/** "Plant logs 2/4   Patient records 0/5   Flight records 1/3" for the menu. */
export function foundSummary() {
  const found = loadFound();
  return Object.entries(COLLECTIBLES).map(([key, c]) => `${c.label}s ${(found[key] ?? []).length}/${c.files.length}`);
}

let shared = null;
function sharedPieces() {
  if (shared) return shared;
  const soft = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  shared = {
    plane: new THREE.PlaneGeometry(1, 1),
    column: new THREE.CylinderGeometry(1, 1, 1, 20, 1, true),
    base: new THREE.CylinderGeometry(0.3, 0.34, 0.12, 8),
    steel: new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.8, roughness: 0.4 }),
    lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.3) }),
    ring: new THREE.MeshBasicMaterial({ map: soft, color: new THREE.Color(1.6, 1.0, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  return shared;
}

export class CollectibleSet {
  /**
   * @param {"foundry"|"labs"|"roof"} level
   * @param {object} o
   * @param {THREE.Vector3[]} o.positions  where each one stands (on the floor)
   * @param {number[]} [o.headings]        which way each faces
   */
  constructor(level, { positions, headings = [] }) {
    this.level = level;
    this.def = COLLECTIBLES[level];
    this.root = new THREE.Group();
    this.root.name = `Collectibles_${level}`;
    this.time = { value: 0 };
    this.owned = [];
    const s = sharedPieces();
    this.beam = createBeaconMaterial(this.time, 0xffc45a);
    this.owned.push(this.beam);
    const found = loadFound()[level] ?? [];
    this.items = this.def.files.map((lines, index) => {
      const at = positions[index];
      if (!at) return null;
      const map = hologramTexture(lines);
      const material = createHologramMaterial(map, this.time, 0xffc45a);
      this.owned.push(map, material);
      const group = new THREE.Group();
      group.position.copy(at);
      group.rotation.y = headings[index] ?? 0;
      const panel = new THREE.Mesh(s.plane, material);
      panel.scale.set(1.05, 1.3, 1);
      panel.position.y = 1.7;
      const base = new THREE.Mesh(s.base, s.steel);
      base.position.y = 0.06;
      const lens = new THREE.Mesh(s.base, s.lens);
      lens.scale.set(0.6, 0.15, 0.6);
      lens.position.y = 0.13;
      const column = new THREE.Mesh(s.column, this.beam);
      // A tall beam, so it can be seen from far down a corridor.
      column.scale.set(0.9, 9, 0.9);
      column.position.y = 4.5;
      const ring = new THREE.Mesh(s.plane, s.ring);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.set(3.4, 3.4, 1);
      ring.position.y = 0.03;
      group.add(panel, base, lens, column, ring);
      this.root.add(group);
      // Found on an earlier run: still there to read, dimmer.
      material.uniforms.uHighlight.value = found.includes(index) ? -0.5 : 0.6;
      return { index, lines, group, panel, ring, taken: false, pinged: false };
    });
  }

  /** @returns {number} how many there are to find in this level */
  get total() {
    return this.def.files.length;
  }

  /**
   * @param {THREE.Vector3} player  the player's position (world)
   * @param {(e: {index:number, lines:string[], found:number, total:number, label:string}) => void} onFound
   * @param {(e: {label:string, distance:number}) => void} [onNear]  once each, about 30 m out
   */
  update(dt, time, player, onFound, onNear) {
    this.time.value = time;
    for (const item of this.items) {
      if (!item || item.taken) continue;
      item.panel.rotation.y = Math.sin(time * 0.9 + item.index) * 0.35;
      item.panel.position.y = 1.7 + Math.sin(time * 1.7 + item.index) * 0.06;
      item.ring.material.opacity = 0.75 + 0.25 * Math.sin(time * 3);
      if (!player) continue;
      item.group.getWorldPosition(_p);
      const dx = player.x - _p.x;
      const dz = player.z - _p.z;
      if (!item.pinged && dx * dx + dz * dz < 30 * 30) {
        item.pinged = true;
        onNear?.({ label: this.def.label, level: this.level, distance: Math.sqrt(dx * dx + dz * dz) });
      }
      if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(player.y - _p.y) < 3) {
        item.taken = true;
        item.group.visible = false;
        const all = loadFound();
        const mine = new Set(all[this.level] ?? []);
        mine.add(item.index);
        all[this.level] = [...mine].sort();
        saveFound(all);
        onFound?.({ index: item.index, lines: item.lines, found: mine.size, total: this.total, label: this.def.label });
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}

const _p = new THREE.Vector3();
