# Instagram Reset Telegram Bot (Python) - v2.5 (Robust Bulk Processing)
# This version fixes the bulk reset feature by sending results in smaller chunks
# to avoid Telegram's message length limits. It also includes improved
# error logging for better diagnostics.

# ============================================================================
# Step 1: Setup and Configuration
# ============================================================================
import os
import re
import asyncio
import requests
import telebot
import threading
import traceback
from flask import Flask
from telebot.async_telebot import AsyncTeleBot
from uuid import uuid4
from dotenv import load_dotenv

# Load environment variables from a .env file for local development
load_dotenv()

# --- Configuration ---
BOT_TOKEN = os.getenv('BOT_TOKEN', '7852130119:AAFQ_cPJLRqOeHFgoaH7ARUU2DqkGWC_VPo')

# --- Initialization ---
bot = AsyncTeleBot(BOT_TOKEN)
app = Flask(__name__) # Initialize the Flask web server
user_states = {}

# Constants for Instagram API requests
INSTAGRAM_API = {
    'USER_AGENT_WEB': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'USER_AGENT_MOBILE': 'Instagram 27.0.0.7.97 Android (24/7.0; 120dpi; 720x1280; samsung; SM-G935F; herolte; samsungexynos8890; en_US)',
    'APP_ID': '936619743392459',
}

# ============================================================================
# Step 2: Web Server Route
# ============================================================================
@app.route('/')
def home():
    """This function runs when someone visits the root URL."""
    return "<h1>Bot is alive and running!</h1><p>You can interact with the bot on Telegram.</p>"

# ============================================================================
# Step 3: Utilities
# ============================================================================
def escape_markdown_v2(text):
    """Escapes special characters in a string for Telegram's MarkdownV2 parse mode."""
    if not isinstance(text, str):
        return ''
    escape_chars = r'_*[]()~`>#+|-={}!.\\'
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', text)

# ============================================================================
# Step 4: Instagram API Functions
# ============================================================================
async def make_post_request(url, data, headers):
    """A robust wrapper for making POST requests with timeouts."""
    loop = asyncio.get_running_loop()
    try:
        # Add a 15-second timeout to prevent requests from hanging indefinitely
        response = await loop.run_in_executor(
            None, lambda: requests.post(url, data=data, headers=headers, timeout=15)
        )
        response.raise_for_status()
        return response.json() if 'application/json' in response.headers.get('Content-Type', '') else response.text
    except requests.exceptions.HTTPError as http_err:
        if http_err.response.status_code == 429:
            raise Exception('Rate Limited. Please wait a while before trying again.')
        raise Exception(f'Request failed with status code {http_err.response.status_code}.')
    except requests.exceptions.RequestException as req_err:
        raise Exception(f'An unexpected error occurred: {req_err}')

async def send_reset_method_1(target):
    """Method 1: Sends a reset link using a standard web ajax endpoint."""
    try:
        url = 'https://www.instagram.com/accounts/account_recovery_send_ajax/'
        data = {'email_or_username': target, 'recaptcha_challenge_field': ''}
        headers = {
            'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'],
            'Referer': 'https://www.instagram.com/accounts/password/reset/',
            'X-Requested-With': 'XMLHttpRequest',
        }
        await make_post_request(url, data, headers)
        return {'success': True}
    except Exception:
        return {'success': False}

async def send_reset_method_2(target):
    """Method 2: Sends a reset link using a mobile API endpoint."""
    try:
        loop = asyncio.get_running_loop()
        profile_url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={target}"
        profile_response = await loop.run_in_executor(
            None, lambda: requests.get(profile_url, headers={'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'], 'X-IG-App-ID': INSTAGRAM_API['APP_ID']}, timeout=15)
        )
        profile_response.raise_for_status()
        user_id = profile_response.json().get('data', {}).get('user', {}).get('id')
        if not user_id: return {'success': False}

        reset_url = 'https://i.instagram.com/api/v1/accounts/send_password_reset/'
        data = {'user_id': user_id, 'device_id': f'android-{uuid4()}'}
        headers = {'User-Agent': INSTAGRAM_API['USER_AGENT_MOBILE']}
        await make_post_request(reset_url, data, headers)
        return {'success': True}
    except Exception:
        return {'success': False}

async def send_reset_method_3(target):
    """Method 3: Sends a reset link using an alternative web API endpoint."""
    try:
        url = 'https://www.instagram.com/api/v1/web/accounts/account_recovery_send_ajax/'
        data = {'email_or_username': target, 'flow': 'fxcal'}
        headers = {
            'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://www.instagram.com', 'Referer': 'https://www.instagram.com/accounts/password/reset/',
            'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'], 'X-CSRFToken': 'missing',
            'X-IG-App-ID': INSTAGRAM_API['APP_ID'], 'X-Requested-With': 'XMLHttpRequest',
        }
        response = await make_post_request(url, data, headers)
        return {'success': response.get('status') == 'ok'}
    except Exception:
        return {'success': False}

# ============================================================================
# Step 5: Core Bot Logic
# ============================================================================
async def process_single_target(target):
    """
    Tries all reset methods and returns a single, simple success or failure message.
    """
    methods = [send_reset_method_1, send_reset_method_2, send_reset_method_3]
    escaped_target = escape_markdown_v2(target)
    
    for method in methods:
        result = await method(target)
        if result['success']:
            return f"✅ A password reset link has been sent to the email associated with *{escaped_target}*\\."
    
    return f"❌ Failed to send a password reset for *{escaped_target}*\\. Please double\\-check the username/email\\."

