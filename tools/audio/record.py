"""Record every line with VoiceStudio's engines, judge the takes, keep the best, finish them.

    node tools/audio/export-lines.mjs > lines.json
    python record.py gen     --lines lines.json [--only REGEX]   the takes (OmniVoice, then VoxCPM2)
    python record.py judge   --lines lines.json [--only REGEX]   measure every take (listen.py)
    python record.py perfect --lines lines.json [--only REGEX]   more takes where no take has every word right
    python record.py pick    --lines lines.json [--only REGEX]   choose, finish -> work/vs/out
    python record.py laughs                                       Vale's laughs, from real laughter
    python record.py install                                      into assets/ and src/audio/voice-lines.js

--only is a regular expression on `who|text`. HALCYON is not re-recorded:
her lines (Kokoro, from the earlier version) are kept as they are.

The cast (references in refs/):
  okoro    VoxCPM2, his voice cloned from a Nigerian English speaker (OpenSLR 70,
           speaker 07049) and directed scene by scene - talking, not reading:
           the reference gives the voice, the direction the delivery. Also
           the briefing (his confession). Best of the takes by the words all
           heard + energy + Nigerian accent + how much the voice moves
  vale     VoxCPM2, a designed deep British voice, directed: cold and amused,
           or gleeful; the tower's PA; real laughter
  pilot    Vale's voice, calm, over the radio
  you-f/m  OmniVoice, each character's own designed voice
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

import numpy as np
import soundfile as sf

import work
import finish as F

SR = F.SR
TAKES = os.path.join(work.VS, "takes")
OUT = os.path.join(work.VS, "out")
REF = lambda name: os.path.join(work.REFS, name)  # noqa: E731
OMNI_PY = os.environ.get("OMNI_PYTHON", sys.executable)
VOX_PY = os.environ.get("VOX_PYTHON", sys.executable)

# ---------------------------------------------------------------- the cast

NG_REF = (REF("ng_07049_hot.flac"), open(REF("ng_07049_hot.txt")).read().strip())
VALE_REF = REF("vale.flac")
YOU_REF = {g: (REF(f"you-{g}.flac"), open(REF(f"you-{g}.txt")).read().strip()) for g in "fm"}

# Okoro, scene by scene: the direction (how he says it - the reference only
# gives his voice), and a breath before he speaks where he is out of breath
# (which breathing, how many, how loud). No breaths between his sentences:
# they talk, they don't pause to breathe.
OKORO = {
    "briefing":    dict(direction="a Nigerian doctor recording a secret confession late at night, low, tired and urgent, "
                                  "speaking naturally and personally to one listener, not reading"),
    "wake":        dict(direction="a Nigerian doctor, worried and gentle, speaking softly but urgently to a patient "
                                  "who is waking up, natural and conversational"),
    "walkOut":     dict(direction="a Nigerian doctor, tense and low-voiced, leading someone down a dark corridor"),
    "foundryTalk": dict(direction="a Nigerian doctor, out of breath, talking to the person running beside him, "
                                  "urgent, natural conversation", breath=("man", 1, 0.45)),
    "liftFault":   dict(direction="a Nigerian doctor, panicking, shouting over screeching machinery"),
    "liftBreaks":  dict(direction="a Nigerian doctor, shouting urgent orders over screeching machinery"),
    "liftSaved":   dict(direction="a Nigerian doctor, breathless and relieved, quietly amazed", breath=("man", 2, 0.45)),
    "breach":      dict(direction="a Nigerian doctor, horrified and frightened, talking fast"),
    "bendAttack":  dict(direction="a Nigerian doctor, screaming in panic"),
    "bendSaved":   dict(direction="a Nigerian doctor, breathless and worried, checking on someone", breath=("man", 1, 0.45)),
    "hide":        dict(direction="a Nigerian doctor, whispering, terrified, hiding behind a desk, speaking tenderly "
                                  "to someone he cares about"),
}
HIDE_SHOUTS = {"Now - GO!", "OVER HERE! COME ON, OVER HERE!"}
SHOUTING = "a Nigerian doctor, shouting as loud as he can to draw the monsters away from someone"

VALE_COLD = "a calm, cold, menacing British man speaking over a building's intercom, relaxed and conversational, quietly amused"
VALE_GLEE = "a British man over an intercom, gleeful and mocking, enjoying himself, conversational"
VALE_CLOSE = "a calm British man, quietly triumphant and menacing, speaking face to face, conversational"
VALE_CLOSE_GLEE = "a British man, smug and delighted with himself, speaking face to face, conversational"
VALE_GLEEFUL = {  # the rest are cold
    "He was right. Anaesthesia to the roof in thirty minutes. I couldn't have designed a better field test.",
    "Don't worry about the tower. Fire is very good at keeping secrets.",
    "Did you think I'd leave the roof unguarded? Say hello to my children.",
    "Run all you like. Everything you are, I made.",
}
PILOT = {"ending": "a calm, pleasant helicopter pilot talking to a passenger over the engine noise, friendly",
         "quietRideRadio": "a helicopter pilot calling over a crackling radio, calm and professional, a little urgent"}

# Laughter after these lines (which laugh).
VALE_LAUGHS = {
    "Enjoy your last half hour.": "chuckle",
    "Run all you like. Everything you are, I made.": "chuckle",
    "Lights out, Seven. My patients never needed them.": "chuckle",
    "Did you think I'd leave the roof unguarded? Say hello to my children.": "cackle",
    "Break every lock you like, Seven. The charges don't care.": "chuckle",
    "The atrium's gone. There's no way down, Seven - and nobody is coming for you.": "chuckle",
}
LAUGH_SOURCES = {  # (recording, seconds kept, semitones): Vale's register
    "chuckle": ("oga/laughs/evil-laughter__qubodupevillaughter.flac", 3.4, -1.0),
    "cackle": ("oga/laughs/maniacal-laughter-pack-1__maniacal_laughter_pack_1.ogg#5", 3.6, -3.0),
    "maniac": ("oga/laughs/evil-cackle-laugh-1__evil_cackle_laugh_1.ogg", 6.5, -3.0),
}
RADIO_FIT = {"quietRideRadio": 3.9}  # the lift's radio has a beat to fit


# Lines a voice kept getting wrong, worded so it says them right (the subtitle is unchanged).
SAY = {"The lift's at the far end of the labs. Go!": "The lift is at the far end of the labs. Go!",
       "You'll want to know what you are. You were Subject Seven. Project Ascension.":
           "You will want to know what you are. You were... Subject Seven. Project Ascension.",
       "Every floor is wired, Seven. I signed the order myself.": "Every floor is wired, Seven. I signed the order... myself.",
       # (Okoro says "Vale's" as "Velle's" at the start of a sentence: spelt as it sounds.)
       "Vale's answer is to bury it. Charges on every floor. The subjects still in their beds. Thirty minutes, and this tower comes down.":
           "Vail's answer is to bury it. Charges on every floor. The subjects still in their beds. Thirty minutes, and this tower comes down."}


def spoken(text):
    """The words as an actor says them (the subtitle keeps the script's spelling)."""
    t = text.replace("Subject 07", "Subject Seven").replace("07", "Seven")
    t = re.sub(r"\bDr\. ", "Doctor ", t)
    t = t.replace(" - ", ", ").replace("--", ", ")
    # Shouted capitals are plain words (or they get spelt out); the subtitle keeps the shout.
    t = re.sub(r"\b([A-Z]{2,})\b", lambda m: m.group(1).lower() if m.group(1) != "OK" else m.group(1), t).strip()
    t = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), t)
    return SAY.get(t, t)


