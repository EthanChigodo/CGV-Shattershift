/**
 * Set dressing for the story's sets: the ward, the briefing's rooms, the
 * service passage down to the Foundry. Everything is built in code from a
 * few primitives - rounded boxes, tubes, draped cloth - with shared
 * materials, so a room can be furnished properly without any more models.
 *
 *   const kit = createPropKit(own);          // own(x): register for dispose
 *   const bed = kit.hospitalBed({ made: true });
 *   scene.add(bed.root);
 *
 * Every prop's origin is on the floor at its footprint's centre, facing +Z
 * (its "front") unless it says otherwise. Sizes are real ones, in metres.
 */

import * as THREE from "../../three.js";

function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** A rounded rectangle extruded and bevelled: soft-edged boxes (mattresses, panels, cushions). */
function roundedBoxGeometry(w, h, d, r) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const x = -w / 2 + r;
  const y = -h / 2 + r;
  const iw = w - 2 * r;
  const ih = h - 2 * r;
  shape.moveTo(x, y - r);
  shape.lineTo(x + iw, y - r);
  shape.quadraticCurveTo(x + iw + r, y - r, x + iw + r, y);
  shape.lineTo(x + iw + r, y + ih);
  shape.quadraticCurveTo(x + iw + r, y + ih + r, x + iw, y + ih + r);
  shape.lineTo(x, y + ih + r);
  shape.quadraticCurveTo(x - r, y + ih + r, x - r, y + ih);
  shape.lineTo(x - r, y);
  shape.quadraticCurveTo(x - r, y - r, x, y - r);
  const depth = Math.max(1e-3, d - 2 * r);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * @param {(x: any) => any} own  registers a geometry / material / texture for disposal
 */
