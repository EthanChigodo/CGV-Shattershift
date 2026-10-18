/** Rooftop-only shot: drag-limited fall; camera follows, brakes, then NEVER follows again. */
import * as THREE from "../../three.js";

export const ROOF_FALL = Object.freeze({
  confirmDepth: -0.65, gravity: 24, terminalSpeed: 32, weaponTerminalSpeed: 90,
  cameraSettle: 0.28, brakeStart: 2.0, cameraStop: 2.4,
  afterExitHold: 0.45, cinematicFov: 54,
});

/** A height test alone is insufficient: the missing floor must be an OUTER edge. */
export function exteriorFallEstablished(roof, position, vy, origin) {
  return origin === "exterior" && roof.groundAt(position) === null &&
    !!roof.exteriorAt(position) && position.y < ROOF_FALL.confirmDepth && vy < -1;
}

const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);

export class RoofFall {
  constructor({ position, velocity, vy, yaw, camera, normal, edge, weapon }) {
    this.time = 0;
    this.start = position.clone();
    this.position = position.clone();
    this.normal = normal.clone();
    this.tangent = new THREE.Vector3(-normal.z, 0, normal.x);
    this.edge = edge;
    this.yaw = yaw;
    this.vy = Math.min(-1, vy);
    this.velocity = normal.clone().multiplyScalar(Math.max(1.8, Math.min(4, velocity.dot(normal))));
    this.velocity.addScaledVector(this.tangent, THREE.MathUtils.clamp(velocity.dot(this.tangent), -2, 2));
    this.cameraStart = camera.position.clone();
    this.cameraPosition = camera.position.clone();
    this.lookStart = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(12).add(camera.position);
    this.look = this.lookStart.clone();
    this.cameraOffset = normal.clone().multiplyScalar(9).addScaledVector(this.tangent, 4.5);
    this.followPosition = position.clone().add(this.cameraOffset);
    this.followPosition.y = camera.position.y;
    this.focus = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.fov = camera.fov;
    this.cameraFov = camera.fov;
    // Projection only: no extra renderer or render pass. The live camera uses
    // the exact same transform, FOV and aspect when deciding the body has left.
    this.framingCamera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    this.probe = new THREE.Vector3();
    this.playerFrame = { top: Infinity, bottom: -Infinity, shown: false };
    this.weaponFrame = { top: Infinity, bottom: -Infinity, shown: false };
    this.exitTime = null;
    this.weaponExitTime = null;
    this.weaponStart = weapon?.position.clone() ?? position.clone().add(new THREE.Vector3(0.4, 1.4, 0));
    this.weaponPosition = this.weaponStart.clone();
    this.weaponRotation = weapon?.quaternion.clone() ?? new THREE.Quaternion();
    this.weaponQuaternion = this.weaponRotation.clone();
    this.weaponSpin = new THREE.Quaternion();
    this.weaponEuler = new THREE.Euler();
    this.weaponVelocity = this.velocity.clone().multiplyScalar(0.65).addScaledVector(this.tangent, 1.2);
    this.audio = 1;
    this.wind = 0.8;
    this.hidden = false;
    this.done = false;
  }

