/**
 * Off the roof, in 3D - the death you watch before the end screen when you
 * go over an open ledge or down a hatch (playtest round 4: "a scene of the
 * player falling off the building before the game over display. The camera
 * follows the player falling (and screaming), then mid-air the camera just
 * stops and the player continues falling").
 *
 *   0.0 s  the scream (the host's); the camera dives off the roof after you
 *   ..1.5  it chases from above and behind: your body tumbling, arms and legs
 *          flailing (player.js flail(), straight into the rig's uniforms),
 *          the burning tower's lit windows streaming up past, smoke and
 *          ember streaks rising through the frame
 *   1.5 s  the camera stops dead in mid-air; you fall on without it,
 *          shrinking into the haze and the dark below (the fog thickens)
 *   ~3.3   black (`black` 0..1, for the host's fade), then `onDone` - the
 *          host shows the end screen
 *
 * Down a hatch it is the same fall, but the camera cuts in under the slab
 * and the walls streaming past are a service shaft's (concrete, conduit,
 * caged lamps) instead of the facade.
 *
 * Any key, click or gamepad button skips to the end after SKIP_AFTER seconds
 * (not Esc: that is the pause menu; and nothing while the host is paused).
 * While it plays it owns the camera and the player's body; restore() hands
 * them back (a retry). Everything here is built once, on the first fall, and
 * kept hidden between falls: two walls, two instanced particle meshes.
 *
 *   const fall = new FallScene({ parent: scene, camera, avatar, isPaused });
 *   fall.start({ from, velocity, kind: "ledge" | "hatch", face, wallAt, onDone });
 *   fall.update(dt, time);   // each frame while fall.active
 *   fall.restore();          // a retry: the body upright, the camera free
 *   fall.dispose();
 */

import * as THREE from "../../three.js";

/** Seconds: the chase, the fall on without the camera, the fade to black. */
const TIMING = { chase: 1.5, fallAway: 1.7, black: 0.4 };
/** Input before this many seconds is ignored (so a held key doesn't skip it at once). */
export const SKIP_AFTER = 0.5;
/** The fall: a little heavier than real (it reads better at game speed). */
const GRAVITY = 10;
const TERMINAL = 32;
/** Off a ledge: the push out from the wall (at least, at most), the least it keeps, its drag. */
const OUTWARD = { start: 2.4, most: 4, least: 0.7, drag: 0.9 };
/** The chase camera, from the body: out from the wall, up, along it; and where it looks. */
const CHASE = { out: 2.7, up: 3.3, side: 1.4, lookIn: 0.9, lookDown: 1.4 };
/** Down a hatch: right above you in the shaft. */
const SHAFT_CHASE = { up: 2.7, side: 0.22 };
/** How fast the camera catches the chase (it dives in from the roof camera). */
const CATCH = { from: 2.2, to: 10, over: 0.55 };
/**
 * The tumble: over onto your back in the first `tip` seconds, face up to the
 * camera (as in every falling-away shot: the whole body and its flailing
 * read from above), then wobbling - pitch and roll (radians, and how fast) -
 * while it turns slowly about the vertical (`spin`, radians a second).
 */
const TUMBLE = { tip: 0.45, pitch: 0.3, pitchRate: 1.9, roll: 0.55, rollRate: 1.3, spin: 0.7 };
/** The hip above the feet: the body tumbles about it, not about its soles. */
const HIP = 1.0;
/** The facade dressed for the fall: a tile is 6 bays by 4 floors (3.6 m). */
const FACADE = { tile: 14.4, height: 170, inset: 0.035, glow: 1.3 };
/** A service shaft under a hatch, wider than the hatch itself. */
const SHAFT = { width: 2.3, depth: 150, top: -0.62, tile: 4.6 };
const EMBERS = 56;
const SMOKE = 14;
/** How much thicker the haze gets as you fall away into it (FogExp2 density). */
const FOG_BOOST = 0.02;
/** Once stopped, the camera narrows on you (a fraction of its FOV), so you shrink but stay readable. */
const PUNCH_IN = 0.5;

