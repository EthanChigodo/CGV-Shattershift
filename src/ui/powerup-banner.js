/**
 * Power-ups (serums), explained and kept in view - from the first feedback
 * meeting: players did not know what a power-up does, and forgot they had
 * one because it only showed at the side of the screen.
 *
 * - The first time each serum is picked up, the game pauses on a card in the
 *   middle of the screen: what it is, what it does, what to do with it, how
 *   long it lasts. Seen serums are remembered in the browser.
 * - While a serum is active, a badge at the top centre shows it in its own
 *   colour, with what to do now and the time left; the screen's edges glow
 *   in that colour, and both pulse in the last two seconds.
 *
 * One banner for every level: main.js hands it the shared arsenal's serums
 * (src/systems/arsenal.js), so the Foundry, the Labs, the Skyline and the Roof
 * all show the same thing.
 *
 *   const banner = new PowerupBanner();
 *   banner.needsIntro("prism");          // first time? (then banner.intro(...))
 *   banner.intro(SERUMS.prism);          // the paused card
 *   banner.closeIntro();
 *   banner.update(arsenal.list(), { shieldCharges });
 */

const SEEN_KEY = "fractureRun.serumsSeen";

/** What the player can do with each serum, in a few words. */
export const SERUM_ACTIONS = {
  prism: "Throw or fire now - every shot becomes three",
  thermal: "Look through the smoke - heat glows white",
  shield: "Run through it - hits are absorbed",
  overdrive: "Throw freely - shots are free, and you run faster",
};

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

function loadSeen() {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

export class PowerupBanner {
  constructor({ container = document.body } = {}) {
    if (!document.querySelector("link[data-powerup-banner]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("./powerup-banner.css", import.meta.url).href;
      link.dataset.powerupBanner = "";
      document.head.appendChild(link);
    }
    this.seen = loadSeen();

    // The badges (top centre) and the coloured edge glow.
    this.edge = el("div", "pu-edge", container);
    this.badges = el("div", "pu-badges", container);
    this.badges.setAttribute("aria-live", "polite");
    this._badgeKey = "";

    // The first-time card.
    this.card = el("div", "pu-card", container);
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-modal", "true");
    this.card.hidden = true;
    const box = el("div", "pu-card-box", this.card);
    el("p", "pu-card-eyebrow", box).textContent = "NEW SERUM // GAME PAUSED";
    this.cardName = el("h2", "pu-card-name", box);
    this.cardText = el("p", "pu-card-text", box);
    this.cardAction = el("p", "pu-card-action", box);
    this.cardTime = el("p", "pu-card-time", box);
    this.cardButton = el("button", "pu-card-button", box);
    this.cardButton.type = "button";
    this.cardButton.textContent = "GOT IT";
    el("p", "pu-card-keys", box).innerHTML = "<kbd>Click</kbd> <kbd>Space</kbd> or <kbd>Enter</kbd> to carry on";
    this.open = false;
  }

  /** True the first time this serum is picked up (in this browser). */
  needsIntro(type) {
    return !this.seen.has(type);
  }

  /** Forget which serums were explained (Settings: show the tips again). */
  resetSeen() {
    this.seen.clear();
    try {
      localStorage.removeItem(SEEN_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Show the card for a serum (a SERUMS entry) and remember it as seen. */
  intro(def) {
    this.seen.add(def.key);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...this.seen]));
    } catch {
      /* ignore */
    }
    this.card.style.setProperty("--c", def.colour);
    this.cardName.textContent = def.name;
    this.cardText.textContent = def.text;
    this.cardAction.textContent = SERUM_ACTIONS[def.key] ?? "";
    this.cardTime.textContent = def.charges
      ? `Lasts ${def.duration} s, or ${def.charges} hits`
      : `Lasts ${def.duration} s - watch the timer at the top of the screen`;
    this.card.hidden = false;
    this.open = true;
    this.cardButton.focus({ preventScroll: true });
  }

  closeIntro() {
    this.card.hidden = true;
    this.open = false;
  }

  /**
   * The active serums (Arsenal.list()): one badge each, top centre.
   * @param {Array<{key:string,name:string,colour:string,remaining:number,ratio:number}>} list
   * @param {{shieldCharges?: number}} [extra]
   */
  update(list, { shieldCharges = 0 } = {}) {
    // Rebuilt only when the set of serums changes (so each badge animates in
    // once); the time, bar, shield count and pulse are updated every frame.
    const key = list.map((s) => s.key).join("|");
    if (key !== this._badgeKey) {
      this._badgeKey = key;
      this.badges.innerHTML = list.map((s) => `<div class="pu-badge" data-key="${s.key}" style="--c:${s.colour}">
          <div class="pu-badge-top"><b>${s.name}</b><span></span></div>
          <div class="pu-badge-action"></div>
          <i class="pu-badge-bar"></i>
        </div>`).join("");
    }
    for (const s of list) {
      const node = this.badges.querySelector(`[data-key="${s.key}"]`);
      if (!node) continue;
      const time = `${Math.ceil(s.remaining)}s`;
      const timeEl = node.querySelector(".pu-badge-top span");
      if (timeEl.textContent !== time) timeEl.textContent = time;
      const action = s.key === "shield"
        ? `${shieldCharges} hit${shieldCharges === 1 ? "" : "s"} left - run through it`
        : SERUM_ACTIONS[s.key] ?? s.text;
      const actionEl = node.querySelector(".pu-badge-action");
      if (actionEl.textContent !== action) actionEl.textContent = action;
      node.style.setProperty("--r", Math.max(0, s.ratio).toFixed(3));
      node.classList.toggle("ending", s.remaining < 2);
    }
    const first = list[0];
    this.edge.classList.toggle("on", !!first);
    this.edge.classList.toggle("ending", !!first && first.remaining < 2);
    if (first) this.edge.style.setProperty("--c", first.colour);
  }

  /**
   * The pickup itself: a ring of the serum's colour bursts out from the
   * centre of the screen with a quick flash. Removes itself when done.
   */
  burst(colour) {
    const node = el("div", "pu-burst", this.badges.parentElement);
    node.style.setProperty("--c", colour);
    el("i", "pu-burst-ring", node);
    const last = el("i", "pu-burst-ring late", node);
    last.addEventListener("animationend", () => node.remove());
    setTimeout(() => node.remove(), 3000); // in case animations are off
  }

  /** No serums (a level ended, a restart). */
  clear() {
    this.update([]);
    this.closeIntro();
  }
}
