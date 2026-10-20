import * as THREE from "../three.js";
import { EMERGENCY_RECHARGE_SECONDS } from "../systems/ammo-recovery.js";

/** One reusable marker/status per gameplay controller; no pickup mutations. */
export class AmmoRecoveryHint {
  constructor(scene) {
    this.status = document.createElement("div");
    this.status.setAttribute("role", "status");
    // The NIGHTFALL look (src/ui/theme.css): a line of warn-coloured text on
    // the picture just under the crosshair - no box.
    this.status.style.cssText = "position:fixed;top:64%;left:50%;transform:translateX(-50%);width:max-content;max-width:min(620px,84vw);text-align:center;color:var(--warn,#ffc457);font:450 15px/1.5 var(--font,system-ui);letter-spacing:.01em;text-shadow:0 1px 2px rgba(0,0,0,.7),0 0 16px rgba(0,0,0,.6),0 0 30px rgba(0,0,0,.4);z-index:30;pointer-events:none";
    document.body.append(this.status);
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.85), new THREE.MeshBasicMaterial({ color: 0xffd23f, wireframe: true }));
    this.marker.name = "AmmoRecoveryHint";
    scene.add(this.marker);
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.hide();
  }

  hide() { this.status.hidden = true; this.marker.visible = false; }

  update({ active, ammunition, cost, seconds = EMERGENCY_RECHARGE_SECONDS, contact = false, targets = [], player, routeDistance = null, filter = () => true, solids = [] }) {
    this.hide();
    if (!active || ammunition > 0 && ammunition >= cost) return;
    const instruction = contact ? "Run through a sack or shoot it" : "Shoot a sphere cache";
    const text = ammunition < 1
      ? `No spheres. ${instruction} - one comes back after ${seconds} s empty in play. ${cost === 0 ? "Overdrive: throws are free." : "Use glass (Q / E)."}`
      : "Not enough spheres. Switch to glass (Q / E), or collect a cache.";
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.hidden = false;
    if (ammunition > 0 || !player) return;
    let nearest = Infinity;
    for (const target of targets) {
      if (!target.userData.alive || !filter(target)) continue;
      const d = target.userData.routeDistance;
      // Linear routes: never advertise a sack behind the runner or far away.
      if (routeDistance !== null && (!Number.isFinite(d) || d < routeDistance - 1 || d > routeDistance + 35)) continue;
      target.getWorldPosition(this.position);
      if (Math.abs(this.position.y - player.y) > 2.5) continue;
      const distance = this.position.distanceTo(player);
      if (distance > 35 || distance >= nearest) continue;
      this.direction.copy(this.position).sub(player).normalize();
      this.ray.set(player, this.direction);
      this.ray.far = Math.max(0, distance - 0.8);
      if (this.ray.intersectObjects(solids, false).some((hit) => !hit.object.userData.disabled)) continue;
      nearest = distance;
      this.marker.position.copy(this.position);
    }
    this.marker.visible = nearest < Infinity;
  }

  dispose() {
    this.status.remove();
    this.marker.removeFromParent();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
  }
}
