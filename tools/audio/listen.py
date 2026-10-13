"""The machine listener: what a take sounds like, measured - so takes can be
chosen, and sounds checked, without anyone having to listen to all of them.

  words(path)    the words Whisper (medium.en) hears; wer() against the script
  emotion(path)  arousal (energy), dominance, valence, 0..1 (audEERING's
                 MSP-Podcast model)
  nigerian(path) how much nearer a line's accent is to Nigerian English than to
                 American (CommonAccent ECAPA embeddings, against the eleven other
                 Nigerian speakers of OpenSLR 70 and an American speaker of Expresso)
  tags(path)     AudioSet sound events (AST): "Screaming", "Explosion", "Laughter"...

    python listen.py words|emotion|tags|nigerian a.wav ...
"""
import json
import os
import glob
import re
import sys
import warnings

warnings.filterwarnings("ignore")
import work  # noqa: E402  (sets HF_HOME)

import numpy as np
import librosa

_whisper = _accent = _ast = None


def load(path, sr=16000):
    y, _ = librosa.load(path, sr=sr, mono=True)
    return y


def words(path):
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel("medium.en", device="cpu", compute_type="int8")
    segs, _ = _whisper.transcribe(path, beam_size=5, language="en", vad_filter=False)
    return " ".join(s.text.strip() for s in segs)


NUMBERS = {"07": "seven", "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
           "7": "seven", "8": "eight", "9": "nine", "10": "ten", "30": "thirty", "40": "forty"}
SPELLING = {"programme": "program", "anaesthesia": "anesthesia", "anaesthetic": "anesthetic", "anaesthetics": "anesthetics",
            "catalogued": "cataloged", "okay": "ok", "mr": "mister", "dr": "doctor", "round": "around"}
CONTRACTIONS = {"it's": "it is", "they're": "they are", "you'll": "you will", "that's": "that is", "i'm": "i am",
                "we're": "we are", "you're": "you are", "there's": "there is", "he's": "he is", "what's": "what is",
                "i'd": "i would", "you've": "you have", "i've": "i have", "let's": "let us", "who's": "who is",
                "anaesthetic's": "anesthetic is", "anesthetic's": "anesthetic is", "atrium's": "atrium is",
                "lift's": "lifts", "vale's": "vale is", "can't": "cannot"}
COMPOUNDS = [("lift off", "liftoff"), ("half hour", "halfhour"), ("sky bridge", "skybridge"), ("x ray", "xray"),
             ("heli pad", "helipad"), ("any one", "anyone"), ("every one", "everyone")]


def norm(t):
    """Words as spoken, so spelling, digits and contractions don't count as errors."""
    t = t.lower().replace("\u2019", "'").replace("-", " ")
    t = re.sub(r"\b(\d+)\b", lambda m: NUMBERS.get(m.group(1), m.group(1)), t)
    words = []
    for w in re.findall(r"[a-z0-9']+", t):
        w = w.strip("'")
        w = CONTRACTIONS.get(w, w)
        for x in w.split():
            words.append(SPELLING.get(x, x))
    t = " ".join(words)
    for a, b in COMPOUNDS:
        t = t.replace(a, b)
    return t.split()


def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = np.zeros((len(r) + 1, len(h) + 1), int)
    d[:, 0] = range(len(r) + 1)
    d[0, :] = range(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(r), len(h)] / max(1, len(r))


def accent(path, top=3, scores=False):
    global _accent
    if _accent is None:
        from speechbrain.inference.classifiers import EncoderClassifier
        _accent = EncoderClassifier.from_hparams(
            source="Jzuluaga/accent-id-commonaccent_ecapa",
            savedir=os.path.join(work.WORK, "hf", "sb-accent"))
    import torch
    sig = torch.tensor(load(path)).unsqueeze(0)
    out = _accent.classify_batch(sig)
    # The classifier scores are cosine similarities (AAM-softmax, scale 30).
    probs = (out[0].reshape(-1) * 30).softmax(-1)
    labels = _accent.hparams.label_encoder
    if scores:
        return {labels.decode_ndim(i): float(probs[i]) for i in range(len(probs))}
    idx = probs.argsort(descending=True)[:top]
    return [(labels.decode_ndim(int(i)), round(float(probs[i]), 3)) for i in idx]


def accent_embedding(path):
    accent(path)  # loads the model
    import torch
    e = _accent.encode_batch(torch.tensor(load(path)).unsqueeze(0)).reshape(-1).numpy()
    return e / np.linalg.norm(e)


