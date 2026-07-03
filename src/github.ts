// Octokit client construction and the read only GitHub query seam.
//
// Two clients are built: one from the calling repository's GITHUB_TOKEN for
// reading pull request context and setting checks and comments, and one from the
// store token for reading and appending the JSON data files in decibri/decibri-cla. The
// store write itself is wired with the enforcement flow; this module provides the
// clients and the read only identity queries the coverage decision depends on.
//
// This module is the boundary where live GitHub access lives. Nothing here checks
// out or executes untrusted pull request code, and token values are never logged.

import { getOctokit } from '@actions/github';
import type { PullRequestGateway, PullRequestInfo } from './gateways';
import type { GitHubIdentityQueries } from './types';

export type Octokit = ReturnType<typeof getOctokit>;

/** Build the client for the calling repository from its GITHUB_TOKEN. */
export function createLocalClient(githubToken: string): Octokit {
  if (!githubToken) {
    throw new Error('A github-token is required for the calling repository.');
  }
  return getOctokit(githubToken);
}

/** Build the client for the signature store (decibri/decibri-cla) from the store token. */
export function createStoreClient(storeToken: string): Octokit {
  if (!storeToken) {
    throw new Error(
      'The store-token input is missing. Set the CLA_STORE_TOKEN secret with Contents read and write on decibri/decibri-cla.',
    );
  }
  return getOctokit(storeToken);
}

/**
 * The Octokit backed implementation of the identity queries used by coverage.
 * Each method is read only and degrades to a safe negative (not a throw) when the
 * information is not available, so a missing membership or email is treated as no
 * match rather than an error.
 */
export function createIdentityQueries(client: Octokit): GitHubIdentityQueries {
  return {
    async isOrgMember(org: string, login: string): Promise<boolean> {
      try {
        const response = await client.rest.orgs.checkMembershipForUser({
          org,
          username: login,
        });
        // A 204 means the user is a member. Octokit types this endpoint's status
        // as its 302 (requester not a member) response, so widen before comparing.
        return (response.status as number) === 204;
      } catch {
        return false;
      }
    },

    async isPublicOrgMember(org: string, login: string): Promise<boolean> {
      try {
        const response = await client.rest.orgs.checkPublicMembershipForUser({
          org,
          username: login,
        });
        return response.status === 204;
      } catch {
        return false;
      }
    },

    async getPublicEmail(login: string): Promise<string | null> {
      try {
        const response = await client.rest.users.getByUsername({ username: login });
        return response.data.email ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Build the pull request gateway for the calling repository. */
export function createPullRequestGateway(
  client: Octokit,
  owner: string,
  repo: string,
): PullRequestGateway {
  return {
    async getPullRequest(prNumber: number): Promise<PullRequestInfo> {
      const { data } = await client.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      return {
        number: data.number,
        headSha: data.head.sha,
        author: { githubId: data.user?.id ?? 0, login: data.user?.login ?? '' },
        state: data.state === 'closed' ? 'closed' : 'open',
        merged: data.merged === true,
      };
    },

    async listOpenPullRequests(): Promise<PullRequestInfo[]> {
      const pulls = await client.paginate(client.rest.pulls.list, {
        owner,
        repo,
        state: 'open',
        per_page: 100,
      });
      return pulls.map((pull) => ({
        number: pull.number,
        headSha: pull.head.sha,
        author: { githubId: pull.user?.id ?? 0, login: pull.user?.login ?? '' },
        state: 'open' as const,
        merged: false,
      }));
    },

    async lockPullRequest(prNumber: number): Promise<void> {
      await client.rest.issues.lock({
        owner,
        repo,
        issue_number: prNumber,
        lock_reason: 'resolved',
      });
    },
  };
}
