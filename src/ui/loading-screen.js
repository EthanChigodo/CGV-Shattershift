/**
 * The loading screen: whatever is being built or streamed in, the screen
 * never just sits black.
 *
 * Ascension Tower draws itself in the middle of the screen - its outline,
 * then its windows lighting floor by floor from the street up as the loading
 * goes (the floor counter climbs with it), a scan line sweeping up the
 * facade, glass shards drifting past in the dark, the sector you are headed
 * for in big letters and a tip under it. All 2D canvas and DOM: the game's
 * own renderer is busy with what is loading.
 *
 *   const loading = new LoadingScreen();
 *   loading.show("SECTOR 02", "THE LABS");
 *   loading.setProgress(loaded, total);   // or never: it runs on its own
 *   loading.hide();
 *
 * Progress is whatever it is told (main.js feeds it three.js's loading
 * manager), but it never goes backwards and it creeps on its own, so a
 * build with nothing to download still reads as moving.
 */

const TIPS = [
  "Cyan rims break. Everything else, go round.",
  "Cryo goes off like shock, in ice - and puts out every fire it reaches.",
  "Shock shatters reinforced glass in one hit.",
  "No spheres left? One comes back every few seconds.",
  "Lure the patients into a charge at the open ledge - they don't stop.",
  "Thermal Aegis: see through the smoke, and the fire can't touch you.",
  "Restoration: twenty spheres and your integrity back, at once.",
  "Sprinkler bulbs are glass. Break one and the fire below goes out.",
  "Slide under, jump over, and never stop moving.",
  "The scientists' gadgets glow before they fire. Move when they do.",
];

