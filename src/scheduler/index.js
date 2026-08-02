'use strict';

/**
 * Scheduler
 * ----------
 * The heart of the application, but deliberately a dumb one: it doesn't
 * know how to talk to GitHub or Telegram, it only asks "should work be
 * performed now?" and delegates. That separation means the GitHub engine,
 * state module, and notifier can each be tested and changed independently
 * of *when* they get called.
 *
 *   Scheduler wakes (once an hour)
 *        │
 *        ▼
 *   Already completed today?
 *        │
 *    ┌───┴───┐
 *   YES      NO
 *    │        │
 *  Sleep   Call GitHub Engine ──success──▶ mark state + notify success
 *                    │
 *                  failure
 *                    │
 *          token rejected?──yes──▶ notify "auth required", stop for this hour
 *                    │no
 *          retries exhausted──▶ notify failure, stop for this hour
 *
 * Note: runWithRetry (inside the GitHub Engine) already handles retrying
 * *within* a single hourly check. The scheduler doesn't retry across
 * hours — if this hour's attempt fails, the next hourly wake-up is the
 * natural retry.
 */

const logger = require('../utils/logger');
const state = require('../state');
const notify = require('../notify/telegram');
const { getConfig } = require('../config');
const { performDailyContribution, AuthenticationError } = require('../engine');

const ONE_HOUR_IN_MILLISECONDS = 60 * 60 * 1000;

async function runHourlyCheck() {
  logger.info('Scheduler', 'Hourly check started.');

  if (state.hasCompletedToday()) {
    logger.info('Scheduler', 'Already completed today. Sleeping until next check.');
    return;
  }

  const { dryRun } = getConfig();

  try {
    if (dryRun) {
      logger.info('Scheduler', 'DRY_RUN is enabled — simulating success without touching GitHub.');
    } else {
      await performDailyContribution();
    }

    state.markTodayAsCompleted();
    await notify.sendSuccessNotification();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      logger.error('Scheduler', 'GitHub rejected the token — halting automation until it is replaced.');
      await notify.sendAuthRequiredNotification();
      return;
    }

    logger.error('Scheduler', `Contribution failed after all retries: ${error.message}`);
    await notify.sendFailureNotification(error.message);
  }
}

function startHourlyMonitoring() {
  runHourlyCheck(); // check once immediately at startup, don't wait a full hour
  setInterval(runHourlyCheck, ONE_HOUR_IN_MILLISECONDS);
  logger.info('Scheduler', 'Hourly monitoring started.');
}

module.exports = { startHourlyMonitoring, runHourlyCheck };
