package dev.puxl.qol.hud;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;

import dev.puxl.qol.client.PuxlClient;
import dev.puxl.qol.config.PuxlConfig;

/**
 * Draws the overlay. Every line is optional, the whole HUD can be toggled with a
 * keybind, and the layout stays inside the screen at any GUI scale.
 */
public final class HudRenderer {
    private static final int PADDING = 3;
    private static final int LINE_HEIGHT = 10;

    private HudRenderer() {
    }

    public static void render(GuiGraphics graphics) {
        Minecraft client = Minecraft.getInstance();
        if (client == null || client.player == null || client.level == null) {
            return;
        }
        PuxlConfig.Hud config = PuxlConfig.get().hud;
        if (!config.enabled || PuxlClient.isHudHidden()) {
            return;
        }
        if (client.options.hideGui || PuxlClient.isScreenshotMode()) {
            return;
        }
        if (config.hideWithDebugScreen && client.getDebugOverlay().showDebugScreen()) {
            return;
        }
        if (PuxlClient.isZoomed() && config.modules != null && PuxlConfig.get().zoom.hideHudWhileZoomed) {
            return;
        }

        HudData data = HudData.collect(client);
        Font font = client.font;
        int textColor = parseColor(config.textColor, 0xFFFFFFFF);
        int accent = parseColor(config.accentColor, 0xFF7C5CFF);
        int warn = parseColor(config.warnColor, 0xFFFFB454);
        int danger = parseColor(config.dangerColor, 0xFFFF6B6B);

        List<Line> lines = new ArrayList<>();
        PuxlConfig.Hud.Modules modules = config.modules;
        if (modules.fps) {
            String text = data.fps + " " + data.fpsExtra;
            int color = config.highlightLowFps && data.fpsLow ? warn : textColor;
            lines.add(new Line(text, color));
        }
        if (modules.coordinates) {
            lines.add(new Line(data.coordinates + (data.chunkPosition.isEmpty() ? "" : "  " + data.chunkPosition), textColor));
        }
        if (modules.facing) {
            lines.add(new Line(data.facing, textColor));
        }
        if (modules.biome) {
            lines.add(new Line("Biome " + data.biome, textColor));
        }
        if (modules.dimension) {
            lines.add(new Line("Dimension " + data.dimension, textColor));
        }
        if (modules.time) {
            lines.add(new Line(data.time, textColor));
        }
        if (modules.light && !data.light.isEmpty()) {
            lines.add(new Line(data.light, textColor));
        }
        if (modules.ping && !data.ping.isEmpty()) {
            lines.add(new Line("Ping " + data.ping, accent));
        }
        if (modules.server && !data.server.isEmpty()) {
            lines.add(new Line("Server " + data.server, textColor));
        }
        if (modules.memory) {
            lines.add(new Line("RAM " + data.memory, textColor));
        }
        if (modules.chunks && !data.chunks.isEmpty()) {
            lines.add(new Line(data.chunks, textColor));
        }
        if (modules.entities && !data.entities.isEmpty()) {
            lines.add(new Line(data.entities, textColor));
        }
        if (modules.session) {
            lines.add(new Line("Session " + data.session, textColor));
        }
        if (modules.speed) {
            lines.add(new Line(data.speed, textColor));
        }
        if (modules.waypoint && !data.waypoint.isEmpty()) {
            lines.add(new Line(data.waypoint, parseColor(data.nearestWaypoint != null ? data.nearestWaypoint.color : config.accentColor, accent)));
        }

        double scale = config.scale;
        int width = 0;
        for (Line line : lines) {
            width = Math.max(width, font.width(line.text));
        }
        int graphHeight = modules.graph ? 22 : 0;
        int step = Math.max(1, (int) Math.round(LINE_HEIGHT * config.lineSpacing));
        int blockWidth = (int) Math.ceil((width + PADDING * 2) * scale);
        int blockHeight = (int) Math.ceil((lines.size() * step + graphHeight) * scale) + PADDING * 2;

        int screenWidth = graphics.guiWidth();
        int screenHeight = graphics.guiHeight();
        boolean right = config.corner == PuxlConfig.Corner.TOP_RIGHT || config.corner == PuxlConfig.Corner.BOTTOM_RIGHT;
        boolean bottom = config.corner == PuxlConfig.Corner.BOTTOM_LEFT || config.corner == PuxlConfig.Corner.BOTTOM_RIGHT;
        int originX = right ? screenWidth - blockWidth - 4 : 4;
        int originY = bottom ? screenHeight - blockHeight - 4 : 4;

        if (config.background) {
            graphics.fill(originX, originY, originX + blockWidth, originY + blockHeight, 0x66101020);
            graphics.fill(originX, originY, originX + 2, originY + blockHeight, accent);
        }

        graphics.pose().pushPose();
        graphics.pose().translate(originX + PADDING * scale, originY + PADDING * scale, 0.0f);
        graphics.pose().scale((float) scale, (float) scale, 1.0f);

        int y = 0;
        for (Line line : lines) {
            graphics.drawString(font, line.text, 0, y, line.color, config.shadow);
            y += step;
        }

        if (modules.graph && width > 10) {
            drawGraph(graphics, data.fpsHistory, data.graphScale, 0, y + 2, width, textColor, accent, warn);
        }
        graphics.pose().popPose();

        if (data.nearestWaypoint != null && config.modules.waypoint && PuxlConfig.get().waypoints.showMarker) {
            drawWaypointMarker(graphics, client, data, parseColor(data.nearestWaypoint.color, accent));
        }
    }

