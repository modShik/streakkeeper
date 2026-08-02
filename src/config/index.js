'use strict';

/**
 * Centralized Configuration Module
 * ---------------------------------
 * Every other module in StreakKeeper reads its configuration through this
 * file. Nothing outside src/config should ever touch `process.env`
 * directly — that keeps parsing, defaults, and validation in one place
 * instead of scattered across the codebase.
 *
 * Design decision: fail fast.
 * All configuration is validated once, at startup, before any subsystem
 * (logger, scheduler, GitHub engine, etc.) begins doing real work. If
 * something is missing or malformed, we want the application to refuse
 * to start with a clear explanation — not fail two hours later, at 3am,
 * halfway through a browser automation run.
 */

const path = require('path');
const dotenv = require('dotenv');
const { isValidTimeZone } = require('../utils/dates');

dotenv.config();

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// ---------------------------------------------------------------------------
// Type-safe environment variable readers
// ---------------------------------------------------------------------------
// Each reader pulls one value out of process.env and validates its shape.
// Rather than throwing on the first problem it finds, each reader pushes a
// human-readable message onto a shared `validationErrors` list. That lets
// loadConfiguration() report every problem at once — much friendlier than
// making a user fix one typo, rerun, find the next typo, rerun again.

function readRequiredString(variableName, validationErrors) {
  const rawValue = process.env[variableName];
  if (!rawValue || rawValue.trim().length === 0) {
    validationErrors.push(`${variableName} is required but was not set.`);
    return undefined;
  }
  return rawValue.trim();
}

function readOptionalString(variableName, defaultValue) {
  const rawValue = process.env[variableName];
  return rawValue && rawValue.trim().length > 0 ? rawValue.trim() : defaultValue;
}

function readBoolean(variableName, defaultValue, validationErrors) {
  const rawValue = process.env[variableName];
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === 'true') return true;
  if (normalizedValue === 'false') return false;

  validationErrors.push(`${variableName} must be "true" or "false", but got "${rawValue}".`);
  return defaultValue;
}

function readPositiveInteger(variableName, defaultValue, validationErrors) {
  const rawValue = process.env[variableName];
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    validationErrors.push(`${variableName} must be a positive whole number, but got "${rawValue}".`);
    return defaultValue;
  }

  return parsedValue;
}

function readTimeZone(variableName, defaultValue, validationErrors) {
  const rawValue = readOptionalString(variableName, defaultValue);

  if (!isValidTimeZone(rawValue)) {
    validationErrors.push(
      `${variableName} must be an IANA time zone name such as "UTC" or "Asia/Kolkata", but got "${rawValue}".`
    );
    return defaultValue;
  }

  return rawValue;
}

/**
 * Telegram is entirely optional.
 *
 * Requiring it would mean every new user has to talk to BotFather and hunt
 * down a numeric chat ID before the thing they actually came for — an
 * automated commit — works at all. So StreakKeeper runs happily with no
 * notifications; you just don't get told when something breaks.
 *
 * What *isn't* allowed is half-configured, because that reads as "I want
 * notifications" while silently delivering none.
 */
function readTelegramConfiguration(validationErrors) {
  const botToken = readOptionalString('TELEGRAM_BOT_TOKEN', undefined);
  const chatId = readOptionalString('TELEGRAM_CHAT_ID', undefined);

  if (!botToken && !chatId) {
    return { enabled: false, botToken: undefined, chatId: undefined };
  }

  if (!botToken || !chatId) {
    const missingVariable = botToken ? 'TELEGRAM_CHAT_ID' : 'TELEGRAM_BOT_TOKEN';
    validationErrors.push(
      `${missingVariable} is missing. Telegram needs both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, ` +
        `or neither (leave both blank to run without notifications).`
    );
  }

  validateTelegramChatId(chatId, validationErrors);

  return { enabled: true, botToken, chatId };
}

/**
 * Chat IDs must be numeric here — "123456789" for a person, negative for a
 * group or channel.
 *
 * Telegram does accept an "@name" for *public channels*, and an earlier
 * version of this allowed it. That was a mistake: pointing "@name" at a
 * personal account fails with "chat not found" on every single send,
 * forever, while every other part of the setup looks perfectly healthy.
 * It cost the author two weeks of silently unreported failures. Public
 * channels have numeric IDs too, so requiring one loses no capability and
 * removes the trap entirely.
 */
function validateTelegramChatId(chatId, validationErrors) {
  if (!chatId || /^-?\d+$/.test(chatId)) {
    return;
  }

  const looksLikeUsername = chatId.startsWith('@');

  validationErrors.push(
    `TELEGRAM_CHAT_ID must be a number (e.g. 123456789), but got "${chatId}".` +
      (looksLikeUsername
        ? ' An @username is not a chat ID — Telegram accepts that form only for public channels, and it fails' +
          ' with "chat not found" for personal accounts.'
        : '') +
      ' Message your bot, then run `node manage.js telegram-id` to find the right number.'
  );
}

