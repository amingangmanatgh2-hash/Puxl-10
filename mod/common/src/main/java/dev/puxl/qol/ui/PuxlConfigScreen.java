package dev.puxl.qol.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import java.util.function.DoubleConsumer;
import java.util.function.Supplier;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import dev.puxl.qol.client.PuxlClient;
import dev.puxl.qol.config.PuxlConfig;
import dev.puxl.qol.keys.PuxlKeys;
import dev.puxl.qol.optimizer.PerformanceOptimizer;
import dev.puxl.qol.waypoint.Waypoint;
import dev.puxl.qol.waypoint.WaypointManager;

/**
 * The mod's settings screen: six tabs built from vanilla widgets only, so no
 * configuration library has to be installed.
 */
public class PuxlConfigScreen extends Screen {
    private enum Tab {
        HUD("HUD"),
        ZOOM("Zoom"),
        WAYPOINTS("Waypoints"),
        CHAT("Chat"),
        OPTIMIZER("Optimizer"),
        ABOUT("About");

        final String label;

        Tab(String label) {
            this.label = label;
        }
    }

    private final Screen parent;
    private Tab tab = Tab.HUD;
    private int waypointPage;
    private EditBox timestampFormatField;

    public PuxlConfigScreen(Screen parent) {
        super(Component.literal("Puxl QoL"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        PuxlConfig config = PuxlConfig.get();
        config.sanitise();

        int tabWidth = 82;
        int totalWidth = tabWidth * Tab.values().length;
        int startX = (width - totalWidth) / 2;
        for (int i = 0; i < Tab.values().length; i++) {
            Tab candidate = Tab.values()[i];
            Button button = Button.builder(Component.literal(candidate.label), b -> {
                tab = candidate;
                rebuild();
            }).bounds(startX + i * tabWidth, 26, tabWidth - 2, 20).build();
            addRenderableWidget(button);
        }

        addRenderableWidget(Button.builder(Component.literal("Done"), b -> onClose())
                .bounds(width / 2 - 60, height - 28, 120, 20).build());

        rebuild();
    }

    private void rebuild() {
        // Rebuild the screen contents for the selected tab.
        clearWidgets();
        addRenderableWidget(Button.builder(Component.literal("Done"), b -> onClose())
                .bounds(width / 2 - 60, height - 28, 120, 20).build());
        int tabWidth = 82;
        int totalWidth = tabWidth * Tab.values().length;
        int startX = (width - totalWidth) / 2;
        for (int i = 0; i < Tab.values().length; i++) {
            Tab candidate = Tab.values()[i];
            addRenderableWidget(Button.builder(Component.literal(candidate.label), b -> {
                tab = candidate;
                rebuild();
            }).bounds(startX + i * tabWidth, 26, tabWidth - 2, 20).build());
        }

        PuxlConfig config = PuxlConfig.get();
        switch (tab) {
            case HUD -> buildHud(config);
            case ZOOM -> buildZoom(config);
            case WAYPOINTS -> buildWaypoints(config);
            case CHAT -> buildChat(config);
            case OPTIMIZER -> buildOptimizer(config);
            case ABOUT -> buildAbout();
        }
        PuxlConfig.get().save();
    }

    private void buildHud(PuxlConfig config) {
        List<Row> rows = new ArrayList<>();
        rows.add(toggle("HUD enabled", () -> config.hud.enabled, v -> config.hud.enabled = v));
        rows.add(cycle("Position", config.hud.corner.name(), () -> {
            PuxlConfig.Corner[] values = PuxlConfig.Corner.values();
            config.hud.corner = values[(config.hud.corner.ordinal() + 1) % values.length];
        }));
        rows.add(slider("Scale", config.hud.scale, 0.5, 2.0, v -> config.hud.scale = v, "x"));
        rows.add(slider("Line spacing", config.hud.lineSpacing, 0.5, 2.0, v -> config.hud.lineSpacing = v, "x"));
        rows.add(toggle("Background panel", () -> config.hud.background, v -> config.hud.background = v));
        rows.add(toggle("Text shadow", () -> config.hud.shadow, v -> config.hud.shadow = v));
        rows.add(toggle("Hide with F3 debug", () -> config.hud.hideWithDebugScreen, v -> config.hud.hideWithDebugScreen = v));
        rows.add(toggle("Highlight low FPS", () -> config.hud.highlightLowFps, v -> config.hud.highlightLowFps = v));
        rows.add(slider("Graph window", config.hud.graphSeconds, 5, 120, v -> config.hud.graphSeconds = (int) Math.round(v), "s"));

        PuxlConfig.Hud.Modules modules = config.hud.modules;
        rows.add(toggle("FPS + frame time", () -> modules.fps, v -> modules.fps = v));
        rows.add(toggle("FPS graph", () -> modules.graph, v -> modules.graph = v));
        rows.add(toggle("Coordinates + chunk", () -> modules.coordinates, v -> modules.coordinates = v));
        rows.add(toggle("Facing + yaw", () -> modules.facing, v -> modules.facing = v));
        rows.add(toggle("Biome", () -> modules.biome, v -> modules.biome = v));
        rows.add(toggle("Dimension", () -> modules.dimension, v -> modules.dimension = v));
        rows.add(toggle("In-game time", () -> modules.time, v -> modules.time = v));
        rows.add(toggle("Light level", () -> modules.light, v -> modules.light = v));
        rows.add(toggle("Ping", () -> modules.ping, v -> modules.ping = v));
        rows.add(toggle("Server address", () -> modules.server, v -> modules.server = v));
        rows.add(toggle("Memory usage", () -> modules.memory, v -> modules.memory = v));
        rows.add(toggle("Loaded chunks", () -> modules.chunks, v -> modules.chunks = v));
        rows.add(toggle("Entity count", () -> modules.entities, v -> modules.entities = v));
        rows.add(toggle("Session time", () -> modules.session, v -> modules.session = v));
        rows.add(toggle("Movement speed", () -> modules.speed, v -> modules.speed = v));
        rows.add(toggle("Waypoint indicator", () -> modules.waypoint, v -> modules.waypoint = v));

        addRenderableWidget(Button.builder(Component.literal("Reset session stats"), b -> {
            PuxlClient.resetSession();
            PuxlClient.message(Minecraft.getInstance(), "Session stats reset");
        }).bounds(width - 150, 52, 140, 20).build());

        layout(rows);
    }

    private void buildZoom(PuxlConfig config) {
        List<Row> rows = new ArrayList<>();
        rows.add(toggle("Zoom enabled", () -> config.zoom.enabled, v -> config.zoom.enabled = v));
        rows.add(slider("Zoom factor", config.zoom.factor, 1.5, 20.0, v -> config.zoom.factor = v, "x"));
        rows.add(toggle("Scroll adjusts zoom", () -> config.zoom.scrollAdjustsZoom, v -> config.zoom.scrollAdjustsZoom = v));
        rows.add(slider("Scroll step", config.zoom.scrollStep, 0.1, 3.0, v -> config.zoom.scrollStep = v, ""));
        rows.add(slider("Minimum factor", config.zoom.minFactor, 1.1, 10.0, v -> config.zoom.minFactor = v, "x"));
        rows.add(slider("Maximum factor", config.zoom.maxFactor, 2.0, 30.0, v -> config.zoom.maxFactor = v, "x"));
        rows.add(slider("Smoothing", config.zoom.smoothness, 0.05, 1.0, v -> config.zoom.smoothness = v, ""));
        rows.add(toggle("Reduce sensitivity while zoomed", () -> config.zoom.reduceSensitivity, v -> config.zoom.reduceSensitivity = v));
        rows.add(slider("Sensitivity scale", config.zoom.sensitivityScale, 0.05, 1.0, v -> config.zoom.sensitivityScale = v, "x"));
        rows.add(toggle("Hide HUD while zoomed", () -> config.zoom.hideHudWhileZoomed, v -> config.zoom.hideHudWhileZoomed = v));
        layout(rows);
    }

    private void buildWaypoints(PuxlConfig config) {
        List<Row> rows = new ArrayList<>();
        rows.add(toggle("Waypoints enabled", () -> config.waypoints.enabled, v -> config.waypoints.enabled = v));
        rows.add(toggle("Save a point on death", () -> config.waypoints.deathPoints, v -> config.waypoints.deathPoints = v));
        rows.add(toggle("Show on-screen marker", () -> config.waypoints.showMarker, v -> config.waypoints.showMarker = v));
        rows.add(toggle("Show distance label", () -> config.waypoints.showDistance, v -> config.waypoints.showDistance = v));
        rows.add(slider("Marker radius", config.waypoints.markerRadius, 20, 200, v -> config.waypoints.markerRadius = v, "px"));
        rows.add(slider("Max per dimension", config.waypoints.maxPerDimension, 8, 512, v -> config.waypoints.maxPerDimension = (int) Math.round(v), ""));
        layout(rows, 0, 170);

        Minecraft client = Minecraft.getInstance();
        String dimension = PuxlClient.currentDimension(client);
        List<Waypoint> waypoints = dimension.isEmpty() ? List.of() : WaypointManager.inDimension(dimension);
        int perPage = 6;
        int pages = Math.max(1, (int) Math.ceil(waypoints.size() / (double) perPage));
        waypointPage = Math.max(0, Math.min(pages - 1, waypointPage));

        int y = 190;
        for (int i = waypointPage * perPage; i < Math.min(waypoints.size(), (waypointPage + 1) * perPage); i++) {
            Waypoint waypoint = waypoints.get(i);
            String label = String.format(Locale.ROOT, "%s  %.0f %.0f %.0f", waypoint.name, waypoint.x, waypoint.y, waypoint.z);
            addRenderableWidget(Button.builder(Component.literal(label), b -> {
                Minecraft.getInstance().keyboardHandler.setClipboard(
                        String.format(Locale.ROOT, "%.1f %.1f %.1f", waypoint.x, waypoint.y, waypoint.z));
                PuxlClient.message(Minecraft.getInstance(), "Copied " + waypoint.name + " coordinates");
            }).bounds(width / 2 - 180, y, 280, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Delete"), b -> {
                WaypointManager.remove(waypoint);
                rebuild();
            }).bounds(width / 2 + 105, y, 75, 20).build());
            y += 22;
        }

        addRenderableWidget(Button.builder(Component.literal("Add waypoint here"), b -> {
            PuxlClient.addWaypointHere(Minecraft.getInstance());
            rebuild();
        }).bounds(width / 2 - 180, height - 52, 160, 20).build());

        addRenderableWidget(Button.builder(Component.literal("Clear this dimension"), b -> {
            int removed = WaypointManager.clearDimension(dimension);
            PuxlClient.message(Minecraft.getInstance(), removed + " waypoint(s) removed");
            rebuild();
        }).bounds(width / 2 + 20, height - 52, 160, 20).build());

        if (pages > 1) {
            addRenderableWidget(Button.builder(Component.literal("<"), b -> {
                waypointPage = Math.max(0, waypointPage - 1);
                rebuild();
            }).bounds(width / 2 - 210, height - 52, 24, 20).build());
            addRenderableWidget(Button.builder(Component.literal(">"), b -> {
                waypointPage = Math.min(pages - 1, waypointPage + 1);
                rebuild();
            }).bounds(width / 2 + 186, height - 52, 24, 20).build());
        }
    }

    private void buildChat(PuxlConfig config) {
        List<Row> rows = new ArrayList<>();
        rows.add(toggle("Timestamps", () -> config.chat.timestamps, v -> config.chat.timestamps = v));
        rows.add(slider("History limit", config.chat.historyLimit, 100, 2000, v -> config.chat.historyLimit = (int) Math.round(v), " lines"));
        rows.add(toggle("Keep vanilla 100-line limit", () -> config.chat.keepVanillaLimit, v -> config.chat.keepVanillaLimit = v));
        rows.add(toggle("Copy coordinates keybind", () -> config.tools.copyCoordinatesKey, v -> config.tools.copyCoordinatesKey = v));
        rows.add(toggle("Copy last chat keybind", () -> config.tools.copyLastChatKey, v -> config.tools.copyLastChatKey = v));
        rows.add(toggle("Open screenshots keybind", () -> config.tools.openScreenshotsKey, v -> config.tools.openScreenshotsKey = v));
        rows.add(toggle("Chat message when adding a waypoint", () -> config.tools.chatOnWaypointAdd, v -> config.tools.chatOnWaypointAdd = v));
        layout(rows);

        timestampFormatField = new EditBox(font, width / 2 - 100, height - 82, 150, 20, Component.literal("timestamp format"));
        timestampFormatField.setValue(config.chat.timestampFormat);
        addRenderableWidget(timestampFormatField);
        addRenderableWidget(Button.builder(Component.literal("Apply format"), b -> {
            if (timestampFormatField != null && !timestampFormatField.getValue().isBlank()) {
                config.chat.timestampFormat = timestampFormatField.getValue().trim();
                config.save();
                PuxlClient.message(Minecraft.getInstance(), "Timestamp format set to " + config.chat.timestampFormat);
            }
        }).bounds(width / 2 + 55, height - 82, 110, 20).build());
    }

    private void buildOptimizer(PuxlConfig config) {
        List<Row> rows = new ArrayList<>();
        rows.add(toggle("Automatic optimisation", () -> config.optimizer.enabled, v -> {
            config.optimizer.enabled = v;
            if (!v) {
                PerformanceOptimizer.deactivate(Minecraft.getInstance(), true);
            }
        }));
        rows.add(slider("Target FPS", config.optimizer.targetFps, 30, 240, v -> config.optimizer.targetFps = (int) Math.round(v), " fps"));
        rows.add(slider("Sample window", config.optimizer.sampleSeconds, 2, 30, v -> config.optimizer.sampleSeconds = (int) Math.round(v), "s"));
        rows.add(slider("Cooldown between changes", config.optimizer.cooldownSeconds, 3, 60, v -> config.optimizer.cooldownSeconds = (int) Math.round(v), "s"));
        rows.add(slider("Warm-up after joining", config.optimizer.warmupSeconds, 0, 60, v -> config.optimizer.warmupSeconds = (int) Math.round(v), "s"));
        rows.add(slider("Minimum render distance", config.optimizer.minRenderDistance, 2, 32, v -> config.optimizer.minRenderDistance = (int) Math.round(v), ""));
        rows.add(slider("Maximum render distance", config.optimizer.maxRenderDistance, 4, 32, v -> config.optimizer.maxRenderDistance = (int) Math.round(v), ""));
        rows.add(toggle("Adjust particles", () -> config.optimizer.adjustParticles, v -> config.optimizer.adjustParticles = v));
        rows.add(toggle("Adjust simulation distance", () -> config.optimizer.adjustSimulationDistance, v -> config.optimizer.adjustSimulationDistance = v));
        rows.add(toggle("Adjust entity distance", () -> config.optimizer.adjustEntityDistance, v -> config.optimizer.adjustEntityDistance = v));
        rows.add(toggle("Adjust entity shadows", () -> config.optimizer.adjustEntityShadows, v -> config.optimizer.adjustEntityShadows = v));
        rows.add(toggle("Restore original settings when off", () -> config.optimizer.restoreOnDisable, v -> config.optimizer.restoreOnDisable = v));
        rows.add(toggle("Show chat notifications", () -> config.optimizer.showNotifications, v -> config.optimizer.showNotifications = v));
        layout(rows);

        addRenderableWidget(Button.builder(Component.literal("Restore my original graphics settings"), b -> {
            PerformanceOptimizer.restoreOriginals(Minecraft.getInstance());
            PuxlClient.message(Minecraft.getInstance(), "Original graphics settings restored");
        }).bounds(width / 2 - 130, height - 82, 260, 20).build());
    }

    private void buildAbout() {
        addRenderableWidget(Button.builder(Component.literal("Reload config from disk"), b -> {
            PuxlConfig.reload();
            PuxlClient.message(Minecraft.getInstance(), "Config reloaded");
            rebuild();
        }).bounds(width / 2 - 110, height - 110, 220, 20).build());
    }

    private void layout(List<Row> rows) {
        layout(rows, 0, 52);
    }

    private void layout(List<Row> rows, int startColumn, int startY) {
        int y = startY;
        int x = width / 2 - 180;
        for (Row row : rows) {
            row.place(x, y);
            y += 22;
            if (y > height - 60) {
                y = startY;
                x += 190;
            }
        }
    }

    private Row toggle(String label, Supplier<Boolean> getter, Consumer<Boolean> setter) {
        Button[] holder = new Button[1];
        Runnable refresh = () -> holder[0].setMessage(Component.literal(label + ": " + (getter.get() ? "ON" : "OFF")));
        Button button = Button.builder(Component.literal(label), b -> {
            setter.accept(!getter.get());
            PuxlConfig.get().save();
            refresh.run();
        }).bounds(0, 0, 180, 20).build();
        holder[0] = button;
        refresh.run();
        addRenderableWidget(button);
        return Row.of(new WidgetHolder(button));
    }

    private Row cycle(String label, String unusedValue, Runnable onPress) {
        Button button = Button.builder(Component.literal(label), b -> {
            onPress.run();
            PuxlConfig.get().save();
            rebuild();
        }).bounds(0, 0, 180, 20).build();
        addRenderableWidget(button);
        return Row.of(new WidgetHolder(button));
    }

    private Row slider(String label, double value, double min, double max, DoubleConsumer setter, String suffix) {
        PuxlSlider widget = new PuxlSlider(0, 0, 180, 20, label, value, min, max, suffix, setter);
        addRenderableWidget(widget);
        return Row.of(new WidgetHolder(widget));
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        // Painted by hand: Screen#renderBackground changed its signature in 1.20.2 and the
        // mod supports both generations from one source set.
        graphics.fill(0, 0, width, height, 0xC0101018);
        super.render(graphics, mouseX, mouseY, partialTick);
        graphics.drawCenteredString(font, Component.literal("Puxl QoL"), width / 2, 10, 0xFFFFFFFF);
        graphics.drawString(font, Component.literal(hint()), 12, height - 18, 0xFF8B8BB5, false);
    }

    private String hint() {
        return switch (tab) {
            case HUD -> "Toggle modules and pick a corner. The HUD also hides with F3.";
            case ZOOM -> "Hold " + keyName(PuxlKeys.ZOOM) + " to zoom, scroll while zoomed to adjust.";
            case WAYPOINTS -> "Add: " + keyName(PuxlKeys.ADD_WAYPOINT) + " · remove nearest: " + keyName(PuxlKeys.REMOVE_NEAREST_WAYPOINT);
            case CHAT -> "Timestamps are added by the client only; nothing is sent to the server.";
            case OPTIMIZER -> "Only changes vanilla graphics sliders, never gameplay or world state.";
            case ABOUT -> "Config file: config/puxl-qol.json · session " + PuxlClient.sessionLabel();
        };
    }

    private String keyName(net.minecraft.client.KeyMapping mapping) {
        return mapping.getTranslatedKeyMessage().getString();
    }

    @Override
    public void onClose() {
        PuxlConfig.get().sanitise();
        PuxlConfig.get().flush();
        PuxlConfig.get().save();
        if (minecraft != null) {
            minecraft.setScreen(parent);
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    /** Small interface so a row can hold any vanilla widget without type gymnastics. */
    private interface AbstractWidgetHolder {
        void setPosition(int x, int y);
    }

    /** Positions any vanilla widget; the shared interface keeps the row list simple. */
    private record WidgetHolder(AbstractWidget widget) implements AbstractWidgetHolder {
        @Override
        public void setPosition(int x, int y) {
            widget.setX(x);
            widget.setY(y);
        }
    }

    private record Row(AbstractWidgetHolder holder) {
        static Row of(AbstractWidgetHolder holder) {
            return new Row(holder);
        }

        void place(int x, int y) {
            holder.setPosition(x, y);
        }
    }

    /** Slider wired to the config, with a live label. */
    private static final class PuxlSlider extends AbstractSliderButton {
        private final String label;
        private final String suffix;
        private final DoubleConsumer setter;

        private final double min;
        private final double max;

        PuxlSlider(int x, int y, int width, int height, String label, double value, double min, double max, String suffix, DoubleConsumer setter) {
            super(x, y, width, height, Component.empty(), (value - min) / Math.max(0.0001, max - min));
            this.min = min;
            this.max = max;
            this.label = label;
            this.suffix = suffix;
            this.setter = setter;
            updateMessage();
        }

        @Override
        protected void updateMessage() {
            double value = min + (max - min) * this.value;
            setMessage(Component.literal(String.format(Locale.ROOT, "%s: %.2f%s", label, value, suffix)));
        }

        @Override
        protected void applyValue() {
            double value = min + (max - min) * this.value;
            setter.accept(value);
            PuxlConfig.get().sanitise();
            PuxlConfig.get().markDirty();
        }

    }
}
