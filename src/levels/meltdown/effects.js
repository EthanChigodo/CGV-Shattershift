/**
 * Physical feedback for Level 3: launcher balls and breakage debris.
 *
 * Projectiles are real bodies, not instant rays. Each ball is pooled, flies
 * under gravity, sweeps a ray along its path every frame (so it cannot tunnel
 * through a thin pane at 70 m/s), bounces off solid hazards and the floor,
 * and reports what it hit. Glass it hits breaks.
 *
 * Debris is what breaking looks like: pooled shards with velocity, spin,
 * gravity, floor bounce and friction; spark bursts; dust puffs. Everything is
 * allocated once up front and recycled, so a big shatter costs no garbage -
 * and shards are drawn as one InstancedMesh per material, so a 70-shard pane
 * costs one draw call, not seventy (it used to spike the frame on every
 * big break).
 */

import * as THREE from "../../three.js";

const GRAVITY = -16;
const FLOOR_Y = 0;

/* ------------------------------------------------------------------ */
/* Projectiles                                                          */
/* ------------------------------------------------------------------ */

export class Projectiles {
  constructor(scene, { count = 28 } = {}) {
    this.scene = scene;
    this.geometry = new THREE.SphereGeometry(0.13, 14, 10);
    this.material = new THREE.MeshStandardMaterial({ color: 0xc9d2d6, metalness: 0.95, roughness: 0.18, emissive: 0x6a9aa8, emissiveIntensity: 0.35 });
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.balls = [];
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      const glow = new THREE.Mesh(this.geometry, this.glowMaterial);
      glow.scale.setScalar(2.2);
      mesh.add(glow);
      mesh.visible = false;
      scene.add(mesh);
      this.balls.push({ mesh, velocity: new THREE.Vector3(), life: 0, active: false, bounces: 0, power: 1 });
    }
    this._ray = new THREE.Raycaster();
    this._dir = new THREE.Vector3();
    this._next = new THREE.Vector3();
    this._normal = new THREE.Vector3();
  }

  /** Brightness of the balls' glow: raised in the dark, where balls are flares. */
  setGlow(value) {
    this.material.emissiveIntensity = 0.35 * value;
    this.glowMaterial.opacity = Math.min(0.9, 0.35 * value);
  }

  fire(origin, direction, speed = 70, { power = 1, inherit } = {}) {
    const ball = this.balls.find((b) => !b.active) ?? this.balls.reduce((a, b) => (a.life > b.life ? a : b));
    ball.active = true;
    ball.life = 0;
    ball.bounces = 0;
    ball.power = power;
    ball.mesh.position.copy(origin);
    ball.velocity.copy(direction).normalize().multiplyScalar(speed);
    if (inherit) ball.velocity.add(inherit);
    ball.mesh.visible = true;
    return ball;
  }

  /**
   * @param {number} dt
   * @param {{breakables: THREE.Object3D[], solids: THREE.Object3D[], onBreakable: Function, onSolid: Function}} world
   */
  update(dt, { breakables, solids, onBreakable, onSolid, onFloor }) {
    for (const ball of this.balls) {
      if (!ball.active) continue;
      ball.life += dt;
      if (ball.life > 2.6) {
        ball.active = false;
        ball.mesh.visible = false;
        continue;
      }

      ball.velocity.y += GRAVITY * dt;
      const p = ball.mesh.position;
      this._next.copy(ball.velocity).multiplyScalar(dt);
      const travel = this._next.length();
      if (travel < 1e-5) continue;
      this._dir.copy(this._next).divideScalar(travel);
      this._ray.set(p, this._dir);
      this._ray.far = travel + 0.13;

      // Breakables first. Glass panes also have an invisible collider a
      // few cm in front of them; that one is ignored so the ball reaches
      // the glass rather than bouncing off an unseen box.
      const hitB = this._ray.intersectObjects(breakables, false)[0];
      const hitS = this._ray.intersectObjects(solids, false).find((h) => !h.object.userData.glass && !h.object.userData.disabled);

      if (hitB && (!hitS || hitB.distance <= hitS.distance)) {
        p.copy(hitB.point);
        const consumed = onBreakable?.(hitB.object, hitB.point, ball) !== false;
        if (consumed) {
          ball.active = false;
          ball.mesh.visible = false;
          continue;
        }
      } else if (hitS) {
        // Bounce off solid hazards with most of the energy gone.
        p.copy(hitS.point).addScaledVector(this._dir, -0.14);
        this._normal.copy(hitS.face?.normal ?? this._dir.clone().negate()).transformDirection(hitS.object.matrixWorld);
        ball.velocity.reflect(this._normal).multiplyScalar(0.38);
        ball.bounces += 1;
        onSolid?.(hitS.object, hitS.point, ball);
        if (ball.bounces > 3) {
          ball.active = false;
          ball.mesh.visible = false;
        }
        continue;
      }

      p.add(this._next);
      if (p.y < FLOOR_Y + 0.13 && ball.velocity.y < 0) {
        p.y = FLOOR_Y + 0.13;
        if (Math.abs(ball.velocity.y) > 2) onFloor?.(p, ball);
        ball.velocity.y *= -0.45;
        ball.velocity.x *= 0.8;
        ball.velocity.z *= 0.8;
      }
    }
  }

  clear() {
    for (const b of this.balls) {
      b.active = false;
      b.mesh.visible = false;
    }
  }

  dispose() {
    for (const b of this.balls) this.scene.remove(b.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Debris                                                               */
/* ------------------------------------------------------------------ */

function shardGeometry() {
  // A thin irregular triangle prism - reads as a glass or concrete shard.
  const g = new THREE.BufferGeometry();
  const t = 0.02;
  const v = [
    [-0.5, -0.4], [0.55, -0.25], [0.05, 0.6],
  ];
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const f = v.map(([x, y]) => [x, y, t]);
  const b = v.map(([x, y]) => [x, y, -t]);
  tri(f[0], f[1], f[2]);
  tri(b[0], b[2], b[1]);
  for (let i = 0; i < 3; i += 1) {
    const j = (i + 1) % 3;
    tri(f[i], b[i], b[j]);
    tri(f[i], b[j], f[j]);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const DEBRIS_MATERIALS = {
  glass: () => new THREE.MeshStandardMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.7, emissive: 0x2a8aa0, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.05, side: THREE.DoubleSide }),
  sack: () => new THREE.MeshStandardMaterial({ color: 0x8ef6c8, transparent: true, opacity: 0.75, emissive: 0x1f7a52, emissiveIntensity: 1.2, side: THREE.DoubleSide }),
  concrete: () => new THREE.MeshStandardMaterial({ color: 0x57524b, roughness: 0.95, side: THREE.DoubleSide }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0x8a918d, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }),
  power: () => new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  ball: () => new THREE.MeshStandardMaterial({ color: 0xc9d2d6, metalness: 0.95, roughness: 0.2 }),
};

export class Debris {
  constructor(scene, { shards = 260, sparks = 240, dust = 12, smokeTexture = null } = {}) {
    this.scene = scene;
    this.shardGeo = shardGeometry();
    this.ballGeo = new THREE.SphereGeometry(0.12, 10, 8);
    this.materials = Object.fromEntries(Object.entries(DEBRIS_MATERIALS).map(([k, f]) => [k, f()]));

    // One instanced mesh per material; pieces are plain state, written into
    // whichever mesh their kind uses each frame.
    this.batches = {};
    for (const [kind, material] of Object.entries(this.materials)) {
      const batch = new THREE.InstancedMesh(kind === "ball" ? this.ballGeo : this.shardGeo, material, shards);
      batch.name = `Debris_${kind}`;
      batch.count = 0;
      batch.frustumCulled = false;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(batch);
      this.batches[kind] = batch;
    }
    this.pieces = [];
    for (let i = 0; i < shards; i += 1) {
      this.pieces.push({
        kind: "glass", position: new THREE.Vector3(), rotation: new THREE.Euler(), scale: 1,
        v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, size: 1, active: false, rest: false,
      });
    }
    this._matrix = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._scale = new THREE.Vector3();

    // Sparks: one Points object, per-particle state in typed arrays.
    this.sparkCount = sparks;
    this.sparkPos = new Float32Array(sparks * 3);
    this.sparkVel = new Float32Array(sparks * 3);
    this.sparkLife = new Float32Array(sparks);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkPoints = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffc070, size: 0.09, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparkPoints.frustumCulled = false;
    scene.add(this.sparkPoints);
    this._sparkCursor = 0;
    for (let i = 0; i < sparks; i += 1) this.sparkPos[i * 3 + 1] = -999;

    // Dust puffs: a few billboards that swell and fade.
    this.puffs = [];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(160,150,140,0.8)");
    grad.addColorStop(1, "rgba(160,150,140,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this.dustTexture = smokeTexture ?? new THREE.CanvasTexture(canvas);
    for (let i = 0; i < dust; i += 1) {
      const material = new THREE.SpriteMaterial({ map: this.dustTexture, color: 0x8a8278, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, life: 0, max: 1, active: false, grow: 1 });
    }
  }

  /**
   * Throw shards out of a point or across an area.
   * @param {THREE.Vector3} position
   * @param {object} o
   * @param {string} [o.kind] glass | sack | concrete | metal | power | ball
   * @param {number[]} [o.area] [w, h] spread shards over a pane-sized area
   * @param {THREE.Vector3} [o.push] bias velocity (e.g. the ball's direction)
   */
  burst(position, { kind = "glass", count = 24, speed = 5, size = 0.28, area = null, right = null, push = null, up = 3 } = {}) {
    if (!this.batches[kind]) kind = "glass";
    let spawned = 0;
    for (const piece of this.pieces) {
      if (spawned >= count) break;
      if (piece.active) continue;
      piece.active = true;
      piece.kind = kind;
      piece.rest = false;
      piece.life = 0;
      piece.max = 1.8 + Math.random() * 1.4;
      piece.size = kind === "ball" ? 1 : size * (0.4 + Math.random() * 1.1);
      piece.scale = piece.size;
      const p = piece.position.copy(position);
      if (area) {
        // Spread across the pane: along its `right` axis (the route's
        // lateral direction there) and up its height.
        const across = (Math.random() - 0.5) * area[0];
        if (right) p.addScaledVector(right, across);
        else p.x += across;
        p.y += (Math.random() - 0.5) * area[1];
      }
      piece.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      piece.v.set((Math.random() - 0.5) * 2, Math.random() * 0.8 + 0.2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      piece.v.y += up * Math.random();
      if (push) piece.v.addScaledVector(push, 0.3 + Math.random() * 0.5);
      piece.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      spawned += 1;
    }
    return spawned;
  }

  sparks(position, { count = 24, speed = 7 } = {}) {
    for (let n = 0; n < count; n += 1) {
      const i = this._sparkCursor;
      this._sparkCursor = (this._sparkCursor + 1) % this.sparkCount;
      this.sparkPos[i * 3] = position.x;
      this.sparkPos[i * 3 + 1] = position.y;
      this.sparkPos[i * 3 + 2] = position.z;
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.2 - 0.2;
      const s = speed * (0.3 + Math.random());
      this.sparkVel[i * 3] = Math.cos(a) * Math.cos(e) * s;
      this.sparkVel[i * 3 + 1] = Math.sin(e) * s + 2;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * s;
      this.sparkLife[i] = 0.35 + Math.random() * 0.5;
    }
  }

  dust(position, { size = 4, life = 1.6, color = 0x8a8278 } = {}) {
    const puff = this.puffs.find((p) => !p.active) ?? this.puffs[0];
    puff.active = true;
    puff.life = 0;
    puff.max = life;
    puff.grow = size;
    puff.sprite.material.color.set(color);
    puff.sprite.position.copy(position);
    puff.sprite.visible = true;
  }

  update(dt) {
    for (const batch of Object.values(this.batches)) batch.count = 0;
    for (const piece of this.pieces) {
      if (!piece.active) continue;
      piece.life += dt;
      if (piece.life > piece.max) {
        piece.active = false;
        continue;
      }
      const p = piece.position;
      if (!piece.rest) {
        piece.v.y += GRAVITY * dt;
        p.addScaledVector(piece.v, dt);
        piece.rotation.x += piece.spin.x * dt;
        piece.rotation.y += piece.spin.y * dt;
        piece.rotation.z += piece.spin.z * dt;
        if (p.y < FLOOR_Y + 0.03) {
          p.y = FLOOR_Y + 0.03;
          piece.v.y *= -0.3;
          piece.v.x *= 0.55;
          piece.v.z *= 0.55;
          piece.spin.multiplyScalar(0.5);
          if (Math.abs(piece.v.y) < 0.6) {
            piece.rest = true;
            piece.rotation.x = Math.PI / 2;
          }
        }
      }
      const fade = piece.max - piece.life;
      const scale = fade < 0.4 ? Math.max(0.001, (fade / 0.4) * piece.size) : piece.size;
      const batch = this.batches[piece.kind];
      this._quat.setFromEuler(piece.rotation);
      this._matrix.compose(p, this._quat, this._scale.setScalar(scale));
      batch.setMatrixAt(batch.count, this._matrix);
      batch.count += 1;
    }
    for (const batch of Object.values(this.batches)) if (batch.count) batch.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.sparkCount; i += 1) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[i * 3 + 1] = -999;
        continue;
      }
      this.sparkVel[i * 3 + 1] += GRAVITY * 0.6 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkPos[i * 3 + 1] < 0.02) {
        this.sparkPos[i * 3 + 1] = 0.02;
        this.sparkVel[i * 3 + 1] *= -0.4;
      }
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;

    for (const puff of this.puffs) {
      if (!puff.active) continue;
      puff.life += dt;
      const t = puff.life / puff.max;
      if (t >= 1) {
        puff.active = false;
        puff.sprite.visible = false;
        continue;
      }
      puff.sprite.scale.setScalar(puff.grow * (0.4 + t));
      puff.sprite.material.opacity = 0.55 * (1 - t);
      puff.sprite.position.y += dt * 0.6;
    }
  }

  clear() {
    for (const p of this.pieces) p.active = false;
    for (const batch of Object.values(this.batches)) batch.count = 0;
    this.sparkLife.fill(0);
    for (let i = 0; i < this.sparkCount; i += 1) this.sparkPos[i * 3 + 1] = -999;
    for (const p of this.puffs) {
      p.active = false;
      p.sprite.visible = false;
    }
  }
}
