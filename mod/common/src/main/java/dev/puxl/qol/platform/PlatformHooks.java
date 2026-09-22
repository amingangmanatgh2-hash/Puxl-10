package dev.puxl.qol.platform;

import java.nio.file.Path;

/**
 * The only loader-specific surface the shared code needs. Each loader module ships
 * an implementation and registers it through META-INF/services.
 */
public interface PlatformHooks {
    /** "fabric", "neoforge", "forge" — shown in the config screen. */
    String loaderName();

    /** Writable directory for configs (usually <game>/config). */
    Path configDirectory();

    /** True when another mod with this id is present. */
    boolean isModLoaded(String modId);
}
