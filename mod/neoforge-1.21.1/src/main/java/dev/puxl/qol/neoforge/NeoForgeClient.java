package dev.puxl.qol.neoforge;

import net.minecraft.client.Minecraft;
import net.neoforged.neoforge.client.event.ClientChatReceivedEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.event.RenderGuiEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.bus.api.SubscribeEvent;

import dev.puxl.qol.chat.ChatTweaks;
import dev.puxl.qol.client.PuxlClient;
import dev.puxl.qol.hud.HudRenderer;
import dev.puxl.qol.keys.PuxlKeys;

/** All client-side event wiring for NeoForge. */
final class NeoForgeClient {
    private NeoForgeClient() {
    }

    static void init() {
        PuxlClient.init();
        NeoForge.EVENT_BUS.register(NeoForgeClient.class);
    }

    /** Mod bus: key mappings must be registered while the mod is loading. */
    static void registerKeyMappings(RegisterKeyMappingsEvent event) {
        PuxlKeys.registerAll(event::register);
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        PuxlClient.tick(Minecraft.getInstance());
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
