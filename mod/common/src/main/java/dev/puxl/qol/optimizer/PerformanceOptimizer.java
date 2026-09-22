package dev.puxl.qol.optimizer;

import java.util.Locale;

import net.minecraft.client.Minecraft;
import net.minecraft.client.ParticleStatus;
import net.minecraft.network.chat.Component;

import dev.puxl.qol.config.PuxlConfig;
import dev.puxl.qol.hud.FpsTracker;

/**
 * Automatic frame-rate recovery.
 *
 * Everything is bounded by the player's own limits, changes happen at most once per
 * cooldown window, and the values that were in use before the optimizer touched
 * anything are stored so disabling it restores them exactly. It never touches
 * gameplay state — only the same graphics sliders the video settings screen writes.
 */
public final class PerformanceOptimizer {
    private static boolean active;
    private static boolean haveOriginals;
    private static int originalRenderDistance;
    private static int originalSimulationDistance;
    private static ParticleStatus originalParticles;
    private static double originalEntityDistance;
    private static boolean originalEntityShadows;

    private static int appliedRenderDistance = -1;
    private static int appliedSimulationDistance = -1;
    private static long lastChangeAt;
    private static long worldJoinedAt;
    private static long lastWorldId = Long.MIN_VALUE;

    private PerformanceOptimizer() {
    }

    public static boolean isActive() {
        return active;
    }

    public static int appliedRenderDistance() {
        return appliedRenderDistance;
    }

    public static void onWorldChanged(long worldId) {
        if (worldId != lastWorldId) {
            lastWorldId = worldId;
            worldJoinedAt = System.currentTimeMillis();
        }
    }

    public static void tick(Minecraft client) {
        PuxlConfig.Optimizer config = PuxlConfig.get().optimizer;
        if (client.level == null || client.player == null) {
            if (active) {
                deactivate(client, false);
            }
            return;
        }
        if (!config.enabled) {
            if (active) {
                deactivate(client, false);
            }
            return;
        }
        if (!active) {
            activate(client);
        }
        long now = System.currentTimeMillis();
        if (now - worldJoinedAt < config.warmupSeconds * 1000L) {
            return;
        }
        if (now - lastChangeAt < config.cooldownSeconds * 1000L) {
            return;
        }

        double average = FpsTracker.averageOver(config.sampleSeconds);
        if (average <= 0) {
            return;
        }
        int target = config.targetFps;

        if (average < target * 0.85) {
            if (stepDown(client, config, average, target)) {
                lastChangeAt = now;
            }
        } else if (average > target * 1.2) {
            if (stepUp(client, config, average, target)) {
                lastChangeAt = now;
            }
        }
    }

    private static void activate(Minecraft client) {
        PuxlConfig.Optimizer config = PuxlConfig.get().optimizer;
        if (!haveOriginals) {
            originalRenderDistance = client.options.renderDistance().get();
            originalSimulationDistance = client.options.simulationDistance().get();
            originalParticles = client.options.particles().get();
            originalEntityDistance = client.options.entityDistanceScaling().get();
            originalEntityShadows = client.options.entityShadows().get();
            haveOriginals = true;
        }
        appliedRenderDistance = clamp(client.options.renderDistance().get(), config.minRenderDistance, config.maxRenderDistance);
        appliedSimulationDistance = clamp(client.options.simulationDistance().get(), Math.max(3, config.minRenderDistance - 1), config.maxRenderDistance);
        active = true;
        if (config.showNotifications) {
            notify(client, "Optimizer on — target " + config.targetFps + " FPS");
        }
    }

    /** Returns true when something actually changed. */
    private static boolean stepDown(Minecraft client, PuxlConfig.Optimizer config, double average, int target) {
        boolean changed = false;
        String what;
        if (config.adjustParticles && client.options.particles().get() != ParticleStatus.MINIMAL) {
            ParticleStatus next = client.options.particles().get() == ParticleStatus.ALL ? ParticleStatus.DECREASED : ParticleStatus.MINIMAL;
            client.options.particles().set(next);
            changed = true;
            what = "particles → " + next.name().toLowerCase(Locale.ROOT);
        } else if (config.adjustEntityDistance && client.options.entityDistanceScaling().get() > 0.6) {
            client.options.entityDistanceScaling().set(0.5);
            changed = true;
            what = "entity distance → 50%";
        } else if (config.adjustEntityShadows && client.options.entityShadows().get()) {
            client.options.entityShadows().set(false);
            changed = true;
            what = "entity shadows off";
        } else if (appliedRenderDistance > config.minRenderDistance) {
            appliedRenderDistance = Math.max(config.minRenderDistance, appliedRenderDistance - 2);
            client.options.renderDistance().set(appliedRenderDistance);
            changed = true;
            what = "render distance → " + appliedRenderDistance;
        } else if (config.adjustSimulationDistance && appliedSimulationDistance > Math.max(3, config.minRenderDistance - 1)) {
            appliedSimulationDistance = Math.max(3, appliedSimulationDistance - 2);
            client.options.simulationDistance().set(appliedSimulationDistance);
            changed = true;
            what = "simulation distance → " + appliedSimulationDistance;
        } else {
            return false;
        }
        client.options.save();
        if (config.showNotifications) {
            notify(client, String.format(Locale.ROOT, "%.0f FPS (target %d): %s", average, target, what));
        }
        return changed;
    }

