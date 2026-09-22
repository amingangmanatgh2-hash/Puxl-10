package dev.puxl.qol.zoom;

import net.minecraft.client.Minecraft;

import dev.puxl.qol.config.PuxlConfig;

/**
 * Smooth zoom.
 *
 * The field of view is changed through the vanilla FOV option, which keeps the mod
 * free of renderer hooks: the value is restored the moment the key is released and
 * nothing is ever written to disk, so the user's own FOV setting is never lost.
 */
public final class ZoomHandler {
    private static boolean held;
    private static double currentFactor = 1.0;
    private static double targetFactor = 1.0;
    private static int baseFov = -1;
    private static double baseSensitivity = -1.0;
    private static boolean zooming;

    private ZoomHandler() {
    }

    public static void setHeld(boolean value) {
        PuxlConfig.Zoom config = PuxlConfig.get().zoom;
        if (!config.enabled) {
            held = false;
            return;
        }
        if (value && !held) {
            targetFactor = config.factor;
            baseFov = -1;
            baseSensitivity = -1.0;
        }
        held = value;
        if (!held) {
            targetFactor = 1.0;
        }
    }

    public static boolean isHeld() {
        return held;
    }

    public static boolean isZooming() {
        return zooming;
    }

    /** Scroll wheel while zoomed walks the factor between the configured limits. */
    public static void adjust(double delta) {
        PuxlConfig.Zoom config = PuxlConfig.get().zoom;
        if (!config.enabled || !config.scrollAdjustsZoom || !held) {
            return;
        }
        config.factor = Math.max(config.minFactor, Math.min(config.maxFactor, config.factor + delta * config.scrollStep));
        targetFactor = config.factor;
    }

    /** Called once per client tick; applies (or releases) the zoom. */
    public static void tick(Minecraft client) {
        PuxlConfig.Zoom config = PuxlConfig.get().zoom;
        if (!config.enabled) {
            release(client);
            return;
        }
        double speed = Math.max(0.02, Math.min(1.0, config.smoothness));
        currentFactor += (targetFactor - currentFactor) * speed;
        if (Math.abs(currentFactor - targetFactor) < 0.005) {
            currentFactor = targetFactor;
        }
        zooming = currentFactor > 1.01;

        if (!zooming) {
            release(client);
            return;
        }
        apply(client, config);
    }

    private static void apply(Minecraft client, PuxlConfig.Zoom config) {
        if (baseFov <= 0) {
            baseFov = client.options.fov().get();
        }
        if (baseSensitivity < 0) {
            baseSensitivity = client.options.sensitivity().get();
        }
        int zoomedFov = (int) Math.max(10.0, Math.min(110.0, Math.round(baseFov / currentFactor)));
        if (client.options.fov().get() != zoomedFov) {
            client.options.fov().set(zoomedFov);
        }
        if (config.reduceSensitivity) {
            double sensitive = baseSensitivity * Math.max(0.05, Math.min(1.0, config.sensitivityScale));
            if (Math.abs(client.options.sensitivity().get() - sensitive) > 0.0005) {
                client.options.sensitivity().set(sensitive);
            }
        }
    }

    private static void release(Minecraft client) {
        if (client == null) {
            return;
        }
        if (baseFov > 0 && client.options.fov().get() != baseFov) {
            client.options.fov().set(baseFov);
        }
        if (baseSensitivity >= 0 && Math.abs(client.options.sensitivity().get() - baseSensitivity) > 0.0005) {
            client.options.sensitivity().set(baseSensitivity);
        }
        baseFov = -1;
        baseSensitivity = -1.0;
        currentFactor = 1.0;
        zooming = false;
    }

    /** Used when the game unloads, so the player's options are always left untouched. */
    public static void reset(Minecraft client) {
        held = false;
        targetFactor = 1.0;
        release(client);
    }
}
