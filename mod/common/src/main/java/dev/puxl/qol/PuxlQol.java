package dev.puxl.qol;

import java.util.logging.Level;
import java.util.logging.Logger;

/** Shared constants and a dependency-free logger (works on every loader). */
public final class PuxlQol {
    public static final String MOD_ID = "puxl-qol";
    public static final String MOD_NAME = "Puxl QoL";
    public static final String VERSION = "1.0.0";
    /** Keybind category, also used as the translation key prefix. */
    public static final String KEY_CATEGORY = "key.categories.puxl-qol";
    private static final Logger LOGGER = Logger.getLogger(MOD_NAME);

    private PuxlQol() {
    }

    public static void log(String message) {
        LOGGER.log(Level.INFO, "[Puxl QoL] {0}", message);
    }

    public static void warn(String message, Throwable error) {
        LOGGER.log(Level.WARNING, "[Puxl QoL] " + message, error);
    }
}
