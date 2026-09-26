/**
 * The player's body for Level 3.
 *
 * Wraps one of the two player models (player_female / player_male, see
 * characters.js) with everything the host needs to make it look alive
 * without a skeleton:
 *
 *  - the vertex-shader rig (characters.js `rigPlayerMesh`) driven from the
 *    runner's real state: stride and cadence from running speed, arms swing
 *    against the legs, both hands on the launcher, knees tucked in a jump,
 *    body dropped and leaning back in a slide;
 *  - a lean into lane changes and a lurch on a stumble;
 *  - a soft contact shadow, because nothing else in this level casts one
 *    and a runner without one floats;
 *  - a mount point on the right shoulder for the launcher.
 *
 * It starts as a stand-in (capsule and gown) and swaps to the real model
 * whenever `setModel` is called, so the run can begin before models arrive.
 * Local space: feet on y = 0, facing -Z (the direction of travel).
 */

import * as THREE from "../../three.js";
import { cloneCharacter, rigPlayerMesh } from "./characters.js";

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.6)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.3)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class PlayerAvatar {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = "PlayerRoot";
    this.body = new THREE.Group();
    this.body.name = "Avatar";
    this.root.add(this.body);

    // Stand-in until the chosen model arrives.
    this.standIn = new THREE.Group();
    const skin = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.05, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8f877c, roughness: 0.85 }));
    skin.position.y = 1.1;
    const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0x3f8f88, roughness: 0.9 }));
    gown.position.y = 0.95;
    this.standIn.add(skin, gown);
    this.body.add(this.standIn);

    this.shoulder = new THREE.Object3D();
    this.shoulder.name = "LauncherMount";
    this.shoulder.position.set(0.3, 1.45, 0.05);
    this.body.add(this.shoulder);

    this.shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 1 });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), this.shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.025;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    this.model = null;
    this.uniforms = null;
    this.phase = 0;
    this.lean = 0;
    this.tuck = 0;
    this.crouch = 0;
    this.lurch = 0;
    /** 1 = both hands on the launcher (default); 0 = arms free. */
    this.hold = 1;
    /** 0..1 arms overhead - set by the host for the ladder. */
    this.reachUp = 0;
  }

  /** Swap in a prepared character template (from loadMeltdownAssets). */
  setModel(template) {
    if (this.model) {
      this.body.remove(this.model);
      this.model = null;
    }
    const model = cloneCharacter(template);
    const mesh = model.getObjectByName("CharacterMerged");
    if (!mesh) return;
    const { uniforms, body } = rigPlayerMesh(mesh);
    // Models face +Z; the runner travels down -Z.
    model.rotation.y = Math.PI;
    this.model = model;
    this.uniforms = uniforms;
    this.body.add(model);
    this.standIn.visible = false;
    // Seat the launcher on the right shoulder (model -X, so +X once turned).
    this.shoulder.position.set(body.shoulderX + 0.08, body.shoulderY + 0.12, 0.02);
    this.shoulderBase = this.shoulder.position.clone();
    this.bodyInfo = body;
  }

  /**
   * @param {number} dt
   * @param {object} s
   * @param {number} s.speed         forward speed, m/s (0 = standing)
   * @param {number} s.lateralVel    sideways speed, m/s (for leaning)
   * @param {number} s.height        feet above the floor
   * @param {boolean} s.sliding
   * @param {boolean} s.pushing      shouldering a fallen duct
   * @param {number} s.stumble       0..1, a hit just landed
   * @param {boolean} s.aiming       the trigger is held
   */
  update(dt, { speed = 0, lateralVel = 0, height = 0, sliding = false, pushing = false, stumble = 0, aiming = false } = {}) {
    const k = (rate) => 1 - Math.exp(-dt * rate);
    const running = speed > 0.5 || pushing;
    // Cadence rises with speed but stride does most of the work, the way
    // sprinting really goes: ~2.6 steps/s at 8 m/s, ~3.2 at 14.
    const cadence = pushing ? 1.4 : 1.9 + speed * 0.1;
    if (running && height <= 0.02) this.phase += dt * cadence * Math.PI * 2 * 0.5;
    this.tuck += ((height > 0.05 ? 1 : 0) - this.tuck) * k(height > 0.05 ? 16 : 22);
    this.crouch += ((sliding ? 1 : 0) - this.crouch) * k(sliding ? 20 : 10);
    this.lean += (THREE.MathUtils.clamp(-lateralVel * 0.035, -0.28, 0.28) - this.lean) * k(10);
    this.lurch += (stumble - this.lurch) * k(12);

    this.body.rotation.z = this.lean;
    this.body.rotation.x = -this.lurch * 0.35;
    this.body.position.y = running && height <= 0.02 && !sliding ? Math.abs(Math.sin(this.phase)) * 0.06 : 0;

    const u = this.uniforms;
    if (u) {
      u.uPhase.value = this.phase;
      u.uStride.value = pushing ? 0.3 : running ? THREE.MathUtils.clamp(0.45 + speed * 0.028, 0.45, 0.85) * (1 - this.tuck) : 0;
      u.uArmSwing.value = running ? 0.55 * (1 - this.crouch * 0.6) : 0.05;
      u.uLean.value = (running ? 0.12 + speed * 0.008 : 0) + (pushing ? 0.35 : 0) - this.crouch * 0.55;
      u.uCrouch.value = this.crouch;
      u.uTuck.value = this.tuck;
      u.uHold.value = this.hold;
      u.uReachUp.value = this.reachUp;
      // The shader leans the torso about the hips and drops the body into a
      // slide; the launcher on the shoulder has to go with it or the hands
      // slide off the tube. (Model faces +Z, the body faces -Z, so a
      // model-space lean of +a about X is -a here.)
      if (this.shoulderBase && this.bodyInfo) {
        const angle = -(u.uLean.value + u.uCrouch.value * 0.25);
        const hip = this.bodyInfo.hipY;
        const y = this.shoulderBase.y - hip;
        const z = this.shoulderBase.z;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        this.shoulder.position.set(this.shoulderBase.x, hip + y * c - z * s - u.uCrouch.value * 0.42 - u.uTuck.value * 0.15, y * s + z * c);
        this.shoulder.rotation.x = angle;
      }
    } else {
      this.standIn.scale.y = 1 - this.crouch * 0.45;
      this.standIn.rotation.z = running ? Math.sin(this.phase * 2) * 0.05 : 0;
    }

    // The contact shadow shrinks and fades as the feet leave the floor.
    const lift = THREE.MathUtils.clamp(height / 1.6, 0, 1);
    this.shadow.position.y = 0.025 - height; // stays on the floor under a jump
    this.shadow.scale.setScalar((1 - lift * 0.45) * (sliding ? 1.25 : 1));
    this.shadowMaterial.opacity = 1 - lift * 0.65;
  }

  setVisible(visible) {
    this.body.visible = visible;
  }
}
