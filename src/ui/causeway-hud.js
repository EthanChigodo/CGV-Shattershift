/**
 * Level 1 HUD - The Glass Causeway.
 *
 * The player is a patient escaping a lab, so the HUD borrows from a bedside
 * monitor: integrity is a live ECG trace whose rate climbs with damage and
 * smoke, the tools read like an infusion panel, and transmissions arrive as
 * intercom captions. Everything is DOM (cheap, crisp, accessible); only the
 * ECG trace uses a small 2D canvas.
 *
 * Scoped under .cw-ui so it cannot clash with styles.css or the Level 2 HUD.
 */

import { BALLS, BALL_ORDER } from "../systems/arsenal.js";

/**
 * Every panel the player can switch on or off (View menu, Settings, or `H`
 * for none at all). Visibility is a body class per panel, so it costs nothing
 * and survives HUD rebuilds. Defaults are deliberately sparse.
 */
export const HUD_PANELS = [
  { key: "stats", label: "Spheres and score", on: true },
  { key: "vitals", label: "Vitals (integrity, air)", on: true },
  { key: "tools", label: "Sphere type, speed, focus", on: true },
  { key: "intercom", label: "Intercom subtitles", on: true },
  { key: "hints", label: "Hints and section titles", on: true },
  { key: "serums", label: "Active serums", on: true },
  { key: "missions", label: "Missions", on: false },
  { key: "minimap", label: "Minimap", on: false },
  { key: "fps", label: "Performance overlay", on: false },
];