// ---------------------------------------------------------------------------
// Configuration assembly
// ---------------------------------------------------------------------------

function loadConfiguration() {
  const validationErrors = [];

  const config = {
    github: {
      token: readRequiredString('GITHUB_TOKEN', validationErrors),
      repositoryUrl: readRequiredString('GITHUB_REPOSITORY_URL', validationErrors),
      branchName: readOptionalString('GITHUB_BRANCH_NAME', 'main'),
      streakLogFilePath: readOptionalString('STREAK_LOG_FILE_PATH', 'streak-log.md'),
      timeZone: readTimeZone('TIMEZONE', 'UTC', validationErrors),
      commitAuthorName: readOptionalString('GITHUB_COMMIT_AUTHOR_NAME', undefined),
      commitAuthorEmail: readOptionalString('GITHUB_COMMIT_AUTHOR_EMAIL', undefined),
    },

    telegram: readTelegramConfiguration(validationErrors),

    paths: {
      logDirectory: path.resolve(readOptionalString('LOG_DIRECTORY', 'logs')),
      stateFilePath: path.resolve(readOptionalString('STATE_FILE_PATH', 'data/state.json')),
    },

    retry: {
      maxAttempts: readPositiveInteger('RETRY_MAX_ATTEMPTS', 5, validationErrors),
      baseDelayMilliseconds: readPositiveInteger('RETRY_BASE_DELAY_MS', 30000, validationErrors),
    },

    // Cross-cutting flags — not owned by any one subsystem, so they live
    // at the top level rather than nested under a category.
    dryRun: readBoolean('DRY_RUN', false, validationErrors),
    debug: readBoolean('DEBUG', false, validationErrors),
  };

  validateTimeZoneAndCommitIdentityAgree(config, validationErrors);

  if (validationErrors.length > 0) {
    const formattedErrors = validationErrors.map((error) => `  - ${error}`).join('\n');
    throw new ConfigurationError(
      `StreakKeeper cannot start because of the following configuration problems:\n${formattedErrors}\n\n` +
        'Fix these values in your .env file (see .env.example for reference) and try again.'
    );
  }

  // Freeze so that no module can accidentally mutate shared configuration
  // at runtime — configuration is read-only data, not shared mutable state.
  return Object.freeze(config);
}

/**
 * Guards against a subtle, expensive mistake.
 *
 * StreakKeeper decides whether today is done using TIMEZONE. GitHub files
 * a commit onto the contribution graph using the commit's own timestamp,
 * which is UTC unless we stamp it ourselves — and we can only stamp it if
 * a commit identity is configured. So a non-UTC TIMEZONE without an
 * identity means the two disagree near midnight: StreakKeeper believes
 * the day is covered while the graph records it on the day before. That
 * shows up as a broken streak, weeks later, with nothing in the logs
 * looking wrong.
 */
function validateTimeZoneAndCommitIdentityAgree(config, validationErrors) {
  const { timeZone, commitAuthorName, commitAuthorEmail } = config.github;
  const hasCommitIdentity = Boolean(commitAuthorName && commitAuthorEmail);

  if (timeZone !== 'UTC' && !hasCommitIdentity) {
    validationErrors.push(
      `TIMEZONE is set to "${timeZone}", which requires GITHUB_COMMIT_AUTHOR_NAME and ` +
        `GITHUB_COMMIT_AUTHOR_EMAIL to also be set, so commits carry that zone's offset and land on ` +
        `the same day StreakKeeper thinks they did. The email must be one verified on your GitHub ` +
        `account, or the commits will not count as contributions. Leave TIMEZONE unset to use UTC instead.`
    );
  }

  if (hasCommitIdentity && !commitAuthorEmail.includes('@')) {
    validationErrors.push(`GITHUB_COMMIT_AUTHOR_EMAIL does not look like an email address ("${commitAuthorEmail}").`);
  }
}

let cachedConfig;

/**
 * Returns StreakKeeper's validated configuration.
 *
 * Configuration is loaded and validated once, on first call, then cached
 * for the lifetime of the process. Every subsequent call returns the same
 * frozen object rather than re-reading and re-validating process.env.
 *
 * @returns {Readonly<object>} the validated configuration object
 * @throws {ConfigurationError} if required values are missing or invalid
 */
function getConfig() {
  if (!cachedConfig) {
    cachedConfig = loadConfiguration();
  }
  return cachedConfig;
}

module.exports = { getConfig, ConfigurationError };
