'use strict';

/**
 * Reusable Retry Engine
 * ----------------------
 * Any subsystem can wrap a failure-prone async operation in runWithRetry.
 * It knows nothing about GitHub, Telegram, or anything domain-specific —
 * that's what makes it safe to reuse for future StreakKeeper modules.
 *
 * Strategy: exponential backoff with jitter.
 *   - Exponential backoff: each retry waits longer than the last
 *     (base, base×2, base×4, ...) so a struggling service gets progressively
 *     more room to recover instead of being hammered at a constant rate.
 *   - Jitter: a random amount is added on top of that delay. Without it,
 *     many clients that failed at the same moment (e.g. after a shared
 *     network blip) would all retry at exactly the same moment too —
 *     synchronized retries can re-overwhelm a service right as it recovers.
 *     A random offset spreads them out.
 *
 * Non-retryable errors: if a caller throws an error with `.retryable = false`
 * set on it (see src/engine/githubApi.js's AuthenticationError), this
 * engine stops immediately instead of burning through attempts — some
 * failures, like a rejected token, can't be fixed by trying again.
 */

const logger = require('./logger');

async function runWithRetry(operation, { maxAttempts, baseDelayMilliseconds, subsystem }) {
  let lastError;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (error.retryable === false) {
        logger.error(subsystem, `Non-retryable error: ${error.message}. Stopping immediately.`);
        throw error;
      }

      const isLastAttempt = attemptNumber === maxAttempts;
      if (isLastAttempt) {
        logger.error(subsystem, `Attempt ${attemptNumber}/${maxAttempts} failed: ${error.message}. No attempts remaining.`);
        break;
      }

      const delayMilliseconds = calculateBackoffDelay(attemptNumber, baseDelayMilliseconds);
      logger.warning(
        subsystem,
        `Attempt ${attemptNumber}/${maxAttempts} failed: ${error.message}. Retrying in ${Math.round(delayMilliseconds / 1000)}s.`
      );
      await sleep(delayMilliseconds);
    }
  }

  throw lastError;
}

function calculateBackoffDelay(attemptNumber, baseDelayMilliseconds) {
  const exponentialDelay = baseDelayMilliseconds * 2 ** (attemptNumber - 1);
  const jitter = Math.floor(Math.random() * baseDelayMilliseconds);
  return exponentialDelay + jitter;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = { runWithRetry };
