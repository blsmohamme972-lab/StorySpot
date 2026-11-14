# StorySpot Android shell

This is the independent `com.storyspot.app` application, version 0.2.0/code 2.
It does not modify an InstaAnki installation or reuse its signing identity.
Minimum Android: 8.0/API 26.

Build using the installed API 35 SDK:

```sh
python3 tools/build-apk.py
```

The builder compiles Java, runs D8, aligns the APK, signs with the existing key,
and verifies its signature and package. It writes the APK, SHA-256 and metadata
to `dist/`. Only English UI files, an empty Drive configuration, fonts and their
licenses are eligible for the APK. Story records, images, narration and timing
data are obtained from Google Drive after installation. The builder excludes
all content directories and verifies the final APK asset list and empty config.
`--init-key` is only for a new app identity; a pinned identity is
never silently replaced. Private signing files live outside this project and
must not be included in a source archive or an APK.

The bundled UI runs at `https://appassets.androidplatform.net/assets/index.html`.
Only bundled code executes with the native bridge. Keep the UI's CSP restricted
to local scripts, no frames, and no embedded active content from imported JSON.
All remote navigation is blocked in the WebView. Verified Google Drive links
can open externally through an explicit user action.

## `StorySpotNative` bridge

- `getItem(key)`, `setItem(key, value)`, `removeItem(key)`: private persistent text.
- `getAppInfo()`: JSON describing app version and native API.
- `fetchText(id, url)`: background public HTTPS Drive text read, maximum 8 MB.
- `cacheMedia(id, url)`: background public HTTPS Drive media download, maximum
  120 MB; always reads current bytes on explicit sync. Stores by content hash.
- `registerMedia(url, revisionToken)` (alias `remoteMedia`): returns a local
  `/remote/` URL immediately, without downloading. The registry persists across
  app restarts. The first image/audio request downloads and caches the bytes;
  subsequent loads use the downloaded file offline. A changed revision token
  produces a new mapping and checks the current remote file. Use a per-file
  content hash or Drive modification time/size; without a trustworthy revision,
  supply a fresh sync token to avoid indefinitely retaining an edited file.
- `sync()`: invokes `window.StorySpotSync.sync()` in the trusted UI.
- `openDriveFolder(url)`: verifies a Drive folder URL and opens it externally.

Network responses call `window.onNativeResponse({id, ok, text?, url?, sha256?,
error?})`. Native requests permit only `drive.google.com`,
`drive.usercontent.google.com` and subdomains of `googleusercontent.com`, over
HTTPS without URL credentials or nonstandard ports. Redirects are checked too.
Private files require sharing access or local file import; no Google account
token is embedded in this application.

Standard HTML file inputs use Android's document picker. Remote and cached
audio responses implement byte ranges for seeking. Android's pause lifecycle
pauses all audio/video and dispatches `storyspot:pause`. Returning to a loaded
WebView dispatches `storyspot:resume` for an automatic Drive refresh. A UI can implement
`window.storyspotBack()` returning `true` when it has handled Android Back.

Run the native byte-range boundary checks without an emulator:

```sh
mkdir -p build/range-tests
java -m jdk.compiler/com.sun.tools.javac.Main -d build/range-tests \
  android/src/com/storyspot/app/ByteRange.java android/tests/ByteRangeTest.java
java -cp build/range-tests com.storyspot.app.ByteRangeTest
python3 android/tests/test_asset_policy.py
```

Compilation, signature verification, and these tests do not establish playback
on a physical Android device. Device testing must be reported separately.
