/**
 * Spheres and power-ups, one look and one set of physics in every level -
 * the Skyline's (Sector 03), so a sphere thrown in the Foundry, fired in the
 * Labs or on the roof, and fired on the Skyline is the same glowing ball,
 * on the same arc, bouncing the same way:
 *
 *   look      an unlit orb in its type's colour, bright enough to bloom
 *   flight    its type's speed and gravity (arsenal.js BALLS), 3 s of life
 *   walls     a corridor's walls and ceiling hand it back at full speed
 *             (a clean ricochet), solid hazards at 45 %, the floor at 42 %
 *   glass     a glass sphere punches through a pane and keeps going at 82 %
 *
 * And the pickups: a serum is the Skyline's capsule (a glass orb with the
 * serum alive inside it, ray marched), in that serum's own colour; a sphere
 * cache is the Skyline's floating crystal.
 */

import * as THREE from "../three.js";
import { BALLS } from "./arsenal.js";
import { createSerumMaterial, createCrystalMaterial } from "../levels/causeway/shaders/objects.js";

/** The Skyline's flight rules (main.js updateProjectiles). */
export const SPHERE_FLIGHT = Object.freeze({
  life: 3,
  wall: 1.0,          // walls and ceilings: a clean ricochet
  solid: 0.45,        // solid hazards
  solidBounces: 2,    // then it's spent
  floor: 0.42,        // floor: vertical
  floorFriction: 0.75, // floor: horizontal
  punch: 0.82,        // a glass sphere through a pane
});

/** Radius 1: scale it by the sphere type's radius. */
export const SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 16, 12);

let looks = null;
/** The orb for a sphere type (shared; never dispose it). */
export function sphereMaterial(kind) {
  looks ??= Object.fromEntries(Object.values(BALLS).map((b) => [b.key, new THREE.MeshBasicMaterial({ color: new THREE.Color(...b.glow) })]));
  return looks[kind] ?? looks.glass;
}

let halos = null;
let haloTexture = null;
/** The soft glow round an orb in flight, in its colour (shared). */
export function sphereHaloMaterial(kind) {
  if (!halos) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    haloTexture = new THREE.CanvasTexture(c);
    haloTexture.colorSpace = THREE.SRGBColorSpace;
    halos = Object.fromEntries(Object.values(BALLS).map((b) => {
      const [r, gg, bb] = b.glow;
      const colour = new THREE.Color(r, gg, bb).multiplyScalar(0.9 / Math.max(r, gg, bb));
      return [b.key, new THREE.SpriteMaterial({ map: haloTexture, color: colour, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })];
    }));
  }
  return halos[kind] ?? halos.glass;
}

/** An orb's halo, as a child of the orb mesh (which is scaled to the sphere's radius). */
export function sphereHalo(kind) {
  const sprite = new THREE.Sprite(sphereHaloMaterial(kind));
  sprite.scale.setScalar(4.2);
  sprite.name = "SphereHalo";
  return sprite;
}

/* ------------------------------------------------------------------ */
/* Ricochet off a route corridor's walls and ceiling                    */
/* ------------------------------------------------------------------ */

const _p = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _o0 = new THREE.Vector3();

/**
 * Where a world point is along a route (src/levels/foundry/route.js): the
 * distance, how far right of the centre line, and the heading there.
 */
export function locateOnRoute(route, point, out = {}) {
  let best = null;
  for (const node of route.nodes) {
    let local;
    if (node.type === "arc") {
      _o0.copy(node.startPosition).sub(node.centre).setY(0);
      _p.copy(point).sub(node.centre).setY(0);
      const turned = Math.atan2(_o0.z * _p.x - _o0.x * _p.z, _o0.dot(_p));
      local = turned * node.sign * node.radius;
    } else {
      _fwd.set(-Math.sin(node.startHeading), 0, -Math.cos(node.startHeading));
      local = _p.copy(point).sub(node.startPosition).dot(_fwd);
    }
    const clamped = THREE.MathUtils.clamp(local, 0, node.length);
    const miss = Math.abs(local - clamped);
    if (!best || miss < best.miss) best = { miss, distance: node.startDistance + clamped };
  }
  const { position, heading } = route.sample(best?.distance ?? 0);
  _right.set(Math.cos(heading), 0, -Math.sin(heading));
  out.distance = best?.distance ?? 0;
  out.heading = heading;
  out.lateral = _p.copy(point).sub(position).dot(_right);
  return out;
}

const _a = {};
const _b = {};
/**
 * A sphere moving start -> end against a corridor laid along `route`: the
 * wall or ceiling it reaches first, if any.
 *
 * @param {(distance: number) => {halfWidth: number, ceiling: number} | null} spaceAt
 *   the corridor's inner half width and ceiling height at a distance (null:
 *   open there - no walls)
 * @returns {{normal: THREE.Vector3, point: THREE.Vector3, position: THREE.Vector3, distance: number, surface: string} | null}
 */
