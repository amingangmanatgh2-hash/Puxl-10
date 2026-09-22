package dev.puxl.qol.neoforge;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;

import dev.puxl.qol.PuxlQol;
import dev.puxl.qol.platform.Platform;

/** NeoForge bootstrap. Client-only work is skipped entirely on a dedicated server. */
@Mod(PuxlQol.MOD_ID)
public class PuxlQolNeoForge {
    public PuxlQolNeoForge(IEventBus modEventBus, ModContainer container) {
        Platform.setHooks(new NeoForgeHooks());
        if (FMLEnvironment.dist == Dist.CLIENT) {
            modEventBus.addListener(NeoForgeClient::registerKeyMappings);
            NeoForgeClient.init();
        }
        PuxlQol.log("NeoForge bootstrap complete");
    }
}