def _mean(es):
    m = np.mean(es, 0)
    return m / np.linalg.norm(m)


_CENTROIDS = None


def _centroids():
    """Accent fingerprints: each OpenSLR 70 Nigerian speaker, and an American speaker (Expresso ex01)."""
    global _CENTROIDS
    if _CENTROIDS is None:
        cache = os.path.join(work.DATA, "accent-centroids.npy")
        if os.path.exists(cache):
            _CENTROIDS = np.load(cache, allow_pickle=True).item()
        else:
            ng = {}
            for f in sorted(glob.glob(os.path.join(work.DATA, "ng_male", "*.wav"))):
                ng.setdefault(f.split("_")[-2], []).append(f)
            rng = np.random.default_rng(1)
            speakers = {k: [accent_embedding(f) for f in rng.choice(v, min(12, len(v)), replace=False)] for k, v in ng.items()}
            us = [accent_embedding(f) for f in sorted(glob.glob(os.path.join(work.DATA, "expresso", "wav", "ex01_default_*.wav")))[:12]]
            _CENTROIDS = {"ng": speakers, "us": _mean(us)}
            np.save(cache, _CENTROIDS, allow_pickle=True)
    return _CENTROIDS


def nigerian(path, exclude="07049"):
    """Nearness to Nigerian English minus nearness to American (Okoro's own speaker left out)."""
    c = _centroids()
    e = accent_embedding(path)
    ng = _mean([x for k, v in c["ng"].items() if k != exclude for x in v])
    return float(e @ ng) - float(e @ c["us"])


def tags(path, top=5):
    global _ast
    if _ast is None:
        from transformers import pipeline
        _ast = pipeline("audio-classification", model="MIT/ast-finetuned-audioset-10-10-0.4593", device="cpu")
    out = _ast(load(path), top_k=top)
    return [(o["label"], round(o["score"], 3)) for o in out]


if __name__ == "__main__":
    mode, args = sys.argv[1], sys.argv[2:]
    if mode == "all":
        for job in json.load(open(args[0])):
            if not os.path.exists(job["out"]):
                continue
            heard = words(job["out"])
            print(f"{os.path.basename(job['out'])}: WER {wer(job['text'], heard):.2f} | {heard}")
            if job.get("judge_accent"):
                print("   accent", accent(job["out"]))
            if job.get("judge_emotion"):
                print("   emotion", emotion(job["out"]))
            if job.get("judge_tags"):
                print("   tags", tags(job["out"]))
    else:
        for p in args:
            if mode == "words":
                print(p, "|", words(p))
            elif mode == "accent":
                print(p, accent(p))
            elif mode == "emotion":
                print(p, emotion(p))
            elif mode == "nigerian":
                print(p, round(nigerian(p), 3))
            elif mode == "tags":
                print(p, tags(p))


_ser = None


def emotion(path):
    """Arousal (energy), dominance and valence, each 0..1 (audEERING's MSP-Podcast model)."""
    global _ser
    import torch
    import torch.nn as nn
    from transformers import Wav2Vec2Processor
    from transformers.models.wav2vec2.modeling_wav2vec2 import Wav2Vec2Model, Wav2Vec2PreTrainedModel

    class RegressionHead(nn.Module):
        def __init__(self, config):
            super().__init__()
            self.dense = nn.Linear(config.hidden_size, config.hidden_size)
            self.dropout = nn.Dropout(config.final_dropout)
            self.out_proj = nn.Linear(config.hidden_size, config.num_labels)

        def forward(self, x):
            return self.out_proj(self.dropout(torch.tanh(self.dense(self.dropout(x)))))

    class EmotionModel(Wav2Vec2PreTrainedModel):
        def __init__(self, config):
            super().__init__(config)
            self.wav2vec2 = Wav2Vec2Model(config)
            self.classifier = RegressionHead(config)
            self.post_init()

        def forward(self, x):
            h = self.wav2vec2(x)[0].mean(dim=1)
            return self.classifier(h)

    if _ser is None:
        name = "audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim"
        _ser = (Wav2Vec2Processor.from_pretrained(name), EmotionModel.from_pretrained(name).eval())
    proc, model = _ser
    y = proc(load(path), sampling_rate=16000)["input_values"][0]
    with torch.no_grad():
        a, d, v = model(torch.tensor(y).reshape(1, -1))[0].tolist()
    return {"arousal": round(a, 2), "dominance": round(d, 2), "valence": round(v, 2)}
