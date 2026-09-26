/**
 * The game's own post-processing pipeline. No EffectComposer, no add-ons -
 * every pass here is a small ShaderMaterial on a full-screen triangle pair.
 *
 * Frame order (high and medium quality):
 *
 *   1. WORLD pass     opaque level + sky -> sceneTarget (HDR, half float)
 *   2. SNAPSHOT       sceneTarget -> refractTarget (half resolution copy)
 *   3. GLASS pass     glass draws INTO sceneTarget, reading the snapshot to
 *                     refract what is behind it (screen-space refraction)
 *   4. FX pass        fire, smoke, sparks on top, so glass never hides a flame
 *   5. BLOOM          bright-pass at quarter resolution, two separable
 *                     Gaussian blur iterations
 *   6. COMPOSITE      to the screen: heat-haze distortion, FXAA, chromatic
 *                     aberration, bloom, ACES tone mapping, then the "looks":
 *                     smoke veil, damage, thermal vision, overdrive, prism,
 *                     focus, photo filters, vignette, grain, fades,
 *                     water droplets on the lens under sprinklers, and a
 *                     heartbeat pulse in the vignette when the subject is
 *                     frightened (low integrity, smoke, fire), and the
 *                     sedation blur at the start of Level 1, and an
 *                     unsharp-mask sharpening pass.
 *
 * Low quality skips all of it and renders the scene once, straight to the
 * screen; glass falls back to alpha blending.
 *
 * `scale` is the render resolution relative to the canvas. The performance
 * monitor in main.js lowers it when frame time climbs (dynamic resolution),
 * which is the most effective lever on the fill-rate-bound lab GPUs the Level
 * 2 measurements identified.
 */

import * as THREE from "../three.js";
import { LAYERS } from "../levels/causeway/layers.js";

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const copyFragment = /* glsl */ `
uniform sampler2D tInput;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tInput, vUv); }
`;

const brightFragment = /* glsl */ `
uniform sampler2D tInput;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = max(0.0, l - uThreshold) / max(l, 1e-4);   // soft threshold
  gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}
`;

// 9-tap Gaussian using 5 bilinear fetches (linear-sampling trick).
const blurFragment = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDirection;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 0.2270270270;
  vec2 o1 = uDirection * 1.3846153846;
  vec2 o2 = uDirection * 3.2307692308;
  c += texture2D(tInput, vUv + o1).rgb * 0.3162162162;
  c += texture2D(tInput, vUv - o1).rgb * 0.3162162162;
  c += texture2D(tInput, vUv + o2).rgb * 0.0702702703;
  c += texture2D(tInput, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const compositeFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBloom;
uniform float uChroma;
uniform float uVignette;
uniform vec4 uHaze[4];          // xy = screen uv, z = radius, w = strength
uniform float uSmoke;
uniform float uDamage;
uniform float uHeat;
uniform float uThermal;
uniform float uOverdrive;
uniform float uPrism;
uniform float uFocus;
uniform float uSpeed;
uniform float uFade;
uniform float uFlash;
uniform float uFilter;          // 0 none, 1 noir, 2 vintage, 3 thermal
uniform float uGrain;
uniform float uFxaa;
uniform float uLens;
uniform float uPulse;
uniform float uSedation;
uniform float uSharpen;
varying vec2 vUv;

vec3 fxaa(vec2 uv, vec2 rcp) {
  vec3 nw = texture2D(tScene, uv + vec2(-1.0, -1.0) * rcp).rgb;
  vec3 ne = texture2D(tScene, uv + vec2( 1.0, -1.0) * rcp).rgb;
  vec3 sw = texture2D(tScene, uv + vec2(-1.0,  1.0) * rcp).rgb;
  vec3 se = texture2D(tScene, uv + vec2( 1.0,  1.0) * rcp).rgb;
  vec3 m  = texture2D(tScene, uv).rgb;
  vec3 W = vec3(0.299, 0.587, 0.114);
  // Luma on a compressed curve so HDR highlights do not dominate edge detection.
  float lnw = dot(nw / (1.0 + nw), W), lne = dot(ne / (1.0 + ne), W);
  float lsw = dot(sw / (1.0 + sw), W), lse = dot(se / (1.0 + se), W);
  float lm  = dot(m / (1.0 + m), W);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse)));
  float lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float reduce = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * rcp;
  vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
  float lb = dot(b / (1.0 + b), W);
  return (lb < lmin || lb > lmax) ? a : b;
}

