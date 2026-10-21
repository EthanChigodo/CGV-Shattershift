/**
 * How a death looks, before the end screen: a couple of seconds made out of
 * the last frame of the game, different for each place you can die.
 *
 *   burn     the Labs (and any fire): flames climb the screen from the
 *            bottom, the picture shimmering in the heat and charring away
 *            behind them, embers rising - until there is only black
 *   shatter  the Skyline: cracks race out from where it hit, then the
 *            picture breaks like a pane of glass and the shards fall away
 *   crush    the Foundry: the screen shakes as the machine hits, then two
 *            press slabs slam together from top and bottom, sparks at the
 *            seam
 *   mauled   the roof: three claw slashes rake across it, a red pulse, the
 *            picture going dark round the edges like passing out
 *   fall     off a ledge or the bridge: the picture drops away, smaller and
 *            turning, into the dark
 *
 * Those play over a missed quick-time event, live. A run that ends plays
 * `still` instead: the last moment held, as a film's freeze frame. The
 * picture smears for a beat as if time slowed, drains of colour and slowly
 * pushes in while the end screen surfaces over it, and keeps going (it is
 * not wiped to black). `accent` gives it the place's touch: a burn's warm
 * glow and embers, a shatter's hairline cracks, a crush's jolt, claw marks,
 * a fall's drift.
 *
 * The last frame is copied from the game's canvas (drawn just before), so
 * the effect owns the screen while the game itself holds still.
 *
 *   const fx = new DeathFX();
 *   fx.play("shatter", renderer.domElement, () => showEndScreen());
 *   fx.play("still", renderer.domElement, showEndScreen, { accent: "burn" });
 *   fx.clear();   // a restart
 */

const DURATION = { burn: 2.0, shatter: 2.1, crush: 1.7, mauled: 1.9, fall: 1.9, still: 1.25 };
/** How long the held frame keeps drifting before it settles for good (s). */
const STILL_HOLD = 24;

export class DeathFX {
  constructor({ container = document.body, reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "death-fx";
    Object.assign(this.canvas.style, {
      position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "30",
      pointerEvents: "none", display: "none", transition: "opacity 0.45s ease",
    });
    container.append(this.canvas);
    this.frame = document.createElement("canvas");
    this.playing = false;
    this._raf = 0;
    this._timer = 0;
  }

  /** Seconds the effect runs for. */
  duration(kind) {
    return (DURATION[kind] ?? 1.8) * (this.reducedMotion ? 0.7 : 1);
  }

  /**
   * Play `kind` over a copy of `source` (the game's canvas, just drawn), then
   * call `done`. The effect stays on its last (black) frame until clear().
   */
  play(kind, source, done, { live = false, seconds = null, accent = null } = {}) {
    this.clear();
    this.accent = accent;
    // The still sits under the end screen (it IS its picture); the others cover everything.
    this.canvas.style.zIndex = kind === "still" ? "7" : "30";
    // Live: drawn over the game as it goes on moving (a missed quick-time
    // event's own fall or attack), not over a copy of its last frame.
    this.live = live;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.canvas, this.frame]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const f = this.frame.getContext("2d");
    f.fillStyle = "#000";
    f.fillRect(0, 0, this.frame.width, this.frame.height);
    try {
      if (source) f.drawImage(source, 0, 0, this.frame.width, this.frame.height);
    } catch {}
    this.kind = kind;
    this.t = 0;
    this.dpr = dpr;
    this.length = seconds ?? this.duration(kind);
    this.state = this._setup(kind);
    this.playing = true;
    this.canvas.style.opacity = "1";
    this.canvas.style.display = "block";
    let last = performance.now();
    const holds = kind === "still";
    const step = (now) => {
      if (!this.playing) return;
      this.t += Math.min(0.05, (now - last) / 1000);
      last = now;
      this._draw();
      if (this.t < this.length || (holds && this.t < this.length + STILL_HOLD)) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
    // On time even if frames stop (a hidden tab).
    this._timer = setTimeout(() => {
      // The still goes on under the end screen until clear().
      if (holds) { done?.(); return; }
      this.t = this.length;
      this._draw();
      cancelAnimationFrame(this._raf);
      done?.();
      // The end screen is up: let the frozen game show through it again.
      // (Live: the host clears it, on its retry.)
      if (this.live) return;
      this.canvas.style.opacity = "0";
      this._timer = setTimeout(() => this.clear(), 500);
    }, this.length * 1000);
  }

  clear() {
    this.playing = false;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._timer);
    this.canvas.style.display = "none";
  }

