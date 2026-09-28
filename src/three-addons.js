/**
 * Single place where Three.js add-ons (loaders, post-processing) come from,
 * alongside src/three.js for the core.
 *
 * The add-on files import the bare specifier "three", so any page that loads
 * this module needs an import map resolving "three" to the same file
 * src/three.js uses - otherwise the browser would load two copies of Three.
 * Paths are relative to the page (this is index.html's):
 *
 *   <script type="importmap">
 *     { "imports": {
 *         "three": "./lib/three/build/three.module.js",
 *         "three/addons/": "./lib/three/examples/jsm/"
 *     } }
 *   </script>
 *
 * Only the add-ons used here (and the files they import) are in lib/three/.
 * To use another one, copy it from the three@0.160.0 npm package into
 * lib/three/examples/jsm/ at the same path.
 */
export { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
export { RenderPass } from "three/addons/postprocessing/RenderPass.js";
export { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/addons/postprocessing/OutputPass.js";
export * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
export { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
export * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
export { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
