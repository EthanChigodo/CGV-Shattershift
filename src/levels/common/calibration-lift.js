/**
 * The Calibration Lift - Level 1's glass elevator, as a stand-alone prop so
 * Levels 2 and 3 can end the same way Level 1 does.
 *
 * The cabin is the tower's one glass cabin (src/elevators/glass-cabin.js),
 * octagonal: a glass wall in steel mullions on a tread-plate deck, steel
 * posts with glowing conduits, two glass doors with lit edges in a steel
 * frame (the button panel inside), light bars, a handrail - built by
 * `buildCalibrationCabin`, which Level 1's own lift (src/levels/causeway/
 * kit.js `lift()`) uses too, with its refraction glass. Around it a tall
 * glass shaft on four rails, and the same ride:
 * the doors close, the cabin accelerates up to 11 m/s, the camera drops back
 * behind the player and then circles the shaft as the cabin climbs away.
 *
 *   const lift = new CalibrationLift({ landing: 10 });
 *   scene.add(lift.root);                 // doors face local +Z
 *   lift.start();                         // the player is inside
 *   // each frame:
 *   const ride = lift.update(dt, time);   // { t, cabinY, velocity, fade, done }
 *   lift.cameraPose(ride.t, fromWorld, camPos, lookAt, reduced);
 *   lift.floorPoint(target);              // where the player stands
 *
 * Local frame: cabin centred on the origin, floor at y = 0, doors toward +Z
 * (the side the player comes from). Place it so +Z faces back along the run.
 */

import * as THREE from "../../three.js";
import { createGlassCabinKit, GLASS_CABIN } from "../../elevators/glass-cabin.js";

/** Seconds from the doors starting to close to the end of the ride. */
export const RIDE_SECONDS = 7.4;
const RIDE_SECONDS_REDUCED = 6.2;
/** Cabin radius (to the octagon's corners). */
export const LIFT_RADIUS = 4.5;
/** The glass shaft's radius. */
const R_SHAFT = 5;
/** The cabin's glass wall: its radius and height, and the doorway's angle (radians, centred on +Z). */
const R_GLASS = 4.3;
const WALL_H = 5.4;
const DOORWAY = 1.25;
/** The doors: one leaf's width, their height, the plane they slide in. */
const DOOR = { leaf: 2.3, height: 5.0, z: LIFT_RADIUS - 0.25 };

/**
 * The Calibration Lift's cabin, from the tower's glass-cabin kit - for this
 * prop and for Level 1's own lift, which passes its refraction glass (and
 * layer hooks) in `kitOptions` (see createGlassCabinKit). Floor at y = 0,
 * doors toward +Z. Returns { cabin, doors, conduits }; each door leaf's
 * userData has closedX and openX.
 */
