/**
 * Johannesburg on the skyline, seen from the roof: three landmarks anyone
 * from the city knows by their shape, standing among the generic towers of
 * CityAtNight so the city is ours and not just any city.
 *
 *   Hillbrow Tower   ~269 m  a tall concrete shaft, a wider head of window
 *                            bands near the top, an antenna, red lights
 *   Ponte City       ~173 m  a hollow cylinder of flats with a giant lit
 *                            sign ring round the top
 *   Carlton Centre   ~223 m  a dark slab of narrow vertical concrete fins
 *
 * They are built from primitives and drawn by one shader in four modes, so
 * there are no models to license. The Ponte sign carries a made-up name
 * (PONTE_SIGN), not a real company's: a real logo would need the company's
 * permission, more so on a city that is burning. The landmarks stay
 * standing; it is the generic towers that come down.
 *
 * Heights are real (metres above the street) and the three stand roughly
 * where they do from a CBD rooftop - the Carlton Centre close by to the east,
 * Ponte and the Hillbrow Tower further off to the north - but nearer than
 * they really are, so they sit inside the camera's far plane, and ahead of
 * the roof camera (which looks north).
 *
 *   const jhb = new JoburgLandmarks({ streetY: -160 });
 *   scene.add(jhb.root);
 *   new CityAtNight({ ..., clear: jhb.footprints });   // no towers inside them
 *   jhb.update(dt, time);
 *   jhb.dispose();
 */

import * as THREE from "../../three.js";

/** The sign round the top of Ponte (fictional - see above). */
export const PONTE_SIGN = "ASCENSION";

/** Where they stand, from the tower you're on (x east, -z north), metres. */
export const LANDMARKS = {
  carlton: { x: 125, z: -105 },
  ponte: { x: 70, z: -185 },
  hillbrow: { x: -5, z: -245 },
};