def file_id(key):
    return hashlib.sha1(key.encode("utf8")).hexdigest()[:10]


def direction(line):
    """How the line is said - VoxCPM2 reads it from the (brackets) before the words."""
    who, scene, text = line["who"], line["scene"], line["text"]
    if who == "okoro":
        return SHOUTING if text in HIDE_SHOUTS else OKORO.get(scene, OKORO["breach"])["direction"]
    if who == "vale":
        if scene == "ending":
            return VALE_CLOSE_GLEE if text in VALE_GLEEFUL else VALE_CLOSE
        return VALE_GLEE if text in VALE_GLEEFUL else VALE_COLD
    return PILOT[scene]


def recipe(line):
    """How a line is recorded: (engine, takes, job fields). `text` is what the
    take should say (judged against Whisper); `prompt` what the engine gets."""
    who, scene, text = line["who"], line["scene"], line["text"]
    s = spoken(text)
    if who in ("okoro", "vale", "pilot"):
        ref = NG_REF[0] if who == "okoro" else VALE_REF
        # The briefing's long speeches: one take first (more where a word is missed).
        return "vox", 1 if scene == "briefing" else 2, {"text": s, "prompt": f"({direction(line)}){s}", "ref": ref}
    if who.startswith("you-"):
        ref, rtext = YOU_REF[who[-1]]
        return "omni", 2, {"text": s, "ref_audio": ref, "ref_text": rtext, "speed": 0.92}
    raise ValueError(who)


