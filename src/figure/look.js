/**
 * The player figure's look and its damage - one shader value, `wear`, and
 * one switch, `gear`.
 *
 * From Tebogo's task sheet (the new team storyline): the player is the last
 * surviving test subject of an illegal underground lab - kidnapped from the
 * city, woken in the basement ward by the one good scientist. They keep the
 * lab-subject look (patient scrubs, a hospital wristband, an IV port) with
 * one detail from the life they were taken from: their own grey t-shirt,
 * still on under the scrubs, showing at the neck and through the tears.
 *
 *   wear 0.00  Clean                  waking in the ward
 *        0.33  Dusty                  the basement: concrete dust, grime
 *        0.66  Bloodied and scratched the mutant lab: claw rips, scratches,
 *                                     blood, a bandaged forearm
 *   gear       Geared up              after the scientist's sacrifice: his
 *                                     vest and radio
 *
 *   const look = applyFigureLook(mesh, body);   // after the rig (characters.js)
 *   look.setWear(0.66);
 *   look.setGear(true);
 *
 * How it works. The shader is added to the character's own material (it
 * chains onto the rig's onBeforeCompile), so it is still one draw call:
 *
 *  - Which surface a pixel belongs to - the scrub top, skin, the trousers,
 *    the clogs - is read from where its UV falls in the texture atlas (each
 *    source material has its own rectangle, recorded by characters.js).
 *  - Where on the body it is comes from the REST-POSE position (the vertex
 *    position before the rig bends it), passed to the fragment shader as a
 *    varying. So a mark painted "on the left wrist" stays on the left wrist
 *    however the arm swings.
 *  - Damage patterns come from 3D noise of that rest position, compared
 *    against thresholds that move with `wear`: as wear rises, more of the
 *    noise field passes the threshold, so dust spreads and stains grow on
 *    their own - no separate textures per stage.
 *
 * Why tears are painted, not cut: an alpha cut-out (discard pixels where a
 * mask is below the wear value) would show empty space on these models -
 * they have no body under the clothes; the scrub top IS the torso's surface.
 * So a tear paints what is underneath: the t-shirt they were kidnapped in.
 *
 * Notes for the presentation: docs/figure-wear-shader.md.
 */

import * as THREE from "../three.js";

/** Wear values for each stage of the story. */
export const WEAR = { clean: 0, dusty: 0.33, bloodied: 0.66 };

/**
 * Skin tones the player can choose on the start screen. `light` is the
 * models' own; the others re-tint the skin in the shader (see uTone), so
 * every tone gets the same shading, damage and details.
 */
export const SKIN_TONES = {
  light: { label: "Light", color: null, swatch: "#e2b597" },
  medium: { label: "Medium", color: "#b0826a", swatch: "#b0826a" },
  brown: { label: "Brown", color: "#80563f", swatch: "#80563f" },
  dark: { label: "Dark", color: "#4d3427", swatch: "#4d3427" },
};
const SKIN_KEY = "fractureRun.skinTone";

