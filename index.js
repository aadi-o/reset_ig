/**
 * Instagram Reset Telegram Bot (Node.js)
 *
 * This bot provides functionality to send password reset links to Instagram accounts.
 * The mandatory channel join feature has been removed.
 */

// Step 1: Setup and Configuration
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- Configuration ---
// It's recommended to use environment variables for security.
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

// Initialize the bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// In-memory state storage for simplicity.
// For production, a database like Redis would be more robust.
const userStates = {};

// --- Instagram API Constants (for headers) ---
const constants = {
    USER_AGENT_WEB: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    USER_AGENT_MOBILE: 'Instagram 6.12.1 Android (30/11; 480dpi; 1080x2004; HONOR; ANY-LX2; HNANY-Q1; qcom; ar_EG_#u-nu-arab)',
    IG_APP_ID: '936619743392459'
};

// Step 2: Instagram Reset Functions

/**
 * Method 1: Tries to send a reset link via a web endpoint.
 * @param {string} usernameOrEmail - The target username or email.
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendResetMethod1(usernameOrEmail) {
    try {
        const url = 'https://www.instagram.com/accounts/account_recovery_send_ajax/';
        const headers = {
            'User-Agent': constants.USER_AGENT_WEB,
            'Referer': 'https://www.instagram.com/accounts/password/reset/',
            'X-CSRFToken': 'missing', // This endpoint is often lenient with CSRF
            'X-Requested-With': 'XMLHttpRequest'
        };
        const data = new URLSearchParams({
            email_or_username: usernameOrEmail,
            recaptcha_challenge_field: ''
        });

        const response = await axios.post(url, data, { headers });
        const emailMatch = response.data.match(/<b>(.*?)<\/b>/);
        const email = emailMatch ? emailMatch[1] : 'an associated email';
        return { success: true, message: `Reset link sent to ${email}.` };
    } catch (error) {
        return { success: false, message: 'Method 1 failed.' };
    }
}

/**
 * Method 2: Tries to get user ID and send a reset link via a mobile API endpoint.
 * @param {string} username - The target username.
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendResetMethod2(username) {
    let userId;
    try {
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileHeaders = {
            'User-Agent': constants.USER_AGENT_WEB,
            'X-IG-App-ID': constants.IG_APP_ID
        };
        const profileResponse = await axios.get(profileUrl, { headers: profileHeaders });
        userId = profileResponse.data.data.user.id;
    } catch (error) {
        return { success: false, message: `Could not find user ID for @${username}.` };
    }

    try {
        const resetUrl = 'https://i.instagram.com/api/v1/accounts/send_password_reset/';
        const resetHeaders = {
            'User-Agent': constants.USER_AGENT_MOBILE,
            'Accept-Language': 'en-US'
        };
        const data = new URLSearchParams({
            user_id: userId,
            device_id: `android-${uuidv4()}`
        });

        const response = await axios.post(resetUrl, data, { headers: resetHeaders });
        const email = response.data.obfuscated_email;
        return { success: true, message: `Reset link sent to ${email}.` };
    } catch (error) {
        return { success: false, message: `Failed to send reset request for @${username}.` };
    }
}


/**
 * Processes all reset methods for a single target.
 * @param {string} target - The username or email.
 * @returns {Promise<string>} - A formatted string of results.
 */
async function processSingleTarget(target) {
    const results = [];
    
    const res1 = await sendResetMethod1(target);
    results.push(`METHOD 1: ${res1.message}`);

    const res2 = await sendResetMethod2(target);
    results.push(`METHOD 2: ${res2.message}`);

    // You can add more methods here if needed
    // const res3 = await sendResetMethod3(target);
    // results.push(`METHOD 3: ${res3.message}`);

    return results.join('\n');
}

/**
 * Processes a list of targets for bulk reset.
 * @param {string[]} targets - An array of usernames or emails.
 * @param {number} chatId - The chat ID to send progress updates to.
 */