def all_lines(path):
    out = []
    for l in json.load(open(path)):
        if l["who"] == "halcyon":
            continue
        if l["who"] == "you":  # one recording per character
            out += [{**l, "who": f"you-{g}", "gender": g} for g in "fm"]
        else:
            out.append(l)
    return out


def take_path(line, i):
    # (VoxCPM2's takes apart from the earlier engines' takes of the same lines.)
    sub = "vox" if line["who"] in ("okoro", "vale", "pilot") else ""
    return os.path.join(TAKES, line["who"], sub, f"{file_id(line['key'])}-{i}.wav")


def takes_on_disk(line):
    return [take_path(line, i) for i in range(12) if os.path.exists(take_path(line, i))]


# ---------------------------------------------------------------- stages

def vox_jobs(jobs, procs=None):
    """VoxCPM2 takes, split over VOX_PROCS processes (each loads the model once)."""
    todo = [{"out": j["out"], "text": j["prompt"], "ref": j["ref"], "seed": j["seed"]} for j in jobs if not os.path.exists(j["out"])]
    procs = max(1, min(len(todo), procs or int(os.environ.get("VOX_PROCS", "1"))))
    running = []
    for k in range(procs):
        part = os.path.join(work.VS, f"jobs-vox-{k}.json")
        json.dump(todo[k::procs], open(part, "w"), indent=1)
        if k:  # loading takes about 7 GB for a minute, running 5: one at a time
            time.sleep(150)
        running.append(subprocess.Popen([VOX_PY, os.path.join(work.TOOLS, "engines", "voxcpm_jobs.py"), part]))
    for p in running:
        p.wait()


def gen(lines):
    """The takes. OmniVoice runs one process per line with a time limit, so a
    stalled take costs minutes, not the run."""
    jobs = {"omni": [], "vox": []}
    for l in lines:
        engine, n, job = recipe(l)
        jobs[engine] += [{**job, "out": take_path(l, i), "seed": 100 + i} for i in range(n)]
    os.makedirs(work.VS, exist_ok=True)
    by_line = {}
    for j in jobs["omni"]:
        by_line.setdefault(j["out"].rsplit("-", 1)[0], []).append(j)
    for stem, group in by_line.items():
        group = [j for j in group if not os.path.exists(j["out"])]
        if not group:
            continue
        part = os.path.join(work.VS, "jobs-omni.json")
        json.dump(group, open(part, "w"), indent=1)
        try:
            subprocess.run([OMNI_PY, os.path.join(work.TOOLS, "engines", "omnivoice_jobs.py"), part],
                           check=True, timeout=120 + 150 * len(group))
        except subprocess.TimeoutExpired:
            print(f"TIMEOUT {stem}: kept the takes already made", flush=True)
    if jobs["vox"]:
        vox_jobs(jobs["vox"])


