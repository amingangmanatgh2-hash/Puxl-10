package dev.puxl.qol.client;

import java.awt.Desktop;
import java.io.File;
import java.net.URI;
import java.util.Locale;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;

import dev.puxl.qol.PuxlQol;
import dev.puxl.qol.chat.ChatTweaks;
import dev.puxl.qol.config.PuxlConfig;
import dev.puxl.qol.hud.FpsTracker;
import dev.puxl.qol.keys.PuxlKeys;
import dev.puxl.qol.optimizer.PerformanceOptimizer;
import dev.puxl.qol.ui.PuxlConfigScreen;
import dev.puxl.qol.waypoint.Waypoint;
import dev.puxl.qol.waypoint.WaypointManager;
import dev.puxl.qol.zoom.ZoomHandler;

/**
 * The mod's runtime: keybind handling, session stats and the per-tick work shared by
 * every loader. The loader modules call {@link #tick} and {@link #onFrame} from their own
 * events, so nothing here depends on a loader API.
 */
public final class PuxlClient {
    private static boolean initialised;
    private static boolean hudHidden;
    private static boolean screenshotMode;

    private static long sessionStartedAt;
    private static double walkedBlocks;
    private static int deaths;
    private static Vec3 lastPosition;
    private static boolean wasDead;
    private static String lastDimension = "";
    private static double horizontalSpeed;

    private PuxlClient() {
    }

    public static void init() {
        if (initialised) {
            return;
        }
        initialised = true;
        sessionStartedAt = System.currentTimeMillis();
        WaypointManager.ensureLoaded();
        PuxlQol.log("ready on " + dev.puxl.qol.platform.Platform.loaderName()
                + " (config: " + dev.puxl.qol.platform.Platform.configDir() + ")");
    }

    public static boolean isHudHidden() {
        return hudHidden;
    }

    public static boolean isScreenshotMode() {
        return screenshotMode;
    }

    public static boolean isZoomed() {
        return ZoomHandler.isZooming();
    }

    public static String sessionLabel() {
        long seconds = Math.max(0L, (System.currentTimeMillis() - sessionStartedAt) / 1000L);
        long hours = seconds / 3600L;
        long minutes = (seconds % 3600L) / 60L;
        long secs = seconds % 60L;
        if (hours > 0) {
            return String.format(Locale.ROOT, "%dh %02dm", hours, minutes);
        }
        return String.format(Locale.ROOT, "%dm %02ds", minutes, secs);
    }

    public static double horizontalSpeedBlocksPerSecond() {
        return horizontalSpeed;
    }

    /** Runs once per client tick, before the world renders. */
    public static void tick(Minecraft client) {
        init();
        PuxlConfig config = PuxlConfig.get();

        if (client.player == null || client.level == null) {
            lastPosition = null;
            lastDimension = "";
            ZoomHandler.setHeld(false);
            ZoomHandler.tick(client);
            return;
        }

        String dimension = client.level.dimension().location().toString();
        if (!dimension.equals(lastDimension)) {
            lastDimension = dimension;
            WaypointManager.ensureLoaded();
            PerformanceOptimizer.onWorldChanged(dimension.hashCode());
        }
        if (client.getConnection() != null) {
            PerformanceOptimizer.onWorldChanged(client.getConnection().hashCode());
        }

        trackSession(client);
        handleKeys(client, config);
        ZoomHandler.tick(client);
        PerformanceOptimizer.tick(client);
        maintainChat(client);
    }

    /**
     * Called once per rendered frame by the loader's HUD event. Frame time sampling and
     * the overlay both live here so every loader behaves identically.
     */
    public static void onFrame() {
        FpsTracker.onFrame();
    }

    private static void trackSession(Minecraft client) {
        LocalPlayer player = client.player;
        if (player == null) {
            return;
        }
        Vec3 position = player.position();
        if (lastPosition != null) {
            double horizontal = Math.sqrt(
                    Math.pow(position.x - lastPosition.x, 2) + Math.pow(position.z - lastPosition.z, 2));
            // Ignore teleports and dimension changes.
            if (horizontal < 32.0) {
                walkedBlocks += horizontal;
                horizontalSpeed = horizontal * 20.0;
            } else {
                horizontalSpeed = 0.0;
            }
        }
        lastPosition = position;

        boolean dead = player.isDeadOrDying();
        if (dead && !wasDead) {
            deaths++;
            if (PuxlConfig.get().waypoints.deathPoints) {
                Waypoint waypoint = WaypointManager.add(
                        player.level().dimension().location().toString(),
                        position.x,
                        position.y,
                        position.z,
                        "Death " + deaths,
                        "#FF6B6B",
                        true);
                message(client, "Death point saved as " + waypoint.name);
            }
        }
        wasDead = dead;
    }

    private static long lastChatTrim;
    private static long lastConfigFlush;

    /** Keeps the chat scrollback at the configured size and flushes config edits. */
    private static void maintainChat(Minecraft client) {
        long now = System.currentTimeMillis();
        if (now - lastChatTrim > 2000L) {
            lastChatTrim = now;
            try {
                ChatTweaks.trimHistory(client.gui.getChat());
            } catch (Throwable ignored) {
                // Chat internals differ between versions; the feature simply stays off.
            }
        }
        if (now - lastConfigFlush > 5000L) {
            lastConfigFlush = now;
            PuxlConfig.get().flush();
        }
    }

