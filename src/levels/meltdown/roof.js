/**
 * Level 3, Phase B - the roof.
 *
 * You come up the stairwell onto the roof of the burning building. The
 * scientists who ran the experiments are up here waiting for their own way
 * out, and they send the last of their test subjects at you. Somewhere a
 * rescue helicopter is inbound - you are never told when.
 *
 *   - Six waves out of the stair hut's door: scientists with gadgets (a
 *     laser that tracks then locks, lobbed grenades with a warning ring, slow
 *     orbs) and patients (melee: they stalk you, wind up, then charge in a
 *     straight line); from the fourth, the two-headed brute.
 *   - Two levels: the roof, and a steel deck on legs over its east side,
 *     up a stair. The east edge and the middle of the west are open (as are
 *     the deck's west and south sides): sidestep a charging patient near one
 *     and they go straight over - but walk off one and so do you.
 *   - The helicopter timer is hidden and random (165-190 s). The only tells
 *     are the rotor sound growing and, late, the helicopter itself.
 *   - It gets worse the longer you are up here (`chaos`): the facade explodes,
 *     the building shudders, ash fills the air. No fire on the roof.
 *   - Clear the roof: the helicopter comes down over the pad and you climb
 *     its rope ladder (victory). Still fighting when it arrives: it cannot
 *     land, so it hangs off the east ledge with the ladder down, and you
 *     have to get to the edge and jump for it before it gives up on you
 *     (survived - or left behind).
 *
 * The level owns the arena, the enemies and their AI, their projectiles, the
 * helicopter and both endings (including where the camera goes). The host
 * owns the player: movement, the launcher, vitality - exactly the split
 * Phase A uses. Everything is in world space around the origin; the host
 * hides Phase A's root while the roof is up.
 *
 *   RoofRoot
 *   |-- Set         slab, parapets, lift and stair huts, the deck, helipad, cover
 *   |-- Hazards     ash
 *   |-- Pickups     ball sacks
 *   |-- Enemies     scientists and patients (their hurtboxes are breakables)
 *   |-- Orbs        the scientists' shots
 *   |-- Weapons     their lasers and grenades
 *   |-- Helicopter
 *   `-- Lights      moon, sky fill, floods, police lights from below
 */

import * as THREE from "../../three.js";
import { createMeltdownKit } from "./kit.js";
import { createFireMaterials } from "./fire.js";
import { fillAssetSlots, assetSlot } from "./assets.js";
import { cloneCharacter, HumanoidRig } from "./characters.js";
import { Helicopter } from "./helicopter.js";
import { createLift, ROOF_LIFT } from "./elevator.js";

/**
 * Half-sizes of the roof: x to +/-EDGE (the east ledge is where the
 * helicopter waits), z to +/-DEPTH. Parapets run along the north and south
 * sides and part of the west; everywhere else the edge is open - and you
 * can go over it.
 */
export const EDGE = 22;
export const DEPTH = 18;
const HELIPAD = new THREE.Vector3(-2, 0, -9);
export const ROOF_SPAWN = new THREE.Vector3(0, 0, 10);
/** The lift housing's doorway (the lift you come up in; see elevator.js). */
const LIFT_DOOR = new THREE.Vector3(0, 0, DEPTH - 3.1);
/**
 * The second level: a steel deck on legs over the east side of the roof,
 * reached by a stair from the south. The high ground - and the scientists'
 * favourite target.
 */
const DECK = { minX: 9, maxX: 19, minZ: -3, maxZ: 7, y: 3.4 };
const STAIR = { minX: 11.2, maxX: 13.4, minZ: 7, maxZ: 13.5 };
/** The stair hut the patients come out of (the "small building"), and its door. */
const HUT = { x: -14, z: -10, w: 8.2, d: 6, h: 3.2 };
const HUT_DOOR = new THREE.Vector3(HUT.x + 1.2, 0, HUT.z + HUT.d / 2);
/** Height a step can climb (onto the stair, never onto the deck from the side). */
const STEP = 0.7;
/** The roof scan is scaled up by this (the user: "the rooftop can be larger"). */
const SCAN_SCALE = 1.4;

/**
 * A scan's surface has pinholes (and a ray down one lands far below): a cell
 * much lower than most of its 5x5 neighbours - or empty with surface all
 * round it - takes their median instead. Edges stay edges.
 */
function fillScanHoles(grid) {
  const { nx, nz } = grid;
  const src = grid.heights;
  const out = src.slice();
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const near = [];
      for (let dj = -2; dj <= 2; dj += 1) {
        for (let di = -2; di <= 2; di += 1) {
          const a = i + di;
          const b = j + dj;
          if ((di || dj) && a >= 0 && b >= 0 && a < nx && b < nz && src[b * nx + a] !== null) near.push(src[b * nx + a]);
        }
      }
      if (near.length < 16) continue; // at an edge: leave it be
      near.sort((x, y) => x - y);
      const median = near[near.length >> 1];
      const h = src[j * nx + i];
      if (h === null || h < median - 1.2) out[j * nx + i] = median;
    }
  }
  return { ...grid, heights: out };
}

/** The built-in layout's points, kept so a scan layout can be undone. */
const BUILT_IN = {
  helipad: HELIPAD.clone(), spawn: ROOF_SPAWN.clone(), lift: LIFT_DOOR.clone(), door: HUT_DOOR.clone(),
  deck: { ...DECK }, stair: { ...STAIR }, hut: { ...HUT },
};

/**
 * Point the shared layout constants at the scanned roof (or back at the
 * built-in one). One roof exists at a time, so the module's points are the
 * current roof's - which keeps every use of them (the enemies' AI, the
 * endings, the host's spawn) as it was.
 */
function applyLayout(scan) {
  Object.assign(DECK, BUILT_IN.deck);
  Object.assign(STAIR, BUILT_IN.stair);
  Object.assign(HUT, BUILT_IN.hut);
  HELIPAD.copy(BUILT_IN.helipad);
  ROOF_SPAWN.copy(BUILT_IN.spawn);
  LIFT_DOOR.copy(BUILT_IN.lift);
  HUT_DOOR.copy(BUILT_IN.door);
  if (!scan) return;
  // No built deck or stair on the scan: its building is the second level.
  Object.assign(DECK, { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 });
  Object.assign(STAIR, { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 });
  const b = scan.building;
  const f = scan.floor;
  HUT_DOOR.copy(scan.door);
  // The lift up from the Skyline: in the open deck west of the building,
  // doors facing north; you walk out of it toward the middle of the roof.
  LIFT_DOOR.set((f.minX + b.minX) / 2 + 1.5, 0, f.maxZ - 3.4);
  ROOF_SPAWN.set(LIFT_DOOR.x + 1.5, 0, LIFT_DOOR.z - 4.6);
  // The pad: the open deck south of the building, toward the east.
  HELIPAD.set((b.minX + b.maxX) / 2 + 3, 0, (b.maxZ + f.maxZ) / 2 + 0.5);
}
/** Fall this far below the roof and you're gone. */
const FALL_LIMIT = -9;
/** Seconds of the arrival: doors open, you walk out, the camera settles. */
const ARRIVAL_SECONDS = 3.4;
const ARRIVAL_CUT = 2.9;
/** Where the arrival hands the camera over: the host's roof camera offsets. */
const ARRIVAL_CAMERA = new THREE.Vector3(0, 11.5, 8.5);
const ARRIVAL_LOOK = new THREE.Vector3(0, 0.6, -3.4);

/** Seconds the helicopter waits at the ledge for you to jump for the ladder. */
export const EXTRACT_WINDOW = 16;
/**
 * The hidden helicopter timer, in seconds (it used to be 40-58: now a long
 * hold-out), and when each of the story's waves comes.
 */
const HELI_SECONDS = [165, 190];
const WAVE_TIMES = [1.2, 24, 48, 74, 100, 126];

const PATIENT = { hp: 2, stalk: 2.3, charge: 10, windup: 0.62, chargeRange: 22, damage: 14, notice: 12 };
/** The two-headed brute: slow, heavy, hard to put down, hits like a truck. */
const BRUTE = { hp: 9, stalk: 1.7, charge: 8.2, windup: 1.05, chargeRange: 18, damage: 26, notice: 14, height: 2.7 };
const SCIENTIST = { hp: 3, walk: 2.8, aim: 0.85, orbSpeed: 11, damage: 10 };
/** The scientists' laser: tracks you, locks, fires down the locked line. */
const LASER = { track: 0.85, lock: 0.3, beam: 0.16, damage: 12, width: 0.6, range: 40 };
/** The scientists' grenades: lobbed at where you're going, a short fuse. */
const GRENADE = { flight: 1.05, fuse: 0.95, radius: 3.4, damage: 22, knock: 8 };

function rng(seed) {
  // Scramble the seed and throw the first draws away: a Lehmer generator's
  // first output tracks a small seed almost linearly, which made the
  // "random" helicopter timer land within a few seconds every attempt.
  let value = (Math.floor(Math.abs(seed) * 2654435761) % 2147483646) + 1;
  const next = () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
  for (let i = 0; i < 4; i += 1) next();
  return next;
}

function createEmitter() {
  const handlers = new Map();
  return {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name)?.delete(fn);
    },
    emit(name, payload) {
      for (const fn of handlers.get(name) ?? []) fn(payload);
    },
    clear() {
      handlers.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Canvas textures                                                      */
/* ------------------------------------------------------------------ */

function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Tar-and-gravel roofing, with seams. */
function roofingTexture() {
  return canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = "#3a3734";
      ctx.fillRect(0, 0, s, s);
      const r = rng(77);
      const image = ctx.getImageData(0, 0, s, s);
      for (let i = 0; i < image.data.length; i += 4) {
        const n = (r() - 0.5) * 46;
        image.data[i] += n;
        image.data[i + 1] += n;
        image.data[i + 2] += n;
      }
      ctx.putImageData(image, 0, 0);
      ctx.strokeStyle = "rgba(10,9,8,0.8)";
      ctx.lineWidth = 3;
      for (const y of [0, 128]) {
        ctx.beginPath();
        ctx.moveTo(0, y + 1);
        ctx.lineTo(s, y + 1);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 9; i += 1) {
        ctx.beginPath();
        ctx.ellipse(r() * s, r() * s, 8 + r() * 26, 5 + r() * 14, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeat: [8, 8] }
  );
}

/** The helipad marking: a yellow ring and an H. */
function helipadTexture() {
  return canvasTexture(512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = "#23262a";
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.49, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e5b52a";
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.41, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#e8e4d8";
    const w = s * 0.07;
    ctx.fillRect(s * 0.33, s * 0.28, w, s * 0.44);
    ctx.fillRect(s * 0.67 - w, s * 0.28, w, s * 0.44);
    ctx.fillRect(s * 0.33, s * 0.465, s * 0.34, w);
    // Scuffs, so it has been used.
    const r = rng(5);
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = `rgba(80,70,60,${0.1 + r() * 0.2})`;
      ctx.fillRect(r() * s, r() * s, 4 + r() * 40, 2 + r() * 6);
    }
  });
}

/** A lit-window facade for the city, and the building under you. */
function windowsTexture(seed, litRatio = 0.3) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = "#07080a";
    ctx.fillRect(0, 0, s, s);
    const r = rng(seed);
    const cols = 8;
    const rows = 16;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const lit = r() < litRatio;
        const warm = r() < 0.8;
        ctx.fillStyle = lit ? (warm ? `rgba(255,${180 + r() * 50},${90 + r() * 60},${0.5 + r() * 0.5})` : "rgba(160,200,255,0.7)") : "rgba(20,24,30,1)";
        ctx.fillRect(x * (s / cols) + 5, y * (s / rows) + 3, s / cols - 10, s / rows - 7);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Sky                                                                  */
/* ------------------------------------------------------------------ */

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float h = vDir.y;
    // Night sky, orange at the horizon from a city lit from below and the
    // fire under your feet; drifting smoke across it.
    vec3 top = vec3(0.012, 0.016, 0.035);
    vec3 horizon = vec3(0.16, 0.07, 0.035);
    vec3 col = mix(horizon, top, smoothstep(-0.05, 0.45, h));
    vec2 p = vDir.xz / max(0.15, h + 0.3) * 1.6 + vec2(uTime * 0.02, uTime * 0.01);
    float smoke = noise(p) * 0.6 + noise(p * 2.7) * 0.4;
    col = mix(col, vec3(0.07, 0.05, 0.045), smoothstep(0.45, 0.85, smoke) * 0.7 * smoothstep(-0.1, 0.3, h));
    // A few stars through the gaps.
    vec2 sp = floor(vDir.xz / (h + 1.0) * 380.0);
    float star = step(0.9975, hash(sp)) * smoothstep(0.25, 0.6, h) * (1.0 - smoothstep(0.4, 0.7, smoke));
    col += star * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/* Enemies                                                              */
/* ------------------------------------------------------------------ */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
/** Eight directions round a circle's rim (wall tests against the scan). */
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)]);
const _laserFrom = new THREE.Vector3();
const _laserTo = new THREE.Vector3();