const FLOORS = 48;
const COLS = 9;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class LoadingScreen {
  constructor({ container = document.body, reducedMotion = false } = {}) {
    if (!document.querySelector("link[data-loading-screen]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("./loading-screen.css", import.meta.url).href;
      link.dataset.loadingScreen = "true";
      document.head.appendChild(link);
    }
    this.reducedMotion = reducedMotion;
    this.root = el("section", "ld-root");
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.root.hidden = true;
    this.canvas = el("canvas", "ld-canvas");
    const copy = el("div", "ld-copy");
    this.kicker = el("p", "ld-kicker", "ASCENSION TOWER");
    this.title = el("h2", "ld-title", "LOADING");
    this.title.dataset.text = "LOADING";
    const meter = el("div", "ld-meter");
    this.bar = el("i", "ld-bar");
    meter.append(this.bar);
    const row = el("div", "ld-row");
    this.floorEl = el("span", "ld-floor", "FLOOR 000");
    this.pctEl = el("b", "ld-pct", "0%");
    row.append(this.floorEl, this.pctEl);
    this.tip = el("p", "ld-tip", TIPS[0]);
    copy.append(this.kicker, this.title, meter, row, this.tip);
    this.root.append(this.canvas, copy);
    container.append(this.root);

    this.visible = false;
    this.shown = 0;
    this.progress = 0;
    this.target = 0;
    this.t = 0;
    this.tipIndex = Math.floor(Math.random() * TIPS.length);
    this.tipAt = 0;
    this.shards = Array.from({ length: 46 }, () => this._shard(true));
    this._frame = this._frame.bind(this);
    this._last = 0;
    this._raf = 0;
  }

  /** Show it, headed for `kicker` / `title` (e.g. "SECTOR 02", "THE LABS"). */
  /** `instant`: up at once, no fade in (between levels, before the long frozen part). */
  show(kicker = "ASCENSION TOWER", title = "LOADING", { instant = false } = {}) {
    this.kicker.textContent = kicker;
    this.title.textContent = title;
    this.title.dataset.text = title;
    if (this.visible) return;
    this.visible = true;
    this.progress = 0;
    this.target = 0;
    this.t = 0;
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.tip.textContent = TIPS[this.tipIndex];
    this.tipAt = 0;
    this.root.hidden = false;
    if (instant) {
      this.root.style.transition = "none";
      this.root.classList.add("show");
      void this.root.offsetWidth;
      this.root.style.transition = "";
      this._draw(0);
    } else {
      // A moment later, so the fade-in transition runs.
      setTimeout(() => { if (this.visible) this.root.classList.add("show"); }, 20);
    }
    this._last = performance.now();
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._frame);
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.target = 1;
    this.root.classList.remove("show");
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (this.visible) return;
      this.root.hidden = true;
      cancelAnimationFrame(this._raf);
    }, 450);
  }

  /** How far the loading has got (items loaded of total). */
  setProgress(loaded, total) {
    if (!total) return;
    this.target = Math.max(this.target, Math.min(1, loaded / total));
  }

  _shard(anywhere = false) {
    const w = this.canvas?.width || 1600;
    const h = this.canvas?.height || 900;
    const r = 4 + Math.random() * 22;
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + r * 2,
      r,
      vy: -(8 + Math.random() * 26),
      vx: (Math.random() - 0.5) * 10,
      spin: (Math.random() - 0.5) * 1.6,
      a: Math.random() * Math.PI * 2,
      sides: 3 + Math.floor(Math.random() * 2),
      tint: Math.random() < 0.2 ? 1 : 0,
      alpha: 0.08 + Math.random() * 0.22,
    };
  }

  _frame(now) {
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this.t += dt;
    // Creep on its own (to 90% at most), and ease toward what we are told.
    this.target = Math.max(this.target, Math.min(0.9, this.target + dt * 0.05 * (1 - this.target)));
    this.progress += (this.target - this.progress) * Math.min(1, dt * 4);
    this.tipAt += dt;
    if (this.tipAt > 4.5) {
      this.tipAt = 0;
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
      this.tip.classList.remove("in");
      void this.tip.offsetWidth;
      this.tip.textContent = TIPS[this.tipIndex];
      this.tip.classList.add("in");
    }
    const pct = Math.round(this.progress * 100);
    this.bar.style.transform = `scaleX(${this.progress.toFixed(3)})`;
    this.pctEl.textContent = `${pct}%`;
    this.floorEl.textContent = `FLOOR ${String(Math.round(141 + this.progress * 71)).padStart(3, "0")}`;
    this._draw(dt);
    if (this.visible || this.root.classList.contains("show")) this._raf = requestAnimationFrame(this._frame);
  }

  _draw(dt) {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(c.clientWidth * dpr));
    const H = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
      // Re-scatter the glass over the new size, and the skyline with it.
      this.shards = this.shards.map(() => this._shard(true));
      this._skyline = null;
    }
    const g = c.getContext("2d");
    const t = this.t;
    const motion = this.reducedMotion ? 0.2 : 1;

    // The night: a deep gradient, a glow of fire from below.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#05070b");
    sky.addColorStop(0.65, "#0b0a0d");
    sky.addColorStop(1, "#2a0f07");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.5, H * 1.05, 10, W * 0.5, H * 1.05, H * 0.75);
    glow.addColorStop(0, `rgba(255, 110, 40, ${0.32 + 0.06 * Math.sin(t * 2.3)})`);
    glow.addColorStop(1, "rgba(255, 110, 40, 0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    // Glass in the dark: shards drifting up past the tower, catching the light.
    for (const s of this.shards) {
      s.y += s.vy * dt * motion * dpr;
      s.x += s.vx * dt * motion * dpr;
      s.a += s.spin * dt * motion;
      if (s.y < -40) Object.assign(s, this._shard());
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.a);
      g.beginPath();
      for (let i = 0; i < s.sides; i += 1) {
        const a = (i / s.sides) * Math.PI * 2;
        const rr = s.r * dpr * (i % 2 ? 0.55 : 1);
        if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 1.6);
        else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 1.6);
      }
      g.closePath();
      g.fillStyle = s.tint ? `rgba(255, 150, 80, ${s.alpha * 0.6})` : `rgba(126, 244, 241, ${s.alpha * 0.45})`;
      g.strokeStyle = s.tint ? `rgba(255, 170, 100, ${s.alpha})` : `rgba(160, 250, 255, ${s.alpha * 1.4})`;
      g.lineWidth = dpr;
      g.fill();
      g.stroke();
      g.restore();
    }

    // The city round its feet: dark blocks, a few windows lit.
    if (!this._skyline) {
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      this._skyline = [];
      for (let x = -20; x < W + 20;) {
        const w = (30 + rand() * 70) * dpr;
        const h = H * (0.08 + rand() * rand() * 0.34);
        this._skyline.push({ x, w, h, lights: Array.from({ length: Math.floor(rand() * 9) }, () => [rand(), rand()]) });
        x += w + rand() * 6 * dpr;
      }
    }
    const street = H * 0.94;
    for (const b of this._skyline) {
      g.fillStyle = "#07090c";
      g.fillRect(b.x, street - b.h, b.w, b.h);
      for (const [u, v] of b.lights) {
        g.fillStyle = v < 0.25 ? "rgba(255, 140, 70, 0.5)" : "rgba(200, 225, 240, 0.28)";
        g.fillRect(b.x + u * (b.w - 6 * dpr), street - b.h + v * b.h * 0.9, 3 * dpr, 2 * dpr);
      }
    }

    // Ascension Tower: centred, tall, lit floor by floor with the progress.
    const towerH = H * 0.72;
    const towerW = Math.min(W * 0.16, towerH * 0.26);
    const x0 = W * 0.5 - towerW / 2;
    const yBase = H * 0.94;
    const yTop = yBase - towerH;
    const floorH = towerH / FLOORS;
    const lit = this.progress * FLOORS;
    // A halo of light behind it, as it lights up.
    const halo = g.createRadialGradient(W * 0.5, yBase - towerH * 0.5, towerW * 0.3, W * 0.5, yBase - towerH * 0.5, towerH * 0.75);
    halo.addColorStop(0, `rgba(236, 230, 218, ${0.04 + 0.08 * this.progress})`);
    halo.addColorStop(1, "rgba(236, 230, 218, 0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    // Body.
    g.fillStyle = "#0a0d11";
    g.fillRect(x0, yTop, towerW, towerH);
    // The spire and the helipad on top.
    g.fillStyle = "#0a0d11";
    g.fillRect(x0 + towerW * 0.46, yTop - towerH * 0.06, towerW * 0.08, towerH * 0.06);
    const beacon = 0.5 + 0.5 * Math.sin(t * 5);
    g.fillStyle = `rgba(255, 60, 40, ${0.4 + 0.6 * beacon})`;
    g.beginPath();
    g.arc(x0 + towerW * 0.5, yTop - towerH * 0.06, 3 * dpr, 0, Math.PI * 2);
    g.fill();
    // Windows: dark until their floor is reached; the floor being loaded flickers.
    const cw = towerW / COLS;
    for (let f = 0; f < FLOORS; f += 1) {
      const y = yBase - (f + 1) * floorH;
      const on = f < Math.floor(lit);
      const loading = f === Math.floor(lit);
      for (let col = 0; col < COLS; col += 1) {
        const n = Math.sin(f * 12.9898 + col * 78.233) * 43758.5453;
        const r = n - Math.floor(n);
        let a = 0.05;
        if (on) a = r < 0.18 ? 0.12 : 0.55 + 0.4 * r;
        else if (loading) a = 0.2 + 0.6 * Math.max(0, Math.sin(t * 18 + col * 2.1)) * r;
        // The floors at the bottom burn.
        const fire = f < 5 && on;
        g.fillStyle = fire ? `rgba(255, ${120 + 60 * r}, 50, ${a})` : `rgba(${200 + 40 * r}, ${235 + 20 * r}, 255, ${a})`;
        g.fillRect(x0 + col * cw + cw * 0.18, y + floorH * 0.22, cw * 0.64, floorH * 0.56);
      }
    }
    // Edges: drawn in bone, like the elevation on an engineer's sheet, bright where it is lit.
    g.strokeStyle = "rgba(236, 230, 218, 0.6)";
    g.lineWidth = 1.5 * dpr;
    g.strokeRect(x0, yTop, towerW, towerH);
    const litY = yBase - lit * floorH;
    g.strokeStyle = "rgba(236, 230, 218, 1)";
    g.shadowColor = "rgba(236, 230, 218, 0.7)";
    g.shadowBlur = 14 * dpr;
    g.beginPath();
    g.moveTo(x0, yBase);
    g.lineTo(x0, litY);
    g.moveTo(x0 + towerW, yBase);
    g.lineTo(x0 + towerW, litY);
    g.stroke();
    // The scan line: up the facade to where it has got, again and again.
    const sweep = (t * 0.6 * motion) % 1;
    const sy = yBase - sweep * (yBase - Math.min(litY, yBase - floorH));
    g.fillStyle = "rgba(255, 59, 31, 0.9)";
    g.fillRect(x0 - 10 * dpr, sy, towerW + 20 * dpr, 1.5 * dpr);
    g.shadowBlur = 0;
    // The street.
    g.fillStyle = "rgba(255, 138, 66, 0.45)";
    g.fillRect(0, yBase, W, 1 * dpr);

    // Scanlines over everything, barely there.
    g.fillStyle = "rgba(0, 0, 0, 0.18)";
    for (let y = 0; y < H; y += 3 * dpr) g.fillRect(0, y, W, dpr);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    clearTimeout(this._hideTimer);
    this.root.remove();
  }
}
