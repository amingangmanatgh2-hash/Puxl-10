package dev.puxl.qol.chat;

import java.lang.reflect.Field;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;

import dev.puxl.qol.config.PuxlConfig;

/**
 * Chat helpers: timestamps, a longer scrollback and copy-last-message.
 *
 * Loaders deliver received messages through their own events; the history limit is
 * raised by trimming the vanilla message list through reflection, and every step is
 * guarded so an unexpected game version can never crash the client.
 */
public final class ChatTweaks {
    private static final int KEEP_PLAIN = 200;
    private static final Deque<String> RECENT = new ArrayDeque<>();
    private static String lastPattern = "";
    private static DateTimeFormatter formatter = DateTimeFormatter.ofPattern("HH:mm");
    private static Field messagesField;
    private static boolean fieldResolved;
    private static int trimmedLimit;

    private ChatTweaks() {
    }

    /** Adds the timestamp prefix and remembers the plain text for copying. */
    public static Component decorate(Component message) {
        if (message == null) {
            return null;
        }
        PuxlConfig.Chat config = PuxlConfig.get().chat;
        RECENT.addLast(message.getString());
        while (RECENT.size() > KEEP_PLAIN) {
            RECENT.removeFirst();
        }
        if (!config.timestamps) {
            return message;
        }
        String pattern = config.timestampFormat == null || config.timestampFormat.isBlank() ? "HH:mm" : config.timestampFormat;
        if (!pattern.equals(lastPattern)) {
            lastPattern = pattern;
            try {
                formatter = DateTimeFormatter.ofPattern(pattern);
            } catch (Exception error) {
                formatter = DateTimeFormatter.ofPattern("HH:mm");
            }
        }
        String stamp = "[" + LocalTime.now().format(formatter) + "] ";
        return Component.literal(stamp).append(message);
    }

    /** Records a received message for the copy-last-chat keybind, without changing it. */
    public static void observe(Component message) {
        if (message == null) {
            return;
        }
        RECENT.addLast(message.getString());
        while (RECENT.size() > KEEP_PLAIN) {
            RECENT.removeFirst();
        }
    }

    public static String lastMessage() {
        return RECENT.peekLast();
    }

    /** 0 means "keep vanilla's own limit". */
    public static int historyLimit() {
        PuxlConfig.Chat config = PuxlConfig.get().chat;
        if (config.keepVanillaLimit) {
            return 0;
        }
        return Math.max(100, config.historyLimit);
    }

    /**
     * Drops the oldest lines once the configured limit is exceeded. Returns the number
     * of removed lines, or -1 when the vanilla list could not be reached.
     */
    public static int trimHistory(ChatComponent chat) {
        int limit = historyLimit();
        if (chat == null || limit <= 0) {
            return 0;
        }
        try {
            List<?> messages = messages(chat);
            if (messages == null) {
                return -1;
            }
            int removed = 0;
            while (messages.size() > limit) {
                messages.remove(0);
                removed++;
            }
            trimmedLimit = limit;
            return removed;
        } catch (Throwable error) {
            return -1;
        }
    }

    private static List<?> messages(ChatComponent chat) throws Exception {
        if (!fieldResolved) {
            fieldResolved = true;
            // "allMessages" in 1.19+; the lookup is attempted once and cached.
            for (String name : new String[]{"allMessages", "f_93765_", "messages"}) {
                try {
                    Field field = ChatComponent.class.getDeclaredField(name);
                    field.setAccessible(true);
                    if (List.class.isAssignableFrom(field.getType())) {
                        messagesField = field;
                        break;
                    }
                } catch (NoSuchFieldException ignored) {
                    // Try the next candidate.
                }
            }
        }
        if (messagesField == null) {
            return null;
        }
        Object value = messagesField.get(chat);
        return value instanceof List<?> list ? list : null;
    }

    public static int trimmedLimit() {
        return trimmedLimit;
    }
}
