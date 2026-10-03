/**
 * The prologue: everything before the game, as a short in-engine film - the
 * start screen's "briefing". No voice: chapter cards and typed captions over
 * staged shots, with the story track under it. It explains what Project
 * Ascension was for, why the patients were taken, who ran it, what went wrong,
 * how it was found out, and why the tower is coming down tonight.
 *
 *   const prologue = new Prologue({ renderer, assetBase, character });
 *   await prologue.load();                 // the models it stages
 *   prologue.start(() => backToTheMenu());
 *   // each frame while it runs:
 *   prologue.update(dt, time);
 *   prologue.render();                     // instead of the game's scene
 *   prologue.skip();                       // the SKIP button / Esc
 *
 * Every chapter is its own small set in its own THREE.Scene (its own lights
 * and fog), so a cut is just a change of which scene is drawn. The sets use
 * the supplied models where they exist: the city at night, the operating
 * theatre, the police helicopters,
 * the scientists, the patients - with plain stand-ins if one fails to load.
 * The words are all in CHAPTERS below.
 */

import * as THREE from "../three.js";
import { RoomEnvironment } from "../three-addons.js";
import { loadMeltdownAssets } from "../levels/meltdown/assets.js";
import { cloneCharacter, HumanoidRig } from "../levels/meltdown/characters.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";
import { Companion, loadStoryCharacter } from "./companion.js";
import { WardStage } from "./stages/ward.js";
import { PoliceHelicopters } from "../fx/police-helicopters.js";

/**
 * The film, chapter by chapter: which set, how long, the card and the
 * caption, and the camera's move (from -> to, each { pos, look }, in the set's
 * own coordinates). Edit the words here.
 */
export const CHAPTERS = [
  {
    set: "city", seconds: 10, tag: "01", title: "Ascension Tower",
    text: "The Meridian Institute owned the top forty floors of Ascension Tower. The city thought it was a hospital.",
    from: { pos: [150, 22, 210], look: [0, 60, 0] }, to: { pos: [70, 120, 120], look: [0, 175, 0] },
  },
  {
    set: "office", seconds: 11, tag: "02", title: "Project Ascension",
    text: "Its director, Dr. Adrian Vale, sold the board a resonance field that could rebuild a body cell by cell. \"Fixed\" people, he called them. No more illness. No more age.",
    from: { pos: [4.5, 1.7, 5.5], look: [-1, 1.5, -1.5] }, to: { pos: [1.6, 1.6, 2.6], look: [-1.4, 1.55, -1] },
  },
  {
    set: "theatre", seconds: 11, tag: "03", title: "The subjects",
    text: "Trials need subjects. Meridian found them at the city's free clinics - the homeless, the uninsured, the ones nobody would come looking for. They signed up for a sleep study.",
    from: { pos: [2.6, 2.1, 2.6], look: [0, 1.0, 0] }, to: { pos: [1.2, 2.6, 1.0], look: [0, 0.95, -0.2] },
  },
  {
    set: "labs", seconds: 11, tag: "04", title: "Trials one to six",
    text: "Six trials failed. The subjects lived - and kept changing. Meridian sedated them, catalogued them, and kept them in the labs below the observation decks.",
    from: { pos: [0, 1.7, 9], look: [0, 1.6, -6] }, to: { pos: [0.6, 1.5, 1.5], look: [-2.6, 1.7, -2.5] },
  },
  {
    set: "ward", seconds: 11, tag: "05", title: "Subject 07",
    text: "Trial seven was different. Subject 07 came through the field changed in a way none of their instruments could measure. Vale wanted to know how - before anyone else did.",
    from: { pos: [1.8, 2.4, -1.4], look: [-1.4, 0.8, 1.6] }, to: { pos: [-0.4, 1.7, 0.0], look: [-1.4, 0.75, 1.9] },
  },
  {
    set: "leak", seconds: 11, tag: "06", title: "The leak",
    text: "Dr. Elias Okoro had run the trials' anaesthesia for two years. He kept a copy of everything. Tonight he sent it to the city police.",
    from: { pos: [-2.4, 1.9, 2.8], look: [0.3, 1.1, -0.6] }, to: { pos: [-0.9, 1.55, 1.2], look: [0.4, 1.15, -0.8] },
  },
  {
    set: "city", seconds: 9, tag: "07", title: "Found out",
    text: "They're on their way. Every helicopter the city has.",
    police: true,
    from: { pos: [-150, 95, 250], look: [0, 125, 30] }, to: { pos: [-115, 150, 200], look: [0, 165, 20] },
  },
  {
    set: "control", seconds: 11, tag: "08", title: "The order",
    text: "Vale's answer was to bury it. Charges on every floor. The subjects still in their beds. Thirty minutes - and Ascension Tower comes down.",
    from: { pos: [-1.6, 1.8, 3.8], look: [0.45, 1.5, -1] }, to: { pos: [-0.7, 1.65, 2.5], look: [0.5, 1.5, -1] },
  },
  {
    set: "ward", seconds: 8, tag: "09", title: "Tonight",
    text: "Okoro went back for one of them.",
    okoroArrives: true,
    from: { pos: [0.8, 1.7, -3.8], look: [-0.6, 1.1, 2] }, to: { pos: [0.2, 1.6, -2.4], look: [-1.2, 1.0, 1.8] },
  },
];

