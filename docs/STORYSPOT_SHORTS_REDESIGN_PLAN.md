# StorySpot Android Shorts redesign plan

**Status:** planning only. This change documents the implementation sequence; it does not modify the app UI, native code, content, or build output.

**Repository:** `blsmohamme972-lab/StorySpot`  
**Package:** `com.storyspot.app`  
**Current release:** 1.1.1 / versionCode 10  
**Target:** Android phones in portrait use, with a YouTube Shorts-like vertical story feed.

## Product result

The feed should feel like a focused Shorts viewer:

- The current story image owns almost the entire usable phone viewport. It is edge-to-edge inside the Android safe area, uses a consistent crop, and has no desktop-style side gutters or letterboxed panel.
- Save, transcript, sound, play, speed, and the next-story affordance float above the image as small translucent controls. The visible icon is compact; the larger hit area remains accessible at about 44 dp. Labels are hidden from the visual layout but retained in `aria-label`/focus text.
- Unnecessary chrome disappears from the feed: duplicate headings, collection slogans, counters, repeated audio labels, asset-status chips, and explanatory filler do not compete with the image. Keep only the essential story context and the controls needed to learn, play, save, read, and answer.
- A deliberate upward or downward gesture advances exactly one story. A quick flick responds immediately, a slow drag has a clear snap, horizontal movement does not navigate, and a tap on a control never becomes a swipe. Pointer and touch input must work in Android Chrome/WebView.
- Current and adjacent media are warm before a swipe. Off-screen media and audio stop cleanly, and the feed remains responsive on a mid-range Android phone.

## Hard preservation rules

The redesign is presentation and interaction work only. Every agent must preserve:

- Google Drive runtime discovery and sync, including the root folder, catalog, one-level folder discovery, cache behavior, and offline reuse.
- Stable story IDs, image/audio URLs, Arabic story text and story voice, English explanation text and controls, MCQ behavior, camera/light/pointer timing, and quote timing.
- Saved stories, preferences, the current playback position, downloaded media, and refresh behavior. Never uninstall the app or clear app data.
- The thin APK boundary: lesson content remains in Drive and must not be copied into the APK.
- Package `com.storyspot.app`, the existing signing identity, and the current version files unless a later release task explicitly changes them.
- Portrait-first Android behavior. Do not add an orientation lock; the requirement is a portrait layout, not a native orientation-policy change.

## Baseline to use

The relevant surfaces in the current repository are:

- `web/index.html`: `#viewer`, `#storyImage`, `#scene`, `.side-actions`, story metadata, and the audio player.
- `web/styles.css`: `.viewer`, `.scene img`, `.side-actions`, `.story-info`, `.player`, safe-area rules, and the 1.1.1 compact-screen overrides.
- `web/app.js`: `drawScene()` (image/cue geometry), `prefetchNeighbors()`, `move()`, and the touch/wheel gesture handlers.
- `android/src/com/storyspot/app/MainActivity.java`: the WebView/immersive shell. Keep native behavior unchanged unless a later slice proves a WebView-only fix is insufficient.
- `tests/gestures.test.cjs`, `tests/ui.test.cjs`, `tests/catalog-flow.test.cjs`, and `tests/playback-races.test.cjs`: regression coverage to retain and extend only when a slice changes the contract.

Known baseline issues to resolve in the slices below:

- The image layer still uses `object-fit: contain` and the viewer leaves substantial non-image space on compact phones.
- Actions are currently laid out in a heading strip rather than as a Shorts-style overlay rail.
- Several labels and status blocks remain visible even though the image is the primary content.
- Swipe behavior is touch-first and already has thresholds, but it needs a pointer-compatible, velocity-aware, direction-locked snap interaction with stricter tap/control cancellation.

## Sequential agent slices

Each agent owns **at most 15% of the total redesign scope**. Work is sequential: finish one slice, commit it, record evidence, and hand the next agent the prompt shown below. Do not combine slices, redesign unrelated screens, or spend a later slice on unfinished work from an earlier slice without documenting the tradeoff. The seven slices leave a small contingency for integration fixes; no slice may exceed its 15% cap.

### Agent 1 — Android portrait Shorts shell (15% maximum)

Implement the viewport contract only. Make the feed route consume the portrait phone viewport with `100dvh`/safe-area variables, establish one full-height viewer stage, and set the gesture ownership boundary (`#viewer` owns vertical paging; controls and dialogs remain interactive). Keep existing story rendering and audio behavior. Do not change crop math, action placement, copy, or Drive code yet.

