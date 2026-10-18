/**
 * Procedural life for the people the player fights: the escaped patients
 * (the roof, the Labs' corridor) and the roof's scientists.
 *
 * Beta feedback pointed at another team's game for its "creative and
 * realistic figures". Watching ours frame by frame next to theirs, three
 * things gave ours away as puppets:
 *
 *  1. A crowd of clones. Every patient shambled with the same pose, the same
 *     cadence and the same speed - only a phase offset apart, so a wave
 *     marched in near lockstep.
 *  2. Hits that didn't land. The stagger tipped the body about the WORLD's
 *     X axis whichever way they faced, and never by where the shot came
 *     from: hit from the side, a patient facing you barely moved.
 *  3. A frozen death. A killing shot held the body rigid - legs splayed,
 *     arms flung - for the second and a half it burned away.
 *
 * Their figures are mocap clips; ours have no clips at all (HumanoidRig in
 * characters.js poses any skeleton from a few numbers). So each fix is a
 * small piece of procedural animation on top of HumanoidRig.pose(), costing
 * a few trig calls and one spring per person - no physics engine:
 *
 *   persona(seed)          who this patient is: their pace and cadence, a
 *                          limp, a dragged foot or a lurching gait, a hunch,
 *                          which arm reaches further, a head tilt, twitches
 *   shamble(rig, p, t, o)  the zombie gait, built from the persona
 *   Flinch                 a hit reaction: a damped spring in the body's own
 *                          frame, kicked by the direction of the hit - the
 *                          torso whips away, overshoots and settles, the
 *                          head lags it
 *   Collapse               death: the blow's jolt, then the knees go (they
 *                          accelerate like a fall), the torso folds over
 *                          them, the arms hang and swing on, the head lolls,
 *                          and the body tips over to one side - while it
 *                          burns away (ash.js), so nothing is left lying
 *
 *   const p = persona(seed);
 *   shamble(rig, p, time, { reach: 0.9, lean: 0.3 });   // instead of rig.pose()
 *   position += dir * speed * stride(p, time) * dt;      // their own pace
 *
 *   const flinch = new Flinch();
 *   flinch.hit(shooterPosition, position, yaw, power);
 *   flinch.update(dt); flinch.apply(rig, body);           // after the pose
 *
 *   const collapse = new Collapse(rig, p);
 *   collapse.start(shooterPosition, position, yaw);
 *   collapse.update(dt, body);                            // each frame, while down
 *
 * The rig's rotations are model-space (+Z forward, +Y up), and `body` is the
 * group that turns the person to `yaw`; its rotation order is set to YXZ so a
 * tilt is about the body's own axes, not the world's.
 */

import * as THREE from "../three.js";

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _e = new THREE.Euler();
const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