export function buildCalibrationCabin(own, kitOptions = {}) {
  const kit = createGlassCabinKit(own, kitOptions);
  const { steel, darkSteel, glass } = kit.materials;
  const cabin = new THREE.Group();
  cabin.name = "LiftCabin";
  const R = LIFT_RADIUS;
  kit.octagonDeck(cabin, R);
  const roof = new THREE.Mesh(own(new THREE.CylinderGeometry(R, R, 0.4, 8).rotateY(Math.PI / 8)), darkSteel);
  roof.position.y = WALL_H + 0.25;
  cabin.add(roof);
  // The glass, all round but the doorway, and its steel: sill, transom, head.
  const wall = new THREE.Mesh(own(new THREE.CylinderGeometry(R_GLASS, R_GLASS, WALL_H, 32, 1, true, DOORWAY / 2, Math.PI * 2 - DOORWAY)), glass);
  wall.name = "CabinGlass";
  wall.position.y = WALL_H / 2 + 0.05;
  wall.renderOrder = 2;
  kitOptions.onGlass?.(wall);
  cabin.add(wall);
  const arc = Math.PI * 2 - DOORWAY;
  for (const [y, t] of [[0.05 + GLASS_CABIN.rail / 2, GLASS_CABIN.rail], [0.05 + WALL_H * GLASS_CABIN.transom, GLASS_CABIN.mullion], [WALL_H, GLASS_CABIN.rail]]) {
    // A torus round the XY plane, laid flat and turned so its gap is the doorway.
    const ring = new THREE.Mesh(own(new THREE.TorusGeometry(R_GLASS, t / 2, 6, 40, arc).rotateX(Math.PI / 2).rotateY(-(Math.PI / 2 + DOORWAY / 2))), steel);
    ring.name = "CabinMullion";
    ring.position.y = y;
    cabin.add(ring);
  }
  // Posts with conduits at the octagon's corners (none across the doorway),
  // and a mullion halfway along each face of glass.
  const conduits = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (Math.abs(Math.sin(a) - 1) < 0.2) continue;
    conduits.push(kit.post(cabin, Math.cos(a) * (R - 0.2), Math.sin(a) * (R - 0.2), WALL_H + 0.05));
    const c = a + Math.PI / 8;
    if (Math.sin(c) < 0.5) kit.box(cabin, steel, GLASS_CABIN.mullion, WALL_H, GLASS_CABIN.mullion, Math.cos(c) * R_GLASS, WALL_H / 2 + 0.05, Math.sin(c) * R_GLASS).name = "CabinMullion";
  }
  // The doors in their frame (the buttons on the inside), and glass returns
  // from the wall's ends to the jambs.
  const doors = kit.doors(cabin, { width: DOOR.leaf * 2, height: DOOR.height, y0: 0.05, z: DOOR.z, depth: 0.08 });
  kit.doorFrame(cabin, { width: DOOR.leaf * 2, height: DOOR.height + 0.05, z: DOOR.z, inward: -1, depth: 0.2, ceiling: WALL_H + 0.05 });
  const ex = Math.sin(DOORWAY / 2) * R_GLASS;
  const ez = Math.cos(DOORWAY / 2) * R_GLASS;
  for (const s of [-1, 1]) kit.glassWall(cabin, [s * ex, ez], [s * (DOOR.leaf + GLASS_CABIN.post / 2), DOOR.z], WALL_H, { y0: 0.05, transom: false });
  // Light bars under the roof; a handrail round the faces clear of the doorway.
  kit.lightBars(cabin, { span: 1.5, length: 5.2, y: WALL_H + 0.03 });
  for (let i = 0; i < 8; i += 1) {
    const c = (i / 8) * Math.PI * 2;
    if (Math.sin(c) > 0.3) continue;
    const at = (ang, k) => [Math.cos(ang) * (R - 0.2) * k, Math.sin(ang) * (R - 0.2) * k];
    const [a0, b0] = [at(c - Math.PI / 8, 0.93), at(c + Math.PI / 8, 0.93)];
    const lerp = (k) => [a0[0] + (b0[0] - a0[0]) * k, a0[1] + (b0[1] - a0[1]) * k];
    kit.handrail(cabin, lerp(0.1), lerp(0.9), [Math.cos(c), Math.sin(c)]);
  }
  return { cabin, doors: doors.leaves, conduits };
}

export class CalibrationLift {
  /**
   * @param {object} [o]
   * @param {number} [o.accent]   conduit / trim colour (Level 1: cyan)
   * @param {number} [o.landing]  length of the floor slab from the doors toward +Z (0 = none)
   * @param {number} [o.shaftHeight]
   * @param {number} [o.landingWidth]
   * @param {{ceiling: number}|null} [o.core]  build the lift core round the
   *   shaft (an atrium of floors it climbs past); `ceiling` is the height of
   *   the level's own ceiling, where the core's galleries start
   */
  constructor({ accent = 0x7ef4f1, landing = 0, landingWidth = 11, shaftHeight = 80, core = null } = {}) {
    this.root = new THREE.Group();
    this.root.name = "CalibrationLift";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);

