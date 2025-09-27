// STEP 1: IMPORTS AND CONFIGURATION
// =======================================
// Import necessary libraries. `node-telegram-bot-api` for the bot and `axios` for HTTP requests.
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- Bot Configuration ---
// Fetch credentials securely from environment variables, with fallbacks for local testing.
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID || '-100xxxxxxxxxx';
const PUBLIC_CHANNEL = process.env.PUBLIC_CHANNEL || '@YourPublicChannel';
const PUBLIC_GROUP = process.env.PUBLIC_GROUP || '@YourPublicGroup';
const PUBLIC_GROUP2 = process.env.PUBLIC_GROUP2 || '@YourSecondPublicGroup';

// --- Initialize the Bot ---
// The 'polling: true' option tells the bot to actively fetch updates from Telegram.
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- State Management ---
// An object to track the current state of each user (e.g., waiting for input).
const userStates = {};


// STEP 2: MEMBERSHIP VERIFICATION FUNCTIONS
// ==========================================
// These async functions check if a user has joined the required channels.

async function checkChannelMembership(chatId, userId) {
    try {
        const member = await bot.getChatMember(chatId, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        if (error.response && error.response.body.description.includes("user not found")) {
            return false;
        }
        console.error(`Error checking membership for user ${userId} in ${chatId}:`, error.response.body);
        return false;
    }
}

async function hasJoinedAll(userId) {
    const results = await Promise.all([
        checkChannelMembership(PRIVATE_CHANNEL_ID, userId),
        checkChannelMembership(PUBLIC_CHANNEL, userId),
        checkChannelMembership(PUBLIC_GROUP, userId),
        checkChannelMembership(PUBLIC_GROUP2, userId)
    ]);
    return results.every(status => status === true);
}

async function sendJoinRequiredMessage(chatId, userId) {
    const privateChannelLinkId = PRIVATE_CHANNEL_ID.replace('-100', '');
    
    // Check status for each channel to provide feedback to the user.
    const statusChecks = {
        "Main Channel": await checkChannelMembership(PRIVATE_CHANNEL_ID, userId),
        "Backup Channel": await checkChannelMembership(PUBLIC_CHANNEL, userId),
        "Backup Group 1": await checkChannelMembership(PUBLIC_GROUP, userId),
        "Backup Group 2": await checkChannelMembership(PUBLIC_GROUP2, userId)
    };
    
    const statusMessage = Object.entries(statusChecks)
        .map(([name, status]) => `${status ? '✅' : '❌'} ${name}`)
        .join('\n');

    const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "📢 MAIN CHANNEL", url: `https://t.me/c/${privateChannelLinkId}` },
                    { text: "BACKUP CHANNEL", url: `https://t.me/${PUBLIC_CHANNEL.replace('@', '')}` }
                ],
                [
                    { text: "BACKUP GROUP 1", url: `https://t.me/${PUBLIC_GROUP.replace('@', '')}` },
                    { text: "BACKUP GROUP 2", url: `https://t.me/${PUBLIC_GROUP2.replace('@', '')}` }
                ],
                [
                    { text: "✅ I Have Joined All", callback_data: "check_joined" }
                ]
            ]
        }
    };

    const messageText = `🚫 *ACCESS DENIED* 🚫\n\nYou must join all our channels and groups to use this bot.\n\n*Your Current Status:*\n${statusMessage}\n\nPlease join all the required places and then click the button below to verify.`;
    bot.sendMessage(chatId, messageText, opts);
}


// STEP 3: INSTAGRAM PASSWORD RESET FUNCTIONS
// ==========================================
// Async functions that use axios to interact with Instagram's APIs.

async function sendResetMethod1(emailOrUsername) {
    const url = 'https://www.instagram.com/accounts/account_recovery_send_ajax/';
    const data = new URLSearchParams({ email_or_username: emailOrUsername }).toString();
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' };

    try {
        const response = await axios.post(url, data, { headers });
        if (response.status === 200 && response.data.obfuscated_email) {
            return `✅ Reset link sent to ${response.data.obfuscated_email}.`;
        }
        return "❌ Failed. The account may not exist.";
    } catch (error) {
        return "❌ Network error.";
    }
}

async function sendResetMethod2(username) {
    const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
    const profileHeaders = { 'x-ig-app-id': '936619743392459' };

    let userId;
    try {
        const profileRes = await axios.get(profileUrl, { headers: profileHeaders });
        userId = profileRes.data?.data?.user?.id;
        if (!userId) return "❌ Could not find user ID.";
    } catch (error) {
        return "❌ Failed to fetch user profile.";
    }

    const resetUrl = 'https://i.instagram.com/api/v1/accounts/send_password_reset/';
    const resetData = new URLSearchParams({ user_id: userId, device_id: uuidv4() }).toString();
    try {
        const resetRes = await axios.post(resetUrl, resetData);
        if (resetRes.data.obfuscated_email) {
            return `✅ Reset link sent to ${resetRes.data.obfuscated_email}.`;
        }
        return "❌ Failed.";
    } catch (error) {
        return "❌ Failed to send reset link.";
    }
}

