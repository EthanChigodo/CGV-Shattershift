"""Download everything the audio tools use into the work folder (work.py).

    python sources.py                 recordings, music, the Nigerian speech set
    python sources.py engines         VoiceStudio (OmniVoice) and VoxCPM2 (+ weights)

All of it is free to use - the licences are in docs/credits.md. Nothing here
is committed: re-run this on a new machine.
"""
import glob
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile

import work

UA = {"User-Agent": "Mozilla/5.0"}
D = work.DATA

# BigSoundBank (Joseph Sardin, CC0): sound ids.
BSB = ("0148 0322 0359 0387 0437 0457 0486 0550 0616 0952 1022 1023 1103 1121 1153 1302 1345 1490 1774 1776 "
       "1807 2106 2107 2108 2110 2118 2195 2452 2460 2681").split()

# OpenGameArt packs (slug); laughs go into one folder.
OGA = ["100-cc0-metal-and-wood-sfx", "metal-impact-sounds", "rumbling-sound-effects", "2-high-quality-explosions",
       "80-cc0-creture-sfx-2", "hungry-ghoul", "ghost-monster-voice-moaning-growling", "female-screams",
       "elevator-ding", "old-elevator-door", "voices-sound-effects-library", "horror-sound-effects-library",
       "male-gruntyelling-sounds", "female-rpg-voice-starter-pack", "female-hurt-grunts-groans", "grunts-male-death-and-pain"]
LAUGHS = ["maniacal-laughter-pack-1", "evil-laughter", "evil-cackle-laugh-1"]

# Kevin MacLeod (incompetech.com, CC BY 4.0).
MUSIC = ["Nerves", "Big Mojo", "Darkness is Coming", "Rocket", "Black Vortex", "Space Fighter Loop", "Lost Time"]


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


def oga_files(slug):
    s = get(f"https://opengameart.org/content/{slug}").decode("utf8", "replace")
    return sorted({f for f in re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+)"', s)
                   if not f.lower().endswith((".css", ".png", ".jpg", ".gif"))})


def unpack(path):
    folder = os.path.join(os.path.dirname(path), "x")
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            z.extractall(folder)
    elif path.endswith(".7z"):
        import py7zr
        with py7zr.SevenZipFile(path) as z:
            z.extractall(folder)
    else:
        return
    os.remove(path)


def recordings():
    os.makedirs(os.path.join(D, "bsb"), exist_ok=True)
    for sid in BSB:
        dst = os.path.join(D, "bsb", f"bsb-{sid}.mp3")
        if not os.path.exists(dst):
            open(dst, "wb").write(get(f"https://bigsoundbank.com/UPLOAD/mp3/{sid}.mp3"))
    for slug in OGA:
        folder = os.path.join(D, "oga", slug)
        if os.path.isdir(folder):
            continue
        os.makedirs(folder)
        for f in oga_files(slug):
            dst = os.path.join(folder, urllib.parse.unquote(f.split("/")[-1]))
            open(dst, "wb").write(get(f))
            unpack(dst)
    os.makedirs(os.path.join(D, "oga", "laughs"), exist_ok=True)
    for slug in LAUGHS:
        for f in oga_files(slug):
            dst = os.path.join(D, "oga", "laughs", f"{slug}__{urllib.parse.unquote(f.split('/')[-1]).replace(' ', '_')}")
            if not os.path.exists(dst):
                open(dst, "wb").write(get(f))
    print("recordings: done")


def music():
    os.makedirs(os.path.join(D, "music"), exist_ok=True)
    for title in MUSIC:
        dst = os.path.join(D, "music", f"{title}.mp3")
        if not os.path.exists(dst):
            open(dst, "wb").write(get("https://incompetech.com/music/royalty-free/mp3-royaltyfree/" + urllib.parse.quote(title + ".mp3")))
    print("music: done")


def nigerian_english():
    """OpenSLR 70 (Google, CC BY-SA 4.0), the male speakers: Okoro's voice, and the accent check."""
    folder = os.path.join(D, "ng_male")
    if os.path.isdir(folder):
        return
    z = os.path.join(D, "en_ng_male.zip")
    subprocess.run(["curl", "-sSL", "-o", z, "https://www.openslr.org/resources/70/en_ng_male.zip"], check=True)
    with zipfile.ZipFile(z) as f:
        f.extractall(folder)
    os.remove(z)
    print("OpenSLR 70: done")


def american_reference():
    """A dozen plain reads by Expresso's ex01 (Meta, CC BY-NC 4.0) - the "not Nigerian" side of the accent check."""
    out = os.path.join(D, "expresso", "wav")
    if len(glob.glob(os.path.join(out, "ex01_default_*.wav"))) >= 12:
        return
    from huggingface_hub import hf_hub_download
    import pyarrow.parquet as pq
    shard = hf_hub_download("ylacombe/expresso", "read/train-00000-of-00012.parquet", repo_type="dataset",
                            local_dir=os.path.join(D, "expresso"))
    t = pq.read_table(shard).to_pandas()
    t = t[(t["style"] == "default") & (t["speaker_id"] == "ex01")].head(12)
    os.makedirs(out, exist_ok=True)
    for _, r in t.iterrows():
        open(os.path.join(out, f"{r['id']}.wav"), "wb").write(r["audio"]["bytes"])
    os.remove(shard)


def breaths():
    """Single breaths cut from BigSoundBank's breathing recordings, for Okoro's pauses."""
    import numpy as np
    import soundfile as sf
    import finish as F
    out = os.path.join(D, "breaths")
    if os.path.isdir(out):
        return
    os.makedirs(out)
    for sid, tag in (("1103", "man"), ("1345", "woman"), ("2195", "man-slow")):
        y = F.load(os.path.join(D, "bsb", f"bsb-{sid}.mp3"), 24000)
        hop = 240
        rms = np.sqrt(np.mean(y[: len(y) // hop * hop].reshape(-1, hop) ** 2, axis=1) + 1e-12)
        db = 20 * np.log10(rms)
        on = db > np.percentile(db, 15) + 10
        k, i = 0, 0
        while i < len(on):
            if not on[i]:
                i += 1
                continue
            j = i
            while j < len(on) and (on[j] or (j + 6 < len(on) and on[j:j + 6].any())):
                j += 1
            a, b = i * hop, j * hop
            if 0.15 <= (b - a) / 24000 <= 1.2:
                seg = y[max(0, a - 720): b + 1440].copy()
                f = 360
                seg[:f] *= np.linspace(0, 1, f)
                seg[-f:] *= np.linspace(1, 0, f)
                sf.write(os.path.join(out, f"{tag}-{k:02d}.wav"), seg, 24000)
                k += 1
            i = j


def engines():
    """VoiceStudio (its OmniVoice package) and the VoxCPM2 weights (its VoxCPM2 engine)."""
    from huggingface_hub import snapshot_download
    os.makedirs(work.EXT, exist_ok=True)
    vs = os.path.join(work.EXT, "VoiceStudio")
    if not os.path.isdir(vs):
        subprocess.run(["git", "clone", "--depth", "1", "https://github.com/debpalash/VoiceStudio", vs], check=True)
    snapshot_download("k2-fsa/OmniVoice")
    snapshot_download("openbmb/VoxCPM2", local_dir=os.path.join(work.EXT, "VoxCPM2"))
    print("engines: done")


if __name__ == "__main__":
    if sys.argv[1:] == ["engines"]:
        engines()
    else:
        recordings()
        music()
        nigerian_english()
        american_reference()
        breaths()
