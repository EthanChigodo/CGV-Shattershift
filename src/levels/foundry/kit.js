/**
 * The Shifting Foundry modular kit.
 *
 * The project guide asks for "5-8 reusable structural pieces per level, then
 * vary their scale, rotation, spacing, lighting, and combinations" rather than
 * one hand-modelled scene. This file is that kit. Every piece is a factory
 * returning a `THREE.Object3D`; pieces that move attach a `userData.tick`
 * callback, and the level walks those each frame.
 *
 * The eight pieces:
 *   1. wallSegment   - ribbed plating with hazard trim, the corridor shell
 *   2. floorSection  - grated walkway with kerbs and an emissive centre seam
 *   3. ceilingRig    - overhead beam, conduits, and a swinging work light
 *   4. pistonBank    - hierarchical housing -> shaft -> head, a solid hazard
 *   5. conveyor      - side belt with scrolling texture and spinning rollers
 *   6. heatVent      - furnace grille, flickering light, and a steam jet
 *   7. shutterWall   - hazard-striped slab that advances or retracts on cue
 *   8. switchNode    - the breakable cyan glass switch that reshapes the route
 *
 * Support pieces: warningStrobe, turnChevrons, sparkBurst.
 *
 * Materials, geometries, and textures are created per kit instance and freed by
 * `kit.dispose()`, so unloading the level releases its GPU memory.
 */

import * as THREE from "../../three.js";
import { createFoundryTextures } from "./textures.js";

