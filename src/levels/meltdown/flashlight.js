/**
 * The launcher's light - how the player sees in the blacked-out beat.
 *
 * Three parts, all created once when the level starts (so the scene's light
 * count never changes and no shader ever recompiles mid-run), and all at zero
 * until the level reports darkness:
 *
 *  - a spot light from the muzzle toward wherever the reticle points, so you
 *    look with the same hand you aim with;
 *  - a visible beam: an additive cone with a custom shader that scrolls
 *    world-space noise through it, so the smoke the beam passes through is
 *    what you actually see lit;
 *  - two point lights riding the newest balls in flight. A ball is a flare:
 *    fire one down the corridor and it lights the walls on the way, and
 *    lingers for a moment where it lands. Shooting ahead is scouting.
 */

import * as THREE from "../../three.js";

const BEAM_VERTEX = /* glsl */ `
  varying float vAlong;
  varying vec3 vWorld;
  varying float vFacing;
  uniform float uLength;
  void main() {
    vAlong = position.z / uLength;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 view = viewMatrix * world;
    vec3 n = normalize(normalMatrix * normal);
    // Faces seen side-on are the beam's soft edge; faces seen square-on
    // look through the most smoke.
    vFacing = abs(dot(n, normalize(-view.xyz)));
    gl_Position = projectionMatrix * view;
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying float vAlong;
  varying vec3 vWorld;
  varying float vFacing;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 p = vWorld * 0.55 + vec3(0.0, uTime * 0.35, uTime * 0.12);
    float smoke = noise(p) * 0.6 + noise(p * 2.3 + 4.0) * 0.4;
    float falloff = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.06, vAlong);
    float soft = pow(vFacing, 1.6);
    // Fade out close to the eye: in first person the camera sits right at
    // the beam's root, where the cone would otherwise fill the screen.
    float near = smoothstep(2.0, 7.0, distance(cameraPosition, vWorld));
    float a = uIntensity * falloff * soft * near * (0.35 + smoke * 0.9);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

export class LauncherLight {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [o]
   * @param {number} [o.range]    how far the beam reaches, metres
   * @param {number} [o.angle]    cone half-angle, radians
   */
  constructor(scene, { range = 36, angle = 0.42 } = {}) {
    this.scene = scene;
    this.range = range;
    this.angle = angle;
    this.power = 0;

    this.spot = new THREE.SpotLight(0xe6efff, 0, range, angle, 0.62, 1.2);
    this.spot.name = "LauncherBeam";
    scene.add(this.spot, this.spot.target);

    const length = range * 0.62;
    const geometry = new THREE.CylinderGeometry(0.035, Math.tan(angle) * length * 0.9, length, 28, 1, true);
    geometry.translate(0, -length / 2, 0);
    geometry.rotateX(-Math.PI / 2); // apex at the origin, opening down +Z
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uLength: { value: length }, uColor: { value: new THREE.Color(0xcfdcff) } },
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.cone = new THREE.Mesh(geometry, this.material);
    this.cone.name = "LauncherBeamCone";
    this.cone.frustumCulled = false;
    this.cone.renderOrder = 4;
    scene.add(this.cone);

    this.flares = [];
    for (let i = 0; i < 2; i += 1) {
      const light = new THREE.PointLight(0x9fe8ff, 0, 11, 1.6);
      light.name = `BallFlare_${i}`;
      scene.add(light);
      this.flares.push({ light, ball: null, linger: 0 });
    }
    this._dir = new THREE.Vector3();
  }

  /**
   * @param {number} dt
   * @param {object} s
   * @param {THREE.Vector3} s.origin   muzzle position, world
   * @param {THREE.Vector3} s.target   point the reticle is on, world
   * @param {number} s.darkness        0..1 from the level
   * @param {number} s.time
   * @param {import('./effects.js').Projectiles} [s.projectiles]
   */
  update(dt, { origin, target, darkness, time, projectiles }) {
    // Clicks on as the lights die, rather than fading with them.
    const want = darkness > 0.08 ? Math.min(1, 0.35 + darkness) : 0;
    this.power += (want - this.power) * Math.min(1, dt * (want > this.power ? 12 : 3));
    const p = this.power;

    this.spot.position.copy(origin);
    this.spot.target.position.copy(target);
    this.spot.target.updateMatrixWorld();
    // A faint flicker - a failed experiment's battery, not a torch.
    const flicker = 1 - (Math.sin(time * 37) > 0.97 ? 0.35 : 0) - Math.max(0, Math.sin(time * 1.7)) * 0.04;
    this.spot.intensity = 170 * p * flicker;

    this.cone.position.copy(origin);
    this.cone.lookAt(target);
    this.cone.visible = p > 0.01;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uIntensity.value = 0.34 * p * flicker;

    // Flares ride the newest balls; when a ball dies its flare holds for a
    // moment where it landed, then fades.
    const flareStrength = 0.25 + p * 0.75;
    if (projectiles) {
      const newest = projectiles.balls.filter((b) => b.active).sort((a, b) => a.life - b.life);
      for (const [i, flare] of this.flares.entries()) {
        const ball = newest[i];
        if (ball) {
          flare.ball = ball;
          flare.linger = 0.5;
          flare.light.position.copy(ball.mesh.position);
          flare.light.intensity = 9 * flareStrength * (darkness > 0.05 ? 1 : 0.25);
        } else if (flare.linger > 0) {
          flare.linger = Math.max(0, flare.linger - dt);
          flare.light.intensity *= Math.max(0, 1 - dt * 4);
        } else {
          flare.light.intensity = 0;
        }
      }
      projectiles.setGlow?.(0.35 + darkness * 1.6);
    }
  }

  /** Aim direction, normalised, for the level's flashlight query. */
  direction() {
    return this._dir.subVectors(this.spot.target.position, this.spot.position).normalize();
  }

  dispose() {
    this.scene.remove(this.spot, this.spot.target, this.cone);
    for (const f of this.flares) this.scene.remove(f.light);
    this.cone.geometry.dispose();
    this.material.dispose();
  }
}