**Acceptance:** no horizontal overflow at 360×800, 390×844, and 412×915; the viewer has a stable height when browser chrome changes; safe-area padding is respected; existing UI and tests still load.

**Handoff prompt:**

> You are Agent 1 for StorySpot. Work only on the Android portrait Shorts shell described in `docs/STORYSPOT_SHORTS_REDESIGN_PLAN.md`. Inspect `web/index.html` and `web/styles.css`, then implement the viewport/safe-area contract for `#viewer` and its parent feed. Use `100dvh` and Android-safe-area variables, keep the existing Drive/story/audio APIs and DOM IDs, and do not change image crop, controls, copy, or swipe thresholds yet. Test at 360×800, 390×844, and 412×915, commit only this slice, and hand off: files changed, tests run, screenshots/measurements, known risks, and the exact prompt for Agent 2.

### Agent 2 — Full-bleed media (15% maximum)

Make the current image fill the usable viewer with a deliberate `cover` crop and no inset card. Update `drawScene()` cue positioning if needed so camera/light/pointer coordinates still point to the intended visual region after cropping. Preserve image loading, fallback, and Drive URLs.

**Acceptance:** image pixels occupy the viewer on portrait Android sizes; no letterbox gutters; cue pointer and spotlight remain aligned; image failures still show the existing empty/error path.

**Handoff prompt:**

> You are Agent 2 for StorySpot. Start from Agent 1’s commit and implement only full-bleed media. Change the viewer image layer to a consistent viewport-sized crop, update cue geometry for the crop if required, and keep all existing media IDs, Drive URLs, loading states, and audio timing intact. Do not move controls or remove text. Verify portrait screenshots at 360×800, 390×844, and 412×915 plus the existing playback/cue checks. Commit this slice and hand Agent 3 the files, evidence, risks, and next prompt.

### Agent 3 — Translucent overlay controls (15% maximum)

Move the existing actions into the image layer as a right-side Shorts rail (or an equivalent absolute overlay) without changing their handlers or IDs. Use transparent/blurred surfaces that remain readable on bright and dark artwork. Keep at least a 44 dp touch target, a roughly 20–24 px icon, focus rings, and accessible names. Keep the play/speed/audio controls reachable without adding a large panel over the artwork.

**Acceptance:** controls visibly float over the image, labels do not consume layout space, taps work in WebView, focus and pressed states remain visible, and swipe gestures are blocked while a control is being touched.

**Handoff prompt:**

> You are Agent 3 for StorySpot. Build only the Shorts-style translucent overlay controls from the plan. Reuse the existing save, transcript, sound, play, speed, and next actions; preserve their IDs and JavaScript handlers. Use small visible icons with accessible hit areas, safe-area offsets, contrast scrims, and no opaque card. Do not redesign the media crop, metadata, or swipe engine. Run UI and gesture regressions, commit this slice, and hand Agent 4 the evidence and prompt.

### Agent 4 — Minimal feed metadata (15% maximum)

Reduce visible copy on the feed while retaining learning meaning and accessibility. Hide or relocate collection slogans, redundant counters, duplicate audio labels, asset chips, the player note, and any repeated story heading. Keep a compact essential title/context line, progress/audio affordance, transcript/MCQ access, and screen-reader labels. Do not delete data fields needed by Drive content or dialogs.

**Acceptance:** the image remains dominant; no text block obscures the focal artwork; the story and explanation remain understandable; saved/library/transcript/MCQ flows still work.

**Handoff prompt:**

> You are Agent 4 for StorySpot. Apply only the minimal-copy pass from the plan. Remove visual clutter from the feed with CSS or narrowly scoped markup while preserving semantic labels, story/explanation text sources, transcript, MCQ, saved state, and all existing element IDs used by `web/app.js`. Keep one compact essential story context and the playback affordances. Do not change swipe physics or media loading. Run the UI/catalog regressions, commit this slice, and hand Agent 5 the changed files, measurements, and prompt.

### Agent 5 — Faster vertical swipe engine (15% maximum)

Upgrade paging to a Shorts-like interaction: pointer events plus touch fallback, vertical direction lock, velocity-aware threshold, one item per gesture, cancellation on multi-touch/control/dialog/track changes, and a short composited snap transition. Keep keyboard and wheel fallback where already supported. Avoid scroll chaining and accidental taps.

