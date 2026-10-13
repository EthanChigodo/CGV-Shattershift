"""Build the game's effects and the patients' voices from real recordings.

Every source is a free recording (BigSoundBank, CC0; OpenGameArt, CC0 or
CC-BY - docs/credits.md names each one; sources.py downloads them). Each
file is cut, layered and mastered to the loudness the game's mix expects.

    python sounds_build.py speech             the patients' broken speech (OmniVoice)
    python sounds_build.py build [--only RX]  -> work/vs/sounds/{sfx,creatures}
    python sounds_build.py install            -> assets/audio/{sfx,creatures}
"""
import argparse
import glob
import json
import os
import re

import numpy as np

import work
import finish as F

SR = F.SR
D = work.DATA
OUT = os.path.join(work.VS, "sounds")
RNG = np.random.default_rng(11)

LOUDNESS = {  # name: [LUFS, seconds] - the loudness the game's mix was balanced for
    "creatures/patient-death-1": [-19.6, 1.91],
    "creatures/patient-death-2": [-19.5, 2.15],
    "creatures/patient-death-3": [-20.4, 2.88],
    "creatures/patient-death-4": [-20.7, 1.85],
    "creatures/patient-growl-1": [-17.9, 2.63],
    "creatures/patient-growl-2": [-18.0, 2.75],
    "creatures/patient-growl-3": [-18.6, 2.24],
    "creatures/patient-growl-4": [-18.2, 1.75],
    "creatures/patient-growl-5": [-18.0, 2.0],
    "creatures/patient-growl-6": [-18.6, 2.41],
    "creatures/patient-horde-1": [-15.2, 5.94],
    "creatures/patient-horde-2": [-16.0, 5.94],
    "creatures/patient-moan-1": [-21.6, 2.61],
    "creatures/patient-moan-2": [-21.5, 3.1],
    "creatures/patient-moan-3": [-22.2, 5.23],
    "creatures/patient-moan-4": [-21.6, 3.35],
    "creatures/patient-moan-5": [-22.1, 3.04],
    "creatures/patient-moan-6": [-22.1, 5.3],
    "creatures/patient-pain-1": [-19.2, 1.3],
    "creatures/patient-pain-2": [-19.7, 1.61],
    "creatures/patient-pain-3": [-20.5, 1.08],
    "creatures/patient-pain-4": [-21.2, 1.02],
    "creatures/patient-pain-5": [-21.4, 1.27],
    "creatures/patient-roar-1": [-15.5, 3.66],
    "creatures/patient-roar-2": [-15.9, 6.03],
    "creatures/patient-shriek-1": [-17.4, 2.28],
    "creatures/patient-shriek-2": [-18.0, 1.51],
    "creatures/patient-shriek-3": [-18.0, 1.79],
    "creatures/patient-shriek-4": [-17.0, 1.69],
    "creatures/patient-speech-1": [-19.5, 3.57],
    "creatures/patient-speech-2": [-20.2, 3.11],
    "creatures/patient-speech-3": [-19.2, 3.13],
    "creatures/patient-speech-4": [-19.7, 2.68],
    "creatures/patient-speech-5": [-19.9, 3.54],
    "creatures/patient-speech-6": [-19.6, 3.62],
    "creatures/patient-speech-7": [-18.8, 3.17],
    "creatures/patient-speech-8": [-19.9, 3.4],
    "sfx/body-hit": [-19.2, 1.26],
    "sfx/brake": [-14.4, 2.27],
    "sfx/breath-pant-f": [-21.3, 5.55],
    "sfx/breath-pant-m": [-21.3, 5.55],
    "sfx/breath-recover-f": [-22.0, 7.33],
    "sfx/breath-recover-m": [-22.1, 7.33],
    "sfx/breath-run-f": [-22.6, 8.0],
    "sfx/breath-run-m": [-22.5, 8.0],
    "sfx/breath-scared-f": [-24.7, 4.16],
    "sfx/breath-scared-m": [-24.7, 4.16],
    "sfx/building-collapse": [-12.7, 16.28],
    "sfx/cable-snap": [-15.4, 4.06],
    "sfx/clank": [-17.9, 1.36],
    "sfx/clatter": [-15.4, 2.25],
    "sfx/debris": [-14.1, 3.71],
    "sfx/demolition-charges": [-12.4, 9.62],
    "sfx/distant-collapse-1": [-14.0, 6.51],
    "sfx/distant-collapse-2": [-14.3, 6.51],
    "sfx/explosion-1": [-12.3, 7.8],
    "sfx/explosion-2": [-12.3, 7.8],
    "sfx/fire-alarm": [-16.2, 8.0],
    "sfx/glass-cascade": [-13.6, 5.72],
    "sfx/grunt-f": [-18.7, 1.55],
    "sfx/grunt-m": [-20.8, 1.3],
    "sfx/hurt-1-f": [-19.7, 0.86],
    "sfx/hurt-1-m": [-20.7, 0.86],
    "sfx/hurt-2-f": [-20.4, 0.91],
    "sfx/hurt-2-m": [-20.3, 0.91],
    "sfx/hurt-3-f": [-19.8, 0.85],
    "sfx/hurt-3-m": [-20.3, 0.85],
    "sfx/lift-chime": [-21.5, 2.27],
    "sfx/lift-doors": [-18.2, 2.05],
    "sfx/metal-groan-1": [-16.0, 5.64],
    "sfx/metal-groan-2": [-15.9, 6.64],
    "sfx/monitor-beep": [-26.2, 2.76],
    "sfx/pistol": [-16.5, 3.04],
    "sfx/scream-f": [-17.1, 3.64],
    "sfx/scream-m": [-16.3, 3.68],
    "sfx/spark": [-20.9, 1.65],
    "sfx/sprinkler-burst": [-16.5, 3.4],
}


