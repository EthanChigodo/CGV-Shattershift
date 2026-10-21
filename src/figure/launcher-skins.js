/**
 * Launcher skins: patterned finishes for the sphere launcher - not a tint,
 * a pattern: tiger stripes, woodland camo, digital camo, carbon fibre,
 * hazard stripes, a galaxy, flames, arctic camo, a neon grid, gold.
 *
 *   applyLauncherSkin(model, "tiger")   // any launcher model, any time
 *   savedLauncherSkin() / saveLauncherSkin(key)
 *
 * Each pattern is drawn once on a canvas. The launcher's own UVs are an
 * atlas, so a pattern laid on them would come out in scraps; instead the
 * pattern is projected onto the model from its three axes and blended by
 * the surface normal (triplanar mapping), in object space - so it wraps the
 * barrel and the grips continuously and sticks to the model as it moves.
 * Spliced into the launcher's own materials (onBeforeCompile), so they keep
 * their lighting, the heat glow and the shadows; the model's own texture
 * shows through a little as wear.
 */

import * as THREE from "../three.js";

/** The skins: [label, how it's drawn, surface]. "factory" is the model's own. */
export const LAUNCHER_SKINS = {
  factory: { label: "Factory", swatch: "linear-gradient(135deg,#4b5560,#20262c)" },
  tiger: { label: "Tiger", swatch: "repeating-linear-gradient(110deg,#e8801c 0 9px,#111 9px 13px)", rough: 0.55, metal: 0.1 },
  camo: { label: "Woodland", swatch: "radial-gradient(circle at 30% 30%,#56623a 0 30%,transparent 31%),radial-gradient(circle at 70% 65%,#2e3520 0 28%,transparent 29%),#7a6a45", rough: 0.75, metal: 0.05 },
  digital: { label: "Digital", swatch: "conic-gradient(#6e7880 0 25%,#3c444b 0 50%,#9aa3aa 0 75%,#252b30 0)", rough: 0.6, metal: 0.15 },
  carbon: { label: "Carbon", swatch: "repeating-linear-gradient(45deg,#1c1f22 0 4px,#33383d 4px 8px)", rough: 0.32, metal: 0.4 },
  hazard: { label: "Hazard", swatch: "repeating-linear-gradient(45deg,#f2c21b 0 8px,#121212 8px 16px)", rough: 0.5, metal: 0.2 },
  galaxy: { label: "Galaxy", swatch: "radial-gradient(circle at 40% 40%,#b45cff,#2a1060 50%,#05040f)", rough: 0.3, metal: 0.3, glow: 0.6 },
  flames: { label: "Flames", swatch: "linear-gradient(0deg,#ffd23f,#ff5a1a 45%,#141414 70%)", rough: 0.4, metal: 0.25, glow: 0.35 },
  arctic: { label: "Arctic", swatch: "radial-gradient(circle at 30% 40%,#c9d6df 0 30%,transparent 31%),radial-gradient(circle at 70% 60%,#7f93a3 0 25%,transparent 26%),#eef3f6", rough: 0.7, metal: 0.05 },
  neon: { label: "Neon", swatch: "repeating-linear-gradient(90deg,#00f0ff 0 2px,transparent 2px 10px),repeating-linear-gradient(0deg,#ff2fa0 0 2px,#0b0f14 2px 10px)", rough: 0.35, metal: 0.3, glow: 1 },
  gold: { label: "Gold", swatch: "linear-gradient(135deg,#fff1b8,#e0ad2a 45%,#7a5410)", rough: 0.2, metal: 1 },
  // Unlocked (src/figure/kits.js): the Escapee kit, the Fracture kit.
  ember: { label: "Molten", swatch: "radial-gradient(circle at 35% 45%,#ffb347 0 6%,transparent 7%),linear-gradient(120deg,#1a1210 0 40%,#ff7a2a 42%,#1a1210 46% 70%,#ff9a3c 72%,#1a1210 75%)", rough: 0.6, metal: 0.2, glow: 1.1, kit: "escapee" },
  prism: { label: "Prism", swatch: "conic-gradient(from 30deg,#7ef4f1,#b48cff,#ff8ad8,#ffe08a,#7ef4f1)", rough: 0.18, metal: 0.55, glow: 0.9, kit: "fracture" },
};
export const LAUNCHER_SKIN_ORDER = Object.keys(LAUNCHER_SKINS);

