package dev.puxl.qol.config;

import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import dev.puxl.qol.PuxlQol;
import dev.puxl.qol.platform.Platform;

/**
 * Single JSON config for the whole mod. Every field has a default so a partial or
 * corrupted file never breaks the client: unknown keys are ignored, missing ones
 * come from the defaults.
 */
public final class PuxlConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
    private static final String FILE_NAME = "puxl-qol.json";

    private static PuxlConfig instance;
    private transient boolean dirty;

    public int version = 1;
    public Hud hud = new Hud();
    public Zoom zoom = new Zoom();
    public Waypoints waypoints = new Waypoints();
    public Chat chat = new Chat();
    public Optimizer optimizer = new Optimizer();
    public Tools tools = new Tools();

    public static PuxlConfig get() {
        if (instance == null) {
            instance = load();
        }
        return instance;
    }

    private static Path file() {
        return Platform.configDir().resolve(FILE_NAME);
    }

    private static PuxlConfig load() {
        Path path = file();
        if (Files.exists(path)) {
            try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
                PuxlConfig parsed = GSON.fromJson(reader, PuxlConfig.class);
                if (parsed != null) {
                    parsed.fillDefaults();
                    return parsed;
                }
            } catch (Exception error) {
                PuxlQol.warn("Config was unreadable, using defaults (" + path + ")", error);
                backup(path);
            }
        }
        PuxlConfig fresh = new PuxlConfig();
        fresh.save();
        return fresh;
    }

    private static void backup(Path path) {
        try {
            Path backup = path.resolveSibling(FILE_NAME + ".broken");
            Files.move(path, backup, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception ignored) {
            // Nothing to do: the file is already unusable.
        }
    }

    /** Repairs a partial file so later code never sees a null section. */
    private void fillDefaults() {
        PuxlConfig defaults = new PuxlConfig();
        if (hud == null) hud = defaults.hud;
        hud.fillDefaults(defaults.hud);
        if (zoom == null) zoom = defaults.zoom;
        if (waypoints == null) waypoints = defaults.waypoints;
        if (chat == null) chat = defaults.chat;
        if (optimizer == null) optimizer = defaults.optimizer;
        if (tools == null) tools = defaults.tools;
        sanitise();
    }

    /** Keeps stored values inside ranges the UI can actually present. */
    public void sanitise() {
        hud.scale = clamp(hud.scale, 0.5, 2.0);
        hud.lineSpacing = clamp(hud.lineSpacing, 0.5, 2.0);
        hud.graphSeconds = clamp(hud.graphSeconds, 5, 120);
        zoom.factor = clamp(zoom.factor, 1.5, 20.0);
        zoom.scrollStep = clamp(zoom.scrollStep, 0.1, 3.0);
        zoom.minFactor = clamp(zoom.minFactor, 1.1, 10.0);
        zoom.maxFactor = clamp(zoom.maxFactor, zoom.minFactor, 30.0);
        zoom.smoothness = clamp(zoom.smoothness, 0.05, 1.0);
        zoom.sensitivityScale = clamp(zoom.sensitivityScale, 0.05, 1.0);
        waypoints.markerRadius = clamp(waypoints.markerRadius, 20, 200);
        chat.historyLimit = (int) clamp(chat.historyLimit, 100, 5000);
        optimizer.targetFps = (int) clamp(optimizer.targetFps, 30, 480);
        optimizer.minRenderDistance = (int) clamp(optimizer.minRenderDistance, 2, 32);
        optimizer.maxRenderDistance = (int) clamp(optimizer.maxRenderDistance, optimizer.minRenderDistance, 32);
        optimizer.cooldownSeconds = (int) clamp(optimizer.cooldownSeconds, 3, 60);
        optimizer.sampleSeconds = (int) clamp(optimizer.sampleSeconds, 2, 30);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    /** Marks the config as needing a write; used while a slider is being dragged. */
    public void markDirty() {
        dirty = true;
    }

    /** Writes the config if it changed since the last write. */
    public void flush() {
        if (dirty) {
            save();
        }
    }

    public void save() {
        dirty = false;
        Path path = file();
        try {
            Path temp = path.resolveSibling(FILE_NAME + ".tmp");
            try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
                GSON.toJson(this, writer);
            }
            Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception error) {
            PuxlQol.warn("Could not write config to " + path, error);
        }
    }

    public static void reload() {
        instance = load();
    }

    public enum Corner {
        TOP_LEFT,
        TOP_RIGHT,
        BOTTOM_LEFT,
        BOTTOM_RIGHT
    }

    /** HUD layout and per-module visibility. */
    public static final class Hud {
        public boolean enabled = true;
        public Corner corner = Corner.TOP_LEFT;
        public double scale = 1.0;
        public double lineSpacing = 1.0;
        public boolean background = true;
        public boolean shadow = true;
        public String textColor = "#FFFFFF";
        public String accentColor = "#7C5CFF";
        public String warnColor = "#FFB454";
        public String dangerColor = "#FF6B6B";
        public boolean hideWithDebugScreen = true;
        public boolean highlightLowFps = true;
        public int graphSeconds = 30;
        public Modules modules = new Modules();

        public static final class Modules {
            public boolean fps = true;
            public boolean coordinates = true;
            public boolean facing = true;
            public boolean biome = true;
            public boolean dimension = false;
            public boolean time = false;
            public boolean light = false;
            public boolean ping = true;
            public boolean server = false;
            public boolean memory = true;
            public boolean chunks = false;
            public boolean entities = false;
            public boolean session = false;
            public boolean speed = false;
            public boolean waypoint = true;
            public boolean graph = false;
            public boolean directionalCrosshair = false;
        }

        void fillDefaults(Hud defaults) {
            if (modules == null) modules = defaults.modules;
        }
    }

    public static final class Zoom {
        public boolean enabled = true;
        /** How far the view zooms in when held. */
        public double factor = 4.0;
        public double scrollStep = 0.5;
        public boolean scrollAdjustsZoom = true;
        public double minFactor = 1.5;
        public double maxFactor = 12.0;
        /** 1.0 = instant, lower = smoother. */
        public double smoothness = 0.35;
        public boolean reduceSensitivity = true;
        public double sensitivityScale = 0.35;
        /** Hide the HUD while zoomed for a clean look. */
        public boolean hideHudWhileZoomed = false;
    }

    public static final class Waypoints {
        public boolean enabled = true;
        public boolean deathPoints = true;
        public boolean showDistance = true;
        public boolean showMarker = true;
        public double markerRadius = 70;
        public boolean showOffscreenOnly = false;
        public int maxPerDimension = 128;
        public String defaultColor = "#45E0C8";
    }

    public static final class Chat {
        public boolean timestamps = true;
        public String timestampFormat = "HH:mm";
        public String timestampColor = "#8B8BB5";
        public int historyLimit = 500;
        public boolean keepVanillaLimit = false;
    }

    /**
     * Automatic frame-rate recovery. Every adjustment is bounded by the user's own
     * min/max and reverts to the original values when disabled.
     */
    public static final class Optimizer {
        public boolean enabled = false;
        public int targetFps = 60;
        public int sampleSeconds = 5;
        public int cooldownSeconds = 8;
        public int minRenderDistance = 4;
        public int maxRenderDistance = 16;
        public boolean adjustSimulationDistance = true;
        public boolean adjustParticles = true;
        public boolean adjustEntityDistance = true;
        public boolean adjustEntityShadows = false;
        public boolean restoreOnDisable = true;
        public boolean showNotifications = true;
        /** Grace period after joining a world so loading stutter is ignored. */
        public int warmupSeconds = 10;
    }

    public static final class Tools {
        public boolean copyCoordinatesKey = true;
        public boolean copyLastChatKey = true;
        public boolean openScreenshotsKey = true;
        public boolean copyCoordinatesFormat = "%.1f %.1f %.1f";
        public boolean chatOnWaypointAdd = true;
    }
}
