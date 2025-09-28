// Instagram Reset Telegram Bot - v4.0 (Cloudflare Worker Edition with Force Join)
// This script is rewritten in JavaScript to run natively on the Cloudflare Workers platform.
// It includes a mandatory channel subscription feature and an updated Instagram API method.

// ============================================================================
// Step 1: Configuration
// ============================================================================

// --- Channel Configuration ---
// This list defines the channels users must join.
// IMPORTANT: The 'id' for each channel MUST be set as a secret in your Cloudflare dashboard.
// e.g., CHANNEL_ID_1, CHANNEL_ID_2, etc.
const CHANNELS = [
    { url: "https://t.me/+YEObPfKXsK1hNjU9", name: "Main Channel", id_key: "CHANNEL_ID_1" }, // Example: -1002628211220
    { url: "https://t.me/pytimebruh", name: "Backup 1", id_key: "CHANNEL_ID_2" },         // Example: @pytimebruh
    { url: "https://t.me/HazyPy", name: "Backup 2", id_key: "CHANNEL_ID_3" },           // Example: @HazyPy
    { url: "https://t.me/HazyGC", name: "Chat Group", id_key: "CHANNEL_ID_4" }           // Example: -1001234567890
];

// In-memory key-value store for user states.
const userStates = new Map();

// ============================================================================
// Step 2: Telegram API Helper
// ============================================================================

/**
 * A helper function to send API requests to Telegram.
 * @param {string} token The bot token.
 * @param {string} method The Telegram API method to call.
 * @param {object} body The JSON payload for the API call.
 */
async function sendTelegramRequest(token, method, body) {
    return fetch(`httpshttps://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ============================================================================
// Step 3: Utilities
// ============================================================================

function escapeMarkdownV2(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/_|\*|\[|\]|\(|\)|~|`|>|#|\+|-|=|\||{|}|\.|!/g, '\\$&');
}

function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ============================================================================
// Step 4: Core Bot Logic
// ============================================================================

/**
 * Checks if a user is subscribed to all required channels.
 * @param {number} userId The user's Telegram ID.
 * @param {object} env The Cloudflare environment object containing secrets.
 * @returns {Promise<{isSubscribed: boolean, notJoined: Array}>}
 */
async function checkChannelSubscription(userId, env) {
    const notJoined = [];
    for (const channel of CHANNELS) {
        const chatId = env[channel.id_key];
        if (!chatId) {
            console.error(`Secret ${channel.id_key} is not set!`);
            notJoined.push(channel);
            continue;
        }

        try {
            const response = await sendTelegramRequest(env.BOT_TOKEN, 'getChatMember', { chat_id: chatId, user_id: userId });
            const data = await response.json();
            if (!data.ok || ['left', 'kicked'].includes(data.result.status)) {
                notJoined.push(channel);
            }
        } catch (e) {
            console.error(`Error checking channel ${channel.name}:`, e);
            notJoined.push(channel);
        }
    }
    return { isSubscribed: notJoined.length === 0, notJoined };
}

/**
 * Sends the message forcing the user to join channels.
 * @param {object} update The Telegram update object.
 * @param {object} env The Cloudflare environment object.
 * @param {Array} notJoinedChannels A list of channels the user hasn't joined.
 */
async function sendForceJoinMessage(update, env, notJoinedChannels) {
    const chatId = update.message?.chat.id || update.callback_query?.message.chat.id;
    const messageId = update.callback_query?.message.message_id;

    const buttons = notJoinedChannels.map(channel => ([{ text: `🔗 Join ${channel.name}`, url: channel.url }]));
    buttons.push([{ text: "✅ I'VE JOINED", callback_data: "check_subscription" }]);
    const keyboard = { inline_keyboard: buttons };

    const messageText = `*🚫 ACCESS RESTRICTED 🚫*\n\nYou must join ALL our channels to use this bot\\.\n\n*Missing channels:*\n${notJoinedChannels.map(c => `• ${escapeMarkdownV2(c.name)}`).join('\n')}\n\nClick the buttons, join the channels, then click "I'VE JOINED"\\.`;

    if (update.callback_query) {
        await sendTelegramRequest(env.BOT_TOKEN, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: messageText,
            reply_markup: keyboard,
            parse_mode: 'MarkdownV2',
        });
    } else {
        await sendTelegramRequest(env.BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: messageText,
            reply_markup: keyboard,
            parse_mode: 'MarkdownV2',
        });
    }
}

/**
 * New Instagram API password reset function.
 * @param {string} target The username or email.
 * @returns {Promise<string>} A formatted result message.
 */
