/**
 * Subject 07 on the menu stage.
 *
 * Everything about the figure goes through `createFigure` - the one seam to
 * change when the realistic rigged models (with Mixamo clips) replace the
 * player models: return any object with the same small interface and the
 * stage needs nothing else.
 *
 *   const figure = await createFigure({ character, skin, hair, assetBase });
 *   figure.root            // Object3D: feet on y = 0, facing local +Z
 *   figure.height          // metres
 *   figure.setLook({ skin, hair })            // instant (SKIN_TONES / HAIR_COLOURS keys)
 *   figure.update(dt, time, { camera, attention, gaze, wind, rimDir, rim, reducedMotion })
 *   figure.headPosition(out)                  // world space, for framing
 *   figure.dispose()
 *
 * Today's figure: the game's player model (characters.js), its vertex-shader
 * rig and its look (src/figure/look.js), plus what a still figure needs to
 * look alive and lit like film:
 *
 *  - a living idle: breathing (chest and shoulders), the weight shifting
 *    from one leg to the other every few seconds (a hip drop, a knee
 *    softening), the arms hanging loose and swaying a touch, and now and
 *    then a slow look round - toward the camera, then back to the fire;
 *  - the scrubs moving in the wind (a flutter strongest at the hems);
 *  - a rim light: a Fresnel edge lit from the fire's side (warm), so the
 *    silhouette separates from the night behind it;
 *  - a shadow cast from the posed body (a depth material running the same
 *    rig), and a soft contact shadow under the feet.
 */

import * as THREE from "../three.js";
import { loadMeltdownAssets } from "../levels/meltdown/assets.js";
import { cloneCharacter, rigPlayerMesh, PLAYER_RIG_VERTEX, PLAYER_RIG_MAIN } from "../levels/meltdown/characters.js";
import { applyFigureLook } from "../figure/look.js";
import { OUTFITS } from "../figure/outfit.js";
import { buildShoes, disposeShoes } from "../figure/shoes.js";

/** Head turn, breath and wind, run in the rest pose before the rig poses the body. */
const MENU_VERTEX_HEAD = /* glsl */ `
  uniform float uHeadYaw;
  uniform float uHeadPitch;
  uniform float uNeck;
  uniform float uBreath;
  uniform float uMenuTime;
  uniform vec3 uWind;
  uniform vec4 uClothTop;
  uniform vec4 uClothLegs;
`;

const MENU_VERTEX_MAIN = /* glsl */ `
  {
    // Breathing: the chest swells forward a few millimetres.
    float chest = smoothstep(uHipY + 0.2, uShoulderY - 0.1, rigP.y) * (1.0 - smoothstep(uShoulderY - 0.02, uShoulderY + 0.08, rigP.y));
    rigP.z += uBreath * 0.012 * chest * smoothstep(-0.02, 0.08, rigP.z) * (1.0 - smoothstep(uShoulderX * 0.6, uShoulderX, abs(rigP.x)));
    // The scrubs in the wind (by the atlas cell the vertex samples).
    #ifdef USE_MAP
      vec2 cuv = uv;
      float top = step(uClothTop.x, cuv.x) * step(cuv.x, uClothTop.z) * step(uClothTop.y, cuv.y) * step(cuv.y, uClothTop.w);
      float legs = step(uClothLegs.x, cuv.x) * step(cuv.x, uClothLegs.z) * step(uClothLegs.y, cuv.y) * step(cuv.y, uClothLegs.w);
      float hem = top * (1.0 - smoothstep(uHipY, uShoulderY, rigP.y)) * 0.8 + legs * (1.0 - smoothstep(0.0, uHipY, rigP.y)) * 0.5;
      float gust = sin(uMenuTime * 3.1 + rigP.y * 9.0 + rigP.x * 7.0) * 0.6 + sin(uMenuTime * 7.3 + rigP.y * 23.0) * 0.4;
      rigP += uWind * hem * (0.6 + 0.4 * gust) * 0.012;
    #endif
    // The head turns about the neck (arms, out at the T-pose's sides, stay put).
    float headW = smoothstep(uNeck - 0.09, uNeck + 0.03, rigP.y) * (1.0 - smoothstep(uShoulderX * 0.55, uShoulderX * 0.85, abs(rigP.x)));
    if (headW > 0.0) {
      vec3 pivot = vec3(0.0, uNeck, -0.01);
      turn(rigP, rigN, pivot, rotY(uHeadYaw * headW));
      turn(rigP, rigN, pivot, rotX(uHeadPitch * headW));
    }
  }
  float ax = abs(rigP.x);
`;

