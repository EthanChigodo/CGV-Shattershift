"""Finishing for the recorded lines and built sounds: pitch and time (Rubber Band),
real breaths in a line's pauses, the tower's PA, the radio, a room, loudness."""
import glob
import os
import subprocess
import tempfile

import numpy as np
import pyloudnorm
import soundfile as sf
from scipy import signal

import work

SR = 48000
RNG = np.random.default_rng(7)


def load(path, sr=SR):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).copy()


def ffilter(y, chain, sr=SR):
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "a.wav"), os.path.join(d, "b.wav")
        sf.write(a, y, sr, subtype="FLOAT")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a, "-af", chain, "-ar", str(sr), b], check=True)
        return load(b, sr)


def pitch(y, semitones, tempo=1.0):
    if not semitones and tempo == 1.0:
        return y
    return ffilter(y, f"rubberband=pitch={2 ** (semitones / 12):.5f}:tempo={tempo:.4f}:formant=preserved:pitchq=quality")


def envelope_db(y, hop=480):
    frames = len(y) // hop
    r = np.sqrt(np.mean(y[: frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(r), hop


def trim(y, top_db=45, pad=0.04):
    db, hop = envelope_db(y)
    on = np.where(db > db.max() - top_db)[0]
    if not len(on):
        return y
    a, b = max(0, on[0] * hop - int(pad * SR)), min(len(y), (on[-1] + 1) * hop + int(pad * SR))
    return y[a:b]


def pauses(y, min_len=0.14, top_db=38):
    """Silent stretches inside a line: [(start, end)] in samples."""
    db, hop = envelope_db(y)
    quiet = db < db.max() - top_db
    out, i = [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            if (j - i) * hop >= min_len * SR and i > 3 and j < len(quiet) - 3:
                out.append((i * hop, j * hop))
            i = j
        else:
            i += 1
    return out


_BREATHS = {}


def breaths(kind):
    if kind not in _BREATHS:
        _BREATHS[kind] = [load(p) for p in sorted(glob.glob(os.path.join(work.DATA, "breaths", f"{kind}-*.wav")))]
    return _BREATHS[kind]


def gasp(kind, n=1, gain=0.5):
    """n breaths from the real recording, joined."""
    pool = breaths(kind)
    picks = [pool[i] for i in RNG.choice(len(pool), n, replace=False)]
    out = []
    for b in picks:
        out += [b * gain, np.zeros(int(RNG.uniform(0.03, 0.09) * SR), np.float32)]
    return np.concatenate(out)


def breathe(y, kind="man", lead=2, between=1, gain=0.5, min_pause=0.18):
    """Real breaths before the line and in its pauses (the pauses widen to fit)."""
    out, last = [], 0
    if lead:
        out += [gasp(kind, lead, gain), np.zeros(int(0.05 * SR), np.float32)]
    for a, b in pauses(y, min_pause):
        mid = (a + b) // 2
        out.append(y[last:mid])
        if between:
            g = gasp(kind, between, gain * 0.85)
            out.append(g)
        last = mid
    out.append(y[last:])
    return np.concatenate(out)


def tighten(y, longest=0.42, keep=0.3):
    """Shorten the long silences inside a line: people talking don't stop that
    long between sentences, people reading do."""
    out, last = [], 0
    for a, b in pauses(y, longest):
        cut = (b - a) - int(keep * SR)
        mid = (a + b) // 2
        out.append(y[last: mid - cut // 2])
        last = mid + (cut - cut // 2)
    out.append(y[last:])
    return np.concatenate(out)


def loud(y, lufs=-18.0, peak=0.89):
    meter = pyloudnorm.Meter(SR)
    l = meter.integrated_loudness(y.astype(np.float64)) if len(y) > SR * 0.4 else None
    if l is None or not np.isfinite(l):
        l = 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)
    y = y * 10 ** ((lufs - l) / 20)
    p = np.max(np.abs(y))
    if p > peak:
        y = np.tanh(y / peak * 0.95) * peak / np.tanh(0.95)  # a soft limit, not a hard clip
    return y.astype(np.float32)


def band(y, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, y).astype(np.float32)


def room(y, rt=0.6, wet=0.12, predelay=0.012, damp=5000):
    n = int(rt * SR)
    t = np.arange(n) / SR
    ir = RNG.standard_normal(n) * np.exp(-6.9 * t / rt)
    ir = signal.sosfilt(signal.butter(1, damp, fs=SR, output="sos"), ir)
    ir = np.concatenate([np.zeros(int(predelay * SR)), ir / np.sqrt(np.sum(ir ** 2))])
    w = signal.fftconvolve(y, ir)[: len(y) + int(rt * SR * 0.5)]
    d = np.concatenate([y, np.zeros(len(w) - len(y), np.float32)])
    return (d + wet * w).astype(np.float32)


def pa(y):
    """The tower's PA: a horn speaker's band, a short slap off the walls, a big room."""
    x = band(y, 180, 6000)
    x = np.tanh(x * 1.6) / 1.6
    slap = np.zeros(len(x) + int(0.11 * SR), np.float32)
    slap[: len(x)] += x
    slap[int(0.11 * SR):] += 0.16 * x
    return room(slap, rt=1.4, wet=0.1, predelay=0.02, damp=3500)


def radio(y, noise=0.006):
    x = band(y, 320, 3400, order=3)
    x = np.tanh(x * 2.2) / 2.2
    hiss = band(RNG.standard_normal(len(x)).astype(np.float32), 800, 5000) * noise
    return x + hiss


def save_mp3(y, path, bitrate="96k"):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        w = os.path.join(d, "x.wav")
        sf.write(w, y, SR, subtype="FLOAT")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w, "-ac", "1", "-ar", "44100",
                        "-codec:a", "libmp3lame", "-b:a", bitrate, path], check=True)
