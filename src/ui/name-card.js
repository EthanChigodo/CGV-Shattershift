/**
 * Your name for the global leaderboards (systems/leaderboard.js): asked once,
 * the first time the game opens, and changed from Customise. As you type it
 * asks the server whether the name is free (names are unique there).
 *
 *   const card = new NameCard({ leaderboard });
 *   card.show({ mode: "new", done });      // onboarding: Continue, or Skip for now
 *   card.show({ mode: "change", done });   // Customise: Save, or Cancel
 *   card.open
 */

function ensureStyles() {
  if (document.querySelector("link[data-name-card]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./name-card.css", import.meta.url).href;
  link.dataset.nameCard = "true";
  document.head.appendChild(link);
}

export class NameCard {
  constructor({ leaderboard }) {
    ensureStyles();
    this.lb = leaderboard;
    this.root = document.createElement("div");
    this.root.className = "name-card";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.innerHTML = `
      <form class="nc-box" novalidate>
        <p class="nc-eyebrow"><i class="nc-dot"></i><span>Global leaderboards</span></p>
        <h2 class="nc-title"></h2>
        <p class="nc-text"></p>
        <label class="nc-field">
          <input class="nc-input" type="text" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your name" placeholder="Your name">
          <small class="nc-rule">3 to 16 letters or numbers (spaces and _ . - too)</small>
        </label>
        <p class="nc-status" aria-live="polite"></p>
        <div class="nc-foot">
          <button type="submit" class="nc-button"><span></span><i>&#9654;</i></button>
          <button type="button" class="nc-skip"></button>
        </div>
      </form>`;
    document.body.appendChild(this.root);
    this.form = this.root.querySelector("form");
    this.input = this.root.querySelector(".nc-input");
    this.status = this.root.querySelector(".nc-status");
    this.button = this.root.querySelector(".nc-button");
    this.skipButton = this.root.querySelector(".nc-skip");
    this.open = false;
    // Typing is for the box only: the game's keys (and the menus') don't see it.
    for (const type of ["keydown", "keyup"]) {
      this.root.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "keydown" && e.key === "Escape") { e.preventDefault(); this._skip(); }
      });
    }
    this.input.addEventListener("input", () => this._typed());
    this.form.addEventListener("submit", (e) => { e.preventDefault(); this._save(); });
    this.skipButton.addEventListener("click", () => this._skip());
  }

  show({ mode = "new", done = null } = {}) {
    this.mode = mode;
    this.done = done;
    const now = this.lb.name;
    this.root.querySelector(".nc-title").textContent = mode === "new" ? "Who are you?" : "Change your name";
    this.root.querySelector(".nc-text").textContent = mode === "new"
      ? "Your name goes on the global leaderboards - the fastest escape, the highest scores, the furthest Endless runs. Nobody else can have it. You can change it any time in Customise."
      : `Now: ${now ?? "no name yet"}. Nobody else can have the new one either; your scores keep their places.`;
    this.button.querySelector("span").textContent = mode === "new" ? "Continue" : "Save";
    this.skipButton.textContent = mode === "new" ? "Skip for now" : "Cancel";
    this.input.value = mode === "change" ? (now ?? "") : "";
    this._setStatus("", "");
    this.root.classList.remove("show");
    void this.root.offsetWidth;
    this.root.classList.add("show");
    this.root.hidden = false;
    this.open = true;
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  _setStatus(text, kind) {
    this.status.textContent = text;
    this.status.dataset.kind = kind;
  }

  /** The rules the server keeps, checked here first (no call for what can't pass). */
  _local(name) {
    const n = name.trim().replace(/\s+/g, " ");
    if (n.length < 3) return "At least 3 characters.";
    if (n.length > 16) return "At most 16 characters.";
    if (!/^[A-Za-z0-9 _.\-]+$/.test(n)) return "Letters, numbers, spaces and _ . - only.";
    if (!/[A-Za-z0-9]/.test(n)) return "Needs a letter or a number.";
    return null;
  }

  _typed() {
    clearTimeout(this._timer);
    const name = this.input.value;
    if (!name.trim()) { this._setStatus("", ""); return; }
    const bad = this._local(name);
    if (bad) { this._setStatus(bad, "bad"); return; }
    if (this.mode === "change" && name.trim().toLowerCase() === (this.lb.name ?? "").toLowerCase()) { this._setStatus("That's your name now.", ""); return; }
    this._setStatus("Checking...", "wait");
    const asked = name;
    this._timer = setTimeout(async () => {
      const r = await this.lb.check(asked);
      if (this.input.value !== asked || !this.open) return;
      if (r.available === null) this._setStatus("Offline - it will be checked when the leaderboard answers.", "wait");
      else this._setStatus(r.available ? "Free - it's yours if you want it." : r.message, r.available ? "good" : "bad");
    }, 320);
  }

  async _save() {
    const name = this.input.value;
    const bad = this._local(name);
    if (bad) { this._setStatus(bad, "bad"); this.input.focus(); return; }
    if (this.mode === "change" && name.trim() === this.lb.name) { this._close(); return; }
    this.button.disabled = true;
    this._setStatus(this.mode === "new" ? "Taking it..." : "Changing it...", "wait");
    const r = await this.lb.claim(name);
    this.button.disabled = false;
    if (!r.ok) {
      this._setStatus(r.message ?? "That didn't work - try again.", "bad");
      this.input.focus();
      this.input.select();
      return;
    }
    this._close(r);
  }

  _skip() {
    if (this.mode === "new") this.lb.skip();
    this._close(null);
  }

  _close(result = null) {
    clearTimeout(this._timer);
    this.open = false;
    this.root.hidden = true;
    const done = this.done;
    this.done = null;
    done?.(result);
  }
}
