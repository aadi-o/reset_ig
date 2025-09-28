# Instagram Reset Telegram Bot (Python) - v2.8 (Cloudflare Webhook)
# This script is adapted to run on serverless platforms like Cloudflare by using
# webhooks instead of polling. The bot receives updates via HTTP requests.

# ============================================================================
# Step 1: Setup and Configuration
# ============================================================================
import os
import re
import requests
import telebot
import traceback
from flask import Flask, request
from uuid import uuid4

# --- Configuration ---
# IMPORTANT: Paste your bot token directly here.
BOT_TOKEN = "7852130119:AAFQ_cPJLRqOeHFgoaH7ARUU2DqkGWC_VPo"
# This should be set to your Cloudflare Worker's public URL after deployment.
WEBHOOK_URL = f"https://your-worker-name.your-account.workers.dev/{BOT_TOKEN}"

# Constants for Instagram API requests
INSTAGRAM_API = {
    'USER_AGENT_WEB': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'USER_AGENT_MOBILE': 'Instagram 27.0.0.7.97 Android (24/7.0; 120dpi; 720x1280; samsung; SM-G935F; herolte; samsungexynos8890; en_US)',
    'APP_ID': '936619743392459',
}

# --- Initialization ---
# Note: We are using the synchronous 'telebot' for the webhook model.
bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)  # Initialize the Flask web server
user_states = {}  # In-memory dictionary to track user states

# ============================================================================
# Step 2: Web Server and Webhook Logic
# ============================================================================
@app.route('/')
def home():
    """A simple page to confirm the web server is running."""
    return "<h1>Bot is alive!</h1><p>Webhook is active.</p>"

@app.route(f'/{BOT_TOKEN}', methods=['POST'])
def webhook():
    """This route receives updates from Telegram and processes them."""
    if request.headers.get('content-type') == 'application/json':
        json_string = request.get_data().decode('utf-8')
        update = telebot.types.Update.de_json(json_string)
        bot.process_new_updates([update])
        return '', 200
    else:
        return 'Unsupported Media Type', 415

def set_webhook():
    """One-time function to register the webhook with Telegram."""
    bot.remove_webhook()
    # Set the webhook URL after a short delay
    import time
    time.sleep(0.5)
    bot.set_webhook(url=WEBHOOK_URL)
    print(f"Webhook set to: {WEBHOOK_URL}")

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
# Step 4: Instagram API Functions (Synchronous)
# ============================================================================
def make_post_request(url, data, headers):
    """A robust wrapper for making synchronous POST requests."""
    try:
        response = requests.post(url, data=data, headers=headers, timeout=15)
        response.raise_for_status()
        return response.json() if 'application/json' in response.headers.get('Content-Type', '') else response.text
    except requests.exceptions.HTTPError as http_err:
        if http_err.response.status_code == 429:
            raise Exception('Rate Limited.')
        raise Exception(f'Request failed with status code {http_err.response.status_code}.')
    except requests.exceptions.RequestException as req_err:
        raise Exception(f'An unexpected network error occurred: {req_err}')

def send_reset_method_1(target):
    try:
        # ... (Implementation is the same as the async version) ...
        url = 'https://www.instagram.com/accounts/account_recovery_send_ajax/'
        data = {'email_or_username': target, 'recaptcha_challenge_field': ''}
        headers = { 'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'], 'Referer': 'https://www.instagram.com/accounts/password/reset/', 'X-Requested-With': 'XMLHttpRequest' }
        make_post_request(url, data, headers)
        return {'success': True}
    except Exception:
        return {'success': False}

def send_reset_method_2(target):
    try:
        # ... (Implementation is the same as the async version) ...
        profile_url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={target}"
        profile_response = requests.get(profile_url, headers={'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'], 'X-IG-App-ID': INSTAGRAM_API['APP_ID']}, timeout=15)
        profile_response.raise_for_status()
        user_id = profile_response.json().get('data', {}).get('user', {}).get('id')
        if not user_id: return {'success': False}
        reset_url = 'https://i.instagram.com/api/v1/accounts/send_password_reset/'
        data = {'user_id': user_id, 'device_id': f'android-{uuid4()}'}
        headers = {'User-Agent': INSTAGRAM_API['USER_AGENT_MOBILE']}
        make_post_request(reset_url, data, headers)
        return {'success': True}
    except Exception:
        return {'success': False}

def send_reset_method_3(target):
    try:
        # ... (Implementation is the same as the async version) ...
        url = 'https://www.instagram.com/api/v1/web/accounts/account_recovery_send_ajax/'
        data = {'email_or_username': target, 'flow': 'fxcal'}
        headers = { 'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://www.instagram.com', 'Referer': 'https://www.instagram.com/accounts/password/reset/', 'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'], 'X-CSRFToken': 'missing', 'X-IG-App-ID': INSTAGRAM_API['APP_ID'], 'X-Requested-With': 'XMLHttpRequest' }
        response = make_post_request(url, data, headers)
        return {'success': response.get('status') == 'ok'}
    except Exception:
        return {'success': False}

# ============================================================================
# Step 5: Core Bot Logic (Synchronous)
# ============================================================================
def process_single_target(target):
    methods = [send_reset_method_1, send_reset_method_2, send_reset_method_3]
    escaped_target = escape_markdown_v2(target)
    for method in methods:
        result = method(target)
        if result['success']:
            return f"✅ A password reset link has been sent to the email associated with *{escaped_target}*\\."
    return f"❌ Failed to send a password reset for *{escaped_target}*\\. Please double\\-check the username/email\\."

