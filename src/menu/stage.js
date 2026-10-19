/**
 * The menu stage: a live shot of Ascension Tower burning at 3 a.m., seen
 * from the roof across the street, Subject 07 at the parapet.
 *
 *   const stage = new MenuStage({ renderer, quality: "medium", reducedMotion: false, assetBase,
 *                                 figure: { character, skin, hair } });
 *   await stage.ready;                 // (or poll stage.isReady)
 *   stage.update(dt);                  // only while the menu shows
 *   stage.render(postfx);              // through the game's post chain (bloom, grading)
 *   stage.setShot("appearance");       // title | appearance | newgame | chapters | endless | dim | versus
 *   stage.setFigure({ character, skin, hair });
 *   stage.setQuality("low");  stage.resize(w, h);  stage.dispose();
 *
 * It owns its scene and camera and never touches the game's. What is in it:
 * atmosphere.js (haze, sky), tower.js (the tower and its windows),
 * fire.js (flames, smoke, embers, ash), city.js, roof.js, helicopters.js,
 * figure.js (Subject 07), shots.js (the camera). Nothing here runs unless
 * the host calls update/render - the host stops calling when a run starts.
 *
 * Light, as on a film set at night:
 *  - key: the fire, low and warm from across the street, flickering; it
 *    casts the figure's long shadow across the wet roof toward us;
 *  - fill: the moon, cool and soft, plus a sky/ground hemisphere;
 *  - rim: a Fresnel edge on the figure from the fire's side (figure.js);
 *  - practicals: the stair door's caged lamp, the antenna's red beacon;
 *  - the helicopter's searchlight, now and then, across the roof;
 *  - reflections: an environment map captured from this scene once it is
 *    built (the burning tower and the sky in every puddle).
 */

import * as THREE from "../three.js";
import { GLTFLoader } from "../three-addons.js";
import { noiseTexture, createHazeUniforms, createSky } from "./atmosphere.js";
import { AscensionTower } from "./tower.js";
import { TowerFire, DriftingAsh } from "./fire.js";
import { MenuCity, STREET_Y } from "./city.js";
import { MenuRoof, ROOF } from "./roof.js";
import { MenuHelicopters } from "./helicopters.js";
import { createFigure } from "./figure.js";
import { ShotRig, SHOTS } from "./shots.js";

/** Where things stand (metres; the roof's surface is y = 0). */
const SUBJECT = new THREE.Vector3(4.2, 0, -4.35);
const TOWER = new THREE.Vector3(-34, -100, -340);
const WIND = new THREE.Vector3(-5.5, 0, 1.6);
/** The body turned a little off the tower: a three-quarter back view from the title shot. */
const BODY_TURN = 0.38;

const QUALITY = {
  low: { shadows: false, shadowSize: 512, env: 128, ash: 220 },
  medium: { shadows: true, shadowSize: 1024, env: 256, ash: 480 },
  high: { shadows: true, shadowSize: 2048, env: 256, ash: 800 },
};

/** The look the stage asks of the game's post chain (restored after each frame). */
const POST = { bloom: 0.62, vignette: 0.55, grain: 0.022, chroma: 0.0009, threshold: 1.1 };

