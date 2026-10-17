/**
 * One of the two Subjects in Rooftop Showdown: their body, launcher, colours,
 * camera and the numbers the match keeps on them.
 *
 * The body is the game's own (PlayerAvatar, src/levels/meltdown/player.js) -
 * the same rig, gait, wear and skin tone as the story's Subject 07. Two of
 * them on a dark roof, in a crowd of patients, must never be confused, so
 * each wears its player's colour four ways:
 *
 *   rim     a Fresnel rim light in the team colour, added to the figure's
 *           own shader (chained after the rig's and the wear shader's
 *           onBeforeCompile - still one draw call). The same hook frosts the
 *           figure over when a cryo sphere has them, and flashes it white
 *           on a hit.
 *   ring    a glowing ring on the deck under their feet, with a notch that
 *           points where they aim, and a fading aim line out to the target
 *           (the twin-stick player's sight line).
 *   tag     "P1" / "P2" over their head - drawn only for the *other* player
 *           (it is on a layer only the rival's camera renders), so nobody
 *           has their own name floating in front of them.
 *   HUD     the same colour on their half of the screen (hud.js).
 *
 * The match (match.js) owns the rules: it moves them, hurts them, puts them
 * on the ladder. This file only keeps their state and makes it visible.
 */

import * as THREE from "../three.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";
import { Arsenal } from "../systems/arsenal.js";
import { AmmoRecovery } from "../systems/ammo-recovery.js";
import { figureStage } from "../figure/look.js";

export const TEAMS = [
  { key: "p1", label: "P1", name: "SUBJECT 07-A", colour: 0xff3b1f, hex: "#ff3b1f" },
  { key: "p2", label: "P2", name: "SUBJECT 07-B", colour: 0x7ff3ff, hex: "#7ff3ff" },
];
/** The layer each player's name tag is drawn on (the rival's camera enables it). */
export const TAG_LAYERS = [21, 22];

export const MAX_INTEGRITY = 100;
export const START_SPHERES = 18;
export const MAX_SPHERES = 40;

const _v = new THREE.Vector3();

/**
 * The team rim, the frost and the hit flash, added to the figure's material.
 * Returns the uniforms to drive (per figure: each avatar has its own material).
 */
