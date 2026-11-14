package com.storyspot.app;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

public final class MediaStreamTest {
    private static void equal(long expected, long actual, String message) {
        if (expected != actual) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
    public static void main(String[] args) throws Exception {
        byte[] bytes = new byte[100];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) i;
        try (BoundedInput range = new BoundedInput(new ByteArrayInputStream(bytes), 5)) {
            equal(5, range.available(), "Probe exposes only response bytes");
            equal(3, range.skip(3), "Skip consumes response budget");
            equal(3, range.read(), "Read follows skip");
            equal(1, range.available(), "Probe follows consumed bytes");
            equal(1, range.read(bytes, 0, bytes.length), "Bulk read cannot leave response");
            equal(-1, range.read(), "Underlying bytes after range stay hidden");
            equal(0, range.read(bytes, 0, 0), "Empty read at EOF follows InputStream contract");
            equal(0, range.skip(100), "Skip at EOF remains bounded");
        }
        try (BoundedInput range = new BoundedInput(new ByteArrayInputStream(bytes), 4)) {
            equal(4, range.skip(Long.MAX_VALUE), "Large skip cannot leave response");
            equal(-1, range.read(), "Large skip consumes exactly response");
            if (range.markSupported()) throw new AssertionError("Reset must not bypass bound");
            try { range.reset(); throw new AssertionError("Reset must fail"); }
            catch (IOException expected) { }
        }
        try (BoundedInput range = new BoundedInput(new ByteArrayInputStream(new byte[1]), 2)) {
            range.read();
            try { range.read(); throw new AssertionError("Truncated range must fail explicitly"); }
            catch (IOException expected) { }
        }
        File cached = File.createTempFile("storyspot-integrity-", ".bin");
        try {
            String abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
            try (FileOutputStream out = new FileOutputStream(cached)) { out.write(new byte[]{97, 98, 99}); }
            if (!MediaIntegrity.matches(cached, abc)) throw new AssertionError("Verified cache must remain usable offline");
            try (FileOutputStream out = new FileOutputStream(cached)) { out.write(new byte[]{97, 98, 100}); }
            if (MediaIntegrity.matches(cached, abc)) throw new AssertionError("Same-length corrupted cache must be rejected");
            try (FileOutputStream out = new FileOutputStream(cached)) { out.write(97); }
            if (MediaIntegrity.matches(cached, abc)) throw new AssertionError("Truncated cache must be rejected");
        } finally { cached.delete(); }
        System.out.println("MediaStream: range skip/probe/EOF, truncated responses, and cache corruption checks passed.");
    }
}
