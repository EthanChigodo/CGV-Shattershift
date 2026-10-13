"""The game's score: Kevin MacLeod's tracks (incompetech.com, CC BY 4.0), cut into seamless loops.

Each stage loop starts on a bar after the piece's opening and ends on a bar
where the music matches its start, blended across one beat; the briefing
plays its whole track. Loudness matches what the game's mix was balanced for.

    python music_build.py [stage ...]      -> assets/audio/music/<stage>.mp3
"""
import os
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
    "briefing": ("Hitman", None, None, -16.0),
    "foundry": ("The Complex", 20, (70, 100), -16.2),
    "labs": ("SCP-x3x", 15, (70, 100), -17.9),
    "skyline": ("Movement Proposition", 12, (60, 95), -16.1),
    "roof": ("Volatile Reaction", 10, (60, 95), -15.7),
    "tension": ("Constance", 8, (60, 95), -18.5),
    "grief": ("Lost Time", 10, (70, 110), -19.2),
}


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


if __name__ == "__main__":
    only = sys.argv[1:]
    for stage, (track, earliest, rng, lufs) in PLAN.items():
        if only and stage not in only:
            continue
        y = load(os.path.join(MUSIC, f"{track}.mp3"))
        if rng is None:
            out = y
            note = "whole track"
        else:
            score, a, b, beat, tempo = best_loop(y, earliest, *rng)
            out = seamless(y, a, b, beat)
            note = f"loop {a / SR:.1f}-{b / SR:.1f}s ({(b - a) / SR:.1f}s, {tempo:.0f} bpm, match {score:.2f})"
        out = master(out, lufs)
        save(out, stage)
        print(f"{stage}: {track} - {note}", flush=True)
