'use strict';

/**
 * Telegram Notifications
 * ------------------------
 * A notification layer, nothing more. This module has no opinion about
 * schedulers, retries, or GitHub — it just knows how to send a message,
 * and it fails *safely*: if Telegram is unreachable, that is logged as a
 * warning and swallowed rather than thrown, because a notification
 * failure should never be allowed to stop GitHub automation.
 *
 * Deliberately not sent here: an "already completed today" message.
 * The scheduler runs hourly, but nobody wants an hourly Telegram ping —
 * notifications only fire on meaningful state changes.
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');

async function sendTelegramMessage(text) {
  const { enabled, botToken, chatId } = getConfig().telegram;

  if (!enabled) {
    throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Telegram API responded with ${response.status}: ${responseBody}`);
  }
}

/**
 * @returns {Promise<boolean>} whether the message actually reached Telegram.
 *   Callers are free to ignore this — failures are already logged, and no
 *   notification problem should ever stop GitHub automation. Startup uses
 *   it to warn loudly, because notifications that silently go nowhere are
 *   how a broken automation stays unnoticed for weeks.
 */
async function notifySafely(text) {
  if (!getConfig().telegram.enabled) {
    // Not an error, and not worth a warning on every single event —
    // running without notifications is a supported choice.
    logger.debug('Telegram', 'Notifications are not configured; skipping.');
    return false;
  }

  try {
    await sendTelegramMessage(text);
    logger.info('Telegram', 'Notification delivered.');
    return true;
  } catch (error) {
    logger.warning('Telegram', `Failed to deliver notification: ${error.message}`);
    return false;
  }
}

/**
 * Lists the chats that have messaged this bot, so a user can find their
 * numeric chat ID without hand-assembling a getUpdates URL and reading raw
 * JSON. Takes the token as an argument rather than reading configuration,
 * because this is exactly the moment when configuration is still
 * incomplete — you can't have a chat ID yet if you're trying to find it.
 *
 * @param {string} botToken
 * @returns {Promise<Array<{id: number, type: string, name: string}>>}
 */
async function discoverChatIds(botToken) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
  const payload = await response.json();

  if (!payload.ok) {
    throw new Error(`Telegram rejected the bot token: ${payload.description}`);
  }

  const chatsById = new Map();
  for (const update of payload.result) {
    const message = update.message || update.channel_post || update.my_chat_member;
    if (message && message.chat) {
      const { chat } = message;
      chatsById.set(chat.id, {
        id: chat.id,
        type: chat.type,
        name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '(no name)',
      });
    }
  }

  return [...chatsById.values()];
}

module.exports = {
  discoverChatIds,
  sendStartupNotification: () => notifySafely('🟢 StreakKeeper started. Monitoring has begun.'),
  sendShutdownNotification: () => notifySafely('🛑 StreakKeeper is shutting down.'),
  sendSuccessNotification: () => notifySafely("✅ Today's GitHub contribution completed."),
  sendFailureNotification: (reason) =>
    notifySafely(`⚠️ StreakKeeper could not complete today's contribution.\nReason: ${reason}`),
  sendAuthRequiredNotification: () =>
    notifySafely(
      '🔒 GitHub rejected StreakKeeper\'s token — it has expired, been revoked, or lost access to the repository.\n' +
        'Create a new one (`node manage.js auth` prints the steps), put it in .env as GITHUB_TOKEN, then run `node manage.js restart`.'
    ),

  // Exposed directly (bypassing notifySafely's silent failure) so
  // `manage.js test-telegram` can report a real success/failure to the user.
  sendRawMessage: sendTelegramMessage,
};
