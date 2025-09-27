/**
 * Instagram Reset Telegram Bot (Node.js) - v2.0
 *
 * A completely rewritten, robust, and well-documented script for the Instagram
 * password reset bot. This version focuses on clarity, error handling, and a
 * better user experience.
 */

// ============================================================================
// Step 1: Setup and Configuration
// ============================================================================

// The 'dotenv' package loads environment variables from a .env file for local development.
// On Render, these variables are set in the dashboard.
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- Configuration ---
// The bot token is read from environment variables. A fallback is provided for local testing.
const BOT_TOKEN = process.env.BOT_TOKEN || '7852130119:AAFYmkU3Dn5g_D-7HDCW29zcIUM7o-iemCE';

// --- Initialization ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// A simple in-memory object to track the state of each user (e.g., waiting for input).
const userStates = {};

// Constants for Instagram API requests to avoid magic strings.
const INSTAGRAM_API = {
    USER_AGENT_WEB: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    USER_AGENT_MOBILE: 'Instagram 27.0.0.7.97 Android (24/7.0; 120dpi; 720x1280; samsung; SM-G935F; herolte; samsungexynos8890; en_US)',
    APP_ID: '936619743392459',
};

// ============================================================================
// Step 2: Instagram API Functions
// ============================================================================

/**
 * A wrapper for making robust POST requests with detailed error handling.
 * @param {string} url - The URL to send the request to.
 * @param {URLSearchParams} data - The data to send in the request body.
 * @param {object} headers - The request headers.
 * @returns {Promise<object>} The response data from the server.
 * @throws {Error} Throws an error with a user-friendly message if the request fails.
 */
async function makePostRequest(url, data, headers) {
    try {
        const response = await axios.post(url, data, { headers });
        return response.data;
    } catch (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            const status = error.response.status;
            const errorData = error.response.data;
            if (status === 429) {
                throw new Error('Rate Limited. Please wait a while before trying again.');
            }
            // Try to get a specific message from Instagram's response
            const message = errorData?.message || `Request failed with status code ${status}`;
            throw new Error(message);
        } else if (error.request) {
            // The request was made but no response was received
            throw new Error('No response from Instagram. Check your network connection.');
        } else {
            // Something happened in setting up the request that triggered an Error
            throw new Error(`An unexpected error occurred: ${error.message}`);
        }
    }
}


/**
 * Method 1: Sends a reset link using a standard web ajax endpoint.
 * @param {string} target - The Instagram username or email.
 * @returns {Promise<{success: boolean, message: string}>} Result of the operation.
 */
