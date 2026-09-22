package dev.puxl.qol.fabric;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;

import dev.puxl.qol.PuxlQol;
import dev.puxl.qol.chat.ChatTweaks;
import dev.puxl.qol.client.PuxlClient;
import dev.puxl.qol.hud.HudRenderer;
import dev.puxl.qol.keys.PuxlKeys;
import dev.puxl.qol.platform.Platform;

/**
 * Fabric (and Quilt, which loads Fabric mods) bootstrap.
 *
 * Everything the mod needs comes from the loader events declared here: ticks, the HUD
 * frame and received chat messages. The shared code in {@code dev.puxl.qol} never
 * references a loader API.
 */
public class PuxlQolFabric implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        Platform.setHooks(new FabricHooks());
        PuxlClient.init();

        PuxlKeys.registerAll(KeyBindingHelper::registerKeyBinding);
        ClientTickEvents.END_CLIENT_TICK.register(PuxlClient::tick);
        HudRenderCallback.EVENT.register((graphics, tickCounter) -> {
            PuxlClient.onFrame();
            HudRenderer.render(graphics);
        });
        // System/game messages can be rewritten before they are shown.
        ClientReceiveMessageEvents.MODIFY_GAME.register((message, overlay) -> ChatTweaks.decorate(message));
        // Fabric API has no modify hook for player chat, so those lines are only observed
        // (which is what the copy-last-chat keybind needs). Forge and NeoForge timestamp both.
        ClientReceiveMessageEvents.CHAT.register(
                (message, signedMessage, sender, params, receptionTimestamp) -> ChatTweaks.observe(message));

        PuxlQol.log("Fabric/Quilt bootstrap complete");
    }
}
