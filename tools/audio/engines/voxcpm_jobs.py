"""Run a list of VoxCPM2 jobs - VoiceStudio's VoxCPM2 engine - on the CPU.

    python engines/voxcpm_jobs.py jobs.json

jobs.json: [{"out": "x.wav", "text": "(direction)the words", "ref": "r.flac", "seed": 1}]

Controllable cloning: the reference recording gives the voice, the
(direction) at the start of the text gives the delivery - so a speaker who
only ever read sentences aloud can still talk, shout or whisper (VoiceStudio
docs/engines/voxcpm2.md). Weights: openbmb/VoxCPM2 in work.EXT/VoxCPM2
(sources.py engines). GEN_THREADS sets the CPU threads.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import work  # noqa: E402

import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from voxcpm import VoxCPM  # noqa: E402

torch.set_num_threads(int(os.environ.get("GEN_THREADS", os.cpu_count() or 4)))

t0 = time.time()
model = VoxCPM.from_pretrained(os.path.join(work.EXT, "VoxCPM2"), load_denoiser=False)
SR = model.tts_model.sample_rate
print(f"loaded in {time.time() - t0:.0f}s", flush=True)

STEPS_PER_SECOND = 6.25  # 16 kHz / 640 per latent frame / 4 frames a step


def longest(words):
    """The most a line can take: 2 syllables a second (slow), and a breath."""
    syl = sum(max(1, len(re.findall(r"[aeiouy]+", w))) for w in re.findall(r"[a-z']+", words.lower()))
    return syl / 2.0 + 1.5


for job in json.load(open(sys.argv[1])):
    if os.path.exists(job["out"]) and not job.get("force"):
        continue
    # The engine caps a take by the length of its whole text - the direction
    # included - so a take that never stops can run for half an hour. Capped
    # by the words instead, a runaway is cut short and taken again.
    words = job["text"].split(")", 1)[-1] if job["text"].startswith("(") else job["text"]
    limit = longest(words)
    t = time.time()
    for attempt in range(3):
        torch.manual_seed(job.get("seed", 0) + 1000 * attempt)
        wav = model.generate(text=job["text"], reference_wav_path=job["ref"], cfg_value=job.get("cfg", 2.0),
                             inference_timesteps=job.get("steps", 10), max_len=int(limit * STEPS_PER_SECOND) + 4,
                             retry_badcase=False)
        if len(wav) / SR < limit - 0.3:
            break
        print(f"{job['out']}: ran to the limit ({limit:.1f}s) - again", flush=True)
    os.makedirs(os.path.dirname(job["out"]) or ".", exist_ok=True)
    sf.write(job["out"], wav, SR)
    print(f"{job['out']}: {len(wav) / SR:.2f}s audio in {time.time() - t:.0f}s", flush=True)