const UP = new THREE.Vector3(0, 1, 0);

function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * The burning tower's face, close up: concrete spandrels, mullioned windows
 * - offices lit warm or cold, dark ones, burning ones with soot above.
 * Returns [colour, emissive] canvases (the emissive is the light alone).
 */
function facadeCanvases(size = 512) {
  const bays = 6;
  const floors = 4;
  const bw = size / bays;
  const fh = size / floors;
  const r = rng(77);
  const rooms = [];
  for (let f = 0; f < floors; f += 1) {
    for (let b = 0; b < bays; b += 1) {
      const x = r();
      rooms.push({ b, f, kind: x < 0.16 ? "fire" : x < 0.5 ? "warm" : x < 0.64 ? "cold" : "dark", shade: r(), blind: r() });
    }
  }
  const win = (b, f) => [b * bw + 7, f * fh + 26, bw - 14, fh * 0.6];
  const colour = canvas(size, size, (g) => {
    g.fillStyle = "#2c2b29";
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i += 1) {
      g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,255,255"},${0.03 + r() * 0.05})`;
      g.fillRect(r() * size, r() * size, 1 + r() * 4, 1 + r() * 3);
    }
    for (const { b, f, kind, shade, blind } of rooms) {
      const [x, y, w, h] = win(b, f);
      // Soot up the spandrel over a burning room.
      if (kind === "fire") {
        const soot = g.createLinearGradient(0, y - fh * 0.42, 0, y);
        soot.addColorStop(0, "rgba(8,6,5,0)");
        soot.addColorStop(1, "rgba(8,6,5,0.85)");
        g.fillStyle = soot;
        g.fillRect(x - 6, y - fh * 0.42, w + 12, fh * 0.42);
      }
      g.fillStyle = "#121416";
      g.fillRect(x - 3, y - 3, w + 6, h + 6);
      const glass = kind === "dark" ? `rgb(${12 + shade * 10},${16 + shade * 10},${22 + shade * 12})`
        : kind === "fire" ? "#ff8a2a" : kind === "warm" ? "#e9c58c" : "#bcd3e6";
      g.fillStyle = glass;
      g.fillRect(x, y, w, h);
      if (kind !== "dark") {
        // Blinds part-down, a ceiling light strip, the odd silhouette.
        g.fillStyle = "rgba(30,24,18,0.55)";
        g.fillRect(x, y, w, h * blind * 0.4);
        g.fillStyle = "rgba(20,16,12,0.5)";
        g.fillRect(x + w * 0.2, y + h * 0.62, w * 0.5, h * 0.38);
      }
      // Mullions.
      g.fillStyle = "#15181a";
      g.fillRect(x + w / 2 - 2, y, 4, h);
      g.fillRect(x, y + h * 0.3, w, 3);
    }
    // Floor slab edges.
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (let f = 0; f < floors; f += 1) g.fillRect(0, f * fh + fh - 6, size, 6);
  });
  const glow = canvas(size, size, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, size, size);
    for (const { b, f, kind, blind } of rooms) {
      if (kind === "dark") continue;
      const [x, y, w, h] = win(b, f);
      if (kind === "fire") {
        const flame = g.createLinearGradient(0, y + h, 0, y);
        flame.addColorStop(0, "#ffd36a");
        flame.addColorStop(0.5, "#ff7a1c");
        flame.addColorStop(1, "#7a1a04");
        g.fillStyle = flame;
      } else g.fillStyle = kind === "warm" ? "#b98a4e" : "#7f98ad";
      g.fillRect(x, y + h * blind * 0.4, w, h * (1 - blind * 0.4));
      g.fillStyle = "#000";
      g.fillRect(x + w / 2 - 2, y, 4, h);
      g.fillRect(x, y + h * 0.3, w, 3);
    }
  });
  return [colour, glow];
}

/**
 * A service shaft's wall, one tile (the shaft's width by SHAFT.tile): bare
 * concrete, a floor slab's band, conduit, a caged lamp. [colour, emissive].
 */
