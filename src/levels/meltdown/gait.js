/**
 * A running gait for the player's shader rig (Phase 7, the graphics pass).
 *
 * The old cycle swung each leg on a sine. This one plants the feet: each leg
 * has a stance - the foot fixed on the floor while the body runs over it -
 * and a swing - toe-off, the heel kicked up behind, the knee driven forward,
 * and down again in front. Foot targets are solved into hip and knee angles
 * with two-bone IK, so a planted foot really stays put (the checks measure
 * it) and the knee bends the right way. Around that:
 *
 *  - cadence from speed: ~2.6 steps/s at 8 m/s up to 3.2 at 14;
 *  - the pelvis drops on contact and rises in flight (twice per cycle);
 *  - hips twist against the shoulders with the stride;
 *  - lean from acceleration, not just speed;
 *  - a landing squash after a jump.
 *
 * Model space throughout: the model faces +Z, feet on y = 0, the left leg
 * on +X. Angles are in the rig's convention (characters.js): a positive hip
 * angle swings the leg back, a positive knee angle folds the shin back.
 */

const TAU = Math.PI * 2;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Steps per second at a running speed (m/s). */
export function cadenceAt(speed) {
  if (speed < 0.5) return 0;
  return Math.min(3.2, Math.max(1.7, 2.2 + speed * 0.075));
}

export class RunGait {
  /** @param {{hipY:number, kneeY:number}} body  from characters.js measureBody */
  constructor(body) {
    this.hipY = body.hipY;
    this.kneeY = body.kneeY;
    this.thigh = body.hipY - body.kneeY;
    this.shin = body.kneeY;
    this.cycle = 0; // 0..1, the right leg's cycle (the left is half a cycle on)
    this.amp = 0; // 0 standing .. 1 running
    this.speed = 0;
    this.accel = 0;
    this.squash = 0;
    this.out = {
      hipR: 0, kneeR: 0, hipL: 0, kneeL: 0,
      bob: 0, twist: 0, lean: 0, squash: 0, cadence: 0,
      footR: { z: 0, y: 0 }, footL: { z: 0, y: 0 },
      contactR: false, contactL: false,
    };
  }

