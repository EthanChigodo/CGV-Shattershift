/**
 * Pooled dynamic lighting for the foundry.
 *
 * The level wants dozens of glowing things - furnace vents, warning strobes,
 * switch halos, swinging work lights - but every extra light in a Three.js
 * scene costs shader work on every lit pixel, and changing the light *count*
 * forces a material recompile, which shows up as a stutter mid-run.
 *
 * So the level never creates a light per object. It creates a fixed pool once,
 * and each frame binds the pool to the emitters nearest the player. Position,
 * colour, and intensity are plain uniforms, so rebinding is free. The count
 * never changes, so the shaders never recompile.
 */

import * as THREE from "../../three.js";

export class LightPool {
  /**
   * @param {{points?:number, spots?:number, shadows?:boolean}} options
   */
  constructor({ points = 7, spots = 2, shadows = false, brightness = 1 } = {}) {
    this.brightness = brightness;
    this.group = new THREE.Group();
    this.group.name = "PooledLighting";
    this.emitters = [];
    this._scratch = new THREE.Vector3();

    /**
     * 0 normally; raised by the level when the player is hit. Every pooled
     * light bleeds toward alarm red and spikes in intensity, so a collision
     * changes the whole corridor rather than just the screen. Because it only
     * touches colour and intensity uniforms, it costs nothing and cannot
     * trigger a shader recompile.
     */
    this.alarm = 0;
    this._alarmColour = new THREE.Color(0xff2a24);

    /**
     * A light that travels with the player, outside the emitter pool.
     *
     * Ambient fill raises everything by the same amount, which makes a scene
     * brighter and flatter at once - it was why turning the brightness up read
     * as washed out rather than lit. A travelling light does the opposite: it
     * gives the metal nearest the player highlights and falloff, so the corridor
     * has shape wherever the player happens to be, and the distance is still
     * allowed to go dark.
     */
    this.playerLight = new THREE.PointLight(0xffd9b0, 26, 26, 1.7);
    this.playerLight.name = "PlayerRigLight";
    this.group.add(this.playerLight);

    this.pointLights = [];
    for (let i = 0; i < points; i += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 16, 2);
      light.name = `PooledPoint_${i}`;
      this.group.add(light);
      this.pointLights.push(light);
    }

