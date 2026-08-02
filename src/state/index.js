'use strict';

/**
 * State Management
 * -----------------
 * Answers exactly one question: has today's contribution already
 * happened? The state file stores nothing but a single date
 * (e.g. "2026-07-15") — no timestamps, no history, no database needed.
 *
 * Failure handling: a missing or corrupted state file is never treated as
 * a fatal error. It's simply treated as "not completed today", which is
 * always the safe default — worst case, we check GitHub and find out
 * nothing needs doing. The file is recreated automatically the next time
 * a contribution succeeds.
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config');
const logger = require('../utils/logger');
const { getDateString } = require('../utils/dates');

const DATE_FORMAT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getTodayDateString() {
  return getDateString(getConfig().github.timeZone);
}

function readLastSuccessfulRunDate() {
  const { stateFilePath } = getConfig().paths;

  if (!fs.existsSync(stateFilePath)) {
    logger.info('State', 'No state file found — treating this as a first run.');
    return null;
  }

  const rawContents = fs.readFileSync(stateFilePath, 'utf8').trim();
  if (!DATE_FORMAT_PATTERN.test(rawContents)) {
    logger.warning('State', `State file contents were unexpected ("${rawContents}"). Treating today as not yet completed.`);
    return null;
  }

  return rawContents;
}

function hasCompletedToday() {
  return readLastSuccessfulRunDate() === getTodayDateString();
}

function markTodayAsCompleted() {
  const { stateFilePath } = getConfig().paths;
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  fs.writeFileSync(stateFilePath, getTodayDateString());
  logger.success('State', `Marked ${getTodayDateString()} as completed.`);
}

module.exports = {
  hasCompletedToday,
  markTodayAsCompleted,
  readLastSuccessfulRunDate,
  getTodayDateString,
};