  applyCamera(camera) {
    camera.position.copy(this.cameraPosition);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    if (camera.fov !== this.cameraFov) {
      camera.fov = this.cameraFov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
  }

  _projectEnvelope(position, radius, centreY, frame) {
    frame.top = -Infinity;
    frame.bottom = Infinity;
    this.probe.set(position.x, position.y + centreY, position.z).project(this.framingCamera);
    let inView = Math.abs(this.probe.x) < 1 && Math.abs(this.probe.y) < 1 && this.probe.z > -1 && this.probe.z < 1;
    // Conservative bounds cover the laid-out body, GPU-rigged flailing and
    // the complete launcher. Do not hide an object whose feet alone are out.
    for (let x = -1; x <= 1; x += 2) for (let y = -1; y <= 1; y += 2) for (let z = -1; z <= 1; z += 2) {
      this.probe.set(position.x + x * radius, position.y + centreY + y * radius, position.z + z * radius).project(this.framingCamera);
      frame.top = Math.max(frame.top, this.probe.y);
      frame.bottom = Math.min(frame.bottom, this.probe.y);
      if (this.probe.y > -1 && this.probe.y < 1 && Math.abs(this.probe.x) < 1 && this.probe.z > -1 && this.probe.z < 1) inView = true;
    }
    frame.shown ||= inView;
  }

  update(dt, aspect = this.framingCamera.aspect) {
    if (this.done) return this;
    if (this.framingCamera.aspect !== aspect) {
      this.framingCamera.aspect = aspect;
      this.framingCamera.updateProjectionMatrix();
    }
    // Integrate the shot in small steps, so a slow render cannot skip braking.
    let remaining = Math.max(0, Math.min(dt, 0.1));
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 120);
      remaining -= step;
      this.time += step;
      const t = this.time;
      const drag = ROOF_FALL.terminalSpeed / ROOF_FALL.gravity;
      this.position.copy(this.start).addScaledVector(this.velocity, (1 - Math.exp(-t * 0.85)) / 0.85);
      this.position.y += -ROOF_FALL.terminalSpeed * t +
        (this.vy + ROOF_FALL.terminalSpeed) * drag * (1 - Math.exp(-t / drag));
      // Same gravity, less air resistance than the laid-out person. No mass-
      // dependent gravity, new weapon instance, projectile or collision rules.
      const weaponDrag = ROOF_FALL.weaponTerminalSpeed / ROOF_FALL.gravity;
      this.weaponPosition.copy(this.weaponStart).addScaledVector(this.weaponVelocity, (1 - Math.exp(-t * 0.35)) / 0.35);
      this.weaponPosition.y += -ROOF_FALL.weaponTerminalSpeed * t +
        (this.vy + ROOF_FALL.weaponTerminalSpeed) * weaponDrag * (1 - Math.exp(-t / weaponDrag));
      this.weaponSpin.setFromEuler(this.weaponEuler.set(t * 1.8, t * 0.7, -t * 0.45));
      this.weaponQuaternion.copy(this.weaponRotation).multiply(this.weaponSpin);

      if (t < ROOF_FALL.cameraStop) {
        // Speed goes continuously to zero; after cameraStop neither its position
        // nor its aim changes. This remains a SIDE view: never pan down after
        // the body, which must visibly cross the bottom of this fixed frame.
        const brake = 1 - smooth(ROOF_FALL.brakeStart, ROOF_FALL.cameraStop, t);
        this.desired.copy(this.position).add(this.cameraOffset);
        this.desired.y = this.position.y + 1;
        this.followPosition.lerp(this.desired, (1 - Math.exp(-step * 24)) * brake);
        const settle = smooth(0, ROOF_FALL.cameraSettle, t);
        this.cameraPosition.lerpVectors(this.cameraStart, this.followPosition, settle);
        // At roof height the camera may still be above the slab. Below it the
        // complete camera path must be outside the solid tower, not through it.
        if (this.cameraPosition.y < 0.4) {
          const clearance = this.cameraPosition.dot(this.normal);
          this.cameraPosition.addScaledVector(this.normal, Math.max(0, this.edge + 2.5 - clearance));
        }
        this.focus.copy(this.position).addScaledVector(this.normal, -0.6);
        this.focus.y += 0.9;
        this.look.lerpVectors(this.lookStart, this.focus, settle);
      }
      this.cameraFov = THREE.MathUtils.lerp(this.fov, ROOF_FALL.cinematicFov, smooth(0, ROOF_FALL.cameraSettle, t));
      this.applyCamera(this.framingCamera);
      this._projectEnvelope(this.position, 1.8, 0.9, this.playerFrame);
      this._projectEnvelope(this.weaponPosition, 0.9, 0, this.weaponFrame);
      if (this.weaponExitTime === null && this.weaponFrame.shown && this.weaponFrame.top < -1.05) this.weaponExitTime = t;
      if (this.exitTime === null && t >= ROOF_FALL.cameraStop && this.playerFrame.shown && this.playerFrame.top < -1.05) this.exitTime = t;
      const afterExit = this.exitTime === null ? 0 : t - this.exitTime;
      const distance = this.cameraPosition.distanceTo(this.position);
      const recede = t > ROOF_FALL.cameraStop ? 1 / (1 + Math.pow(Math.max(0, distance - 20) / 24, 2)) : 1;
      const ending = this.exitTime === null ? 1 : 1 - smooth(0, ROOF_FALL.afterExitHold, afterExit);
      this.audio = recede * ending;
      this.wind = (0.8 + 0.2 * smooth(0, 1, t)) * ending;
      this.hidden = this.exitTime !== null;
      // The host reveals its existing results OVER this live view. Only audio
      // fades during the hold; black would obscure the facade and imply a load.
      this.done = this.exitTime !== null && afterExit >= ROOF_FALL.afterExitHold;
      if (this.done) break;
    }
    return this;
  }
}
