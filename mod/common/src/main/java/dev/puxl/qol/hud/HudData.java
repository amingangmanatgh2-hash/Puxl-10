package dev.puxl.qol.hud;

import java.util.Locale;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;

import dev.puxl.qol.client.PuxlClient;
import dev.puxl.qol.waypoint.Waypoint;
import dev.puxl.qol.waypoint.WaypointManager;

/**
 * A snapshot of everything the HUD can show. Values are collected once per render
 * so every line agrees with the others.
 */
public final class HudData {
    public String fps = "--";
    public String fpsExtra = "";
    public boolean fpsLow;
    public String coordinates = "--";
    public String chunkPosition = "";
    public String facing = "";
    public String biome = "";
    public String dimension = "";
    public String time = "";
    public String light = "";
    public String ping = "";
    public String server = "";
    public String memory = "";
    public String chunks = "";
    public String entities = "";
    public String session = "";
    public String speed = "";
    public String waypoint = "";
    public Waypoint nearestWaypoint;
    public double waypointDistance;
    public double waypointBearing;
    public double[] fpsHistory = new double[0];
    public double graphScale = 60.0;

    public static HudData collect(Minecraft client) {
        HudData data = new HudData();
        LocalPlayer player = client.player;
        ClientLevel level = client.level;

        double fps = FpsTracker.fps();
        data.fps = String.format(Locale.ROOT, "%.0f FPS", fps);
        data.fpsExtra = String.format(Locale.ROOT, "(1%% low %.0f, %.1f ms)", FpsTracker.onePercentLow(), FpsTracker.frameTimeMillis());
        data.fpsLow = fps > 0 && fps < 45;
        data.fpsHistory = FpsTracker.history(30);
        for (double sample : data.fpsHistory) {
            if (sample > data.graphScale) {
                data.graphScale = Math.ceil(sample / 30.0) * 30.0;
            }
        }

        if (player == null || level == null) {
            return data;
        }

        Vec3 position = player.position();
        BlockPos blockPos = player.blockPosition();
        data.coordinates = String.format(Locale.ROOT, "XYZ %.1f %.1f %.1f", position.x, position.y, position.z);
        data.chunkPosition = String.format(Locale.ROOT, "chunk %d %d", blockPos.getX() >> 4, blockPos.getZ() >> 4);

        float yaw = ((player.getYRot() % 360.0f) + 360.0f) % 360.0f;
        data.facing = String.format(Locale.ROOT, "%s (%.0f°)", compass(yaw), yaw);

        try {
            data.biome = level.getBiome(blockPos).unwrapKey()
                    .map(key -> prettify(key.location().getPath()))
                    .orElse("unknown");
        } catch (Exception ignored) {
            data.biome = "unknown";
        }

        ResourceKey<Level> dimensionKey = level.dimension();
        data.dimension = prettify(dimensionKey.location().getPath());

        long dayTime = level.getDayTime();
        long ticksOfDay = dayTime % 24000L;
        int hours = (int) ((ticksOfDay / 1000L + 6L) % 24L);
        int minutes = (int) ((ticksOfDay % 1000L) * 60L / 1000L);
        data.time = String.format(Locale.ROOT, "%02d:%02d (day %d)", hours, minutes, dayTime / 24000L + 1L);

        try {
            int blockLight = level.getBrightness(net.minecraft.world.level.LightLayer.BLOCK, blockPos);
            int skyLight = level.getBrightness(net.minecraft.world.level.LightLayer.SKY, blockPos);
            data.light = String.format(Locale.ROOT, "light %d/%d", blockLight, skyLight);
        } catch (Exception ignored) {
            data.light = "";
        }

        ClientPacketListener connection = client.getConnection();
        if (connection != null && player.getUUID() != null) {
            PlayerInfo info = connection.getPlayerInfo(player.getUUID());
            if (info != null) {
                int latency = info.getLatency();
                data.ping = latency + " ms";
                if (client.getSingleplayerServer() != null) {
                    data.ping = "singleplayer";
                }
            }
        } else {
            data.ping = "singleplayer";
        }

        if (client.getCurrentServer() != null) {
            data.server = client.getCurrentServer().ip;
        }

        Runtime runtime = Runtime.getRuntime();
        long used = (runtime.totalMemory() - runtime.freeMemory()) / (1024L * 1024L);
        long max = runtime.maxMemory() / (1024L * 1024L);
        data.memory = String.format(Locale.ROOT, "%.1f / %.1f GB", used / 1024.0, max / 1024.0);

        try {
            data.chunks = level.getChunkSource().getLoadedChunksCount() + " chunks";
        } catch (Exception ignored) {
            data.chunks = "";
        }
        try {
            data.entities = countEntities(level) + " entities";
        } catch (Throwable ignored) {
            data.entities = "";
        }

        data.session = PuxlClient.sessionLabel();
        data.speed = String.format(Locale.ROOT, "%.2f b/s", PuxlClient.horizontalSpeedBlocksPerSecond());

        Waypoint nearest = WaypointManager.nearest(dimensionKey.location().toString(), position.x, position.z);
        if (nearest != null) {
            data.nearestWaypoint = nearest;
            data.waypointDistance = nearest.horizontalDistanceTo(position.x, position.z);
            data.waypointBearing = nearest.bearingFrom(position.x, position.z);
            String direction = WaypointManager.relativeDirection(data.waypointBearing, yaw);
            data.waypoint = String.format(
                    Locale.ROOT,
                    "%s %s %s",
                    nearest.name,
                    WaypointManager.formatDistance(data.waypointDistance),
                    direction);
        }

        return data;
    }

    private static int countEntities(ClientLevel level) {
        int count = 0;
        for (Object ignored : level.entitiesForRendering()) {
            count++;
        }
        return count;
    }

    private static String compass(float yaw) {
        String[] names = {"south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"};
        int index = Math.round(yaw / 45.0f) % 8;
        return names[(index + 8) % 8];
    }

    private static String prettify(String id) {
        String cleaned = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
        cleaned = cleaned.replace('_', ' ');
        if (cleaned.isEmpty()) {
            return id;
        }
        return Character.toUpperCase(cleaned.charAt(0)) + cleaned.substring(1);
    }
}
