/**
 * The launcher crashing into the lift: Level 3's failed experiment, falling
 * from the lab above, through the cabin roof, onto the floor - where
 * Subject 07 picks it up and carries it into Level 3.
 *
 * It is the same model Level 3 uses (assets/meltdown/launcher.glb, loaded
 * through Level 3's cached loader, so it is only fetched once), oriented and
 * scaled the way Level 3 mounts it (game.js `_mountLauncherModel`): a
 * 1.25 m tube pointing down -Z. Until the model is in, a simple stand-in.
 *
 *   const launcher = new LauncherProp(cabin.root, assetBase);
 *   launcher.drop(from, velocity);  // falls in the cabin's frame
 *   launcher.update(dt, gEff);
 *   launcher.attach(shoulder, 0.5); // to the hands, over 0.5 s
 */

import * as THREE from "../three.js";
import { loadMeltdownAssets } from "../levels/meltdown/assets.js";
import { CABIN } from "./kit.js";

const LENGTH = 1.25;
/** Where the launcher sits in PlayerAvatar.shoulder for the two-handed hold (as game.js). */
const HELD = new THREE.Vector3(-0.04, -0.07, -0.18);
const _a = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class LauncherProp {
  constructor(parent, assetBase) {
    this.parent = parent;
    this.root = new THREE.Group();
    this.root.name = "Launcher";
    this.root.visible = false;
    parent.add(this.root);
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);

    // Stand-in: tube, grip and a muzzle ring, until the model arrives.
    const metal = own(new THREE.MeshStandardMaterial({ color: 0x3d4a3a, metalness: 0.6, roughness: 0.5 }));
    const dark = own(new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0.5, roughness: 0.6 }));
    this.standIn = new THREE.Group();
    const tube = new THREE.Mesh(own(new THREE.CylinderGeometry(0.09, 0.11, LENGTH, 14)), metal);
    tube.rotation.x = Math.PI / 2;
    const grip = new THREE.Mesh(own(new THREE.BoxGeometry(0.05, 0.16, 0.07)), dark);
    grip.position.set(0, -0.12, 0.12);
    const ring = new THREE.Mesh(own(new THREE.TorusGeometry(0.1, 0.022, 8, 16)), dark);
    ring.position.z = -LENGTH / 2;
    this.standIn.add(tube, grip, ring);
    this.root.add(this.standIn);

    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
    this.state = "idle";
    this.landed = false;
    this.attachT = 0;
    this.attachFor = 0.5;
    this.target = null;
    this.startPos = new THREE.Vector3();
    this.startQuat = new THREE.Quaternion();

    if (assetBase) {
      loadMeltdownAssets(assetBase, { names: ["launcher"] })
        .then((assets) => this._setModel(assets.get("launcher")))
        .catch(() => {});
    }
  }

  _setModel(asset) {
    if (!asset || this.disposed) return;
    // Oriented as game.js mounts it: long axis to -Z, ~1.25 m, centred.
    const model = asset.template.clone(true);
    model.scale.setScalar(LENGTH / Math.max(asset.size.x, asset.size.z));
    model.rotation.y = Math.PI / 2;
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    this.root.add(model);
    // Same camera layers as the prop (the diagnostic view marks it).
    model.traverse((o) => {
      o.layers.mask = this.root.layers.mask;
    });
    this.standIn.visible = false;
    this.model = model;
  }

  /** It falls into the cabin from `from` (cabin frame). */
  drop(from, velocity) {
    this.state = "falling";
    this.root.visible = true;
    this.root.position.copy(from);
    this.root.rotation.set(0.5, 0.8, 0.3);
    this.v.copy(velocity);
    this.w.set(3.2, 1.4, -2.1);
  }

  /**
   * Move it into the hands (PlayerAvatar.shoulder) over `seconds`, swinging
   * up through `via` (world) - in front of the chest, not through it.
   */
  attach(shoulder, seconds = 0.5, via = null) {
    this.via = via?.clone() ?? null;
    this.state = "attaching";
    this.target = shoulder;
    this.attachT = 0;
    this.attachFor = seconds;
    // Start from where it lies, in world space.
    this.root.updateMatrixWorld(true);
    this.root.matrixWorld.decompose(this.startPos, this.startQuat, _a);
  }

  update(dt, gEff) {
    if (this.state === "held") {
      // Kicks back into the shoulder on a shot, then settles.
      this.recoil = Math.max(0, (this.recoil ?? 0) - dt * 7);
      this.root.position.set(HELD.x, HELD.y, HELD.z + this.recoil * 0.1);
      this.root.rotation.x = this.recoil * 0.15;
    } else if (this.state === "falling") {
      const p = this.root.position;
      this.v.y -= gEff * dt;
      p.addScaledVector(this.v, dt);
      this.root.rotation.x += this.w.x * dt;
      this.root.rotation.y += this.w.y * dt;
      this.root.rotation.z += this.w.z * dt;
      const B = CABIN.half - 0.4;
      for (const axis of ["x", "z"]) {
        if (Math.abs(p[axis]) > B) {
          p[axis] = Math.sign(p[axis]) * B;
          this.v[axis] *= -0.4;
        }
      }
      // The floor: bounce, skid, then lie flat along the floor.
      if (p.y < 0.1) {
        p.y = 0.1;
        if (!this.landed) {
          this.landed = true;
          this.onLand?.(Math.abs(this.v.y));
        }
        this.v.y = Math.abs(this.v.y) > 1 ? -this.v.y * 0.28 : 0;
        this.v.x *= 0.5;
        this.v.z *= 0.5;
        this.w.multiplyScalar(0.4);
      }
      if (this.landed && p.y <= 0.1001) {
        const k = Math.min(1, dt * 8);
        this.root.rotation.x += (0 - this.root.rotation.x) * k;
        this.root.rotation.z += (0 - this.root.rotation.z) * k;
      }
    } else if (this.state === "attaching") {
      // World-space blend from the floor to the hands, then parent to them.
      this.attachT += dt;
      const k = Math.min(1, this.attachT / this.attachFor);
      const e = k * k * (3 - 2 * k);
      this.target.updateMatrixWorld(true);
      const to = _m.compose(HELD, _qa.identity(), _a.set(1, 1, 1)).premultiply(this.target.matrixWorld);
      const toPos = new THREE.Vector3();
      const toScale = new THREE.Vector3();
      to.decompose(toPos, _qb, toScale);
      // A curve through `via`: floor -> in front of the chest -> the shoulder.
      const pos = this.startPos.clone().lerp(toPos, e);
      if (this.via) {
        const mid = this.startPos.clone().lerp(toPos, 0.5);
        pos.addScaledVector(this.via.clone().sub(mid), 4 * e * (1 - e));
      }
      const quat = this.startQuat.clone().slerp(_qb, e);
      // Into the cabin's frame (the root's parent).
      this.parent.updateMatrixWorld(true);
      _m.compose(pos, quat, _a.set(1, 1, 1)).premultiply(new THREE.Matrix4().copy(this.parent.matrixWorld).invert());
      _m.decompose(this.root.position, this.root.quaternion, _a);
      if (k >= 1) {
        this.state = "held";
        this.recoil = 0;
        this.target.add(this.root);
        this.root.position.copy(HELD);
        this.root.quaternion.identity();
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
    // The model's geometry and materials are Level 3's cached template's.
    for (const x of this.owned) x.dispose();
  }
}
