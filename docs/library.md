# Multiple books and MCQ content

Each book uses its own public Google Drive folder. In the library, choose a saved
book or add its name and folder link. Adding a book does not copy any content or
share the folder. Enable link viewing on the content folder and its files before
syncing; private Google Drive login is not implemented by this app.

Books are independent of the original 200-question collection. There is no
200-question counter or fixed book title in the player. A new book needs its own
images, story/explanation audio, matching content and reviewed timing. Adding a
book does not create those assets or infer clinical explanations. One folder and
one child-folder level are automatically discovered. Drive's public HTML listing
has upstream size/format limitations; a complete `catalog.json` is recommended
for larger books, with at most 500 stories per manifest.

The original book retains its existing story IDs and cache key, so its saved
stories and downloaded media survive an update. New books have folder-based IDs;
their story IDs are prefixed with that book ID to prevent collisions. Switching
books opens its most recent completed catalog immediately. Network failure
preserves that book's completed catalog. An unfinished sync for another book
cannot overwrite the current book.

The public JavaScript library API is:

```js
StorySpotSync.listBooks();             // copies of {id,name,folderId,folderUrl}
StorySpotSync.currentBook();
const book = StorySpotSync.addBook('Book name', 'https://drive.google.com/drive/folders/FOLDER_ID');
StorySpotSync.selectBook(book.id);     // opens cached/empty catalog, calls onNativeCatalog
await StorySpotSync.sync();           // optional refresh of selected book
```

MCQ data can be supplied in a story's manifest `mcq` object or in an adjacent
`<image-basename>-mcq.json` file. An MCQ object uses this shape:

```json
{
  "stem": "The question stem",
  "options": [
    {"label": "A", "text": "An answer statement", "explanation": "Reviewed rationale"},
    {"label": "B", "text": "Another answer statement", "explanation": "Reviewed reason this is wrong"}
  ],
  "key": "A",
  "explanation": "Reviewed explanation of the keyed answer",
  "language": "en"
}
```

Keep option labels and answer keys faithful to the book. Missing explanations
remain missing; the app must not invent them. A question with a disputed or absent
key should identify that explicitly rather than assigning a replacement letter.
The XLSX importer prepares this metadata from source columns; reviewed
per-option rationale must be provided separately when it is absent from the source.

MCQ playback in this update uses the phone's native text-to-speech engine. It
speaks the stem, keyed answer and its supplied explanation, then the other
options and their supplied reasons. Missing rationales are identified as missing;
the player does not generate medical explanations. The active narration segment
highlights the corresponding on-screen question or option.

`mcqAudio`, `mcqDuration` and `mcqCues` are reserved metadata fields, retained by
the Drive loader for a future recorded-MCQ player. An adjacent
`<image-basename>-mcq.mp3` is discovered and retained, but this release's MCQ mode
does not play that recording. Story and Explanation continue to use recorded
tracks. Their `<image-basename>-timing.json` supplies `cues` and
`explanationCues`. Cue `time` and optional `end` are seconds on the selected audio
track, x/y are normalized image coordinates, and optional `segmentId` is retained.
The player keeps the image fitted in place; zoom values from older catalogs are
accepted for compatibility and no longer move the image.

## Import an MCQ spreadsheet on the desktop

Keep source data and generated question banks outside `web/`; they are not APK
input. The importer reads exactly `MCQ`, `Option A` through `Option E`, `Answer key`
and `Explanation`. The MCQ field must begin with its original number, for example
`7. Question stem`. It preserves absent or disputed keys, and notes image options
whose figures are absent from the workbook. Empty rationale cells stay empty.

```sh
python tools/import_mcqs.py --xlsx /private/MCQs.xlsx --output /private/mcq-bank.json
```

Optional reviewed rationale input uses question numbers and option labels:

```json
{
  "7": {
    "correctExplanation": "Reviewed explanation of the keyed answer",
    "options": {"B": "Reviewed reason option B is wrong"}
  }
}
```

To prepare a separate enriched catalog without changing the source catalog:

```sh
python tools/import_mcqs.py --xlsx /private/MCQs.xlsx --output /private/mcq-bank.json \
  --rationales /private/reviewed-rationales.json \
  --catalog /private/catalog.json --catalog-output /private/catalog-with-mcqs.json
```

The join uses only an explicit story `number` or `drive.number`. It never assumes
that array position is a question number. Two scenes with the same number both
receive that question; conflicting numbers are rejected. Stories without a
matching explicit number keep their current metadata. Review the enriched catalog
before uploading it to the book's content folder.
