/**
 * The rescue helicopter for Phase B (helicopter.glb, a Hind - see
 * docs/credits.md).
 *
 * The source model is a gunship: 107 separate meshes including a nose cannon,
 * missile rails and rocket pods. As loaded here it is a rescue ship:
 *
 *  - the weapons are left out entirely, and the red stars painted on its
 *    texture are painted out (paintOutStars) - no air force markings;
 *  - the main and tail rotors are pulled out into their own pivots, centred
 *    on their shafts, so they can spin;
 *  - everything else is merged into one mesh per material (the model uses
 *    one texture set, so the whole airframe is a single draw call);
 *  - it is scaled from centimetres to metres, nose toward -Z;
 *  - a searchlight, anchors for the door and the skid, and a rope ladder
 *    hanging from the side door (what the player climbs, or jumps for) are
 *    added.
 */

import * as THREE from "../../three.js";
import { BufferGeometryUtils } from "../../three-addons.js";

const WEAPONS = /cannon|missile|rocket|flare|misslestarter|wingpylons/i;

function mergeMeshes(meshes, inverse) {
  const groups = new Map();
  for (const mesh of meshes) {
    const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!groups.has(mesh.material)) groups.set(mesh.material, []);
    groups.get(mesh.material).push(g.index ? g.toNonIndexed() : g);
  }
  const out = new THREE.Group();
  for (const [material, list] of groups) {
    const merged = BufferGeometryUtils.mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (merged) out.add(new THREE.Mesh(merged, material));
  }
  return out;
}

/**
 * The texture's red stars (and their white rims), painted over with the
 * camouflage round them: every strongly red pixel, grown a few pixels to
 * take the rim, is refilled from the nearest unmarked pixels.
 */
function paintOutStars(map) {
  const image = map?.image;
  if (!image?.width || typeof document === "undefined") return map;
  const w = image.width;
  const h = image.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  const pixels = g.getImageData(0, 0, w, h);
  const d = pixels.data;
  const red = new Uint8Array(w * h);
  let found = 0;
  for (let i = 0; i < w * h; i += 1) {
    const r = d[i * 4];
    const gr = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    if (r > 110 && r > gr * 1.7 && r > b * 1.7) { red[i] = 1; found += 1; }
  }
  if (!found) return map;
  // Grow the marks to take in the white rims.
  const GROW = Math.max(3, Math.round(w / 256));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!red[y * w + x]) continue;
      for (let dy = -GROW; dy <= GROW; dy += 1) {
        for (let dx = -GROW; dx <= GROW; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) mask[yy * w + xx] = 1;
        }
      }
    }
  }
  // Refill each marked pixel from the unmarked ones round it.
  const R = GROW * 3;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let dy = -R; dy <= R; dy += 2) {
        for (let dx = -R; dx <= R; dx += 2) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (mask[j]) continue;
          sr += d[j * 4];
          sg += d[j * 4 + 1];
          sb += d[j * 4 + 2];
          n += 1;
        }
      }
      if (n) {
        d[i * 4] = sr / n;
        d[i * 4 + 1] = sg / n;
        d[i * 4 + 2] = sb / n;
      }
    }
  }
  g.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  for (const key of ["flipY", "colorSpace", "wrapS", "wrapT", "channel", "anisotropy"]) texture[key] = map[key];
  return texture;
}

