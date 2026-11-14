# StorySpot 0.3.1 repair update

Package `com.storyspot.app`, version code 4. Install over the existing app using
the original signing certificate. Saved stories, preferences, downloaded media,
book connections and story IDs remain in place. Do not uninstall or clear data.

## Repaired behavior

- Recorded WebView audio uses Chromium's audio focus. Native focus belongs to
  Android MCQ speech, so the app no longer competes with its own recording.
  Released focus callbacks cannot interrupt a later recording.
- Pending MCQ speech survives a simultaneous sync after seeking. Unexpected TTS
  cancellation reports immediately, and an explicit Play can retry failed voice
  initialization after Android voice settings change.
- Byte-range media streams enforce their limits when WebView skips or probes.
  Truncated streams fail explicitly. Cached media is checked against its hash on
  first use or file change; corrupt entries can be replaced with a fresh download.
- Manual sync preserves unchanged, versioned media URLs and downloaded files.
  Automatic checks preserve unversioned mappings; manual sync revalidates those.
  Three concurrent story reads reduce serial waiting while preserving feed order.
- Malformed Drive listings cannot masquerade as an empty library. Partial
  discovery retains absent cached stories, and a partial or failed read cannot
  strip existing narration or overwrite a completed library with partial data.
- Swipes require a clear vertical gesture. Cancelled touches, multiple fingers,
  controls and dialogs cannot leave stale gestures armed. Wheel inertia and held
  arrow keys cannot repeatedly skip stories. MCQ text scrolls within its panel.
- Same-media refresh updates the Next button, category, image description, timing
  status and duration without resetting playback. Same-book selection clears the
  Saved filter correctly even offline. Applying a deferred update that removes
  stories preserves narration intent and selects the intended surviving story.
- Short landscape screens keep the image and transport controls reachable.

## Validation

44 Python content/Drive/timing tests, 3 APK asset-policy tests, 19 Java range cases,
12 native focus checks, stream/cache integrity checks and browser suites passed.
Browser coverage includes the existing 11 stories and 22 original recordings,
offline reopening, saved state, MCQ callbacks, speech/sync races, catalog changes,
actual Chromium touch scrolling, gestures, and portrait/landscape layouts.

A read-only check against the live public Drive collection discovered 11 stories
and 33 media registrations. Two consecutive manual syncs preserved all media
URLs and completed in approximately 8 seconds each in the test environment.
All 22 unchanged MP3s matched their saved hashes/text/durations and decoded fully.
The APK is signed with the original certificate and contains no lesson media.

Physical Android listening and gesture testing have not been performed. Existing
spotlights use provider sentence boundaries, not verified word-level alignment;
multiple symbols mentioned in one sentence can share a single target. Public
Drive HTML discovery still has no guaranteed unbounded pagination contract.
No lesson text, artwork, narration, quote timing or live catalog was changed.
