/**
 * A scientist who acts in the story: Dr. Okoro (who runs with you) or
 * Dr. Vale (the pilot). The models (scientist_good.glb / scientist_evil.glb)
 * have no animation clips, so everything is procedural on HumanoidRig
 * (src/levels/meltdown/characters.js), like the roof's scientists:
 *
 *   const okoro = new Companion({ bag: true });
 *   scene.add(okoro.root);
 *   okoro.setModel(await loadStoryCharacter(base, "scientistGood"));
 *   okoro.act("talk");                // see ACTIONS
 *   okoro.lookAt(cameraPosition);     // head (and a little chest) turn
 *   okoro.hold(pistol, { hand: "R" }); // a prop in the right hand
 *   // each frame:
 *   okoro.follow(route, distance, lateral);  // optional: place on a route
 *   okoro.update(dt, { speed });
 *
 * Local frame: feet on y = 0, facing -Z (the same as the player's avatar),
 * so `root.rotation.y = heading` faces him down a route.
 */

import * as THREE from "../three.js";
import { cloneCharacter, HumanoidRig } from "../levels/meltdown/characters.js";
import { loadMeltdownAssets } from "../levels/meltdown/assets.js";

/** Load and prepare a story character template ("scientistGood" / "scientistEvil"). */
export async function loadStoryCharacter(assetBase, name) {
  const assets = await loadMeltdownAssets(assetBase, { names: [name] });
  return assets.get(name)?.template ?? null;
}

/**
 * What a companion can do. Speed-driven gaits (walk/run) come from
 * update({ speed }); the rest are held poses with a little life in them.
 */
export const ACTIONS = ["idle", "talk", "walk", "run", "point", "beckon", "offer", "aim", "crouch", "hold", "wave", "slump", "sit"];

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.6, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Okoro's bag: a worn canvas duffel on a strap across his chest (right hip,
 * strap over the left shoulder). Local origin at the strap's top; the duffel
 * hangs below it so it can swing.
 */
function buildBag() {
  const group = new THREE.Group();
  group.name = "Bag";
  const canvas = new THREE.MeshStandardMaterial({ color: 0x3b4031, roughness: 0.92 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1d1f1a, roughness: 0.8 });
  const duffel = new THREE.Group();
  duffel.name = "Duffel";
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 4, 10), canvas);
  body.rotation.x = Math.PI / 2; // long axis front-to-back, along his hip
  body.scale.set(0.8, 1, 1);
  duffel.add(body);
  for (const z of [-0.09, 0.09]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.01, 4, 14), trim);
    band.position.z = z;
    band.scale.set(0.8, 1, 1);
    duffel.add(band);
  }
  duffel.position.y = -0.56;
  group.add(duffel);
  // The strap: from the left shoulder, across the chest, down to the bag.
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.66, 0.012), trim);
  strap.position.set(0.13, -0.24, -0.15);
  strap.rotation.z = -0.62;
  group.add(strap);
  group.userData.duffel = duffel;
  return group;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _fwd = new THREE.Vector3(0, 0, -1);
const Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);

