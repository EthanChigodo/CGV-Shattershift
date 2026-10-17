/**
 * Split screen: one scene, two cameras, each drawn into its half of the
 * canvas through the roof's own post-processing.
 *
 * The roof is graded, not just rendered (src/levels/meltdown/game.js): bloom
 * on the fire, the floods and the spheres, ACES tone mapping, then the
 * grading pass (post.js) - heat haze, the chromatic split on a hit, the
 * vignette that closes in with danger, film grain. A split screen that
 * dropped all that would not look like the game, and two full post chains
 * would cost twice the memory, so there is one chain, sized to a single
 * view, run once per view:
 *
 *   renderer.setViewport(rect)  +  setScissor(rect)  +  setScissorTest(true)
 *   composer: RenderPass(scene, that view's camera) -> bloom -> output -> grade
 *
 * Every pass but the last draws into the composer's own targets (their own
 * full-size viewports); only the grade draws to the canvas, and three.js
 * puts a draw to the canvas inside the renderer's current viewport and
 * scissor - so the same chain lands in each half in turn. Each view gets its
 * own grade (its player's danger, hit flash, a darkening while they are
 * out). Afterwards the renderer is left full-screen with the scissor off,
 * as the rest of the game expects.
 *
 * Layouts: "v" side by side (default), "h" stacked, "single" (the winner's
 * shot, full screen). Rects are in CSS pixels, origin bottom-left (WebGL's).
 *
 * Budget: each view is half the pixels, so the fill cost is about one full
 * screen's; the draw calls double. Bloom runs at a third of a view.
 */

import * as THREE from "../three.js";
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from "../three-addons.js";
import { createGradePass } from "../levels/meltdown/post.js";

/** The seam between the views, CSS px (the HUD draws it; the views leave it free). */
export const SEAM = 4;

export class SplitRenderer {
  constructor(renderer, scene, { bloom = true } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.layout = "v";
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.pass = new RenderPass(scene, new THREE.PerspectiveCamera());
    this.composer.addPass(this.pass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 3, size.y / 3), 0.6, 0.45, 0.92);
    this.bloom.enabled = bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = createGradePass();
    this.composer.addPass(this.grade);
    /** The rects drawn last frame (the checks read them). */
    this.lastViews = [];
    this.viewSize = new THREE.Vector2();
    this.resize();
  }

  setLayout(layout) {
    if (layout === this.layout) return;
    this.layout = layout;
    this.resize();
  }

  /** The views' rects for the current canvas size and layout. */
  rects() {
    const { x: w, y: h } = this.renderer.getSize(new THREE.Vector2());
    if (this.layout === "single") return [{ x: 0, y: 0, w, h }];
    if (this.layout === "h") {
      const half = Math.floor((h - SEAM) / 2);
      // P1 on top (WebGL's y runs up).
      return [{ x: 0, y: h - half, w, h: half }, { x: 0, y: 0, w, h: half }];
    }
    const half = Math.floor((w - SEAM) / 2);
    return [{ x: 0, y: 0, w: half, h }, { x: w - half, y: 0, w: half, h }];
  }

  /** After the canvas or the pixel ratio changes. */
  resize() {
    const r = this.rects()[0];
    this.viewSize.set(r.w, r.h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(r.w, r.h);
    this.bloom.resolution.set(r.w / 3, r.h / 3);
    this.grade.uniforms.uResolution.value.set(r.w * this.renderer.getPixelRatio(), r.h * this.renderer.getPixelRatio());
  }

  /**
   * Draw each view. `views`: [{ camera, grade: {danger, hit, dark, heat}, before() }]
   * in the order of rects() (P1 first).
   */
  render(views, time = 0) {
    const renderer = this.renderer;
    const rects = this.rects();
    const full = renderer.getSize(new THREE.Vector2());
    const g = this.grade.uniforms;
    this.lastViews = [];
    renderer.setScissorTest(true);
    for (let i = 0; i < views.length && i < rects.length; i += 1) {
      const view = views[i];
      const r = rects[i];
      view.before?.();
      const aspect = r.w / Math.max(1, r.h);
      if (Math.abs(view.camera.aspect - aspect) > 1e-3) {
        view.camera.aspect = aspect;
        view.camera.updateProjectionMatrix();
      }
      this.pass.camera = view.camera;
      g.uTime.value = time;
      g.uDanger.value = view.grade?.danger ?? 0;
      g.uHit.value = view.grade?.hit ?? 0;
      g.uDark.value = view.grade?.dark ?? 0.15;
      g.uHeat.value = view.grade?.heat ?? 0;
      renderer.setViewport(r.x, r.y, r.w, r.h);
      renderer.setScissor(r.x, r.y, r.w, r.h);
      this.composer.render();
      this.lastViews.push({ ...r, scissor: renderer.getScissorTest() });
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, full.x, full.y);
    renderer.setScissor(0, 0, full.x, full.y);
  }

  dispose() {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.bloom.dispose?.();
    this.grade.material?.dispose?.();
  }
}