    private static void handleKeys(Minecraft client, PuxlConfig config) {
        while (PuxlKeys.OPEN_SETTINGS.consumeClick()) {
            client.setScreen(new PuxlConfigScreen(client.screen));
        }
        while (PuxlKeys.TOGGLE_HUD.consumeClick()) {
            hudHidden = !hudHidden;
            message(client, hudHidden ? "HUD hidden (press again to show)" : "HUD shown");
        }
        while (PuxlKeys.ADD_WAYPOINT.consumeClick()) {
            addWaypointHere(client);
        }
        while (PuxlKeys.REMOVE_NEAREST_WAYPOINT.consumeClick()) {
            removeNearestWaypoint(client);
        }
        if (config.tools.copyCoordinatesKey) {
            while (PuxlKeys.COPY_COORDINATES.consumeClick()) {
                copyCoordinates(client);
            }
        }
        if (config.tools.copyLastChatKey) {
            while (PuxlKeys.COPY_LAST_CHAT.consumeClick()) {
                copyLastChat(client);
            }
        }
        if (config.tools.openScreenshotsKey) {
            while (PuxlKeys.OPEN_SCREENSHOTS.consumeClick()) {
                openScreenshotsFolder(client);
            }
        }
        ZoomHandler.setHeld(client.screen == null && PuxlKeys.ZOOM.isDown());
    }

    public static Waypoint addWaypointHere(Minecraft client) {
        LocalPlayer player = client.player;
        if (player == null) {
            return null;
        }
        PuxlConfig config = PuxlConfig.get();
        Waypoint waypoint = WaypointManager.add(
                player.level().dimension().location().toString(),
                player.getX(),
                player.getY(),
                player.getZ(),
                null,
                config.waypoints.defaultColor,
                false);
        if (config.tools.chatOnWaypointAdd) {
            message(client, "Waypoint " + waypoint.name + " added at " + coordinates(player));
        }
        return waypoint;
    }

    private static void removeNearestWaypoint(Minecraft client) {
        LocalPlayer player = client.player;
        if (player == null) {
            return;
        }
        String dimension = player.level().dimension().location().toString();
        Waypoint nearest = WaypointManager.nearest(dimension, player.getX(), player.getZ());
        if (nearest == null) {
            message(client, "No waypoints in this dimension");
            return;
        }
        WaypointManager.remove(nearest);
        message(client, "Removed " + nearest.name);
    }

    private static void copyCoordinates(Minecraft client) {
        LocalPlayer player = client.player;
        if (player == null) {
            return;
        }
        String value = coordinates(player);
        setClipboard(client, value);
        message(client, "Copied " + value);
    }

    private static void copyLastChat(Minecraft client) {
        String last = ChatTweaks.lastMessage();
        if (last == null || last.isBlank()) {
            message(client, "No chat message to copy yet");
            return;
        }
        setClipboard(client, last);
        message(client, "Copied last chat line");
    }

    private static void openScreenshotsFolder(Minecraft client) {
        File folder = new File(client.gameDirectory, "screenshots");
        if (!folder.exists() && !folder.mkdirs()) {
            message(client, "Screenshots folder could not be opened");
            return;
        }
        try {
            if (Desktop.isDesktopSupported()) {
                Desktop.getDesktop().open(folder);
                return;
            }
        } catch (Exception ignored) {
            // Falls back to revealing the URI below.
        }
        try {
            if (Desktop.isDesktopSupported()) {
                Desktop.getDesktop().browse(new URI(folder.toURI().toString()));
                return;
            }
        } catch (Exception error) {
            PuxlQol.warn("Could not open the screenshots folder", error);
        }
        message(client, "Screenshots are in " + folder.getAbsolutePath());
    }

    private static void setClipboard(Minecraft client, String value) {
        client.keyboardHandler.setClipboard(value);
    }

    private static String coordinates(LocalPlayer player) {
        PuxlConfig.Tools tools = PuxlConfig.get().tools;
        try {
            return String.format(Locale.ROOT, tools.copyCoordinatesFormat, player.getX(), player.getY(), player.getZ());
        } catch (Exception ignored) {
            return String.format(Locale.ROOT, "%.1f %.1f %.1f", player.getX(), player.getY(), player.getZ());
        }
    }

    public static void message(Minecraft client, String text) {
        if (client.player != null) {
            client.player.displayClientMessage(Component.literal("[Puxl] " + text), false);
        }
    }

    public static long sessionMillis() {
        return System.currentTimeMillis() - sessionStartedAt;
    }

    public static double walkedBlocks() {
        return walkedBlocks;
    }

    public static int deaths() {
        return deaths;
    }

    public static void resetSession() {
        sessionStartedAt = System.currentTimeMillis();
        walkedBlocks = 0.0;
        deaths = 0;
        FpsTracker.reset();
    }

    public static void setScreenshotMode(boolean value) {
        screenshotMode = value;
    }

    public static String currentDimension(Minecraft client) {
        if (client.level == null) {
            return "";
        }
        ResourceKey<Level> key = client.level.dimension();
        return key.location().toString();
    }
}
