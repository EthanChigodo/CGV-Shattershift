/**
 * The city at night, seen from the top of Ascension Tower (the Roof).
 *
 * Towers in three finishes - warm office windows, cool glass, sparse
 * residential - stand up out of the haze from far below: they go all the
 * way down into the dark, so nothing floats. Some step back as they rise,
 * some carry a lit crown, the tallest a mast with a red aircraft light
 * blinking on it. Under it all the street grid glows: avenues and cross
 * streets in sodium orange, the traffic moving along them (white one way,
 * red the other). Police helicopters circle the tower, their searchlights
 * on the streets - and now and then on the roof.
 *
 * Windows are mapped in world space (one tile = 8 x 16 windows, 3.5 m
 * each), so a 400 m tower isn't a stretched 40 m one. One InstancedMesh per
 * finish, the street plane is one shader: a handful of draw calls.
 *
 *   const city = new CityAtNight({ seed: 41 });
 *   scene.add(city.root);
 *   city.loadHelicopters(assetBase);   // optional
 *   city.update(dt, time, { fog: scene.fog });
 *   city.dispose();
 */

import * as THREE from "../../three.js";
import { PoliceHelicopters } from "../../fx/police-helicopters.js";

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** A tile of windows: 8 columns, 16 rows. */
function windowTile(seed, { lit = 0.3, warm = 0.8, cool = "160,200,255" } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let y = 0; y < 16; y += 1) {
    // Whole floors lit or dark together now and then (offices after hours).
    const floor = r() < 0.15 ? 0 : r() < 0.1 ? 2 : 1;
    for (let x = 0; x < 8; x += 1) {
      const on = floor === 2 || (floor === 1 && r() < lit);
      if (!on) { g.fillStyle = "rgba(10,12,16,1)"; }
      else if (r() < warm) g.fillStyle = `rgba(255,${170 + r() * 60},${90 + r() * 70},${0.55 + r() * 0.45})`;
      else g.fillStyle = `rgba(${cool},${0.55 + r() * 0.4})`;
      // A window between mullions, a spandrel panel under it.
      g.fillRect(x * 32 + 6, y * 16 + 4, 20, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * World-space window mapping (and dark roofs) for an instanced tower material.
 * And demolition: per instance, aFall = (metres fallen, lights out 0..1).
 * Everything above the street drops by aFall.x; a point that reaches the
 * heap stops at a tenth of its old height above the street - the building
 * crushed into a pile, its lowest floors at the bottom - and spreads out.
 */
function worldWindows(material, tileW = 18, tileH = 52, streetY = -160) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vCityNormal;\nvarying float vCityHash;\nvarying float vCityTop;\nvarying float vCityFall;\nvarying float vCityRubble;\n#ifdef USE_INSTANCING\nattribute vec2 aFall;\n#endif")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vCityFall = 0.0;
        vCityRubble = 0.0;
        #ifdef USE_INSTANCING
          if (aFall.x > 0.0) {
            float citySy = length(instanceMatrix[1].xyz);
            float cityBaseY = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
            float cityY = cityBaseY + transformed.y * citySy;
            float cityGround = ${(streetY + 1.5).toFixed(1)};
            if (cityY > cityGround) {
              float heap = cityGround + (cityY - cityGround) * 0.1;
              float fell = cityY - aFall.x;
              vCityRubble = clamp((heap - fell) / 12.0, 0.0, 1.0);
              // The facade buckles as it goes, floor by floor.
              transformed.x += sin(cityY * 0.31 + instanceMatrix[3].x) * 0.012 * min(aFall.x / 25.0, 1.0);
              transformed.xz *= 1.0 + vCityRubble * 0.45;
              transformed.y = (max(fell, heap) - cityBaseY) / citySy;
            }
            vCityFall = aFall.y;
          }
        #endif`)
      .replace("#include <fog_vertex>", `#include <fog_vertex>
        mat4 cityM = modelMatrix;
        #ifdef USE_INSTANCING
          cityM = modelMatrix * instanceMatrix;
          vCityHash = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #else
          vCityHash = 0.0;
        #endif
        vCityPos = (cityM * vec4(position, 1.0)).xyz;
        vCityTop = (cityM * vec4(0.0, 1.0, 0.0, 1.0)).y;   // the unit box's top
        vCityNormal = normalize(mat3(cityM) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vCityNormal;\nvarying float vCityHash;\nvarying float vCityTop;\nvarying float vCityFall;\nvarying float vCityRubble;")
      .replace("#include <emissivemap_fragment>", `
        vec2 cuv = abs(vCityNormal.x) > 0.5 ? vec2(vCityPos.z, vCityPos.y) : vec2(vCityPos.x, vCityPos.y);
        cuv = cuv / vec2(${tileW.toFixed(1)}, ${tileH.toFixed(1)}) + vec2(vCityHash * 7.0, vCityHash * 3.0);
        vec4 cityWindows = texture2D(emissiveMap, cuv);
        // Roofs have no windows; the lowest floors fade into the haze.
        cityWindows.rgb *= step(abs(vCityNormal.y), 0.5);
        totalEmissiveRadiance *= cityWindows.rgb;
        // Floodlit crowns: most towers have lamps along the parapet washing
        // the top floors - warm sodium or cool white - in pools between the
        // lamps, fading down the facade. Lit stone, not just a dark box.
        float cityWall = step(abs(vCityNormal.y), 0.5);
        float cityBelow = max(vCityTop - vCityPos.y, 0.0);
        float cityFloodOn = step(0.3, fract(vCityHash * 7.13));
        vec3 cityFlood = mix(vec3(1.0, 0.7, 0.42), vec3(0.72, 0.84, 1.0), step(0.72, fract(vCityHash * 3.7)));
        float cityPools = 0.55 + 0.45 * cos(cuv.x * 6.2831853 * 2.0);
        vec3 cityStone = mix(diffuseColor.rgb * 3.0, vec3(0.42, 0.37, 0.31), 0.55);
        totalEmissiveRadiance += cityStone * cityFlood * exp(-cityBelow / 20.0) * cityPools * cityFloodOn * cityWall * 1.7;
        // Coming down: the lights go out (but for a glow off the fires), the
        // falling block greys with its own dust, and the heap is broken concrete.
        totalEmissiveRadiance *= 1.0 - vCityFall * 0.85;
        totalEmissiveRadiance += vec3(0.11, 0.09, 0.075) * vCityFall;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.18, 0.16), max(vCityRubble, vCityFall * 0.5));`);
  };
  material.customProgramCacheKey = () => `cityWindows${tileW}x${tileH}+flood+fall`;
}

const STREETS_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const STREETS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHaze;
  uniform vec3 uCentre;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  // A street of width w along one axis: its lamps, and traffic both ways.
  vec3 street(float across, float along, float w, float period, float speed, float lane) {
    float road = 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.5, abs(across));
    vec3 c = vec3(1.0, 0.55, 0.18) * road * 0.22;                        // sodium on the tarmac
    float lamps = (1.0 - smoothstep(0.0, 1.2, abs(mod(along, 24.0) - 12.0))) * (1.0 - smoothstep(w * 0.5, w * 0.5 + 2.5, abs(abs(across) - w * 0.5)));
    c += vec3(1.0, 0.7, 0.35) * lamps * 0.9;
    // Cars: white heading one way on one side, red going away on the other.
    float cellA = floor((along + uTime * speed) / period);
    float carA = step(0.55, hash(vec2(cellA, lane))) * (1.0 - smoothstep(0.0, 2.0, abs(mod(along + uTime * speed, period) - period * 0.5)));
    float cellB = floor((along - uTime * speed * 0.8) / period);
    float carB = step(0.55, hash(vec2(cellB, lane + 7.0))) * (1.0 - smoothstep(0.0, 2.0, abs(mod(along - uTime * speed * 0.8, period) - period * 0.5)));
    float sideA = 1.0 - smoothstep(0.6, 1.6, abs(across - w * 0.2));
    float sideB = 1.0 - smoothstep(0.6, 1.6, abs(across + w * 0.2));
    c += vec3(1.0, 0.95, 0.8) * carA * sideA * 1.6 + vec3(1.0, 0.12, 0.06) * carB * sideB * 1.3;
    return c;
  }
  void main() {
    vec2 p = vWorld.xz;
    vec3 col = vec3(0.0);
    // Cross streets every 70 m, an avenue every 210 m (wider, busier).
    vec2 cell = p / 70.0;
    vec2 local = (fract(cell) - 0.5) * 70.0;
    vec2 id = floor(cell);
    bool avenueX = mod(id.y, 3.0) < 0.5;
    bool avenueZ = mod(id.x, 3.0) < 0.5;
    col += street(local.y, p.x, avenueX ? 18.0 : 10.0, avenueX ? 26.0 : 40.0, avenueX ? 14.0 : 8.0, id.y);
    col += street(local.x, p.y, avenueZ ? 18.0 : 10.0, avenueZ ? 26.0 : 40.0, avenueZ ? 14.0 : 8.0, id.x + 50.0);
    // The blocks between: dark, a few lit windows and courtyards.
    vec2 b = floor(p / 6.0);
    col += vec3(1.0, 0.8, 0.5) * step(0.985, hash(b)) * 0.5;
    // Haze: the further, the more it melts into the night's glow.
    float d = length(vWorld - cameraPosition);
    float haze = 1.0 - exp(-d * 0.0042);
    // Nothing right under the tower (its own footprint is dark).
    float under = smoothstep(26.0, 60.0, length(p - uCentre.xz));
    col = mix(col * under, uHaze, haze);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class CityAtNight {
  /**
   * @param {object} [o]
   * @param {number} [o.seed]
   * @param {number} [o.streetY]   how far down the streets are
   * @param {THREE.Vector3} [o.centre]  the tower you're standing on
   * @param {boolean} [o.towers]  false: just the streets (a city model stands on them)
   * @param {{x:number, z:number, r:number}[]} [o.clear]  spots (from the centre) left
   *   empty, for landmarks to stand in (landmarks.js)
   * @param {{x:number, z:number, top:number, w:number, d:number, yaw?:number, finish?:number}[]} [o.condemned]
   *   towers like all the others, but placed (from the centre) where they
   *   can be seen, to be brought down (`demolitions`; demolition.js, with
   *   setFall()). Clear their spots of the others with `clear`.
   */
  constructor({ seed = 41, streetY = -160, centre = new THREE.Vector3(), towers: withTowers = true, neighbours = 0, clear = [], condemned = [] } = {}) {
    this.root = new THREE.Group();
    this.root.name = "CityAtNight";
    this.owned = [];
    const own = (x) => (this.owned.push(x), x);
    const r = rng(seed);
    const unit = own(new THREE.BoxGeometry(1, 1, 1));
    unit.translate(0, 0.5, 0); // origin at the base

    // Three finishes.
    const finishes = [
      { colour: 0x37332e, metal: 0.25, rough: 0.8, tile: own(windowTile(seed + 1, { lit: 0.3, warm: 0.85 })), glow: 0.62, count: 70 },
      { colour: 0x1b2633, metal: 0.75, rough: 0.22, tile: own(windowTile(seed + 2, { lit: 0.22, warm: 0.3, cool: "150,210,255" })), glow: 0.5, count: 50 },
      { colour: 0x5a3326, metal: 0.1, rough: 0.92, tile: own(windowTile(seed + 3, { lit: 0.15, warm: 0.95 })), glow: 0.55, count: 60 },
    ];
    const towers = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const crowns = [];
    const masts = [];
    /** Tops of towers, for the rooftop clutter: [x, y, z, w, d, yaw, distance]. */
    const roofs = [];
    /** Where the towers stand, for whatever goes on the streets: {x, z, r, top} from the centre. */
    this.footprints = [];
    /** Every tower: where, how tall, and its instances (for demolition). */
    const records = [];
    /** The towers to be brought down (`condemned`), in their order. */
    this.demolitions = [];
    this.streetY = streetY;
    for (const f of withTowers ? finishes : []) {
      const fi = finishes.indexOf(f);
      // Lambert, not standard: the towers are a night backdrop (dark facades,
      // lit windows), and the physically-based shading of every one of the
      // scene's lights on every distant pixel was most of the roof's frame.
      const material = own(new THREE.MeshLambertMaterial({ color: f.colour, emissive: 0xffffff, emissiveMap: f.tile, emissiveIntensity: f.glow }));
      worldWindows(material, 18, 52, streetY);
      const pieces = [];
      for (let i = 0; i < f.count; i += 1) {
        const a = r() * Math.PI * 2;
        const d = 70 + Math.pow(r(), 0.8) * 230;
        // Mostly below you (the tallest tower in the city); further out, a
        // few that reach your height and past it, so there is a skyline.
        const top = -95 + r() * 75 + (d > 170 && r() < 0.3 ? 40 + r() * 40 : 0);
        const w = 14 + r() * 22;
        const depth = w * (0.6 + r() * 0.7);
        const yaw = Math.round(r() * 4) * (Math.PI / 2) + (r() - 0.5) * 0.2;
        const cx = Math.cos(a) * d + centre.x;
        const cz = Math.sin(a) * d + centre.z;
        // From deep in the haze up to the top - or to a setback, and a
        // narrower block on that.
        const setback = r() < 0.35 ? 12 + r() * 30 : 0;
        const base = streetY - 260;
        // Inside a landmark's spot: drawn from the same random numbers (so
        // the rest of the skyline doesn't change), just not built.
        const open = !clear.some((c) => Math.hypot(cx - centre.x - c.x, cz - centre.z - c.z) < c.r + w * 0.7);
        const rec = { x: cx, z: cz, top, w, d: depth, yaw, dist: d, pieces: [], crown: -1, mast: -1 };
        if (open) records.push(rec);
        if (open) rec.pieces.push([fi, pieces.length]);
        if (open) pieces.push([cx, base, cz, w, top - setback - base, depth, yaw]);
        if (setback && open) rec.pieces.push([fi, pieces.length]);
        if (setback && open) pieces.push([cx, top - setback, cz, w * 0.68, setback, depth * 0.68, yaw]);
        const topW = setback ? w * 0.68 : w;
        if (open) roofs.push([cx, top, cz, topW, setback ? depth * 0.68 : depth, yaw, d, rec]);
        if (open) this.footprints.push({ x: cx - centre.x, z: cz - centre.z, r: Math.hypot(w, depth) / 2, top });
        if (r() < 0.3) {
          const crown = [cx, top - 2.2, cz, topW + 0.3, 2.0, (setback ? depth * 0.68 : depth) + 0.3, yaw, r() < 0.6 ? 0xffe2a8 : 0x9fe8ff];
          if (open) rec.crown = crowns.length;
          if (open) crowns.push(crown);
        }
        if (top > -40 && r() < 0.7) {
          const mast = [cx, top, cz, 8 + r() * 18];
          if (open) rec.mast = masts.length;
          if (open) masts.push(mast);
        }
      }
      // Neighbours: a few towers close by (45-85 m) that come up to about
      // your height, so from the roof the city stands round you rather than
      // all of it lying far below.
      for (let i = 0; i < neighbours; i += 1) {
        const a = ((i + finishes.indexOf(f) / finishes.length) / neighbours) * Math.PI * 2 + (r() - 0.5) * 0.5;
        const d = 46 + r() * 40;
        const top = -16 + r() * 30;
        const w = 12 + r() * 12;
        const depth = w * (0.7 + r() * 0.5);
        const yaw = Math.round(r() * 4) * (Math.PI / 2);
        const cx = Math.cos(a) * d + centre.x;
        const cz = Math.sin(a) * d + centre.z;
        const base = streetY - 260;
        const open = !clear.some((c) => Math.hypot(cx - centre.x - c.x, cz - centre.z - c.z) < c.r + w * 0.7);
        const crown = [cx, top - 2.2, cz, w + 0.3, 2.0, depth + 0.3, yaw, r() < 0.6 ? 0xffe2a8 : 0x9fe8ff];
        const mast = [cx, top, cz, 6 + r() * 10];
        if (open) {
          const rec = { x: cx, z: cz, top, w, d: depth, yaw, dist: d, pieces: [[fi, pieces.length]], crown: crowns.length, mast: masts.length };
          records.push(rec);
          roofs.push([cx, top, cz, w, depth, yaw, d, rec]);
          this.footprints.push({ x: cx - centre.x, z: cz - centre.z, r: Math.hypot(w, depth) / 2, top });
          pieces.push([cx, base, cz, w, top - base, depth, yaw]);
          crowns.push(crown);
          masts.push(mast);
        }
      }
      // The condemned: like the rest, in this finish, but placed by hand (and
      // drawing no random numbers, so the rest of the skyline stays put).
      for (const c of condemned) {
        if ((c.finish ?? 0) !== fi) continue;
        const cx = centre.x + c.x;
        const cz = centre.z + c.z;
        const base = streetY - 260;
        const yaw = c.yaw ?? 0;
        const rec = { x: cx, z: cz, top: c.top, w: c.w, d: c.d, yaw, dist: Math.hypot(c.x, c.z), pieces: [[fi, pieces.length]], crown: crowns.length, mast: masts.length, demolish: true };
        pieces.push([cx, base, cz, c.w, c.top - base, c.d, yaw]);
        crowns.push([cx, c.top - 2.2, cz, c.w + 0.3, 2.0, c.d + 0.3, yaw, 0xffe2a8]);
        masts.push([cx, c.top, cz, 14]);
        this.footprints.push({ x: c.x, z: c.z, r: Math.hypot(c.w, c.d) / 2, top: c.top });
        records.push(rec);
        this.demolitions.push(rec);
      }
      // Its own box: the per-instance aFall lives on the geometry.
      const box = own(unit.clone());
      box.setAttribute("aFall", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, pieces.length) * 2), 2).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.InstancedMesh(box, material, pieces.length);
      pieces.forEach(([x, y, z, sx, sy, sz, yaw], i) => {
        q.setFromAxisAngle(up, yaw);
        m.compose(p.set(x, y, z), q, s.set(sx, sy, sz));
        mesh.setMatrixAt(i, m);
      });
      mesh.frustumCulled = false;
      this.root.add(mesh);
      towers.push(mesh);
    }
    this.towers = towers;
    // In the order they were given.
    this.demolitions.sort((a, b) => condemned.findIndex((c) => c.x === a.x - centre.x && c.z === a.z - centre.z) - condemned.findIndex((c) => c.x === b.x - centre.x && c.z === b.z - centre.z));
    if (withTowers) this._buildRooftops(roofs.filter((roof) => !roof[7]?.demolish), seed, own, centre);

    // Lit crowns: a glowing band round some of the tops.
    if (crowns.length) {
      const crownMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }));
      const crownMesh = new THREE.InstancedMesh(unit, crownMat, crowns.length);
      const colour = new THREE.Color();
      crowns.forEach(([x, y, z, sx, sy, sz, yaw, c], i) => {
        q.setFromAxisAngle(up, yaw);
        m.compose(p.set(x, y, z), q, s.set(sx, sy, sz));
        crownMesh.setMatrixAt(i, m);
        crownMesh.setColorAt(i, colour.set(c).multiplyScalar(0.8));
      });
      crownMesh.frustumCulled = false;
      this.root.add(crownMesh);
      this._crownMesh = crownMesh;
    }
    this._crowns = crowns;
    this._masts = masts;
    this._mastLights = [];

    // Masts, and the red aircraft lights on them (blinking together, as they do).
    const glow = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.3, "rgba(255,255,255,0.5)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return own(t);
    })();
    this.beacons = own(new THREE.SpriteMaterial({ map: glow, color: 0xff2a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    if (masts.length) {
      const mastMat = own(new THREE.MeshLambertMaterial({ color: 0x2a2c30 }));
      const mastMesh = new THREE.InstancedMesh(unit, mastMat, masts.length);
      masts.forEach(([x, y, z, h], i) => {
        m.compose(p.set(x, y, z), q.identity(), s.set(0.6, h, 0.6));
        mastMesh.setMatrixAt(i, m);
        const light = new THREE.Sprite(this.beacons);
        light.position.set(x, y + h + 0.6, z);
        light.scale.setScalar(5);
        this.root.add(light);
        this._mastLights.push(light);
      });
      this.root.add(mastMesh);
      this._mastMesh = mastMesh;
    }

    // The streets far below.
    this.streetUniforms = { uTime: { value: 0 }, uHaze: { value: new THREE.Color(0.11, 0.06, 0.035) }, uCentre: { value: centre.clone() } };
    const streets = new THREE.Mesh(own(new THREE.PlaneGeometry(900, 900, 1, 1)), own(new THREE.ShaderMaterial({
      uniforms: this.streetUniforms, vertexShader: STREETS_VERTEX, fragmentShader: STREETS_FRAGMENT, fog: false, depthWrite: true,
    })));
    streets.rotation.x = -Math.PI / 2;
    streets.position.set(centre.x, streetY, centre.z);
    streets.name = "Streets";
    this.root.add(streets);

    this.police = null;
    this.centre = centre.clone();
  }

  /**
   * Life on the roofs you look down on: water tanks on stands, air-con
   * units, and now and then a painted billboard for a made-up company,
   * turned to face the tower. A random stream of its own, so the towers
   * themselves don't move. A few instanced meshes in all.
   */
  _buildRooftops(roofs, seed, own, centre) {
    const r = rng(seed + 500);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tanks = [];
    const stands = [];
    const units = [];
    const boards = [[], [], []];
    const posts = [];
    const near = roofs.filter(([, y, , , , , d]) => d < 260 && y > -120);
    for (const [x, y, z, w, d, yaw] of near) {
      const spot = (fx, fz) => {
        const ox = (fx - 0.5) * (w - 4);
        const oz = (fz - 0.5) * (d - 4);
        return [x + Math.cos(yaw) * ox + Math.sin(yaw) * oz, z - Math.sin(yaw) * ox + Math.cos(yaw) * oz];
      };
      if (r() < 0.6) {
        const [tx, tz] = spot(r() < 0.5 ? 0.15 : 0.85, r());
        const radius = 1.4 + r() * 1.2;
        stands.push([tx, y, tz, radius * 1.4, 2.2, radius * 1.4, 0]);
        tanks.push([tx, y + 2.2, tz, radius, 3 + r() * 1.5, radius, 0]);
      }
      const count = r() < 0.7 ? 1 + Math.floor(r() * 3) : 0;
      for (let i = 0; i < count; i += 1) {
        const [ux, uz] = spot(r(), r());
        units.push([ux, y, uz, 2.4, 1.4, 1.6, yaw]);
      }
      // Billboards on some of the nearer, lower roofs, facing the tower.
      if (y > -75 && y < 15 && r() < 0.16) {
        const [bx, bz] = spot(0.5, 0.5);
        const face = Math.atan2(centre.x - bx, centre.z - bz);
        const kind = Math.floor(r() * boards.length);
        boards[kind].push([bx, y + 4.5, bz, face]);
        for (const side of [-1, 1]) posts.push([bx + Math.cos(face) * side * 5, y, bz - Math.sin(face) * side * 5, 0.35, 4.2, 0.35, face]);
      }
    }
    const unit = own(new THREE.BoxGeometry(1, 1, 1));
    unit.translate(0, 0.5, 0);
    const drum = own(new THREE.CylinderGeometry(1, 1, 1, 12));
    drum.translate(0, 0.5, 0);
    const steel = own(new THREE.MeshLambertMaterial({ color: 0x6a6c70 }));
    const tankMat = own(new THREE.MeshLambertMaterial({ color: 0x8b8f92 }));
    const instanced = (geometry, material, list) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach(([x, y, z, sx, sy, sz, yaw], i) => {
        q.setFromAxisAngle(up, yaw);
        mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(sx, sy, sz)));
      });
      mesh.frustumCulled = false;
      this.root.add(mesh);
    };
    instanced(unit, steel, stands);
    instanced(drum, tankMat, tanks);
    instanced(unit, steel, units);
    instanced(unit, steel, posts);
    const ads = [
      ["UMNANDI COLA", "ICE COLD, EVERY DAY", "#c8231d", "#ffffff", "#ffe36b"],
      ["IGOLIDE FM 101.6", "THE SOUND OF THE CITY", "#13306b", "#ffd23f", "#ffffff"],
      ["SIYAKHA CEMENT", "BUILT TO LAST", "#e9e1cf", "#2b2b2b", "#b8321e"],
    ];
    const board = own(new THREE.PlaneGeometry(13, 4.9));
    boards.forEach((list, k) => {
      if (!list.length) return;
      const [title, line, ground, ink, accent] = ads[k];
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 192;
      const g = c.getContext("2d");
      g.fillStyle = ground;
      g.fillRect(0, 0, 512, 192);
      g.fillStyle = accent;
      g.fillRect(0, 150, 512, 42);
      g.fillStyle = ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "bold 64px Impact, Arial Black, sans-serif";
      g.fillText(title, 256, 78, 488);
      g.fillStyle = ground;
      g.font = "bold 26px Arial, sans-serif";
      g.fillText(line, 256, 171, 480);
      const t = own(new THREE.CanvasTexture(c));
      t.colorSpace = THREE.SRGBColorSpace;
      // Lit by its own lamps: a little brighter than the night round it.
      const mat = own(new THREE.MeshBasicMaterial({ map: t, color: 0xb8aa96, fog: true }));
      const mesh = new THREE.InstancedMesh(board, mat, list.length);
      list.forEach(([x, y, z, face], i) => {
        q.setFromAxisAngle(up, face);
        mesh.setMatrixAt(i, m.compose(p.set(x, y + 2.45, z), q, s.set(1, 1, 1)));
      });
      mesh.frustumCulled = false;
      this.root.add(mesh);
    });
  }

  /**
   * Bring a tower (one of `demolitions`) down: `drop` metres fallen, `dark`
   * its lights going out (0..1). Its crown band and mast ride down with it
   * until they reach the heap.
   */
  setFall(tower, drop, dark) {
    for (const [fi, index] of tower.pieces) {
      const attribute = this.towers[fi].geometry.attributes.aFall;
      attribute.setXY(index, drop, dark);
      attribute.needsUpdate = true;
    }
    const heap = this.streetY + 1.5 + (tower.top - this.streetY) * 0.1;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (tower.crown >= 0 && this._crownMesh) {
      const [x, y, z, sx, sy, sz, yaw] = this._crowns[tower.crown];
      const gone = y - drop < heap;
      m.compose(new THREE.Vector3(x, y - drop, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(sx, sy, sz).multiplyScalar(gone ? 0 : 1));
      this._crownMesh.setMatrixAt(tower.crown, m);
      this._crownMesh.instanceMatrix.needsUpdate = true;
    }
    if (tower.mast >= 0 && this._mastMesh) {
      const [x, y, z, h] = this._masts[tower.mast];
      const gone = y - drop < heap;
      m.compose(new THREE.Vector3(x, y - drop, z), q.identity(), new THREE.Vector3(0.6, h, 0.6).multiplyScalar(gone ? 0 : 1));
      this._mastMesh.setMatrixAt(tower.mast, m);
      this._mastMesh.instanceMatrix.needsUpdate = true;
      const light = this._mastLights[tower.mast];
      light.position.y = y + h + 0.6 - drop;
      light.visible = !gone && dark < 0.9;
    }
  }

  /** Police helicopters circling the tower (assets/meltdown/police_helicopter.glb). */
  async loadHelicopters(assetBase, { count = 3 } = {}) {
    this.police = new PoliceHelicopters({ count, seed: 17, craftScale: 1 });
    this.root.add(this.police.root);
    await this.police.load(assetBase);
  }

  /**
   * @param {number} dt
   * @param {number} time
   * @param {object} [o]
   * @param {THREE.Color} [o.haze]  the night's glow the streets melt into
   */
  update(dt, time, { haze = null } = {}) {
    this.streetUniforms.uTime.value = time;
    if (haze) this.streetUniforms.uHaze.value.copy(haze).multiplyScalar(1.6);
    // Aircraft lights: a slow on-off, as on real masts.
    this.beacons.opacity = Math.sin(time * 2.4) > 0.1 ? 1 : 0.08;
    // Orbiting the tower; the searchlights on the streets, now and then on the roof.
    this.police?.update(dt, time, {
      worldZ: (d) => this.centre.z + 70 - d, distance: 0,
      deckY: 0, overDeck: true, spotZ: this.centre.z, spotSpread: 9, cityY: -150,
    });
  }

  dispose() {
    this.police?.dispose();
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