const RIM_FRAGMENT = /* glsl */ `
  uniform vec3 uRimColor;
  uniform vec3 uRimDir;      // view space, toward the rim light
  uniform vec3 uFill;        // a soft, cool lift on the side away from it
`;

/** Chain the menu's extras onto the rigged, looked material. */
function extendMaterial(material, extra) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior?.call(material, shader, renderer);
    Object.assign(shader.uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${MENU_VERTEX_HEAD}`)
      .replace("float ax = abs(rigP.x);", MENU_VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${RIM_FRAGMENT}`)
      .replace("#include <opaque_fragment>", `
        {
          vec3 vdir = normalize(vViewPosition);
          float fres = pow(1.0 - saturate(dot(normal, vdir)), 2.6);
          float side = saturate(dot(normal, uRimDir) * 0.75 + 0.35);
          outgoingLight += uRimColor * fres * side * (0.6 + 0.4 * diffuseColor.r);
          outgoingLight += uFill * diffuseColor.rgb * saturate(0.5 - dot(normal, uRimDir) * 0.5);
        }
        #include <opaque_fragment>`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ""}+menu-figure`;
  material.needsUpdate = true;
}

/** A depth material that poses the body the same way (for its shadow). */
function posedDepthMaterial(uniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PLAYER_RIG_VERTEX}\n${MENU_VERTEX_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvec3 objectNormal = vec3(0.0, 1.0, 0.0);\n${PLAYER_RIG_MAIN.replace("float ax = abs(rigP.x);", MENU_VERTEX_MAIN)}`);
  };
  m.customProgramCacheKey = () => "menu-figure-depth";
  return m;
}

function contactTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.85)");
  grad.addColorStop(0.35, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const smooth = (t) => t * t * (3 - 2 * t);

class MenuFigure {
  constructor(template, { skin, hair, outfit, shoes, shadows = true }) {
    this.root = new THREE.Group();
    this.root.name = "Subject07";
    this.pelvis = new THREE.Group();
    this.root.add(this.pelvis);
    this.owned = [];
    const model = cloneCharacter(template);
    const mesh = model.getObjectByName("CharacterMerged");
    const { uniforms, body } = rigPlayerMesh(mesh);
    this.look = applyFigureLook(mesh, body);
    this.look.setWear(0);
    this.look.setGear(false);
    this.uniforms = uniforms;
    this.body = body;
    this.height = body.height;
    const lu = this.look.uniforms;
    this.extra = {
      uHeadYaw: { value: 0 },
      uHeadPitch: { value: 0 },
      uNeck: { value: lu.uNeckY.value + 0.02 },
      uBreath: { value: 0 },
      uMenuTime: { value: 0 },
      uWind: { value: new THREE.Vector3(-1, 0, 0.3) },
      uClothTop: { value: lu.uCellTop.value.clone() },
      uClothLegs: { value: lu.uCellBottom.value.clone() },
      uRimColor: { value: new THREE.Color(0, 0, 0) },
      uRimDir: { value: new THREE.Vector3(0, 0, -1) },
      uFill: { value: new THREE.Color(0, 0, 0) },
    };
    extendMaterial(mesh.material, this.extra);
    this.owned.push(mesh.material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    if (shadows) {
      mesh.customDepthMaterial = posedDepthMaterial({ ...uniforms, ...this.extra });
      this.owned.push(mesh.customDepthMaterial);
    }
    this.mesh = mesh;
    this.pelvis.add(model);
    // Arms loose at the sides; nothing in the hands.
    uniforms.uHold.value = 0;
    uniforms.uArmDrop.value = 1.36;
    uniforms.uGait.value = 1;

    // Contact shadow (the ground's ambient occlusion under the feet).
    this.contactMap = contactTexture();
    this.owned.push(this.contactMap);
    const contactMat = new THREE.MeshBasicMaterial({ map: this.contactMap, transparent: true, depthWrite: false, opacity: 0.9 });
    this.owned.push(contactMat);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), contactMat);
    this.owned.push(contact.geometry);
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.008;
    contact.renderOrder = 1;
    this.root.add(contact);

    this.setLook({ skin, hair, outfit, shoes });
    // The idle's state.
    this.weight = 0; // -1 on the left leg .. +1 on the right
    this.weightTarget = 0.7;
    this.weightTimer = 3;
    this.yaw = 0;
    this.pitch = 0;
    this.glance = { t: 0, next: 4, hold: 0, active: false };
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  setLook({ skin, hair, outfit, shoes } = {}) {
    if (skin) this.look.setSkinTone(skin);
    if (hair) this.look.setHairColour(hair);
    if (outfit) this.look.setOutfit(OUTFITS[outfit]?.color ?? null);
    if (shoes && shoes !== this.shoeKind) {
      // On the same rig as the body (src/figure/shoes.js).
      this.shoeKind = shoes;
      if (this.shoes) { this.shoes.removeFromParent(); disposeShoes(this.shoes); }
      this.shoes = buildShoes(shoes, this.mesh, this.uniforms);
      if (this.shoes) {
        this.mesh.parent.add(this.shoes);
        this.shoes.userData.onReady = () => this.look.setFeetHidden(true);
      } else this.look.setFeetHidden(false);
    }
  }

  /** The head, in world space (for the camera's framing). */
  headPosition(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(out.set(0, this.height - 0.12, 0));
  }

  /**
   * @param {number} dt
   * @param {number} time
   * @param {object} o
   * @param {THREE.Camera} o.camera
   * @param {number} [o.attention]   0..1, how much they look round at the camera
   * @param {THREE.Vector3} [o.gaze] world point they look at otherwise (the fire)
   * @param {THREE.Vector3} [o.wind] world wind, m/s
   * @param {THREE.Vector3} [o.rimDir]  world direction toward the rim light
   * @param {THREE.Color} [o.rim]    rim colour (and strength)
   * @param {THREE.Color} [o.fill]
   * @param {boolean} [o.reducedMotion]
   */
  update(dt, time, { camera, attention = 0.3, gaze = null, wind = null, rimDir = null, rim = null, fill = null, reducedMotion = false } = {}) {
    const u = this.uniforms;
    const x = this.extra;
    const calm = reducedMotion ? 0.4 : 1;
    x.uMenuTime.value = time;

    // Breath: ~14 a minute, a little uneven.
    const breath = Math.sin(time * 1.45) * 0.8 + Math.sin(time * 0.53 + 1.2) * 0.2;
    x.uBreath.value = breath * calm;

    // Weight shift: every 6-10 s onto the other leg, taking ~1.8 s.
    this.weightTimer -= dt;
    if (this.weightTimer <= 0) {
      this.weightTimer = 6 + Math.random() * 4;
      this.weightTarget = -Math.sign(this.weightTarget || 1) * (0.6 + Math.random() * 0.4);
    }
    this.weight += (this.weightTarget - this.weight) * (1 - Math.exp(-dt * 1.6));
    const w = this.weight * calm;
    // The free leg's knee softens, the hip drops on that side, the body
    // sways over the standing foot.
    const free = Math.abs(w);
    const softR = w < 0 ? free : 0; // weight on the left: the right knee softens
    const softL = w > 0 ? free : 0;
    u.uLegR.value.set(0.03 * softR, 0.13 * softR);
    u.uLegL.value.set(0.03 * softL, 0.13 * softL);
    this.pelvis.position.x = -w * 0.022;
    this.pelvis.position.y = -free * 0.008;
    this.pelvis.rotation.z = w * 0.022;
    u.uTwist.value = w * 0.04 + Math.sin(time * 0.31) * 0.015 * calm;
    u.uLean.value = 0.015 + breath * 0.006 * calm;
    // Arms hang and sway a little with the breath and the wind.
    u.uArmSwing.value = 0.035 * calm;
    u.uPhase.value = Math.PI / 2 + Math.sin(time * 0.7) * 0.6;

    // Where they look: at the fire mostly; now and then round at us.
    this.root.updateMatrixWorld(true);
    this._m.copy(this.root.matrixWorld).invert();
    const headY = this.height - 0.1;
    const aimAt = (p) => {
      const l = this._v.copy(p).applyMatrix4(this._m);
      const yaw = Math.atan2(l.x, l.z);
      const pitch = -Math.atan2(l.y - headY, Math.hypot(l.x, l.z));
      return [yaw, pitch];
    };
    let [yaw, pitch] = gaze ? aimAt(gaze) : [0, -0.1];
    const g = this.glance;
    g.next -= dt;
    if (!g.active && g.next <= 0 && camera) {
      g.active = true;
      g.hold = 2.2 + Math.random() * 2.2;
      g.t = 0;
    }
    if (g.active) {
      g.t += dt;
      if (g.t > g.hold + 1.6) {
        g.active = false;
        g.next = (5 + Math.random() * 7) * (1.4 - attention);
      }
    }
    const towardCam = g.active ? smooth(Math.min(1, g.t / 1.6)) * (1 - smooth(THREE.MathUtils.clamp((g.t - g.hold) / 1.6, 0, 1))) : 0;
    const look = Math.max(towardCam * Math.min(1, attention * 1.6), attention > 0.85 ? 0.75 : 0);
    if (camera && look > 0) {
      const [cy, cp] = aimAt(camera.position);
      yaw += (cy - yaw) * look;
      pitch += (cp - pitch) * look;
    }
    // A neck turns so far, no further (over the shoulder at most).
    yaw = THREE.MathUtils.clamp(yaw, -1.05, 1.05);
    pitch = THREE.MathUtils.clamp(pitch, -0.35, 0.3);
    const k = 1 - Math.exp(-dt * 2.4);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    x.uHeadYaw.value = this.yaw;
    x.uHeadPitch.value = this.pitch;
    // The shoulders follow the head a little.
    u.uTwist.value += this.yaw * 0.18;

    if (wind) {
      // World wind into the model's frame.
      const l = this._v.copy(wind).transformDirection(this._m).multiplyScalar(Math.min(1.5, wind.length() / 5));
      x.uWind.value.copy(l).multiplyScalar(calm);
    }
    if (camera && rimDir) x.uRimDir.value.copy(rimDir).transformDirection(camera.matrixWorldInverse);
    if (rim) x.uRimColor.value.copy(rim);
    if (fill) x.uFill.value.copy(fill);
  }

  dispose() {
    this.root.removeFromParent();
    for (const o of this.owned) o.dispose?.();
    this.owned.length = 0;
  }
}

/**
 * Subject 07, ready to stand on the stage. The model streams through the
 * game's shared asset cache (it is usually in memory already: the game
 * loads the player at boot).
 *
 * @param {object} o
 * @param {string} o.character   "playerFemale" | "playerMale"
 * @param {string} [o.skin]      SKIN_TONES key
 * @param {string} [o.hair]      HAIR_COLOURS key
 * @param {string} o.assetBase   assets/meltdown/ URL
 * @param {boolean} [o.shadows]  cast a real shadow (the stage's key light)
 * @returns {Promise<MenuFigure|null>}
 */
export async function createFigure({ character, skin, hair, outfit, shoes, assetBase, shadows = true }) {
  const assets = await loadMeltdownAssets(assetBase, { names: [character] });
  const asset = assets.get(character);
  if (!asset) return null;
  return new MenuFigure(asset.template, { skin, hair, outfit, shoes, shadows });
}
