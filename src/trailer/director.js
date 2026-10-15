/**
 * Trailer mode: the game as a film set.
 *
 * Off unless the page is opened with `?trailer`. Then:
 *
 *   `        clean frame: every bit of UI hidden, letterbox bars on
 *   , .      previous / next camera shot (below)
 *   - =      slower / faster time (1, 0.5, 0.25, 0.1)
 *   /        autopilot on/off (it dodges and shoots for you)
 *   ;        god mode on/off (you can't die)
 *
 * The camera shots frame the player from outside the game's own camera, so
 * one run gives a dozen different angles:
 *
 *   game     the game's own camera
 *   front    ahead of you, looking back as you run at it
 *   low      behind, at ankle height, tilted - the action-trailer hero shot
 *   side     tracking beside you, long lens
 *   orbit    circling you slowly
 *   drone    high behind, looking down the route
 *   flyby    planted ahead of you; you run past it, it turns to follow
 *   top      straight down (the roof)
 *
 * Each frame the game's camera is put back first (its chase camera eases
 * from wherever it was, so it must never see the shot), the game updates,
 * then the shot takes the camera for the render.
 */

import * as THREE from "../three.js";

export const SHOTS = ["game", "front", "low", "side", "orbit", "drone", "flyby", "top"];
export const TIME_SCALES = [1, 0.5, 0.25, 0.1];

const UP = new THREE.Vector3(0, 1, 0);

export class TrailerDirector {
  constructor() {
    this.enabled = typeof location !== "undefined" && new URLSearchParams(location.search).has("trailer");
    this.shot = "game";
    this.timeScale = 1;
    this.clean = false;
    this.autopilot = false;
    this.god = false;
    /** A capture is reading frames back: the game loop must not draw over them. */
    this.holdRender = false;
    /** The orbit shot: radius and height (m) - up and out over the roof's clutter. */
    this.orbit = { radius: 5, height: 1.1 };
    this.time = 0;
    this._saved = null;
    this._camera = null;
    this._target = new THREE.Vector3();
    this._snap = true;
    this._anchor = null;
    this._v = { pos: new THREE.Vector3(), look: new THREE.Vector3(), right: new THREE.Vector3(), f: new THREE.Vector3() };
    if (this.enabled) this._buildBars();
  }

  _buildBars() {
    const bars = document.createElement("div");
    bars.className = "trailer-bars";
    bars.innerHTML = "<i></i><i></i>";
    document.body.append(bars);
    this.toast = document.createElement("div");
    this.toast.className = "trailer-toast";
    document.body.append(this.toast);
  }

  /** Say what changed (top left, small; hidden in a clean frame). */
  say(text) {
    if (!this.toast) return;
    this.toast.textContent = text;
    this.toast.classList.remove("show");
    void this.toast.offsetWidth;
    this.toast.classList.add("show");
  }

  set({ shot, timeScale, clean, autopilot, god, orbit } = {}) {
    if (orbit) this.orbit = { ...this.orbit, ...orbit };
    if (shot !== undefined && SHOTS.includes(shot)) { this.shot = shot; this._snap = true; this._anchor = null; this._orbitF = null; this.time = 0; }
    if (timeScale !== undefined) this.timeScale = timeScale;
    if (clean !== undefined) { this.clean = !!clean; document.body.classList.toggle("trailer-clean", this.clean); }
    if (autopilot !== undefined) this.autopilot = !!autopilot;
    if (god !== undefined) this.god = !!god;
  }

  /** The trailer keys. Returns true when it used the key. */
  onKey(event) {
    if (!this.enabled || event.repeat) return false;
    const i = SHOTS.indexOf(this.shot);
    const t = TIME_SCALES.indexOf(this.timeScale);
    switch (event.code) {
      case "Backquote": this.set({ clean: !this.clean }); break;
      case "Comma": this.set({ shot: SHOTS[(i + SHOTS.length - 1) % SHOTS.length] }); this.say(`SHOT // ${this.shot.toUpperCase()}`); break;
      case "Period": this.set({ shot: SHOTS[(i + 1) % SHOTS.length] }); this.say(`SHOT // ${this.shot.toUpperCase()}`); break;
      case "Minus": this.set({ timeScale: TIME_SCALES[Math.min(TIME_SCALES.length - 1, t + 1)] }); this.say(`TIME x${this.timeScale}`); break;
      case "Equal": this.set({ timeScale: TIME_SCALES[Math.max(0, t - 1)] }); this.say(`TIME x${this.timeScale}`); break;
      case "Slash": this.set({ autopilot: !this.autopilot }); this.say(`AUTOPILOT ${this.autopilot ? "ON" : "OFF"}`); break;
      case "Semicolon": this.set({ god: !this.god }); this.say(`GOD MODE ${this.god ? "ON" : "OFF"}`); break;
      default: return false;
    }
    event.preventDefault?.();
    return true;
  }