/** Build the helicopter template from the loaded glTF scene. */
export function buildHelicopterTemplate(scene) {
  scene.updateMatrixWorld(true);
  // No markings: the stars come off its paint (one texture, shared).
  const repainted = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || !o.material?.map) return;
    if (!repainted.has(o.material.map)) repainted.set(o.material.map, paintOutStars(o.material.map));
    o.material.map = repainted.get(o.material.map);
  });
  const body = [];
  const main = [];
  const tail = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name || o.parent?.name || "";
    if (WEAPONS.test(name)) return;
    if (/^tailrotor/i.test(name)) tail.push(o);
    else if (/^rotor/i.test(name)) main.push(o);
    else body.push(o);
  });

  const identity = new THREE.Matrix4();
  const airframe = mergeMeshes(body, identity);
  const mainRotor = mergeMeshes(main, identity);
  const tailRotor = mergeMeshes(tail, identity);

  // Pivots: the main rotor spins about the vertical through its hub; the
  // tail rotor about its thinnest axis (the disc's normal).
  const recentre = (group) => {
    const box = new THREE.Box3().setFromObject(group);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    for (const m of group.children) m.geometry.translate(-centre.x, -centre.y, -centre.z);
    const pivot = new THREE.Group();
    pivot.position.copy(centre);
    pivot.add(group);
    const axis = size.x < size.y && size.x < size.z ? "x" : size.y < size.z ? "y" : "z";
    return { pivot, axis };
  };
  const mainPivot = recentre(mainRotor);
  const tailPivot = recentre(tailRotor);

  const model = new THREE.Group();
  model.add(airframe, mainPivot.pivot, tailPivot.pivot);

  // Centimetres to metres, then nose to -Z. The airframe's longest
  // horizontal side is its length; the nose end is the one without the
  // tail rotor.
  model.scale.setScalar(0.01);
  model.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(airframe);
  const size = bodyBox.getSize(new THREE.Vector3());
  const lengthAxis = size.x > size.z ? "x" : "z";
  const tailWorld = tailPivot.pivot.getWorldPosition(new THREE.Vector3());
  const centre = bodyBox.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  holder.add(model);
  // Rotate so the tail points +Z (nose -Z).
  const tailDir = lengthAxis === "x" ? Math.sign(tailWorld.x - centre.x) : Math.sign(tailWorld.z - centre.z);
  if (lengthAxis === "x") holder.rotation.y = tailDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  else holder.rotation.y = tailDir > 0 ? 0 : Math.PI;
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box.min.y, -c.z);

  const root = new THREE.Group();
  root.name = "Helicopter";
  root.add(holder);
  root.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(root);

  root.userData.helicopter = {
    mainRotor: mainPivot.pivot,
    mainAxis: mainPivot.axis,
    tailRotor: tailPivot.pivot,
    tailAxis: tailPivot.axis,
    size: finalBox.getSize(new THREE.Vector3()),
  };
  for (const m of [...airframe.children, ...mainRotor.children, ...tailRotor.children]) {
    if (m.material?.isMeshStandardMaterial) m.material.envMapIntensity = 0.5;
  }
  return root;
}

/**
 * A flying instance: clone of the template plus its moving parts, a
 * searchlight, and anchors. Call `update(dt)` every frame.
 */