OGA = os.path.join(D, "oga")
LRSF_Z = os.path.join(OGA, "voices-sound-effects-library/x/Wav/Zombie")
LRSF_H = os.path.join(OGA, "voices-sound-effects-library/x/Wav/Human")
HORROR = os.path.join(OGA, "horror-sound-effects-library/x/Horror Sound Library/Wav")


def bsb(sid):
    return os.path.join(D, "bsb", f"bsb-{sid}.mp3")


def src(*parts):
    p = os.path.join(OGA, *parts)
    hits = glob.glob(p)
    if not hits:
        raise FileNotFoundError(p)
    return hits[0]


# ------------------------------------------------------------------ helpers

def L(path, start=0.0, dur=None, trim=True):
    y = F.load(path)
    y = y[int(start * SR):]
    if dur:
        y = y[: int(dur * SR)]
    return F.trim(y, 50, 0.02) if trim else y


def fade(y, a=0.005, b=0.05):
    y = y.copy()
    na, nb = min(len(y) // 2, int(a * SR)), min(len(y) // 2, int(b * SR))
    if na:
        y[:na] *= np.linspace(0, 1, na)
    if nb:
        y[-nb:] *= np.linspace(1, 0, nb) ** 2
    return y


def mix(*parts, length=None):
    """parts: (signal, at seconds, gain)."""
    end = max(int(at * SR) + len(y) for y, at, g in parts)
    out = np.zeros(length and int(length * SR) or end, np.float32)
    for y, at, g in parts:
        a = int(at * SR)
        n = min(len(y), len(out) - a)
        if n > 0:
            out[a:a + n] += y[:n] * g
    return out


def lowpass(y, hz, order=2):
    from scipy import signal
    return signal.sosfilt(signal.butter(order, hz, fs=SR, output="sos"), y).astype(np.float32)


def highpass(y, hz, order=2):
    from scipy import signal
    return signal.sosfilt(signal.butter(order, hz, btype="high", fs=SR, output="sos"), y).astype(np.float32)


def stretch(y, factor):
    """Longer (factor > 1) without changing pitch."""
    return F.pitch(y, 0, tempo=1 / factor)


def loop(y, seconds, xfade=0.6):
    """A seamless loop of `seconds`: the tail crossfades into the head."""
    n, x = int(seconds * SR), int(xfade * SR)
    y = y[: n + x]
    if len(y) < n + x:
        y = np.concatenate([y, y])[: n + x]
    head, tail = y[:x], y[n:n + x]
    w = np.linspace(0, 1, x)
    out = y[:n].copy()
    out[:x] = head * np.sqrt(w) + tail * np.sqrt(1 - w)
    return out


def segments(y, top_db=35, min_gap=0.12, min_len=0.15):
    db, hop = F.envelope_db(y, 240)
    on = db > db.max() - top_db
    segs, i = [], 0
    gap = int(min_gap * SR / hop)
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and (on[j] or on[j:j + gap].any()):
                j += 1
            if (j - i) * hop >= min_len * SR:
                segs.append((i * hop, j * hop))
            i = j
        else:
            i += 1
    return segs


def piece(path, k, top_db=35, pad=0.03, **kw):
    y = L(path, trim=False)
    segs = segments(y, top_db, **kw)
    a, b = segs[k % len(segs)]
    return fade(y[max(0, a - int(pad * SR)): b + int(pad * 2 * SR)], 0.004, 0.06)


def master(name, y, lufs=None, peak=0.9):
    lufs = lufs if lufs is not None else LOUDNESS[name][0]
    y = F.loud(highpass(y, 30, 1), lufs, peak)
    F.save_mp3(y, os.path.join(OUT, name + ".mp3"), "128k")
    return y


# ------------------------------------------------------------------ the effects

def body_hit():
    punch = L(bsb("2460"))
    fall = L(bsb("2452"))
    return mix((punch, 0, 1.0), (lowpass(fall, 3000), 0.06, 0.8))


def brake():
    """The lift's emergency brakes biting: a grind, the chain taking the load, a clunk, air."""
    grind = lowpass(F.pitch(L(bsb("0322")), -3), 5000)
    chain = lowpass(L(bsb("0359")), 4000)
    clunk = F.pitch(L(src("metal-impact-sounds", "bong1.wav")), -6)
    hiss = L(bsb("1490"))
    return fade(mix((grind, 0, 0.8), (chain, 0.25, 0.8), (clunk, 0.9, 1.0), (hiss, 1.1, 0.7)), 0.002, 0.6)


def breath(kind, g):
    if g == "m":
        src_y = {"run": L(bsb("1103")), "pant": L(bsb("1103"), 6), "recover": L(bsb("2195")), "scared": L(bsb("2195"), 30)}[kind]
    else:
        src_y = {"run": L(bsb("1345")), "pant": L(bsb("1345"), 20), "recover": L(bsb("1345"), 45), "scared": L(bsb("1345"), 58)}[kind]
    if kind == "scared":
        src_y = F.pitch(src_y, 0, tempo=1.25)  # quick, shallow
    if kind == "recover" and g == "f":
        src_y = F.pitch(src_y, 0, tempo=0.8)  # slowing down
    secs = LOUDNESS[f"sfx/breath-{kind}-{g}"][1]
    return loop(src_y, secs, 0.4) if kind == "run" else fade(src_y[: int(secs * SR)], 0.05, 0.6)


def rumble(seconds, at=0.0):
    """The ground moving: real falling stone, an octave and more below itself."""
    y = L(bsb("1022"), at, seconds * 0.6 + 1)
    return lowpass(F.pitch(y, -14, tempo=0.6), 400)


def building_collapse():
    boom = F.pitch(L(src("2-high-quality-explosions", "x", "explosions", "explode.wav")), -4)
    stone_a, stone_b = L(bsb("1022"), 0, 12), L(bsb("1022"), 12, 12)
    glass, mirror = L(bsb("2681"), 0, 8), L(bsb("0387"))
    steel_a, steel_b = L(bsb("1776")), L(bsb("1774"))
    far = L(bsb("1023"))
    y = mix((rumble(16), 0, 1.0), (boom, 0.2, 0.9), (stone_a, 0.8, 0.9), (glass, 2.0, 0.35), (mirror, 2.6, 0.5),
            (lowpass(steel_a, 3000), 3.2, 0.5), (lowpass(steel_b, 2500), 4.4, 0.4), (lowpass(stone_b, 2500), 6.0, 0.8),
            (lowpass(far, 1500), 7.5, 0.7), (lowpass(stone_a, 1200), 9.5, 0.6), length=16.3)
    return fade(y, 0.01, 3.0)


def cable_snap():
    snap = L(bsb("0550"))
    chain = L(bsb("0359"))
    twang = F.pitch(L(src("metal-impact-sounds", "bing1.wav")), -7)
    groan = F.pitch(L(bsb("0616"), 20, 3), -8, tempo=0.8)
    return fade(mix((snap, 0, 1.0), (twang, 0.01, 0.8), (chain, 0.05, 0.9), (lowpass(groan, 2000), 0.3, 0.5)), 0.002, 1.0)


def clank():
    return L(src("metal-impact-sounds", "bong1.wav"))


def clatter():
    """The launcher hitting the floor and bouncing to rest."""
    hits = [L(src("100-cc0-metal-and-wood-sfx", "x", f)) for f in ("metal_sheet_02.ogg", "metal_hit_02.ogg", "metal_hit_03.ogg", "hammer_01.ogg", "metal_hit_04.ogg", "metal_hit_02.ogg")]
    at, parts, gap, g = 0.0, [], 0.32, 1.0
    for h in hits:
        parts.append((F.pitch(h, -3), at, g))
        at += gap; gap *= 0.7; g *= 0.72
    slide = lowpass(L(bsb("0322")), 3000)
    return fade(mix(*parts, (slide, 0.5, 0.3)), 0.002, 0.3)


def debris():
    return fade(L(bsb("1022"), 2.0, 3.7), 0.01, 0.8)


def demolition_charges():
    a = L(src("2-high-quality-explosions", "x", "explosions", "explode.wav"))
    b = L(src("2-high-quality-explosions", "x", "explosions", "explodemini.wav"))
    near, far = L(bsb("1807")), L(bsb("1023"))
    parts = [(a, 0.0, 1.0), (near, 1.2, 0.8), (lowpass(b, 3000), 2.4, 0.8), (lowpass(far, 2000), 3.4, 0.9),
             (lowpass(a, 1500), 4.6, 0.6), (lowpass(far, 1000), 5.8, 0.7)]
    return fade(mix(*parts, length=9.6), 0.002, 2.5)


def distant_collapse(k):
    far = L(bsb("1023"))
    stone = L(bsb("1022"), 4 + 8 * k, 4)
    y = mix((rumble(6.5, 6 * k), 0, 1.0), (far, 0.3, 0.9), (stone, 1.0, 0.8), length=6.5)
    return fade(lowpass(y, 1800), 0.2, 2.0)


def explosion(k):
    y = L(src("2-high-quality-explosions", "x", "explosions", "explode.wav" if k == 1 else "explodemini.wav"))
    if k == 2:
        y = F.pitch(y, -3)
    tail = lowpass(L(src("rumbling-sound-effects", "rumbling20.mp3"), 0, 6), 600)
    return fade(mix((y, 0, 1.0), (tail, 0.4, 0.5), length=7.8), 0.002, 2.5)


def fire_alarm():
    return loop(L(bsb("1153"), 2.0), 8.0, 0.05)


def glass_cascade():
    return fade(mix((L(bsb("0387")), 0, 1.0), (L(bsb("0148")), 0.25, 0.8), (L(bsb("2681"), 1.0, 5.0), 0.5, 0.6), length=5.7), 0.002, 1.0)


def lift_chime():
    return L(src("elevator-ding", "*.ogg"))


def lift_doors():
    return L(src("old-elevator-door", "*.mp3"), 0, 2.1)


def metal_groan(k):
    """The tower's steel under load: a real metal door's creak, slowed, over crumbling."""
    y = L(bsb("0616"), 12 + 30 * k, 5)
    y = F.pitch(y, -3 - 2 * k, tempo=0.65)
    crumble = lowpass(L(bsb("1022"), 3 + 5 * k, 6), 2500)
    clang = F.pitch(L(src("metal-impact-sounds", "bong1.wav")), -10)
    return fade(mix((lowpass(y, 4000), 0, 0.8), (crumble, 0.5, 0.5), (clang, 2.0 + k, 0.5)), 0.3, 1.2)


def monitor_beep():
    return L(bsb("0457"), 0, 2.76, trim=False)


def pistol():
    return L(bsb("0437"), 0, 3.0)


def spark():
    weld = L(bsb("0952"), 0, 1.2)
    hum = L(bsb("2118"), 0, 1.5)
    return fade(mix((weld, 0, 1.0), (hum, 0.05, 0.25)), 0.002, 0.4)


def sprinkler_burst():
    pop = L(bsb("1121"))
    spray = L(bsb("1302"), 2, 3.2)
    return fade(mix((pop, 0, 0.9), (spray, 0.05, 1.0)), 0.002, 0.6)


# ------------------------------------------------------------------ Seven (by character)

MALE_YELLS = sorted(glob.glob(os.path.join(OGA, "male-gruntyelling-sounds", "x", "**", "*.wav"), recursive=True))
FEMALE_HURT = os.path.join(OGA, "female-hurt-grunts-groans", "female_hurt_grunts_groans_1.ogg")
FEMALE_RPG = os.path.join(OGA, "female-rpg-voice-starter-pack", "x", "RPG Voice Starter Pack")


def hurt(k, g):
    if g == "f":
        return L(os.path.join(FEMALE_RPG, "Type 2", f"damaged{k}.wav"))
    return L(src("male-gruntyelling-sounds", "x", "*", ["3yell11.wav", "3yell15.wav", "3yell7.wav"][k - 1]))


def grunt(g):
    if g == "f":
        return L(os.path.join(FEMALE_RPG, "Type 2", "attack1.wav"))
    return L(src("male-gruntyelling-sounds", "x", "*", "3yell10.wav"))


def scream(g):
    """The fall: a real scream, dropping away into the dark."""
    if g == "f":
        a, b = L(src("female-screams", "x", "2.ogg")), L(src("female-screams", "x", "1.ogg"))
        y = mix((a, 0, 1.0), (b, 1.1, 0.8))
    else:
        a, b = L(src("male-gruntyelling-sounds", "x", "*", "yell10.wav")), L(src("male-gruntyelling-sounds", "x", "*", "yell11.wav"))
        y = mix((a, 0, 1.0), (b, 1.7, 0.7))
    n = len(y)
    env = np.linspace(1, 0.2, n) ** 1.3
    # Falling away: the top end goes first.
    near, far = y * env, lowpass(y, 1500) * env
    w = np.linspace(0, 1, n) ** 0.8
    y = near * (1 - w) + far * w
    return fade(F.room(y, rt=1.2, wet=0.18), 0.005, 0.8)


# ------------------------------------------------------------------ the patients

def z(i):
    return os.path.join(LRSF_Z, f"Zombie_{i:02d}.wav")


GROWL = [lambda: L(z(0), 0, 2.6), lambda: L(bsb("2108"), 2.0, 2.6), lambda: L(bsb("2107"), 1.0, 2.4),
         lambda: L(src("hungry-ghoul", "*.ogg"), 3.0, 2.0), lambda: L(z(48)), lambda: mix((L(z(41)), 0, 1.0), (L(z(56)), 0.7, 0.9))]
MOAN = [lambda: L(bsb("2106"), 0, 3.0), lambda: L(bsb("2110")), lambda: L(z(68)), lambda: L(z(70)),
        lambda: L(bsb("2106"), 6, 4.5), lambda: L(z(6))]
SHRIEK = [lambda: L(src("female-screams", "x", "2.ogg")), lambda: L(src("female-screams", "x", "1.ogg")),
          lambda: L(os.path.join(OGA, "voices-sound-effects-library/x/Wav/Dinosaur/Dinosaur_14.wav")), lambda: L(os.path.join(OGA, "voices-sound-effects-library/x/Wav/Dinosaur/Dinosaur_00.wav"))]
PAIN = [lambda: L(os.path.join(HORROR, "Scream_Male_04.wav")), lambda: L(z(71)), lambda: L(z(61)),
        lambda: L(src("80-cc0-creture-sfx-2", "x", "die_03.ogg")), lambda: L(z(14))]
DEATH_GRUNTS = os.path.join(OGA, "grunts-male-death-and-pain", "death pain grunts.wav")
DEATH = [lambda: L(os.path.join(LRSF_H, "Human_DyingBreath_00.wav")),
         lambda: mix((L(src("80-cc0-creture-sfx-2", "x", "die_02.ogg")), 0, 1.0), (L(z(8)), 0.5, 0.8)),
         lambda: piece(DEATH_GRUNTS, 2),
         lambda: L(os.path.join(LRSF_H, "Human_DyingBreath_03.wav"))]


def monstrous(y, semis=-2.0, grit=1.6):
    """Make a human sound wrong: lower, rougher, a body too big for it."""
    y = F.pitch(y, semis)
    y = np.tanh(y / (np.max(np.abs(y)) + 1e-9) * grit) / np.tanh(grit)
    return y.astype(np.float32)


def roar(k):
    if k == 1:
        beast = L(bsb("0486"), 0, 3.6)
        b = L(os.path.join(HORROR, "Monster_00.wav"))
        y = mix((F.pitch(beast, -2), 0, 1.0), (F.pitch(b, -2), 0.15, 0.6))
    else:
        a, b = L(src("80-cc0-creture-sfx-2", "x", "roar_05.ogg")), L(os.path.join(HORROR, "Monster_04.wav"))
        ghost = L(src("ghost-monster-voice-moaning-growling", "x", "**", "mp3", "*04.mp3"))
        y = mix((F.pitch(a, -6), 0, 1.0), (F.pitch(b, -2), 0.3, 0.9), (lowpass(ghost, 1500), 0.8, 0.5))
    return fade(F.room(y, rt=0.9, wet=0.12), 0.002, 1.0)


def horde(k):
    voices = [g() for g in GROWL] + [m() for m in MOAN]
    parts = []
    for i in range(14):
        v = voices[RNG.integers(len(voices))]
        v = F.pitch(v, float(RNG.uniform(-3, 2)))
        parts.append((lowpass(v, float(RNG.uniform(1800, 5000))), float(RNG.uniform(0, 4.2)), float(RNG.uniform(0.3, 0.8))))
    y = mix(*parts, length=5.94)
    return fade(F.room(y, rt=1.6, wet=0.25, predelay=0.03), 0.4, 1.2)


def patient_speech(k):
    takes = sorted(glob.glob(os.path.join(work.VS, "patients", f"speech-{k}-*.wav")))
    if not takes:
        raise FileNotFoundError(f"patient speech {k}")
    y = F.trim(F.load(takes[0]))
    y = monstrous(y, -3.0, 2.2)
    under = F.pitch(GROWL[k % len(GROWL)](), -2)
    y = mix((y, 0, 1.0), (lowpass(under, 1200), 0.1, 0.35))
    return fade(F.room(y, rt=0.7, wet=0.1), 0.01, 0.4)


# ------------------------------------------------------------------ the list

def recipes():
    r = {
        "sfx/body-hit": body_hit, "sfx/brake": brake, "sfx/building-collapse": building_collapse,
        "sfx/cable-snap": cable_snap, "sfx/clank": clank, "sfx/clatter": clatter, "sfx/debris": debris,
        "sfx/demolition-charges": demolition_charges, "sfx/fire-alarm": fire_alarm,
        "sfx/glass-cascade": glass_cascade, "sfx/lift-chime": lift_chime, "sfx/lift-doors": lift_doors,
        "sfx/monitor-beep": monitor_beep, "sfx/pistol": pistol, "sfx/spark": spark,
        "sfx/sprinkler-burst": sprinkler_burst,
    }
    for k in (1, 2):
        r[f"sfx/distant-collapse-{k}"] = lambda k=k: distant_collapse(k)
        r[f"sfx/explosion-{k}"] = lambda k=k: explosion(k)
        r[f"sfx/metal-groan-{k}"] = lambda k=k: metal_groan(k)
        r[f"creatures/patient-roar-{k}"] = lambda k=k: roar(k)
        r[f"creatures/patient-horde-{k}"] = lambda k=k: horde(k)
    for g in "fm":
        for kind in ("run", "pant", "recover", "scared"):
            r[f"sfx/breath-{kind}-{g}"] = lambda kind=kind, g=g: breath(kind, g)
        for k in (1, 2, 3):
            r[f"sfx/hurt-{k}-{g}"] = lambda k=k, g=g: hurt(k, g)
        r[f"sfx/grunt-{g}"] = lambda g=g: grunt(g)
        r[f"sfx/scream-{g}"] = lambda g=g: scream(g)
    for name, fns, semis in (("growl", GROWL, -2), ("moan", MOAN, -2), ("shriek", SHRIEK, 0), ("pain", PAIN, -1), ("death", DEATH, -2)):
        for i, fn in enumerate(fns):
            r[f"creatures/patient-{name}-{i + 1}"] = lambda fn=fn, semis=semis, name=name: (
                monstrous(fn(), semis, 1.3 if name in ("moan", "death") else 1.8))
    for k in range(1, 9):
        r[f"creatures/patient-speech-{k}"] = lambda k=k: patient_speech(k)
    return r


PATIENT_LINES = [  # (words, designed voice)
    ("Help... me... help me...", "male, elderly, low pitch, whisper"),
    ("It hurts... it hurts... make it stop...", "female, middle-aged, low pitch, whisper"),
    ("Doctor... Doctor... fix me...", "male, middle-aged, very low pitch"),
    ("Where is... where is my...", "male, elderly, low pitch, whisper"),
    ("Let me out... let me out!", "male, middle-aged, very low pitch"),
    ("I can't... I can't feel my...", "female, middle-aged, low pitch, whisper"),
    ("Seven... Seven...", "male, elderly, low pitch, whisper"),
    ("Why... why did you... why...", "female, middle-aged, low pitch, whisper"),
]


def speech():
    """What is left of the patients' speech: OmniVoice, slow, in designed voices (one process per take)."""
    import subprocess
    import sys
    for i, (text, voice) in enumerate(PATIENT_LINES):
        out = os.path.join(work.VS, "patients", f"speech-{i + 1}-1.wav")
        if os.path.exists(out):
            continue
        part = os.path.join(work.VS, "jobs-patient.json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump([{"out": out, "text": text, "instruct": voice, "seed": 41, "speed": 0.8}], open(part, "w"))
        try:
            subprocess.run([sys.executable, os.path.join(work.TOOLS, "engines", "omnivoice_jobs.py"), part], timeout=300)
        except subprocess.TimeoutExpired:
            print("TIMEOUT", out)


def install():
    import shutil
    for d in ("sfx", "creatures"):
        for f in sorted(os.listdir(os.path.join(OUT, d))):
            shutil.copy(os.path.join(OUT, d, f), os.path.join(work.ASSETS, d, f))
    print("installed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["speech", "build", "install"])
    ap.add_argument("--only")
    a = ap.parse_args()
    if a.stage == "speech":
        speech()
        raise SystemExit
    if a.stage == "install":
        install()
        raise SystemExit
    rx = re.compile(a.only) if a.only else None
    for name, fn in recipes().items():
        if rx and not rx.search(name):
            continue
        try:
            y = master(name, fn())
            print(f"{name}: {len(y) / SR:.2f}s", flush=True)
        except Exception as e:
            print(f"FAILED {name}: {e!r}", flush=True)
