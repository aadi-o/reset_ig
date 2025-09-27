# Instagram Reset Telegram Bot (Python) - v2.1
#
# A robust and well-documented Python script for the Instagram password reset bot,
# converted from the Node.js version. This version focuses on clarity,
# error handling, and a better user experience.

# ============================================================================
# Step 1: Setup and Configuration
# ============================================================================

import os
import re
import telebot
import requests
import uuid
import threading
from dotenv import load_dotenv

# Load environment variables from a .env file for local development.
# On Render, these variables are set in the dashboard.
load_dotenv()

# --- Configuration ---
# The bot token is read from environment variables. A fallback is provided for local testing.
BOT_TOKEN = os.getenv('BOT_TOKEN', '7852130119:AAFQ_cPJLRqOeHFgoaH7ARUU2DqkGWC_VPo')

# --- Initialization ---
bot = telebot.TeleBot(BOT_TOKEN, parse_mode=None)

# A simple in-memory dictionary to track the state of each user.
user_states = {}

# Constants for Instagram API requests.
INSTAGRAM_API = {
    'USER_AGENT_WEB': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'USER_AGENT_MOBILE': 'Instagram 27.0.0.7.97 Android (24/7.0; 120dpi; 720x1280; samsung; SM-G935F; herolte; samsungexynos8890; en_US)',
    'APP_ID': '936619743392459',
}

# ============================================================================
# Step 2: Utilities
# ============================================================================

def escape_markdown_v2(text):
    """Escapes special characters in a string for Telegram's MarkdownV2 parse mode."""
    if not isinstance(text, str):
        return ''
    # Chars to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return re.sub(r'([_*\[\]()~`>#+\-=|{}.!])', r'\\\1', text)

# ============================================================================
# Step 3: Instagram API Functions
# ============================================================================

def make_post_request(url, data, headers):
    """A wrapper for making robust POST requests with detailed error handling."""
    try:
        response = requests.post(url, data=data, headers=headers)
        response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)
        return response.json() if response.text else {}
    except requests.exceptions.HTTPError as http_err:
        if http_err.response.status_code == 429:
            raise Exception('Rate Limited. Please wait a while before trying again.')
        try:
            error_data = http_err.response.json()
            message = error_data.get('message', f'Request failed with status code {http_err.response.status_code}')
        except ValueError:
            message = f'Request failed with status code {http_err.response.status_code}'
        raise Exception(message)
    except requests.exceptions.RequestException as req_err:
        raise Exception(f'An unexpected error occurred: {req_err}')

def send_reset_method_1(target):
    """Method 1: Sends a reset link using a standard web ajax endpoint."""
    try:
        url = 'https://www.instagram.com/accounts/account_recovery_send_ajax/'
        data = {'email_or_username': target, 'recaptcha_challenge_field': ''}
        headers = {
            'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'],
            'Referer': 'https://www.instagram.com/accounts/password/reset/',
            'X-Requested-With': 'XMLHttpRequest',
        }
        # This endpoint returns HTML, not JSON, so we handle it separately
        response = requests.post(url, data=data, headers=headers)
        response.raise_for_status()
        
        match = re.search(r'<b>(.*?)<\/b>', response.text)
        email = match.group(1) if match else 'an associated email'
        return {'success': True, 'message': f'Reset link sent to {email}.'}
    except Exception as e:
        return {'success': False, 'message': str(e)}

def send_reset_method_2(target):
    """Method 2: Sends a reset link using a mobile API endpoint."""
    try:
        profile_url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={target}"
        profile_headers = {'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'], 'X-IG-App-ID': INSTAGRAM_API['APP_ID']}
        profile_response = requests.get(profile_url, headers=profile_headers)
        profile_response.raise_for_status()
        user_id = profile_response.json().get('data', {}).get('user', {}).get('id')

        if not user_id:
            return {'success': False, 'message': 'Could not find a user with that username.'}

        reset_url = 'https://i.instagram.com/api/v1/accounts/send_password_reset/'
        data = {'user_id': user_id, 'device_id': f'android-{uuid.uuid4()}'}
        headers = {'User-Agent': INSTAGRAM_API['USER_AGENT_MOBILE']}
        response = make_post_request(reset_url, data=data, headers=headers)
        email = response.get('obfuscated_email', 'an associated email')
        return {'success': True, 'message': f'Reset link sent to {email}.'}
    except Exception as e:
        return {'success': False, 'message': str(e)}

def send_reset_method_3(target):
    """Method 3: Sends a reset link using an alternative web API endpoint."""
    try:
        url = 'https://www.instagram.com/api/v1/web/accounts/account_recovery_send_ajax/'
        data = {'email_or_username': target, 'flow': 'fxcal'}
        headers = {
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://www.instagram.com',
            'Referer': 'https://www.instagram.com/accounts/password/reset/',
            'User-Agent': INSTAGRAM_API['USER_AGENT_WEB'],
            'X-CSRFToken': 'missing',
            'X-IG-App-ID': INSTAGRAM_API['APP_ID'],
            'X-Requested-With': 'XMLHttpRequest',
        }
        response = make_post_request(url, data=data, headers=headers)
        if response.get('status') == 'ok':
            return {'success': True, 'message': 'Reset link sent successfully.'}
        return {'success': False, 'message': response.get('message', 'An unknown error occurred.')}
    except Exception as e:
        return {'success': False, 'message': str(e)}