function shaftCanvases() {
  const W = 128;
  const H = 256;
  const r = rng(31);
  const colour = canvas(W, H, (g) => {
    g.fillStyle = "#34322e";
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 500; i += 1) {
      g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,255,255"},${0.04 + r() * 0.06})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
    }
    // The floor slab, a hazard edge painted on it.
    g.fillStyle = "#24231f";
    g.fillRect(0, 200, W, 30);
    for (let x = -16; x < W; x += 16) {
      g.fillStyle = "#c9a118";
      g.beginPath(); g.moveTo(x, 200); g.lineTo(x + 8, 200); g.lineTo(x + 14, 206); g.lineTo(x + 6, 206); g.closePath(); g.fill();
    }
    // Conduit down the wall.
    g.fillStyle = "#1c1e20";
    g.fillRect(18, 0, 7, H);
    g.fillRect(30, 0, 4, H);
    // The lamp's cage.
    g.fillStyle = "#1a1a18";
    g.fillRect(84, 70, 26, 34);
  });
  const glow = canvas(W, H, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    const lamp = g.createRadialGradient(97, 87, 2, 97, 87, 30);
    lamp.addColorStop(0, "#ffd08a");
    lamp.addColorStop(0.35, "#c26a1a");
    lamp.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = lamp;
    g.fillRect(60, 50, 74, 74);
    g.fillStyle = "#000";
    for (let y = 72; y < 104; y += 8) g.fillRect(84, y, 26, 2);
  });
  return [colour, glow];
}

