/**
 * A scene's shaders and textures made ready before it is seen - without
 * freezing the page while the driver works.
 *
 *   await compileReady(renderer, scene, camera)
 *   await uploadTextures(renderer, root)
 *
 * renderer.compile only queues the programs, and the first thing to touch
 * one after that - a draw, a texture upload - blocks until every program
 * queued ahead of it is linked. On a laptop's own graphics under Direct3D
 * that was twenty seconds of a frozen page going up to the Roof.
 * compileReady finishes them one at a time with a breath between, so the
 * page (the loading screen, the pause) keeps going. (three's compileAsync
 * waits on the driver instead, but forever on a program disposed meanwhile
 * - a level thrown away while it warmed - polling it every 10 ms for good.)
 */

import * as THREE from "../three.js";

const breath = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Drawn into a render target, not the screen: three's programs differ (linear, no tone mapping). */
let offscreen = null;

/**
 * `throughTarget`: the scene is drawn through post-processing (an
 * EffectComposer, postfx.js), so into a render target - the programs it
 * needs are those (linear output, no tone mapping), not the screen's. Warmed
 * for the screen instead, every one compiled again on the first frame.
 */
export async function compileReady(renderer, scene, camera, { throughTarget = false, hidden = false, timeout = 90000 } = {}) {
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(throughTarget ? (offscreen ??= new THREE.WebGLRenderTarget(1, 1)) : null);
  // `hidden`: what is hidden for now too (renderer.compile skips it), or it
  // compiles the moment it first shows. Lights stay as they are: their
  // count is part of every program.
  const shown = [];
  if (hidden) {
    scene.traverse((o) => {
      if (!o.visible && !o.isLight) {
        o.visible = true;
        shown.push(o);
      }
    });
  }
  let materials;
  try {
    materials = renderer.compile(scene, camera);
  } finally {
    for (const o of shown) o.visible = false;
    renderer.setRenderTarget(previous);
  }
  const gl = renderer.getContext();
  const parallel = !!renderer.extensions.get("KHR_parallel_shader_compile");
  const start = performance.now();
  for (const material of materials) {
    if (performance.now() - start > timeout) break;
    const program = renderer.properties.get(material).currentProgram;
    // Gone meanwhile (disposed, or its program given back), or linked.
    if (!program?.program || (parallel && program.isReady())) continue;
    // Finished now, this one: asking its link status waits for it (and
    // whatever was queued ahead of it) - a moment's freeze, not one long one.
    gl.getProgramParameter(program.program, gl.LINK_STATUS);
    await breath(0);
  }
}

/** Every texture under `root` on the GPU, a few at a time with a breath between. */
export async function uploadTextures(renderer, root, { batch = 4 } = {}) {
  const textures = new Set();
  root.traverse((o) => {
    for (const m of o.material ? [].concat(o.material) : []) {
      for (const key of ["map", "normalMap", "emissiveMap", "roughnessMap", "metalnessMap", "alphaMap"]) if (m[key]) textures.add(m[key]);
    }
  });
  let n = 0;
  for (const t of textures) {
    renderer.initTexture(t);
    if (++n % batch === 0) await breath(0);
  }
  return textures.size;
}
