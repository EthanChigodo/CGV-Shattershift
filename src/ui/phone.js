/**
 * Phones (src/ui/phone.css has the layout).
 *
 * Fracture Run plays on a phone held sideways:
 *
 *   html.touch           set while the screen is a touch screen with no mouse
 *                        (no hover, a coarse pointer) - the CSS makes room
 *                        for fingers, and the touch controls switch on
 *   html.portrait-phone  set while that phone is held upright: the "turn it
 *                        sideways" screen covers everything, and a run in
 *                        progress pauses (`onPortrait`)
 *   full screen          the first tap on a button asks for full screen and,
 *                        where the browser allows it (Android), locks the
 *                        screen to landscape. iPhones don't allow either in
 *                        the browser - added to the home screen, the web
 *                        app manifest opens it full screen and sideways.
 *
 *   setUpPhone({ onPortrait: () => openPause() });
 */

const TOUCH = "(hover: none) and (pointer: coarse)";

/**
 * A touch screen with no mouse. The media query says so on most phones and
 * tablets; some tablets' browsers (Huawei's, in "desktop site" mode, or with
 * a stylus that reports itself as fine) don't, so a screen that takes touches
 * and has nothing that can hover counts too. `?touch` on the address forces
 * it on, `?touch=0` off (remembered on this device).
 */
export function isTouch() {
  const forced = touchOverride();
  if (forced !== null) return forced;
  if (matchMedia(TOUCH).matches) return true;
  return (navigator.maxTouchPoints ?? 0) > 0 && !matchMedia("(any-hover: hover)").matches;
}

const OVERRIDE_KEY = "fractureRun.touch";
function touchOverride() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("touch")) {
      const on = q.get("touch") !== "0";
      localStorage.setItem(OVERRIDE_KEY, on ? "1" : "0");
      return on;
    }
    const saved = localStorage.getItem(OVERRIDE_KEY);
    return saved === null ? null : saved === "1";
  } catch {
    return null;
  }
}

export function setUpPhone({ onPortrait = null } = {}) {
  const root = document.documentElement;
  const touch = matchMedia(TOUCH);
  const upright = matchMedia(`${TOUCH} and (orientation: portrait)`);

  const turn = document.createElement("div");
  turn.className = "turn-phone";
  turn.setAttribute("role", "alert");
  turn.innerHTML = "<div><i aria-hidden=\"true\"></i><b>Turn your phone sideways</b><span>Fracture Run plays in landscape.</span></div>";
  document.body.append(turn);

  const sync = () => {
    const on = isTouch();
    root.classList.toggle("touch", on);
    const was = root.classList.contains("portrait-phone");
    const portrait = on && matchMedia("(orientation: portrait)").matches;
    root.classList.toggle("portrait-phone", portrait);
    if (portrait && !was) onPortrait?.();
  };
  sync();
  touch.addEventListener?.("change", sync);
  upright.addEventListener?.("change", sync);
  matchMedia("(orientation: portrait)").addEventListener?.("change", sync);

  // A finger held still on a phone means "select this text" (Huawei's
  // browser even inside buttons, whatever the CSS says): never in the game -
  // no selection, no copy menu, no picture-saving menu. Text boxes still can.
  const editable = (t) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable='true']");
  for (const type of ["selectstart", "contextmenu", "dragstart"]) {
    addEventListener(type, (e) => { if (isTouch() && !editable(e.target)) e.preventDefault(); }, true);
  }
  document.addEventListener("selectionchange", () => {
    if (!isTouch() || editable(document.activeElement)) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  });

  // Full screen (and landscape, where it can be locked) from a tap on a
  // button: browsers only allow it from a tap. Not again once you've left it.
  let asked = false;
  addEventListener("click", (event) => {
    if (asked || !isTouch() || document.fullscreenElement || !root.requestFullscreen) return;
    if (!(event.target instanceof Element) || !event.target.closest("button")) return;
    asked = true;
    root.requestFullscreen({ navigationUI: "hide" })
      .then(() => screen.orientation?.lock?.("landscape"))
      .catch(() => {});
  }, true);
}