    const steel = own(new THREE.MeshStandardMaterial({ color: 0x737c80, metalness: 0.75, roughness: 0.4, envMapIntensity: 0.45 }));
    const darkSteel = own(new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.7, roughness: 0.45 }));
    this.conduit = own(new THREE.MeshBasicMaterial({ color: accent }));
    this.accent = new THREE.Color(accent);
    const strip = own(new THREE.MeshBasicMaterial({ color: accent }));
    const shaftGlass = own(new THREE.MeshStandardMaterial({ color: 0xbfe4ec, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));

    const box = own(new THREE.BoxGeometry(1, 1, 1));
    const tube = own(new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, true));
    const mesh = (geometry, material, sx, sy, sz, x, y, z, parent = this.cabin) => {
      const m = new THREE.Mesh(geometry, material);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };

    // The cabin (the tower's glass cabin, octagonal); the doors open until the ride starts.
    const R = LIFT_RADIUS;
    const built = buildCalibrationCabin(own, { conduit: this.conduit, accent });
    this.cabin = built.cabin;
    this.doors = built.doors;
    this.root.add(this.cabin);

    // The shaft: a tall glass tube on four steel rails.
    mesh(tube, shaftGlass, 10, shaftHeight, 10, 0, shaftHeight / 2, 0, this.root);
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      mesh(box, darkSteel, 0.35, shaftHeight, 0.35, Math.cos(a) * 5.1, shaftHeight / 2, Math.sin(a) * 5.1, this.root);
    }
    // Landing: a steel slab from the doors back toward the run, edged in the accent.
    if (landing > 0) {
      mesh(box, darkSteel, landingWidth, 0.4, landing, 0, -0.2, R + landing / 2, this.root);
      for (const s of [-1, 1]) mesh(box, strip, 0.08, 0.04, landing, s * (landingWidth / 2 - 0.1), 0.02, R + landing / 2, this.root);
    }
    if (core) this._buildCore({ own, mesh, box, darkSteel, strip, shaftHeight, ceiling: core.ceiling ?? 8 });

    // What it hangs from: a crosshead and sheave on the cabin's roof, the
    // hoist ropes up the shaft, and the machine at the top of the tube - so
    // it rides on something, not up into the dark.
    mesh(box, darkSteel, 4.2, 0.35, 0.5, 0, 5.95, 0);
    const sheave = mesh(own(new THREE.CylinderGeometry(0.55, 0.55, 0.24, 24)), steel, 1, 1, 1, 0, 6.5, 0);
    sheave.rotation.z = Math.PI / 2;
    this.ropeTop = shaftHeight - 1.2;
    this.ropes = [-0.18, -0.06, 0.06, 0.18].map((x) => {
      const rope = mesh(own(new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true)), darkSteel, 1, 1, 1, x, 0, 0, this.root);
      rope.frustumCulled = false;
      return rope;
    });
    mesh(box, darkSteel, 6.4, 1.6, 6.4, 0, shaftHeight + 0.2, 0, this.root);
    mesh(box, strip, 6.5, 0.06, 6.5, 0, shaftHeight - 0.62, 0, this.root);
    const drum = mesh(own(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 24)), steel, 1, 1, 1, 0, shaftHeight - 1.3, 0, this.root);
    drum.rotation.z = Math.PI / 2;
    this._drum = drum;

    this.state = { t: 0, cabinY: 0, velocity: 0, riding: false };
    this._v = new THREE.Vector3();
    this.reset();
  }

  /**
   * The lift core: the shaft rises through an atrium in the middle of the
   * building - a ring of galleries, one a floor, lit doors and office
   * windows round the walls, a steel ring beam round the tube at every
   * floor - so the ride climbs past the building's floors instead of out
   * of the top of the level into the dark. The camera circles inside it.
   */
  _buildCore({ own, mesh, box, darkSteel, strip, shaftHeight, ceiling }) {
    const RADIUS = 26;
    const GALLERY = 4;
    const FLOOR = 4.2;
    const core = new THREE.Group();
    core.name = "LiftCore";
    this.root.add(core);
    // The walls: each floor a band of concrete with lit doors and windows.
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#1a1d20";
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#0c0e10";
    g.fillRect(0, 100, 512, 28); // the slab edge
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let x = 6; x < 506; x += 32) {
      const kind = rnd();
      if (kind < 0.18) { g.fillStyle = "rgba(255,226,170,0.95)"; g.fillRect(x, 34, 18, 62); } // a lit doorway
      else if (kind < 0.7) { g.fillStyle = rnd() < 0.5 ? "rgba(190,215,235,0.75)" : "rgba(255,210,150,0.6)"; g.fillRect(x, 30, 24, 30); }
      else { g.fillStyle = "#14171a"; g.fillRect(x, 30, 24, 30); }
    }
    const tex = own(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, shaftHeight / FLOOR);
    const wallMat = own(new THREE.MeshStandardMaterial({ color: 0x444a50, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.85, side: THREE.BackSide }));
    const wall = new THREE.Mesh(own(new THREE.CylinderGeometry(RADIUS, RADIUS, shaftHeight, 8, 1, true)), wallMat);
    wall.position.y = shaftHeight / 2;
    wall.rotation.y = Math.PI / 8;
    core.add(wall);
    // A floor under it all (just below the level's own), and a roof over it.
    const slabMat = own(new THREE.MeshStandardMaterial({ color: 0x2a2e31, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide }));
    const base = new THREE.Mesh(own(new THREE.RingGeometry(R_SHAFT, RADIUS, 8, 1)), slabMat);
    base.rotation.x = -Math.PI / 2;
    base.rotation.z = Math.PI / 8;
    base.position.y = -0.25;
    core.add(base);
    const roof = base.clone();
    roof.position.y = shaftHeight;
    core.add(roof);
    // Galleries round the walls, one per floor above the level's ceiling,
    // with a railing and a strip of light along the edge.
    const ringGeo = own(new THREE.RingGeometry(RADIUS - GALLERY, RADIUS, 8, 1));
    const railGeo = own(new THREE.TorusGeometry(RADIUS - GALLERY, 0.05, 4, 8));
    const lightGeo = own(new THREE.TorusGeometry(RADIUS - GALLERY + 0.1, 0.04, 4, 8));
    const beamGeo = own(new THREE.TorusGeometry(5.6, 0.18, 6, 8));
    for (let y = Math.ceil(ceiling / FLOOR) * FLOOR; y < shaftHeight - 1; y += FLOOR) {
      const floor = new THREE.Mesh(ringGeo, slabMat);
      floor.rotation.x = -Math.PI / 2;
      floor.rotation.z = Math.PI / 8;
      floor.position.y = y;
      core.add(floor);
      const rail = new THREE.Mesh(railGeo, darkSteel);
      rail.rotation.x = Math.PI / 2;
      rail.rotation.z = Math.PI / 8;
      rail.position.y = y + 1.05;
      core.add(rail);
      const light = new THREE.Mesh(lightGeo, strip);
      light.rotation.x = Math.PI / 2;
      light.rotation.z = Math.PI / 8;
      light.position.y = y + 0.05;
      core.add(light);
    }
    // A ring beam round the tube at every floor, all the way up.
    for (let y = FLOOR; y < shaftHeight; y += FLOOR) {
      const beam = new THREE.Mesh(beamGeo, darkSteel);
      beam.rotation.x = Math.PI / 2;
      beam.position.y = y;
      core.add(beam);
    }
    // Columns from the ground to the roof, round the gallery edge.
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      mesh(box, darkSteel, 0.6, shaftHeight, 0.6, Math.cos(a) * (RADIUS - GALLERY), shaftHeight / 2, Math.sin(a) * (RADIUS - GALLERY), core);
    }
  }

  /** Doors open, cabin down, ready for the player. */
  reset() {
    Object.assign(this.state, { t: 0, cabinY: 0, velocity: 0, riding: false });
    this.cabin.position.y = 0;
    this._placeRopes();
    for (const leaf of this.doors) leaf.position.x = leaf.userData.openX;
  }

  /** 0 = shut, 1 = open (eased) - for an arrival, where the doors open to let the player out. */
  setDoorsOpen(k) {
    const e = THREE.MathUtils.smoothstep(k, 0, 1);
    for (const leaf of this.doors) leaf.position.x = THREE.MathUtils.lerp(leaf.userData.closedX, leaf.userData.openX, e);
  }

  /** The player is in: close the doors and go up. */
  start() {
    this.reset();
    this.state.riding = true;
  }

  /**
   * One frame of the ride (also animates the conduits while idle).
   * @returns {{t:number, cabinY:number, velocity:number, fade:number, done:boolean}}
   */
  update(dt, time = 0, reduced = false) {
    const s = this.state;
    const pulse = 0.6 + 0.4 * Math.sin(time * 3);
    if (!s.riding) {
      this.conduit.color.copy(this.accent).multiplyScalar(0.55 + 0.25 * pulse);
      return { t: 0, cabinY: 0, velocity: 0, fade: 0, done: false };
    }
    s.t += dt;
    const t = s.t;
    // Charge up as the doors close, then glow.
    this.conduit.color.copy(this.accent).multiplyScalar(0.6 + Math.min(1, t / 2) * (0.8 + 0.4 * pulse));
    const k = THREE.MathUtils.smoothstep(t, 0.1, 1.0);
    for (const leaf of this.doors) leaf.position.x = THREE.MathUtils.lerp(leaf.userData.openX, leaf.userData.closedX, k);
    // Rise: accelerate to 11 m/s.
    const rideT = Math.max(0, t - 1.0);
    s.velocity = Math.min(11, rideT * 4.5);
    s.cabinY += s.velocity * dt;
    this.cabin.position.y = s.cabinY;
    this._placeRopes();
    this._drum.rotation.x += s.velocity * dt / 0.9;
    const end = reduced ? RIDE_SECONDS_REDUCED : RIDE_SECONDS;
    return { t, cabinY: s.cabinY, velocity: s.velocity, fade: THREE.MathUtils.clamp((t - (end - 0.9)) / 0.9, 0, 1), done: t >= end };
  }

  /** The ropes run from the sheave on the cabin to the drum at the top. */
  _placeRopes() {
    const from = this.cabin.position.y + 6.5;
    const length = Math.max(0.1, this.ropeTop - from);
    for (const r of this.ropes) {
      r.scale.y = length;
      r.position.y = from + length / 2;
    }
  }

  /** Where the player stands in the cabin, in world space. */
  floorPoint(target = new THREE.Vector3()) {
    this.root.updateMatrixWorld();
    return this.root.localToWorld(target.set(0, this.state.cabinY, 0));
  }

  /**
   * True only after a world-space point has crossed the doorway into the
   * cabin. This is deliberately tighter than the shaft radius, so standing
   * beside the lift or on its landing does not count as being inside.
   */
  containsPoint(point) {
    this.root.updateMatrixWorld(true);
    this._v.copy(point);
    this.root.worldToLocal(this._v);
    this._v.y -= this.state.cabinY;
    const radial = Math.hypot(this._v.x, this._v.z);
    return radial <= LIFT_RADIUS - 0.35
      && this._v.z <= LIFT_RADIUS - 0.45
      && this._v.y >= -0.35
      && this._v.y <= 5.65;
  }

  /**
   * Level 1's ride camera: from `from` (the camera's position when the ride
   * began) to just behind the player in the cabin, then out and round the
   * shaft as the cabin climbs away. Writes world-space position and target.
   */
  cameraPose(t, from, position, look, reduced = false) {
    const y = this.state.cabinY;
    this.root.updateMatrixWorld();
    if (t < 1.3) {
      const k = THREE.MathUtils.smoothstep(t / 1.3, 0, 1);
      this.root.localToWorld(this._v.set(2.2, y + 3.2, 3.4));
      position.lerpVectors(from, this._v, k);
      this.root.localToWorld(look.set(0, y + 1.2, -1));
    } else {
      const orbit = (t - 1.3) * (reduced ? 0.18 : 0.42) + 0.6;
      const radius = 13 + (t - 1.3) * 1.2;
      const height = y + 3 - Math.min(10, (t - 1.3) * 2.2);
      this.root.localToWorld(position.set(Math.sin(orbit) * radius, height, Math.cos(orbit) * radius));
      this.root.localToWorld(look.set(0, y + 1.5 - Math.min(6, Math.max(0, t - 3) * 1.6), 0));
    }
    return position;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const x of this.owned) x.dispose();
  }
}
