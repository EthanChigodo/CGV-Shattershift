/**
 * Rooftop-only, non-combat patients: telegraph -> dive -> carry/QTE, seen
 * first person -> shoot it off point-blank, or bitten, out cold and carried
 * into the sky.
 */
import * as THREE from "../../three.js";
import { cloneCharacter, createRig } from "./characters.js";
import { ReactionHits, MASH_DIFFICULTY } from "../../story/reaction.js";
import { StoryUI } from "../../story/story-ui.js";

// All encounter balancing lives here. Accessibility options still come from ReactionHits.
// How often they come and how fast they swoop: the circle follows you for
// `tracking` of the `warning`, then the time left plus the `dive` is all you
// have to get out of it - three seconds on Easy (walk), about one and a half
// on Normal, half a second on Hard (only the quick shift, Space, gets you out).
export const ABDUCTION = {
  easy: { maximum: 1, warning: 3, tracking: 0.7, qte: 5, presses: 6, dive: 0.75, firstSpawn: [16, 22], spawn: [22, 32], cooldown: [30, 42] },
  normal: { maximum: 2, warning: 2.4, tracking: 1.4, qte: 4, presses: 8, dive: 0.6, firstSpawn: [9, 13], spawn: [12, 18], cooldown: [18, 26] },
  hard: { maximum: 2, warning: 1.25, tracking: 1.05, qte: 2.5, presses: 10, dive: 0.35, firstSpawn: [6, 9], spawn: [7, 11], cooldown: [9, 14] },
};
/** Endless Roof: from its difficulty to this over `minutes` held - faster, more often. */
export const ENDLESS_RAMP = { minutes: 4, warning: 1.05, tracking: 0.95, dive: 0.3, cooldown: 0.45, maximum: 3 };
export const FLIGHT = { radius: 1.5, circle: [2.5, 5], lift: 4, skyTransition: 1.1, gameOverDelay: 3.5, skySpeed: 12, obstacleClearance: 2.6, obstacleHeight: 2.2 };
/** The struggle up close: where the eye sits under the grip, the shot and the bite. */
// (In front of its face and under it, looking up: seen from behind its head, the face is upside down.)
export const CLOSE = { below: 0.85, ahead: 0.55, lift: 0.3, shoot: 0.75, fireAt: 0.14, bite: 1.6, biteAt: 0.24, wakeUp: 1.4 };
/** Eyes closing after the bite: [time, how closed] - two heavy blinks, then out. */
const LIDS = [[0.3, 0], [0.55, 0.85], [0.72, 0.3], [1.0, 0.95], [1.12, 0.6], [1.45, 1]];
const UP = new THREE.Vector3(0, 1, 0);
const AVOID_ANGLES = [0, 18, 32, 48, 66, 88, 112, 138];
const AVOID_VERTICAL_SCALES = [1, 0.55, 0.15, 0];
const smooth = (t) => THREE.MathUtils.smoothstep(t, 0, 1);

/** Use the existing mash UI/input, with exactly N taps and no decay between taps. */
export function abductionReaction(tune, options = {}) {
  const key = typeof options.difficulty === "function" ? options.difficulty() : options.difficulty;
  const multiplier = (MASH_DIFFICULTY[key]?.gain ?? 1) * (options.longWindows ? 1.25 : 1);
  return { kind: "mash", keys: ["Space"], time: tune.qte, gain: (1 / tune.presses + 1e-9) / multiplier, decay: 0, duration: tune.qte * 0.65, label: "BREAK FREE!" };
}

/** Search real collision/ground data, away from edges, holes and cover. */
export function safeAbductionSpot(roof, origin, clearance = 1.1) {
  const p = new THREE.Vector3();
  const valid = () => {
    if (Math.abs(p.x) > 13.5 || Math.abs(p.z) > 13.5 || roof.blocked(p, clearance)) return false;
    for (const x of [-clearance, 0, clearance]) for (const z of [-clearance, 0, clearance]) {
      if (roof.groundAt(new THREE.Vector3(p.x + x, 0, p.z + z)) !== 0) return false;
    }
    return true;
  };
  for (let radius = 0; radius <= 35; radius += 0.65) {
    const steps = radius === 0 ? 1 : Math.ceil(radius * 12);
    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      p.set(origin.x + Math.cos(a) * radius, 0, origin.z + Math.sin(a) * radius);
      if (valid()) return p.clone();
    }
  }
  return null; // Do not grab if a safe release/pickup location cannot be found.
}

export class FlyingZombieEncounter {
  constructor(game, { layer = null, random = Math.random } = {}) {
    this.game = game;
    this.roof = game.roof;
    this.layer = layer;
    this.random = random;
    this.base = ABDUCTION[game.difficulty?.key] ?? ABDUCTION.normal;
    this.root = new THREE.Group();
    this.root.name = "FlyingZombieEncounter";
    game.scene.add(this.root);
    this.owned = [];
    this.actors = [];
    this.state = "idle";
    this.time = 0;
    this.elapsed = 0;
    this.spawnIn = this._range(this.tune.firstSpawn);
    this.attackIn = 0;
    this.kick = 0;
    this.target = new THREE.Vector3();
    this._world = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._heading = new THREE.Vector3();
    this._previous = new THREE.Vector3();
    this._flightTarget = new THREE.Vector3();
    this._moveDestination = new THREE.Vector3();
    this._flightDelta = new THREE.Vector3();
    this._obstacleHit = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._slide = new THREE.Vector3();
    this._handLeft = new THREE.Vector3();
    this._handRight = new THREE.Vector3();
    this._gripTarget = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._obstacles = [];
    this._obstacleCount = -1;
    this._obstacleClearance = new THREE.Vector3(FLIGHT.obstacleClearance, FLIGHT.obstacleHeight, FLIGHT.obstacleClearance);
    this.skyDirection = new THREE.Vector3();
    this.skyVelocity = new THREE.Vector3();
    this.skyPosition = new THREE.Vector3();
    this._cameraRig = new THREE.PerspectiveCamera();
    this.marker = this._marker();
    this.root.add(this.marker);
  }

  _own(x) { this.owned.push(x); return x; }

  /**
   * What the roof's cryo and shock see of the winged ones (roof.js freeze,
   * shock - the burst, and the charge jumping on): one stand-in each, with
   * the ground enemies' freeze, electrify and drawArcs.
   */
  get targets() {
    return this.actors.filter((a) => a.active).map((a) => a.hold ?? (a.hold = this._holdFor(a)));
  }

