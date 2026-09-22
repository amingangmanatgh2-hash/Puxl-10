package dev.puxl.qol.forge;

import java.nio.file.Path;

import net.minecraftforge.fml.ModList;
import net.minecraftforge.fml.loading.FMLPaths;

import dev.puxl.qol.platform.PlatformHooks;

/** Forge's answer to the three loader questions the shared code asks. */
public class ForgeHooks implements PlatformHooks {
    @Override
    public String loaderName() {
        return "Forge";
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
