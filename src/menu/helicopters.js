/**
 * Police helicopters over the burning tower (the model and its bake come
 * from src/fx/police-helicopters.js; this file only flies them).
 *
 *  - One circles the tower at the height of the fire, its searchlight
 *    walking the burning floors and now and then dropping to the streets.
 *  - One patrols wide, between our roof and the tower. Every half minute or
 *    so its light comes across our roof - over the puddles, over Subject 07
 *    - and moves on. A real spot light rides with that beam, so the figure
 *    and the wet roof are actually lit by it (its intensity is zero the
 *    rest of the time: the light count never changes, nothing recompiles).
 *
 * The beams are cones with a soft shader: brightest along the axis where
 * you look through the most lit air, soft at the edges (Fresnel), dimmer
 * with distance from the lamp, dust drifting through them, and fading into
 * the haze like everything else.
 */

import * as THREE from "../three.js";
import { loadTemplate } from "../fx/police-helicopters.js";
import { HAZE_GLSL, hazeMaterial } from "./atmosphere.js";
import { glowTexture } from "./fire.js";

const BEAM_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlong;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vAlong = uv.y; // 1 at the lamp, 0 at the far end
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uLength;
  uniform float uTime;
  uniform sampler2D uNoise;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlong;
  ${HAZE_GLSL}
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), V));
    float core = pow(facing, 3.5);
    float dist = (1.0 - vAlong) * uLength;
    float fall = 1.0 / (1.0 + dist * 0.025) * smoothstep(0.0, 0.08, vAlong);
    // Dust and smoke drifting through the light.
    vec2 q = vWorld.xz * 0.02 + vWorld.y * 0.013 + vec2(uTime * 0.02, -uTime * 0.015);
    float dust = 0.55 + 0.75 * texture2D(uNoise, q).r * texture2D(uNoise, q * 3.1 + 0.5).a * 2.0;
    float a = core * fall * dust * uOpacity;
    a *= 1.0 - hazeAmount(cameraPosition, vWorld) * 0.8;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RED = new THREE.Color(5, 0.35, 0.25);
