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