class Enemy {
  constructor(level, { kind, model, position, hp }) {
    this.level = level;
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.name = kind === "patient" ? "RoofPatient" : "Scientist";
    this.root.position.copy(position);
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.position = this.root.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.hp = hp;
    this.maxHp = hp;
    this.state = "idle";
    this.t = 0;
    this.stagger = 0;
    this.alive = true;
    this.removed = false;
    this.rig = null;

    if (model) {
      this.model = model;
      this.body.add(model);
      const rig = new HumanoidRig(model);
      this.rig = rig.valid ? rig : null;
    } else {
      this.body.add(level.kit.personStandIn());
    }

    // The hurtbox is what balls hit; it follows the body.
    this.hurt = new THREE.Mesh(level.kit.geometries.unitBox, level.kit.materials.collider);
    this.hurt.scale.set(0.9, 1.9, 0.8);
    this.hurt.position.y = 0.95;
    this.hurt.userData = { kind: "enemy", breakable: true, alive: true, enemy: this };
    this.root.add(this.hurt);
  }

  face(target, dt, rate = 8) {
    _v.subVectors(target, this.position);
    const want = Math.atan2(_v.x, _v.z);
    let delta = want - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.yaw += delta * Math.min(1, dt * rate);
    this.body.rotation.y = this.yaw;
  }

  /** Returns true if this hit took them down. */
  hit(power, from) {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - power);
    this.stagger = 1;
    if (from) {
      _v.subVectors(this.position, from).setY(0).normalize();
      this.velocity.addScaledVector(_v, 2.5);
    }
    if (this.hp > 0) return false;
    this.die("down");
    return true;
  }

  die(how) {
    this.alive = false;
    this.hurt.userData.alive = false;
    this.state = how;
    this.t = 0;
  }

  /** Push out of cover (and the parapets). */
  collide(radius = 0.45) {
    this.level.resolveCircle(this.position, radius);
  }

  /**
   * Stand on whatever is underfoot (the roof, the deck, the stair) - or, off
   * an edge, fall. Returns false once there's nothing under them.
   */
  settle(dt) {
    const ground = this.level.groundAt(this.position, this.position.y);
    if (ground !== null && this.position.y <= ground + 0.05) {
      this.position.y = ground;
      this.fallSpeed = 0;
      return true;
    }
    this.fallSpeed = (this.fallSpeed ?? 0) - 22 * dt;
    this.position.y = Math.max(ground ?? -Infinity, this.position.y + this.fallSpeed * dt);
    return ground !== null;
  }

  /** Walk toward `target` (through the stair if it's on the other level), not off an edge. */
  walk(target, speed, dt) {
    const goal = this.level.routeToward(this.position, target, _w);
    if (goal.climb) {
      // Up the ladder, hand over hand; over the top onto the building's roof.
      const l = this.level.scan.ladder;
      this.position.x = l.x;
      this.position.z = l.z;
      this.position.y = Math.min(l.top, this.position.y + 2.0 * dt);
      this.climbing = true;
      if (this.position.y >= l.top - 0.01) {
        this.position.x = l.x - l.nx * 0.9;
        this.position.z = l.z - l.nz * 0.9;
        this.climbing = false;
      }
      return 1;
    }
    this.climbing = false;
    _v.subVectors(goal, this.position).setY(0);
    const d = _v.length();
    if (d < 0.3) return d;
    _v.divideScalar(d);
    const step = Math.min(d, speed * dt);
    const nx = this.position.x + _v.x * step;
    const nz = this.position.z + _v.z * step;
    // Never step off into nothing (charging is another matter).
    if (this.level.groundAt(_v.set(nx, this.position.y, nz), this.position.y) === null) return d;
    this.position.x = nx;
    this.position.z = nz;
    return d;
  }

  updateDown(dt) {
    const k = Math.min(1, this.t / 0.8);
    this.body.rotation.x = -k * k * Math.PI * 0.47;
    this.velocity.multiplyScalar(Math.max(0, 1 - dt * 4));
    this.position.addScaledVector(this.velocity, dt);
    this.rig?.pose({ headNod: -0.6 * k, elbow: 0.9, lean: -0.4 * k, spread: 0.18 * k });
  }
}

class Patient extends Enemy {
  constructor(level, opts) {
    const spec = opts.brute ? BRUTE : PATIENT;
    super(level, { ...opts, kind: opts.brute ? "brute" : "patient", hp: spec.hp });
    this.spec = spec;
    this.brute = !!opts.brute;
    this.state = "emerge";
    // Out of the hut's door: from just inside it, out onto the roof.
    this.from = opts.position.clone();
    this.out = opts.out?.clone() ?? opts.position.clone().add(new THREE.Vector3(0, 0, 2.4));
    this.cooldown = 0.5 + opts.delay;
    this.delay = opts.delay;
    this.dir = new THREE.Vector3();
    this.travelled = 0;
    this.phase = Math.random() * 10;
    this.root.visible = false;
    if (this.brute) {
      // A big body: a bigger hurtbox.
      this.hurt.scale.set(1.5, BRUTE.height, 1.3);
      this.hurt.position.y = BRUTE.height / 2;
    }
  }

  /** The brute has no skeleton: it heaves and sways as a whole. */
  _heave(time, amount, lean = 0) {
    if (this.rig || !this.brute) return;
    this.body.position.y = Math.abs(Math.sin(time * 3.2 + this.phase)) * 0.12 * amount;
    this.body.rotation.z = Math.sin(time * 1.6 + this.phase) * 0.08 * amount;
    this.body.rotation.x = lean;
  }

  update(dt, time, ctx) {
    this.t += dt;
    this.stagger = Math.max(0, this.stagger - dt * 2.5);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const player = ctx.player;
    const rig = this.rig;
    const spec = this.spec;

    switch (this.state) {
      case "emerge": {
        // Through the hut's door and out onto the roof.
        if (this.t < this.delay) break;
        if (!this.root.visible) {
          this.root.visible = true;
          this.level.openDoor();
        }
        const k = Math.min(1, (this.t - this.delay) / 1.4);
        this.position.lerpVectors(this.from, this.out, k);
        this.face(this.out.clone().add(_v.subVectors(this.out, this.from)), dt, 6);
        rig?.pose({ phase: time * 6 + this.phase, stride: 0.4, knee: 0.6, reach: 0.8, lean: 0.35, headNod: 0.2 });
        this._heave(time, 1, 0.1);
        if (k >= 1) this.setState("stalk");
        break;
      }
      case "stalk": {
        this.face(player, dt, 5);
        const d = this.position.distanceTo(player);
        if (d > 1.2) this.walk(player, spec.stalk, dt);
        this.position.addScaledVector(this.velocity, dt);
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
        this.collide();
        if (!this.settle(dt)) this._fall(_v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(2));
        rig?.pose({ phase: time * 4.2 + this.phase, stride: 0.35, knee: 0.6, reach: 0.9, lean: 0.3, headTilt: Math.sin(time * 1.7 + this.phase) * 0.3 });
        this._heave(time, 1, 0.12);
        // They only charge you on their own level.
        const level = Math.abs(player.y - this.position.y) < 1;
        if (level && d < spec.notice && this.cooldown <= 0 && !ctx.frozen && this.level.clearLine(this.position, player)) {
          this.setState("windup");
          this.level.events.emit("patient-windup", { position: this.position.clone(), brute: this.brute });
        }
        break;
      }
      case "windup": {
        // The telegraph: a crouch and a scream, arms thrown back. The
        // direction locks at the end - move and they miss.
        this.face(player, dt, 10);
        const k = Math.min(1, this.t / spec.windup);
        rig?.pose({ crouch: 0.35 * k, lean: 0.5 * k, reach: -0.6 * k, headNod: -0.5 * k, elbow: 0.2 });
        this.body.position.x = Math.sin(time * 60) * 0.02 * k;
        this._heave(time * 3, k, 0.3 * k);
        if (this.t >= spec.windup) {
          this.dir.subVectors(player, this.position).setY(0).normalize();
          this.yaw = Math.atan2(this.dir.x, this.dir.z);
          this.body.rotation.y = this.yaw;
          this.body.position.x = 0;
          this.travelled = 0;
          this.setState("charge");
          this.level.events.emit("patient-charge", { position: this.position.clone(), brute: this.brute });
        }
        break;
      }
      case "charge": {
        const step = spec.charge * dt;
        this.position.addScaledVector(this.dir, step);
        this.travelled += step;
        rig?.pose({ phase: time * 13 + this.phase, stride: 0.7, knee: 1.1, lean: 0.55, reach: 0.4, armSwing: 0.2 });
        this._heave(time * 2.5, 1.4, 0.35);
        // Straight off the edge (of the roof, or the deck).
        if (!this.settle(dt)) {
          this._fall(this.dir.clone().multiplyScalar(spec.charge * 0.7));
          break;
        }
        if (!ctx.frozen && Math.abs(player.y - this.position.y) < 1.2 && this.position.distanceTo(_w.copy(player).setY(this.position.y)) < (this.brute ? 1.4 : 0.95)) {
          ctx.hits.push({ damage: spec.damage, from: this.position.clone(), knock: this.brute ? 12 : 7, source: this.brute ? "brute" : "patient" });
          this.setState("recover");
          break;
        }
        if (this.level.blocked(this.position, 0.45)) {
          // Into cover or a parapet: stunned for a moment. Shoot them now.
          this.collide();
          this.setState("stunned");
          this.level.events.emit("patient-stunned", { position: this.position.clone() });
          break;
        }
        if (this.travelled > spec.chargeRange) this.setState("recover");
        break;
      }
      case "recover":
      case "stunned": {
        const hold = this.state === "stunned" ? 1.5 : 0.9;
        rig?.pose({ lean: 0.2 - this.stagger * 0.6, headNod: 0.6, headTilt: Math.sin(this.t * 9) * 0.3, reach: 0.2, elbow: 0.7 });
        this._heave(time, 0.4, -0.1);
        this.position.addScaledVector(this.velocity, dt);
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
        this.collide();
        // Knocked back over an edge by a hit, they go too.
        if (!this.settle(dt)) {
          this._fall(this.velocity.clone());
          break;
        }
        if (this.t > hold) {
          this.cooldown = 1.2;
          this.setState("stalk");
        }
        break;
      }
      case "fall": {
        // Over the edge: gravity, a tumble, gone.
        this.velocity.y -= 22 * dt;
        this.position.addScaledVector(this.velocity, dt);
        this.body.rotation.x -= dt * 3.2;
        this.body.rotation.z += dt * 1.3;
        rig?.pose({ reach: 1.3, spread: 0.3, headNod: -0.5, elbow: 0.2, phase: time * 20, stride: 0.4 });
        if (this.position.y < -40) this.removed = true;
        break;
      }
      case "down":
        this.updateDown(dt);
        break;
      default:
        break;
    }
    if (this.stagger > 0 && this.alive && this.state !== "charge") {
      this.body.rotation.x = -this.stagger * 0.3;
    } else if (this.alive && !this.brute) this.body.rotation.x = 0;
  }

  setState(state) {
    this.state = state;
    this.t = 0;
  }

  /** Off the edge: over they go. */
  _fall(velocity) {
    this.velocity.copy(velocity);
    this.velocity.y = Math.max(this.velocity.y, 0);
    this.die("fall");
    this.level.events.emit("enemy-fall", { enemy: this, position: this.position.clone() });
  }
}

class Scientist extends Enemy {
  constructor(level, opts) {
    super(level, { ...opts, kind: "scientist", hp: SCIENTIST.hp });
    this.state = opts.enter ? "enter" : "release";
    this.target = new THREE.Vector3().copy(opts.enter ?? opts.position);
    this.random = rng(opts.seed ?? 3);
    this.cooldown = 1;
    this.phase = Math.random() * 10;
    this.gadget = opts.gadget ?? null;
    this.charge = 0;
    this.weapon = "laser";
    this.laserAim = new THREE.Vector3();
    // The gadget glows before it fires - that is the tell.
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0x7ef4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow = new THREE.Mesh(level.kit.geometries.unitSphere, this.glowMaterial);
    this.glow.scale.setScalar(0.5);
    this.root.add(this.glow);
    if (this.gadget && this.rig?.bones.handR) {
      this.rig.bones.handR.add(this.gadget);
    }
  }

  handPosition(target) {
    const hand = this.rig?.bones.handR;
    if (hand) return hand.getWorldPosition(target);
    return target.copy(this.position).add(_v.set(Math.sin(this.yaw) * 0.5, 1.4, Math.cos(this.yaw) * 0.5));
  }