    private static void drawGraph(GuiGraphics graphics, double[] history, double scaleMax, int x, int y, int width, int textColor, int accent, int warn) {
        if (history.length == 0 || width < 10) {
            return;
        }
        int height = 18;
        graphics.fill(x, y, x + width, y + height, 0x55000000);
        int barWidth = Math.max(1, width / history.length);
        for (int i = 0; i < history.length; i++) {
            double value = history[i];
            if (value <= 0) {
                continue;
            }
            int barHeight = (int) Math.max(1, Math.min(height, value / scaleMax * height));
            int barX = x + i * barWidth;
            int color = value < 30 ? warn : accent;
            graphics.fill(barX, y + height - barHeight, barX + barWidth, y + height, color);
        }
        String label = String.format(Locale.ROOT, "0-%d FPS", (int) Math.ceil(scaleMax));
        graphics.drawString(Minecraft.getInstance().font, label, x + width + 3, y + height - 8, textColor, true);
    }

    private static void drawWaypointMarker(GuiGraphics graphics, Minecraft client, HudData data, int color) {
        if (client.player == null) {
            return;
        }
        int centerX = graphics.guiWidth() / 2;
        int centerY = graphics.guiHeight() / 2;
        double radius = PuxlConfig.get().waypoints.markerRadius;
        double difference = Math.toRadians(data.waypointBearing - client.player.getYRot());
        int markerX = centerX + (int) Math.round(Math.sin(difference) * radius);
        int markerY = centerY - (int) Math.round(Math.cos(difference) * radius);
        graphics.fill(markerX - 2, markerY - 2, markerX + 3, markerY + 3, 0xCC000000);
        graphics.fill(markerX - 1, markerY - 1, markerX + 2, markerY + 2, color);
        if (PuxlConfig.get().waypoints.showDistance) {
            String label = waypointLabel(data);
            int labelWidth = client.font.width(label);
            graphics.drawString(client.font, label, markerX - labelWidth / 2, markerY + 6, color, true);
        }
    }

    private static String waypointLabel(HudData data) {
        return String.format(Locale.ROOT, "%s %.0fm", data.nearestWaypoint.name, data.waypointDistance);
    }

    public static int parseColor(String hex, int fallback) {
        if (hex == null || hex.isBlank()) {
            return fallback;
        }
        String value = hex.trim();
        if (value.startsWith("#")) {
            value = value.substring(1);
        }
        try {
            int rgb = (int) Long.parseLong(value, 16);
            if (value.length() <= 6) {
                rgb |= 0xFF000000;
            }
            return rgb;
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    private record Line(String text, int color) {
    }
}