def judge(lines):
    import listen
    path = os.path.join(TAKES, "scores.json")
    cache = json.load(open(path)) if os.path.exists(path) else {}
    for l in lines:
        _, _, job = recipe(l)
        for p in takes_on_disk(l):
            rel = os.path.relpath(p, TAKES)
            if rel in cache:
                continue
            cache[rel] = measure(l, job, p)
            row = cache[rel]
            print(rel, row, flush=True)
            json.dump(cache, open(path, "w"), indent=1)


def measure(line, job, path):
    """What the listener hears in a take."""
    import listen
    heard = listen.words(path)
    row = {"wer": listen.wer(job["text"], heard), "heard": heard, **listen.emotion(path),
           **listen.prosody(path, job["text"])}
    if line["who"] == "okoro":
        row["ng"] = listen.nigerian(path)
    return row


def perfect(lines, extra=6):
    """More takes for any line with no word-perfect take, one at a time, until Whisper hears every word."""
    path = os.path.join(TAKES, "scores.json")
    for line in lines:
        engine, n, job = recipe(line)
        cache = json.load(open(path))
        if any(cache.get(os.path.relpath(p, TAKES), {}).get("wer", 1) == 0 for p in takes_on_disk(line)):
            continue
        print("==", line["who"], line["text"], flush=True)
        for i in range(n, n + extra):
            out = take_path(line, i)
            if not os.path.exists(out) and engine == "vox":
                vox_jobs([{**job, "out": out, "seed": 100 + i}], procs=1)
            elif not os.path.exists(out):
                part = os.path.join(work.VS, "jobs-extra.json")
                json.dump([{**job, "out": out, "seed": 100 + i}], open(part, "w"))
                try:
                    subprocess.run([OMNI_PY, os.path.join(work.TOOLS, "engines", "omnivoice_jobs.py"), part], timeout=420)
                except subprocess.TimeoutExpired:
                    continue
            if not os.path.exists(out):
                continue
            row = measure(line, job, out)
            heard = row["heard"]
            cache = json.load(open(path))
            cache[os.path.relpath(out, TAKES)] = row
            json.dump(cache, open(path, "w"), indent=1)
            print(f"   take {i}: WER {row['wer']:.2f} | {heard}", flush=True)
            if row["wer"] == 0:
                break


def score(who, row):
    """Every word heard first; then what the character needs. A voice that
    moves (pitch range, in semitones) talks; a flat one reads - but not
    gabbling (more than about 7 syllables a second of speech)."""
    if row is None:
        return -9
    s = -2.0 * row["wer"]
    talk = 0.03 * min(row.get("spread", 0), 14) - 0.15 * max(0, row.get("rate", 0) - 7)
    if who == "okoro":  # frightened, Nigerian, talking
        s += row["arousal"] + 0.8 * max(-0.2, min(0.6, row.get("ng", 0))) + talk
    elif who == "vale":  # in command, not kind, talking
        s += row["dominance"] - 0.3 * row["valence"] + talk
    elif who == "pilot":
        s += talk
    return s


def laugh(kind):
    return F.load(os.path.join(work.VS, "laughs", f"{kind}.wav"))


def squelch():
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    return F.band(F.RNG.standard_normal(n).astype(np.float32), 900, 4000) * np.exp(-t * 40) * 0.25


