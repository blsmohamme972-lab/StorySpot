#!/usr/bin/env python3
"""Install the pinned official Android API 35/build-tools 35 SDK for Linux x86_64.

Review https://developer.android.com/studio/terms before using the Android SDK.
This tool does not accept SDK licenses, modify global settings, or use sudo.
Downloads use Python's normal HTTPS certificate trust and inherited proxy settings.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import tempfile
import urllib.parse
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://dl.google.com/android/repository/"
MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024


@dataclass(frozen=True)
class Package:
    archive: str
    sha256: str
    destination: str
    archive_root: str
    required: tuple[str, ...]


PACKAGES = (
    Package("platform-35_r02.zip", "0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0",
            "platforms", "android-35", ("android.jar", "source.properties")),
    Package("build-tools_r35_linux.zip", "bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88",
            "build-tools", "android-15", ("aapt2", "zipalign", "lib/d8.jar", "lib/apksigner.jar")),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive(path: Path, package: Package) -> None:
    if not path.is_file() or sha256(path) != package.sha256:
        raise ValueError(f"Missing archive or SHA-256 mismatch: {path.name}")


def download_archive(directory: Path, package: Package) -> Path:
    archive = directory / package.archive
    if archive.is_file() and sha256(archive) == package.sha256:
        return archive
    print(f"Downloading {REPOSITORY}{package.archive}", flush=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix=package.archive + ".", suffix=".part", dir=directory, delete=False) as output:
            temporary = Path(output.name)
            with urllib.request.urlopen(REPOSITORY + package.archive, timeout=30) as response:
                if urllib.parse.urlsplit(response.geturl()).scheme != "https":
                    raise ValueError("The SDK download redirected away from HTTPS")
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES:
                        raise ValueError("SDK archive exceeds its download size limit")
                    output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        verify_archive(temporary, package)
        temporary.replace(archive)
        temporary = None
        return archive
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def checked_members(archive: zipfile.ZipFile, expected_root: str):
    """Reject traversal, duplicate paths, links, devices, and unexpected roots."""
    members = []
    seen = set()
    for entry in archive.infolist():
        name = entry.filename
        path = PurePosixPath(name)
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if (not name or "\\" in name or "\0" in name or path.is_absolute()
                or ".." in path.parts or not path.parts or path.parts[0] != expected_root
                or any(":" in part for part in path.parts)
                or kind not in {0, stat.S_IFREG, stat.S_IFDIR}):
            raise ValueError(f"Unsafe SDK ZIP member: {name!r}")
        normalized = path.as_posix().rstrip("/")
        if normalized in seen:
            raise ValueError(f"Duplicate SDK ZIP member: {name!r}")
        seen.add(normalized)
        members.append((entry, path))
    if not members:
        raise ValueError("Empty SDK archive")
    return members


def safely_extract(archive_path: Path, destination: Path, package: Package) -> Path:
    # Hash verification is required immediately before any extraction.
    verify_archive(archive_path, package)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        members = checked_members(archive, package.archive_root)
        for entry, relative in members:
            target = destination.joinpath(*relative.parts)
            if not target.resolve().is_relative_to(root):
                raise ValueError("SDK extraction path leaves its staging directory")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                target.chmod(0o755)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            # Keep executable flags without importing unsafe write/setuid bits.
            target.chmod(0o755 if (entry.external_attr >> 16) & 0o111 else 0o644)
    extracted = destination / package.archive_root
    if not all((extracted / name).is_file() for name in package.required):
        raise ValueError(f"SDK package {package.archive} is missing required tools")
    return extracted


def install_archive(archive: Path, sdk_directory: Path, package: Package) -> None:
    parent = sdk_directory / package.destination
    if parent.is_symlink():
        raise ValueError(f"SDK installation parent must not be a symlink: {parent}")
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / package.archive_root
    if target.is_symlink():
        raise ValueError(f"SDK installation target must not be a symlink: {target}")
    if target.exists() and not target.is_dir():
        raise ValueError(f"SDK installation target must be a directory: {target}")
    marker = target / ".storyspot-sdk-sha256"
    if (marker.is_file() and marker.read_text().strip() == package.sha256
            and all((target / name).is_file() for name in package.required)):
        print(f"Already installed: {target}")
        return
    with tempfile.TemporaryDirectory(prefix="storyspot-sdk-unpack-", dir=sdk_directory) as temporary:
        extracted = safely_extract(archive, Path(temporary), package)
        (extracted / ".storyspot-sdk-sha256").write_text(package.sha256 + "\n")
        previous = parent / (package.archive_root + ".previous-" + uuid.uuid4().hex)
        had_previous = target.exists()
        if had_previous:
            target.rename(previous)
        try:
            extracted.rename(target)
        except BaseException:
            if had_previous:
                previous.rename(target)
            raise
        if had_previous:
            shutil.rmtree(previous)
    print(f"Installed: {target}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-dir", type=Path, default=ROOT.parent / "android-toolchain")
    parser.add_argument("--verify-only", action="store_true", help="Verify existing ZIPs/tools without downloading or changing any file")
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine().lower() not in {"x86_64", "amd64"}:
        raise SystemExit("These pinned Android build tools require Linux x86_64. Use a Linux x86_64 machine or VM.")
    sdk_directory = args.sdk_dir.expanduser().resolve()
    try:
        if args.verify_only:
            for package in PACKAGES:
                archive = sdk_directory / package.archive
                verify_archive(archive, package)
                with zipfile.ZipFile(archive) as zipped:
                    checked_members(zipped, package.archive_root)
                installed = sdk_directory / package.destination / package.archive_root
                if not all((installed / name).is_file() for name in package.required):
                    raise ValueError(f"Installed SDK package is incomplete: {installed}")
                print(f"Verified archive SHA-256 and installed tools: {package.archive}")
        else:
            print("Android SDK terms: https://developer.android.com/studio/terms")
            sdk_directory.mkdir(parents=True, exist_ok=True)
            for package in PACKAGES:
                archive = download_archive(sdk_directory, package)
                install_archive(archive, sdk_directory, package)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error)) from error
    print(f"Android toolchain ready: {sdk_directory}")


if __name__ == "__main__":
    main()
