/**
 * Police helicopters over the city at night (the Skyline, and the prologue):
 * each one circles, red and blue lights flashing, a white searchlight
 * sweeping the streets below - and now and then across the skybridge.
 *
 *   const police = new PoliceHelicopters({ count: 3 });
 *   scene.add(police.root);
 *   await police.load(assetBase);          // assets/meltdown/police_helicopter.glb
 *   // every frame (route = { worldZ(d), distance }):
 *   police.update(dt, time, { centreZ, ahead: -1, deckY: 0 });
 *
 * The model (a Harbin Z-9 / Dolphin) is a skinned mesh of ~33 parts; drawn
 * as-is that's ~33 draw calls a helicopter. It's baked here into one static
 * mesh per material, with the two rotors as their own spinning parts - so a
 * helicopter costs about a dozen draw calls. Everything that glows is
 * additive and unlit: no real lights, so nothing in the level recompiles.
 */

import * as THREE from "../three.js";
import { GLTFLoader, BufferGeometryUtils } from "../three-addons.js";

/** Parts that spin with the main rotor / the tail rotor (by material). */
const MAIN_ROTOR = new Set(["Z9_mainpaddle", "Z9_rotorparts"]);
const TAIL_ROTOR = new Set(["Z9_tailpaddle"]);
/** Repainted parts: navy and white, the city police. */
const POLICE_PAINT = { Z9_mainbody1: 0x18284a, Z9_mainbody2: 0xe9edf2, Z9_tail: 0x18284a, Z9_cabinwall: 0x2a3550 };
/** The height the model is scaled to (fuselage ~12 m long). */
const LENGTH = 12.5;

let templatePromise = null;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A searchlight's cone of lit haze: brightest along its axis (where you look
 * through the most of it), soft at the edges, strong at the lamp and thinning
 * toward where it lands.
 */
/** A searchlight's cone of light (soft-edged, brightest at the lamp). Shared with the story's skies. */
export function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.85, 0.9, 1) }, uOpacity: { value: 0.16 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vAlong = uv.y; // 1 at the lamp, 0 where it lands
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float a = facing * mix(0.25, 1.0, vAlong * vAlong) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Four blades and the faint disc they blur into, `radius` long, about +Y. */
function rotorBlades(radius) {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6, metalness: 0.4 });
  const blade = new THREE.BoxGeometry(radius, radius * 0.012, radius * 0.075);
  blade.translate(radius / 2, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const m = new THREE.Mesh(blade, bladeMat);
    m.rotation.y = (i * Math.PI) / 2;
    group.add(m);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x8a96a8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
  );
  group.add(disc);
  return group;
}

/**
 * Bake the skinned model into static parts: { body, mainRotor, tailRotor },
 * each a Group of one mesh per material, in a frame where the helicopter's
 * nose points -Z, the skids sit on y = 0 and it's LENGTH long.
 */
