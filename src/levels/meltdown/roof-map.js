/**
 * The roof's tactical map, top right: the whole roof from straight above,
 * north up, through a real OrthographicCamera, rendered picture-in-picture
 * into a scissored corner of the canvas after the frame.
 *
 * Like the Skyline's old minimap it never draws the roof itself: every icon
 * is a flat unlit quad on its own layer (MAP_LAYER), which the game's camera
 * does not see and the map's camera sees alone - so the second render is a
 * few dozen quads. The icons:
 *
 *   the deck, the parapets (north and south) and the open ledges (east and
 *   west, red and broken); cover, the hatches (a pulsing yellow/black
 *   striped square with a warning triangle - holes you can fall down, as
 *   on the roof itself: hatch-guard.js), the helipad, the lift hut;
 *   you, an arrow pointing where you aim; patients (red; a brute bigger),
 *   scientists (amber); the supply drop (green, pulsing); the helicopter,
 *   and - while it waits off the ledge - its ladder, a pulsing cyan ring.
 *
 *   const map = new RoofMinimap(roof, scene);
 *   map.update(time, hero, visible);   // each frame on the roof
 *   map.render(renderer);              // after the frame
 *   map.dispose();
 */

import * as THREE from "../../three.js";
import { EDGE, HATCHES } from "./roof.js";

export const MAP_LAYER = 9;
/** Half the width the map shows (the roof, the ledges and the helicopter's hold point). */
const VIEW = EDGE + 5;
const MAX_ENEMIES = 32;
/** A hatch's icon, metres across (bigger than the hatch, so it reads at 200 px). */
const HATCH_ICON = 3.4;

const HELIPAD = new THREE.Vector3(0, 0, -8);
const LIFT_HUT = new THREE.Vector3(0, 0, EDGE - 1.7);

/**
 * A hatch on the map: a yellow/black striped square (the rails and the
 * painted band) round the black hole, a warning triangle with "!" on it.
 */
