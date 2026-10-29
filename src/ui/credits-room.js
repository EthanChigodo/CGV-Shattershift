/**
 * The Credits screen (index.html #creditsScreen), drawn as Trophies & Stats
 * is: four tabs - the team (who made what, and the cast), the models (each
 * with its author, licence, source and what it is in the game), music and
 * sound, and what it's made with. The same data as the end credits roll
 * (src/story/credits-roll.js).
 *
 *   const credits = new CreditsRoom(section);
 *   credits.open();
 */

import { GAME_TITLE, STORY_CREDITS } from "../story/script.js";
import { MELTDOWN_CREDITS } from "../levels/meltdown/credits.js";
import { AUDIO_CREDITS } from "../story/credits-roll.js";
import { TabbedScreen } from "./tabbed-screen.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
/** One colour per teammate, the same wherever they're listed. */
const TEAM_COLOURS = ["#ff8a42", "#5ef0ff", "#ffd23f", "#c77dff", "#7dff9a", "#ff5a4e", "#4d8dff"];

export class CreditsRoom {
  constructor(root) {
    this.root = root;
    this.body = root.querySelector("#creditsBody");
    this.body.innerHTML = [this._team(), this._models(), this._sound(), this._tools()].join("");
    this.tabs = new TabbedScreen(root);
  }

  open(tab = "team") {
    this.tabs.open(tab);
  }

  cycleTab(step) {
    this.tabs.cycleTab(step);
  }

  _team() {
    const c = STORY_CREDITS;
    const people = c.members;
    const colourOf = (n) => TEAM_COLOURS[people.indexOf(n) % TEAM_COLOURS.length];
    const person = (n) => `<span class="cr-person" style="--tc:${colourOf(n)}"><i>${initials(n)}</i>${esc(n)}</span>`;
    // The group together: who made which part isn't said - the game is the team's.
    return `<div data-st-panel="team">
      <section class="tr-summary cr-hero">
        <div class="cr-mark">FR</div>
        <div class="tr-sum-text"><b>${esc(GAME_TITLE)}</b><small>A game by ${esc(c.team)} - ${people.length} people, three sectors and a roof, made together.</small>
          <div class="tr-chips">${people.map(person).join("")}</div>
        </div>
      </section>
      <h3 class="tr-group">Cast</h3>
      <div class="tr-grid">${c.cast.map(([who, as]) => `
        <article class="tr-card got cr-card" tabindex="0" style="--tc:#5ef0ff">
          <div class="tr-body"><header><b>${esc(who)}</b></header><p>${esc(as)}</p></div>
        </article>`).join("")}</div>
      <p class="cr-thanks">${esc(c.thanks)}</p>
    </div>`;
  }

  _models() {
    return `<div data-st-panel="models" hidden>
      <p class="fm-blurb">Every model we didn't make, with its author and licence - CC-BY attribution included.</p>
      <div class="tr-grid">${MELTDOWN_CREDITS.map((m) => `
        <article class="tr-card got cr-card" tabindex="0" style="--tc:#ffd23f">
          <div class="tr-body">
            <header><b>${esc(m.title)}</b><span class="fm-act" data-act="collect">${esc(m.licence)}</span></header>
            <p><span class="cr-by">by ${esc(m.author)}</span><br>${esc(m.use)}</p>
            ${m.changes ? `<p class="cr-small">${esc(m.changes)}</p>` : ""}
            ${m.url ? `<p class="cr-small cr-url">${esc(m.url.replace(/^https:\/\//, ""))}</p>` : ""}
          </div>
        </article>`).join("")}</div>
    </div>`;
  }

  _sound() {
    return `<div data-st-panel="sound" hidden>
      <p class="fm-blurb">The voices, the music for each place, and every sound effect.</p>
      <section class="tr-sec cr-list" tabindex="0"><h3>Music and sound</h3>
        <dl>${AUDIO_CREDITS.map(([what, who]) => `<div class="tr-row"><dt>${esc(what)}</dt><dd>${esc(who)}</dd></div>`).join("")}</dl>
      </section>
    </div>`;
  }

  _tools() {
    const made = [
      ["Three.js", "The 3D engine - MIT licence"],
      ["Blender", "Asset conversion"],
      ["Generated in code", "Fire, smoke, sky, glass, the launcher finishes, the trophies and most textures"],
      ["Playwright", "The automated checks that play the game"],
    ];
    return `<div data-st-panel="tools" hidden>
      <p class="fm-blurb">What it's built with.</p>
      <div class="tr-grid">${made.map(([what, note]) => `
        <article class="tr-card got cr-card" tabindex="0" style="--tc:#c77dff">
          <div class="tr-body"><header><b>${esc(what)}</b></header><p>${esc(note)}</p></div>
        </article>`).join("")}</div>
      <p class="cr-thanks">${esc(STORY_CREDITS.thanks)}</p>
    </div>`;
  }
}
