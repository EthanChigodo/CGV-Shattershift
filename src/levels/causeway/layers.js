/**
 * Render layers. A Three.js object is drawn by a camera only if they share a
 * layer, which lets one scene serve several cameras with different jobs:
 *
 *   WORLD    opaque level geometry and the sky. Every camera sees it.
 *   GLASS    refractive glass. Drawn in its own pass after the scene snapshot
 *            it refracts; hidden from the reflection probe so glass never
 *            reflects itself.
 *   FX       additive and alpha effects (fire, smoke, sparks, shards). Drawn
 *            last so glass cannot overwrite a flame in front of it.
 *   MINIMAP  flat icons only the orthographic minimap camera sees.
 */
export const LAYERS = { WORLD: 0, GLASS: 1, FX: 2, MINIMAP: 3 };

/** Put an object and all its children on one layer. */
export function setLayer(object, layer) {
  object.traverse((child) => child.layers.set(layer));
  return object;
}
