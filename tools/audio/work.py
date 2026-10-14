"""Where the audio tools keep things.

The downloads (VoiceStudio's engines and their weights, the recordings,
the music) and every take live in a work folder outside git - by default
`.audio-work/` at the repository root, or wherever AUDIO_WORK points. The
reference voices the cast is cloned from are committed, in `refs/`.
"""
import os

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(TOOLS, "..", ".."))
WORK = os.environ.get("AUDIO_WORK", os.path.join(ROOT, ".audio-work"))
DATA = os.path.join(WORK, "data")      # recordings and music (sources.py)
EXT = os.path.join(WORK, "ext")        # VoiceStudio's checkout, VoxCPM2's weights
VS = os.path.join(WORK, "vs")          # takes, finished lines, built sounds
REFS = os.path.join(TOOLS, "refs")     # the cast's reference voices (committed)
ASSETS = os.path.join(ROOT, "assets", "audio")

os.environ.setdefault("HF_HOME", os.path.join(WORK, "hf"))