export class MenuStage {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {"low"|"medium"|"high"} [o.quality]
   * @param {boolean} [o.reducedMotion]
   * @param {string} o.assetBase   assets/meltdown/ URL
   * @param {{character:string, skin?:string, hair?:string}} o.figure
   */
  constructor({ renderer, quality = "medium", reducedMotion = false, assetBase, figure = {} }) {
    this.renderer = renderer;
    this.quality = QUALITY[quality] ? quality : "medium";
    this.reducedMotion = reducedMotion;
    this.assetBase = assetBase;
    this.figureSpec = { character: "playerFemale", skin: "light", hair: "natural", ...figure };
    this.isReady = false;
    this.disposed = false;
    this.time = 0;
    this.fade = 1; // starts from black; fades in once shown
    this.fadeTarget = 0;
    this.swap = null;
    this._size = new THREE.Vector2();
    this._v = new THREE.Vector3();
    // Its own loading manager: the menu's loading screen (which waits on
    // three's default one) never waits for the stage.
    this.manager = new THREE.LoadingManager();

    this.scene = new THREE.Scene();
    this.scene.name = "MenuStage";
    this.scene.background = new THREE.Color(0x020306);
    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(40, size.x / Math.max(1, size.y), 0.15, 6000);

    const q = QUALITY[this.quality];
    this.noise = noiseTexture();
    this.haze = createHazeUniforms();

    // ---- The tower and its fire ----
    this.tower = new AscensionTower({ position: TOWER, rotation: 0.42, height: 228, haze: this.haze, noise: this.noise, viewFrom: SUBJECT, quality: this.quality });
    this.scene.add(this.tower.root);
    this.haze.uFirePos.value.copy(this.tower.fireFront);
    this.fire = new TowerFire({ tower: this.tower, haze: this.haze, noise: this.noise, wind: WIND, quality: this.quality });
    this.scene.add(this.fire.root);

    // ---- Sky, city, roof ----
    this.sky = createSky(this.haze, this.noise);
    this.scene.add(this.sky.mesh);
    const roofBox = new THREE.Box3(new THREE.Vector3(ROOF.minX, -100, ROOF.minZ), new THREE.Vector3(ROOF.maxX, 0, ROOF.maxZ));
    this.city = new MenuCity({ haze: this.haze, noise: this.noise, towerAt: TOWER, roof: roofBox, eye: SUBJECT, quality: this.quality, buildings: [[(ROOF.minX + ROOF.maxX) / 2, STREET_Y - 40, (ROOF.minZ + ROOF.maxZ) / 2, ROOF.maxX - ROOF.minX + 0.64, 40 - STREET_Y - 0.03, ROOF.maxZ - ROOF.minZ + 0.64]] });
    this.scene.add(this.city.root);
    this.roof = new MenuRoof({ noise: this.noise, manager: this.manager, quality: this.quality });
    this.scene.add(this.roof.root);

    // ---- Helicopters ----
    this.helis = new MenuHelicopters({ haze: this.haze, noise: this.noise, tower: TOWER.clone().setY(0), fire: this.tower.fireCentre, subject: SUBJECT, quality: this.quality });
    this.scene.add(this.helis.root);

    // ---- Foreground ash ----
    this.ash = new DriftingAsh({ count: q.ash, centre: SUBJECT.clone().add(new THREE.Vector3(-2, 3, 4)), wind: WIND.clone().multiplyScalar(0.5) });
    this.scene.add(this.ash.points);

    // ---- Light ----
    const toFire = this.tower.fireFront.clone().sub(SUBJECT).normalize();
    this.toFire = toFire;
    this.key = new THREE.DirectionalLight(0xff8a3a, 2.4);
    this.key.position.copy(SUBJECT).addScaledVector(toFire, 40);
    this.key.target.position.copy(SUBJECT);
    this.key.castShadow = q.shadows;
    this.key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const sc = this.key.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 7; sc.bottom = -7; sc.near = 10; sc.far = 80;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 3;
    this.scene.add(this.key, this.key.target);
    const moonDir = this.haze.uMoonDir.value;
    this.moon = new THREE.DirectionalLight(0x8ea6e0, 0.42);
    this.moon.position.copy(SUBJECT).addScaledVector(moonDir, 50);
    this.moon.target.position.copy(SUBJECT);
    this.scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0x22304e, 0x2a1a10, 0.55);
    this.scene.add(this.hemi);

    // ---- The camera ----
    const facing = Math.atan2(toFire.x, toFire.z) + BODY_TURN;
    this.facing = facing;
    const fireTop = this.tower.toWorld(new THREE.Vector3(0, this.tower.top + 6, 0));
    this.rig = new ShotRig(this.camera, {
      subject: SUBJECT, facing, figureHeight: 1.7, fire: this.tower.fireCentre.clone(), fireTop, tower: TOWER.clone(),
    });
    this.rig.reducedMotion = reducedMotion;