function hatchIconTexture() {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#16140f";
  g.fillRect(0, 0, S, S);
  g.fillStyle = "#f2c21a";
  for (let x = -S; x < S * 2; x += 16) {
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + 8, 0); g.lineTo(x + 8 + S, S); g.lineTo(x + S, S);
    g.closePath();
    g.fill();
  }
  g.fillStyle = "#050708";
  g.fillRect(14, 14, S - 28, S - 28);
  g.fillStyle = "#f2c21a";
  g.beginPath();
  g.moveTo(S / 2, 18); g.lineTo(S - 19, S - 21); g.lineTo(19, S - 21);
  g.closePath();
  g.fill();
  g.fillStyle = "#16140f";
  g.fillRect(S / 2 - 1.5, 27, 3, 9);
  g.fillRect(S / 2 - 1.5, 38, 3, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RoofMinimap {
  constructor(roof, scene) {
    this.roof = roof;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "RoofMap";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    // (All in the transparent pass, so the translucent deck can go under the icons by renderOrder.)
    const mat = (color, opacity = 1) => own(new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false, transparent: true, opacity, depthWrite: false }));
    const plane = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const disc = own(new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2));
    const ring = own(new THREE.RingGeometry(0.38, 0.5, 28).rotateX(-Math.PI / 2));
    this.geo = { plane, disc, ring };
    const add = (geometry, material, x, z, sx, sz, y = 0, parent = this.group) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z);
      m.scale.set(sx, 1, sz);
      m.layers.set(MAP_LAYER);
      m.frustumCulled = false;
      parent.add(m);
      return m;
    };
    this._add = add;

    // The deck, and its edges. Translucent: the frame shows through the map
    // (render() keeps the picture under it), over a faint shade for the icons.
    add(plane, mat(0x05090c, 0.42), 0, 0, VIEW * 4, VIEW * 4, -0.2).renderOrder = -2;
    add(plane, mat(0x18242a, 0.62), 0, 0, EDGE * 2, EDGE * 2, 0).renderOrder = -1;
    const parapet = mat(0xc9d6da);
    for (const z of [-EDGE, EDGE]) add(plane, parapet, 0, z, EDGE * 2, 0.45, 0.1);
    const open = mat(0xff4a3d);
    for (const x of [-EDGE, EDGE]) {
      for (let z = -EDGE + 1; z < EDGE; z += 2.4) add(plane, open, x, z, 0.4, 1.3, 0.1);
    }
    // Cover, hatches, the helipad, the lift hut.
    const cover = mat(0x5d6b72);
    for (const box of roof.cover ?? []) {
      // (A hatch's rails are part of its icon, not cover to draw.)
      if (box.fence) continue;
      const sx = box.max.x - box.min.x;
      const sz = box.max.z - box.min.z;
      if (sx > 0 && sz > 0 && sx < 12 && sz < 12) add(plane, cover, (box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, sx, sz, 0.2);
    }
    // The hatches: hazard icons, pulsing with the amber strips round them.
    const hatchIcon = mat(0xffffff);
    hatchIcon.map = own(hatchIconTexture());
    hatchIcon.needsUpdate = true;
    this.hatchIcon = hatchIcon;
    this.hatches = HATCHES.map((h) => add(plane, hatchIcon, h.x, h.z, HATCH_ICON, HATCH_ICON, 0.3));
    add(ring, mat(0xf4f6f6), HELIPAD.x, HELIPAD.z, 7, 7, 0.25);
    add(plane, mat(0x7ef4f1, 0.8), LIFT_HUT.x, LIFT_HUT.z, 5, 2.8, 0.25);

    // You: an arrow.
    const arrow = new THREE.Shape();
    arrow.moveTo(0, 1.1); arrow.lineTo(0.75, -0.75); arrow.lineTo(0, -0.3); arrow.lineTo(-0.75, -0.75); arrow.closePath();
    const arrowGeo = own(new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2));
    this.player = add(arrowGeo, mat(0xffffff), 0, 0, 2.2, 2.2, 1.2);
    this.player.renderOrder = 10; // over everything else

    // Them, a pool of dots.
    this.patientMat = mat(0xff4a3d);
    this.scientistMat = mat(0xffb03c);
    this.enemies = Array.from({ length: MAX_ENEMIES }, () => {
      const dot = add(disc, this.patientMat, 0, 0, 1, 1, 1);
      dot.visible = false;
      return dot;
    });
    // The drop, the helicopter and its ladder.
    this.drop = add(plane, mat(0x6dff9a), 0, 0, 1.3, 1.3, 0.9);
    this.drop.rotation.y = Math.PI / 4;
    this.drop.visible = false;
    this.heli = add(disc, mat(0x7ef4f1), 0, 0, 2.2, 2.2, 0.8);
    this.heli.visible = false;
    this.ladder = add(ring, mat(0x7ef4f1), 0, 0, 3, 3, 0.85);
    this.ladder.visible = false;

    scene.add(this.group);
    this.camera = new THREE.OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, 0.1, 100);
    this.camera.position.set(0, 50, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.layers.set(MAP_LAYER);

    // The frame: CSS owns the border, the label and the key.
    this.frame = document.createElement("section");
    this.frame.className = "roof-map";
    this.frame.setAttribute("aria-label", "Roof map");
    this.frame.innerHTML = `<header>The roof <b>N</b></header><div class="roof-map-view"></div>
      <footer><span class="k-you">You</span><span class="k-patient">Patient</span><span class="k-sci">Scientist</span><span class="k-ledge">Open ledge</span><span class="k-hatch">Open hatch</span></footer>`;
    this.view = this.frame.querySelector(".roof-map-view");
    document.body.append(this.frame);
    if (!document.querySelector("style[data-roof-map]")) {
      const style = document.createElement("style");
      style.dataset.roofMap = "";
      style.textContent = STYLE;
      document.head.append(style);
    }
    this.visible = false;
    this._size = new THREE.Vector2();
  }

  /** Each frame on the roof: where you, they, the drop and the helicopter are. */
  update(time, hero, visible = true) {
    this.visible = visible;
    this.frame.classList.toggle("show", visible);
    if (!visible) return;
    const roof = this.roof;
    // The hatches pulse slowly (as their strips do on the roof), and swell a
    // little when you are near one.
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.7);
    this.hatchIcon.color.setScalar(0.72 + 0.28 * pulse);
    for (const [i, icon] of this.hatches.entries()) {
      const near = hero ? Math.max(0, 1 - Math.hypot(hero.position.x - HATCHES[i].x, hero.position.z - HATCHES[i].z) / 5) : 0;
      const s = HATCH_ICON * (1 + near * 0.3 * pulse);
      icon.scale.set(s, 1, s);
    }
    if (hero) {
      this.player.position.set(hero.position.x, 1.2, hero.position.z);
      const dx = hero.aim.x - hero.position.x;
      const dz = hero.aim.z - hero.position.z;
      if (dx * dx + dz * dz > 0.01) this.player.rotation.y = Math.atan2(-dx, -dz);
    }
    let i = 0;
    for (const e of roof.enemies) {
      if (i >= MAX_ENEMIES) break;
      if (e.removed || e.position.y < -2) continue;
      const dot = this.enemies[i++];
      dot.visible = true;
      dot.material = e.kind === "scientist" ? this.scientistMat : this.patientMat;
      const size = (e.brute ? 2.1 : 1.45) * (e.alive ? 1 : 0.6);
      dot.scale.set(size, 1, size);
      dot.position.set(e.position.x, 1, e.position.z);
    }
    for (; i < MAX_ENEMIES; i += 1) this.enemies[i].visible = false;

    const drop = roof.drop;
    this.drop.visible = !!drop && drop.crate?.visible !== false;
    if (this.drop.visible) {
      this.drop.position.set(drop.at.x, 0.9, drop.at.z);
      const s = 1.2 + 0.35 * Math.sin(time * 6);
      this.drop.scale.set(s, 1, s);
    }
    const heli = roof.heli?.root;
    this.heli.visible = !!heli?.visible && Math.abs(heli.position.x) < VIEW + 2 && Math.abs(heli.position.z) < VIEW + 2;
    if (this.heli.visible) this.heli.position.set(heli.position.x, 0.8, heli.position.z);
    const waiting = roof.state?.ending === "extraction";
    this.ladder.visible = waiting;
    if (waiting) {
      const at = roof.ladderPoint?.(0) ?? heli?.position;
      if (at) this.ladder.position.set(Math.min(at.x, VIEW - 1), 0.85, at.z);
      const s = 2.4 + 1.6 * ((time * 1.5) % 1);
      this.ladder.scale.set(s, 1, s);
    }
  }

  /** Into its corner of the canvas, after the frame. */
  render(renderer) {
    if (!this.visible) return;
    const r = this.view.getBoundingClientRect();
    if (r.width < 4) return;
    const size = renderer.getSize(this._size);
    const scale = size.x / window.innerWidth;
    const x = r.left * scale;
    const y = (window.innerHeight - r.bottom) * scale;
    const w = r.width * scale;
    const h = r.height * scale;
    const aspect = w / h;
    this.camera.left = -VIEW * aspect;
    this.camera.right = VIEW * aspect;
    this.camera.updateProjectionMatrix();
    const background = this.scene.background;
    const fog = this.scene.fog;
    const autoClear = renderer.autoClear;
    this.scene.background = null;
    this.scene.fog = null;
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    renderer.setClearColor(0x05090c, 1);
    renderer.autoClear = false;
    // Depth only: the picture under the map stays (the map is translucent).
    renderer.clear(false, true, false);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.autoClear = autoClear;
    this.scene.background = background;
    this.scene.fog = fog;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
    this.frame.remove();
  }
}