const KEY = "fractureRun.launcherSkin";
export function savedLauncherSkin() {
  try {
    const v = localStorage.getItem(KEY);
    if (v && LAUNCHER_SKINS[v]) return v;
  } catch {
    /* storage unavailable */
  }
  return "factory";
}
export function saveLauncherSkin(key) {
  if (!LAUNCHER_SKINS[key]) return;
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* ignore */
  }
}

/* ---- The patterns, drawn once each ---------------------------------------- */

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function blobs(g, size, colours, count, rMin, rMax, random) {
  for (const colour of colours) {
    g.fillStyle = colour;
    for (let i = 0; i < count; i += 1) {
      const x = random() * size;
      const y = random() * size;
      const r = rMin + random() * (rMax - rMin);
      g.beginPath();
      // A lumpy blob: a ring of points pushed in and out.
      const n = 9;
      for (let k = 0; k <= n; k += 1) {
        const a = (k / n) * Math.PI * 2;
        const rr = r * (0.7 + random() * 0.6);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr * 0.75;
        if (k === 0) g.moveTo(px, py);
        else g.quadraticCurveTo(x + Math.cos(a - 0.35) * rr * 1.2, y + Math.sin(a - 0.35) * rr * 0.9, px, py);
      }
      g.fill();
      // Tiled: the same blob on the far edges, so the pattern repeats seamlessly.
      for (const [dx, dy] of [[size, 0], [-size, 0], [0, size], [0, -size]]) {
        if (x + dx < -r || x + dx > size + r || y + dy < -r || y + dy > size + r) continue;
        g.save();
        g.translate(dx, dy);
        g.beginPath();
        g.arc(x, y, r * 0.8, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }
}

const drawers = {
  tiger(g, s, random) {
    g.fillStyle = "#e8801c";
    g.fillRect(0, 0, s, s);
    // A warm belly-light gradient through it.
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, "rgba(255,200,120,0.35)");
    grad.addColorStop(1, "rgba(160,60,0,0.25)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#111";
    for (let i = 0; i < 16; i += 1) {
      const x = (i / 16) * s + random() * 12;
      const w = 6 + random() * 10;
      g.beginPath();
      g.moveTo(x, -10);
      // A stripe that tapers and forks as it runs across.
      for (let y = 0; y <= s + 10; y += 16) g.lineTo(x + Math.sin(y * 0.03 + i) * 18 + (random() - 0.5) * 6, y);
      for (let y = s + 10; y >= -10; y -= 16) g.lineTo(x + w * (0.4 + 0.6 * Math.abs(Math.sin(y * 0.012 + i))) + Math.sin(y * 0.03 + i) * 18, y);
      g.closePath();
      g.fill();
    }
  },
  camo(g, s, random) {
    g.fillStyle = "#7a6a45";
    g.fillRect(0, 0, s, s);
    blobs(g, s, ["#56623a", "#2e3520", "#1a1c14"], 14, 18, 46, random);
  },
  arctic(g, s, random) {
    g.fillStyle = "#eef3f6";
    g.fillRect(0, 0, s, s);
    blobs(g, s, ["#c9d6df", "#7f93a3", "#3e4c57"], 12, 16, 40, random);
  },
  digital(g, s, random) {
    const cell = 8;
    const colours = ["#6e7880", "#3c444b", "#9aa3aa", "#252b30"];
    for (let y = 0; y < s; y += cell) {
      for (let x = 0; x < s; x += cell) {
        // Clumped pixels: neighbours tend to share a colour.
        const n = Math.sin(x * 0.045) + Math.sin(y * 0.05 + x * 0.02) + random() * 1.4;
        g.fillStyle = colours[Math.max(0, Math.min(3, Math.floor((n + 2) * 0.85)))];
        g.fillRect(x, y, cell, cell);
      }
    }
  },
  carbon(g, s) {
    const c = 8;
    for (let y = 0; y < s; y += c) {
      for (let x = 0; x < s; x += c) {
        const odd = ((x / c + y / c) & 1) === 1;
        const grad = odd ? g.createLinearGradient(x, y, x + c, y) : g.createLinearGradient(x, y, x, y + c);
        grad.addColorStop(0, "#15181b");
        grad.addColorStop(0.5, "#3a4046");
        grad.addColorStop(1, "#15181b");
        g.fillStyle = grad;
        g.fillRect(x, y, c, c);
      }
    }
  },
  hazard(g, s) {
    g.fillStyle = "#f2c21b";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#121212";
    const w = s / 8;
    for (let i = -8; i < 16; i += 1) {
      g.beginPath();
      g.moveTo(i * w * 2, 0);
      g.lineTo(i * w * 2 + w, 0);
      g.lineTo(i * w * 2 + w + s, s);
      g.lineTo(i * w * 2 + s, s);
      g.closePath();
      g.fill();
    }
  },
  ember(g, s, random) {
    // Basalt, cracked through to the glow beneath.
    g.fillStyle = "#1a1210";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i += 1) {
      g.fillStyle = `rgba(${40 + random() * 30},${28 + random() * 18},${22 + random() * 12},0.6)`;
      g.fillRect(random() * s, random() * s, 3 + random() * 6, 3 + random() * 6);
    }
    for (const [width, colour] of [[9, "rgba(255,90,20,0.35)"], [4, "#ff7a2a"], [1.6, "#ffd27a"]]) {
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.lineCap = "round";
      const r2 = rng(7);
      for (let c = 0; c < 14; c += 1) {
        let x = r2() * s;
        let y = r2() * s;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 7; k += 1) {
          x += (r2() - 0.5) * 70;
          y += (r2() - 0.5) * 70;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  },
  prism(g, s, random) {
    // Shards of holographic glass: each a sweep through the spectrum, white-edged.
    g.fillStyle = "#0b0f18";
    g.fillRect(0, 0, s, s);
    const hues = ["#7ef4f1", "#b48cff", "#ff8ad8", "#ffe08a", "#8affc1"];
    for (let i = 0; i < 46; i += 1) {
      const x = random() * s;
      const y = random() * s;
      const r = 30 + random() * 70;
      const pts = [0, 1, 2].map((k) => [x + Math.cos(k * 2.1 + i) * r * (0.6 + random() * 0.6), y + Math.sin(k * 2.1 + i) * r * (0.6 + random() * 0.6)]);
      const grad = g.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
      grad.addColorStop(0, hues[i % 5]);
      grad.addColorStop(0.5, hues[(i + 2) % 5]);
      grad.addColorStop(1, hues[(i + 4) % 5]);
      g.globalAlpha = 0.55;
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.lineTo(...pts[2]); g.closePath();
      g.fill();
      g.globalAlpha = 0.9;
      g.strokeStyle = "rgba(255,255,255,0.8)";
      g.lineWidth = 1.2;
      g.stroke();
    }
    g.globalAlpha = 1;
  },
  galaxy(g, s, random) {
    g.fillStyle = "#05040f";
    g.fillRect(0, 0, s, s);
    for (const [colour, count] of [["rgba(180,92,255,0.35)", 6], ["rgba(60,140,255,0.3)", 5], ["rgba(255,60,170,0.25)", 4]]) {
      for (let i = 0; i < count; i += 1) {
        const x = random() * s;
        const y = random() * s;
        const r = 40 + random() * 90;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, colour);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }
    }
    for (let i = 0; i < 420; i += 1) {
      const b = random();
      g.fillStyle = `rgba(255,255,255,${0.3 + b * 0.7})`;
      g.fillRect(random() * s, random() * s, b > 0.92 ? 2 : 1, b > 0.92 ? 2 : 1);
    }
  },
  flames(g, s, random) {
    g.fillStyle = "#141414";
    g.fillRect(0, 0, s, s);
    // Licks of flame rising from the bottom edge.
    for (let i = 0; i < 9; i += 1) {
      const x = (i / 9) * s + random() * 20;
      const h = s * (0.45 + random() * 0.45);
      const grad = g.createLinearGradient(0, s, 0, s - h);
      grad.addColorStop(0, "#ffd23f");
      grad.addColorStop(0.45, "#ff5a1a");
      grad.addColorStop(1, "rgba(200,20,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - 24, s);
      g.bezierCurveTo(x - 30, s - h * 0.5, x + 14, s - h * 0.6, x + 4, s - h);
      g.bezierCurveTo(x + 24, s - h * 0.55, x + 30, s - h * 0.25, x + 26, s);
      g.closePath();
      g.fill();
    }
  },
  neon(g, s) {
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, s, s);
    const step = s / 8;
    g.lineWidth = 3;
    g.shadowBlur = 10;
    g.strokeStyle = "#00f0ff";
    g.shadowColor = "#00f0ff";
    for (let i = 0; i <= 8; i += 1) { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, s); g.stroke(); }
    g.strokeStyle = "#ff2fa0";
    g.shadowColor = "#ff2fa0";
    for (let i = 0; i <= 8; i += 1) { g.beginPath(); g.moveTo(0, i * step); g.lineTo(s, i * step); g.stroke(); }
  },
  gold(g, s, random) {
    const grad = g.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, "#fff1b8");
    grad.addColorStop(0.5, "#e0ad2a");
    grad.addColorStop(1, "#9a6c14");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // Fine brushed lines.
    for (let i = 0; i < 300; i += 1) {
      g.strokeStyle = `rgba(255,255,255,${random() * 0.12})`;
      const y = random() * s;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(s, y + (random() - 0.5) * 4);
      g.stroke();
    }
  },
};

const textures = new Map();
function skinTexture(key) {
  if (textures.has(key)) return textures.get(key);
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  drawers[key]?.(g, size, rng(key.length * 7919 + key.charCodeAt(0)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

/* ---- On the model ---------------------------------------------------------- */

const VERTEX_HEAD = /* glsl */ `
  varying vec3 vSkinPos;
  varying vec3 vSkinNormal;
`;
const FRAGMENT_HEAD = /* glsl */ `
  uniform sampler2D uSkinMap;
  uniform float uSkinOn;
  uniform float uSkinScale;
  uniform float uSkinGlow;
  varying vec3 vSkinPos;
  varying vec3 vSkinNormal;
  vec3 skinTriplanar() {
    vec3 n = abs(normalize(vSkinNormal));
    n = pow(n, vec3(4.0));
    n /= (n.x + n.y + n.z);
    vec3 p = vSkinPos * uSkinScale;
    vec3 x = texture2D(uSkinMap, p.zy).rgb;
    vec3 y = texture2D(uSkinMap, p.xz).rgb;
    vec3 z = texture2D(uSkinMap, p.xy).rgb;
    return x * n.x + y * n.y + z * n.z;
  }
`;

/**
 * Put a skin on a launcher model (any of the game's copies of it). Its
 * materials are made its own the first time; "factory" takes the skin off.
 */
export function applyLauncherSkin(model, key = "factory", { inPlace = false } = {}) {
  if (!model) return;
  const skin = LAUNCHER_SKINS[key] ?? LAUNCHER_SKINS.factory;
  const on = key !== "factory" && LAUNCHER_SKINS[key];
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const list = wasArray ? o.material : [o.material];
    // The pattern's size from the part's own: about two and a half repeats along it.
    o.geometry.boundingBox ?? o.geometry.computeBoundingBox();
    const size = o.geometry.boundingBox.getSize(new THREE.Vector3());
    const scale = 2.5 / Math.max(1e-4, size.x, size.y, size.z);
    const next = list.map((m) => {
      let mat = m;
      if (!mat.userData.skin) {
        // Its own copy (or, for a host that already made the launcher's
        // materials its own, that one), with the skin spliced in once.
        mat = inPlace ? m : m.clone();
        const uniforms = {
          uSkinMap: { value: skinTexture("tiger") },
          uSkinOn: { value: 0 },
          uSkinScale: { value: scale },
          uSkinGlow: { value: 0 },
        };
        mat.userData.skin = { uniforms, rough: mat.roughness, metal: mat.metalness };
        const before = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader, renderer) => {
          before?.call(mat, shader, renderer);
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
            .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vSkinPos = position;\n  vSkinNormal = normal;");
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
            .replace("#include <map_fragment>", `#include <map_fragment>
              if (uSkinOn > 0.5) {
                vec3 skinCol = skinTriplanar();
                // The model's own texture under it, a little: wear and edges.
                float own = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                diffuseColor.rgb = skinCol * (0.75 + 0.35 * own);
              }`)
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
              if (uSkinOn > 0.5) totalEmissiveRadiance += skinTriplanar() * uSkinGlow;`);
        };
        const k = mat.customProgramCacheKey?.() ?? "";
        mat.customProgramCacheKey = () => `${k}+launcher-skin`;
        mat.needsUpdate = true;
      }
      const s = mat.userData.skin;
      s.uniforms.uSkinOn.value = on ? 1 : 0;
      if (on) s.uniforms.uSkinMap.value = skinTexture(key);
      s.uniforms.uSkinGlow.value = on ? skin.glow ?? 0 : 0;
      if ("roughness" in mat) mat.roughness = on ? skin.rough ?? s.rough : s.rough;
      if ("metalness" in mat) mat.metalness = on ? skin.metal ?? s.metal : s.metal;
      return mat;
    });
    o.material = wasArray ? next : next[0];
  });
}
