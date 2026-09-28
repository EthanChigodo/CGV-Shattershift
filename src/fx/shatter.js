/**
 * Level 1's glass physics, for every level.
 *
 * The Glass Causeway breaks glass on the GPU (src/levels/causeway/shaders/
 * particles.js): a pane fractures radially around the exact point it was hit
 * - small fast pieces at the impact, big slow ones at the edges - and every
 * piece flies ballistically, spins (Rodrigues' formula) and bounces once on
 * the floor with restitution and friction, all computed in the vertex
 * shader, so hundreds of shards cost the CPU nothing after they spawn.
 *
 * Those shaders only need a reflection cube map from Level 1 (its probe).
 * This wraps them with a small cube map of its own, so the Foundry, the Labs
 * and the Roof shatter the same way:
 *
 *   const shatter = new ShatterFX(scene, { floorHalfWidth: 5.6 });
 *   shatter.fracture(paneMesh, hitPoint, ballVelocity);   // a flat pane
 *   shatter.chunks(point, 16, { tint: 0x9ff4f0 });        // anything else
 *   // each frame: shatter.update(dt)
 */

import * as THREE from "../three.js";
import { createShardMaterial, buildChunkGeometry, buildFractureGeometry } from "../levels/causeway/shaders/particles.js";

/** A tiny sky/ground cube map for the shards to reflect. */
function reflectionCube(sky, ground, horizon) {
  const faces = [];
  const colour = (c) => `#${new THREE.Color(c).getHexString()}`;
  for (let i = 0; i < 6; i += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const g = canvas.getContext("2d");
    if (i === 2) g.fillStyle = colour(sky);
    else if (i === 3) g.fillStyle = colour(ground);
    else {
      const grad = g.createLinearGradient(0, 0, 0, 16);
      grad.addColorStop(0, colour(sky));
      grad.addColorStop(0.55, colour(horizon));
      grad.addColorStop(1, colour(ground));
      g.fillStyle = grad;
    }
    g.fillRect(0, 0, 16, 16);
    faces.push(canvas);
  }
  const texture = new THREE.CubeTexture(faces);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const MAX_BURSTS = 24;

export class ShatterFX {
  /**
   * @param {THREE.Object3D} parent  where the (world-space) shards go
   * @param {object} [o]
   * @param {number} [o.floorHalfWidth]  shards land within |x| < this and fall past it
   *   (world x - fine for runs down -Z; pass a big value for turning routes)
   * @param {number} [o.floor]  floor height
   * @param {number[]} [o.env]  [sky, ground, horizon] colours for reflections
   */
  constructor(parent, { floorHalfWidth = 6, floor = 0, env = [0xbfd6e0, 0x1a1512, 0x6a7a80] } = {}) {
    this.parent = parent;
    this.floorHalfWidth = floorHalfWidth;
    this.floor = floor;
    this.envTexture = reflectionCube(...env);
    this.shared = { uEnv: { value: this.envTexture } };
    this.bursts = [];
  }

  /** Tumbling chunks (Level 1's crystals, tanks, the pod): for anything that isn't a flat pane. */
  chunks(centre, count, { tint = 0xcff8ff, speed = 4, radius = 0.4, size = 0.12, push = null, life = 2.4 } = {}) {
    return this._add(buildChunkGeometry(centre, count, { speed, radius, size, push }), tint, life);
  }

  /**
   * Fracture a flat pane around the point it was hit (Level 1's radial
   * fracture). The pane's geometry is taken as a box: width x, height y,
   * thickness z, in its own space.
   */
  fracture(mesh, hitPoint, push, { tint = 0xcff8ff, spokes = 11, rings = 4, power = 1, life = 3.2 } = {}) {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    mesh.updateWorldMatrix(true, false);
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    // Work in a frame centred on the pane.
    const matrix = mesh.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z));
    const local = mesh.worldToLocal(hitPoint.clone()).sub(centre);
    const dir = push.clone();
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const g = buildFractureGeometry(matrix, { width: size.x, height: size.y, depth: Math.max(0.02, size.z) }, new THREE.Vector2(local.x, local.y), dir, { spokes, rings, power });
    return this._add(g, tint, life);
  }

  _add(geometry, tint, life) {
    const material = createShardMaterial(this.shared, tint, life);
    material.uniforms.uFloor.value = this.floor;
    material.uniforms.uFloorHalfWidth.value = this.floorHalfWidth;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.parent.add(mesh);
    this.bursts.push({ mesh, age: 0, life });
    while (this.bursts.length > MAX_BURSTS) this._remove(0);
    return mesh;
  }

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i];
      b.age += dt;
      b.mesh.material.uniforms.uAge.value = b.age;
      if (b.age >= b.life) this._remove(i);
    }
  }

  _remove(index) {
    const b = this.bursts[index];
    b.mesh.parent?.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
    this.bursts.splice(index, 1);
  }

  clear() {
    while (this.bursts.length) this._remove(this.bursts.length - 1);
  }

  dispose() {
    this.clear();
    this.envTexture.dispose();
  }
}
