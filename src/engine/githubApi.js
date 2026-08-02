'use strict';

/**
 * GitHub REST client
 * -------------------
 * A thin wrapper over the two Contents API calls StreakKeeper needs:
 * read a file, and write a file. It deliberately knows nothing about
 * streaks, schedules, or state — it speaks HTTP to GitHub and translates
 * GitHub's responses into errors the rest of the app can reason about.
 *
 * The important translation work is classifying failures as retryable or
 * not, because that single flag is what the retry engine keys off:
 *
 *   401, or 403 without a rate-limit signal  → bad/expired token. Retrying
 *                                              cannot help. Non-retryable,
 *                                              and the user must act.
 *   403/429 with a rate-limit signal         → we're being throttled.
 *                                              Backing off is exactly right.
 *   404                                      → could be a missing file (normal,
 *                                              we create it) or a missing repo
 *                                              (configuration is wrong). The
 *                                              caller disambiguates via
 *                                              repositoryExists().
 *   409                                      → the file changed under us.
 *                                              Retrying re-reads the new sha.
 *   5xx and network failures                 → GitHub or the network is
 *                                              having a moment. Retryable.
 *   Anything else 4xx                        → we sent something wrong.
 *                                              Retrying would just repeat it.
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');
const { parseOwnerAndRepoFromUrl } = require('./githubUrls');

const GITHUB_API_ORIGIN = 'https://api.github.com';
const REQUEST_TIMEOUT_MILLISECONDS = 20000;

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
    this.retryable = false; // a bad token stays bad no matter how often we ask
  }
}

class GitHubApiError extends Error {
  constructor(message, { retryable }) {
    super(message);
    this.name = 'GitHubApiError';
    this.retryable = retryable;
  }
}

/**
 * A 404 on the contents endpoint. Not necessarily a problem — a missing
 * streak log file is something we can fix by creating it.
 */
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.retryable = false;
  }
}

function buildRequestHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'StreakKeeper',
  };
}

async function requestGitHub(pathname, { method = 'GET', body } = {}) {
  const { token } = getConfig().github;
  const url = `${GITHUB_API_ORIGIN}${pathname}`;

  logger.debug('GitHub API', `${method} ${pathname}`);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...buildRequestHeaders(token),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch (error) {
    // DNS failures, connection resets, timeouts — all transient by nature.
    throw new GitHubApiError(`Could not reach GitHub: ${error.message}`, { retryable: true });
  }

  if (response.ok) {
    return response.status === 204 ? null : response.json();
  }

  throw await buildErrorForResponse(response, pathname);
}

async function buildErrorForResponse(response, pathname) {
  const details = await readErrorMessage(response);
  const { status } = response;

  if (status === 401) {
    return new AuthenticationError(`GitHub rejected the token (401): ${details}`);
  }

  if (status === 403 || status === 429) {
    if (isRateLimited(response)) {
      return new GitHubApiError(`GitHub is rate limiting us (${status}): ${details}`, { retryable: true });
    }
    // A 403 that isn't throttling means the token lacks permission for this
    // repository — a scope or repository-access problem the user must fix.
    return new AuthenticationError(
      `GitHub denied access (403): ${details}. Check that the token grants "Contents: Read and write" on this repository.`
    );
  }

  if (status === 404) {
    return new NotFoundError(`GitHub returned 404 for ${pathname}: ${details}`);
  }

  if (status === 409) {
    return new GitHubApiError(`The file changed while we were writing it (409): ${details}`, { retryable: true });
  }

  if (status >= 500) {
    return new GitHubApiError(`GitHub server error (${status}): ${details}`, { retryable: true });
  }

  return new GitHubApiError(`GitHub rejected the request (${status}): ${details}`, { retryable: false });
}

function isRateLimited(response) {
  return response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after');
}

async function readErrorMessage(response) {
  try {
    const parsedBody = await response.json();
    return parsedBody.message || JSON.stringify(parsedBody);
  } catch {
    return response.statusText || 'no further detail provided';
  }
}

// ---------------------------------------------------------------------------
// The operations StreakKeeper actually performs
// ---------------------------------------------------------------------------

function buildContentsPath(repositoryUrl, filePath) {
  const { owner, repo } = parseOwnerAndRepoFromUrl(repositoryUrl);
  // Each path segment is encoded separately so that slashes in a nested
  // file path ("logs/streak.md") survive, but spaces and other characters
  // within a segment are escaped.
  const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/');
  return `/repos/${owner}/${repo}/contents/${encodedFilePath}`;
}

/**
 * @returns {Promise<{content: string, sha: string} | null>} the decoded file
 *   and its blob sha, or null if the file does not exist yet
 */
async function getFile(repositoryUrl, branchName, filePath) {
  const pathname = `${buildContentsPath(repositoryUrl, filePath)}?ref=${encodeURIComponent(branchName)}`;

  try {
    const payload = await requestGitHub(pathname);
    return {
      content: Buffer.from(payload.content, 'base64').toString('utf8'),
      sha: payload.sha,
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return null;
    }
    throw error;
  }
}

/**
 * Creates or updates the file in a single commit.
 *
 * @param {object} options
 * @param {string|undefined} options.sha the blob sha being replaced; omit to create
 * @param {object|undefined} options.commitIdentity {name, email, date} or undefined
 * @returns {Promise<string>} the sha of the resulting commit
 */
async function putFile(repositoryUrl, branchName, filePath, { content, sha, commitMessage, commitIdentity }) {
  const payload = {
    message: commitMessage,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: branchName,
  };

  if (sha) {
    payload.sha = sha;
  }

  // Supplying an identity is optional. When it's absent GitHub attributes
  // the commit to the token's owner with a UTC timestamp, which is both
  // correct and guaranteed to count toward the contribution graph.
  if (commitIdentity) {
    payload.author = commitIdentity;
    payload.committer = commitIdentity;
  }

  const result = await requestGitHub(buildContentsPath(repositoryUrl, filePath), {
    method: 'PUT',
    body: payload,
  });

  return result.commit.sha;
}

/**
 * @returns {Promise<boolean>} whether the token can see the repository at all.
 *   Used to tell "the file doesn't exist" apart from "the repo doesn't exist
 *   or the token can't see it", which GitHub reports identically as a 404.
 */
async function repositoryExists(repositoryUrl) {
  const { owner, repo } = parseOwnerAndRepoFromUrl(repositoryUrl);

  try {
    await requestGitHub(`/repos/${owner}/${repo}`);
    return true;
  } catch (error) {
    if (error instanceof NotFoundError) {
      return false;
    }
    throw error;
  }
}

/**
 * @returns {Promise<string>} the login of the account the token belongs to
 */
async function getAuthenticatedUser() {
  const payload = await requestGitHub('/user');
  return payload.login;
}

module.exports = {
  getFile,
  putFile,
  repositoryExists,
  getAuthenticatedUser,
  AuthenticationError,
  GitHubApiError,
  NotFoundError,
};
