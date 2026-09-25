/**
 * The Causeway kit - every prop in Level 1, built from primitives.
 *
 * The project guide asks for "5-8 reusable structural pieces per level" and
 * shared materials; this is that kit. Geometries and materials are created
 * once and shared; only objects with their own state (a pane's crack, a
 * fire's intensity) get their own material instance, and those instances
 * reuse the same compiled GPU program.
 *
 * Readability rule (from the guide): anything breakable is glass with a cyan
 * rim; anything solid is dark steel with amber/black hazard paint and never
 * glows cyan. The player should never have to guess.
 */

import * as THREE from "../../three.js";
import { createCausewayTextures, disposeTextures, hologramTexture } from "./textures.js";
import { createGlassMaterial, cloneGlass } from "./shaders/glass.js";
import { createFireMaterial, makeFireInstance } from "./shaders/fire.js";
import {
  createSerumMaterial, createCrystalMaterial, createHologramMaterial,
  createShieldMaterial, createConduitMaterial, createBeaconMaterial,
} from "./shaders/objects.js";
import { LAYERS, setLayer } from "./layers.js";

export const CASE_FILES = [
  ["CASE FILE 01", "Trial 07, day 1.", "Subject responds to the", "resonance field. Glass", "within 3 m fractures."],
  ["CASE FILE 02", "Day 19.", "Seven can hold the field", "as a sphere. The board", "wants a weapon."],
  ["CASE FILE 03", "Day 40.", "Subjects 01-06 did not", "survive the shift.", "Seven is different."],
  ["CASE FILE 04", "Day 41.", "Board order: demolish the", "tower if containment", "fails. No witnesses."],
  ["CASE FILE 05", "Final entry - Dr. Vale.", "I'm sorry. The control", "core can still cancel", "the sequence. Go up."],
];

export const MARKER_COLOURS = {
  glass: 0x5ef0ff, hazard: 0xff4a3d, fire: 0xff8a1f, sprinkler: 0x4d8dff,
  serum: 0xff5ad0, cache: 0xb6fbff, file: 0xffffff, vent: 0x7dff9a, lock: 0xffd23f,
};

function wetFloor(material, wet) {
  // Sprinkler water turns the floor into a mirror where the puddle map says
  // so. Injected into Three's standard shader rather than a new shader, so the
  // floor keeps PBR lighting, shadows, and the probe reflection.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uWet;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - 0.35 * uWet;")
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughness, texelRoughness.g * 0.55 + 0.03, uWet);",
      );
  };
  material.customProgramCacheKey = () => "causeway-wet-floor";
  return material;
}

/**
 * Lab monitors left running on emergency power: instanced screens that
 * glitch. Each instance (gl_InstanceID) gets its own state from a hash - dead,
 * blue error screen, rolling static, or a red containment alarm - and
 * scan lines, horizontal tearing and flicker are animated from time.
 */