/** A small seeded random generator (mulberry32): the same seed, the same person. */
function random(seed) {
  let s = (Math.floor(Math.abs(seed) * 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A repeatable 0..1 value for an integer (which twitches fire, which way). */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** How the gaits are shared out across a crowd. */
const GAITS = [
  ["limp", 0.36],    // a bad leg: a quick, short step onto it, the hips dropping over it
  ["drag", 0.24],    // a stiff leg dragged behind, the toe scraping
  ["lurch", 0.22],   // surges forward, then stalls - steady at nothing
  ["steady", 0.18],  // a plain shamble (still their own pace and arms)
];

/**
 * Who a patient is, from a seed. Every number is the persona's own; nothing
 * changes once made except the gait's clock (shamble keeps it here).
 */
export function persona(seed = Math.random() * 1e6) {
  const r = random(seed);
  let pick = r();
  let gait = "steady";
  for (const [name, share] of GAITS) {
    if (pick < share) {
      gait = name;
      break;
    }
    pick -= share;
  }
  return {
    seed,
    gait,
    phase: r() * 20,
    /** Walking speed, x the level's (0.82..1.18). */
    pace: 0.82 + r() * 0.36,
    /** Steps per second, x the level's. */
    cadence: 0.85 + r() * 0.35,
    /** The bad leg (limp, drag) and the further-reaching arm: 1 = left, -1 = right. */
    side: r() < 0.5 ? 1 : -1,
    limp: gait === "limp" ? 0.6 + r() * 0.4 : 0,
    drag: gait === "drag" ? 0.65 + r() * 0.35 : 0,
    lurch: gait === "lurch" ? 0.6 + r() * 0.4 : r() * 0.15,
    lurchEvery: 1.5 + r() * 1.5,
    /** Extra forward hunch of the back. */
    hunch: r() * 0.22,
    /** How far each arm reaches, x the pose's reach: [left, right]. */
    reach: [0.6 + r() * 0.65, 0.6 + r() * 0.65],
    /** A head held on one side. */
    headTilt: (r() - 0.5) * 0.6,
    /** Mean seconds between twitches, and how hard they are. */
    twitchEvery: 1.3 + r() * 2.4,
    twitch: 0.5 + r() * 0.5,
    // The gait's own clock (shamble advances it).
    clock: null,
    cycle: 0,
  };
}

/**
 * A lurcher's surge at time t: 1 at rest; a burst forward (up to 1 + 1.1 x
 * lurch) then a stall (down to 1 - 0.5 x lurch), every `lurchEvery` seconds.
 */
function surge(p, t) {
  const k = (((t + p.phase) / p.lurchEvery) % 1 + 1) % 1;
  const burst = smooth(k, 0, 0.1) * (1 - smooth(k, 0.12, 0.38));
  const stall = smooth(k, 0.45, 0.6) * (1 - smooth(k, 0.65, 0.95));
  return { burst, stall, factor: 1 + p.lurch * (1.1 * burst - 0.5 * stall) };
}

/** A persona's speed multiplier at time t (its pace, with its surges and stalls). */
export function stride(p, t) {
  return p.pace * surge(p, t).factor;
}

/**
 * The zombie gait, from a persona: HumanoidRig.pose() with the persona's
 * own numbers, then what pose() can't say on its own, then apply().
 *
 * @param {import("../levels/meltdown/characters.js").HumanoidRig} rig
 * @param {object} p   a persona()
 * @param {number} t   seconds (the level's clock)
 * @param {object} [o] the level's shamble: reach, lean, stride, knee, cadence
 *   (radians of gait phase per second at a persona cadence of 1), amount
 *   (0 standing .. 1 walking), look (yaw of the head toward something, in
 *   the body's frame, radians)
 */
export function shamble(rig, p, t, { reach = 0.9, lean = 0.3, stride: legs = 0.35, knee = 0.6, cadence = 4.2, amount = 1, look = 0 } = {}) {
  if (!rig) return;
  // The gait's clock runs at the persona's cadence, faster in a surge, so
  // the feet keep up with the body instead of skating.
  const dt = p.clock === null ? 0 : clamp(t - p.clock, 0, 0.1);
  p.clock = t;
  const s = surge(p, t);
  p.cycle += dt * cadence * p.cadence * (0.7 + 0.3 * s.factor) * (0.35 + 0.65 * amount);
  const base = p.cycle + p.phase;
  // A limp: the step onto the bad leg is short and quick, the step off it
  // long - the cycle is warped so one half runs faster than the other.
  const phase = base + p.side * p.limp * 0.5 * Math.sin(base);
  const side = p.side > 0 ? "L" : "R";
  const sideSign = p.side > 0 ? 1 : -1;
  // The bad leg's stance (its foot planted, carrying the weight): left
  // stance is where sin(phase) falls, right where it rises.
  const stance = Math.max(0, -Math.cos(phase) * sideSign);

  // Arms: each reaches its own height (pose() raises both by `reach`; the
  // extra goes on with aimL / aimR, which add to one arm only).
  const reachL = p.reach[0] * reach;
  const reachR = p.reach[1] * reach;
  const low = Math.min(reachL, reachR);
  const lurchLean = p.lurch * (0.28 * s.burst - 0.12 * s.stall);
  rig.pose({
    phase,
    stride: legs * amount * (1 - 0.3 * p.drag) * (1 + 0.25 * s.burst * p.lurch),
    knee,
    reach: low + 0.2 * s.burst * p.lurch,
    aimL: ((reachL - low) * 1.35) / 1.45,
    aimR: ((reachR - low) * 1.35) / 1.45,
    lean: lean + p.hunch + lurchLean,
    headTilt: p.headTilt + Math.sin(t * 1.7 + p.phase) * 0.22,
    headNod: 0.15 + p.hunch * 0.8,
    elbow: 0.25 + p.hunch,
    spread: 0.05,
  });

  // The arms drift on their own, out of step with each other.
  rig.rotate("armL", X, -0.14 * Math.sin(t * 1.3 + p.phase));
  rig.rotate("armR", X, -0.14 * Math.sin(t * 1.1 + p.phase * 1.7));

  // Limp: the torso lurches over the bad leg while it carries the weight
  // (the hip on the other side drops), and the head rights itself against it.
  if (p.limp > 0) {
    const legX = rig.legSide?.[side] ?? sideSign;
    rig.rotate("spineLow", Z, -legX * p.limp * 0.2 * stance * amount);
    rig.rotate("head", Z, legX * p.limp * 0.1 * stance * amount);
  }

  // Drag: the stiff leg barely swings and never bends; the hip hikes it
  // round and the toe trails on the floor.
  if (p.drag > 0) {
    const swing = Math.sin(phase) * sideSign;
    const bend = Math.max(0, -Math.sin(phase + (side === "L" ? 0 : Math.PI) + 0.9)) * knee;
    const legX = rig.legSide?.[side] ?? sideSign;
    rig.rotate(`thigh${side}`, X, swing * legs * amount * p.drag * 0.75);
    rig.rotate(`calf${side}`, X, -bend * p.drag * 0.9);
    rig.rotate(`foot${side}`, X, 0.5 * p.drag);
    rig.rotate(`thigh${side}`, Z, legX * 0.14 * p.drag * Math.abs(Math.sin(phase)) * amount);
    rig.rotate("spineLow", Z, legX * 0.08 * p.drag * amount);
  }

  // Breathing: the chest heaves (they are winded, not dead yet).
  rig.rotate("chest", X, Math.sin(t * 2.1 + p.phase) * 0.035);

  // Twitches: every so often (not every interval) the head snaps aside and
  // a shoulder jerks - a sharp attack and a quick decay.
  const ti = (t + p.phase * 3) / p.twitchEvery;
  const n = Math.floor(ti);
  const local = (ti - n) * p.twitchEvery;
  if (hash(n + p.seed) > 0.35 && local < 0.4) {
    const env = Math.sin(Math.min(1, local / 0.05) * Math.PI * 0.5) * Math.exp(-local * 11) * p.twitch;
    const dir = hash(n * 3.1 + p.seed) < 0.5 ? -1 : 1;
    rig.rotate("head", Y, dir * 0.6 * env);
    rig.rotate("head", Z, -dir * 0.35 * env);
    rig.rotate(hash(n * 7.7 + p.seed) < 0.5 ? "armL" : "armR", Z, dir * 0.35 * env);
    rig.rotate("chest", Y, dir * 0.12 * env);
  }

  // Looking at something off to the side: the neck and head share it.
  if (look) {
    const yaw = clamp(look, -1.1, 1.1);
    rig.rotate("neck", Y, yaw * 0.4);
    rig.rotate("head", Y, yaw * 0.5);
  }
  rig.apply();
}

/**
 * A hit reaction: the upper body as a damped spring (pitch, roll and twist
 * in the body's own frame), kicked by the hit's direction. Underdamped, so
 * it whips away, overshoots a little and settles in about half a second;
 * the head lags behind the torso (it turns against the spring's velocity).
 * A third of the tilt goes on the whole body, the rest bends the spine.
 */
export class Flinch {
  constructor({ stiffness = 170, damping = 9.5 } = {}) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.pitch = 0;
    this.roll = 0;
    this.twist = 0;
    this.vPitch = 0;
    this.vRoll = 0;
    this.vTwist = 0;
  }

  /**
   * @param {THREE.Vector3|null} from  where the hit came from (world); null: from the front
   * @param {THREE.Vector3} at         the body's position (world)
   * @param {number} yaw               which way the body faces (it faces +Z turned by yaw)
   * @param {number} [power]           ~1 a normal hit
   */
  hit(from, at, yaw = 0, power = 1) {
    if (from) _d.subVectors(at, from).setY(0);
    else _d.set(0, 0, 0);
    // No direction: from straight in front (pushed straight back).
    if (_d.lengthSq() < 1e-6) _d.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _d.normalize();
    // The push, in the body's frame (+Z its front, +X its left).
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const sideways = _d.x * c - _d.z * s;
    const forward = _d.x * s + _d.z * c;
    const k = 9 * clamp(power, 0.4, 1.6);
    // Pushed forward tips the top forward (+pitch); pushed to +X tips it
    // toward +X (-roll). A blow to one side turns the shoulders with it.
    this.vPitch += forward * k;
    this.vRoll += -sideways * k;
    this.vTwist += sideways * k * 0.45 + (hash(at.x * 13.1 + at.z * 7.3) - 0.5) * k * 0.3;
  }

  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / steps;
    const k = this.stiffness;
    const c = this.damping;
    for (let i = 0; i < steps; i += 1) {
      this.vPitch += (-k * this.pitch - c * this.vPitch) * h;
      this.vRoll += (-k * this.roll - c * this.vRoll) * h;
      this.vTwist += (-k * 0.8 * this.twist - c * this.vTwist) * h;
      this.pitch += this.vPitch * h;
      this.roll += this.vRoll * h;
      this.twist += this.vTwist * h;
    }
  }

  /** 0..1, how far into a flinch the body is (for a host that wants to drop its guard). */
  get amount() {
    return Math.min(1, Math.hypot(this.pitch, this.roll) * 3);
  }

  /** Bend the posed rig (call after its pose) and tilt the body. */
  apply(rig, body) {
    if (body) {
      body.rotation.order = "YXZ";
      body.rotation.x = this.pitch * 0.35;
      body.rotation.z = this.roll * 0.35;
    }
    if (!rig) return;
    rig.rotate("spineLow", X, this.pitch * 0.45);
    rig.rotate("spineLow", Z, this.roll * 0.45);
    rig.rotate("chest", X, this.pitch * 0.35);
    rig.rotate("chest", Z, this.roll * 0.3);
    rig.rotate("chest", Y, this.twist);
    // Whiplash: the head trails the torso.
    rig.rotate("head", X, -this.vPitch * 0.03);
    rig.rotate("head", Z, -this.vRoll * 0.03);
    // The arms are thrown a little by it.
    rig.rotate("armL", X, this.vPitch * 0.03);
    rig.rotate("armR", X, this.vPitch * 0.03);
    rig.apply();
  }
}

/**
 * Death, without a ragdoll: a sequence of springs and falls on the rig.
 * The killing blow jolts the body (a Flinch); the knees give - their bend
 * accelerating, like a fall, not easing; the torso folds over them; the
 * hips drop by exactly what the bent legs lose, and move back so the feet
 * stay planted; the arms go limp, hanging toward the floor and swinging on
 * after the body stops (follow-through); the head lolls; and the whole body
 * tips over about the feet, the way the blow pushed it and to one side.
 */
export class Collapse {
  constructor(rig, p = null) {
    this.rig = rig;
    this.side = p?.side ?? (Math.random() < 0.5 ? 1 : -1);
    this.t = 0;
    this.flinch = new Flinch({ stiffness: 120, damping: 8 });
    this.tip = new THREE.Vector2(0.3 * this.side, 1).normalize();
  }

  /** The killing blow: from where (world, or null), on whom, facing which way. */
  start(from, at, yaw = 0, power = 1.4) {
    this.t = 0;
    this.flinch.hit(from, at, yaw, power);
    // Which way they go down: forward over their knees, to one side, and
    // with the blow (a blow from behind puts them on their face, one from
    // the front makes them sit back first).
    const pushSide = -this.flinch.vRoll;
    const pushFwd = this.flinch.vPitch;
    this.tip.set(0.55 * this.side + 0.06 * pushSide, 0.75 + 0.05 * pushFwd).normalize();
  }

  update(dt, body = null) {
    this.t += dt;
    const t = this.t;
    this.flinch.update(dt);
    const fall = (a, b) => {
      const k = clamp((t - a) / (b - a), 0, 1);
      return k * k;
    };
    // The knees go, the torso folds, then the body tips over.
    const buckle = fall(0.05, 0.6);
    const slump = smooth(t, 0.12, 0.85);
    const topple = fall(0.45, 1.4);
    const crouch = 1.3 * buckle;
    // Arms hang under gravity (the torso's lean, undone) and swing on.
    const lean = 0.75 * slump;
    const torso = 0.45 * lean + 0.2 * crouch + 0.35 * lean;
    const swing = 0.4 * Math.sin((t - 0.25) * 7.5) * Math.exp(-Math.max(0, t - 0.25) * 2.6) * smooth(t, 0.2, 0.35);
    const rig = this.rig;
    if (rig) {
      rig.pose({
        crouch,
        lean,
        reach: torso / 1.35 - 0.08 + swing,
        elbow: 0.15 + 0.25 * slump,
        headNod: 0.85 * slump + 0.25 * Math.sin(t * 9) * Math.exp(-t * 4),
        headTilt: this.side * 0.45 * slump,
        spread: -0.04 * buckle,
      });
      this.flinch.apply(rig, null);
      // Hips down by what the folded legs lose, and back so the feet stay
      // put (pose()'s crouch: thigh 0.9 x crouch forward, calf 1.6 x back).
      const leg = (rig.hipHeight ?? 0.95) * 0.5;
      const drop = leg * (2 - Math.cos(0.9 * crouch) - Math.cos(0.7 * crouch));
      const back = leg * (Math.sin(0.9 * crouch) - Math.sin(0.7 * crouch));
      // Tip over about the feet: rotate, and carry the offset round with it.
      const angle = 0.75 * topple;
      _e.set(this.tip.y * angle, 0, -this.tip.x * angle);
      rig.root.rotation.copy(_e);
      rig.root.position.set(0, -drop, -back).applyEuler(_e);
    }
    if (body) {
      body.rotation.order = "YXZ";
      body.rotation.x = this.flinch.pitch * 0.3 + (rig ? 0 : 0.9 * topple);
      body.rotation.z = this.flinch.roll * 0.3;
    }
  }
}
