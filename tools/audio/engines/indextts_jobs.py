"""Run a list of IndexTTS 2.5 jobs - VoiceStudio's emotion engine - on the CPU.

    <index-tts venv>/bin/python engines/indextts_jobs.py jobs.json

jobs.json: [{"out": "x.wav", "text": "...", "spk": "speaker.wav",
             "emo_vector": [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm],
             "emo_audio": "e.wav", "emo_alpha": 0.8, "seed": 1}]

Needs the IndexTTS checkout VoiceStudio pins (work.EXT/index-tts, revision
bf2e967, in its own Python 3.11 venv with transformers<5) and the
IndexTeam/IndexTTS-2.5 weights in its checkpoints/. Like VoiceStudio, it
points the shipped config's training-machine paths at the local weights.
"""
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import work  # noqa: E402

REPO = os.path.join(work.EXT, "index-tts")
sys.path.insert(0, REPO)

import numpy as np  # noqa: E402
import torch  # noqa: E402
from omegaconf import OmegaConf  # noqa: E402

from indextts.infer_v2_5 import IndexTTS2  # noqa: E402

torch.set_num_threads(int(os.environ.get("GEN_THREADS", os.cpu_count() or 4)))

local_cfg = os.path.join(REPO, "checkpoints", "config.local.yaml")
if not os.path.exists(local_cfg):
    cfg = OmegaConf.load(os.path.join(REPO, "checkpoints", "config.yaml"))
    cfg["gpt_checkpoint"], cfg["s2mel_checkpoint"] = "gpt.pth", "s2mel.pth"
    OmegaConf.save(cfg, local_cfg)

jobs = json.load(open(os.path.abspath(sys.argv[1])))
os.chdir(REPO)
t0 = time.time()
tts = IndexTTS2(cfg_path="checkpoints/config.local.yaml", model_dir="checkpoints", device="cpu")
print(f"loaded in {time.time() - t0:.0f}s", flush=True)

for job in jobs:
    if os.path.exists(job["out"]) and not job.get("force"):
        continue
    seed = job.get("seed", 0)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    os.makedirs(os.path.dirname(job["out"]), exist_ok=True)
    t = time.time()
    tts.infer(spk_audio_prompt=job["spk"], text=job["text"], output_path=job["out"], lang=job.get("lang", "en"),
              emo_audio_prompt=job.get("emo_audio"), emo_alpha=job.get("emo_alpha", 1.0),
              emo_vector=job.get("emo_vector"), use_random=False, verbose=False)
    print(f"{job['out']}: done in {time.time() - t:.0f}s", flush=True)