/** A soft round dot: embers stretched into streaks, puffs of smoke. */
function softDot(rgba) {
  return canvas(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

function texture(c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  return t;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _look = new THREE.Vector3();
const _hip = new THREE.Vector3();

export class FallScene {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.parent    where its walls and particles go (the scene)
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {object} o.avatar            the PlayerAvatar (player.js)
   * @param {boolean} [o.reducedMotion]  a gentler tumble
   * @param {() => boolean} [o.isPaused] the host's pause: no skipping under the menu
   */
  constructor({ parent, camera, avatar, reducedMotion = false, isPaused = () => false }) {
    this.parent = parent;
    this.camera = camera;
    this.avatar = avatar;
    this.reducedMotion = reducedMotion;
    this.isPaused = isPaused;
    this.active = false;
    this.done = false;
    /** The camera is the scene's from start() until restore() (it holds after the end). */
    this.holdsCamera = false;
    this.t = 0;
    this.black = 0;
    this.fogBoost = 0;
    this.frozen = false;
    this.skipped = false;
    this.body = { p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.from = new THREE.Vector3();
    this.face = new THREE.Vector3(1, 0, 0);
    this.side = new THREE.Vector3(0, 0, 1);
    this._look = new THREE.Vector3();
    this._camVel = 0;
    this._skip = false;
    this._onInput = (event) => {
      if (!this.active || this.isPaused()) return;
      if (event.type === "keydown" && (event.code === "Escape" || event.repeat)) return;
      if (this.t >= SKIP_AFTER) this._skip = true;
    };
    this.group = null;
  }

  /** Walls and particles, built on the first fall. */
  _build() {
    const group = new THREE.Group();
    group.name = "FallScene";
    group.visible = false;
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);

    const [fc, fg] = facadeCanvases();
    const facadeRepeat = [1, FACADE.height / FACADE.tile];
    this.facadeMaterial = own(new THREE.MeshStandardMaterial({
      map: own(texture(fc, { repeat: facadeRepeat })), emissiveMap: own(texture(fg, { repeat: facadeRepeat })),
      emissive: 0xffffff, emissiveIntensity: FACADE.glow, roughness: 0.82, metalness: 0.1,
    }));
    this.facade = new THREE.Mesh(own(new THREE.PlaneGeometry(1, FACADE.height)), this.facadeMaterial);
    this.facade.name = "FallFacade";
    group.add(this.facade);

    const [sc, sg] = shaftCanvases();
    const shaftRepeat = [1, SHAFT.depth / SHAFT.tile];
    this.shaft = new THREE.Mesh(
      own(new THREE.BoxGeometry(SHAFT.width, SHAFT.depth, SHAFT.width)),
      own(new THREE.MeshStandardMaterial({
        map: own(texture(sc, { repeat: shaftRepeat })), emissiveMap: own(texture(sg, { repeat: shaftRepeat })),
        emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.95, metalness: 0.05, side: THREE.BackSide,
      }))
    );
    this.shaft.name = "FallShaft";
    group.add(this.shaft);

    // Embers: thin additive streaks, stretched by how fast they pass you.
    const quad = own(new THREE.PlaneGeometry(1, 1));
    const emberMaterial = own(new THREE.MeshBasicMaterial({
      map: own(texture(softDot("rgba(255,190,110,1)"))), color: new THREE.Color(3.2, 1.5, 0.55),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.embers = new THREE.InstancedMesh(quad, emberMaterial, EMBERS);
    this.embers.name = "FallEmbers";
    this.embers.frustumCulled = false;
    this.embers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(this.embers);
    // Smoke: big soft puffs, rising.
    const smokeMaterial = own(new THREE.MeshBasicMaterial({
      map: own(texture(softDot("rgba(200,190,180,0.9)"))), color: 0x4a423c,
      transparent: true, opacity: 0.42, depthWrite: false,
    }));
    this.smoke = new THREE.InstancedMesh(quad, smokeMaterial, SMOKE);
    this.smoke.name = "FallSmoke";
    this.smoke.frustumCulled = false;
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(this.smoke);
    const r = rng(5);
    this._r = r;
    this.emberState = Array.from({ length: EMBERS }, () => ({ p: new THREE.Vector3(), speed: 0, len: 0, width: 0, wob: r() * 10 }));
    this.smokeState = Array.from({ length: SMOKE }, () => ({ p: new THREE.Vector3(), speed: 0, size: 0, roll: r() * 6, spin: (r() - 0.5) * 0.6, shade: 0 }));
    this.parent.add(group);
    this.group = group;
  }

  /**
   * @param {object} o
   * @param {THREE.Vector3} o.from      where the player's feet left the roof
   * @param {THREE.Vector3} o.velocity  their velocity then (y: falling)
   * @param {"ledge"|"hatch"} o.kind
   * @param {THREE.Vector3} o.face      off a ledge: the wall's outward normal (horizontal)
   * @param {number} o.wallAt           off a ledge: how far the wall is from the tower's axis
   * @param {() => void} [o.onFreeze]   the camera has stopped (a line, a sound)
   * @param {() => void} o.onDone       it is over (or skipped): the end screen
   */
  start({ from, velocity, kind = "ledge", face, wallAt = 15.9, onFreeze = null, onDone }) {
    if (!this.group) this._build();
    this.kind = kind;
    this.onDone = onDone;
    this.onFreeze = onFreeze;
    this.active = true;
    this.done = false;
    this.holdsCamera = true;
    this.frozen = false;
    this.skipped = false;
    this._skip = false;
    this.t = 0;
    this.black = 0;
    this.fogBoost = 0;
    this.from.copy(from);
    this.face.copy(face).setY(0).normalize();
    this.side.crossVectors(UP, this.face).normalize();
    const b = this.body;
    const avatar = this.avatar;
    this._yaw = avatar.root.rotation.y;
    b.v.copy(velocity);
    if (kind === "hatch") {
      // A cut: in under the slab, already dropping down the shaft.
      b.p.set(from.x, SHAFT.top - 1.9, from.z);
      b.v.set(velocity.x * 0.2, Math.min(velocity.y, 0) - 4, velocity.z * 0.2);
      this.shaft.position.set(from.x, SHAFT.top - SHAFT.depth / 2, from.z);
      this.shaft.visible = true;
      this.facade.visible = false;
      this.camera.position.set(from.x, SHAFT.top - 0.2, from.z).addScaledVector(this.side, SHAFT_CHASE.side);
      this._look.copy(b.p).addScaledVector(UP, -2);
    } else {
      // Clear of the slab's lip, pushed out from the wall.
      b.p.copy(from).addScaledVector(UP, HIP).addScaledVector(this.face, 0.25);
      const out = THREE.MathUtils.clamp(b.v.dot(this.face), OUTWARD.start, OUTWARD.most);
      b.v.addScaledVector(this.face, out - b.v.dot(this.face));
      b.v.y = Math.min(b.v.y, 0) - 1;
      // The burning facade, over the plain one for the length of the fall.
      this.facade.scale.x = wallAt * 2;
      for (const map of [this.facadeMaterial.map, this.facadeMaterial.emissiveMap]) map.repeat.x = (wallAt * 2) / FACADE.tile;
      this.facade.position.copy(this.face).multiplyScalar(wallAt + FACADE.inset).setY(-0.62 - FACADE.height / 2);
      this.facade.rotation.set(0, Math.atan2(this.face.x, this.face.z), 0);
      this.facade.visible = true;
      this.shaft.visible = false;
      this._look.copy(b.p);
    }
    this._fov = this.camera.fov;
    this._camVel = 0;
    this.group.visible = true;
    avatar.shadow.visible = false;
    avatar.body.position.set(0, -HIP, 0);
    for (let i = 0; i < EMBERS; i += 1) this._spawnEmber(this.emberState[i], true);
    for (let i = 0; i < SMOKE; i += 1) this._spawnSmoke(this.smokeState[i], true);
    this._updateParticles(0, 0);
    // Any key, click or button skips it (after SKIP_AFTER): pads are polled.
    window.addEventListener("keydown", this._onInput, true);
    window.addEventListener("pointerdown", this._onInput, true);
    this._padsHeld = this._pressedPads();
    this._tumble(0);
    this._place();
  }

  /** Skip to the end (as any key does after SKIP_AFTER seconds). */
  skip() {
    if (this.active && this.t >= SKIP_AFTER) this._skip = true;
  }

  update(dt, time) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const b = this.body;
    const avatar = this.avatar;

    // The body: gravity, drag outward, a tumble (gentler with reduced motion).
    b.v.y = Math.max(-TERMINAL, b.v.y - GRAVITY * dt);
    if (this.kind === "ledge") {
      const out = b.v.dot(this.face);
      const want = Math.max(OUTWARD.least, out * Math.exp(-dt * OUTWARD.drag));
      b.v.addScaledVector(this.face, want - out);
    } else {
      // The shaft's walls: stay in it.
      b.v.x *= Math.exp(-dt * 2);
      b.v.z *= Math.exp(-dt * 2);
    }
    b.p.addScaledVector(b.v, dt);
    this._tumble(t);
    avatar.flail(time, THREE.MathUtils.lerp(1, 0.75, Math.min(1, t / 3)));
    avatar.body.position.set(0, -HIP, 0);

    // The camera: the chase, then it stops dead and only turns to watch.
    const cam = this.camera;
    const before = cam.position.y;
    if (t < TIMING.chase) {
      const k = 1 - Math.exp(-dt * THREE.MathUtils.lerp(CATCH.from, CATCH.to, Math.min(1, t / CATCH.over)));
      if (this.kind === "hatch") {
        _p.copy(b.p).addScaledVector(UP, SHAFT_CHASE.up).addScaledVector(this.side, SHAFT_CHASE.side);
        _p.y = Math.min(_p.y, SHAFT.top - 0.2);
        cam.position.lerp(_p, k);
        _look.copy(b.p).addScaledVector(UP, -2.5);
      } else {
        _p.copy(b.p).addScaledVector(this.face, CHASE.out).addScaledVector(UP, CHASE.up).addScaledVector(this.side, CHASE.side);
        cam.position.lerp(_p, k);
        _look.copy(b.p).addScaledVector(this.face, -CHASE.lookIn).addScaledVector(UP, -CHASE.lookDown);
      }
      this._look.lerp(_look, 1 - Math.exp(-dt * 9));
    } else {
      if (!this.frozen) {
        this.frozen = true;
        this.onFreeze?.();
      }
      this._look.lerp(b.p, 1 - Math.exp(-dt * 10));
    }
    this._camVel = (cam.position.y - before) / Math.max(dt, 1e-4);
    cam.up.copy(UP);
    cam.lookAt(this._look);

    // Into the dark: the haze closes in once the camera has let you go.
    const away = THREE.MathUtils.clamp((t - TIMING.chase) / TIMING.fallAway, 0, 1);
    this.fogBoost = FOG_BOOST * away * away;
    cam.fov = this._fov * (1 - PUNCH_IN * THREE.MathUtils.smoothstep(away, 0, 0.55));
    cam.updateProjectionMatrix();
    this.facadeMaterial.emissiveIntensity = FACADE.glow * (0.92 + 0.08 * Math.sin(time * 11) * Math.sin(time * 3.3));
    this._updateParticles(dt, time);
    this._place();

    // Skip (any key, click or pad button after SKIP_AFTER); else the fade at the end.
    if (t >= SKIP_AFTER && !this._skip && this._padPressed()) this._skip = true;
    if (this._skip) {
      this.skipped = true;
      this.black = 1;
      this._finish();
      return;
    }
    const end = TIMING.chase + TIMING.fallAway;
    this.black = THREE.MathUtils.clamp((t - end) / TIMING.black, 0, 1);
    if (t >= end + TIMING.black) this._finish();
  }

  /** Over onto the back, then wobbling and turning (TUMBLE); gentler with reduced motion. */
  _tumble(t) {
    const calm = this.reducedMotion ? 0.4 : 1;
    const tip = THREE.MathUtils.smoothstep(t, 0, TUMBLE.tip);
    const pitch = (Math.PI / 2) * tip + Math.sin(t * TUMBLE.pitchRate) * TUMBLE.pitch * calm * tip;
    const roll = Math.sin(t * TUMBLE.rollRate) * TUMBLE.roll * calm * tip;
    const q = this.body.q.setFromAxisAngle(UP, this._yaw + t * TUMBLE.spin * calm);
    // Pitch back about the body's own side axis (face up), then roll about its spine.
    q.multiply(_dq.setFromAxisAngle(_x.set(1, 0, 0), pitch));
    q.multiply(_dq.setFromAxisAngle(_y.set(0, 1, 0), roll));
  }

  /** The body where the fall has it: rotated about the hip. */
  _place() {
    const b = this.body;
    const root = this.avatar.root;
    root.quaternion.copy(b.q);
    // The root is at the feet; the body hangs HIP below it (avatar.body), so
    // the root sits at the hip and the tumble turns about it.
    root.position.copy(b.p);
    root.updateMatrixWorld();
  }

  _finish() {
    this.active = false;
    this.done = true;
    window.removeEventListener("keydown", this._onInput, true);
    window.removeEventListener("pointerdown", this._onInput, true);
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  /** A retry (or a new roof): the body upright, the camera the host's again. */
  restore() {
    if (this.active) {
      this.active = false;
      window.removeEventListener("keydown", this._onInput, true);
      window.removeEventListener("pointerdown", this._onInput, true);
    }
    this.onDone = null;
    this.done = false;
    this.holdsCamera = false;
    this.black = 0;
    this.fogBoost = 0;
    if (this.group) this.group.visible = false;
    if (this._fov) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
      this._fov = 0;
    }
    const avatar = this.avatar;
    avatar.root.rotation.set(0, 0, 0);
    avatar.body.position.set(0, 0, 0);
    avatar.shadow.visible = true;
    avatar.hold = 1;
    avatar.reachUp = 0;
  }

  /* ---------------- Embers and smoke ---------------- */

  /** Somewhere off to the side of the fall, below the camera (or anywhere, at the start). */
  _spot(out, initial, spread) {
    const r = this._r;
    const below = initial ? -4 + r() * 34 : 10 + r() * 24;
    const y = Math.min(this.camera.position.y, this.body.p.y + 3) - below;
    if (this.kind === "hatch") {
      const half = SHAFT.width / 2 - 0.2;
      out.set(this.from.x + (r() * 2 - 1) * half, y, this.from.z + (r() * 2 - 1) * half);
    } else {
      // Between the wall and well out from it, along the face.
      const wall = this.from.dot(this.face);
      out.copy(this.face).multiplyScalar(wall + 0.3 + r() * spread);
      out.addScaledVector(this.side, this.from.dot(this.side) + (r() * 2 - 1) * spread);
      out.y = y;
    }
    return out;
  }

  _spawnEmber(e, initial = false) {
    const r = this._r;
    this._spot(e.p, initial, 6.5);
    e.speed = 2.5 + r() * 5;
    e.len = 0.18 + r() * 0.35;
    e.width = 0.025 + r() * 0.035;
  }

  _spawnSmoke(s, initial = false) {
    const r = this._r;
    this._spot(s.p, initial, 9);
    s.speed = 1.2 + r() * 2.4;
    s.size = 2.4 + r() * 3.4;
    s.shade = 0.55 + r() * 0.45;
  }

  _updateParticles(dt, time) {
    const cam = this.camera;
    const top = cam.position.y + 3;
    const color = new THREE.Color();
    // Embers: each a streak along its motion relative to the camera (up the
    // screen), as long as it passes in about a frame and a bit.
    for (let i = 0; i < EMBERS; i += 1) {
      const e = this.emberState[i];
      e.p.y += e.speed * dt;
      e.p.x += Math.sin(time * 2.1 + e.wob) * 0.4 * dt;
      e.p.z += Math.cos(time * 1.7 + e.wob) * 0.4 * dt;
      if (e.p.y > top) this._spawnEmber(e);
      const rel = Math.abs(e.speed - this._camVel);
      _d.subVectors(e.p, cam.position).normalize();
      _a.copy(UP).addScaledVector(_d, -UP.dot(_d));
      const la = _a.length();
      if (la < 1e-3) _a.copy(cam.up);
      else _a.divideScalar(la);
      _z.copy(_d).negate();
      _y.copy(_a);
      _x.crossVectors(_y, _z);
      const len = (e.len + rel * 0.045) * Math.max(0.25, la);
      _m.makeBasis(_x.multiplyScalar(e.width), _y.multiplyScalar(len), _z);
      _m.setPosition(e.p);
      this.embers.setMatrixAt(i, _m);
      color.setScalar(0.6 + 0.4 * Math.sin(time * 9 + e.wob * 7) ** 2);
      this.embers.setColorAt(i, color);
    }
    this.embers.instanceMatrix.needsUpdate = true;
    if (this.embers.instanceColor) this.embers.instanceColor.needsUpdate = true;
    // Smoke: camera-facing puffs, turning slowly.
    for (let i = 0; i < SMOKE; i += 1) {
      const s = this.smokeState[i];
      s.p.y += s.speed * dt;
      s.roll += s.spin * dt;
      if (s.p.y > top + s.size) this._spawnSmoke(s);
      _q.copy(cam.quaternion).multiply(_dq.setFromAxisAngle(_z.set(0, 0, 1), s.roll));
      _m.compose(s.p, _q, _s.setScalar(s.size));
      this.smoke.setMatrixAt(i, _m);
      this.smoke.setColorAt(i, color.setScalar(s.shade));
    }
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }

  /* ---------------- Gamepads ---------------- */

  _pressedPads() {
    const held = new Set();
    for (const pad of navigator.getGamepads?.() ?? []) {
      pad?.buttons.forEach((button, i) => { if (button.pressed) held.add(`${pad.index}:${i}`); });
    }
    return held;
  }

  /** A button pressed since the fall began (one held from before doesn't count until let go). */
  _padPressed() {
    const now = this._pressedPads();
    for (const id of this._padsHeld) if (!now.has(id)) this._padsHeld.delete(id);
    for (const id of now) if (!this._padsHeld.has(id)) return true;
    return false;
  }

  dispose() {
    this.restore();
    this.group?.parent?.remove(this.group);
    for (const x of this.owned ?? []) x.dispose?.();
    this.embers?.dispose();
    this.smoke?.dispose();
    this.group = null;
  }
}