function applyTeamLook(mesh, colour) {
  const material = mesh.material;
  const uniforms = {
    uTeam: { value: new THREE.Color(colour) },
    uTeamRim: { value: 0.85 },
    uFrost: { value: 0 },
    uFlash: { value: 0 },
  };
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uTeam;\nuniform float uTeamRim;\nuniform float uFrost;\nuniform float uFlash;")
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        // Rooftop Showdown: who this is, at a glance - a rim of their colour
        // where the surface turns away from the camera (Fresnel).
        float vsRim = pow(clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += uTeam * vsRim * uTeamRim;
        // Frozen by a cryo sphere: an icy sheen, brightest at the edges.
        totalEmissiveRadiance += vec3(0.45, 0.8, 1.0) * (0.22 + vsRim * 1.1) * uFrost;
        totalEmissiveRadiance += vec3(1.0, 0.92, 0.88) * uFlash;`
      );
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey.call(material) : ""}|versus-team`;
  material.needsUpdate = true;
  return uniforms;
}

/** "P1" on a dark tag with the team colour, for over the head. */
function tagTexture(team) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(13, 14, 16, 0.86)";
  g.beginPath();
  g.moveTo(20, 10); g.lineTo(220, 10); g.lineTo(246, 36); g.lineTo(246, 92); g.lineTo(20, 92); g.closePath();
  g.fill();
  g.fillStyle = team.hex;
  g.fillRect(20, 10, 14, 82);
  g.font = "900 64px 'Big Shoulders Display', 'Arial Narrow', sans-serif";
  g.textBaseline = "middle";
  g.fillText(team.label, 50, 54);
  g.font = "700 18px 'Martian Mono', monospace";
  g.fillStyle = "#ece6da";
  g.fillText(team.key === "p1" ? "07-A" : "07-B", 148, 54);
  // A chevron pointing down at them.
  g.fillStyle = team.hex;
  g.beginPath();
  g.moveTo(112, 100); g.lineTo(144, 100); g.lineTo(128, 122); g.closePath();
  g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A soft dash pattern fading out along the aim line. */
function aimTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  for (let y = 0; y < 128; y += 16) {
    const a = 1 - y / 128;
    g.fillStyle = `rgba(255,255,255,${(0.9 * a).toFixed(3)})`;
    g.fillRect(4, y, 8, 10);
  }
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

export class Competitor {
  /**
   * @param {object} o
   * @param {number} o.index      0 (P1) or 1 (P2)
   * @param {string} o.device     the controls (controls.js)
   * @param {string} o.character  playerFemale | playerMale
   * @param {string} [o.skin]     a SKIN_TONES key
   */
  constructor({ index, device, character, skin = "light", scene }) {
    this.index = index;
    this.team = TEAMS[index];
    this.device = device;
    this.character = character;
    this.scene = scene;
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);

    /* ---- Body ---- */
    this.avatar = new PlayerAvatar();
    this.avatar.root.name = `Versus${this.team.label}`;
    this.avatar.setSkinTone(skin);
    const stage = figureStage(3);
    this.avatar.setWear(stage.wear);
    this.avatar.setGear(stage.gear);
    scene.add(this.avatar.root);
    this.look = null;

    // The launcher on the shoulder (the model arrives with setModels).
    this.launcher = { rig: new THREE.Group(), muzzle: new THREE.Object3D(), recoil: 0 };
    this.launcher.rig.add(this.launcher.muzzle);
    this.launcher.muzzle.position.set(0, 0.02, -0.66);
    const standIn = new THREE.Mesh(own(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 12)), own(new THREE.MeshStandardMaterial({ color: 0x3d4a3a, metalness: 0.6, roughness: 0.5 })));
    standIn.rotation.x = Math.PI / 2;
    this.launcher.standIn = standIn;
    this.launcher.rig.add(standIn);
    this.avatar.shoulder.add(this.launcher.rig);

    // What the rival's spheres hit.
    this.hurt = new THREE.Mesh(own(new THREE.BoxGeometry(1, 1, 1)), own(new THREE.MeshBasicMaterial({ visible: false })));
    this.hurt.scale.set(0.95, 1.9, 0.85);
    this.hurt.position.y = 0.95;
    this.hurt.userData = { kind: "player", competitor: this, alive: true };
    this.avatar.root.add(this.hurt);

    /* ---- Identity: ring, aim line, tag ---- */
    const colour = new THREE.Color(this.team.colour);
    this.marker = new THREE.Group();
    this.marker.name = `VersusMarker${this.team.label}`;
    const glow = (opacity) => own(new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.ringMaterial = glow(0.9);
    const ring = new THREE.Mesh(own(new THREE.RingGeometry(0.58, 0.72, 48).rotateX(-Math.PI / 2)), this.ringMaterial);
    ring.position.y = 0.035;
    ring.renderOrder = 2;
    this.marker.add(ring);
    this.ring = ring;
    this.aimPivot = new THREE.Group();
    this.marker.add(this.aimPivot);
    const notchShape = new THREE.Shape([new THREE.Vector2(-0.2, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0, -0.32)]);
    const notch = new THREE.Mesh(own(new THREE.ShapeGeometry(notchShape).rotateX(-Math.PI / 2)), glow(0.95));
    notch.position.set(0, 0.04, -0.8);
    notch.renderOrder = 2;
    this.aimPivot.add(notch);
    this.aimTexture = own(aimTexture());
    this.aimMaterial = own(new THREE.MeshBasicMaterial({ color: colour, map: this.aimTexture, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    const lineGeometry = own(new THREE.PlaneGeometry(0.11, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5));
    this.aimLine = new THREE.Mesh(lineGeometry, this.aimMaterial);
    this.aimLine.position.set(0, 0.04, -1.15);
    this.aimLine.renderOrder = 2;
    this.aimPivot.add(this.aimLine);
    scene.add(this.marker);

    this.tagTexture = own(tagTexture(this.team));
    this.tag = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: this.tagTexture, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false })));
    this.tag.scale.set(1.5, 0.75, 1);
    this.tag.renderOrder = 10;
    this.tag.layers.set(TAG_LAYERS[index]);
    scene.add(this.tag);

    /* ---- Camera ---- */
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.05, 320);
    this.camera.layers.enable(TAG_LAYERS[1 - index]);
    scene.add(this.camera);
    this.cam = {
      vel: new THREE.Vector3(), look: new THREE.Vector3(), smoothedLook: new THREE.Vector3(), desired: new THREE.Vector3(),
      lean: new THREE.Vector3(), snap: true, trauma: 0, hutFade: 1,
    };

    /* ---- Tools and numbers ---- */
    this.arsenal = new Arsenal();
    this.arsenal.onInstant = (type, def) => {
      this.spheres = Math.min(MAX_SPHERES + 10, this.spheres + (def.spheres ?? 0));
      if (def.heal) this.integrity = MAX_INTEGRITY;
    };
    this.recovery = new AmmoRecovery();
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.dodgeDir = new THREE.Vector3();
    this.ladder = { h: 0, iced: 0, lastTap: 0, from: new THREE.Vector3(), t: 0 };
    this.stats = {
      kills: 0, lured: 0, rivalHits: 0, takedowns: 0, knockOffs: 0, overboard: 0, downs: 0,
      shots: 0, ladderTime: 0, damageDealt: 0, roundsWon: 0, roundKills: 0,
    };
    this.feed = [];
    this.spawn(new THREE.Vector3());
  }

  /** The models are in: the chosen Subject, and the launcher. */
  setModels(assets) {
    const body = assets.get(this.character);
    if (body) {
      this.avatar.setModel(body.template);
      const mesh = this.avatar.model?.getObjectByName("CharacterMerged");
      if (mesh) this.look = applyTeamLook(mesh, this.team.colour);
    }
    const launcher = assets.get("launcher");
    if (launcher && !this.launcher.model) {
      const model = launcher.template.clone(true);
      const length = Math.max(launcher.size.x, launcher.size.z);
      model.scale.setScalar(1.25 / length);
      model.rotation.y = Math.PI / 2;
      const box = new THREE.Box3().setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3()));
      this.launcher.model = model;
      this.launcher.rig.add(model);
      this.launcher.standIn.visible = false;
    }
  }

  /** Back on the roof: at a spawn point, facing north, full integrity. */
  spawn(at, { spheres = START_SPHERES, invulnerable = 0 } = {}) {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.vy = 0;
    this.yaw = 0;
    this.aimDir.set(0, 0, -1);
    this.aim.copy(at).add(_v.set(0, 1.15, -8));
    this.dodge = 0;
    this.dodgeCooldown = 0;
    this.invulnerable = invulnerable;
    this.stun = 0;
    this.frozen = 0;
    this.hitFlash = 0;
    this.integrity = MAX_INTEGRITY;
    this.spheres = Math.max(this.spheres ?? 0, spheres);
    this.fireCooldown = 0;
    this.state = "alive";
    this.respawnIn = 0;
    this.fall = 0;
    this.lastRivalHit = -99;
    this.wells = 0;
    this.ladder.h = 0;
    this.ladder.iced = 0;
    this.recovery.reset();
    this.avatar.root.rotation.set(0, 0, 0);
    this.avatar.hold = 1;
    this.avatar.reachUp = 0;
    this.avatar.setVisible(true);
    this.avatar.shadow.visible = true;
    this.hurt.userData.alive = true;
    this.cam.snap = true;
  }

  /** A new round: spawn, and the round's own counters cleared. */
  resetForRound(at) {
    this.spheres = 0;
    this.spawn(at, { spheres: START_SPHERES });
    this.arsenal.active.clear();
    this.arsenal.shieldCharges = 0;
    this.stats.roundKills = 0;
    this.feed.length = 0;
  }

  /** On the roof and in the fight (not falling, down, on the ladder or gone). */
  get onRoof() {
    return this.state === "alive";
  }

  /** Something the enemies would go for. */
  get targetable() {
    return this.state === "alive" || this.state === "ladder" || this.state === "leap";
  }

  get chest() {
    return _v.copy(this.position).setY(this.position.y + 1.15);
  }

  /** A line in this player's kill feed (hud.js shows the last few). */
  log(text, tone = "") {
    this.feed.push({ text, tone, t: performance.now() });
    if (this.feed.length > 5) this.feed.shift();
  }

  /** Mirror the state onto the body, the launcher, the ring and the tag. */
  present(dt, time, { aiming = false, speed = 0, height = 0, sliding = false, climbing = 0 } = {}) {
    const a = this.avatar;
    a.root.position.copy(this.position);
    if (this.state !== "falling") a.root.rotation.y = this.yaw;
    a.update(dt, { speed, lateralVel: 0, height, sliding, aiming, stumble: Math.min(1, this.stun * 2) });
    // The launcher: shouldered, or slung across the back for the ladder.
    const l = this.launcher;
    l.recoil = Math.max(0, l.recoil - dt * 7);
    if (a.hold > 0.5) {
      l.rig.position.set(-0.04, -0.07, -0.18 + l.recoil * 0.1);
      l.rig.rotation.set(l.recoil * 0.15, 0, 0);
    } else {
      l.rig.position.set(-0.3, -0.35, 0.2);
      l.rig.rotation.set(0, Math.PI / 2, 0.85);
    }
    // A hand-over-hand bob on the rungs.
    if (climbing > 0) a.body.position.y += Math.abs(Math.sin(time * 9)) * 0.06 * climbing;

    // The colours: rim, frost, flash; a blink while untouchable.
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    if (this.look) {
      this.look.uFrost.value += ((this.frozen > 0 ? 1 : 0) - this.look.uFrost.value) * Math.min(1, dt * 8);
      this.look.uFlash.value = this.hitFlash * 0.7;
      this.look.uTeamRim.value = 0.75 + Math.sin(time * 3 + this.index) * 0.1;
    }
    const blink = this.invulnerable > 0 && this.state === "alive" && Math.floor(time * 12) % 2 === 0;
    a.setVisible(this.state !== "gone" && !blink);

    const onDeck = this.state === "alive" || this.state === "down";
    this.marker.visible = onDeck && this.position.y > -0.5;
    this.marker.position.set(this.position.x, Math.max(0, this.position.y), this.position.z);
    this.ringMaterial.opacity = (this.state === "down" ? 0.35 : 0.85) + Math.sin(time * 5) * 0.08;
    const aimYaw = Math.atan2(-this.aimDir.x, -this.aimDir.z);
    this.aimPivot.rotation.y = aimYaw;
    const reach = THREE.MathUtils.clamp(_v.copy(this.aim).sub(this.position).setY(0).length() - 1.2, 0.5, 9);
    this.aimLine.scale.set(1, 1, reach);
    this.aimLine.visible = this.state === "alive";
    this.aimMaterial.opacity = aiming ? 0.75 : 0.42;

    this.tag.visible = this.state !== "gone" && this.state !== "out";
    this.tag.position.copy(this.position).setY(this.position.y + 2.55);
  }

  /** Where the launcher's muzzle is, in the world. */
  muzzle(target) {
    this.avatar.root.updateMatrixWorld(true);
    return this.launcher.muzzle.getWorldPosition(target);
  }

  /** The direction the body faces (for a dodge with no stick held). */
  forward(target) {
    return target.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  dispose() {
    this.scene.remove(this.avatar.root, this.marker, this.tag, this.camera);
    for (const x of this.owned) x.dispose?.();
    this.tag.material.dispose();
  }
}