/** The saved skin tone (start screen). */
export function savedSkinTone() {
  try {
    const saved = localStorage.getItem(SKIN_KEY);
    if (saved && SKIN_TONES[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  return "light";
}

export function saveSkinTone(name) {
  if (!SKIN_TONES[name]) return;
  try {
    localStorage.setItem(SKIN_KEY, name);
  } catch {
    /* ignore */
  }
}

/**
 * The figure at a point in the story: 0 = waking, 1..3 = the sector (the
 * Foundry, the Labs, the Skyline; the Roof is 3 as well). The gear comes
 * with the scientist's sacrifice at the Labs' lift, so it is on from the
 * ride up from the Labs onwards.
 */
export function figureStage(position) {
  const p = Math.max(0, Math.min(3, position));
  const wear = [WEAR.clean, WEAR.dusty, WEAR.bloodied, WEAR.bloodied][p];
  return { wear, gear: p >= 3 };
}

/** Skin tone of a model, averaged once from its body texture (cached per atlas). */
const skinCache = new WeakMap();
function skinTone(atlas, cell) {
  if (skinCache.has(atlas)) return skinCache.get(atlas);
  const fallback = new THREE.Color(0.72, 0.45, 0.34);
  const image = atlas?.image;
  if (!image || !cell || !image.getContext) return fallback;
  const [u0, v0, u1, v1] = cell;
  const ctx = image.getContext("2d", { willReadFrequently: true });
  const x = Math.floor(u0 * image.width);
  const y = Math.floor(v0 * image.height);
  const w = Math.floor((u1 - u0) * image.width);
  const h = Math.floor((v1 - v0) * image.height);
  let data;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return fallback;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    // Skin-like pixels only (not eyes, teeth, the dark cells).
    if (R > 110 && R > G * 1.05 && G > B && R - B > 30) {
      r += R;
      g += G;
      b += B;
      n += 1;
    }
  }
  const color = n ? new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace) : fallback;
  skinCache.set(atlas, color);
  return color;
}

const LOOK_VERTEX_HEAD = /* glsl */ `
  varying vec3 vRest;
`;

const LOOK_FRAGMENT_HEAD = /* glsl */ `
  varying vec3 vRest;
  uniform float uWear;
  uniform float uGear;
  uniform vec3 uSkin;
  uniform vec3 uTone;
  uniform float uToneOn;
  uniform vec4 uCellTop;
  uniform vec4 uCellBody;
  uniform vec4 uCellBottom;
  uniform vec4 uCellShoes;
  uniform float uShoulderX;
  uniform float uShoulderY;
  uniform float uArmLength;
  uniform float uHipY;
  uniform float uNeckY;

  bool inCell(vec2 uv, vec4 c) { return uv.x >= c.x && uv.x <= c.z && uv.y >= c.y && uv.y <= c.w; }

  // 3D value noise and a few octaves of it (fbm), for every damage pattern.
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { return 0.55 * n3(p) + 0.3 * n3(p * 2.1 + 7.3) + 0.15 * n3(p * 4.3 + 1.7); }

  // Claw marks: three parallel slashes. 'c' is where they start, 'dir' the
  // way they rake, 'len' how far they have torn (0..1). Returns 1 inside a
  // slash, fading to 0 at its ragged edge.
  float claw(vec2 q, vec2 c, vec2 dir, float len, float seed) {
    vec2 d = normalize(dir);
    vec2 n = vec2(-d.y, d.x);
    vec2 r = q - c;
    float along = dot(r, d);
    float across = dot(r, n);
    float marks = 0.0;
    for (int i = 0; i < 3; i++) {
      float offset = (float(i) - 1.0) * 0.035;
      float taper = smoothstep(0.0, 0.03, along) * (1.0 - smoothstep(len * 0.2 - 0.05, len * 0.2, along));
      float width = 0.007 * taper * (0.7 + 0.6 * n3(vec3(along * 60.0, float(i) + seed, seed)));
      marks = max(marks, 1.0 - smoothstep(width * 0.4, width, abs(across - offset)));
    }
    return marks * step(0.001, len);
  }
`;

/**
 * The look, run right after the atlas colour is sampled (map_fragment): it
 * rewrites diffuseColor before lighting, so every mark is lit like the rest
 * of the figure.
 */
const LOOK_FRAGMENT_MAIN = /* glsl */ `
  {
    vec2 uv = vMapUv;
    vec3 p = vRest;
    float w = uWear;
    vec3 col = diffuseColor.rgb;
    // The chosen skin tone (or the model's own).
    vec3 skin = mix(uSkin, uTone, uToneOn);
    vec3 dust = vec3(0.36, 0.33, 0.29);   // concrete dust
    vec3 grime = vec3(0.1, 0.085, 0.07);
    vec3 blood = vec3(0.24, 0.015, 0.01);
    vec3 tee = vec3(0.34, 0.35, 0.37);    // their own grey t-shirt

    // How far into each stage.
    float dusty = smoothstep(0.08, 0.33, w);
    float bloody = smoothstep(0.4, 0.66, w);

    // Where on the body: along an arm (0 at the shoulder joint), which side,
    // front or back.
    float ax = abs(p.x);
    bool arm = ax > uShoulderX * 0.95 && p.y > uShoulderY - 0.16;
    float along = arm ? (ax - uShoulderX) / uArmLength : -1.0;   // 0 shoulder .. 1 fingertips
    bool left = p.x > 0.0;                                        // the figure's left (model +X)
    bool front = p.z > 0.0;                                       // the model faces +Z
    float grain = fbm3(p * 9.0);

    bool top = inCell(uv, uCellTop);
    bool body = inCell(uv, uCellBody);
    bool legs = inCell(uv, uCellBottom);
    bool feet = inCell(uv, uCellShoes);
    bool bare = body || (top && arm && along > 0.2);

    // Skin tone: re-tint the skin in the body texture. Skin pixels are the
    // warm ones (red above blue and green); the whites of the eyes and the
    // teeth are grey, so they stay. Brightness relative to the model's own
    // average skin keeps every shadow, crease and the lips.
    if (body && uToneOn > 0.5) {
      float warm = smoothstep(0.015, 0.07, col.r - col.b) * smoothstep(-0.02, 0.02, col.r - col.g);
      vec3 luma = vec3(0.2126, 0.7152, 0.0722);
      vec3 tinted = uTone * (dot(col, luma) / max(0.001, dot(uSkin, luma)));
      col = mix(col, tinted, warm);
    }
    // Short-sleeved scrubs: past the sleeve's end the arm is bare skin.
    if (top && arm && along > 0.2) col = skin * (0.92 + 0.08 * grain);

    // ---- The scrub top ------------------------------------------------------
    if (top && !(arm && along > 0.2)) {
      // Short sleeves: the hem.
      if (arm && along > 0.182) col *= 0.8;
      // Their own t-shirt, under the scrubs, at the V of the neck.
      // A narrow V: 12 cm deep at the middle, closing to nothing 5 cm out.
      float vee = uNeckY - 0.14 + abs(p.x) * 2.4;
      if (front && !arm && abs(p.x) < 0.05 && p.y > vee && p.y < uNeckY - 0.015) col = tee * (0.9 + 0.1 * grain);
      // Dust: pale patches that spread with wear, heavier on the shoulders
      // and down the front where they brushed past things.
      float d = smoothstep(0.62 - 0.3 * dusty, 0.95 - 0.25 * dusty, fbm3(p * 7.0 + 2.0) + (front ? 0.08 : 0.0));
      col = mix(col, dust, d * dusty * 0.42);
      col = mix(col, grime, smoothstep(0.7, 1.0, grain) * w * 0.45);
      // Claw rips: a rake across the left of the chest and one down the
      // right of the back. Inside a rip, the t-shirt; at its edge, blood.
      vec2 q = p.xy;
      float rip = front ? claw(q, vec2(0.02, uShoulderY - 0.08), vec2(1.0, -0.75), bloody, 1.0)
                        : claw(q, vec2(-0.02, uShoulderY - 0.02), vec2(-0.6, -1.0), bloody, 5.0);
      col = mix(col, blood, smoothstep(0.0, 0.5, rip) * 0.8);
      if (rip > 0.6) col = tee * 0.8;
      // Blood: spatter that grows with the stage, and soaked in below the rips.
      float spatter = smoothstep(0.74 - 0.12 * bloody, 0.84, fbm3(p * 16.0 + 9.0)) * bloody;
      col = mix(col, blood, spatter * 0.9);
      float soak = bloody * smoothstep(0.5, 0.8, n3(p * 6.0 + 3.0)) * (front ? smoothstep(-0.02, 0.1, p.x) : (1.0 - smoothstep(-0.1, 0.02, p.x)));
      col = mix(col, blood, soak * 0.7);

      // Geared up: the scientist's vest over the scrubs - dark panels,
      // pouches across the front, straps over the shoulders, his radio on
      // the left of the chest with a green light.
      if (uGear > 0.5 && !arm) {
        float halfW = uShoulderX * 0.82;
        bool vestBand = p.y > uHipY + 0.04 && p.y < uShoulderY - 0.02 && abs(p.x) < halfW;
        bool strap = p.y >= uShoulderY - 0.02 && abs(abs(p.x) - 0.1) < 0.028;
        if (vestBand || strap) {
          vec3 vest = vec3(0.045, 0.05, 0.048) * (0.8 + 0.4 * n3(p * 90.0));
          if (vestBand && front) {
            // Three pouches low on the front, lighter at their flaps.
            float px = abs(fract((p.x + 0.045) / 0.09) - 0.5) * 0.09;
            if (p.y < uHipY + 0.17 && px < 0.034) vest = mix(vec3(0.07, 0.075, 0.065), vec3(0.11), step(uHipY + 0.145, p.y));
            // The radio: a black box, a green LED.
            vec2 r = vec2(p.x - 0.075, p.y - (uShoulderY - 0.12));
            if (abs(r.x) < 0.026 && abs(r.y) < 0.045) vest = vec3(0.02);
            if (length(r - vec2(0.012, 0.034)) < 0.005) vest = vec3(0.2, 1.4, 0.3);
          }
          col = vest;
        }
      }
    }

    // ---- Skin: face, neck, hands, bare arms ----------------------------------
    if (bare) {
      float d = smoothstep(0.7 - 0.3 * dusty, 1.0 - 0.25 * dusty, fbm3(p * 8.0 + 4.0));
      col = mix(col, mix(dust, grime, 0.5), d * dusty * 0.45);
      // Scratches: thin raised red lines on the forearms and hands.
      if (arm && along > 0.25) {
        float s = abs(fract(along * 42.0 + p.y * 30.0 + n3(p * 25.0) * 2.0) - 0.5);
        float scratch = (1.0 - smoothstep(0.0, 0.03, s)) * step(0.62, n3(p * vec3(5.0, 40.0, 40.0)));
        col = mix(col, vec3(0.45, 0.06, 0.05), scratch * bloody * 0.9);
      }
      col = mix(col, blood, smoothstep(0.82, 0.95, fbm3(p * 14.0)) * bloody * 0.7);
    }

    // ---- Things on the arms ------------------------------------------------------
    if (arm) {
      // Hospital wristband, left wrist: white band, blue stripe, the subject
      // number as rows of dashes round the wrist.
      float wrist = 0.63;
      if (left && abs(along - wrist) < 0.04) {
        float around = atan(p.z, p.y - uShoulderY);
        vec3 band = vec3(0.9, 0.92, 0.94);
        if (abs(along - wrist) < 0.008) band = vec3(0.15, 0.35, 0.75);
        else if (abs(along - wrist) < 0.025 && step(0.5, fract(around * 6.0)) * step(0.6, fract(ax * 180.0)) > 0.0) band = vec3(0.1);
        col = band * (1.0 - 0.3 * w);
      }
      // IV port: the inner elbow of the right arm - a clear dressing over a
      // cannula with a white cap.
      if (!left && abs(along - 0.38) < 0.04 && p.z > 0.01) {
        col = mix(col, vec3(0.86, 0.8, 0.72), 0.7) * (1.0 - 0.25 * w);
        if (abs(along - 0.38) < 0.012 && p.z > 0.022) col = vec3(0.92);
      }
      // Bandage round the right forearm (bloodied stage): gauze, a blood spot.
      if (!left && along > 0.46 && along < 0.56 && bloody > 0.5) {
        float wraps = 0.5 + 0.5 * sin((along + p.y * 0.3) * 260.0);
        col = mix(vec3(0.8, 0.78, 0.72), vec3(0.64, 0.62, 0.57), wraps * 0.5);
        col = mix(col, blood, smoothstep(0.5, 0.8, n3(p * 30.0)) * 0.9);
      }
    }

    // ---- Scrub trousers: dust up the shins, blood at the knees ----------------
    if (legs) {
      float low = 1.0 - smoothstep(0.05, 0.55, p.y);
      col = mix(col, dust, low * dusty * (0.15 + 0.35 * smoothstep(0.4, 0.8, grain)));
      col = mix(col, grime, smoothstep(0.75, 1.0, grain) * w * 0.35);
      float knee = (1.0 - smoothstep(0.0, 0.12, abs(p.y - 0.5))) * smoothstep(0.55, 0.8, n3(p * 12.0));
      col = mix(col, blood, knee * bloody * 0.8);
    }

    // ---- Clogs: scuffed and dusty ------------------------------------------------
    if (feet) {
      col = mix(col, dust * 0.8, dusty * (0.2 + 0.3 * grain));
      col *= 1.0 - 0.2 * w;
    }

    diffuseColor.rgb = col;
  }
`;

/**
 * Give a rigged player mesh its look and wear. Call after `rigPlayerMesh`
 * (it chains onto the rig's shader). Returns the controls.
 *
 * @param {THREE.Mesh} mesh  the character's merged mesh (userData.cells from characters.js)
 * @param {object} body      the rig's body measurements (rigPlayerMesh().body)
 */
export function applyFigureLook(mesh, body) {
  const material = mesh.material;
  const cells = mesh.userData.cells ?? {};
  const cell = (name) => new THREE.Vector4(...(cells[name] ?? [2, 2, 2, 2]));
  const skin = skinTone(mesh.userData.atlas ?? material.map, cells.Body);
  // The top of the scrub top (its neckline), from the geometry.
  const neckY = topOf(mesh.geometry, cells.material) ?? body.shoulderY + 0.05;
  const uniforms = {
    uWear: { value: 0 },
    uGear: { value: 0 },
    uSkin: { value: skin.clone() },
    uTone: { value: skin.clone() },
    uToneOn: { value: 0 },
    uCellTop: { value: cell("material") },
    uCellBody: { value: cell("Body") },
    uCellBottom: { value: cell("Bottom") },
    uCellShoes: { value: cell("Shoes") },
    uShoulderX: { value: body.shoulderX },
    uShoulderY: { value: body.shoulderY },
    uArmLength: { value: body.armLength },
    uHipY: { value: body.hipY },
    uNeckY: { value: neckY },
  };
  const rig = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    rig?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${LOOK_VERTEX_HEAD}`)
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vRest = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${LOOK_FRAGMENT_HEAD}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${LOOK_FRAGMENT_MAIN}`)
      // A host that makes the figure self-lit (main.js, Level 1's dark halls)
      // uses the atlas as the emissive map; glow with the damaged colours
      // instead, or the clean scrubs would shine through the dust and blood.
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_EMISSIVEMAP\n  totalEmissiveRadiance = emissive * diffuseColor.rgb;\n#endif");
  };
  const key = material.customProgramCacheKey?.() ?? "";
  material.customProgramCacheKey = () => `${key}+figure-look`;
  material.needsUpdate = true;

  return {
    uniforms,
    get wear() {
      return uniforms.uWear.value;
    },
    get gear() {
      return uniforms.uGear.value > 0.5;
    },
    setWear(value) {
      uniforms.uWear.value = THREE.MathUtils.clamp(value, 0, 1);
    },
    setGear(on) {
      uniforms.uGear.value = on ? 1 : 0;
    },
    /** A SKIN_TONES key ("light" = the model's own). */
    setSkinTone(name) {
      const tone = SKIN_TONES[name]?.color;
      uniforms.uToneOn.value = tone ? 1 : 0;
      if (tone) uniforms.uTone.value.set(tone);
    },
  };
}

/** The highest y of the vertices whose UVs fall in an atlas cell (the scrub top's neckline). */
function topOf(geometry, rect) {
  if (!rect) return null;
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  if (!uv) return null;
  let high = -Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u >= rect[0] && u <= rect[2] && v >= rect[1] && v <= rect[3]) high = Math.max(high, pos.getY(i));
  }
  return Number.isFinite(high) ? high : null;
}
