'use strict';

/**
 * Centralized Logger
 * -------------------
 * Every message in StreakKeeper goes through here instead of a raw
 * console.log — that's what makes the log format consistent everywhere,
 * and it's what lets us later add new outputs (e.g. shipping logs
 * somewhere external) without touching a single line of application code.
 *
 * Log files rotate automatically because the filename is derived from
 * today's date (logs/2026-07-15.log). There's nothing to clean up and
 * nothing to configure — tomorrow's log simply goes in tomorrow's file.
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config');

const LEVEL_COLUMN_WIDTH = 7; // "SUCCESS" is the longest level name
const SUBSYSTEM_COLUMN_WIDTH = 10;

function formatTimestamp(date) {
  return date.toTimeString().slice(0, 8); // HH:MM:SS
}

function formatDateForFilename(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function writeLogLine(level, subsystem, message) {
  const now = new Date();
  const line = `[${formatTimestamp(now)}] ${level.padEnd(LEVEL_COLUMN_WIDTH)} ${subsystem.padEnd(SUBSYSTEM_COLUMN_WIDTH)} ${message}`;

  console.log(line);

  const { logDirectory } = getConfig().paths;
  fs.mkdirSync(logDirectory, { recursive: true });
  const logFilePath = path.join(logDirectory, `${formatDateForFilename(now)}.log`);
  fs.appendFileSync(logFilePath, `${line}\n`);
}

module.exports = {
  info: (subsystem, message) => writeLogLine('INFO', subsystem, message),
  success: (subsystem, message) => writeLogLine('SUCCESS', subsystem, message),
  warning: (subsystem, message) => writeLogLine('WARNING', subsystem, message),
  error: (subsystem, message) => writeLogLine('ERROR', subsystem, message),

  // Debug-level messages only print when DEBUG=true — selector attempts,
  // navigation timing, retry internals. Normal users should never see this.
  debug: (subsystem, message) => {
    if (getConfig().debug) {
      writeLogLine('DEBUG', subsystem, message);
    }
  },
};