    this.figure = null;
    this.ready = this._load().then(
      () => this,
      (error) => {
        console.warn("[menu stage] could not finish building", error);
        throw error;
      },
    );
  }

  async _load() {
    const base = this.assetBase;
    const city = new GLTFLoader(this.manager).loadAsync(new URL("city_night.glb", base).href)
      .then((gltf) => {
        if (this.disposed) return;
        this.city.addModel(gltf.scene, [
          { position: new THREE.Vector3(TOWER.x + 190, STREET_Y, TOWER.z - 200), rotation: 0.3, scale: 30 },
          { position: new THREE.Vector3(TOWER.x - 330, STREET_Y, TOWER.z - 380), rotation: 2.2, scale: 26 },
        ]);
      })
      .catch((error) => console.warn("[menu stage] city model failed; procedural city only", error));
    const helis = this.helis.load(base, this.manager).catch((error) => console.warn("[menu stage] helicopters failed", error));
    const figure = this._makeFigure(this.figureSpec).then((f) => {
      if (f) this._placeFigure(f);
    });
    await Promise.all([city, helis, figure, this.roof.ready.catch(() => {})]);
    if (this.disposed) return;
    // Settle the moving parts, then let the scene see itself.
    for (let i = 0; i < 4; i += 1) this.update(0.25);
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
    } catch (error) {
      console.warn("[menu stage] async compile failed", error);
    }
    if (this.disposed) return;
    this._captureEnvironment();
    this.isReady = true;
  }

  async _makeFigure(spec) {
    try {
      return await createFigure({ ...spec, assetBase: this.assetBase, shadows: QUALITY[this.quality].shadows });
    } catch (error) {
      console.warn("[menu stage] figure failed to load", error);
      return null;
    }
  }

  _placeFigure(f) {
    if (this.disposed) {
      f.dispose();
      return;
    }
    if (this.figure) this.figure.dispose();
    this.figure = f;
    f.root.position.copy(SUBJECT);
    f.root.rotation.y = this.facing;
    this.scene.add(f.root);
    this.rig.world.figureHeight = f.height;
    f.update(0, this.time, this._figureContext());
  }

  /** The burning tower and the sky in the puddles: a cube capture of the stage, prefiltered. */
  _captureEnvironment() {
    const size = QUALITY[this.quality].env;
    const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(0.5, 6000, target);
    cube.position.copy(SUBJECT).add(new THREE.Vector3(-1, 0.6, 2));
    const hidden = [this.figure?.root, this.helis.root, this.ash.points, this.fire.shards.points].filter(Boolean);
    const was = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const prevTarget = this.renderer.getRenderTarget();
    cube.update(this.renderer, this.scene);
    hidden.forEach((o, i) => { o.visible = was[i]; });
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromCubemap(target.texture);
    pmrem.dispose();
    target.dispose();
    this.renderer.setRenderTarget(prevTarget);
    this.envTarget?.dispose();
    this.envTarget = env;
    this.scene.environment = env.texture;
  }

  _figureContext() {
    return {
      camera: this.camera,
      attention: this.rig.attention,
      gaze: this.tower.fireCentre,
      wind: WIND,
      rimDir: this.toFire,
      rim: this._rim ?? new THREE.Color(0.5, 0.2, 0.06),
      fill: new THREE.Color(0.006, 0.009, 0.016),
      reducedMotion: this.reducedMotion,
    };
  }

  /** A camera shot (SHOTS); eased to over ~2.6 s. */
  setShot(name) {
    if (!SHOTS[name]) return;
    this.shot = name;
    this.rig.setShot(name);
  }

  /** Subject 07's body, skin and hair. Skin and hair change at once; a new body fades in. */
  setFigure({ character, skin, hair } = {}) {
    const spec = this.figureSpec;
    if (skin) spec.skin = skin;
    if (hair) spec.hair = hair;
    this.figure?.setLook({ skin: spec.skin, hair: spec.hair });
    if (character && character !== spec.character) {
      spec.character = character;
      const wanted = character;
      this._makeFigure({ ...spec }).then((f) => {
        if (!f) return;
        if (this.disposed || this.figureSpec.character !== wanted) {
          f.dispose();
          return;
        }
        f.setLook({ skin: this.figureSpec.skin, hair: this.figureSpec.hair });
        if (!this.isReady || this.fade > 0.9) {
          this._placeFigure(f);
          return;
        }
        // A quick dip through dark, the new body there when it lifts.
        this.swap = { figure: f, t: 0 };
      });
    }
  }

  setQuality(quality) {
    if (!QUALITY[quality] || quality === this.quality) return;
    this.quality = quality;
    const q = QUALITY[quality];
    this.key.castShadow = q.shadows;
    if (this.key.shadow.mapSize.x !== q.shadowSize) {
      this.key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.ash.geometry.setDrawRange(0, q.ash);
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
    this.rig.reducedMotion = !!on;
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** 0..1, how dark the picture should be behind dense text (the "dim" shot). */
  get dim() {
    return this.rig.dim;
  }

  /** Pixels per metre at 1 m (for the point sprites). */
  _pixelScale(postfx) {
    this.renderer.getDrawingBufferSize(this._size);
    const h = this._size.y * (postfx?.enabled ? postfx.scale : 1);
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  update(dt, postfx = null) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const t = this.time;
    const calm = this.reducedMotion ? 0.5 : 1;

    this.rig.update(dt, t);
    const flicker = this.fire.flicker;
    this.tower.update(dt, t, { flicker, blowouts: true });
    this.fire.update(dt, t, this.camera, this._pixelScale(postfx));
    this.sky.uniforms.uTime.value = t;
    this.city.update(dt, t, this._pixelScale(postfx));
    this.roof.update(dt, t, { reducedMotion: this.reducedMotion });
    this.helis.update(dt, t, { reducedMotion: this.reducedMotion });
    this.ash.update(t, this._pixelScale(postfx), this.camera.position.distanceTo(SUBJECT));

    // The fire's light: flickering, flaring with a blow-out.
    const blast = this.fire.blast;
    const f = 0.72 + 0.28 * flicker * calm + (1 - calm) * 0.14;
    this.key.intensity = 2.3 * f + blast * 2.2;
    this.haze.uFireGlow.value.setRGB(0.95, 0.34, 0.085).multiplyScalar(0.8 + 0.35 * flicker + blast * 0.9);
    this.tower.uniforms.uFireLight.value.setRGB(1.6, 0.55, 0.14).multiplyScalar(0.85 + 0.3 * flicker + blast * 0.6);
    this._rim = (this._rim ?? new THREE.Color()).setRGB(0.55, 0.21, 0.06).multiplyScalar(f + blast * 1.2 + this.helis.onSubject * 0.4);

    if (this.figure) this.figure.update(dt, t, this._figureContext());

    // A body swap: down to dark, swap, back up.
    if (this.swap) {
      this.swap.t += dt;
      if (this.swap.t >= 0.28 && this.swap.figure) {
        this._placeFigure(this.swap.figure);
        this.swap.figure = null;
      }
      if (this.swap.t >= 0.6) this.swap = null;
    }
    // Fade from black on arrival.
    this.fade += (this.fadeTarget - this.fade) * (1 - Math.exp(-dt * 2.2));
  }

  /** How dark the frame is right now (fade in, a body swap, a reduced-motion cut). */
  _darkness() {
    let d = this.fade;
    if (this.swap) d = Math.max(d, Math.sin(Math.PI * Math.min(1, this.swap.t / 0.6)));
    d = Math.max(d, this.rig.dip);
    return THREE.MathUtils.clamp(d, 0, 1);
  }

  /** Draw through the game's post chain; its settings are put back afterwards. */
  render(postfx) {
    if (this.disposed) return;
    const r = this.renderer;
    const exposure = r.toneMappingExposure;
    // Dense pages: the picture recedes behind the text.
    r.toneMappingExposure = 1.0 * (1 - this.rig.dim * 0.6);
    if (!postfx || !postfx.enabled) {
      r.toneMappingExposure *= 1 - this._darkness();
      if (postfx) postfx.render(this.scene, this.camera, null);
      else {
        r.setRenderTarget(null);
        r.render(this.scene, this.camera);
      }
      r.toneMappingExposure = exposure;
      return;
    }
    const u = postfx.uniforms;
    const saved = {
      bloom: u.uBloom.value, vignette: u.uVignette.value, grain: u.uGrain.value, chroma: u.uChroma.value,
      fade: u.uFade.value, threshold: postfx.bright.uniforms.uThreshold.value,
      haze: u.uHaze.value.map((v) => v.clone()),
    };
    u.uBloom.value = POST.bloom;
    u.uVignette.value = POST.vignette + this.rig.dim * 0.25;
    u.uGrain.value = POST.grain;
    u.uChroma.value = POST.chroma;
    postfx.bright.uniforms.uThreshold.value = POST.threshold;
    u.uFade.value = this._darkness();
    // Heat shimmer over the burning floors.
    const p = this._v.copy(this.tower.fireFront).project(this.camera);
    for (const slot of u.uHaze.value) slot.set(0, 0, 0, 0);
    if (p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2) {
      const radius = THREE.MathUtils.clamp(9 / Math.max(1, this.camera.fov), 0.05, 0.5);
      u.uHaze.value[0].set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5 + radius * 0.4, radius, this.reducedMotion ? 0.3 : 0.7);
    }
    postfx.render(this.scene, this.camera, null);
    u.uBloom.value = saved.bloom;
    u.uVignette.value = saved.vignette;
    u.uGrain.value = saved.grain;
    u.uChroma.value = saved.chroma;
    u.uFade.value = saved.fade;
    postfx.bright.uniforms.uThreshold.value = saved.threshold;
    saved.haze.forEach((v, i) => u.uHaze.value[i].copy(v));
    r.toneMappingExposure = exposure;
  }

  /** Scene and camera, for a host that compiles behind a loading screen. */
  get warmTarget() {
    return [this.scene, this.camera];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.figure?.dispose();
    this.swap?.figure?.dispose();
    this.tower.dispose();
    this.fire.dispose();
    this.city.dispose();
    this.roof.dispose();
    this.helis.dispose();
    this.ash.dispose();
    this.sky.mesh.geometry.dispose();
    this.sky.material.dispose();
    this.envTarget?.dispose();
    this.key.shadow.map?.dispose();
    this.scene.environment = null;
    this.scene.clear();
  }
}

export { SHOTS };
