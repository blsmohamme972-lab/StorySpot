# Quotation at the end of the story

The supplied Arabic quotation appears over the image only while that quotation is spoken in the existing Arabic story recording. It is not spoken again, and the English explanation has no quotation prelude. The rest of the story text is not rendered as image captions.

A story provides an explicit recorded interval:

```json
"quote": {"text": "الجمال سينقذ العالم", "start": 38.9868, "end": 46.1316}
```

`text` is the supplied Arabic quotation. If absent, the player can extract the last `«…»` quotation in `storyText`. The player never estimates start/end times: without a valid explicit interval the quote remains hidden. Interval metadata must come from the matching recording's timing and text review. Sentence-boundary metadata is not word-level alignment or proof of human listening.

The app calls `StorySpotQuotes.showAt(audio.currentTime, enabled)` from the recorded playback timeline. `enabled` is true only during active story playback. Seeking recomputes visibility, pausing hides the quote, and the quote disappears at its interval's end. Switching to Explanation or MCQ, changing the story/book, or stopping playback hides it. The module does not invoke native or browser text-to-speech, alter the recording, add attribution, or assert that supplied quotations are independently verified.
