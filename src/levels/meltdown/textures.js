/**
 * Procedural textures for Level 3 - The Meltdown.
 *
 * Same approach as Level 2 (docs/level-2-foundry.md): everything is generated
 * at runtime on a 2D canvas, so the level works offline and needs no credits
 * entry. Cracked ceramic tile and scorched plating replace the foundry's clean
 * ribbed metal, and warning stripes shift from amber to a hotter red/orange to
 * match this level's "things have already gotten worse" palette.
 *
 * The evac-sign texture is different from the rest: it is redrawn on demand
 * (`setText`), because the countdown value it shows changes at runtime and the
 * others are baked once.
 */

import * as THREE from "../../three.js";

function createCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function finish(canvas, { repeat = [1, 1], srgb = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Sobel-filter a greyscale height canvas into a tangent-space normal map. */
function heightToNormal(heightCanvas, strength = 2) {
  const size = heightCanvas.width;
  const src = heightCanvas.getContext("2d").getImageData(0, 0, size, size).data;
  const out = createCanvas(size);
  const ctx = out.getContext("2d");
  const image = ctx.createImageData(size, size);

  const heightAt = (x, y) => {
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return src[(wy * size + wx) * 4] / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx =
        heightAt(x - 1, y - 1) + 2 * heightAt(x - 1, y) + heightAt(x - 1, y + 1) -
        (heightAt(x + 1, y - 1) + 2 * heightAt(x + 1, y) + heightAt(x + 1, y + 1));
      const dy =
        heightAt(x - 1, y - 1) + 2 * heightAt(x, y - 1) + heightAt(x + 1, y - 1) -
        (heightAt(x - 1, y + 1) + 2 * heightAt(x, y + 1) + heightAt(x + 1, y + 1));

      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;

      const index = (y * size + x) * 4;
      image.data[index] = (nx * 0.5 + 0.5) * 255;
      image.data[index + 1] = (ny * 0.5 + 0.5) * 255;
      image.data[index + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      image.data[index + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return out;
}

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function grain(ctx, size, amount, seed) {
  const random = seededRandom(seed);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const noise = (random() - 0.5) * amount;
    image.data[i] = THREE.MathUtils.clamp(image.data[i] + noise, 0, 255);
    image.data[i + 1] = THREE.MathUtils.clamp(image.data[i + 1] + noise, 0, 255);
    image.data[i + 2] = THREE.MathUtils.clamp(image.data[i + 2] + noise, 0, 255);
  }
  ctx.putImageData(image, 0, 0);
}

/* ------------------------------------------------------------------ */
/* Cracked ceramic tile: the sub-level's wall/floor finish              */
/* ------------------------------------------------------------------ */

function tileHeight(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a8a86";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#3c3c38";
  ctx.lineWidth = 3;
  for (let x = 0; x <= size; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Crack lines: short jagged strokes wandering across a handful of tiles.
  const random = seededRandom(9007199);
  ctx.strokeStyle = "#141412";
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i += 1) {
    let x = random() * size;
    let y = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 6; step += 1) {
      x += (random() - 0.5) * 40;
      y += (random() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  grain(ctx, size, 22, 6151);
  return canvas;
}

function tileColour(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#4d5450";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#22261f";
  ctx.lineWidth = 3;
  for (let x = 0; x <= size; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Scorch and soot patches, heavier than the foundry's rust stains - this
  // level is actively on fire somewhere nearby, not just industrially worn.
  const random = seededRandom(15485867);
  for (let i = 0; i < 46; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 8 + random() * 30;
    const soot = ctx.createRadialGradient(x, y, 0, x, y, r);
    soot.addColorStop(0, "rgba(10, 8, 6, 0.42)");
    soot.addColorStop(1, "rgba(10, 8, 6, 0)");
    ctx.fillStyle = soot;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  grain(ctx, size, 20, 32452867);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Hazard stripes: hotter than the foundry's amber, closer to red       */
/* ------------------------------------------------------------------ */

function hazardStripeCanvas(size = 256, warm = "#e8560f", cold = "#1a0f0c") {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = cold;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = warm;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  ctx.translate(-size, -size);
  for (let x = 0; x < size * 2; x += 56) ctx.fillRect(x, 0, 28, size * 2);
  ctx.restore();

  const random = seededRandom(50331653);
  ctx.fillStyle = "rgba(10, 6, 4, 0.5)";
  for (let i = 0; i < 60; i += 1) {
    ctx.fillRect(random() * size, random() * size, 2 + random() * 22, 1 + random() * 4);
  }

  grain(ctx, size, 20, 12582917);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Fire glow: what shows through a floor gap or a duct's scorched vents */
/* ------------------------------------------------------------------ */

function fireGlowCanvas(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "#160402");
  gradient.addColorStop(0.4, "#8c1c05");
  gradient.addColorStop(0.72, "#ff7a1f");
  gradient.addColorStop(1, "#ffdf9a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const random = seededRandom(1299709);
  ctx.fillStyle = "rgba(20, 6, 2, 0.5)";
  for (let i = 0; i < 30; i += 1) {
    const x = random() * size;
    const y = size * 0.5 + random() * size * 0.5;
    ctx.fillRect(x, y, 4 + random() * 10, 4 + random() * 14);
  }

  return canvas;
}

/** Soft round sprite for embers, smoke puffs, and impact sparks. */
function softParticleCanvas(size = 64, inner = "rgba(255,255,255,0.95)") {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Evac sign: redrawn whenever the countdown value it shows changes     */
/* ------------------------------------------------------------------ */

/**
 * A building-evacuation-style sign: a dark plate, a running-figure glyph, and
 * a line of text (e.g. "EXIT 92s"). Returns a live CanvasTexture plus a
 * `setText` you can call again later - the level calls it once when the
 * player passes the sign, so the number it shows is fixed until the next one.
 */
export function createSignTexture(initialText = "EXIT") {
  const canvas = createCanvas(256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(text) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#0aff6a";
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 244);

    // Running-figure glyph, simple enough to read as an exit icon at a glance.
    ctx.fillStyle = "#0aff6a";
    ctx.save();
    ctx.translate(70, 96);
    ctx.beginPath();
    ctx.arc(0, -34, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-8, -20, 16, 46);
    ctx.beginPath();
    ctx.moveTo(-8, 26);
    ctx.lineTo(-30, 66);
    ctx.lineTo(-16, 72);
    ctx.lineTo(4, 34);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, 24);
    ctx.lineTo(34, 10);
    ctx.lineTo(28, -4);
    ctx.lineTo(2, 8);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#0aff6a";
    ctx.font = "bold 46px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 128, 190);

    texture.needsUpdate = true;
  }

  draw(initialText);
  return { texture, setText: draw };
}

/* ------------------------------------------------------------------ */
/* Per-beat wall finishes, so each area of the building reads different */
/* ------------------------------------------------------------------ */

/** Ward: pale clinical tile with a darker wainscot band and scorch creep. */
function clinicalTileCanvas(size = 512) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b9c3bd";
  ctx.fillRect(0, 0, size, size);
  const random = seededRandom(7331);
  const tile = size / 8;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const shade = 170 + Math.floor(random() * 30);
      ctx.fillStyle = `rgb(${shade - 6}, ${shade + 4}, ${shade})`;
      ctx.fillRect(x * tile + 2, y * tile + 2, tile - 4, tile - 4);
    }
  }
  // Wainscot: the lower third is a darker, scuffed band.
  ctx.fillStyle = "rgba(40, 70, 64, 0.55)";
  ctx.fillRect(0, size * 0.68, size, size * 0.32);
  ctx.fillStyle = "rgba(20, 30, 28, 0.9)";
  ctx.fillRect(0, size * 0.66, size, 6);
  // Grime and scorch creeping up from the floor.
  for (let i = 0; i < 70; i += 1) {
    const x = random() * size;
    const y = size * 0.45 + random() * size * 0.55;
    const r = 10 + random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(12, 10, 8, 0.45)");
    g.addColorStop(1, "rgba(12, 10, 8, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(ctx, size, 18, 1181);
  return canvas;
}

/** Containment: riveted steel panels with warning chevrons at the base. */
function steelPanelCanvas(size = 512) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3b4246";
  ctx.fillRect(0, 0, size, size);
  const random = seededRandom(90121);
  const cols = 2;
  const rows = 3;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = (c * size) / cols;
      const y = (r * size) / rows;
      const w = size / cols;
      const h = size / rows;
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      const base = 58 + random() * 16;
      grad.addColorStop(0, `rgb(${base}, ${base + 6}, ${base + 10})`);
      grad.addColorStop(1, `rgb(${base - 14}, ${base - 10}, ${base - 6})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      ctx.fillStyle = "#1a1e20";
      for (const [bx, by] of [[x + 14, y + 14], [x + w - 14, y + 14], [x + 14, y + h - 14], [x + w - 14, y + h - 14]]) {
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Warning chevrons along the base.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, size * 0.9, size, size * 0.1);
  ctx.clip();
  ctx.fillStyle = "#1a1512";
  ctx.fillRect(0, size * 0.9, size, size * 0.1);
  ctx.fillStyle = "#c9a227";
  for (let x = -size; x < size * 2; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(x + 24, size * 0.9);
    ctx.lineTo(x + 48, size * 0.9);
    ctx.lineTo(x + 24, size);
    ctx.fill();
  }
  ctx.restore();
  // Heat discoloration.
  for (let i = 0; i < 30; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 20 + random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(70, 30, 10, 0.3)");
    g.addColorStop(1, "rgba(70, 30, 10, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(ctx, size, 16, 4409);
  return canvas;
}

/** Stairwell: poured concrete with form-tie holes, water stains, and cracks. */
function concreteCanvas(size = 512) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#6d6a64";
  ctx.fillRect(0, 0, size, size);
  const random = seededRandom(60617);
  for (let i = 0; i < 400; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 2 + random() * 18;
    ctx.fillStyle = `rgba(${random() < 0.5 ? "40,38,34" : "150,146,138"}, ${0.05 + random() * 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Form-panel seams and tie holes.
  ctx.strokeStyle = "rgba(30, 28, 26, 0.6)";
  ctx.lineWidth = 2;
  for (let y = 0; y <= size; y += size / 2) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#2a2724";
  for (let y = size / 4; y < size; y += size / 2) {
    for (let x = size / 6; x < size; x += size / 3) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Water/soot streaks running down.
  for (let i = 0; i < 24; i += 1) {
    const x = random() * size;
    const g = ctx.createLinearGradient(x, 0, x, size);
    g.addColorStop(0, "rgba(20, 18, 16, 0.35)");
    g.addColorStop(1, "rgba(20, 18, 16, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 3 + random() * 8, size * (0.3 + random() * 0.7));
  }
  ctx.strokeStyle = "rgba(15, 14, 12, 0.85)";
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 7; i += 1) {
    let x = random() * size;
    let y = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s += 1) {
      x += (random() - 0.5) * 50;
      y += random() * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grain(ctx, size, 24, 8123);
  return canvas;
}

/** Floor: large scuffed vinyl/concrete tiles with a painted evac line. */
function labFloorCanvas(size = 512) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3d3f3c";
  ctx.fillRect(0, 0, size, size);
  const random = seededRandom(24593);
  const tile = size / 4;
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const shade = 52 + Math.floor(random() * 16);
      ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade - 2})`;
      ctx.fillRect(x * tile + 1.5, y * tile + 1.5, tile - 3, tile - 3);
    }
  }
  for (let i = 0; i < 140; i += 1) {
    ctx.strokeStyle = `rgba(${random() < 0.5 ? "20,20,18" : "120,118,110"}, ${0.08 + random() * 0.15})`;
    ctx.lineWidth = 1;
    const x = random() * size;
    const y = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 40, y + (random() - 0.5) * 10);
    ctx.stroke();
  }
  for (let i = 0; i < 40; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 10 + random() * 36;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(8, 6, 4, 0.5)");
    g.addColorStop(1, "rgba(8, 6, 4, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(ctx, size, 16, 5501);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Lab dressing: what makes this read as a lab and not a hallway        */
/* ------------------------------------------------------------------ */

/** A wall console's screen: readouts, a waveform, and a status grid. */
function consoleScreenCanvas(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#040a06";
  ctx.fillRect(0, 0, size, size);

  const random = seededRandom(2147483629);
  ctx.strokeStyle = "rgba(60, 255, 140, 0.35)";
  ctx.lineWidth = 1;
  for (let y = 10; y < size; y += 14) {
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(8 + random() * (size - 40), y);
    ctx.stroke();
  }

  // A waveform strip, the readable "this is a working console" cue.
  ctx.strokeStyle = "#3cff8c";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.62);
  for (let x = 0; x <= size; x += 6) {
    const y = size * 0.62 + Math.sin(x * 0.12) * 14 * Math.sin(x * 0.02) - (random() - 0.5) * 6;
    ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 60, 40, 0.85)";
  for (let i = 0; i < 5; i += 1) {
    ctx.fillRect(16 + i * 44, size - 26, 30, 12);
  }

  return canvas;
}

/** A web of cracks over glass - used on tanks and observation windows. */
function crackOverlayCanvas(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const random = seededRandom(3126986123);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.4;
  const originX = size * (0.3 + random() * 0.4);
  const originY = size * (0.3 + random() * 0.4);
  for (let arm = 0; arm < 9; arm += 1) {
    let x = originX;
    let y = originY;
    let angle = (arm / 9) * Math.PI * 2 + random() * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 5; step += 1) {
      angle += (random() - 0.5) * 0.8;
      x += Math.cos(angle) * (10 + random() * 20);
      y += Math.sin(angle) * (10 + random() * 20);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return canvas;
}

/**
 * Roughness for the floors: mostly scuffed, with blotches of water from the
 * sprinklers and burst pipes. Dark = glossy, so the puddles pick up the fire
 * and the alarm lights - the cheapest "reflective wet floor" there is, with
 * the scene's environment map and point lights doing the rest.
 */
function puddleCanvas(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b4b4b4";
  ctx.fillRect(0, 0, size, size);
  const random = seededRandom(771);
  ctx.filter = "blur(7px)";
  for (let i = 0; i < 16; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 10 + random() * 34;
    const g = Math.round(28 + random() * 50);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    // Draw with wrap-around copies so the tile repeats seamlessly.
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r * (1 + random() * 0.6), r * 0.6, random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.filter = "none";
  grain(ctx, size, 26, 91);
  return canvas;
}

/**
 * Build every baked texture the level needs, once per level instance. Owns
 * its textures and disposes them on unload.
 */
export function createMeltdownTextures() {
  const tileHeightMap = tileHeight();
  const hazardCanvas = hazardStripeCanvas();

  const textures = {
    tileColour: finish(tileColour(), { repeat: [2, 1], srgb: true }),
    tileNormal: finish(heightToNormal(tileHeightMap, 2.2), { repeat: [2, 1] }),
    hazardColour: finish(hazardCanvas, { repeat: [2, 1], srgb: true }),
    hazardNormal: finish(heightToNormal(hazardCanvas, 1.1), { repeat: [2, 1] }),
    fireGlow: finish(fireGlowCanvas(), { repeat: [1, 1], srgb: true }),
    ember: finish(softParticleCanvas(64, "rgba(255,178,96,0.98)"), { srgb: true }),
    smoke: finish(softParticleCanvas(96, "rgba(210,205,198,0.55)"), { srgb: true }),
    consoleScreen: finish(consoleScreenCanvas(), { srgb: true }),
    crackOverlay: finish(crackOverlayCanvas(), { srgb: true }),
    wardWall: finish(clinicalTileCanvas(), { repeat: [2, 1], srgb: true }),
    steelWall: finish(steelPanelCanvas(), { repeat: [2, 1], srgb: true }),
    concreteWall: finish(concreteCanvas(), { repeat: [2, 1], srgb: true }),
    labFloor: finish(labFloorCanvas(), { repeat: [3, 2], srgb: true }),
  };
  textures.wardWallNormal = finish(heightToNormal(clinicalTileCanvas(256), 1.4), { repeat: [2, 1] });
  textures.steelWallNormal = finish(heightToNormal(steelPanelCanvas(256), 1.8), { repeat: [2, 1] });
  textures.concreteWallNormal = finish(heightToNormal(concreteCanvas(256), 2.2), { repeat: [2, 1] });
  textures.labFloorNormal = finish(heightToNormal(labFloorCanvas(256), 1.6), { repeat: [3, 2] });
  textures.floorRoughness = finish(puddleCanvas(), { repeat: [1.5, 1] });

  textures.dispose = () => {
    for (const value of Object.values(textures)) {
      if (value && typeof value.dispose === "function") value.dispose();
    }
  };

  return textures;
}
