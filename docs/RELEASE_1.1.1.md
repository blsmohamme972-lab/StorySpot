# StorySpot 1.1.1

Version 1.1.1 (versionCode 7) is the signed Android update for `com.storyspot.app`.
It keeps Google Drive as the source of images, story text, narration, explanations,
and timing data; the APK contains only the UI, fonts, and empty Drive connection
configuration. Existing app data and the original signing identity are preserved.

The playback controls now sit lower in a translucent rounded dock below the artwork.
The dock uses a soft gradient and blur, with a lighter selected track and play
control, so image details remain unobstructed and the compact Android portrait
layout stays touchable. Short-height and reduced-motion layouts retain the same
spacing and behavior.

Validation completed for this build:

- Python catalog, Drive-sync, and APK asset-policy tests
- Java byte-range and media tests
- Chromium UI, playback, integration, MCQ, quote, race, catalog, gesture, and accelerated-audio suites
- Signed APK package/version, certificate, ZIP alignment, and Drive-only asset checks

Physical Android playback and touch testing still require a handset.