function bakeTemplate(scene) {
  scene.updateMatrixWorld(true);
  const parts = { body: new Map(), main: new Map(), tail: new Map() };
  const bladeBox = new THREE.Box3();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.material?.name) return;
    const g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    if (o.isSkinnedMesh) {
      // Exactly where three.js draws each vertex: through the bones, then the mesh.
      const pos = g.attributes.position;
      const src = o.geometry.attributes.position;
      for (let i = 0; i < src.count; i += 1) {
        v.fromBufferAttribute(src, i);
        o.applyBoneTransform(i, v);
        v.applyMatrix4(o.matrixWorld);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
    } else g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // The source's main blades don't survive the bake (they draw as a sliver):
    // they're rebuilt below as plain blades and a blur disc.
    if (o.material.name === "Z9_mainpaddle") {
      g.computeBoundingBox();
      bladeBox.union(g.boundingBox);
      return;
    }
    const into = MAIN_ROTOR.has(o.material.name) ? parts.main : TAIL_ROTOR.has(o.material.name) ? parts.tail : parts.body;
    if (!into.has(o.material)) into.set(o.material, []);
    into.get(o.material).push(g.index ? g.toNonIndexed() : g);
  });
  // Which way is up, which way is back: the main rotor is over the body, the
  // tail rotor behind it. (The bones put the vertices in the source's own
  // frame, which isn't the scene's - so read it off the parts, don't assume.)
  const boxOf = (map) => {
    const b = new THREE.Box3();
    for (const list of map.values()) for (const g of list) { g.computeBoundingBox(); b.union(g.boundingBox); }
    return b;
  };
  const centreOf = (map) => boxOf(map).getCenter(new THREE.Vector3());
  const snap = (dir) => {
    const a = [Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z)];
    const i = a.indexOf(Math.max(...a));
    return new THREE.Vector3().setComponent(i, Math.sign(dir.getComponent(i)) || 1);
  };
  // The hubs are the middles of the rotors themselves. Up is the main
  // rotor disc's thin axis, toward the side the disc sits on.
  const bodyC = centreOf(parts.body);
  const mainPivot = centreOf(parts.main);
  const tailPivot = centreOf(parts.tail);
  const disc = boxOf(parts.main).getSize(new THREE.Vector3());
  const thin = [disc.x, disc.y, disc.z].indexOf(Math.min(disc.x, disc.y, disc.z));
  const up = new THREE.Vector3().setComponent(thin, Math.sign(mainPivot.getComponent(thin) - bodyC.getComponent(thin)) || 1);
  const backRaw = tailPivot.clone().sub(bodyC);
  backRaw.addScaledVector(up, -backRaw.dot(up));
  const back = snap(backRaw);
  const right = new THREE.Vector3().crossVectors(up, back);
  const orient = new THREE.Matrix4().makeBasis(right, up, back).transpose();
  for (const map of Object.values(parts)) for (const list of map.values()) for (const g of list) g.applyMatrix4(orient);
  mainPivot.applyMatrix4(orient);
  tailPivot.applyMatrix4(orient);

  const group = (map) => {
    const out = new THREE.Group();
    for (const [material, list] of map) {
      const merged = BufferGeometryUtils.mergeGeometries(list, false);
      if (!merged) continue;
      material.envMapIntensity = 0.5;
      // The bake keeps one UV set: every map reads it.
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"]) {
        if (material[key]) material[key].channel = 0;
      }
      // Glass reads as glass at night: dark and glossy.
      if (/glass/i.test(material.name)) {
        material.transparent = true;
        material.opacity = 0.55;
        material.roughness = 0.05;
      }
      // Police livery: the source is a military camo with a red star.
      if (POLICE_PAINT[material.name] !== undefined) {
        material.map = null;
        material.color.setHex(POLICE_PAINT[material.name]);
        material.metalness = 0.35;
        material.roughness = 0.45;
        material.needsUpdate = true;
      }
      out.add(new THREE.Mesh(merged, material));
    }
    return out;
  };
  const body = group(parts.body);
  const main = group(parts.main);
  const tail = group(parts.tail);
  // Measure the body: which way is long, where's the bottom.
  const box = new THREE.Box3().setFromObject(body);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  inner.add(body);
  // Rotors spin about their own hubs (found again in a clone by name).
  for (const [rotor, pivot, name] of [[main, mainPivot, "MainHub"], [tail, tailPivot, "TailHub"]]) {
    const hub = new THREE.Group();
    hub.name = name;
    hub.position.copy(pivot);
    rotor.position.copy(pivot).negate();
    hub.add(rotor);
    inner.add(hub);
    if (name === "MainHub") hub.add(rotorBlades(Math.max(bladeBox.isEmpty() ? 0 : bladeBox.getSize(v).length() / 2.83, size.z * 0.47)));
  }
  // Now nose down -Z, rotor up: scale to length, skids on y = 0.
  const scale = LENGTH / size.z;
  inner.scale.setScalar(scale);
  inner.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  return root;
}

async function loadTemplate(assetBase) {
  templatePromise ??= new GLTFLoader()
    .loadAsync(new URL("police_helicopter.glb", assetBase).href)
    .then((gltf) => bakeTemplate(gltf.scene))
    .catch((error) => {
      console.warn("[police] helicopter failed to load", error);
      templatePromise = null;
      return null;
    });
  return templatePromise;
}

