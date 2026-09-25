/**
 * The Meltdown modular kit - Level 3.
 *
 * Every factory returns a THREE.Object3D. Three conventions hold throughout:
 *
 *  - Collision and looks are separate. A hazard's `userData.hazardMesh` (or
 *    `hazardMeshes`) is an invisible box collider sized against the player
 *    volume; the visible geometry is decoration and can be swapped freely.
 *    That is what lets the imported models arrive late (see assets.js)
 *    without collision ever changing.
 *  - Moving pieces set `userData.tick(dt, time)`. Pieces the *level* has to
 *    sequence (things that fall when you get close) expose a controller such
 *    as `setFallen(t)` instead.
 *  - Breakables carry `userData.kind` on the mesh a projectile ray will hit.
 *
 * Collider heights are set against the player volume, the same rule Level 2
 * uses: standing 0.18-2.08 m, sliding 0.18-1.18 m, jump apex puts the feet at
 * ~1.70 m. So "jumpable" means top <= ~1.12, "slide under" means bottom >= ~1.6.
 *
 * Hazards (13):   barrier (low=concrete, high=hanging beam), rubbleWall,
 *                 ceilingChunk, airDuct, floorGap, pendulum, laserGrid,
 *                 fireVent, topplingShelf, rollingCylinder, slidingCart,
 *                 glassPane (shoot it or crash through it)
 * Pickups:        sack, powerup
 * Lab dressing:   labBench, shelfUnit, cagePanel, labCell, specimenTank,
 *                 labGurney, ivStand, curtainRail, consolePanel,
 *                 observationWindow, doorway, wallBreach, pipeWall,
 *                 ventNetwork, ventFanUnit, ceilingFanUnit, securityCam,
 *                 utilityBoxUnit, experimentRing, hangingCables, brokenLight
 * Signage/fx:     evacSign, alarmBeacon, fireSpot, emberJet, smokeJet
 */

import * as THREE from "../../three.js";
import { createMeltdownTextures, createSignTexture } from "./textures.js";
import { createFire } from "./fire.js";
import { assetSlot } from "./assets.js";