    this.spotLights = [];
    for (let i = 0; i < spots; i += 1) {
      const light = new THREE.SpotLight(0xffd9a8, 0, 22, Math.PI / 5, 0.55, 1.6);
      light.name = `PooledSpot_${i}`;
      // Only the closest work light casts shadows. Each shadow-casting light
      // re-renders the scene into a depth map, so a second one would roughly
      // double the level's draw calls for very little visible gain.
      light.castShadow = shadows && i === 0;
      if (light.castShadow) {
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.far = 24;
        light.shadow.bias = -0.0015;
      }
      this.group.add(light);
      this.group.add(light.target);
      this.spotLights.push(light);
    }
  }

  /**
   * Register an emitter. `anchor` is any Object3D already parented into the
   * scene; its world position is cached once, because foundry emitters are
   * bolted to the walls and do not travel.
   */
  register(emitter, routeDistance = 0) {
    const position = new THREE.Vector3();
    emitter.anchor.getWorldPosition(position);
    this.emitters.push({
      kind: emitter.kind ?? "point",
      color: new THREE.Color(emitter.color ?? 0xffffff),
      base: emitter.base ?? 8,
      distance: emitter.distance ?? 16,
      intensityAt: emitter.intensityAt ?? (() => emitter.base ?? 8),
      position,
      routeDistance,
    });
  }

  /** Number of emitters competing for the pool, for the performance readout. */
  get emitterCount() {
    return this.emitters.length;
  }

  /**
   * Bind the pool to the nearest emitters. `playerPosition` is a world-space
   * Vector3; sorting by route distance instead would also work, but world
   * distance keeps the pool correct around the 90-degree junctions where two
   * stretches of corridor sit close together.
   */
  update(playerPosition, time) {
    // Sits slightly above and ahead of the player so it lights the route rather
    // than the floor under their feet.
    this.playerLight.position.set(playerPosition.x, playerPosition.y + 2.6, playerPosition.z);
    this.playerLight.intensity = 22 * this.brightness * (1 + this.alarm * 0.8);
    if (this.alarm > 0.001) {
      this.playerLight.color.set(0xffd9b0).lerp(this._alarmColour, Math.min(1, this.alarm) * 0.85);
    } else {
      this.playerLight.color.set(0xffd9b0);
    }

    const point = [];
    const spot = [];

    for (const emitter of this.emitters) {
      const d2 = emitter.position.distanceToSquared(playerPosition);
      (emitter.kind === "spot" ? spot : point).push({ emitter, d2 });
    }

    point.sort((a, b) => a.d2 - b.d2);
    spot.sort((a, b) => a.d2 - b.d2);

    this._bind(this.pointLights, point, time, false);
    this._bind(this.spotLights, spot, time, true);
  }

  _bind(lights, candidates, time, isSpot) {
    for (let i = 0; i < lights.length; i += 1) {
      const light = lights[i];
      const entry = candidates[i];

      if (!entry) {
        light.intensity = 0;
        continue;
      }

      const { emitter } = entry;
      light.position.copy(emitter.position);
      light.color.copy(emitter.color);
      light.distance = emitter.distance;

      // Fade the light in over its last few metres of range so a light being
      // rebound to a further emitter never pops.
      const falloff =
        1 - THREE.MathUtils.smoothstep(Math.sqrt(entry.d2), emitter.distance * 1.1, emitter.distance * 2.2);
      light.intensity = emitter.intensityAt(time) * falloff * this.brightness;
      light.distance = emitter.distance * (0.85 + this.brightness * 0.25);

      if (this.alarm > 0.001) {
        const a = Math.min(1, this.alarm);
        light.color.lerp(this._alarmColour, a * 0.9);
        // Flicker the spike so it reads as an alarm, not a dimmer switch.
        light.intensity *= 1 + a * (1.6 + Math.sin(time * 34) * 0.5);
        light.distance = emitter.distance * (1 + a * 0.5);
      }

      if (isSpot) {
        light.target.position.set(emitter.position.x, emitter.position.y - 8, emitter.position.z);
        light.target.updateMatrixWorld();
      }
    }
  }

  dispose() {
    for (const light of [...this.pointLights, ...this.spotLights]) {
      light.parent?.remove(light);
      light.dispose?.();
    }
    this.emitters.length = 0;
  }
}

/**
 * Ambient fill for the foundry: a dim hemisphere plus one weak directional so
 * unlit metal still reads as metal. Everything dramatic comes from the pool.
 */
export function createFoundryAmbience({ brightness = 1 } = {}) {
  const group = new THREE.Group();
  group.name = "FoundryAmbience";

  // Enough fill that plating and grating stay readable at running speed - the
  // foundry is the dark level, but the guide is explicit that the floor path
  // and interactive objects must never be hard to read.
  //
  // `brightness` is the single knob for the whole level: it scales this fill
  // and every pooled light. 1.0 is the original moody authoring, 1.6 is the
  // default, and roughly 2.2 is as bright as it can go before the sector stops
  // reading as the dark one.
  // Fill is deliberately weak and scaled sub-linearly. Raising it in step with
  // brightness lifts lit and unlit surfaces equally, which flattens the image:
  // the sector got brighter and less readable at the same time. Shape comes
  // from the travelling player light, the pooled lights, and the directional
  // key instead.
  const hemisphere = new THREE.HemisphereLight(0x3d5361, 0x241a12, 0.72 * Math.sqrt(brightness));
  group.add(hemisphere);

  const key = new THREE.DirectionalLight(0xbcd8e8, 0.95 * brightness);
  key.position.set(4, 12, 3);
  group.add(key);

  group.userData.setBrightness = (value) => {
    hemisphere.intensity = 0.72 * Math.sqrt(value);
    key.intensity = 0.95 * value;
  };

  group.userData.dispose = () => {
    hemisphere.dispose?.();
    key.dispose?.();
  };

  return group;
}
