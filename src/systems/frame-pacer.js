/**
 * Phones and tablets: how often a frame is drawn (main.js's loop asks).
 *
 * A phone's graphics are a fraction of a laptop's, and it heats up and slows
 * itself down after a few minutes. So, on a touch device only:
 *
 *   - at most 60 frames a second, even on a 90 or 120 Hz screen (twice the
 *     work for a difference nobody sees on a phone, and twice the heat)
 *   - if it can't keep 60 (under ~42 fps for a few seconds), a steady 30:
 *     an even 30 plays smoother than one jumping between 35 and 55
 *   - once in a while, when it's had room to spare, it tries 60 again
 *
 * The automatic quality (main.js) keeps working at 30: `budgetMs` turns a
 * frame's time into what it would be at 60, so its "too slow" and "room to
 * spare" mean the same at either rate.
 *
 *   const pacer = new FramePacer({ enabled: isTouch() });
 *   function animate() {
 *     requestAnimationFrame(animate);
 *     if (pacer.skip(performance.now())) return;
 *     ...
 *   }
 *   pacer.update(rawDt, { judging });       // once a frame
 *   const ms = pacer.budgetMs(rawDt);       // for the automatic quality
 */

const FAST = 1000 / 60;
const STEADY = 1000 / 30;
/** A frame this much early still counts (rAF times wobble). */
const SLACK = 3;
/** Below ~42 fps (a frame every 24 ms) for this long: drop to 30. */
const SLOW_MS = 24;
const SLOW_FOR = 2.5;
/** At 30 with room to spare this long: try 60 again. */
const RETRY_AFTER = 20;

export class FramePacer {
  constructor({ enabled = false } = {}) {
    this.enabled = enabled;
    /** Locked to 30 fps. */
    this.steady = false;
    this._last = 0;
    this._ema = FAST;
    this._slow = 0;
    this._easy = 0;
    /** Seconds into a try at 60 (0: not trying). */
    this._trying = 0;
    this._backoff = RETRY_AFTER;
  }

  get frameMs() {
    return this.steady ? STEADY : FAST;
  }

  /** Too soon for the next frame: skip this one. */
  skip(now) {
    if (!this.enabled) return false;
    if (now - this._last < this.frameMs - SLACK) return true;
    this._last = now;
    return false;
  }

  /** A frame's time as it would be at 60 fps (what the automatic quality reads). */
  budgetMs(rawDt) {
    const ms = rawDt * 1000;
    return this.enabled && this.steady ? ms * (FAST / STEADY) : ms;
  }

  /**
   * Once a frame. `judging`: a level in play, settled, not paused - the only
   * time the frame rate means anything. `easy`: the automatic quality has
   * everything back at full (nothing left to give back but the rate).
   */
  update(rawDt, { judging = false, easy = false } = {}) {
    if (!this.enabled) return;
    const ms = rawDt * 1000;
    this._ema = this._ema * 0.9 + ms * 0.1;
    if (!judging) { this._slow = 0; this._easy = 0; return; }
    if (!this.steady) {
      this._slow = this._ema > SLOW_MS ? this._slow + rawDt : 0;
      if (this._slow > SLOW_FOR) {
        this.steady = true;
        this._slow = 0;
        // A failed try at 60: wait longer before the next.
        if (this._trying) this._backoff = Math.min(120, this._backoff * 2);
        this._trying = 0;
      } else if (this._trying) {
        this._trying += rawDt;
        if (this._trying > 6) { this._trying = 0; this._backoff = RETRY_AFTER; }
      }
      return;
    }
    // At 30: frames on time (or early), and the quality at full - try 60.
    this._easy = easy && this._ema < STEADY + 4 ? this._easy + rawDt : 0;
    if (this._easy > this._backoff) {
      this.steady = false;
      this._easy = 0;
      this._trying = rawDt;
      this._ema = FAST;
    }
  }
}
