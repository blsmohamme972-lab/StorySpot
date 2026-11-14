# Drive-only library

StorySpot 0.2.0 contains the player and a Drive folder configuration. The APK includes **no images, stories, narration, timing cues or content records**. On a clean installation its library is empty until the first successful Drive sync. A completed remote library and played media may be cached privately on the phone for later use. Old APK asset paths cannot be restored from the legacy catalog cache.

Folder: https://drive.google.com/drive/folders/1eVNE4gXZUVkd0sP7uvrTa3SvB7k2EHaT

The Android app syncs on launch, foreground/resume and periodically while visible. **Sync from Drive** also refreshes manually. It reads files in the configured folder and one level of child folders. Every discovered image appears, including a standalone image without text, audio or timing. Adding matching files to Drive requires no APK rebuild. The player shows which optional media is missing.

Google account sign-in is not implemented. The folder and referenced files must allow **Anyone with the link – Viewer**. The app reads Drive; it does not upload, replace or delete Drive files or change their sharing permissions.

## Automatic filename matching

Images use PNG, JPEG, WebP or GIF extensions (or an image MIME type). Sidecars are matched within the same folder. For example:

- `moon.png`: the image.
- `moon.txt`: its story text.
- `moon.mp3` or `moon-story.mp3`: story narration.
- `moon-explanation.mp3`: explanation narration.
- `moon-explanation.txt`: explanation text.
- `moon-timing.json`: an object with `cues` and `explanationCues` arrays.

Hyphen and underscore prefix/suffix forms are supported. Numbered conventions also work: `16.png`, `story-image-16.txt`, `story-16.mp3`, `explanation-16.mp3` and `timing-16.json`. Audio extensions include MP3, M4A, WAV, OGG and AAC. Duplicate image basenames in the same folder both appear, but ambiguous sidecars are never assigned by guesswork. Use explicit Drive IDs in a manifest to disambiguate them.

Text-only stories without an image are not reel entries. New text does not trigger cloud speech generation from the Android app; add the corresponding narration and timing when available.

## Optional manifest enrichment

A public `catalog.json` or `storyspot.json` in the root or an inspected child folder supplies titles, explanations, exact media IDs and timing. The manifest **enriches** the live discovery results; it never hides newly added images that are absent from the manifest. Explicit manifest image IDs can also include images outside the initial public listing. Keep each image in at most one manifest.

```json
{
  "schemaVersion": 1,
  "stories": [{
    "id": "rib-neck",
    "title": "The breathing room",
    "image": "PUBLIC_DRIVE_IMAGE_FILE_ID",
    "storyText": "Arabic story narration here",
    "explanationText": "English explanation narration here",
    "storyAudio": "PUBLIC_DRIVE_STORY_MP3_FILE_ID",
    "explanationAudio": "PUBLIC_DRIVE_EXPLANATION_MP3_FILE_ID",
    "drive": {
      "imageId": "PUBLIC_DRIVE_IMAGE_FILE_ID",
      "textId": "PUBLIC_DRIVE_STORY_TXT_FILE_ID"
    },
    "cues": [
      {"time": 0, "x": 0.5, "y": 0.5, "zoom": 1, "pointer": false},
      {"time": 5.3, "x": 0.65, "y": 0.4, "zoom": 1.7, "label": "Rib neck"}
    ],
    "explanationCues": []
  }]
}
```

Media values accept a public Drive file ID or Google HTTPS download/file link. Times are seconds in the selected audio track; x/y are normalized coordinates on the original image (0 at left/top, 1 at right/bottom). Zoom ranges from 1 to 8. Cue times must ascend. `pointer: false` hides the target for an overview. The player uses the audio clock, so pause, seek and playback speed also update camera movement and the pointer.

Story IDs remain stable for the same Drive image across syncs, preserving saved-story references. A first discovery uses the manifest ID, or `drive-<imageId>` when no explicit ID exists. Exact image/text Drive IDs distinguish duplicate filenames.

## Downloads and updates

Native `registerMedia(url, revisionToken)` returns a local app URL without downloading the media immediately. Images and audio download when requested for display/playback. The native registry survives app restarts and serves cached audio with byte-range support. Revision tokens use live Drive modification time and size; manifest hashes or manifest revision provide a fallback. Automatic and manual sync reuse the mappings for unchanged known revisions, preserving downloaded media and the playing source. Unversioned media keeps its last mapping during automatic refresh; manual Sync revalidates only those unversioned mappings. A changed file revision receives a new mapping. Story text and sidecars are fetched with at most three stories in progress and shared reads are deduplicated within that sync; the completed library keeps its discovery order.

When a live story text differs from its manifest narration text, stale audio, explanation and timing are withheld. When the image revision changes without an updated manifest, old timing is withheld. Replacement sidecar timing can supply the new coordinates. The app does not invent missing narration or coordinates on the phone.

A failed sync leaves the last completed library selected. A malformed folder-data marker is rejected rather than treated as an empty folder. When one public listing view fails, previously synced images absent from the surviving view are retained; missing manifest enrichment or optional files for an existing story aborts the update so that a partial response cannot strip its narration or timing. A successfully parsed empty listing remains a valid empty library. A first-run network failure leaves the library empty and offers retry. Cached records must reference app-private `/remote/` or `/cache/` URLs; packaged `content/` and `/assets/` media paths are rejected. Uninstalling the app removes its private caches and saved state.

## Public-listing limits

Discovery merges the standard Drive folder page with `embeddedfolderview` and follows one level of child folders. Standard metadata supplies modification times and sizes; the embedded listing can reveal additional files omitted from the initial main view. These are unauthenticated read-only HTML interfaces, not a guaranteed unbounded paginated Drive API. Their format or limits can change. The app warns for large listings; maintain a complete manifest or use lesson subfolders if an item is missing. Arbitrary external media hosts, private files and deeper automatic folder recursion are not supported in this release.

## Verification

`python tests/test_drive_sync.py -v` tests empty startup, first remote discovery, new arbitrary images with an unchanged manifest, standalone images, one-level lesson folders, duplicate-ID disambiguation, embedded listing supplementation, offline rollback, cache restoration, legacy asset rejection, changed text/image invalidation, known/unversioned media revision reuse, malformed/partial listing rollback, richer embedded metadata merging and bounded parallel reads. Its fixtures are synthetic and contain no bundled lesson library.

`production/remote-library/live-sync-check.json` records a real public-network probe using the exact native user agent. It starts empty, reads the configured folder, child audio folder and remote manifest, then produces the current remote library with both narration tracks and preserved overview pointer flags. No media is eagerly downloaded by that sync probe. Earlier route evidence is in `production/drive-network-check.json`; actual MP3 hash checks are separate. Browser/mock tests and network reads do not establish real Android device playback or future Drive availability.