export function createFoundryKit({ shadows = false } = {}) {
  const textures = createFoundryTextures();

  /* -------------------------------------------------------------- */
  /* Shared materials                                                */
  /* -------------------------------------------------------------- */

  const materials = {
    plating: new THREE.MeshStandardMaterial({
      map: textures.platingColour,
      normalMap: textures.platingNormal,
      normalScale: new THREE.Vector2(1.35, 1.35),
      metalness: 0.86,
      roughness: 0.44,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1b2228, metalness: 0.9, roughness: 0.32 }),
    grate: new THREE.MeshStandardMaterial({
      map: textures.grateColour,
      normalMap: textures.grateNormal,
      normalScale: new THREE.Vector2(1.6, 1.6),
      metalness: 0.82,
      roughness: 0.52,
    }),
    hazard: new THREE.MeshStandardMaterial({
      map: textures.hazardColour,
      normalMap: textures.hazardNormal,
      metalness: 0.62,
      roughness: 0.58,
    }),
    heat: new THREE.MeshStandardMaterial({
      map: textures.heatPanel,
      emissiveMap: textures.heatPanel,
      emissive: 0xff6a1e,
      emissiveIntensity: 1.9,
      metalness: 0.3,
      roughness: 0.7,
    }),
    belt: new THREE.MeshStandardMaterial({ color: 0x15191d, metalness: 0.35, roughness: 0.82 }),
    // Breakable objects share the recognisable cyan glass language of Level 1.
    switchGlass: new THREE.MeshPhysicalMaterial({
      color: 0x7ef4f1,
      transmission: 0.45,
      transparent: true,
      opacity: 0.62,
      roughness: 0.08,
      metalness: 0.06,
      thickness: 0.4,
      emissive: 0x1b6d74,
      emissiveIntensity: 1.1,
    }),
    switchHousing: new THREE.MeshStandardMaterial({ color: 0x202a30, metalness: 0.92, roughness: 0.28 }),
    warning: new THREE.MeshStandardMaterial({
      color: 0x3a0d12,
      emissive: 0xd8242e,
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.5,
    }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffe6b8 }),
    // The centre guide line. Bright enough to read the lane at speed, dim
    // enough not to bloom over the floor at a grazing camera angle.
    seam: new THREE.MeshBasicMaterial({ color: 0x2e9aa4 }),
    steam: new THREE.PointsMaterial({
      map: textures.steam,
      color: 0x9fb0b8,
      size: 0.95,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      sizeAttenuation: true,
    }),
    spark: new THREE.PointsMaterial({
      map: textures.spark,
      color: 0xffb765,
      size: 0.35,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  };

  /* -------------------------------------------------------------- */
  /* Shared geometries                                               */
  /* -------------------------------------------------------------- */

  const geometries = {
    wallPanel: new THREE.BoxGeometry(0.42, 7.4, 8),
    wallRib: new THREE.BoxGeometry(0.62, 7.4, 0.34),
    floorPlate: new THREE.BoxGeometry(11.2, 0.3, 8),
    kerb: new THREE.BoxGeometry(0.5, 0.44, 8),
    seamStrip: new THREE.BoxGeometry(0.16, 0.04, 7.6),
    beam: new THREE.BoxGeometry(11.6, 0.42, 0.5),
    conduit: new THREE.CylinderGeometry(0.14, 0.14, 11.4, 8),
    lampHousing: new THREE.ConeGeometry(0.52, 0.62, 10, 1, true),
    lampBulb: new THREE.SphereGeometry(0.17, 8, 6),
    pistonHousing: new THREE.CylinderGeometry(0.78, 0.9, 1.5, 12),
    pistonShaft: new THREE.CylinderGeometry(0.3, 0.3, 1, 10),
    pistonHead: new THREE.BoxGeometry(2.3, 0.75, 2.3),
    roller: new THREE.CylinderGeometry(0.38, 0.38, 2.1, 12),
    beltSurface: new THREE.BoxGeometry(2.1, 0.16, 9),
    ventFrame: new THREE.BoxGeometry(0.34, 3.1, 3.1),
    ventPanel: new THREE.PlaneGeometry(2.6, 2.6),
    shutterSlab: new THREE.BoxGeometry(4.6, 6.6, 0.7),
    shutterEdge: new THREE.BoxGeometry(0.3, 6.6, 0.86),
    switchHousing: new THREE.BoxGeometry(1.5, 0.36, 0.5),
    switchGlass: new THREE.BoxGeometry(1.16, 1.34, 0.24),
    switchStem: new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6),
    strobeLens: new THREE.SphereGeometry(0.24, 10, 8),
    chevron: new THREE.BoxGeometry(1.5, 0.14, 0.42),
  };

  // Cloned materials and cloned textures are tracked here too - disposing a
  // material does not dispose the textures it references, which is exactly the
  // kind of leak the guide warns about when levels are swapped.
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

  /** Small reusable particle jet. Recycled in place, so nothing is allocated per frame. */
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
          array[i * 3] += drift * dt;
          array[i * 3 + 1] += speeds[i] * dt;
        }
      }
      geometry.attributes.position.needsUpdate = true;
    };

    points.userData.disposeGeometry = geometry;
    return points;
  }

  /* -------------------------------------------------------------- */
  /* 1. Wall segment                                                 */
  /* -------------------------------------------------------------- */

  /**
   * One 8m length of corridor wall. `side` is -1 for the left wall, 1 for the
   * right. Ribs are spaced unevenly so repeated segments do not read as tiling.
   */
  function wallSegment({ side = 1, halfWidth = 5.6, hazardTrim = true, seed = 0 } = {}) {
    const group = new THREE.Group();
    group.name = `WallSegment_${side > 0 ? "R" : "L"}`;

    const panel = mesh(geometries.wallPanel, materials.plating);
    panel.position.set(side * halfWidth, 3.7, 0);
    group.add(panel);

    const ribCount = 3 + (seed % 2);
    for (let i = 0; i < ribCount; i += 1) {
      const rib = mesh(geometries.wallRib, materials.trim);
      rib.position.set(side * (halfWidth - 0.22), 3.7, -3.2 + (i * 8) / ribCount + (seed % 3) * 0.3);
      rib.scale.y = 0.82 + ((seed + i) % 3) * 0.09;
      group.add(rib);
    }

    if (hazardTrim) {
      const trim = mesh(geometries.wallRib, materials.hazard);
      trim.scale.set(0.6, 0.1, 22);
      trim.position.set(side * (halfWidth - 0.26), 0.62, 0);
      group.add(trim);
    }

    return group;
  }

  /* -------------------------------------------------------------- */
  /* 2. Floor section                                                */
  /* -------------------------------------------------------------- */

  function floorSection({ glow = true } = {}) {
    const group = new THREE.Group();
    group.name = "FloorSection";

    const plate = mesh(geometries.floorPlate, materials.grate, { cast: false });
    plate.position.y = -0.16;
    group.add(plate);

    for (const side of [-1, 1]) {
      const kerb = mesh(geometries.kerb, materials.trim);
      kerb.position.set(side * 5.2, 0.16, 0);
      group.add(kerb);
    }

    if (glow) {
      const seam = new THREE.Mesh(geometries.seamStrip, materials.seam);
      seam.position.y = 0.01;
      group.add(seam);
    }

    return group;
  }

  /* -------------------------------------------------------------- */
  /* 3. Ceiling rig                                                  */
  /* -------------------------------------------------------------- */

  /**
   * Overhead beam with conduits and a work light that sways. When `light` is
   * true it carries a real SpotLight - the level only switches these on for a
   * handful of rigs, because dynamic lights are the expensive part.
   */
  function ceilingRig({ light = false, sway = 0.16, seed = 0 } = {}) {
    const group = new THREE.Group();
    group.name = "CeilingRig";

    const beam = mesh(geometries.beam, materials.trim);
    beam.position.y = 7.1;
    group.add(beam);

    for (const offset of [-2.6, 2.9]) {
      const conduit = mesh(geometries.conduit, materials.trim);
      conduit.rotation.z = Math.PI / 2;
      conduit.position.set(0, 7.5 + (offset > 0 ? 0.24 : 0), offset * 0.12);
      conduit.scale.set(0.8, 1, 0.8);
      group.add(conduit);
    }

    const pivot = new THREE.Group();
    pivot.position.set(seed % 2 ? -2.6 : 2.6, 6.9, 0);
    group.add(pivot);

    const housing = mesh(geometries.lampHousing, materials.trim);
    housing.position.y = -0.5;
    housing.rotation.x = Math.PI;
    pivot.add(housing);

    const bulb = new THREE.Mesh(geometries.lampBulb, materials.lamp);
    bulb.position.y = -0.72;
    pivot.add(bulb);

    if (light) {
      // No light object is created here. The rig registers itself as an emitter
      // and the level's light pool binds one of its few real lights to the
      // nearest rigs each frame - see lighting.js.
      const anchor = new THREE.Object3D();
      anchor.position.set(0, -0.8, 0);
      pivot.add(anchor);
      group.userData.emitter = { kind: "spot", anchor, color: 0xffd9a8, base: 24 };
    }

    const phase = seed * 1.7;
    group.userData.tick = (dt, time) => {
      pivot.rotation.z = Math.sin(time * 0.9 + phase) * sway;
    };

    return group;
  }

  /* -------------------------------------------------------------- */
  /* 4. Piston bank                                                  */
  /* -------------------------------------------------------------- */

  /**
   * Hierarchical machinery: housing -> shaft -> head. The shaft stretches while
   * the head travels, which is what sells it as one mechanism rather than three
   * boxes. The head is a solid hazard - it cannot be destroyed, only timed.
   */
  function pistonBank({ speed = 1.4, phase = 0, reach = 3.4, fromCeiling = true } = {}) {
    const group = new THREE.Group();
    group.name = "PistonBank";

    const housing = mesh(geometries.pistonHousing, materials.trim);
    housing.position.y = fromCeiling ? 7.0 : 0.4;
    group.add(housing);

    const shaft = mesh(geometries.pistonShaft, materials.plating);
    group.add(shaft);

    const head = mesh(geometries.pistonHead, materials.hazard);
    head.userData = { kind: "hazard", solid: true, piston: true };
    group.add(head);

    const anchorY = fromCeiling ? 6.4 : 0.9;
    const direction = fromCeiling ? -1 : 1;

    group.userData.tick = (dt, time) => {
      // 0 at rest, 1 fully extended, with a snap out and a slower retract.
      const wave = Math.sin(time * speed + phase);
      const extension = Math.pow(Math.max(0, wave), 0.6);
      const travel = extension * reach;

      head.position.y = anchorY + direction * travel;
      shaft.position.y = anchorY + (direction * travel) / 2;
      shaft.scale.y = Math.max(0.12, travel);
    };
    group.userData.tick(0, 0);

    group.userData.hazardMesh = head;
    return group;
  }

  /* -------------------------------------------------------------- */
  /* 5. Conveyor                                                     */
  /* -------------------------------------------------------------- */

  function conveyor({ side = 1, speed = 1.1, halfWidth = 5.6 } = {}) {
    const group = new THREE.Group();
    group.name = "Conveyor";

    const beltMaterial = materials.belt.clone();
    beltMaterial.map = textures.grateColour.clone();
    beltMaterial.map.repeat.set(1, 3);
    beltMaterial.map.needsUpdate = true;
    tracked.materials.push(beltMaterial);
    tracked.textures.push(beltMaterial.map);

    const belt = mesh(geometries.beltSurface, beltMaterial, { cast: false });
    belt.position.set(side * (halfWidth - 1.5), 1.05, 0);
    group.add(belt);

    const rollers = [];
    for (const z of [-4.2, 0, 4.2]) {
      const roller = mesh(geometries.roller, materials.trim);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(side * (halfWidth - 1.5), 1.05, z);
      group.add(roller);
      rollers.push(roller);
    }

    // Crates riding the belt give the machinery something to carry.
    const crates = [];
    for (let i = 0; i < 3; i += 1) {
      const crate = mesh(geometries.switchHousing, materials.plating);
      crate.scale.set(1.1, 2.4, 2.2);
      crate.position.set(side * (halfWidth - 1.5), 1.55, -4 + i * 4);
      group.add(crate);
      crates.push(crate);
    }

    group.userData.tick = (dt) => {
      beltMaterial.map.offset.y = (beltMaterial.map.offset.y + dt * speed * 0.4) % 1;
      for (const roller of rollers) roller.rotation.x += dt * speed * 3;
      for (const crate of crates) {
        crate.position.z += dt * speed * 2.4;
        if (crate.position.z > 4.6) crate.position.z = -4.6;
      }
    };

    return group;
  }

  /* -------------------------------------------------------------- */
  /* 6. Heat vent                                                    */
  /* -------------------------------------------------------------- */

  function heatVent({ side = 1, halfWidth = 5.6, seed = 0, light = true } = {}) {
    const group = new THREE.Group();
    group.name = "HeatVent";

    const frame = mesh(geometries.ventFrame, materials.trim);
    frame.position.set(side * (halfWidth - 0.1), 2.4, 0);
    group.add(frame);

    const panelMaterial = materials.heat.clone();
    tracked.materials.push(panelMaterial);
    const panel = new THREE.Mesh(geometries.ventPanel, panelMaterial);
    panel.position.set(side * (halfWidth - 0.32), 2.4, 0);
    panel.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(panel);

    const steam = particleJet({
      count: 24,
      material: materials.steam,
      spread: 1.5,
      rise: 1.6,
      life: 2.6,
      drift: -side * 0.5,
    });
    steam.position.set(side * (halfWidth - 1.1), 1.2, 0);
    group.add(steam);

    const phase = seed * 2.3;
    // Furnace flicker: two out-of-phase sines read as irregular combustion.
    const flickerAt = (time) =>
      0.72 + Math.sin(time * 5.3 + phase) * 0.18 + Math.sin(time * 11.7 + phase) * 0.1;

    if (light) {
      const anchor = new THREE.Object3D();
      anchor.position.set(side * (halfWidth - 1.4), 2.4, 0);
      group.add(anchor);
      group.userData.emitter = {
        kind: "point",
        anchor,
        color: 0xff6a1e,
        base: 9,
        distance: 16,
        intensityAt: (time) => 6 + flickerAt(time) * 5,
      };
    }

    group.userData.tick = (dt, time) => {
      steam.userData.tick(dt);
      panelMaterial.emissiveIntensity = 1.35 + flickerAt(time);
    };

    return group;
  }

  /* -------------------------------------------------------------- */
  /* 7. Shutter wall                                                 */
  /* -------------------------------------------------------------- */

  /**
   * A hazard-striped slab on a rail. `setProgress(0..1)` drives it from fully
   * open to fully closed, so the level can use the same piece for a switch that
   * retracts a wall and for the closing walls of the finale.
   */
  function shutterWall({ side = 1, halfWidth = 5.6, closedOffset = 2.3, progress = 0 } = {}) {
    const group = new THREE.Group();
    group.name = "ShutterWall";

    const rail = mesh(geometries.beam, materials.trim);
    rail.scale.set(1, 0.7, 1.4);
    rail.position.set(0, 7.0, 0);
    group.add(rail);

    const slab = mesh(geometries.shutterSlab, materials.hazard);
    group.add(slab);

    // Emissive leading edge. Hazard stripes disappear in the unlit stretches of
    // the furnace, and a closing gate the player cannot see is not a challenge,
    // it is an ambush. Emissive shows with or without a light on it.
    const edge = mesh(geometries.shutterEdge, materials.warning);
    edge.position.x = -side * 2.3;
    slab.add(edge);

    // Fully open, the slab is tucked outside the corridor wall; fully closed,
    // the pair meets on the centre line. Half-closed leaves only the centre
    // lane passable, which is what the finale's escape is built around.
    const openX = side * (halfWidth + 2.8);
    const closedX = side * closedOffset;

    let current = progress;
    let target = progress;

    const apply = () => {
      slab.position.set(THREE.MathUtils.lerp(openX, closedX, current), 3.3, 0);
    };
    apply();

    group.userData.setProgress = (value, instant = false) => {
      target = THREE.MathUtils.clamp(value, 0, 1);
      if (instant) {
        current = target;
        apply();
      }
    };
    group.userData.getProgress = () => current;
    group.userData.hazardMesh = slab;

    group.userData.tick = (dt) => {
      if (Math.abs(current - target) > 0.001) {
        current = THREE.MathUtils.damp(current, target, 3.2, dt);
        apply();
      }
    };

    return group;
  }

  /* -------------------------------------------------------------- */
  /* 8. Switch node                                                  */
  /* -------------------------------------------------------------- */

  /**
   * The interactive piece: reinforced cyan glass on a housing. Breaking it runs
   * `action`, which is how a shot retracts a wall, stops a piston, or rotates a
   * bridge. Solid hazards use red metal and a blockier silhouette so the player
   * never has to guess what can be broken.
   */
  function switchNode({ x = 0, y = 2.3, label = "SWITCH", action = null, points = 200 } = {}) {
    const group = new THREE.Group();
    group.name = "SwitchNode";
    group.position.set(x, 0, 0);

    const stem = mesh(geometries.switchStem, materials.switchHousing);
    stem.position.y = y - 0.95;
    group.add(stem);

    const housing = mesh(geometries.switchHousing, materials.switchHousing);
    housing.position.y = y - 0.78;
    group.add(housing);

    const glassMaterial = materials.switchGlass.clone();
    tracked.materials.push(glassMaterial);
    const glass = mesh(geometries.switchGlass, glassMaterial);
    glass.position.y = y;
    glass.userData = {
      kind: "switch",
      breakable: true,
      alive: true,
      points,
      label,
      action,
      node: group,
    };
    group.add(glass);

    const anchor = new THREE.Object3D();
    anchor.position.y = y;
    group.add(anchor);

    const pulseAt = (time) => 0.85 + Math.sin(time * 3.1 + x) * 0.35;

    group.userData.emitter = {
      kind: "point",
      anchor,
      color: 0x7ef4f1,
      base: 4.5,
      distance: 10,
      intensityAt: (time) => (glass.userData.alive ? 3.2 + pulseAt(time) * 2.2 : 0),
    };

    group.userData.glass = glass;
    group.userData.tick = (dt, time) => {
      if (!glass.userData.alive) return;
      // A slow pulse plus a slow spin makes the switch findable at running speed.
      glassMaterial.emissiveIntensity = pulseAt(time);
      glass.rotation.y = Math.sin(time * 0.8 + x) * 0.28;
    };

    group.userData.onBreak = () => {
      if (!glass.userData.alive) return false;
      glass.userData.alive = false;
      glass.visible = false;
      if (typeof action === "function") action();
      return true;
    };

    return group;
  }

  /* -------------------------------------------------------------- */
  /* Support pieces                                                  */
  /* -------------------------------------------------------------- */

  /**
   * Jump/slide obstacle. A `low` barrier is hurdled, a `high` one is slid
   * under. Both are solid red-metal hazards, never breakable, so the silhouette
   * alone tells the player to move rather than shoot.
   */
  function barrier({ x = 0, kind = "low", width = 3.4 } = {}) {
    const group = new THREE.Group();
    group.name = `Barrier_${kind}`;

    const slab = mesh(geometries.pistonHead, materials.hazard);
    const isLow = kind === "low";
    slab.scale.set(width / 2.3, isLow ? 1.5 : 1.1, 0.42);
    slab.position.set(x, isLow ? 0.56 : 3.55, 0);
    slab.userData = { kind: "hazard", solid: true, barrier: kind };
    group.add(slab);

    // Support posts tie the barrier to the corridor so it reads as installed.
    for (const side of [-1, 1]) {
      const post = mesh(geometries.switchStem, materials.trim);
      post.scale.set(1.1, isLow ? 0.7 : 3.4, 1.1);
      post.position.set(x + side * (width / 2), isLow ? 0.4 : 2.1, 0);
      group.add(post);
    }

    group.userData.hazardMesh = slab;
    return group;
  }

  function warningStrobe({ x = 0, y = 5.4, speed = 3.4, phase = 0 } = {}) {
    const group = new THREE.Group();
    group.name = "WarningStrobe";

    const lensMaterial = materials.warning.clone();
    tracked.materials.push(lensMaterial);
    const lens = mesh(geometries.strobeLens, lensMaterial);
    lens.position.set(x, y, 0);
    group.add(lens);

    const anchor = new THREE.Object3D();
    anchor.position.set(x, y, 0);
    group.add(anchor);

    group.userData.armed = true;
    const strengthAt = (time) =>
      group.userData.armed ? Math.pow(Math.max(0, Math.sin(time * speed + phase)), 3) : 0;

    group.userData.emitter = {
      kind: "point",
      anchor,
      color: 0xd8242e,
      base: 11,
      distance: 13,
      intensityAt: (time) => strengthAt(time) * 11,
    };

    group.userData.tick = (dt, time) => {
      lensMaterial.emissiveIntensity = 0.3 + strengthAt(time) * 3.4;
    };

    return group;
  }

  /** Floor chevrons that point into a 90-degree route turn. */
  function turnChevrons({ direction = -1, count = 4 } = {}) {
    const group = new THREE.Group();
    group.name = "TurnChevrons";

    const chevronMaterial = materials.warning.clone();
    tracked.materials.push(chevronMaterial);

    for (let i = 0; i < count; i += 1) {
      const chevron = new THREE.Mesh(geometries.chevron, chevronMaterial);
      chevron.position.set(direction * (i * 0.55 - 0.8), 0.06, -i * 1.5);
      chevron.rotation.y = direction * Math.PI * 0.18;
      group.add(chevron);
    }

    group.userData.tick = (dt, time) => {
      chevronMaterial.emissiveIntensity = 1.1 + Math.sin(time * 4.5) * 0.8;
      group.children.forEach((chevron, index) => {
        chevron.position.y = 0.06 + Math.max(0, Math.sin(time * 4.5 - index * 0.7)) * 0.12;
      });
    };

    return group;
  }

  function sparkBurst({ count = 26 } = {}) {
    const jet = particleJet({ count, material: materials.spark, spread: 0.8, rise: 2.4, life: 1.1 });
    jet.name = "SparkBurst";
    return jet;
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
    wallSegment,
    floorSection,
    ceilingRig,
    pistonBank,
    conveyor,
    heatVent,
    shutterWall,
    switchNode,
    barrier,
    warningStrobe,
    turnChevrons,
    sparkBurst,
    dispose,
  };
}
