/**
 * The Leaderboards screen (index.html #leaderboardsScreen): the boards down
 * the left in the main menu's own style (one lit, an ember line beside it),
 * the chosen one's top 50 from the server on the right - your own row lit,
 * and your place on it if you're further down. Your name at the top, with
 * Change.
 *
 *   const view = new LeaderboardView(screen, { leaderboard, onChangeName });
 *   view.open();                 // when the screen shows
 *   view.open("endless_roof");   // on a given board
 */

import { BOARDS, BOARD, formatValue } from "../systems/leaderboard.js";
import { DIFFICULTIES } from "../systems/difficulty.js";

export function ensureStyles() {
  if (document.querySelector("link[data-leaderboard]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./leaderboard.css", import.meta.url).href;
  link.dataset.leaderboard = "true";
  document.head.appendChild(link);
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Your name as a card - your initials in a disc, PLAYING AS, the name, and
 * CHANGE NAME (CHOOSE A NAME with none yet): the Leaderboards' and
 * Customise's (modes/locker). Its container is `.lb-me`, `.unnamed` with no
 * name; the button is `.lb-rename`.
 */
export function nameCardHTML(name) {
  // (Two words: their first letters; one: its first two.)
  const words = name ? name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean) : [];
  const initials = !name ? "?" : (words.length > 1 ? words[0][0] + words[1][0] : words[0] ?? name).slice(0, 2).toUpperCase();
  const pencil = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.3 2.3l2.4 2.4-8.4 8.4-3.1.7.7-3.1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  return `
      <i class="lb-avatar" aria-hidden="true">${escape(initials)}</i>
      <span class="lb-who"><small>Playing as</small><b>${name ? escape(name) : "No name yet"}</b></span>
      <button type="button" class="lb-rename">${pencil}${name ? "Change<span class=\"lb-word\"> name</span>" : "Choose<span class=\"lb-word\"> a name</span>"}</button>`;
}

/** Each board's mark in the list (as the main menu's glyphs). */
const GLYPHS = { time: "&#9201;", points: "&#9733;", m: "&#8734;", count: "&#9650;" };

export class LeaderboardView {
  constructor(root, { leaderboard, onChangeName }) {
    ensureStyles();
    this.root = root;
    this.lb = leaderboard;
    this.onChangeName = onChangeName;
    this.board = BOARDS[0].key;
    this.nav = root.querySelector(".lb-boards");
    this.body = root.querySelector(".lb-body");
    this.me = root.querySelector(".lb-me");
    this.nav.innerHTML = BOARDS.map((b) => `
      <button type="button" class="menu-button" data-board="${b.key}">
        <i class="menu-glyph" aria-hidden="true">${GLYPHS[b.unit]}</i><span><b>${b.label}</b></span>
      </button>`).join("");
    for (const b of this.nav.querySelectorAll("[data-board]")) {
      // Moving over a board (mouse or controller) shows it; no click needed.
      const pick = () => this._pick(b.dataset.board);
      b.addEventListener("click", pick);
      b.addEventListener("focus", pick);
    }
  }

  open(board = this.board) {
    this._me();
    this._pick(board, true);
  }

  /** Who you are on the boards: the name card (nameCardHTML). */
  _me() {
    const name = this.lb.name;
    this.me.classList.toggle("unnamed", !name);
    this.me.innerHTML = nameCardHTML(name);
    this.me.querySelector(".lb-rename").addEventListener("click", () => this.onChangeName?.(() => { this._me(); this._load(); }));
  }

  _pick(board, force = false) {
    if (board === this.board && !force) return;
    this.board = board;
    for (const b of this.nav.querySelectorAll("[data-board]")) b.setAttribute("aria-current", String(b.dataset.board === board));
    this._load();
  }

  async _load() {
    const board = this.board;
    const def = BOARD[board];
    const head = (count) => `
      <header class="lb-title">
        <p class="eyebrow">${count}</p>
        <h3>${def.label}</h3>
        <p class="lb-note">${def.note}</p>
      </header>`;
    this.body.innerHTML = `${head("GLOBAL")}<p class="lb-empty">Loading...</p>`;
    // (Anything waiting to go up goes first, so your newest best is on it.)
    await this.lb.flush();
    const r = await this.lb.top(board);
    if (this.board !== board) return;
    if (!r.ok) {
      this.body.innerHTML = `${head("OFFLINE")}<p class="lb-empty">${escape(r.message ?? "The leaderboard can't be reached.")} Your bests are kept here and go up when it answers.</p>`;
      return;
    }
    const me = this.lb.name?.toLowerCase();
    const metaOf = (e) => {
      const d = e.meta?.difficulty;
      return d && d !== "normal" ? DIFFICULTIES[d]?.name ?? d : "";
    };
    const rows = r.entries.map((e) => `
      <li class="lb-row${e.name.toLowerCase() === me ? " you" : ""}${e.rank <= 3 ? ` top-${e.rank}` : ""}">
        <span class="lb-rank">${e.rank}</span>
        <span class="lb-name">${escape(e.name)}</span>
        <span class="lb-meta">${metaOf(e)}</span>
        <span class="lb-val">${formatValue(board, e.value)}</span>
      </li>`).join("");
    const you = r.you;
    const listed = you?.rank && r.entries.some((e) => e.rank === you.rank);
    const how = board === "story_time" || board === "story_score" ? "Finish a whole story run" : board === "trophies" ? "Earn a trophy" : "Play this Endless";
    const youLine = !you
      ? `<p class="lb-you">Choose a name to get on the boards.</p>`
      : you.value === null
        ? `<p class="lb-you">You're not on this board yet. ${how} to get on it.</p>`
        : !listed ? `<p class="lb-you">You: <b>#${you.rank}</b> of ${r.total} · ${formatValue(board, you.value)}</p>` : "";
    this.body.innerHTML = `
      ${head(`GLOBAL · ${r.total} ${r.total === 1 ? "PLAYER" : "PLAYERS"}`)}
      ${r.entries.length ? `<ol class="lb-list">${rows}</ol>` : `<p class="lb-empty">Nobody yet. Be the first.</p>`}
      ${youLine}`;
  }
}