def process_bulk_targets(targets, chat_id):
    results_batch = []
    CHUNK_SIZE = 10
    for i, target in enumerate(targets, 1):
        target = target.strip()
        if not target: continue
        escaped_target = escape_markdown_v2(target)
        bot.send_message(chat_id, f"⏳ Processing {i}/{len(targets)}: *{escaped_target}*", parse_mode='MarkdownV2')
        result_message = process_single_target(target)
        results_batch.append(result_message)
        if i % CHUNK_SIZE == 0:
            chunk_summary = "\n".join(results_batch)
            bot.send_message(chat_id, f"📊 *Batch Results ({i - CHUNK_SIZE + 1} - {i})*\n\n{chunk_summary}", parse_mode='MarkdownV2')
            results_batch = []
        import time
        time.sleep(2)
    if results_batch:
        final_summary = "\n".join(results_batch)
        bot.send_message(chat_id, f"🎉 *Final Results*\n\n{final_summary}", parse_mode='MarkdownV2')
    else:
        bot.send_message(chat_id, "✅ *Bulk Processing Complete*\\.", parse_mode='MarkdownV2')

# ============================================================================
# Step 6: Bot Command and Message Handlers
# ============================================================================
def show_main_menu(chat_id):
    welcome_message = (
        f"🤖 *Welcome to the Instagram Password Reset Bot*\n\n"
        f"I can help you send password reset links to Instagram accounts\\. "
        f"Use the commands below or the keyboard to get started\\.\n\n"
        f"🔑 `/reset` \\- Reset a single account\\.\n"
        f"👥 `/bulk_reset` \\- Reset multiple accounts at once\\.\n"
        f"📚 `/help` \\- Show this guide again\\."
    )
    bot.send_message(chat_id, welcome_message, parse_mode='MarkdownV2', reply_markup=telebot.types.ReplyKeyboardMarkup(
        resize_keyboard=True,
        keyboard=[
            [telebot.types.KeyboardButton('/reset'), telebot.types.KeyboardButton('/bulk_reset')],
            [telebot.types.KeyboardButton('/help')]
        ]
    ))

@bot.message_handler(commands=['start', 'help'])
def handle_start_help(message):
    show_main_menu(message.chat.id)

@bot.message_handler(commands=['reset'])
def handle_reset(message):
    user_states[message.from_user.id] = 'awaiting_single_target'
    bot.send_message(message.chat.id, "🔑 Please enter the Instagram username or email for the account you want to reset:")

@bot.message_handler(commands=['bulk_reset'])
def handle_bulk_reset(message):
    user_states[message.from_user.id] = 'awaiting_bulk_targets'
    bot.send_message(message.chat.id, "👥 Please enter up to 50 Instagram usernames or emails, each on a new line.")

@bot.message_handler(func=lambda message: not message.text.startswith('/'))
def handle_text_input(message):
    user_id = message.from_user.id
    current_state = user_states.get(user_id)
    if not current_state:
        show_main_menu(message.chat.id)
        return
    if current_state == 'awaiting_single_target':
        target = message.text.strip()
        escaped_target = escape_markdown_v2(target)
        bot.send_message(message.chat.id, f"⏳ Attempting to send a reset link for *{escaped_target}*\\.\\.\\.", parse_mode='MarkdownV2')
        result_message = process_single_target(target)
        bot.send_message(message.chat.id, result_message, parse_mode='MarkdownV2')
        if user_id in user_states:
            del user_states[user_id]
    elif current_state == 'awaiting_bulk_targets':
        targets = [line for line in message.text.strip().split('\n') if line]
        if not targets:
            bot.send_message(message.chat.id, "⚠️ No valid targets entered.")
            return
        if len(targets) > 50:
            bot.send_message(message.chat.id, f"❌ You entered *{len(targets)}* targets. The maximum is 50.", parse_mode='MarkdownV2')
            return
        try:
            bot.send_message(message.chat.id, f"🚀 Starting bulk reset for *{len(targets)}* targets.", parse_mode='MarkdownV2')
            process_bulk_targets(targets, message.chat.id)
        except Exception:
            print(f"--- UNEXPECTED ERROR IN BULK PROCESSING FOR USER {user_id} ---")
            traceback.print_exc()
            print("--- END OF TRACEBACK ---")
            bot.send_message(message.chat.id, "An unexpected error occurred during the bulk process.")
        finally:
            if user_id in user_states:
                del user_states[user_id]

# ============================================================================
# Step 7: Main Execution Block
# ============================================================================
if __name__ == '__main__':
    # This block is for setting the webhook or running locally for testing.
    # On a platform like Cloudflare, the Flask app object is run by a WSGI server.
    
    # To set the webhook, uncomment the following line and run this script once locally.
    # set_webhook()
    
    # To run the bot locally for testing (uses polling):
    # print("Bot is running locally with polling...")
    # bot.remove_webhook()
    # bot.polling(non_stop=True)
    
    # For deployment, a WSGI server like Gunicorn will run the 'app' object.
    print("Flask app is ready. A WSGI server should be used to run it.")

