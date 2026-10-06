/**
 * Your hands on the ledge (Phase 5, the Skyline's latch): seen in first
 * person as you hang from the far building's lip - palms flat on the top,
 * fingers pressing in, thumbs along the side, forearms bending over the edge
 * and down out of view. In the player's chosen skin tone, with the patient
 * wristband on the left wrist.
 *
 * Local frame: y = 0 is the top of the lip, -Z runs away over it, the lip's
 * near edge is at z = +0.12 (where you hang), x = 0 between your hands.
 *
 *   const hands = new LedgeHands({ skin: "#b0826a" });
 *   group.add(hands.root);
 *   hands.dispose();
 */

import * as THREE from "../../three.js";

/** One finger: [x offset from the hand's centre, length of each bone, radius]. */
const FINGERS = [
  [0.031, [0.044, 0.027, 0.021], 0.0098], // index (toward the middle)
  [0.011, [0.048, 0.03, 0.022], 0.0101],
  [-0.009, [0.045, 0.028, 0.021], 0.0096],
  [-0.028, [0.036, 0.022, 0.018], 0.0085], // little finger
];
/** Each joint's bend, down toward the surface (radians). */
// (Gentle: the fingers lie along the top and just press in at the tips -
// curled any harder they'd go down into the concrete.)
const CURL = [0.04, 0.22, 0.2];

export class LedgeHands {
  constructor({ skin = "#b0826a" } = {}) {
    this.root = new THREE.Group();
    this.root.name = "LedgeHands";
    this._owned = [];
    const own = (x) => (this._owned.push(x), x);
    const skinColour = new THREE.Color(skin);
    // Lit from below by the fires: a little warmth of its own.
    this.skin = own(new THREE.MeshStandardMaterial({
      color: skinColour,
      roughness: 0.58,
      metalness: 0,
      emissive: skinColour.clone().multiply(new THREE.Color(0.5, 0.3, 0.2)),
      emissiveIntensity: 0.22,
    }));
    this.nail = own(new THREE.MeshStandardMaterial({ color: skinColour.clone().lerp(new THREE.Color(0xf2d6cc), 0.55), roughness: 0.35 }));
    this.band = own(new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.6, emissive: 0x3a3430 }));
    this.ball = own(new THREE.SphereGeometry(1, 12, 10));
    this.palmGeometry = own(this._palmGeometry());
    this.forearmGeometry = own(new THREE.CylinderGeometry(0.031, 0.043, 1, 14, 1, true));
    this.bandGeometry = own(new THREE.CylinderGeometry(0.0345, 0.0345, 0.018, 16, 1, true));
    for (const side of [-1, 1]) this.root.add(this._hand(side));
    // A touch over life size: they're the whole shot.
    this.root.scale.setScalar(1.12);
  }

  /** A palm: a rounded slab, thicker at the heel, narrower at the wrist. */
  _palmGeometry() {
    const g = new THREE.BoxGeometry(0.084, 0.026, 0.096, 6, 2, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      // Narrower toward the wrist (+z), rounded at the edges, a fuller heel.
      const k = (z + 0.048) / 0.096;
      const narrow = 1 - 0.18 * k;
      const round = 1 - 0.35 * Math.pow(Math.abs(x) / 0.042, 4);
      p.setX(i, x * narrow);
      p.setY(i, y * round * (1 + 0.25 * k) + (y > 0 ? 0.004 * Math.cos((x / 0.042) * Math.PI * 0.5) : 0));
    }
    g.computeVertexNormals();
    return g;
  }

  /** A finger bone: a capsule `length` long overall, along -Z from the joint. */
  _bone(length, radius) {
    const g = this._own(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - 2 * radius), 4, 10));
    const mesh = new THREE.Mesh(g, this.skin);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = -length / 2;
    return mesh;
  }

  _own(x) {
    this._owned.push(x);
    return x;
  }

  _hand(side) {
    const hand = new THREE.Group();
    // The two hands a shoulder's width apart, turned in a little.
    hand.position.set(side * 0.2, 0.015, 0.02);
    hand.rotation.y = -side * 0.16;
    const palm = new THREE.Mesh(this.palmGeometry, this.skin);
    palm.position.set(0, 0, 0.03);
    hand.add(palm);
    // Knuckles: a soft ridge across the top of the palm's front edge.
    for (const [x, , r] of FINGERS) {
      const k = new THREE.Mesh(this.ball, this.skin);
      k.scale.set(r * 1.18, r * 0.95, r * 1.1);
      k.position.set(x * -side, 0.006, -0.016);
      hand.add(k);
    }
    // Fingers: three bones each, curling down to press into the top.
    for (const [x, bones, r] of FINGERS) {
      let joint = new THREE.Group();
      joint.position.set(x * -side, 0.002, -0.018);
      hand.add(joint);
      bones.forEach((length, b) => {
        joint.rotation.x = -CURL[b];
        const radius = r * (1 - b * 0.1);
        joint.add(this._bone(length, radius));
        if (b === bones.length - 1) {
          const nail = new THREE.Mesh(this.ball, this.nail);
          nail.scale.set(radius * 0.82, radius * 0.32, radius * 1.1);
          nail.position.set(0, radius * 0.72, -length + radius * 1.2);
          joint.add(nail);
        }
        const next = new THREE.Group();
        next.position.z = -length;
        joint.add(next);
        joint = next;
      });
    }
    // The thumb: along the inner side, pressing down beside the index finger.
    const thumbBase = new THREE.Group();
    thumbBase.position.set(0.04 * side * -1, -0.002, 0.045);
    thumbBase.rotation.set(-0.25, side * -0.75, side * 0.35);
    hand.add(thumbBase);
    let tj = thumbBase;
    [0.036, 0.03].forEach((length, b) => {
      const radius = 0.0118 - b * 0.0012;
      tj.add(this._bone(length, radius));
      const next = new THREE.Group();
      next.position.z = -length;
      next.rotation.x = -0.32;
      tj.add(next);
      tj = next;
    });
    // The wrist, bent over the near edge; the forearm hanging down below it.
    const wrist = new THREE.Mesh(this.ball, this.skin);
    wrist.scale.set(0.034, 0.024, 0.032);
    wrist.position.set(0, -0.004, 0.084);
    hand.add(wrist);
    const forearm = new THREE.Mesh(this.forearmGeometry, this.skin);
    const from = new THREE.Vector3(0, -0.004, 0.09);
    const to = new THREE.Vector3(side * 0.04, -0.36, 0.24);
    forearm.position.copy(from).lerp(to, 0.5);
    forearm.scale.y = from.distanceTo(to);
    forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
    hand.add(forearm);
    // The patient wristband (left wrist).
    if (side < 0) {
      const band = new THREE.Mesh(this.bandGeometry, this.band);
      band.position.copy(from).lerp(to, 0.08);
      band.quaternion.copy(forearm.quaternion);
      hand.add(band);
    }
    return hand;
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this._owned) x.dispose();
    this._owned.length = 0;
  }
}
