/**
 * The foreground: the roof of the building across the street from the
 * burning tower, where Subject 07 stands at the parapet.
 *
 * Wet after rain. The roof membrane (photographed tarred gravel, the same
 * set the Roof level uses) is damp all over and holds puddles in its low
 * spots: a mask from the stage's noise, in world space, turns the surface
 * dark and mirror-smooth there, flattens its normal, and the stage's
 * environment map (captured from this very scene) puts the burning tower,
 * the sky and the searchlights in the water. Rain rings break the puddles
 * now and then.
 *
 * Round it: a concrete parapet with a coping, an old timber water tank on
 * a steel stand, two condenser units, the stair bulkhead with a caged lamp
 * over its door (a practical light, warm), a lattice antenna whose red
 * aircraft light blinks on the wet roof, vent stacks, a conduit.
 *
 * Every piece is a few boxes and cylinders: at night, against the city's
 * glow, they read as silhouettes - the shapes matter, not the polygons.
 */

import * as THREE from "../three.js";

const TEXTURES = new URL("../../assets/meltdown/textures/", import.meta.url);

/** The roof, in stage coordinates: top surface at y = 0. */
export const ROOF = { minX: -16, maxX: 12, minZ: -6, maxZ: 24, parapet: 1.05 };

/**
 * Wet: damp everywhere, puddles in the low spots (world-space mask from the
 * noise texture's low octaves), rain rings in the puddles.
 */
