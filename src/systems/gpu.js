/**
 * What this device's graphics can actually draw into.
 *
 * The post-processing draws the world into a half-float image first (room
 * for light brighter than white, for the bloom). Most GPUs can; some phone
 * and tablet GPUs can't, or say they can and then draw black. So it is
 * tried once - an image made, cleared and checked as a place to draw - and
 * if that fails everything falls back to ordinary 8-bit images (no bright
 * highlights to bloom, but a picture).
 *
 *   new THREE.WebGLRenderTarget(w, h, { type: drawableType(renderer) });
 *   gpuReport()   // { halfFloat: true|false|null }
 */

import * as THREE from "../three.js";

let halfFloat = null;
let shared = null;

/** The game's renderer (main.js), for code that has none to hand. */
export function useRenderer(renderer) {
  shared = renderer;
}

/** HalfFloatType where it can be drawn into, else UnsignedByteType. */
export function drawableType(renderer = shared) {
  if (halfFloat === null) {
    if (!renderer) return THREE.HalfFloatType;
    halfFloat = probe(renderer);
  }
  return halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
}

function probe(renderer) {
  const gl = renderer?.getContext?.();
  if (!gl) return true;
  if (/[?&]fx8(&|$)/.test(location.search)) return false;
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const before = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.clear();
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    renderer.setRenderTarget(before);
    target.dispose();
  }
}

export function gpuReport() {
  return { halfFloat };
}
