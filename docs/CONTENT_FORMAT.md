# StorySpot remote content format

The APK embeds no lesson images, audio, stories, or explanations. The player discovers them in the configured public Google Drive folder and caches downloaded files privately. Content changes in Drive can reach the app without an APK rebuild.

## File naming without a manifest

Place each image and its related files together in the root folder or one public subfolder. Matching uses exact image basenames. For example:

| Image | Related file | Content |
| --- | --- | --- |
| `moon.png` | `moon.txt` | Arabic story text |
| `moon.png` | `moon.mp3` | Arabic story voice |
| `moon.png` | `moon-explanation.txt` | English explanation text |
| `moon.png` | `moon-explanation.mp3` | English explanation voice |
| `moon.png` | `moon-timing.json` | `cues` and `explanationCues` arrays |

Supported image extensions are PNG, JPG, JPEG, WebP, and GIF. Story audio sidecars can also use M4A, WAV, or OGG. Prefixes and suffixes such as `story`, `text`, `audio`, `explain`, `explanation`, `cues`, and `timing` use a hyphen or underscore separator. Existing numbered collections may use `16.png`, `story-image-16.txt`, `story-16.mp3`, `explanation-16.mp3`, and `timing-16.json`.

Images appear even when no sidecars are present. Duplicate basenames in the same folder do not cause images to disappear, but sidecar pairing is ambiguous; provide an explicit manifest using exact Drive file IDs. Public folder listing is an unofficial fallback and can be partial or change format. An explicit manifest is recommended for dependable metadata mapping; see [DRIVE_SYNC.md](DRIVE_SYNC.md).

## Optional catalog manifest

Add `catalog.json` or `storyspot.json` to Drive to enrich discovered images. Its `stories` entries map exact `drive.imageId` values to metadata; it does not hide new images absent from the manifest. Preserve each story's `id` across changes so saved-story state remains associated with it.

```json
{
  "schemaVersion": 1,
  "name": "StorySpot",
  "stories": [
    {
      "id": "example-1",
      "title": "The Breathing Lantern",
      "subtitle": "A cage that protects and breathes",
      "topic": "Thoracic cage",
      "image": "GOOGLE_DRIVE_IMAGE_FILE_ID",
      "drive": {
        "imageId": "GOOGLE_DRIVE_IMAGE_FILE_ID",
        "textId": "GOOGLE_DRIVE_ARABIC_TEXT_FILE_ID"
      },
      "storyText": "تحمي الأقواس مصباح الحياة.",
      "explanationText": "The arches represent the protective ribs.",
      "storyAudio": "GOOGLE_DRIVE_ARABIC_MP3_FILE_ID",
      "explanationAudio": "GOOGLE_DRIVE_ENGLISH_MP3_FILE_ID",
      "duration": 12.5,
      "explanationDuration": 7.8,
      "cues": [
        {"time": 0, "x": 0.5, "y": 0.5, "zoom": 1, "label": "Overview"},
        {"time": 3.2, "x": 0.62, "y": 0.38, "zoom": 1.4, "label": "Protective arches"}
      ],
      "explanationCues": [
        {"time": 0, "x": 0.62, "y": 0.38, "zoom": 1.4, "label": "Ribs"}
      ]
    }
  ]
}
```

Media references accept public Drive file IDs or supported Google HTTPS file/download links. They must not point to former bundled paths such as `content/images/...`; no such media is installed with the APK. Titles and labels are English. `storyText` and story narration are Arabic; `explanationText` and its narration are English. Audio, text, topic, subtitle, duration, and cues are optional. Once an audio file loads, its actual duration controls playback.

A matching image retains its prior stable story ID. A newly discovered image uses its manifest ID when available, otherwise `drive-<imageId>`. Keep `drive.imageId` and `drive.textId` accurate when the original filenames are duplicated. Changed story text invalidates stale generated narration and timing; changed image content invalidates old focus positions until replacement timing is supplied. Include the replacement assets when making those changes.

## Camera and pointer cues

Each track has its own cue array: `cues` for the Arabic story and `explanationCues` for the English explanation. A timing sidecar contains those same two arrays. Cue `time` values must ascend and refer to seconds on that track's audio clock. Interpolation follows the clock during speed changes, pause, and seeking.

Coordinates `x` and `y` refer to the original image: `(0, 0)` is its top-left corner and `(1, 1)` its bottom-right corner. They position the pointer and camera focus. Use canonical fields `time`, `x`, `y`, `zoom`, and `label` in Drive manifests. Zoom values from `1` to `5` are supported by the player; gentle values around `1.2` to `1.7` preserve context. Labels are short English descriptions of the symbol.

The preserved initial remote collection was authored from actual image review and speech-provider sentence offsets in `production/audio-metadata.json`. Those focus choices are sentence-level timings, not human-verified word alignment. Changed narration needs regenerated audio and timing review; changed artwork needs renewed coordinate review. Desktop tools perform that authoring work. The Android app discovers, downloads, and plays the resulting files; it does not generate new speech or synchronization on the phone.