    private static boolean stepUp(Minecraft client, PuxlConfig.Optimizer config, double average, int target) {
        boolean changed = false;
        String what;
        int ceiling = Math.min(config.maxRenderDistance, originalRenderDistance > 0 ? originalRenderDistance : config.maxRenderDistance);
        if (appliedRenderDistance < ceiling) {
            appliedRenderDistance = Math.min(ceiling, appliedRenderDistance + 2);
            client.options.renderDistance().set(appliedRenderDistance);
            changed = true;
            what = "render distance → " + appliedRenderDistance;
        } else if (config.adjustSimulationDistance && appliedSimulationDistance < Math.min(ceiling, originalSimulationDistance > 0 ? originalSimulationDistance : ceiling)) {
            appliedSimulationDistance = Math.min(ceiling, appliedSimulationDistance + 2);
            client.options.simulationDistance().set(appliedSimulationDistance);
            changed = true;
            what = "simulation distance → " + appliedSimulationDistance;
        } else if (config.adjustEntityDistance && originalEntityDistance > 0 && client.options.entityDistanceScaling().get() < originalEntityDistance) {
            double next = Math.min(originalEntityDistance, client.options.entityDistanceScaling().get() + 0.1);
            client.options.entityDistanceScaling().set(next);
            changed = true;
            what = String.format(Locale.ROOT, "entity distance → %.0f%%", next * 100.0);
        } else if (config.adjustParticles && originalParticles != null && client.options.particles().get() != originalParticles) {
            ParticleStatus next = client.options.particles().get() == ParticleStatus.MINIMAL ? ParticleStatus.DECREASED : originalParticles;
            client.options.particles().set(next);
            changed = true;
            what = "particles → " + next.name().toLowerCase(Locale.ROOT);
        } else if (config.adjustEntityShadows && originalEntityShadows && !client.options.entityShadows().get()) {
            client.options.entityShadows().set(true);
            changed = true;
            what = "entity shadows on";
        } else {
            return false;
        }
        client.options.save();
        if (config.showNotifications) {
            notify(client, String.format(Locale.ROOT, "%.0f FPS (target %d): %s", average, target, what));
        }
        return changed;
    }

    public static void deactivate(Minecraft client, boolean restore) {
        active = false;
        appliedRenderDistance = -1;
        appliedSimulationDistance = -1;
        PuxlConfig.Optimizer config = PuxlConfig.get().optimizer;
        if (restore && haveOriginals && config.restoreOnDisable && client != null) {
            client.options.renderDistance().set(originalRenderDistance);
            client.options.simulationDistance().set(originalSimulationDistance);
            if (originalParticles != null) {
                client.options.particles().set(originalParticles);
            }
            if (originalEntityDistance > 0) {
                client.options.entityDistanceScaling().set(originalEntityDistance);
            }
            client.options.entityShadows().set(originalEntityShadows);
            client.options.save();
            if (config.showNotifications) {
                notify(client, "Optimizer off — settings restored");
            }
        }
    }

    /** Restores the user's original graphics values (used by the settings screen). */
    public static void restoreOriginals(Minecraft client) {
        if (!haveOriginals || client == null) {
            return;
        }
        client.options.renderDistance().set(originalRenderDistance);
        client.options.simulationDistance().set(originalSimulationDistance);
        if (originalParticles != null) {
            client.options.particles().set(originalParticles);
        }
        if (originalEntityDistance > 0) {
            client.options.entityDistanceScaling().set(originalEntityDistance);
        }
        client.options.entityShadows().set(originalEntityShadows);
        client.options.save();
    }

    private static void notify(Minecraft client, String message) {
        if (client.player != null) {
            client.player.displayClientMessage(Component.literal("[Puxl] " + message), true);
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