export function createPropKit(own) {
  const geo = new Map();
  const g = (key, make) => {
    if (!geo.has(key)) geo.set(key, own(make()));
    return geo.get(key);
  };
  const box = () => g("box", () => new THREE.BoxGeometry(1, 1, 1));
  const cyl = (seg = 16) => g(`cyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg));
  const sphere = () => g("sphere", () => new THREE.SphereGeometry(1, 20, 14));
  const rbox = (w, h, d, r) => g(`rb${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}_${r.toFixed(3)}`, () => roundedBoxGeometry(w, h, d, r));

  /* ---------------- materials ---------------- */

  const fabricTex = own(canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, w, h);
    const rnd = seeded(5);
    for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`; c.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { c.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.03})`; c.fillRect(x, 0, 1, h); }
  }, { repeat: [6, 6] }));
  const woodTex = own(canvasTexture(256, 256, (c, w, h) => {
    const rnd = seeded(11);
    c.fillStyle = "#7a5638";
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i += 1) {
      const y = rnd() * h;
      c.strokeStyle = `rgba(${rnd() < 0.5 ? "40,24,12" : "150,110,70"},${0.12 + rnd() * 0.18})`;
      c.lineWidth = 0.5 + rnd() * 2.5;
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) c.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
      c.stroke();
    }
  }));
  const concreteTex = own(canvasTexture(256, 256, (c, w, h) => {
    const rnd = seeded(23);
    c.fillStyle = "#7d807f";
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i += 1) {
      c.fillStyle = `rgba(${rnd() < 0.5 ? "20,20,20" : "200,200,195"},${rnd() * 0.08})`;
      c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 6, 1 + rnd() * 6);
    }
    for (let i = 0; i < 18; i += 1) {
      c.fillStyle = `rgba(60,50,40,${0.05 + rnd() * 0.08})`;
      c.fillRect(rnd() * w, 0, 2 + rnd() * 10, h * (0.3 + rnd() * 0.7)); // water streaks
    }
  }));
  const carpetTex = own(canvasTexture(128, 128, (c, w, h) => {
    const rnd = seeded(31);
    c.fillStyle = "#2b2f38";
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i += 1) { c.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`; c.fillRect(rnd() * w, rnd() * h, 1, 1); }
  }, { repeat: [8, 8] }));

  const M = {
    steel: own(new THREE.MeshStandardMaterial({ color: 0xb9c2c7, metalness: 0.8, roughness: 0.32 })),
    chrome: own(new THREE.MeshStandardMaterial({ color: 0xe2e8ec, metalness: 1, roughness: 0.14 })),
    darkSteel: own(new THREE.MeshStandardMaterial({ color: 0x3a4045, metalness: 0.7, roughness: 0.45 })),
    painted: own(new THREE.MeshStandardMaterial({ color: 0xe6eae8, metalness: 0.1, roughness: 0.5 })),
    paintedBlue: own(new THREE.MeshStandardMaterial({ color: 0x5f8da0, metalness: 0.15, roughness: 0.5 })),
    plastic: own(new THREE.MeshStandardMaterial({ color: 0xf1f3f2, roughness: 0.38, metalness: 0.02 })),
    plasticGrey: own(new THREE.MeshStandardMaterial({ color: 0x9aa3a6, roughness: 0.45 })),
    plasticDark: own(new THREE.MeshStandardMaterial({ color: 0x25292c, roughness: 0.5 })),
    rubber: own(new THREE.MeshStandardMaterial({ color: 0x161718, roughness: 0.92 })),
    vinyl: own(new THREE.MeshStandardMaterial({ color: 0x6f9fae, roughness: 0.45, metalness: 0.02 })),
    linen: own(new THREE.MeshStandardMaterial({ color: 0xeef1f1, roughness: 0.96, map: fabricTex, side: THREE.DoubleSide })),
    blanket: own(new THREE.MeshStandardMaterial({ color: 0x86a9b4, roughness: 1, map: fabricTex, side: THREE.DoubleSide })),
    gown: own(new THREE.MeshStandardMaterial({ color: 0x8fb4bd, roughness: 0.95, map: fabricTex, side: THREE.DoubleSide })),
    curtain: own(new THREE.MeshStandardMaterial({ color: 0x86aaa4, roughness: 0.95, map: fabricTex, side: THREE.DoubleSide })),
    wood: own(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55, metalness: 0.05 })),
    darkWood: own(new THREE.MeshStandardMaterial({ map: woodTex, color: 0x5a4636, roughness: 0.5 })),
    fabricDark: own(new THREE.MeshStandardMaterial({ color: 0x2d3640, roughness: 0.95, map: fabricTex })),
    leather: own(new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.55, metalness: 0.05 })),
    glass: own(new THREE.MeshStandardMaterial({ color: 0xd8eef6, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.1, depthWrite: false })),
    fluid: own(new THREE.MeshStandardMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.55, roughness: 0.1 })),
    water: own(new THREE.MeshStandardMaterial({ color: 0x9fd0e6, transparent: true, opacity: 0.5, roughness: 0.05 })),
    concrete: own(new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.92 })),
    carpet: own(new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1 })),
    hazard: own(new THREE.MeshStandardMaterial({ color: 0xd1a326, roughness: 0.6 })),
    black: own(new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.6 })),
    pipeRed: own(new THREE.MeshStandardMaterial({ color: 0x8e2a22, roughness: 0.55, metalness: 0.3 })),
    pipeYellow: own(new THREE.MeshStandardMaterial({ color: 0xb08a22, roughness: 0.55, metalness: 0.3 })),
    pipeGrey: own(new THREE.MeshStandardMaterial({ color: 0x5d6468, roughness: 0.5, metalness: 0.6 })),
    green: own(new THREE.MeshStandardMaterial({ color: 0x2f6b3c, roughness: 0.8 })),
    leaf: own(new THREE.MeshStandardMaterial({ color: 0x2f5d2a, roughness: 0.8, side: THREE.DoubleSide })),
    soil: own(new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 1 })),
    paper: own(new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, side: THREE.DoubleSide })),
    lampGlow: own(new THREE.MeshBasicMaterial({ color: 0xfff1d6 })),
    panelGlow: own(new THREE.MeshBasicMaterial({ color: 0xeef8ff })),
    ledRed: own(new THREE.MeshBasicMaterial({ color: 0xff2a1a })),
    ledGreen: own(new THREE.MeshBasicMaterial({ color: 0x3cff8a })),
    ledAmber: own(new THREE.MeshBasicMaterial({ color: 0xffb030 })),
    ledBlue: own(new THREE.MeshBasicMaterial({ color: 0x4fc8ff })),
  };

  /* ---------------- primitives ---------------- */

  const part = (parent, material, sx, sy, sz, x, y, z, { r = 0, rx = 0, ry = 0, rz = 0, cast = true } = {}) => {
    const m = new THREE.Mesh(r > 0 ? rbox(sx, sy, sz, r) : box(), material);
    if (r <= 0) m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const rod = (parent, material, radius, length, x, y, z, { rx = 0, ry = 0, rz = 0, seg = 12 } = {}) => {
    const m = new THREE.Mesh(cyl(seg), material);
    m.scale.set(radius, length, radius);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };
  const ball = (parent, material, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(sphere(), material);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  /** A tube through world/local points (cables, IV lines, pipes with bends). */
  const tube = (parent, material, points, radius, { segments = 40, closed = false } = {}) => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
    const m = new THREE.Mesh(own(new THREE.TubeGeometry(curve, segments, radius, 8, closed)), material);
    parent.add(m);
    return m;
  };
  /** A wheel: caster or chair castor. */
  const caster = (parent, x, z, r = 0.05) => {
    const fork = part(parent, M.darkSteel, 0.03, r * 1.6, 0.05, x, r * 1.4, z);
    const wheel = rod(parent, M.rubber, r, 0.03, x, r, z, { rz: Math.PI / 2 });
    return [fork, wheel];
  };

  /**
   * Cloth laid over a surface: a sheet `width` x `length` at height `top`
   * that follows `bump(x, z)` (what's under it, 0 = flat) and droops over
   * the edges by `drop`, with a little softness in it.
   */
  function drape({ width, length, top, bump = () => 0, drop = 0.28, edge = 0.46, sides = true, foot = true, material = M.linen, segW = 28, segL = 40, seed = 1 }) {
    const rnd = seeded(seed + 7);
    const extra = sides ? drop : 0;
    const plane = new THREE.PlaneGeometry(width + extra * 2, length + (foot ? drop : 0), segW, segL);
    plane.rotateX(-Math.PI / 2);
    plane.translate(0, 0, foot ? -drop / 2 : 0);
    const pos = plane.attributes.position;
    const wobble = Array.from({ length: 6 }, () => [rnd() * 6 + 3, rnd() * Math.PI * 2, rnd() * 0.008]);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Over the edge: fold down, rounding the corner.
      const overX = Math.max(0, Math.abs(x) - edge);
      const overZ = foot ? Math.max(0, -z - length / 2) : 0;
      const over = Math.hypot(overX, overZ);
      let y = top + bump(x, z);
      let nx = x;
      let nz = z;
      if (over > 0) {
        const bend = Math.min(over, 0.06);
        const hang = over - bend;
        y = top - bend * 0.7 - hang;
        // Hanging cloth stays near the edge plane.
        if (overX > 0) nx = Math.sign(x) * (edge + bend * 0.7 + hang * 0.08);
        if (overZ > 0) nz = -(length / 2 + bend * 0.7 + hang * 0.08);
      }
      for (const [f, ph, a] of wobble) y += Math.sin(nx * f + ph) * Math.cos(nz * f * 0.7 + ph) * a;
      pos.setXYZ(i, nx, y, nz);
    }
    plane.computeVertexNormals();
    const m = new THREE.Mesh(own(plane), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /* ---------------- the ward ---------------- */

  /**
   * A hospital bed: a steel frame on casters, rails, head- and footboards,
   * a soft mattress, pillow and sheets. Head toward +Z.
   * @returns {{root: THREE.Group, mattressTop: number, pillow: {y: number, z: number, top: number}}}
   */
  function hospitalBed({ made = true, occupied = false, rails = [true, false], blanket = true, seed = 1 } = {}) {
    const root = new THREE.Group();
    root.name = "HospitalBed";
    const L = 2.1;
    const W = 1.0;
    // Frame and casters.
    part(root, M.steel, W - 0.06, 0.06, L - 0.1, 0, 0.47, 0, { r: 0.02 });
    part(root, M.darkSteel, 0.5, 0.12, 1.4, 0, 0.32, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      rod(root, M.steel, 0.022, 0.32, sx * (W / 2 - 0.08), 0.28, sz * (L / 2 - 0.12));
      caster(root, sx * (W / 2 - 0.08), sz * (L / 2 - 0.12));
    }
    // Head- and footboards: moulded plastic panels on steel posts.
    part(root, M.plastic, W + 0.02, 0.62, 0.05, 0, 0.86, L / 2 + 0.02, { r: 0.025 });
    part(root, M.paintedBlue, W - 0.16, 0.08, 0.055, 0, 1.06, L / 2 + 0.02, { r: 0.02 });
    part(root, M.plastic, W + 0.02, 0.42, 0.05, 0, 0.74, -L / 2 - 0.02, { r: 0.025 });
    // A chart in its holder on the footboard.
    part(root, M.plasticDark, 0.26, 0.32, 0.015, 0.18, 0.86, -L / 2 - 0.055);
    part(root, M.paper, 0.22, 0.27, 0.005, 0.18, 0.86, -L / 2 - 0.064);
    // Side rails: tubes; one up, one folded down.
    rails.forEach((up, i) => {
      const sx = i === 0 ? -1 : 1;
      const x = sx * (W / 2 + 0.03);
      const y = up ? 0.92 : 0.6;
      for (const dy of [0, -0.16]) rod(root, M.chrome, 0.014, 1.0, x, y + dy, 0.35, { rx: Math.PI / 2 });
      for (const dz of [-0.1, 0.8]) rod(root, M.chrome, 0.012, 0.18, x, y - 0.08, dz);
    });
    // Mattress: soft, with a seam.
    const mattressTop = 0.72;
    part(root, M.vinyl, W - 0.08, 0.18, L - 0.12, 0, mattressTop - 0.09, 0, { r: 0.06 });
    // The pillow: a soft, squashed cushion at the head end, a dent where the head goes.
    const pillowZ = L / 2 - 0.3;
    const pillowH = occupied ? 0.09 : 0.12;
    const pillow = ball(root, M.linen, 0.33, pillowH / 2, 0.2, 0, mattressTop + pillowH / 2 - 0.01, pillowZ);
    pillow.castShadow = true;
    // Sheets: a fitted sheet, and the top sheet / blanket over the bed.
    const fitted = drape({ width: W - 0.08, length: L - 0.12, top: mattressTop + 0.004, drop: 0.12, edge: (W - 0.08) / 2, foot: false, sides: true, segW: 8, segL: 12, seed });
    root.add(fitted);
    if (blanket && !occupied) {
      if (made) {
        const sheet = drape({ width: W - 0.02, length: 1.5, top: mattressTop + 0.02, drop: 0.3, edge: (W - 0.06) / 2, material: M.blanket, seed: seed + 1 });
        sheet.position.z = -0.24;
        sheet.userData.cover = true;
        root.add(sheet);
        // The top sheet folded back over it.
        part(root, M.linen, W - 0.04, 0.035, 0.28, 0, mattressTop + 0.035, 0.36, { r: 0.015 }).userData.cover = true;
      } else {
        // Thrown back: rumpled at the foot.
        const sheet = drape({ width: W - 0.02, length: 0.9, top: mattressTop + 0.03, drop: 0.32, edge: (W - 0.06) / 2, material: M.blanket, seed: seed + 2,
          bump: (x, z) => Math.max(0, Math.sin((z + 0.45) * 9 + x * 2) * 0.05 + Math.sin(x * 7) * 0.02) });
        sheet.position.z = -0.55;
        sheet.rotation.y = 0.08;
        root.add(sheet);
      }
    }
    return { root, mattressTop, pillow: { y: mattressTop + pillowH, z: pillowZ, top: mattressTop + pillowH }, length: L, width: W };
  }

  /**
   * A blanket over someone lying on their back, head toward +Z: it rises
   * over the feet, shins, knees, hips and chest. `from`/`to` are z along the
   * bed it covers (local to the bed).
   */
  function bodyBlanket({ mattressTop, from = -1.0, to = 0.45, width = 1.0, seed = 3 }) {
    const length = to - from;
    // Bumps in the blanket's own frame: z from -length/2 (feet) to +length/2.
    const bump = (x, z) => {
      const zz = z + length / 2 + from; // back to bed space
      const legs = (cx) => {
        const lx = (x - cx) / 0.09;
        return Math.max(0, 1 - lx * lx);
      };
      let h = 0;
      if (zz < -0.15) h = (legs(-0.11) + legs(0.11)) * 0.075 + (zz < -0.9 ? 0.06 * Math.max(0, 1 - Math.abs(zz + 0.95) / 0.08) : 0);
      else {
        const t = Math.min(1, (zz + 0.15) / 0.3);
        const lx = x / 0.24;
        const torso = Math.max(0, 1 - lx * lx);
        h = (legs(-0.11) + legs(0.11)) * 0.075 * (1 - t) + torso * (0.11 + 0.03 * t) * t;
      }
      return h;
    };
    const m = drape({ width, length, top: mattressTop + 0.025, bump, drop: 0.3, edge: width / 2 - 0.02, foot: true, material: M.blanket, segW: 32, segL: 48, seed });
    m.position.z = from + length / 2;
    // The sheet's folded edge across the chest (the drape's vertices are at
    // their real height, so this is too).
    part(m, M.linen, width - 0.02, 0.03, 0.12, 0, mattressTop + 0.165, length / 2 - 0.05, { r: 0.012 });
    return m;
  }

  /** An IV stand with a bag and drip chamber; `line` gives where the line leaves the bag. */
  function ivStand() {
    const root = new THREE.Group();
    root.name = "IVStand";
    rod(root, M.chrome, 0.014, 2.0, 0, 1.0, 0);
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      const leg = rod(root, M.chrome, 0.012, 0.32, Math.cos(a) * 0.16, 0.08, Math.sin(a) * 0.16, { rz: Math.PI / 2 - 0.25 });
      leg.rotation.set(0, -a, Math.PI / 2 - 0.25);
      caster(root, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.03);
    }
    // Hooks and the bag.
    part(root, M.chrome, 0.3, 0.012, 0.012, 0, 1.98, 0);
    part(root, M.glass, 0.13, 0.22, 0.04, 0.1, 1.82, 0, { r: 0.02 });
    part(root, M.fluid, 0.1, 0.14, 0.03, 0.1, 1.79, 0, { r: 0.012 });
    part(root, M.paper, 0.06, 0.04, 0.002, 0.1, 1.86, 0.022);
    rod(root, M.glass, 0.012, 0.06, 0.1, 1.66, 0);
    // An infusion pump clamped to the pole.
    part(root, M.plastic, 0.16, 0.2, 0.12, 0, 1.25, 0.08, { r: 0.02 });
    part(root, M.ledGreen, 0.08, 0.04, 0.005, 0, 1.3, 0.141);
    return { root, line: new THREE.Vector3(0.1, 1.63, 0) };
  }

  /** A patient monitor on a wheeled stand; `screen` is the plane to draw on. */
  function monitorStand(screenMaterial) {
    const root = new THREE.Group();
    rod(root, M.plasticGrey, 0.025, 1.1, 0, 0.6, 0);
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      caster(root, Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.03);
      const leg = part(root, M.plasticGrey, 0.24, 0.03, 0.04, Math.cos(a) * 0.11, 0.07, Math.sin(a) * 0.11);
      leg.rotation.y = -a;
    }
    const head = new THREE.Group();
    head.position.y = 1.32;
    root.add(head);
    part(head, M.plastic, 0.44, 0.32, 0.12, 0, 0, 0, { r: 0.03 });
    const screen = new THREE.Mesh(g("plane", () => new THREE.PlaneGeometry(1, 1)), screenMaterial);
    screen.scale.set(0.36, 0.23, 1);
    screen.position.set(-0.02, 0.01, 0.062);
    head.add(screen);
    part(head, M.plasticDark, 0.04, 0.2, 0.01, 0.19, 0, 0.061);
    for (let i = 0; i < 4; i += 1) part(head, i ? M.plasticGrey : M.ledRed, 0.025, 0.02, 0.012, 0.19, 0.08 - i * 0.05, 0.065);
    return { root, head };
  }

  /** A bedside cabinet with a drawer, a water jug and a cup on top. */
  function bedsideCabinet() {
    const root = new THREE.Group();
    part(root, M.painted, 0.45, 0.78, 0.45, 0, 0.42, 0, { r: 0.02 });
    part(root, M.plasticGrey, 0.4, 0.02, 0.4, 0, 0.82, 0);
    part(root, M.plastic, 0.4, 0.16, 0.012, 0, 0.66, 0.226, { r: 0.004 });
    part(root, M.chrome, 0.12, 0.015, 0.02, 0, 0.66, 0.238);
    part(root, M.plastic, 0.4, 0.4, 0.012, 0, 0.32, 0.226, { r: 0.004 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) caster(root, sx * 0.17, sz * 0.17, 0.025);
    // Jug and cup.
    const jug = rod(root, M.glass, 0.055, 0.2, -0.08, 0.93, 0.02, { seg: 18 });
    jug.castShadow = false;
    rod(root, M.water, 0.05, 0.13, -0.08, 0.895, 0.02, { seg: 18 });
    rod(root, M.plastic, 0.035, 0.09, 0.1, 0.875, -0.05, { seg: 14 });
    // A folded towel and a tissue box.
    part(root, M.linen, 0.18, 0.04, 0.12, 0.07, 0.85, 0.12, { r: 0.012 });
    return root;
  }

  /** The bed-head services panel: gas outlets, sockets, a reading light, the call button. */
  function headwall(width = 2.2) {
    const root = new THREE.Group();
    part(root, M.painted, width, 0.24, 0.07, 0, 1.45, 0, { r: 0.015 });
    part(root, M.lampGlow, width - 0.3, 0.025, 0.01, 0, 1.53, 0.04);
    const outlets = [[M.ledGreen, -0.6], [M.plastic, -0.45], [M.ledAmber, -0.3]];
    for (const [m, x] of outlets) {
      rod(root, M.chrome, 0.03, 0.03, x, 1.43, 0.045, { rx: Math.PI / 2 });
      rod(root, m, 0.018, 0.035, x, 1.43, 0.05, { rx: Math.PI / 2 });
    }
    for (const x of [0.35, 0.5, 0.65]) part(root, M.plastic, 0.08, 0.08, 0.02, x, 1.42, 0.04);
    for (const x of [0.35, 0.5, 0.65]) part(root, M.plasticDark, 0.02, 0.03, 0.005, x, 1.42, 0.052);
    // The call handset on its curly cord.
    part(root, M.plasticGrey, 0.05, 0.14, 0.04, 0.85, 1.3, 0.06, { r: 0.012 });
    part(root, M.ledRed, 0.025, 0.025, 0.005, 0.85, 1.34, 0.082);
    return root;
  }

  /**
   * A curtain hanging in folds from a ceiling track, along local X.
   * @returns {THREE.Group}
   */
  function curtain({ width = 2.2, height = 2.1, top = 2.55, folds = 11, open = 0, seed = 1 } = {}) {
    const root = new THREE.Group();
    const rnd = seeded(seed + 3);
    const span = width * (1 - open * 0.7);
    const plane = new THREE.PlaneGeometry(span, height, folds * 6, 10);
    const pos = plane.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const depth = 0.05 + (1 - (y + height / 2) / height) * 0.02;
      const z = Math.sin((x / span) * folds * Math.PI * 2) * depth + Math.sin(x * 3 + rnd()) * 0.01;
      // The hem swings out a touch at the bottom.
      pos.setXYZ(i, x, y, z + (y < -height / 2 + 0.2 ? (rnd() - 0.5) * 0.01 : 0));
    }
    plane.computeVertexNormals();
    const cloth = new THREE.Mesh(own(plane), M.curtain);
    cloth.position.set(-width / 2 + span / 2, top - 0.04 - height / 2, 0);
    cloth.castShadow = true;
    root.add(cloth);
    rod(root, M.steel, 0.012, width + 0.1, 0, top, 0, { rz: Math.PI / 2 });
    for (let i = 0; i <= folds * 2; i += 1) rod(root, M.chrome, 0.006, 0.03, -width / 2 + (i / (folds * 2)) * span, top - 0.02, 0);
    return root;
  }

  /** A hand-wash sink on the wall, a mirror over it, soap and towels. Back on z = 0. */
  function sink() {
    const root = new THREE.Group();
    part(root, M.plastic, 0.55, 0.16, 0.42, 0, 0.84, 0.21, { r: 0.05 });
    part(root, M.chrome, 0.04, 0.2, 0.04, 0, 1.0, 0.06);
    part(root, M.chrome, 0.03, 0.03, 0.14, 0, 1.08, 0.12);
    part(root, M.glass, 0.5, 0.65, 0.01, 0, 1.55, 0.01);
    part(root, M.plastic, 0.12, 0.2, 0.08, 0.42, 1.25, 0.04, { r: 0.02 });
    part(root, M.plastic, 0.3, 0.34, 0.12, -0.5, 1.3, 0.06, { r: 0.02 });
    return root;
  }

  /** A wheelchair, facing +Z. */
  function wheelchair() {
    const root = new THREE.Group();
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(g("wcWheel", () => new THREE.TorusGeometry(0.3, 0.018, 8, 32)), M.rubber);
      wheel.position.set(sx * 0.3, 0.31, -0.05);
      wheel.rotation.y = Math.PI / 2;
      root.add(wheel);
      const rim = new THREE.Mesh(g("wcRim", () => new THREE.TorusGeometry(0.27, 0.008, 6, 32)), M.chrome);
      rim.position.set(sx * 0.33, 0.31, -0.05);
      rim.rotation.y = Math.PI / 2;
      root.add(rim);
      rod(root, M.chrome, 0.012, 0.6, sx * 0.25, 0.62, -0.18);
      rod(root, M.chrome, 0.012, 0.42, sx * 0.25, 0.46, 0.12, { rx: Math.PI / 2 });
      caster(root, sx * 0.22, 0.3, 0.04);
    }
    part(root, M.leather, 0.46, 0.04, 0.42, 0, 0.5, 0.05);
    part(root, M.leather, 0.46, 0.38, 0.03, 0, 0.74, -0.18);
    part(root, M.darkSteel, 0.14, 0.02, 0.12, -0.12, 0.12, 0.33);
    part(root, M.darkSteel, 0.14, 0.02, 0.12, 0.12, 0.12, 0.33);
    return root;
  }

  /** A wall clock (face on +Z). */
  function wallClock() {
    const root = new THREE.Group();
    rod(root, M.plastic, 0.16, 0.04, 0, 0, 0, { rx: Math.PI / 2, seg: 28 });
    const face = rod(root, M.painted, 0.145, 0.005, 0, 0, 0.022, { rx: Math.PI / 2, seg: 28 });
    face.castShadow = false;
    part(root, M.black, 0.008, 0.1, 0.004, 0, 0.04, 0.027, { rz: -0.6 });
    part(root, M.black, 0.008, 0.12, 0.004, 0, 0.05, 0.028, { rz: 2.2 });
    return root;
  }

  /** A window with half-closed blinds and the night outside (on +Z, set in a wall at z = 0). */
  function blindWindow({ width = 1.6, height = 1.2, night = null } = {}) {
    const root = new THREE.Group();
    const outside = new THREE.Mesh(g("plane", () => new THREE.PlaneGeometry(1, 1)), night ?? M.black);
    outside.scale.set(width, height, 1);
    outside.position.z = -0.04;
    root.add(outside);
    part(root, M.painted, width + 0.1, 0.06, 0.12, 0, height / 2 + 0.03, 0);
    part(root, M.painted, width + 0.1, 0.06, 0.16, 0, -height / 2 - 0.03, 0.02);
    for (const sx of [-1, 1]) part(root, M.painted, 0.05, height, 0.12, sx * (width / 2 + 0.025), 0, 0);
    for (let i = 0; i < 26; i += 1) {
      const slat = part(root, M.plastic, width, 0.004, 0.045, 0, height / 2 - 0.03 - i * 0.04, 0.03, { rx: 0.9, cast: false });
      if (i > 17) slat.visible = false; // pulled up at the bottom
    }
    return root;
  }

  /** An office chair (star base, gas lift, cushioned seat and back), facing +Z. */
  function officeChair({ material = M.fabricDark, seat = 0.48 } = {}) {
    const root = new THREE.Group();
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      const leg = part(root, M.plasticDark, 0.3, 0.03, 0.05, Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15);
      leg.rotation.y = -a;
      caster(root, Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0.03);
    }
    const lift = seat - 0.12;
    rod(root, M.chrome, 0.025, lift, 0, 0.08 + lift / 2, 0);
    part(root, material, 0.48, 0.08, 0.46, 0, seat, 0.02, { r: 0.035 });
    part(root, material, 0.46, 0.55, 0.07, 0, seat + 0.34, -0.22, { r: 0.035, rx: -0.12 });
    part(root, M.plasticDark, 0.05, 0.36, 0.04, 0, seat + 0.14, -0.24);
    for (const sx of [-1, 1]) part(root, M.plasticDark, 0.05, 0.03, 0.26, sx * 0.27, seat + 0.18, 0.02, { r: 0.012 });
    return root;
  }

  /** A potted plant. */
  function plant({ height = 1.1, seed = 1 } = {}) {
    const root = new THREE.Group();
    const rnd = seeded(seed * 13 + 1);
    rod(root, M.plasticDark, 0.17, 0.36, 0, 0.18, 0, { seg: 18 });
    rod(root, M.soil, 0.155, 0.02, 0, 0.35, 0, { seg: 18 });
    const leafGeo = g("leaf", () => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.quadraticCurveTo(0.07, 0.2, 0, 0.42);
      s.quadraticCurveTo(-0.07, 0.2, 0, 0);
      return new THREE.ShapeGeometry(s, 6);
    });
    for (let i = 0; i < 26; i += 1) {
      const leaf = new THREE.Mesh(leafGeo, M.leaf);
      const a = rnd() * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.04, 0.36 + rnd() * (height - 0.7), Math.sin(a) * 0.04);
      leaf.rotation.set(-0.3 - rnd() * 0.9, a, 0, "YXZ");
      leaf.scale.setScalar(0.8 + rnd() * 0.7);
      root.add(leaf);
    }
    return root;
  }

  /** A bookshelf full of binders and books, back against z = 0, facing +Z. */
  function bookshelf({ width = 1.4, height = 2.0, seed = 1 } = {}) {
    const root = new THREE.Group();
    const rnd = seeded(seed * 17 + 5);
    part(root, M.darkWood, width, height, 0.04, 0, height / 2, 0.02);
    for (const sx of [-1, 1]) part(root, M.darkWood, 0.03, height, 0.34, sx * width / 2, height / 2, 0.17);
    const shelves = 5;
    const colours = [0x7a2b22, 0x23446a, 0x2f5a34, 0xc9b98f, 0x3a3a3a, 0x8a6a2a, 0xdedcd2];
    const bookMats = colours.map((c) => own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })));
    for (let s = 0; s < shelves; s += 1) {
      const y = 0.05 + (s * (height - 0.1)) / shelves;
      part(root, M.darkWood, width - 0.03, 0.025, 0.32, 0, y, 0.17);
      let x = -width / 2 + 0.04;
      while (x < width / 2 - 0.08) {
        const w = 0.03 + rnd() * 0.05;
        const h = 0.22 + rnd() * 0.12;
        if (rnd() < 0.08) { x += 0.12; continue; }
        const lean = rnd() < 0.06 ? 0.25 : 0;
        part(root, bookMats[Math.floor(rnd() * bookMats.length)], w, h, 0.22 + rnd() * 0.06, x + w / 2, y + 0.013 + h / 2, 0.16, { rz: lean, cast: false });
        x += w + 0.004;
      }
    }
    return root;
  }

  /** A filing cabinet, four drawers, facing +Z. */
  function filingCabinet() {
    const root = new THREE.Group();
    part(root, M.plasticGrey, 0.46, 1.32, 0.62, 0, 0.66, 0, { r: 0.012 });
    for (let i = 0; i < 4; i += 1) {
      part(root, M.painted, 0.42, 0.29, 0.01, 0, 0.18 + i * 0.32, 0.311);
      part(root, M.chrome, 0.14, 0.02, 0.03, 0, 0.26 + i * 0.32, 0.32);
    }
    return root;
  }

  /** A desk lamp with a glowing shade, facing +Z. */
  function deskLamp() {
    const root = new THREE.Group();
    rod(root, M.darkSteel, 0.07, 0.02, 0, 0.01, 0, { seg: 18 });
    rod(root, M.darkSteel, 0.008, 0.36, 0, 0.19, -0.02, { rx: 0.25 });
    rod(root, M.darkSteel, 0.008, 0.3, 0, 0.42, 0.08, { rx: -0.95 });
    const shade = new THREE.Mesh(g("shade", () => new THREE.ConeGeometry(0.08, 0.12, 18, 1, true)), M.darkSteel);
    shade.position.set(0, 0.48, 0.2);
    shade.rotation.x = 0.6;
    root.add(shade);
    ball(root, M.lampGlow, 0.03, 0.03, 0.03, 0, 0.45, 0.22);
    return root;
  }

  /** A laptop, lid up, screen texture optional. */
  function laptop(screenMaterial = M.ledBlue) {
    const root = new THREE.Group();
    part(root, M.plasticGrey, 0.34, 0.015, 0.24, 0, 0.008, 0, { r: 0.006 });
    const lid = new THREE.Group();
    lid.position.set(0, 0.015, -0.115);
    lid.rotation.x = -0.25;
    root.add(lid);
    part(lid, M.plasticGrey, 0.34, 0.23, 0.01, 0, 0.115, 0, { r: 0.005 });
    const screen = part(lid, screenMaterial, 0.3, 0.19, 0.002, 0, 0.115, 0.006, { cast: false });
    screen.material = screenMaterial;
    return root;
  }

  /** A mug. */
  function mug(colour = 0xe9e4da) {
    const root = new THREE.Group();
    const m = own(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35 }));
    rod(root, m, 0.04, 0.095, 0, 0.0475, 0, { seg: 16 });
    const handle = new THREE.Mesh(g("mugHandle", () => new THREE.TorusGeometry(0.025, 0.007, 6, 12, Math.PI)), m);
    handle.position.set(0.045, 0.05, 0);
    handle.rotation.z = -Math.PI / 2;
    root.add(handle);
    return root;
  }

  /** A loose stack of papers. */
  function papers(count = 6, seed = 1) {
    const root = new THREE.Group();
    const rnd = seeded(seed * 7 + 2);
    for (let i = 0; i < count; i += 1) {
      const p = part(root, M.paper, 0.21, 0.002, 0.297, (rnd() - 0.5) * 0.06, 0.002 + i * 0.003, (rnd() - 0.5) * 0.05, { ry: (rnd() - 0.5) * 0.4, cast: false });
      p.receiveShadow = true;
    }
    return root;
  }

  /** A server rack with blinking LEDs (call tick). Front +Z. */
  function serverRack({ seed = 1 } = {}) {
    const root = new THREE.Group();
    const rnd = seeded(seed * 29 + 3);
    part(root, M.black, 0.62, 2.0, 0.9, 0, 1.0, 0, { r: 0.01 });
    const leds = [];
    for (let i = 0; i < 14; i += 1) {
      const y = 0.18 + i * 0.13;
      part(root, M.darkSteel, 0.56, 0.1, 0.01, 0, y, 0.452);
      for (let j = 0; j < 4; j += 1) {
        const led = part(root, [M.ledGreen, M.ledBlue, M.ledAmber][Math.floor(rnd() * 3)], 0.012, 0.012, 0.004, -0.22 + j * 0.03, y + 0.02, 0.459, { cast: false });
        leds.push({ led, rate: 2 + rnd() * 9, phase: rnd() * 10 });
      }
    }
    root.userData.tick = (t) => { for (const l of leds) l.led.visible = Math.sin(t * l.rate + l.phase) > -0.3; };
    return root;
  }

  /** A console desk with a row of screens; `screens` is an array of materials (2-4). Front +Z. */
  function consoleDesk({ width = 2.4, screens = [] } = {}) {
    const root = new THREE.Group();
    part(root, M.darkSteel, width, 0.74, 0.7, 0, 0.37, 0, { r: 0.02 });
    part(root, M.plasticDark, width + 0.04, 0.04, 0.8, 0, 0.76, 0.03, { r: 0.015 });
    // The angled control surface with keys.
    const slope = part(root, M.plasticGrey, width - 0.1, 0.02, 0.32, 0, 0.82, 0.18, { rx: -0.35 });
    slope.castShadow = false;
    const rnd = seeded(width * 100);
    for (let i = 0; i < 18; i += 1) part(root, [M.ledAmber, M.ledGreen, M.plasticDark, M.plastic][Math.floor(rnd() * 4)], 0.05, 0.015, 0.04, -width / 2 + 0.2 + (i % 9) * (width - 0.4) / 8, 0.84 + Math.floor(i / 9) * 0.04, 0.24 - Math.floor(i / 9) * 0.1, { cast: false });
    screens.forEach((material, i) => {
      const x = -width / 2 + (width / (screens.length + 1)) * (i + 1);
      rod(root, M.darkSteel, 0.02, 0.18, x, 0.88, -0.2);
      part(root, M.plasticDark, 0.62, 0.38, 0.04, x, 1.16, -0.22, { r: 0.012 });
      const s = part(root, material, 0.56, 0.32, 0.003, x, 1.16, -0.198, { cast: false });
      s.material = material;
    });
    return root;
  }

  /** A run of pipe along points (straight segments with rounded bends). */
  function pipe(points, { radius = 0.06, material = M.pipeGrey, brackets = true } = {}) {
    const root = new THREE.Group();
    const pts = points.map((p) => new THREE.Vector3(...p));
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(cyl(14), material);
      m.scale.set(radius, len, radius);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      root.add(m);
      if (i < pts.length - 1) ball(root, material, radius * 1.15, radius * 1.15, radius * 1.15, b.x, b.y, b.z);
      if (brackets) {
        const steps = Math.floor(len / 1.5);
        for (let s = 1; s <= steps; s += 1) {
          const p = a.clone().lerp(b, s / (steps + 1));
          const ring = new THREE.Mesh(g("bracket", () => new THREE.TorusGeometry(1, 0.18, 6, 14)), M.darkSteel);
          ring.scale.setScalar(radius * 1.15);
          ring.position.copy(p);
          ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
          root.add(ring);
        }
      }
    }
    return root;
  }

  /** A caged bulkhead lamp (wall or ceiling), its glow a material you can dim. Faces +Z. */
  function cagedLamp(glow = M.lampGlow) {
    const root = new THREE.Group();
    part(root, M.darkSteel, 0.2, 0.12, 0.05, 0, 0, 0);
    const bulb = ball(root, glow, 0.08, 0.05, 0.05, 0, 0, 0.05);
    for (let i = 0; i < 3; i += 1) part(root, M.darkSteel, 0.18, 0.008, 0.008, 0, -0.035 + i * 0.035, 0.1);
    part(root, M.darkSteel, 0.008, 0.1, 0.008, 0, 0, 0.105);
    return { root, bulb };
  }

  /** A painted sign: lines of text on a coloured plate. */
  function sign(lines, { width = 0.9, height = 0.3, bg = "#f3f3ee", fg = "#1b1d1f", stripe = null } = {}) {
    const tex = own(canvasTexture(512, Math.round(512 * (height / width)), (c, w, h) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      if (stripe) {
        c.fillStyle = stripe;
        c.fillRect(0, 0, w, h * 0.16);
      }
      c.fillStyle = fg;
      c.textAlign = "center";
      c.textBaseline = "middle";
      lines.forEach(([text, size], i) => {
        c.font = `bold ${size}px Arial, sans-serif`;
        c.fillText(text, w / 2, h * (stripe ? 0.58 : 0.5) + (i - (lines.length - 1) / 2) * size * 1.15);
      });
    }));
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.Mesh(g("plane", () => new THREE.PlaneGeometry(1, 1)), own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })));
    m.scale.set(width, height, 1);
    return m;
  }

  /**
   * A heavy blast door in a frame (two leaves sliding apart), across local X,
   * `open` 0..1 via the returned setOpen.
   */
  function blastDoor({ width = 2.4, height = 2.8 } = {}) {
    const root = new THREE.Group();
    const leaves = [];
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Group();
      part(leaf, M.darkSteel, width / 2, height, 0.18, 0, height / 2, 0, { r: 0.02 });
      for (let i = 0; i < 6; i += 1) part(leaf, M.hazard, width / 2 - 0.02, 0.1, 0.012, 0, 0.3 + i * 0.42, 0.095, { rz: sx * 0.6, cast: false });
      part(leaf, M.steel, 0.06, height - 0.4, 0.04, -sx * (width / 4 - 0.06), height / 2, 0.11);
      root.add(leaf);
      leaves.push({ leaf, sx });
    }
    const setOpen = (k) => {
      for (const { leaf, sx } of leaves) leaf.position.x = sx * (width / 4 + k * (width / 2 + 0.05));
    };
    setOpen(0);
    return { root, setOpen };
  }

  return {
    M, part, rod, ball, tube, drape, sign, pipe, cagedLamp,
    hospitalBed, bodyBlanket, ivStand, monitorStand, bedsideCabinet, headwall, curtain, sink, wheelchair, wallClock, blindWindow,
    officeChair, plant, bookshelf, filingCabinet, deskLamp, laptop, mug, papers, serverRack, consoleDesk, blastDoor,
    roundedBox: rbox,
  };
}
