package com.storyspot.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/** Checks the content-addressed cache before trusting a previous app session. */
final class MediaIntegrity {
    static boolean matches(File file, String expectedHash) throws Exception {
        if (!file.isFile() || file.length() == 0) return false;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[32768]; int count;
            while ((count = input.read(bytes)) != -1) digest.update(bytes, 0, count);
        }
        StringBuilder actual = new StringBuilder();
        for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value & 255));
        return actual.toString().equals(expectedHash);
    }
}