  _holdFor(a) {
    const self = this;
    return {
      flying: true, removed: false, root: { scale: { x: 1 } },
      get position() { return a.root.position; },
      get alive() { return a.active && a.state !== "frozen"; },
      get holdable() { return self._holdable(a); },
      get shocked() { return a.state === "shocked" ? a.shocked : 0; },
      freeze: () => this._freeze(a),
      electrify: (seconds, power) => this._shock(a, seconds, power),
      drawArcs: (level) => this._drawArcs(a, level),
    };
  }

  /** Free to be frozen, shocked or pulled down: in the air of its own accord - not carrying you off, not already falling. */
  _holdable(a) {
    if (!a.active || !["circle", "attack", "shocked"].includes(a.state)) return false;
    return !(a === this.attacker && !["warning", "dive"].includes(this.state));
  }

  /** Its swoop called off: frozen, shocked or pulled down before it reached you. */
  _callOff(a) {
    if (a !== this.attacker) return;
    this.marker.visible = false;
    this.attacker = null;
    this.state = "idle";
    this.attackIn = this._range(this.tune.cooldown);
  }

  /** A cryo burst: frozen solid in the air - it drops like a stone, and shatters where it lands. */
  _freeze(a) {
    if (!this._holdable(a)) return false;
    this._callOff(a);
    a.state = "frozen"; a.age = 0;
    a.velocity = new THREE.Vector3((this.random() - 0.5) * 2, 0, (this.random() - 0.5) * 2);
    a.spin = (this.random() < 0.5 ? -1 : 1) * (0.6 + this.random() * 0.8);
    if (!a.ice) {
      // Round the body and both wings (the body lies along +Z, the wings out to the sides).
      a.ice = new THREE.Mesh(this.roof.holdFX.iceGeometry, this.roof.holdFX.ice);
      a.ice.position.set(0, 0.1, 0.85);
      a.ice.scale.set(2.3, 0.75, 1.3);
      a.ice.renderOrder = 4;
    }
    a.root.add(a.ice);
    this.game._patientSound?.("shriek", a.root.position, 0.7);
    return true;
  }

  /** A shock: wings seized in the arcs, dropping and twitching for `seconds`, then back up. */
  _shock(a, seconds, power = 0) {
    if (!this._holdable(a)) return false;
    this._callOff(a);
    const again = a.state === "shocked";
    a.shocked = Math.max(again ? a.shocked : 0, seconds);
    a.shockPower = Math.max(again ? a.shockPower : 0, power);
    a.state = "shocked"; a.age = 0;
    a.velocity = new THREE.Vector3(0, -1, 0);
    return true;
  }

  /** The shock's arcs over it, wings and all (roof.js strands): more and thicker, charged. */
  _drawArcs(a, level) {
    const power = a.shockPower ?? 0;
    const width = 0.02 * (1 + 1.4 * power);
    const A = this._arcA ?? (this._arcA = new THREE.Vector3());
    const B = this._arcB ?? (this._arcB = new THREE.Vector3());
    for (let i = 0; i < 9 + Math.round(4 * power); i += 1) {
      let x = (this.random() - 0.5) * 4.2, y = 0.1 + (this.random() - 0.5) * 0.5, z = 0.85 + (this.random() - 0.5) * 1.4;
      a.root.localToWorld(A.set(x, y, z));
      for (let j = 0; j < 4; j += 1) {
        x += (this.random() - 0.5) * 0.6; y += (this.random() - 0.5) * 0.4; z += (this.random() - 0.5) * 0.5;
        a.root.localToWorld(B.set(x, y, z));
        level.strand(A, B, width);
        A.copy(B);
      }
    }
  }

  /** Frozen, it hit the roof: in pieces of ice. */
  _shatter(a, ground) {
    const g = this.game;
    const at = a.root.position.clone().setY(ground + 0.6);
    this._putAway(a);
    g._chunks?.(at, 70, { tint: 0xbff4ff, speed: 7, radius: 1.3, size: 0.14 });
    g.sfx?.glassBreak();
    g.audio?.glassShatter?.(true);
    g.trauma = Math.min(1, (g.trauma ?? 0) + 0.3);
    if (g.runner) g.runner.downs = (g.runner.downs ?? 0) + 1;
    g.hud?.toast("SHATTERED", "OUT OF THE SKY", "power", 1400);
  }

  /** Gone: out of the encounter until it's flown again. */
  _putAway(a) {
    a.ice?.removeFromParent();
    a.active = false;
    a.root.visible = false;
    a.root.rotation.x = 0;
  }
  _range([a, b]) { return a + this.random() * (b - a); }
  get activeCount() { return this.actors.filter((a) => a.active).length; }
  get controlsPlayer() { return ["grab", "carried", "shoot", "bite", "release", "landing", "sky"].includes(this.state); }
  get holdsCamera() { return this.controlsPlayer; }
  /** Seen through your own eyes, the launcher in your hands (game.js leaves it to us). */
  get firstPerson() { return ["grab", "carried", "shoot", "bite"].includes(this.state); }

  /** This difficulty's pacing - in Endless, quickening the longer the roof is held. */
  get tune() {
    const b = this.base, g = this.game;
    if (g.mode !== "endless-roof") return b;
    const k = THREE.MathUtils.clamp((g.roofClock ?? 0) / (ENDLESS_RAMP.minutes * 60), 0, 1);
    const toward = (v, to) => Math.min(v, THREE.MathUtils.lerp(v, to, k));
    const scale = THREE.MathUtils.lerp(1, ENDLESS_RAMP.cooldown, k);
    return {
      ...b,
      warning: toward(b.warning, ENDLESS_RAMP.warning),
      tracking: toward(b.tracking, ENDLESS_RAMP.tracking),
      dive: toward(b.dive, ENDLESS_RAMP.dive),
      maximum: Math.max(b.maximum, Math.round(THREE.MathUtils.lerp(b.maximum, ENDLESS_RAMP.maximum, k))),
      spawn: b.spawn.map((v) => v * scale),
      cooldown: b.cooldown.map((v) => v * scale),
    };
  }

