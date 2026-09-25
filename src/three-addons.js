/**
 * Single place where Three.js add-ons (loaders, post-processing) come from,
 * alongside src/three.js for the core.
 *
 * The add-on files import the bare specifier "three", so any page that loads
 * this module needs an import map resolving "three" to the same URL
 * src/three.js uses - otherwise the browser would load two copies of Three.
 *
 *   <script type="importmap">
 *     { "imports": {
 *         "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
 *         "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
 *     } }
 *   </script>
 */
export { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
export { RenderPass } from "three/addons/postprocessing/RenderPass.js";
export { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/addons/postprocessing/OutputPass.js";
export * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
export { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
