package com.storyspot.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A trusted bundled UI with public Drive reads and private, offline media storage. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/index.html";
    private static final int PICK_FILE = 101;
    private static final int MAX_TEXT = 8 * 1024 * 1024;
    private static final long MAX_MEDIA = 120L * 1024 * 1024;
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private WebView web;
    private SharedPreferences store;
    private SharedPreferences remoteRegistry;
    private final ConcurrentHashMap<String, Object> remoteLocks = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> verifiedMedia = new ConcurrentHashMap<>();
    private boolean pageReady;
    private File media;
    private ValueCallback<Uri[]> chooser;
    private boolean destroyed;
    private boolean foreground;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocus;
    private PlaybackFocus playbackFocus;
    private TextToSpeech speech;
    private boolean speechReady;
    private boolean speechFailed;
    private SpeechRequest pendingSpeech;
    private String speakingId;

    private static final class SpeechRequest {
        final String id, text, language;
        final float rate;
        SpeechRequest(String id, String text, String language, float rate) {
            this.id = id; this.text = text; this.language = language; this.rate = rate;
        }
    }


    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.rgb(9, 12, 18));
        getWindow().setNavigationBarColor(Color.rgb(9, 12, 18));
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        playbackFocus = new PlaybackFocus(new PlaybackFocus.Host() {
            @Override public boolean requestSpeechFocus() {
                return audioManager != null && audioManager.requestAudioFocus(audioFocus)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            }
            @Override public void abandonSpeechFocus() {
                if (audioManager != null) audioManager.abandonAudioFocusRequest(audioFocus);
            }
            @Override public void pausePlayback() { MainActivity.this.pausePlayback(); }
        });
        audioFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(speechAttributes())
            .setAcceptsDelayedFocusGain(false)
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(change -> {
                if (change == AudioManager.AUDIOFOCUS_LOSS
                    || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                    || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    playbackFocus.onFocusLoss();
                }
            }, new Handler(Looper.getMainLooper())).build();
        store = getSharedPreferences("storyspot", MODE_PRIVATE);
        remoteRegistry = getSharedPreferences("remote-media", MODE_PRIVATE);
        media = new File(getFilesDir(), "media");
        if (!media.isDirectory() && !media.mkdirs()) throw new IllegalStateException("Cannot open media storage");
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(9, 12, 18));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(9, 12, 18));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, ime.bottom));
                return insets;
            });
            frame.requestApplyInsets();
        }
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Android document picker; never used for page navigation.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setTextZoom(100);
        settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);
        web.addJavascriptInterface(new Bridge(), "StorySpotNative");
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, PICK_FILE); }
                catch (Exception e) { chooser.onReceiveValue(null); chooser = null; }
                return true;
            }
        });
        web.loadUrl(START);
    }

    private final class Bridge {
        @JavascriptInterface public String getItem(String key) { return store.getString(key, null); }
        @JavascriptInterface public void setItem(String key, String value) {
            if (key != null && key.length() <= 256 && value != null && value.length() <= 4 * 1024 * 1024)
                store.edit().putString(key, value).apply();
        }
        @JavascriptInterface public void removeItem(String key) { store.edit().remove(key).apply(); }
        @JavascriptInterface public String getAppInfo() {
            return "{\"name\":\"StorySpot\",\"packageName\":\"com.storyspot.app\",\"version\":\"1.1.1\",\"versionCode\":7,\"nativeApi\":3,\"platform\":\"Android\"}";
        }
        @JavascriptInterface public void setPlaybackActive(boolean active) {
            runOnUiThread(() -> {
                if (destroyed) return;
                playbackFocus.playbackChanged(active, foreground);
            });
        }
        @JavascriptInterface public void speakMcq(String id, String text, String language, double rate) {
            final String safeId = id == null ? "" : id;
            if (safeId.isEmpty() || safeId.length() > 200 || text == null || text.trim().isEmpty()
                || text.length() > TextToSpeech.getMaxSpeechInputLength()) {
                speechEvent(safeId, "error", "This speech segment is empty or too long.");
                return;
            }
            final SpeechRequest request = new SpeechRequest(safeId, text,
                language == null || language.isEmpty() ? "en" : language,
                (float) (Double.isFinite(rate) ? Math.max(.5, Math.min(2, rate)) : 1));
            runOnUiThread(() -> requestSpeech(request));
        }
        @JavascriptInterface public void stopMcq() {
            runOnUiThread(() -> { stopSpeech(); releaseAudioFocus(); });
        }
        @JavascriptInterface public void sync() {
            runOnUiThread(() -> web.evaluateJavascript("window.StorySpotSync && window.StorySpotSync.sync();", null));
        }
        @JavascriptInterface public boolean openDriveFolder(String url) {
            Uri uri = Uri.parse(url == null ? "" : url);
            if (!isDriveLink(uri) || uri.getPath() == null || !uri.getPath().matches("/drive/folders/[A-Za-z0-9_-]+/?")) return false;
            openDrive(uri);
            return true;
        }
        @JavascriptInterface public void fetchText(String requestId, String url) {
            io.execute(() -> {
                JSONObject result = response(requestId);
                try {
                    HttpURLConnection connection = open(url);
                    try (InputStream input = connection.getInputStream()) {
                        String text = new String(read(input, MAX_TEXT), StandardCharsets.UTF_8);
                        result.put("ok", true).put("text", text);
                    } finally { connection.disconnect(); }
                } catch (Exception e) { error(result, e); }
                deliver(result);
            });
        }
        @JavascriptInterface public String registerMedia(String url, String revision) {
            try {
                String checked = checkedUrl(url).toString();
                String version = revision == null ? "" : revision;
                if (checked.length() > 8192 || version.length() > 2048) return null;
                String key = hex(MessageDigest.getInstance("SHA-256").digest((checked + "\n" + version).getBytes(StandardCharsets.UTF_8)));
                if (!remoteRegistry.contains(key)) {
                    String value = new JSONObject().put("url", checked).put("revision", version).toString();
                    if (!remoteRegistry.edit().putString(key, value).commit()) return null;
                }
                return "https://" + HOST + "/remote/" + key;
            } catch (Exception invalid) { return null; }
        }
        @JavascriptInterface public String remoteMedia(String url, String revision) { return registerMedia(url, revision); }
        @JavascriptInterface public void cacheMedia(String requestId, String url) {
            io.execute(() -> {
                JSONObject result = response(requestId);
                try {
                    MediaFile downloaded = downloadMedia(url);
                    result.put("ok", true).put("url", "https://" + HOST + "/cache/" + downloaded.hash).put("sha256", downloaded.hash);
                } catch (Exception e) { error(result, e); }
                deliver(result);
            });
        }
    }

    private static AudioAttributes speechAttributes() {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }
    private boolean acquireAudioFocus() {
        return playbackFocus.acquireForSpeech();
    }
    private void releaseAudioFocus() {
        if (playbackFocus != null) playbackFocus.release();
    }
    private void pausePlayback() {
        stopSpeech();
        releaseAudioFocus();
        if (!destroyed && web != null) web.evaluateJavascript(
            "window.dispatchEvent(new Event('storyspot:pause')); document.querySelectorAll('audio,video').forEach(function(el){el.pause();});", null);
    }
    private void stopSpeech() {
        pendingSpeech = null;
        speakingId = null;
        if (speech != null) speech.stop();
    }
    private void speechEvent(String id, String state, String error) {
        JSONObject result = new JSONObject();
        try {
            result.put("id", id).put("state", state);
            if (error != null) result.put("error", error);
        } catch (Exception ignored) { return; }
        String payload = result.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        runOnUiThread(() -> {
            if (!destroyed && web != null) web.evaluateJavascript(
                "window.onMCQSpeech && window.onMCQSpeech(" + payload + ");", null);
        });
    }
    private void requestSpeech(SpeechRequest request) {
        if (destroyed) return;
        stopSpeech();
        if (!foreground) {
            speechEvent(request.id, "error", "Open StorySpot to play MCQ narration."); return;
        }
        if (speechFailed) {
            // A user may have enabled/installed their voice after the failed
            // attempt. Play is an explicit retry; failure must not be latched
            // until the entire Activity is restarted.
            if (speech != null) speech.shutdown();
            speech = null; speechReady = false; speechFailed = false;
        }
        pendingSpeech = request;
        if (speech == null) {
            speech = new TextToSpeech(this, result -> runOnUiThread(() -> {
                if (destroyed) return;
                speechReady = result == TextToSpeech.SUCCESS;
                speechFailed = !speechReady;
                if (!speechReady) {
                    SpeechRequest waiting = pendingSpeech; pendingSpeech = null;
                    if (waiting != null) speechEvent(waiting.id, "error", "Android could not start its speech engine.");
                    return;
                }
                speech.setAudioAttributes(speechAttributes());
                speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {
                        runOnUiThread(() -> { if (id.equals(speakingId)) speechEvent(id, "start", null); });
                    }
                    @Override public void onDone(String id) {
                        runOnUiThread(() -> {
                            if (id.equals(speakingId)) { speakingId = null; speechEvent(id, "done", null); }
                        });
                    }
                    @Override public void onStop(String id, boolean interrupted) {
                        runOnUiThread(() -> {
                            // stopSpeech() clears speakingId first, so only
                            // unexpected engine stops reach the UI as errors.
                            if (id.equals(speakingId)) {
                                speakingId = null; releaseAudioFocus();
                                speechEvent(id, "error", "Speech was interrupted. Tap Play to retry this step.");
                            }
                        });
                    }
                    @Override public void onError(String id) { onError(id, TextToSpeech.ERROR); }
                    @Override public void onError(String id, int code) {
                        runOnUiThread(() -> {
                            if (id.equals(speakingId)) {
                                speakingId = null;
                                speechEvent(id, "error", "Android speech failed (" + code + "). Check the installed voice.");
                            }
                        });
                    }
                });
                speakPending();
            }));
        } else if (speechReady) speakPending();
    }
    private void speakPending() {
        SpeechRequest request = pendingSpeech;
        if (request == null || !speechReady || speech == null || !foreground || destroyed) return;
        pendingSpeech = null;
        if (!acquireAudioFocus()) {
            speechEvent(request.id, "error", "Audio is in use by another app. Try Play again."); return;
        }
        int language = speech.setLanguage(Locale.forLanguageTag(request.language));
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            releaseAudioFocus();
            speechEvent(request.id, "error", "Install an Android text-to-speech voice for " + request.language + "."); return;
        }
        speech.setSpeechRate(request.rate);
        speakingId = request.id;
        if (speech.speak(request.text, TextToSpeech.QUEUE_FLUSH, new Bundle(), request.id) == TextToSpeech.ERROR) {
            speakingId = null; releaseAudioFocus();
            speechEvent(request.id, "error", "Android could not play this speech segment.");
        }
    }

    private static final class MediaFile {
        final String hash, type;
        final File file;
        MediaFile(String hash, String type, File file) { this.hash = hash; this.type = type; this.file = file; }
    }
    private MediaFile existingMedia(String hash) throws Exception {
        if (hash == null || !hash.matches("[a-f0-9]{64}")) return null;
        File file = new File(media, hash), typeFile = new File(media, hash + ".mime");
        if (!file.isFile() || file.length() == 0 || !typeFile.isFile()) return null;
        String fingerprint = file.length() + ":" + file.lastModified();
        if (!fingerprint.equals(verifiedMedia.get(hash))) {
            if (!MediaIntegrity.matches(file, hash)) return null;
            verifiedMedia.put(hash, fingerprint);
        }
        try (InputStream input = new FileInputStream(typeFile)) {
            String type = new String(read(input, 256), StandardCharsets.UTF_8).trim();
            if (!mediaType(type)) return null;
            return new MediaFile(hash, type, file);
        }
    }
    private MediaFile resolveRemote(String key) throws Exception {
        Object lock = remoteLocks.computeIfAbsent(key, ignored -> new Object());
        synchronized (lock) {
            String serialized = remoteRegistry.getString(key, null);
            if (serialized == null) throw new IOException("This remote media is not registered.");
            JSONObject record = new JSONObject(serialized);
            MediaFile cached = existingMedia(record.optString("sha256", null));
            if (cached != null) return cached;
            MediaFile downloaded = downloadMedia(record.getString("url"));
            record.put("sha256", downloaded.hash);
            if (!remoteRegistry.edit().putString(key, record.toString()).commit()) throw new IOException("Cannot persist the media index.");
            return downloaded;
        }
    }
    private MediaFile downloadMedia(String url) throws Exception {
        File temporary = null;
        File temporaryType = null;
        HttpURLConnection connection = open(url);
        try {
            String type = connection.getContentType();
            type = type == null ? "application/octet-stream" : type.split(";")[0].trim().toLowerCase(Locale.ROOT);
            if (!mediaType(type))
                throw new IOException("The Drive link did not return an image or audio file. Check public sharing.");
            long expectedLength = connection.getContentLengthLong();
            if (expectedLength > MAX_MEDIA) throw new IOException("Media exceeds the 120 MB limit.");
            temporary = File.createTempFile("download-", ".part", media);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[32768]; int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_MEDIA) throw new IOException("Media exceeds the 120 MB limit.");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            if (total == 0) throw new IOException("The media file is empty.");
            if (expectedLength >= 0 && total != expectedLength)
                throw new IOException("The media download was interrupted. Please sync and retry.");
            String hash = hex(digest.digest());
            File target = new File(media, hash), typeFile = new File(media, hash + ".mime");
            // Always replace atomically: a same-length corrupt cache entry is
            // not proof that this fresh, verified download can be discarded.
            if (!temporary.renameTo(target)) throw new IOException("Cannot save downloaded media.");
            temporary = null;
            temporaryType = File.createTempFile("mime-", ".part", media);
            try (FileOutputStream output = new FileOutputStream(temporaryType)) {
                output.write(type.getBytes(StandardCharsets.UTF_8)); output.getFD().sync();
            }
            if (!temporaryType.renameTo(typeFile)) throw new IOException("Cannot save the media type.");
            temporaryType = null;
            verifiedMedia.put(hash, target.length() + ":" + target.lastModified());
            return new MediaFile(hash, type, target);
        } finally {
            connection.disconnect();
            if (temporary != null) temporary.delete();
            if (temporaryType != null) temporaryType.delete();
        }
    }
    private static boolean mediaType(String type) {
        return type != null && (type.startsWith("image/") || type.startsWith("audio/")
            || type.equals("application/octet-stream"));
    }

    private JSONObject response(String id) {
        JSONObject result = new JSONObject();
        try { result.put("id", id == null ? "" : id); } catch (Exception ignored) { }
        return result;
    }
    private void error(JSONObject result, Exception e) {
        try { result.put("ok", false).put("error", e.getMessage() == null ? "Public Drive request failed." : e.getMessage()); }
        catch (Exception ignored) { }
    }
    private void deliver(JSONObject result) {
        final String safe = result.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript("window.onNativeResponse && window.onNativeResponse(" + safe + ");", null); });
    }
    private static URL checkedUrl(String input) throws Exception {
        URL url = new URL(input);
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)
            || !(host.equals("drive.google.com") || host.equals("drive.usercontent.google.com") || host.endsWith(".googleusercontent.com")))
            throw new IOException("Use a public HTTPS Google Drive link.");
        return url;
    }
    private static HttpURLConnection open(String input) throws Exception {
        URL url = checkedUrl(input);
        for (int redirects = 0; redirects < 7; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "StorySpot/0.3 Android");
            connection.setRequestProperty("Accept-Encoding", "identity");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("Google Drive returned an invalid redirect.");
                url = checkedUrl(new URL(url, location).toString());
                continue;
            }
            if (status != 200) {
                connection.disconnect();
                throw new IOException("Google Drive returned HTTP " + status + ". Check the file's sharing permissions.");
            }
            return connection;
        }
        throw new IOException("Too many Google Drive redirects.");
    }
    private static byte[] read(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new IOException("File exceeds the supported size.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
    private static String hex(byte[] digest) {
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }

    private final class LocalClient extends WebViewClient {
        @Override public void onPageFinished(WebView view, String url) { if (START.equals(url)) pageReady = true; }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (isLocal(request.getUrl())) return false;
            if (request.isForMainFrame() && request.hasGesture() && isDriveLink(request.getUrl())) openDrive(request.getUrl());
            return true;
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isLocal(uri)) return false;
            if (isDriveLink(uri)) openDrive(uri);
            return true;
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isLocal(uri)) return null;
            String path = uri.getPath();
            try {
                if (path == null || path.contains("..") || path.contains("\\")) return missing();
                if (path.startsWith("/assets/")) {
                    String name = path.substring(8);
                    if (mime(name).startsWith("audio/")) {
                        AssetFileDescriptor asset = getAssets().openFd(name);
                        return dataResponse(asset.createInputStream(), asset.getLength(), mime(name), request.getRequestHeaders());
                    }
                    return new WebResourceResponse(mime(name), "UTF-8", getAssets().open(name));
                }
                if (path.matches("/remote/[a-f0-9]{64}")) {
                    MediaFile resolved = resolveRemote(path.substring(8));
                    return mediaResponse(resolved.file, resolved.type, request.getRequestHeaders());
                }
                if (path.matches("/cache/[a-f0-9]{64}")) {
                    MediaFile cached = existingMedia(path.substring(7));
                    if (cached == null) return missing();
                    return mediaResponse(cached.file, cached.type, request.getRequestHeaders());
                }
            } catch (Exception ignored) { }
            return missing();
        }
    }
    private static boolean isLocal(Uri uri) { return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()); }
    private static boolean isDriveLink(Uri uri) {
        return "https".equals(uri.getScheme()) && "drive.google.com".equals(uri.getHost())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private void openDrive(Uri uri) {
        runOnUiThread(() -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
            catch (Exception e) { Toast.makeText(this, "No app is available to open Google Drive.", Toast.LENGTH_LONG).show(); }
        });
    }
    private static String mime(String name) {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "svg": return "image/svg+xml";
            case "mp3": return "audio/mpeg";
            case "m4a": return "audio/mp4";
            case "ogg": case "opus": return "audio/ogg";
            case "wav": return "audio/wav";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            default: return "application/octet-stream";
        }
    }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
    private static WebResourceResponse mediaResponse(File file, String type, Map<String, String> headers) throws IOException {
        return dataResponse(new FileInputStream(file), file.length(), type, headers);
    }
    private static WebResourceResponse dataResponse(InputStream input, long length, String type, Map<String, String> headers) throws IOException {
        String header = null;
        for (Map.Entry<String, String> entry : headers.entrySet()) if (entry.getKey().equalsIgnoreCase("Range")) header = entry.getValue();
        ByteRange range;
        try { range = ByteRange.parse(header, length); }
        catch (IllegalArgumentException invalid) {
            input.close();
            Map<String, String> out = new HashMap<>(); out.put("Content-Range", "bytes */" + length);
            return new WebResourceResponse(type, null, 416, "Range Not Satisfiable", out, new ByteArrayInputStream(new byte[0]));
        }
        long start = range.start, end = range.end;
        boolean partial = range.partial;
        long skipped = 0;
        try {
            while (skipped < start) {
                long count = input.skip(start - skipped);
                if (count <= 0) { if (input.read() < 0) throw new IOException("Unexpected end of audio."); count = 1; }
                skipped += count;
            }
        } catch (IOException e) { input.close(); throw e; }
        long count = range.count;
        Map<String, String> out = new HashMap<>();
        out.put("Accept-Ranges", "bytes"); out.put("Content-Length", Long.toString(count));
        out.put("Cache-Control", "private, max-age=31536000, immutable");
        if (partial) out.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
        return new WebResourceResponse(type, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", out, new BoundedInput(input, count));
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && chooser != null) {
            Uri[] uris = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount(); uris = new Uri[count];
                    for (int i = 0; i < count; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) uris = new Uri[]{data.getData()};
            }
            chooser.onReceiveValue(uris); chooser = null;
        }
    }
    @Override protected void onStop() {
        // A transient overlay/onPause must not interrupt a visible lesson.
        // Background playback intentionally pauses; no background service is used.
        foreground = false;
        pausePlayback();
        web.onPause();
        super.onStop();
    }
    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        if (web != null) {
            web.onResume();
            if (pageReady) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('storyspot:resume'));", null);
        }
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("typeof window.storyspotBack === 'function' ? !!window.storyspotBack() : false", handled -> { if (!"true".equals(handled)) finish(); });
    }
    @Override protected void onDestroy() {
        destroyed = true;
        stopSpeech(); releaseAudioFocus();
        if (speech != null) { speech.shutdown(); speech = null; }
        io.shutdownNow();
        if (chooser != null) { chooser.onReceiveValue(null); chooser = null; }
        web.removeJavascriptInterface("StorySpotNative"); web.destroy(); super.onDestroy();
    }
}
