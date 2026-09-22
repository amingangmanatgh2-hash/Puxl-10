package dev.puxl.qol.fabric;

import java.nio.file.Path;

import net.fabricmc.loader.api.FabricLoader;

import dev.puxl.qol.platform.PlatformHooks;

/** Fabric's answer to the three loader questions the shared code asks. */
public class FabricHooks implements PlatformHooks {
    private final FabricLoader loader = FabricLoader.getInstance();

    @Override
    public String loaderName() {
        if (loader.isModLoaded("quilt_loader")) {
            return "Quilt";
        }
        return "Fabric";
    }

    @Override
    public Path configDirectory() {
        return loader.getConfigDir();
    }

    @Override
    public boolean isModLoaded(String modId) {
        return loader.isModLoaded(modId);
    }
}
