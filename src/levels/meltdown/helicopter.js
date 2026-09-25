/**
 * The rescue helicopter for Phase B (helicopter.glb, a Hind - see
 * docs/credits.md).
 *
 * The source model is a gunship: 107 separate meshes including a nose cannon,
 * missile rails and rocket pods. As loaded here it is a rescue ship:
 *
 *  - the weapons are left out entirely;
 *  - the main and tail rotors are pulled out into their own pivots, centred
 *    on their shafts, so they can spin;
 *  - everything else is merged into one mesh per material (the model uses
 *    one texture set, so the whole airframe is a single draw call);
 *  - it is scaled from centimetres to metres, nose toward -Z;
 *  - a searchlight and anchors for the door and the skid (where the player
 *    boards, or grabs on) are added.
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

/** Build the helicopter template from the loaded glTF scene. */
export function buildHelicopterTemplate(scene) {
  scene.updateMatrixWorld(true);
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

    this.door = new THREE.Object3D();
    this.door.position.set(this.size.x * 0.22, 1.2, -this.size.z * 0.12);
    this.skid = new THREE.Object3D();
    this.skid.position.set(this.size.x * 0.22, 0.2, -this.size.z * 0.05);
    this.root.add(this.door, this.skid);
  }

  update(dt, { rotor = 1, light = 1 } = {}) {
    this.spin += dt * rotor * 28;
    this.mainRotor.rotation[this.mainAxis] = this.spin;
    this.tailRotor.rotation[this.tailAxis] = this.spin * 2.3;
    this.searchlight.intensity = 400 * light;
  }
}
