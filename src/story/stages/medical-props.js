/**
 * The briefing's equipment: what makes an operating theatre and a lab read
 * as real ones. Built from the prop kit's parts and materials (props.js), at
 * real scale (metres), each a THREE.Group standing on y = 0, facing +Z.
 *
 *   const med = createMedicalProps(kit, own);
 *   scene.add(med.surgicalLight());          // ceiling boom, two domes
 *   const m = med.vitalsMonitor();            // m.update(time) - a live ECG
 *   scene.add(med.anaesthesiaMachine(m.screen), m.root)
 *
 * The screens are canvases drawn here (an ECG and the numbers beside it);
 * `update(time)` redraws them a few times a second.
 */

import * as THREE from "../../three.js";

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.canvas = c;
  return t;
}

export function createMedicalProps(kit, own) {
  const { M, part, rod, ball, tube } = kit;
  const mat = (o) => own(new THREE.MeshStandardMaterial(o));
  const glow = (color) => own(new THREE.MeshBasicMaterial({ color }));
  const local = {
    green: mat({ color: 0x2f7a46, metalness: 0.3, roughness: 0.45 }),
    white: mat({ color: 0xe7ecee, metalness: 0.1, roughness: 0.4 }),
    red: mat({ color: 0xa8201c, metalness: 0.2, roughness: 0.45 }),
    yellow: mat({ color: 0xe8c21a, metalness: 0.1, roughness: 0.5 }),
    clear: own(new THREE.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false })),
    amber: own(new THREE.MeshStandardMaterial({ color: 0xc7832a, transparent: true, opacity: 0.55, roughness: 0.1 })),
    film: own(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    dome: glow(new THREE.Color(2.4, 2.35, 2.2)),
    specimen: own(new THREE.MeshStandardMaterial({ color: 0xb9d68a, transparent: true, opacity: 0.55, roughness: 0.1, emissive: 0x24381a, emissiveIntensity: 0.5 })),
  };

  /** A screen: a canvas on a plane, redrawn by `draw(g, w, h, time)`. */
  function screen(w, h, px, draw) {
    const texture = own(canvasTexture(px, Math.round((px * h) / w), (g, cw, ch) => draw(g, cw, ch, 0)));
    const material = own(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), material);
    let next = 0;
    mesh.userData.update = (time) => {
      if (time < next) return;
      next = time + 0.06;
      const c = texture.userData.canvas;
      draw(c.getContext("2d"), c.width, c.height, time);
      texture.needsUpdate = true;
    };
    return mesh;
  }

  /** The vitals: an ECG sweeping across, the pleth under it, HR / SpO2 / BP. */
  function drawVitals(g, w, h, time) {
    g.fillStyle = "#020807";
    g.fillRect(0, 0, w, h);
    const trace = (y, amp, colour, fn) => {
      g.strokeStyle = colour;
      g.lineWidth = 2;
      g.beginPath();
      const sweep = (time * 0.35) % 1;
      for (let i = 0; i <= 120; i += 1) {
        const u = i / 120;
        if (Math.abs(u - sweep) < 0.02) {
          g.stroke();
          g.beginPath();
          continue;
        }
        const x = 8 + u * (w * 0.66);
        const v = fn(u * 4.2 + Math.floor(time * 0.35) * 4.2);
        if (i === 0) g.moveTo(x, y - v * amp);
        else g.lineTo(x, y - v * amp);
      }
      g.stroke();
    };
    const ecg = (t) => {
      const p = t % 1;
      return p > 0.42 && p < 0.46 ? -0.3 : p > 0.46 && p < 0.5 ? 1 : p > 0.5 && p < 0.54 ? -0.45 : p > 0.68 && p < 0.8 ? 0.22 * Math.sin(((p - 0.68) / 0.12) * Math.PI) : 0;
    };
    trace(h * 0.32, h * 0.22, "#5dff8a", ecg);
    trace(h * 0.72, h * 0.12, "#5fd6ff", (t) => Math.max(0, Math.sin((t % 1) * Math.PI * 2 - 0.6)) ** 1.6);
    g.textAlign = "right";
    g.fillStyle = "#5dff8a";
    g.font = `bold ${Math.round(h * 0.2)}px monospace`;
    g.fillText(String(52 + Math.round(Math.sin(time * 0.7) * 2)), w - 10, h * 0.3);
    g.fillStyle = "#5fd6ff";
    g.fillText("96", w - 10, h * 0.62);
    g.font = `bold ${Math.round(h * 0.1)}px monospace`;
    g.fillStyle = "#ff6b6b";
    g.fillText("NIBP 88/54", w - 10, h * 0.9);
    g.fillStyle = "#8aa";
    g.textAlign = "left";
    g.fillText("HR", w * 0.7, h * 0.12);
  }

  /** A patient monitor on an arm (or on a machine): bezel, screen, buttons. */
  function vitalsMonitor() {
    const root = new THREE.Group();
    part(root, M.plasticGrey, 0.42, 0.3, 0.08, 0, 0, 0, { r: 0.02 });
    const s = screen(0.36, 0.22, 384, drawVitals);
    s.position.set(-0.01, 0.01, 0.041);
    root.add(s);
    for (let i = 0; i < 4; i += 1) part(root, M.plasticDark, 0.025, 0.014, 0.01, 0.17, 0.09 - i * 0.04, 0.042);
    return { root, update: (time) => s.userData.update(time) };
  }

  /** The surgical light: a ceiling mount, a jointed boom, two lit domes. */
  function surgicalLight({ heads = [[0.35, 2.25, -0.25, -0.5], [-0.5, 2.15, 0.35, 0.45]] } = {}) {
    const root = new THREE.Group();
    part(root, M.painted, 0.5, 0.06, 0.5, 0, 3.05, 0, { r: 0.02 });
    rod(root, M.painted, 0.06, 0.45, 0, 2.8, 0);
    for (const [x, y, z, tilt] of heads) {
      // The boom out to the head, a yoke, the dome with its ring of lamps.
      const len = Math.hypot(x, z);
      const arm = rod(root, M.painted, 0.035, len, x / 2, 2.6, z / 2, { rz: Math.PI / 2, ry: -Math.atan2(z, x) });
      arm.rotation.order = "YXZ";
      rod(root, M.painted, 0.03, 2.6 - y - 0.12, x, (2.6 + y + 0.12) / 2, z);
      const head = new THREE.Group();
      head.position.set(x, y, z);
      head.rotation.set(tilt * 0.6, 0, tilt * 0.4);
      const shell = new THREE.Mesh(own(new THREE.SphereGeometry(0.34, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2.4)), M.painted);
      head.add(shell);
      const lens = new THREE.Mesh(own(new THREE.CircleGeometry(0.3, 28)), local.dome);
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.005;
      head.add(lens);
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        const cell = new THREE.Mesh(own(new THREE.CircleGeometry(0.055, 14)), M.chrome);
        cell.rotation.x = Math.PI / 2;
        cell.position.set(Math.cos(a) * 0.18, -0.01, Math.sin(a) * 0.18);
        head.add(cell);
      }
      rod(head, M.chrome, 0.025, 0.12, 0, -0.06, 0);
      root.add(head);
    }
    return root;
  }

  /** The anaesthesia machine: cabinet, vaporisers, bellows, cylinders, hoses, its monitor. */
  function anaesthesiaMachine(monitor = null) {
    const root = new THREE.Group();
    part(root, M.plasticGrey, 0.75, 0.85, 0.6, 0, 0.55, 0, { r: 0.03 });
    part(root, M.painted, 0.79, 0.05, 0.64, 0, 1.0, 0, { r: 0.01 });
    for (let i = 0; i < 3; i += 1) part(root, M.plasticDark, 0.68, 0.18, 0.02, 0, 0.32 + i * 0.22, 0.3, { r: 0.01 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.rod(root, M.rubber, 0.05, 0.03, sx * 0.3, 0.05, sz * 0.24, { rz: Math.PI / 2 });
    // The bellows in its clear housing; the vaporisers (one yellow, one blue).
    rod(root, local.clear, 0.09, 0.32, 0.24, 1.2, 0.12, { seg: 20 });
    rod(root, M.rubber, 0.07, 0.2, 0.24, 1.15, 0.12, { seg: 16 });
    part(root, local.yellow, 0.1, 0.2, 0.12, -0.12, 1.14, 0.14, { r: 0.015 });
    part(root, M.paintedBlue, 0.1, 0.2, 0.12, -0.26, 1.14, 0.14, { r: 0.015 });
    // A tower with the flowmeters, the monitor on top.
    part(root, M.plasticGrey, 0.32, 0.5, 0.22, -0.18, 1.38, -0.12, { r: 0.02 });
    for (let i = 0; i < 4; i += 1) rod(root, local.clear, 0.012, 0.22, -0.28 + i * 0.065, 1.42, -0.005);
    if (monitor) {
      monitor.position.set(0.05, 1.86, -0.05);
      monitor.rotation.x = -0.12;
      root.add(monitor);
      rod(root, M.painted, 0.02, 0.3, 0.05, 1.68, -0.08);
    }
    // Cylinders on the back: oxygen (green-shouldered), air.
    for (const [x, colour] of [[-0.25, local.green], [0.0, local.white], [0.25, local.green]]) {
      rod(root, M.steel, 0.075, 0.7, x, 0.55, -0.36, { seg: 16 });
      ball(root, colour, 0.075, 0.06, 0.075, x, 0.92, -0.36);
      rod(root, M.chrome, 0.018, 0.08, x, 1.0, -0.36);
    }
    // The breathing circuit: two corrugated hoses off toward the patient.
    tube(root, M.plasticGrey, [[0.24, 1.0, 0.25], [0.3, 1.05, 0.6], [0.2, 1.0, 1.0], [0.05, 1.02, 1.35]], 0.022);
    tube(root, M.paintedBlue, [[0.18, 1.0, 0.25], [0.22, 1.08, 0.62], [0.12, 1.03, 1.0], [0.0, 1.03, 1.32]], 0.02);
    return root;
  }

  /** A Mayo stand: one leg, a tray, the instruments laid out on a green towel. */
  function instrumentTray() {
    const root = new THREE.Group();
    part(root, M.darkSteel, 0.5, 0.03, 0.08, 0, 0.03, 0);
    rod(root, M.chrome, 0.02, 1.0, 0.2, 0.52, 0);
    part(root, M.steel, 0.62, 0.02, 0.42, 0, 1.03, 0.12, { r: 0.008 });
    part(root, local.green, 0.58, 0.004, 0.38, 0, 1.042, 0.12);
    // Scalpels, forceps, scissors, clamps, retractors, gauze.
    for (let i = 0; i < 7; i += 1) {
      const x = -0.24 + i * 0.075;
      part(root, M.chrome, 0.012, 0.006, i % 3 === 0 ? 0.22 : 0.17, x, 1.05, 0.12, { ry: (i % 2 ? 1 : -1) * 0.04 });
      if (i % 3 === 1) for (const s of [-1, 1]) rod(root, M.chrome, 0.012, 0.004, x + s * 0.012, 1.05, 0.03, { rx: Math.PI / 2 });
    }
    part(root, M.linen, 0.1, 0.02, 0.1, 0.21, 1.055, 0.0, { r: 0.008 });
    ball(root, M.steel, 0.06, 0.025, 0.06, -0.18, 1.055, 0.24);
    return root;
  }

  /** The crash cart: red drawers, a defibrillator on top, paddles, a sharps bin. */
  function crashCart() {
    const root = new THREE.Group();
    part(root, local.red, 0.7, 0.95, 0.5, 0, 0.55, 0, { r: 0.02 });
    for (let i = 0; i < 5; i += 1) {
      part(root, M.plasticDark, 0.64, 0.004, 0.01, 0, 0.24 + i * 0.17, 0.252);
      part(root, M.chrome, 0.16, 0.02, 0.02, 0, 0.32 + i * 0.17, 0.262);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.rod(root, M.rubber, 0.05, 0.03, sx * 0.28, 0.05, sz * 0.2, { rz: Math.PI / 2 });
    part(root, M.plasticDark, 0.42, 0.2, 0.32, -0.08, 1.13, 0, { r: 0.03 });
    const s = screen(0.16, 0.1, 192, (g, w, h, t) => {
      g.fillStyle = "#031006";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#ffd36a";
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x < w; x += 2) g.lineTo(x, h * 0.55 + Math.sin(x * 0.2 + t * 6) * h * 0.08);
      g.stroke();
      g.fillStyle = "#ffd36a";
      g.font = `bold ${Math.round(h * 0.28)}px monospace`;
      g.fillText("200J", 6, h * 0.3);
    });
    s.position.set(-0.12, 1.15, 0.161);
    root.add(s);
    for (const x of [0.08, 0.16]) part(root, local.yellow, 0.06, 0.1, 0.05, x, 1.16, 0.08, { r: 0.012 });
    part(root, local.yellow, 0.14, 0.18, 0.12, 0.26, 1.13, -0.08, { r: 0.02 });
    root.userData.update = (time) => s.userData.update(time);
    return root;
  }

  /** A rack of gas cylinders, chained to the wall. */
  function cylinderRack(count = 3) {
    const root = new THREE.Group();
    part(root, M.darkSteel, count * 0.26, 0.04, 0.3, 0, 0.02, 0);
    part(root, M.darkSteel, count * 0.26, 0.04, 0.04, 0, 0.9, -0.12);
    for (let i = 0; i < count; i += 1) {
      const x = (i - (count - 1) / 2) * 0.26;
      rod(root, M.steel, 0.1, 1.25, x, 0.66, 0, { seg: 18 });
      ball(root, i % 2 ? local.white : local.green, 0.1, 0.08, 0.1, x, 1.29, 0);
      rod(root, M.chrome, 0.022, 0.1, x, 1.39, 0);
      rod(root, M.chrome, 0.006, 0.26, x, 0.9, 0.1, { rz: Math.PI / 2 });
    }
    return root;
  }

  /** An X-ray lightbox on the wall, two films of a chest and a hand on it. */
  function lightbox() {
    const root = new THREE.Group();
    part(root, M.plasticGrey, 1.2, 0.6, 0.08, 0, 0, 0, { r: 0.015 });
    const t = own(canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = "#e9f2f6";
      g.fillRect(0, 0, w, h);
      for (const ox of [12, w / 2 + 6]) {
        g.fillStyle = "#0a0d10";
        g.fillRect(ox, 12, w / 2 - 18, h - 24);
        g.strokeStyle = "rgba(220,235,240,0.75)";
        g.fillStyle = "rgba(220,235,240,0.55)";
        const cx = ox + (w / 2 - 18) / 2;
        if (ox < w / 2) {
          // A chest: spine, ribs, the heart's shadow.
          g.fillRect(cx - 4, 24, 8, h - 48);
          g.lineWidth = 3;
          for (let i = 0; i < 9; i += 1) {
            const y = 40 + i * 20;
            for (const s of [-1, 1]) {
              g.beginPath();
              g.moveTo(cx, y);
              g.quadraticCurveTo(cx + s * 70, y - 10, cx + s * 95, y + 22);
              g.stroke();
            }
          }
          g.fillStyle = "rgba(220,235,240,0.25)";
          g.beginPath();
          g.ellipse(cx + 18, 150, 34, 40, 0.3, 0, Math.PI * 2);
          g.fill();
        } else {
          // A hand: the bones of five fingers.
          g.lineWidth = 6;
          g.lineCap = "round";
          for (let f = 0; f < 5; f += 1) {
            const a = -0.9 + f * 0.42;
            g.beginPath();
            g.moveTo(cx, h - 40);
            g.lineTo(cx + Math.sin(a) * 120, h - 40 - Math.cos(a) * (f === 0 ? 90 : 160));
            g.stroke();
          }
        }
      }
    }));
    const face = new THREE.Mesh(own(new THREE.PlaneGeometry(1.12, 0.52)), own(new THREE.MeshBasicMaterial({ map: t, toneMapped: false })));
    face.position.z = 0.041;
    root.add(face);
    return root;
  }

  /** A yellow clinical-waste bin with its pedal and lid. */
  function wasteBin() {
    const root = new THREE.Group();
    part(root, local.yellow, 0.36, 0.55, 0.32, 0, 0.28, 0, { r: 0.04 });
    part(root, local.yellow, 0.38, 0.05, 0.34, 0, 0.58, -0.01, { r: 0.02, rx: -0.06 });
    part(root, M.darkSteel, 0.12, 0.02, 0.08, 0, 0.03, 0.2);
    part(root, M.black, 0.12, 0.12, 0.004, 0, 0.36, 0.162);
    return root;
  }

  /* ---- The labs ---- */

  /** A steel shelving unit of specimen jars - bodies in formalin, labelled. */
  function specimenShelf({ width = 1.8, seed = 1 } = {}) {
    const root = new THREE.Group();
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (const x of [-width / 2, width / 2]) for (const z of [-0.2, 0.2]) part(root, M.steel, 0.04, 2.1, 0.04, x, 1.05, z);
    for (let i = 0; i < 5; i += 1) {
      const y = 0.25 + i * 0.44;
      part(root, M.steel, width, 0.03, 0.44, 0, y, 0);
      if (i === 4) break;
      for (let x = -width / 2 + 0.14; x < width / 2 - 0.1; x += 0.2 + rnd() * 0.08) {
        const r = 0.06 + rnd() * 0.04;
        const hgt = 0.2 + rnd() * 0.12;
        rod(root, local.clear, r, hgt, x, y + 0.015 + hgt / 2, 0.02, { seg: 14 });
        if (rnd() < 0.85) ball(root, rnd() < 0.5 ? local.specimen : local.amber, r * 0.7, hgt * 0.32, r * 0.7, x, y + 0.02 + hgt * 0.42, 0.02);
        rod(root, M.plasticDark, r * 1.04, 0.03, x, y + 0.03 + hgt, 0.02, { seg: 14 });
        part(root, M.paper, r * 1.1, 0.05, 0.002, x, y + 0.03 + hgt * 0.55, 0.02 + r + 0.002);
      }
    }
    return root;
  }

  /** A lab bench: a worktop on cabinets, a centrifuge, a monitor, a rack of tubes. */
  function labBench({ width = 2.4, microscope = null } = {}) {
    const root = new THREE.Group();
    part(root, M.painted, width, 0.86, 0.7, 0, 0.43, 0, { r: 0.02 });
    part(root, M.darkSteel, width + 0.04, 0.04, 0.74, 0, 0.88, 0);
    for (let x = -width / 2 + 0.3; x < width / 2; x += 0.6) part(root, M.chrome, 0.14, 0.02, 0.02, x, 0.72, 0.36);
    // A centrifuge.
    rod(root, M.white ?? local.white, 0.2, 0.26, -width / 2 + 0.35, 1.03, 0, { seg: 24 });
    rod(root, local.clear, 0.17, 0.02, -width / 2 + 0.35, 1.17, 0, { seg: 24 });
    part(root, M.plasticDark, 0.12, 0.05, 0.02, -width / 2 + 0.35, 1.0, 0.2);
    // A tube rack.
    part(root, M.plasticGrey, 0.3, 0.08, 0.12, 0.05, 0.94, 0.15, { r: 0.01 });
    for (let i = 0; i < 6; i += 1) rod(root, i % 2 ? local.specimen : local.amber, 0.012, 0.12, -0.07 + i * 0.05, 1.0, 0.15);
    // A monitor with the trial's numbers.
    const mon = new THREE.Group();
    part(mon, M.plasticDark, 0.56, 0.34, 0.04, 0, 0.17, 0, { r: 0.01 });
    const s = screen(0.52, 0.3, 320, (g, w, h, t) => {
      g.fillStyle = "#03120c";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#2bd38c";
      g.lineWidth = 2;
      for (let row = 0; row < 3; row += 1) {
        g.beginPath();
        for (let x = 0; x < w; x += 4) g.lineTo(x, h * (0.25 + row * 0.25) + Math.sin(x * 0.05 + t * (1 + row) + row) * h * 0.06);
        g.stroke();
      }
      g.fillStyle = "#ffd36a";
      g.font = `bold ${Math.round(h * 0.1)}px monospace`;
      g.fillText("CELL DRIFT +3.1%", 8, h * 0.95);
    });
    s.position.set(0, 0.17, 0.021);
    mon.add(s);
    rod(mon, M.plasticDark, 0.02, 0.12, 0, -0.06, -0.02);
    mon.position.set(width / 2 - 0.45, 0.96, -0.12);
    root.add(mon);
    if (microscope) {
      microscope.position.set(-0.35, 0.9, -0.05);
      root.add(microscope);
    }
    root.userData.update = (time) => s.userData.update(time);
    return root;
  }

  /** A fume hood: a cabinet with a sash window, lit inside, a vent duct up. */
  function fumeHood() {
    const root = new THREE.Group();
    part(root, M.painted, 1.5, 0.9, 0.8, 0, 0.45, 0, { r: 0.02 });
    part(root, M.painted, 1.5, 1.2, 0.08, 0, 1.5, -0.36);
    for (const sx of [-1, 1]) part(root, M.painted, 0.08, 1.2, 0.8, sx * 0.71, 1.5, 0);
    part(root, M.painted, 1.5, 0.25, 0.8, 0, 2.2, 0);
    part(root, local.clear, 1.34, 0.7, 0.02, 0, 1.6, 0.36);
    part(root, M.lampGlow, 1.2, 0.03, 0.4, 0, 2.06, 0, { cast: false });
    rod(root, M.steel, 0.15, 1.2, 0, 2.9, -0.1, { seg: 16 });
    // Flasks inside.
    for (const [x, colour] of [[-0.3, local.specimen], [0.1, local.amber], [0.35, local.clear]]) {
      ball(root, colour, 0.08, 0.08, 0.08, x, 1.0, 0);
      rod(root, local.clear, 0.02, 0.12, x, 1.12, 0);
    }
    return root;
  }

  return { vitalsMonitor, surgicalLight, anaesthesiaMachine, instrumentTray, crashCart, cylinderRack, lightbox, wasteBin, specimenShelf, labBench, fumeHood };
}
