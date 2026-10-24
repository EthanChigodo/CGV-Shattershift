/** Rooftop-only, non-combat patients: telegraph -> dive -> carry/QTE -> release or sky. */
import * as THREE from "../../three.js";
import { cloneCharacter, createRig } from "./characters.js";
import { ReactionHits, MASH_DIFFICULTY } from "../../story/reaction.js";
import { StoryUI } from "../../story/story-ui.js";

// All encounter balancing lives here. Accessibility options still come from ReactionHits.
export const ABDUCTION = {
  easy: { maximum: 1, warning: 3.5, qte: 5, presses: 6, dive: 0.9 },
  normal: { maximum: 2, warning: 3, qte: 4, presses: 8, dive: 0.75 },
  hard: { maximum: 2, warning: 2, qte: 2.5, presses: 10, dive: 0.5 },
};
export const FLIGHT = { radius: 1.5, tracking: 0.7, firstSpawn: [6, 10], spawn: [8, 14], cooldown: [12, 19], circle: [2.5, 5], lift: 4, pickup: 2, skyTransition: 1.1, skyHold: 2, skyFallback: 12, skySpeed: 12 };
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
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
    this.tune = ABDUCTION[game.difficulty?.key] ?? ABDUCTION.normal;
    this.root = new THREE.Group();
    this.root.name = "FlyingZombieEncounter";
    game.scene.add(this.root);
    this.owned = [];
    this.actors = [];
    this.state = "idle";
    this.time = 0;
    this.elapsed = 0;
    this.spawnIn = this._range(FLIGHT.firstSpawn);
    this.attackIn = 0;
    this.weapon = null;
    this.target = new THREE.Vector3();
    this._world = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._heading = new THREE.Vector3();
    this._previous = new THREE.Vector3();
    this.skyDirection = new THREE.Vector3();
    this.skyVelocity = new THREE.Vector3();
    this.skyPosition = new THREE.Vector3();
    this._box = new THREE.Box3();
    this._cameraRig = new THREE.PerspectiveCamera();
    this.marker = this._marker();
    this.root.add(this.marker);
  }

  _own(x) { this.owned.push(x); return x; }
  _range([a, b]) { return a + this.random() * (b - a); }
  get activeCount() { return this.actors.filter((a) => a.active).length; }
  get controlsPlayer() { return ["grab", "carried", "release", "landing", "sky", "hold"].includes(this.state); }
  get holdsCamera() { return this.controlsPlayer || this.state === "done"; }
  get pickupPrompt() {
    return this.game.phase === "roof" && this.drop?.landed && this.weapon && this.game.hero.position.distanceTo(this.drop.to) <= FLIGHT.pickup
      ? "E - PICK UP BAZOOKA" : null;
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
    const actor = { root, body, model, rig, wings, carry, active: false, state: "circle", age: 0, angle: this.random() * Math.PI * 2, wait: 0 };
    this.actors.push(actor);
    // Deliberately no hurtbox and no registration in enemies/breakables/solids.
    return actor;
  }

  _spawn() {
    if (this.activeCount >= this.tune.maximum) return null;
    const a = this.actors.find((x) => !x.active) ?? this._createActor();
    const player = this.game.hero.position;
    let angle = this.random() * Math.PI * 2;
    for (let i = 0; i < 8; i++, angle += Math.PI / 4) {
      a.root.position.set(Math.cos(angle) * 21, 10 + this.random() * 3, Math.sin(angle) * 21);
      if (a.root.position.distanceTo(player) > 10) break;
    }
    a.angle = angle; a.age = 0; a.wait = this._range(FLIGHT.circle);
    a.state = "circle"; a.active = true; a.root.visible = true;
    this.spawnIn = this._range(FLIGHT.spawn);
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
    this.game.hud.toast("LOOK UP!", "MOVE OUT OF THE RED CIRCLE", "warn", this.tune.warning * 1000);
    this.game._patientSound("shriek", a.root.position, 0.65);
    return true;
  }

  _depart(a = this.attacker) {
    if (a) { a.state = "depart"; a.age = 0; }
    this.attacker = null;
    this.marker.visible = false;
    this.attackIn = this._range(FLIGHT.cooldown);
  }

  _faceDirection(actor, direction, dt, speed = 4) {
    if (direction.lengthSq() < 1e-5) return;
    const want = Math.atan2(direction.x, direction.z);
    let delta = want - actor.root.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    actor.root.rotation.y += delta * Math.min(1, dt * speed);
  }

  _poseActor(actor, dt, time) {
    const carrying = actor === this.attacker && ["grab", "carried", "release", "sky", "hold", "done"].includes(this.state);
    const reaching = carrying || actor.state === "attack";
    actor.body.rotation.x = Math.PI / 2 + 0.14 + Math.sin(time * 2.1 + actor.angle) * 0.04;
    actor.body.position.y = Math.sin(time * 3 + actor.angle) * 0.06;
    for (let i = 0; i < actor.wings.length; i++) actor.wings[i].rotation.y = (i ? 1 : -1) * (0.25 + Math.sin(time * 9) * 0.65);
    actor.rig?.pose({ dt, phase: time * 2, stride: 0.1, knee: 0.2, armSwing: carrying ? 0.22 : 0.1, reach: reaching ? 0.82 : 0.25, elbow: carrying ? 0.55 : 0.2, lean: 0.1 });
  }

  _updateBackgroundActors(dt, time) {
    for (const actor of this.actors) {
      if (!actor.active) continue;
      actor.age += dt;
      if (actor.state === "circle") {
        actor.angle += dt * 0.28;
        this._desired.set(Math.cos(actor.angle) * 12, 8.5 + Math.sin(time * 0.8 + actor.angle) * 0.6, Math.sin(actor.angle) * 12);
        this._previous.copy(actor.root.position);
        actor.root.position.lerp(this._desired, 1 - Math.exp(-dt * 1.4));
        this._heading.subVectors(actor.root.position, this._previous);
        this._faceDirection(actor, this._heading, dt);
      } else if (actor.state === "depart") {
        this._heading.set(Math.sin(actor.angle), 0.8, Math.cos(actor.angle));
        actor.root.position.addScaledVector(this._heading, dt * 6);
        this._faceDirection(actor, this._heading, dt, 3);
        if (actor.age > 4) { actor.active = false; actor.root.visible = false; }
      }
      this._poseActor(actor, dt, time);
    }
  }

  update(dt, time) {
    const g = this.game;
    if (g.paused || this.disposed) return;
    this.time += dt;
    if (this.state === "done") {
      // Keep non-interacting flyers and their wings alive behind the summary.
      this._updateBackgroundActors(dt, time);
      return;
    }
    this._updateWeapon(dt);
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
      if (this.spawnIn <= 0 && this.activeCount < this.tune.maximum) this._spawn();
    }
    for (const a of this.actors) {
      if (!a.active) continue;
      a.age += dt;
      if (a.state === "circle") {
        a.angle += dt * 0.28;
        this._desired.set(Math.cos(a.angle) * 12, 8.5 + Math.sin(time * 0.8 + a.angle) * 0.6, Math.sin(a.angle) * 12);
        this._previous.copy(a.root.position);
        a.root.position.lerp(this._desired, 1 - Math.exp(-dt * 1.4));
        this._heading.subVectors(a.root.position, this._previous);
        this._faceDirection(a, this._heading, dt);
      } else if (a.state === "depart") {
        this._heading.set(Math.sin(a.angle), 0.8, Math.cos(a.angle));
        a.root.position.addScaledVector(this._heading, dt * 6);
        this._faceDirection(a, this._heading, dt, 3);
        if (a.age > 4) { a.active = false; a.root.visible = false; }
      }
      this._poseActor(a, dt, time);
    }
    if (this.state === "idle" && this.attackIn <= 0 && this._canAttack()) {
      const actor = this.actors.find((a) => a.active && a.state === "circle" && a.age >= a.wait);
      if (actor) this._warn(actor);
    }
    if (this.state === "warning") {
      if (!this._canAttack()) { this._depart(); this.state = "idle"; return; }
      if (this.elapsed <= FLIGHT.tracking) this.target.copy(g.hero.position).setY(0);
      this.marker.position.copy(this.target).y = 0.045;
      this.marker.scale.setScalar(1 + 0.025 * Math.sin(time * 15));
      this._desired.copy(this.target).add(new THREE.Vector3(3, 9, 3));
      this._previous.copy(this.attacker.root.position);
      this.attacker.root.position.lerp(this._desired, 1 - Math.exp(-dt * 3));
      this._heading.subVectors(this.attacker.root.position, this._previous);
      this._faceDirection(this.attacker, this._heading, dt);
      if (this.elapsed >= this.tune.warning) {
        this.state = "dive"; this.elapsed = 0;
        this.diveFrom = this.attacker.root.position.clone();
      }
    } else if (this.state === "dive") {
      const u = Math.min(1, this.elapsed / this.tune.dive);
      this._desired.copy(this.target).add(new THREE.Vector3(0, 1.55, -0.15));
      this._previous.copy(this.attacker.root.position);
      this.attacker.root.position.lerpVectors(this.diveFrom, this._desired, smooth(u));
      this._heading.subVectors(this.attacker.root.position, this._previous);
      this._faceDirection(this.attacker, this._heading, dt, 6);
      if (u === 1) {
        const p = g.hero.position;
        this.landingSpot = safeAbductionSpot(this.roof, p);
        if (Math.hypot(p.x - this.target.x, p.z - this.target.z) <= FLIGHT.radius && p.y < 0.9 && this.roof.groundAt(p) === 0 && this.landingSpot && this._canAttack()) this._grab();
        else { this._depart(); this.state = "idle"; }
      }
    } else if (this.state === "grab" || this.state === "carried" || this.state === "release") {
      const a = this.attacker;
      // Small lateral correction toward a clear landing area, visibly flown.
      a.root.position.x += (this.landingSpot.x - this.carryOffset.x - a.root.position.x) * (1 - Math.exp(-dt * 1.2));
      a.root.position.z += (this.landingSpot.z - this.carryOffset.z - a.root.position.z) * (1 - Math.exp(-dt * 1.2));
      const height = Math.min(FLIGHT.lift, Math.max(0, this.time - this.grabAt) * 1.1);
      a.root.position.y = this.grabHeight + height;
      this._heading.set(this.landingSpot.x - this.carryOffset.x - a.root.position.x, 0, this.landingSpot.z - this.carryOffset.z - a.root.position.z);
      this._faceDirection(a, this._heading, dt, 2.5);
      if (this.state === "grab") a.carry.position.lerpVectors(this.gripFrom, this.gripTo, smooth(this.elapsed / 0.35));
      this._syncPlayer(dt);
      this._carryCamera(dt);
      if (this.state === "grab" && this.elapsed >= 0.35) { this.state = "carried"; this.elapsed = 0; this._startQTE(); }
      if (this.state === "carried") {
        this._struggleAudio();
        const result = this.reactions.update(dt);
        if (result === "success") { this._endQTE(); g.sfx?.playAbductionVoice?.("escape", { replace: true }); this.state = "release"; this.elapsed = 0; g.audio.whoosh(); }
        else if (result === "fail") { this._endQTE(); this._startSky(); }
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
    } else if (this.state === "sky" || this.state === "hold") this._sky(dt);
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
    this.gripTo = new THREE.Vector3(0, -1.55, 0.15);
    this.carryOffset = this.gripTo.clone().applyQuaternion(a.root.quaternion);
    this.grabHeight = a.root.position.y;
    this.playerHome = g.avatar.root.parent;
    a.root.updateMatrixWorld(true);
    a.carry.attach(g.avatar.root);
    this._dropWeapon();
    g.avatar.hold = 0; g.avatar.shadow.visible = false;
    this.cameraDirection = g.camera.position.clone().sub(g.hero.position).setY(0).normalize();
    if (this.cameraDirection.lengthSq() < 0.1) this.cameraDirection.set(0.6, 0, 0.8);
    this.cameraSide = new THREE.Vector3().crossVectors(UP, this.cameraDirection);
    // Release a few metres from the dropped gun, so recovery means walking
    // back to it. Both destinations are checked against the existing roof.
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const candidate = safeAbductionSpot(this.roof, g.hero.position.clone().add(new THREE.Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4)));
      if (candidate && candidate.distanceTo(this.drop.to) > FLIGHT.pickup + 1 && candidate.distanceTo(g.hero.position) < 6 && this._clearReleasePath(g.hero.position, candidate)) {
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
    g.avatar.flail?.(struggleTime, THREE.MathUtils.lerp(1, 0.75, Math.min(1, struggleTime / 3)));
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
    (this.playerHome ?? g.scene).attach(g.avatar.root);
    g.avatar.root.rotation.set(0, g.hero.yaw, 0);
    g.avatar.body.position.set(0, 0, 0);
    g.avatar.root.getWorldPosition(g.hero.position);
    this.releaseFrom = g.hero.position.clone();
    this.state = "landing"; this.elapsed = 0;
    this._depart();
    g.avatar.reachUp = 0;
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
    g.hud.toast("YOU BROKE FREE", "RECOVER YOUR BAZOOKA ON THE ROOF", "", 2600);
    g.audio.land?.();
    // MeltdownAudio has no land() cue; use the existing recorded body impact.
    g.sfx?.play?.("body-hit", { volume: 0.45, cooldown: 0.3, cooldownKey: "abduction-landing" });
  }

  _dropWeapon() {
    if (this.weapon) return; // A second abduction never duplicates an unrecovered weapon.
    const g = this.game, weapon = g.launcher.rig;
    const home = { parent: weapon.parent, p: weapon.position.clone(), q: weapon.quaternion.clone(), s: weapon.scale.clone() };
    g.scene.attach(weapon);
    const from = weapon.position.clone(), rotation = weapon.quaternion.clone();
    const to = safeAbductionSpot(this.roof, from) ?? this.landingSpot.clone();
    const resting = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.random() * Math.PI * 2, 0.1));
    weapon.quaternion.copy(resting); weapon.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(weapon);
    to.y = box.isEmpty() ? 0.15 : from.y - box.min.y + 0.045;
    weapon.quaternion.copy(rotation);
    weapon.updateMatrixWorld(true);
    this.weapon = weapon;
    this.drop = { home, from, to, rotation, resting, t: 0, duration: Math.sqrt(2 * Math.max(0.05, from.y - to.y) / 14), landed: false };
  }

  _updateWeapon(dt) {
    const d = this.drop;
    if (!this.weapon || !d || d.landed) return;
    d.t += dt;
    const u = Math.min(1, d.t / d.duration);
    this.weapon.position.lerpVectors(d.from, d.to, u);
    this.weapon.position.y = Math.max(d.to.y, d.from.y - 7 * d.t * d.t);
    this.weapon.quaternion.slerpQuaternions(d.rotation, d.resting, u);
    this.weapon.rotateZ(Math.sin(u * Math.PI) * 0.35);
    if (u === 1) { d.landed = true; this.weapon.position.copy(d.to); this.weapon.quaternion.copy(d.resting); }
  }

  pickup() {
    if (!this.pickupPrompt || this.controlsPlayer || this.game.paused) return false;
    this._restoreWeapon();
    this.game.avatar.hold = 1;
    this.game._placeLauncher(false);
    this.game.audio.pickup?.();
    this.game.hud.toast("BAZOOKA RECOVERED", "", "", 1200);
    return true;
  }

  _restoreWeapon() {
    if (!this.weapon) return;
    const { parent, p, q, s } = this.drop.home;
    parent.add(this.weapon);
    this.weapon.position.copy(p); this.weapon.quaternion.copy(q); this.weapon.scale.copy(s);
    this.weapon = null; this.drop = null;
  }

  _startSky() {
    const g = this.game;
    this.state = "sky"; this.elapsed = 0; this.skyTime = 0; this.vanishedAt = null;
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
    this.attacker.root.position.addScaledVector(this.skyVelocity, dt);
    this._faceDirection(this.attacker, this.skyDirection, dt, 5);
    this._syncPlayer(dt);
    const blend = smooth(this.skyTime / FLIGHT.skyTransition);
    cam.position.lerpVectors(this.skyFrom, this.skyPosition, blend);
    cam.quaternion.slerpQuaternions(this.skyRotationFrom, this.skyRotation, blend);
    g.sfx?.updateAbductionVoice?.(cam.position.distanceTo(g.hero.position));
    if (this.state === "sky" && blend === 1 && (this._outOfSkyFrame() || this.skyTime >= FLIGHT.skyFallback)) {
      this.state = "hold"; this.vanishedAt = this.skyTime;
      g.sfx?.stopAbductionVoice?.(0.18);
    }
    if (this.state === "hold" && this.skyTime - this.vanishedAt >= FLIGHT.skyHold) {
      this.state = "done";
      document.body.classList.remove("story-cutscene");
      g._roofSummary(false, "YOU WERE CAPTURED!", { deathScene: "capture" });
    }
  }

  _outOfSkyFrame() {
    const cam = this.game.camera;
    cam.updateMatrixWorld(true);
    this._box.setFromObject(this.attacker.root).expandByScalar(0.4);
    let above = true, behind = true, minY = Infinity, maxY = -Infinity;
    const { min, max } = this._box;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      this._world.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      if (this._world.z < -cam.near) behind = false;
      this._world.applyMatrix4(cam.projectionMatrix);
      if (!Number.isFinite(this._world.y) || this._world.y < 1.05) above = false;
      minY = Math.min(minY, this._world.y); maxY = Math.max(maxY, this._world.y);
    }
    return above || behind || (cam.position.distanceTo(this.attacker.root.position) > 160 && maxY - minY < 0.012);
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
    this._restoreWeapon();
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
