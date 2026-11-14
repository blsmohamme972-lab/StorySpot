package com.storyspot.app;

/** One HTTP byte range. Kept independent of Android for boundary tests. */
final class ByteRange {
    final long start;
    final long end;
    final long count;
    final boolean partial;

    private ByteRange(long start, long end, boolean partial) {
        this.start = start;
        this.end = end;
        this.count = Math.max(0, end - start + 1);
        this.partial = partial;
    }

    static ByteRange parse(String header, long length) {
        if (length < 0) throw new IllegalArgumentException("Negative content length");
        if (header == null) return new ByteRange(0, length - 1, false);
        String value = header.trim();
        if (!value.regionMatches(true, 0, "bytes=", 0, 6) || value.indexOf(',') >= 0 || length == 0)
            throw new IllegalArgumentException("Unsupported byte range");
        String[] parts = value.substring(6).split("-", -1);
        if (parts.length != 2 || (!parts[0].isEmpty() && !parts[0].matches("[0-9]+"))
                || (!parts[1].isEmpty() && !parts[1].matches("[0-9]+")))
            throw new IllegalArgumentException("Invalid byte range");
        long start, end = length - 1;
        try {
            if (parts[0].isEmpty()) {
                long suffix = Long.parseLong(parts[1]);
                if (suffix <= 0) throw new IllegalArgumentException("Empty suffix range");
                start = Math.max(0, length - suffix);
            } else {
                start = Long.parseLong(parts[0]);
                if (!parts[1].isEmpty()) end = Math.min(end, Long.parseLong(parts[1]));
            }
        } catch (NumberFormatException invalid) { throw new IllegalArgumentException("Invalid byte range", invalid); }
        if (start >= length || end < start) throw new IllegalArgumentException("Unsatisfiable byte range");
        return new ByteRange(start, end, true);
    }
}