  _marker() {
    const group = new THREE.Group();
    group.name = "AbductionTarget";
    const material = this._own(new THREE.MeshBasicMaterial({ color: 0xff2038, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    const ring = new THREE.Mesh(this._own(new THREE.RingGeometry(FLIGHT.radius - 0.07, FLIGHT.radius, 48)), material);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const line = this._own(new THREE.BoxGeometry(0.05, 0.015, 0.42));
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(line, material);
      const angle = i * Math.PI / 2;
      tick.position.set(Math.sin(angle) * 1.25, 0, Math.cos(angle) * 1.25);
      tick.rotation.y = angle;
      group.add(tick);
    }
    group.visible = false;
    return group;
  }

  _createActor() {
    const root = new THREE.Group(), body = new THREE.Group();
    root.name = "FlyingRoofPatient";
    root.add(body);
    const template = this.roof.assets.get("patient")?.template;
    const model = template ? cloneCharacter(template) : this.roof.kit.personStandIn();
    body.add(model);
    const rig = template ? createRig(model) : null;
    const wings = [];
    const membrane = this._own(new THREE.MeshStandardMaterial({ color: 0x632b36, roughness: 0.92, side: THREE.DoubleSide }));
    const bone = this._own(new THREE.MeshStandardMaterial({ color: 0xaba28b, roughness: 0.85 }));
    const shape = new THREE.Shape();
    // Ragged bat-like membrane with torn scallops between elongated fingers.
    shape.moveTo(0, 0); shape.lineTo(0.65, 0.65); shape.lineTo(2.35, 0.55);
    shape.lineTo(1.6, -0.12); shape.lineTo(1.72, -0.7); shape.lineTo(1.03, -0.35);
    shape.lineTo(0.92, -0.86); shape.lineTo(0.45, -0.4); shape.lineTo(0, -0.45);
    const geometry = this._own(new THREE.ShapeGeometry(shape));
    const finger = this._own(new THREE.CylinderGeometry(0.025, 0.04, 1, 5));
    for (const sign of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(sign * 0.16, 1.35, -0.2);
      wing.scale.x = sign;
      wing.add(new THREE.Mesh(geometry, membrane));
      for (const end of [[2.35, 0.55], [1.72, -0.7], [0.92, -0.86]]) {
        const tip = new THREE.Vector3(end[0], end[1], 0);
        const strut = new THREE.Mesh(finger, bone);
        strut.position.copy(tip).multiplyScalar(0.5);
        strut.scale.y = tip.length();
        strut.quaternion.setFromUnitVectors(UP, tip.normalize());
        wing.add(strut);
      }
      body.add(wing);
      wings.push(wing);
      // Attach the mutated claws to the animated hands so the grab reads as a
      // hand hold. Keep a visible fallback for stand-in models without bones.
      const claw = new THREE.Mesh(finger, bone);
      claw.name = "FlyingZombieClaw";
      claw.rotation.x = Math.PI / 2;
      claw.position.set(0, 0, 0.08);
      claw.scale.set(0.9, 1.2, 0.9);
      const hand = rig?.bones?.[sign < 0 ? "handR" : "handL"];
      if (hand) hand.add(claw);
      else {
        claw.position.set(sign * 0.62, 0.65, 0.08);
        body.add(claw);
      }
    }
    const carry = new THREE.Object3D();
    carry.name = "AbductionGrip";
    carry.position.set(0, -1.55, 0.15);
    root.add(carry);
    root.visible = false;
    this.root.add(root);
    const actor = { root, body, model, rig, wings, carry, active: false, state: "circle", age: 0, angle: this.random() * Math.PI * 2, wait: 0, avoidSign: this.random() < 0.5 ? -1 : 1 };
    this.actors.push(actor);
    // Deliberately no hurtbox and no registration in enemies/breakables/solids.
    return actor;
  }

  _spawn() {
    if (this.activeCount >= this.tune.maximum) return null;
    const a = this.actors.find((x) => !x.active) ?? this._createActor();
    const player = this.game.hero.position;
    this._refreshObstacles();
    let angle = this.random() * Math.PI * 2;
    let clearSpawn = false;
    for (let i = 0; i < 8; i++, angle += Math.PI / 4) {
      a.root.position.set(Math.cos(angle) * 21, 10 + this.random() * 3, Math.sin(angle) * 21);
      if (a.root.position.distanceTo(player) > 10 && !this._obstacles.some((box) => box.containsPoint(a.root.position))) {
        clearSpawn = true;
        break;
      }
    }
    if (!clearSpawn) { this.spawnIn = this._range(this.tune.spawn); return null; }
    a.angle = angle; a.age = 0; a.wait = this._range(FLIGHT.circle);
    a.state = "circle"; a.active = true; a.root.visible = true;
    a.root.rotation.x = 0;
    a.ice?.removeFromParent();
    this.spawnIn = this._range(this.tune.spawn);
    return a;
  }

  _canAttack() {
    const g = this.game;
    return g.phase === "roof" && g.runner.alive && g.hero.position.y < 0.15 && this.roof.groundAt(g.hero.position) === 0 && !this.roof.cutscene && !this.roof.state.ending && !this.layer?.reactions.running && !this.layer?.player?.active;
  }

  _warn(a) {
    if (this.state !== "idle" || !this._canAttack()) return false;
    this.attacker = a;
    this.state = "warning"; this.elapsed = 0;
    a.state = "attack";
    this.target.copy(this.game.hero.position).setY(0);
    this.marker.position.copy(this.target).y = 0.045;
    this.marker.visible = true;
    // (A swoop too quick to walk out of: the quick shift.)
    const tune = this.tune, quick = tune.warning - tune.tracking + tune.dive < 1;
    this.game.hud.toast("LOOK UP!", quick ? "QUICK SHIFT (SPACE) OUT OF THE RED CIRCLE" : "MOVE OUT OF THE RED CIRCLE", "warn", tune.warning * 1000);
    this.game._patientSound("shriek", a.root.position, 0.65);
    return true;
  }

  _depart(a = this.attacker) {
    if (a) { a.state = "depart"; a.age = 0; }
    this.attacker = null;
    this.marker.visible = false;
    this.attackIn = this._range(this.tune.cooldown);
  }

  /**
   * A gravity sphere's black hole at `point` (game.js _gravityWell): any
   * winged one low enough over it - circling, or coming for you - is dragged
   * down into it and thrown off the roof. Not one carrying you off.
   */
  gravityPull(point, radius) {
    let plucked = 0;
    for (const a of this.actors) {
      // (A shocked one too: its wings are no use to it.)
      if (!this._holdable(a)) continue;
      const p = a.root.position;
      if (Math.hypot(p.x - point.x, p.z - point.z) > radius + 3 || p.y - point.y > 12) continue;
      // Its swoop is over: no circle, no grab.
      this._callOff(a);
      a.state = "pulled"; a.age = 0; a.pullTo = point.clone().setY(point.y + 1.2);
      plucked += 1;
    }
    if (plucked) this.game._patientSound?.("shriek", point, 0.9);
    return plucked;
  }

  _faceDirection(actor, direction, dt, speed = 4) {
    if (direction.lengthSq() < 1e-5) return;
    const want = Math.atan2(direction.x, direction.z);
    let delta = want - actor.root.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    actor.root.rotation.y += delta * Math.min(1, dt * speed);
  }

  _refreshObstacles() {
    const cover = this.roof.cover ?? [];
    if (cover.length === this._obstacleCount) return;
    this._obstacles = cover.map((box) => box.clone().expandByVector(this._obstacleClearance));
    this._obstacleCount = cover.length;
  }

  _contactNormal(box, point, direction, out = this._normal) {
    const faces = [
      [Math.abs(point.x - box.min.x), -1, 0, 0, Math.abs(direction.x)],
      [Math.abs(point.x - box.max.x), 1, 0, 0, Math.abs(direction.x)],
      [Math.abs(point.y - box.min.y), 0, -1, 0, Math.abs(direction.y)],
      [Math.abs(point.y - box.max.y), 0, 1, 0, Math.abs(direction.y)],
      [Math.abs(point.z - box.min.z), 0, 0, -1, Math.abs(direction.z)],
      [Math.abs(point.z - box.max.z), 0, 0, 1, Math.abs(direction.z)],
    ];
    faces.sort((a, b) => (a[0] - a[4] * 1e-4) - (b[0] - b[4] * 1e-4));
    return out.set(faces[0][1], faces[0][2], faces[0][3]);
  }

  /** Sweep the body and attached player through the roof's existing cover boxes. */
  _moveAvoiding(actor, destination, blend = 1) {
    const start = actor.root.position;
    // Snapshot because callers may use _flightTarget itself as their destination.
    this._moveDestination.copy(destination);
    this._flightTarget.lerpVectors(start, this._moveDestination, THREE.MathUtils.clamp(blend, 0, 1));
    this._flightDelta.subVectors(this._flightTarget, start);
    const distance = this._flightDelta.length();
    if (distance < 1e-5) return false;
    this._heading.copy(this._flightDelta).divideScalar(distance);
    this._refreshObstacles();
    if (!this._obstacles.length) { start.copy(this._flightTarget); return false; }

    this._ray.set(start, this._heading);
    let nearest = distance;
    let blockedBy = null;
    for (const box of this._obstacles) {
      if (box.containsPoint(start)) {
        this._contactNormal(box, start, this._heading);
        if (this._normal.x) start.x = this._normal.x < 0 ? box.min.x - 0.08 : box.max.x + 0.08;
        else if (this._normal.y) start.y = this._normal.y < 0 ? box.min.y - 0.08 : box.max.y + 0.08;
        else start.z = this._normal.z < 0 ? box.min.z - 0.08 : box.max.z + 0.08;
        return true;
      }
      const hit = this._ray.intersectBox(box, this._obstacleHit);
      const hitDistance = hit ? hit.distanceTo(start) : Infinity;
      if (hit && hitDistance <= nearest) {
        nearest = hitDistance;
        blockedBy = box;
      }
    }
    if (!blockedBy) { start.copy(this._flightTarget); return false; }

    // Prefer preserving the climb angle, then temporarily flatten the path if
    // a high obstacle blocks every horizontal bearing. The ascent resumes as
    // soon as the route clears the cover volume.
    for (const verticalScale of AVOID_VERTICAL_SCALES) {
      this._side.set(this._heading.x, this._heading.y * verticalScale, this._heading.z).normalize();
      for (const degrees of AVOID_ANGLES) {
        for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
          if (degrees === 0 && sideIndex === 1) continue;
          const sign = actor.avoidSign * (sideIndex === 0 ? 1 : -1);
          this._slide.copy(this._side).applyAxisAngle(UP, sign * degrees * Math.PI / 180);
          this._ray.set(start, this._slide);
          let clear = true;
          for (const box of this._obstacles) {
            const hit = this._ray.intersectBox(box, this._obstacleHit);
            if (hit && hit.distanceTo(start) <= distance) { clear = false; break; }
          }
          if (clear) {
            start.addScaledVector(this._slide, distance);
            return true;
          }
        }
      }
    }

    // If all steering probes are blocked, stop just short of the first solid.
    start.addScaledVector(this._heading, Math.max(0, nearest - 0.08));
    return true;
  }

  _handGripLocal(actor, out = this._gripTarget) {
    const left = actor.rig?.bones?.handL, right = actor.rig?.bones?.handR;
    if (!left || !right) return out.set(0, -1.55, 0.15);
    actor.root.updateMatrixWorld(true);
    left.getWorldPosition(this._handLeft);
    right.getWorldPosition(this._handRight);
    this._handLeft.add(this._handRight).multiplyScalar(0.5);
    return out.copy(actor.root.worldToLocal(this._handLeft));
  }

  _updateCarryGrip(dt) {
    const actor = this.attacker;
    if (!actor) return;
    this._handGripLocal(actor, this._gripTarget);
    if (this.state === "grab") actor.carry.position.lerpVectors(this.gripFrom, this._gripTarget, smooth(this.elapsed / 0.35));
    else actor.carry.position.lerp(this._gripTarget, 1 - Math.exp(-dt * 9));
  }

  _poseActor(actor, dt, time) {
    const carrying = actor === this.attacker && ["grab", "carried", "release", "sky"].includes(this.state);
    const reaching = carrying || actor.state === "attack";
    actor.body.rotation.x = Math.PI / 2 + 0.14 + Math.sin(time * 2.1 + actor.angle) * 0.04;
    actor.body.position.y = Math.sin(time * 3 + actor.angle) * 0.06;
    for (let i = 0; i < actor.wings.length; i++) actor.wings[i].rotation.y = (i ? 1 : -1) * (0.25 + Math.sin(time * 9) * 0.65);
    actor.rig?.pose({ dt, phase: time * 2, stride: 0.1, knee: 0.2, armSwing: carrying ? 0.22 : 0.1, reach: reaching ? 0.82 : 0.25, elbow: carrying ? 0.55 : 0.2, lean: 0.1 });
  }

  update(dt, time) {
    const g = this.game;
    if (g.paused || this.disposed) return;
    this.time += dt;
    const tune = this.tune;
    const playing = g.phase === "roof" && g.runner.alive;
    if (!playing && !this.controlsPlayer) {
      this.marker.visible = false;
      if (this.attacker) this._depart();
      this.state = "idle";
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this.elapsed += dt;
    this.attackIn -= dt;
    if (playing) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0 && this.activeCount < tune.maximum) this._spawn();
    }
    for (const a of this.actors) {
      if (!a.active) continue;
      a.age += dt;
      if (a.state === "circle") {
        a.angle += dt * 0.28;
        this._desired.set(Math.cos(a.angle) * 12, 8.5 + Math.sin(time * 0.8 + a.angle) * 0.6, Math.sin(a.angle) * 12);
        this._previous.copy(a.root.position);
        this._moveAvoiding(a, this._desired, 1 - Math.exp(-dt * 1.4));
        this._heading.subVectors(a.root.position, this._previous);
        this._faceDirection(a, this._heading, dt);
      } else if (a.state === "depart") {
        this._heading.set(Math.sin(a.angle), 0.8, Math.cos(a.angle));
        this._flightTarget.copy(a.root.position).addScaledVector(this._heading, dt * 6);
        this._moveAvoiding(a, this._flightTarget);
        this._faceDirection(a, this._heading, dt, 3);
        if (a.age > 4) { a.active = false; a.root.visible = false; }
      } else if (a.state === "pulled") {
        // Dragged down into a gravity sphere's black hole, then flung off the roof.
        this._flightTarget.copy(a.pullTo);
        a.root.position.lerp(this._flightTarget, 1 - Math.exp(-dt * 4));
        a.root.rotation.x += dt * 3;
        if (a.age > 0.7) {
          const side = Math.abs(a.root.position.x) > 0.5 ? Math.sign(a.root.position.x) : 1;
          a.velocity = new THREE.Vector3(side * 14, 4, 0);
          a.state = "blasted"; a.age = 0; a.spin = side * 6;
        }
      } else if (a.state === "blasted") {
        // Shot off point-blank: thrown back tumbling, and down off the roof.
        a.velocity.y -= 11 * dt;
        a.root.position.addScaledVector(a.velocity, dt);
        a.root.rotation.x += dt * a.spin;
        if (a.age > 3.5) { a.active = false; a.root.visible = false; a.root.rotation.x = 0; }
      } else if (a.state === "frozen") {
        // Frozen in the air: down like a stone, tumbling - in pieces on the
        // roof, or past the ledge and down the side of the building.
        a.velocity.y -= 18 * dt;
        a.root.position.addScaledVector(a.velocity, dt);
        a.root.rotation.x += dt * a.spin;
        const ground = this.roof.groundAt(a.root.position);
        if (ground !== null && a.root.position.y <= ground + 0.5) this._shatter(a, ground);
        else if (a.root.position.y < -40) this._putAway(a);
        // Locked in the ice as it was: no wingbeat, no pose.
        continue;
      } else if (a.state === "shocked") {
        // Seized up in the arcs: dropping, jerking about - then it beats its way back up.
        a.shocked -= dt;
        a.velocity.y = Math.max(-4, a.velocity.y - 6 * dt);
        a.root.position.addScaledVector(a.velocity, dt);
        a.root.position.x += (this.random() - 0.5) * 0.1;
        a.root.position.z += (this.random() - 0.5) * 0.1;
        a.root.position.y = Math.max(2.6, a.root.position.y);
        if (a.shocked <= 0) { a.state = "circle"; a.age = 0; a.wait = this._range(FLIGHT.circle); a.shockPower = 0; }
      }
      this._poseActor(a, dt, time);
      if (a.state === "shocked") for (const wing of a.wings) wing.rotation.y = (this.random() - 0.5) * 1.4;
    }
    if (this.state === "idle" && this.attackIn <= 0 && this._canAttack()) {
      const actor = this.actors.find((a) => a.active && a.state === "circle" && a.age >= a.wait);
      if (actor) this._warn(actor);
    }
    if (this.state === "warning") {
      if (!this._canAttack()) { this._depart(); this.state = "idle"; return; }
      if (this.elapsed <= tune.tracking) this.target.copy(g.hero.position).setY(0);
      this.marker.position.copy(this.target).y = 0.045;
      this.marker.scale.setScalar(1 + 0.025 * Math.sin(time * 15));
      this._desired.copy(this.target).add(new THREE.Vector3(3, 9, 3));
      this._previous.copy(this.attacker.root.position);
      this._moveAvoiding(this.attacker, this._desired, 1 - Math.exp(-dt * 3));
      this._heading.subVectors(this.attacker.root.position, this._previous);
      this._faceDirection(this.attacker, this._heading, dt);
      if (this.elapsed >= tune.warning) {
        this.state = "dive"; this.elapsed = 0;
        this.diveFrom = this.attacker.root.position.clone();
      }
    } else if (this.state === "dive") {
      const u = Math.min(1, this.elapsed / tune.dive);
      this._desired.copy(this.target).add(new THREE.Vector3(0, 1.55, -0.15));
      this._previous.copy(this.attacker.root.position);
      this._flightTarget.lerpVectors(this.diveFrom, this._desired, smooth(u));
      this._moveAvoiding(this.attacker, this._flightTarget);
      this._heading.subVectors(this.attacker.root.position, this._previous);
      this._faceDirection(this.attacker, this._heading, dt, 6);
      if (u === 1) {
        const p = g.hero.position;
        this.landingSpot = safeAbductionSpot(this.roof, p);
        const grabPoint = this._desired.copy(this.target).add(new THREE.Vector3(0, 1.55, -0.15));
        const reached = this.attacker.root.position.distanceTo(grabPoint) <= 1.65;
        if (reached && Math.hypot(p.x - this.target.x, p.z - this.target.z) <= FLIGHT.radius && p.y < 0.9 && this.roof.groundAt(p) === 0 && this.landingSpot && this._canAttack()) this._grab();
        else if (this.elapsed >= tune.dive + 1.2) { this._depart(); this.state = "idle"; }
      }
    } else if (["grab", "carried", "shoot", "bite", "release"].includes(this.state)) {
      const a = this.attacker;
      // Small lateral correction toward a clear landing area, visibly flown.
      this._flightTarget.copy(a.root.position);
      this._flightTarget.x += (this.landingSpot.x - this.carryOffset.x - a.root.position.x) * (1 - Math.exp(-dt * 1.2));
      this._flightTarget.z += (this.landingSpot.z - this.carryOffset.z - a.root.position.z) * (1 - Math.exp(-dt * 1.2));
      const height = Math.min(FLIGHT.lift, Math.max(0, this.time - this.grabAt) * 1.1);
      this._flightTarget.y = this.grabHeight + height;
      this._moveAvoiding(a, this._flightTarget);
      this._heading.set(this.landingSpot.x - this.carryOffset.x - a.root.position.x, 0, this.landingSpot.z - this.carryOffset.z - a.root.position.z);
      this._faceDirection(a, this._heading, dt, 2.5);
      this._updateCarryGrip(dt);
      this._syncPlayer(dt);
      if (this.firstPerson) this._closeCamera(dt);
      else this._carryCamera(dt);
      if (this.state === "grab" && this.elapsed >= 0.35) { this.state = "carried"; this.elapsed = 0; this._startQTE(); }
      if (this.state === "carried") {
        this._struggleAudio();
        const presses = this.reactions._s?.presses ?? 0;
        if (presses > (this._kickPresses ?? 0)) this.kick = Math.max(this.kick, 1);
        this._kickPresses = presses;
        const result = this.reactions.update(dt);
        if (result === "success") { this._endQTE(); g.sfx?.playAbductionVoice?.("escape", { replace: true }); this.state = "shoot"; this.elapsed = 0; this.fired = false; }
        else if (result === "fail") { this._endQTE(); this._startBite(); }
      } else if (this.state === "shoot") {
        if (!this.fired && this.elapsed >= CLOSE.fireAt) this._pointBlank();
        if (this.elapsed >= CLOSE.shoot) {
          const a = this.attacker;
          this._release();
          // (Not departing: blown off - _release's _depart, overruled.)
          a.state = "blasted"; a.age = 0; a.spin = (this.random() < 0.5 ? -1 : 1) * (4 + this.random() * 3);
        }
      } else if (this.state === "bite") {
        if (!this.bitten && this.elapsed >= CLOSE.biteAt) this._bite();
        this._lids(this._closed(this.elapsed));
        if (this.elapsed >= CLOSE.bite) this._startSky();
      } else if (this.state === "release" && this.elapsed >= 0.25) this._release();
    } else if (this.state === "landing") {
      const duration = Math.sqrt(2 * Math.max(0.01, this.releaseFrom.y) / 14);
      const u = Math.min(1, this.elapsed / duration);
      g.hero.position.lerpVectors(this.releaseFrom, this.landingSpot, smooth(u));
      g.hero.position.y = Math.max(0, this.releaseFrom.y - 7 * this.elapsed * this.elapsed);
      g.avatar.root.position.copy(g.hero.position);
      g.avatar.update(dt, { speed: 0, height: g.hero.position.y, aiming: false });
      this._carryCamera(dt);
      if (u === 1) this._land();
    } else if (this.state === "return") {
      const cam = g.camera, q = cam.quaternion.clone(), position = cam.position.clone();
      const blend = smooth(this.elapsed / 0.65);
      cam.position.lerpVectors(this.returnPosition, position, blend);
      cam.quaternion.slerpQuaternions(this.returnRotation, q, blend);
      if (blend === 1) this.state = "idle";
    } else if (this.state === "sky") this._sky(dt);
  }

