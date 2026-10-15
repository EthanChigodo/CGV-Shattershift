# Audio tools - the voices, the patients, the effects and the music

Everything under `assets/audio/voice`, `assets/audio/creatures`,
`assets/audio/sfx` and `assets/audio/music` is made by the scripts in this
folder. The game never runs them; it only plays the files.

- **The voices** are acted with [VoiceStudio](https://github.com/debpalash/VoiceStudio)'s
  engines: **VoxCPM2** for Okoro, Vale and the pilot (controllable cloning:
  the reference recording gives the voice, a written direction per scene
  gives the delivery - so they talk, rather than read) and **OmniVoice** (its
  default) for Seven and the patients. Every line is recorded in several
  takes; a machine listener measures each take - the words, the energy, the
  accent, how much the voice moves - and the best one is kept.
- **The patients and the effects** are real recordings (BigSoundBank,
  OpenGameArt), cut, layered, pitched and mastered.
- **The music** is Kevin MacLeod's hybrid orchestral tracks (incompetech.com), cut
  into seamless loops; the briefing's is cut to the film.

Who made every recording, and the licences: `docs/credits.md`.

| Script | What it does |
| --- | --- |
| `export-lines.mjs` | Every line the game speaks (the story script, the Skyline's intercom, the lift's radio, the briefing's captions), as JSON |
| `record.py` | The cast and its direction; records, judges, picks and finishes the lines; installs them with `src/audio/voice-lines.js` |
| `engines/voxcpm_jobs.py`, `engines/omnivoice_jobs.py` | Run a list of takes through each engine |
| `finish.py` | Pitch and time, long pauses tightened, a real breath before Okoro's out-of-breath lines, the tower's PA, the radio, rooms, loudness |
| `listen.py` | The machine listener: Whisper (words), audEERING's emotion model (energy, dominance, valence), an accent fingerprint (Nigerian or not), talking or reading (pitch range, pace), AudioSet tags (what a sound is) |
| `sounds_build.py` | The effects and the patients from real recordings (and the patients' broken speech, from OmniVoice) |
| `music_build.py` | The stage loops, and the briefing's score cut to the film (after the voices: it is timed by Okoro's lines) |
| `sources.py` | Downloads every recording, the tracks, the Nigerian speech set, and the engines |
| `refs/` | The recordings the cast is cloned from (see `refs/README.md`) |

## Setting up (once)

The downloads (about 15 GB with the engines' weights) go in a work folder
outside git: `.audio-work/`, or wherever `AUDIO_WORK` points.

```text
python3.11 -m venv .venv
.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
.venv/bin/pip install "transformers>=5.10" huggingface_hub pydub soundfile numpy scipy librosa \
    pyloudnorm faster-whisper speechbrain pyarrow pandas py7zr pydantic
# VoxCPM2 (only what it needs to speak - its full requirements pull in a web UI and ASR):
.venv/bin/pip install --no-deps voxcpm==2.0.3 einops inflect addict wetext simplejson sortedcontainers argbind
.venv/bin/python tools/audio/sources.py engines      # VoiceStudio (OmniVoice), VoxCPM2, their weights
.venv/bin/python tools/audio/sources.py              # the recordings, the tracks, OpenSLR 70
```

ffmpeg must be on the PATH, built with `libmp3lame` and `rubberband`.

## Making everything

```text
node tools/audio/export-lines.mjs > .audio-work/vs/lines.json
cd tools/audio
VOX_PROCS=2 GEN_THREADS=2 ../../.venv/bin/python record.py gen   # the takes - hours on a CPU
../../.venv/bin/python record.py judge                  # measure them
../../.venv/bin/python record.py perfect                # more takes, until every line has one word-perfect
../../.venv/bin/python record.py laughs                 # Vale's laughs
../../.venv/bin/python record.py pick                   # the best take of each line, finished
../../.venv/bin/python record.py install                # into the game
../../.venv/bin/python sounds_build.py speech           # the patients' broken speech
../../.venv/bin/python sounds_build.py build && ../../.venv/bin/python sounds_build.py install
../../.venv/bin/python music_build.py                    # after install: the briefing is timed by Okoro's lines
```

On a CPU, VoxCPM2 takes about 40 s for each second of speech in a process
of two threads (two such processes on four cores: `VOX_PROCS=2
GEN_THREADS=2`); OmniVoice a minute or two a line. Leave a core free if
anything else runs alongside: oversubscribed, the engines slow to a crawl.
VoxCPM2 caps each take by its own words (`engines/voxcpm_jobs.py`): a take
that doesn't stop is cut short and taken again.

## The cast

| Who | Engine | The performance |
| --- | --- | --- |
| Dr. Okoro | VoxCPM2, his voice from a Nigerian English speaker (OpenSLR 70, speaker 07049) | A Nigerian doctor, terrified, directed scene by scene (`OKORO` in `record.py`): gentle and urgent waking Seven, out of breath talking as he runs, shouting over the lift's machinery, whispering behind the desk - and the briefing, his confession, low and personal. The take kept is the one with every word heard, the most energy and accent, and the voice that moves most |
| Dr. Vale | VoxCPM2, a designed deep British voice | Cold, relaxed and amused - or gleeful when he wins; the tower's PA; real laughter after his taunts, lowered into his register |
| The pilot | VoxCPM2, Vale's voice | Calm and pleasant over the radio (it is Vale) |
| HALCYON | Kokoro (kept from the earlier version) | The building's PA, after a chime |
| Subject 07 | OmniVoice, a designed voice per character | Tired, clear; pain and effort are kept from the earlier version (Kokoro, a held strained vowel - clearer than real recordings were), the fall a real scream |
| The patients | Real recordings; their broken speech from OmniVoice, made monstrous | Growls, moans, shrieks, pain, deaths, the brute's roar, the horde |

Lines are said as an actor would say them: "Subject 07" is "Subject Seven",
"Dr." is "Doctor", shouted capitals are words. A direction goes before the
words in brackets - "(a Nigerian doctor, out of breath, talking to the person
running beside him, urgent, natural conversation)" - and VoxCPM2 plays it
with the reference's voice; the reference's own delivery (Okoro's is read
sentences) doesn't come with it.

## How a take is judged (`listen.py`)

Nobody listens to hundreds of takes, so the machine does, and the numbers
choose:

- **Words**: Whisper transcribes the take; any missing or wrong word costs
  heavily, and a line with no word-perfect take gets more takes until it has
  one (spelling, digits and contractions don't count - "programme" is
  "program", "30" is "thirty"). A line a voice keeps getting wrong can be
  reworded for the voice only (`SAY` in `record.py`; the subtitle keeps the script's words).
- **Energy** (arousal, 0-1): Okoro should be frightened.
- **Talking, not reading**: how far the pitch moves in a line (semitones,
  10th to 90th percentile) and how fast the syllables come. A flat read moves
  about 6-7; directed takes move more, and win - as long as they don't
  gabble (over about 7 syllables a second). A line whose best take moved
  less than 6 got another take. Against the earlier OmniVoice recordings of
  the same lines, Okoro's pitch moves 8.4 semitones on average (was 6.4), his
  lines come about 40% quicker (no breaths laid between his sentences, long
  pauses tightened), with more energy (0.63, was 0.49) and a stronger accent
  score (+0.24, was +0.18); Vale moves 11.0 (was 8.6), calmer and colder
  (energy 0.59, was 0.78).
- **Intensity**: playtesters heard those as one fluid sentence, not people
  in danger. Directed with short emotion tags instead of descriptions of the
  scene (`OKORO`, `VALE_*` in `record.py`), the lines punched up in the
  script, and energy weighted higher in the pick (with more takes, `record.py
  more`, for any line still flat or calm): Okoro's energy 0.75 (was 0.58),
  command 0.77 (was 0.64); Vale's energy 0.45 (was 0.36), command 0.56 (was
  0.49), pitch movement 15.0 (was 13.0). Okoro's accent score is +0.18 (was
  +0.28): still on the Nigerian side - urgency pulls it a little towards
  neutral.
- **Accent**: a take's accent fingerprint (CommonAccent's ECAPA embedding) is
  compared with OpenSLR 70's other Nigerian speakers and an American speaker.
  Okoro's lines score +0.2 to +0.5 towards Nigerian; the earlier Kokoro Okoro
  (with an accent written in by rule) scored around zero (-0.23 to +0.17).
- **Vale**: dominance (high) and valence (low) - in command, and not kind.

The effects and the patients are checked the same way, with AudioSet tags: the
fire alarm is heard as "Smoke detector, smoke alarm" (0.80), the falls as
"Screaming", the brute as "Roar" (0.77), the laughs as laughter.

## Changing a line of dialogue

1. Edit the words in `src/story/script.js` (or the Skyline's intercom in
   `src/levels/causeway/layout.js`, the lift's radio in
   `src/elevators/quiet-ride.js`, the briefing in `src/story/prologue.js`).
2. Export the lines and record just that line: `record.py gen --only "^okoro\|Here, catch"`
   (`--only` is a regular expression on `who|text`), then `judge`, `pick`
   and `install` with the same `--only`.
3. Commit the new mp3 and `src/audio/voice-lines.js`. A briefing line changes
   the film's timing: run `music_build.py briefing` too.

Until a changed line is recorded again, the game shows it with the old voice
blip (a line is found by its exact words).
