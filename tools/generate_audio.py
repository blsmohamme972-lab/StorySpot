#!/usr/bin/env python3
"""Generate real Arabic story / English explanation speech and sentence timestamps.

Requires edge-tts and ffmpeg/ffprobe. Uses the configured HTTPS proxy and trusted
system CA. Re-runs keep outputs only if their exact text/voice/rate/hash match.
The generated speech is synthetic; no human-listening review is asserted.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import time

import edge_tts
import edge_tts.communicate

BASE = Path(__file__).resolve().parents[1]
VOICE = {"story": "ar-SA-ZariyahNeural", "explanation": "en-US-AriaNeural"}
RATE = {"story": "-5%", "explanation": "-3%"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(text: str) -> str:
    return re.sub(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]", "", text).strip()


def probe(path: Path) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_name,sample_rate,channels", "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    )
    data = json.loads(result.stdout)
    # A complete audio decode catches corrupt/truncated frames, not just headers.
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-f", "null", "-"],
                   check=True, capture_output=True)
    return {"duration": float(data["format"]["duration"]), **data["streams"][0]}


async def synthesize(story_id: str, kind: str, text: str, output: Path) -> dict:
    text = normalize(text)
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", story_id):
        raise ValueError(f"Unsafe story ID: {story_id!r}")
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(".mp3.part")
    sentences = []
    for attempt in range(3):
        try:
            sentences = []
            communicate = edge_tts.Communicate(
                text, VOICE[kind], rate=RATE[kind], boundary="SentenceBoundary",
                proxy=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy"),
            )
            with partial.open("wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "SentenceBoundary":
                        start = chunk["offset"] / 10_000_000
                        end = start + chunk["duration"] / 10_000_000
                        sentences.append({"start": round(start, 4), "end": round(end, 4), "text": chunk["text"]})
            info = probe(partial)
            if info["duration"] < 1 or not sentences:
                raise RuntimeError("No valid speech or sentence timing returned")
            partial.replace(output)
            print(f"Generated {story_id}/{kind}: {info['duration']:.2f}s, {len(sentences)} sentences", flush=True)
            return {
                "file": "content/audio/" + output.name,
                "voice": VOICE[kind], "language": "ar-SA" if kind == "story" else "en-US",
                "rate": RATE[kind], "textSha256": hashlib.sha256(text.encode()).hexdigest(),
                "sha256": digest(output), "bytes": output.stat().st_size,
                "duration": round(info["duration"], 4),
                "codec": info["codec_name"], "sampleRate": int(info["sample_rate"]),
                "channels": info["channels"], "segments": sentences,
                "validation": "ffprobe metadata and full ffmpeg decode passed; no human listening asserted",
            }
        except Exception:
            partial.unlink(missing_ok=True)
            if attempt == 2:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))
    raise AssertionError("unreachable")


async def run(args):
    # edge-tts defaults to certifi. The cloud proxy's CA is deliberately included
    # by SSL_CERT_FILE; continue to validate TLS rather than disabling verification.
    ca_file = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    edge_tts.communicate._SSL_CTX = ssl.create_default_context(cafile=ca_file)
    catalog = json.loads(args.catalog.read_text())
    metadata_file = args.root / "production/audio-metadata.json"
    metadata_file.parent.mkdir(parents=True, exist_ok=True)
    metadata = json.loads(metadata_file.read_text()) if metadata_file.exists() else {}
    metadata.update({"schemaVersion": 1, "engine": "Microsoft Edge neural text-to-speech", "packageVersion": importlib.metadata.version("edge-tts"), "syntheticSpeech": True})
    tracks = metadata.setdefault("tracks", {})
    semaphore = asyncio.Semaphore(args.concurrency)

    def save():
        temp = metadata_file.with_suffix(".json.tmp")
        temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
        temp.replace(metadata_file)

    async def one(story, kind):
        text = normalize(story.get(kind + "Text", ""))
        if not text:
            return
        story_id = story["id"]
        output = args.root / "production/remote-library/content/audio" / f"{story_id}-{kind}.mp3"
        old = tracks.get(story_id, {}).get(kind)
        expected_text = hashlib.sha256(text.encode()).hexdigest()
        if not args.force and old and output.exists() and old.get("textSha256") == expected_text and old.get("voice") == VOICE[kind] and old.get("rate") == RATE[kind] and old.get("sha256") == digest(output):
            print(f"Keeping verified {story_id}/{kind}", flush=True)
            return
        async with semaphore:
            track = await synthesize(story_id, kind, text, output)
            tracks.setdefault(story_id, {})[kind] = track
            save()

    selected = [s for s in catalog["stories"] if not args.id or s["id"] in args.id]
    await asyncio.gather(*(one(story, kind) for story in selected for kind in VOICE))
    save()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=BASE)
    parser.add_argument("--catalog", type=Path, default=BASE / "production/remote-library/catalog-source.json")
    parser.add_argument("--id", action="append")
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--force", action="store_true")
    asyncio.run(run(parser.parse_args()))
