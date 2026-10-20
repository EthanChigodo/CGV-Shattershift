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
 *   Mandela Bridge           white cable-stayed pylons over the rail yard,
 *                            lit blue at night, a train passing under it
 *   Orlando Towers    ~95 m  Soweto's two painted cooling towers, far off to
 *                            the west, with the walkway between their tops.
 *                            The murals are our own designs in that spirit -
 *                            the real ones are artists' work, not ours to copy
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
  // Down on the streets off the west ledge, across the rail yard (Park
  // Station's yards are right by the CBD; the real bridge spans them).
  bridge: { x: -94, z: -34 },
  // Soweto, out on the western horizon (far nearer than it really is).
  orlando: { x: -194, z: -103 },
};

const MODE = { concrete: 0, rings: 1, fins: 2, sign: 3, rails: 4, mural: 5 };

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying float vDepth;
  varying vec2 vUv;
  void main() {
    vLocal = position;
    vUv = uv;
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
  uniform float uWash;       // floodlight from the foot (Hillbrow, the bridge)
  uniform vec3 uWashColour;
  uniform float uHazeCut;    // how much less haze than the city gets
  uniform float uTime;
  uniform sampler2D uMap;    // the sign's lettering; a mural
  varying vec2 vUv;
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
      glow += uWashColour * uWash * exp(-h / 70.0) * (0.6 + 0.4 * (1.0 - abs(n.y)));
    } else if (uMode == ${MODE.mural}) {
      // A painted cooling tower: the mural (wrapped round by the lathe's uv),
      // floodlit from the foot; bare concrete inside.
      vec3 paint = texture2D(uMap, vUv).rgb;
      if (!gl_FrontFacing) paint = uColour * 0.5;
      col = shade(paint, n) * 1.3;
      glow += paint * uWashColour * uWash * (exp(-h / 55.0) + 0.25);
    } else if (uMode == ${MODE.rails}) {
      // The rail yard under the bridge: ballast, a track every 4.6 m whose
      // steel catches the city's glow, signal lamps, and a train going by.
      vec2 q = vLocal.xz;                  // x across the tracks, z along them
      col = vec3(0.05, 0.045, 0.04) * (0.7 + 0.6 * hash(floor(q * 1.5)));
      float track = mod(q.x, 4.6);
      float rail = (1.0 - smoothstep(0.04, 0.12, abs(track - 1.6))) + (1.0 - smoothstep(0.04, 0.12, abs(track - 3.0)));
      col += vec3(0.5, 0.44, 0.38) * rail * 0.45;
      vec2 sid = vec2(floor(q.x / 4.6), floor(q.y / 55.0));
      float lamp = (1.0 - smoothstep(0.0, 0.7, length(vec2(track - 0.5, mod(q.y, 55.0) - 27.5)))) * step(0.72, hash(sid));
      glow += mix(vec3(1.0, 0.08, 0.04), vec3(0.1, 1.0, 0.35), step(0.5, hash(sid + 5.0))) * lamp * 2.5;
      // The train: 140 m of lit carriages on track 9, back and forth.
      float head = mod(uTime * 14.0, 360.0) - 180.0;
      float onTrain = step(abs(floor(q.x / 4.6) - 9.0), 0.5) * step(abs(q.y - head), 70.0) * (1.0 - smoothstep(1.3, 1.6, abs(track - 2.3)));
      float window = step(0.3, fract((q.y - head) / 2.4)) * step(fract((q.y - head) / 24.0), 0.93);
      col = mix(col, vec3(0.1, 0.1, 0.12), onTrain);
      glow += vec3(1.0, 0.9, 0.72) * onTrain * window * 1.1;
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

/**
 * A mural for a cooling tower: our own design - bold bands, swoops, suns and
 * zigzag borders - in the spirit of the painted towers. u runs round the
 * tower, v up it (the canvas top is the tower's top).
 */
function muralTexture(design) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d");
  const [ground, swoop, swoop2, sun, word] = design === 0
    ? ["#1aa3a3", "#f07c1e", "#c2321f", "#ffd23f", "SOWETO"]
    : ["#f2c230", "#1d4f9c", "#2aa36b", "#ffffff", "MZANSI"];
  g.fillStyle = ground;
  g.fillRect(0, 0, 1024, 512);
  // Big swoops round the tower.
  for (const [colour, y0, amp, width] of [[swoop, 250, 70, 70], [swoop2, 330, 50, 42], ["#ffffff", 200, 60, 14]]) {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    for (let x = -20; x <= 1044; x += 16) g.lineTo(x, y0 + Math.sin((x / 1024) * Math.PI * 4) * amp);
    g.stroke();
  }
  // Suns.
  for (const [x, y, r] of [[170, 140, 46], [610, 120, 36], [880, 300, 30]]) {
    g.fillStyle = sun;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = sun;
    g.lineWidth = 6;
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8));
      g.lineTo(x + Math.cos(a) * (r + 24), y + Math.sin(a) * (r + 24));
      g.stroke();
    }
  }
  // The word, big, once round.
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#111111";
  g.lineWidth = 8;
  g.font = "bold 120px Impact, Arial Black, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.strokeText(word, 400, 70);
  g.fillText(word, 400, 70);
  // Zigzag borders near the top and above the bare concrete foot.
  const zigzag = (y, colour) => {
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 32) {
      g.lineTo(x + 16, y - 22);
      g.lineTo(x + 32, y);
    }
    g.lineTo(1024, y + 14);
    g.lineTo(0, y + 14);
    g.fill();
  };
  zigzag(22, "#111111");
  zigzag(410, "#111111");
  // The foot: bare, stained concrete.
  g.fillStyle = "#5f5b56";
  g.fillRect(0, 424, 1024, 88);
  for (let i = 0; i < 300; i += 1) {
    g.fillStyle = `rgba(30,25,20,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * 1024, 424 + Math.random() * 88, 2 + Math.random() * 6, 6 + Math.random() * 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
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
        uWashColour: { value: new THREE.Color(o.washColour ?? 0xbfd9ff) },
        uHazeCut: { value: o.hazeCut ?? 0.3 },
        uTime: { value: 0 },
        uMap: { value: o.map ?? this.signMap },
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

    // ---- Nelson Mandela Bridge ----
    // Down at street level: a deck on two white pylons (the taller to the
    // north), its cables fanning down to both edges, lit blue from below,
    // over the rail yard. Turned side-on to the roof so its shape reads.
    {
      const g = place("MandelaBridge", LANDMARKS.bridge);
      const view = new THREE.Vector2(LANDMARKS.bridge.x, LANDMARKS.bridge.z).normalize();
      g.rotation.y = Math.atan2(view.x, view.y); // local x square to the line of sight
      const yard = own(new THREE.PlaneGeometry(150, 60));
      yard.rotateX(-Math.PI / 2);
      part(g, yard, material(MODE.rails, { hazeCut: 0.28 }), 0.4);
      const white = material(MODE.concrete, { colour: 0xd9d9d4, wash: 0.75, washColour: 0x6fa8ff });
      const DECK = 14;
      const span = 150;
      const deck = own(new THREE.BoxGeometry(span, 1.4, 13));
      part(g, deck, white, DECK);
      // The approaches, down to the streets at both ends.
      for (const side of [-1, 1]) {
        const ramp = own(new THREE.BoxGeometry(34, 1.2, 13));
        const mesh = part(g, ramp, white, DECK / 2);
        mesh.position.x = side * (span / 2 + 16);
        mesh.rotation.z = side * -Math.atan2(DECK, 34);
      }
      // Lights along both edges of the deck.
      const strip = own(new THREE.BoxGeometry(span, 0.3, 0.3));
      const stripMat = own(new THREE.MeshBasicMaterial({ color: 0xd4ecff, fog: true }));
      for (const z of [-6.6, 6.6]) part(g, strip, stripMat, DECK + 1.1).position.z = z;
      // Two pylons, each a pair of legs leaning in to a crossbeam.
      const cables = [];
      for (const [x, height, reach] of [[-30, 42, 62], [38, 27, 42]]) {
        const leg = own(new THREE.CylinderGeometry(0.8, 1.4, height, 6));
        leg.translate(0, height / 2, 0);
        for (const z of [-6.8, 6.8]) {
          const m = part(g, leg, white, 0);
          m.position.set(x, 0, z);
          m.rotation.x = Math.sign(z) * 0.06;
        }
        const beam = own(new THREE.BoxGeometry(2.2, 1.6, 12));
        part(g, beam, white, height - 2).position.x = x;
        // Cables: from the top of each leg to the deck edge on its side.
        for (const z of [-6.4, 6.4]) {
          for (let i = 1; i <= 7; i += 1) {
            for (const dir of [-1, 1]) {
              cables.push(x, height - 1.5, z * 0.9, x + dir * (reach * i) / 7, DECK + 0.8, z);
            }
          }
        }
        beacon(g, height + 1.5, 4);
      }
      const cableGeometry = own(new THREE.BufferGeometry());
      cableGeometry.setAttribute("position", new THREE.Float32BufferAttribute(cables, 3));
      const cableLines = new THREE.LineSegments(cableGeometry, own(new THREE.LineBasicMaterial({ color: 0xe6f1ff, fog: true, transparent: true, opacity: 0.75 })));
      cableLines.frustumCulled = false;
      g.add(cableLines);
    }

    // ---- Orlando Towers ----
    // A cooling tower's waisted curve - a hyperbola, r = waist * sqrt(1 +
    // ((y - y0) / b)^2) - spun round its axis by LatheGeometry, whose uv
    // wraps the mural round it.
    {
      const g = place("OrlandoTowers", LANDMARKS.orlando);
      const view = new THREE.Vector2(LANDMARKS.orlando.x, LANDMARKS.orlando.z).normalize();
      g.rotation.y = Math.atan2(view.x, view.y);   // the pair side by side as you look
      const H = 95;
      const profile = [];
      for (let y = 0; y <= H; y += 5) profile.push(new THREE.Vector2(15 * Math.sqrt(1 + ((y - 70) / 46.8) ** 2), y));
      const lathe = own(new THREE.LatheGeometry(profile, 56));
      for (const [x, design] of [[-32, 0], [32, 1]]) {
        const map = own(muralTexture(design));
        const mat = material(MODE.mural, { colour: 0x7a7570, wash: 1.1, washColour: 0xffd9a8, hazeCut: 0.28, map, side: THREE.DoubleSide });
        part(g, lathe, mat, 0).position.x = x;
      }
      // The walkway between the tops, and its cables.
      const deck = own(new THREE.BoxGeometry(34, 1.2, 2.4));
      part(g, deck, material(MODE.concrete, { colour: 0x55524e, wash: 0.4 }), H - 2);
      const wires = own(new THREE.BufferGeometry());
      wires.setAttribute("position", new THREE.Float32BufferAttribute([-17, H + 4, 0, 17, H + 4, 0, -17, H + 4, 0, 0, H - 0.8, 0, 17, H + 4, 0, 0, H - 0.8, 0], 3));
      g.add(new THREE.LineSegments(wires, own(new THREE.LineBasicMaterial({ color: 0x9a9a9a, fog: true }))));
      beacon(g, H + 5, 4);
    }
  }

  /** Spots the generic city leaves empty (x, z from the centre; radius), metres. */
  get footprints() {
    return [
      { ...LANDMARKS.carlton, r: 40 },
      { ...LANDMARKS.ponte, r: 42 },
      { ...LANDMARKS.hillbrow, r: 24 },
      // The rail yard and the bridge's approaches: open ground.
      ...[-80, -40, 0, 40, 80].map((d) => {
        const { x, z } = LANDMARKS.bridge;
        const view = new THREE.Vector2(x, z).normalize();
        return { x: x - view.y * d, z: z + view.x * d, r: 40 };   // along the bridge
      }),
      { ...LANDMARKS.orlando, r: 55 },
      // And the line of sight down to it from the roof.
      { x: LANDMARKS.bridge.x * 0.55, z: LANDMARKS.bridge.z * 0.55, r: 26 },
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
