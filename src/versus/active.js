/**
 * Who owns the controllers: the single-player game, or Versus.
 *
 * In single player, pad 1 drives the game through synthesised keyboard and
 * pointer events (the pad-to-keys layer). Versus reads every pad raw
 * (src/systems/gamepad.js) and gives each player their own - so while the
 * Versus lobby or a match is up, that synthesis must stand down, or pad 1
 * would drive player 1 twice (once raw, once through the fake keys).
 *
 * The synthesiser checks this before it dispatches anything:
 *
 *   import { versusActive } from "./src/versus/active.js";
 *   if (versusActive) return;        // a live binding: always current
 *
 * (or `isVersusActive()`, or `document.documentElement.dataset.versus === "on"`
 * from code that cannot import modules). True from the moment the lobby
 * opens until the players are back on the main menu.
 */

export let versusActive = false;

export function isVersusActive() {
  return versusActive;
}

/** Set by src/versus/index.js only. */
export function setVersusActive(on) {
  versusActive = !!on;
  if (typeof document !== "undefined") document.documentElement.dataset.versus = versusActive ? "on" : "off";
}