  /** Before the game updates: give it back its own camera. */
  restore() {
    const s = this._saved;
    if (!s) return;
    s.camera.position.copy(s.position);
    s.camera.quaternion.copy(s.quaternion);
    s.camera.up.copy(s.up);
    if (s.camera.fov !== s.fov) { s.camera.fov = s.fov; s.camera.updateProjectionMatrix(); }
    this._saved = null;
  }

  /**
   * After the game updates: frame the shot.
   * @param {THREE.PerspectiveCamera} camera  the camera about to render
   * @param {THREE.Vector3} target            the player's chest, in world space
   * @param {THREE.Vector3} forward           the way they are running / facing
   * @param {number} dt                       the frame's (scaled) seconds
   * @param {number} [lateral]                how far right of the corridor's middle the player is:
   *                                          side and fly-by shots go on the far side, inside the walls
   */
  frame(camera, target, forward, dt, lateral = 0) {
    if (!this.enabled || this.shot === "game" || !camera || !target) return;
    if (camera !== this._camera) { this._camera = camera; this._snap = true; }
    this.time += dt;
    this._saved = { camera, position: camera.position.clone(), quaternion: camera.quaternion.clone(), up: camera.up.clone(), fov: camera.fov };
    const { pos, look, right, f } = this._v;
    f.copy(forward).setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    right.crossVectors(f, UP).normalize();
    // The player bobs as they run: follow a smoothed point, not the bounce.
    if (this._snap) this._target.copy(target);
    else this._target.lerp(target, 1 - Math.exp(-dt * 9));
    this._snap = false;
    const T = this._target;
    let fov = camera.fov;
    let roll = 0;
    // The far side of the corridor from the player's lane.
    const away = lateral > 0.5 ? -1 : 1;
    switch (this.shot) {
      case "front":
        pos.copy(T).addScaledVector(f, 5.4).addScaledVector(right, 1.1).addScaledVector(UP, 0.15);
        look.copy(T).addScaledVector(f, -1.5).addScaledVector(UP, 0.05);
        fov = 58;
        break;
      case "low":
        pos.copy(T).addScaledVector(f, -3.3).addScaledVector(right, 0.9).addScaledVector(UP, -0.8);
        look.copy(T).addScaledVector(f, 7).addScaledVector(UP, 0.7);
        fov = 64; roll = 0.09;
        break;
      case "side":
        pos.copy(T).addScaledVector(right, away * 4.3).addScaledVector(f, 0.8).addScaledVector(UP, 0.25);
        look.copy(T).addScaledVector(f, 1.4);
        fov = 42;
        break;
      case "orbit": {
        // Round a fixed axis (taken when the shot starts): the player turning to
        // aim must not swing the camera with them.
        if (!this._orbitF || this.time <= dt) this._orbitF = f.clone();
        const of = this._orbitF;
        const or = new THREE.Vector3().crossVectors(of, UP).normalize();
        const a = this.time * 0.38;
        const { radius, height } = this.orbit;
        pos.copy(T).addScaledVector(or, Math.cos(a) * radius).addScaledVector(of, Math.sin(a) * radius).addScaledVector(UP, height);
        look.copy(T);
        fov = 52;
        break;
      }
      case "drone":
        // Under a corridor ceiling (the Foundry's is about 7 m up).
        pos.copy(T).addScaledVector(f, -7).addScaledVector(UP, 3.9);
        look.copy(T).addScaledVector(f, 9);
        fov = 56;
        break;
      case "flyby": {
        // Planted ahead and to the side; replanted once you're well past it.
        if (!this._anchor || this._anchor.clone().sub(T).dot(f) < -7) {
          this._anchor = T.clone().addScaledVector(f, 16).addScaledVector(right, away * 3).addScaledVector(UP, 0.1);
        }
        pos.copy(this._anchor);
        look.copy(T);
        fov = 46;
        break;
      }
      case "top":
        pos.copy(T).addScaledVector(UP, 15).addScaledVector(f, -2.5);
        look.copy(T);
        fov = 55;
        break;
      default:
        return;
    }
    camera.position.copy(pos);
    camera.up.copy(UP);
    camera.lookAt(look);
    if (roll) camera.rotateZ(roll);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
}