async function processBulkTargets(targets, chatId) {
    const allResults = [];
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i].trim();
        if (target) {
            await bot.sendMessage(chatId, `⏳ Processing ${i + 1}/${targets.length}: ${target}`);
            const result = await processSingleTarget(target);
            allResults.push(`🎯 Target: ${target}\n${result}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay
        }
    }
    await bot.sendMessage(chatId, `✅ Bulk Processing Complete!\n\n---\n\n${allResults.join('\n\n---\n\n')}`);
}


// Step 3: Bot Command and Message Handlers

/**
 * Displays the main menu of the bot.
 * @param {number} chatId - The chat ID to send the menu to.
 */
function showMainMenu(chatId) {
    const welcomeMessage = `
🤖 *Welcome to the Instagram Password Reset Bot*

You can use this bot to send password reset links to Instagram accounts.

*Available Commands:*
/reset - Reset a single account.
/bulk_reset - Reset multiple accounts at once.
/help - Show the help guide.
    `;
    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: '/reset' }, { text: '/bulk_reset' }],
                [{ text: '/help' }]
            ],
            resize_keyboard: true
        }
    });
}

// Handler for the /start command
bot.onText(/\/start/, (msg) => {
    showMainMenu(msg.chat.id);
});

// Handler for the /help command
bot.onText(/\/help/, (msg) => {
    const helpMessage = `
📖 *Help Guide*

*Commands:*
/reset - Prompts you to enter a single Instagram username or email to send a password reset link to.

/bulk_reset - Prompts you to enter a list of Instagram usernames or emails (one per line). The bot will process them one by one.

*How to Use:*
1. Select a command from the menu or type it.
2. Follow the on-screen instructions and provide the requested username(s) or email(s).
3. The bot will attempt multiple methods to send the reset link and report the results.
    `;
    bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
});

// Handler for the /reset command
bot.onText(/\/reset/, (msg) => {
    const userId = msg.from.id;
    userStates[userId] = 'awaiting_reset_target';
    bot.sendMessage(msg.chat.id, '🔑 Please enter the Instagram username or email:');
});

// Handler for the /bulk_reset command
bot.onText(/\/bulk_reset/, (msg) => {
    const userId = msg.from.id;
    userStates[userId] = 'awaiting_bulk_targets';
    const bulkMessage = `
📝 *Bulk Reset*

Please enter multiple Instagram usernames or emails. Each one should be on a new line.

*Example:*
username1
another_user
user@example.com
    `;
    bot.sendMessage(msg.chat.id, bulkMessage, { parse_mode: 'Markdown' });
});

// General message handler to process user input based on their state
bot.on('message', async (msg) => {
    // Ignore commands, as they are handled by their specific listeners
    if (msg.text.startsWith('/')) {
        return;
    }

    const userId = msg.from.id;
    const state = userStates[userId];

    if (!state) {
        showMainMenu(msg.chat.id);
        return;
    }

    if (state === 'awaiting_reset_target') {
        const target = msg.text.trim();
        await bot.sendMessage(msg.chat.id, `⏳ Processing reset for *${target}*... This might take a moment.`, { parse_mode: 'Markdown' });
        
        try {
            const result = await processSingleTarget(target);
            await bot.sendMessage(msg.chat.id, `📊 *Results for ${target}:*\n\n${result}`, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(msg.chat.id, '❌ An unexpected error occurred. Please try again.');
            console.error(`Error processing single target ${target}:`, error);
        } finally {
            delete userStates[userId]; // Clear the user's state
        }
    }

    if (state === 'awaiting_bulk_targets') {
        const targets = msg.text.trim().split('\n').filter(t => t); // Filter out empty lines
        if (targets.length === 0) {
            bot.sendMessage(msg.chat.id, '⚠️ No targets provided. Please enter at least one username or email.');
            return;
        }
        if (targets.length > 50) {
            bot.sendMessage(msg.chat.id, '❌ The maximum number of targets for a bulk request is 50.');
            return;
        }

        await bot.sendMessage(msg.chat.id, `⏳ Starting bulk reset for *${targets.length}* targets...`, { parse_mode: 'Markdown' });
        
        try {
            // No need to wrap this in a thread in Node.js, async operations are non-blocking
            await processBulkTargets(targets, msg.chat.id);
        } catch (error) {
            await bot.sendMessage(msg.chat.id, '❌ An unexpected error occurred during the bulk process. Please try again.');
            console.error(`Error processing bulk targets:`, error);
        } finally {
            delete userStates[userId]; // Clear the user's state
        }
    }
});


// Step 4: Start the Bot
console.log('Bot is starting...');
bot.on('polling_error', (error) => {
    console.error(`Polling error: ${error.code} - ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

