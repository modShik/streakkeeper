'use strict';

/**
 * Small, pure helper functions for interpreting GitHub URLs.
 * Split out of engine/index.js because they have no dependency on the
 * network or configuration — they're just string parsing, and keeping
 * them separate makes them trivial to unit test on their own.
 */

function parseOwnerAndRepoFromUrl(repositoryUrl) {
  const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/);
  if (!match) {
    throw new Error(`Could not parse an owner/repo pair out of "${repositoryUrl}". Expected something like https://github.com/owner/repo`);
  }
  return { owner: match[1], repo: match[2] };
}

function buildFileUrl(repositoryUrl, branchName, filePath) {
  const { owner, repo } = parseOwnerAndRepoFromUrl(repositoryUrl);
  return `https://github.com/${owner}/${repo}/blob/${branchName}/${filePath}`;
}

module.exports = { parseOwnerAndRepoFromUrl, buildFileUrl };
