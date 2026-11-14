# StorySpot 0.3.2

Package `com.storyspot.app`, versionCode 5, signed with the original certificate.
Install over the existing app; keep app data and downloaded media.

- Artwork has a dedicated surface. Titles, categories, status chips, cue labels,
  position, and controls live outside it. MCQs and quotes replace the artwork
  with an opaque reading surface. The spotlight remains on the artwork.
- Recorded audio from native same-origin remote/cache URLs is read completely
  into a Blob before playback. This bypasses the WebView intercepted range-stream
  decoder path implicated in the reported 0:19 stop at 2x. Native cache integrity
  checks remain in force. Only the current track Blob is retained; track changes
  abort stale reads and revoke old URLs. Playback generation guards preserve Pause
  and navigation intent. External browser recordings retain ordinary streaming.
- Vertical gestures give proportional drag feedback and animate the outgoing and
  incoming artwork. Cancelled gestures reset, and reduced-motion preferences
  disable the transitions. MCQ scrolling and existing gesture filtering remain.

Validation: 44 Python tests, 3 APK policy tests, native range/focus/stream checks,
eight existing browser suites, plus a new accelerated-audio suite. Original
story-1 story and explanation MP3s played from the start beyond 0:19 at 2x in
Chromium, then passed pause/resume, seek, and natural completion. The new suite
also checks pending-read cancellation, separated artwork/metadata bounds,
transition cleanup and reduced motion. Portrait and rotated control reachability
passed. APK signature, package/version, alignment and UI-only assets verified.

The reported physical-device fault could not be reproduced on a physical Android
device here. The complete-file path is covered in Chromium, but Android listening
and gesture verification remain outstanding. No lesson content or live catalog
was changed. Existing synthetic speech and sentence-level timing limitations remain.
