package dev.puxl.qol.forge;

import net.minecraft.client.Minecraft;
import net.minecraftforge.client.event.ClientChatReceivedEvent;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.client.event.RenderGuiEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;

import dev.puxl.qol.chat.ChatTweaks;
import dev.puxl.qol.client.PuxlClient;
import dev.puxl.qol.hud.HudRenderer;
import dev.puxl.qol.keys.PuxlKeys;

/** All client-side event wiring for Forge. */
final class ForgeClient {
    private ForgeClient() {
    }

    static void init() {
        PuxlClient.init();
        MinecraftForge.EVENT_BUS.register(ForgeClient.class);
    }

    /** Mod bus: key mappings must be registered while the mod is loading. */
    static void registerKeyMappings(RegisterKeyMappingsEvent event) {
        PuxlKeys.registerAll(event::register);
    }

    @SubscribeEvent
    static void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase == TickEvent.Phase.END) {
            PuxlClient.tick(Minecraft.getInstance());
        }
    }

    @SubscribeEvent
    static void onRenderGui(RenderGuiEvent.Post event) {
        PuxlClient.onFrame();
        HudRenderer.render(event.getGuiGraphics());
    }

    @SubscribeEvent
    static void onChatReceived(ClientChatReceivedEvent event) {
        event.setMessage(ChatTweaks.decorate(event.getMessage()));
    }
}
