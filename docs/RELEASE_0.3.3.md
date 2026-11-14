# StorySpot 0.3.3 — interface source candidate

**Status: source only.** Build-ready candidate (`com.storyspot.app`, versionCode 6). No 0.3.3 APK is provided, and the 0.3.2 signed APK remains unchanged. A compatible installable update must reuse the private original signing identity, be built and verified with the Android SDK, then be tested on a real Android phone. Never resign with a replacement key.

## Changes

- Artwork now receives more vertical space: reduced outer gutter, shorter app header and transport spacing, and compact single-row status chips.
- Save / Read / Sound are 36-pixel icon-only circular controls aligned in a 37-pixel strip **above** the image rather than consuming a separate row below it. The image itself is not overlapped, preserving important details.
- Image remains `object-fit: contain` with the existing focus/timing map; no artwork crop or changes to story media.
- Vertical touch feedback moves only the scene using composited `translate` and subtle opacity, never the entire viewer. Reduced-motion settings are respected.
- A completed swipe changes exactly one story, supports a short intentional flick, and cancels short/horizontal/multitouch gestures. The transition duration decreased from 260 to 190 milliseconds, with incoming and outgoing animation cleanup.
- At most two neighboring images are prefetched to reduce perceived delay on subsequent swipes. Remote catalog, IDs, library state, playback rules and content remain unchanged.

## Checks completed

- JavaScript syntax (`node --check`) and structural layout review.
- Headless Chromium smoke test with synthesized images and no networking at 320×568, 360×600, 390×700, 390×844, 430×932, 844×390, and 640×360: image loaded, all visible controls inside the viewport, no horizontal overflow, action toolbar fully above image at every tested size.
- Touch gesture smoke test: drag feedback, one-story swipe, short tap rejection, short fast flick, and outgoing-animation cleanup. Browser raised no JavaScript errors.
- Existing Python integration suites could not be fully run here: the optional authoring media fixtures are absent and network navigation to test hosts is administratively blocked. The self-contained inline-browser test does not require these fixtures.

## Outstanding before Android release

- Run complete native, catalog, Drive and browser regressions with original optional media fixtures.
- Restore the original private signing material *outside the source archive*, obtain SDK 35/build-tools 35, build the 0.3.3 APK, verify the original certificate and versionCode 6, then test actual swipe and media playback on a phone.
- Install over 0.3.2 without clearing app data.
