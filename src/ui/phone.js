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

export function isTouch() {
  return matchMedia(TOUCH).matches;
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
    root.classList.toggle("touch", touch.matches);
    const was = root.classList.contains("portrait-phone");
    root.classList.toggle("portrait-phone", upright.matches);
    if (upright.matches && !was) onPortrait?.();
  };
  sync();
  touch.addEventListener?.("change", sync);
  upright.addEventListener?.("change", sync);

  // Full screen (and landscape, where it can be locked) from a tap on a
  // button: browsers only allow it from a tap. Not again once you've left it.
  let asked = false;
  addEventListener("click", (event) => {
    if (asked || !touch.matches || document.fullscreenElement || !root.requestFullscreen) return;
    if (!(event.target instanceof Element) || !event.target.closest("button")) return;
    asked = true;
    root.requestFullscreen({ navigationUI: "hide" })
      .then(() => screen.orientation?.lock?.("landscape"))
      .catch(() => {});
  }, true);
}
