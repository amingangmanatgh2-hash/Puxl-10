package dev.puxl.qol.platform;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ServiceLoader;

import dev.puxl.qol.PuxlQol;

/**
 * Resolves the loader-specific hooks. Each loader's bootstrap calls {@link #setHooks}
 * during initialisation; a service-file lookup is kept as a fallback so the shared code
 * also works when it is dropped into a loader without a bootstrap.
 */
public final class Platform {
    private static PlatformHooks hooks;

    private Platform() {
    }

    /** Called first thing by every loader bootstrap. */
    public static void setHooks(PlatformHooks value) {
        if (value != null) {
            hooks = value;
        }
    }

    public static PlatformHooks get() {
        if (hooks == null) {
            hooks = discover();
        }
        return hooks;
    }

    private static PlatformHooks discover() {
        try {
            for (PlatformHooks candidate : ServiceLoader.load(PlatformHooks.class, Platform.class.getClassLoader())) {
                return candidate;
            }
        } catch (Throwable error) {
            PuxlQol.warn("Could not load platform hooks, falling back to defaults", error);
        }
        return new FallbackHooks();
    }

    public static Path configDir() {
        Path dir = get().configDirectory();
        if (dir == null) {
            dir = Paths.get("config");
        }
        try {
            Files.createDirectories(dir);
        } catch (Exception ignored) {
            // Falls through: the caller handles unwritable paths.
        }
        return dir;
    }

    public static String loaderName() {
        return get().loaderName();
    }

    public static boolean isModLoaded(String modId) {
        return get().isModLoaded(modId);
    }

    static final class FallbackHooks implements PlatformHooks {
        @Override
        public String loaderName() {
            return "unknown";
        }

        @Override
        public Path configDirectory() {
            return Paths.get("config");
        }

        @Override
        public boolean isModLoaded(String modId) {
            return false;
        }
    }
}
