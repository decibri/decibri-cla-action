// The CLA check run: mapping a coverage decision to a check, and the Octokit
// backed gateway that sets it on the pull request head SHA.

import type { CoverageDecision } from './coverage';
import type { CheckConclusion, CheckGateway } from './gateways';
import type { Octokit } from './github';

export function checkConclusion(decision: CoverageDecision): CheckConclusion {
  return decision.covered ? 'success' : 'failure';
}

export function checkTitle(decision: CoverageDecision): string {
  return decision.covered ? 'CLA satisfied' : 'CLA signature required';
}

export function checkSummary(decision: CoverageDecision, assentPhrase: string): string {
  if (decision.covered) {
    return decision.detail;
  }
  return [
    decision.detail,
    '',
    'To sign, comment the following on this pull request, exactly, from your own account:',
    '',
    `> ${assentPhrase}`,
  ].join('\n');
}

/**
 * Check text for a decibri owned repository that is not in allowedRepos. The
 * conclusion is always a failure so an unconfigured repository resolves its
 * required check visibly and can never merge on a green check.
 */
export const NOT_ALLOWLISTED_CHECK_TITLE = 'CLA enforcement not configured for this repository';

export function notAllowlistedCheckSummary(repoFullName: string): string {
  return [
    `${repoFullName} is not in the CLA allowlist. The CLA action was invoked here, but it is not ` +
      'configured to enforce the CLA for this repository, so it cannot evaluate coverage. This check ' +
      'fails closed so that an unconfigured repository cannot merge on a green check.',
    '',
    'To enable CLA enforcement, a maintainer must add this repository to `allowedRepos` in ' +
      '`config/cla.config.json` in decibri/decibri-cla-action and move the `v1` tag for the change ' +
      'to take effect. If CLA enforcement is not intended here, remove the CLA workflow and the ' +
      'required check from this repository instead.',
  ].join('\n');
}

/** Build the Octokit backed check gateway for the calling repository. */
export function createCheckGateway(client: Octokit, owner: string, repo: string): CheckGateway {
  return {
    async setCheck(params) {
      await client.rest.checks.create({
        owner,
        repo,
        name: params.name,
        head_sha: params.headSha,
        status: 'completed',
        conclusion: params.conclusion,
        output: {
          title: params.title,
          summary: params.summary,
        },
      });
    },
  };
}
