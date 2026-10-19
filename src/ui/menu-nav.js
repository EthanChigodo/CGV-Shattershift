/**
 * Menus you can drive like a console's: the arrow keys move a single
 * selection through the open screen's choices, Enter takes it, and the mouse
 * moves the same selection (pointing at a choice selects it), so there is
 * only ever one lit item.
 *
 * Pads have their own spatial navigation (src/systems/pad-input.js); this
 * only answers real keys, so the two never move the selection twice.
 *
 *   installMenuNav();   // once, at boot
 */

/** What counts as a choice on a screen, in reading order. */
const CHOICES = ".menu-button, .chapter-card, .difficulty-card, .endless-card, .link-button, .subject-line";

function visible(el) {
  if (el.disabled || el.hidden || el.closest("[hidden]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function activeScreen() {
  const list = [...document.querySelectorAll(".screen.active")];
  return list[list.length - 1] ?? null;
}

export function installMenuNav() {
  addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;
    const screen = activeScreen();
    if (!screen) return;
    // A slider or a select keeps its own arrows.
    if (event.target.closest?.("input, select, textarea")) return;
    const items = [...screen.querySelectorAll(CHOICES)].filter(visible);
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement);
    const step = event.code === "ArrowDown" ? 1 : -1;
    const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next].focus({ preventScroll: false });
    items[next].scrollIntoView({ block: "nearest" });
  }, true);

  // Pointing at a choice selects it.
  addEventListener("pointerover", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const el = event.target.closest?.(CHOICES);
    if (!el || !el.closest(".screen.active") || el === document.activeElement || !visible(el)) return;
    el.focus({ preventScroll: true });
  });
}