async function sendResetMethod1(target) {
    try {
        const url = 'https://www.instagram.com/accounts/account_recovery_send_ajax/';
        const data = new URLSearchParams({ email_or_username: target, recaptcha_challenge_field: '' });
        const headers = {
            'User-Agent': INSTAGRAM_API.USER_AGENT_WEB,
            'Referer': 'https://www.instagram.com/accounts/password/reset/',
            'X-Requested-With': 'XMLHttpRequest',
        };
        const response = await makePostRequest(url, data, headers);
        const emailMatch = typeof response === 'string' && response.match(/<b>(.*?)<\/b>/);
        const email = emailMatch ? emailMatch[1] : 'an associated email';
        return { success: true, message: `Reset link sent to ${email}.` };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/**
 * Method 2: Sends a reset link using a mobile API endpoint after fetching the user's ID.
 * @param {string} target - The Instagram username.
 * @returns {Promise<{success: boolean, message: string}>} Result of the operation.
 */
async function sendResetMethod2(target) {
    try {
        // First, get the user ID from the username
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${target}`;
        const profileResponse = await axios.get(profileUrl, { headers: { 'User-Agent': INSTAGRAM_API.USER_AGENT_WEB, 'X-IG-App-ID': INSTAGRAM_API.APP_ID } });
        const userId = profileResponse.data?.data?.user?.id;

        if (!userId) {
            return { success: false, message: 'Could not find a user with that username.' };
        }

        // Now, send the password reset request
        const resetUrl = 'https://i.instagram.com/api/v1/accounts/send_password_reset/';
        const data = new URLSearchParams({ user_id: userId, device_id: `android-${uuidv4()}` });
        const headers = { 'User-Agent': INSTAGRAM_API.USER_AGENT_MOBILE };
        const response = await makePostRequest(resetUrl, data, headers);
        const email = response.obfuscated_email || 'an associated email';
        return { success: true, message: `Reset link sent to ${email}.` };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/**
 * Method 3: Sends a reset link using an alternative web API endpoint.
 * @param {string} target - The Instagram username or email.
 * @returns {Promise<{success: boolean, message: string}>} Result of the operation.
 */
async function sendResetMethod3(target) {
    try {
        const url = 'https://www.instagram.com/api/v1/web/accounts/account_recovery_send_ajax/';
        const data = new URLSearchParams({ email_or_username: target, flow: 'fxcal' });
        const headers = {
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://www.instagram.com',
            'Referer': 'https://www.instagram.com/accounts/password/reset/',
            'User-Agent': INSTAGRAM_API.USER_AGENT_WEB,
            'X-CSRFToken': 'missing', // This endpoint is often lenient
            'X-IG-App-ID': INSTAGRAM_API.APP_ID,
            'X-Requested-With': 'XMLHttpRequest',
        };
        const response = await makePostRequest(url, data, headers);
        if (response.status === 'ok') {
            return { success: true, message: 'Reset link sent successfully.' };
        }
        return { success: false, message: response.message || 'An unknown error occurred.' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// ============================================================================
// Step 3: Core Bot Logic
// ============================================================================

/**
 * Runs all available reset methods for a single target and formats the results.
 * @param {string} target - The Instagram username or email.
 * @returns {Promise<string>} A formatted string containing the results of all methods.
 */
async function processSingleTarget(target) {
    const results = [];
    const methods = [sendResetMethod1, sendResetMethod2, sendResetMethod3];

    for (let i = 0; i < methods.length; i++) {
        const result = await methods[i](target);
        const icon = result.success ? '✅' : '❌';
        results.push(`${icon} *Method ${i + 1}:* ${result.message}`);
    }

    return results.join('\n');
}

/**
 * Processes a list of targets sequentially, sending progress updates to the user.
 * @param {string[]} targets - An array of Instagram usernames or emails.
 * @param {number} chatId - The chat ID to send updates and results to.
 */
async function processBulkTargets(targets, chatId) {
    const allResults = [];
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i].trim();
        if (!target) continue; // Skip empty lines

        await bot.sendMessage(chatId, `⏳ Processing ${i + 1}/${targets.length}: *${target}*`, { parse_mode: 'Markdown' });
        const result = await processSingleTarget(target);
        allResults.push(`🎯 *Target: ${target}*\n${result}`);

        // Add a delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await bot.sendMessage(chatId, `🎉 *Bulk Processing Complete!* 🎉\n\n---\n\n${allResults.join('\n\n---\n\n')}`, { parse_mode: 'Markdown' });
}

// ============================================================================
// Step 4: Bot Command and Message Handlers
// ============================================================================

/**
 * Sends the main welcome menu with command buttons.
 * @param {number} chatId The chat ID to send the menu to.
 */
function showMainMenu(chatId) {
    const welcomeMessage = `
🤖 *Welcome to the Instagram Password Reset Bot*

Use the commands below to get started.

/reset - Reset a single account.
/bulk_reset - Reset multiple accounts.
/help - Show this guide again.
    `;
    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: '/reset' }, { text: '/bulk_reset' }],
                [{ text: '/help' }],
            ],
            resize_keyboard: true,
        },
    });
}

bot.onText(/\/start|\/help/, (msg) => {
    showMainMenu(msg.chat.id);
});

bot.onText(/\/reset/, (msg) => {
    userStates[msg.from.id] = 'awaiting_single_target';
    bot.sendMessage(msg.chat.id, '🔑 Please enter the Instagram username or email for the account you want to reset:');
});

bot.onText(/\/bulk_reset/, (msg) => {
    userStates[msg.from.id] = 'awaiting_bulk_targets';
    bot.sendMessage(msg.chat.id, '📝 Please enter up to 50 Instagram usernames or emails, each on a new line.');
});

// This handler catches any message that isn't a command.
bot.on('message', async (msg) => {
    if (msg.text.startsWith('/')) return; // Ignore commands

    const userId = msg.from.id;
    const currentState = userStates[userId];

    if (!currentState) {
        showMainMenu(msg.chat.id);
        return;
    }

    // --- State: Awaiting Single Target ---
    if (currentState === 'awaiting_single_target') {
        const target = msg.text.trim();
        await bot.sendMessage(msg.chat.id, `⏳ Processing reset for *${target}*... Please wait.`, { parse_mode: 'Markdown' });

        try {
            const results = await processSingleTarget(target);
            await bot.sendMessage(msg.chat.id, `📊 *Results for ${target}*\n\n${results}`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error during single target processing:', error);
            await bot.sendMessage(msg.chat.id, 'An unexpected error occurred. Please try again later.');
        } finally {
            delete userStates[userId]; // Reset state
        }
    }

    // --- State: Awaiting Bulk Targets ---
    if (currentState === 'awaiting_bulk_targets') {
        const targets = msg.text.trim().split('\n').filter(Boolean); // Split by line and remove empty ones

        if (targets.length === 0) {
            bot.sendMessage(msg.chat.id, '⚠️ No valid targets were entered. Please provide at least one username or email.');
            return;
        }
        if (targets.length > 50) {
            bot.sendMessage(msg.chat.id, '❌ You entered more than 50 targets. Please reduce the list and try again.');
            return;
        }

        await bot.sendMessage(msg.chat.id, `🚀 Starting bulk reset for *${targets.length}* targets...`, { parse_mode: 'Markdown' });
        
        try {
            await processBulkTargets(targets, msg.chat.id);
        } catch (error) {
            console.error('Error during bulk target processing:', error);
            await bot.sendMessage(msg.chat.id, 'An unexpected error occurred during the bulk process. Please try again later.');
        } finally {
            delete userStates[userId]; // Reset state
        }
    }
});


// ============================================================================
// Step 5: Start the Bot and Handle Errors
// ============================================================================

console.log('Bot is starting up...');

bot.on('polling_error', (error) => {
    // This event is fired when the polling mechanism encounters an error.
    console.error(`[Polling Error] Code: ${error.code} - Message: ${error.message}`);
    // A 409 conflict means another instance is running. Other errors might be network-related.
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
        console.error('!!! Critical Error: Another bot instance is running with the same token. Shutting down. !!!');
        process.exit(1); // Exit the process to prevent conflict loops.
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

console.log('Bot is running successfully and polling for messages.');