function wetMaterial(material, noise, uniforms, { puddles = 1, damp = 0.55 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetNoise = { value: noise };
    shader.uniforms.uWetTime = uniforms.uTime;
    shader.uniforms.uRain = uniforms.uRain;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWetWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWetWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWetWorld;
        uniform sampler2D uWetNoise;
        uniform float uWetTime;
        uniform float uRain;
        float wetMask() {
          vec2 p = vWetWorld.xz * 0.045;
          float n = texture2D(uWetNoise, p).r * 0.7 + texture2D(uWetNoise, p * 3.3 + 0.27).a * 0.3;
          return smoothstep(0.56, 0.6, n) * ${puddles.toFixed(2)};
        }
        // Rain rings: a grid of cells, each with a ring that grows and fades.
        vec2 ripples(vec2 p, float t) {
          vec2 g = p * 2.2;
          vec2 cell = floor(g);
          vec2 f = fract(g) - 0.5;
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float phase = fract(t * 0.7 + h * 7.0);
          vec2 c = vec2(fract(h * 13.1), fract(h * 71.3)) - 0.5;
          vec2 d = f - c * 0.5;
          float r = length(d);
          float ring = sin((r - phase * 0.45) * 60.0) * smoothstep(0.08, 0.0, abs(r - phase * 0.45)) * (1.0 - phase);
          return d / max(r, 1e-3) * ring * step(0.55, h);
        }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        float wet = wetMask();
        diffuseColor.rgb *= mix(${(1 - damp * 0.45).toFixed(3)}, 0.22, wet);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * ${(1 - damp * 0.4).toFixed(3)}, 0.035, wet);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, wet * 0.92));
        if (uRain > 0.0 && wet > 0.1) {
          vec2 rp = ripples(vWetWorld.xz, uWetTime) * uRain * wet;
          normal = normalize(normal + (viewMatrix * vec4(rp.x, 0.0, rp.y, 0.0)).xyz * 0.35);
        }`);
  };
  material.customProgramCacheKey = () => `menuWet${puddles}${damp}`;
  return material;
}

function loadSet(manager, set, srgbRepeat) {
  const loader = new THREE.TextureLoader(manager);
  const one = (file, srgb) => new Promise((resolve) => {
    loader.load(new URL(file, TEXTURES).href, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.repeat.set(srgbRepeat[0], srgbRepeat[1]);
      resolve(t);
    }, undefined, () => resolve(null));
  });
  return Promise.all([one(`${set}_diff_1k.jpg`, true), one(`${set}_nor_gl_1k.jpg`, false), one(`${set}_rough_1k.jpg`, false)]);
}

/** Vertical timber staves for the water tank (drawn). */
function staveTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#3a2a1e";
  g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 8) {
    const v = 40 + Math.floor(Math.random() * 30);
    g.fillStyle = `rgb(${v + 14},${v},${v - 10})`;
    g.fillRect(x, 0, 7, 128);
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(x + 7, 0, 1, 128);
  }
  for (let i = 0; i < 400; i += 1) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * 256, Math.random() * 128, 1 + Math.random() * 3, 4 + Math.random() * 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class MenuRoof {
  constructor({ noise, manager, quality = "medium" }) {
    this.root = new THREE.Group();
    this.root.name = "MenuRoof";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    this.uniforms = { uTime: { value: 0 }, uRain: { value: quality === "low" ? 0 : 1 } };
    const R = ROOF;
    const w = R.maxX - R.minX;
    const d = R.maxZ - R.minZ;
    const cx = (R.minX + R.maxX) / 2;
    const cz = (R.minZ + R.maxZ) / 2;
    const box = own(new THREE.BoxGeometry(1, 1, 1));
    const part = (material, sx, sy, sz, x, y, z, { cast = true, receive = true, ry = 0 } = {}) => {
      const m = new THREE.Mesh(box, material);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = cast;
      m.receiveShadow = receive;
      this.root.add(m);
      return m;
    };

    // ---- The roof membrane ----
    this.roofMat = own(wetMaterial(new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.92, metalness: 0 }), noise, this.uniforms, { puddles: 1, damp: 0.6 }));
    const surface = new THREE.Mesh(own(new THREE.PlaneGeometry(w, d, 1, 1)), this.roofMat);
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(cx, 0, cz);
    surface.receiveShadow = true;
    surface.name = "RoofSurface";
    this.root.add(surface);
    // UVs in metres / 3 (the photo tiles every 3 m).
    const uv = surface.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * w / 3, uv.getY(i) * d / 3);

    // ---- Parapet: concrete wall, a coping on top ----
    this.concrete = own(new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.85 }));
    this.coping = own(wetMaterial(new THREE.MeshStandardMaterial({ color: 0x77736e, roughness: 0.6, metalness: 0.05 }), noise, this.uniforms, { puddles: 0, damp: 0.7 }));
    const H = R.parapet;
    const t = 0.32;
    const walls = [
      [w + t * 2, H, t, cx, H / 2, R.minZ - t / 2],
      [w + t * 2, H, t, cx, H / 2, R.maxZ + t / 2],
      [t, H, d, R.minX - t / 2, H / 2, cz],
      [t, H, d, R.maxX + t / 2, H / 2, cz],
    ];
    for (const [sx, sy, sz, x, y, z] of walls) {
      part(this.concrete, sx, sy, sz, x, y, z);
      part(this.coping, sx + (sx > sz ? 0.06 : 0.12), 0.07, sz + (sz > sx ? 0.06 : 0.12), x, H + 0.035, z);
    }
    // The building's face below the parapet's front (seen over the edge).
    const face = own(new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 }));
    part(face, w + 0.7, 3, 0.4, cx, -1.5, R.minZ - 0.2, { cast: false });

    // ---- Condenser units ----
    this.metal = own(new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.5, metalness: 0.6 }));
    const dark = own(new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.7, metalness: 0.3 }));
    const fanGeo = own(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 24));
    for (const [x, z, ry] of [[-8.2, -2.4, 0.04], [-8.4, 0.6, -0.03]]) {
      part(this.metal, 2.6, 1.25, 2.1, x, 0.75, z, { ry });
      part(dark, 2.7, 0.12, 2.2, x, 0.06, z, { ry });
      for (const k of [-0.6, 0.6]) {
        const fan = new THREE.Mesh(fanGeo, dark);
        fan.position.set(x + k, 1.39, z);
        this.root.add(fan);
      }
      // Pipes to the wall.
      part(dark, 0.08, 0.08, 1.4, x + 1.1, 0.35, z - 1.6);
    }

    // ---- The water tank: timber staves, steel hoops, a conical cap, on a stand ----
    this.stave = own(staveTexture());
    this.stave.repeat.set(4, 1);
    const timber = own(new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.stave, roughness: 0.8 }));
    const steel = own(new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.55, metalness: 0.7 }));
    const tank = new THREE.Group();
    tank.position.set(-11.2, 0, 9.5);
    const legH = 4.2;
    for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const leg = new THREE.Mesh(box, steel);
      leg.scale.set(0.22, legH, 0.22);
      leg.position.set(lx, legH / 2, lz);
      leg.castShadow = true;
      tank.add(leg);
    }
    for (const y of [1.4, 3.0]) {
      for (const [sx, sz, lx, lz] of [[3.4, 0.1, 0, -1.6], [3.4, 0.1, 0, 1.6], [0.1, 3.4, -1.6, 0], [0.1, 3.4, 1.6, 0]]) {
        const b = new THREE.Mesh(box, steel);
        b.scale.set(sx, 0.1, sz);
        b.position.set(lx, y, lz);
        tank.add(b);
      }
    }
    const deck = new THREE.Mesh(box, steel);
    deck.scale.set(4.2, 0.2, 4.2);
    deck.position.y = legH;
    tank.add(deck);
    const barrel = new THREE.Mesh(own(new THREE.CylinderGeometry(2.25, 2.4, 4.4, 28, 1, true)), timber);
    barrel.position.y = legH + 2.3;
    barrel.castShadow = true;
    tank.add(barrel);
    const capMat = own(new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.85 }));
    const cap = new THREE.Mesh(own(new THREE.ConeGeometry(2.55, 1.6, 28)), capMat);
    cap.position.y = legH + 4.5 + 0.8;
    tank.add(cap);
    const finial = new THREE.Mesh(own(new THREE.SphereGeometry(0.16, 8, 6)), steel);
    finial.position.y = legH + 6.2;
    tank.add(finial);
    const hoopGeo = own(new THREE.TorusGeometry(2.33, 0.035, 4, 40));
    for (const y of [0.4, 1.2, 2.0, 2.8, 3.6]) {
      const hoop = new THREE.Mesh(hoopGeo, steel);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = legH + 0.15 + y;
      tank.add(hoop);
    }
    // A ladder up its side.
    for (const lx of [-0.25, 0.25]) {
      const rail = new THREE.Mesh(box, steel);
      rail.scale.set(0.05, legH + 4.5, 0.05);
      rail.position.set(lx, (legH + 4.5) / 2, 2.45);
      tank.add(rail);
    }
    for (let y = 0.4; y < legH + 4.4; y += 0.35) {
      const rung = new THREE.Mesh(box, steel);
      rung.scale.set(0.5, 0.03, 0.03);
      rung.position.set(0, y, 2.45);
      tank.add(rung);
    }
    this.root.add(tank);

    // ---- The stair bulkhead, its door and caged lamp ----
    const hut = own(new THREE.MeshStandardMaterial({ color: 0x55524d, roughness: 0.88 }));
    part(hut, 4.2, 3.2, 3.6, 5.5, 1.6, 15.5);
    part(this.coping, 4.5, 0.12, 3.9, 5.5, 3.26, 15.5);
    const door = own(new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.45, metalness: 0.6 }));
    part(door, 1.0, 2.1, 0.06, 4.6, 1.05, 13.68, { cast: false });
    this.lampMat = own(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc070, emissiveIntensity: 6 }));
    const bulb = new THREE.Mesh(own(new THREE.SphereGeometry(0.1, 10, 8)), this.lampMat);
    bulb.position.set(4.6, 2.45, 13.55);
    this.root.add(bulb);
    const cage = new THREE.Mesh(own(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 8, 1, true)), own(new THREE.MeshStandardMaterial({ color: 0x111111, wireframe: true })));
    cage.position.copy(bulb.position);
    this.root.add(cage);
    this.lamp = new THREE.PointLight(0xffb060, 5, 9, 1.6);
    this.lamp.position.set(4.6, 2.35, 13.2);
    this.root.add(this.lamp);

    // ---- Antenna mast with its red aircraft light ----
    const mast = new THREE.Group();
    mast.position.set(9.4, 0, 19.5);
    const mastH = 10;
    for (const [lx, lz] of [[-0.22, -0.22], [0.22, -0.22], [0, 0.25]]) {
      const leg = new THREE.Mesh(own(new THREE.CylinderGeometry(0.035, 0.05, mastH, 5)), steel);
      leg.position.set(lx, mastH / 2, lz);
      mast.add(leg);
    }
    for (let y = 0.6; y < mastH; y += 0.7) {
      const ring = new THREE.Mesh(own(new THREE.TorusGeometry(0.26, 0.015, 3, 3)), steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      mast.add(ring);
    }
    const dish = new THREE.Mesh(own(new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, 0.9)), this.metal);
    dish.rotation.x = -1.1;
    dish.rotation.z = 0.5;
    dish.position.set(0.4, mastH * 0.62, 0.3);
    mast.add(dish);
    this.beaconMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.4, 0.25) }));
    const beacon = new THREE.Mesh(own(new THREE.SphereGeometry(0.1, 10, 8)), this.beaconMat);
    beacon.position.y = mastH + 0.12;
    mast.add(beacon);
    this.beaconLight = new THREE.PointLight(0xff2a1a, 3, 16, 1.4);
    this.beaconLight.position.set(0, mastH, 0);
    mast.add(this.beaconLight);
    this.beaconGlowMat = own(new THREE.SpriteMaterial({ color: 0xff3020, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
    this.root.add(mast);
    this.beaconAt = new THREE.Vector3(9.4, mastH + 0.12, 19.5);

    // ---- Vent stacks and a conduit run ----
    const pipe = own(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 12));
    for (const [x, z, h] of [[-3.5, 6, 1.3], [-2.9, 6.4, 1.0], [8.5, 4, 1.5]]) {
      const v = new THREE.Mesh(pipe, steel);
      v.scale.y = h / 1.6;
      v.position.set(x, h / 2, z);
      v.castShadow = true;
      this.root.add(v);
      const hood = new THREE.Mesh(own(new THREE.CylinderGeometry(0.28, 0.2, 0.18, 12)), steel);
      hood.position.set(x, h + 0.09, z);
      this.root.add(hood);
    }
    part(steel, 0.09, 0.09, d - 2, R.maxX - 0.45, 0.18, cz, { cast: false });
    part(steel, 0.09, 0.09, d - 2, R.maxX - 0.6, 0.18, cz, { cast: false });
    // Supports under the conduit.
    for (let z = R.minZ + 1; z < R.maxZ - 1; z += 3) part(dark, 0.4, 0.12, 0.12, R.maxX - 0.52, 0.06, z, { cast: false });
    // A roof drain at the low spot, by the figure.
    const drain = new THREE.Mesh(own(new THREE.CircleGeometry(0.18, 16)), dark);
    drain.rotation.x = -Math.PI / 2;
    drain.position.set(1.5, 0.004, -3.2);
    this.root.add(drain);

    // The photographed surfaces, when they arrive (drawn colours until then).
    this.ready = Promise.all([
      loadSet(manager, "tarred_gravel", [w / 3, d / 3]).then(([map, nor, rough]) => {
        if (!map) return;
        own(map); own(nor); own(rough);
        map.repeat.set(1, 1);
        nor.repeat.set(1, 1);
        rough.repeat.set(1, 1);
        Object.assign(this.roofMat, { map, normalMap: nor, roughnessMap: rough, roughness: 1 });
        this.roofMat.color.set(0x9a948c);
        this.roofMat.normalScale.set(0.8, 0.8);
        this.roofMat.needsUpdate = true;
      }),
      loadSet(manager, "painted_concrete", [2, 1]).then(([map, nor, rough]) => {
        if (!map) return;
        own(map); own(nor); own(rough);
        for (const m of [this.concrete, hut]) {
          Object.assign(m, { map, normalMap: nor, roughnessMap: rough, roughness: 1 });
          m.color.set(0x8c8882);
          m.needsUpdate = true;
        }
      }),
      loadSet(manager, "metal_plate", [1, 1]).then(([map, nor, rough]) => {
        if (!map) return;
        own(map); own(nor); own(rough);
        Object.assign(this.metal, { map, normalMap: nor, roughnessMap: rough });
        this.metal.needsUpdate = true;
      }),
    ]);
  }

  update(dt, time, { reducedMotion = false } = {}) {
    this.uniforms.uTime.value = time;
    // The aircraft light: one second on, one off (as real ones go).
    const on = Math.sin(time * Math.PI * 0.9) > 0.15;
    this.beaconMat.color.setRGB(on ? 8 : 0.25, on ? 0.4 : 0.02, on ? 0.25 : 0.01);
    this.beaconLight.intensity = on ? 3.2 : 0;
    // The caged lamp buzzes a little.
    this.lamp.intensity = 5 * (reducedMotion ? 1 : 0.94 + 0.06 * Math.sin(time * 37) * Math.sin(time * 3.1));
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
