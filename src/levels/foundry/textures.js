/**
 * Procedural textures for Level 2 - The Shifting Foundry.
 *
 * Every texture here is generated at runtime on a 2D canvas. Nothing is
 * downloaded, so the level works offline, adds no load time, and needs no
 * entry in the credits register.
 *
 * Height maps are converted to tangent-space normal maps with a Sobel filter
 * (`heightToNormal`), which is what gives the foundry its ribbed metal, grated
 * floors, and stamped hazard plating under the moving work lights.
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

/**
 * Sobel-filter a greyscale height canvas into a tangent-space normal map.
 * `strength` exaggerates the slope; 1 is subtle, 4 is heavy industrial relief.
 */
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
      // Sobel gradients in x and y.
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
      image.data[index + 2] = (nz / length * 0.5 + 0.5) * 255;
      image.data[index + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return out;
}

/** Deterministic value noise so every teammate sees the same foundry. */
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
/* Ribbed wall plating: vertical ribs, bolt rows, weld seams            */
/* ------------------------------------------------------------------ */

function ribbedPlatingHeight(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#6e6e6e";
  ctx.fillRect(0, 0, size, size);

  // Vertical structural ribs.
  for (let x = 0; x < size; x += 64) {
    const gradient = ctx.createLinearGradient(x, 0, x + 48, 0);
    gradient.addColorStop(0, "#4a4a4a");
    gradient.addColorStop(0.5, "#e2e2e2");
    gradient.addColorStop(1, "#4a4a4a");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 8, 0, 48, size);
  }

  // Horizontal weld seams.
  ctx.fillStyle = "#2a2a2a";
  for (let y = 0; y < size; y += 128) ctx.fillRect(0, y, size, 5);

  // Bolt heads along each seam.
  ctx.fillStyle = "#f4f4f4";
  for (let y = 10; y < size; y += 128) {
    for (let x = 22; x < size; x += 64) {
      ctx.beginPath();
      ctx.arc(x, y + 8, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  grain(ctx, size, 26, 7919);
  return canvas;
}

function ribbedPlatingColour(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#39434b";
  ctx.fillRect(0, 0, size, size);

  for (let x = 0; x < size; x += 64) {
    const gradient = ctx.createLinearGradient(x, 0, x + 48, 0);
    gradient.addColorStop(0, "#232b31");
    gradient.addColorStop(0.5, "#4e5a63");
    gradient.addColorStop(1, "#232b31");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 8, 0, 48, size);
  }

  // Rust and heat staining low on the panel.
  const random = seededRandom(104729);
  for (let i = 0; i < 40; i += 1) {
    const x = random() * size;
    const y = size * 0.55 + random() * size * 0.45;
    const r = 6 + random() * 26;
    const stain = ctx.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, "rgba(96, 54, 26, 0.30)");
    stain.addColorStop(1, "rgba(96, 54, 26, 0)");
    ctx.fillStyle = stain;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  ctx.fillStyle = "#171d21";
  for (let y = 0; y < size; y += 128) ctx.fillRect(0, y, size, 5);

  grain(ctx, size, 18, 15485863);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Floor grating: open mesh walkway                                     */
/* ------------------------------------------------------------------ */

function grateHeight(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 9;
  for (let x = 0; x <= size; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  ctx.lineWidth = 5;
  for (let y = 0; y <= size; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  grain(ctx, size, 14, 32452843);
  return canvas;
}

function grateColour(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d1114";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#4b555d";
  ctx.lineWidth = 9;
  for (let x = 0; x <= size; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  ctx.strokeStyle = "#39424a";
  ctx.lineWidth = 5;
  for (let y = 0; y <= size; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  grain(ctx, size, 16, 49979687);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Hazard plating: diagonal warning stripes on the edge of danger       */
/* ------------------------------------------------------------------ */

function hazardStripeCanvas(size = 256, warm = "#d8a21a", cold = "#16191c") {
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

  // Scuffs, so the stripes do not look like clean vector art.
  const random = seededRandom(86028121);
  ctx.fillStyle = "rgba(20, 22, 25, 0.45)";
  for (let i = 0; i < 60; i += 1) {
    ctx.fillRect(random() * size, random() * size, 2 + random() * 22, 1 + random() * 4);
  }

  grain(ctx, size, 20, 27644437);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Heat panel: furnace glow behind a slotted grille                     */
/* ------------------------------------------------------------------ */

function heatPanelCanvas(size = 256) {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "#2b0d05");
  gradient.addColorStop(0.45, "#c8380c");
  gradient.addColorStop(0.7, "#ffb347");
  gradient.addColorStop(1, "#5c1a06");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#10100f";
  for (let y = 12; y < size; y += 28) ctx.fillRect(0, y, size, 12);

  return canvas;
}

/** Soft round sprite used for steam puffs and spark motes. */
function softParticleCanvas(size = 64, inner = "rgba(255,255,255,0.95)") {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.45, "rgba(255,255,255,0.25)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * Build every texture the foundry needs, once per level instance.
 * The returned object owns its textures and disposes them on unload, which is
 * how the level avoids the "level changes leak GPU memory" risk in the guide.
 */
export function createFoundryTextures() {
  const platingHeight = ribbedPlatingHeight();
  const grateHeightMap = grateHeight();
  const hazardCanvas = hazardStripeCanvas();

  const textures = {
    platingColour: finish(ribbedPlatingColour(), { repeat: [2, 1], srgb: true }),
    platingNormal: finish(heightToNormal(platingHeight, 2.6), { repeat: [2, 1] }),
    grateColour: finish(grateColour(), { repeat: [2, 6], srgb: true }),
    grateNormal: finish(heightToNormal(grateHeightMap, 3.4), { repeat: [2, 6] }),
    hazardColour: finish(hazardCanvas, { repeat: [2, 1], srgb: true }),
    hazardNormal: finish(heightToNormal(hazardCanvas, 1.1), { repeat: [2, 1] }),
    heatPanel: finish(heatPanelCanvas(), { repeat: [1, 1], srgb: true }),
    steam: finish(softParticleCanvas(), { srgb: true }),
    spark: finish(softParticleCanvas(64, "rgba(255,214,150,0.98)"), { srgb: true }),
  };

  textures.dispose = () => {
    for (const value of Object.values(textures)) {
      if (value && typeof value.dispose === "function") value.dispose();
    }
  };

  return textures;
}
