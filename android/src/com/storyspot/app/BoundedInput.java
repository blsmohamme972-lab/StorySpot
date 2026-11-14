package com.storyspot.app;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

/** A byte-range response must remain bounded when the consumer skips or probes. */
final class BoundedInput extends FilterInputStream {
    private long remaining;
    BoundedInput(InputStream input, long count) {
        super(input);
        if (count < 0) throw new IllegalArgumentException("Negative stream bound");
        remaining = count;
    }
    @Override public int read() throws IOException {
        if (remaining == 0) return -1;
        int value = in.read();
        if (value < 0) throw new IOException("The cached media ended before its byte range.");
        remaining--;
        return value;
    }
    @Override public int read(byte[] bytes, int offset, int count) throws IOException {
        if (bytes == null) throw new NullPointerException();
        if (offset < 0 || count < 0 || offset > bytes.length - count) throw new IndexOutOfBoundsException();
        if (count == 0) return 0;
        if (remaining == 0) return -1;
        int size = in.read(bytes, offset, (int) Math.min(count, remaining));
        if (size < 0) throw new IOException("The cached media ended before its byte range.");
        remaining -= size;
        return size;
    }
    @Override public long skip(long count) throws IOException {
        if (count <= 0 || remaining == 0) return 0;
        long skipped = in.skip(Math.min(count, remaining));
        remaining -= skipped;
        return skipped;
    }
    @Override public int available() throws IOException { return (int) Math.min(in.available(), remaining); }
    @Override public boolean markSupported() { return false; }
    @Override public void mark(int limit) { }
    @Override public void reset() throws IOException { throw new IOException("Byte-range responses cannot reset."); }
}
