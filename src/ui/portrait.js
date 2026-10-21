/**
 * The single-player card's portrait: Subject 07 as you've dressed them, in
 * their idle, in a little canvas of its own (its own renderer, so it draws
 * whatever the game's canvas is doing behind the menu).
 *
 *   const portrait = new Portrait(canvas, { assetBase });
 *   portrait.show({ character, skin, hair, outfit, headwear, launcherSkin });
 *
 * It only draws while the canvas is on screen.
 */

import * as THREE from "../three.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";
import { loadMeltdownAssets } from "../levels/meltdown/assets.js";
import { buildLauncher, mountLauncher, setLauncherSkin } from "../figure/launcher-model.js";

export class Portrait {
  constructor(canvas, { assetBase }) {
    this.canvas = canvas;
    this.assetBase = assetBase;
    this.look = null;
    this.avatar = null;
    this.rig = null;
    this._loop = this._loop.bind(this);
    this._last = 0;
  }

  _init() {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    } catch (error) {
      console.warn("[portrait] no WebGL for the portrait", error);
      return false;
    }
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 30);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x24160f, 1.1));
    const key = new THREE.DirectionalLight(0xfff0e0, 2.4);
    key.position.set(1.6, 3, 3);
    const rimA = new THREE.DirectionalLight(0x5ef0ff, 2.2);
    rimA.position.set(-2.5, 2, -2);
    const rimB = new THREE.DirectionalLight(0xff8a42, 1.6);
    rimB.position.set(2.5, 1.5, -2);
    scene.add(key, rimA, rimB);
    // A ring of light at the feet, as in the studio.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 48), new THREE.MeshBasicMaterial({ color: 0x5ef0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    scene.add(this.ring);
    this.time = 0;
    requestAnimationFrame(this._loop);
    return true;
  }

  /** Dress the figure (and swap the model if the character changed). */
  async show(look) {
    this.look = { ...look };
    if (!this._init()) return;
    const assets = await loadMeltdownAssets(this.assetBase, { names: [look.character, "launcher"] });
    if (this.look.character !== look.character) return; // changed again while loading
    const template = assets.get(look.character)?.template;
    if (!this.avatar || this.avatar.character !== look.character) {
      if (this.avatar) this.scene.remove(this.avatar.root);
      const a = new PlayerAvatar();
      a.character = look.character;
      a.hold = 0;
      a.setSkinTone(look.skin);
      a.setHairColour(look.hair ?? "natural");
      a.setOutfit(look.outfit);
      a.setHeadwear(look.headwear);
      if (template) a.setModel(template);
      // Three-quarters on, the launcher's side to us.
      a.root.rotation.y = Math.PI - 0.5;
      a.shadow.visible = false;
      this.scene.add(a.root);
      this.avatar = a;
      this.rig = buildLauncher(assets.get("launcher"), look.launcherSkin);
      this.rigSkin = look.launcherSkin;
      mountLauncher(a, this.rig);
      this._frame();
    } else {
      this.avatar.setSkinTone(look.skin);
      this.avatar.setHairColour(look.hair ?? "natural");
      this.avatar.setOutfit(look.outfit);
      this.avatar.setHeadwear(look.headwear);
    }
    if (this.rig && this.rigSkin !== look.launcherSkin) { setLauncherSkin(this.rig, look.launcherSkin); this.rigSkin = look.launcherSkin; }
  }

  /** The whole figure, head to toe, in the canvas. */
  _frame() {
    const h = this.avatar?.bodyInfo?.height ?? 1.75;
    // (The figure right of centre: the launcher reaches out to the left.)
    this.camera.position.set(-0.24, h * 0.56, 5.6);
    this.camera.lookAt(-0.24, h * 0.5, 0);
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    // Only while it can be seen.
    if (!this.avatar || !this.canvas.offsetParent || document.hidden) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.time += dt;
    this.avatar.update(dt, { speed: 0 });
    this.ring.material.opacity = 0.65 + Math.sin(this.time * 2) * 0.15;
    this.renderer.render(this.scene, this.camera);
  }
}
