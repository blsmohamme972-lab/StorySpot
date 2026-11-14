**Current update:** [RELEASE_1.1.1.md](RELEASE_1.1.1.md). Version 1.1.1 / versionCode 7 is built and signed with the pinned StorySpot certificate. The 0.3.x notes below remain historical repair records.

# StorySpot developer handoff

Continue this project from the source archive, this document, and the machine-readable `HANDOFF.json` at the source root. The current signed release is **1.1.1 / versionCode 7**; the package remains **`com.storyspot.app`**, for Android 8.0 or later. It is a Drive-only player: the APK contains UI code, fonts, and connection settings, with zero bundled lessons or lesson media.

The story text and voice are Arabic. Explanations, their voice, and all app controls are English. Images and content added to Drive are discovered without an APK rebuild. The app checks on launch, resume, periodically while visible, and on manual refresh; downloaded remote media can be reused offline. Preserve story IDs, saved state, preferences, and the running playback position during updates. Do not uninstall the app or clear its data to perform an update.

## Files to retain

- **Source archive:** `StorySpot-0.3.3-source.zip`. Contains executable source, public signing certificate identity, documentation, tests, and authoring metadata. It contains no private signing key or password.
- **Private signing archive:** `PRIVATE-StorySpot-signing-backup.zip`. Required to sign compatible future APKs. Keep it private and separately backed up; never add its contents to source control, a public archive, or an APK.
- **Optional authoring media archive:** `StorySpot-0.2.0-authoring-media.zip`. Restores the original images and generated MP3s under `production/remote-library/content/` for full media/browser tests or future content authoring. Extract it into the same StorySpot source root so its `production/remote-library/content/` paths align. Building the thin APK does not need this archive.

Use the archive names and Drive references in `HANDOFF.json` and any accompanying delivery index. Download the source archive; an APK alone is insufficient for maintaining the app.

## Restore the signing identity before building

The existing APK's certificate SHA-256 is:

```text
7c0394b5c20dbc225b4612b41a46d0e3d03a7e3dc0313b8fd619538db2340138
```

The public pin is `android/signing-identity.json`; the key alias is `storyspot`. Extract the private archive's `storyspot-release.p12` and `keystore-password.txt` into a sibling directory named `.storyspot-signing`. Keep a copy of the complete private archive as the sibling path `shared/storyspot-private/storyspot-signing-backup.zip`. The default layout is:

```text
parent/
  StorySpot/                         # extracted source root
  .storyspot-signing/
    storyspot-release.p12
    keystore-password.txt
  shared/storyspot-private/
    storyspot-signing-backup.zip
  android-toolchain/
```

Restrict the private directories to their owner and the private files to owner read/write. Do not print the password. The builder verifies both the certificate pin and the duplicate backup. `--key-dir` can select another key directory, but the backup path remains relative to the source root's parent. Restore missing original material; **never use `--init-key` or generate a replacement key for this delivered app**. A new key cannot update installations signed with the existing identity.

## Build an update

Use Python 3.10 or later, JDK 17 or later, Android SDK platform 35, and build-tools 35. Run `python tools/bootstrap-sdk.py` to prepare the SDK, or place an existing SDK at `../android-toolchain`; `--sdk-dir` overrides that location. A normal build is:

```sh
python tools/build-apk.py
```

The current update sets versionCode to **7** / versionName **1.1.1**. Keep these three locations consistent:

1. `tools/build-apk.py`: `VERSION` and `VERSION_CODE`.
2. `android/AndroidManifest.xml`: `android:versionName` and `android:versionCode`.
3. `android/src/com/storyspot/app/MainActivity.java`: version fields returned by `getAppInfo()`.

Keep package `com.storyspot.app`, the certificate pin, and the original key. The builder checks manifest/version consistency, allows only UI assets into the APK, verifies the signed APK and ZIP alignment, and writes checksums/build metadata under `dist/`. Install the newer same-key APK as an update. Content-only changes belong in Drive and do not require a new APK.

## Drive and content references

- Content root: [`1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT`](https://drive.google.com/drive/folders/1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT).
- Remote catalog: [`1zA1ckUDRk8VjFPciBLe6lR8vvLSZCa4s`](https://drive.google.com/file/d/1zA1ckUDRk8VjFPciBLe6lR8vvLSZCa4s/view).
- Narration subfolder: [`1jcRJ1aHDmn2QDdmfrO3ZTbNqDZA_lXsL`](https://drive.google.com/drive/folders/1jcRJ1aHDmn2QDdmfrO3ZTbNqDZA_lXsL).
- Delivered APK: [`StorySpot-0.3.2.apk`](https://drive.google.com/file/d/1wXmAVTxpc7cov6LZ2ngF5j7z_0KLZD0w/view?usp=drivesdk).

The root folder is configured in both `web/config.json` and `web/drive-sync.js`; change both deliberately if moving the library. Public read-only Drive access is used without Google login. The app reads the root and one level of public subfolders. An optional manifest enriches matching image IDs and must not hide newly added images. See [DRIVE_SYNC.md](DRIVE_SYNC.md) for naming, duplicate handling, and caching, and [CONTENT_FORMAT.md](CONTENT_FORMAT.md) for cues and manifest fields.

Desktop authoring inputs and outputs live in `production/remote-library/`, not `web/`. Story and explanation recordings remain authored content; MCQ uses Android text-to-speech. The app does not invent missing rationales or spotlight timing. Do not run a base-catalog preparation script over enriched authoring metadata casually. Replacing text or artwork requires appropriate speech/timing or coordinate review; preserve the remote story IDs. The private signing archive has no role in content authoring.

## Validation and known limits

For the complete checks, restore the optional authoring media first. Follow `docs/BUILD_SETUP.md` to install `requirements-dev.txt` in a Python virtual environment, run `npm ci`, and install Chromium. Tests use `CHROMIUM_PATH`, a system Chromium, or Playwright's browser. `PLAYWRIGHT_MODULE` is optional when using an alternate Node module location; another project's dependencies are not needed.

Run from the source root:

```sh
python -m unittest discover -s tests -p 'test_*.py' -v
python -m unittest discover -s android/tests -p 'test_*.py' -v
mkdir -p build/test-classes
java -m jdk.compiler/com.sun.tools.javac.Main -d build/test-classes \
  android/src/com/storyspot/app/ByteRange.java \
  android/src/com/storyspot/app/PlaybackFocus.java \
  android/src/com/storyspot/app/BoundedInput.java \
  android/src/com/storyspot/app/MediaIntegrity.java \
  android/tests/ByteRangeTest.java android/tests/PlaybackFocusTest.java \
  android/tests/MediaStreamTest.java
java -cp build/test-classes com.storyspot.app.ByteRangeTest
java -cp build/test-classes com.storyspot.app.PlaybackFocusTest
java -cp build/test-classes com.storyspot.app.MediaStreamTest
npm run test:ui
python tools/build-apk.py
```

The 0.2.0 handoff records 15 content/Drive regression tests, 3 APK asset-policy tests, 19 Java byte-range cases, and browser playback/discovery/cache/state checks passing. Public-network probes discovered the current 11 stories and 22 narration tracks and verified selected remote file hashes. These are recorded checks, not a promise about future remote availability.

**Physical Android device playback has not been tested.** Public Drive HTML discovery is unofficial and has no guaranteed unbounded pagination contract. Do not describe the app as fully production-ready on the strength of browser tests alone. Synthetic speech and sentence-level focus timing are documented in [AUDIO.md](AUDIO.md); no human listening or verified word-level alignment is claimed. Supplied medical mnemonic claims and literary quotations were not independently source-verified.
