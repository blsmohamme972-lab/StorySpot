# StorySpot maintenance

Read `docs/HANDOFF.md`, `HANDOFF.json`, and `docs/BUILD_SETUP.md` before updates.

The user uses Android in portrait only. Prioritize portrait touch interactions and controls on compact usable viewports; this preference does not request an orientation lock.

- This is the independent `com.storyspot.app` application. The baseline is 0.2.0 / code 2; next source candidate is 1.1.1 / code 10; the latest signed release is 0.3.2 / code 5. Increment the version code for executable updates and preserve the package and original signing identity.
- All lesson images, stories, audio, and timing come from Google Drive at runtime. The APK contains only the player, empty connection config, fonts, and UI resources. Never restore the old bundled lesson collection.
- MCQ voice is English Android TTS. Quote overlays use the original Arabic story recording near its end, never an Explanation prelude. Missing distractor rationales must remain explicitly missing.
- Story text and story voice are Arabic; explanation text, explanation voice, controls, and the rest of the interface are English.
- New Drive images must be discoverable without an APK rebuild. Preserve stable story IDs, saved state, preferences, downloaded-content cache, and playback during unchanged automatic refreshes. Never uninstall or clear app data as a routine update step.
- Restore the existing private signing backup from the separately restricted Drive location. Never regenerate the key or use `--init-key` for this delivered app. Keep all key/password files outside source archives, Git, public Drive folders, and APKs.
- The content folder is public for read access. Source and signing backups are in separate owner-only folders. Do not change sharing or move signing material into the content folder.
- `production/remote-library/` holds desktop authoring metadata; its optional `content/` fixtures are restored from the authoring media archive. These files are never APK input. Do not overwrite enriched source catalogs by casually rerunning base preparation tools.
- Validate the relevant Drive, UI, APK asset-policy, and native audio-range behavior. Browser tests and signing checks do not establish playback on a physical Android device; the baseline has no physical-device test.

No app service credentials are required for the current public Drive reader. Public HTML folder discovery can change upstream and has no guaranteed unbounded pagination contract. Check `docs/DRIVE_SYNC.md` before changing discovery behavior.
