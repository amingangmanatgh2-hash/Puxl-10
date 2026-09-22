package dev.puxl.qol.neoforge;

import java.nio.file.Path;

import net.neoforged.fml.ModList;
import net.neoforged.fml.loading.FMLPaths;

import dev.puxl.qol.platform.PlatformHooks;

/** NeoForge's answer to the three loader questions the shared code asks. */
public class NeoForgeHooks implements PlatformHooks {
    @Override
    public String loaderName() {
        return "NeoForge";
    }

    @Override
    public Path configDirectory() {
        return FMLPaths.CONFIGDIR.get();
    }

    @Override
    public boolean isModLoaded(String modId) {
        ModList list = ModList.get();
        return list != null && list.isLoaded(modId);
    }
}
