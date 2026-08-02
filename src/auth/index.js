'use strict';

/**
 * Authentication
 * ---------------
 * StreakKeeper authenticates to GitHub with a fine-grained personal access
 * token scoped to a single repository. It never sees your GitHub password.
 *
 * This replaced an interactive browser login that exported Playwright's
 * cookie "storage state" to disk. That approach had an appealing property —
 * no credential was ever stored — but three costs that mattered more for a
 * service meant to run untouched for months: the session expired on
 * GitHub's schedule and needed a human at a keyboard to restore it, the
 * saved cookie jar was itself a full-account credential sitting on disk,
 * and verifying it meant launching a browser. A fine-grained token is
 * narrower than the session it replaced: one repository, one permission.
 *
 * This module is deliberately the *only* place that knows how to check
 * whether authentication works — the engine just assumes a usable token
 * and lets this module worry about whether that's true.
 */

const { getConfig } = require('../config');
const logger = require('../utils/logger');
const { getAuthenticatedUser, repositoryExists, AuthenticationError } = require('../engine/githubApi');

/**
 * Confirms the token works *and* reaches the configured repository.
 *
 * Both halves matter: a token can be perfectly valid and still be useless
 * here if it wasn't granted access to this particular repository, and
 * that distinction is worth catching at startup rather than discovering
 * it during the first contribution attempt.
 *
 * @returns {Promise<boolean>} true if StreakKeeper can do its job
 */
async function verifyGitHubAccess() {
  const { repositoryUrl } = getConfig().github;

  try {
    const login = await getAuthenticatedUser();
    logger.info('Auth', `Token is valid (authenticated as ${login}).`);

    if (!(await repositoryExists(repositoryUrl))) {
      logger.error('Auth', `Token is valid but cannot see ${repositoryUrl}. Grant it access to that repository.`);
      return false;
    }

    logger.info('Auth', `Repository access confirmed for ${repositoryUrl}.`);
    return true;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      logger.error('Auth', error.message);
      return false;
    }

    // A network problem isn't an auth problem. Say so plainly rather than
    // sending the user off to regenerate a token that was never broken.
    logger.error('Auth', `Could not verify GitHub access: ${error.message}`);
    return false;
  }
}

function printTokenSetupInstructions() {
  const { repositoryUrl } = getConfig().github;

  console.log(`
Creating a token for StreakKeeper
─────────────────────────────────
  1. Open https://github.com/settings/personal-access-tokens/new
  2. Token name:        streakkeeper
  3. Expiration:        choose the longest period you're comfortable with.
                        StreakKeeper will tell you over Telegram when it stops working.
  4. Repository access: "Only select repositories" → ${repositoryUrl}
  5. Permissions:       Repository permissions → Contents → "Read and write"
                        (that is the only permission needed)
  6. Generate the token and copy it.
  7. Put it in your .env file as:  GITHUB_TOKEN=github_pat_...

Then confirm it works with:  node manage.js check-auth
`);
}

module.exports = { verifyGitHubAccess, printTokenSetupInstructions };
