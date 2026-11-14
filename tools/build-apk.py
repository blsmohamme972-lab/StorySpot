#!/usr/bin/env python3
"""Build the independent StorySpot APK with the installed Android SDK.

The signing identity lives outside the source tree. --init-key is used once for
a new application. Later builds require and verify the same pinned certificate.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android"
PACKAGE = "com.storyspot.app"
VERSION = "1.1.1"
VERSION_CODE = 10
UI_FILES = {"index.html", "app.js", "styles.css", "drive-sync.js", "config.json", "mcq.js", "quotes.js", "books.js"}
FONT_EXTENSIONS = {".woff2", ".woff", ".ttf", ".otf"}
LESSON_FIELDS = {"storyText", "explanationText", "storyAudio", "explanationAudio", "cues", "explanationCues"}

def ui_asset(relative: Path) -> bool:
    """Allow UI code/config/fonts only; all content/media directories are excluded."""
    if relative.as_posix() in UI_FILES:
        return True
    return (len(relative.parts) == 2 and relative.parts[0] == "fonts"
            and (relative.suffix.lower() in FONT_EXTENSIONS or relative.suffix.lower() == ".txt"))

def validate_config(value):
    if not isinstance(value, dict):
        raise ValueError("UI config must be an object")
    def visit(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if key in LESSON_FIELDS or (key in {"stories", "lessons"} and child):
                    raise ValueError("The Drive-only application cannot bundle story records or timing")
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
        elif isinstance(item, str) and (item.lower().startswith(("data:audio/", "data:image/", "data:video/"))
                                       or item.lstrip("/").startswith("content/")):
            raise ValueError("UI config cannot embed lesson media")
    visit(value)

def stage_ui(web_dir: Path, destination: Path):
    source_root = web_dir.resolve()
    if not all((source_root / name).is_file() for name in UI_FILES):
        raise ValueError("The Drive-only UI requires index.html, app.js, styles.css, drive-sync.js, and config.json")
    validate_config(json.loads((source_root / "config.json").read_text()))
    selected = []
    for source in sorted(source_root.rglob("*")):
        relative = source.relative_to(source_root)
        if not source.is_file() or not ui_asset(relative):
            continue
        if source.is_symlink() or not source.resolve().is_relative_to(source_root):
            raise ValueError("UI assets must be regular files inside the web directory")
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        selected.append(relative.as_posix())
    return {"files": selected, "bytes": sum((destination / name).stat().st_size for name in selected),
            "bundledStories": 0, "bundledLessonMedia": 0}

def verify_ui_only_apk(path: Path):
    with zipfile.ZipFile(path) as archive:
        assets = [Path(name[7:]) for name in archive.namelist() if name.startswith("assets/") and not name.endswith("/")]
        if not assets or any(not ui_asset(relative) for relative in assets):
            raise ValueError("APK contains an asset outside the UI-only allowlist")
        validate_config(json.loads(archive.read("assets/config.json")))
        if not UI_FILES.issubset({relative.as_posix() for relative in assets}):
            raise ValueError("APK is missing required UI files")

def run(arguments, **kwargs):
    return subprocess.run([str(arg) for arg in arguments], check=True, **kwargs)

def key_files(directory: Path, initialize: bool):
    key = directory / "storyspot-release.p12"
    password = directory / "keystore-password.txt"
    pin = ANDROID / "signing-identity.json"
    if key.exists() != password.exists():
        raise SystemExit("Incomplete private signing backup. Restore both files; never replace a delivered key.")
    if not key.exists():
        if not initialize or pin.exists():
            raise SystemExit("Restore StorySpot's private signing key, or use --init-key only for the first build of a new identity.")
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o700)
        password.write_text(secrets.token_urlsafe(36) + "\n")
        password.chmod(0o600)
        run(["keytool", "-genkeypair", "-storetype", "PKCS12", "-keystore", key,
             "-storepass:file", password, "-alias", "storyspot", "-keyalg", "RSA", "-keysize", "3072",
             "-validity", "10000", "-dname", "CN=StorySpot,OU=Android,O=StorySpot,C=US"])
        key.chmod(0o600)
    certificate = run(["keytool", "-exportcert", "-keystore", key, "-alias", "storyspot",
                       "-storepass:file", password], capture_output=True).stdout
    digest = hashlib.sha256(certificate).hexdigest()
    if pin.exists():
        identity = json.loads(pin.read_text())
        if identity.get("packageName") != PACKAGE or identity.get("certificateSha256") != digest:
            raise SystemExit("Signing identity mismatch. Restore the pinned StorySpot signing key.")
    else:
        if not initialize:
            raise SystemExit("Missing public signing identity; use --init-key to pin a new app's original key.")
        identity = {"schemaVersion": 1, "packageName": PACKAGE, "certificateSha256": digest,
                    "keyAlias": "storyspot", "createdForVersion": VERSION}
        pin.write_text(json.dumps(identity, indent=2) + "\n")
    # A private duplicate survives removal of source/build directories. Never
    # include this archive in an APK or public source archive.
    backup_dir = ROOT.parent / "shared" / "storyspot-private"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_dir.chmod(0o700)
    backup = backup_dir / "storyspot-signing-backup.zip"
    if not backup.exists():
        with zipfile.ZipFile(backup, "w", zipfile.ZIP_STORED) as archive:
            archive.write(key, key.name)
            archive.write(password, password.name)
            archive.writestr("signing-identity.json", json.dumps(identity, indent=2) + "\n")
        backup.chmod(0o600)
    # Read back the duplicate before it is considered a usable signing backup.
    with zipfile.ZipFile(backup) as archive:
        if archive.read(key.name) != key.read_bytes() or archive.read(password.name) != password.read_bytes():
            raise SystemExit("Private signing backup differs from the pinned identity; investigate before delivery.")
    return key, password, digest

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-dir", type=Path, default=ROOT.parent / "android-toolchain")
    parser.add_argument("--web-dir", type=Path, default=ROOT / "web")
    parser.add_argument("--key-dir", type=Path, default=ROOT.parent / ".storyspot-signing")
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / f"StorySpot-{VERSION}.apk")
    parser.add_argument("--init-key", action="store_true")
    args = parser.parse_args()
    if not (args.web_dir / "index.html").is_file():
        raise SystemExit("Missing web/index.html")
    manifest = ET.parse(ANDROID / "AndroidManifest.xml").getroot()
    namespace = "{http://schemas.android.com/apk/res/android}"
    if (manifest.get("package") != PACKAGE or manifest.get(namespace + "versionName") != VERSION
            or manifest.get(namespace + "versionCode") != str(VERSION_CODE)):
        raise SystemExit("Manifest package/version differs from the selected StorySpot release")
    platform = args.sdk_dir / "platforms" / "android-35" / "android.jar"
    candidates = [args.sdk_dir / "build-tools" / "35.0.0", args.sdk_dir / "build-tools" / "android-15"]
    tools = next((candidate for candidate in candidates if (candidate / "aapt2").is_file()), None)
    if not platform.is_file() or tools is None:
        raise SystemExit("Android SDK API35 and build-tools 35 are required.")
    key, password, certificate = key_files(args.key_dir.resolve(), args.init_key)
    stage = ROOT / "build" / "android"
    if stage.exists():
        shutil.rmtree(stage)
    for part in ["generated", "classes", "dex", "assets"]:
        (stage / part).mkdir(parents=True, exist_ok=True)
    bundle = stage_ui(args.web_dir, stage / "assets")
    compiled = stage / "resources.zip"
    run([tools / "aapt2", "compile", "--dir", ANDROID / "res", "-o", compiled])
    linked = stage / "resources.apk"
    run([tools / "aapt2", "link", "-o", linked, "-I", platform, "--manifest", ANDROID / "AndroidManifest.xml",
         "--java", stage / "generated", "-A", stage / "assets", "-0", "mp3", "-0", "m4a", "-0", "ogg", "-0", "wav", compiled])
    sources = sorted((ANDROID / "src").rglob("*.java")) + sorted((stage / "generated").rglob("*.java"))
    run(["java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-source", "8", "-target", "8",
         "-Xlint:-options", "-classpath", platform, "-d", stage / "classes", *sources])
    jar = stage / "classes.jar"
    with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as archive:
        for source in sorted((stage / "classes").rglob("*.class")):
            archive.write(source, source.relative_to(stage / "classes").as_posix())
    run(["java", "-cp", tools / "lib" / "d8.jar", "com.android.tools.r8.D8", "--release", "--min-api", "26",
         "--lib", platform, "--output", stage / "dex", jar])
    unsigned = stage / "unsigned.apk"
    shutil.copyfile(linked, unsigned)
    with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as archive:
        for source in sorted((stage / "dex").glob("*.dex")):
            archive.write(source, source.name)
    aligned = stage / "aligned.apk"
    run([tools / "zipalign", "-f", "-P", "16", "4", unsigned, aligned])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    run(["java", "-jar", tools / "lib" / "apksigner.jar", "sign", "--ks", key, "--ks-key-alias", "storyspot",
         "--ks-pass", "file:" + str(password), "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
         "--v3-signing-enabled", "true", "--v4-signing-enabled", "false", "--out", args.output, aligned])
    run(["java", "-jar", tools / "lib" / "apksigner.jar", "verify", "--verbose", "--print-certs", args.output])
    run([tools / "zipalign", "-c", "-P", "16", "4", args.output])
    run([tools / "aapt2", "dump", "badging", args.output])
    verify_ui_only_apk(args.output)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix(".apk.sha256").write_text(f"{digest}  {args.output.name}\n")
    metadata = {"packageName": PACKAGE, "applicationLabel": "StorySpot", "version": VERSION, "versionCode": VERSION_CODE,
                "minSdk": 26, "targetSdk": 35, "file": args.output.name, "bytes": args.output.stat().st_size,
                "sha256": digest, "certificateSha256": certificate, "signed": True,
                "contentSource": "Google Drive at runtime", "bundle": bundle,
                "verification": "APK signature, package identity, and ZIP alignment verified. Device playback testing is separate."}
    args.output.with_suffix(".apk.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))

if __name__ == "__main__":
    main()