const RED = new THREE.Color(1, 0.12, 0.1);
const BLUE = new THREE.Color(0.15, 0.35, 1);

export class PoliceHelicopters {
  /**
   * @param {object} [o]
   * @param {number} [o.count]
   * @param {number} [o.seed]
   * @param {number} [o.craftScale]  bigger craft (seen from far off), same flight paths
   */
  constructor({ count = 3, seed = 1, craftScale = 1 } = {}) {
    this.root = new THREE.Group();
    this.root.name = "PoliceHelicopters";
    this.glow = glowTexture();
    this.beamGeometry = new THREE.CylinderGeometry(0.15, 7, 1, 20, 1, true);
    // Apex at the lamp (y = 0), opening down -Y to the far end at y = -1.
    this.beamGeometry.translate(0, -0.5, 0);
    this.beamGeometry.rotateX(-Math.PI / 2); // now opens along -Z, so lookAt aims it
    this.spotGeometry = new THREE.CircleGeometry(1, 28);
    this.spotGeometry.rotateX(-Math.PI / 2);
    this.materials = [];
    this.craft = [];
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < count; i += 1) {
      const holder = new THREE.Group();
      holder.scale.setScalar(craftScale);
      const mount = new THREE.Group(); // the model goes in here
      holder.add(mount);
      const lights = [];
      for (const [x, y, z, colour] of [[-1.2, 1.2, 0.5, RED], [1.2, 1.2, 0.5, BLUE], [0, 0.4, 2.2, RED], [0, 3.6, 4.5, BLUE]]) {
        const m = new THREE.SpriteMaterial({ map: this.glow, color: colour, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
        const sprite = new THREE.Sprite(m);
        sprite.position.set(x, y, z);
        sprite.scale.setScalar(2.4);
        holder.add(sprite);
        lights.push({ sprite, colour });
        this.materials.push(m);
      }
      // The searchlight: a cone of light, and a pool of it where it lands.
      const beamMat = beamMaterial();
      const beam = new THREE.Mesh(this.beamGeometry, beamMat);
      beam.frustumCulled = false;
      beam.renderOrder = 2;
      const lampMat = new THREE.SpriteMaterial({ map: this.glow, color: 0xf2f6ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
      const lamp = new THREE.Sprite(lampMat);
      lamp.scale.setScalar(3.2);
      lamp.position.set(0, 0.2, -3.6);
      holder.add(lamp);
      const spotMat = new THREE.MeshBasicMaterial({ map: this.glow, color: 0xe8eeff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
      const spot = new THREE.Mesh(this.spotGeometry, spotMat);
      spot.renderOrder = 2;
      this.materials.push(beamMat, lampMat, spotMat);
      this.root.add(holder, beam, spot);
      this.craft.push({
        holder, mount, lights, beam, lamp, spot,
        side: i % 2 === 0 ? -1 : 1,
        ahead: 30 + i * 55 + rnd() * 20,
        height: 26 + rnd() * 18,
        radius: 22 + rnd() * 16,
        out: 48 + rnd() * 30,
        angle: rnd() * Math.PI * 2,
        rate: (0.12 + rnd() * 0.1) * (rnd() < 0.5 ? -1 : 1),
        phase: rnd() * 10,
        sweep: rnd() * 10,
        target: new THREE.Vector3(),
        aim: new THREE.Vector3(),
        model: null,
        snapped: false,
      });
    }
    this._v = new THREE.Vector3();
    this._lamp = new THREE.Vector3();
  }

  /** Fetch and bake the model (shared by every instance); stand-ins until then. */
  async load(assetBase) {
    const template = await loadTemplate(assetBase);
    if (!template) return;
    for (const c of this.craft) {
      if (c.model) continue;
      const model = template.clone(true);
      c.mainHub = model.getObjectByName("MainHub");
      c.tailHub = model.getObjectByName("TailHub");
      c.mount.add(model);
      c.model = model;
    }
  }

  /**
   * @param {number} dt
   * @param {number} time
   * @param {object} o
   * @param {(d:number) => number} o.worldZ  route distance -> world z
   * @param {number} o.distance              where the player is (route distance)
   * @param {number} [o.deckY]               the bridge deck's height (for the light pools)
   * @param {boolean} [o.overDeck]           the deck is open sky (the skybridge): beams may cross it
   * @param {number} [o.cityY]               where the streets are, far below
   * @param {number} [o.spotZ]               sweep round this z (a roof) rather than ahead on the route
   * @param {number} [o.spotSpread]          how far the sweep wanders from it
   */
  update(dt, time, { worldZ, distance, deckY = 0, overDeck = true, cityY = -60, spotZ = null, spotSpread = 7 }) {
    for (const [i, c] of this.craft.entries()) {
      c.angle += c.rate * dt;
      // An orbit to one side of the route, ahead of the player, carried along with them.
      const cz = worldZ(distance + c.ahead);
      const cx = c.side * c.out;
      const x = cx + Math.cos(c.angle) * c.radius;
      const z = cz + Math.sin(c.angle) * c.radius;
      const y = c.height + Math.sin(time * 0.4 + c.phase) * 1.5;
      const h = c.holder;
      if (!c.snapped) {
        h.position.set(x, y, z);
        c.snapped = true;
      } else h.position.lerp(this._v.set(x, y, z), Math.min(1, dt * 3));
      // Nose (-Z) along the orbit, banked into the turn.
      const dir = Math.sign(c.rate);
      const heading = Math.atan2(Math.sin(c.angle) * dir, -Math.cos(c.angle) * dir);
      h.rotation.set(0, heading, 0);
      h.rotateZ(-Math.sign(c.rate) * 0.18);
      h.rotateX(0.06);
      if (c.mainHub) c.mainHub.rotation.y += dt * 38;
      if (c.tailHub) c.tailHub.rotation.x += dt * 70;

      // Police lights: red and blue in turn, double flashes.
      const beat = (time * 2.2 + i * 0.37) % 1;
      const redOn = beat < 0.12 || (beat > 0.2 && beat < 0.3);
      const blueOn = (beat > 0.5 && beat < 0.62) || (beat > 0.7 && beat < 0.8);
      for (const [j, l] of c.lights.entries()) {
        const on = l.colour === RED ? redOn : blueOn;
        l.sprite.material.opacity = on ? 1 : 0.06;
        l.sprite.scale.setScalar(on ? (j > 1 ? 4.2 : 3) : 1.6);
      }

      // The searchlight: wandering the streets; now and then across the bridge.
      c.sweep += dt;
      const onDeck = overDeck && Math.sin(c.sweep * 0.21 + i * 2) > 0.55;
      if (onDeck) {
        const z = spotZ !== null ? spotZ + Math.sin(c.sweep * 0.5 + i) * spotSpread : worldZ(distance + 8 + Math.sin(c.sweep * 0.5 + i) * 14);
        c.target.set(Math.sin(c.sweep * 0.9) * spotSpread, deckY, z);
      }
      else c.target.set(cx + Math.sin(c.sweep * 0.33 + i) * 40, cityY, cz + Math.cos(c.sweep * 0.27 + i * 3) * 50);
      c.aim.lerp(c.target, Math.min(1, dt * (onDeck ? 1.4 : 0.7)));
      if (c.aim.lengthSq() === 0) c.aim.copy(c.target);
      c.lamp.getWorldPosition(this._lamp);
      const length = this._lamp.distanceTo(c.aim);
      c.beam.position.copy(this._lamp);
      c.beam.lookAt(c.aim);
      c.beam.scale.set(1, 1, length);
      // A cone 7 m wide at the far end: the pool is that wide where it lands.
      c.spot.position.copy(c.aim).setY(c.aim.y + 0.05);
      c.spot.scale.setScalar(onDeck ? 3.6 : 7);
      c.spot.material.opacity = onDeck ? 0.45 : 0.3;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.glow.dispose();
    this.beamGeometry.dispose();
    this.spotGeometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