def finish_line(line, y):
    who, scene, text = line["who"], line["scene"], line["text"]
    y = F.trim(y)
    if who == "okoro":
        y = F.tighten(F.loud(y, -18))
        breath = OKORO.get(scene, OKORO["breach"]).get("breath")
        if breath and text not in HIDE_SHOUTS:
            kind, lead, gain = breath
            y = F.breathe(y, kind, lead, 0, gain)
        speech = len(y) / SR
        if scene == "briefing":  # his recording: close to the microphone, a small office
            return F.loud(F.room(y, rt=0.3, wet=0.04), -17.5), speech
        return F.loud(F.room(y, rt=0.45, wet=0.05), -18), speech
    if who == "vale":
        y = F.tighten(F.loud(y, -18))
        if text in VALE_LAUGHS:
            y = np.concatenate([y, np.zeros(int(0.15 * SR), np.float32), F.loud(laugh(VALE_LAUGHS[text]), -19)])
        speech = len(y) / SR
        if scene == "ending":  # in the helicopter, close
            return F.loud(F.room(y, rt=0.35, wet=0.05), -16.5), speech
        return F.loud(F.pa(y), -17), speech
    if who == "pilot":
        fit = RADIO_FIT.get(scene)
        if fit and len(y) / SR > fit:
            y = F.pitch(y, 0, tempo=(len(y) / SR) / fit)
        if scene == "quietRideRadio":
            y = np.concatenate([squelch(), np.zeros(int(0.03 * SR), np.float32), F.radio(y), squelch()])
        else:
            y = F.band(y, 150, 6000)
        return F.loud(y, -19), len(y) / SR
    if who.startswith("you-"):
        speech = len(y) / SR
        return F.loud(F.room(y, rt=0.3, wet=0.04), -18), speech
    raise ValueError(who)


def pick(lines):
    scores = json.load(open(os.path.join(TAKES, "scores.json")))
    man_path = os.path.join(OUT, "voice-lines.json")
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    for line in lines:
        best, best_s = None, -99
        takes = takes_on_disk(line)
        perfect = [p for p in takes if scores.get(os.path.relpath(p, TAKES), {}).get("wer", 1) == 0]
        for p in perfect or takes:  # a word-perfect take always wins
            s = score(line["who"], scores.get(os.path.relpath(p, TAKES)))
            if s > best_s:
                best, best_s = p, s
        if best is None:
            print("no take for", line["key"])
            continue
        y, speech = finish_line(line, F.load(best))
        if line["who"].startswith("you-"):
            base = f"you-{file_id(line['key'])}"
            name, entry = f"{base}-{line['gender']}", [base, round(speech, 2), round(len(y) / SR, 2), 1]
            if line["key"] in manifest:  # one entry for both characters: the longer
                entry[1] = max(entry[1], manifest[line["key"]][1])
                entry[2] = max(entry[2], manifest[line["key"]][2])
        else:
            name = f"{line['who']}-{file_id(line['key'])}"
            entry = [name, round(speech, 2), round(len(y) / SR, 2)]
        F.save_mp3(y, os.path.join(OUT, "voice", name + ".mp3"))
        manifest[line["key"]] = entry
        print(f"{name}: {os.path.basename(best)} (score {best_s:.2f}), {entry[1]:.2f}s", flush=True)
        json.dump(manifest, open(man_path, "w"), indent=1)


def laughs():
    """Vale's laughs from real laughter (CC0), lowered into his register."""
    os.makedirs(os.path.join(work.VS, "laughs"), exist_ok=True)
    man_path = os.path.join(OUT, "voice-lines.json")
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    for kind, (src, keep, semis) in LAUGH_SOURCES.items():
        path, _, part = src.partition("#")
        y = F.load(os.path.join(work.DATA, path))
        if part:  # one laugh out of a pack of them
            import sounds_build
            a, b = sounds_build.segments(y, 40, min_gap=0.4)[int(part)]
            y = y[max(0, a - 2400): b + 4800]
        y = F.trim(F.pitch(F.trim(y)[: int(keep * SR)], semis))
        nb = int(0.2 * SR)
        y[-nb:] *= np.linspace(1, 0, nb)
        # The raw laugh, as wav: the lines append it before their PA.
        sf.write(os.path.join(work.VS, "laughs", f"{kind}.wav"), y, SR)
        if kind in ("maniac", "cackle"):  # the cues: close, in the cabin
            speech = len(y) / SR
            z = F.loud(F.room(y, rt=0.35, wet=0.06), -17)
            F.save_mp3(z, os.path.join(OUT, "voice", f"vale-laugh-{kind}.mp3"))
            manifest[f"#laugh-{kind}"] = [f"vale-laugh-{kind}", round(speech, 2), round(len(z) / SR, 2)]
        print(kind, f"{len(y) / SR:.2f}s")
    os.makedirs(OUT, exist_ok=True)
    json.dump(manifest, open(man_path, "w"), indent=1)