  _grab() {
    const g = this.game, a = this.attacker;
    this.state = "grab"; this.elapsed = 0; this.grabAt = this.time;
    this.marker.visible = false;
    g.phase = "roofAbduct";
    g.runner.firing = false; g.runner.shotQueued = false; g.runner.chargedQueued = 0;
    g.charge?.cancel(); g.held.clear();
    g.hero.velocity.set(0, 0, 0); g.hero.knock.set(0, 0, 0); g.hero.vy = 0;
    // Reach from the actual dive pose, preserving both world transforms.
    // The grip closes over the short grab animation instead of snapping either body.
    g.scene.updateMatrixWorld(true);
    g.avatar.root.getWorldPosition(this._world);
    a.carry.position.copy(a.root.worldToLocal(this._world.clone()));
    this.gripFrom = a.carry.position.clone();
    this.gripTo = this._handGripLocal(a, new THREE.Vector3());
    this.carryOffset = this.gripTo.clone().applyQuaternion(a.root.quaternion);
    this.grabHeight = a.root.position.y;
    this.playerHome = g.avatar.root.parent;
    a.root.updateMatrixWorld(true);
    a.carry.attach(g.avatar.root);
    this._holdUp();
    g.avatar.hold = 0; g.avatar.shadow.visible = false;
    this.cameraDirection = g.camera.position.clone().sub(g.hero.position).setY(0).normalize();
    if (this.cameraDirection.lengthSq() < 0.1) this.cameraDirection.set(0.6, 0, 0.8);
    this.cameraSide = new THREE.Vector3().crossVectors(UP, this.cameraDirection);
    // Let go a few metres on - a clear spot on the roof, a clear way down to it.
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const candidate = safeAbductionSpot(this.roof, g.hero.position.clone().add(new THREE.Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4)));
      if (candidate && candidate.distanceTo(g.hero.position) > 2 && candidate.distanceTo(g.hero.position) < 6 && this._clearReleasePath(g.hero.position, candidate)) {
        this.landingSpot.copy(candidate);
        break;
      }
    }
    g.hud.hideBanner(); g.hud.setPrompt(null); g.ammoHint.hide();
    this.layer?.stopTalk?.();
    document.body.classList.add("story-cutscene");
    g.audio.stumble(); g._patientSound("growl", a.root.position, 0.8);
    g.sfx?.playAbductionVoice?.("grab", { replace: true });
    this._nextEffort = this.time + 0.9;
    this._lastEffortPresses = 0;
    this._kickPresses = 0;
    this.unconscious = false;
  }

  _clearReleasePath(from, to) {
    const steps = Math.ceil(from.distanceTo(to) / 0.35);
    for (let i = 1; i <= steps; i++) {
      const p = new THREE.Vector3().lerpVectors(from, to, i / steps).setY(0);
      if (this.roof.blocked(p, 0.6) || this.roof.groundAt(p) !== 0) return false;
    }
    return true;
  }

  _startQTE() {
    if (!this.layer) {
      const ui = new StoryUI();
      this.layer = { ui, reactions: new ReactionHits(ui) };
      this.layer.reactions.listen();
      this.ownLayer = true;
    }
    this.reactions = this.layer.reactions;
    this.ownsQTE = true;
    this.uiWasHidden = this.layer.ui.root.hidden;
    this.layer.ui.show();
    this.reactions.start(abductionReaction(this.tune, this.reactions.options));
  }

  _endQTE() {
    if (!this.ownsQTE) return;
    this.reactions.cancel();
    if (this.uiWasHidden) this.layer.ui.hide();
    this.ownsQTE = false;
  }

  _struggleAudio() {
    const s = this.reactions._s;
    if (!s || this.reactions.state === "success" || this.time < this._nextEffort) return;
    const urgency = Math.min(1, s.total / s.time);
    const pressed = s.presses > this._lastEffortPresses;
    // React to a counted tap when possible; slower idle exertions keep the
    // struggle audible with hold accessibility or when the player hesitates.
    if (!pressed && this.time < this._nextEffort + 0.35) return;
    this.game.sfx?.playAbductionVoice?.("struggle", { intensity: urgency });
    this._lastEffortPresses = s.presses;
    this._nextEffort = this.time + THREE.MathUtils.lerp(0.85, 0.5, urgency);
  }

  _syncPlayer(dt) {
    const g = this.game;
    g.avatar.root.getWorldPosition(g.hero.position);
    g.avatar.hold = 0; g.avatar.reachUp = 0.55;
    g.avatar.update(dt, { speed: 0, height: 1, aiming: false });
    // Match FallScene's hip pivot, horizontal tumble, and active air flail.
    const struggleTime = this.time - this.grabAt;
    g.avatar.body.position.set(0, -1, 0);
    g.avatar.root.rotation.set(Math.PI / 2 + Math.sin(struggleTime * 2.3) * 0.05, 0, Math.sin(struggleTime * 3.1) * 0.08);
    // (Out cold after the bite: hanging limp.)
    g.avatar.flail?.(struggleTime, this.unconscious ? 0.06 : THREE.MathUtils.lerp(1, 0.75, Math.min(1, struggleTime / 3)));
  }

  /* ---- up close: first person ---- */

  _headWorld(actor, out) {
    const head = actor.rig?.bones?.head;
    if (head) return head.getWorldPosition(out);
    // (A stand-in without bones: ahead of the grip, along the body.)
    return out.set(0, 0.2, 0.9).applyQuaternion(actor.root.quaternion).add(actor.root.position);
  }

  /**
   * The eye: held up under its face, looking up into it - shaken by every tap
   * of the struggle, thrown by the shot, lunged at by the bite.
   */
  _closeCamera(dt) {
    const g = this.game, a = this.attacker, cam = g.camera;
    a.root.updateMatrixWorld(true);
    const head = this._headWorld(a, this._look);
    // Its way forward: from the grip to the head.
    this._heading.subVectors(head, g.hero.position).setY(0);
    if (this._heading.lengthSq() < 1e-4) this._heading.copy(this.cameraDirection).negate();
    const eye = this._desired.copy(head).addScaledVector(this._heading.normalize(), CLOSE.ahead);
    eye.y -= CLOSE.below;
    if (this.state === "bite") eye.lerp(head, 0.5 * smooth(Math.min(1, this.elapsed / CLOSE.biteAt)));
    this.kick = Math.max(0, this.kick - dt * 3.5);
    const t = this.time, calm = g.reducedMotion ? 0.3 : 1;
    const shake = (0.012 + 0.05 * this.kick) * calm;
    eye.x += Math.sin(t * 37) * shake; eye.y += Math.sin(t * 29 + 1) * shake; eye.z += Math.sin(t * 41 + 2) * shake;
    // (Aimed a little under it: the face sits above the struggle's prompt.)
    this._aimCamera(eye, this._flightTarget.copy(head).setY(head.y - CLOSE.lift), this.state === "grab" ? 1 - Math.exp(-dt * 9) : 1);
    cam.rotateZ((Math.sin(t * 6.5) * 0.06 + Math.sin(t * 23) * 0.04 * this.kick) * calm);
    this._handsUp();
  }

  /** The launcher, in your hands under its face (as game.js holds it first person). */
  _handsUp() {
    const g = this.game, rig = g.launcher.rig;
    if (rig.parent !== g.camera) g.camera.add(rig);
    const sway = Math.sin(this.time * 9) * 0.02 * (0.4 + this.kick);
    rig.position.set(0.3 + sway, -0.34 + Math.abs(sway), -0.58 + g.launcher.recoil * 0.14);
    rig.rotation.set(0.12 + g.launcher.recoil * 0.3, 0.06, sway);
  }

  /** Into first person: the body out of the way, the launcher kept. */
  _holdUp() {
    const g = this.game, rig = g.launcher.rig;
    this.weaponHome = { parent: rig.parent, p: rig.position.clone(), q: rig.quaternion.clone() };
    g.avatar.root.visible = false;
    this._handsUp();
  }

  /** Out of first person: the body back, the launcher back on its shoulder. */
  _holster() {
    const g = this.game, rig = g.launcher.rig, home = this.weaponHome;
    g.avatar.root.visible = true;
    if (!home) return;
    if (rig.parent !== home.parent) home.parent.add(rig);
    rig.position.copy(home.p); rig.quaternion.copy(home.q);
    this.weaponHome = null;
  }

  /** The struggle won: the launcher up under its jaw, and fire. */
  _pointBlank() {
    const g = this.game, a = this.attacker;
    this.fired = true;
    const at = this._headWorld(a, new THREE.Vector3());
    g.launcher.recoil = 1;
    this.kick = 2;
    g.audio.shot?.(false);
    g.audio.crash?.(0.9);
    g.sphereImpact?.splash(at, "shock", 1.4, null, { ground: false });
    g.debris?.sparks(at, { count: 40, speed: 8 });
    g._patientSound?.("death", at, 1);
    // Thrown back the way it faced, and up: a.velocity, for "blasted".
    this._heading.subVectors(at, g.hero.position).setY(0);
    if (this._heading.lengthSq() < 1e-4) this._heading.copy(this.cameraDirection).negate();
    a.velocity = this._heading.normalize().multiplyScalar(9).add(new THREE.Vector3(0, 5, 0));
  }

  /** The struggle lost: it bites. */
  _startBite() {
    this.state = "bite"; this.elapsed = 0; this.bitten = false;
    this.game._patientSound?.("growl", this.attacker.root.position, 1);
  }

  _bite() {
    const g = this.game;
    this.bitten = true;
    this.kick = 2.5;
    g.hitFlash = 1;
    g.hud.flashDamage?.();
    g.audio.stumble?.();
    g.sfx?.play?.("body-hit", { volume: 0.8, cooldown: 0.3, cooldownKey: "abduction-bite" });
    this.unconscious = true;
  }

  /** How closed the eyes are, `t` into the bite. */
  _closed(t) {
    if (t <= LIDS[0][0]) return 0;
    for (let i = 1; i < LIDS.length; i++) {
      const [t1, v1] = LIDS[i], [t0, v0] = LIDS[i - 1];
      if (t <= t1) return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
    return 1;
  }

  /** Black over the screen as the eyes close (0 open .. 1 out cold). */
  _lids(closed) {
    if (!this._lidsEl) {
      if (closed <= 0 || typeof document.createElement !== "function") return;
      const el = document.createElement("div");
      el.className = "abduction-lids";
      el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:30;opacity:0;background:radial-gradient(ellipse 120% 90% at 50% 50%,rgba(20,0,0,.9) 0%,#000 62%);";
      document.body.appendChild(el);
      this._lidsEl = el;
    }
    this._lidsEl.style.opacity = String(THREE.MathUtils.clamp(closed, 0, 1));
  }

  _aimCamera(position, look, blend) {
    const cam = this.game.camera;
    cam.position.lerp(position, blend);
    this._cameraRig.position.copy(cam.position);
    this._cameraRig.up.copy(UP);
    this._cameraRig.lookAt(look);
    cam.quaternion.slerp(this._cameraRig.quaternion, blend);
  }

  _carryCamera(dt) {
    const p = this.game.hero.position;
    this._desired.copy(p).addScaledVector(this.cameraDirection, 9).y += 5;
    // Keep the bodies to the left of the existing centered SPACE prompt.
    this._look.copy(p).addScaledVector(this.cameraSide, 3.8).y += 1.8;
    this._aimCamera(this._desired, this._look, 1 - Math.exp(-dt * 5));
  }

  _release() {
    const g = this.game;
    this._holster();
    (this.playerHome ?? g.scene).attach(g.avatar.root);
    g.avatar.root.rotation.set(0, g.hero.yaw, 0);
    g.avatar.body.position.set(0, 0, 0);
    g.avatar.root.getWorldPosition(g.hero.position);
    this.releaseFrom = g.hero.position.clone();
    this.state = "landing"; this.elapsed = 0;
    this._depart();
    g.avatar.reachUp = 0;
    g.avatar.hold = 1;
  }

  _land() {
    const g = this.game;
    g.hero.vy = 0; g.hero.velocity.set(0, 0, 0); g.hero.knock.set(0, 0, 0);
    g.avatar.shadow.visible = true;
    g.runner.invulnerable = Math.max(g.runner.invulnerable, 1);
    g.phase = "roof"; g.snapCamera = false; g.held.clear();
    this.state = "return"; this.elapsed = 0;
    this.returnPosition = g.camera.position.clone(); this.returnRotation = g.camera.quaternion.clone();
    document.body.classList.remove("story-cutscene");
    g.hud.toast("YOU BROKE FREE", "SHOT IT OFF POINT-BLANK", "", 2600);
    g.audio.land?.();
    // MeltdownAudio has no land() cue; use the existing recorded body impact.
    g.sfx?.play?.("body-hit", { volume: 0.45, cooldown: 0.3, cooldownKey: "abduction-landing" });
  }

  _startSky() {
    const g = this.game;
    this._holster();
    this.state = "sky"; this.elapsed = 0; this.skyTime = 0; this.gameOverShown = false;
    g.runner.alive = false; g.runner.vitality = 0;
    this.skyFrom = g.camera.position.clone(); this.skyRotationFrom = g.camera.quaternion.clone();
    // Escape outward from the roof at roughly 45 degrees, with a small random
    // bearing change each time. The camera starts behind that path and aims
    // obliquely into the sky instead of looking straight up.
    this.skyDirection.set(this.attacker.root.position.x, 0, this.attacker.root.position.z);
    if (this.skyDirection.lengthSq() < 1) {
      const angle = this.random() * Math.PI * 2;
      this.skyDirection.set(Math.sin(angle), 0, Math.cos(angle));
    }
    this.skyDirection.normalize().applyAxisAngle(UP, (this.random() - 0.5) * 1.1).normalize();
    this.skyVelocity.copy(this.skyDirection).add(UP).normalize().multiplyScalar(FLIGHT.skySpeed);
    this.skyPosition.copy(this.attacker.root.position).addScaledVector(this.skyDirection, -10).setY(2.2);
    this._look.copy(this.skyPosition).addScaledVector(this.skyDirection, 18).addScaledVector(UP, 18 * Math.tan(0.16));
    this._cameraRig.position.copy(this.skyPosition); this._cameraRig.lookAt(this._look);
    this.skyRotation = this._cameraRig.quaternion.clone();
    g.sfx?.playAbductionVoice?.("capture", { replace: true });
  }

  _sky(dt) {
    const g = this.game, cam = g.camera;
    this.skyTime += dt;
    this._previous.copy(this.attacker.root.position);
    this._flightTarget.copy(this.attacker.root.position).addScaledVector(this.skyVelocity, dt);
    this._moveAvoiding(this.attacker, this._flightTarget);
    this._heading.subVectors(this.attacker.root.position, this._previous);
    this._faceDirection(this.attacker, this._heading, dt, 5);
    this._updateCarryGrip(dt);
    this._syncPlayer(dt);
    // Coming round (bitten) as it carries you off.
    if (this.unconscious) this._lids(1 - smooth(this.skyTime / CLOSE.wakeUp));
    const blend = smooth(this.skyTime / FLIGHT.skyTransition);
    cam.position.lerpVectors(this.skyFrom, this.skyPosition, blend);
    cam.quaternion.slerpQuaternions(this.skyRotationFrom, this.skyRotation, blend);
    g.sfx?.updateAbductionVoice?.(cam.position.distanceTo(g.hero.position));
    if (!this.gameOverShown && this.skyTime >= FLIGHT.gameOverDelay) {
      this.gameOverShown = true;
      document.body.classList.remove("story-cutscene");
      g._roofSummary(false, "YOU WERE CAPTURED!", { deathScene: "capture" });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.game.sfx?.stopAbductionVoice?.();
    this._endQTE();
    const g = this.game;
    if (this.playerHome) {
      this.playerHome.attach(g.avatar.root);
      g.avatar.root.rotation.set(0, g.hero.yaw, 0);
      g.avatar.body.position.set(0, 0, 0);
      g.avatar.shadow.visible = true;
    }
    this._holster();
    this._lidsEl?.remove();
    this._lidsEl = null;
    g.avatar.hold = 1; g.avatar.reachUp = 0;
    g.avatar.body.position.set(0, 0, 0);
    if (this.ownLayer) { this.layer.reactions.dispose(); this.layer.ui.dispose(); }
    document.body.classList.remove("story-cutscene");
    this.root.removeFromParent();
    for (const a of this.actors) {
      a.rig?.dispose?.();
      a.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton?.dispose(); });
    }
    for (const x of this.owned) x.dispose();
    this.actors.length = 0;
    this.disposed = true;
  }
}
