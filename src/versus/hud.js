/**
 * Rooftop Showdown's screens: a HUD per half, what the halves share, and the
 * cards between the fighting (round intro, round result, pause, the winner).
 *
 * Built like the other HUDs (src/ui/meltdown-hud.js): its own DOM and its own
 * stylesheet (versus.css, loaded here), the game's tokens (src/ui/theme.css)
 * - specimen tags in bone and ink, P1 in hazard red, P2 in glass cyan.
 *
 *   each half    who (P1 / P2, the Subject, the device), the rounds won,
 *                integrity, spheres and the sphere in hand, serums, a kill
 *                feed, the prompt that matters now (jump for the ladder, mash
 *                to climb, knock them off), arrows to the helicopter and the
 *                rival when they are off screen, the mouse player's reticle,
 *                and their state (down, over the edge, stunned, frozen)
 *   the seam     a hazard-striped divider; over it the score, the helicopter's
 *                clock (and the time each kill takes off it) and, while
 *                someone is on the ladder, how far up they are
 *
 * The match (match.js) builds a plain state object each frame; `update`
 * writes only what changed.
 */

import { label as padLabel } from "../systems/gamepad.js";
import { BALLS, SERUMS } from "../systems/arsenal.js";

function ensureStylesheet() {
  if (document.querySelector("link[data-versus-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./versus.css", import.meta.url).href;
  link.dataset.versusCss = "true";
  document.head.appendChild(link);
}

const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

/** The glyph for an action on a device ("✕", "A", "G"...). */
export function glyph(device, action, kind = "xbox") {
  const keys = {
    "keys-left": { jump: "G", fire: "F", confirm: "F", back: "Esc", alt: "R", alt2: "T" },
    "keys-right": { jump: "R-Shift", fire: "/", confirm: "/", back: "Esc", alt: "R", alt2: "T" },
  };
  if (keys[device]) return keys[device][action] ?? action;
  const map = { jump: "cross", fire: "r2", confirm: "cross", back: "circle", alt: "triangle", alt2: "square", pause: "options" };
  return padLabel(map[action] ?? action, kind);
}

const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** The match's lines still use the old "A // B" separators: shown as "A · B". */
const tidy = (text) => String(text ?? "").replace(/\s*\/\/\s*/g, " · ");

export class VersusHud {
  constructor({ container = document.body } = {}) {
    ensureStylesheet();
    this.root = el("div", "vs-hud vs-layout-v");
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Rooftop Showdown");
    this.views = [0, 1].map((i) => this._buildView(i));
    for (const v of this.views) this.root.append(v.root);
    this.seam = el("div", "vs-seam");
    this.centre = el("div", "vs-centre", `
      <div class="vs-score"><b class="vs-s1">0</b><span class="vs-round mono-label">ROUND 1</span><b class="vs-s2">0</b></div>
      <div class="vs-heli"><span class="mono-label vs-heli-label">HELICOPTER</span><strong class="vs-heli-time">0:52</strong><span class="vs-shaves"></span></div>
      <div class="vs-climb" hidden><span class="mono-label vs-climb-label">P1 CLIMBING</span><div class="vs-climb-bar"><i></i></div></div>`);
    this.fadeEl = el("div", "vs-fade");
    this.pauseEl = el("div", "vs-card vs-pause");
    this.pauseEl.hidden = true;
    this.winnerEl = el("div", "vs-winner");
    this.winnerEl.hidden = true;
    this.loadingEl = el("div", "vs-loading", `<p class="mono-label">ROOFTOP SHOWDOWN</p><h2>Getting the roof ready</h2><div class="vs-load-bar"><i></i></div><p class="vs-load-note mono-label"></p>`);
    this.loadingEl.hidden = true;
    this.root.append(this.seam, this.centre, this.fadeEl, this.pauseEl, this.winnerEl, this.loadingEl);
    container.append(this.root);
    this._cache = new Map();
    this.layout = "v";
  }

  _buildView(index) {
    const root = el("section", `vs-view vs-p${index + 1}`);
    root.dataset.player = String(index);
    root.innerHTML = `
      <header class="vs-plate tag">
        <b class="vs-chip">P${index + 1}</b>
        <div class="vs-id"><strong class="vs-name"></strong><small class="vs-device mono-label"></small></div>
        <ol class="vs-pips" aria-label="Rounds won"></ol>
      </header>
      <div class="vs-vitals">
        <div class="vs-vitals-top"><span class="mono-label">INTEGRITY</span><strong class="vs-integrity">100</strong></div>
        <div class="vs-bar"><i></i></div>
      </div>
      <div class="vs-ammo">
        <strong class="vs-spheres">0</strong>
        <div class="vs-ammo-side"><span class="mono-label">SPHERES</span><span class="vs-ball"></span></div>
        <div class="vs-serums"></div>
      </div>
      <ol class="vs-feed" aria-live="polite"></ol>
      <div class="vs-flash"><b></b><small></small></div>
      <div class="vs-status"><b></b><small></small></div>
      <div class="vs-prompt"><kbd class="key"></kbd><span></span></div>
      <div class="vs-marker vs-marker-heli"><i class="vs-arrow"></i><b></b><small></small></div>
      <div class="vs-marker vs-marker-rival"><i class="vs-arrow"></i><b></b><small></small></div>
      <div class="vs-reticle"><i></i><b></b></div>
      <div class="vs-intro"><span class="vs-intro-round"></span><span class="vs-intro-word"></span><span class="vs-intro-sub mono-label"></span></div>
      <div class="vs-result"><span class="vs-result-word"></span><span class="vs-result-sub mono-label"></span></div>`;
    const q = (s) => root.querySelector(s);
    return {
      root, index,
      name: q(".vs-name"), device: q(".vs-device"), pips: q(".vs-pips"),
      integrity: q(".vs-integrity"), bar: q(".vs-bar i"), vitals: q(".vs-vitals"),
      spheres: q(".vs-spheres"), ball: q(".vs-ball"), serums: q(".vs-serums"),
      feed: q(".vs-feed"), flash: q(".vs-flash"), status: q(".vs-status"), prompt: q(".vs-prompt"),
      heli: q(".vs-marker-heli"), rival: q(".vs-marker-rival"), reticle: q(".vs-reticle"),
      intro: q(".vs-intro"), result: q(".vs-result"),
      flashUntil: 0, feedKey: "",
    };
  }

  show() { this.root.hidden = false; }

  hide() {
    this.root.hidden = true;
    this.pause(false);
    this.winnerEl.hidden = true;
  }

  /** Write only when it changed. */
  _set(node, key, value, write = (n, v) => (n.textContent = v)) {
    const k = node;
    const prev = this._cache.get(k)?.[key];
    if (prev === value) return;
    if (!this._cache.has(k)) this._cache.set(k, {});
    this._cache.get(k)[key] = value;
    write(node, value);
  }

  setLayout(layout) {
    if (layout === this.layout) return;
    this.layout = layout;
    this.root.classList.remove("vs-layout-v", "vs-layout-h", "vs-layout-single");
    this.root.classList.add(`vs-layout-${layout}`);
  }

  /* ---------------- Cards ---------------- */

  /** The round's card: ROUND n (or MATCH POINT / FINAL ROUND), then FIGHT. */
  intro({ round, wins, scores, final }) {
    const word = final ? "FINAL ROUND" : scores.some((s) => s === wins - 1) && wins > 1 ? "MATCH POINT" : `ROUND ${round}`;
    for (const v of this.views) {
      v.root.classList.remove("vs-show-result");
      v.intro.querySelector(".vs-intro-round").textContent = word;
      v.intro.querySelector(".vs-intro-word").textContent = "FIGHT";
      v.intro.querySelector(".vs-intro-sub").textContent = `First up the ladder · ${scores[0]} - ${scores[1]} · first to ${wins}`;
      v.intro.classList.remove("vs-run");
      void v.intro.offsetWidth; // restart the animation
      v.intro.classList.add("vs-run");
      v.feed.replaceChildren();
      v.feedKey = "";
    }
    this.centre.querySelector(".vs-round").textContent = word;
    this.winnerEl.hidden = true;
  }

  /** The round's result, in each half: won, or left behind. */
  roundEnd({ winner, match }) {
    for (const v of this.views) {
      const won = v.index === winner;
      v.result.querySelector(".vs-result-word").textContent = won ? (match ? "MATCH WON" : "ROUND WON") : "LEFT BEHIND";
      v.result.querySelector(".vs-result-sub").textContent = won ? "UP THE LADDER AND OUT" : `P${winner + 1} TOOK THE SEAT`;
      v.root.classList.toggle("vs-won", won);
      v.root.classList.add("vs-show-result");
    }
  }

  /** A banner across one half (or both): a wave, the helicopter, a knock-off. */
  flash(target, title, sub = "", team = null) {
    const now = performance.now();
    for (const v of this.views) {
      if (target !== "both" && target !== v.index) continue;
      v.flash.querySelector("b").textContent = tidy(title);
      v.flash.querySelector("small").textContent = tidy(sub);
      v.flash.dataset.team = team === null ? "" : String(team);
      v.flash.classList.remove("on");
      void v.flash.offsetWidth;
      v.flash.classList.add("on");
      v.flashUntil = now + 2600;
    }
  }

  /** A kill took time off the helicopter: "-1.3s" in the killer's colour, by the clock. */
  heliPulse(index, seconds) {
    const bubble = el("span", `vs-shave vs-shave-${index + 1}`, `-${seconds.toFixed(1)}s`);
    this.centre.querySelector(".vs-shaves").append(bubble);
    setTimeout(() => bubble.remove(), 1200);
  }

  pause(on, { onResume, onQuit, hints } = {}) {
    this.pauseEl.hidden = !on;
    if (!on) return;
    this.pauseEl.innerHTML = `
      <p class="mono-label">Rooftop showdown</p>
      <h2>Paused</h2>
      <div class="vs-buttons">
        <button type="button" class="vs-button primary" data-act="resume"><kbd class="key">${hints?.resume ?? "Esc"}</kbd>Resume</button>
        <button type="button" class="vs-button" data-act="quit"><kbd class="key">${hints?.quit ?? "Q"}</kbd>Quit to menu</button>
      </div>`;
    this.pauseEl.querySelector("[data-act=resume]").onclick = () => onResume?.();
    this.pauseEl.querySelector("[data-act=quit]").onclick = () => onQuit?.();
  }

  loading(on, ratio = 0, note = "") {
    this.loadingEl.hidden = !on;
    if (!on) return;
    this.loadingEl.querySelector(".vs-load-bar i").style.transform = `scaleX(${Math.max(0.02, Math.min(1, ratio))})`;
    this.loadingEl.querySelector(".vs-load-note").textContent = note;
  }

  /** The end: who won, and how it went for both. */
  winner({ winner, players, rounds }, { onRematch, onLobby, onMenu, hints } = {}) {
    const w = players[winner];
    const rows = [
      ["Rounds won", (s) => s.roundsWon],
      ["Enemies down", (s) => s.kills],
      ["Lured over the edge", (s) => s.lured],
      ["Hits on the rival", (s) => s.rivalHits],
      ["Takedowns", (s) => s.takedowns],
      ["Knocked off / over", (s) => s.knockOffs],
      ["Time on the ladder", (s) => `${s.ladderTime.toFixed(1)}s`],
      ["Went over the edge", (s) => s.overboard],
      ["Spheres fired", (s) => s.shots],
    ];
    const best = (i, f) => {
      const a = players[0].stats;
      const b = players[1].stats;
      const va = parseFloat(f(a));
      const vb = parseFloat(f(b));
      if (va === vb || Number.isNaN(va)) return "";
      return (i === 0 ? va > vb : vb > va) ? " best" : "";
    };
    this.winnerEl.innerHTML = `
      <div class="vs-winner-card vs-team-${winner + 1}">
        <p class="mono-label">Rooftop showdown · ${rounds} round${rounds === 1 ? "" : "s"}</p>
        <h1 class="vs-winner-title"><span>${w.label}</span> WINS</h1>
        <p class="vs-winner-sub">${w.name} took the only seat out of Ascension Tower.</p>
        <table class="vs-stats">
          <thead><tr><th></th>${players.map((p, i) => `<th class="vs-col-${i + 1}"><b>${p.label}</b><small>${p.device}</small></th>`).join("")}</tr></thead>
          <tbody>${rows.map(([name, f]) => `<tr><td>${name}</td>${players.map((p, i) => `<td class="vs-col-${i + 1}${best(i, f)}">${f(p.stats)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
        <div class="vs-buttons">
          <button type="button" class="vs-button primary" data-act="rematch"><kbd class="key">${hints?.rematch ?? "Enter"}</kbd>Rematch</button>
          <button type="button" class="vs-button" data-act="lobby"><kbd class="key">${hints?.lobby ?? "L"}</kbd>Change players</button>
          <button type="button" class="vs-button" data-act="menu"><kbd class="key">${hints?.menu ?? "Esc"}</kbd>Main menu</button>
        </div>
      </div>`;
    this.winnerEl.querySelector("[data-act=rematch]").onclick = () => onRematch?.();
    this.winnerEl.querySelector("[data-act=lobby]").onclick = () => onLobby?.();
    this.winnerEl.querySelector("[data-act=menu]").onclick = () => onMenu?.();
    this.winnerEl.hidden = false;
    for (const v of this.views) v.root.classList.remove("vs-show-result");
  }

  /* ---------------- Every frame ---------------- */

  update(state) {
    this.setLayout(state.layout);
    this.fadeEl.style.opacity = state.fade.toFixed(3);
    const over = state.phase === "over";
    this.root.classList.toggle("vs-over", over);
    this.root.classList.toggle("vs-intro-on", state.phase === "intro");
    const now = performance.now();
    for (const p of state.players) this._updateView(this.views[p.index], p, state, now);

    // The seam: the score, the helicopter's clock, the climb.
    const [a, b] = state.players;
    this._set(this.centre.querySelector(".vs-s1"), "t", String(a.roundsWon));
    this._set(this.centre.querySelector(".vs-s2"), "t", String(b.roundsWon));
    const h = state.heli;
    const heliLabel = h.arrived ? `Waiting · ${h.side < 0 ? "west" : "east"} ledge` : h.inbound ? `Inbound · ${h.side < 0 ? "west" : "east"}` : "Helicopter";
    this._set(this.centre.querySelector(".vs-heli-label"), "t", heliLabel);
    this._set(this.centre.querySelector(".vs-heli-time"), "t", h.arrived ? "NOW" : time(Math.ceil(h.eta)));
    this.centre.classList.toggle("vs-heli-close", h.inbound || h.arrived);
    const climb = this.centre.querySelector(".vs-climb");
    climb.hidden = !state.ladder;
    if (state.ladder) {
      this._set(climb.querySelector(".vs-climb-label"), "t", `P${state.ladder.owner + 1} ${state.ladder.iced ? "FROZEN ON THE LADDER" : "CLIMBING"}`);
      climb.dataset.team = String(state.ladder.owner);
      climb.querySelector(".vs-climb-bar i").style.transform = `scaleX(${state.ladder.progress.toFixed(3)})`;
    }
  }

  _updateView(v, p, state, now) {
    const kind = p.device.kind;
    this._set(v.name, "t", p.name);
    this._set(v.device, "t", p.device.short);
    this._set(v.pips, "n", `${state.wins}:${p.roundsWon}`, (n) => {
      n.innerHTML = Array.from({ length: state.wins }, (_, i) => `<li class="${i < p.roundsWon ? "won" : ""}"></li>`).join("");
    });
    this._set(v.integrity, "t", String(Math.ceil(p.integrity)));
    v.bar.style.transform = `scaleX(${Math.max(0, p.integrity / 100).toFixed(3)})`;
    v.vitals.classList.toggle("low", p.integrity <= 30);
    this._set(v.spheres, "t", String(p.spheres));
    const ball = BALLS[p.ball];
    this._set(v.ball, "t", `${ball.name} · ${p.cost === 0 ? "free" : `${p.cost} each`}`);
    this._set(v.ball, "b", p.ball, (n, val) => (n.dataset.ball = val));
    v.root.classList.toggle("vs-dry", p.spheres < p.cost);
    this._set(v.serums, "s", p.serums.map((s) => `${s.key}:${Math.ceil(s.remaining)}`).join(","), (n) => {
      n.innerHTML = p.serums.map((s) => `<span class="vs-serum" style="--serum:${SERUMS[s.key]?.colour ?? "#fff"}">${s.name} ${Math.ceil(s.remaining)}s</span>`).join("");
    });

    // The feed: the last few lines, newest at the bottom, fading with age.
    const last = p.feed[p.feed.length - 1];
    const key = `${p.feed.length}:${last?.t ?? 0}`;
    if (key !== v.feedKey) {
      v.feedKey = key;
      v.feed.innerHTML = p.feed.slice(-4).map((f) => `<li class="vs-feed-${f.tone}" data-t="${f.t}">${tidy(f.text)}</li>`).join("");
    }
    for (const li of v.feed.children) li.style.opacity = Math.max(0, 1 - (now - Number(li.dataset.t)) / 6000).toFixed(2);

    if (now > v.flashUntil) v.flash.classList.remove("on");

    // Their state, in the middle of their half.
    let status = null;
    if (p.state === "down") status = ["DOWN", `BACK IN ${Math.ceil(Math.max(0, p.respawnIn))}`];
    else if (p.state === "falling" || p.state === "out") status = ["OVER THE EDGE", p.state === "out" ? `BACK IN ${Math.ceil(Math.max(0, p.respawnIn))}` : ""];
    else if (state.phase === "fight" && p.stun > 0.05) status = ["STUNNED", ""];
    else if (state.phase === "fight" && p.frozen > 0.05 && p.state === "alive") status = ["FROZEN", "SLOWED"];
    this._set(v.status, "s", status ? status.join("|") : "", (n) => {
      n.classList.toggle("on", Boolean(status));
      n.querySelector("b").textContent = status?.[0] ?? "";
      n.querySelector("small").textContent = status?.[1] ?? "";
    });

    // The prompt for what matters now.
    const prompt = p.prompt;
    this._set(v.prompt, "p", prompt ? `${prompt.text}|${prompt.action}|${prompt.alert}` : "", (n) => {
      n.classList.toggle("on", Boolean(prompt));
      n.classList.toggle("alert", Boolean(prompt?.alert));
      n.classList.toggle("mash", Boolean(prompt?.mash));
      const k = n.querySelector("kbd");
      k.hidden = !prompt?.action;
      k.classList.toggle("pad", p.deviceId.startsWith("pad:"));
      k.textContent = prompt?.action ? glyph(p.deviceId, prompt.action, kind) : "";
      n.querySelector("span").textContent = tidy(prompt?.text);
    });

    // Markers: the helicopter (or its ladder) and the rival, arrows when off screen.
    const heli = p.markers.find((m) => m.kind === "heli" || m.kind === "ladder");
    this._marker(v.heli, heli, heli?.kind === "ladder" ? "LADDER" : "HELI", true);
    const rival = p.markers.find((m) => m.kind === "rival");
    this._marker(v.rival, rival && !rival.on ? rival : null, rival?.label ?? "", false);

    // The mouse player's reticle (in their half only).
    v.reticle.hidden = !p.reticle || state.phase === "over";
    if (p.reticle) {
      const box = v.root.getBoundingClientRect();
      v.reticle.style.transform = `translate(${(p.reticle.x - box.left).toFixed(1)}px, ${(p.reticle.y - box.top).toFixed(1)}px)`;
      v.reticle.classList.toggle("hot", Boolean(p.hot));
    }
  }

  _marker(node, m, text, showOn) {
    const visible = Boolean(m) && (showOn || !m.on);
    node.classList.toggle("on", visible);
    if (!visible) return;
    node.classList.toggle("vs-edge", !m.on);
    node.style.left = `${(m.x * 100).toFixed(2)}%`;
    node.style.top = `${(m.y * 100).toFixed(2)}%`;
    node.querySelector(".vs-arrow").style.transform = `rotate(${(m.angle).toFixed(3)}rad)`;
    if (m.team !== null && m.team !== undefined) node.dataset.team = String(m.team);
    this._set(node.querySelector("b"), "t", text);
    this._set(node.querySelector("small"), "t", `${m.distance}m`);
  }

  dispose() {
    this.root.remove();
  }
}
