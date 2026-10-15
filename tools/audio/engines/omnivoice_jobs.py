"""Run a list of OmniVoice jobs - VoiceStudio's default engine - on the CPU.

    python engines/omnivoice_jobs.py jobs.json

jobs.json: [{"out": "x.wav", "text": "...", "instruct": "...", "ref_audio": "r.wav",
             "ref_text": "...", "speed": 1.0, "seed": 1, "num_step": 32, ...}]

Uses the `omnivoice` package from a VoiceStudio checkout (work.EXT/VoiceStudio)
and the k2-fsa/OmniVoice weights. GEN_THREADS sets the CPU threads (leave a
core free if anything else runs: oversubscribed, generation crawls).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import work  # noqa: E402

sys.path.insert(0, os.path.join(work.EXT, "VoiceStudio"))

import torch  # noqa: E402
import torchaudio  # noqa: E402
from omnivoice.models.omnivoice import OmniVoice  # noqa: E402

torch.set_num_threads(int(os.environ.get("GEN_THREADS", os.cpu_count() or 4)))
GEN_KEYS = ("num_step", "guidance_scale", "t_shift", "position_temperature", "class_temperature",
            "layer_penalty_factor", "denoise", "postprocess_output")

t0 = time.time()
model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cpu", dtype=torch.float32)
print(f"loaded in {time.time() - t0:.0f}s", flush=True)

prompts = {}
for job in json.load(open(sys.argv[1])):
    if os.path.exists(job["out"]) and not job.get("force"):
        continue
    torch.manual_seed(job.get("seed", 0))
    kw = {k: job[k] for k in GEN_KEYS if k in job}
    kw.setdefault("num_step", 32)
    if job.get("ref_audio"):
        key = (job["ref_audio"], job.get("ref_text"))
        if key not in prompts:
            prompts[key] = model.create_voice_clone_prompt(job["ref_audio"], ref_text=job.get("ref_text"))
        kw["voice_clone_prompt"] = prompts[key]
    t = time.time()
    audio = model.generate(text=job["text"], language=job.get("language", "English"),
                           instruct=job.get("instruct"), speed=job.get("speed"),
                           duration=job.get("duration"), **kw)[0]
    os.makedirs(os.path.dirname(job["out"]) or ".", exist_ok=True)
    torchaudio.save(job["out"], audio, model.sampling_rate)
    print(f"{job['out']}: {audio.shape[-1] / model.sampling_rate:.2f}s audio in {time.time() - t:.0f}s", flush=True)