# ============================================================================
# Step 4: Core Bot Logic
# ============================================================================

def process_single_target(target):
    """Runs all reset methods for a single target and formats the results."""
    results = []
    methods = [send_reset_method_1, send_reset_method_2, send_reset_method_3]
    for i, method in enumerate(methods, 1):
        result = method(target)
        icon = '✅' if result['success'] else '❌'
        message = escape_markdown_v2(result['message'])
        results.append(f"{icon} *Method {i}:* {message}")
    return '\n'.join(results)

def process_bulk_targets(targets, chat_id):
    """Processes a list of targets sequentially, sending updates to the user."""
    all_results = []
    for i, target in enumerate(targets, 1):
        target = target.strip()
        if not target:
            continue
        
        escaped_target = escape_markdown_v2(target)
        bot.send_message(chat_id, f"⏳ Processing {i}/{len(targets)}: *{escaped_target}*", parse_mode='MarkdownV2')
        result = process_single_target(target)
        all_results.append(f"🎯 *Target: {escaped_target}*\n{result}")

    final_message = f"🎉 *Bulk Processing Complete\\!* 🎉\n\n---\n\n" + '\n\n---\n\n'.join(all_results)
    bot.send_message(chat_id, final_message, parse_mode='MarkdownV2')

# ============================================================================
# Step 5: Bot Command and Message Handlers
# ============================================================================

def show_main_menu(chat_id):
    """Sends the main welcome menu with command buttons."""
    welcome_message = (
        "🤖 *Welcome to the Instagram Password Reset Bot*\n\n"
        "Use the commands below to get started\\.\n\n"
        "/reset \\- Reset a single account\\.\n"
        "/bulk\\_reset \\- Reset multiple accounts\\.\n"
        "/help \\- Show this guide again\\."
    )
    markup = telebot.types.ReplyKeyboardMarkup(resize_keyboard=True)
    markup.row(telebot.types.KeyboardButton('/reset'), telebot.types.KeyboardButton('/bulk_reset'))
    markup.row(telebot.types.KeyboardButton('/help'))
    bot.send_message(chat_id, welcome_message, reply_markup=markup, parse_mode='MarkdownV2')

@bot.message_handler(commands=['start', 'help'])
def handle_start_help(message):
    show_main_menu(message.chat.id)

@bot.message_handler(commands=['reset'])
def handle_reset(message):
    user_states[message.from_user.id] = 'awaiting_single_target'
    bot.send_message(message.chat.id, '🔑 Please enter the Instagram username or email for the account you want to reset:')

@bot.message_handler(commands=['bulk_reset'])
def handle_bulk_reset(message):
    user_states[message.from_user.id] = 'awaiting_bulk_targets'
    bot.send_message(message.chat.id, '📝 Please enter up to 50 Instagram usernames or emails, each on a new line.')

@bot.message_handler(func=lambda message: not message.text.startswith('/'))
def handle_message(message):
    """Handles non-command messages based on user state."""
    user_id = message.from_user.id
    current_state = user_states.get(user_id)

    if not current_state:
        show_main_menu(message.chat.id)
        return

    if current_state == 'awaiting_single_target':
        target = message.text.strip()
        escaped_target = escape_markdown_v2(target)
        bot.send_message(message.chat.id, f"⏳ Processing reset for *{escaped_target}*\\.\\.\\. Please wait\\.", parse_mode='MarkdownV2')
        
        try:
            results = process_single_target(target)
            bot.send_message(message.chat.id, f"📊 *Results for {escaped_target}*\n\n{results}", parse_mode='MarkdownV2')
        except Exception as e:
            print(f"Error during single target processing: {e}")
            bot.send_message(message.chat.id, 'An unexpected error occurred. Please try again later.')
        finally:
            user_states.pop(user_id, None)

    elif current_state == 'awaiting_bulk_targets':
        targets = [line.strip() for line in message.text.strip().split('\n') if line.strip()]
        
        if not targets:
            bot.send_message(message.chat.id, '⚠️ No valid targets were entered. Please provide at least one username or email.')
            return
        if len(targets) > 50:
            bot.send_message(message.chat.id, '❌ You entered more than 50 targets. Please reduce the list and try again.')
            return
            
        bot.send_message(message.chat.id, f"🚀 Starting bulk reset for *{len(targets)}* targets\\.\\.\\.", parse_mode='MarkdownV2')
        
        # Run the bulk process in a separate thread to avoid blocking the bot
        thread = threading.Thread(target=process_bulk_targets, args=(targets, message.chat.id))
        thread.start()
        
        user_states.pop(user_id, None)

# ============================================================================
# Step 6: Start the Bot
# ============================================================================

if __name__ == '__main__':
    print('Bot is starting up...')
    try:
        bot.polling(non_stop=True)
    except Exception as e:
        print(f"An error occurred during polling: {e}")
    print('Bot has stopped.')

