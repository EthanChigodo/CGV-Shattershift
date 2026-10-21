/**
 * The studio: where a figure is dressed - single player's Customise, the
 * Race's line-up. A dark stage under a key light and two coloured rims, a
 * gradient backdrop, a ring of light under each figure in its colour; the
 * figures with their headwear, skin and outfit, and a launcher on the
 * shoulder for those who carry one.
 *
 *   const studio = new Studio(renderer, assets);     // assets: the two player models, the launcher
 *   studio.setFigures([{ id, character, skin, outfit, headwear, launcher, launcherSkin, colour }]);
 *   studio.frame("body" | "launcher", { offsetX });   // what the camera shows
 *   // every frame: studio.update(dt); studio.render();
 */

import * as THREE from "../../three.js";
import { PlayerAvatar } from "../../levels/meltdown/player.js";
import { buildLauncher, mountLauncher, unmountLauncher, setLauncherSkin } from "../../figure/launcher-model.js";

const BACKDROP_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;
// A dark room: deep navy overhead, a warm haze at the horizon, a soft
// pool of light behind the figures.
const BACKDROP_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform float uTime;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(uHorizon, uTop, smoothstep(-0.05, 0.6, h));
    float behind = pow(max(0.0, dot(vDir, normalize(vec3(0.0, 0.15, -1.0)))), 6.0);
    col += uGlow * behind * (0.85 + 0.15 * sin(uTime * 0.6));
    col = mix(col, uHorizon * 0.6, smoothstep(0.02, -0.3, h));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function floorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, "#232a33");
  grad.addColorStop(0.6, "#151a20");
  grad.addColorStop(1, "#0b0e12");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // Fine concentric lines and spokes: a stage, not a floor.
  g.strokeStyle = "rgba(126,244,241,0.07)";
  g.lineWidth = 1.5;
  for (let r = 40; r < 256; r += 36) { g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * 40, 256 + Math.sin(a) * 40);
    g.lineTo(256 + Math.cos(a) * 250, 256 + Math.sin(a) * 250);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Studio {
  constructor(renderer, assets) {
    this.renderer = renderer;
    this.assets = assets;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0f14, 14, 34);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camPos = new THREE.Vector3(0, 1.5, 7);
    this.camLook = new THREE.Vector3(0, 1.05, 0);
    this.time = { value: 0 };
    const backdrop = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color(0x070a10) }, uHorizon: { value: new THREE.Color(0x2a1a14) }, uGlow: { value: new THREE.Color(0x24414a) }, uTime: this.time },
      vertexShader: BACKDROP_VERTEX, fragmentShader: BACKDROP_FRAGMENT, side: THREE.BackSide, depthWrite: false,
    }));
    backdrop.renderOrder = -1;
    scene.add(backdrop);
    this.backdrop = backdrop;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x1a120e, 0.7));
    const key = new THREE.SpotLight(0xfff1e0, 60, 20, 0.6, 0.55, 1.4);
    key.position.set(2.5, 6.5, 5);
    key.target.position.set(0, 1, 0);
    scene.add(key, key.target);
    const rimA = new THREE.SpotLight(0x3aa0ff, 40, 16, 0.7, 0.6, 1.5);
    rimA.position.set(-4, 3.5, -3);
    rimA.target.position.set(0, 1.2, 0);
    const rimB = new THREE.SpotLight(0xff7a3a, 32, 16, 0.7, 0.6, 1.5);
    rimB.position.set(4, 3, -3);
    rimB.target.position.set(0, 1.2, 0);
    scene.add(rimA, rimA.target, rimB, rimB.target);
    this.figures = new Map();
    this.view = "body";
    this.offsetX = 0;
    this.spin = false;
  }

  /**
   * The figures to show, left to right. Each: { id, character, skin, outfit,
   * headwear, launcher (carried?), launcherSkin, colour (hex, the ring) }.
   */
  setFigures(list) {
    const keep = new Set(list.map((f) => f.id));
    for (const [id, f] of this.figures) if (!keep.has(id)) this._remove(f);
    const n = list.length;
    list.forEach((spec, i) => {
      let f = this.figures.get(spec.id);
      if (!f || f.character !== spec.character) {
        if (f) this._remove(f);
        f = this._make(spec);
      }
      f.x = (i - (n - 1) / 2) * 1.6;
      f.avatar.root.position.set(f.x, 0, 0);
      f.ring.position.set(f.x, 0.02, 0);
      f.ring.material.color.set(spec.colour ?? "#7ef4f1");
      if (f.skin !== spec.skin) { f.avatar.setSkinTone(spec.skin); f.skin = spec.skin; }
      if (f.outfit !== spec.outfit) { f.avatar.setOutfit(spec.outfit); f.outfit = spec.outfit; }
      if (f.headwear !== spec.headwear) { f.avatar.setHeadwear(spec.headwear); f.headwear = spec.headwear; }
      if (spec.launcher && !f.rig) {
        f.rig = buildLauncher(this.assets.get("launcher"), spec.launcherSkin);
        f.launcherSkin = spec.launcherSkin;
        mountLauncher(f.avatar, f.rig);
      } else if (!spec.launcher && f.rig) {
        unmountLauncher(f.avatar, f.rig);
        f.rig = null;
      }
      if (f.rig && f.launcherSkin !== spec.launcherSkin) { setLauncherSkin(f.rig, spec.launcherSkin); f.launcherSkin = spec.launcherSkin; }
    });
    this.count = n;
  }

  _make(spec) {
    const a = new PlayerAvatar();
    a.hold = 0;
    a.setSkinTone(spec.skin);
    a.setOutfit(spec.outfit);
    a.setHeadwear(spec.headwear);
    const template = this.assets.get(spec.character)?.template;
    if (template) a.setModel(template);
    a.root.rotation.y = Math.PI;
    this.scene.add(a.root);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 48), new THREE.MeshBasicMaterial({ color: spec.colour ?? "#7ef4f1", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    const f = { id: spec.id, character: spec.character, avatar: a, ring, rig: null, skin: spec.skin, outfit: spec.outfit, headwear: spec.headwear, yaw: Math.PI };
    this.figures.set(spec.id, f);
    return f;
  }

  _remove(f) {
    this.scene.remove(f.avatar.root, f.ring);
    f.ring.geometry.dispose();
    f.ring.material.dispose();
    this.figures.delete(f.id);
  }

  /** What the camera shows: the whole figure, or the launcher on the shoulder. `offsetX`: the figures to one side (a panel on the other). */
  frame(view = "body", { offsetX = 0, spin = false } = {}) {
    this.view = view;
    this.offsetX = offsetX;
    this.spin = spin;
  }

  /** A little turn of a lone figure (the stick, or a drag). */
  turn(amount) {
    for (const f of this.figures.values()) f.yaw += amount;
  }

  update(dt) {
    this.time.value += dt;
    const n = Math.max(1, this.count ?? 1);
    // Body: the whole line-up; launcher: in close on the shoulder.
    // (offsetX moves the camera over, so the figures stand to the other side.)
    if (this.view === "launcher") {
      this.camPos.set(this.offsetX * 0.6, 1.7, 3.6 + (n - 1) * 1.2);
      this.camLook.set(this.offsetX * 0.6, 1.3, 0);
    } else {
      this.camPos.set(this.offsetX, 1.45, 5.4 + (n - 1) * 1.3);
      this.camLook.set(this.offsetX, 1.0, 0);
    }
    const k = Math.min(1, dt * 5);
    this.camera.position.lerp(this.camPos, k);
    this._look = (this._look ?? this.camLook.clone()).lerp(this.camLook, k);
    this.camera.lookAt(this._look);
    for (const f of this.figures.values()) {
      // Facing you; three-quarters on for the launcher, so its side shows, not its muzzle.
      const face = this.view === "launcher" ? Math.PI - 1.15 : Math.PI;
      if (this.spin && n === 1) f.yaw += dt * 0.35;
      else f.yaw += (face - f.yaw) * Math.min(1, dt * 2.5);
      f.avatar.root.rotation.y = f.yaw;
      f.avatar.update(dt, { speed: 0 });
      f.ring.material.opacity = 0.75 + Math.sin(this.time.value * 2 + f.x) * 0.15;
    }
  }

  render() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();
    r.render(this.scene, this.camera);
  }

  /** Where a figure's feet are on the screen (for its panel). */
  screenOf(id, height = 0, out = { x: 0, y: 0 }) {
    const f = this.figures.get(id);
    if (!f) return out;
    const v = new THREE.Vector3(f.x, height, 0).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * innerHeight;
    return out;
  }

  dispose() {
    for (const f of [...this.figures.values()]) this._remove(f);
  }
}
