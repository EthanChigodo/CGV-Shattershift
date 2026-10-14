"""The game's score: Kevin MacLeod's hybrid orchestral tracks (incompetech.com,
CC BY 4.0) - big drums, brass and strings with synths and electronic beats -
cut into seamless loops.

Each stage loop starts on a bar after the piece's opening and ends on a bar
where the music matches its start, blended across one beat. Loudness matches
what the game's mix was balanced for.

The briefing's score is cut to the film instead (briefing()): the chapters'
lengths come from Okoro's recorded lines (src/audio/voice-lines.js), so
build it after recording them. "Nerves" runs low under the confession, swells
through the leak, erupts as the order is given, and drops out for his last
line; a last hit lands on the title.

    python music_build.py [stage ...]      -> assets/audio/music/<stage>.mp3
"""
import json
import os
import re
import subprocess
import sys
import tempfile

os.environ.setdefault("OMP_NUM_THREADS", "1")
import librosa
import numpy as np
import pyloudnorm
import soundfile as sf

import work

MUSIC = os.path.join(work.DATA, "music")
OUT = os.path.join(work.ASSETS, "music")
SR = 44100

# stage: (track, earliest loop start in seconds, loop length range in seconds, loudness)
PLAN = {
    "foundry": ("Big Mojo", 32, (70, 110), -16.2),             # huge drums, electronics, strings: the machines
    "labs": ("Darkness is Coming", 10, (70, 110), -17.0),      # synths, choir, processed drums: horror that drives
    "skyline": ("Rocket", 10, (60, 100), -15.8),               # euro-tech guitar and symphony: the escape
    "roof": ("Black Vortex", 35, (55, 80), -15.7),             # hybrid orchestra in 7/8: the last stand
    "tension": ("Space Fighter Loop", 3, (45, 98), -18.5),     # synths, drums, low brass: the wake-up, the failing lift
    "grief": ("Lost Time", 10, (70, 110), -19.2),              # the quiet ride up, after Okoro
}
BRIEFING = ("Nerves", -16.0)


def load(path):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).reshape(-1, 2).copy()


def best_loop(y, earliest, lo, hi):
    mono = y.mean(axis=1)
    tempo, beats = librosa.beat.beat_track(y=mono, sr=SR, units="samples")
    beats = np.asarray(beats)
    if len(beats) < 16:
        raise RuntimeError("no beat grid")
    beat_len = int(np.median(np.diff(beats)))
    bars = beats[::4]
    hop = 512
    feat = np.vstack([librosa.feature.chroma_cqt(y=mono, sr=SR, hop_length=hop),
                      librosa.util.normalize(librosa.feature.mfcc(y=mono, sr=SR, hop_length=hop, n_mfcc=13), axis=1)])
    win = int(2.0 * SR / hop)

    def ctx(sample):
        f = sample // hop
        return feat[:, f: f + win].mean(axis=1)

    best = None
    for a in bars:
        if a < earliest * SR:
            continue
        for b in bars:
            L = (b - a) / SR
            if L < lo or L > hi or b + beat_len * 2 > len(mono):
                continue
            sim = float(np.dot(ctx(a), ctx(b)) / (np.linalg.norm(ctx(a)) * np.linalg.norm(ctx(b)) + 1e-9))
            # loudness continuity too: a loop shouldn't jump in level at the seam
            ra = np.sqrt(np.mean(mono[a: a + SR] ** 2)); rb = np.sqrt(np.mean(mono[b: b + SR] ** 2))
            score = sim - 0.5 * abs(np.log((ra + 1e-6) / (rb + 1e-6)))
            if best is None or score > best[0]:
                best = (score, int(a), int(b), beat_len, float(np.atleast_1d(tempo)[0]))
    return best


def seamless(y, a, b, xf):
    body = y[a:b].copy()
    tail = y[b: b + xf]
    w = np.linspace(0, 1, xf)[:, None]
    body[:xf] = body[:xf] * np.sqrt(w) + tail * np.sqrt(1 - w)
    return body


def master(y, lufs):
    meter = pyloudnorm.Meter(SR)
    l = meter.integrated_loudness(y.astype(np.float64))
    y = y * 10 ** ((lufs - l) / 20)
    p = np.max(np.abs(y))
    if p > 0.95:
        y = np.tanh(y / p * 1.2) * 0.95 / np.tanh(1.2) * (p / max(p, 1e-9)) if p > 1.3 else y * 0.95 / p
    return y.astype(np.float32)