const MODE = { concrete: 0, rings: 1, fins: 2, sign: 3 };

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying float vDepth;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform int uMode;
  uniform vec3 uColour;      // the concrete
  uniform vec3 uGlass;       // lit windows
  uniform float uBase;       // world y of the street under it
  uniform float uFloorH;     // storey height (rings, fins)
  uniform float uCols;       // windows round a ring
  uniform float uLit;        // share of windows lit
  uniform float uWash;       // floodlight up the shaft (Hillbrow)
  uniform float uHazeCut;    // how much less haze than the city gets
  uniform float uTime;
  uniform sampler2D uMap;    // the sign's lettering
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying float vDepth;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Night light: the moon from above one side, the burning city's orange
  // glow from below, a little sky.
  vec3 shade(vec3 base, vec3 n) {
    vec3 moon = vec3(0.62, 0.7, 0.86) * max(dot(n, normalize(vec3(-0.45, 0.8, -0.3))), 0.0) * 0.55;
    vec3 city = vec3(0.9, 0.42, 0.16) * (0.35 + 0.65 * max(-n.y, 0.0) + 0.25 * (1.0 - abs(n.y)));
    return base * (moon + city * 0.32 + vec3(0.05, 0.06, 0.09));
  }

  // The scene's exp2 haze, thinned: these are the shapes the eye looks for.
  vec3 haze(vec3 col, float cut) {
    float f = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * cut);
    return mix(col, fogColor, clamp(f, 0.0, 1.0));
  }

  void main() {
    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;           // Ponte's core is seen from inside
    float h = vWorld.y - uBase;            // metres above the street
    vec3 col = shade(uColour, n);
    vec3 glow = vec3(0.0);

    if (uMode == ${MODE.concrete}) {
      // Floodlit from the foot: bright low down, fading up the shaft.
      glow += vec3(0.75, 0.85, 1.0) * uWash * exp(-h / 70.0) * (0.6 + 0.4 * (1.0 - abs(n.y)));
    } else if (uMode == ${MODE.rings}) {
      // Window bands round a cylinder: angle gives the column, height the floor.
      float a = atan(vLocal.z, vLocal.x) / 6.2831853 + 0.5;
      vec2 cell = vec2(a * uCols, h / uFloorH);
      vec2 id = floor(cell);
      vec2 f = fract(cell);
      float pane = step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.85);
      float r = hash(id);
      float lit = step(1.0 - uLit, r) * step(0.12, hash(vec2(id.y, 7.0)));   // a few floors all dark
      vec3 tint = mix(uGlass, uGlass * vec3(1.0, 0.8, 0.62), step(0.5, hash(id + 3.1)));
      // Balcony slabs: a pale band at every floor line.
      float slab = 1.0 - smoothstep(0.0, 0.12, f.y);
      col = mix(col, shade(uColour * 1.5, n), slab);
      col *= mix(1.0, 0.45, pane);                                           // dark glass when off
      glow += tint * pane * lit * (0.55 + 0.45 * r) * step(abs(n.y), 0.5);
    } else if (uMode == ${MODE.fins}) {
      // Carlton: narrow vertical windows between concrete fins.
      float along = abs(n.x) > 0.5 ? vWorld.z : vWorld.x;
      if (abs(n.y) < 0.5) {
        float fin = 1.9;
        vec2 cell = vec2(along / fin, h / uFloorH);
        vec2 id = floor(cell);
        vec2 f = fract(cell);
        float slot = step(0.52, f.x) * step(f.x, 0.9) * step(0.1, f.y);
        float r = hash(id);
        // Offices lit in clumps: a lit bay lights its neighbours.
        float clump = hash(floor(vec2(id.x / 6.0, id.y / 3.0)) + 9.0);
        float lit = step(1.0 - uLit, r * 0.5 + clump * 0.5);
        // The fins catch the city's glow: paler than the dark glass.
        col = mix(shade(uColour * 1.6, n), col * 0.25, slot);
        glow += uGlass * slot * lit * (0.5 + 0.5 * r);
        // The top floors: the lit viewing deck.
        glow += uGlass * vec3(1.0, 0.85, 0.6) * slot * smoothstep(212.0, 216.0, h) * 0.9;
      }
    } else {
      // The sign: the lettering lit, the band dark red; a slow buzz.
      float a = atan(vLocal.z, vLocal.x) / 6.2831853 + 0.5;
      float y = clamp((vLocal.y + 4.0) / 8.0, 0.0, 1.0);
      float letter = texture2D(uMap, vec2(1.0 - a * 3.0, y)).r;
      float buzz = 0.93 + 0.07 * sin(uTime * 37.0) * step(0.97, fract(uTime * 0.13));
      col = vec3(0.32, 0.02, 0.02);
      glow = mix(vec3(0.9, 0.05, 0.03), vec3(1.0, 0.97, 0.92), letter) * (0.6 + letter * 1.6) * buzz;
      gl_FragColor = vec4(haze(col + glow, uHazeCut * 0.5), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }

    // Lit windows cut through the haze better than the walls.
    vec3 outCol = haze(col, uHazeCut) + glow * (1.0 - clamp(1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth * uHazeCut * 0.5), 0.0, 1.0));
    gl_FragColor = vec4(outCol, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The sign's lettering: the name three times round, white on black. */
function signTexture(text) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#fff";
  g.font = "bold 96px Arial, Helvetica, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Stretch to fill the band, whatever the name's length.
  const w = g.measureText(text).width;
  g.save();
  g.translate(c.width / 2, c.height / 2 + 4);
  g.scale(Math.min(1.6, (c.width * 0.86) / w), 1);
  g.fillText(text, 0, 0);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A soft round glow for the aircraft lights. */
function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class JoburgLandmarks {
  /**
   * @param {object} [o]
   * @param {number} [o.streetY]  world y of the streets
   * @param {THREE.Vector3} [o.centre]  the tower you're standing on
   */
  constructor({ streetY = -160, centre = new THREE.Vector3() } = {}) {
    this.root = new THREE.Group();
    this.root.name = "JoburgLandmarks";
    this.owned = [];
    this.uniforms = [];
    const own = (x) => (this.owned.push(x), x);
    this.streetY = streetY;
    this.signMap = own(signTexture(PONTE_SIGN));

    const material = (mode, o = {}) => {
      const uniforms = {
        uMode: { value: mode },
        uColour: { value: new THREE.Color(o.colour ?? 0x6a6a6c) },
        uGlass: { value: new THREE.Color(o.glass ?? 0xffc98a) },
        uBase: { value: streetY },
        uFloorH: { value: o.floorH ?? 3.2 },
        uCols: { value: o.cols ?? 64 },
        uLit: { value: o.lit ?? 0.4 },
        uWash: { value: o.wash ?? 0 },
        uHazeCut: { value: o.hazeCut ?? 0.3 },
        uTime: { value: 0 },
        uMap: { value: this.signMap },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      };
      this.uniforms.push(uniforms);
      return own(new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, fog: true, side: o.side ?? THREE.FrontSide }));
    };
    const cylinder = (rTop, rBottom, height, segments = 48, open = false) => {
      const g = own(new THREE.CylinderGeometry(rTop, rBottom, height, segments, 1, open));
      g.translate(0, height / 2, 0); // origin at the base
      return g;
    };
    /** A part of a landmark: geometry, material, from `h0` metres up. */
    const part = (group, geometry, mat, h0) => {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.y = h0;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    const place = (name, { x, z }) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(centre.x + x, streetY, centre.z + z);
      this.root.add(g);
      return g;
    };

    // Red aircraft lights: one sprite material, blinking together.
    this.beacon = own(new THREE.SpriteMaterial({ map: own(glowTexture()), color: 0xff2a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    const beacon = (group, y, size = 7, r = 0, count = 1) => {
      for (let i = 0; i < count; i += 1) {
        const s = new THREE.Sprite(this.beacon);
        const a = (i / count) * Math.PI * 2;
        s.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        s.scale.setScalar(size);
        group.add(s);
      }
    };

    // ---- Hillbrow Tower ----
    {
      const g = place("HillbrowTower", LANDMARKS.hillbrow);
      const concrete = material(MODE.concrete, { colour: 0x8a8a88, wash: 0.55 });
      const dark = material(MODE.concrete, { colour: 0x4a4a4c });
      const head = material(MODE.rings, { colour: 0x7c7c7a, glass: 0xdff0ff, floorH: 4, cols: 44, lit: 0.62, hazeCut: 0.25 });
      part(g, cylinder(6.4, 8.6, 186), concrete, 0);             // the shaft
      part(g, cylinder(9.6, 7.0, 6), dark, 176);                 // the collar under the head
      part(g, cylinder(12.5, 11.0, 22), head, 182);              // the head: viewing and equipment floors
      part(g, cylinder(13.6, 13.6, 2.5), dark, 204);             // the overhang
      part(g, cylinder(10.5, 10.5, 10), head, 206.5);
      part(g, cylinder(7.5, 9.5, 5), concrete, 216.5);           // the cap
      part(g, cylinder(0.7, 1.8, 47), dark, 221.5);              // the antenna, to 269 m
      beacon(g, 269.5, 8);
      beacon(g, 244, 5);
      beacon(g, 207, 5, 13.8, 4);
      beacon(g, 184, 5, 12.8, 4);
    }

    // ---- Ponte City ----
    {
      const g = place("PonteCity", LANDMARKS.ponte);
      const top = 168;
      const outer = material(MODE.rings, { colour: 0x8c857a, glass: 0xffc583, floorH: top / 54, cols: 130, lit: 0.46 });
      const core = material(MODE.rings, { colour: 0x6e675e, glass: 0xffb470, floorH: top / 54, cols: 60, lit: 0.2, side: THREE.BackSide });
      const roof = material(MODE.concrete, { colour: 0x3c3a38 });
      part(g, cylinder(26, 26, top, 72, true), outer, 0);
      part(g, cylinder(11, 11, top, 40, true), core, 0);           // the hollow core
      const ring = own(new THREE.RingGeometry(11, 26, 72, 1));
      ring.rotateX(-Math.PI / 2);
      part(g, ring, roof, top);
      // The sign: a band round the crown on a dark frame.
      const frame = material(MODE.concrete, { colour: 0x262422 });
      part(g, cylinder(25.2, 25.2, 1.2, 72, true), frame, top);
      const sign = material(MODE.sign, { hazeCut: 0.3 });
      const band = own(new THREE.CylinderGeometry(26.4, 26.4, 8, 96, 1, true));
      const signMesh = new THREE.Mesh(band, sign);
      signMesh.position.y = top + 1.2 + 4;
      signMesh.frustumCulled = false;
      g.add(signMesh);
      beacon(g, top + 10, 5, 26, 4);
    }

    // ---- Carlton Centre ----
    {
      const g = place("CarltonCentre", LANDMARKS.carlton);
      const slab = own(new THREE.BoxGeometry(46, 223, 30));
      slab.translate(0, 223 / 2, 0);
      const fins = material(MODE.fins, { colour: 0x6b5b50, glass: 0xffd8a0, floorH: 4.4, lit: 0.2 });
      part(g, slab, fins, 0);
      const crown = own(new THREE.BoxGeometry(40, 3, 24));
      crown.translate(0, 1.5, 0);
      part(g, crown, material(MODE.concrete, { colour: 0x3a322d }), 223);
      beacon(g, 227, 6, 21, 4);
    }
  }

  /** Spots the generic city leaves empty (x, z from the centre; radius), metres. */
  get footprints() {
    return [
      { ...LANDMARKS.carlton, r: 40 },
      { ...LANDMARKS.ponte, r: 42 },
      { ...LANDMARKS.hillbrow, r: 24 },
    ];
  }

  update(dt, time) {
    for (const u of this.uniforms) u.uTime.value = time;
    // Aircraft lights: a slow on-off, out of step with the city's masts.
    this.beacon.opacity = Math.sin(time * 2.1 + 1.3) > 0.15 ? 1 : 0.06;
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