export function createMeltdownKit({ shadows = false, fire } = {}) {
  const textures = createMeltdownTextures();

  /* -------------------------------------------------------------- */
  /* Materials                                                       */
  /* -------------------------------------------------------------- */

  // Low environment-reflection strength: the scene's environment map exists
  // so metal is not black, not to make every surface look chromed.
  const std = (params) => {
    const m = new THREE.MeshStandardMaterial(params);
    m.envMapIntensity = 0.3;
    return m;
  };

  const materials = {
    tile: std({ map: textures.tileColour, normalMap: textures.tileNormal, metalness: 0.12, roughness: 0.82 }),
    floor: std({ map: textures.labFloor, normalMap: textures.labFloorNormal, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.2, roughness: 0.62 }),
    wardWall: std({ map: textures.wardWall, normalMap: textures.wardWallNormal, metalness: 0.05, roughness: 0.55 }),
    steelWall: std({ map: textures.steelWall, normalMap: textures.steelWallNormal, metalness: 0.7, roughness: 0.42 }),
    concreteWall: std({ map: textures.concreteWall, normalMap: textures.concreteWallNormal, metalness: 0.02, roughness: 0.92 }),
    trim: std({ color: 0x23211d, metalness: 0.72, roughness: 0.4 }),
    darkMetal: std({ color: 0x15171a, metalness: 0.8, roughness: 0.45 }),
    paintedMetal: std({ color: 0x5b6863, metalness: 0.55, roughness: 0.5 }),
    hazard: std({ map: textures.hazardColour, normalMap: textures.hazardNormal, metalness: 0.5, roughness: 0.62 }),
    rubble: std({ color: 0x4a4540, metalness: 0.05, roughness: 0.96 }),
    rubbleDark: std({ color: 0x2c2825, metalness: 0.05, roughness: 0.96 }),
    rebar: std({ color: 0x7a4a22, metalness: 0.7, roughness: 0.55 }),
    fireGlow: new THREE.MeshBasicMaterial({ map: textures.fireGlow }),
    pitBlack: new THREE.MeshBasicMaterial({ color: 0x050302 }),
    ductMetal: std({ color: 0x8a918d, metalness: 0.85, roughness: 0.38 }),
    warning: std({ color: 0x3a0d12, emissive: 0xff3a1e, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.5 }),
    ventGlow: std({ color: 0x1a0a04, emissive: 0xff5a14, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.5 }),
    laser: new THREE.MeshBasicMaterial({ color: 0xff2418, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    laserGlow: new THREE.MeshBasicMaterial({ color: 0xff1a10, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
    laserPost: std({ color: 0x1a1c1f, emissive: 0xff1a10, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.35 }),
    collider: new THREE.MeshBasicMaterial({ visible: false }),
    glassHousing: std({ color: 0x1c2622, metalness: 0.85, roughness: 0.3 }),
    // Breakables keep the game-wide cyan/green "this can be shot" language.
    // Plain transparency, not transmission: a transmissive material makes
    // Three re-render the whole scene into a buffer every frame.
    sackGlass: std({ color: 0x8ef6c8, transparent: true, opacity: 0.62, roughness: 0.1, metalness: 0.1, emissive: 0x1f7a52, emissiveIntensity: 1.1 }),
    paneGlass: std({ color: 0xa8f4ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3, emissive: 0x2a8aa0, emissiveIntensity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    paneEdge: std({ color: 0x0b2a30, emissive: 0x5ff0ff, emissiveIntensity: 1.15, metalness: 0.6, roughness: 0.3 }),
    signPost: std({ color: 0x181a17, metalness: 0.6, roughness: 0.5 }),
    chain: std({ color: 0x2a2a26, metalness: 0.85, roughness: 0.35 }),
    padding: std({ color: 0x6b1f22, metalness: 0.1, roughness: 0.75 }),
    sheet: std({ color: 0xc9cdc6, metalness: 0, roughness: 0.9, side: THREE.DoubleSide }),
    curtain: std({ color: 0x6f8f86, metalness: 0, roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
    consoleBody: std({ color: 0x2a2f2b, metalness: 0.55, roughness: 0.5 }),
    consoleScreen: std({ map: textures.consoleScreen, emissiveMap: textures.consoleScreen, emissive: 0xffffff, emissiveIntensity: 1.1, metalness: 0.2, roughness: 0.4 }),
    tankGlass: std({ color: 0x2fae6e, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.2, emissive: 0x0f3a24, emissiveIntensity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    tankFluid: std({ color: 0x1f8a52, transparent: true, opacity: 0.5, emissive: 0x2cff8a, emissiveIntensity: 0.55, roughness: 0.2, depthWrite: false }),
    silhouette: std({ color: 0x0c0f0d, metalness: 0, roughness: 1 }),
    crackOverlay: new THREE.MeshBasicMaterial({ map: textures.crackOverlay, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
    windowGlass: std({ color: 0x9fb8c2, transparent: true, opacity: 0.2, roughness: 0.15, metalness: 0.3, depthWrite: false }),
    roomBack: std({ color: 0x0f1411, emissive: 0x1a3a30, emissiveIntensity: 0.6, roughness: 0.9 }),
    fireBehind: std({ color: 0x100502, emissive: 0xff5a14, emissiveIntensity: 1.8, roughness: 0.9 }),
    lightTube: std({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.05 }),
    beaker: std({ color: 0x5affa0, transparent: true, opacity: 0.55, emissive: 0x2aff80, emissiveIntensity: 0.9, depthWrite: false }),
    cylinderRed: std({ color: 0x8a1812, metalness: 0.6, roughness: 0.35 }),
    cylinderGreen: std({ color: 0x1d5a2c, metalness: 0.6, roughness: 0.35 }),
    energy: new THREE.MeshBasicMaterial({ color: 0x7ef4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    decal: new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    ember: new THREE.PointsMaterial({ map: textures.ember, color: 0xff9a3c, size: 0.35, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    spark: new THREE.PointsMaterial({ map: textures.ember, color: 0xffe0a0, size: 0.18, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    smoke: new THREE.PointsMaterial({ map: textures.smoke, color: 0x6f665e, size: 2.2, transparent: true, opacity: 0.18, depthWrite: false, sizeAttenuation: true }),
  };

  const POWERUP_COLOURS = {
    coolant: { core: 0x6fe8ff, label: "COOLANT" },
    adrenaline: { core: 0xff5a6a, label: "ADRENALINE" },
    overcharge: { core: 0xffd23c, label: "OVERCHARGE" },
    barrier: { core: 0x6a8cff, label: "BARRIER" },
  };

  /* -------------------------------------------------------------- */
  /* Geometries                                                      */
  /* -------------------------------------------------------------- */

  const geometries = {
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    unitCyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    unitCylLow: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    unitSphere: new THREE.SphereGeometry(0.5, 14, 10),
    unitPlane: new THREE.PlaneGeometry(1, 1),
    wallPanel: new THREE.BoxGeometry(0.42, 1, 8),
    floorPlate: new THREE.BoxGeometry(1, 0.3, 8),
    kerb: new THREE.BoxGeometry(0.5, 0.44, 8),
    beam: new THREE.BoxGeometry(1, 0.42, 0.5),
    conduit: new THREE.CylinderGeometry(0.14, 0.14, 8.2, 8),
    pipe: new THREE.CylinderGeometry(0.2, 0.2, 8.2, 10),
    pilaster: new THREE.BoxGeometry(0.5, 1, 0.9),
    ceilingPanel: new THREE.BoxGeometry(2.4, 0.08, 1.2),
    chunkBody: new THREE.BoxGeometry(2.6, 1.3, 2.6),
    rebarRod: new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5),
    rock: new THREE.DodecahedronGeometry(0.5, 0),
    ductBody: new THREE.BoxGeometry(1.4, 1.1, 1),
    ductFlange: new THREE.BoxGeometry(1.6, 1.3, 0.12),
    gapPanel: new THREE.PlaneGeometry(3.3, 6),
    sackMount: new THREE.CylinderGeometry(0.1, 0.12, 0.7, 6),
    sackGlass: new THREE.OctahedronGeometry(0.62, 0),
    sackBallSmall: new THREE.SphereGeometry(0.13, 8, 6),
    powerupVial: new THREE.CapsuleGeometry(0.28, 0.62, 4, 10),
    powerupRing: new THREE.TorusGeometry(0.4, 0.05, 6, 14),
    signPlate: new THREE.PlaneGeometry(1.4, 1.4),
    pendulumBob: new THREE.SphereGeometry(0.55, 12, 10),
    tankBody: new THREE.CylinderGeometry(0.85, 0.9, 2.3, 18, 1, true),
    tankCap: new THREE.CylinderGeometry(0.95, 0.95, 0.18, 18),
    capsule: new THREE.CapsuleGeometry(0.25, 0.9, 4, 8),
    ring: new THREE.TorusGeometry(1, 0.06, 8, 40),
    decalRing: new THREE.RingGeometry(1.0, 1.35, 28),
    gasCylinder: new THREE.CylinderGeometry(0.42, 0.42, 1.7, 16),
    gasCap: new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  };
  geometries.unitBox.computeBoundingBox();

  const tracked = {
    materials: Object.values(materials),
    geometries: Object.values(geometries),
    textures: [],
  };

  /* -------------------------------------------------------------- */
  /* Helpers                                                         */
  /* -------------------------------------------------------------- */

  function mesh(geometry, material, { cast = true, receive = true } = {}) {
    const item = new THREE.Mesh(geometry, material);
    item.castShadow = shadows && cast;
    item.receiveShadow = shadows && receive;
    return item;
  }

  /** A box of `w x h x d`, bottom at `y0`, as a child-ready mesh. */
  function box(w, h, d, material, y0 = 0, x = 0, z = 0) {
    const m = mesh(geometries.unitBox, material);
    m.scale.set(w, h, d);
    m.position.set(x, y0 + h / 2, z);
    return m;
  }

  function cyl(radius, length, material, { lowPoly = false } = {}) {
    const m = mesh(lowPoly ? geometries.unitCylLow : geometries.unitCyl, material);
    m.scale.set(radius * 2, length, radius * 2);
    return m;
  }

  /** Invisible box collider. Never rendered (material.visible = false), but
   * still `visible` to the shared collide() test and to projectile rays. */
  function collider(w, h, d, y0 = 0, data = {}) {
    const c = new THREE.Mesh(geometries.unitBox, materials.collider);
    c.scale.set(w, h, d);
    c.position.y = y0 + h / 2;
    c.userData = { kind: "hazard", solid: true, ...data };
    return c;
  }

  let seedCounter = 1;
  function rng(seed = seedCounter++) {
    let value = (seed * 9301 + 49297) % 2147483647 || 1;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function particleJet({ count, material, spread, rise, life, drift = 0 }) {
    const positions = new Float32Array(count * 3);
    const lives = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      lives[i] = Math.random() * life;
      speeds[i] = rise * (0.6 + Math.random() * 0.8);
      positions[i * 3] = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = Math.random() * rise * life;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.userData.tick = (dt) => {
      const array = geometry.attributes.position.array;
      for (let i = 0; i < count; i += 1) {
        lives[i] += dt;
        if (lives[i] > life) {
          lives[i] = 0;
          array[i * 3] = (Math.random() - 0.5) * spread;
          array[i * 3 + 1] = 0;
          array[i * 3 + 2] = (Math.random() - 0.5) * spread;
        } else {
          array[i * 3] += drift * dt + (Math.random() - 0.5) * dt * 0.6;
          array[i * 3 + 1] += speeds[i] * dt;
        }
      }
      geometry.attributes.position.needsUpdate = true;
    };
    points.userData.disposeGeometry = geometry;
    return points;
  }

  /** Chain several ticks into one userData.tick. */
  function addTick(group, fn) {
    const previous = group.userData.tick;
    group.userData.tick = previous ? (dt, t) => { previous(dt, t); fn(dt, t); } : fn;
  }

  function fireSpot({ width = 1.6, depth = 1.2, height = 2.2, count, smoke = true, light = true, seed, materialSet } = {}) {
    return createFire(materialSet ?? fire, {
      width, depth, height, smoke, light,
      count: count ?? Math.max(6, Math.round(width * depth * 5 + 4)),
      seed: seed ?? seedCounter++,
    });
  }

  /* ============================================================== */
  /* HAZARDS                                                         */
  /* ============================================================== */

  /**
   * Low = a concrete jersey barrier (jump it). High = a hazard beam hung on
   * chains at head height (slide under it). Same heights Level 2 proved out.
   */
  function barrier({ kind = "low" } = {}) {
    const group = new THREE.Group();
    group.name = `Barrier_${kind}`;
    const isLow = kind === "low";

    if (isLow) {
      const stand = box(2.5, 0.95, 0.62, materials.rubble);
      const cap = box(2.5, 0.12, 0.34, materials.rubbleDark, 0.95);
      group.add(stand, cap);
      group.add(assetSlot("concreteBarrier", { size: [2.7, 1.1, 0.8], longAxis: "x" }, [stand, cap]));
      group.userData.hazardMesh = collider(2.7, 1.12, 0.85, 0, { barrier: "low" });
    } else {
      const beam = box(2.8, 0.7, 0.5, materials.hazard, 1.7);
      group.add(beam);
      for (const side of [-1, 1]) {
        const c = cyl(0.04, 5.5, materials.chain, { lowPoly: true });
        c.position.set(side * 1.2, 5.15, 0);
        group.add(c);
      }
      group.userData.hazardMesh = collider(2.8, 0.9, 0.6, 1.64, { barrier: "high" });
    }
    group.add(group.userData.hazardMesh);
    return group;
  }

  /** A collapsed section of wall: too tall to jump, change lanes. */
  function rubbleWall({ burning = false, seed } = {}) {
    const group = new THREE.Group();
    group.name = "RubbleWall";
    const random = rng(seed);
    for (let i = 0; i < 9; i += 1) {
      const s = 0.8 + random() * 1.1;
      const r = mesh(i % 3 ? geometries.unitBox : geometries.rock, i % 2 ? materials.rubble : materials.rubbleDark);
      r.scale.set(s * (1 + random()), s * (0.7 + random() * 0.6), s);
      r.position.set((random() - 0.5) * 2.2, s * 0.4 + (i > 5 ? 1.3 + random() * 0.8 : random() * 0.4), (random() - 0.5) * 1.2);
      r.rotation.set(random() * 0.8, random() * Math.PI, random() * 0.6);
      group.add(r);
    }
    for (let i = 0; i < 5; i += 1) {
      const rod = cyl(0.04, 1.2 + random() * 1.4, materials.rebar, { lowPoly: true });
      rod.position.set((random() - 0.5) * 2, 1.4 + random() * 1.4, (random() - 0.5) * 0.8);
      rod.rotation.set(random() - 0.5, 0, random() - 0.5);
      group.add(rod);
    }
    if (burning) {
      const f = fireSpot({ width: 1.8, depth: 1, height: 1.8, light: true });
      f.position.y = 2.2;
      group.add(f);
    }
    group.userData.hazardMesh = collider(2.7, 3.2, 1.7, 0, { rubble: true });
    group.add(group.userData.hazardMesh);
    return group;
  }

  /**
   * Hangs at the ceiling until the level calls setFallen(t). A pulsing red
   * ring on the floor marks the landing spot while it falls - the telegraph.
   * Once down it stays as rubble the player has to hurdle.
   */
  function ceilingChunk({ seed = 0 } = {}) {
    const group = new THREE.Group();
    group.name = "CeilingChunk";

    const body = new THREE.Group();
    const slab = box(2.6, 0.9, 2.6, materials.rubble, -0.45);
    body.add(slab);
    const tiles = box(2.5, 0.08, 2.5, materials.tile, -0.5);
    body.add(tiles);
    const random = rng(seed + 11);
    for (let i = 0; i < 5; i += 1) {
      const rod = cyl(0.04, 1.4, materials.rebar, { lowPoly: true });
      rod.rotation.z = Math.PI / 2 + (random() - 0.5) * 0.6;
      rod.position.set((random() - 0.5) * 1.6, 0.35 + random() * 0.3, (random() - 0.5) * 1.6);
      body.add(rod);
    }
    group.add(body);

    const decal = mesh(geometries.decalRing, materials.decal, { cast: false, receive: false });
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.03;
    decal.visible = false;
    group.add(decal);

    const hit = collider(2.6, 1.1, 2.6, -0.55, { barrier: "low", chunk: true });
    body.add(hit);

    const CEILING_Y = 7.6;
    const REST_Y = 0.55;
    let current = 0;
    const apply = (t) => {
      const fall = Math.min(1, t / 0.82);
      const eased = fall * fall; // gravity: accelerating, not easing
      let y = THREE.MathUtils.lerp(CEILING_Y, REST_Y, eased);
      if (t > 0.82) {
        const settle = (t - 0.82) / 0.18;
        y = REST_Y + Math.max(0, Math.sin(settle * Math.PI)) * 0.25 * (1 - settle);
      }
      body.position.y = y;
      body.rotation.x = eased * 0.35 * (seed % 2 ? 1 : -1);
      body.rotation.z = eased * 0.18;
      decal.visible = t > 0 && t < 0.9;
      decal.scale.setScalar(1.6 - fall * 0.5);
    };
    apply(0);

    group.userData.setFallen = (t) => {
      current = THREE.MathUtils.clamp(t, 0, 1);
      apply(current);
    };
    group.userData.fallen = () => current >= 1;
    group.userData.hazardMesh = hit;
    return group;
  }

  /**
   * One ventilation duct, two jobs. "blocker" falls across the whole corridor
   * on its chains and has to be mashed clear. "bridge" lies across a floor
   * gap and is the only safe ground there.
   */
  /**
   * One straight section of the supplied ventilation kit, laid along local Z
   * and stretched to exactly `w x h x length` around the origin. The source
   * part is modelled standing up, hence the X rotation.
   */
  function ductSlot(length, w = 1.4, h = 1.1, placeholders = []) {
    return assetSlot("ductStraight", { rotateX: Math.PI / 2, size: [w, h, length], stretch: true, align: "centre" }, placeholders);
  }

  function airDuct({ mode = "blocker", halfWidth = 7 } = {}) {
    const group = new THREE.Group();
    group.name = `AirDuct_${mode}`;
    const length = mode === "bridge" ? 7 : halfWidth * 2 - 0.4;

    const duct = new THREE.Group();
    const procedural = new THREE.Group();
    const sections = Math.round(length / 1.2);
    for (let i = 0; i < sections; i += 1) {
      const s = mesh(geometries.ductBody, materials.ductMetal);
      s.scale.z = length / sections;
      s.position.z = -length / 2 + (i + 0.5) * (length / sections);
      procedural.add(s);
      const f = mesh(geometries.ductFlange, materials.trim);
      f.position.z = -length / 2 + i * (length / sections);
      procedural.add(f);
    }
    duct.add(procedural);
    // Tile the kit's 6 m section so it is not stretched lengthwise.
    const pieces = Math.max(1, Math.round(length / 6));
    for (let i = 0; i < pieces; i += 1) {
      const slot = ductSlot(length / pieces, 1.4, 1.1, i === 0 ? [procedural] : []);
      slot.position.z = -length / 2 + (i + 0.5) * (length / pieces);
      duct.add(slot);
    }

    if (mode === "bridge") {
      // Run along the route, lying in the centre lane, slightly dented.
      duct.position.y = 0.55;
      duct.rotation.x = 0.04;
      group.add(duct);
      group.userData.walkable = true;
      return group;
    }

    // A big trunk duct: ~2.1 m tall once scaled, so it visibly fills the
    // height its collider blocks - you cannot jump or slide it, only push.
    duct.rotation.y = Math.PI / 2; // across the corridor
    duct.scale.set(1.3, 1.9, 1);
    group.add(duct);

    const chains = [];
    for (const side of [-1, 1]) {
      const c = cyl(0.045, 1, materials.chain, { lowPoly: true });
      c.position.set(side * (length / 2 - 0.8), 0, 0);
      group.add(c);
      chains.push(c);
    }

    const hit = collider(length, 2.1, 1.6, 0, { duct: true });
    group.add(hit);

    const HANG_Y = 6.4;
    const BLOCK_Y = 1.05; // duct centre when down: spans ~0 - 2.1 m
    let progress = 0;
    let mashCount = 0;
    const MASH_NEEDED = 6;
    let dropY = HANG_Y;

    const apply = () => {
      const y = THREE.MathUtils.lerp(dropY, HANG_Y, progress);
      duct.position.y = y;
      duct.rotation.z = progress * 0.5;
      for (const c of chains) {
        const len = Math.max(0.2, 7.6 - y);
        c.scale.y = len;
        c.position.y = y + len / 2;
      }
      hit.position.y = y;
    };
    apply();

    group.userData.setFallen = (t) => {
      const fall = Math.min(1, t / 0.85);
      dropY = THREE.MathUtils.lerp(HANG_Y, BLOCK_Y, fall * fall);
      apply();
    };
    group.userData.push = (amount = 1) => {
      mashCount += amount;
      progress = Math.min(1, mashCount / MASH_NEEDED);
      apply();
      return progress;
    };
    group.userData.pushProgress = () => progress;
    group.userData.pushable = true;
    group.userData.hazardMesh = hit;
    return group;
  }

  /**
   * A section of floor that has given way, with the fire underneath visibly
   * burning up through it. Non-mandatory: jump-height collider. Mandatory:
   * full-height, only a bridge or another lane gets you across.
   */
  function floorGap({ mandatory = false } = {}) {
    const group = new THREE.Group();
    group.name = "FloorGap";

    // The corridor floor is one continuous instanced slab, so the "hole" is
    // drawn on top of it: a glowing fire bed just above floor level, ringed
    // with broken rubble, flames rising out of it.
    const glow = mesh(geometries.gapPanel, materials.fireGlow, { cast: false, receive: false });
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.025;
    group.add(glow);
    for (const x of [-1.7, 1.7]) group.add(box(0.12, 0.08, 6, materials.pitBlack, 0.01, x));

    const random = rng();
    for (const z of [-3, 3]) {
      for (let i = 0; i < 4; i += 1) {
        const lip = mesh(geometries.rock, materials.rubbleDark);
        lip.scale.set(0.8 + random() * 0.6, 0.3 + random() * 0.3, 0.5 + random() * 0.4);
        lip.position.set(-1.3 + i * 0.85, 0.05, z + (random() - 0.5) * 0.4);
        lip.rotation.y = random() * Math.PI;
        group.add(lip);
      }
    }

    const flames = fireSpot({ width: 2.8, depth: 5, height: mandatory ? 2.8 : 1.5, count: mandatory ? 22 : 14, light: true });
    group.add(flames);

    const height = mandatory ? 2.6 : 1.12;
    const hit = collider(3.1, height, 5.4, 0, { barrier: mandatory ? "gap-mandatory" : "low", gap: true });
    group.add(hit);
    group.userData.hazardMesh = hit;
    return group;
  }

  /** A swinging wrecking weight - dodged by lane timing. */
  function pendulum({ length = 4.8, speed = 1.1, phase = 0, amplitude = 2.6 } = {}) {
    const group = new THREE.Group();
    group.name = "Pendulum";
    const pivot = new THREE.Group();
    pivot.position.y = 7.4;
    group.add(pivot);
    const chain = cyl(0.05, length, materials.chain, { lowPoly: true });
    chain.position.y = -length / 2;
    pivot.add(chain);
    const bob = mesh(geometries.pendulumBob, materials.hazard);
    bob.scale.setScalar(1.6);
    bob.position.y = -length;
    pivot.add(bob);
    const hit = collider(1.3, 1.3, 1.3, -length - 0.65, { pendulum: true });
    pivot.add(hit);
    group.userData.tick = (dt, time) => {
      pivot.rotation.z = Math.sin(time * speed + phase) * (amplitude / length);
    };
    group.userData.tick(0, 0);
    group.userData.hazardMesh = hit;
    return group;
  }

  /**
   * Security laser grid across the whole corridor. "low" beams: jump.
   * "high": slide. "sweep": the grid rides up and down, so it is a timing
   * problem - at mid-height it catches both a jump and a slide.
   */
  function laserGrid({ mode = "low", speed = 1.6, phase = 0, span = 11 } = {}) {
    const group = new THREE.Group();
    group.name = `LaserGrid_${mode}`;

    for (const side of [-1, 1]) {
      const post = box(0.35, 3.4, 0.35, materials.laserPost, 0, side * (span / 2 + 0.1));
      group.add(post);
    }

    const beams = new THREE.Group();
    group.add(beams);
    const heights = mode === "high" ? [1.78, 2.12, 2.46] : [0.3, 0.68, 1.02];
    for (const y of heights) {
      const core = cyl(0.028, span, materials.laser, { lowPoly: true });
      core.rotation.z = Math.PI / 2;
      core.position.y = y;
      beams.add(core);
      const glowBeam = cyl(0.11, span, materials.laserGlow, { lowPoly: true });
      glowBeam.rotation.z = Math.PI / 2;
      glowBeam.position.y = y;
      beams.add(glowBeam);
    }

    const hit = mode === "high"
      ? collider(span, 0.98, 0.35, 1.62, { laser: "high" })
      : collider(span, 1.12, 0.35, 0, { laser: mode });
    beams.add(hit);

    const anchor = new THREE.Object3D();
    anchor.position.y = heights[1];
    beams.add(anchor);
    group.userData.emitter = {
      kind: "point", anchor, color: 0xff2014, base: 6, distance: 10,
      intensityAt: (time) => 5 + Math.sin(time * 30) * 0.8,
    };

    group.userData.tick = (dt, time) => {
      materials.laser.opacity = 0.8 + Math.sin(time * 47) * 0.15;
      if (mode === "sweep") {
        beams.position.y = (0.5 + 0.5 * Math.sin(time * speed + phase)) * 1.55;
      }
    };
    group.userData.tick(0, 0);
    group.userData.hazardMesh = hit;
    return group;
  }

  /**
   * Floor vents that erupt on a cycle, one flame column per lane given. The
   * grates glow brighter for the half-second before each burst - that is
   * the tell. Colliders only count while the flames are actually up.
   */
  function fireVent({ lanes = [-3.2, 0], period = 2.6, duty = 0.42, phase = 0 } = {}) {
    const group = new THREE.Group();
    group.name = "FireVent";
    const hits = [];
    const columns = [];
    const grateMat = materials.ventGlow.clone();
    tracked.materials.push(grateMat);
    // Its own flame material so this vent can erupt independently; it still
    // shares the level-wide clock uniform, and the same compiled shader.
    const ventFire = fire.fire.clone();
    ventFire.uniforms.uTime = fire.fire.uniforms.uTime;
    ventFire.uniforms.uHeightScale = { value: 0 };
    tracked.materials.push(ventFire);
    const ventSet = { ...fire, fire: ventFire };

    for (const [i, lane] of lanes.entries()) {
      const grate = box(2.6, 0.08, 2, grateMat, 0, lane);
      group.add(grate);
      for (let s = -2; s <= 2; s += 1) {
        const bar = box(2.5, 0.1, 0.12, materials.darkMetal, 0.02, lane, s * 0.38);
        group.add(bar);
      }
      const column = new THREE.Group();
      column.position.x = lane;
      column.add(fireSpot({ width: 2.1, depth: 1.5, height: 3.4, count: 16, smoke: false, light: i === 0, materialSet: ventSet }));
      group.add(column);
      columns.push(column);
      const hit = collider(2.4, 2.8, 1.6, 0, { fireVent: true });
      hit.position.x = lane;
      group.add(hit);
      hits.push(hit);
    }

    group.userData.tick = (dt, time) => {
      const cycle = (((time + phase) % period) + period) % period / period;
      let burst = 0;
      if (cycle < duty) burst = THREE.MathUtils.clamp(Math.min(cycle / 0.05, (duty - cycle) / 0.08), 0, 1);
      const warn = cycle > 1 - 0.2 ? (cycle - 0.8) / 0.2 : 0;
      grateMat.emissiveIntensity = 0.35 + warn * 2.8 + burst * 2;
      const s = Math.max(burst, warn * 0.16);
      ventFire.uniforms.uHeightScale.value = s;
      for (const column of columns) column.visible = s > 0.03;
      for (const hit of hits) hit.userData.disabled = burst < 0.45;
    };
    group.userData.tick(0, 0);
    group.userData.hazardMeshes = hits;
    return group;
  }

  /**
   * A tall storage shelf against the wall that tips across two lanes when the
   * player gets close. Mid-fall its collider sweeps a big arc - getting
   * caught under it is a hit. Once down it lies across the lanes: jump it,
   * or take the far lane.
   */
  function topplingShelf({ side = 1, height = 5.4 } = {}) {
    const group = new THREE.Group();
    group.name = "TopplingShelf";

    // It tips over its front-bottom edge - the edge facing the lanes - so the
    // pivot sits there and the body extends back toward the wall from it.
    // Standing: occupies x = 5.0..5.8 against the wall. Fallen: lies on the
    // floor from x = 5.0 inward across `height` metres, i.e. to about -0.4,
    // covering its own lane and the centre lane.
    const pivot = new THREE.Group();
    pivot.position.x = side * 5.0;
    group.add(pivot);

    const body = new THREE.Group();
    body.position.x = side * 0.4;
    pivot.add(body);

    const stand = new THREE.Group();
    for (const [x, z] of [[-0.32, -0.66], [0.32, -0.66], [-0.32, 0.66], [0.32, 0.66]]) {
      const post = box(0.07, height, 0.07, materials.paintedMetal, 0, x, z);
      stand.add(post);
    }
    const random = rng();
    for (let s = 0; s < 6; s += 1) {
      const y = 0.25 + s * ((height - 0.4) / 5);
      stand.add(box(0.72, 0.05, 1.42, materials.paintedMetal, y));
      for (let k = 0; k < 3; k += 1) {
        if (random() < 0.35) continue;
        const crate = box(0.5, 0.3 + random() * 0.3, 0.35, random() < 0.5 ? materials.trim : materials.sheet, y + 0.05, 0, -0.45 + k * 0.45);
        stand.add(crate);
      }
    }
    body.add(stand);
    const lower = assetSlot("steelShelves", { size: [0.8, height / 2, 1.45], longAxis: "z" }, [stand]);
    const upper = assetSlot("steelShelves", { size: [0.8, height / 2, 1.45], longAxis: "z" });
    upper.position.y = height / 2;
    body.add(lower, upper);

    const hit = collider(0.8, height, 1.45, 0, { shelf: true });
    body.add(hit);

    let current = 0;
    const apply = (t) => {
      const fall = Math.min(1, t / 0.86);
      let angle = fall * fall * (Math.PI / 2);
      if (t > 0.86) angle -= Math.sin(((t - 0.86) / 0.14) * Math.PI) * 0.06;
      pivot.rotation.z = side * angle;
    };
    apply(0);

    group.userData.setFallen = (t) => {
      current = THREE.MathUtils.clamp(t, 0, 1);
      apply(current);
    };
    group.userData.fallen = () => current >= 1;
    group.userData.hazardMesh = hit;
    return group;
  }

  /** A gas cylinder rolling back and forth across all three lanes. */
  function rollingCylinder({ speed = 1.3, phase = 0, range = 4.2 } = {}) {
    const group = new THREE.Group();
    group.name = "RollingCylinder";
    const mover = new THREE.Group();
    group.add(mover);
    const roller = new THREE.Group();
    roller.position.y = 0.42;
    mover.add(roller);
    const body = mesh(geometries.gasCylinder, Math.random() < 0.5 ? materials.cylinderRed : materials.cylinderGreen);
    body.rotation.x = Math.PI / 2;
    roller.add(body);
    const cap = mesh(geometries.gasCap, materials.paintedMetal);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = -0.85;
    roller.add(cap);
    const leak = particleJet({ count: 12, material: materials.smoke, spread: 0.3, rise: 0.8, life: 1.2 });
    leak.position.set(0, 0.5, -0.9);
    mover.add(leak);

    const hit = collider(0.9, 0.9, 1.8, 0, { cylinder: true });
    mover.add(hit);

    group.userData.tick = (dt, time) => {
      const x = Math.sin(time * speed + phase) * range;
      const dx = x - mover.position.x;
      mover.position.x = x;
      roller.rotation.z -= dx / 0.42;
      leak.userData.tick(dt);
    };
    group.userData.tick(0, 0);
    group.userData.hazardMesh = hit;
    return group;
  }

  /** A lab desk (microscope still on it) sliding across the lanes. */
  function slidingCart({ speed = 1.0, phase = 0, range = 3.4 } = {}) {
    const group = new THREE.Group();
    group.name = "SlidingCart";
    const mover = new THREE.Group();
    group.add(mover);
    const top = box(2.0, 0.08, 1.0, materials.paintedMetal, 0.76);
    const legs = new THREE.Group();
    for (const [x, z] of [[-0.9, -0.42], [0.9, -0.42], [-0.9, 0.42], [0.9, 0.42]]) legs.add(box(0.06, 0.76, 0.06, materials.trim, 0, x, z));
    mover.add(top, legs);
    mover.add(assetSlot("officeDesk", { size: [2.1, 0.85, 1.05], longAxis: "x" }, [top, legs]));
    const scope = assetSlot("microscope", { size: [0, 0.45, 0] });
    scope.position.set(0.4, 0.84, 0);
    mover.add(scope);
    const hit = collider(2.1, 1.0, 1.1, 0, { cart: true });
    mover.add(hit);
    group.userData.tick = (dt, time) => {
      mover.position.x = Math.sin(time * speed + phase) * range;
    };
    group.userData.tick(0, 0);
    group.userData.hazardMesh = hit;
    return group;
  }

  /**
   * Lab partition glass across the given lanes. Each pane is breakable (shoot
   * it: `hp` hits, cracks spreading as it weakens) and solid until broken -
   * the Smash Hit rule. Running into an intact pane is a hit.
   */
  function glassPane({ lanes = [-3.2, 0, 3.2], hp = 1 } = {}) {
    const group = new THREE.Group();
    group.name = "GlassPane";
    const panes = [];
    const hits = [];
    const H = 3.6;

    const minX = Math.min(...lanes) - 1.6;
    const maxX = Math.max(...lanes) + 1.6;
    group.add(box(maxX - minX, 0.18, 0.22, materials.darkMetal, H, (minX + maxX) / 2));
    group.add(box(maxX - minX, 0.12, 0.22, materials.darkMetal, 0, (minX + maxX) / 2));

    for (const lane of lanes) {
      for (const edge of [-1.55, 1.55]) {
        group.add(box(0.12, H, 0.2, materials.paneEdge, 0, lane + edge));
      }
      const glassMat = materials.paneGlass.clone();
      tracked.materials.push(glassMat);
      const glass = mesh(geometries.unitBox, glassMat, { cast: false });
      glass.scale.set(3.0, H - 0.12, 0.06);
      glass.position.set(lane, 0.12 + (H - 0.12) / 2, 0);
      const crack = mesh(geometries.unitPlane, materials.crackOverlay, { cast: false, receive: false });
      crack.scale.set(3.0, H - 0.12, 1);
      crack.position.set(lane, glass.position.y, 0.04);
      crack.visible = false;
      group.add(glass, crack);

      const hit = collider(3.0, H, 0.5, 0, { glass: true });
      hit.position.x = lane;
      group.add(hit);
      hits.push(hit);

      const pane = { glass, crack, hit, material: glassMat };
      glass.userData = {
        kind: "glass", breakable: true, alive: true, hp, maxHp: hp, label: "GLASS", node: group, pane,
      };
      pane.hitPane = (power = 1) => {
        const data = glass.userData;
        if (!data.alive) return false;
        data.hp = Math.max(0, data.hp - power);
        if (data.hp > 0) {
          crack.visible = true;
          crack.material = materials.crackOverlay;
          glassMat.opacity = 0.28 + (1 - data.hp / data.maxHp) * 0.25;
          return false;
        }
        data.alive = false;
        glass.visible = false;
        crack.visible = false;
        hit.userData.disabled = true;
        return true;
      };
      panes.push(pane);
    }

    group.userData.panes = panes;
    group.userData.hazardMeshes = hits;
    group.userData.breakableMeshes = panes.map((p) => p.glass);
    return group;
  }

  /* ============================================================== */
  /* PICKUPS                                                         */
  /* ============================================================== */

  function sack({ hp = 1, spheres = 4 } = {}) {
    const group = new THREE.Group();
    group.name = "Sack";
    const mount = mesh(geometries.sackMount, materials.trim);
    mount.position.y = 0.4;
    group.add(mount);
    const glassMaterial = materials.sackGlass.clone();
    tracked.materials.push(glassMaterial);
    const glass = mesh(geometries.sackGlass, glassMaterial);
    glass.position.y = 0.9;
    glass.userData = { kind: "sack", breakable: true, alive: true, hp, maxHp: hp, spheres, label: "SACK", node: group };
    group.add(glass);
    for (let i = 0; i < 5; i += 1) {
      const ball = mesh(geometries.sackBallSmall, materials.ductMetal, { cast: false });
      const a = (i / 5) * Math.PI * 2;
      ball.position.set(Math.cos(a) * 0.28, Math.sin(a * 1.7) * 0.15, Math.sin(a) * 0.28);
      glass.add(ball);
    }
    const anchor = new THREE.Object3D();
    anchor.position.y = 0.9;
    group.add(anchor);
    group.userData.emitter = {
      kind: "point", anchor, color: 0x8ef6c8, base: 4, distance: 9,
      intensityAt: (time) => (glass.userData.alive ? 2.6 + Math.sin(time * 2.6) * 1.4 : 0),
    };
    group.userData.glass = glass;
    group.userData.tick = (dt, time) => {
      if (!glass.userData.alive) return;
      glass.rotation.y = Math.sin(time * 0.7) * 0.3;
      const hurt = 1 - glass.userData.hp / glass.userData.maxHp;
      glassMaterial.emissiveIntensity = 0.9 + hurt * 0.8 + Math.sin(time * 3) * 0.25;
    };
    group.userData.hit = (power = 1) => {
      if (!glass.userData.alive) return false;
      glass.userData.hp = Math.max(0, glass.userData.hp - power);
      if (glass.userData.hp > 0) return false;
      glass.userData.alive = false;
      glass.visible = false;
      return true;
    };
    return group;
  }

  function powerup({ kind = "coolant" } = {}) {
    const info = POWERUP_COLOURS[kind] ?? POWERUP_COLOURS.coolant;
    const group = new THREE.Group();
    group.name = `Powerup_${kind}`;
    const ring = mesh(geometries.powerupRing, materials.glassHousing);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.1;
    group.add(ring);
    const vialMaterial = std({ color: info.core, transparent: true, opacity: 0.8, roughness: 0.08, metalness: 0.1, emissive: info.core, emissiveIntensity: 1.4 });
    tracked.materials.push(vialMaterial);
    const vial = mesh(geometries.powerupVial, vialMaterial);
    vial.position.y = 1.1;
    vial.userData = { kind: "powerup", breakable: true, alive: true, label: info.label, powerupKind: kind, node: group };
    group.add(vial);
    const anchor = new THREE.Object3D();
    anchor.position.y = 1.1;
    group.add(anchor);
    group.userData.emitter = {
      kind: "point", anchor, color: info.core, base: 5, distance: 10,
      intensityAt: (time) => (vial.userData.alive ? 3.4 + Math.sin(time * 4) * 1.6 : 0),
    };
    group.userData.glass = vial;
    group.userData.tick = (dt, time) => {
      if (!vial.userData.alive) return;
      group.rotation.y = time * 0.9;
      vial.position.y = 1.1 + Math.sin(time * 2.2) * 0.08;
    };
    group.userData.onBreak = () => {
      if (!vial.userData.alive) return false;
      vial.userData.alive = false;
      vial.visible = false;
      ring.visible = false;
      return true;
    };
    return group;
  }

  /* ============================================================== */
  /* SIGNAGE / FX                                                    */
  /* ============================================================== */

  function evacSign({ side = 1, halfWidth = 7 } = {}) {
    const group = new THREE.Group();
    group.name = "EvacSign";
    const { texture, setText } = createSignTexture("EXIT");
    tracked.textures.push(texture);
    const plateMaterial = new THREE.MeshBasicMaterial({ map: texture });
    tracked.materials.push(plateMaterial);
    const plate = mesh(geometries.signPlate, plateMaterial, { cast: false, receive: false });
    plate.scale.setScalar(1.3);
    plate.position.set(side * (halfWidth - 0.25), 3.2, 0);
    plate.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(plate);
    const anchor = new THREE.Object3D();
    anchor.position.set(side * (halfWidth - 1), 3.2, 0);
    group.add(anchor);
    group.userData.emitter = { kind: "point", anchor, color: 0x0aff6a, base: 3, distance: 7, intensityAt: () => 3 };
    group.userData.setText = setText;
    return group;
  }

  /** Rotating red alarm beacon (the supplied alarm-light model). */
  function alarmBeacon({ x = 0, y = 5.4, speed = 3.4, phase = 0, onWall = 0 } = {}) {
    const group = new THREE.Group();
    group.name = "AlarmBeacon";
    const lensMaterial = materials.warning.clone();
    tracked.materials.push(lensMaterial);
    const holder = new THREE.Group();
    holder.position.set(x, y, 0);
    if (onWall) holder.rotation.z = onWall * Math.PI / 2;
    group.add(holder);
    const lens = mesh(geometries.unitSphere, lensMaterial);
    lens.scale.set(0.32, 0.4, 0.32);
    holder.add(lens);
    holder.add(assetSlot("alarmLight", { size: [0, 0.42, 0], align: "centre" }, [lens]));
    const anchor = new THREE.Object3D();
    anchor.position.set(x, y - 0.4, 0);
    group.add(anchor);
    const strengthAt = (time) => Math.pow(Math.max(0, Math.sin(time * speed + phase)), 2);
    group.userData.emitter = {
      kind: "point", anchor, color: 0xff2a14, base: 12, distance: 14,
      intensityAt: (time) => 2 + strengthAt(time) * 12,
    };
    group.userData.armed = true;
    group.userData.tick = (dt, time) => {
      lensMaterial.emissiveIntensity = 0.4 + strengthAt(time) * 4;
    };
    return group;
  }

  function emberJet({ count = 20 } = {}) {
    return particleJet({ count, material: materials.ember, spread: 1.4, rise: 1.8, life: 1.8 });
  }

  function smokeJet({ count = 14 } = {}) {
    return particleJet({ count, material: materials.smoke, spread: 2.4, rise: 0.7, life: 3.6, drift: 0.2 });
  }

  /* ============================================================== */
  /* LAB DRESSING - decoration only, no colliders                    */
  /* ============================================================== */

  function labGurney({ tipped = 0.3 } = {}) {
    const group = new THREE.Group();
    group.name = "LabGurney";
    const frame = new THREE.Group();
    frame.add(box(0.78, 0.1, 1.95, materials.paintedMetal, 0.72));
    frame.add(box(0.7, 0.12, 1.8, materials.padding, 0.82));
    frame.add(box(0.7, 0.04, 1.2, materials.sheet, 0.94, 0, 0.25));
    for (const [x, z] of [[-0.34, -0.85], [0.34, -0.85], [-0.34, 0.85], [0.34, 0.85]]) {
      frame.add(box(0.05, 0.72, 0.05, materials.trim, 0, x, z));
    }
    // Restraint straps - the detail that says what this room was for.
    for (const z of [-0.4, 0.3]) frame.add(box(0.8, 0.03, 0.1, materials.trim, 0.95, 0, z));
    frame.rotation.z = tipped;
    frame.position.y = tipped ? 0.18 : 0;
    group.add(frame);
    return group;
  }

  function ivStand() {
    const group = new THREE.Group();
    group.name = "IVStand";
    const pole = cyl(0.025, 2.1, materials.paintedMetal, { lowPoly: true });
    pole.position.y = 1.05;
    group.add(pole);
    group.add(box(0.5, 0.04, 0.04, materials.paintedMetal, 2.05));
    const bag = box(0.16, 0.26, 0.05, materials.beaker, 1.72, 0.18);
    group.add(bag);
    for (let i = 0; i < 4; i += 1) {
      const foot = box(0.4, 0.03, 0.04, materials.trim, 0);
      foot.rotation.y = (i / 4) * Math.PI;
      group.add(foot);
    }
    return group;
  }

  /** A bed-bay curtain on its rail, swaying in the heat. */
  function curtainRail({ length = 3.4 } = {}) {
    const group = new THREE.Group();
    group.name = "CurtainRail";
    group.add(box(0.05, 0.05, length, materials.trim, 2.7));
    const cloth = mesh(geometries.unitPlane, materials.curtain, { cast: false });
    cloth.scale.set(length * 0.6, 2.3, 1);
    cloth.rotation.y = Math.PI / 2;
    cloth.position.set(0, 1.5, -length * 0.15);
    group.add(cloth);
    const phase = Math.random() * 10;
    group.userData.tick = (dt, time) => {
      cloth.rotation.x = Math.sin(time * 0.9 + phase) * 0.06;
    };
    return group;
  }

  /** A cracked specimen tank; `occupied` puts a dark figure inside. */
  function specimenTank({ seed = 0, occupied = false, broken = false } = {}) {
    const group = new THREE.Group();
    group.name = "SpecimenTank";
    group.add(box(2.1, 0.35, 2.1, materials.darkMetal));
    const glass = mesh(geometries.tankBody, materials.tankGlass, { cast: false });
    glass.position.y = 1.55;
    group.add(glass);
    if (!broken) {
      const fluid = mesh(geometries.unitCyl, materials.tankFluid, { cast: false });
      fluid.scale.set(1.62, 1.6 + (seed % 3) * 0.2, 1.62);
      fluid.position.y = 0.45 + fluid.scale.y / 2;
      group.add(fluid);
    }
    const crack = mesh(geometries.tankBody, materials.crackOverlay, { cast: false, receive: false });
    crack.position.y = 1.55;
    crack.rotation.y = (seed % 4) * 0.8;
    crack.scale.setScalar(1.01);
    group.add(crack);
    const cap = mesh(geometries.tankCap, materials.darkMetal);
    cap.position.y = 2.75;
    group.add(cap);
    for (let i = 0; i < 3; i += 1) {
      const tube = cyl(0.05, 1.5, materials.trim, { lowPoly: true });
      tube.position.set(Math.cos(i * 2.1) * 0.6, 3.5, Math.sin(i * 2.1) * 0.6);
      group.add(tube);
    }
    if (occupied) {
      const figure = mesh(geometries.capsule, materials.silhouette);
      figure.position.y = 1.45;
      figure.scale.set(1, 1, 0.8);
      group.add(figure);
      const head = mesh(geometries.unitSphere, materials.silhouette);
      head.scale.setScalar(0.36);
      head.position.y = 2.2;
      group.add(head);
    }
    if (broken) {
      const shards = new THREE.Group();
      const random = rng(seed + 3);
      for (let i = 0; i < 8; i += 1) {
        const s = box(0.3 + random() * 0.3, 0.02, 0.2 + random() * 0.2, materials.tankGlass, 0.02, (random() - 0.5) * 3, (random() - 0.5) * 3);
        s.rotation.y = random() * Math.PI;
        shards.add(s);
      }
      group.add(shards);
    }
    const anchor = new THREE.Object3D();
    anchor.position.y = 1.4;
    group.add(anchor);
    group.userData.emitter = { kind: "point", anchor, color: 0x3cff8c, base: 3, distance: 7, intensityAt: (t) => 2.5 + Math.sin(t * 1.3 + seed) * 0.6 };
    group.rotation.z = broken ? 0 : ((seed % 3) - 1) * 0.04;
    return group;
  }

  /** A desk with a microscope and glowing sample beakers. */
  function labBench({ scope = true } = {}) {
    const group = new THREE.Group();
    group.name = "LabBench";
    const top = box(2.0, 0.08, 0.95, materials.paintedMetal, 0.76);
    const legs = new THREE.Group();
    for (const [x, z] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) legs.add(box(0.06, 0.76, 0.06, materials.trim, 0, x, z));
    group.add(top, legs);
    group.add(assetSlot("officeDesk", { size: [2.0, 0.8, 0.95], longAxis: "x" }, [top, legs]));
    if (scope) {
      const s = assetSlot("microscope", { size: [0, 0.46, 0] });
      s.position.set(-0.45, 0.8, 0);
      group.add(s);
    }
    for (let i = 0; i < 3; i += 1) {
      const b = cyl(0.06, 0.2, materials.beaker, { lowPoly: true });
      b.position.set(0.25 + i * 0.2, 0.9, 0.1 - i * 0.08);
      group.add(b);
    }
    group.add(box(0.5, 0.01, 0.35, materials.sheet, 0.8, 0.5, -0.2));
    return group;
  }

  function shelfUnit() {
    const group = new THREE.Group();
    group.name = "ShelfUnit";
    const stand = new THREE.Group();
    for (let s = 0; s < 4; s += 1) stand.add(box(1.9, 0.05, 0.6, materials.paintedMetal, 0.2 + s * 0.65));
    for (const x of [-0.92, 0.92]) for (const z of [-0.27, 0.27]) stand.add(box(0.05, 2.2, 0.05, materials.paintedMetal, 0, x, z));
    group.add(stand);
    group.add(assetSlot("steelShelves", { size: [2.0, 2.3, 0.7], longAxis: "x" }, [stand]));
    const random = rng();
    for (let s = 0; s < 3; s += 1) {
      for (let k = 0; k < 4; k += 1) {
        if (random() < 0.4) continue;
        const b = cyl(0.07, 0.22, random() < 0.5 ? materials.beaker : materials.cylinderGreen, { lowPoly: true });
        b.position.set(-0.7 + k * 0.45, 0.35 + s * 0.72, 0);
        group.add(b);
      }
    }
    return group;
  }

  /** A run of chain-link cage panels (containment pens). */
  function cagePanel({ length = 6 } = {}) {
    const group = new THREE.Group();
    group.name = "CagePanel";
    const count = Math.max(1, Math.round(length / 1.9));
    for (let i = 0; i < count; i += 1) {
      const z = -length / 2 + (i + 0.5) * (length / count);
      const stand = new THREE.Group();
      stand.add(box(0.06, 2.4, 0.06, materials.paintedMetal, 0, 0, z - 0.95));
      stand.add(box(0.03, 0.05, 1.9, materials.paintedMetal, 2.35, 0, z));
      group.add(stand);
      const slot = assetSlot("chainlinkFence", { size: [0, 2.4, 1.9], rotateY: Math.PI / 2 }, [stand]);
      slot.position.z = z;
      group.add(slot);
    }
    return group;
  }

  /** A containment cell set into the wall: frame, cracked glass, an occupied tank. */
  function labCell({ side = 1, broken = false, seed = 0 } = {}) {
    const group = new THREE.Group();
    group.name = "LabCell";
    group.add(box(0.35, 4.2, 0.3, materials.darkMetal, 0, 0, -2.2));
    group.add(box(0.35, 4.2, 0.3, materials.darkMetal, 0, 0, 2.2));
    group.add(box(0.35, 0.4, 4.7, materials.darkMetal, 4.0));
    const back = box(0.1, 4, 4.4, materials.roomBack, 0, side * 3.6);
    group.add(back);
    if (!broken) {
      const glass = mesh(geometries.unitBox, materials.windowGlass, { cast: false });
      glass.scale.set(0.05, 3.9, 4.2);
      glass.position.y = 2;
      group.add(glass);
    }
    const crack = mesh(geometries.unitPlane, materials.crackOverlay, { cast: false, receive: false });
    crack.scale.set(4.2, 3.9, 1);
    crack.rotation.y = Math.PI / 2;
    crack.position.set(-side * 0.03, 2, 0);
    group.add(crack);
    const tank = specimenTank({ seed, occupied: !broken, broken });
    tank.scale.setScalar(0.85);
    tank.position.x = side * 1.9;
    group.add(tank);
    return group;
  }

  function consolePanel({ side = 1 } = {}) {
    const group = new THREE.Group();
    group.name = "ConsolePanel";
    // Facing lives on an inner group: route.place() owns the outer rotation.
    const inner = new THREE.Group();
    inner.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(inner);
    inner.add(box(0.5, 0.9, 0.4, materials.trim));
    const body = box(1.5, 1.15, 0.5, materials.consoleBody, 0.8);
    body.rotation.x = -0.35;
    inner.add(body);
    const screen = mesh(geometries.unitPlane, materials.consoleScreen, { cast: false, receive: false });
    screen.scale.set(1.2, 0.75, 1);
    screen.position.set(0, 1.42, 0.3);
    screen.rotation.x = -0.35;
    inner.add(screen);
    group.userData.tick = (dt, time) => {
      materials.consoleScreen.emissiveIntensity = 0.85 + Math.sin(time * 6) * 0.2 + (Math.random() < 0.02 ? 0.8 : 0);
    };
    return group;
  }

  /** A cracked window into a dim room you never enter - depth for free. */
  function observationWindow({ side = 1, fireBehind = false } = {}) {
    const group = new THREE.Group();
    group.name = "ObservationWindow";
    group.add(box(0.3, 0.25, 3.4, materials.darkMetal, 1.1));
    group.add(box(0.3, 0.25, 3.4, materials.darkMetal, 3.6));
    group.add(box(0.3, 2.75, 0.25, materials.darkMetal, 1.1, 0, -1.6));
    group.add(box(0.3, 2.75, 0.25, materials.darkMetal, 1.1, 0, 1.6));
    const glass = mesh(geometries.unitBox, materials.windowGlass, { cast: false });
    glass.scale.set(0.04, 2.3, 3.0);
    glass.position.y = 2.4;
    group.add(glass);
    const crack = mesh(geometries.unitPlane, materials.crackOverlay, { cast: false, receive: false });
    crack.scale.set(3, 2.3, 1);
    crack.rotation.y = Math.PI / 2;
    crack.position.set(-side * 0.03, 2.4, 0);
    group.add(crack);
    const back = box(0.1, 3.6, 4.4, fireBehind ? materials.fireBehind : materials.roomBack, 0.3, side * 3.2);
    group.add(back);
    if (fireBehind) {
      const f = fireSpot({ width: 2.4, depth: 1.5, height: 2.4, smoke: false });
      f.position.set(side * 2.2, 0.2, 0);
      group.add(f);
    } else {
      const bench = labBench({ scope: false });
      bench.position.set(side * 2.2, 0.1, 0);
      bench.rotation.y = Math.PI / 2;
      group.add(bench);
    }
    return group;
  }

  /** A doorway recessed into the wall - shut, ajar, or burning behind. */
  function doorway({ side = 1, state = "shut" } = {}) {
    const group = new THREE.Group();
    group.name = `Doorway_${state}`;
    group.add(box(0.5, 3.2, 0.3, materials.darkMetal, 0, 0, -1.2));
    group.add(box(0.5, 3.2, 0.3, materials.darkMetal, 0, 0, 1.2));
    group.add(box(0.5, 0.35, 2.7, materials.darkMetal, 3.1));
    group.add(box(0.1, 3.2, 2.3, state === "fire" ? materials.fireBehind : materials.pitBlack, 0, side * 0.6));
    const door = box(0.08, 3.0, 2.2, materials.paintedMetal, 0, 0, 0);
    if (state === "ajar") {
      door.rotation.y = side * 1.1;
      door.position.set(side * 0.7, 1.5, -0.7);
    } else if (state === "fire") {
      door.visible = false;
      const f = fireSpot({ width: 2, depth: 1, height: 2.8 });
      f.position.x = side * 0.8;
      group.add(f);
    }
    group.add(door);
    const sign = box(0.05, 0.3, 1.2, materials.hazard, 3.5, -side * 0.28);
    group.add(sign);
    return group;
  }

  /** A hole blown through the wall, fire inside, rubble spilling out. */
  function wallBreach({ side = 1, seed } = {}) {
    const group = new THREE.Group();
    group.name = "WallBreach";
    group.add(box(0.2, 3.4, 3.6, materials.fireBehind, 0, side * 1.2));
    const random = rng(seed);
    for (let i = 0; i < 10; i += 1) {
      const r = mesh(geometries.rock, i % 2 ? materials.rubble : materials.rubbleDark);
      const s = 0.3 + random() * 0.6;
      r.scale.set(s, s * 0.7, s);
      r.position.set(-side * random() * 2.2, s * 0.3, (random() - 0.5) * 3.4);
      r.rotation.set(random(), random() * 3, random());
      group.add(r);
    }
    for (const z of [-1.9, 1.9]) {
      const jag = box(0.6, 3.6 + random(), 0.4, materials.rubbleDark, 0, 0, z);
      jag.rotation.x = (random() - 0.5) * 0.3;
      group.add(jag);
    }
    const f = fireSpot({ width: 2.6, depth: 1.4, height: 3.2, count: 18 });
    f.position.x = side * 0.5;
    group.add(f);
    const embers = emberJet({ count: 16 });
    embers.position.set(-side * 0.3, 1, 0);
    group.add(embers);
    group.userData.tick = (dt) => embers.userData.tick(dt);
    return group;
  }

  /** Wall-hugging bank of industrial pipes (the geothermal plant's pipe rig). */
  function pipeWall({ length = 8, height = 7 } = {}) {
    const group = new THREE.Group();
    group.name = "PipeWall";
    const stand = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
      const p = cyl(0.22 - i * 0.03, length, materials.ductMetal, { lowPoly: true });
      p.rotation.x = Math.PI / 2;
      p.position.set(i % 2 ? 0.25 : 0, 1.2 + i * 1.3, 0);
      stand.add(p);
    }
    group.add(stand);
    // The source rig is ~0.82 as long as it is tall; tile it to fill the run.
    const panel = height * 0.82;
    const count = Math.max(1, Math.round(length / panel));
    for (let i = 0; i < count; i += 1) {
      const slot = assetSlot("industrialPipes", { size: [1.0, height, length / count], longAxis: "z" }, i === 0 ? [stand] : []);
      slot.position.z = -length / 2 + (i + 0.5) * (length / count);
      slot.rotation.y = i % 2 ? Math.PI : 0;
      group.add(slot);
    }
    return group;
  }

/**
   * A hanging duct line along local Z: sections of the supplied duct kit on
   * straps, with vent grilles underneath. Origin is at the duct's centre line.
   */
  function ductRun({ length = 20, w = 1.3, h = 1.0, drop = 1.2 } = {}) {
    const group = new THREE.Group();
    group.name = "DuctRun";
    const stand = box(w, h, length, materials.ductMetal, -h / 2);
    group.add(stand);
    const pieces = Math.max(1, Math.round(length / 6));
    for (let i = 0; i < pieces; i += 1) {
      const slot = ductSlot(length / pieces, w, h, i === 0 ? [stand] : []);
      slot.position.z = -length / 2 + (i + 0.5) * (length / pieces);
      group.add(slot);
    }
    for (let z = -length / 2 + 1.5; z < length / 2; z += 3) {
      for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) group.add(box(0.04, drop, 0.08, materials.trim, h / 2, x, z));
    }
    for (let z = -length / 2 + 3; z < length / 2 - 1; z += 6) {
      const grille = assetSlot("ventGrille", { size: [w * 0.8, 0, w * 0.8], align: "top" });
      grille.position.set(0, -h / 2 - 0.01, z);
      group.add(grille);
    }
    return group;
  }

  /** Two parallel duct lines and a cross-feed, hung under a hall ceiling. */
  function ventNetwork({ width = 24, length = 36 } = {}) {
    const group = new THREE.Group();
    group.name = "VentNetwork";
    for (const side of [-1, 1]) {
      const run = ductRun({ length, w: 1.6, h: 1.2 });
      run.position.set(side * width * 0.28, -1.2, 0);
      group.add(run);
    }
    const cross = ductRun({ length: width * 0.56, w: 1.2, h: 1.0 });
    cross.rotation.y = Math.PI / 2;
    cross.position.set(0, -1.2, -length * 0.2);
    group.add(cross);
    return group;
  }

  function ventFanUnit() {
    const group = new THREE.Group();
    group.name = "VentFan";
    const stand = box(1.6, 1.6, 1.4, materials.ductMetal);
    group.add(stand);
    group.add(assetSlot("ventFan", { size: [0, 1.8, 0] }, [stand]));
    return group;
  }

  function ceilingFanUnit() {
    const group = new THREE.Group();
    group.name = "CeilingFan";
    const spinner = assetSlot("ceilingFan", { size: [1.8, 0, 1.8], align: "top" });
    group.add(spinner);
    const speed = 1.5 + Math.random() * 2;
    group.userData.tick = (dt) => {
      spinner.rotation.y += dt * speed;
    };
    return group;
  }

  /** Wall-mounted security camera, slowly panning. `side` = which wall. */
  function securityCam({ side = 1 } = {}) {
    const group = new THREE.Group();
    group.name = "SecurityCam";
    group.add(box(0.1, 0.1, 0.4, materials.trim, -0.05, 0, 0));
    const head = new THREE.Group();
    head.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // look away from its wall
    group.add(head);
    const stand = box(0.2, 0.2, 0.5, materials.paintedMetal, -0.1);
    head.add(stand);
    head.add(assetSlot("securityCamera", { size: [0, 0.35, 0], align: "top" }, [stand]));
    const led = mesh(geometries.unitSphere, materials.warning);
    led.scale.setScalar(0.05);
    led.position.set(0, -0.05, 0.3);
    head.add(led);
    const phase = Math.random() * 6;
    const base = head.rotation.y;
    group.userData.tick = (dt, time) => {
      head.rotation.y = base + Math.sin(time * 0.4 + phase) * 0.6;
    };
    return group;
  }

  function utilityBoxUnit() {
    const group = new THREE.Group();
    group.name = "UtilityBox";
    const stand = box(0.9, 1.1, 0.4, materials.paintedMetal);
    group.add(stand);
    group.add(assetSlot("utilityBox", { size: [1.0, 1.2, 0.5], longAxis: "x" }, [stand]));
    return group;
  }

  /**
   * The failed experiment itself: the supplied geothermal ring stood upright
   * across the route, a cracked energy core burning in its heart. The player
   * runs through it. This is where the reality-warp beat fires.
   */
  function experimentRing({ height = 15 } = {}) {
    const group = new THREE.Group();
    group.name = "ExperimentRing";
    const fallback = new THREE.Group();
    const torus = mesh(geometries.ring, materials.darkMetal);
    torus.scale.setScalar(height * 0.46);
    torus.position.y = height / 2;
    fallback.add(torus);
    group.add(fallback);
    const slot = assetSlot("experimentRing", { size: [0, height, 0], rotateX: Math.PI / 2 }, [fallback]);
    group.add(slot);

    const halo = mesh(geometries.ring, materials.energy, { cast: false, receive: false });
    halo.scale.setScalar(height * 0.38);
    halo.position.y = height / 2;
    group.add(halo);
    const halo2 = halo.clone();
    halo2.scale.setScalar(height * 0.33);
    group.add(halo2);

    const sparks = particleJet({ count: 40, material: materials.spark, spread: height * 0.7, rise: 2.5, life: 1.4 });
    sparks.position.y = 1;
    group.add(sparks);

    for (const x of [-1, 1]) {
      const f = fireSpot({ width: 3, depth: 2, height: 3.5, count: 18 });
      f.position.set(x * height * 0.42, 0, 0);
      group.add(f);
    }

    const anchor = new THREE.Object3D();
    anchor.position.y = height / 2;
    group.add(anchor);
    group.userData.emitter = {
      kind: "point", anchor, color: 0x7ef4ff, base: 20, distance: 28,
      intensityAt: (t) => 14 + Math.sin(t * 9) * 4 + (Math.random() < 0.05 ? 12 : 0),
    };
    group.userData.tick = (dt, time) => {
      halo.rotation.z = time * 0.7;
      halo2.rotation.z = -time * 1.1;
      halo.rotation.x = Math.sin(time * 0.5) * 0.15;
      materials.energy.opacity = 0.55 + Math.sin(time * 13) * 0.2 + (Math.random() < 0.04 ? 0.3 : 0);
      sparks.userData.tick(dt);
    };
    return group;
  }

  function hangingCables({ seed } = {}) {
    const group = new THREE.Group();
    group.name = "HangingCables";
    const random = rng(seed);
    for (let i = 0; i < 3; i += 1) {
      const x = (random() - 0.5) * 2;
      const drop = 2 + random() * 2.5;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, 7.5, -1),
        new THREE.Vector3(x + (random() - 0.5), 7.5 - drop, 0),
        new THREE.Vector3(x + (random() - 0.5) * 0.4, 7.5 - drop * 0.6, 1.2),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 5), materials.trim);
      tube.userData.disposeGeometry = tube.geometry;
      group.add(tube);
    }
    const sparks = particleJet({ count: 14, material: materials.spark, spread: 0.2, rise: -1.2, life: 0.6 });
    sparks.position.set(0, 4.5, 0.5);
    group.add(sparks);
    group.userData.tick = (dt, time) => {
      sparks.visible = Math.sin(time * 3.1) > 0.3;
      sparks.userData.tick(dt);
    };
    return group;
  }

  /** A fluorescent fitting hanging off one wire, flickering. */
  function brokenLight() {
    const group = new THREE.Group();
    group.name = "BrokenLight";
    const pivot = new THREE.Group();
    pivot.position.y = 7.5;
    group.add(pivot);
    const wire = cyl(0.015, 1.2, materials.trim, { lowPoly: true });
    wire.position.y = -0.6;
    pivot.add(wire);
    const fixture = new THREE.Group();
    fixture.position.y = -1.2;
    fixture.rotation.z = 0.9;
    pivot.add(fixture);
    fixture.add(box(0.3, 0.08, 1.4, materials.trim, 0.04));
    const tubeMat = materials.lightTube.clone();
    tracked.materials.push(tubeMat);
    const tube = box(0.12, 0.08, 1.3, tubeMat, -0.02);
    fixture.add(tube);
    const anchor = new THREE.Object3D();
    fixture.add(anchor);
    let on = 1;
    const phase = Math.random() * 10;
    group.userData.emitter = { kind: "point", anchor, color: 0xfff0d0, base: 5, distance: 9, intensityAt: () => on * 6 };
    group.userData.tick = (dt, time) => {
      on = Math.sin(time * 17 + phase) > 0.6 || Math.random() < 0.03 ? 1 : 0.05;
      tubeMat.emissiveIntensity = on * 2.4;
      pivot.rotation.x = Math.sin(time * 0.8 + phase) * 0.12;
    };
    return group;
  }

  /* -------------------------------------------------------------- */

  function dispose() {
    for (const material of tracked.materials) material.dispose?.();
    for (const geometry of tracked.geometries) geometry.dispose?.();
    for (const texture of tracked.textures) texture.dispose?.();
    textures.dispose();
  }

  return {
    materials,
    geometries,
    textures,
    box,
    // hazards
    barrier,
    rubbleWall,
    ceilingChunk,
    airDuct,
    floorGap,
    pendulum,
    laserGrid,
    fireVent,
    topplingShelf,
    rollingCylinder,
    slidingCart,
    glassPane,
    // pickups
    sack,
    powerup,
    // signage / fx
    evacSign,
    alarmBeacon,
    warningStrobe: alarmBeacon,
    fireSpot,
    emberJet,
    smokeJet,
    // dressing
    labGurney,
    ivStand,
    curtainRail,
    specimenTank,
    labBench,
    shelfUnit,
    cagePanel,
    labCell,
    consolePanel,
    observationWindow,
    doorway,
    wallBreach,
    pipeWall,
    ductRun,
    ventNetwork,
    ventFanUnit,
    ceilingFanUnit,
    securityCam,
    utilityBoxUnit,
    experimentRing,
    hangingCables,
    brokenLight,
    dispose,
  };
}