  /**
   * @param {number} dt
   * @param {object} s  { speed, grounded, landed (a jump just ended), pushing }
   */
  update(dt, { speed = 0, grounded = true, landed = false, pushing = false } = {}) {
    const out = this.out;
    const L = this.thigh + this.shin;
    // Acceleration, smoothed: the body leans into speeding up.
    if (dt > 0) {
      const a = (speed - this.speed) / dt;
      this.accel += (Math.max(-12, Math.min(12, a)) - this.accel) * Math.min(1, dt * 6);
    }
    this.speed = speed;
    const running = speed > 0.5 || pushing;
    this.amp += ((running && grounded ? 1 : 0) - this.amp) * Math.min(1, dt * (running ? 8 : 5));
    const steps = pushing ? 1.4 : cadenceAt(Math.max(speed, running ? 1 : 0));
    out.cadence = steps;
    const cycleTime = steps > 0 ? 2 / steps : 1;
    if (running && grounded) this.cycle = (this.cycle + dt / cycleTime) % 1;
    if (landed) this.squash = 1;
    this.squash = Math.max(0, this.squash - dt * 3.2);

    // How fast a run this is: 0 a walk .. 1 a full run (heel kick, knee drive).
    const runK = Math.min(1, Math.max(0, (speed - 1) / 5));
    // The stance: a share of the cycle that shrinks as you speed up (a walk
    // ~40%, a sprint ~15%), and the distance the planted foot covers under
    // the hip in that time - the leg sweeps at most ~26 degrees either way.
    const targetDuty = Math.max(0.14, Math.min(0.4, 0.38 - 0.016 * speed));
    const contact = Math.min(speed * cycleTime * targetDuty, 0.88 * L);
    // The real share, so the foot moves at exactly the ground speed: planted.
    const duty = speed > 0.1 ? Math.max(0.04, contact / (speed * cycleTime)) : 0.45;
    // The hip is as high as the leg allows at the stance's edges, a little
    // lower at mid-stance (the knee gives), highest in flight.
    const edgeHip = Math.min(L - 0.015, Math.sqrt(Math.max(0, L * L - (contact / 2) ** 2)) * 0.995);
    const top = L - 0.008;
    const flex = 0.025;

    // Pelvis: phase within a step (two per cycle).
    const stepPhase = (this.cycle * 2) % 1;
    const stance = stepPhase < duty * 2 ? stepPhase / (duty * 2) : -1;
    const raw = stance >= 0 ? edgeHip - flex * Math.sin(Math.PI * stance) : edgeHip + (top - edgeHip) * Math.sin((Math.PI * (stepPhase - duty * 2)) / (1 - duty * 2));
    const hipHeight = L + (raw - L) * this.amp;
    out.bob = hipHeight - L;

    const leg = (p, side) => {
      let z;
      let y;
      let planted = false;
      if (p < duty) {
        // Stance: the foot fixed to the floor as the body passes over it.
        z = contact / 2 - (p / duty) * contact;
        y = 0;
        planted = true;
      } else {
        // Swing: toe-off, the heel kicked up behind, the knee driven through,
        // the foot out in front, and down. Keyframes, eased between.
        const s = (p - duty) / (1 - duty);
        // A walk barely lifts the foot; a run kicks the heel up and drives the knee.
        const keys = [
          [0, -contact / 2, 0],
          [0.3, -contact / 2 - 0.3 * L * runK, (0.08 + 0.34 * runK) * L],
          [0.72, (0.12 + 0.26 * runK) * L, (0.06 + 0.15 * runK) * L],
          [1, contact / 2, 0],
        ];
        let i = 1;
        while (i < keys.length - 1 && s > keys[i][0]) i += 1;
        const [s0, z0, y0] = keys[i - 1];
        const [s1, z1, y1] = keys[i];
        const k = smooth(s0, s1, s);
        z = z0 + (z1 - z0) * k;
        y = y0 + (y1 - y0) * k;
      }
      // Standing: feet under the hips.
      z *= this.amp;
      y *= this.amp;
      // Two-bone IK from the hip (at hipHeight) to the foot (z, y).
      const dz = z;
      const dy = y - hipHeight;
      let d = Math.hypot(dz, dy);
      const a = this.thigh;
      const b = this.shin;
      d = Math.min(d, a + b - 1e-4);
      d = Math.max(d, Math.abs(a - b) + 1e-4);
      const phi = Math.atan2(dz, -dy); // from straight down, forward positive
      const alpha = Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))));
      const interior = Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - d * d) / (2 * a * b))));
      const thighForward = phi + alpha; // the knee bends backward, so the thigh sits forward of the line
      const knee = Math.PI - interior;
      // The foot the rig will actually draw (forward kinematics), for checks.
      const kz = Math.sin(thighForward) * a;
      const ky = hipHeight - Math.cos(thighForward) * a;
      const shinAngle = thighForward - knee;
      const foot = { z: kz + Math.sin(shinAngle) * b, y: ky - Math.cos(shinAngle) * b, planted };
      return { hip: -thighForward, knee, foot };
    };

    const right = leg(this.cycle, -1);
    const left = leg((this.cycle + 0.5) % 1, 1);
    out.hipR = right.hip;
    out.kneeR = right.knee;
    out.hipL = left.hip;
    out.kneeL = left.knee;
    out.footR = right.foot;
    out.footL = left.foot;
    out.contactR = right.foot.planted && this.amp > 0.99;
    out.contactL = left.foot.planted && this.amp > 0.99;
    // Hips twist with the stride, the shoulders against them.
    out.twist = Math.sin(this.cycle * TAU) * 0.13 * this.amp;
    // Lean: a little from speed, more from accelerating.
    out.lean = this.amp * (0.06 + Math.min(14, speed) * 0.006) + Math.max(-0.12, Math.min(0.2, this.accel * 0.025));
    out.squash = this.squash;
    return out;
  }
}
