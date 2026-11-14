package com.storyspot.app;

public final class ByteRangeTest {
    private static void expect(String header, long length, long start, long end, boolean partial) {
        ByteRange range = ByteRange.parse(header, length);
        if (range.start != start || range.end != end || range.partial != partial || range.count != Math.max(0, end - start + 1))
            throw new AssertionError("Incorrect range: " + header);
    }
    private static void reject(String header, long length) {
        try { ByteRange.parse(header, length); }
        catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Accepted invalid range: " + header);
    }
    public static void main(String[] args) {
        expect(null, 100, 0, 99, false);
        expect(null, 0, 0, -1, false);
        expect("bytes=0-", 100, 0, 99, true);
        expect("bytes=40-", 100, 40, 99, true);
        expect("bytes=99-99", 100, 99, 99, true);
        expect("bytes=90-1000", 100, 90, 99, true);
        expect("bytes=-10", 100, 90, 99, true);
        expect("bytes=-1000", 100, 0, 99, true);
        expect("BYTES=0-1", 100, 0, 1, true);
        reject("bytes=100-", 100);
        reject("bytes=80-70", 100);
        reject("bytes=-0", 100);
        reject("bytes=0-0", 0);
        reject("bytes=0-1,4-8", 100);
        reject("bytes=+1-4", 100);
        reject("bytes=1--4", 100);
        reject("bytes=-", 100);
        reject("bytes=9999999999999999999999999-", 100);
        reject("items=0-2", 100);
        System.out.println("ByteRange: 19 boundary cases passed.");
    }
}
