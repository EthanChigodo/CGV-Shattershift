/**
 * Sparks: a pooled particle shower for brake clamps grinding on the rails.
 *
 * A fixed pool; each spark is a position, a velocity and a remaining life,
 * simulated on the CPU (a few hundred at most). Each is drawn twice: a
 * streak (a line from where it is back along its velocity - what the eye
 * sees of a fast, hot particle) and a small glowing head. Both cool from
 * white to orange and fade. Additive blending, so a shower of them lights
 * up the frame.
 *
 *   const sparks = new Sparks(400);
 *   scene.add(sparks.points);
 *   sparks.emit(position, count, { up, spread, speed });
 *   sparks.update(dt);
 */

import * as THREE from "../three.js";

const _v = new THREE.Vector3();

export class Sparks {
  constructor(max = 400) {
    this.max = max;
    this.position = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.velocity = new Float32Array(max * 3);
    this.next = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    this.heat = new Float32Array(max);
    geometry.setAttribute("aHeat", new THREE.BufferAttribute(this.heat, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = geometry;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute float aHeat;
        uniform float uScale;
        varying float vHeat;
        void main() {
          vHeat = aHeat;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aHeat <= 0.0 ? 0.0 : (0.012 + 0.03 * aHeat) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vHeat;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float core = smoothstep(1.0, 0.0, d);
          vec3 hot = vec3(1.0, 0.95, 0.8);
          vec3 cool = vec3(1.0, 0.35, 0.05);
          vec3 col = mix(cool, hot, vHeat * vHeat) * (1.5 + 2.5 * vHeat);
          gl_FragColor = vec4(col * core * vHeat, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const heads = new THREE.Points(geometry, this.material);
    heads.frustumCulled = false;

    // Streaks: two vertices per spark, head and tail.
    this.trail = new Float32Array(max * 6);
    this.trailColor = new Float32Array(max * 6);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(this.trail, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeometry.setAttribute("color", new THREE.BufferAttribute(this.trailColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeometry = trailGeometry;
    this.trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const streaks = new THREE.LineSegments(trailGeometry, this.trailMaterial);
    streaks.frustumCulled = false;

    this.points = new THREE.Group();
    this.points.name = "Sparks";
    this.points.add(streaks, heads);
  }

  /**
   * @param {THREE.Vector3} origin  world position
   * @param {number} count
   * @param {object} [o]
   * @param {THREE.Vector3} [o.direction]  main direction (world), default down
   * @param {number} [o.spread]  0..1 cone spread
   * @param {number} [o.speed]
   */
  emit(origin, count, { direction = _down, spread = 0.6, speed = 6 } = {}) {
    for (let n = 0; n < count; n += 1) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.position[i * 3] = origin.x + (Math.random() - 0.5) * 0.1;
      this.position[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.1;
      this.position[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.1;
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * spread).add(direction).normalize();
      const v = speed * (0.5 + Math.random());
      this.velocity[i * 3] = _v.x * v;
      this.velocity[i * 3 + 1] = _v.y * v;
      this.velocity[i * 3 + 2] = _v.z * v;
      const life = 0.35 + Math.random() * 0.6;
      this.life[i] = life;
      this.maxLife[i] = life;
    }
  }

  update(dt) {
    const p = this.position;
    const v = this.velocity;
    for (let i = 0; i < this.max; i += 1) {
      if (this.life[i] <= 0) {
        this.heat[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      v[i * 3 + 1] -= 9.8 * dt;
      const drag = 1 - 1.2 * dt;
      v[i * 3] *= drag;
      v[i * 3 + 2] *= drag;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const heat = Math.max(0, this.life[i] / this.maxLife[i]);
      this.heat[i] = heat;
    }
    // Streaks: head at the spark, tail back along its velocity (~40 ms).
    const tr = this.trail;
    const tc = this.trailColor;
    for (let i = 0; i < this.max; i += 1) {
      const h = this.heat[i];
      const j = i * 6;
      tr[j] = p[i * 3];
      tr[j + 1] = p[i * 3 + 1];
      tr[j + 2] = p[i * 3 + 2];
      tr[j + 3] = p[i * 3] - v[i * 3] * 0.04;
      tr[j + 4] = p[i * 3 + 1] - v[i * 3 + 1] * 0.04;
      tr[j + 5] = p[i * 3 + 2] - v[i * 3 + 2] * 0.04;
      // White-hot head, orange tail; black (invisible, additive) when dead.
      tc[j] = h * 1.8;
      tc[j + 1] = h * (0.55 + 0.5 * h);
      tc[j + 2] = h * h * 0.25;
      tc[j + 3] = h * 0.9;
      tc[j + 4] = h * 0.25;
      tc[j + 5] = 0;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aHeat.needsUpdate = true;
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.attributes.color.needsUpdate = true;
  }

  /** Pixel scale for point sizes: call when the viewport height changes. */
  setViewportHeight(h) {
    this.material.uniforms.uScale.value = h * 0.6;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
  }
}

const _down = new THREE.Vector3(0, -1, 0);