def save(y, name):
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        w = os.path.join(d, "x.wav")
        sf.write(w, y, SR, subtype="FLOAT")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w, "-codec:a", "libmp3lame", "-b:a", "160k",
                        os.path.join(OUT, f"{name}.mp3")], check=True)


def film_chapters():
    """[(start, length)] of the briefing's chapters, as the game times them
    (src/story/prologue.js: a chapter lasts its set seconds, or longer if
    Okoro's line needs it: 0.7 s in, the line, 1.1 s after)."""
    src = open(os.path.join(work.ROOT, "src", "story", "prologue.js"), encoding="utf8").read()
    film = re.search(r"const FILM = \[([\s\S]*?)\n\];", src).group(1)
    lines = open(os.path.join(work.ROOT, "src", "audio", "voice-lines.js"), encoding="utf8").read()
    spoken = {json.loads(k): json.loads(v)[1] for k, v in re.findall(r'^  (".*"): (\[[^\]]*\]),?$', lines, re.M)}
    out, t = [], 0.0
    for secs, text in re.findall(r'seconds: ([\d.]+),.*?text: "((?:[^"\\]|\\.)*)"', film, re.S):
        text = text.replace('\\"', '"')
        say = spoken.get(f"okoro|{text}")
        if say is None:
            raise SystemExit(f"not recorded yet: {text}")
        length = max(float(secs), 0.7 + say + 1.1)
        out.append((t, length))
        t += length
    return out


def briefing():
    """The briefing's score, cut to the film (see the top of this file)."""
    track, lufs = BRIEFING
    y = load(os.path.join(MUSIC, f"{track}.mp3"))
    chapters = film_chapters()
    order, last = chapters[7][0], chapters[8][0]        # "The order", and Okoro's last line
    end = chapters[-1][0] + chapters[-1][1]              # then the title on black (4.4 s)
    # Where the piece erupts: the biggest rise in loudness after its first minute and a half.
    mono = y.mean(axis=1)
    sec = np.array([np.sqrt(np.mean(mono[i: i + SR] ** 2)) for i in range(0, len(mono) - SR, SR // 4)])
    db = 20 * np.log10(sec + 1e-9)
    rise = db[8:] - db[:-8]
    k0 = 90 * 4
    erupt = (k0 + int(np.argmax(rise[k0:])) + 8) * SR // 4
    _, beats = librosa.beat.beat_track(y=mono[erupt - 4 * SR: erupt + 4 * SR], sr=SR, units="samples")
    erupt += int(beats[np.argmin(np.abs(beats - 4 * SR))]) - 4 * SR if len(beats) else 0
    offset = erupt - int(order * SR)                     # the piece starts this far in
    n = int((end + 5.0) * SR)
    out = np.zeros((n, 2), np.float32)
    src = y[max(0, offset): max(0, offset) + n]
    out[max(0, -offset): max(0, -offset) + len(src)] = src
    # Its level through the film: low under the confession (he must be heard),
    # rising through the leak and the police, full from the order, gone for his last line.
    t = np.arange(n) / SR
    leak = chapters[5][0]
    gain_db = np.interp(t, [0, 2.5, leak, order - 0.3, order, last - 0.4, last],
                        [-40, -11, -9, -4, 0, 0, -60])
    gain_db[t >= last] = -80
    out *= (10 ** (gain_db / 20))[:, None]
    # A last hit as the title comes up: the piece's own final chord.
    tail = y[-int(4.0 * SR):]
    at = int((end + 0.4) * SR)
    m = min(len(tail), n - at)
    out[at: at + m] += tail[:m] * np.linspace(1, 0, m)[:, None] ** 0.5
    note = (f"{track} from {offset / SR:.1f}s: erupts at {order:.1f}s (the order), "
            f"silent at {last:.1f}s (his last line), {n / SR:.1f}s in all")
    return master(out, lufs), note


if __name__ == "__main__":
    only = sys.argv[1:]
    if not only or "briefing" in only:
        out, note = briefing()
        save(out, "briefing")
        print(f"briefing: {note}", flush=True)
    for stage, (track, earliest, rng, lufs) in PLAN.items():
        if only and stage not in only:
            continue
        y = load(os.path.join(MUSIC, f"{track}.mp3"))
        score, a, b, beat, tempo = best_loop(y, earliest, *rng)
        out = seamless(y, a, b, beat)
        note = f"loop {a / SR:.1f}-{b / SR:.1f}s ({(b - a) / SR:.1f}s, {tempo:.0f} bpm, match {score:.2f})"
        out = master(out, lufs)
        save(out, stage)
        print(f"{stage}: {track} - {note}", flush=True)
