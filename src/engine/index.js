'use strict';

/**
 * GitHub Engine
 * --------------
 * One responsibility: maintain today's contribution. It doesn't know when
 * it was scheduled, how Telegram works, or where configuration comes from —
 * it reads the streak log file, appends today's entry, commits, and
 * reports success or failure.
 *
 * ── WHY THIS TALKS TO AN API AND NOT A BROWSER ──
 * This engine used to drive GitHub's web editor with Playwright: launch
 * Chromium, restore a cookie session, click into a CodeMirror instance,
 * type, and click Commit. It never once succeeded. Every run in logs/
 * timed out waiting for a '.cm-content' element, because the selectors
 * were guesses against a JavaScript-heavy UI that GitHub reshapes without
 * notice.
 *
 * The Contents API does the same job in two HTTP calls. There is no
 * browser to launch, no DOM to guess at, no cookie session to expire, and
 * nothing that changes shape when GitHub ships a redesign. For a service
 * whose entire purpose is running unattended for months, that trade —
 * storing a scoped token instead of a cookie jar — buys an enormous
 * amount of reliability.
 *
 * ── ON NOT COMMITTING TWICE ──
 * The scheduler already avoids duplicate work by consulting the state
 * file, but state files can be deleted, corrupted, or restored from a
 * backup. So this engine independently verifies: it reads the file first,
 * and if today's entry is already in there, it reports success without
 * committing. Two layers of defense, and the second one reads the truth
 * straight from GitHub rather than from local state.
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');
const { runWithRetry } = require('../utils/retry');
const { getDateString, getUtcOffset } = require('../utils/dates');
const { getFile, putFile, repositoryExists, AuthenticationError, GitHubApiError } = require('./githubApi');

const NEW_FILE_HEADER = '# Streak Log\n\nMaintained automatically by StreakKeeper.\n';

async function performDailyContribution() {
  const config = getConfig();

  return runWithRetry(() => attemptContribution(config), {
    maxAttempts: config.retry.maxAttempts,
    baseDelayMilliseconds: config.retry.baseDelayMilliseconds,
    subsystem: 'GitHub Engine',
  });
}

async function attemptContribution(config) {
  const { repositoryUrl, branchName, streakLogFilePath, timeZone } = config.github;

  const todayDateString = getDateString(timeZone);
  const entryLine = `- ${todayDateString}: automated streak entry`;

  const existingFile = await getFile(repositoryUrl, branchName, streakLogFilePath);

  if (existingFile && containsEntryForDate(existingFile.content, todayDateString)) {
    logger.info('GitHub Engine', `${streakLogFilePath} already contains an entry for ${todayDateString}. Nothing to commit.`);
    return { committed: false, date: todayDateString };
  }

  const updatedContent = existingFile
    ? appendLine(existingFile.content, entryLine)
    : `${NEW_FILE_HEADER}\n${entryLine}\n`;

  if (!existingFile) {
    await failClearlyIfRepositoryIsUnreachable(repositoryUrl, branchName, streakLogFilePath);
    logger.info('GitHub Engine', `${streakLogFilePath} does not exist yet — creating it.`);
  }

  const commitSha = await putFile(repositoryUrl, branchName, streakLogFilePath, {
    content: updatedContent,
    sha: existingFile ? existingFile.sha : undefined,
    commitMessage: `streakkeeper by github/modshik — ${todayDateString}`,
    commitIdentity: buildCommitIdentity(config),
  });

  logger.success('GitHub Engine', `Contribution committed successfully (${commitSha.slice(0, 7)}).`);
  return { committed: true, date: todayDateString };
}

/**
 * A missing file and a missing repository both surface as a 404, so when
 * the file isn't there we check the repository before assuming it's safe
 * to create one. Getting this wrong would mean silently doing nothing
 * useful for months while reporting success.
 */
async function failClearlyIfRepositoryIsUnreachable(repositoryUrl, branchName, streakLogFilePath) {
  if (await repositoryExists(repositoryUrl)) {
    return;
  }

  throw new GitHubApiError(
    `The repository ${repositoryUrl} could not be found, or the token cannot see it. ` +
      `Verify GITHUB_REPOSITORY_URL, that branch "${branchName}" exists, and that the token grants access ` +
      `to this repository (it would create ${streakLogFilePath} there).`,
    { retryable: false }
  );
}

/**
 * Matches any line already recording today, regardless of the text after
 * the date — so a manually added entry counts too, and a change to the
 * wording of entryLine never causes a duplicate commit for the same day.
 */
function containsEntryForDate(fileContent, dateString) {
  return fileContent
    .split('\n')
    .some((line) => line.trimStart().startsWith(`- ${dateString}`));
}

function appendLine(fileContent, line) {
  const needsSeparatingNewline = fileContent.length > 0 && !fileContent.endsWith('\n');
  return `${fileContent}${needsSeparatingNewline ? '\n' : ''}${line}\n`;
}

/**
 * Returns undefined unless the user has explicitly configured a commit
 * identity. Undefined is the safe default: GitHub then attributes the
 * commit to the token's owner, which always counts toward the
 * contribution graph. A wrong or unverified email would produce commits
 * that look fine in the repository but count for nothing.
 */
function buildCommitIdentity(config) {
  const { commitAuthorName, commitAuthorEmail, timeZone } = config.github;

  if (!commitAuthorName || !commitAuthorEmail) {
    return undefined;
  }

  return {
    name: commitAuthorName,
    email: commitAuthorEmail,
    date: buildTimestampWithOffset(timeZone),
  };
}

/**
 * An ISO-8601 timestamp carrying the configured zone's offset, e.g.
 * "2026-08-02T23:40:00+05:30". The offset is what tells GitHub which
 * calendar day to file the contribution under, which is why it has to
 * match the zone the state file uses.
 */
function buildTimestampWithOffset(timeZone) {
  const now = new Date();
  const offset = getUtcOffset(timeZone, now);
  const localWallClock = new Date(now.getTime() + parseOffsetToMilliseconds(offset));
  return `${localWallClock.toISOString().slice(0, 19)}${offset}`;
}

function parseOffsetToMilliseconds(offset) {
  const [, sign, hours, minutes] = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  const magnitude = (Number(hours) * 60 + Number(minutes)) * 60 * 1000;
  return sign === '-' ? -magnitude : magnitude;
}

module.exports = { performDailyContribution, AuthenticationError };
