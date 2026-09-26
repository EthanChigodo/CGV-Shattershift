/**
 * Amortised reflection probe.
 *
 * Reflections need to see the actual level - the fires, the sky, the smoke -
 * not a static picture. A CubeCamera captures the scene into the six faces of
 * a cube map, which the glass shader and the wet floor sample with reflect().
 *
 * Rendering all six faces every frame would mean rendering the level seven
 * times per frame. Instead this probe renders ONE face per frame, so a full
 * refresh takes six frames (a tenth of a second at 60 fps) and the extra cost
 * is one small 128x128 render per frame. On low quality it renders a face
 * every third frame.
 *
 * Rough PBR materials (the floor, steel, walls) cannot use a sharp cube map
 * directly; they need it pre-filtered into blurrier versions for each
 * roughness (PMREM). The probe owns its own PMREMGenerator and output target
 * rather than letting Three cache one internally, because Three's cache never
 * frees the filtered copy of a render-target cube map - a texture leaked on
 * every level load until this was changed.
 *
 * The probe cameras only see the world layer, never the glass layer - glass
 * reflecting itself inside its own probe would feed back into itself - and
 * shadows are not re-rendered for the probe (the renderer's shadow map is
 * updated once per frame by the post pipeline).
 */

import * as THREE from "../../three.js";
import { LAYERS } from "./layers.js";

export class ReflectionProbe {
  constructor({ size = 128, interval = 1 } = {}) {
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.CubeCamera(0.2, 900, this.target);
    this.camera.name = "ReflectionProbe";
    for (const cam of this.camera.children) {
      cam.layers.set(LAYERS.WORLD);
      cam.layers.enable(LAYERS.FX);
    }
    this.face = 0;
    this.frame = 0;
    this.interval = interval;
    this.primed = false;
    this.enabled = true;
    this.position = new THREE.Vector3();
    this.pmrem = null;
    this.pmremTarget = null;
    /** Called once, when the pre-filtered map first exists. */
    this.onReady = null;
  }

  /** Pre-filtered (PMREM) version of the probe, for rough materials. */
  get filteredTexture() {
    return this.pmremTarget?.texture ?? null;
  }

  _filter(renderer) {
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
    const first = !this.pmremTarget;
    this.pmremTarget = this.pmrem.fromCubemap(this.target.texture, this.pmremTarget);
    if (first) this.onReady?.(this.pmremTarget.texture);
  }

  get texture() {
    return this.target.texture;
  }

  _ensureCoordinateSystem(renderer) {
    if (this.camera.coordinateSystem !== renderer.coordinateSystem) {
      this.camera.coordinateSystem = renderer.coordinateSystem;
      this.camera.updateCoordinateSystem();
    }
  }

  /** Render every face now. Used on level start so the first frame is right. */
  prime(renderer, scene) {
    this._ensureCoordinateSystem(renderer);
    this.camera.position.copy(this.position);
    this.camera.updateMatrixWorld(true);
    const previous = renderer.getRenderTarget();
    for (let face = 0; face < 6; face += 1) {
      renderer.setRenderTarget(this.target, face);
      renderer.render(scene, this.camera.children[face]);
    }
    renderer.setRenderTarget(previous);
    this._filter(renderer);
    this.primed = true;
  }

  /** Render one face. Call once per frame, after the main render. */
  update(renderer, scene) {
    if (!this.enabled) return;
    if (!this.primed) { this.prime(renderer, scene); return; }
    this.frame += 1;
    if (this.frame % this.interval !== 0) return;
    this._ensureCoordinateSystem(renderer);
    this.camera.position.copy(this.position);
    this.camera.updateMatrixWorld(true);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target, this.face);
    renderer.render(scene, this.camera.children[this.face]);
    renderer.setRenderTarget(previous);
    this.face = (this.face + 1) % 6;
    // Re-filter for rough materials once per completed cycle, not every face.
    if (this.face === 0) this._filter(renderer);
  }

  dispose() {
    this.target.dispose();
    this.pmremTarget?.dispose();
    this.pmrem?.dispose();
  }
}