/** Apply a { key: boolean } map to the page. */
export function applyHudPanels(panels) {
  for (const p of HUD_PANELS) document.body.classList.toggle(`hud-off-${p.key}`, !(panels[p.key] ?? p.on));
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function ensureStylesheet() {
  if (document.querySelector("link[data-causeway-hud]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./causeway-hud.css", import.meta.url).href;
  link.dataset.causewayHud = "";
  document.head.appendChild(link);
}

export class CausewayHud {
  constructor() {
    ensureStylesheet();
    this.root = el("div", "cw-ui");
    this.root.hidden = true;

    this.fadeEl = el("div", "cw-fade");
    this.titleEl = el("div", "cw-title", "<span></span><strong></strong>");
    this.radioEl = el("div", "cw-radio", "<span class='cw-who'></span><p></p>");
    this.hintEl = el("div", "cw-hint");
    this.warnEl = el("div", "cw-warn", "<strong></strong><span></span>");
    this.fileEl = el("div", "cw-file", "<span>Case file recovered</span><h3></h3><p></p>");
    this.missionsEl = el("div", "cw-missions", "<h4>Missions</h4><ol></ol>");
    this.serumsEl = el("div", "cw-serums");

    this.vitalsEl = el("div", "cw-vitals", `
      <div class="cw-vitals-head"><span>Subject 07</span><b class="cw-bpm">72 bpm</b></div>
      <canvas width="200" height="40"></canvas>
      <div class="cw-meters">
        <label><span>Integrity</span><i><em class="cw-int"></em></i><b class="cw-int-n">100</b></label>
        <label><span>Air</span><i><em class="cw-air"></em></i><b class="cw-air-n">Clear</b></label>
      </div>`);
    this.ecg = this.vitalsEl.querySelector("canvas");
    this.ecgCtx = this.ecg.getContext("2d");

    this.toolsEl = el("div", "cw-tools");
    const balls = BALL_ORDER.map((k, i) => `
      <div class="cw-ball" data-ball="${k}">
        <i style="--c:#${BALLS[k].colour.toString(16).padStart(6, "0")}"></i>
        <span>${BALLS[k].name}</span><b>${BALLS[k].cost}</b>
      </div>`).join("");
    this.toolsEl.innerHTML = `
      <div class="cw-balls">${balls}</div>
      <div class="cw-gauges">
        <label><span>Speed</span><i><em class="cw-speed"></em></i><b class="cw-speed-n">0</b></label>
        <label><span>Focus</span><i><em class="cw-focus"></em></i><b>RMB</b></label>
      </div>`;

    this.coreEl = el("div", "cw-core", `
      <div class="cw-spheres"><b>20</b><span>Spheres</span></div>
      <div class="cw-score"><b>000000</b><span>Score</span></div>
      <div class="cw-combo"><b>x1</b><span>Combo</span><i><em></em></i></div>
      <div class="cw-cam"><b>First person</b><span>Camera (C)</span></div>`);

    this.mapEl = el("div", "cw-map", `
      <div class="cw-map-frame"><i class="lane l"></i><i class="lane r"></i></div>
      <div class="cw-map-key"><span class="k-glass">Glass</span><span class="k-hazard">Solid</span><span class="k-fire">Fire</span><span class="k-sprinkler">Sprinkler</span></div>`);
    this.mapFrame = this.mapEl.querySelector(".cw-map-frame");

    this.introEl = el("div", "cw-intro", `
      <span>Sector 01 of 03</span>
      <h2>The Glass Causeway</h2>
      <p>Observation wing, level 212. The demolition charges are armed. Reach the Calibration Lift.</p>
      <ul></ul>`);

    this.reportEl = el("div", "cw-report", `
      <span>Sector report</span><h3>Causeway cleared</h3>
      <dl></dl><ol class="cw-report-missions"></ol>`);

    this.labelsEl = el("div", "cw-labels");
    this.perfEl = el("pre", "cw-perf");
    this.perfEl.hidden = true;

    this.photoEl = el("div", "cw-photo", `
      <div class="cw-photo-bar">
        <strong>Photo mode</strong>
        <span>Drag to orbit, scroll to zoom</span>
        <div class="cw-photo-filters">
          <button data-filter="0" class="on">Natural</button>
          <button data-filter="1">Noir</button>
          <button data-filter="2">Archive</button>
          <button data-filter="3">Thermal</button>
        </div>
        <label>Field of view <input type="range" min="25" max="100" value="60" data-fov></label>
        <button data-action="photo" class="cw-primary">Save photo</button>
        <button data-action="360">Save 360°</button>
        <button data-action="exit">Exit (P)</button>
      </div>`);
    this.photoEl.hidden = true;

    this.root.append(this.fadeEl, this.labelsEl, this.titleEl, this.radioEl, this.hintEl, this.warnEl, this.fileEl,
      this.missionsEl, this.serumsEl, this.vitalsEl, this.toolsEl, this.coreEl, this.mapEl, this.introEl, this.reportEl);
    document.body.append(this.root, this.photoEl, this.perfEl);

    this._timers = { title: 0, radio: 0, hint: 0, file: 0, intro: 0 };
    this._typing = null;
    this._ecgPhase = 0;
    this._ecgX = 0;
    this._bpm = 72;
    this._integrity = 100;
    this._labelPool = [];
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  get visible() { return !this.root.hidden; }

  _flash(node, key, seconds) {
    node.classList.add("show");
    this._timers[key] = seconds;
  }

  title(kicker, name, seconds = 3.2) {
    this.titleEl.querySelector("span").textContent = kicker;
    this.titleEl.querySelector("strong").textContent = name;
    this._flash(this.titleEl, "title", seconds);
  }

  radio({ who, speaker, text }) {
    this.radioEl.dataset.speaker = speaker;
    this.radioEl.querySelector(".cw-who").textContent = who;
    const p = this.radioEl.querySelector("p");
    p.textContent = "";
    this._typing = { text, i: 0, p };
    this._flash(this.radioEl, "radio", 3 + text.length * 0.045);
  }

  hint(text, seconds = 2.4) {
    this.hintEl.textContent = text;
    this._flash(this.hintEl, "hint", seconds);
  }

  warning(title, detail = "", tone = "red") {
    if (!title) { this.warnEl.classList.remove("show"); return; }
    this.warnEl.dataset.tone = tone;
    this.warnEl.querySelector("strong").textContent = title;
    this.warnEl.querySelector("span").textContent = detail;
    this.warnEl.classList.add("show");
  }

  caseFile(lines, found = 0, total = 5) {
    this.fileEl.querySelector("span").textContent = found ? `Case file ${found} of ${total} recovered` : "Case file recovered";
    this.fileEl.querySelector("h3").textContent = lines[0];
    this.fileEl.querySelector("p").textContent = lines.slice(1).join(" ");
    this._flash(this.fileEl, "file", 6);
  }

  showIntro(missions) {
    this.introEl.querySelector("ul").innerHTML = missions.map((m) => `<li>${m.def.text}</li>`).join("");
    this._flash(this.introEl, "intro", 5);
  }

  setMissions(missions) {
    const html = missions.map((m) => {
      const progress = m.def.goal > 1 ? `<b>${m.value}/${m.def.goal}</b>` : "";
      return `<li class="${m.done ? "done" : ""}"><span>${m.def.text}</span>${progress}</li>`;
    }).join("");
    if (html !== this._missionsHtml) {
      this._missionsHtml = html;
      this.missionsEl.querySelector("ol").innerHTML = html;
    }
  }

  setTools({ ball, spheres, speed, speedRatio, focus, cost }) {
    for (const node of this.toolsEl.querySelectorAll(".cw-ball")) {
      const key = node.dataset.ball;
      node.classList.toggle("on", key === ball);
      node.classList.toggle("dry", BALLS[key].cost > spheres && cost !== 0);
    }
    this.toolsEl.querySelector(".cw-speed").style.transform = `scaleX(${speedRatio.toFixed(3)})`;
    this.toolsEl.querySelector(".cw-speed-n").textContent = `${speed.toFixed(1)} m/s`;
    this.toolsEl.querySelector(".cw-focus").style.transform = `scaleX(${focus.toFixed(3)})`;
  }

  setCore({ spheres, score, combo, comboRatio, camera, low }) {
    const c = this.coreEl;
    c.querySelector(".cw-spheres b").textContent = spheres;
    c.querySelector(".cw-spheres").classList.toggle("low", low);
    c.querySelector(".cw-score b").textContent = String(Math.floor(score)).padStart(6, "0");
    c.querySelector(".cw-combo b").textContent = `x${combo}`;
    c.querySelector(".cw-combo em").style.transform = `scaleX(${comboRatio.toFixed(3)})`;
    c.querySelector(".cw-cam b").textContent = camera;
  }

  bump(selector) {
    const node = this.coreEl.querySelector(selector);
    node?.classList.remove("bump");
    void node?.offsetWidth;
    node?.classList.add("bump");
  }

  setVitals({ integrity, smoke, heat, sedation = 0 }) {
    this._integrity = integrity;
    const stress = (100 - integrity) / 100;
    // Sedated at the pod: a slow resting rate that climbs as the drug wears off.
    this._bpm = integrity <= 0 ? 0 : 68 + stress * 70 + smoke * 30 + heat * 25 - sedation * 18;
    this.vitalsEl.querySelector(".cw-bpm").textContent = integrity <= 0 ? "No signal" : `${Math.round(this._bpm)} bpm`;
    this.vitalsEl.querySelector(".cw-int").style.transform = `scaleX(${Math.max(0, integrity / 100).toFixed(3)})`;
    this.vitalsEl.querySelector(".cw-int-n").textContent = Math.max(0, Math.round(integrity));
    this.vitalsEl.querySelector(".cw-air").style.transform = `scaleX(${(1 - smoke).toFixed(3)})`;
    this.vitalsEl.querySelector(".cw-air-n").textContent = smoke > 0.6 ? "Toxic" : smoke > 0.3 ? "Smoky" : "Clear";
    this.vitalsEl.classList.toggle("critical", integrity < 35);
    this.vitalsEl.classList.toggle("smoky", smoke > 0.55);
  }

  setSerums(list) {
    const html = list.map((s) => `
      <div class="cw-serum" style="--c:${s.colour};--r:${s.ratio.toFixed(3)}">
        <i></i><span>${s.name}</span><b>${Math.ceil(s.remaining)}s</b>
      </div>`).join("");
    if (html !== this._serumHtml) { this._serumHtml = html; this.serumsEl.innerHTML = html; }
  }

  liftReport(rows, missions) {
    this.reportEl.querySelector("dl").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    this.reportEl.querySelector("ol").innerHTML = missions.map((m) => `<li class="${m.done ? "done" : ""}">${m.def.text}</li>`).join("");
    this.reportEl.classList.add("show");
  }

  hideReport() { this.reportEl.classList.remove("show"); }

  fade(value) { this.fadeEl.style.opacity = value.toFixed(3); }

  perf(text) {
    if (text === null) { this.perfEl.hidden = true; return; }
    this.perfEl.hidden = false;
    this.perfEl.textContent = text;
  }

  /**
   * World-attached labels for the level preview. Each label is projected
   * from its object's world position to the screen every frame; labels that
   * would overlap are pushed down until they do not.
   */
  labels(items, camera) {
    const visible = [];
    for (const item of items.slice(0, 3)) {
      if (!camera) break;
      const p = item.position.clone().project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.1) continue;
      visible.push({ item, x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight });
    }
    visible.sort((a, b) => a.y - b.y);
    const placed = [];
    for (const v of visible) {
      let guard = 0;
      while (placed.some((q) => Math.abs(q.x - v.x) < 210 && Math.abs(q.y - v.y) < 62) && guard++ < 8) v.y += 64;
      v.y = Math.min(v.y, innerHeight - 150);
      placed.push(v);
    }
    while (this._labelPool.length < placed.length) {
      const node = el("div", "cw-label", "<strong></strong><span></span>");
      this.labelsEl.appendChild(node);
      this._labelPool.push(node);
    }
    this._labelPool.forEach((node, i) => {
      const v = placed[i];
      if (!v) { node.hidden = true; return; }
      node.hidden = false;
      node.dataset.kind = v.item.kind;
      node.style.transform = `translate(${v.x.toFixed(0)}px, ${v.y.toFixed(0)}px)`;
      node.style.opacity = Math.min(1, (44 - v.item.gap) / 10).toFixed(2);
      node.querySelector("strong").textContent = v.item.title;
      node.querySelector("span").textContent = v.item.text;
    });
  }

  clearLabels() { this.labels([], null); }

  _drawEcg(dt) {
    const ctx = this.ecgCtx;
    const w = this.ecg.width;
    const h = this.ecg.height;
    const speed = 70;
    const steps = Math.max(1, Math.round(dt * speed));
    for (let s = 0; s < steps; s += 1) {
      this._ecgPhase += (this._bpm / 60) / speed;
      const ph = this._ecgPhase % 1;
      // A stylised PQRST complex.
      let v = 0;
      if (this._bpm > 0) {
        v += Math.exp(-((ph - 0.12) ** 2) / 0.0012) * 0.12;
        v -= Math.exp(-((ph - 0.2) ** 2) / 0.00008) * 0.18;
        v += Math.exp(-((ph - 0.23) ** 2) / 0.00012) * 1.0;
        v -= Math.exp(-((ph - 0.26) ** 2) / 0.0001) * 0.3;
        v += Math.exp(-((ph - 0.45) ** 2) / 0.003) * 0.22;
      }
      const x = this._ecgX;
      const y = h * 0.62 - v * h * 0.5;
      ctx.clearRect(x, 0, 6, h);
      ctx.strokeStyle = this._integrity < 35 ? "#ff5a4a" : "#5ef0ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 1, this._lastY ?? y);
      ctx.lineTo(x, y);
      ctx.stroke();
      this._lastY = y;
      this._ecgX = (x + 1) % w;
      if (this._ecgX === 0) this._lastY = null;
    }
  }

  update(dt) {
    for (const [key, node] of [["title", this.titleEl], ["radio", this.radioEl], ["hint", this.hintEl], ["file", this.fileEl], ["intro", this.introEl]]) {
      if (this._timers[key] > 0) {
        this._timers[key] -= dt;
        if (this._timers[key] <= 0) node.classList.remove("show");
      }
    }
    if (this._typing) {
      const t = this._typing;
      t.i = Math.min(t.text.length, t.i + dt * 55);
      t.p.textContent = t.text.slice(0, Math.floor(t.i));
      if (t.i >= t.text.length) this._typing = null;
    }
    if (this.visible) this._drawEcg(dt);
  }

  reset() {
    for (const node of [this.titleEl, this.radioEl, this.hintEl, this.fileEl, this.introEl, this.reportEl, this.warnEl]) node.classList.remove("show");
    for (const key of Object.keys(this._timers)) this._timers[key] = 0;
    this.fade(0);
    this.clearLabels();
  }
}