const STYLE = `
.prologue { position: fixed; inset: 0; z-index: 40; pointer-events: none; font-family: Inter, "Segoe UI", Arial, sans-serif; color: #eef4f6; }
.prologue[hidden] { display: none; }
.prologue .pl-bar { position: absolute; left: 0; right: 0; height: 11vh; background: #000; }
.prologue .pl-bar.top { top: 0; } .prologue .pl-bar.bottom { bottom: 0; }
.prologue .pl-fade { position: absolute; inset: 0; background: #000; opacity: 1; }
.prologue .pl-card { position: absolute; left: 5vw; bottom: calc(11vh + 4vh); max-width: min(760px, 84vw); padding: 18px 26px 20px; background: linear-gradient(90deg, rgba(3,5,8,.82), rgba(3,5,8,.55) 70%, rgba(3,5,8,0)); border-left: 3px solid #ff9a52; opacity: 0; transform: translateY(8px); transition: opacity .7s ease, transform .7s ease; }
.prologue .pl-card.show { opacity: 1; transform: none; }
.prologue .pl-tag { font-size: 11px; font-weight: 800; letter-spacing: .32em; color: #ff9a52; }
.prologue .pl-title { margin: 6px 0 10px; font-size: clamp(26px, 3.4vw, 44px); font-weight: 800; letter-spacing: .02em; text-shadow: 0 2px 18px rgba(0,0,0,.7); }
.prologue .pl-text { font-size: clamp(14px, 1.35vw, 18px); line-height: 1.55; color: #d6e2e6; text-shadow: 0 1px 10px rgba(0,0,0,.85); min-height: 3.2em; }
.prologue .pl-dots { position: absolute; right: 5vw; bottom: calc(11vh + 3vh); display: flex; gap: 6px; }
.prologue .pl-dots i { width: 18px; height: 3px; background: rgba(255,255,255,.18); }
.prologue .pl-dots i.on { background: #ff9a52; }
.prologue .pl-endtitle { position: absolute; inset: 0; display: grid; place-items: center; font-size: clamp(40px, 7vw, 92px); font-weight: 900; letter-spacing: .12em; opacity: 0; transition: opacity 1.2s ease; }
.prologue .pl-endtitle.show { opacity: 1; }
.prologue .pl-skip { position: absolute; right: 4vw; top: calc(11vh + 18px); z-index: 2; pointer-events: auto; padding: 8px 14px; border: 1px solid rgba(255,255,255,.35); background: rgba(0,0,0,.45); color: #eef4f6; font: 700 11px/1 Inter, "Segoe UI", Arial, sans-serif; letter-spacing: .2em; cursor: pointer; }
.prologue .pl-skip:hover { border-color: #ff9a52; color: #ff9a52; }
`;

function ensureStyle() {
  if (document.querySelector("style[data-prologue]")) return;
  const style = document.createElement("style");
  style.dataset.prologue = "";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A screen's worth of text on a dark panel (the presentation, the upload, the charges). */
function screenTexture(lines, { bg = "#04121a", fg = "#7fe9ff", accent = null, w = 512, h = 288 } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(127,233,255,0.15)";
    for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    lines.forEach(([text, size, colour], i) => {
      g.fillStyle = colour ?? fg;
      g.font = `bold ${size}px monospace`;
      g.fillText(text, 24, 50 + i * (h - 70) / Math.max(1, lines.length - 1 || 1));
    });
    if (accent) accent(g, w, h);
  });
}