async function sendResetMethod3(usernameOrEmail) {
    const url = 'https://www.instagram.com/api/v1/web/accounts/account_recovery_send_ajax/';
    const data = new URLSearchParams({ email_or_username: usernameOrEmail }).toString();
    const headers = { 'x-ig-app-id': '936619743392459' };

    try {
        const response = await axios.post(url, data, { headers });
        if (response.data?.status === 'ok') {
            return `✅ Success: ${response.data.message || 'Request was successful.'}`;
        }
        return `❌ Failed: ${response.data.message || 'Unknown error.'}`;
    } catch (error) {
        return "❌ Failed to get a valid response.";
    }
}

async function processSingleTarget(target) {
    const results = await Promise.all([
        sendResetMethod1(target),
        sendResetMethod2(target),
        sendResetMethod3(target)
    ]);
    return [
        `*Method 1:* ${results[0]}`,
        `*Method 2:* ${results[1]}`,
        `*Method 3:* ${results[2]}`
    ].join('\n');
}


// STEP 4: BOT HANDLERS FOR COMMANDS AND CALLBACKS
// ===============================================

// Middleware function to check membership before executing a command.
const membershipGate = (handler) => async (msg, match) => {
    const userId = msg.from.id;
    if (await hasJoinedAll(userId)) {
        handler(msg, match);
    } else {
        sendJoinRequiredMessage(msg.chat.id, userId);
    }
};

function showMainMenu(chatId) {
    const opts = {
        reply_markup: {
            keyboard: [
                [{ text: "/reset" }, { text: "/bulk_reset" }],
                [{ text: "/help" }]
            ],
            resize_keyboard: true
        }
    };
    bot.sendMessage(chatId, "🤖 Welcome! Choose an option from the menu:", opts);
}

// Handler for /start command
bot.onText(/\/start/, async (msg) => {
    if (await hasJoinedAll(msg.from.id)) {
        showMainMenu(msg.chat.id);
    } else {
        sendJoinRequiredMessage(msg.chat.id, msg.from.id);
    }
});

// Handler for callback queries (e.g., from inline buttons)
bot.on('callback_query', async (callbackQuery) => {
    const { data, message, from } = callbackQuery;
    const chatId = message.chat.id;
    const userId = from.id;

    if (data === 'check_joined') {
        if (await hasJoinedAll(userId)) {
            bot.answerCallbackQuery(callbackQuery.id, { text: "✅ Success! You now have access." });
            bot.deleteMessage(chatId, message.message_id);
            showMainMenu(chatId);
        } else {
            bot.answerCallbackQuery(callbackQuery.id, { text: "❌ You still haven't joined all channels.", show_alert: true });
        }
    }
});

// Handlers for other commands, wrapped in the membership gate
bot.onText(/\/help/, membershipGate((msg) => {
    bot.sendMessage(msg.chat.id, "*/reset*: Get a reset link for one account.\n*/bulk_reset*: Get links for multiple accounts.", { parse_mode: 'Markdown' });
}));

bot.onText(/\/reset/, membershipGate((msg) => {
    userStates[msg.from.id] = 'awaiting_reset_target';
    bot.sendMessage(msg.chat.id, "🔑 Enter the Instagram username or email:");
}));

bot.onText(/\/bulk_reset/, membershipGate((msg) => {
    userStates[msg.from.id] = 'awaiting_bulk_targets';
    bot.sendMessage(msg.chat.id, "📝 Enter multiple Instagram usernames (one per line, max 50).");
}));


// STEP 5: HANDLE USER TEXT INPUT
// ==================================
// This is the main message handler that processes non-command text.
bot.on('message', membershipGate(async (msg) => {
    // Ignore commands, as they are handled by onText
    if (msg.text.startsWith('/')) return;

    const userId = msg.from.id;
    const state = userStates[userId];

    if (state === 'awaiting_reset_target') {
        const target = msg.text.trim();
        const sentMsg = await bot.sendMessage(msg.chat.id, `⏳ Processing \`${target}\`...`, { parse_mode: 'Markdown' });
        
        const result = await processSingleTarget(target);
        bot.editMessageText(`📊 *Results for \`${target}\`*\n\n${result}`, {
            chat_id: msg.chat.id,
            message_id: sentMsg.message_id,
            parse_mode: 'Markdown'
        });
        delete userStates[userId];

    } else if (state === 'awaiting_bulk_targets') {
        const targets = msg.text.trim().split('\n').map(t => t.trim()).filter(Boolean);
        if (targets.length > 50) {
            bot.sendMessage(msg.chat.id, "❌ Max 50 targets allowed.");
            return;
        }

        await bot.sendMessage(msg.chat.id, `⏳ Starting bulk reset for ${targets.length} targets.`);
        for (const [index, target] of targets.entries()) {
            await bot.sendMessage(msg.chat.id, `🔄 Processing ${index + 1}/${targets.length}: \`${target}\``, { parse_mode: 'Markdown' });
            const result = await processSingleTarget(target);
            await bot.sendMessage(msg.chat.id, `📊 *Result for \`${target}\`*\n${result}`, { parse_mode: 'Markdown' });
            // Delay to avoid rate-limiting
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        await bot.sendMessage(msg.chat.id, "✅ Bulk processing complete!");
        delete userStates[userId];
    }
}));


// STEP 6: RUN THE BOT
// =====================
console.log("Bot is starting...");
bot.on('polling_error', (error) => {
    console.error(`Polling error: ${error.code} - ${error.message}`);
});
