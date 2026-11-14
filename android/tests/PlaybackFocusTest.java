package com.storyspot.app;

/** Desktop checks of native speech vs. Chromium recorded-media focus ownership. */
public final class PlaybackFocusTest {
    private static final class Host implements PlaybackFocus.Host {
        int requests, abandons, pauses;
        boolean grant = true;
        PlaybackFocus policy;
        @Override public boolean requestSpeechFocus() { requests++; return grant; }
        @Override public void abandonSpeechFocus() { abandons++; }
        @Override public void pausePlayback() { pauses++; policy.release(); }
    }
    private static void equal(int expected, int actual, String message) {
        if (expected != actual) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
    private static Host create() {
        Host host = new Host(); host.policy = new PlaybackFocus(host); return host;
    }
    public static void main(String[] args) {
        Host recorded = create();
        recorded.policy.playbackChanged(true, true);
        equal(0, recorded.requests, "HTML recording does not acquire competing native focus");
        recorded.policy.onFocusLoss();
        equal(0, recorded.pauses, "Unowned callback does not pause a Chromium recording");

        Host speech = create();
        if (!speech.policy.acquireForSpeech() || !speech.policy.acquireForSpeech())
            throw new AssertionError("Speech must acquire granted focus");
        equal(1, speech.requests, "Successive TTS segments retain one native focus lease");
        speech.policy.onFocusLoss();
        equal(1, speech.pauses, "Real speech focus loss pauses playback");
        equal(1, speech.abandons, "Recursive pause cleanup abandons focus exactly once");
        speech.policy.onFocusLoss();
        equal(1, speech.pauses, "Late duplicate loss does not pause again");

        Host switched = create();
        switched.policy.acquireForSpeech();
        switched.policy.playbackChanged(false, true);
        switched.policy.playbackChanged(true, true);
        switched.policy.onFocusLoss();
        equal(1, switched.requests, "Switch from TTS to a recording does not reacquire native focus");
        equal(0, switched.pauses, "Late speech callback cannot stop the new recording");

        Host background = create();
        background.policy.playbackChanged(true, false);
        equal(1, background.pauses, "Background play request remains paused");
        equal(0, background.requests, "Background request does not take focus");

        Host denied = create(); denied.grant = false;
        if (denied.policy.acquireForSpeech()) throw new AssertionError("Denied focus must not be owned");
        denied.policy.onFocusLoss(); denied.policy.release();
        equal(0, denied.pauses, "Denied request has no lease to interrupt");
        equal(0, denied.abandons, "Denied request cannot abandon another owner's focus");
        System.out.println("PlaybackFocus: 12 ownership/interruption checks passed.");
    }
}