/** Lit office windows for the tower. */
function windowsTexture(seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const t = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = "#0b0d12";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const lit = rnd() < 0.55;
        g.fillStyle = lit ? `rgba(${200 + rnd() * 55},${200 + rnd() * 40},${150 + rnd() * 80},${0.6 + rnd() * 0.4})` : "rgba(24,30,40,1)";
        g.fillRect(x * 32 + 4, y * 16 + 3, 24, 10);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const smooth = THREE.MathUtils.smoothstep;

export class Prologue {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {string} o.assetBase     URL of assets/meltdown/
   * @param {string} [o.character]   the player character's asset key
   */
  constructor({ renderer, assetBase, character = "playerFemale" }) {
    this.renderer = renderer;
    this.assetBase = assetBase;
    this.character = character;
    this.active = false;
    this.loaded = false;
    this.owned = [];
    this.sets = {};
    this.updaters = [];
    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(50, size.x / size.y, 0.05, 2000);
    ensureStyle();
    this._buildOverlay();
  }

  _own(x) {
    this.owned.push(x);
    return x;
  }

  _buildOverlay() {
    const el = (tag, cls, html = "") => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      n.innerHTML = html;
      return n;
    };
    // A plain object (on an element, our `title` would be its tooltip).
    this.ui = { root: el("div", "prologue") };
    this.ui.root.hidden = true;
    this.ui.fade = el("div", "pl-fade");
    this.ui.card = el("div", "pl-card", `<div class="pl-tag"></div><div class="pl-title"></div><div class="pl-text"></div>`);
    this.ui.dots = el("div", "pl-dots", CHAPTERS.map(() => "<i></i>").join(""));
    this.ui.end = el("div", "pl-endtitle", "FRACTURE RUN");
    this.ui.tag = this.ui.card.querySelector(".pl-tag");
    this.ui.title = this.ui.card.querySelector(".pl-title");
    this.ui.text = this.ui.card.querySelector(".pl-text");
    this.ui.skipButton = el("button", "pl-skip", "SKIP (ESC)");
    this.ui.skipButton.type = "button";
    this.ui.skipButton.addEventListener("click", () => this.skip());
    this.ui.root.append(el("div", "pl-bar top"), el("div", "pl-bar bottom"), this.ui.card, this.ui.dots, this.ui.end, this.ui.fade, this.ui.skipButton);
    document.body.appendChild(this.ui.root);
  }

  /** Fetch the models and build every set. Safe to call twice. */
  async load(onProgress) {
    if (this.loaded) return;
    this._loading ??= (async () => {
      const base = this.assetBase;
      const [assets, okoro, vale] = await Promise.all([
        loadMeltdownAssets(base, { names: ["cityNight", "operatingRoom", "patient", "officeDesk", this.character, "scientistRust"], onProgress }),
        loadStoryCharacter(base, "scientistGood"),
        loadStoryCharacter(base, "scientistEvil"),
      ]);
      this.assets = assets;
      this.templates = { okoro, vale };
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.env = this._own(pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture);
      pmrem.dispose();
      this._buildCity();
      this._buildOffice();
      this._buildTheatre();
      this._buildLabs();
      this._buildWard();
      this._buildLeak();
      this._buildControl();
      this.police = new PoliceHelicopters({ count: 5, seed: 9, craftScale: 2.6 });
      this.police.root.position.y = 115;
      this.sets.city.scene.add(this.police.root);
      await this.police.load(base);
      // Compile every set now, so a cut never stalls.
      for (const set of Object.values(this.sets)) this.renderer.compile(set.scene, this.camera);
      this.loaded = true;
    })();
    await this._loading;
  }

  _set(name, { background = 0x05070a, fog = null } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    if (fog) scene.fog = new THREE.FogExp2(fog[0], fog[1]);
    scene.environment = this.env;
    const set = { scene, name };
    this.sets[name] = set;
    return set;
  }

  _person(template, { position, heading = 0, action = "idle" } = {}) {
    const c = new Companion();
    if (template) c.setModel(template);
    c.root.position.copy(position);
    c.root.rotation.y = heading;
    c.act(action);
    return c;
  }

  /** A patient (the supplied model), posed - floating in a tank, or laid out. */
  _patient(pose = {}) {
    const asset = this.assets.get("patient");
    if (!asset) {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 4, 8), this._own(new THREE.MeshStandardMaterial({ color: 0x8a7b70 })));
      m.position.y = 0.85;
      const g = new THREE.Group();
      g.add(m);
      return g;
    }
    const model = cloneCharacter(asset.template);
    const rig = new HumanoidRig(model);
    if (rig.valid) rig.pose(pose);
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
    });
    return model;
  }

  /* ---------------- The sets ---------------- */

  /** The city at night, and Ascension Tower standing over it. */
  _buildCity() {
    const set = this._set("city", { background: 0x070a14, fog: [0x0b1020, 0.0028] });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0x5a6c9a, 0x120c08, 0.9));
    const moon = new THREE.DirectionalLight(0x9fb2e0, 1.1);
    moon.position.set(-200, 300, 100);
    s.add(moon);
    const city = this.assets.get("cityNight");
    if (city) {
      const model = city.template.clone(true);
      // Its own little sky dome goes: the set has a sky.
      model.traverse((o) => {
        if (o.isMesh && o.geometry.boundingSphere === null) o.geometry.computeBoundingSphere();
        if (o.isMesh && /Sphere/.test(o.name)) o.visible = false;
        if (o.isMesh && o.material && "emissive" in o.material) {
          o.material = this._own(o.material.clone());
          o.material.emissiveMap = o.material.map;
          o.material.emissive = new THREE.Color(0xffffff);
          o.material.emissiveIntensity = 0.55;
        }
      });
      model.scale.setScalar(26);
      model.position.set(0, -6, 0);
      s.add(model);
    }
    // Ascension Tower: the tallest thing in the city by a long way.
    const windows = this._own(windowsTexture(7));
    windows.repeat.set(3, 9);
    const towerMat = this._own(new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.4, metalness: 0.6, map: windows, emissiveMap: windows, emissive: 0xffffff, emissiveIntensity: 0.75 }));
    const tower = new THREE.Mesh(this._own(new THREE.BoxGeometry(34, 220, 34)), towerMat);
    tower.position.y = 110;
    s.add(tower);
    const crown = new THREE.Mesh(this._own(new THREE.BoxGeometry(26, 14, 26)), this._own(new THREE.MeshStandardMaterial({ color: 0x1d2128, metalness: 0.7, roughness: 0.4 })));
    crown.position.y = 227;
    s.add(crown);
    const spire = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.4, 1.4, 40, 8)), crown.material);
    spire.position.y = 254;
    s.add(spire);
    // Aircraft warning lights, blinking.
    const red = this._own(new THREE.MeshBasicMaterial({ color: 0xff2a20 }));
    const blink = [];
    for (const [x, y, z] of [[0, 274, 0], [13, 234, 13], [-13, 234, -13], [13, 234, -13], [-13, 234, 13]]) {
      const b = new THREE.Mesh(this._own(new THREE.SphereGeometry(0.9, 8, 6)), red);
      b.position.set(x, y, z);
      s.add(b);
      blink.push(b);
    }
    // The institute's floors: a band of hot white near the top.
    const band = new THREE.Mesh(this._own(new THREE.BoxGeometry(34.4, 30, 34.4)), this._own(new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })));
    band.position.y = 195;
    s.add(band);
    this.updaters.push((dt, time) => {
      const on = Math.sin(time * 3) > 0.6;
      for (const b of blink) b.visible = on;
    });
  }

  /** Vale's office: the presentation, the board's chairs, a model of the tower. */
  _buildOffice() {
    const set = this._set("office", { background: 0x08090c });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0x8b97b0, 0x1b130d, 0.6));
    const key = new THREE.SpotLight(0xffe2c0, 60, 18, 0.7, 0.6, 1.4);
    key.position.set(2, 4.5, 3);
    key.target.position.set(-1, 1, -1);
    s.add(key, key.target);
    const screenGlow = new THREE.PointLight(0x7fd8ff, 8, 8, 1.6);
    screenGlow.position.set(-1, 2, -2.2);
    s.add(screenGlow);
    const wood = this._own(new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.55, metalness: 0.1 }));
    const wall = this._own(new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.8 }));
    const box = this._own(new THREE.BoxGeometry(1, 1, 1));
    const part = (m, sx, sy, sz, x, y, z) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      s.add(mesh);
      return mesh;
    };
    part(wood, 14, 0.1, 12, 0, -0.05, 0);
    part(wall, 14, 4, 0.2, 0, 2, -3);
    part(wall, 0.2, 4, 12, -6, 2, 0);
    // The night through the window wall.
    const night = this._own(new THREE.MeshBasicMaterial({ color: 0x0d1830 }));
    part(night, 0.05, 2.6, 8, 5.9, 1.8, 0);
    // The presentation screen.
    const slide = this._own(screenTexture([
      ["MERIDIAN INSTITUTE", 22, "#9fd6e6"],
      ["PROJECT ASCENSION", 40, "#ffffff"],
      ["RESONANCE-FIELD CELLULAR RECONSTRUCTION", 16],
      ["PHASE III // HUMAN TRIALS", 20, "#ff9a52"],
    ], { accent: (g, w, h) => {
      g.strokeStyle = "#7fe9ff";
      g.lineWidth = 3;
      for (let i = 0; i < 4; i += 1) { g.beginPath(); g.arc(w - 90, h / 2, 20 + i * 16, 0, Math.PI * 2); g.stroke(); }
    } }));
    const screen = new THREE.Mesh(this._own(new THREE.PlaneGeometry(3.6, 2.0)), this._own(new THREE.MeshBasicMaterial({ map: slide })));
    screen.position.set(-1, 2.1, -2.88);
    s.add(screen);
    // A model of the tower on a plinth by the window: the institute's pride.
    part(this._own(new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.4, metalness: 0.3 })), 1.2, 0.9, 1.2, 3.6, 0.45, -1.6);
    part(this._own(new THREE.MeshStandardMaterial({ color: 0x8fa6b8, roughness: 0.25, metalness: 0.7, emissive: 0x223344 })), 0.35, 1.6, 0.35, 3.6, 1.7, -1.6);
    // The board's chairs, empty now.
    for (let i = 0; i < 4; i += 1) part(this._own(new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.5 })), 0.6, 1.1, 0.6, 1.5 + (i % 2) * 1.2, 0.55, 2 + Math.floor(i / 2) * 1.3);
    // Vale, presenting.
    const vale = this._person(this.templates.vale, { position: new THREE.Vector3(-2.6, 0, -1.8), heading: -0.9, action: "talk" });
    s.add(vale.root);
    this.updaters.push((dt) => vale.update(dt));
    set.people = { vale };
  }

  /** The operating theatre (the supplied scan): a patient on the table, a surgeon. */
  _buildTheatre() {
    const set = this._set("theatre", { background: 0x0a0c0e });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0xdfeaf0, 0x2a2a2a, 0.9));
    const surgical = new THREE.SpotLight(0xffffff, 70, 9, 0.55, 0.5, 1.2);
    surgical.position.set(0, 3.2, 0);
    surgical.target.position.set(0, 0.8, 0);
    s.add(surgical, surgical.target);
    const room = this.assets.get("operatingRoom");
    if (room) {
      const model = room.template.clone(true);
      // The scan's lighting is baked into its textures: let it show.
      model.traverse((o) => {
        // (Unlit materials show their texture as it is already.)
        if (o.isMesh && o.material?.map && "emissive" in o.material) {
          o.material = this._own(o.material.clone());
          o.material.emissiveMap = o.material.map;
          o.material.emissive = new THREE.Color(0xffffff);
          o.material.emissiveIntensity = 0.55;
        }
      });
      model.position.y = 0;
      s.add(model);
    }
    // The table, and the patient on it.
    const steel = this._own(new THREE.MeshStandardMaterial({ color: 0xa8b2b8, metalness: 0.8, roughness: 0.3 }));
    const table = new THREE.Mesh(this._own(new THREE.BoxGeometry(0.8, 0.12, 2.1)), steel);
    table.position.set(0, 0.85, 0);
    s.add(table);
    const leg = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.12, 0.2, 0.85, 10)), steel);
    leg.position.set(0, 0.42, 0);
    s.add(leg);
    const patient = this._patient({ headNod: -0.2, elbow: 0.1 });
    patient.rotation.x = -Math.PI / 2;
    patient.position.set(0, 0.96, 0.9);
    s.add(patient);
    // A surgeon at the table.
    const surgeonT = this.assets.get("scientistRust")?.template ?? null;
    const surgeon = this._person(surgeonT, { position: new THREE.Vector3(-0.85, 0, -0.2), heading: -Math.PI / 2, action: "hold" });
    s.add(surgeon.root);
    this.updaters.push((dt) => surgeon.update(dt));
  }

  /** The labs below the decks: tanks, and what's in them. */
  _buildLabs() {
    const set = this._set("labs", { background: 0x020604, fog: [0x03100a, 0.06] });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0x2a6a50, 0x050505, 0.5));
    const floor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(14, 30)), this._own(new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.3, metalness: 0.5 })));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const glass = this._own(new THREE.MeshStandardMaterial({ color: 0x9fffd8, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.2, emissive: 0x1a8a5a, emissiveIntensity: 0.6 }));
    const fluid = this._own(new THREE.MeshBasicMaterial({ color: 0x2bd38c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    const cap = this._own(new THREE.MeshStandardMaterial({ color: 0x2a3034, metalness: 0.8, roughness: 0.35 }));
    const tankGeo = this._own(new THREE.CylinderGeometry(0.85, 0.85, 2.6, 24, 1, true));
    const capGeo = this._own(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 24));
    const bodies = [];
    for (let i = 0; i < 6; i += 1) {
      const side = i % 2 ? 1 : -1;
      const z = 2 - Math.floor(i / 2) * 4;
      const x = side * 2.6;
      const tank = new THREE.Mesh(tankGeo, glass);
      tank.position.set(x, 1.6, z);
      const inside = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.8, 0.8, 2.5, 20)), fluid);
      inside.position.copy(tank.position);
      for (const y of [0.15, 3.05]) {
        const c = new THREE.Mesh(capGeo, cap);
        c.position.set(x, y, z);
        s.add(c);
      }
      const light = new THREE.PointLight(0x2bd38c, 4, 4.5, 1.8);
      light.position.set(x - side * 0.6, 1.8, z);
      s.add(tank, inside, light);
      const body = this._patient({ reach: 0.35, headNod: 0.5, spread: 0.1, elbow: 0.5 });
      body.position.set(x, 0.35, z);
      body.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      s.add(body);
      bodies.push({ body, phase: i * 1.3 });
      // A label on each: TRIAL 01..06.
      const label = new THREE.Mesh(this._own(new THREE.PlaneGeometry(0.7, 0.18)), this._own(new THREE.MeshBasicMaterial({ map: this._own(screenTexture([[`TRIAL 0${i + 1}`, 64, "#ff6b4a"]], { bg: "#0b0f0e", w: 256, h: 64 })) })));
      label.position.set(x - side * 0.9, 1.0, z);
      label.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      s.add(label);
    }
    // They float, barely moving.
    this.updaters.push((dt, time) => {
      for (const b of bodies) {
        b.body.position.y = 0.35 + Math.sin(time * 0.6 + b.phase) * 0.06;
        b.body.rotation.z = Math.sin(time * 0.4 + b.phase) * 0.04;
      }
    });
  }

  /** The recovery ward (the same set the game opens in): Subject 07 asleep. */
  _buildWard() {
    const set = this._set("ward", { background: 0x0b0f12 });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0xdfefff, 0x2a2420, 1.25));
    const sun = new THREE.DirectionalLight(0xfff4e8, 0.6);
    sun.position.set(-3, 8, -4);
    s.add(sun);
    // The ward is built round a run start; put that at -20 so the ward sits near the origin.
    const ward = new WardStage({ startZ: -20 });
    s.add(ward.root);
    ward.root.position.z = -ward.centreZ;
    this.wardStage = ward;
    this.updaters.push((dt, time) => ward.update(dt, time));
    // Subject 07, asleep: the player's own character, laid in the bed.
    const asset = this.assets.get(this.character);
    const body = new PlayerAvatar();
    if (asset) body.setModel(asset.template);
    body.hold = 0;
    body.update(0.016, { speed: 0 });
    // On their back: head toward the headboard (+Z), face to the ceiling.
    body.root.rotation.x = Math.PI / 2;
    body.shadow.visible = false;
    // The bed (ward.js): x = -1.4, mattress top ~0.7, feet at its foot.
    body.root.position.set(-1.4, 0.8, 0.75);
    s.add(body.root);
    this.updaters.push((dt) => body.update(dt, { speed: 0 }));
    // Okoro, coming in through the door (the last chapter).
    const okoro = this._person(this.templates.okoro, { position: new THREE.Vector3(0.8, 0, -4.6), heading: 0, action: "run" });
    okoro.root.visible = false;
    s.add(okoro.root);
    set.people = { okoro };
    this.updaters.push((dt) => okoro.update(dt, { speed: okoro.speed }));
  }

  /** Okoro's office, late: sending everything to the police. */
  _buildLeak() {
    const set = this._set("leak", { background: 0x040506 });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0x3a4458, 0x0a0806, 0.35));
    const screenLight = new THREE.PointLight(0x8fd8ff, 9, 5, 1.8);
    screenLight.position.set(0.4, 1.3, -0.3);
    s.add(screenLight);
    const lamp = new THREE.PointLight(0xffc98a, 6, 4, 1.8);
    lamp.position.set(1.2, 1.4, -0.9);
    s.add(lamp);
    const floor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(10, 10)), this._own(new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.8 })));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const wall = new THREE.Mesh(this._own(new THREE.PlaneGeometry(10, 4)), this._own(new THREE.MeshStandardMaterial({ color: 0x272a30, roughness: 0.9 })));
    wall.position.set(0, 2, -1.6);
    s.add(wall);
    // The desk (the supplied model, or a slab).
    const desk = this.assets.get("officeDesk");
    if (desk) {
      const model = desk.template.clone(true);
      model.scale.setScalar(1.6 / Math.max(desk.size.x, desk.size.z));
      model.position.set(0.4, 0, -0.6);
      s.add(model);
    } else {
      const slab = new THREE.Mesh(this._own(new THREE.BoxGeometry(1.6, 0.06, 0.8)), this._own(new THREE.MeshStandardMaterial({ color: 0x555b60 })));
      slab.position.set(0.4, 0.75, -0.6);
      s.add(slab);
    }
    // The monitor: the upload.
    this.leakCanvas = document.createElement("canvas");
    this.leakCanvas.width = 512;
    this.leakCanvas.height = 300;
    this.leakTex = this._own(new THREE.CanvasTexture(this.leakCanvas));
    this.leakTex.colorSpace = THREE.SRGBColorSpace;
    const monitor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(0.62, 0.36)), this._own(new THREE.MeshBasicMaterial({ map: this.leakTex })));
    monitor.position.set(0.45, 1.13, -0.85);
    monitor.rotation.y = -0.15;
    s.add(monitor);
    const okoro = this._person(this.templates.okoro, { position: new THREE.Vector3(0.2, 0, 0.25), heading: -0.1, action: "sit" });
    s.add(okoro.root);
    okoro.lookAt(new THREE.Vector3(0.45, 1.13, -0.85), 0.8);
    this.updaters.push((dt) => okoro.update(dt));
    this._leakT = 0;
  }

  _drawLeak(k) {
    const g = this.leakCanvas.getContext("2d");
    const w = this.leakCanvas.width;
    const h = this.leakCanvas.height;
    g.fillStyle = "#03101a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#7fe9ff";
    g.font = "bold 22px monospace";
    g.fillText("SECURE TRANSFER", 24, 40);
    g.font = "16px monospace";
    const files = ["TRIAL_01-06_CASE_RECORDS.zip", "CONSENT_FORMS_SCANNED.pdf", "SUBJECT_07_FIELD_DATA.raw", "VALE_BOARD_MINUTES.mp4"];
    files.forEach((f, i) => {
      const done = k > (i + 1) / (files.length + 1);
      g.fillStyle = done ? "#5dff9a" : "#7fa9b8";
      g.fillText(`${done ? "SENT" : "...."}  ${f}`, 24, 84 + i * 30);
    });
    g.fillStyle = "#1d3340";
    g.fillRect(24, 220, w - 48, 18);
    g.fillStyle = "#5dff9a";
    g.fillRect(24, 220, (w - 48) * Math.min(1, k), 18);
    g.fillStyle = "#ffffff";
    g.font = "bold 18px monospace";
    g.fillText(k >= 1 ? "DELIVERED: CITY POLICE // MAJOR CRIMES" : `UPLOADING  ${Math.floor(Math.min(1, k) * 100)}%`, 24, 270);
    this.leakTex.needsUpdate = true;
  }

  /** The control room: the charges armed, the clock started. */
  _buildControl() {
    const set = this._set("control", { background: 0x060203 });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0x4a2a2a, 0x080404, 0.4));
    this.alarm = new THREE.PointLight(0xff2a1a, 14, 9, 1.6);
    this.alarm.position.set(0, 2.8, 0.5);
    s.add(this.alarm);
    const floor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(10, 10)), this._own(new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5, metalness: 0.4 })));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const panelMat = this._own(new THREE.MeshStandardMaterial({ color: 0x24282c, metalness: 0.6, roughness: 0.4 }));
    const console1 = new THREE.Mesh(this._own(new THREE.BoxGeometry(3.4, 1, 0.9)), panelMat);
    console1.position.set(0, 0.5, -1.4);
    s.add(console1);
    const armed = this._own(screenTexture([
      ["HALCYON // DEMOLITION", 22, "#ff9a8a"],
      ["SEQUENCE ARMED", 42, "#ff3a2a"],
      ["CHARGES: 212 FLOORS", 18, "#ffd1c8"],
      ["T-MINUS 30:00", 34, "#ffffff"],
    ], { bg: "#1a0404" }));
    const screen = new THREE.Mesh(this._own(new THREE.PlaneGeometry(2.4, 1.35)), this._own(new THREE.MeshBasicMaterial({ map: armed })));
    screen.position.set(0, 1.85, -1.86);
    s.add(screen);
    // A row of red keys under the screen.
    const keyMat = this._own(new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    for (let i = 0; i < 7; i += 1) {
      const k = new THREE.Mesh(this._own(new THREE.BoxGeometry(0.12, 0.05, 0.12)), keyMat);
      k.position.set(-0.75 + i * 0.25, 1.03, -1.1);
      s.add(k);
    }
    // Off to the side, so the screen reads past him.
    const vale = this._person(this.templates.vale, { position: new THREE.Vector3(1.2, 0, -0.35), heading: Math.PI + 0.35, action: "point" });
    s.add(vale.root);
    this.updaters.push((dt, time) => {
      vale.update(dt);
      this.alarm.intensity = 8 + Math.max(0, Math.sin(time * 6)) * 14;
    });
  }

  /* ---------------- Playing it ---------------- */

  /** Roll the film; `onDone` when it's over (or skipped). */
  start(onDone) {
    this.onDone = onDone;
    this.active = true;
    this.t = 0;
    this.chapter = -1;
    this.ended = false;
    this.ui.root.hidden = false;
    this.ui.end.classList.remove("show");
    this.ui.fade.style.opacity = "1";
    this._resize();
  }

  /** Cut it short: straight back. */
  skip() {
    if (!this.active) return;
    this._finish();
  }

  _finish() {
    this.active = false;
    this.ui.root.hidden = true;
    this.ui.card.classList.remove("show");
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  _resize() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();
  }

  /** Where in the film: { index, chapter, local time, k 0..1 }. */
  _at(t) {
    let start = 0;
    for (const [index, chapter] of CHAPTERS.entries()) {
      if (t < start + chapter.seconds) return { index, chapter, local: t - start, k: (t - start) / chapter.seconds };
      start += chapter.seconds;
    }
    return null;
  }

  get duration() {
    return CHAPTERS.reduce((a, c) => a + c.seconds, 0);
  }

  update(dt, time) {
    if (!this.active) return;
    this.t += dt;
    const at = this._at(this.t);
    if (!at) {
      // The end: the title on black, then back to the menu.
      const end = this.t - this.duration;
      this.ui.card.classList.remove("show");
      this.ui.fade.style.opacity = "1";
      this.ui.end.classList.toggle("show", end > 0.4 && end < 3.6);
      if (end > 4.4) this._finish();
      return;
    }
    const { index, chapter, local, k } = at;
    if (index !== this.chapter) this._enterChapter(index, chapter);
    // Fade through black between chapters.
    const fade = Math.max(1 - smooth(local, 0, 0.7), smooth(local, chapter.seconds - 0.6, chapter.seconds));
    this.ui.fade.style.opacity = fade.toFixed(3);
    // Type the caption out.
    const chars = Math.floor(Math.max(0, local - 0.8) * 42);
    this.ui.text.textContent = chapter.text.slice(0, chars);
    // The camera's move, with a little drift.
    const e = smooth(k, 0, 1);
    const p = (a, b) => new THREE.Vector3().fromArray(a).lerp(new THREE.Vector3().fromArray(b), e);
    this.camera.position.copy(p(chapter.from.pos, chapter.to.pos));
    this.camera.position.x += Math.sin(time * 0.37) * 0.03;
    this.camera.position.y += Math.sin(time * 0.53) * 0.02;
    this.camera.lookAt(p(chapter.from.look, chapter.to.look));
    for (const u of this.updaters) u(dt, time);
    if (chapter.set === "leak") this._drawLeak(smooth(local, 1.5, chapter.seconds - 1.5));
    if (chapter.police) {
      this.police.root.visible = true;
      // Lifted to the institute's floors (they fly at a bridge's height), lights on the tower.
      this.police.update(dt, time, { worldZ: (d) => 90 - d, distance: 0, deckY: 75, overDeck: true, cityY: -115, spotZ: 0, spotSpread: 16 });
    }
    if (chapter.okoroArrives) {
      const okoro = this.sets.ward.people.okoro;
      okoro.root.visible = true;
      const run = smooth(local, 0.6, 4);
      // In through the door, up beside the bed - then turned to the patient.
      okoro.root.position.set(0.8 - run * 0.9, 0, -4.6 + run * 5.6);
      okoro.root.rotation.y = Math.PI - 0.16 - smooth(local, 3.6, 4.4) * (Math.PI / 2 - 0.16);
      okoro.act(run < 1 ? "run" : "talk");
      okoro.speed = run < 1 ? 4 : 0;
      okoro.lookAt(new THREE.Vector3(-1.4, 0.9, 2.2), 1);
    }
  }

  _enterChapter(index, chapter) {
    this.chapter = index;
    this.current = this.sets[chapter.set];
    this.police.root.visible = !!chapter.police;
    this.sets.ward.people.okoro.root.visible = !!chapter.okoroArrives;
    this.ui.tag.textContent = `${chapter.tag} // PROJECT ASCENSION`;
    this.ui.title.textContent = chapter.title;
    this.ui.text.textContent = "";
    this.ui.card.classList.remove("show");
    void this.ui.card.offsetWidth;
    this.ui.card.classList.add("show");
    [...this.ui.dots.children].forEach((d, i) => d.classList.toggle("on", i <= index));
    this.camera.fov = chapter.set === "city" ? 38 : 50;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (!this.active || !this.current) return;
    this.renderer.render(this.current.scene, this.camera);
  }

  dispose() {
    this.active = false;
    this.ui.root.remove();
    this.wardStage?.dispose();
    this.police?.dispose();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
