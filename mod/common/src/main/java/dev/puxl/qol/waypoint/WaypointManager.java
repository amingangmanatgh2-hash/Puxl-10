package dev.puxl.qol.waypoint;

import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import dev.puxl.qol.PuxlQol;
import dev.puxl.qol.config.PuxlConfig;
import dev.puxl.qol.platform.Platform;

/** Waypoints, grouped per dimension and stored next to the config. */
public final class WaypointManager {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final List<Waypoint> WAYPOINTS = new ArrayList<>();
    private static boolean loaded;

    private WaypointManager() {
    }

    private static Path file() {
        return Platform.configDir().resolve("puxl-qol-waypoints.json");
    }

    public static void ensureLoaded() {
        if (loaded) {
            return;
        }
        loaded = true;
        Path path = file();
        if (!Files.exists(path)) {
            return;
        }
        try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            List<Waypoint> parsed = GSON.fromJson(reader, new TypeToken<List<Waypoint>>() {
            }.getType());
            if (parsed != null) {
                for (Waypoint waypoint : parsed) {
                    if (waypoint != null && waypoint.name != null && waypoint.dimension != null) {
                        WAYPOINTS.add(waypoint);
                    }
                }
            }
        } catch (Exception error) {
            PuxlQol.warn("Waypoint file could not be read; starting empty", error);
        }
    }

    public static void save() {
        Path path = file();
        try {
            Path temp = path.resolveSibling("puxl-qol-waypoints.json.tmp");
            try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
                GSON.toJson(WAYPOINTS, writer);
            }
            Files.move(temp, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception error) {
            PuxlQol.warn("Could not save waypoints", error);
        }
    }

    public static List<Waypoint> all() {
        ensureLoaded();
        return List.copyOf(WAYPOINTS);
    }

    public static List<Waypoint> inDimension(String dimension) {
        ensureLoaded();
        List<Waypoint> result = new ArrayList<>();
        for (Waypoint waypoint : WAYPOINTS) {
            if (waypoint.dimension.equals(dimension)) {
                result.add(waypoint);
            }
        }
        result.sort(Comparator.naturalOrder());
        return result;
    }

    public static Waypoint add(String dimension, double x, double y, double z, String name, String color, boolean temporary) {
        ensureLoaded();
        PuxlConfig.Waypoints settings = PuxlConfig.get().waypoints;
        List<Waypoint> existing = new ArrayList<>();
        for (Waypoint waypoint : WAYPOINTS) {
            if (waypoint.dimension.equals(dimension)) {
                existing.add(waypoint);
            }
        }
        if (existing.size() >= settings.maxPerDimension) {
            // Drop the oldest temporary waypoint first, then the oldest overall.
            Waypoint victim = existing.stream().filter(w -> w.temporary).findFirst().orElse(existing.get(0));
            WAYPOINTS.remove(victim);
        }
        String resolvedName = name == null || name.isBlank() ? nextDefaultName(dimension) : name.trim();
        Waypoint waypoint = new Waypoint(resolvedName, dimension, x, y, z, color == null ? settings.defaultColor : color, temporary);
        WAYPOINTS.add(waypoint);
        save();
        return waypoint;
    }

    private static String nextDefaultName(String dimension) {
        int index = 1;
        while (true) {
            String candidate = "Waypoint " + index;
            boolean taken = WAYPOINTS.stream()
                    .anyMatch(w -> w.dimension.equals(dimension) && w.name.equalsIgnoreCase(candidate));
            if (!taken) {
                return candidate;
            }
            index++;
        }
    }

    public static boolean remove(Waypoint waypoint) {
        ensureLoaded();
        boolean removed = WAYPOINTS.remove(waypoint);
        if (removed) {
            save();
        }
        return removed;
    }

    public static void rename(Waypoint waypoint, String name) {
        waypoint.name = name;
        save();
    }

    public static Waypoint nearest(String dimension, double x, double z) {
        ensureLoaded();
        Waypoint best = null;
        double bestDistance = Double.MAX_VALUE;
        for (Waypoint waypoint : WAYPOINTS) {
            if (!waypoint.dimension.equals(dimension)) {
                continue;
            }
            double distance = waypoint.horizontalDistanceTo(x, z);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = waypoint;
            }
        }
        return best;
    }

    public static int clearDimension(String dimension) {
        ensureLoaded();
        int before = WAYPOINTS.size();
        WAYPOINTS.removeIf(waypoint -> waypoint.dimension.equals(dimension));
        int removed = before - WAYPOINTS.size();
        if (removed > 0) {
            save();
        }
        return removed;
    }

    /** Human readable direction for a bearing, relative to where the player is looking. */
    public static String relativeDirection(double bearing, double playerYaw) {
        double difference = ((bearing - playerYaw) % 360.0 + 540.0) % 360.0 - 180.0;
        double absolute = Math.abs(difference);
        if (absolute <= 22.5) {
            return "ahead";
        }
        if (absolute >= 157.5) {
            return "behind";
        }
        String side = difference > 0 ? "right" : "left";
        if (absolute >= 112.5) {
            return "far " + side;
        }
        if (absolute >= 67.5) {
            return side;
        }
        return "slightly " + side;
    }

    public static String formatDistance(double distance) {
        if (distance < 1000.0) {
            return String.format(Locale.ROOT, "%.0fm", distance);
        }
        return String.format(Locale.ROOT, "%.2fkm", distance / 1000.0);
    }
}