export class Companion {
  /**
   * @param {object} [o]
   * @param {boolean} [o.bag]  carry Okoro's bag on the left hip
   * @param {number} [o.coat]  stand-in coat colour (before the model arrives)
   */
  constructor({ bag = false, coat = 0xe8ece9 } = {}) {
    this.root = new THREE.Group();
    this.root.name = "Companion";
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.standIn = new THREE.Group();
    const skin = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a6e5c, roughness: 0.8 }));
    skin.position.y = 0.95;
    const labCoat = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.33, 1.0, 12), new THREE.MeshStandardMaterial({ color: coat, roughness: 0.85 }));
    labCoat.position.y = 0.95;
    this.standIn.add(skin, labCoat);
    this.body.add(this.standIn);

    this.shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), this.shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    this.bag = bag ? buildBag() : null;
    if (this.bag) {
      // Strap from his left shoulder across his chest; the bag rides his
      // right hip (+X, facing -Z).
      this.bag.position.set(-0.02, 1.38, 0);
      this.body.add(this.bag);
    }

    this.model = null;
    this.rig = null;
    this.action = "idle";
    this.blend = 1;
    this.phase = 0;
    this.time = 0;
    this.speed = 0;
    this.crouch = 0;
    this.slump = 0;
    this.lookTarget = null;
    this.lookWeight = 0;
    this.headYaw = 0;
    this.props = [];
    /** Added to whatever the action poses (a scene leaning him over a bed...). */
    this.adjust = { lean: 0, headNod: 0, twist: 0 };
  }

  /** Swap in the character (from loadStoryCharacter). */
  setModel(template) {
    if (!template) return;
    if (this.model) this.body.remove(this.model);
    const model = cloneCharacter(template);
    // Models face +Z; companions face -Z, like the player.
    model.rotation.y = Math.PI;
    this.body.add(model);
    this.model = model;
    this.rig = new HumanoidRig(model);
    this.standIn.visible = false;
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // skinned bounds don't follow the pose
    });
  }

  /** Switch what he's doing. `speed` for walk/run can also come from update(). */
  act(action) {
    if (!ACTIONS.includes(action)) throw new Error(`unknown action "${action}"`);
    if (action !== this.action) {
      this.action = action;
      this.blend = 0;
    }
    return this;
  }

  /** Turn the head toward a world point (null to stop). */
  lookAt(point, weight = 1) {
    this.lookTarget = point ? (this.lookTarget ?? new THREE.Vector3()).copy(point) : null;
    this.lookWeight = point ? weight : 0;
    return this;
  }

  /**
   * Carry an object in a hand. It is re-placed every frame at the hand bone,
   * pointing along the forearm. `offset` is in the object's frame after that.
   */
  hold(object, { hand = "R", offset = [0, 0, 0], rotation = [0, 0, 0] } = {}) {
    this.root.add(object);
    this.props.push({ object, hand, offset: new THREE.Vector3(...offset), rotation: new THREE.Euler(...rotation) });
    return object;
  }

  /** Let go of a held object (it stays where it is, in world space, in `into`). */
  drop(object, into = null) {
    const i = this.props.findIndex((p) => p.object === object);
    if (i < 0) return;
    this.props.splice(i, 1);
    if (into) into.attach(object);
    else this.root.remove(object);
  }

  /** Stand him on a route (the levels' route.sample) at a distance and lane offset. */
  follow(route, distance, lateral = 0, height = 0) {
    const s = route.sample(distance, lateral, height, this.root.position);
    this.root.rotation.y = s.heading;
    return this;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  /** World position of his eyes (for a camera to look at him). */
  headPosition(out = new THREE.Vector3()) {
    const head = this.rig?.bones.head;
    this.root.updateMatrixWorld(true);
    if (head) {
      head.getWorldPosition(out);
      return out.addScaledVector(Y, 0.09);
    }
    return this.root.localToWorld(out.set(0, 1.68 - this.crouch * 0.38, 0));
  }

  update(dt, { speed = null } = {}) {
    this.time += dt;
    const k = (rate) => 1 - Math.exp(-dt * rate);
    const t = this.time;
    if (speed !== null) this.speed = speed;
    this.blend = Math.min(1, this.blend + dt * 4);
    const moving = (this.action === "walk" || this.action === "run") && this.speed > 0.2;
    const sp = moving ? this.speed : 0;
    // Steps: ~1.6/s walking, ~3/s running (a full cycle is two steps).
    if (moving) this.phase += dt * Math.PI * (1.55 + sp * 0.24);
    this.crouch += ((this.action === "crouch" ? 1 : 0) - this.crouch) * k(6);
    this.slump += ((this.action === "slump" ? 1 : 0) - this.slump) * k(2.2);

    const b = (v) => v * this.blend;
    let pose;
    switch (this.action) {
      case "talk": {
        const g = Math.sin(t * 2.1) * 0.5 + Math.sin(t * 3.7) * 0.3;
        pose = { aimL: b(0.16 + 0.12 * g), aimR: b(0.08 + 0.08 * Math.sin(t * 2.6 + 1)), elbow: 0.85, headTilt: Math.sin(t * 1.3) * 0.06, headNod: 0.05 + Math.sin(t * 2.9) * 0.05, twist: Math.sin(t * 1.1) * 0.07 };
        break;
      }
      case "walk":
      case "run": {
        pose = {
          phase: this.phase,
          stride: THREE.MathUtils.clamp(0.28 + sp * 0.075, 0.25, 0.78),
          knee: 0.35 + sp * 0.12,
          armSwing: 0.22 + sp * 0.06,
          lean: 0.04 + sp * 0.035,
          elbow: 0.3 + sp * 0.08,
        };
        break;
      }
      case "point":
        pose = { aimR: b(1), elbow: 0.1, headNod: -0.05, twist: b(-0.12) };
        break;
      case "beckon":
        pose = { aimL: b(0.7 + Math.sin(t * 7) * 0.25), elbow: 0.9 + Math.sin(t * 7) * 0.5, twist: b(0.15), lean: -0.05 };
        break;
      case "offer":
        pose = { aimR: b(0.62), elbow: 0.55, lean: b(0.12), headNod: b(0.2) };
        break;
      case "aim":
        pose = { aimR: b(1), aimL: b(0.75), elbow: 0.15, lean: 0.06, twist: b(0.08) };
        break;
      case "hold":
        pose = { reach: b(0.55), elbow: 1.3, lean: 0.08 };
        break;
      case "wave":
        pose = { aimL: b(1.6 + Math.sin(t * 9) * 0.25), elbow: 0.4, headNod: -0.2 };
        break;
      case "crouch":
        pose = { crouch: 0.75 * this.crouch, lean: 0.45, headNod: 0.15, elbow: 0.9, reach: 0.15 };
        break;
      case "sit":
        pose = { crouch: 1.05, lean: -0.1, headNod: 0.35, elbow: 0.6, reach: 0.2 };
        break;
      case "slump":
        pose = { lean: 0.5, headNod: 0.9, crouch: 0.4, elbow: 0.1, headTilt: 0.3 };
        break;
      default: {
        // Idle: breathing, shifting weight.
        pose = { headNod: 0.04 + Math.sin(t * 1.6) * 0.02, elbow: 0.3, lean: Math.sin(t * 1.6) * 0.012, twist: Math.sin(t * 0.4) * 0.03 };
      }
    }

    // Crouching / sitting drops the hips so the feet stay on the floor.
    const drop = this.action === "sit" ? 0.52 : this.crouch * 0.38;
    this.body.position.y += (-drop + (moving ? Math.abs(Math.sin(this.phase)) * 0.03 * Math.min(1, sp / 3) : 0) - this.body.position.y) * k(12);
    // Slumped: down onto the floor.
    this.body.rotation.x = -this.slump * 1.35;
    this.body.position.z = this.slump * 0.6;

    if (this.rig?.valid) {
      const adj = this.adjust;
      pose.lean = (pose.lean ?? 0) + adj.lean;
      pose.headNod = (pose.headNod ?? 0) + adj.headNod;
      pose.twist = (pose.twist ?? 0) + adj.twist;
      this.rig.pose(pose);
      this._lookHead(dt, k);
      this.rig.apply();
    } else {
      this.standIn.rotation.z = moving ? Math.sin(this.phase) * 0.05 : 0;
    }
    // The duffel swings with his stride.
    const duffel = this.bag?.userData.duffel;
    if (duffel) {
      duffel.position.x = 0.24;
      duffel.rotation.z = moving ? Math.sin(this.phase) * 0.12 * Math.min(1, sp / 3) : 0;
      duffel.rotation.x = moving ? -0.1 - sp * 0.02 : 0;
    }
    this._placeProps();
    this.shadow.scale.setScalar(1 - this.slump * 0.2);
  }

  _lookHead(dt, k) {
    let yaw = 0;
    let pitch = 0;
    if (this.lookTarget && this.rig.bones.head) {
      this.root.updateMatrixWorld(true);
      const local = this.root.worldToLocal(_a.copy(this.lookTarget));
      // Root faces -Z; the rig's model space faces +Z and is turned by PI,
      // which leaves a turn about Y the same in both.
      yaw = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -1.2, 1.2) * this.lookWeight;
      // Nod down (positive) or up toward the target, from eye height.
      const eye = 1.62 - this.crouch * 0.38 + this.body.position.y;
      pitch = THREE.MathUtils.clamp(Math.atan2(eye - local.y, Math.hypot(local.x, local.z)), -0.6, 0.9) * this.lookWeight;
    }
    this.headYaw += (yaw - this.headYaw) * k(8);
    this.headPitch = (this.headPitch ?? 0) + (pitch - (this.headPitch ?? 0)) * k(8);
    this.rig.rotate("head", Y, this.headYaw * 0.6);
    this.rig.rotate("neck", Y, this.headYaw * 0.25);
    this.rig.rotate("chest", Y, this.headYaw * 0.15);
    this.rig.rotate("head", _X, this.headPitch * 0.55);
    this.rig.rotate("neck", _X, this.headPitch * 0.35);
  }

  _placeProps() {
    if (!this.props.length) return;
    this.root.updateMatrixWorld(true);
    this.model?.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_qi).invert();
    for (const p of this.props) {
      const hand = this.rig?.bones[`hand${p.hand}`];
      const fore = this.rig?.bones[`forearm${p.hand}`];
      if (!hand || !fore) {
        p.object.position.set(p.hand === "R" ? 0.32 : -0.32, 1.0, -0.25);
        continue;
      }
      hand.getWorldPosition(_a);
      fore.getWorldPosition(_b);
      _dir.subVectors(_a, _b).normalize().applyQuaternion(_qi);
      this.root.worldToLocal(_a);
      p.object.position.copy(_a);
      _q.setFromUnitVectors(_fwd, _dir);
      p.object.quaternion.copy(_q).multiply(_qe.setFromEuler(p.rotation));
      p.object.position.add(_b.copy(p.offset).applyQuaternion(p.object.quaternion));
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.shadowMaterial.map?.dispose();
    this.shadowMaterial.dispose();
    this.shadow.geometry.dispose();
  }
}
