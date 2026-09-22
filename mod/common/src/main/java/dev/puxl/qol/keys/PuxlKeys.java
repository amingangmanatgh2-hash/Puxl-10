package dev.puxl.qol.keys;

import java.util.List;
import java.util.function.Consumer;

import com.mojang.blaze3d.platform.InputConstants;

import net.minecraft.client.KeyMapping;

import dev.puxl.qol.PuxlQol;

/**
 * Key mappings owned by the mod. They are created here and registered by each
 * loader's bootstrap, so the shared code never depends on a loader API.
 */
public final class PuxlKeys {
    public static final KeyMapping OPEN_SETTINGS = create("open_settings", InputConstants.KEY_P);
    public static final KeyMapping ZOOM = create("zoom", InputConstants.KEY_C);
    public static final KeyMapping TOGGLE_HUD = create("toggle_hud", InputConstants.KEY_H);
    public static final KeyMapping ADD_WAYPOINT = create("add_waypoint", InputConstants.KEY_N);
    public static final KeyMapping REMOVE_NEAREST_WAYPOINT = create("remove_nearest_waypoint", InputConstants.KEY_M);
    public static final KeyMapping COPY_COORDINATES = create("copy_coordinates", InputConstants.KEY_J);
    public static final KeyMapping COPY_LAST_CHAT = create("copy_last_chat", InputConstants.KEY_K);
    public static final KeyMapping OPEN_SCREENSHOTS = create("open_screenshots", InputConstants.KEY_O);

    public static final List<KeyMapping> ALL = List.of(
            OPEN_SETTINGS,
            ZOOM,
            TOGGLE_HUD,
            ADD_WAYPOINT,
            REMOVE_NEAREST_WAYPOINT,
            COPY_COORDINATES,
            COPY_LAST_CHAT,
            OPEN_SCREENSHOTS);

    private PuxlKeys() {
    }

    private static KeyMapping create(String name, int code) {
        return new KeyMapping("key." + PuxlQol.MOD_ID + "." + name, InputConstants.Type.KEYSYM, code, PuxlQol.KEY_CATEGORY);
    }

    /** Hands every mapping to a loader registration callback. */
    public static void registerAll(Consumer<KeyMapping> registrar) {
        for (KeyMapping mapping : ALL) {
            registrar.accept(mapping);
        }
    }
}
