# Synthetic speech

The Arabic story narration stored in Drive uses Microsoft Edge's `ar-SA-ZariyahNeural` voice. English explanation narration uses `en-US-AriaNeural`. Both tracks are synthetic speech generated from the exact catalog text. No narration is bundled inside the APK.

The desktop authoring tool is `tools/generate_audio.py`; install `tools/requirements-audio.txt` in a local Python virtual environment. It reads `production/remote-library/catalog-source.json` and writes `production/remote-library/content/audio/`, outside the APK input. Upload generated tracks to Drive and update the remote manifest when preparing more narrated stories. `ffmpeg` and `ffprobe` must also be available. Generation uses the inherited HTTPS proxy and system certificate trust. No speech service credentials are bundled in the app.

Run:

```sh
.venv-audio/bin/python tools/generate_audio.py
```

`production/audio-metadata.json` records the engine and package version, exact source-text hash, MP3 hash, duration, encoding, and the provider's sentence boundary timestamps. These timestamps drive the image camera and pointer cues. They are sentence-level provider timings; they are not manually verified word alignments. A successful generation includes a complete FFmpeg decode. These checks do not claim human listening or playback on a physical Android phone.

Re-running the tool reuses an output only when its voice, speed, source-text hash, and MP3 hash match the current request. Changed text regenerates the corresponding track. No other catalog fields are changed automatically.
