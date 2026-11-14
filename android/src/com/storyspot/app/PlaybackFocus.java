package com.storyspot.app;

/** Native focus belongs to Android TTS; Chromium owns its recorded-media focus. */
final class PlaybackFocus {
    interface Host {
        boolean requestSpeechFocus();
        void abandonSpeechFocus();
        void pausePlayback();
    }

    private final Host host;
    private boolean ownsSpeechFocus;

    PlaybackFocus(Host host) { this.host = host; }

    void playbackChanged(boolean active, boolean foreground) {
        if (active) {
            // Requesting native focus here competes with Chromium's independent
            // focus request when HTML audio starts, pausing our own recording.
            if (!foreground) host.pausePlayback();
        } else release();
    }

    boolean acquireForSpeech() {
        if (!ownsSpeechFocus) ownsSpeechFocus = host.requestSpeechFocus();
        return ownsSpeechFocus;
    }

    void release() {
        if (!ownsSpeechFocus) return;
        ownsSpeechFocus = false;
        host.abandonSpeechFocus();
    }

    void onFocusLoss() {
        // An abandoned native request can still have a queued callback. It
        // must not stop a recording that has since taken over in Chromium.
        if (!ownsSpeechFocus) return;
        release();
        host.pausePlayback();
    }
}
