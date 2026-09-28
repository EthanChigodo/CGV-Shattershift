/**
 * Subject 07's acting in the lift: the character reacts to what is happening
 * instead of standing still.
 *
 * It drives Level 3's PlayerAvatar directly - the vertex-shader rig's
 * controls (characters.js: uCrouch, uTuck, uLean, uReachUp, uHold,
 * uArmSwing/uPhase, uStride) plus the body's own transform - from a few
 * layered behaviours:
 *
 *   idle     breathing, small weight shifts, arms settling, and looking
 *            around (out at the city, down, back at the doors)
 *   react    a flinch toward/away from something: a lurch, a half-crouch,
 *            the body turning to it
 *   stumble  thrown off balance: staggered steps, arms out, then catching it
 *   brace    knees bent, weight forward, arms a little out - holding on
 *   fear     builds with every scare and fades slowly: heavier, faster
 *            breathing, quicker nervous glances, arms held up in front,
 *            a lower stance
 *   gravity  the body is a physical thing in the cabin's felt gravity: it
 *            drifts up off the floor in free fall (knees tucking, arms
 *            reaching and paddling), and slams down into a deep crouch when
 *            the brakes bite, then gets back up
 *   pickUp / hold   step 4: the launcher
 *
 * Every control eases toward its target at its own rate, so the behaviours
 * blend rather than snap. Local frame: feet at y = 0 in the cabin, yaw 0 =
 * facing -Z (out over the city).
 */

import * as THREE from "../three.js";

const ease = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));

export class Performer {
  /**
   * @param {import("../levels/meltdown/player.js").PlayerAvatar} avatar
   * @param {object} [o]
   * @param {THREE.Vector3} [o.home]  where they stand in the cabin
   */
  constructor(avatar, { home = new THREE.Vector3(-0.35, 0, 0.35), reduced = false } = {}) {
    this.avatar = avatar;
    this.home = home.clone();
    this.reduced = reduced;
    this.time = 0;
    // Current (eased) values of every control.
    this.c = { crouch: 0, tuck: 0, lean: 0, side: 0, reach: 0, hold: 0, swing: 0.05, stride: 0, yaw: 0, pitch: 0 };
    // Behaviour state.
    this.brace = 0;
    this.flinch = 0;
    this.flinchSide = 0;
    this.lookYaw = 0;
    this.lookHold = 0;
    this.stagger = new THREE.Vector3();
    this.staggerV = new THREE.Vector3();
    this.stepping = 0;
    this.phase = 0;
    this.floatY = 0;
    this.floatV = 0;
    this.impact = 0;
    this.tumble = 0;
    this.tumbleV = 0;
    this.fear = 0;
    this.breathPhase = 0;
    /** Extra control targets a scripted moment can set (the pickup). */
    this.override = null;
    this.attention = null;
  }

  /** Where the body is now, in the cabin's frame (for cameras). */
  get position() {
    return this.avatar.root.position;
  }

  /**
   * Flinch at something. `yaw` is the direction it came from (0 = ahead,
   * +PI/2 = to their left); they turn toward it.
   */
  react(yaw = 0, strength = 1) {
    this.flinch = Math.min(1, this.flinch + strength);
    this.scare(strength * 0.5);
    this.flinchSide = Math.sign(Math.sin(yaw)) || 1;
    this.look(yaw, 1.8);
  }

  /** Thrown off balance by (dx, dz) metres. */
  stumble(dx, dz, strength = 1) {
    if (this.floatY > 0.05) return;
    this.scare(strength * 0.3);
    this.staggerV.x += dx * 3.2;
    this.staggerV.z += dz * 3.2;
    this.stepping = Math.max(this.stepping, 0.55 * strength);
    this.flinch = Math.min(1, this.flinch + 0.5 * strength);
    this.flinchSide = -Math.sign(dx) || 1;
  }

  /** Raise the fear level (0..1). */
  scare(amount) {
    this.fear = Math.min(1, this.fear + amount);
  }

  /** Turn to look at a direction (cabin yaw) for a while. */
  look(yaw, seconds = 2) {
    this.lookYaw = yaw;
    this.lookHold = seconds;
  }

  /** How hard to hold on, 0..1. */
  setBrace(amount) {
    this.brace = amount;
  }

  /** The floor drops away or kicks: an upward shove (m/s). */
  jolt(up) {
    this.floatV += up;
    this.floatY = Math.max(this.floatY, 0.001);
    this.tumbleV += (Math.random() - 0.5) * 0.6;
  }