float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 thermalRamp(float t) {
  vec3 c = mix(vec3(0.02, 0.0, 0.08), vec3(0.35, 0.0, 0.55), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(0.95, 0.1, 0.15), smoothstep(0.25, 0.5, t));
  c = mix(c, vec3(1.0, 0.65, 0.0), smoothstep(0.5, 0.75, t));
  return mix(c, vec3(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, t));
}

void main() {
  vec2 uv = vUv;
  vec2 rcp = 1.0 / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 centred = uv - 0.5;

  // Heat haze: wobble the lookup inside a circle above each nearby fire.
  for (int i = 0; i < 4; i++) {
    vec4 h = uHaze[i];
    if (h.w <= 0.0) continue;
    vec2 d = (uv - h.xy) * vec2(aspect, 1.0);
    float fall = 1.0 - smoothstep(0.0, h.z, length(d));
    uv += vec2(sin(uv.y * 90.0 + uTime * 9.0), cos(uv.x * 70.0 + uTime * 7.0)) * 0.0022 * fall * h.w;
  }
  uv += vec2(sin(uv.y * 60.0 + uTime * 11.0), cos(uv.x * 50.0 + uTime * 8.0)) * 0.004 * uHeat;

  // Water on the lens: a grid of cells, some holding a droplet that slides
  // slowly down. Each droplet refracts the image behind it like a tiny lens.
  if (uLens > 0.01) {
    for (int layer = 0; layer < 2; layer++) {
      float scale = layer == 0 ? 7.0 : 13.0;
      vec2 g = vec2(vUv.x * aspect, vUv.y) * scale;
      float column = floor(g.x);
      g.y += uTime * (0.05 + rand(vec2(column, float(layer))) * 0.25);
      vec2 cell = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = rand(cell + float(layer) * 17.0);
      vec2 centre = (vec2(rand(cell + 3.1), rand(cell + 7.7)) - 0.5) * 0.5;
      vec2 d = f - centre;
      float radius = 0.1 + 0.16 * h;
      float drop = (1.0 - smoothstep(radius * 0.55, radius, length(d))) * step(0.62, h);
      uv -= d * drop * 0.05 * uLens / scale * 7.0;
    }
  }

  vec3 colour = uFxaa > 0.5 ? fxaa(uv, rcp) : texture2D(tScene, uv).rgb;

  // Chromatic aberration grows toward the edge of the screen and with damage.
  float ca = uChroma + uDamage * 0.006 + uPrism * 0.012 + uOverdrive * 0.004;
  vec2 caDir = centred * ca;
  colour.r = mix(colour.r, texture2D(tScene, uv + caDir).r, 0.85);
  colour.b = mix(colour.b, texture2D(tScene, uv - caDir).b, 0.85);

  // Sharpening (unsharp mask): push each pixel away from the average of its
  // four neighbours. It restores the crispness FXAA and any render-scale
  // reduction take off. The difference is clamped so bright HDR edges (fire,
  // strips) do not ring.
  if (uSharpen > 0.01) {
    vec3 nb = (texture2D(tScene, uv + vec2(rcp.x, 0.0)).rgb + texture2D(tScene, uv - vec2(rcp.x, 0.0)).rgb
             + texture2D(tScene, uv + vec2(0.0, rcp.y)).rgb + texture2D(tScene, uv - vec2(0.0, rcp.y)).rgb) * 0.25;
    colour += clamp(colour - nb, vec3(-0.12), vec3(0.12)) * uSharpen;
    colour = max(colour, vec3(0.0));
  }

  // Sedation: the drug has not worn off yet. A soft blur that is stronger
  // toward the edges (six taps on a slowly turning ring), plus a faint
  // drifting double image. Fades out as Subject 07 wakes up.
  if (uSedation > 0.01) {
    float e = smoothstep(0.1, 0.7, length(centred));
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472 + uTime * 0.3;
      acc += texture2D(tScene, uv + vec2(cos(a), sin(a)) * 0.007 * uSedation * (0.35 + e)).rgb;
    }
    colour = mix(colour, acc / 6.0, uSedation * (0.3 + e * 0.7));
    vec2 ghost = vec2(sin(uTime * 0.7), cos(uTime * 0.5)) * 0.008 * uSedation;
    colour = mix(colour, texture2D(tScene, uv + ghost).rgb, 0.28 * uSedation);
  }

  // Speed lines: radial blur toward the centre (sprint and overdrive).
  float radial = uSpeed * 0.45 + uOverdrive * 0.8;
  if (radial > 0.01) {
    vec3 acc = colour;
    for (int i = 1; i <= 5; i++) acc += texture2D(tScene, uv - centred * float(i) * 0.012 * radial).rgb;
    colour = mix(colour, acc / 6.0, smoothstep(0.1, 0.6, length(centred)));
  }

  colour += texture2D(tBloom, vUv).rgb * uBloom;

  #ifdef TONE_MAPPING
    colour = toneMapping(colour);
  #endif
  colour = clamp(colour, 0.0, 1.0);

  float luma = dot(colour, vec3(0.299, 0.587, 0.114));
  colour = mix(colour, vec3(luma), uSedation * 0.3);

  // Smoke veil: desaturate, flatten, and close in from the edges.
  float edge = smoothstep(0.25, 0.75, length(centred * vec2(aspect * 0.8, 1.0)));
  float veil = uSmoke * (1.0 - uThermal);
  colour = mix(colour, vec3(luma) * vec3(0.8, 0.77, 0.74), veil * 0.45);
  colour = mix(colour, vec3(0.1, 0.09, 0.085), veil * edge * 0.75);

  // Thermal vision: map brightness and warmth onto an iron-bow palette.
  float heatValue = clamp(luma * 0.9 + (colour.r - colour.b) * 0.6, 0.0, 1.0);
  float thermal = max(uThermal, step(2.5, uFilter) * step(uFilter, 3.5));
  colour = mix(colour, thermalRamp(heatValue), thermal);

  // Overdrive: the serum takes over - saturated, hot, pulsing edges.
  if (uOverdrive > 0.0) {
    vec3 sat = mix(vec3(luma), colour, 1.6);
    colour = mix(colour, sat * vec3(1.08, 0.95, 1.1), uOverdrive);
    colour += vec3(1.0, 0.15, 0.55) * edge * uOverdrive * (0.25 + 0.15 * sin(uTime * 10.0));
  }
  // Prism: rainbow fringe around the frame.
  if (uPrism > 0.0) {
    vec3 rainbow = 0.5 + 0.5 * cos(6.2832 * (length(centred) * 2.0 - uTime * 0.4 + vec3(0.0, 0.33, 0.67)));
    colour += rainbow * edge * edge * uPrism * 0.35;
  }
  // Focus (bullet time): cool, desaturated, darker edges.
  colour = mix(colour, vec3(luma) * vec3(0.8, 0.95, 1.1), uFocus * 0.55);

  // Damage and fire: warm pulse from the edges.
  colour = mix(colour, vec3(0.9, 0.05, 0.03), uDamage * edge * 0.7);
  colour = mix(colour, vec3(1.0, 0.45, 0.1), uHeat * edge * 0.55);

  // Photo filters.
  if (uFilter > 0.5 && uFilter < 1.5) {
    float g = smoothstep(0.05, 0.95, luma);
    colour = vec3(g * g * (3.0 - 2.0 * g));
  } else if (uFilter > 1.5 && uFilter < 2.5) {
    colour = vec3(dot(colour, vec3(0.393, 0.769, 0.189)), dot(colour, vec3(0.349, 0.686, 0.168)), dot(colour, vec3(0.272, 0.534, 0.131)));
    colour *= 1.0 - edge * 0.35;
  }

  colour *= 1.0 - edge * uVignette - edge * uFocus * 0.4 - edge * uPulse * 0.35;
  colour += vec3(1.0, 0.75, 0.5) * uFlash;
  colour += (rand(vUv * uResolution + fract(uTime) * 100.0) - 0.5) * uGrain;
  colour *= 1.0 - uFade;

  gl_FragColor = linearToOutputTexel(vec4(colour, 1.0));
}
`;

export class PostFX {
  constructor(renderer, { quality = "high" } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.scale = 1;
    this.lite = false;
    this.enabled = quality !== "low";

    const half = { type: THREE.HalfFloatType, depthBuffer: false };
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.refractTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, half);
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, half);

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
      vertexShader: quadVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.copy = pass(copyFragment, { tInput: { value: null } });
    this.bright = pass(brightFragment, { tInput: { value: null }, uThreshold: { value: 1.35 } });
    this.blur = pass(blurFragment, { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } });

    this.uniforms = {
      tScene: { value: null },
      tBloom: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uBloom: { value: 0.42 },
      uChroma: { value: 0.0004 },
      uVignette: { value: 0.3 },
      uHaze: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
      uSmoke: { value: 0 },
      uDamage: { value: 0 },
      uHeat: { value: 0 },
      uThermal: { value: 0 },
      uOverdrive: { value: 0 },
      uPrism: { value: 0 },
      uFocus: { value: 0 },
      uSpeed: { value: 0 },
      uFade: { value: 0 },
      uFlash: { value: 0 },
      uFilter: { value: 0 },
      uGrain: { value: 0.012 },
      uFxaa: { value: 1 },
      uLens: { value: 0 },
      uPulse: { value: 0 },
      uSedation: { value: 0 },
      uSharpen: { value: 0.35 },
    };
    this.composite = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: compositeFragment,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.composite.toneMapped = true;
    this._size = new THREE.Vector2();
  }

  setQuality(quality) {
    this.quality = quality;
    this.enabled = quality !== "low";
    this.resize();
  }

  /**
   * "Lite" mode: the cheaper refraction snapshot (half resolution) and a
   * smaller bloom buffer. Automatic quality uses this before it touches the
   * render resolution, because both are invisible in play while resolution
   * is not.
   */
  setLite(lite) {
    if (this.lite === lite) return;
    this.lite = lite;
    this.resize();
  }

  setScale(scale) {
    const clamped = THREE.MathUtils.clamp(scale, 0.5, 1);
    if (Math.abs(clamped - this.scale) < 0.02) return;
    this.scale = clamped;
    this.resize();
  }

  resize() {
    this.renderer.getDrawingBufferSize(this._size);
    const w = Math.max(2, Math.floor(this._size.x * this.scale));
    const h = Math.max(2, Math.floor(this._size.y * this.scale));
    this.sceneTarget.setSize(w, h);
    // Full-resolution snapshot on high keeps what is seen through glass sharp.
    const div = this.quality === "high" && !this.lite ? 1 : 2;
    this.refractTarget.setSize(Math.max(2, Math.floor(w / div)), Math.max(2, Math.floor(h / div)));
    const bloomScale = this.quality === "high" && !this.lite ? 4 : 6;
    this.bloomA.setSize(Math.max(2, Math.floor(w / bloomScale)), Math.max(2, Math.floor(h / bloomScale)));
    this.bloomB.setSize(this.bloomA.width, this.bloomA.height);
    this.uniforms.uResolution.value.set(w, h);
    // More sharpening the lower the render scale, so reduced resolution
    // still reads as crisp.
    this.uniforms.uSharpen.value = 0.35 + (1 - this.scale) * 1.6;
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {object|null} glassShared  shared glass uniforms, if a glass level is loaded
   */
  render(scene, camera, glassShared = null) {
    const r = this.renderer;
    r.shadowMap.needsUpdate = true;
    const allLayers = camera.layers.mask;

    if (!this.enabled) {
      if (glassShared) glassShared.uHasScene.value = 0;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    if (this.sceneTarget.width < 4) this.resize();

    // 1. World.
    camera.layers.set(LAYERS.WORLD);
    r.setRenderTarget(this.sceneTarget);
    r.render(scene, camera);

    // 2. Snapshot for refraction.
    if (glassShared) {
      this.copy.uniforms.tInput.value = this.sceneTarget.texture;
      this._pass(this.copy, this.refractTarget);
      glassShared.uSceneTex.value = this.refractTarget.texture;
      glassShared.uHasScene.value = 1;
      glassShared.uResolution.value.set(this.sceneTarget.width, this.sceneTarget.height);
    }

    // 3 + 4. Glass, then effects, into the same target without clearing.
    // A Color background makes Three force a clear on every render call even
    // with autoClear off, so it is detached for these two passes.
    const autoClear = r.autoClear;
    const background = scene.background;
    scene.background = null;
    r.autoClear = false;
    r.setRenderTarget(this.sceneTarget);
    camera.layers.set(LAYERS.GLASS);
    r.render(scene, camera);
    camera.layers.set(LAYERS.FX);
    r.render(scene, camera);
    r.autoClear = autoClear;
    scene.background = background;
    camera.layers.mask = allLayers;

    // 5. Bloom.
    this.bright.uniforms.tInput.value = this.sceneTarget.texture;
    this._pass(this.bright, this.bloomA);
    for (let i = 0; i < 2; i += 1) {
      const spread = 1 + i;
      this.blur.uniforms.tInput.value = this.bloomA.texture;
      this.blur.uniforms.uDirection.value.set(spread / this.bloomA.width, 0);
      this._pass(this.blur, this.bloomB);
      this.blur.uniforms.tInput.value = this.bloomB.texture;
      this.blur.uniforms.uDirection.value.set(0, spread / this.bloomA.height);
      this._pass(this.blur, this.bloomA);
    }

    // 6. Composite to the screen.
    this.uniforms.tScene.value = this.sceneTarget.texture;
    this.uniforms.tBloom.value = this.bloomA.texture;
    this._pass(this.composite, null);
  }

  dispose() {
    for (const t of [this.sceneTarget, this.refractTarget, this.bloomA, this.bloomB]) t.dispose();
    for (const m of [this.copy, this.bright, this.blur, this.composite]) m.dispose();
    this.quad.geometry.dispose();
  }
}
