package dev.puxl.qol.hud;

/**
 * Frame-time tracker. Samples come from the HUD hook, which is called exactly once
 * per rendered frame, so the numbers are real measured frames rather than vanilla's
 * one-second average.
 */
public final class FpsTracker {
    private static final int WINDOW = 600;
    private static final long[] FRAME_NANOS = new long[WINDOW];
    private static final long[] SAMPLE_TIMES = new long[WINDOW];
    private static int index;
    private static int count;
    private static long lastFrameNanos;

    private static double smoothFps;
    private static double onePercentLow;

    private FpsTracker() {
    }

    /** Called once per frame, before the HUD is drawn. */
    public static void onFrame() {
        long now = System.nanoTime();
        if (lastFrameNanos != 0L) {
            long delta = now - lastFrameNanos;
            // Anything below 5 FPS is a stall (loading, alt-tab), not a real frame: skip it.
            if (delta > 0L && delta < 200_000_000L) {
                FRAME_NANOS[index] = delta;
                SAMPLE_TIMES[index] = now;
                index = (index + 1) % WINDOW;
                if (count < WINDOW) {
                    count++;
                }
            }
        }
        lastFrameNanos = now;
        recompute();
    }

    private static void recompute() {
        if (count == 0) {
            smoothFps = 0.0;
            return;
        }
        long total = 0L;
        for (int i = 0; i < count; i++) {
            total += FRAME_NANOS[i];
        }
        double averageNanos = (double) total / count;
        double instant = averageNanos > 0 ? 1_000_000_000.0 / averageNanos : 0.0;
        // Exponential smoothing keeps the number readable without hiding real drops.
        smoothFps = smoothFps == 0.0 ? instant : smoothFps * 0.85 + instant * 0.15;
        onePercentLow = percentileFps(0.01);
    }

    private static double percentileFps(double fraction) {
        if (count < 10) {
            return smoothFps;
        }
        long[] sorted = new long[count];
        System.arraycopy(FRAME_NANOS, 0, sorted, 0, count);
        java.util.Arrays.sort(sorted);
        // Worst frames are the slowest ones, i.e. the end of an ascending sort.
        int position = (int) Math.floor((count - 1) * (1.0 - fraction));
        long worstNanos = sorted[Math.max(0, Math.min(count - 1, position))];
        return worstNanos > 0 ? 1_000_000_000.0 / worstNanos : 0.0;
    }

    public static double fps() {
        return smoothFps;
    }

    public static double onePercentLow() {
        return onePercentLow;
    }

    public static double frameTimeMillis() {
        return smoothFps > 0 ? 1000.0 / smoothFps : 0.0;
    }

    /** Average FPS over the last {@code seconds}, or 0 when there is not enough data. */
    public static double averageOver(double seconds) {
        long cutoff = System.nanoTime() - (long) (seconds * 1_000_000_000.0);
        long total = 0L;
        int samples = 0;
        for (int i = 0; i < count; i++) {
            if (SAMPLE_TIMES[i] >= cutoff) {
                total += FRAME_NANOS[i];
                samples++;
            }
        }
        if (samples < 5 || total <= 0L) {
            return 0.0;
        }
        return samples * 1_000_000_000.0 / total;
    }

    /** FPS history, oldest first, one entry per second — used by the HUD graph. */
    public static double[] history(double seconds) {
        int buckets = Math.max(5, (int) Math.round(seconds));
        double[] history = new double[buckets];
        long now = System.nanoTime();
        for (int bucket = 0; bucket < buckets; bucket++) {
            long from = now - (long) ((buckets - bucket) * 1_000_000_000.0);
            long to = now - (long) ((buckets - bucket - 1) * 1_000_000_000.0);
            long total = 0L;
            int samples = 0;
            for (int i = 0; i < count; i++) {
                if (SAMPLE_TIMES[i] >= from && SAMPLE_TIMES[i] < to) {
                    total += FRAME_NANOS[i];
                    samples++;
                }
            }
            history[bucket] = samples > 0 && total > 0 ? samples * 1_000_000_000.0 / total : 0.0;
        }
        return history;
    }

    public static void reset() {
        index = 0;
        count = 0;
        lastFrameNanos = 0L;
        smoothFps = 0.0;
        onePercentLow = 0.0;
    }
}
