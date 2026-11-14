**StorySpot 1.1.1 / version code 10.** This Android update keeps the Drive-only content model and uses the original signing identity.

# StorySpot

StorySpot is a Drive-powered Android app for visual mnemonic stories, package `com.storyspot.app`. Story text and narration are Arabic. Explanations, explanation narration, navigation, and controls are English.

The APK contains the player and Drive connection settings only. Images, stories, explanations, and audio come from the [Google Drive folder](https://drive.google.com/drive/folders/1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT). Adding content there does not require rebuilding or reinstalling the APK. The prepared remote collection contains 11 original images and stories, with 22 synthetic speech tracks; its authoring files remain outside the app's web assets.

## Use the app

Install version **1.1.1** as an update on Android 8.0 or later. An internet connection and public Drive link access are required for the first load. Tap Play once to begin; swipe up or down to move between stories and continue playback. Switch between **Story** and **Explain**, seek, change speed, mute, read the transcript, or save a story. Camera and pointer positions follow the selected audio track's clock.

The app refreshes Drive on launch and when returning to the app, and checks periodically while visible. **Sync from Drive** requests an immediate refresh. Successfully downloaded files remain in private app storage for offline reuse; files that have never been downloaded need a connection. The app does not use Google account login or change Drive files. Failed refreshes retain the last usable collection. Updates use the same app package and signing identity so saved story IDs remain available.

## Add content in Drive

Every visible image appears in the feed, even without narration or a text file. Place related files in the same folder and use matching names:

| File | Purpose |
| --- | --- |
| `moon.png` | Image; JPG, JPEG, WebP, and GIF are also recognized |
| `moon.txt` | Arabic story |
| `moon.mp3` | Arabic story narration |
| `moon-explanation.txt` | English explanation |
| `moon-explanation.mp3` | English explanation narration |
| `moon-timing.json` | Story and explanation camera cues |

The existing numeric convention also works: `16.png`, `story-image-16.txt`, `story-16.mp3`, `explanation-16.mp3`, and `timing-16.json`. The app reads the root folder and one level of public subfolders. Duplicate basenames in one folder remain separate images; use a manifest with exact Drive IDs to map their sidecar files without ambiguity.

An optional `catalog.json` or `storyspot.json` supplies richer titles, explanations, narration, and cues while newly discovered images still appear. See [Drive setup](docs/DRIVE_SYNC.md) and [content format](docs/CONTENT_FORMAT.md). The app does not create missing narration or timing on the phone: add those assets to Drive or prepare them using the desktop authoring tools.

## Build and authoring

Requirements: Python 3, JDK 17 or later, Android SDK platform 35, and build-tools 35. The default SDK location is `../android-toolchain`; override it with `--sdk-dir`.

```sh
python tools/build-apk.py
```

Use `--init-key` only for the first build of a new app identity. Delivered updates must reuse the original private signing key. The builder pins the public certificate in `android/signing-identity.json`; private signing files and their backup live outside this source tree and are excluded from the source archive. Never regenerate the key for an update.

With the original private signing identity and Android toolchain restored, a new build will output `dist/StorySpot-1.1.1.apk`, with a SHA-256 checksum and build metadata. This source archive does not include a signed 1.1.1 APK. The historical `release/StorySpot-0.3.2.apk` is retained for historical reference, unchanged. Build verification checks package identity, APK signatures, and ZIP alignment; these checks do not establish playback on a physical phone.

The preserved desktop authoring collection is in `production/remote-library/`; it is not APK content. See [speech generation](docs/AUDIO.md) for audio provenance. Its narration is synthetic, and camera cues use provider sentence offsets and actual visual review. They are not human-verified word alignments. Medical mnemonic claims and literary quotations are supplied content and have not been independently source-verified. Automated and browser checks are separate from human listening and Android device testing.