**Acceptance:** one deliberate swipe changes exactly one story; fast flicks feel immediate; slow drags snap cleanly; horizontal/diagonal drags, second fingers, cancelled touches, and control taps do not navigate; reduced-motion users get an instant equivalent state.

**Handoff prompt:**

> You are Agent 5 for StorySpot. Implement only the faster vertical paging contract in `web/app.js` and its narrowly related CSS. Add pointer support while retaining Android touch behavior, direction lock, velocity and distance thresholds, cancellation rules, one-item-per-gesture protection, and a short transform/opacity snap. Keep audio, cue timing, Drive sync, and saved state unchanged. Extend `tests/gestures.test.cjs` for the new edge cases, run the gesture/UI suite, commit this slice, and hand Agent 6 the evidence and prompt.

### Agent 6 — Media lifecycle and perceived speed (15% maximum)

Tune current/adjacent image prefetch and decoding, avoid unnecessary re-render work during drag, pause or stop off-screen audio, and recover from transient image/audio failures without breaking the feed. Keep cache keys and Drive sync semantics unchanged.

**Acceptance:** the next image is decoded/warm before a normal swipe when available; no off-screen audio continues; repeated syncs do not lose the current story or saved state; the feed remains responsive on a mid-range Android WebView.

**Handoff prompt:**

> You are Agent 6 for StorySpot. Optimize only the media lifecycle and swipe readiness described in the plan. Measure current/adjacent image prefetch, decoding, render work, audio pause/resume, and transient failure recovery. Preserve Drive URLs, cache behavior, story IDs, playback position, cues, and all visual decisions from Agents 1–5. Make the smallest measurable fixes, run playback-race, catalog, UI, and gesture tests, commit this slice, and hand Agent 7 the evidence and prompt.

### Agent 7 — Android QA and polish (15% maximum)

Run the final portrait device-sized QA pass and make only polish or regression fixes within the established design. Check contrast, focus, safe areas, touch targets, reduced motion, Arabic story text, English controls, empty/offline states, and long/short images. Capture before/after screenshots and record anything that needs a later release task.

**Acceptance:** no horizontal overflow; the image is dominant; controls are small, translucent, reachable, and labeled; swipe is stable and fast; Drive content and audio/cue behavior are preserved; existing tests pass. Physical Android playback remains a separate verification item and must not be claimed from browser tests.

**Handoff prompt:**

> You are Agent 7 for StorySpot. Perform only the final Android portrait QA/polish slice. Use the acceptance checklist in `docs/STORYSPOT_SHORTS_REDESIGN_PLAN.md` across 360×800, 390×844, and 412×915 layouts, including offline/empty states and Arabic story content. Fix only regressions or small visual/accessibility issues; do not add new features or alter Drive/content contracts. Run the relevant browser, gesture, catalog, playback-race, and asset-policy checks, capture screenshots, commit the slice, and write release notes plus any unresolved device-only checks.

## Handoff contract for every agent

Every handoff must include:

1. The exact commit hash and files changed.
2. The one acceptance slice completed, with no unrelated cleanup.
3. Tests/commands run and their result; distinguish browser evidence from physical Android evidence.
4. Screenshot dimensions or measurements for the affected interaction.
5. Open risks and the next agent's copy-paste prompt.

## Validation matrix

Use the smallest relevant checks after each slice, then the full UI/gesture/playback checks after Agent 7:

- Portrait layouts: 360×800, 390×844, 412×915; include short and tall artwork, safe-area insets, empty library, offline cache, and a refreshed catalog.
- Interaction: save, transcript, sound, play/pause, speed, next, MCQ, dialog focus, one-finger swipe, fast flick, horizontal drag, multi-touch, cancellation, keyboard, wheel, and reduced motion.
- Data/media: Drive sync, stable story IDs, image/audio cache, Arabic story text/audio, English explanation/audio, cue/pointer timing, current playback position, and saved state.
- Regression commands: `npm run test:ui`, `node tests/gestures.test.cjs`, `node tests/catalog-flow.test.cjs`, `node tests/playback-races.test.cjs`, and the relevant Python/native checks listed in `docs/HANDOFF.md`.

## Git sequence

Use one short-lived branch or commit per slice (for example `shorts-agent-01` through `shorts-agent-07`). Keep the plan document and code changes separate: this planning commit contains no implementation. Each agent should rebase or fast-forward from the previous handoff, run its scoped checks, and leave the next prompt in the handoff message.

