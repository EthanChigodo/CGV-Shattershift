/**
 * Procedural textures for Level 1 - The Glass Causeway.
 *
 * Every texture is drawn at runtime on a 2D canvas or built as a DataTexture,
 * so the level downloads nothing, works offline, and has nothing to credit.
 *
 * Three families:
 *   1. Surface textures (lab tile, ceramic wall, steel deck, hazard paint) with
 *      matching height maps that are Sobel-filtered into normal maps.
 *   2. Signage and hologram text, drawn with canvas text.
 *   3. A 256x256 noise lattice (`createNoiseTexture`) that every shader in the
 *      level samples for fire, smoke, clouds, and cracks. Sampling a texture is
 *      several times cheaper than evaluating procedural noise in GLSL, which
 *      matters on the integrated GPUs in the labs.
 */

import * as THREE from "../../three.js";

function canvas(width, height = width) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(c, { repeat = [1, 1], srgb = true, anisotropy = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Sobel filter: greyscale height -> tangent-space normal map.
 * The gradient of the height field gives the surface slope; the normal is
 * (-dx, -dy, 1) normalised and packed from [-1,1] into [0,255].
 */
export function heightToNormal(heightCanvas, strength = 2) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(w, h);
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) - at(x + 1, y - 1) - 2 * at(x + 1, y) - at(x + 1, y + 1);
      const dy = at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) - at(x - 1, y + 1) - 2 * at(x, y + 1) - at(x + 1, y + 1);
      let nx = dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function speckle(ctx, w, h, amount, alpha, seed, light = false) {
  const r = rng(seed);
  for (let i = 0; i < amount; i += 1) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/* ------------------------------------------------------------------ */
/* Noise lattice                                                        */
/* ------------------------------------------------------------------ */

/**
 * A 256x256 RGBA noise lattice for cheap 3D value noise in shaders.
 *
 * R holds random values. G holds R shifted by (37, 17), which is the offset a
 * shader applies per unit of z. One bilinear fetch therefore returns the
 * lattice at two neighbouring z slices, and a mix() on fract(z) finishes a
 * full trilinear 3D noise lookup. B and A are independent 2D noise for
 * cloud and crack detail. See docs/shaders-explained.md, "Noise".
 */
export function createNoiseTexture(seed = 7) {
  const size = 256;
  const r = rng(seed);
  const base = new Uint8Array(size * size);
  for (let i = 0; i < base.length; i += 1) base[i] = Math.floor(r() * 256);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      data[i * 4] = base[i];
      data[i * 4 + 1] = base[((y + 17) % size) * size + ((x + 37) % size)];
      data[i * 4 + 2] = Math.floor(r() * 256);
      data[i * 4 + 3] = Math.floor(r() * 256);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                             */
/* ------------------------------------------------------------------ */

/** White lab floor tile with grout, scuffs and a scorch field. */
function labTile(size = 512) {
  const colour = canvas(size);
  const height = canvas(size);
  const rough = canvas(size);
  const c = colour.getContext("2d");
  const h = height.getContext("2d");
  const ro = rough.getContext("2d");
  const r = rng(11);
  const tiles = 4;
  const step = size / tiles;

  c.fillStyle = "#c9d0d4"; c.fillRect(0, 0, size, size);
  h.fillStyle = "#808080"; h.fillRect(0, 0, size, size);
  ro.fillStyle = "rgb(0,150,0)"; ro.fillRect(0, 0, size, size);

  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const tone = 196 + Math.floor(r() * 22);
      c.fillStyle = `rgb(${tone},${tone + 4},${tone + 8})`;
      c.fillRect(tx * step + 3, ty * step + 3, step - 6, step - 6);
      h.fillStyle = "#b8b8b8";
      h.fillRect(tx * step + 3, ty * step + 3, step - 6, step - 6);
      // Bevel.
      h.fillStyle = "#9a9a9a";
      h.fillRect(tx * step + 3, ty * step + 3, step - 6, 3);
      h.fillRect(tx * step + 3, ty * step + 3, 3, step - 6);
    }
  }
  // Grout.
  c.strokeStyle = "#7b858b"; c.lineWidth = 4;
  for (let i = 0; i <= tiles; i += 1) {
    c.beginPath(); c.moveTo(i * step, 0); c.lineTo(i * step, size); c.stroke();
    c.beginPath(); c.moveTo(0, i * step); c.lineTo(size, i * step); c.stroke();
  }
  speckle(c, size, size, 5000, 0.08, 3);
  // Scuffs and scorch.
  for (let i = 0; i < 18; i += 1) {
    const x = r() * size; const y = r() * size; const rad = 10 + r() * 60;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(40,34,30,${0.12 + r() * 0.2})`);
    g.addColorStop(1, "rgba(40,34,30,0)");
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Cracked tiles: the floor has taken the weight of falling ceiling.
  c.strokeStyle = "rgba(30,28,26,0.75)"; h.strokeStyle = "#3a3a3a";
  for (let i = 0; i < 7; i += 1) {
    let x = r() * size; let y = r() * size;
    c.lineWidth = h.lineWidth = 1 + r() * 1.5;
    c.beginPath(); h.beginPath(); c.moveTo(x, y); h.moveTo(x, y);
    for (let k = 0; k < 6; k += 1) {
      x += (r() - 0.5) * 60; y += (r() - 0.5) * 60;
      c.lineTo(x, y); h.lineTo(x, y);
    }
    c.stroke(); h.stroke();
  }
  // Soot and water staining.
  for (let i = 0; i < 10; i += 1) {
    const x = r() * size; const y = r() * size; const rad = 40 + r() * 120;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(20,16,14,${0.2 + r() * 0.35})`);
    g.addColorStop(1, "rgba(20,16,14,0)");
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Puddle map: low roughness blobs (G channel) that become mirror-wet when
  // the sprinklers run. The floor shader lerps toward this map with wetness.
  for (let i = 0; i < 14; i += 1) {
    const x = r() * size; const y = r() * size; const rad = 30 + r() * 90;
    const g = ro.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(0,10,0,0.95)");
    g.addColorStop(0.7, "rgba(0,40,0,0.6)");
    g.addColorStop(1, "rgba(0,150,0,0)");
    ro.fillStyle = g; ro.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return {
    map: finish(colour, { repeat: [1, 1] }),
    normalMap: finish(heightToNormal(height, 3), { srgb: false }),
    roughnessMap: finish(rough, { srgb: false }),
  };
}

/** Clean white ceramic lab wall panel with seams and a vent slot band. */
function ceramicWall(size = 512) {
  const colour = canvas(size);
  const height = canvas(size);
  const c = colour.getContext("2d");
  const h = height.getContext("2d");
  c.fillStyle = "#e7ecef"; c.fillRect(0, 0, size, size);
  h.fillStyle = "#a0a0a0"; h.fillRect(0, 0, size, size);
  const g = c.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, "rgba(255,255,255,0.25)"); g.addColorStop(1, "rgba(120,130,140,0.25)");
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  // Panel seams.
  c.fillStyle = "#9aa4ab"; h.fillStyle = "#505050";
  for (const x of [0, size / 2]) { c.fillRect(x, 0, 4, size); h.fillRect(x, 0, 4, size); }
  for (const y of [0, size * 0.62]) { c.fillRect(0, y, size, 4); h.fillRect(0, y, size, 4); }
  // Vent slots.
  for (let i = 0; i < 9; i += 1) {
    const x = 40 + i * 20;
    c.fillStyle = "#586168"; c.fillRect(x, size * 0.72, 10, 60);
    h.fillStyle = "#303030"; h.fillRect(x, size * 0.72, 10, 60);
  }
  // Cyan guide stripe - the Causeway's colour for "this way".
  c.fillStyle = "#35c8e0"; c.fillRect(0, size * 0.66, size, 10);
  speckle(c, size, size, 3000, 0.05, 9);
  // Smoke staining: dark toward the top where smoke pools, streaks where
  // soot ran down with the sprinkler water.
  const r = rng(29);
  const top = c.createLinearGradient(0, 0, 0, size * 0.55);
  top.addColorStop(0, "rgba(22,18,16,0.55)"); top.addColorStop(1, "rgba(22,18,16,0)");
  c.fillStyle = top; c.fillRect(0, 0, size, size * 0.55);
  for (let i = 0; i < 26; i += 1) {
    const x = r() * size; const w = 2 + r() * 10; const len = size * (0.2 + r() * 0.7);
    const g = c.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(25,20,18,${0.15 + r() * 0.3})`); g.addColorStop(1, "rgba(25,20,18,0)");
    c.fillStyle = g; c.fillRect(x, 0, w, len);
  }
  return {
    map: finish(colour),
    normalMap: finish(heightToNormal(height, 2.2), { srgb: false }),
  };
}

/** Brushed steel for trusses, frames, and the lift. */
function brushedSteel(size = 256) {
  const colour = canvas(size);
  const c = colour.getContext("2d");
  const r = rng(5);
  c.fillStyle = "#8a9399"; c.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i += 1) {
    const v = 110 + Math.floor(r() * 90);
    c.fillStyle = `rgba(${v},${v + 6},${v + 10},0.22)`;
    c.fillRect(0, r() * size, size, 1);
  }
  return { map: finish(colour) };
}

/** Diamond tread steel deck for the skybridge. */
function steelDeck(size = 512) {
  const colour = canvas(size);
  const height = canvas(size);
  const c = colour.getContext("2d");
  const h = height.getContext("2d");
  c.fillStyle = "#5d666c"; c.fillRect(0, 0, size, size);
  h.fillStyle = "#606060"; h.fillRect(0, 0, size, size);
  const step = 32;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const odd = ((x + y) / step) % 2;
      c.save(); h.save();
      c.translate(x + step / 2, y + step / 2); h.translate(x + step / 2, y + step / 2);
      c.rotate(odd ? Math.PI / 4 : -Math.PI / 4); h.rotate(odd ? Math.PI / 4 : -Math.PI / 4);
      c.fillStyle = "#7a848a"; c.fillRect(-12, -3, 24, 6);
      h.fillStyle = "#d0d0d0"; h.fillRect(-12, -3, 24, 6);
      c.restore(); h.restore();
    }
  }
  // Plate seams every 256px.
  c.fillStyle = "#30363a"; h.fillStyle = "#202020";
  c.fillRect(0, 0, size, 5); c.fillRect(0, size / 2, size, 5);
  h.fillRect(0, 0, size, 5); h.fillRect(0, size / 2, size, 5);
  speckle(c, size, size, 4000, 0.1, 21);
  return {
    map: finish(colour),
    normalMap: finish(heightToNormal(height, 3.5), { srgb: false }),
  };
}

/** Black/amber hazard paint for anything solid - the "never shoot this" colour. */
function hazardPaint(size = 256) {
  const colour = canvas(size);
  const c = colour.getContext("2d");
  c.fillStyle = "#1a1c1f"; c.fillRect(0, 0, size, size);
  c.fillStyle = "#f2a11f";
  for (let i = -size; i < size * 2; i += 64) {
    c.beginPath();
    c.moveTo(i, 0); c.lineTo(i + 32, 0); c.lineTo(i + 32 - size, size); c.lineTo(i - size, size);
    c.closePath(); c.fill();
  }
  speckle(c, size, size, 2500, 0.3, 4);
  return { map: finish(colour) };
}

/** Lab equipment casing: off-white enamel with panel lines and a status strip. */
function equipmentCasing(size = 256) {
  const colour = canvas(size);
  const c = colour.getContext("2d");
  c.fillStyle = "#3a4046"; c.fillRect(0, 0, size, size);
  c.fillStyle = "#2a2f33"; c.fillRect(8, 8, size - 16, size - 16);
  c.fillStyle = "#f2a11f"; c.fillRect(0, size - 22, size, 14);
  c.fillStyle = "#1a1c1f";
  for (let i = 0; i < size; i += 28) c.fillRect(i, size - 22, 14, 14);
  c.fillStyle = "#ff5a3c"; c.fillRect(20, 24, 26, 8);
  c.fillStyle = "#65717a"; for (let i = 0; i < 6; i += 1) c.fillRect(20, 50 + i * 16, size - 40, 4);
  return { map: finish(colour) };
}

/* ------------------------------------------------------------------ */
/* Signage and hologram text                                            */
/* ------------------------------------------------------------------ */

/** A wall sign. Backlit signs read at running speed; small text does not. */
export function signTexture(title, subtitle = "", { accent = "#35c8e0", width = 512, height = 128 } = {}) {
  const c = canvas(width, height);
  const x = c.getContext("2d");
  x.fillStyle = "#0e1418"; x.fillRect(0, 0, width, height);
  x.fillStyle = accent; x.fillRect(0, 0, 10, height);
  x.fillStyle = "#f4fbff";
  x.font = "800 50px Inter, 'Segoe UI', Arial, sans-serif";
  x.textBaseline = "middle";
  x.fillText(title, 32, subtitle ? height * 0.38 : height / 2);
  if (subtitle) {
    x.fillStyle = accent;
    x.font = "700 24px Inter, 'Segoe UI', Arial, sans-serif";
    x.fillText(subtitle, 34, height * 0.76);
  }
  return finish(c, { anisotropy: 8 });
}

/** Text drawn for the case-file hologram. White on transparent. */
export function hologramTexture(lines) {
  const c = canvas(256, 320);
  const x = c.getContext("2d");
  x.clearRect(0, 0, 256, 320);
  x.strokeStyle = "rgba(255,255,255,0.9)"; x.lineWidth = 4;
  x.strokeRect(10, 10, 236, 300);
  x.fillStyle = "rgba(255,255,255,0.95)";
  x.font = "800 30px Inter, 'Segoe UI', Arial, sans-serif";
  x.fillText(lines[0], 26, 58);
  x.font = "600 18px Inter, 'Segoe UI', Arial, sans-serif";
  for (let i = 1; i < lines.length; i += 1) x.fillText(lines[i], 26, 90 + i * 28);
  x.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 6; i += 1) x.fillRect(26, 200 + i * 16, 120 + ((i * 53) % 80), 6);
  return finish(c, { srgb: true });
}

/** A soft round sprite for smoke, embers, water, and dust. */
function softSprite(size = 64) {
  const c = canvas(size);
  const x = c.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** Floor warning decal for incoming collapse: a red ring and chevrons. */
function warningDecal(size = 256) {
  const c = canvas(size);
  const x = c.getContext("2d");
  x.clearRect(0, 0, size, size);
  x.strokeStyle = "rgba(255,70,50,1)"; x.lineWidth = 14;
  x.beginPath(); x.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 6;
  x.beginPath(); x.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2); x.stroke();
  x.fillStyle = "rgba(255,70,50,1)";
  x.font = "900 90px Inter, Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("!", size / 2, size / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** Suspended ceiling tiles: grid, water stains, soot, and a few missing tiles. */
function ceilingTiles(size = 512) {
  const colour = canvas(size);
  const height = canvas(size);
  const c = colour.getContext("2d");
  const h = height.getContext("2d");
  const r = rng(71);
  const n = 4;
  const step = size / n;
  c.fillStyle = "#9ea4a6"; c.fillRect(0, 0, size, size);
  h.fillStyle = "#909090"; h.fillRect(0, 0, size, size);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const missing = r() < 0.14;
      const tone = missing ? 14 : 150 + Math.floor(r() * 40);
      c.fillStyle = `rgb(${tone},${tone + 2},${tone + 3})`;
      c.fillRect(x * step + 4, y * step + 4, step - 8, step - 8);
      h.fillStyle = missing ? "#202020" : "#a8a8a8";
      h.fillRect(x * step + 4, y * step + 4, step - 8, step - 8);
      if (!missing) speckle(c, step, step, 0, 0, 1);
    }
  }
  // Water stains and soot blooms.
  for (let i = 0; i < 16; i += 1) {
    const x = r() * size; const y = r() * size; const rad = 20 + r() * 90;
    const g = c.createRadialGradient(x, y, rad * 0.6, x, y, rad);
    const soot = r() < 0.6;
    g.addColorStop(0, soot ? "rgba(15,12,10,0.55)" : "rgba(120,95,60,0.18)");
    g.addColorStop(0.9, soot ? "rgba(15,12,10,0.25)" : "rgba(110,80,45,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Metal grid.
  c.fillStyle = "#3e4448"; h.fillStyle = "#606060";
  for (let i = 0; i <= n; i += 1) {
    c.fillRect(i * step - 3, 0, 6, size); c.fillRect(0, i * step - 3, size, 6);
    h.fillRect(i * step - 3, 0, 6, size); h.fillRect(0, i * step - 3, size, 6);
  }
  speckle(c, size, size, 6000, 0.12, 12);
  const map = finish(colour);
  map.repeat.set(3, 2);
  const normalMap = finish(heightToNormal(height, 2.5), { srgb: false });
  normalMap.repeat.set(3, 2);
  return { map, normalMap };
}

/** A sheet of paper with ruled lines and a data table - lab notes on the floor. */
function paperSheet() {
  const c = canvas(128, 176);
  const x = c.getContext("2d");
  x.fillStyle = "#e8e4d8"; x.fillRect(0, 0, 128, 176);
  x.fillStyle = "rgba(40,40,60,0.55)";
  for (let i = 0; i < 16; i += 1) x.fillRect(12, 16 + i * 9, 40 + ((i * 37) % 64), 2);
  x.strokeStyle = "rgba(40,40,60,0.4)"; x.strokeRect(12, 120, 104, 44);
  x.fillStyle = "rgba(160,30,30,0.5)"; x.fillRect(12, 10, 30, 3);
  const g = x.createRadialGradient(100, 150, 0, 100, 150, 70);
  g.addColorStop(0, "rgba(60,40,20,0.45)"); g.addColorStop(1, "rgba(60,40,20,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 176);
  return finish(c);
}

/** Crack and scorch decal on transparent background. */
function crackDecal(size = 256) {
  const c = canvas(size);
  const x = c.getContext("2d");
  const r = rng(91);
  x.clearRect(0, 0, size, size);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(8,6,5,0.85)"); g.addColorStop(0.5, "rgba(12,9,7,0.45)"); g.addColorStop(1, "rgba(12,9,7,0)");
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  x.strokeStyle = "rgba(0,0,0,0.9)";
  for (let i = 0; i < 9; i += 1) {
    let px = size / 2; let py = size / 2;
    const a = (i / 9) * Math.PI * 2 + r();
    x.lineWidth = 1 + r() * 2.5;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 7; k += 1) {
      px += Math.cos(a + (r() - 0.5)) * 16; py += Math.sin(a + (r() - 0.5)) * 16;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Build every texture the level needs once. The kit owns them and disposes
 * them with the level.
 */
export function createCausewayTextures() {
  const tile = labTile();
  tile.map.repeat.set(2, 2); tile.normalMap.repeat.set(2, 2); tile.roughnessMap.repeat.set(2, 2);
  const deck = steelDeck();
  deck.map.repeat.set(2, 1.5); deck.normalMap.repeat.set(2, 1.5);
  const textures = {
    noise: createNoiseTexture(),
    tile,
    wall: ceramicWall(),
    steel: brushedSteel(),
    deck,
    hazard: hazardPaint(),
    casing: equipmentCasing(),
    soft: softSprite(),
    warning: warningDecal(),
    ceiling: ceilingTiles(),
    paper: paperSheet(),
    crack: crackDecal(),
    signs: {
      ward: signTexture("CONTAINMENT WARD 07", "SUBJECT HOLDING  //  LEVEL 212", { accent: "#35c8e0" }),
      evac: signTexture("EVACUATE", "FOLLOW THE CYAN LINE", { accent: "#ff5a3c" }),
      bridge: signTexture("SKYBRIDGE B", "OBSERVATION WING  //  NO RUNNING", { accent: "#35c8e0" }),
      atrium: signTexture("RESONANCE ATRIUM", "AUTHORISED STAFF ONLY", { accent: "#f2a11f" }),
      lift: signTexture("CALIBRATION LIFT", "SECTOR 02  //  FOUNDRY", { accent: "#7ef4f1" }),
      biohazard: signTexture("BIOHAZARD", "SPECIMEN STORAGE", { accent: "#9dff6a" }),
      detonation: signTexture("DEMOLITION ARMED", "ALL STAFF EVACUATED", { accent: "#ff3b30" }),
      exit: signTexture("EXIT", "", { accent: "#2bff6a", width: 256, height: 96 }),
      vent: signTexture("SMOKE VENT", "BREAK THE COVER TO CLEAR", { accent: "#35c8e0" }),
    },
  };
  return textures;
}

export function disposeTextures(textures) {
  const visit = (value) => {
    if (!value) return;
    if (value.isTexture) { value.dispose(); return; }
    if (typeof value === "object") for (const v of Object.values(value)) visit(v);
  };
  visit(textures);
}