  pickSpot(player) {
    // A point on a ring around the player, on the main roof, kept off the
    // edges (they keep their feet on the roof - it's the patients who go over).
    for (let i = 0; i < 8; i += 1) {
      const a = this.random() * Math.PI * 2;
      const r = 9 + this.random() * 4;
      this.target.set(player.x + Math.cos(a) * r, 0, player.z + Math.sin(a) * r);
      const b = this.level.bounds;
      this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX + 3.5, b.maxX - 3.5);
      this.target.z = THREE.MathUtils.clamp(this.target.z, b.minZ + 2.5, b.maxZ - 2.5);
      if (!this.level.blocked(this.target, 0.6) && this.level.groundAt(this.target, 0) === 0) return;
    }
  }

  /** What to hit you with next: the laser most, then a grenade, now and then an orb. */
  pickWeapon() {
    const r = this.random();
    this.weapon = r < 0.45 ? "laser" : r < 0.8 ? "grenade" : "orb";
  }

  update(dt, time, ctx) {
    this.t += dt;
    this.stagger = Math.max(0, this.stagger - dt * 2.5);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const player = ctx.player;
    const rig = this.rig;
    let glow = 0;

    switch (this.state) {
      case "enter":
      case "move": {
        this.face(this.target, dt, 6);
        const d = this.walk(this.target, SCIENTIST.walk, dt);
        this.position.addScaledVector(this.velocity, dt);
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
        this.collide();
        this.settle(dt);
        rig?.pose({ phase: time * 7 + this.phase, stride: 0.45, knee: 0.8, armSwing: 0.45, lean: 0.12, aimR: 0.3 });
        if (d <= 0.3 || this.t > 5) {
          if (this.state === "enter") this.setState("release");
          else {
            this.pickWeapon();
            this.setState("aim");
          }
        }
        break;
      }
      case "release": {
        // Throws an arm at you: go.
        this.face(player, dt, 5);
        const k = Math.min(1, this.t / 1.1);
        rig?.pose({ aimL: Math.sin(k * Math.PI) * 1.2, aimR: 0.3, headNod: -0.2 });
        if (this.t > 1.1) {
          this.cooldown = 1.2;
          this.pickSpot(player);
          this.setState("move");
        }
        break;
      }
      case "aim": {
        this.face(player, dt, 8);
        if (this.weapon === "laser") {
          // A thin red line tracks you, then locks - get off the line.
          const k = Math.min(1, this.t / LASER.track);
          glow = k;
          rig?.pose({ aimR: 1, lean: -0.05, headNod: 0.1 });
          this.handPosition(_w);
          if (this.t < LASER.track - LASER.lock) this.laserAim.copy(player).setY(player.y + 1.15);
          this.level.showLaser(this, _w, this.laserAim, 0.25 + k * 0.5, false);
          if (this.t >= LASER.track && !ctx.frozen) {
            this.level.fireLaser(this, _w, this.laserAim, ctx);
            this.cooldown = 1.3 + this.random() * 0.8;
            this.setState("recoil");
          }
        } else if (this.weapon === "grenade") {
          // Arm back, then the lob - at where you're heading.
          const k = Math.min(1, this.t / 0.6);
          rig?.pose({ aimL: k * 1.6, aimR: 0.2, lean: -0.2 * k, twist: -0.4 * k, headNod: -0.15 });
          if (this.t >= 0.6 && !ctx.frozen) {
            this.handPosition(_w);
            const target = player.clone().addScaledVector(ctx.playerVelocity, 0.9);
            this.level.throwGrenade(_w, target);
            this.cooldown = 1.6 + this.random() * 0.9;
            this.setState("recoil");
          }
        } else {
          const k = Math.min(1, this.t / SCIENTIST.aim);
          glow = k;
          rig?.pose({ aimR: 1, lean: -0.05, headNod: 0.1 });
          if (this.t >= SCIENTIST.aim && !ctx.frozen) {
            this.handPosition(_w);
            // Lead the target a little: standing still is how you get hit.
            const aimAt = player.clone().addScaledVector(ctx.playerVelocity, 0.35).setY(player.y + 1.15);
            this.level.fireOrb(_w, aimAt);
            this.cooldown = 1.1 + this.random() * 0.8;
            this.setState("recoil");
          }
        }
        break;
      }
      case "recoil": {
        rig?.pose({ aimR: 0.7, lean: -0.15, headNod: -0.1 });
        this.face(player, dt, 4);
        if (this.cooldown <= 0) {
          if (this.random() < 0.55) {
            this.pickSpot(player);
            this.setState("move");
          } else {
            this.pickWeapon();
            this.setState("aim");
          }
        }
        break;
      }
      case "down":
        this.updateDown(dt);
        break;
      default:
        break;
    }

    if (this.alive && this.stagger > 0) {
      this.body.rotation.x = -this.stagger * 0.28;
      if (this.state === "aim") this.t = Math.min(this.t, SCIENTIST.aim * 0.3); // a hit spoils the shot
    } else if (this.alive) this.body.rotation.x = 0;

    // The aiming line goes out the moment they stop aiming it (a hit, a move).
    if (!(this.state === "aim" && this.weapon === "laser")) this.level.hideLaserAim(this);
    this.handPosition(this.glow.position).sub(this.position);
    this.glowMaterial.color.setHex(this.weapon === "laser" ? 0xff3a2e : 0x7ef4ff);
    this.glowMaterial.opacity = glow * (0.6 + Math.sin(time * 40) * 0.2);
    this.glow.scale.setScalar(0.25 + glow * 0.45);
  }

  setState(state) {
    this.state = state;
    this.t = 0;
  }
}

/* ------------------------------------------------------------------ */
/* The roof                                                             */
/* ------------------------------------------------------------------ */

export class RoofLevel {
  /**
   * @param {object} o
   * @param {Map} o.assets       loaded assets (characters, helicopter, gadgets, kit models)
   * @param {number} [o.seed]    randomises the helicopter timer
   * @param {number} [o.heliSeconds] force the hidden timer (tests)
   */
  /**
   * @param {object} [o]
   * @param {boolean} [o.endless]  survival: no helicopter, waves keep coming,
   *   the roof comes apart over two minutes; it ends when you go down.
   */
  constructor({ assets = new Map(), seed = Date.now() % 100000, heliSeconds, endless = false, heights = null } = {}) {
    this.assets = assets;
    this.endless = endless;
    /**
     * The roof is the scanned rooftop (two levels: the deck, and the roof of
     * the building on it) when its model and baked height map are both in;
     * otherwise the built-in layout (a deck on legs, a stair hut).
     */
    this.scan = this._readScan(heights);
    applyLayout(this.scan);
    this.bounds = this.scan ? this.scan.floor : { minX: -EDGE, maxX: EDGE, minZ: -DEPTH, maxZ: DEPTH };
    /** The east edge, where the helicopter waits off the side (and how far north). */
    this.eastEdge = this.bounds.maxX;
    this.holdZ = this.scan ? (this.scan.building.minZ + this.scan.building.maxZ) / 2 : -11;
    this.events = createEmitter();
    this.root = new THREE.Group();
    this.root.name = "RoofRoot";
    this.groups = {};
    for (const name of ["set", "hazards", "pickups", "enemies", "orbs", "weapons", "lights"]) {
      const g = new THREE.Group();
      g.name = name[0].toUpperCase() + name.slice(1);
      this.groups[name] = g;
      this.root.add(g);
    }

    this.fire = createFireMaterials();
    this.kit = createMeltdownKit({ fire: this.fire });
    this.owned = { materials: [], textures: [], geometries: [] };
    this.random = rng(seed + 11);

    /** Box3s the player and enemies cannot pass through. */
    this.cover = [];
    /** Invisible meshes the player's balls bounce off. */
    this.solids = [];
    /** Hurtboxes and sacks. */
    this.breakables = [];
    this.enemies = [];
    this._ticking = [];

    this.state = {
      time: 0,
      wave: 0,
      heliAt: endless ? Infinity : heliSeconds ?? HELI_SECONDS[0] + this.random() * (HELI_SECONDS[1] - HELI_SECONDS[0]),
      nextWaveAt: 0,
      heliSeen: false,
      heliArrived: false,
      cleared: false,
      ending: null,
      downs: 0,
      falls: 0,
      chaos: 0,
      extractT: 0,
    };

    if (this.scan) this._buildScanSet();
    else {
      this._buildSet();
      this._buildDeck();
    }
    this._buildSkyline();
    this._buildLights();
    this._buildPickups();
    this._buildOrbs();
    this._buildWeapons();
    this._buildHelicopter();
    this._buildChaos();
    fillAssetSlots(this.root, this.assets);
  }

  /* ---------------- Building ---------------- */

  _track(material) {
    this.owned.materials.push(material);
    return material;
  }