async def process_bulk_targets(targets, chat_id):
    """Processes a list of targets and sends the results in chunks to avoid message length limits."""
    results_batch = []
    CHUNK_SIZE = 10  # Send a summary message every 10 processed targets

    for i, target in enumerate(targets, 1):
        target = target.strip()
        if not target:
            continue
        
        escaped_target = escape_markdown_v2(target)
        await bot.send_message(chat_id, f"⏳ Processing {i}/{len(targets)}: *{escaped_target}*", parse_mode='MarkdownV2')
        
        result_message = await process_single_target(target)
        results_batch.append(result_message)
        
        # When the batch is full, send the chunked summary
        if i % CHUNK_SIZE == 0:
            chunk_summary = "\n".join(results_batch)
            await bot.send_message(chat_id, f"📊 *Batch Results ({i - CHUNK_SIZE + 1} - {i})*\n\n{chunk_summary}", parse_mode='MarkdownV2')
            results_batch = []  # Reset the batch for the next chunk
        
        await asyncio.sleep(2)
        
    # Send any remaining results that didn't form a full chunk
    if results_batch:
        final_summary = "\n".join(results_batch)
        await bot.send_message(chat_id, f"🎉 *Final Results*\n\n{final_summary}", parse_mode='MarkdownV2')
    else:
        await bot.send_message(chat_id, "✅ *Bulk Processing Complete*\\.", parse_mode='MarkdownV2')


# ============================================================================
# Step 6: Bot Command and Message Handlers
# ============================================================================
async def show_main_menu(chat_id):
    """Sends the main welcome menu with a cleaner UI."""
    welcome_message = (
        f"🤖 *Welcome to the Instagram Password Reset Bot*\n\n"
        f"I can help you send password reset links to Instagram accounts\\. "
        f"Use the commands below or the keyboard to get started\\.\n\n"
        f"🔑 `/reset` \\- Reset a single account\\.\n"
        f"👥 `/bulk_reset` \\- Reset multiple accounts at once\\.\n"
        f"📚 `/help` \\- Show this guide again\\."
    )
    await bot.send_message(chat_id, welcome_message, parse_mode='MarkdownV2', reply_markup=telebot.types.ReplyKeyboardMarkup(
        resize_keyboard=True,
        keyboard=[
            [telebot.types.KeyboardButton('/reset'), telebot.types.KeyboardButton('/bulk_reset')],
            [telebot.types.KeyboardButton('/help')]
        ]
    ))

@bot.message_handler(commands=['start', 'help'])
async def handle_start_help(message):
    await show_main_menu(message.chat.id)

@bot.message_handler(commands=['reset'])
async def handle_reset(message):
    user_states[message.from_user.id] = 'awaiting_single_target'
    await bot.send_message(message.chat.id, "🔑 Please enter the Instagram username or email for the account you want to reset:")

@bot.message_handler(commands=['bulk_reset'])
async def handle_bulk_reset(message):
    user_states[message.from_user.id] = 'awaiting_bulk_targets'
    await bot.send_message(message.chat.id, "👥 Please enter up to 50 Instagram usernames or emails, each on a new line.")

@bot.message_handler(func=lambda message: not message.text.startswith('/'))
async def handle_text_input(message):
    user_id = message.from_user.id
    current_state = user_states.get(user_id)

    if not current_state:
        await show_main_menu(message.chat.id)
        return

    if current_state == 'awaiting_single_target':
        target = message.text.strip()
        escaped_target = escape_markdown_v2(target)
        await bot.send_message(message.chat.id, f"⏳ Attempting to send a reset link for *{escaped_target}*\\.\\.\\.", parse_mode='MarkdownV2')
        
        result_message = await process_single_target(target)
        await bot.send_message(message.chat.id, result_message, parse_mode='MarkdownV2')
        
        if user_id in user_states:
            del user_states[user_id]

    elif current_state == 'awaiting_bulk_targets':
        targets = [line for line in message.text.strip().split('\n') if line]
        if not targets:
            await bot.send_message(message.chat.id, "⚠️ No valid targets entered. Please provide at least one username or email.")
            return
        if len(targets) > 50:
            await bot.send_message(message.chat.id, f"❌ You entered *{len(targets)}* targets. The maximum is 50. Please reduce the list and try again.", parse_mode='MarkdownV2')
            return

        try:
            await bot.send_message(message.chat.id, f"🚀 Starting bulk reset for *{len(targets)}* targets. This may take a moment.", parse_mode='MarkdownV2')
            await process_bulk_targets(targets, message.chat.id)
        except Exception as e:
            # Add more detailed logging for easier debugging
            print(f"--- UNEXPECTED ERROR IN BULK PROCESSING FOR USER {user_id} ---")
            traceback.print_exc()
            print("--- END OF TRACEBACK ---")
            await bot.send_message(message.chat.id, "An unexpected error occurred during the bulk process. Please try again later.")
        finally:
            # Always clean up the user's state after the operation
            if user_id in user_states:
                del user_states[user_id]

# ============================================================================
# Step 7: Start the Bot and Web Server
# ============================================================================
def run_flask():
    # This function runs the web server. It needs to be in a separate thread.
    # The host '0.0.0.0' is required for Render to connect to it.
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))

async def main_bot_logic():
    print('Bot is starting up...')
    try:
        # Prevents the bot from crashing on minor polling errors.
        await bot.polling(non_stop=True, request_timeout=90)
    except Exception as e:
        print(f"An unexpected error occurred in bot polling: {e}")
        # A brief pause before attempting to restart polling.
        await asyncio.sleep(5)

if __name__ == '__main__':
    # Start the Flask server in a background thread
    flask_thread = threading.Thread(target=run_flask)
    flask_thread.start()
    
    # Start the bot's polling logic
    print('Web server and bot are running successfully.')
    asyncio.run(main_bot_logic())

