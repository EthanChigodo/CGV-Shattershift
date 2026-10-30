/**
 * The marks the right-tool obstacles carry (src/systems/problems.js): the
 * solving sphere's sign on a disc, and hazard stripes on the floor, in that
 * sphere's colour - cryo cyan on a fire wall, shock violet on a sealed door
 * or a junction box, gravity indigo on stranded supplies, glass white on the
 * forge's valve, the charge's gold on a jammed shutter. Readable at a glance,
 * at running speed, before the words.
 *
 * Plain unlit materials (bright enough to bloom where a level blooms), so
 * one set works in every level's scene. The textures and the unit plane are
 * shared and never disposed (a handful of small canvases); each badge or
 * stripe gets its own material so a level can fade it out once solved.
 *
 *   const badge = toolBadge("cryo", 1.1);       // a disc, facing +Z
 *   const floor = floorStripes("cryo", 12, 2);  // flat, on y = 0
 *   fadeMark(badge, 0.3);                       // dims it (solved)
 */

import * as THREE from "../three.js";
import { TOOLS } from "../systems/problems.js";

const PLANE = new THREE.PlaneGeometry(1, 1);
const textures = new Map();

/** The sign of each tool on a 24-unit grid (as the field manual draws them). */
function drawSign(ctx, tool) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (tool === "glass") {
    ctx.stroke(new Path2D("M12 3l7 9-7 9-7-9z"));
    ctx.lineWidth *= 0.6;
    ctx.stroke(new Path2D("M5 12h14M12 3l-2.5 9L12 21l2.5-9z"));
  } else if (tool === "cryo") {
    ctx.stroke(new Path2D("M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5M4.2 10.6l2.4-.9-.5-2.6M19.8 13.4l-2.4.9.5 2.6M4.2 13.4l2.4.9-.5 2.6M19.8 10.6l-2.4-.9.5-2.6"));
  } else if (tool === "shock") {
    ctx.fill(new Path2D("M13.5 2L5 13.5h6L9.5 22 19 9.5h-6.2z"));
  } else if (tool === "gravity") {
    ctx.beginPath();
    ctx.ellipse(12, 12, 9.5, 3.8, -0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(12, 12, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth *= 0.6;
    ctx.stroke(new Path2D("M12 3.2c3 0 5 1.2 6.2 2.8M12 20.8c-3 0-5-1.2-6.2-2.8"));
  } else if (tool === "charge") {
    ctx.beginPath();
    ctx.arc(12, 12, 4.2, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(12 + Math.cos(a) * 6.6, 12 + Math.sin(a) * 6.6);
      ctx.lineTo(12 + Math.cos(a) * 10, 12 + Math.sin(a) * 10);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The tool's sign in a ring, on a transparent disc (CanvasTexture, shared). */
export function toolMarkTexture(tool) {
  const key = `mark:${tool}`;
  if (textures.has(key)) return textures.get(key);
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const colour = TOOLS[tool]?.colour ?? "#ffffff";
  // A dark disc so the sign reads against fire and glare, a ring in the colour.
  ctx.fillStyle = "rgba(6, 8, 12, 0.82)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = size * 0.06;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  const scale = (size * 0.56) / 24;
  ctx.translate(size / 2 - 12 * scale, size / 2 - 12 * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 2;
  drawSign(ctx, tool);
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textures.set(key, texture);
  return texture;
}

/** Diagonal hazard stripes in the tool's colour (CanvasTexture, shared, repeating). */
function stripeTexture(tool) {
  const key = `stripes:${tool}`;
  if (textures.has(key)) return textures.get(key);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = TOOLS[tool]?.colour ?? "#ffffff";
  for (let i = -1; i < 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * size, size);
    ctx.lineTo(i * size + size * 0.5, size);
    ctx.lineTo(i * size + size * 1.5, 0);
    ctx.lineTo(i * size + size, 0);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  textures.set(key, texture);
  return texture;
}

/** The tool's colour (THREE.Color), times `boost` (above 1 to bloom). */
export function toolColour(tool, boost = 1) {
  return new THREE.Color(TOOLS[tool]?.hex ?? 0xffffff).multiplyScalar(boost);
}

/**
 * The tool's sign on a disc `size` metres across, facing +Z (turn it to face
 * the way the player comes). `glow` > 1 lets it bloom.
 */
export function toolBadge(tool, size = 1, { glow = 1.6 } = {}) {
  const material = new THREE.MeshBasicMaterial({
    map: toolMarkTexture(tool), transparent: true, depthWrite: false, toneMapped: false,
    color: new THREE.Color(glow, glow, glow), side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(PLANE, material);
  mesh.scale.set(size, size, 1);
  mesh.name = `ProblemMark_${tool}`;
  mesh.renderOrder = 4;
  mesh.userData.problemMark = true;
  mesh.userData.disposeMaterial = material;
  return mesh;
}

/** The sign as a sprite (always facing the camera: the roof's overhead view). */
export function toolSprite(tool, size = 1, { glow = 1.6 } = {}) {
  const material = new THREE.SpriteMaterial({
    map: toolMarkTexture(tool), transparent: true, depthWrite: false, toneMapped: false,
    color: new THREE.Color(glow, glow, glow), fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  sprite.name = `ProblemSprite_${tool}`;
  sprite.renderOrder = 4;
  sprite.userData.problemMark = true;
  sprite.userData.disposeMaterial = material;
  return sprite;
}

/**
 * Hazard stripes `width` x `depth` metres flat on the floor (y = 0.02), in
 * the tool's colour: the line the problem draws across the route.
 */
export function floorStripes(tool, width, depth, { opacity = 0.75, glow = 1.3 } = {}) {
  const map = stripeTexture(tool).clone();
  map.needsUpdate = true;
  map.repeat.set(Math.max(1, Math.round(width / 0.9)), Math.max(1, Math.round(depth / 0.9)));
  const material = new THREE.MeshBasicMaterial({
    map, transparent: true, opacity, depthWrite: false, toneMapped: false,
    color: new THREE.Color(glow, glow, glow), polygonOffset: true, polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(PLANE, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(width, depth, 1);
  mesh.position.y = 0.02;
  mesh.name = `ProblemFloor_${tool}`;
  mesh.userData.problemMark = true;
  mesh.userData.disposeMaterial = material;
  mesh.userData.disposeTexture = map;
  return mesh;
}

/** Fade a mark (a badge, a sprite, stripes) to `k` of its strength: solved. */
export function fadeMark(mark, k) {
  const material = mark?.material;
  if (!material) return;
  material.userData.base ??= material.opacity;
  material.opacity = material.userData.base * k;
  mark.visible = k > 0.02;
}

/** Free a mark's own material (and texture copy); the shared textures stay. */
export function disposeMark(mark) {
  mark?.userData.disposeMaterial?.dispose();
  mark?.userData.disposeTexture?.dispose();
}
