# Audio tools - the voices, the patients, the effects and the music

Everything under `assets/audio/voice`, `assets/audio/creatures`,
`assets/audio/sfx` and `assets/audio/music` is made by the scripts in this
folder. The game never runs them; it only plays the files.

- **The voices** are acted with [VoiceStudio](https://github.com/debpalash/VoiceStudio)'s
  engines: **OmniVoice** (its default: cloning and voice design) and
  **IndexTTS 2.5** (its emotion engine). Every line is recorded in several
  takes; a machine listener measures each take - the words, the energy, the
  accent - and the best one is kept.
- **The patients and the effects** are real recordings (BigSoundBank,
  OpenGameArt), cut, layered, pitched and mastered.
- **The music** is Kevin MacLeod's (incompetech.com), cut into seamless loops.

Who made every recording, and the licences: `docs/credits.md`.

| Script | What it does |
| --- | --- |
| `export-lines.mjs` | Every line the game speaks (the story script, the Skyline's intercom, the lift's radio, the briefing's captions), as JSON |
| `record.py` | The cast and its direction; records, judges, picks and finishes the lines; installs them with `src/audio/voice-lines.js` |
| `engines/omnivoice_jobs.py`, `engines/indextts_jobs.py` | Run a list of takes through each engine |
| `finish.py` | Pitch and time, real breaths in Okoro's pauses, the tower's PA, the radio, rooms, loudness |
| `listen.py` | The machine listener: Whisper (words), audEERING's emotion model (energy, dominance, valence), an accent fingerprint (Nigerian or not), AudioSet tags (what a sound is) |
| `sounds_build.py` | The effects and the patients from real recordings (and the patients' broken speech, from OmniVoice) |
| `music_build.py` | The stage loops and the briefing's track |
| `sources.py` | Downloads every recording, the tracks, the Nigerian speech set, and the engines |
| `refs/` | The recordings the cast is cloned from (see `refs/README.md`) |

## Setting up (once)

The downloads (about 25 GB with the engines' weights) go in a work folder
outside git: `.audio-work/`, or wherever `AUDIO_WORK` points.

```text
python3.11 -m venv .venv
.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
.venv/bin/pip install "transformers>=5.10" huggingface_hub pydub soundfile numpy scipy librosa \
    pyloudnorm faster-whisper speechbrain pyarrow pandas py7zr
.venv/bin/python tools/audio/sources.py engines      # VoiceStudio, IndexTTS 2.5, their weights
.venv/bin/python tools/audio/sources.py              # the recordings, the tracks, OpenSLR 70
```

IndexTTS needs its own environment (it wants transformers 4), as VoiceStudio
gives it:

```text
cd .audio-work/ext/index-tts
uv venv .venv --python 3.11
uv pip install --python .venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
uv pip install --python .venv/bin/python -e .
```

ffmpeg must be on the PATH, built with `libmp3lame` and `rubberband`.

## Making everything

```text
node tools/audio/export-lines.mjs > .audio-work/vs/lines.json
cd tools/audio
GEN_THREADS=3 ../../.venv/bin/python record.py gen      # the takes - hours on a CPU
../../.venv/bin/python record.py judge                  # measure them
../../.venv/bin/python record.py perfect                # more takes, until every line has one word-perfect
../../.venv/bin/python record.py laughs                 # Vale's laughs
../../.venv/bin/python record.py pick                   # the best take of each line, finished
../../.venv/bin/python record.py install                # into the game
../../.venv/bin/python sounds_build.py speech           # the patients' broken speech
../../.venv/bin/python sounds_build.py build && ../../.venv/bin/python sounds_build.py install
../../.venv/bin/python music_build.py
```

On a CPU a take of a line takes a minute or two. Leave a core free
(`GEN_THREADS`) if anything else runs alongside: oversubscribed, the engines
slow to a crawl.

## The cast

| Who | Engine | The performance |
| --- | --- | --- |
| Dr. Okoro | OmniVoice, cloned from a Nigerian English speaker (OpenSLR 70, speaker 07049) | A Nigerian doctor, terrified: cloned from the speaker's most excited recordings, a little fast; real breathing laid into his pauses (panting as he runs through the Foundry, quieter when he hides); the take kept is the most energetic one that is still clearly Nigerian with every word heard |
| Dr. Vale | IndexTTS 2.5, a designed deep British voice | Cold (angry, disgusted, calm) - or gleeful when he wins; the tower's PA; real laughter after his taunts, lowered into his register |
| The pilot | IndexTTS 2.5, Vale's voice | Calm and pleasant over the radio (it is Vale) |
| The trailer voice | IndexTTS 2.5, a designed deep American voice | Intense; reads the briefing's captions over "Hitman" |
| HALCYON | Kokoro (kept from the earlier version) | The building's PA, after a chime |
| Subject 07 | OmniVoice, a designed voice per character | Tired, clear; pain and effort are real recordings |
| The patients | Real recordings; their broken speech from OmniVoice, made monstrous | Growls, moans, shrieks, pain, deaths, the brute's roar, the horde |

Lines are read as an actor would say them: "Subject 07" is "Subject Seven",
"Dr." is "Doctor", shouted capitals are words.

## How a take is judged (`listen.py`)

Nobody listens to hundreds of takes, so the machine does, and the numbers
choose:

- **Words**: Whisper transcribes the take; any missing or wrong word costs
  heavily, and a line with no word-perfect take gets more takes until it has
  one (spelling, digits and contractions don't count - "programme" is
  "program", "30" is "thirty"). A line a voice keeps getting wrong can be
  reworded for the voice only (`SAY` in `record.py`; the subtitle keeps the script's words).
- **Energy** (arousal, 0-1): Okoro should be frightened, the trailer exciting.
  Okoro read calmly measured about 0.35; cloned from the speaker's excited
  recordings, about 0.5.
- **Accent**: a take's accent fingerprint (CommonAccent's ECAPA embedding) is
  compared with OpenSLR 70's other Nigerian speakers and an American speaker.
  Okoro's lines score +0.2 to +0.5 towards Nigerian; the earlier Kokoro Okoro
  (with an accent written in by rule) scored around zero (-0.23 to +0.17). IndexTTS, given
  "afraid", reached 0.8 energy but lost the accent (-0.25) - which is why
  Okoro is OmniVoice and the energy comes from the reference and the breaths.
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
3. Commit the new mp3 and `src/audio/voice-lines.js`.

Until a changed line is recorded again, the game shows it with the old voice
blip (a line is found by its exact words).