  _box(w, h, d, material, x, y, z, { solid = false, cover = false } = {}) {
    const mesh = this.kit.box(w, h, d, material, y, x, z);
    this.groups.set.add(mesh);
    if (solid || cover) {
      const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(w, h, d));
      if (cover) this.cover.push(box);
      const collider = new THREE.Mesh(this.kit.geometries.unitBox, this.kit.materials.collider);
      collider.scale.set(w, h, d);
      collider.position.set(x, y + h / 2, z);
      this.groups.set.add(collider);
      this.solids.push(collider);
    }
    return mesh;
  }

  _put(piece, x, y, z, rotY = 0) {
    piece.position.set(x, y, z);
    piece.rotation.y = rotY;
    this.groups.set.add(piece);
    if (typeof piece.userData.tick === "function") this._ticking.push(piece);
    return piece;
  }

  /**
   * A model from the rooftop kit (tools/assets/extract_kit.py), fitted to a
   * footprint: a plain stand-in until it loads, then the model, repainted
   * (the kit comes untextured). `cover` makes the footprint solid.
   */
  _prop(name, { x, z, y = 0, size, rotY = 0, material, cover = true }) {
    const [w, h, d] = size;
    const standIn = this.kit.box(w, h, d, material, 0, 0, 0);
    const piece = new THREE.Group();
    piece.add(standIn);
    const slot = assetSlot(name, { size: [w, h, d], rotateY: 0 }, [standIn]);
    slot.userData.onFilled = (holder) => {
      holder.traverse((o) => {
        if (o.isMesh) o.material = material;
      });
    };
    piece.add(slot);
    this._put(piece, x, y, z, rotY);
    if (cover) {
      const turned = Math.abs(Math.sin(rotY)) > 0.7;
      const fw = turned ? d : w;
      const fd = turned ? w : d;
      this.cover.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(fw * 0.9, h, fd * 0.9)));
      const collider = new THREE.Mesh(this.kit.geometries.unitBox, this.kit.materials.collider);
      collider.scale.set(fw * 0.9, h, fd * 0.9);
      collider.position.set(x, y + h / 2, z);
      this.groups.set.add(collider);
      this.solids.push(collider);
    }
    return piece;
  }

  /**
   * The lift housing you come up in, doors facing the roof (-Z): a hollow hut
   * (so the open doors show the cabin) around a placeholder lift.
   */
  _buildLiftHousing() {
    const k = this.kit;
    const mat = k.materials;
    const concrete = mat.concreteWall;
    const x = LIFT_DOOR.x;
    const hutZ = LIFT_DOOR.z + 1.4;
    const hutH = 3.5;
    this._box(5, hutH, 2.8, mat.collider, x, 0, hutZ, { solid: true, cover: true });
    for (const s of [-1, 1]) {
      this._box(1.15, hutH, 0.3, concrete, x + s * 1.925, 0, LIFT_DOOR.z + 0.15);
      this._box(0.25, hutH, 2.8, concrete, x + s * 2.375, 0, hutZ);
    }
    this._box(2.7, hutH - ROOF_LIFT.height, 0.3, concrete, x, ROOF_LIFT.height, LIFT_DOOR.z + 0.15);
    this._box(5, hutH, 0.25, concrete, x, 0, hutZ + 1.275);
    this._box(5.3, 0.2, 3.1, mat.trim, x, hutH, hutZ);
    this.lift = this._put(createLift(k, { ...ROOF_LIFT, label: "R" }), LIFT_DOOR.x, 0, LIFT_DOOR.z);
    this.lift.userData.lift.setLight(1);
    this._put(k.alarmBeacon({ x: 0, y: 2.6, speed: 3.6 }), x + 1.95, 0.35, LIFT_DOOR.z - 0.2);
  }

  /** The helipad marking at HELIPAD, ringed with lights. */
  _buildHelipad(radius) {
    const k = this.kit;
    const pad = this._track(new THREE.MeshStandardMaterial({ map: helipadTexture(), transparent: true, roughness: 0.7, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.owned.textures.push(pad.map);
    const padMesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), pad);
    padMesh.rotation.x = -Math.PI / 2;
    padMesh.position.set(HELIPAD.x, 0.03, HELIPAD.z);
    this.owned.geometries.push(padMesh.geometry);
    this.groups.set.add(padMesh);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const led = new THREE.Mesh(k.geometries.unitSphere, k.materials.warning);
      led.scale.setScalar(0.18);
      led.position.set(HELIPAD.x + Math.cos(a) * (radius + 0.2), 0.08, HELIPAD.z + Math.sin(a) * (radius + 0.2));
      this.groups.set.add(led);
    }
  }

  _buildSky() {
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: this.fire.time },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this._track(this.skyMaterial);
    // Inside the camera's far plane (320 m), or it is clipped into an arch.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(270, 32, 16), this.skyMaterial);
    sky.name = "Sky";
    sky.renderOrder = -1;
    this.owned.geometries.push(sky.geometry);
    this.root.add(sky);
  }

  /**
   * The scanned rooftop (assets/meltdown/roof_scan.glb, scaled up by
   * SCAN_SCALE): the deck, the building on it (its roof the second level, up
   * a ladder on its south face), its doorway the patients come out of, the
   * tower at the west end. Walls, edges and both levels come from the baked
   * height map - the scan itself is only drawn. Our own pieces on it: the
   * lift you arrive in, the helipad, the ladder, the door's lamp, some plant.
   */
  _buildScanSet() {
    const k = this.kit;
    const mat = k.materials;
    const s = this.scan;
    const b = s.building;
    const f = s.floor;
    const model = s.asset.template.clone(true);
    model.scale.setScalar(s.scale);
    model.position.y = -s.deck * s.scale;
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.frustumCulled = false;
      // The scan's light is baked into its photos: let it show through the night.
      const m = o.material.clone();
      m.emissiveMap = m.map;
      m.emissive = new THREE.Color(0xffffff);
      m.emissiveIntensity = 0.32;
      m.roughness = 0.92;
      m.metalness = 0;
      m.envMapIntensity = 0.3;
      o.material = this._track(m);
    });
    model.name = "RoofScan";
    this.groups.set.add(model);

    // The rest of the building, below the scan, down into the city.
    const facade = this._track(new THREE.MeshStandardMaterial({ color: 0x3a3a3c, emissive: 0xffffff, emissiveMap: windowsTexture(19, 0.12), emissiveIntensity: 0.9, roughness: 0.9 }));
    facade.emissiveMap.repeat.set(4, 6);
    this.owned.textures.push(facade.emissiveMap);
    const fw = f.maxX - f.minX;
    const fd = f.maxZ - f.minZ;
    this._box(fw - 0.8, 70, fd - 0.8, facade, (f.minX + f.maxX) / 2, -76, (f.minZ + f.maxZ) / 2);

    this._buildLiftHousing();
    this._buildHelipad(3.4);

    // The ladder up the building's south face.
    const l = s.ladder;
    const steel = this._track(new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.45, metalness: 0.8 }));
    for (const dx of [-0.32, 0.32]) this.groups.set.add(this.kit.box(0.06, l.top + 1.0, 0.06, steel, 0, l.x + dx, l.z - 0.25));
    for (let y = 0.3; y < l.top + 0.9; y += 0.3) this.groups.set.add(this.kit.box(0.64, 0.04, 0.04, steel, y, l.x, l.z - 0.25));
    const hoops = new THREE.Mesh(this.kit.geometries.unitBox, mat.hazard);
    hoops.scale.set(0.8, 0.05, 0.05);
    hoops.position.set(l.x, l.top + 1.0, l.z - 0.25);
    this.groups.set.add(hoops);

    // The doorway the patients come through: a caged lamp over it, and a
    // steel door that swings open for each one.
    this._put(k.alarmBeacon({ x: 0, y: 0, speed: 4.4 }), HUT_DOOR.x + 1.1, 2.5, HUT_DOOR.z + 0.05);
    this.door = new THREE.Group();
    this.door.position.set(HUT_DOOR.x - 0.75, 0, HUT_DOOR.z + 0.04);
    this.door.add(k.box(1.5, 2.3, 0.07, mat.paintedMetal, 0, 0.75, 0));
    this.groups.set.add(this.door);
    this.doorOpen = 0;
    this.doorAngle = 0;

    // Plant, for cover, in the open stretches of deck.
    const plant = this._track(new THREE.MeshStandardMaterial({ color: 0x6e7680, roughness: 0.55, metalness: 0.6 }));
    const frame = this._track(new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.6, metalness: 0.7 }));
    const tankPaint = this._track(new THREE.MeshStandardMaterial({ color: 0xb9bcb6, roughness: 0.5, metalness: 0.45 }));
    const westX = (f.minX + b.minX) / 2;
    const eastX = (b.maxX + f.maxX) / 2;
    const southZ = (b.maxZ + f.maxZ) / 2;
    this._prop("roofHvac", { x: westX, z: (f.minZ + b.maxZ) / 2 - 1, size: [3.2, 1.5, 2.8], rotY: Math.PI / 2, material: plant });
    this._prop("roofHvac3", { x: b.minX + 4.5, z: southZ + 1.6, size: [3.2, 1.2, 3], material: plant });
    this._prop("roofTank", { x: eastX + 1, z: southZ + 1.5, size: [3.4, 6.5, 3.4], material: tankPaint });
    this._prop("roofDish2", { x: eastX, z: b.minZ + 2.2, size: [4, 3.8, 3.6], rotY: -0.6, material: tankPaint });
    this._prop("roofMast", { x: f.minX + 3, z: f.minZ + 1.6, size: [1.4, 10, 1.4], material: frame, cover: false });

    // Floodlights on two corners.
    this.floods = [];
    for (const [x, z] of [[f.minX + 1.2, f.minZ + 1.2], [f.maxX - 1.2, f.maxZ - 1.2]]) {
      this._box(0.16, 5.5, 0.16, mat.darkMetal, x, 0, z);
      this._box(0.9, 0.4, 0.5, mat.trim, x, 5.5, z);
      this.floods.push(new THREE.Vector3(x, 5.2, z - Math.sign(z) * 0.4));
    }
    this._buildSky();
  }

  _buildSet() {
    const k = this.kit;
    const mat = k.materials;
    const roofing = this._track(new THREE.MeshStandardMaterial({ map: roofingTexture(), roughnessMap: k.textures.floorRoughness, roughness: 1, metalness: 0.05 }));
    roofing.map.repeat.set(11, 9);
    roofing.envMapIntensity = 0.5;
    this.owned.textures.push(roofing.map);
    const concrete = mat.concreteWall;
    // The kit's paint: weathered plant-room steel, darker frames, pale tanks.
    const plant = this._track(new THREE.MeshStandardMaterial({ color: 0x6e7680, roughness: 0.55, metalness: 0.6 }));
    const frame = this._track(new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.6, metalness: 0.7 }));
    const tankPaint = this._track(new THREE.MeshStandardMaterial({ color: 0xb9bcb6, roughness: 0.5, metalness: 0.45 }));
    for (const m of [plant, frame, tankPaint]) m.envMapIntensity = 0.7;

    // The slab, and the building falling away beneath it.
    this._box(EDGE * 2 + 0.6, 0.6, DEPTH * 2 + 0.6, roofing, 0, -0.6, 0);
    const facade = this._track(new THREE.MeshStandardMaterial({ color: 0x3a3a3c, emissive: 0xffffff, emissiveMap: windowsTexture(19, 0.12), emissiveIntensity: 0.9, roughness: 0.9 }));
    facade.emissiveMap.repeat.set(4, 6);
    this.owned.textures.push(facade.emissiveMap);
    this._box(EDGE * 2 - 0.2, 70, DEPTH * 2 - 0.2, facade, 0, -70.6, 0);

    // Parapets along the north and south, and the two ends of the west side;
    // the middle of the west and all of the east are open. Mind the edge.
    const parapet = (len, x, z, alongX) => {
      this._box(alongX ? len : 0.45, 1.0, alongX ? 0.45 : len, concrete, x, 0, z, { solid: true, cover: true });
      this._box(alongX ? len : 0.6, 0.12, alongX ? 0.6 : len, mat.trim, x, 1.0, z);
    };
    parapet(EDGE * 2 + 0.6, 0, -DEPTH, true);
    parapet(EDGE * 2 + 0.6, 0, DEPTH, true);
    parapet(12, -EDGE, -DEPTH + 6, false);
    parapet(12, -EDGE, DEPTH - 6, false);
    // Painted warning lines along every open edge.
    this._box(0.3, 0.02, DEPTH * 2 - 2, mat.hazard, EDGE - 0.6, 0.005, 0);
    this._box(0.3, 0.02, 12, mat.hazard, -EDGE + 0.6, 0.005, 0);
    const r = rng(40);
    for (let i = 0; i < 12; i += 1) {
      const rock = new THREE.Mesh(k.geometries.rock, mat.rubbleDark);
      const s = 0.25 + r() * 0.45;
      rock.scale.set(s * 1.4, s, s);
      const east = i % 2 === 0;
      rock.position.set(east ? EDGE - r() * 0.8 : -EDGE + r() * 0.8, s * 0.3, east ? (r() - 0.5) * (DEPTH * 2 - 4) : (r() - 0.5) * 11);
      rock.rotation.set(r(), r() * 3, r());
      this.groups.set.add(rock);
    }

    this._buildLiftHousing();

    // The stair hut the patients come out of: a concrete block with a steel
    // door that swings open each time another one comes through.
    this._box(HUT.w, HUT.h, HUT.d, concrete, HUT.x, 0, HUT.z, { solid: true, cover: true });
    this._box(HUT.w + 0.4, 0.25, HUT.d + 0.4, mat.trim, HUT.x, HUT.h, HUT.z);
    this._box(1.8, 2.5, 0.12, mat.pitBlack, HUT_DOOR.x, 0, HUT.z + HUT.d / 2 + 0.01);
    this._box(2.2, 0.18, 0.2, mat.trim, HUT_DOOR.x, 2.55, HUT.z + HUT.d / 2 + 0.08);
    this.door = new THREE.Group();
    this.door.position.set(HUT_DOOR.x - 0.85, 0, HUT.z + HUT.d / 2 + 0.08);
    const leaf = k.box(1.7, 2.4, 0.08, mat.paintedMetal, 0, 0.85, 0);
    this.door.add(leaf);
    this.groups.set.add(this.door);
    this.doorOpen = 0;
    this.doorAngle = 0;
    this._put(k.alarmBeacon({ x: 0, y: 0, speed: 4.4 }), HUT_DOOR.x + 1.3, 2.4, HUT.z + HUT.d / 2 + 0.12);
    // Plant on its roof.
    this._prop("roofHvac", { x: HUT.x - 1.5, z: HUT.z, y: HUT.h + 0.25, size: [3.2, 1.5, 2.8], material: plant, cover: false });

    this._buildHelipad(6.5);

    // Cover and plant from the rooftop kit: air handlers, a water tank on
    // its stand, a dish, pipe runs with their walkways, masts.
    this._prop("roofHvac2", { x: 4.5, z: 0.5, size: [4.4, 1.7, 3.8], material: plant });
    this._prop("roofHvac3", { x: -8.5, z: 6.5, size: [3.6, 1.3, 3.4], material: plant });
    this._prop("roofHvac", { x: -4, z: -1, size: [3.2, 1.5, 2.8], rotY: Math.PI / 2, material: plant });
    this._prop("roofTank", { x: -17, z: 9, size: [4, 7.5, 4], material: tankPaint });
    this._prop("roofDish2", { x: 16, z: -13.5, size: [5, 4.5, 4.4], material: tankPaint });
    this._prop("roofMast", { x: 20.2, z: -16, size: [1.6, 12, 1.6], material: frame, cover: false });
    this._prop("roofMast2", { x: -20.2, z: 16.2, size: [1.6, 8, 1.6], material: frame, cover: false });
    for (const [x, z] of [[11, 10], [-12, -1], [1, -16]]) {
      const vent = new THREE.Mesh(k.geometries.unitCyl, mat.ductMetal);
      vent.scale.set(0.9, 1.4, 0.9);
      vent.position.set(x, 0.7, z);
      this.groups.set.add(vent);
      this.cover.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 0.7, z), new THREE.Vector3(0.9, 1.4, 0.9)));
    }
    // Floodlights on poles at the parapets.
    this.floods = [];
    for (const [x, z] of [[-EDGE + 1, -DEPTH + 0.6], [EDGE - 6, DEPTH - 0.6]]) {
      this._box(0.16, 5.5, 0.16, mat.darkMetal, x, 0, z);
      const head = this._box(0.9, 0.4, 0.5, mat.trim, x, 5.5, z);
      head.rotation.x = 0.4;
      this._box(0.7, 0.05, 0.35, mat.lightTube, x, 5.45, z - Math.sign(z) * 0.25);
      this.floods.push(new THREE.Vector3(x, 5.2, z - Math.sign(z) * 0.4));
    }

    this._buildSky();
  }

  /**
   * The second level: a steel deck on legs over the east of the roof, up a
   * stair from the south. Railed on its north and east sides; open to the
   * west and the south - you can be knocked off it, or charge them off it.
   */
  _buildDeck() {
    const k = this.kit;
    const mat = k.materials;
    const steel = this._track(new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.5, metalness: 0.75 }));
    const grate = this._track(new THREE.MeshStandardMaterial({ color: 0x5c636b, roughness: 0.65, metalness: 0.7, map: k.textures.grate ?? null }));
    const w = DECK.maxX - DECK.minX;
    const d = DECK.maxZ - DECK.minZ;
    const cx = (DECK.minX + DECK.maxX) / 2;
    const cz = (DECK.minZ + DECK.maxZ) / 2;
    // The floor (solid to balls, not cover: you walk under it).
    const floor = this.kit.box(w, 0.22, d, grate, DECK.y - 0.22, cx, cz);
    this.groups.set.add(floor);
    const collider = new THREE.Mesh(this.kit.geometries.unitBox, this.kit.materials.collider);
    collider.scale.set(w, 0.22, d);
    collider.position.set(cx, DECK.y - 0.11, cz);
    this.groups.set.add(collider);
    this.solids.push(collider);
    // Edge beams, legs, cross-bracing.
    for (const z of [DECK.minZ, DECK.maxZ]) this.groups.set.add(this.kit.box(w, 0.35, 0.2, steel, DECK.y - 0.55, cx, z));
    for (const x of [DECK.minX, DECK.maxX]) this.groups.set.add(this.kit.box(0.2, 0.35, d, steel, DECK.y - 0.55, x, cz));
    for (const x of [DECK.minX + 0.2, cx, DECK.maxX - 0.2]) {
      for (const z of [DECK.minZ + 0.2, DECK.maxZ - 0.2]) {
        this.groups.set.add(this.kit.box(0.22, DECK.y - 0.2, 0.22, steel, 0, x, z));
      }
    }
    // Railings: north and east.
    const rail = (len, x, z, alongX) => {
      this.groups.set.add(this.kit.box(alongX ? len : 0.06, 0.06, alongX ? 0.06 : len, steel, DECK.y + 1.0, x, z));
      this.groups.set.add(this.kit.box(alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, steel, DECK.y + 0.5, x, z));
      for (let i = 0; i <= Math.round(len / 1.6); i += 1) {
        const t = -len / 2 + (i / Math.round(len / 1.6)) * len;
        this.groups.set.add(this.kit.box(0.06, 1.0, 0.06, steel, DECK.y, alongX ? x + t : x, alongX ? z : z + t));
      }
      this.cover.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, DECK.y + 0.55, z), new THREE.Vector3(alongX ? len : 0.3, 1.1, alongX ? 0.3 : len)));
    };
    rail(w, cx, DECK.minZ + 0.1, true);
    rail(d, DECK.maxX - 0.1, cz, false);
    // The stair: a steel flight from the roof up to the deck's south edge.
    const sw = STAIR.maxX - STAIR.minX;
    const sl = STAIR.maxZ - STAIR.minZ;
    const steps = 14;
    for (let i = 0; i < steps; i += 1) {
      const z = STAIR.maxZ - (i + 0.5) * (sl / steps);
      const y = ((i + 1) / steps) * DECK.y;
      this.groups.set.add(this.kit.box(sw, 0.08, sl / steps + 0.04, grate, y - 0.08, (STAIR.minX + STAIR.maxX) / 2, z));
    }
    const pitch = Math.atan2(DECK.y, sl);
    for (const x of [STAIR.minX, STAIR.maxX]) {
      const stringer = this.kit.box(0.12, 0.3, Math.hypot(sl, DECK.y), steel, 0, 0, 0);
      const holder = new THREE.Group();
      holder.add(stringer);
      stringer.position.y = -0.15;
      holder.position.set(x, DECK.y / 2, (STAIR.minZ + STAIR.maxZ) / 2);
      holder.rotation.x = pitch;
      this.groups.set.add(holder);
      const handrail = this.kit.box(0.05, 0.05, Math.hypot(sl, DECK.y), steel, 0, 0, 0);
      const h2 = new THREE.Group();
      h2.add(handrail);
      h2.position.set(x, DECK.y / 2 + 0.95, (STAIR.minZ + STAIR.maxZ) / 2);
      h2.rotation.x = pitch;
      this.groups.set.add(h2);
    }
    // Something to hide behind up there.
    this._prop("roofHvac", { x: DECK.maxX - 2.4, z: DECK.minZ + 2.2, y: DECK.y, size: [3, 1.4, 2.6], material: steel });
    this.groups.set.add(this.kit.box(0.4, 0.02, w, mat.hazard, DECK.y + 0.005, cx, DECK.maxZ - 0.25));
  }

  /* ---------------- Where you can stand ---------------- */

  /**
   * The height of the walkable surface under `p` that someone at `fromY`
   * can be on - the highest one no more than a step above them (so the deck
   * is reached by its stair, not climbed from the side). Null: nothing under
   * them - they're off the edge.
   */
  groundAt(p, fromY = 0) {
    if (this.scan) {
      // The scan: its baked heights. A cell too high to step onto is a wall -
      // it holds you where you are (the movement code keeps you out of it).
      const h = this.scanHeight(p.x, p.z);
      if (h === null) return null;
      if (this.onLadder(p) && fromY > h + 0.05) return fromY;
      return h > fromY + STEP ? fromY : h;
    }
    let best = null;
    const take = (h) => {
      if (h <= fromY + STEP && (best === null || h > best)) best = h;
    };
    if (Math.abs(p.x) <= EDGE + 0.3 && Math.abs(p.z) <= DEPTH + 0.3) take(0);
    if (p.x >= DECK.minX && p.x <= DECK.maxX && p.z >= DECK.minZ && p.z <= DECK.maxZ) take(DECK.y);
    if (p.x >= STAIR.minX && p.x <= STAIR.maxX && p.z >= STAIR.minZ && p.z <= STAIR.maxZ) {
      take(DECK.y * (STAIR.maxZ - p.z) / (STAIR.maxZ - STAIR.minZ));
    }
    return best;
  }

  /* ---------------- The roof scan (assets/meltdown/roof_scan.glb) ---------------- */

  /**
   * Read the scan's layout off its height map: the deck is the commonest
   * height; the building on it is the big block 2.2-5 m above that (its roof
   * is the second level); the ladder goes up its south face, a third of the
   * way along from the west; the patients' door is near the east end of that
   * face. Null without the model or the map (the built-in layout is used).
   */
  _readScan(source) {
    const asset = this.assets.get("roofScan");
    if (!asset || !source?.heights) return null;
    const grid = fillScanHoles(source);
    const S = SCAN_SCALE;
    const counts = new Map();
    for (const h of grid.heights) {
      if (h === null) continue;
      const k = Math.round(h * 10);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let deckK = 0;
    let best = 0;
    for (const [k, c] of counts) if (c > best) [best, deckK] = [c, k];
    const deck = deckK / 10;
    const bounds = () => ({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const building = bounds();
    const floor = bounds();
    const roofs = [];
    for (let j = 0; j < grid.nz; j += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const h = grid.heights[j * grid.nx + i];
        if (h === null) continue;
        const x = (grid.x0 + i * grid.cell) * S;
        const z = (grid.z0 + j * grid.cell) * S;
        const up = h - deck;
        const into = (b) => {
          b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
          b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
        };
        if (up > 2.2 && up < 5) {
          into(building);
          roofs.push(up);
        } else if (Math.abs(up) < 0.4) into(floor);
      }
    }
    if (!roofs.length) return null;
    roofs.sort((a, b) => a - b);
    building.top = roofs[Math.floor(roofs.length / 2)] * S;
    const scan = { asset, grid, scale: S, deck, building, floor };
    // The ladder: up the south face (+z), a third of the way from the west end,
    // where there's deck in front of it.
    scan.ladder = { x: building.minX + (building.maxX - building.minX) * 0.33, z: building.maxZ + 0.45, top: building.top, nx: 0, nz: 1 };
    // The door: near the east end of the same face (the scan's own doorway).
    scan.door = new THREE.Vector3(building.maxX - 2.4 * S, 0, building.maxZ + 0.2);
    return scan;
  }

  /**
   * The scan's walkable height at (x, z), in roof metres (the deck is 0), or
   * null off its edge. From the baked height map (tools/assets/heightmap.py).
   */
  scanHeight(x, z) {
    const s = this.scan;
    const i = Math.round((x / s.scale - s.grid.x0) / s.grid.cell);
    const j = Math.round((z / s.scale - s.grid.z0) / s.grid.cell);
    if (i < 0 || j < 0 || i >= s.grid.nx || j >= s.grid.nz) return null;
    const h = s.grid.heights[j * s.grid.nx + i];
    return h === null ? null : (h - s.deck) * s.scale;
  }

  /** A wall for someone at `fromY`: the scan's surface there is more than a step up. */
  _scanWall(x, z, fromY) {
    const h = this.scanHeight(x, z);
    return h !== null && h > fromY + STEP;
  }

  /** On the ladder up the building (in its column, between the deck and the roof)? */
  onLadder(p) {
    const l = this.scan?.ladder;
    if (!l) return false;
    return Math.abs(p.x - l.x) < 0.55 && Math.abs(p.z - l.z) < 0.6 && p.y > -0.1 && p.y < l.top + 0.2;
  }

  /** Is `p` on the stair? */
  onStair(p) {
    return p.x >= STAIR.minX - 0.3 && p.x <= STAIR.maxX + 0.3 && p.z >= STAIR.minZ - 0.3 && p.z <= STAIR.maxZ + 0.3;
  }

  /**
   * Where to walk to get from `from` toward `to`: straight there on the same
   * level; otherwise by way of the stair (its foot, then its top, or back) -
   * or, on the scanned roof, the ladder up the building (`out.climb` says
   * "go up it now"); down off the building's roof is just a drop.
   */
  routeToward(from, to, out = new THREE.Vector3()) {
    const rise = to.y - from.y;
    out.climb = false;
    if (Math.abs(rise) < 1) return out.copy(to);
    if (this.scan) {
      const l = this.scan.ladder;
      if (rise < 0) return out.copy(to);
      if (Math.hypot(from.x - l.x, from.z - l.z) > 0.5) return out.set(l.x, from.y, l.z);
      out.set(l.x, from.y, l.z);
      out.climb = true;
      return out;
    }
    const x = (STAIR.minX + STAIR.maxX) / 2;
    if (rise > 0) {
      if (this.onStair(from)) return out.set(x, from.y, STAIR.minZ - 1.2);
      return out.set(x, from.y, STAIR.maxZ + 0.6);
    }
    if (this.onStair(from)) return out.set(x, from.y, STAIR.maxZ + 1.2);
    return out.set(x, from.y, STAIR.minZ + 0.2);
  }

  /** The hut's door swings open for the next one through it. */
  openDoor() {
    this.doorOpen = 1.8;
    this.events.emit("door-open", { position: HUT_DOOR.clone() });
  }

  /** The city around you: lit towers standing in the smoke, far below and away. */
  _buildSkyline() {
    const windows = windowsTexture(5, 0.32);
    windows.repeat.set(2, 3);
    this.owned.textures.push(windows);
    const material = this._track(new THREE.MeshStandardMaterial({ color: 0x15171b, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 0.55, roughness: 0.95 }));
    const count = 110;
    const towers = new THREE.InstancedMesh(this.kit.geometries.unitBox, material, count);
    const r = rng(41);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const a = r() * Math.PI * 2;
      // Mostly below you: this is the tallest building for a while, and the
      // city should read as something you look down on, not a canyon.
      const d = 95 + r() * 150;
      const top = -85 + r() * 60 + (d > 200 ? 20 : 0);
      const h = 60 + r() * 60;
      const w = 14 + r() * 24;
      p.set(Math.cos(a) * d, top - h / 2, Math.sin(a) * d);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI);
      s.set(w, h, w * (0.6 + r() * 0.8));
      m.compose(p, q, s);
      towers.setMatrixAt(i, m);
    }
    towers.name = "Skyline";
    this.root.add(towers);
  }

  _buildLights() {
    const g = this.groups.lights;
    this.hemisphere = new THREE.HemisphereLight(0x33405e, 0x3a1a0c, 0.55);
    this.moon = new THREE.DirectionalLight(0x9fb2d6, 0.9);
    this.moon.position.set(-30, 60, -20);
    g.add(this.hemisphere, this.moon);
    // Two floods and two fire glows from the ledges: a fixed four.
    this.points = [];
    for (const f of this.floods) {
      const light = new THREE.PointLight(0xffe2b8, 55, 30, 1.6);
      light.position.copy(f);
      g.add(light);
      this.points.push({ light, base: 55, flicker: 0 });
    }
    // No fire up here any more: police lights wash up the facade from the
    // street and the helicopters - red on one side, blue on the other,
    // flashing out of step.
    for (const [x, colour] of [[this.bounds.minX - 0.5, 0xff2a22], [this.bounds.maxX + 0.5, 0x2a5cff]]) {
      const light = new THREE.PointLight(colour, 26, 26, 1.5);
      light.position.set(x, -1.5, 0);
      g.add(light);
      this.points.push({ light, base: 26, flicker: 1, police: x > 0 ? 0.5 : 0 });
    }
  }

  _buildPickups() {
    const k = this.kit;
    // One up on the deck: worth the climb.
    for (const [x, z, y] of [[-13, 2, 0], [15, 2, DECK.y], [2, 7, 0], [-7, -15, 0]]) {
      const sack = k.sack({ hp: 1, spheres: 7 });
      sack.position.set(x, y + 0.4, z);
      this.groups.pickups.add(sack);
      this._ticking.push(sack);
      this.breakables.push(sack.userData.glass);
    }
  }

  _buildOrbs() {
    this.orbs = [];
    const core = this._track(new THREE.MeshBasicMaterial({ color: 0xc8fbff }));
    const halo = this._track(new THREE.MeshBasicMaterial({ color: 0x46d8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (let i = 0; i < 8; i += 1) {
      const mesh = new THREE.Mesh(this.kit.geometries.unitSphere, core);
      mesh.scale.setScalar(0.28);
      const glow = new THREE.Mesh(this.kit.geometries.unitSphere, halo);
      glow.scale.setScalar(2.6);
      mesh.add(glow);
      mesh.visible = false;
      this.groups.orbs.add(mesh);
      this.orbs.push({ mesh, velocity: new THREE.Vector3(), life: 0, active: false });
    }
  }

  /**
   * The scientists' other weapons: a laser each (an aiming line that
   * tracks, then a beam down the locked line) and a few grenades (lobbed,
   * a warning ring where they land, then the blast).
   */
  _buildWeapons() {
    const g = this.groups.weapons;
    this.laserGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.laserGeometry.translate(0, 0, 0.5); // from the hand, along +Z
    this.owned.geometries.push(this.laserGeometry);
    this.lasers = new Map();
    this._laserParts = { g };
    const grenadeMat = this._track(new THREE.MeshStandardMaterial({ color: 0x2b2f26, roughness: 0.6, metalness: 0.5 }));
    const blinkMat = this._track(new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.ringGeometry = new THREE.RingGeometry(0.92, 1, 40);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.owned.geometries.push(this.ringGeometry);
    this.grenades = [];
    for (let i = 0; i < 6; i += 1) {
      const mesh = new THREE.Mesh(this.kit.geometries.unitSphere, grenadeMat);
      mesh.scale.set(0.16, 0.2, 0.16);
      const blink = new THREE.Mesh(this.kit.geometries.unitSphere, blinkMat);
      blink.scale.setScalar(0.45);
      blink.position.y = 0.9;
      mesh.add(blink);
      const ringMat = this._track(new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ring = new THREE.Mesh(this.ringGeometry, ringMat);
      ring.scale.setScalar(GRENADE.radius);
      ring.visible = false;
      mesh.visible = false;
      g.add(mesh, ring);
      this.grenades.push({ mesh, blink, ring, velocity: new THREE.Vector3(), state: "idle", t: 0 });
    }
  }

  /** The laser rig for one scientist (made on first use). */
  _laser(sci) {
    let l = this.lasers.get(sci);
    if (!l) {
      const material = this._track(new THREE.MeshBasicMaterial({ color: 0xff2a1e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const mesh = new THREE.Mesh(this.laserGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.groups.weapons.add(mesh);
      l = { mesh, material, fade: 0, aiming: false };
      this.lasers.set(sci, l);
    }
    return l;
  }

  /** Where a beam from `from` toward `to` stops: the first cover in its way, or its range. */
  _laserEnd(from, to, out) {
    const dir = _v.subVectors(to, from).normalize();
    for (let s = 0.5; s < LASER.range; s += 0.4) {
      out.copy(from).addScaledVector(dir, s);
      if (out.y < (this.groundAt(out, out.y + 0.2) ?? -100) - 0.05) return out;
      if (s > 1.2 && this.blocked(out, 0.05)) return out;
    }
    return out.copy(from).addScaledVector(dir, LASER.range);
  }

  _placeLaser(l, origin, to, width) {
    const from = _laserFrom.copy(origin);
    const end = this._laserEnd(from, to, _laserTo);
    const length = from.distanceTo(end);
    l.mesh.position.copy(from);
    l.mesh.lookAt(end);
    l.mesh.scale.set(width, width, length);
    l.mesh.visible = true;
    return end;
  }

  /** The aiming line: thin, flickering, following you. */
  showLaser(sci, from, to, alpha) {
    const l = this._laser(sci);
    if (l.fade > 0) return;
    l.aiming = true;
    this._placeLaser(l, from, to, 0.025);
    l.material.opacity = alpha * (0.6 + Math.random() * 0.4);
  }

  hideLaserAim(sci) {
    const l = this.lasers.get(sci);
    if (!l || !l.aiming || l.fade > 0) return;
    l.aiming = false;
    l.mesh.visible = false;
  }

  /** The shot: a hot beam down the locked line for a moment; on the line, you're hit. */
  fireLaser(sci, origin, to, ctx) {
    const l = this._laser(sci);
    l.aiming = false;
    const from = origin.clone();
    const end = this._placeLaser(l, from, to, 0.16).clone();
    l.fade = LASER.beam;
    l.material.opacity = 1;
    this.events.emit("laser-fired", { from: from.clone(), to: end.clone() });
    // On the line (the beam's segment, at chest height)?
    const seg = new THREE.Line3(from.clone(), end);
    const chest = _v.copy(ctx.player).setY(ctx.player.y + 1.1);
    const closest = seg.closestPointToPoint(chest, true, new THREE.Vector3());
    if (closest.distanceTo(chest) < LASER.width) {
      ctx.hits.push({ damage: LASER.damage, from: from.clone(), knock: 2.5, source: "laser" });
    }
  }

  /** A grenade, lobbed from `from` to land at `to` after GRENADE.flight seconds. */
  throwGrenade(from, to) {
    const g = this.grenades.find((x) => x.state === "idle");
    if (!g) return;
    const land = to.clone();
    land.y = this.groundAt(land, Math.max(land.y, 0) + 0.5) ?? -20;
    const t = GRENADE.flight;
    g.velocity.set((land.x - from.x) / t, (land.y - from.y) / t + 0.5 * 22 * t, (land.z - from.z) / t);
    g.mesh.position.copy(from);
    g.mesh.visible = true;
    g.state = "flying";
    g.t = 0;
    this.events.emit("grenade-thrown", { position: from.clone() });
  }

  _updateWeapons(dt, time, ctx) {
    for (const l of this.lasers.values()) {
      if (l.fade <= 0) continue;
      l.fade -= dt;
      l.material.opacity = Math.max(0, l.fade / LASER.beam);
      if (l.fade <= 0) l.mesh.visible = false;
    }
    for (const g of this.grenades) {
      if (g.state === "idle") continue;
      g.t += dt;
      const p = g.mesh.position;
      if (g.state === "flying") {
        g.velocity.y -= 22 * dt;
        p.addScaledVector(g.velocity, dt);
        g.mesh.rotation.x += dt * 9;
        const ground = this.groundAt(p, p.y + 0.3);
        if (ground !== null && p.y <= ground + 0.12 && g.velocity.y < 0) {
          p.y = ground + 0.12;
          g.state = "armed";
          g.t = 0;
          g.ring.position.set(p.x, ground + 0.04, p.z);
          g.ring.visible = true;
        } else if (p.y < FALL_LIMIT) {
          // Over the edge with it: gone.
          g.state = "idle";
          g.mesh.visible = false;
        }
      } else if (g.state === "armed") {
        // Blinking faster and faster; the ring shows how far it reaches.
        const k = g.t / GRENADE.fuse;
        g.blink.visible = Math.sin(time * (14 + k * 40)) > 0;
        g.ring.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(time * (8 + k * 20)));
        if (g.t >= GRENADE.fuse) this._explodeGrenade(g, ctx);
      }
    }
  }

  _explodeGrenade(g, ctx) {
    const at = g.mesh.position.clone();
    g.state = "idle";
    g.mesh.visible = false;
    g.ring.visible = false;
    this.events.emit("explosion", { position: at.clone(), strength: 0.75, grenade: true });
    // You, if you're in it (on its level).
    if (!ctx.frozen) {
      const d = _v.copy(ctx.player).distanceTo(at);
      if (d < GRENADE.radius && Math.abs(ctx.player.y - at.y) < 2) {
        ctx.hits.push({ damage: Math.round(GRENADE.damage * (1 - (d / GRENADE.radius) * 0.6)), from: at, knock: GRENADE.knock, source: "grenade" });
      }
    }
    // And anyone of theirs caught in it - lure them in.
    for (const e of this.enemies) {
      if (!e.alive || e.position.distanceTo(at) > GRENADE.radius) continue;
      if (e.hit(3, at)) {
        const i = this.breakables.indexOf(e.hurt);
        if (i >= 0) this.breakables.splice(i, 1);
        this.state.downs += 1;
        this.events.emit("enemy-down", { enemy: e, position: e.position.clone(), by: "grenade" });
      }
    }
  }

  _buildHelicopter() {
    const asset = this.assets.get("helicopter");
    this.heli = asset ? new Helicopter(asset.template) : null;
    if (this.heli) {
      this.heli.root.visible = false;
      this.root.add(this.heli.root);
      // The approach, ending in a hover over the pad.
      this.heliPath = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-150, 45, -170),
        new THREE.Vector3(-70, 30, -90),
        new THREE.Vector3(-20, 16, -30),
        new THREE.Vector3(HELIPAD.x, 7.5, HELIPAD.z - 1),
      ]);
    }
  }

  /* ---------------- Collision helpers ---------------- */

  /**
   * Does a box stand in the way of someone at `p` (feet at p.y)? Only on
   * their level: the deck's railing doesn't stop you on the roof below it,
   * and the plant on the roof doesn't stop you up on the deck.
   */
  _inTheWay(box, p) {
    return p.y < box.max.y - 0.25 && p.y + 1.7 > box.min.y;
  }

  /** Is a circle at `p` inside any cover (or, on the scan, a wall)? */
  blocked(p, radius = 0.45) {
    for (const box of this.cover) {
      if (!this._inTheWay(box, p)) continue;
      if (p.x > box.min.x - radius && p.x < box.max.x + radius && p.z > box.min.z - radius && p.z < box.max.z + radius) return true;
    }
    if (this.scan) {
      if (this._scanWall(p.x, p.z, p.y)) return true;
      for (const [dx, dz] of RING) if (this._scanWall(p.x + dx * radius, p.z + dz * radius, p.y)) return true;
    }
    return false;
  }

  /** Push a circle at `p` (in place) out of every cover box (and the scan's walls). */
  resolveCircle(p, radius = 0.45) {
    if (this.scan && !this.onLadder(p)) {
      // Step back out of any wall the circle's rim has gone into.
      for (let pass = 0; pass < 4; pass += 1) {
        let moved = false;
        for (const [dx, dz] of RING) {
          if (!this._scanWall(p.x + dx * radius, p.z + dz * radius, p.y)) continue;
          p.x -= dx * 0.07;
          p.z -= dz * 0.07;
          moved = true;
        }
        if (!moved) break;
      }
    }
    for (const box of this.cover) {
      if (!this._inTheWay(box, p)) continue;
      const cx = THREE.MathUtils.clamp(p.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(p.z, box.min.z, box.max.z);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * radius;
        p.z = cz + (dz / d) * radius;
      } else {
        // Centre inside the box: out through the nearest face.
        const pushes = [
          [box.min.x - radius - p.x, 0],
          [box.max.x + radius - p.x, 0],
          [0, box.min.z - radius - p.z],
          [0, box.max.z + radius - p.z],
        ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += pushes[0][0];
        p.z += pushes[0][1];
      }
    }
    return p;
  }

  /**
   * Keep the player out of the cover and the parapets. The open edges don't
   * hold you: walk off one and you fall (the host asks groundAt()).
   */
  clampPlayer(p) {
    return this.resolveCircle(p, 0.45);
  }

  /** Nothing in the way between two points (for a patient deciding to charge)? */
  clearLine(a, b) {
    const steps = Math.ceil(a.distanceTo(b) / 0.6);
    for (let i = 1; i < steps; i += 1) {
      _w.lerpVectors(a, b, i / steps);
      if (this.blocked(_w, 0.2)) return false;
    }
    return true;
  }

  /* ---------------- Waves ---------------- */

  _character(name) {
    const asset = this.assets.get(name);
    return asset ? cloneCharacter(asset.template) : null;
  }

  _gadget(name, length) {
    const asset = this.assets.get(name);
    if (!asset) return null;
    const g = asset.template.clone(true);
    const size = asset.size;
    g.scale.setScalar(length / Math.max(size.x, size.y, size.z));
    if (name === "gadgetBrass") {
      g.traverse((o) => {
        if (o.isMesh) {
          o.material = this._track(new THREE.MeshStandardMaterial({ color: 0xb4863a, metalness: 0.85, roughness: 0.35 }));
        }
      });
    }
    const holder = new THREE.Group();
    holder.add(g);
    // Bone space is not metres: undo the bone chain's scale so the gadget
    // keeps its real size in the hand.
    holder.userData.fixScale = length;
    return holder;
  }

  /** The brute: a static model (no skeleton), scaled to its height. */
  _brute() {
    const asset = this.assets.get("brute");
    if (!asset) return null;
    const model = asset.template.clone(true);
    model.scale.setScalar(BRUTE.height / Math.max(0.01, asset.size.y));
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
    });
    return model;
  }

  /**
   * The story's waves (WAVE_TIMES says when): everyone comes out of the hut's
   * door - the scientists first, then the patients one at a time. The brute
   * from the fourth on; the last is everyone left.
   */
  _spawnWave(index) {
    this.state.wave = index;
    const SPECS = {
      1: { scientists: ["scientistRadioman"], patients: 2 },
      2: { scientists: ["scientistRust"], patients: 3 },
      3: { scientists: ["scientistRadioman"], patients: 3 },
      4: { scientists: ["scientistRust"], patients: 2, brutes: 1 },
      5: { scientists: ["scientistRadioman", "scientistRust"], patients: 3 },
      6: { scientists: ["scientistRust"], patients: 4, brutes: 1 },
    };
    const spec = SPECS[index] ?? this._endlessWave(index);
    const r = this.random;
    let delay = 0;
    for (const [i, name] of spec.scientists.entries()) {
      const scientist = new Scientist(this, {
        model: this._character(name),
        position: HUT_DOOR.clone().add(new THREE.Vector3(0, 0, 0.5)),
        enter: new THREE.Vector3(HUT_DOOR.x + 2 + r() * 8, 0, HUT_DOOR.z + 4 + r() * 6),
        gadget: this._gadget(i % 2 ? "gadgetCoil" : "gadgetBrass", 0.6),
        seed: index * 17 + 3 + i,
      });
      this._addEnemy(scientist);
      this.openDoor();
    }
    const out = () => HUT_DOOR.clone().add(new THREE.Vector3((r() - 0.5) * 3, 0, 2.2 + r() * 2));
    for (let i = 0; i < (spec.brutes ?? 0); i += 1) {
      delay += 1.2;
      this._addEnemy(new Patient(this, { brute: true, model: this._brute(), position: HUT_DOOR.clone().add(new THREE.Vector3(0, 0, -0.6)), out: out(), delay }));
    }
    for (let i = 0; i < spec.patients; i += 1) {
      delay += 1.1;
      this._addEnemy(new Patient(this, { model: this._character("patient"), position: HUT_DOOR.clone().add(new THREE.Vector3(0, 0, -0.6)), out: out(), delay }));
    }
    this.events.emit("wave", { index, scientist: spec.scientists[0], brute: (spec.brutes ?? 0) > 0 });
  }

  /** Waves past the story's (endless): bigger as it goes on, a brute every third. */
  _endlessWave(index) {
    const extra = Math.max(0, index - 6);
    return {
      scientists: extra > 3 ? ["scientistRadioman", "scientistRust"] : [index % 2 ? "scientistRadioman" : "scientistRust"],
      patients: Math.min(6, 3 + Math.floor(extra / 2)),
      brutes: index % 3 === 0 ? 1 + (extra > 8 ? 1 : 0) : 0,
    };
  }

  /** Endless runs spawn forever: drop enemies that have gone over the edge or been gone a while. */
  _cullFallen() {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      if (!e.removed) continue;
      this.groups.enemies.remove(e.root);
      this.enemies.splice(i, 1);
    }
  }

  _addEnemy(enemy) {
    // Hand gadgets live in bone space; correct their scale for the bone chain.
    if (enemy.gadget?.userData.fixScale && enemy.gadget.parent) {
      enemy.root.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      enemy.gadget.parent.getWorldScale(s);
      enemy.gadget.scale.setScalar(1 / Math.max(1e-6, s.x));
      enemy.gadget.position.set(0, 0, 0);
    }
    this.enemies.push(enemy);
    this.groups.enemies.add(enemy.root);
    this.breakables.push(enemy.hurt);
  }

  get enemiesAlive() {
    return this.enemies.filter((e) => e.alive).length;
  }

  /* ---------------- Orbs ---------------- */

  fireOrb(from, to) {
    const orb = this.orbs.find((o) => !o.active);
    if (!orb) return;
    orb.active = true;
    orb.life = 0;
    orb.mesh.position.copy(from);
    orb.velocity.subVectors(to, from).normalize().multiplyScalar(SCIENTIST.orbSpeed);
    orb.mesh.visible = true;
    this.events.emit("orb-fired", { position: from.clone() });
  }

  _updateOrbs(dt, ctx) {
    for (const orb of this.orbs) {
      if (!orb.active) continue;
      orb.life += dt;
      const p = orb.mesh.position;
      p.addScaledVector(orb.velocity, dt);
      orb.mesh.scale.setScalar(0.28 + Math.sin(orb.life * 30) * 0.03);
      let end = orb.life > 4 || p.y < 0.1 || Math.abs(p.x) > EDGE + 20 || Math.abs(p.z) > EDGE + 20;
      if (!end && this.blocked(p, 0.05) && p.y < 2.2) end = true;
      if (!end && !ctx.frozen) {
        _v.copy(ctx.player).setY(ctx.player.y + 1.1);
        if (p.distanceTo(_v) < 0.75) {
          ctx.hits.push({ damage: SCIENTIST.damage, from: p.clone(), knock: 3, source: "orb" });
          end = true;
        }
      }
      if (end) {
        orb.active = false;
        orb.mesh.visible = false;
        this.events.emit("orb-burst", { position: p.clone() });
      }
    }
  }

  /* ---------------- Balls ---------------- */

  /**
   * A player's ball hit a breakable. Returns null, {partial} or the result -
   * the same contract as MeltdownLevel.breakTarget.
   */
  breakTarget(mesh, power = 1, from = null) {
    const data = mesh?.userData;
    if (!data?.alive) return null;
    const position = mesh.getWorldPosition(new THREE.Vector3());
    const remove = () => {
      const i = this.breakables.indexOf(mesh);
      if (i >= 0) this.breakables.splice(i, 1);
    };
    if (data.kind === "enemy") {
      const enemy = data.enemy;
      const down = enemy.hit(Math.min(power, 3), from);
      if (!down) {
        this.events.emit("enemy-hit", { enemy, position });
        return { partial: true, kind: "enemy", enemyKind: enemy.kind, position };
      }
      remove();
      this.state.downs += 1;
      this.events.emit("enemy-down", { enemy, position });
      return { kind: "enemy", enemyKind: enemy.kind, position };
    }
    if (data.kind === "sack") {
      if (!data.node.userData.hit(power)) return { partial: true, kind: "sack", position };
      remove();
      return { kind: "sack", spheres: data.spheres, position };
    }
    return null;
  }

  /* ---------------- Runtime ---------------- */

  /**
   * @param {object} p
   * @param {number} p.dt
   * @param {number} p.time
   * @param {THREE.Vector3} p.player         the player's position
   * @param {THREE.Vector3} p.playerVelocity
   * @returns {{damage:number, from:THREE.Vector3, knock:number, source:string}[]} hits on the player this frame
   */
  update({ dt, time, player, playerVelocity }) {
    const s = this.state;
    this.fire.setTime(time);
    if (this.cutscene?.kind === "arrival") {
      // The arrival is over (the host has seen `done`): hand the roof over.
      if (!this._arrival) this.cutscene = null;
      else {
        // Nothing starts while the doors are opening: no waves, no clock.
        for (const piece of this._ticking) piece.userData.tick?.(dt, time);
        this._updateArrival(dt);
        return [];
      }
    }
    if (this._liftClose < 1) {
      this._liftClose = Math.min(1, this._liftClose + dt / 1.2);
      this.lift?.userData.lift.setDoors(1 - this._liftClose);
    }
    s.time += dt;
    const hits = [];
    // Enemies keep fighting while the helicopter waits at the ledge; they
    // only stand down for the cutscenes and once it has gone.
    const frozen = s.ending === "victory" || s.ending === "survive" || s.ending === "left";
    const ctx = { player, playerVelocity, hits, frozen };

    // The story's waves, on the clock - or a little early once the roof is
    // nearly clear (never sooner than 12 s after the last).
    const waves = WAVE_TIMES.length;
    if (!frozen && s.wave < waves) {
      const due = WAVE_TIMES[s.wave];
      const early = s.wave > 0 && this.enemiesAlive === 0 && s.time > WAVE_TIMES[s.wave - 1] + 12;
      if (s.time > due || early) this._spawnWave(s.wave + 1);
    }
    // Endless: after the set waves, another every 12-24 s (sooner the longer
    // you last), or as soon as the roof is nearly clear.
    if (this.endless && s.wave >= waves) {
      if (!s.nextWaveAt) s.nextWaveAt = s.time + 24;
      if (s.time > s.nextWaveAt || (this.enemiesAlive <= 1 && s.time > s.nextWaveAt - 16)) {
        this._spawnWave(s.wave + 1);
        s.nextWaveAt = s.time + Math.max(12, 24 - s.wave * 0.6);
      }
    }
    this._cullFallen();

    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      enemy.update(dt, time, ctx);
      if (enemy.state === "fall" && !enemy.counted) {
        enemy.counted = true;
        enemy.hurt.userData.alive = false;
        const i = this.breakables.indexOf(enemy.hurt);
        if (i >= 0) this.breakables.splice(i, 1);
        s.falls += 1;
      }
      if (enemy.removed) enemy.root.visible = false;
    }
    this._updateOrbs(dt, ctx);
    this._updateChaos(dt, time, ctx);
    for (const piece of this._ticking) piece.userData.tick?.(dt, time);

    for (const p of this.points) {
      if (p.flicker) {
        p.flash = Math.max(0, (p.flash ?? 0) - dt * 3);
        // Police strobes: double flashes, the two sides out of step.
        const beat = (time * 1.8 + (p.police ?? 0)) % 1;
        const on = beat < 0.1 || (beat > 0.18 && beat < 0.28) ? 1 : 0.15;
        p.light.intensity = p.base * on * (1 + p.flash * 5);
      }
    }
    // The hut's door: swings open for each one through it, then shuts.
    if (this.door) {
      this.doorOpen = Math.max(0, this.doorOpen - dt);
      const want = this.doorOpen > 0 ? 1.7 : 0;
      this.doorAngle += (want - this.doorAngle) * Math.min(1, dt * (want > this.doorAngle ? 7 : 3));
      this.door.rotation.y = -this.doorAngle;
    }
    this._updateWeapons(dt, time, ctx);

    // The roof is clear: the helicopter stops circling and comes in now.
    const everyone = !this.endless && s.wave === WAVE_TIMES.length && this.enemiesAlive === 0;
    if (!s.cleared && everyone) {
      s.cleared = true;
      this.events.emit("clear", {});
      if (!s.heliArrived) s.heliAt = Math.min(s.heliAt, s.time + 12);
      else if (s.ending === "extraction") this._startVictory();
    }

    this._updateHelicopter(dt, time);
    if (s.ending === "victory" || s.ending === "survive") this._updateEnding(dt, time);
    return hits;
  }

  /* ---------------- Arrival (the lift) ---------------- */

  /**
   * Phase B opens on the lift housing: the doors open, the player walks out
   * onto the roof, the camera settles behind them - then the roof starts.
   * A cutscene like the endings: `cutscene` says where the camera and the
   * player are, the host applies it. PLACEHOLDER staging (see elevator.js).
   */
  beginArrival() {
    this._arrival = { t: 0, opened: false };
    this._liftClose = 0;
    this.lift?.userData.lift.setDoors(0);
    this.cutscene = {
      kind: "arrival", camera: new THREE.Vector3(), look: new THREE.Vector3(), player: new THREE.Vector3(),
      playerYaw: 0, action: "stand", timeScale: 1, done: false, hidePlayer: false, hold: 1, reachUp: 0,
    };
    this._updateArrival(0);
    return this.cutscene;
  }

  _updateArrival(dt) {
    const a = this._arrival;
    const out = this.cutscene;
    a.t += dt;
    const t = a.t;
    const smooth = THREE.MathUtils.smoothstep;
    const lift = this.lift?.userData.lift;
    if (!a.opened && t > 0.7) {
      a.opened = true;
      this.events.emit("lift-open", {});
    }
    lift?.setDoors((t - 0.7) / 0.9);
    lift?.setLight(t < 0.5 ? (Math.sin(t * 40) > 0 ? 1 : 0.3) : 1);

    // Walk out of the cabin to the spawn point.
    const walk = smooth(t, 1.2, 2.8);
    out.player.set(LIFT_DOOR.x, 0, LIFT_DOOR.z + 1.4).lerp(ROOF_SPAWN, walk);
    out.playerYaw = 0;
    out.action = t > 1.2 && t < 2.8 ? "run" : "stand";
    out.speed = out.action === "run" ? 4.5 : 0;

    // In front of the housing, dollying back as the player walks toward the
    // camera; then a cut to the game camera (a swing round would turn the
    // view through 180 degrees - the doors face away from the game camera).
    if (t < ARRIVAL_CUT) {
      const dolly = smooth(t, 0.9, ARRIVAL_CUT);
      out.camera.set(-1.3, 1.8, LIFT_DOOR.z - 5.9).lerp(_w.set(-1.6, 2.0, LIFT_DOOR.z - 7.7), dolly);
      out.look.set(0, 1.3, LIFT_DOOR.z).lerp(_w.copy(out.player).setY(1.2), smooth(t, 1.2, 2.4));
    } else {
      out.camera.copy(ROOF_SPAWN).add(ARRIVAL_CAMERA);
      out.look.copy(ROOF_SPAWN).add(ARRIVAL_LOOK);
    }
    if (t >= ARRIVAL_SECONDS) {
      out.done = true;
      this._arrival = null;
      this.events.emit("arrived", {});
    }
  }

  /** 0 (silent) .. 1 (overhead): how loud the rotors should be. */
  get rotorLevel() {
    const s = this.state;
    if (s.ending === "left") return Math.max(0, 1 - s.extractT / 6);
    const lead = s.heliAt - s.time;
    return s.ending ? 1 : THREE.MathUtils.clamp(1 - lead / 16, 0, 1);
  }

  /* ---------------- Chaos ---------------- */

  /**
   * The roof gets worse the longer you are on it: `chaos` runs 0 -> 1 as the
   * hidden timer runs down. No fire up here (the user's call) - explosions
   * tear out of the facade below the edges, the building shudders, and ash
   * fills the air. The host reads `chaos` for fog, shake and sound.
   */
  _buildChaos() {
    this.state.blastTimer = 9;
    this.state.tremorTimer = 15;

    // Ash: one Points cloud over the whole roof.
    const count = 220;
    const positions = new Float32Array(count * 3);
    this.emberSpeed = new Float32Array(count);
    const r = rng(99);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (r() - 0.5) * EDGE * 2.6;
      positions[i * 3 + 1] = r() * 14;
      positions[i * 3 + 2] = (r() - 0.5) * DEPTH * 2.6;
      this.emberSpeed[i] = 0.3 + r() * 0.9;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.owned.geometries.push(geometry);
    this.embers = new THREE.Points(geometry, this.kit.materials.ember.clone());
    this._track(this.embers.material);
    this.embers.material.color.setHex(0x9a958e);
    this.embers.material.opacity = 0;
    this.embers.frustumCulled = false;
    this.groups.hazards.add(this.embers);
  }

  _updateChaos(dt, time, ctx) {
    const s = this.state;
    const chaos = s.heliArrived ? 1 : THREE.MathUtils.clamp(s.time / (this.endless ? 150 : s.heliAt), 0, 1);
    s.chaos = chaos;
    const live = s.ending !== "left" && s.ending !== "victory";

    // Explosions tearing out of the facade below the edges.
    s.blastTimer -= dt;
    if (live && s.time > 6 && s.blastTimer <= 0) {
      const side = this.random() < 0.5 ? -1 : 1;
      const b = this.bounds;
      const position = new THREE.Vector3(side > 0 ? b.maxX + 0.8 : b.minX - 0.8, -1 - this.random() * 5, THREE.MathUtils.lerp(b.minZ, b.maxZ, 0.1 + this.random() * 0.8));
      this.events.emit("explosion", { position, strength: 0.5 + chaos * 0.6 });
      const glow = this.points.find((p) => p.flicker && Math.sign(p.light.position.x) === side);
      if (glow) glow.flash = 1;
      s.blastTimer = 12 - chaos * 7 + this.random() * 3;
    }

    // The building shudders.
    s.tremorTimer -= dt;
    if (live && s.time > 12 && s.tremorTimer <= 0) {
      this.events.emit("tremor", { strength: 0.3 + chaos * 0.5 });
      s.tremorTimer = 18 - chaos * 9 + this.random() * 4;
    }

    // Ash drifting across.
    this.embers.material.opacity = 0.1 + chaos * 0.5;
    const array = this.embers.geometry.attributes.position.array;
    for (let i = 0; i < this.emberSpeed.length; i += 1) {
      array[i * 3 + 1] += this.emberSpeed[i] * dt * (0.4 + chaos * 0.6);
      array[i * 3] += Math.sin(time * 0.7 + i) * dt * 0.8 + dt * 1.2;
      if (array[i * 3 + 1] > 14) {
        array[i * 3 + 1] = -2;
        array[i * 3] = (this.random() - 0.5) * EDGE * 2.6;
      }
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
  }

  /* ---------------- The helicopter ---------------- */

  _updateHelicopter(dt, time) {
    const s = this.state;
    if (!this.heli) {
      if (!s.heliArrived && s.time >= s.heliAt) this._arrive();
      else if (s.ending === "extraction" || s.ending === "left") this._updateExtraction(dt, time);
      return;
    }
    const heli = this.heli;
    const lead = s.heliAt - s.time;
    const flight = 12; // seconds from first glimpse to the hover
    if (!s.heliArrived) {
      if (lead < flight) {
        const t = THREE.MathUtils.clamp(1 - lead / flight, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2.2);
        this.heliPath.getPointAt(eased, heli.root.position);
        const ahead = this.heliPath.getPointAt(Math.min(1, eased + 0.02)).sub(heli.root.position);
        if (ahead.lengthSq() > 1e-4) {
          // Nose down while it is going fast, flattening out into the hover.
          heli.orient(ahead, { pitch: -0.16 * (1 - eased), bank: Math.sin(time * 0.9) * 0.03 + (1 - eased) * 0.1 });
          this._heliYaw = heli.root.rotation.y;
        }
        heli.root.visible = true;
        if (!s.heliSeen) {
          s.heliSeen = true;
          this.events.emit("heli-seen", {});
        }
      }
      if (s.time >= s.heliAt) this._arrive();
    } else if (s.ending === "extraction" || s.ending === "left") {
      this._updateExtraction(dt, time);
    }
    if (heli.root.visible) heli.update(dt, { rotor: 1, light: 1 });
  }

  _arrive() {
    const s = this.state;
    s.heliArrived = true;
    if (s.cleared || this.enemiesAlive === 0) {
      this._startVictory();
    } else {
      // It cannot land with them still up here. It swings out beyond the
      // east ledge and waits, ladder down - for a while.
      s.ending = "extraction";
      s.extractT = 0;
      this._extractFrom = this.heli ? this.heli.root.position.clone() : new THREE.Vector3();
      this.events.emit("heli-arrived", { ending: "extraction", window: EXTRACT_WINDOW });
    }
  }

  _startVictory() {
    const s = this.state;
    s.ending = "victory";
    s.endingT = 0;
    this.cutscene = null;
    this._victoryFrom = this.heli ? this.heli.root.position.clone() : HELIPAD.clone();
    this.events.emit("heli-arrived", { ending: "victory" });
  }

  /** Where the helicopter holds while it waits for you at the east ledge. */
  get _holdPoint() {
    // Nose to +Z (yaw pi), so its door side - and the ladder - faces the roof.
    return new THREE.Vector3(this.eastEdge + 3.45, 7.1, this.holdZ);
  }

  _updateExtraction(dt, time) {
    const s = this.state;
    const heli = this.heli;
    s.extractT += dt;
    const t = s.extractT;
    const hold = this._holdPoint;
    if (!heli) {
      if (s.ending === "extraction" && t > EXTRACT_WINDOW) {
        s.ending = "left";
        s.extractT = 0;
        this.events.emit("heli-left", {});
      }
      return;
    }
    if (s.ending === "extraction") {
      const k = THREE.MathUtils.smoothstep(t, 0, 3);
      heli.root.position.lerpVectors(this._extractFrom, hold, k);
      heli.root.position.y += Math.sin(time * 1.3) * 0.25 * k;
      heli.root.position.z += Math.sin(time * 0.6) * 0.4 * k;
      const yaw = THREE.MathUtils.lerp(this._heliYaw ?? 0, Math.PI, k);
      heli.root.rotation.set(0, yaw, Math.sin(time * 0.8) * 0.04);
      // Still here, still waiting... then it has to go.
      if (t > EXTRACT_WINDOW) {
        s.ending = "left";
        s.extractT = 0;
        this._leaveFrom = heli.root.position.clone();
        this.events.emit("heli-left", {});
      }
    } else {
      const k = t;
      heli.root.position.copy(this._leaveFrom).add(new THREE.Vector3(k * k * 1.6, k * k * 1.1, k * 3));
      heli.root.rotation.set(-0.15, Math.PI - Math.min(0.6, k * 0.2), -0.1);
      if (k > 12) heli.root.visible = false;
    }
  }

  /**
   * A point on the ladder, `h` metres up from its foot (world). Without the
   * helicopter model (tests, or a failed load) the ladder is where it would
   * hang, so every ending still plays.
   */
  ladderPoint(h, target = new THREE.Vector3()) {
    if (this.heli) return this.heli.ladderPoint(h, target);
    const base = this.state.ending === "victory" ? new THREE.Vector3(HELIPAD.x + 0.25, 0.05, HELIPAD.z + 1.2) : new THREE.Vector3(this.eastEdge + 2.2, 1.0, this.holdZ + 1.2);
    return target.copy(base).setY(base.y + h);
  }

  ladderBottom(target = new THREE.Vector3()) {
    return this.ladderPoint(0, target);
  }

  /**
   * While the helicopter waits at the ledge: "go" (get over there) or
   * "jump" (close enough - press jump), else null.
   */
  extractionHint(player) {
    const s = this.state;
    if (s.ending !== "extraction" || s.extractT < 2.6) return s.ending === "extraction" ? "go" : null;
    return this.canGrab(player) ? "jump" : "go";
  }

  /** Close enough to the ledge and the ladder to jump for it? */
  canGrab(player) {
    const s = this.state;
    if (s.ending !== "extraction" || s.extractT < 2.6) return false;
    const bottom = this.ladderBottom(_w);
    const dx = bottom.x - player.x;
    const dz = bottom.z - player.z;
    return player.x > this.eastEdge - 4.5 && Math.hypot(dx, dz) < 4.6;
  }

  /**
   * The story's latch was missed and the player is back on the roof: the
   * helicopter's waiting window starts over, so a retry can't run it out.
   */
  holdExtraction() {
    const s = this.state;
    if (s.ending === "extraction") s.extractT = Math.min(s.extractT, 2.7);
  }

  /** The player jumped for it: play the leap and carry them off. */
  grab(player) {
    const s = this.state;
    if (!this.canGrab(player)) return false;
    s.ending = "survive";
    s.endingT = 0;
    this.cutscene = null;
    this._playerAtEnding = player.clone();
    this._leaveFrom = this.heli ? this.heli.root.position.clone() : this._holdPoint;
    this.events.emit("ladder-grab", {});
    return true;
  }

  /* ---------------- Endings ---------------- */

  /**
   * The cutscenes, as data the host applies: where the camera is and looks,
   * and where the player is, which way they face, and what their arms are
   * doing (`hold` on the launcher, `reachUp` for the ladder).
   *
   * Victory: the helicopter comes down over the pad until its ladder
   * touches, the player runs to it and climbs, and it lifts away.
   * Survive: the player has jumped from the ledge for the ladder - the leap
   * in slow motion, the catch, and the helicopter hauling them off with the
   * patients still on the roof.
   */
  _updateEnding(dt, time) {
    const s = this.state;
    s.endingT += dt * (this.cutscene?.timeScale ?? 1);
    const t = s.endingT;
    const heli = this.heli;
    const out = this.cutscene ?? (this.cutscene = { camera: new THREE.Vector3(), look: new THREE.Vector3(), player: new THREE.Vector3(), playerYaw: 0, action: "run", timeScale: 1, done: false, hidePlayer: false, playerStart: null, hold: 1, reachUp: 0 });
    if (!out.playerStart) out.playerStart = this._playerAtEnding?.clone() ?? ROOF_SPAWN.clone();
    const start = out.playerStart;

    if (s.ending === "victory") {
      // Down until the ladder's foot is on the pad.
      const low = new THREE.Vector3(HELIPAD.x + 1.5, 6.25, HELIPAD.z);
      const come = THREE.MathUtils.smoothstep(t, 0, 3.2);
      const lift = THREE.MathUtils.smoothstep(t, 7.4, 10);
      if (heli) {
        heli.root.position.lerpVectors(this._victoryFrom, low, come);
        heli.root.position.y += lift * 16 + Math.sin(time * 1.2) * 0.08 * (1 - lift);
        heli.root.position.z -= lift * lift * 14;
        heli.root.rotation.set(-lift * 0.14, THREE.MathUtils.lerp(this._heliYaw ?? 0, 0, come), Math.sin(time) * 0.02);
      }
      const foot = this.ladderPoint(0);
      foot.y = Math.max(0, foot.y);
      const run = THREE.MathUtils.smoothstep(t, 1.6, 4.4);
      const climb = THREE.MathUtils.clamp((t - 4.5) / 2.6, 0, 1);
      if (climb <= 0) {
        out.player.lerpVectors(start, foot.clone().setY(0), run);
        _v.subVectors(foot, start);
        out.playerYaw = Math.atan2(-_v.x, -_v.z);
        out.action = run > 0 && run < 1 ? "run" : "idle";
        out.reachUp = 0;
        out.hold = 1;
      } else {
        // Hand over hand up the rungs: hands 2.1 m above the feet.
        this.ladderPoint(0.2 + climb * 4.6, out.player);
        out.player.y -= 1.9;
        out.player.y += Math.abs(Math.sin(climb * 18)) * 0.08;
        const centre = heli ? heli.root.getWorldPosition(new THREE.Vector3()) : low.clone();
        _v.subVectors(centre, out.player).setY(0).normalize();
        out.playerYaw = Math.atan2(-_v.x, -_v.z);
        // Body just in front of the rungs, facing them - not inside them.
        out.player.addScaledVector(_v, -0.32);
        out.action = "climb";
        out.reachUp = 1;
        out.hold = 0;
      }
      out.hidePlayer = t > 7.3;
      const orbit = t * 0.1 + 0.6;
      out.camera.set(HELIPAD.x + Math.sin(orbit) * 15, 3.5 + t * 0.45, HELIPAD.z + Math.cos(orbit) * 15);
      out.look.copy(heli ? heli.root.position : low).lerp(out.player, 0.5);
      out.done = t > 10.5;
    } else {
      // Survive: from wherever they jumped, to the rungs 2.8 m up.
      const leap = Math.min(1, t / 0.95);
      const away = Math.max(0, t - 0.95);
      if (heli) {
        heli.root.position.copy(this._leaveFrom).add(new THREE.Vector3(away * away * 1.2, away * away * 0.9 + away * 0.4, away * 1.5));
        heli.root.rotation.set(-0.12 * Math.min(1, away), Math.PI - Math.min(0.5, away * 0.15), -0.08 * Math.min(1, away));
      }
      const grip = this.ladderPoint(2.8);
      grip.y -= 2.05; // hands on the rung, body hanging below
      if (leap < 1) {
        out.player.lerpVectors(start, grip.clone().setX(grip.x - 0.32), leap);
        out.player.y += Math.sin(leap * Math.PI) * 1.1;
        out.action = "jump";
        out.reachUp = THREE.MathUtils.smoothstep(leap, 0.1, 0.7);
        out.hold = 1 - out.reachUp;
      } else {
        out.player.copy(grip);
        out.player.x -= 0.32; // hanging on the roof side of the rungs, facing them
        out.player.z += Math.sin(time * 2.1) * 0.08;
        out.action = "hang";
        out.reachUp = 1;
        out.hold = 0;
      }
      _v.set(1, 0, 0);
      out.playerYaw = Math.atan2(-_v.x, -_v.z);
      // Slow motion over the gap.
      out.timeScale = leap > 0.15 && leap < 0.8 ? 0.3 : 1;
      // First watching from the roof, then riding along beside the ladder
      // as it hauls you out over the burning city.
      const fixed = start.clone().add(new THREE.Vector3(-5.5, 2.2, 6.5));
      const trail = out.player.clone().add(new THREE.Vector3(-6.5, 1.2, 7));
      out.camera.lerpVectors(fixed, trail, THREE.MathUtils.smoothstep(away, 0.5, 2.5));
      out.look.copy(out.player).lerp(heli ? heli.root.position : grip, 0.3);
      out.done = t > 7;
    }
  }

  /** The host tells the level where the player stood when the ending began. */
  beginEnding(playerPosition) {
    this._playerAtEnding = playerPosition.clone();
  }

  /* ---------------- Lifecycle ---------------- */

  addTo(scene) {
    scene.add(this.root);
    return this;
  }

  /** Compile and upload everything before the roof is shown. */
  prewarm(renderer, camera) {
    const scene = this.root.parent ?? this.root;
    renderer.compile(scene, camera);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.userData?.disposeGeometry) o.userData.disposeGeometry.dispose();
    });
    this.lift?.userData.dispose?.();
    for (const m of this.owned.materials) m.dispose();
    for (const t of this.owned.textures) t.dispose();
    for (const g of this.owned.geometries) g.dispose();
    this.kit.dispose();
    this.fire.dispose();
    this.root.parent?.remove(this.root);
    this.enemies.length = 0;
    this.breakables.length = 0;
    this.events.clear();
  }
}
