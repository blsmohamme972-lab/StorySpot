# StorySpot 0.3.0

Package com.storyspot.app, version code 3, same signing certificate as 0.2.0.
Install as an update, then tap Sync. Do not uninstall or clear application data.

This release keeps images stationary. Spotlights switch at supplied speech
sentence boundaries, with explicit end times. Existing target coordinates are
preserved; no new image inspection, word alignment or human listening is claimed.
All 22 existing narration text hashes and durations match the saved timing data.

The Arabic quotation appears only when its existing recorded story sentence is
playing near the end of Story. Explanation plays its original English recording
without an added quotation. Other story text is not overlaid on the artwork.

MCQ is the third track. The image is translucent behind the question and options.
Android text-to-speech reads the stem, the keyed answer statement, then the other
options and supplied rationales. Highlight transitions use utterance callbacks.
English voice data must be available in Android Text-to-speech settings. No cloud
speech credentials or new narration files are required. A missing rationale is
explicitly identified; the player only reads explanations included in its catalog. Disputed source
keys are displayed as needing review, and their options are not graded.

The supplied 200-question workbook contains only four explicit explanations and
no individual distractor rationales. A separate AI-authored layer now supplies
explanations without altering the original stems, options or source keys.
Ambiguities are explicitly flagged. The 11 existing image stories are linked to
their matching questions (both Q7 images share Q7). The remaining question bank
is prepared for authoring; this does not create 200 illustrated stories. Referenced
figures that are absent from the workbook are not reconstructed.

Library → Add book connects an independent public Drive content folder. Each book
has independent IDs and a cache. Adding a folder does not generate story artwork,
voice tracks, explanations or timing. See library.md for matching files/imports.

Playback defers changed catalogs during narration, guards stale play promises,
and keeps buffering distinct from Pause. Native playback handles audio focus,
rejects incomplete downloads and pauses on actual background/audio-focus loss;
it no longer pauses just because the activity temporarily loses foreground focus.
Background/lock-screen playback is not implemented. Downloaded content and saved
stories retain their IDs.

Browser playback/controller tests, data/Drive regressions, APK asset checks,
native byte-range checks and certificate verification are separate from a
physical Android listening test. Physical-device playback has not been tested.
