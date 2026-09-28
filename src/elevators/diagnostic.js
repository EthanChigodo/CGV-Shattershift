/**
 * The diagnostic view: the lift seen straight down through an orthographic
 * camera, drawn as a cyan hologram - the brief's "top-down orthographic
 * diagnostic view".
 *
 * Two passes with one OrthographicCamera:
 *   1. everything on the SCAN layer (cabin, shaft, tower, debris, the
 *      character) with one override material: a hologram shader - edges
 *      bright where surfaces turn away from the camera, height bands,
 *      scanlines - additive, so structure shows through structure;
 *   2. the brake clamps on the MARK layer in their own colours on top, so
 *      what matters (red: slipping, cyan: locked) reads at a glance.
 *
 * It renders full screen as a camera shot, or into a corner of the screen
 * as a picture-in-picture monitor (a viewport + scissor on the same canvas).
 */

import * as THREE from "../three.js";

export const SCAN = 5;
export const MARK = 6;

function holoMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFloor: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 local = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 world = modelMatrix * local;
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFloor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        // Looking straight down: walls (normals sideways) read as bright
        // outlines, floors and roofs (normals up) as faint fills.
        float edge = 1.0 - abs(normalize(vNormal).y);
        float band = 0.5 + 0.5 * sin((vWorld.y - uFloor) * 6.0 - uTime * 3.0);
        float scan = 0.75 + 0.25 * sin(gl_FragCoord.y * 1.4 + uTime * 20.0);
        vec3 col = vec3(0.2, 0.95, 1.0) * (0.05 + edge * 0.35 + band * 0.06) * scan;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export class DiagnosticView {
  /** @param {number} [halfSize] half the width of ground the view covers, in metres */
  constructor(halfSize = 4.6) {
    this.half = halfSize;
    this.camera = new THREE.OrthographicCamera(-halfSize, halfSize, halfSize, -halfSize, 0.1, 400);
    // Looking straight down with the cabin's front (-Z) at the top.
    this.camera.up.set(0, 0, -1);
    this.camera.layers.set(SCAN);
    this.material = holoMaterial();
    this.background = new THREE.Color(0x02080b);
  }

  /** Put `object` and everything under it on the scan layer (as well as its own). */
  scan(object) {
    object.traverse((o) => o.layers.enable(SCAN));
  }

  /** The clamps: drawn in their own colours on top. */
  mark(object) {
    object.traverse((o) => o.layers.enable(MARK));
  }

  /** Centre over the cabin (world position of its floor). */
  follow(x, y, z, time) {
    this.camera.position.set(x, y + 60, z);
    this.camera.lookAt(x, y, z);
    this.camera.updateMatrixWorld();
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uFloor.value = y;
  }

  /** Match the frustum to a viewport's aspect. */
  fit(aspect) {
    const h = this.half;
    this.camera.left = -h * aspect;
    this.camera.right = h * aspect;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Draw the view. With `rect` ({x, y, w, h} in CSS pixels, from the bottom
   * left) it goes into that corner of the canvas; without, full screen.
   */
  render(renderer, scene, rect = null) {
    const size = renderer.getSize(new THREE.Vector2());
    const background = scene.background;
    const fog = scene.fog;
    const autoClear = renderer.autoClear;
    scene.background = this.background;
    scene.fog = null;
    if (rect) {
      renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissorTest(true);
      this.fit(rect.w / rect.h);
    } else {
      this.fit(size.x / Math.max(1, size.y));
    }
    renderer.autoClear = true;
    scene.overrideMaterial = this.material;
    this.camera.layers.set(SCAN);
    renderer.render(scene, this.camera);
    scene.overrideMaterial = null;
    scene.background = null;
    renderer.autoClear = false;
    renderer.clearDepth();
    this.camera.layers.set(MARK);
    renderer.render(scene, this.camera);
    // Restore.
    renderer.autoClear = autoClear;
    scene.background = background;
    scene.fog = fog;
    this.camera.layers.set(SCAN);
    if (rect) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
      renderer.setScissor(0, 0, size.x, size.y);
    }
  }

  dispose() {
    this.material.dispose();
  }
}