const BLUE = new THREE.Color(0.4, 0.9, 6);

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export class MenuHelicopters {
  /**
   * @param {object} o
   * @param {object} o.haze
   * @param {THREE.Texture} o.noise
   * @param {THREE.Vector3} o.tower      the tower's base centre
   * @param {THREE.Vector3} o.fire       the fire's centre
   * @param {THREE.Vector3} o.subject    where Subject 07 stands
   */
  constructor({ haze, noise, tower, fire, subject, quality = "medium" }) {
    this.root = new THREE.Group();
    this.root.name = "MenuHelicopters";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    this.haze = haze;
    this.tower = tower.clone();
    this.fire = fire.clone();
    this.subject = subject.clone();
    this.glow = own(glowTexture(64));

    const beamGeo = own(new THREE.CylinderGeometry(0.12, 1, 1, 32, 1, true));
    beamGeo.translate(0, -0.5, 0);
    beamGeo.rotateX(-Math.PI / 2); // apex at the origin, opening down -Z (lookAt aims it)
    const poolGeo = own(new THREE.CircleGeometry(1, 32));
    poolGeo.rotateX(-Math.PI / 2);

    this.craft = [];
    for (let i = 0; i < 2; i += 1) {
      const holder = new THREE.Group();
      const mount = new THREE.Group();
      holder.add(mount);
      const lights = [];
      for (const [x, y, z, colour, size] of [[-1.3, 1.1, 0.4, RED, 2.2], [1.3, 1.1, 0.4, BLUE, 2.2], [0, 0.25, 2.4, RED, 2.6], [0, 3.4, 4.8, BLUE, 2.4], [0, 1.9, 6.6, new THREE.Color(4, 4, 4), 1.6]]) {
        const m = own(new THREE.SpriteMaterial({ map: this.glow, color: colour.clone(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
        const sprite = new THREE.Sprite(m);
        sprite.position.set(x, y, z);
        sprite.scale.setScalar(size);
        holder.add(sprite);
        lights.push({ sprite, colour, size });
      }
      const lampMat = own(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(6, 6.5, 7), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      const lamp = new THREE.Sprite(lampMat);
      lamp.scale.setScalar(4);
      lamp.position.set(0, 0.15, -3.8);
      holder.add(lamp);
      const beamUniforms = {
        ...haze,
        uColor: { value: new THREE.Color(0.9, 0.95, 1.08) },
        uOpacity: { value: i === 0 ? 0.05 : 0.055 },
        uLength: { value: 100 },
        uTime: { value: 0 },
        uNoise: { value: noise },
      };
      const beam = new THREE.Mesh(beamGeo, own(new THREE.ShaderMaterial({
        uniforms: beamUniforms,
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })));
      beam.frustumCulled = false;
      beam.renderOrder = 8;
      const poolMat = own(new THREE.MeshBasicMaterial({ map: this.glow, color: new THREE.Color(0.9, 0.95, 1.1), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.renderOrder = 3;
      this.root.add(holder, beam, pool);
      this.craft.push({
        i, holder, mount, lights, lamp, beam, beamUniforms, pool,
        aim: new THREE.Vector3(), target: new THREE.Vector3(), lampAt: new THREE.Vector3(),
        mainHub: null, tailHub: null, snapped: false,
      });
    }

    // The light that rides the patrol's beam across our roof.
    this.spot = new THREE.SpotLight(0xe6eeff, 0, 0, 0.06, 0.7, 0);
    this.spot.castShadow = quality === "high";
    this.spot.shadow.mapSize.set(512, 512);
    this.spot.shadow.camera.near = 20;
    this.spot.shadow.camera.far = 400;
    this.spot.shadow.bias = -0.0004;
    this.root.add(this.spot, this.spot.target);
    this.sweepAt = 9; // seconds until the next pass over the roof (the first one early)
    this.sweep = null;
    /** 0..1: how much the searchlight is on Subject 07 right now. */
    this.onSubject = 0;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  async load(assetBase, manager) {
    const template = await loadTemplate(assetBase, manager);
    if (!template) return;
    const hazed = new Map();
    for (const c of this.craft) {
      if (c.model) continue;
      const model = template.clone(true);
      model.traverse((o) => {
        if (!o.isMesh) return;
        if (!hazed.has(o.material)) {
          const m = o.material.clone();
          this.owned.push(m);
          hazeMaterial(m, this.haze, "Heli");
          hazed.set(o.material, m);
        }
        o.material = hazed.get(o.material);
      });
      c.mainHub = model.getObjectByName("MainHub");
      c.tailHub = model.getObjectByName("TailHub");
      c.mount.add(model);
      c.model = model;
    }
  }

  /** Where each craft is at time t (both paths are closed loops). */
  _path(c, t, out) {
    if (c.i === 0) {
      // Round the tower at the fire's height, slowly.
      const a = t * 0.055 + 1.2;
      out.set(this.tower.x + Math.cos(a) * 150, this.fire.y + 12 + Math.sin(t * 0.21) * 6, this.tower.z + Math.sin(a) * 150);
    } else {
      // A long loop between our roof and the tower, low over the roofs.
      const a = t * 0.075 + 4.0;
      const mid = this._v.copy(this.subject).lerp(this.tower, 0.42);
      out.set(mid.x - 40 + Math.cos(a) * 190, 70 + Math.sin(a * 2.0) * 14, mid.z + Math.sin(a) * 105);
    }
    return out;
  }

  update(dt, time, { reducedMotion = false } = {}) {
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    for (const c of this.craft) {
      this._path(c, time, p);
      this._path(c, time + 0.6, ahead);
      const h = c.holder;
      h.position.copy(p);
      // Nose (-Z) along the path, banked into the turn.
      const dir = ahead.sub(p);
      const heading = Math.atan2(-dir.x, -dir.z);
      const turn = THREE.MathUtils.euclideanModulo((heading - (c.heading ?? heading)) + Math.PI, Math.PI * 2) - Math.PI;
      c.heading = heading;
      c.bank = THREE.MathUtils.lerp(c.bank ?? 0, THREE.MathUtils.clamp(turn / Math.max(dt, 1e-3) * 0.35, -0.35, 0.35), Math.min(1, dt * 2));
      h.rotation.set(0, heading, 0);
      h.rotateZ(c.bank);
      h.rotateX(-0.08);
      if (c.mainHub) c.mainHub.rotation.y += dt * 36;
      if (c.tailHub) c.tailHub.rotation.x += dt * 70;
      const beat = (time * 1.8 + c.i * 0.41) % 1;
      const redOn = beat < 0.1 || (beat > 0.18 && beat < 0.28);
      const blueOn = (beat > 0.5 && beat < 0.6) || (beat > 0.68 && beat < 0.78);
      const strobe = (time * 0.9 + c.i * 0.3) % 1 < 0.06;
      c.lights.forEach((l, j) => {
        const on = j === 4 ? strobe : l.colour === RED ? redOn : blueOn;
        l.sprite.material.opacity = on ? 1 : 0.04;
        l.sprite.scale.setScalar(on ? l.size * 1.6 : l.size * 0.6);
      });
    }

    // ---- The searchlights ----
    // The orbiting one walks the burning floors, now and then the streets.
    const a = this.craft[0];
    const t0 = time * 0.23;
    const streets = Math.sin(time * 0.05) > 0.7;
    if (streets) a.target.set(this.tower.x + Math.sin(t0) * 120, -96, this.tower.z + 120 + Math.cos(t0 * 0.7) * 80);
    else a.target.set(this.fire.x + Math.sin(t0) * 18, this.fire.y - 8 + Math.sin(t0 * 1.7) * 10, this.fire.z + Math.cos(t0) * 18);

    // The patrol searches the street and the roofs across from the tower;
    // every so often it comes over ours.
    const b = this.craft[1];
    this.sweepAt -= dt;
    if (!this.sweep && this.sweepAt <= 0) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.sweep = { t: 0, length: reducedMotion ? 9 : 7, side };
      this.sweepAt = 26 + Math.random() * 14;
    }
    let onRoof = 0;
    if (this.sweep) {
      const s = this.sweep;
      s.t += dt;
      const k = s.t / s.length;
      if (k >= 1) this.sweep = null;
      else {
        // Across the roof on a slant, through where Subject 07 stands.
        const u = smooth(k) * 2 - 1;
        b.target.set(this.subject.x + u * 13 * s.side, 0, this.subject.z + u * 6 - 1.5);
        onRoof = Math.sin(Math.PI * k);
      }
    }
    if (!onRoof) {
      const t1 = time * 0.17;
      b.target.set(this.subject.x - 60 + Math.sin(t1) * 90, -96 + Math.max(0, Math.sin(t1 * 1.3)) * 70, this.subject.z - 120 + Math.cos(t1 * 0.8) * 70);
    }
    this.onSubject = 0;
    for (const c of this.craft) {
      // The light lags its target like a hand-held lamp does.
      if (!c.snapped) { c.aim.copy(c.target); c.snapped = true; }
      c.aim.lerp(c.target, Math.min(1, dt * (c === b && onRoof ? 3.5 : 1.1)));
      c.lamp.getWorldPosition(c.lampAt);
      const length = c.lampAt.distanceTo(c.aim);
      c.beam.position.copy(c.lampAt);
      c.beam.lookAt(c.aim);
      // ~5 degrees half-angle: a pool 2 m across at 25 m, 9 m at 100 m.
      const spread = Math.tan(0.045) * length;
      c.beam.scale.set(spread, spread, length);
      c.beamUniforms.uLength.value = length;
      c.beamUniforms.uTime.value = time;
      c.pool.position.copy(c.aim).setY(c.aim.y + 0.06);
      c.pool.scale.setScalar(spread * 1.25);
      c.pool.material.opacity = c === b && onRoof ? 0.0 : 0.22;
    }
    // The spot light rides the patrol's beam while it's on our roof.
    this.spot.position.copy(b.lampAt);
    this.spot.target.position.copy(b.aim);
    this.spot.angle = 0.06;
    this.spot.intensity = onRoof * 28;
    const d = this._v.copy(b.aim).sub(this.subject).setY(0).length();
    this.onSubject = onRoof * THREE.MathUtils.clamp(1 - d / 4, 0, 1);
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