export class Helicopter {
  constructor(template) {
    this.root = template.clone(true);
    this.root.name = "RescueHelicopter";
    const info = template.userData.helicopter;
    // clone(true) keeps the hierarchy, so find the rotor pivots by path.
    const find = (target) => {
      const path = [];
      for (let o = target; o && o !== template; o = o.parent) path.unshift(o.parent.children.indexOf(o));
      let node = this.root;
      for (const i of path) node = node.children[i];
      return node;
    };
    this.mainRotor = find(info.mainRotor);
    this.tailRotor = find(info.tailRotor);
    this.mainAxis = info.mainAxis;
    this.tailAxis = info.tailAxis;
    this.size = info.size.clone();
    this.spin = 0;

    this.searchlight = new THREE.SpotLight(0xf2f6ff, 0, 60, 0.22, 0.45, 1.1);
    this.searchlight.position.set(0, 0.6, -this.size.z * 0.38);
    this.root.add(this.searchlight, this.searchlight.target);
    this.searchlight.target.position.set(0, -10, -this.size.z * 0.6);

    this.root.rotation.order = "YXZ"; // yaw, then pitch, then bank

    // The rope ladder, hanging from the door side. Two ropes and instanced
    // rungs; it hangs straight down from a pivot and swings.
    this.ladderLength = 7.2;
    this.ladder = new THREE.Group();
    this.ladder.name = "RopeLadder";
    this.ladder.position.set(1.25, 0.9, -1.2);
    const rope = new THREE.MeshStandardMaterial({ color: 0x6e5a3e, roughness: 0.95 });
    const rung = new THREE.MeshStandardMaterial({ color: 0x9aa0a2, metalness: 0.7, roughness: 0.4 });
    this.ladderMaterials = [rope, rung];
    this.ladderGeometry = new THREE.BoxGeometry(1, 1, 1);
    for (const z of [-0.24, 0.24]) {
      const r = new THREE.Mesh(this.ladderGeometry, rope);
      r.scale.set(0.045, this.ladderLength, 0.045);
      r.position.set(0, -this.ladderLength / 2, z);
      this.ladder.add(r);
    }
    const rungs = Math.floor(this.ladderLength / 0.38);
    const steps = new THREE.InstancedMesh(this.ladderGeometry, rung, rungs);
    const m = new THREE.Matrix4();
    for (let i = 0; i < rungs; i += 1) {
      m.compose(new THREE.Vector3(0, -0.3 - i * 0.38, 0), new THREE.Quaternion(), new THREE.Vector3(0.05, 0.05, 0.52));
      steps.setMatrixAt(i, m);
    }
    this.ladder.add(steps);
    this.root.add(this.ladder);
    this._sway = new THREE.Vector2();
    this._swayV = new THREE.Vector2();
    this._lastPos = null;

    this.door = new THREE.Object3D();
    this.door.position.set(this.size.x * 0.22, 1.2, -this.size.z * 0.12);
    this.skid = new THREE.Object3D();
    this.skid.position.set(this.size.x * 0.22, 0.2, -this.size.z * 0.05);
    this.root.add(this.door, this.skid);
  }

  /**
   * Point the nose along `dir` (world), with a nose-down pitch for speed and
   * a bank into turns. Set explicitly as yaw/pitch/bank - an earlier
   * lookAt-then-rotateY version decomposed to a 180-degree roll whenever the
   * bank was written afterwards, and the helicopter flew in upside down.
   */
  orient(dir, { pitch = 0, bank = 0 } = {}) {
    const yaw = Math.atan2(-dir.x, -dir.z);
    this.root.rotation.set(pitch, yaw, bank);
  }

  /** A point on the ladder, `fromBottom` metres up from its lowest rung. */
  ladderPoint(fromBottom, target = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.ladder.localToWorld(target.set(0, -this.ladderLength + 0.2 + fromBottom, 0));
  }

  update(dt, { rotor = 1, light = 1 } = {}) {
    // The ladder trails behind the helicopter's motion and settles back:
    // a damped pendulum driven by the airframe's acceleration.
    const pos = this.root.getWorldPosition(new THREE.Vector3());
    if (this._lastPos && dt > 0) {
      const vx = (pos.x - this._lastPos.x) / dt;
      const vz = (pos.z - this._lastPos.z) / dt;
      this._swayV.x += (-this._sway.x * 9 - this._swayV.x * 1.4) * dt - (vx - (this._vx ?? vx)) * 0.02;
      this._swayV.y += (-this._sway.y * 9 - this._swayV.y * 1.4) * dt - (vz - (this._vz ?? vz)) * 0.02;
      this._vx = vx;
      this._vz = vz;
    }
    this._lastPos = pos;
    // Rotor wash keeps it moving a little even in a hover.
    this._swayV.x += Math.sin(this.spin * 0.07) * 0.02;
    this._sway.x += this._swayV.x * dt;
    this._sway.y += this._swayV.y * dt;
    this._sway.clampScalar(-0.35, 0.35);
    this.ladder.rotation.set(this._sway.y, 0, -this._sway.x);

    this.spin += dt * rotor * 28;
    this.mainRotor.rotation[this.mainAxis] = this.spin;
    this.tailRotor.rotation[this.tailAxis] = this.spin * 2.3;
    this.searchlight.intensity = 400 * light;
  }
}