const STYLE = `
/* The NIGHTFALL look (src/ui/theme.css): a thin-outlined, translucent square
   on the picture, a quiet line over it, the key under it - no boxed header. */
.roof-map {
  position: fixed; right: 44px; top: 92px; z-index: 6; width: 196px;
  font: 500 11px/1.3 var(--font, system-ui, sans-serif); letter-spacing: .02em; color: var(--text-3, rgba(244, 240, 232, .48));
  text-shadow: var(--shadow-text, 0 1px 2px rgba(0, 0, 0, .55));
  opacity: 0; transition: opacity .5s ease; pointer-events: none;
}
.roof-map.show { opacity: 1; }
body.hud-hidden .roof-map, body.story-cutscene .roof-map, body:not(.mlt-active) .roof-map { opacity: 0; }
.roof-map header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; letter-spacing: .04em; }
.roof-map header b { font-weight: 500; letter-spacing: .1em; color: var(--text-2, rgba(244, 240, 232, .72)); }
/* (No background behind the view: the map is drawn, translucent, into the canvas under it.) */
.roof-map-view {
  width: 196px; height: 196px; box-sizing: border-box;
  border: 1px solid var(--line-2, rgba(244, 240, 232, .32));
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .18), 0 10px 40px rgba(0, 0, 0, .35);
}
.roof-map footer { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 9px; font-size: 10.5px; letter-spacing: .01em; }
.roof-map footer span::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; vertical-align: 1px; }
.roof-map .k-you::before { width: 0; height: 0; border-radius: 0; border: solid transparent; border-width: 0 3.5px 7px; border-bottom-color: var(--text, #f4f0e8); }
.roof-map .k-patient::before { background: var(--blood, #e5412d); }
.roof-map .k-sci::before { background: var(--warn, #ffc457); }
.roof-map .k-ledge::before { width: 9px; height: 1.5px; border-radius: 0; vertical-align: 3px; background: var(--blood, #e5412d); }
.roof-map .k-hatch::before { border-radius: 1px; box-shadow: inset 0 0 0 1px var(--warn, #ffc457); }
@media (max-width: 650px) { .roof-map { transform: scale(.72); transform-origin: top right; } }
`;
