/**
 * Tactical minimap - a real orthographic camera, rendered picture-in-picture.
 *
 * An OrthographicCamera looks straight down from above the player. It only
 * has the MINIMAP layer enabled, so it never draws the level itself - just the
 * flat icon quads every Level 1 object carries (cyan = glass, red = solid,
 * orange = fire, blue = sprinkler, magenta = serum...). That makes the second
 * render almost free: a few dozen quads with no lighting.
 *
 * The render goes into a scissored viewport of the main canvas, sized to an
 * HTML frame so CSS owns the border and the lane guides. Forward is up; the
 * player sits near the bottom so most of the map shows what is coming.
 */

import * as THREE from "../three.js";
import { LAYERS } from "../levels/causeway/layers.js";

export class Minimap {
  constructor(renderer, frameElement) {
    this.renderer = renderer;
    this.frame = frameElement;
    this.enabled = true;
    this.width = 15;
    this.camera = new THREE.OrthographicCamera(-7.5, 7.5, 40, -10, 0.1, 60);
    this.camera.up.set(0, 0, -1);
    this.camera.layers.set(LAYERS.MINIMAP);

    const arrow = new THREE.Shape();
    arrow.moveTo(0, 0.9); arrow.lineTo(0.6, -0.6); arrow.lineTo(0, -0.25); arrow.lineTo(-0.6, -0.6); arrow.closePath();
    this.player = new THREE.Mesh(
      new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }),
    );
    this.player.rotation.y = 0;
    this.player.layers.set(LAYERS.MINIMAP);
    this.player.name = "MinimapPlayer";

    this.chase = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff2a1f, fog: false, toneMapped: false, transparent: true, opacity: 0.8 }),
    );
    this.chase.layers.set(LAYERS.MINIMAP);
    this.chase.visible = false;
    this._rect = null;
  }

  attach(scene) {
    scene.add(this.player, this.chase);
  }

  measure() {
    if (!this.frame) return;
    const r = this.frame.getBoundingClientRect();
    this._rect = r.width > 4 ? { x: r.left, y: innerHeight - r.bottom, w: r.width, h: r.height } : null;
  }

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} player world position
   * @param {number|null} chaseZ  world z of the collapse front, or null
   */
  render(scene, player, chaseZ = null) {
    if (!this.enabled) return;
    // Re-measure every frame: the frame moves with the layout (HUD shown,
    // window resized, mobile breakpoint), and getBoundingClientRect is cheap.
    this.measure();
    if (!this._rect) return;
    const { x, y, w, h } = this._rect;
    const height = this.width * (h / w);
    this.camera.left = -this.width / 2;
    this.camera.right = this.width / 2;
    this.camera.top = height * 0.8;
    this.camera.bottom = -height * 0.2;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 30, player.z);
    this.camera.lookAt(0, 0, player.z);

    this.player.position.set(player.x, 7, player.z);
    this.chase.visible = chaseZ !== null;
    if (chaseZ !== null) this.chase.position.set(0, 6.5, chaseZ + 1.5);

    const r = this.renderer;
    const background = scene.background;
    const autoClear = r.autoClear;
    scene.background = null;
    r.setRenderTarget(null);
    r.setScissorTest(true);
    r.setScissor(x, y, w, h);
    r.setViewport(x, y, w, h);
    r.setClearColor(0x061016, 1);
    r.autoClear = false;
    r.clear(true, true, false);
    r.render(scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, innerWidth, innerHeight);
    r.autoClear = autoClear;
    scene.background = background;
  }

  dispose() {
    this.player.geometry.dispose();
    this.player.material.dispose();
    this.chase.geometry.dispose();
    this.chase.material.dispose();
    this.player.parent?.remove(this.player);
    this.chase.parent?.remove(this.chase);
  }
}
