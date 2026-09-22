package dev.puxl.qol.forge;

import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.loading.FMLEnvironment;

import dev.puxl.qol.PuxlQol;
import dev.puxl.qol.platform.Platform;

/** Forge bootstrap for Minecraft 1.20.1. */
@Mod(PuxlQol.MOD_ID)
public class PuxlQolForge {
    public PuxlQolForge() {
        Platform.setHooks(new ForgeHooks());
        if (FMLEnvironment.dist.isClient()) {
            FMLJavaModLoadingContext.get().getModEventBus().addListener(ForgeClient::registerKeyMappings);
            ForgeClient.init();
        }
        PuxlQol.log("Forge bootstrap complete");
    }
}
