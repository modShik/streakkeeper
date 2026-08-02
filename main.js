'use strict';

/**
 * Application Entry Point
 * -------------------------
 *   Load configuration
 *        ↓
 *   Verify GitHub access
 *        ↓
 *   Send startup notification (and check it arrived)
 *        ↓
 *   Begin hourly monitoring
 *
 * This file is intentionally thin — it orchestrates subsystems, it
 * doesn't contain business logic itself. If any required piece isn't
 * ready (bad config, an unusable token), we stop here rather than starting
 * a scheduler that would just fail every hour.
 */

const { getConfig, ConfigurationError } = require('./src/config');
const logger = require('./src/utils/logger');
const notify = require('./src/notify/telegram');
const { verifyGitHubAccess } = require('./src/auth');
const { startHourlyMonitoring } = require('./src/scheduler');

async function main() {
  loadConfigurationOrExit();
  logger.info('Startup', 'Configuration loaded.');

  const canReachGitHub = await verifyGitHubAccess();
  if (!canReachGitHub) {
    logger.error('Startup', 'GitHub access check failed. Run `node manage.js check-auth` for details.');
    await notify.sendAuthRequiredNotification();
    process.exit(1);
  }

  await warnIfNotificationsAreBroken();
  startHourlyMonitoring();
}

/**
 * The startup notification doubles as a delivery test.
 *
 * This matters more than it looks: every other notification in
 * StreakKeeper is a *failure* report, so if Telegram is misconfigured the
 * symptom is silence — which is indistinguishable from everything working
 * perfectly. This project sat broken for two weeks for exactly that
 * reason. Monitoring still starts (a notification problem is not a reason
 * to stop maintaining the streak), but the log says plainly that nobody
 * is going to hear about it if something breaks.
 */
async function warnIfNotificationsAreBroken() {
  if (!getConfig().telegram.enabled) {
    logger.info('Startup', 'Telegram is not configured — running without notifications.');
    return;
  }

  const notificationDelivered = await notify.sendStartupNotification();
  if (notificationDelivered) {
    return;
  }

  logger.error(
    'Startup',
    'Telegram notifications are NOT working. Monitoring will continue, but you will not be told if it fails. ' +
      'Check TELEGRAM_CHAT_ID (it must be numeric) with `node manage.js test-telegram`.'
  );
}

function loadConfigurationOrExit() {
  try {
    getConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // A clear, human-readable message — not a stack trace — since this
      // is almost always a simple typo or missing value in .env.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

async function shutdown(signal) {
  logger.info('Shutdown', `Received ${signal}. Shutting down gracefully.`);
  await notify.sendShutdownNotification();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((error) => {
  logger.error('Startup', `Unexpected error during startup: ${error.message}`);
  process.exit(1);
});