  update(dt, gEff) {
    this.time += dt;
    const t = this.time;
    const c = this.c;
    const calm = this.reduced ? 0.5 : 1;

    // ---- Gravity: the body in the cabin's felt gravity. ----
    if (this.floatY > 0 || this.floatV > 0) {
      this.floatV -= gEff * dt;
      this.floatY += this.floatV * dt;
      // Head on the ceiling (the cabin is 3.2 m tall).
      if (this.floatY > 1.25) {
        this.floatY = 1.25;
        this.floatV = -Math.abs(this.floatV) * 0.3;
      }
      if (this.floatY <= 0) {
        // Landing: how hard decides how deep they drop.
        const hit = Math.min(1, Math.max(0, -this.floatV) / 5);
        if (hit > 0.08) {
          this.impact = Math.max(this.impact, hit);
          this.flinch = Math.min(1, this.flinch + hit);
        }
        this.floatY = 0;
        this.floatV = 0;
      }
    }
    // Heavy felt gravity (the brakes slamming) drives them down even when
    // their feet are already on the floor.
    if (this.floatY <= 0 && gEff > 16) {
      this.impact = Math.max(this.impact, Math.min(1, (gEff - 16) / 40));
      this.scare(dt * 2);
    }
    const airborne = this.floatY > 0.03;
    this.impact = Math.max(0, this.impact - dt * 0.45);
    this.fear = Math.max(0, this.fear - dt * 0.09);
    // A slow tumble while weightless; it rights itself on landing.
    if (airborne) {
      this.tumbleV += (Math.random() - 0.5) * dt * 0.4;
      this.tumble += this.tumbleV * dt;
      this.tumble = THREE.MathUtils.clamp(this.tumble, -0.45, 0.45);
    } else {
      this.tumble = ease(this.tumble, 0, 8, dt);
      this.tumbleV = 0;
    }

    // ---- Stagger: a sprung offset from home, with steps while it moves. ----
    this.staggerV.addScaledVector(this.stagger, -26 * dt).multiplyScalar(Math.max(0, 1 - 6 * dt));
    this.stagger.addScaledVector(this.staggerV, dt);
    this.stepping = Math.max(0, this.stepping - dt);
    if (this.stepping > 0) this.phase += dt * 9;

    // ---- Where they look: held glances, else idle looking around. ----
    this.lookHold -= dt;
    let yaw = this.lookYaw;
    if (this.lookHold <= 0) {
      // Idle: out at the city, a glance left, down at the floor, back -
      // quicker, jumpier glances when scared.
      const beat = Math.floor(t / (2.6 - 1.4 * this.fear)) % 4;
      yaw = [0.05, 0.55, -0.35, 0.2][beat] * (1 + this.fear * 0.4);
    }
    if (this.attention !== null) yaw = this.attention;

    // ---- Targets. ----
    this.flinch = Math.max(0, this.flinch - dt * 1.6);
    const f = this.flinch;
    const b = Math.max(this.brace, this.impact * 0.6);
    const fear = this.fear;
    // Breathing: calm and slow, or fast and heavy after a scare.
    this.breathPhase += dt * (1.7 + 3.2 * fear);
    const breath = Math.sin(this.breathPhase);
    const target = {
      crouch: b * 0.34 + f * 0.12 + this.impact * 0.62 + fear * 0.08,
      tuck: airborne ? 0.55 + 0.25 * Math.sin(t * 1.3) : 0,
      lean: (0.03 + 0.04 * fear) * breath + b * 0.18 + this.impact * 0.3 - f * 0.12 + fear * 0.06 + (airborne ? -0.15 : 0),
      side: 0.035 * Math.sin(t * 0.37) * calm + f * 0.12 * this.flinchSide,
      reach: airborne ? 0.55 + 0.2 * Math.sin(t * 2.1) : f * 0.15,
      // Arms: forearms come up in front, protective, when braced or scared.
      hold: airborne ? 0 : Math.min(0.55, b * 0.35 + fear * 0.3 + f * 0.2),
      swing: airborne ? 0.55 : this.stepping > 0 ? 0.6 : 0.06 + b * 0.25 + f * 0.3,
      stride: this.stepping > 0 ? 0.45 : 0,
      yaw,
      pitch: -0.08 * f + this.tumble,
    };
    if (this.override) Object.assign(target, this.override);

    c.crouch = ease(c.crouch, target.crouch, this.impact > 0.3 ? 18 : 6, dt);
    c.tuck = ease(c.tuck, target.tuck, 5, dt);
    c.lean = ease(c.lean, target.lean, 7, dt);
    c.side = ease(c.side, target.side, 6, dt);
    c.reach = ease(c.reach, target.reach, 4, dt);
    c.hold = ease(c.hold, target.hold, 5, dt);
    c.swing = ease(c.swing, target.swing, 5, dt);
    c.stride = ease(c.stride, target.stride, 10, dt);
    c.yaw = ease(c.yaw, target.yaw, 2.8, dt);
    c.pitch = ease(c.pitch, target.pitch, 6, dt);
    // Arms: slow paddling when weightless, quick when staggering, a settle otherwise.
    const armRate = airborne ? 2.2 : this.stepping > 0 ? 9 : 0.9;
    if (this.stepping <= 0) this.phase += dt * armRate;

    this._apply(breath);
  }

  _apply(breath) {
    const a = this.avatar;
    const c = this.c;
    const u = a.uniforms;
    if (u) {
      u.uPhase.value = this.phase;
      u.uStride.value = c.stride;
      u.uArmSwing.value = c.swing;
      u.uLean.value = c.lean;
      u.uCrouch.value = c.crouch;
      u.uTuck.value = c.tuck;
      u.uHold.value = c.hold;
      u.uReachUp.value = c.reach;
    }
    // The rig drops the whole body by 0.42 m per unit of crouch (it was made
    // for sliding); lift it back so the feet stay on the floor in a squat.
    const lift = c.crouch * 0.3 + c.tuck * 0.1;
    a.root.position.set(this.home.x + this.stagger.x, this.home.y + this.floatY + lift, this.home.z + this.stagger.z);
    a.root.rotation.y = c.yaw;
    a.body.rotation.set(c.pitch, 0, c.side);
    a.body.position.y = (0.004 + 0.006 * this.fear) * breath;
    // Contact shadow stays on the floor and fades as they lift off it.
    a.shadow.position.y = 0.025 - this.floatY - lift;
    a.shadowMaterial.opacity = Math.max(0.2, 1 - this.floatY * 1.2);
  }
}
