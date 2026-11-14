# Restore and build StorySpot

The source backup contains the English Android player, Drive connection settings,
tests and desktop authoring tools. It does not contain an Android SDK or a private
signing key. The APK itself remains a thin client with no bundled lesson records,
images, narration or timing. See `README.md` and `docs/DRIVE_SYNC.md` for runtime
content updates, which do not require a new APK.

## Build prerequisites

Use Linux x86_64, Python **3.10 or later**, and a full **JDK 17 or later** with
`java`, `keytool`, and the `jdk.compiler` module. The delivered build used JDK 21.
The builder invokes the compiler through `java -m
jdk.compiler/com.sun.tools.javac.Main`, so a separate `javac` wrapper is not
required. Gradle, Android Studio, Node.js and Python packages are not required
to build the APK.

```sh
python3 --version
java -version
java --list-modules
keytool -help
```

`jdk.compiler` must appear in the module list. Allow several hundred MB for SDK
ZIPs and extracted tools, plus temporary build space. Install system packages
using the mechanism supported by the host environment; these instructions do
not assume root or `sudo` access.

## Install the pinned Android SDK

From the restored StorySpot source directory:

```sh
python3 tools/bootstrap-sdk.py
```

The default destination is `../android-toolchain`, which matches the APK builder.
To choose another user-owned location, pass it to both commands:

```sh
python3 tools/bootstrap-sdk.py --sdk-dir /path/to/android-toolchain
python3 tools/build-apk.py --sdk-dir /path/to/android-toolchain
```

The bootstrap reads the official packages below over HTTPS. It verifies their
exact SHA-256 values before extracting, rejects unsafe ZIP paths/links, stages
each package privately, and preserves executable permissions. Existing ZIPs
with matching hashes are reused. It does not change global environment settings
or generate SDK license acceptance records. Review and follow the applicable
[Android SDK terms](https://developer.android.com/studio/terms); the script does
not accept those terms on another person's behalf.

| Package | Official source | SHA-256 |
| --- | --- | --- |
| Android platform API 35 revision 2 | `https://dl.google.com/android/repository/platform-35_r02.zip` | `0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0` |
| Build tools 35, Linux | `https://dl.google.com/android/repository/build-tools_r35_linux.zip` | `bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88` |

The official build-tools ZIP uses the internal directory `build-tools/android-15`;
this is supported by the builder and contains build-tools 35. An existing
`build-tools/35.0.0` installation is also supported. Platform files belong in
`platforms/android-35`.

To check existing ZIPs, paths and tools without downloads or changes:

```sh
python3 tools/bootstrap-sdk.py --verify-only
```

Normal HTTPS clients use inherited proxy settings and system certificate trust.
If network access is restricted, permit the official download host using the
environment's supported network settings. Keep TLS verification enabled.

## Restore the original signing identity

Every update to `com.storyspot.app` must use its original private signing backup.
Restore the separately stored private backup into `../.storyspot-signing/` so
these files exist:

```text
../.storyspot-signing/storyspot-release.p12
../.storyspot-signing/keystore-password.txt
```

Keep that directory private to its owner. The source's
`android/signing-identity.json` pins the certificate's SHA-256; the builder checks
it against the restored key and checks its private backup readback before
signing. A different location can be passed with `--key-dir`. Do not put private
signing files in the source tree, an APK, or a public source archive. For an
existing StorySpot update, restore the key rather than using `--init-key`.

## Build and update versions

```sh
python3 tools/build-apk.py
```

The 1.1.1/code 10 source candidate will write `dist/StorySpot-1.1.1.apk`, its `.apk.sha256` checksum,
and `.apk.json` metadata. The builder compiles Java, runs D8, aligns and signs
the APK, verifies the signature/package, and reads the final asset list back to
check that no lesson content slipped into the package.

Before delivering a later update, raise the numeric `versionCode` above the
latest delivered version and update the displayed version consistently in
these three places:

1. `android/AndroidManifest.xml`: `android:versionCode` and `android:versionName`.
2. `tools/build-apk.py`: `VERSION_CODE` and `VERSION`.
3. `android/src/com/storyspot/app/MainActivity.java`: `getAppInfo()`'s
   `versionCode` and `version` JSON values. Change `nativeApi` only when the
   bridge contract changes.

Keep package `com.storyspot.app`, the pinned certificate, and existing story IDs
stable. Update the source backup and documentation to match the delivered
release. Source/SDK restoration does not require generating new lesson media.

## Run checks

The packaging boundary and Java byte-range checks require only Python and the
JDK:

```sh
python3 android/tests/test_asset_policy.py
mkdir -p build/range-tests
java -m jdk.compiler/com.sun.tools.javac.Main -d build/range-tests \
  android/src/com/storyspot/app/ByteRange.java \
  android/src/com/storyspot/app/PlaybackFocus.java \
  android/src/com/storyspot/app/BoundedInput.java \
  android/src/com/storyspot/app/MediaIntegrity.java \
  android/tests/ByteRangeTest.java android/tests/PlaybackFocusTest.java \
  android/tests/MediaStreamTest.java
java -cp build/range-tests com.storyspot.app.ByteRangeTest
java -cp build/range-tests com.storyspot.app.PlaybackFocusTest
java -cp build/range-tests com.storyspot.app.MediaStreamTest
```

The broader browser checks require Chromium, Node.js 20 or later, Python
Playwright, and Node Playwright. Media authoring and decoding also require
`ffmpeg` and `ffprobe`. The regression fixtures come from the separately
preserved `production/remote-library/`, outside `web/`; restore them before
running tests that read that directory. APK builds do not require these fixtures.

Use project-local dependencies. `requirements-dev.txt` pins Python Playwright
1.62.0; `package-lock.json` pins the Node dependencies, including Playwright
1.62.1:

```sh
python3 -m venv .venv-tests
.venv-tests/bin/python -m pip install -r requirements-dev.txt
npm ci
```

The runners use `CHROMIUM_PATH` when set, then detect a system Chromium, then
use their Playwright browser. To use a system browser, install Chromium and
FFmpeg through the host's package mechanism and optionally set
`CHROMIUM_PATH=/path/to/chromium`. When no system browser is available, install
each pinned Playwright package's Chromium:

```sh
.venv-tests/bin/python -m playwright install chromium
npx playwright install chromium
```

Linux browser runtime libraries must also be available through the environment's
package mechanism. These browser installs do not grant administrative access or
change the APK's UI-only asset policy. Run the full checks from the source root:

```sh
.venv-tests/bin/python -m unittest discover -s tests -p 'test_*.py'
npm run test:ui
```

For explicitly requested speech authoring, install its separate dependencies:

```sh
python3 -m venv .venv-audio
.venv-audio/bin/python -m pip install -r tools/requirements-audio.txt
```

See `docs/AUDIO.md` before generating narration. Dependency installation alone
does not generate or upload content. Automated checks, real browser media
playback, human listening, and physical Android playback are separate evidence;
do not claim device verification from a successful APK build.