async function sendPasswordReset(target) {
    try {
        const data = {
            '_csrftoken': generateRandomString(32),
            'guid': crypto.randomUUID(),
            'device_id': crypto.randomUUID()
        };
        if (target.includes('@')) {
            data.user_email = target;
        } else {
            data.username = target;
        }

        const headers = {
            'User-Agent': `Instagram 150.0.0.0.000 Android (29/10; 300dpi; 720x1440; ${generateRandomString(16)}/${generateRandomString(16)}; ${generateRandomString(16)}; ${generateRandomString(16)}; en_GB;)`
        };

        const response = await fetch('https://i.instagram.com/api/v1/accounts/send_password_reset/', {
            method: 'POST',
            headers: headers,
            body: new URLSearchParams(data)
        });

        const responseText = await response.text();
        if (responseText.includes('obfuscated_email')) {
            return `✅ *Success\\!* Password reset link sent for: \`${escapeMarkdownV2(target)}\``;
        } else {
            return `❌ *Failed* for: \`${escapeMarkdownV2(target)}\`\n_Reason: ${escapeMarkdownV2(responseText)}_`;
        }
    } catch (e) {
        return `❌ *Error* for: \`${escapeMarkdownV2(target)}\`\n_Exception: ${escapeMarkdownV2(e.message)}_`;
    }
}


// ============================================================================
// Step 5: Main Update Handler
// ============================================================================

async function handleUpdate(update, env) {
    const message = update.message || update.callback_query?.message;
    const user = update.callback_query?.from || update.message?.from;

    if (!message || !user) return;

    const chatId = message.chat.id;
    const userId = user.id;
    const text = message.text || '';

    // --- Subscription Check ---
    if (update.callback_query && update.callback_query.data === 'check_subscription') {
        const { isSubscribed, notJoined } = await checkChannelSubscription(userId, env);
        if (isSubscribed) {
            await sendTelegramRequest(env.BOT_TOKEN, 'editMessageText', {
                chat_id: chatId,
                message_id: message.message_id,
                text: "✅ *Verification Successful\\!* 🎉\nYou can now use all bot features\\.\n\n📖 Use /help to see available commands\\.",
                parse_mode: 'MarkdownV2'
            });
        } else {
            await sendForceJoinMessage(update, env, notJoined);
        }
        return;
    }

    const { isSubscribed, notJoined } = await checkChannelSubscription(userId, env);
    if (!isSubscribed) {
        await sendForceJoinMessage(update, env, notJoined);
        return;
    }

    // --- Command Handling ---
    if (text.startsWith('/start')) {
        const welcomeText = "🔓 *ɪɴsᴛᴀɢʀᴀᴍ ʀᴇsᴇᴛ ʙᴏᴛ* 🔓\n\n✨ *Welcome\\!* ✨\n\n/rst username \\- Single account\n/blk user1 user2 \\- Bulk accounts\n/help \\- Detailed guide";
        await sendTelegramRequest(env.BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: welcomeText, parse_mode: 'MarkdownV2' });
    } else if (text.startsWith('/help')) {
        const helpText = "🆘 *Help Guide* 🆘\n\n*Single Account:*\n`/rst username`\n`/rst user@email\\.com`\n\n*Bulk Accounts (Max 10):*\n`/blk user1 user2 user3`";
        await sendTelegramRequest(env.BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: helpText, parse_mode: 'MarkdownV2' });
    } else if (text.startsWith('/rst')) {
        const args = text.split(' ').slice(1);
        if (args.length === 0) {
            await sendTelegramRequest(env.BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: "❌ *Usage:* /rst username\\_or\\_email", parse_mode: 'MarkdownV2' });
            return;
        }
        const target = args[0];
        const processingMsg = await sendTelegramRequest(env.BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: `🔄 *Processing reset for:* \`${escapeMarkdownV2(target)}\``, parse_mode: 'MarkdownV2' });
        const processingMsgData = await processingMsg.json();
        const messageId = processingMsgData.result.message_id;

        const result = await sendPasswordReset(target);
        await sendTelegramRequest(env.BOT_TOKEN, 'editMessageText', { chat_id: chatId, message_id: messageId, text: result, parse_mode: 'MarkdownV2' });
    }
    // ... (Handler for /blk would be added here in a similar fashion) ...
}

// ============================================================================
// Step 6: Cloudflare Worker Entry Point
// ============================================================================

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        // The webhook request from Telegram comes as a POST to a secret URL (your bot token)
        if (request.method === 'POST' && url.pathname === `/${env.BOT_TOKEN}`) {
            const update = await request.json();
            // Respond to Telegram immediately, then process the update
            // This prevents timeouts in a serverless environment
            handleUpdate(update, env);
            return new Response('OK', { status: 200 });
        }
        // A simple response for anyone visiting the worker's URL directly
        return new Response('Hello! This is a Telegram bot running on Cloudflare Workers.');
    },
};