  /* ---------------------------------------------------------------- */

  _setup(kind) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const rand = Math.random;
    if (kind === "still") return this._setupStill(W, H, rand);
    if (kind === "shatter") {
      // An impact point a little off centre; cracks out from it, then shards.
      const cx = W * (0.4 + rand() * 0.2);
      const cy = H * (0.38 + rand() * 0.2);
      const rays = 15;
      const cracks = [];
      for (let i = 0; i < rays; i += 1) {
        const a = (i / rays) * Math.PI * 2 + (rand() - 0.5) * 0.3;
        const pts = [[cx, cy]];
        let x = cx;
        let y = cy;
        const len = Math.hypot(W, H);
        for (let s = 0; s < 9; s += 1) {
          const d = (len / 9) * (0.8 + rand() * 0.4);
          const aa = a + (rand() - 0.5) * 0.35;
          x += Math.cos(aa) * d;
          y += Math.sin(aa) * d;
          pts.push([x, y]);
        }
        cracks.push({ a, pts });
      }
      // Rings between the rays: the shards are the cells of rays x rings.
      const rings = [0, 0.07, 0.17, 0.32, 0.55, 1.2].map((r) => r * Math.hypot(W, H));
      const shards = [];
      for (let i = 0; i < rays; i += 1) {
        const a0 = cracks[i].a;
        const a1 = cracks[(i + 1) % rays].a + (i === rays - 1 ? Math.PI * 2 : 0);
        for (let k = 0; k < rings.length - 1; k += 1) {
          const r0 = rings[k] * (0.9 + rand() * 0.2);
          const r1 = rings[k + 1] * (0.9 + rand() * 0.2);
          const poly = [
            [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0],
            [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0],
            [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1],
            [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1],
          ];
          const mx = poly.reduce((s, p) => s + p[0], 0) / 4;
          const my = poly.reduce((s, p) => s + p[1], 0) / 4;
          const out = Math.atan2(my - cy, mx - cx);
          shards.push({
            poly, mx, my,
            delay: 0.55 + (k / rings.length) * 0.35 + rand() * 0.2,
            vx: Math.cos(out) * (60 + rand() * 260) * this.dpr,
            vy: (Math.sin(out) * 120 - 80 - rand() * 160) * this.dpr,
            spin: (rand() - 0.5) * 5,
          });
        }
      }
      return { cx, cy, cracks, shards };
    }
    if (kind === "burn") {
      const embers = Array.from({ length: 90 }, () => ({ x: rand() * W, y: H + rand() * H * 0.4, v: (60 + rand() * 220) * this.dpr, r: (1 + rand() * 2.6) * this.dpr, w: rand() * 6 }));
      return { embers, seed: rand() * 100 };
    }
    if (kind === "crush") {
      const sparks = Array.from({ length: 120 }, () => ({ x: rand() * W, vx: (rand() - 0.5) * 900 * this.dpr, vy: (rand() - 0.5) * 700 * this.dpr, life: 0.3 + rand() * 0.5 }));
      return { sparks };
    }
    if (kind === "mauled") {
      // One rake: three claws side by side, across the middle.
      const x = W * (0.42 + rand() * 0.16);
      return { slash: [0, 1, 2].map((i) => ({ x: x + (i - 1) * W * 0.055 + (rand() - 0.5) * W * 0.01, tilt: 0.42 + rand() * 0.06, bend: (rand() - 0.5) * 0.08 })) };
    }
    return {};
  }

  _draw() {
    const g = this.canvas.getContext("2d");
    const W = this.canvas.width;
    const H = this.canvas.height;
    const t = this.t;
    const k = Math.min(1, t / this.length);
    const s = this.state;
    const ease = (x) => x * x * (3 - 2 * x);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    if (this.kind === "still") { this._drawStill(g, W, H, t, s); return; }

    if (this.kind === "shatter") {
      g.fillStyle = "#000";
      g.fillRect(0, 0, W, H);
      const crackK = Math.min(1, t / 0.45);
      // Still whole until the shards go: the picture with its cracks.
      for (const sh of s.shards) {
        const tt = Math.max(0, t - sh.delay);
        g.save();
        const x = sh.vx * tt;
        const y = sh.vy * tt + 0.5 * 2600 * this.dpr * tt * tt;
        g.translate(sh.mx + x, sh.my + y);
        g.rotate(sh.spin * tt);
        g.translate(-sh.mx, -sh.my);
        g.beginPath();
        sh.poly.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.closePath();
        g.clip();
        g.globalAlpha = Math.max(0, 1 - tt * 0.9);
        g.drawImage(this.frame, 0, 0);
        // The edge of each piece catches the light.
        g.globalAlpha = Math.min(1, tt * 4) * Math.max(0, 1 - tt);
        g.strokeStyle = "rgba(200, 250, 255, 0.9)";
        g.lineWidth = 2 * this.dpr;
        g.stroke();
        g.restore();
      }
      // The cracks racing out (before the pieces part).
      if (t < 0.9) {
        g.strokeStyle = `rgba(235, 252, 255, ${0.9 * (1 - Math.max(0, t - 0.6) / 0.3)})`;
        g.lineWidth = 1.6 * this.dpr;
        g.shadowColor = "rgba(126, 244, 241, 0.9)";
        g.shadowBlur = 8 * this.dpr;
        for (const c of s.cracks) {
          const n = Math.max(1, Math.floor(crackK * (c.pts.length - 1)));
          g.beginPath();
          g.moveTo(c.pts[0][0], c.pts[0][1]);
          for (let i = 1; i <= n; i += 1) g.lineTo(c.pts[i][0], c.pts[i][1]);
          g.stroke();
        }
        g.shadowBlur = 0;
      }
      // The flash of the hit.
      if (t < 0.25) {
        g.fillStyle = `rgba(255, 255, 255, ${0.55 * (1 - t / 0.25)})`;
        g.fillRect(0, 0, W, H);
      }
      return;
    }

    if (this.kind === "burn") {
      // The heat: the picture wobbles in strips, more as the fire comes.
      const heat = ease(Math.min(1, t / 1.2));
      const strip = 6 * this.dpr;
      for (let y = 0; y < H; y += strip) {
        const off = Math.sin(y * 0.03 + t * 14 + s.seed) * 6 * this.dpr * heat;
        g.drawImage(this.frame, 0, y, W, strip, off, y, W, strip);
      }
      // Orange over it all.
      g.fillStyle = `rgba(255, 90, 20, ${0.28 * heat})`;
      g.fillRect(0, 0, W, H);
      // The flame front climbing. Behind it the picture chars (darkened,
      // reddened), on it the fire: soft glowing tongues, layered and added.
      const front = H * (1.08 - ease(Math.min(1, t / (this.length * 0.9))) * 1.3);
      const flame = (x, amp, speed) => front
        - Math.abs(Math.sin(x * 0.009 + t * 5.3 * speed + s.seed)) * amp
        - Math.abs(Math.sin(x * 0.023 - t * 8.1 * speed)) * amp * 0.55
        - Math.abs(Math.sin(x * 0.051 + t * 13 * speed + s.seed * 2)) * amp * 0.3;
      const path = (amp, speed, lift) => {
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W; x += 10 * this.dpr) g.lineTo(x, flame(x, amp * this.dpr, speed) + lift * this.dpr);
        g.lineTo(W, H);
        g.closePath();
      };
      // Char: the scene burnt dark under the fire.
      path(40, 0.6, 90);
      g.fillStyle = "rgba(24, 6, 2, 0.88)";
      g.fill();
      g.globalCompositeOperation = "lighter";
      g.shadowColor = "rgba(255, 120, 30, 1)";
      g.shadowBlur = 40 * this.dpr;
      for (const [amp, speed, lift, top, bottom] of [
        [150, 0.8, 70, "rgba(255, 70, 10, 0)", "rgba(255, 70, 10, 0.55)"],
        [115, 1.15, 40, "rgba(255, 140, 30, 0)", "rgba(255, 140, 30, 0.6)"],
        [80, 1.5, 20, "rgba(255, 220, 120, 0)", "rgba(255, 220, 120, 0.55)"],
      ]) {
        path(amp, speed, lift);
        const grad = g.createLinearGradient(0, front - amp * this.dpr * 1.8, 0, front + 160 * this.dpr);
        grad.addColorStop(0, top);
        grad.addColorStop(0.55, bottom);
        grad.addColorStop(1, "rgba(120, 20, 0, 0.2)");
        g.fillStyle = grad;
        g.fill();
      }
      g.shadowBlur = 0;
      g.globalCompositeOperation = "source-over";
      // Deeper in, it is gone: black from well below the flames.
      const gone = g.createLinearGradient(0, front + 140 * this.dpr, 0, front + 420 * this.dpr);
      gone.addColorStop(0, "rgba(0, 0, 0, 0)");
      gone.addColorStop(1, "rgba(0, 0, 0, 1)");
      g.fillStyle = gone;
      g.fillRect(0, front + 140 * this.dpr, W, H);
      // Embers going up.
      g.globalCompositeOperation = "lighter";
      for (const e of s.embers) {
        const y = e.y - e.v * t;
        const x = e.x + Math.sin(t * 3 + e.w) * 18 * this.dpr;
        g.fillStyle = `rgba(255, ${140 + Math.floor(e.w * 15)}, 60, ${0.85 * (1 - k * 0.5)})`;
        g.beginPath();
        g.arc(x, y, e.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      if (k > 0.85) {
        g.fillStyle = `rgba(0, 0, 0, ${(k - 0.85) / 0.15})`;
        g.fillRect(0, 0, W, H);
      }
      return;
    }

    if (this.kind === "crush") {
      // The machine hits: a hard shake that dies down, a red flash.
      const shake = Math.max(0, 1 - t / 0.7) * 26 * this.dpr * (this.reducedMotion ? 0.3 : 1);
      g.fillStyle = "#000";
      g.fillRect(0, 0, W, H);
      g.drawImage(this.frame, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      g.fillStyle = `rgba(255, 30, 10, ${0.45 * Math.max(0, 1 - t / 0.4)})`;
      g.fillRect(0, 0, W, H);
      // The press: slabs from top and bottom, slamming together.
      const close = ease(Math.min(1, Math.max(0, (t - 0.35) / 0.55)));
      const gap = (H / 2) * (1 - close);
      for (const [y0, dir] of [[0, 1], [H, -1]]) {
        const edge = y0 + dir * (H / 2 - gap);
        const metal = g.createLinearGradient(0, y0, 0, edge);
        metal.addColorStop(0, "#0c0d0f");
        metal.addColorStop(1, "#2b2f33");
        g.fillStyle = metal;
        g.fillRect(0, Math.min(y0, edge), W, Math.abs(edge - y0));
        // Rivets along the slab.
        g.fillStyle = "rgba(150, 160, 170, 0.5)";
        for (let x = 30 * this.dpr; x < W; x += 90 * this.dpr) g.fillRect(x, edge - dir * 46 * this.dpr, 5 * this.dpr, 5 * this.dpr);
        // Hazard stripes along the slab's edge.
        g.save();
        g.beginPath();
        g.rect(0, dir > 0 ? edge - 26 * this.dpr : edge, W, 26 * this.dpr);
        g.clip();
        for (let x = -W; x < W * 2; x += 48 * this.dpr) {
          g.fillStyle = "#e6a21a";
          g.beginPath();
          g.moveTo(x, edge);
          g.lineTo(x + 24 * this.dpr, edge);
          g.lineTo(x + 24 * this.dpr + 26 * this.dpr * dir, edge - 26 * this.dpr * dir);
          g.lineTo(x + 26 * this.dpr * dir, edge - 26 * this.dpr * dir);
          g.fill();
        }
        g.restore();
      }
      // Sparks squeezed out of the seam as it shuts.
      if (close > 0.85) {
        const st = t - (0.35 + 0.55 * 0.85);
        g.globalCompositeOperation = "lighter";
        for (const sp of s.sparks) {
          if (st > sp.life) continue;
          const x = sp.x + sp.vx * st;
          const y = H / 2 + sp.vy * st + 900 * this.dpr * st * st;
          g.fillStyle = `rgba(255, ${170 + Math.floor(Math.random() * 80)}, 80, ${1 - st / sp.life})`;
          g.fillRect(x, y, 3 * this.dpr, 3 * this.dpr);
        }
        g.globalCompositeOperation = "source-over";
      }
      return;
    }

    if (this.kind === "mauled") {
      if (this.live) g.clearRect(0, 0, W, H);
      else g.drawImage(this.frame, 0, 0);
      // Three rakes across, one after another.
      for (const [i, sl] of s.slash.entries()) {
        const st = Math.min(1, Math.max(0, (t - i * 0.09) / 0.18));
        if (st <= 0) continue;
        // A tapered, slightly curved gash: thin at both ends, widest a third in.
        const x0 = sl.x + H * sl.tilt * 0.5;
        const y0 = H * 0.1;
        const x1 = sl.x - H * sl.tilt * 0.5;
        const y1 = H * 0.9;
        const n = 28;
        const pts = [];
        for (let j = 0; j <= n * st; j += 1) {
          const u = j / n;
          const bow = Math.sin(u * Math.PI) * sl.bend * W;
          const width = Math.sin(Math.min(1, u * 1.4) * Math.PI) * 13 * this.dpr + 1;
          pts.push([x0 + (x1 - x0) * u + bow, y0 + (y1 - y0) * u, width]);
        }
        if (pts.length < 2) continue;
        const gash = (scale, colour) => {
          g.beginPath();
          pts.forEach(([px, py, w], j) => (j ? g.lineTo(px - w * scale, py) : g.moveTo(px - w * scale, py)));
          for (let j = pts.length - 1; j >= 0; j -= 1) g.lineTo(pts[j][0] + pts[j][2] * scale, pts[j][1]);
          g.closePath();
          g.fillStyle = colour;
          g.fill();
        };
        gash(1.25, "rgba(70, 0, 0, 0.9)");
        gash(0.8, "rgba(185, 10, 10, 0.95)");
        gash(0.25, "rgba(255, 120, 100, 0.9)");
      }
      // A red pulse, then the edges closing in - passing out.
      const pulse = Math.max(0, Math.sin(t * 7)) * Math.max(0, 1 - t / 1.2);
      g.fillStyle = `rgba(150, 0, 0, ${0.25 + 0.3 * pulse})`;
      g.fillRect(0, 0, W, H);
      const dark = ease(Math.min(1, Math.max(0, (t - 0.5) / (this.length - 0.6))));
      const vg = g.createRadialGradient(W / 2, H / 2, Math.max(1, (1 - dark) * Math.hypot(W, H) * 0.45), W / 2, H / 2, Math.hypot(W, H) * 0.6);
      vg.addColorStop(0, "rgba(0, 0, 0, 0)");
      vg.addColorStop(1, "rgba(0, 0, 0, 1)");
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
      if (dark > 0.9) {
        g.fillStyle = `rgba(0, 0, 0, ${(dark - 0.9) / 0.1})`;
        g.fillRect(0, 0, W, H);
      }
      return;
    }

    // fall: the picture drops away into the dark, turning (live: the game
    // shows the fall itself; the edges close in, darkening, as you drop).
    const d = ease(k);
    if (this.live) {
      g.clearRect(0, 0, W, H);
      const vg = g.createRadialGradient(W / 2, H / 2, Math.max(1, (1 - d * 0.85) * Math.hypot(W, H) * 0.42), W / 2, H / 2, Math.hypot(W, H) * 0.62);
      vg.addColorStop(0, "rgba(0, 0, 0, 0)");
      vg.addColorStop(1, "rgba(0, 0, 0, 1)");
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = `rgba(0, 0, 0, ${Math.max(0, (k - 0.72) / 0.28)})`;
      g.fillRect(0, 0, W, H);
    } else {
      g.fillStyle = "#000";
      g.fillRect(0, 0, W, H);
      g.save();
      g.translate(W / 2, H / 2 + d * H * 0.35);
      g.rotate(d * 0.5);
      g.scale(1 - d * 0.8, 1 - d * 0.8);
      g.globalAlpha = 1 - d * 0.9;
      g.drawImage(this.frame, -W / 2, -H / 2);
      g.restore();
    }
    // Wind streaks past.
    g.strokeStyle = "rgba(220, 235, 255, 0.25)";
    g.lineWidth = 1.5 * this.dpr;
    for (let i = 0; i < 26; i += 1) {
      const x = ((i * 397) % 1000) / 1000 * W;
      const y = ((i * 613 + t * 2400 * this.dpr) % (H * 1.4)) - H * 0.2;
      g.beginPath();
      g.moveTo(x, H - y);
      g.lineTo(x, H - y - 140 * this.dpr);
      g.stroke();
    }
  }

  /* ---- The still -------------------------------------------------- */

  _setupStill(W, H, rand) {
    const accent = this.accent;
    // The frame as it will end up: colour mostly drained, darker, a little
    // more contrast; warm for fire, cold for glass, neutral otherwise.
    const graded = document.createElement("canvas");
    graded.width = W;
    graded.height = H;
    const c = graded.getContext("2d");
    const tone = { burn: "sepia(0.35) ", shatter: "hue-rotate(-12deg) " }[accent] ?? "";
    if ("filter" in c) {
      c.filter = `${tone}grayscale(0.82) contrast(1.14) brightness(0.62)`;
      c.drawImage(this.frame, 0, 0);
      c.filter = "none";
    } else {
      c.drawImage(this.frame, 0, 0);
      try {
        const img = c.getImageData(0, 0, W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          for (let j = 0; j < 3; j += 1) d[i + j] = Math.max(0, Math.min(255, ((d[i + j] * 0.18 + y * 0.82) - 128) * 1.14 * 0.62 + 128 * 0.62));
        }
        c.putImageData(img, 0, 0);
      } catch {}
    }
    // Film grain, drawn small and tiled.
    const grain = document.createElement("canvas");
    grain.width = grain.height = 160;
    const gc = grain.getContext("2d");
    const gd = gc.createImageData(160, 160);
    for (let i = 0; i < gd.data.length; i += 4) {
      const v = rand() * 255;
      gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = v;
      gd.data[i + 3] = 255;
    }
    gc.putImageData(gd, 0, 0);
    // Where it happened: the push-in heads there.
    const cx = W * (0.44 + rand() * 0.12);
    const cy = H * (0.42 + rand() * 0.12);
    const out = { graded, grain, cx, cy, shake: [] };
    if (accent === "shatter") {
      // A small star of cracks round the hit, not across the whole frame.
      out.cracks = Array.from({ length: 13 }, (_, i) => {
        const a = (i / 13) * Math.PI * 2 + (rand() - 0.5) * 0.4;
        const pts = [[cx, cy]];
        let x = cx;
        let y = cy;
        const steps = 3 + Math.floor(rand() * 5);
        for (let k = 0; k < steps; k += 1) {
          const d = Math.hypot(W, H) * (0.012 + rand() * 0.03);
          const aa = a + (rand() - 0.5) * 0.5;
          x += Math.cos(aa) * d;
          y += Math.sin(aa) * d;
          pts.push([x, y]);
        }
        return pts;
      });
    }
    if (accent === "burn") {
      out.embers = Array.from({ length: 46 }, () => ({ x: rand() * W, y: H * (0.6 + rand() * 0.5), v: (14 + rand() * 40) * this.dpr, r: (0.8 + rand() * 1.8) * this.dpr, w: rand() * 6 }));
    }
    if (accent === "mauled") {
      const x = W * (0.42 + rand() * 0.16);
      out.slash = [0, 1, 2].map((i) => ({ x: x + (i - 1) * W * 0.05, tilt: 0.42 + rand() * 0.06 }));
    }
    return out;
  }

  _drawStill(g, W, H, t, s) {
    const calm = this.reducedMotion;
    const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const accent = this.accent;
    // The slow push toward where it happened, over the whole hold.
    const push = calm ? 0 : 0.075 * (1 - Math.exp(-t / 7));
    let ox = 0;
    let oy = 0;
    let rot = 0;
    if (!calm && accent === "crush" && t < 0.55) {
      const a = (1 - t / 0.55) * 18 * this.dpr;
      ox = Math.sin(t * 90) * a;
      oy = Math.cos(t * 73) * a;
    }
    if (!calm && accent === "fall") {
      oy = (1 - Math.exp(-t / 3)) * H * 0.035;
      rot = (1 - Math.exp(-t / 3)) * 0.018;
    }
    const place = (scale) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.translate(s.cx + ox, s.cy + oy);
      g.rotate(rot);
      g.scale(scale, scale);
      g.translate(-s.cx, -s.cy);
    };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    // Colour, then the drained frame over it.
    const drain = smooth(0.12, 1.5, t);
    place(1 + push);
    g.drawImage(this.frame, 0, 0);
    g.globalAlpha = drain;
    g.drawImage(s.graded, 0, 0);
    // Time slowing: ghosts of the frame a little ahead, fading as it stops.
    if (!calm) {
      const smear = 1 - smooth(0, 1.2, t);
      for (let i = 1; i <= 3 && smear > 0.01; i += 1) {
        place(1 + push + i * 0.011 * smear);
        g.globalAlpha = 0.16 * smear;
        g.drawImage(drain > 0.5 ? s.graded : this.frame, 0, 0);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    // The place's touch.
    if (s.cracks) {
      const k = smooth(0.02, 0.4, t);
      g.strokeStyle = "rgba(235, 248, 255, 0.5)";
      g.lineWidth = 0.8 * this.dpr;
      for (const pts of s.cracks) {
        const n = Math.max(1, Math.round((pts.length - 1) * k));
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i <= n; i += 1) g.lineTo(pts[i][0], pts[i][1]);
        g.stroke();
      }
    }
    if (s.embers) {
      g.globalCompositeOperation = "lighter";
      for (const e of s.embers) {
        const y = e.y - e.v * t;
        const x = e.x + Math.sin(t * 1.3 + e.w) * 10 * this.dpr;
        g.fillStyle = `rgba(255, ${140 + Math.round(e.w * 12)}, 70, ${0.55 * (1 - smooth(0, H, e.y - y))})`;
        g.beginPath();
        g.arc(x, y, e.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      const warm = g.createLinearGradient(0, H, 0, H * 0.45);
      warm.addColorStop(0, "rgba(255, 110, 40, 0.22)");
      warm.addColorStop(1, "rgba(255, 110, 40, 0)");
      g.fillStyle = warm;
      g.fillRect(0, 0, W, H);
    }
    if (s.slash) {
      const k = smooth(0, 0.22, t);
      g.strokeStyle = "rgba(120, 8, 8, 0.55)";
      g.lineCap = "round";
      g.lineWidth = 5 * this.dpr;
      for (const c of s.slash) {
        g.beginPath();
        g.moveTo(c.x - H * c.tilt * 0.5, H * 0.18);
        g.lineTo(c.x - H * c.tilt * 0.5 + (H * c.tilt) * k, H * 0.18 + H * 0.64 * k);
        g.stroke();
      }
    }
    // The hit: a flash, white (fire: amber; claws: red).
    const flash = Math.max(0, 1 - t / 0.28);
    if (flash > 0) {
      const c = { burn: "255, 170, 90", mauled: "200, 30, 20" }[accent] ?? "255, 255, 255";
      g.fillStyle = `rgba(${c}, ${0.5 * flash * flash})`;
      g.fillRect(0, 0, W, H);
    }
    // Grain, and the edges closing in.
    g.globalAlpha = 0.07;
    g.globalCompositeOperation = "overlay";
    const ptn = g.createPattern(s.grain, "repeat");
    if (ptn) {
      g.save();
      g.translate((Math.random() * 160) | 0, (Math.random() * 160) | 0);
      g.fillStyle = ptn;
      g.fillRect(-160, -160, W + 320, H + 320);
      g.restore();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, "rgba(0, 0, 0, 0)");
    v.addColorStop(1, `rgba(0, 0, 0, ${0.45 + 0.3 * drain})`);
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    if (accent === "mauled") {
      const r = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      r.addColorStop(0, "rgba(120, 0, 0, 0)");
      r.addColorStop(1, `rgba(120, 0, 0, ${0.35 * (1 - smooth(0.3, 2.5, t) * 0.5)})`);
      g.fillStyle = r;
      g.fillRect(0, 0, W, H);
    }
    // Film bars close in a little: the frame is held.
    const bar = smooth(0.2, 1.4, t) * H * 0.055;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, bar);
    g.fillRect(0, H - bar, W, bar);
  }
}