def read_manifest(path):
    text = open(path, encoding="utf8").read()
    return {json.loads(k): json.loads(v) for k, v in re.findall(r'^  (".*"): (\[[^\]]*\]),?$', text, re.M)}


def install(order_from):
    """The finished lines into assets/audio/voice and src/audio/voice-lines.js (HALCYON's kept)."""
    js = os.path.join(work.ROOT, "src", "audio", "voice-lines.js")
    old = read_manifest(js)
    new = json.load(open(os.path.join(OUT, "voice-lines.json")))
    merged = {**{k: v for k, v in old.items() if k.startswith("halcyon|")}, **new}
    order = {l["key"]: i for i, l in enumerate(json.load(open(order_from)))}
    # Only what the game still says (a line reworded or recast leaves its old recording behind).
    merged = {k: v for k, v in merged.items() if k in order or k.startswith("#")}
    merged = dict(sorted(merged.items(), key=lambda kv: (order.get(kv[0], -1 if kv[0].startswith("#") else 9999), kv[0])))
    vdir = os.path.join(work.ASSETS, "voice")
    wanted = set()
    for v in merged.values():
        wanted.update(f + ".mp3" for f in ([f"{v[0]}-f", f"{v[0]}-m"] if len(v) > 3 and v[3] else [v[0]]))
    for f in os.listdir(os.path.join(OUT, "voice")):
        if f in wanted:
            shutil.copy(os.path.join(OUT, "voice", f), os.path.join(vdir, f))
    for f in os.listdir(vdir):
        if f.endswith(".mp3") and f not in wanted:
            os.remove(os.path.join(vdir, f))
    missing = sorted(w for w in wanted if not os.path.exists(os.path.join(vdir, w)))
    if missing:
        print("MISSING", missing)
    body = ",\n".join(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v)}" for k, v in merged.items())
    with open(js, "w") as f:
        f.write(
            "/**\n"
            " * Generated by tools/audio/record.py - do not edit by hand.\n"
            " *\n"
            " * Every voiced line, keyed by `who|text` exactly as in the script:\n"
            " *   [file (assets/audio/voice/<file>.mp3), seconds of speech, seconds in all, gendered]\n"
            " * `gendered` lines have -f and -m files (the character picked). A line\n"
            " * whose text has changed since it was recorded is not here: it falls back\n"
            " * to the voice blip until it is recorded again.\n"
            " */\n\n"
            f"export const VOICE_LINES = {{\n{body},\n}};\n"
        )
    print(len(merged), "lines in the manifest")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["gen", "judge", "perfect", "pick", "laughs", "install"])
    ap.add_argument("--lines", default=os.path.join(work.VS, "lines.json"))
    ap.add_argument("--only")
    a = ap.parse_args()
    if a.stage == "laughs":
        laughs()
    elif a.stage == "install":
        install(a.lines)
    else:
        rx = re.compile(a.only) if a.only else None
        sel = [l for l in all_lines(a.lines) if not rx or rx.search(f"{l['who']}|{l['text']}")]
        {"gen": gen, "judge": judge, "perfect": perfect, "pick": pick}[a.stage](sel)
