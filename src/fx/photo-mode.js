/**
 * Photo mode and 360-degree capture.
 *
 * Photo mode freezes the simulation and hands the camera to the player as a
 * free orbit around the runner (drag to orbit, wheel to zoom, FOV slider,
 * filters from the post pipeline).
 *
 * 360 capture is a small graphics pipeline of its own:
 *   1. A CubeCamera renders the scene into six 1024x1024 faces from the
 *      camera's position - a complete spherical view.
 *   2. A full-screen shader converts the cube map to an equirectangular image:
 *      each output pixel's (u, v) becomes a longitude and latitude, which
 *      becomes a direction, which samples the cube map.
 *   3. The shader tone-maps (ACES) and sRGB-encodes by hand, because Three
 *      only applies those when drawing to the screen, not into a target.
 *   4. The pixels are read back, flipped, drawn onto a 2D canvas and saved
 *      as a 2:1 PNG that any 360 viewer can open.
 */

import * as THREE from "../three.js";
import { LAYERS } from "../levels/causeway/layers.js";

const equirectFragment = /* glsl */ `
uniform samplerCube tCube;
uniform float uExposure;
varying vec2 vUv;

vec3 aces(vec3 x) {
  // Narkowicz's fitted ACES filmic curve.
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  float lon = (vUv.x - 0.5) * 6.28318530718;
  float lat = (vUv.y - 0.5) * 3.14159265359;
  vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
  vec3 c = texture(tCube, dir).rgb * uExposure;
  gl_FragColor = vec4(toSRGB(aces(c)), 1.0);
}
`;

export class PhotoMode {
  constructor({ renderer, root }) {
    this.renderer = renderer;
    this.root = root;
    this.active = false;
    this.yaw = 0.6;
    this.pitch = 0.25;
    this.radius = 6;
    this.fov = 60;
    this.target = new THREE.Vector3();
    this._drag = null;
    this._saved = null;

    root.addEventListener("pointerdown", (e) => {
      if (!this.active || e.target.closest("button, input, label")) return;
      this._drag = { x: e.clientX, y: e.clientY };
    });
    addEventListener("pointerup", () => { this._drag = null; });
    addEventListener("pointermove", (e) => {
      if (!this.active || !this._drag) return;
      this.yaw -= (e.clientX - this._drag.x) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this._drag.y) * 0.004, -1.2, 1.35);
      this._drag = { x: e.clientX, y: e.clientY };
    });
    addEventListener("wheel", (e) => {
      if (!this.active) return;
      this.radius = THREE.MathUtils.clamp(this.radius * (1 + Math.sign(e.deltaY) * 0.1), 1.6, 40);
    }, { passive: true });
  }

  enter(camera, target) {
    this.active = true;
    this.target.copy(target);
    this._saved = { fov: camera.fov, position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    this.fov = camera.fov;
    this.root.hidden = false;
  }

  exit(camera) {
    this.active = false;
    this.root.hidden = true;
    if (this._saved) {
      camera.fov = this._saved.fov;
      camera.position.copy(this._saved.position);
      camera.quaternion.copy(this._saved.quaternion);
      camera.updateProjectionMatrix();
    }
  }

  update(camera) {
    const c = Math.cos(this.pitch);
    camera.position.set(
      this.target.x + Math.sin(this.yaw) * c * this.radius,
      this.target.y + Math.sin(this.pitch) * this.radius,
      this.target.z + Math.cos(this.yaw) * c * this.radius,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    if (camera.fov !== this.fov) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }

  /** Save what is on the canvas right now. Call straight after a render. */
  capturePhoto(canvas) {
    const url = canvas.toDataURL("image/png");
    this._download(url, `fracture-run-photo-${Date.now()}.png`);
    return url;
  }

  /**
   * Render and save a 360-degree equirectangular panorama.
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position  where the viewer stands
   * @param {object|null} glassShared shared glass uniforms (refraction is
   *        screen-space, so it is switched to the probe-only path here)
   */
  capture360(scene, position, glassShared = null, { faceSize = 1024, width = 2048 } = {}) {
    const r = this.renderer;
    const cubeTarget = new THREE.WebGLCubeRenderTarget(faceSize, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(0.1, 1600, cubeTarget);
    for (const cam of cube.children) {
      cam.layers.set(LAYERS.WORLD);
      cam.layers.enable(LAYERS.GLASS);
      cam.layers.enable(LAYERS.FX);
    }
    cube.position.copy(position);
    cube.updateMatrixWorld(true);
    const hadScene = glassShared?.uHasScene.value ?? 0;
    if (glassShared) glassShared.uHasScene.value = 0;
    r.shadowMap.needsUpdate = true;
    cube.update(r, scene);
    if (glassShared) glassShared.uHasScene.value = hadScene;

    const height = width / 2;
    const target = new THREE.WebGLRenderTarget(width, height);
    const material = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: equirectFragment,
      uniforms: { tCube: { value: cubeTarget.texture }, uExposure: { value: r.toneMappingExposure } },
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    r.setRenderTarget(target);
    r.render(quadScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const pixels = new Uint8Array(width * height * 4);
    r.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    r.setRenderTarget(null);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    // WebGL rows run bottom-up; images run top-down.
    for (let y = 0; y < height; y += 1) {
      const src = (height - 1 - y) * width * 4;
      image.data.set(pixels.subarray(src, src + width * 4), y * width * 4);
    }
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL("image/png");
    this._download(url, `fracture-run-360-${Date.now()}.png`);

    cubeTarget.dispose();
    target.dispose();
    material.dispose();
    quad.geometry.dispose();
    return url;
  }

  _download(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
