/**
 * The tower behind the skybridge, demolished (the Skyline's blast): the
 * charges go floor by floor, bottom to top - a band of blown-out windows and
 * a burst of fire at each level - then the whole building goes up at once
 * and comes down, dragging the near end of the bridge with it.
 *
 *   const tower = new DemolitionTower({ floors: 24 });
 *   tower.root.position.copy(where);           // base centre, below the bridge
 *   scene.add(tower.root);
 *   tower.detonate();                           // starts the sequence
 *   tower.update(dt);                           // every frame
 *   tower.state  // { floorsGone, whole (0..1 after the big one), sink (m) }
 *
 * Light-free like the Fireball: lit windows are emissive, the blasts are
 * additive sprites and flashing bands - no real lights, so nothing in the
 * level recompiles mid-cutscene.
 */

import * as THREE from "../../three.js";
import { Fireball } from "./fireball.js";

/** A facade of office windows, some lit, on a dark concrete frame. */
function facadeTexture(seed = 7) {
  const w = 256;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#1a1c20";
  g.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const cols = 8;
  const rows = 16;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const lit = rnd();
      const shade = lit > 0.62 ? `rgba(255,${190 + Math.floor(rnd() * 50)},${120 + Math.floor(rnd() * 60)},${0.65 + rnd() * 0.3})` : `rgba(40,60,80,${0.5 + rnd() * 0.3})`;
      g.fillStyle = shade;
      g.fillRect(x * (w / cols) + 4, y * (h / rows) + 5, w / cols - 8, h / rows - 12);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const FLOOR_HEIGHT = 4.2;

export class DemolitionTower {
  /**
   * @param {object} [o]
   * @param {number} [o.floors]   storeys (the root is at the base)
   * @param {number} [o.width]    footprint, metres (square)
   * @param {number} [o.interval] seconds between floors going
   */
  constructor({ floors = 24, width = 22, interval = 0.11 } = {}) {
    this.floors = floors;
    this.width = width;
    this.interval = interval;
    this.height = floors * FLOOR_HEIGHT;
    this.root = new THREE.Group();
    this.root.name = "DemolitionTower";

    // The building: one box, windows on all four faces.
    this.texture = facadeTexture();
    this.texture.repeat.set(width / 22, floors / 16);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x8a8c90, roughness: 0.85, metalness: 0.2,
      map: this.texture, emissiveMap: this.texture, emissive: 0xffffff, emissiveIntensity: 0.55,
    });
    this.body = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, this.height, width), this.material);
    box.position.y = this.height / 2;
    this.body.add(box);
    // A roof plant and a mast, so the silhouette reads as a tower.
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8 });
    const plant = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 4, width * 0.4), roofMat);
    plant.position.y = this.height + 2;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 14, 6), roofMat);
    mast.position.set(width * 0.2, this.height + 7, 0);
    this.body.add(plant, mast);
    this.root.add(this.body);
    this._materials = [this.material, roofMat];
    this._geometries = [box.geometry, plant.geometry, mast.geometry];

    // A band of blown-out fire round each floor, flashed as it goes.
    this.bandGeometry = new THREE.BoxGeometry(width + 0.6, FLOOR_HEIGHT * 0.55, width + 0.6);
    this._geometries.push(this.bandGeometry);
    this.bands = [];
    for (let i = 0; i < floors; i += 1) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const band = new THREE.Mesh(this.bandGeometry, m);
      band.position.y = (i + 0.5) * FLOOR_HEIGHT;
      band.visible = false;
      this.body.add(band);
      this.bands.push({ mesh: band, at: Infinity, glow: 0 });
      this._materials.push(m);
    }

    // Bursts: a small pool for the floors, a big one for the end.
    this.pool = Array.from({ length: 8 }, () => new Fireball());
    this.big = [new Fireball(), new Fireball(), new Fireball()];
    for (const f of [...this.pool, ...this.big]) this.root.add(f.root);
    this._next = 0;

    this.time = 0;
    this.started = false;
    this.state = { floorsGone: 0, whole: 0, sink: 0, done: false };
    this.wholeAt = Infinity;
    /** The two faces that face the viewer (0..3 = +x, +z, -x, -z). */
    this.towardFaces = [0, 3];
    this.onFloor = null; // (index) => {} - for sound and shake
    this.onWhole = null; // () => {}
  }

  /** Light the charges: floor by floor from the bottom, then all of it. */
  detonate() {
    this.started = true;
    this.time = 0;
    this.bands.forEach((b, i) => (b.at = i * this.interval));
    this.wholeAt = this.floors * this.interval + 0.35;
  }

  /** Seconds from detonate() to the whole building going up. */
  get wholeDelay() {
    return this.floors * this.interval + 0.35;
  }

  /**
   * A burst against one face of the building (a burst at its centre would
   * be hidden inside it). `face` 0..3 = +x, +z, -x, -z; default cycles.
   */
  _burst(y, size, big = false, face = null, spread = 1) {
    const pool = big ? this.big : this.pool;
    const f = pool[this._next++ % pool.length];
    const side = face ?? this.towardFaces[this._next % 2];
    const half = this.width / 2 + (big ? size * 0.12 : 0.5);
    const along = big ? 0 : ((this._next % 5) - 2) * this.width * 0.2;
    const x = side === 0 ? half : side === 2 ? -half : along;
    const z = side === 1 ? half : side === 3 ? -half : along;
    // The bursts live under this.root, so this is in the tower's own frame
    // (a world position here would be offset by the tower's twice).
    f.burst(new THREE.Vector3(x, y + this.body.position.y, z), { size, spread });
  }

  update(dt) {
    for (const f of [...this.pool, ...this.big]) f.update(dt);
    if (!this.started) return;
    this.time += dt;
    const t = this.time;
    for (const [i, b] of this.bands.entries()) {
      if (t < b.at) continue;
      if (!b.mesh.visible) {
        b.mesh.visible = true;
        b.glow = 1;
        this.state.floorsGone = i + 1;
        this._burst((i + 0.5) * FLOOR_HEIGHT, 15 + (i % 3) * 4);
        this.onFloor?.(i);
      }
      // A flash that settles into a lasting glow (the floor's on fire now).
      b.glow = Math.max(0.28, b.glow - dt * 2.2);
      b.mesh.material.opacity = b.glow * (0.85 + Math.sin(t * 23 + i) * 0.15);
    }
    if (t >= this.wholeAt) {
      if (this.state.whole === 0) {
        // All of it at once, out of the faces toward the bridge (the host
        // says which: `towardFaces`).
        const [a, b] = this.towardFaces;
        // (Held close to the building: big bursts at full spread reach the bridge.)
        this._burst(this.height * 0.35, 70, true, a, 0.4);
        this._burst(this.height * 0.65, 60, true, b, 0.4);
        this._burst(this.height * 0.9, 52, true, a, 0.4);
        this.onWhole?.();
      }
      this.state.whole = Math.min(1, (t - this.wholeAt) / 0.4);
      // Down it comes: slow at first, then faster, leaning as it goes.
      const k = Math.max(0, t - this.wholeAt - 0.5);
      this.state.sink = 0.5 * 9.8 * 0.35 * k * k;
      this.body.position.y = -this.state.sink;
      this.body.rotation.z = Math.min(0.22, k * k * 0.03);
      this.material.emissiveIntensity = Math.max(0.05, 0.55 - k * 0.3);
      if (this.state.sink > this.height) {
        this.body.visible = false;
        this.state.done = true;
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const f of [...this.pool, ...this.big]) f.dispose();
    for (const m of this._materials) m.dispose();
    for (const g of this._geometries) g.dispose();
    this.texture.dispose();
  }
}

export { FLOOR_HEIGHT };