export function routeSurfaceHit(route, start, end, radius, spaceAt) {
  locateOnRoute(route, end, _b);
  const space = spaceAt(_b.distance);
  if (!space) return null;
  const limit = space.halfWidth - radius;
  const ceiling = space.ceiling - radius;
  const overSide = Math.abs(_b.lateral) > limit;
  const overTop = end.y > ceiling;
  if (!overSide && !overTop) return null;

  locateOnRoute(route, start, _a);
  const right = new THREE.Vector3(Math.cos(_b.heading), 0, -Math.sin(_b.heading));
  let t = 1;
  let normal;
  let surface;
  if (overSide && Math.abs(_a.lateral) <= limit + 1e-3) {
    const side = Math.sign(_b.lateral);
    t = THREE.MathUtils.clamp((side * limit - _a.lateral) / (_b.lateral - _a.lateral || 1e-6), 0, 1);
    normal = right.clone().multiplyScalar(-side);
    surface = "wall";
  }
  if (overTop && start.y <= ceiling + 1e-3) {
    const tc = THREE.MathUtils.clamp((ceiling - start.y) / (end.y - start.y || 1e-6), 0, 1);
    if (!normal || tc < t) { t = tc; normal = new THREE.Vector3(0, -1, 0); surface = "ceiling"; }
  }
  if (!normal) {
    // Already outside (spawned in a wall, or a corner): push back in.
    normal = overTop ? new THREE.Vector3(0, -1, 0) : right.clone().multiplyScalar(-Math.sign(_b.lateral));
    surface = overTop ? "ceiling" : "wall";
    t = 0;
  }
  const position = start.clone().lerp(end, t).addScaledVector(normal, 0.01);
  const point = position.clone().addScaledVector(normal, -radius);
  return { normal, point, position, distance: start.distanceTo(position), surface };
}

/* ------------------------------------------------------------------ */
/* Pickups                                                              */
/* ------------------------------------------------------------------ */

let pickupGeometry = null;
let cradleMaterial = null;
let envCube = null;

function shared() {
  pickupGeometry ??= {
    sphere: new THREE.SphereGeometry(0.5, 28, 18),
    ring: new THREE.TorusGeometry(0.62, 0.035, 8, 40),
    octa: new THREE.OctahedronGeometry(0.55, 0),
  };
  cradleMaterial ??= new THREE.MeshStandardMaterial({ color: 0xc4ccd2, roughness: 0.3, metalness: 0.9 });
  return pickupGeometry;
}

/** A small studio-ish cube map for the crystal's reflections (outside the Skyline, which has a live probe). */
function studioCube() {
  if (envCube) return envCube;
  const faces = [];
  for (let i = 0; i < 6; i += 1) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    const top = i === 2;
    const bottom = i === 3;
    const grad = g.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, top ? "#dfe9ee" : "#8fa3ad");
    grad.addColorStop(1, bottom ? "#121619" : "#2a3238");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    if (!top && !bottom) { g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(6, 6, 20, 5); }
    faces.push(c);
  }
  envCube = new THREE.CubeTexture(faces);
  envCube.colorSpace = THREE.SRGBColorSpace;
  envCube.needsUpdate = true;
  return envCube;
}

/**
 * The Skyline's serum capsule (src/levels/causeway/kit.js serum): a glass
 * orb, two steel cradle rings turning round it, the serum alive inside.
 * `hit` is an invisible, generous sphere to shoot or run into.
 * @returns {{root: THREE.Group, capsule: THREE.Mesh, hit: THREE.Mesh, tick: Function, hide: Function, materials: THREE.Material[]}}
 */
export function serumPickup(type, { scale = 1 } = {}) {
  const geo = shared();
  const time = { value: 0 };
  const material = createSerumMaterial(type, time);
  const root = new THREE.Group();
  root.name = `Serum_${type}`;
  const bob = new THREE.Group();
  const capsule = new THREE.Mesh(geo.sphere, material);
  capsule.name = "SerumCapsule";
  capsule.scale.setScalar(0.95);
  const cradle = new THREE.Mesh(geo.ring, cradleMaterial);
  cradle.scale.setScalar(0.85);
  const cradle2 = cradle.clone();
  const hit = new THREE.Mesh(geo.sphere, new THREE.MeshBasicMaterial({ visible: false }));
  hit.scale.setScalar(1.4);
  bob.add(capsule, cradle, cradle2);
  root.add(bob, hit);
  root.scale.setScalar(scale);
  const tick = (dt, t) => {
    time.value = t;
    bob.position.y = Math.sin(t * 2.2) * 0.1;
    cradle.rotation.x += dt * 1.4;
    cradle2.rotation.y += dt * 1.1;
    cradle2.rotation.z += dt * 0.6;
  };
  const hide = () => { bob.visible = false; };
  return { root, capsule, hit, tick, hide, materials: [material, hit.material] };
}

/**
 * The Skyline's sphere cache (src/levels/causeway/kit.js cache): a faceted
 * cyan crystal turning inside a ring.
 * @returns {{root: THREE.Group, crystal: THREE.Mesh, tick: Function, hide: Function, materials: THREE.Material[]}}
 */
export function sphereCachePickup({ scale = 1 } = {}) {
  const geo = shared();
  const time = { value: 0 };
  const material = createCrystalMaterial({ uEnv: { value: studioCube() }, uTime: time }, 0x66f2ff);
  const root = new THREE.Group();
  root.name = "SphereCache";
  const crystal = new THREE.Mesh(geo.octa, material);
  crystal.name = "SphereCache";
  const ring = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.4, 2.6) }));
  ring.rotation.x = Math.PI / 2;
  root.add(crystal, ring);
  root.scale.setScalar(scale);
  const phase = Math.random() * 10;
  const tick = (dt, t) => {
    time.value = t;
    crystal.rotation.y += dt * 1.6;
    crystal.position.y = Math.sin(t * 2 + phase) * 0.12;
    ring.rotation.z += dt * 0.8;
    ring.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.3;
  };
  const hide = () => { crystal.visible = false; ring.visible = false; };
  return { root, crystal, tick, hide, materials: [material, ring.material] };
}