function createMonitorMaterial(time) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vId;
      void main() {
        vUv = uv;
        vId = float(gl_InstanceID);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vId;
      float h(float n) { return fract(sin(n * 91.7) * 43758.5); }
      void main() {
        float kind = h(vId);
        float t = floor(uTime * 12.0);
        vec2 uv = vUv;
        uv.x += (h(t + vId + floor(uv.y * 20.0)) - 0.5) * 0.08 * step(0.82, h(t * 0.3 + vId));
        vec3 c = vec3(0.0);
        if (kind < 0.25) c = vec3(0.01);
        else if (kind < 0.55) {
          c = vec3(0.05, 0.12, 0.45);
          c += step(0.5, fract(uv.y * 14.0)) * step(uv.x, 0.2 + h(floor(uv.y * 14.0) + vId) * 0.6) * 0.35;
        } else if (kind < 0.8) {
          c = vec3(h(floor(uv.x * 80.0) + floor(uv.y * 60.0) * 7.0 + t)) * 0.35;
        } else {
          float band = step(0.35, uv.y) * step(uv.y, 0.65);
          c = mix(vec3(0.15, 0.0, 0.0), vec3(0.9, 0.08, 0.05), band) * (0.6 + 0.4 * step(0.5, fract(uTime * 1.5)));
        }
        c *= 0.8 + 0.2 * sin(uv.y * 300.0);
        c *= 0.7 + 0.3 * step(0.1, h(t + vId * 3.0));
        gl_FragColor = vec4(c * 1.4, 1.0);
      }`,
  });
  material.name = "CausewayMonitors";
  return material;
}

export class CausewayKit {
  constructor({ quality = "high", glassShared, time, wet }) {
    this.quality = quality;
    this.glassShared = glassShared;
    this.time = time;
    this.textures = createCausewayTextures();
    glassShared.uNoise.value = this.textures.noise;
    const t = this.textures;

    const std = (params) => new THREE.MeshStandardMaterial(params);
    const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });

    this.materials = {
      floor: wetFloor(std({ map: t.tile.map, normalMap: t.tile.normalMap, roughnessMap: t.tile.roughnessMap, roughness: 0.5, metalness: 0.05, envMapIntensity: 0.9 }), wet),
      floorDark: wetFloor(std({ map: t.tile.map, normalMap: t.tile.normalMap, roughnessMap: t.tile.roughnessMap, color: 0x46525c, roughness: 0.35, metalness: 0.1, envMapIntensity: 1.2 }), wet),
      deck: wetFloor(std({ map: t.deck.map, normalMap: t.deck.normalMap, roughnessMap: t.tile.roughnessMap, roughness: 0.45, metalness: 0.7, envMapIntensity: 1.0 }), wet),
      wall: std({ map: t.wall.map, normalMap: t.wall.normalMap, roughness: 0.32, metalness: 0.0, envMapIntensity: 0.6 }),
      ceiling: std({ map: t.ceiling.map, normalMap: t.ceiling.normalMap, color: 0xc9cfd2, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide }),
      steel: std({ map: t.steel.map, color: 0xc4ccd2, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.1 }),
      darkSteel: std({ color: 0x2b3238, roughness: 0.42, metalness: 0.8 }),
      hazard: std({ map: t.hazard.map, roughness: 0.55, metalness: 0.3 }),
      casing: std({ map: t.casing.map, roughness: 0.45, metalness: 0.55 }),
      rubber: std({ color: 0x111316, roughness: 0.9 }),
      liquid: std({ color: 0x2cff7a, emissive: 0x16c05a, emissiveIntensity: 1.3, roughness: 0.1, transparent: true, opacity: 0.7 }),
      specimen: std({ color: 0x28333a, roughness: 0.6, metalness: 0.1 }),
      scorch: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, map: t.soft, depthWrite: false }),
      warning: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 0.3), map: t.warning, transparent: true, depthWrite: false }),
      stripCyan: glow(0.35, 1.5, 1.8),
      stripWhite: glow(1.4, 1.45, 1.5),
      stripAmber: glow(1.8, 0.8, 0.15),
      // Ceiling fluorescents: per-instance colour (on, flickering, dead) is
      // written by the shell every frame, so the material itself is white.
      fixture: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      emergencyLamp: glow(2.4, 2.0, 1.4),
      exitSign: new THREE.MeshBasicMaterial({ map: t.signs.exit, color: new THREE.Color(0.6, 1.8, 0.8) }),
      paper: std({ map: t.paper, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
      crack: new THREE.MeshBasicMaterial({ map: t.crack, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      emberGlow: new THREE.MeshBasicMaterial({ map: t.soft, color: new THREE.Color(1.3, 0.38, 0.07), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      laminate: std({ color: 0xb9bfc2, roughness: 0.55, metalness: 0.05 }),
      cylinderGreen: std({ color: 0x2f5d3a, roughness: 0.4, metalness: 0.6 }),
      cylinderGrey: std({ color: 0x5a6068, roughness: 0.35, metalness: 0.7 }),
      extinguisher: std({ color: 0xa3140f, roughness: 0.35, metalness: 0.3 }),
      bioBin: std({ color: 0xc9a312, roughness: 0.5, metalness: 0.1 }),
      rubble: std({ color: 0x5b5752, roughness: 0.95, metalness: 0.0 }),
      frostTank: std({ color: 0x9fb4c0, roughness: 0.25, metalness: 0.8, emissive: 0x0b2a33, emissiveIntensity: 0.6 }),
      lampRed: glow(3.0, 0.15, 0.1),
      bulbRed: glow(3.2, 0.25, 0.2),
      led: glow(0.25, 1.6, 0.7),
      // Vent rims: one shared material, pulsed by the level with the smoke.
      ventRim: glow(0.35, 1.5, 1.8),
      ventRimDone: glow(0.2, 1.4, 0.55),
      ventSign: new THREE.MeshBasicMaterial({ map: t.signs.vent, color: new THREE.Color(1.5, 1.5, 1.5) }),
    };
    this.monitor = createMonitorMaterial(this.time);
    // Case files: one shared gold beacon column and floor ring for all five.
    this.beaconMaterial = createBeaconMaterial(this.time, 0xffc45a);
    this.materials.fileRing = new THREE.MeshBasicMaterial({ map: t.soft, color: new THREE.Color(1.6, 1.0, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const key of ["floor", "floorDark", "deck", "wall", "steel", "darkSteel", "hazard", "casing"]) {
      this.materials[key].name = `Causeway_${key}`;
    }

    this.glass = {
      pane: createGlassMaterial(glassShared, { size: [2.4, 3.6], thickness: 0.08 }),
      reinforced: createGlassMaterial(glassShared, { size: [2.4, 3.6], thickness: 0.2, absorb: [1.6, 0.45, 0.6], frost: 0.08, edge: 0x9ff6ff, tint: 0xd4fff4 }),
      mirror: createGlassMaterial(glassShared, { size: [2.4, 3.6], mirror: 0.7, tint: 0xcfe6ff, edge: 0x39e6ff }),
      window: createGlassMaterial(glassShared, { size: [9, 9], edge: 0x000000, edgeWidth: 0.0001, thickness: 0.05, refract: 0.6, tint: 0xeaf8ff, grime: 0.7 }),
      wallMirror: createGlassMaterial(glassShared, { size: [9, 9], edge: 0x000000, edgeWidth: 0.0001, mirror: 0.82, tint: 0xb9d4e6 }),
      tank: createGlassMaterial(glassShared, { size: [9, 9], edge: 0x000000, edgeWidth: 0.0001, thickness: 0.05, tint: 0xe0fff0 }),
      pod: createGlassMaterial(glassShared, { size: [9, 9], edge: 0x000000, edgeWidth: 0.0001, thickness: 0.06, tint: 0xd8f7ff, frost: 0.05 }),
      lift: createGlassMaterial(glassShared, { size: [9, 9], edge: 0x000000, edgeWidth: 0.0001, thickness: 0.06, tint: 0xe8fbff }),
    };

    this.fireTemplate = createFireMaterial(this.textures.noise, { steps: quality === "low" ? 10 : 18 });

    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geometries = {
      box,
      boxBase: box.clone().translate(0, 0.5, 0),
      octa: new THREE.OctahedronGeometry(0.55, 0),
      sphere: new THREE.SphereGeometry(0.5, 28, 18),
      smallSphere: new THREE.SphereGeometry(0.14, 12, 8),
      cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1),
      // Low-poly versions for set dressing: dozens of instances per pass, and
      // at running speed nobody counts the sides of a gas cylinder.
      propCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
      thinCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1),
      openCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1, true),
      octagon: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
      cone: new THREE.ConeGeometry(0.16, 0.14, 12),
      plane: new THREE.PlaneGeometry(1, 1),
      disc: new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2),
      ring: new THREE.TorusGeometry(0.62, 0.035, 8, 40),
      wheel: new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2),
      blade: new THREE.BoxGeometry(0.6, 0.04, 0.14),
    };
    this._paneGeometries = new Map();
    this._owned = [];
  }

  paneGeometry(width, height, depth) {
    const key = `${width.toFixed(2)}x${height.toFixed(2)}x${depth.toFixed(2)}`;
    if (!this._paneGeometries.has(key)) this._paneGeometries.set(key, new THREE.BoxGeometry(width, height, depth));
    return this._paneGeometries.get(key);
  }

  mesh(geometry, material, { cast = false, receive = false, name } = {}) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    if (name) m.name = name;
    return m;
  }

  /** A scaled unit box, positioned by its centre. */
  block(material, sx, sy, sz, x = 0, y = 0, z = 0, options = {}) {
    const m = this.mesh(this.geometries.box, material, options);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    return m;
  }

  /** Invisible box used only for collision tests. */
  collider(sx, sy, sz, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(this.geometries.box, this.materials.rubber);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.visible = false;
    m.name = "Collider";
    return m;
  }

  /** Minimap icon: a flat quad only the orthographic minimap camera sees. */
  marker(kind, width = 1.2, depth = 0.6) {
    this._markerMaterials ??= {};
    if (!this._markerMaterials[kind]) {
      this._markerMaterials[kind] = new THREE.MeshBasicMaterial({ color: MARKER_COLOURS[kind], fog: false, toneMapped: false });
      this._owned.push(this._markerMaterials[kind]);
    }
    const material = this._markerMaterials[kind];
    const m = new THREE.Mesh(this.geometries.plane, material);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(width, depth, 1);
    m.position.y = 6;
    m.layers.set(LAYERS.MINIMAP);
    m.name = `Marker_${kind}`;
    m.userData.isMarker = true;
    return m;
  }

  /** Mark a mesh as a shootable target owned by a level record. */
  target(mesh, kind, points) {
    mesh.userData.causeway = true;
    mesh.userData.kind = kind;
    mesh.userData.alive = true;
    mesh.userData.points = points;
    return mesh;
  }

  /* ---------------------------------------------------------------- */
  /* Breakables                                                         */
  /* ---------------------------------------------------------------- */

  pane({ width = 2.4, height = 3.6, reinforced = false, mirror = false } = {}) {
    const depth = reinforced ? 0.16 : 0.08;
    const base = mirror ? this.glass.mirror : reinforced ? this.glass.reinforced : this.glass.pane;
    const material = cloneGlass(base, this.glassShared, { size: [width, height] });
    const glass = this.mesh(this.paneGeometry(width, height, depth), material, { name: "Pane" });
    glass.position.y = height / 2 + 0.04;
    setLayer(glass, LAYERS.GLASS);
    this.target(glass, "pane", reinforced ? 300 : mirror ? 220 : 150);
    glass.userData.hits = reinforced ? 2 : 1;
    glass.userData.size = { width, height, depth };
    const root = new THREE.Group();
    root.name = reinforced ? "ReinforcedPane" : "Pane";
    root.add(glass);
    // A slim floor track makes a pane read as installed rather than floating.
    root.add(this.block(this.materials.darkSteel, width + 0.1, 0.06, 0.24, 0, 0.03, 0, { receive: true }));
    root.userData.owned = [material];
    return { root, target: glass, material };
  }

  door({ width = 10.8, height = 4.8 } = {}) {
    const result = this.pane({ width, height, reinforced: true });
    result.target.userData.kind = "door";
    result.target.userData.points = 600;
    result.root.name = "SecurityDoor";
    const frameY = height + 0.25;
    result.root.add(this.block(this.materials.steel, width + 0.8, 0.5, 0.5, 0, frameY, 0, { cast: true }));
    result.root.add(this.block(this.materials.stripAmber, width, 0.08, 0.52, 0, frameY - 0.2, 0));
    return result;
  }

  cache() {
    const material = createCrystalMaterial(this.glassShared, 0x66f2ff);
    const crystal = this.mesh(this.geometries.octa, material, { name: "SphereCache" });
    setLayer(crystal, LAYERS.GLASS);
    this.target(crystal, "cache", 250);
    const root = new THREE.Group();
    root.name = "SphereCache";
    root.userData.owned = [material];
    const ring = this.mesh(this.geometries.ring, this.materials.stripCyan);
    ring.rotation.x = Math.PI / 2;
    root.add(crystal, ring);
    root.userData.tick = (dt, time) => {
      crystal.rotation.y += dt * 1.6;
      crystal.position.y = Math.sin(time * 2 + root.position.z) * 0.12;
      ring.rotation.z += dt * 0.8;
      ring.rotation.x = Math.PI / 2 + Math.sin(time * 1.3) * 0.3;
    };
    return { root, target: crystal, material };
  }

  tank() {
    const root = new THREE.Group();
    root.name = "SpecimenTank";
    const glass = this.mesh(this.geometries.openCylinder, this.glass.tank, { name: "TankGlass" });
    glass.scale.set(1.1, 2.2, 1.1);
    glass.position.y = 1.45;
    setLayer(glass, LAYERS.GLASS);
    const liquid = this.mesh(this.geometries.cylinder, this.materials.liquid);
    liquid.scale.set(1.0, 1.9, 1.0);
    liquid.position.y = 1.35;
    const specimen = this.mesh(this.geometries.sphere, this.materials.specimen);
    specimen.scale.set(0.5, 1.1, 0.4);
    specimen.position.y = 1.5;
    const baseCap = this.block(this.materials.steel, 1.3, 0.35, 1.3, 0, 0.18, 0, { cast: true });
    const topCap = this.block(this.materials.steel, 1.3, 0.25, 1.3, 0, 2.66, 0, { cast: true });
    const lamp = this.block(this.materials.led, 0.9, 0.04, 0.9, 0, 0.37, 0);
    // The raycast target is a slightly larger invisible cylinder so the tank
    // is fair to hit; the glass itself is the visual.
    const hit = this.mesh(this.geometries.cylinder, this.materials.rubber);
    hit.scale.set(1.3, 2.4, 1.3);
    hit.position.y = 1.45;
    hit.visible = false;
    this.target(hit, "tank", 200);
    root.add(glass, liquid, specimen, baseCap, topCap, lamp, hit);
    root.userData.tick = (dt, time) => {
      specimen.rotation.y += dt * 0.3;
      specimen.position.y = 1.5 + Math.sin(time * 0.8 + root.position.z) * 0.06;
    };
    return { root, target: hit, liquid, specimen, glass };
  }

  /**
   * Case file: a gold data hologram (gold so it never reads as breakable
   * glass) on a floor projector, with a column of light and a glowing ring on
   * the floor so it can be spotted from far down the corridor. Collected by
   * running through it or by shooting it. The root sits at chest height.
   */
  caseFile(index) {
    const map = hologramTexture(CASE_FILES[index] ?? CASE_FILES[0]);
    const material = createHologramMaterial(map, this.time, 0xffc45a);
    const root = new THREE.Group();
    root.userData.owned = [material, map];
    root.name = `CaseFile_${index + 1}`;
    const panel = this.mesh(this.geometries.plane, material);
    panel.scale.set(1.05, 1.3, 1);
    setLayer(panel, LAYERS.FX);
    // Projector on the floor (root is 1.7 m up), and its beam up to the panel.
    const projector = this.mesh(this.geometries.octagon, this.materials.darkSteel);
    projector.scale.set(0.6, 0.12, 0.6);
    projector.position.y = -1.64;
    const lens = this.mesh(this.geometries.octagon, this.materials.stripAmber);
    lens.scale.set(0.34, 0.02, 0.34);
    lens.position.y = -1.57;
    const column = this.mesh(this.geometries.openCylinder, this.beaconMaterial);
    column.scale.set(0.75, 4.6, 0.75);
    column.position.y = -1.7 + 2.3;
    setLayer(column, LAYERS.FX);
    const ring = this.mesh(this.geometries.plane, this.materials.fileRing);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(2.4, 2.4, 1);
    ring.position.y = -1.68;
    setLayer(ring, LAYERS.FX);
    const hit = this.mesh(this.geometries.box, this.materials.rubber);
    hit.scale.set(1.2, 1.5, 0.6);
    hit.visible = false;
    this.target(hit, "file", 500);
    hit.userData.fileIndex = index;
    root.add(panel, projector, lens, column, ring, hit);
    root.userData.tick = (dt, time) => {
      panel.rotation.y = Math.sin(time * 0.9) * 0.35;
      panel.position.y = Math.sin(time * 1.7) * 0.06;
      ring.material.opacity = 0.75 + 0.25 * Math.sin(time * 3);
    };
    return { root, target: hit, material };
  }

  /** @param {number} x the lane offset the sprinkler will be placed at. */
  sprinkler({ gantry = false, ceiling = 5.2, x: laneX = 0, auto = false } = {}) {
    const root = new THREE.Group();
    root.name = "Sprinkler";
    if (gantry) {
      for (const x of [-5.4, 5.4]) root.add(this.block(this.materials.darkSteel, 0.3, ceiling + 0.3, 0.3, x - laneX, (ceiling + 0.3) / 2, 0, { cast: true }));
      root.add(this.block(this.materials.hazard, 11.2, 0.3, 0.3, -laneX, ceiling + 0.15, 0, { cast: true }));
    }
    const pipe = this.block(this.materials.darkSteel, 0.12, 0.12, 3, 0, ceiling - 0.12, 0);
    const drop = this.block(this.materials.steel, 0.06, 0.4, 0.06, 0, ceiling - 0.38, 0);
    const deflector = this.mesh(this.geometries.cone, this.materials.steel);
    deflector.position.y = ceiling - 0.64;
    deflector.rotation.x = Math.PI;
    const bulb = this.mesh(this.geometries.smallSphere, this.materials.bulbRed);
    if (auto) bulb.visible = false;           // already burst from the heat
    bulb.scale.set(0.55, 1.1, 0.55);
    bulb.position.y = ceiling - 0.52;
    const hit = this.mesh(this.geometries.sphere, this.materials.rubber);
    hit.scale.setScalar(1.0);
    hit.position.y = ceiling - 0.55;
    hit.visible = false;
    this.target(hit, "sprinkler", 100);
    root.add(pipe, drop, deflector, bulb);
    if (!auto) root.add(hit);
    const head = new THREE.Object3D();
    head.position.y = ceiling - 0.66;
    root.add(head);
    return { root, target: hit, bulb, head };
  }

  /**
   * Smoke vent, built to be found in a dark, smoky corridor: mounted low,
   * angled toward the approaching runner, a glowing cyan rim (the level's
   * "breakable" colour) that pulses harder the smokier the air, a backlit
   * sign, and a red status lamp that turns green once it is venting.
   * `side` is -1 for the left wall, 1 for the right.
   */
  vent({ side = -1, height = 2.5, gantry = false } = {}) {
    const root = new THREE.Group();
    root.name = "AirVent";
    const m = this.materials;
    // Local +x points out of the wall into the corridor.
    const inward = -side;
    const facing = inward > 0 ? Math.PI / 2 : -Math.PI / 2;
    const unit = new THREE.Group();
    unit.position.set(side * 5.5, height, 0);
    // Turned ~35 degrees toward the runner, who approaches from +z.
    unit.rotation.y = side * 0.6;

    const duct = this.block(m.darkSteel, 0.9, 1.95, 1.95, -inward * 0.3, 0, 0, { cast: true });
    const housing = this.mesh(this.geometries.octagon, m.steel, { cast: true });
    housing.scale.set(1.75, 0.28, 1.75);
    housing.rotation.z = Math.PI / 2;
    const fan = new THREE.Group();
    for (let i = 0; i < 5; i += 1) {
      const blade = this.mesh(this.geometries.blade, m.steel);
      blade.position.set(0, Math.cos((i / 5) * Math.PI * 2) * 0.3, Math.sin((i / 5) * Math.PI * 2) * 0.3);
      blade.rotation.x = (i / 5) * Math.PI * 2;
      blade.rotation.z = 0.5;
      fan.add(blade);
    }
    fan.rotation.y = Math.PI / 2;
    fan.position.x = inward * 0.02;
    const grilleV = this.block(m.darkSteel, 0.05, 1.5, 0.07, inward * 0.1, 0, 0);
    const grilleH = this.block(m.darkSteel, 0.05, 0.07, 1.5, inward * 0.1, 0, 0);

    const coverMaterial = cloneGlass(this.glass.reinforced, this.glassShared, { size: [1.6, 1.6], frost: 0.5, grime: 0.4 });
    const cover = this.mesh(new THREE.CircleGeometry(0.78, 24), coverMaterial, { name: "VentCover" });
    cover.position.x = inward * 0.19;
    cover.rotation.y = facing;
    setLayer(cover, LAYERS.GLASS);

    const rim = this.mesh(this.geometries.ring, m.ventRim);
    rim.scale.setScalar(1.36);
    rim.position.x = inward * 0.21;
    rim.rotation.y = facing;

    const status = this.block(m.lampRed, 0.08, 0.2, 0.2, inward * 0.18, 1.08, 0);
    const sign = this.mesh(this.geometries.plane, m.ventSign);
    sign.scale.set(1.5, 0.37, 1);
    sign.position.set(inward * 0.2, -1.2, 0);
    sign.rotation.y = facing;

    const hit = this.mesh(this.geometries.box, m.rubber);
    hit.scale.set(0.7, 1.8, 1.8);
    hit.position.x = inward * 0.15;
    hit.visible = false;
    this.target(hit, "vent", 100);

    unit.add(duct, housing, fan, grilleV, grilleH, cover, rim, status, sign, hit);
    root.add(unit);
    if (gantry) {
      root.add(this.block(m.darkSteel, 0.3, height + 1.2, 0.3, side * 5.75, (height + 1.2) / 2, 0, { cast: true }));
    }
    root.userData.owned = [coverMaterial, cover.geometry];
    return { root, target: hit, fan, cover, rim, status, coverMaterial, unit };
  }

  fire({ width = 3, height = 2.6, depth = 2.4 } = {}) {
    const material = makeFireInstance(this.fireTemplate, this.time);
    material.uniforms.uScale.value.set(width, height, depth);
    const volume = this.mesh(this.geometries.box, material, { name: "FireVolume" });
    volume.scale.set(width, height, depth);
    volume.position.y = height / 2;
    setLayer(volume, LAYERS.FX);
    const scorch = this.mesh(this.geometries.plane, this.materials.scorch);
    scorch.rotation.x = -Math.PI / 2;
    scorch.scale.set(width * 1.6, depth * 1.8, 1);
    scorch.position.y = 0.02;
    const root = new THREE.Group();
    root.name = "Fire";
    root.userData.owned = [material];
    // Charred debris feeding the fire.
    for (let i = 0; i < 3; i += 1) {
      const d = this.block(this.materials.darkSteel, 0.5 + Math.random() * 0.6, 0.18, 0.3 + Math.random() * 0.4,
        (Math.random() - 0.5) * width * 0.6, 0.09, (Math.random() - 0.5) * depth * 0.5);
      d.rotation.y = Math.random() * Math.PI;
      root.add(d);
    }
    root.add(volume, scorch);
    return { root, volume, material, size: new THREE.Vector3(width, height, depth) };
  }

  /* ---------------------------------------------------------------- */
  /* Solid hazards                                                      */
  /* ---------------------------------------------------------------- */

  hazard(type = "cart") {
    const root = new THREE.Group();
    root.name = `Hazard_${type}`;
    const m = this.materials;
    let collider;
    if (type === "cart") {
      root.add(this.block(m.casing, 2.2, 1.0, 1.3, 0, 0.75, 0, { cast: true }));
      root.add(this.block(m.hazard, 2.24, 0.16, 1.34, 0, 0.3, 0, { cast: true }));
      root.add(this.block(m.darkSteel, 1.2, 0.5, 0.8, -0.3, 1.5, 0, { cast: true }));
      root.add(this.block(m.led, 0.3, 0.1, 0.02, -0.3, 1.55, 0.41));
      for (const [x, z] of [[-0.9, 0.5], [0.9, 0.5], [-0.9, -0.5], [0.9, -0.5]]) {
        const w = this.mesh(this.geometries.wheel, m.rubber);
        w.position.set(x, 0.1, z);
        root.add(w);
      }
      collider = this.collider(2.2, 1.8, 1.3, 0, 0.9, 0);
    } else if (type === "cabinet") {
      root.add(this.block(m.darkSteel, 2.3, 2.6, 1.0, 0, 1.3, 0, { cast: true }));
      root.add(this.block(m.hazard, 2.34, 0.3, 1.04, 0, 2.3, 0));
      root.add(this.block(m.stripAmber, 0.05, 1.6, 0.02, 0, 1.2, 0.51));
      collider = this.collider(2.3, 2.6, 1.0, 0, 1.3, 0);
    } else if (type === "rack") {
      root.add(this.block(m.darkSteel, 2.1, 2.9, 1.1, 0, 1.45, 0, { cast: true }));
      for (let i = 0; i < 7; i += 1) {
        root.add(this.block(m.rubber, 1.8, 0.28, 0.04, 0, 0.45 + i * 0.36, 0.56));
        root.add(this.block(i % 3 ? m.led : m.lampRed, 0.08, 0.05, 0.02, 0.75, 0.45 + i * 0.36, 0.59));
      }
      root.add(this.block(m.hazard, 2.14, 0.2, 1.14, 0, 0.1, 0));
      collider = this.collider(2.1, 2.9, 1.1, 0, 1.45, 0);
    } else {
      // Rubble: a slab of fallen ceiling.
      const slab = this.block(m.ceiling, 2.6, 0.5, 1.6, 0, 0.35, 0, { cast: true });
      slab.rotation.set(0.15, 0.3, -0.12);
      root.add(slab, this.block(m.hazard, 1.2, 0.3, 0.9, 0.5, 0.75, 0.2, { cast: true }));
      collider = this.collider(2.5, 1.2, 1.6, 0, 0.6, 0);
    }
    root.add(collider);
    return { root, collider };
  }

  /** Ceiling beam that falls into a lane. Becomes a hazard once it lands. */
  beam() {
    const root = new THREE.Group();
    root.name = "FallingBeam";
    const body = new THREE.Group();
    body.add(this.block(this.materials.darkSteel, 3.0, 0.55, 0.7, 0, 0, 0, { cast: true }));
    body.add(this.block(this.materials.hazard, 3.04, 0.2, 0.74, 0, 0.2, 0));
    body.add(this.block(this.materials.ceiling, 1.6, 0.2, 1.4, 0.6, -0.1, 0.3, { cast: true }));
    root.add(body);
    const collider = this.collider(2.9, 1.1, 1.0, 0, 0, 0);
    body.add(collider);
    const warning = this.mesh(this.geometries.plane, this.materials.warning);
    warning.rotation.x = -Math.PI / 2;
    warning.scale.set(2.4, 2.4, 1);
    warning.position.y = 0.03;
    warning.visible = false;
    root.add(warning);
    return { root, body, collider, warning };
  }

  /** A ceiling glass panel that breaks loose - shootable while it falls. */
  fallingGlass() {
    const result = this.pane({ width: 2.6, height: 1.6 });
    result.target.userData.kind = "falling";
    result.target.userData.points = 400;
    result.target.position.y = 0;
    result.target.rotation.x = Math.PI / 2;
    const warning = this.mesh(this.geometries.plane, this.materials.warning);
    warning.rotation.x = -Math.PI / 2;
    warning.scale.set(2.4, 2.4, 1);
    warning.position.y = 0.03;
    warning.visible = false;
    result.root.children[1].visible = false;
    const body = new THREE.Group();
    body.add(result.target);
    result.root.add(body, warning);
    return { ...result, body, warning };
  }

  /* ---------------------------------------------------------------- */
  /* Pickups and set pieces                                             */
  /* ---------------------------------------------------------------- */

  serum(type) {
    const material = createSerumMaterial(type, this.time);
    const root = new THREE.Group();
    root.name = `Serum_${type}`;
    root.userData.owned = [material];
    const capsule = this.mesh(this.geometries.sphere, material, { name: "SerumCapsule" });
    capsule.scale.setScalar(0.95);
    setLayer(capsule, LAYERS.FX);
    const cradle = this.mesh(this.geometries.ring, this.materials.steel);
    cradle.scale.setScalar(0.85);
    const cradle2 = cradle.clone();
    const hit = this.mesh(this.geometries.sphere, this.materials.rubber);
    hit.scale.setScalar(1.4);
    hit.visible = false;
    this.target(hit, "serum", 300);
    hit.userData.serum = type;
    root.add(capsule, cradle, cradle2, hit);
    root.userData.tick = (dt, time) => {
      root.children[0].position.y = Math.sin(time * 2.2) * 0.1;
      cradle.rotation.x += dt * 1.4;
      cradle2.rotation.y += dt * 1.1;
      cradle2.rotation.z += dt * 0.6;
    };
    return { root, target: hit, material };
  }

  /**
   * Rotating glass sculpture - a steel pole (solid, blocks the centre lane)
   * with two glass blades sweeping through the outer lanes. Shoot the blades,
   * or time your lane.
   */
  sculpture({ speed = 1.1 } = {}) {
    const root = new THREE.Group();
    root.name = "RotatingSculpture";
    const pole = this.block(this.materials.steel, 0.35, 5.2, 0.35, 0, 2.6, 0, { cast: true });
    const cap = this.mesh(this.geometries.octagon, this.materials.darkSteel, { cast: true });
    cap.scale.set(0.9, 0.3, 0.9);
    cap.position.y = 5.2;
    const spinner = new THREE.Group();
    const blades = [];
    root.userData.owned = [];
    for (const side of [1, -1]) {
      const pane = this.pane({ width: 3.1, height: 3.0 });
      root.userData.owned.push(pane.material);
      pane.target.position.set(side * 1.85, 1.75, 0);
      pane.target.userData.kind = "blade";
      pane.target.userData.points = 250;
      spinner.add(pane.target);
      spinner.add(this.block(this.materials.stripCyan, 3.1, 0.05, 0.1, side * 1.85, 3.28, 0));
      blades.push(pane.target);
    }
    const collider = this.collider(0.6, 5.2, 0.6, 0, 2.6, 0);
    root.add(pole, cap, spinner, collider);
    root.userData.tick = (dt) => { spinner.rotation.y += dt * speed; };
    return { root, blades, collider, spinner };
  }

  /** The finale: three resonance locks on the lift gate. */
  gate() {
    const root = new THREE.Group();
    root.name = "LiftGate";
    const m = this.materials;
    root.add(this.block(m.steel, 0.8, 7, 0.8, -5.6, 3.5, 0, { cast: true }));
    root.add(this.block(m.steel, 0.8, 7, 0.8, 5.6, 3.5, 0, { cast: true }));
    root.add(this.block(m.steel, 12, 0.9, 0.9, 0, 7.2, 0, { cast: true }));
    const slab = new THREE.Group();
    slab.add(this.block(m.darkSteel, 10.6, 5.6, 0.4, 0, 2.8, 0, { cast: true }));
    for (let i = 0; i < 6; i += 1) slab.add(this.block(m.hazard, 10.6, 0.3, 0.42, 0, 0.4 + i * 0.95, 0));
    const conduitMaterial = createConduitMaterial(this.time, 0x7ef4f1);
    this._owned.push(conduitMaterial);
    for (const x of [-3.6, 0, 3.6]) {
      const conduit = this.mesh(this.geometries.cylinder, conduitMaterial);
      conduit.scale.set(0.16, 5.2, 0.16);
      conduit.position.set(x, 2.8, 0.26);
      setLayer(conduit, LAYERS.FX);
      slab.add(conduit);
    }
    root.add(slab);
    const collider = this.collider(11, 5.6, 0.8, 0, 2.8, 0);
    slab.add(collider);
    const locks = [];
    const lockSpots = [[-3.2, 4.5], [3.2, 4.5], [0, 6.0]];
    for (const [i, [x, y]] of lockSpots.entries()) {
      const material = createCrystalMaterial(this.glassShared, 0xffd23f);
      this._owned.push(material);
      const lock = this.mesh(this.geometries.octagon, material, { name: `Lock_${i + 1}` });
      lock.scale.set(1.3, 0.4, 1.3);
      lock.rotation.x = Math.PI / 2;
      lock.position.set(x, y, 0.5);
      setLayer(lock, LAYERS.GLASS);
      this.target(lock, "lock", 500);
      lock.userData.order = i;
      const ring = this.mesh(this.geometries.ring, m.stripAmber);
      ring.position.set(x, y, 0.55);
      ring.scale.setScalar(1.25);
      // Roman numeral plate so the order reads at a glance.
      const c = document.createElement("canvas");
      c.width = 128; c.height = 64;
      const g = c.getContext("2d");
      g.fillStyle = "#0e1418"; g.fillRect(0, 0, 128, 64);
      g.fillStyle = "#ffd23f"; g.font = "900 44px Inter, Arial, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(["I", "II", "III"][i], 64, 34);
      const numeralMap = new THREE.CanvasTexture(c);
      numeralMap.colorSpace = THREE.SRGBColorSpace;
      const numeralMaterial = new THREE.MeshBasicMaterial({ map: numeralMap, color: new THREE.Color(1.8, 1.8, 1.8) });
      this._owned.push(numeralMap, numeralMaterial);
      const numeral = this.mesh(this.geometries.plane, numeralMaterial);
      numeral.scale.set(0.9, 0.45, 1);
      numeral.position.set(x, y - 1.15, 0.45);
      root.add(lock, ring, numeral);
      locks.push({ mesh: lock, ring, material });
    }
    return { root, slab, collider, locks, conduitMaterial };
  }

  /** The Calibration Lift: cabin, glass shaft, doors, conduits. */
  lift() {
    const root = new THREE.Group();
    root.name = "CalibrationLift";
    const m = this.materials;
    const cabin = new THREE.Group();
    cabin.name = "LiftCabin";
    const floor = this.mesh(this.geometries.octagon, m.steel, { receive: true, cast: true });
    floor.scale.set(9, 0.4, 9);
    floor.position.y = -0.15;
    const roof = floor.clone();
    roof.position.y = 5.6;
    const glassWall = this.mesh(this.geometries.openCylinder, this.glass.lift);
    glassWall.scale.set(8.6, 5.4, 8.6);
    glassWall.position.y = 2.75;
    setLayer(glassWall, LAYERS.GLASS);
    const conduitMaterial = createConduitMaterial(this.time, 0x7ef4f1);
    this._owned.push(conduitMaterial);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const post = this.block(m.steel, 0.2, 5.4, 0.2, Math.cos(a) * 4.3, 2.75, Math.sin(a) * 4.3, { cast: true });
      const conduit = this.mesh(this.geometries.cylinder, conduitMaterial);
      conduit.scale.set(0.1, 5.2, 0.1);
      conduit.position.set(Math.cos(a) * 4.05, 2.75, Math.sin(a) * 4.05);
      setLayer(conduit, LAYERS.FX);
      cabin.add(post, conduit);
    }
    cabin.add(floor, roof, glassWall);
    cabin.add(this.block(m.stripCyan, 8.4, 0.05, 0.1, 0, 5.35, 0));
    const doors = [];
    for (const side of [-1, 1]) {
      const door = this.mesh(this.paneGeometry(2.3, 5.0, 0.08), this.glass.lift);
      door.position.set(side * 1.15, 2.6, 4.25);
      setLayer(door, LAYERS.GLASS);
      door.userData.openX = side * 3.4;
      door.userData.closedX = side * 1.15;
      door.position.x = door.userData.openX;
      cabin.add(door);
      doors.push(door);
    }
    // The shaft: a tall glass tube on the outside of the tower.
    const shaft = this.mesh(this.geometries.openCylinder, this.glass.window);
    shaft.scale.set(10, 80, 10);
    shaft.position.y = 40;
    setLayer(shaft, LAYERS.GLASS);
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      root.add(this.block(m.darkSteel, 0.35, 80, 0.35, Math.cos(a) * 5.1, 40, Math.sin(a) * 5.1, { cast: true }));
    }
    root.add(cabin, shaft);
    return { root, cabin, doors, conduitMaterial };
  }

  /** Subject 07's containment pod at the start of the level. */
  pod() {
    const root = new THREE.Group();
    root.name = "ContainmentPod";
    const m = this.materials;
    const base = this.mesh(this.geometries.octagon, m.steel, { cast: true, receive: true });
    base.scale.set(2.6, 0.3, 2.6);
    base.position.y = 0.15;
    const top = base.clone();
    top.position.y = 3.25;
    const glassMaterial = this.glass.pod;
    const glass = this.mesh(this.geometries.openCylinder, glassMaterial, { name: "PodGlass" });
    glass.scale.set(2.3, 2.9, 2.3);
    glass.position.y = 1.7;
    setLayer(glass, LAYERS.GLASS);
    const ring = this.block(m.stripCyan, 2.4, 0.04, 2.4, 0, 0.32, 0);
    root.add(base, top, glass, ring);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const cable = this.block(m.rubber, 0.12, 0.12, 2.6, Math.cos(a) * 1.4, 3.6, Math.sin(a) * 1.4 + 0.6);
      cable.rotation.x = 0.6;
      root.add(cable);
    }
    return { root, glass };
  }

  sign(texture, width = 3.2, height = 0.8) {
    const material = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1.6, 1.6, 1.6) });
    const m = this.mesh(this.geometries.plane, material, { name: "Sign" });
    m.userData.owned = [material];
    m.scale.set(width, height, 1);
    return m;
  }

  beacon() {
    const root = new THREE.Group();
    root.name = "AlarmBeacon";
    const housing = this.mesh(this.geometries.octagon, this.materials.darkSteel);
    housing.scale.set(0.5, 0.2, 0.5);
    const lamp = this.mesh(this.geometries.smallSphere, this.materials.lampRed);
    lamp.scale.set(1.6, 1.0, 1.6);
    lamp.position.y = -0.14;
    root.add(housing, lamp);
    return { root, lamp };
  }

  /** A single tower in the skyline, used for the scripted collapse. */
  distantTower() {
    const material = new THREE.MeshStandardMaterial({ color: 0x8a9aa8, roughness: 0.35, metalness: 0.2, emissive: 0x3a2014, fog: true });
    this._owned.push(material);
    const root = new THREE.Group();
    root.name = "CollapsingTower";
    const body = this.mesh(this.geometries.boxBase, material);
    body.scale.set(34, 190, 34);
    const crown = this.mesh(this.geometries.boxBase, material);
    crown.scale.set(22, 24, 22);
    crown.position.y = 190;
    root.add(body, crown);
    return root;
  }

  shield() {
    const material = createShieldMaterial(this.time);
    this._owned.push(material);
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.3, 32, 20), material);
    this._owned.push(m.geometry);
    m.name = "KineticShield";
    setLayer(m, LAYERS.FX);
    return m;
  }

  dispose() {
    disposeTextures(this.textures);
    for (const material of Object.values(this.materials)) material.dispose();
    for (const material of Object.values(this.glass)) material.dispose();
    this.monitor.dispose();
    this.beaconMaterial.dispose();
    this.fireTemplate.dispose();
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const geometry of this._paneGeometries.values()) geometry.dispose();
    for (const item of this._owned) item.dispose?.();
    this._owned.length = 0;
    this._paneGeometries.clear();
  }
}
