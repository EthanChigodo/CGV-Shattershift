/**
 * What a serum looks like from the inside, the same in every level.
 *
 * When one goes in, a banner across the top of the screen names it, says
 * what it does and how long it lasts; then it shrinks into a chip under the
 * top bar that counts down. While it runs, the edges of the screen glow in
 * its colour (arsenal.js SERUMS), and each one has its own effect on the
 * view:
 *
 *   prism      a gold glow and a prism fringe round the edges
 *   thermal    an orange heat grade, scan lines, a white-hot core
 *   shield     a green honeycomb rim - and a ripple when it takes a hit
 *   overdrive  pink speed lines streaking out from the centre
 *
 * In the last three seconds the glow blinks, so you know it's ending.
 * All DOM and one small 2D canvas (the speed lines): no level has to know
 * about it. CausewayHud.setSerums drives it every frame.
 */

import { SERUMS, SERUM_ORDER } from "../systems/arsenal.js";

const ANNOUNCE_SECONDS = 2.8;

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export class SerumFx {
  /** @param {HTMLElement} parent  the HUD root (hidden with it in cutscenes) */
  constructor(parent) {
    this.root = el("div", "sx");
    this.layers = {};
    for (const key of SERUM_ORDER) {
      const def = SERUMS[key];
      const layer = el("div", `sx-layer sx-${key}`);
      layer.style.setProperty("--c", def.colour);
      layer.style.setProperty("--rgb", rgb(def.colour));
      layer.append(el("i", "sx-edge"), el("i", "sx-look"));
      this.root.append(layer);
      this.layers[key] = layer;
    }
    this.lines = el("canvas", "sx-lines");
    this.layers.overdrive.append(this.lines);
    this.linesCtx = this.lines.getContext("2d");
    this.streaks = Array.from({ length: 70 }, () => this._streak(true));

    this.banner = el("div", "sx-banner", `
      <span class="sx-kicker">Serum injected</span>
      <strong></strong>
      <p></p>
      <em class="sx-duration"></em>`);
    this.chips = el("div", "sx-chips");
    this.root.append(this.banner, this.chips);
    parent.append(this.root);

    this.previous = new Map();
    this.announceLeft = 0;
    this._last = performance.now();
    this._chipsHtml = "";
    this.reducedMotion = false;
  }

  _streak(scatter = false) {
    return { a: Math.random() * Math.PI * 2, r: scatter ? Math.random() : 0.1 + Math.random() * 0.15, v: 0.6 + Math.random() * 1.4, w: 0.6 + Math.random() * 1.6 };
  }

  /** The next injection of this serum is announced elsewhere (the first-pickup card): skip its banner. */
  quiet(key) {
    (this.quietKeys ??= new Set()).add(key);
  }

  /** A serum just went in: the big banner (with what's left of it, if it's been running). */
  announce(def, state = null) {
    this.banner.style.setProperty("--c", def.colour);
    this.banner.style.setProperty("--rgb", rgb(def.colour));
    this.banner.querySelector("strong").textContent = def.name;
    this.banner.querySelector("p").textContent = def.text;
    const seconds = Math.ceil(state?.remaining ?? def.duration);
    this.banner.querySelector(".sx-duration").textContent = def.charges
      ? `${def.charges} hits or ${seconds} seconds`
      : `${seconds} seconds`;
    this.banner.classList.remove("show");
    void this.banner.offsetWidth; // restart the entrance
    this.banner.classList.add("show");
    this.announceLeft = ANNOUNCE_SECONDS;
    const layer = this.layers[def.key];
    layer.classList.remove("flash");
    void layer.offsetWidth;
    layer.classList.add("flash");
  }

  /** The shield took a hit: a ripple through the honeycomb. */
  ripple() {
    const layer = this.layers.shield;
    layer.classList.remove("hit");
    void layer.offsetWidth;
    layer.classList.add("hit");
  }

  /**
   * @param {Array<{key: string, remaining: number, duration: number, ratio: number}>} list  arsenal.list()
   * @param {{charges?: number}} [o]
   */
  update(list, { charges = 0 } = {}) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;

    const active = new Map(list.map((s) => [s.key, s]));
    this.announced ??= new Set();
    for (const [key, s] of active) {
      // Announce each injection once (its serial), however the HUD came and
      // went in between; a list without serials falls back to "it's new".
      const id = s.serial ?? `${key}:${Math.round(s.duration - s.remaining)}`;
      if (s.serial !== undefined ? !this.announced.has(id) : !this.previous.get(key)) {
        this.announced.add(id);
        // Already explained on the paused first-pickup card: no banner too.
        if (this.quietKeys?.delete(key)) continue;
        this.announce(SERUMS[key], s);
      }
    }
    if (this.previous.has("shield") && active.has("shield") && charges < this.previousCharges) this.ripple();
    this.previousCharges = charges;
    this.previous = new Map([...active].map(([k, s]) => [k, { remaining: s.remaining }]));

    // Two or three at once share the screen rather than stacking into a wash.
    const share = active.size > 2 ? 0.5 : active.size > 1 ? 0.65 : 1;
    for (const key of SERUM_ORDER) {
      const s = active.get(key);
      const layer = this.layers[key];
      // Ease in over half a second, out over the last one (arsenal.level).
      const level = s ? Math.min(1, (s.duration - s.remaining) * 2, s.remaining) * share : 0;
      layer.style.setProperty("--a", level.toFixed(3));
      layer.classList.toggle("on", !!s);
      layer.classList.toggle("ending", !!s && s.remaining < 3);
    }

    this.announceLeft = Math.max(0, this.announceLeft - dt);
    if (this.announceLeft <= 0) this.banner.classList.remove("show");

    const html = list.map((s) => {
      const def = SERUMS[s.key];
      const extra = s.key === "shield" && charges ? `<small>${charges} hit${charges > 1 ? "s" : ""}</small>` : "";
      return `<div class="sx-chip${s.remaining < 3 ? " ending" : ""}" style="--c:${def.colour};--rgb:${rgb(def.colour)};--r:${s.ratio.toFixed(3)}">
        <i></i><span>${def.name}</span>${extra}<b>${s.remaining.toFixed(1)}s</b></div>`;
    }).join("");
    if (html !== this._chipsHtml) { this._chipsHtml = html; this.chips.innerHTML = html; }
    this.chips.classList.toggle("lowered", this.announceLeft > 0);
    // A section title showing at the same time steps down out of its way.
    document.body.classList.toggle("sx-announcing", this.announceLeft > 0);

    this._drawLines(dt, active.has("overdrive") ? Number(this.layers.overdrive.style.getPropertyValue("--a")) : 0);
  }

  /** Overdrive's speed lines: streaks flying out from the centre. */
  _drawLines(dt, level) {
    const c = this.lines;
    const g = this.linesCtx;
    if (level <= 0.001) {
      if (this._linesOn) { g.clearRect(0, 0, c.width, c.height); this._linesOn = false; }
      return;
    }
    this._linesOn = true;
    const w = Math.round(innerWidth / 2);
    const h = Math.round(innerHeight / 2);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.46;
    const reach = Math.hypot(w, h) * 0.6;
    g.lineCap = "round";
    const speed = this.reducedMotion ? 0.35 : 1;
    for (const s of this.streaks) {
      s.r += dt * s.v * speed * (0.6 + s.r * 1.8);
      if (s.r > 1.1) Object.assign(s, this._streak());
      const inner = s.r * reach;
      const outer = inner + (20 + s.r * 120) * s.w;
      if (inner < reach * 0.22) continue; // keep the middle of the view clear
      const x0 = cx + Math.cos(s.a) * inner;
      const y0 = cy + Math.sin(s.a) * inner;
      const x1 = cx + Math.cos(s.a) * outer;
      const y1 = cy + Math.sin(s.a) * outer;
      const alpha = Math.min(1, (s.r - 0.22) * 2.2) * level * 0.55;
      g.strokeStyle = `rgba(255, 220, 240, ${alpha.toFixed(3)})`;
      g.lineWidth = 0.6 + s.w * s.r * 1.4;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
  }

  clear() {
    this.previous.clear();
    this.update([]);
    this.banner.classList.remove("show");
    this.announceLeft = 0;
  }
}
