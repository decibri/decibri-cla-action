// Mocked dry-run demonstration.
//
// This wires the orchestrator to in memory fakes (no network, no GitHub) and runs
// the coverage decision in dry-run mode for a few contributor scenarios, printing
// what the Action would decide and confirming it performs no writes. It is a local
// demonstration of the dry-run contract, not part of the shipped Action.
//
// Run with: npm run dry-run-demo

import { runCla, type RunContext, type RunDeps } from '../src/run';
import type { ClaConfig } from '../src/config';
import type { CompaniesFile } from '../src/companies';
import type { SignaturesFile } from '../src/signatures';
import type { GitHubIdentityQueries } from '../src/types';

const ACTIVE_ICLA_HASH = 'sha256:democurrent';

const config: ClaConfig = {
  icla: { file: 'agreements/Individual-CLA-v1.md', versionLabel: 'icla-v1', versionHash: ACTIVE_ICLA_HASH },
  ccla: { file: 'agreements/Corporate-CLA-v1.md', versionLabel: 'ccla-v1', versionHash: 'sha256:demo-ccla' },
  assentPhraseIcla: 'I have read the decibri Individual Contributor License Agreement and I hereby sign it.',
  checkName: 'CLA',
  orgMembersBypass: true,
  lockPrOnMerge: true,
  botAndAppBypass: [],
  // Bare repository name under the decibri org, matching the config format
  // (isRepoAllowed rejects entries containing a slash).
  allowedRepos: ['decibri'],
};

interface Writes {
  checks: number;
  comments: number;
  deletes: number;
  appends: number;
  locks: number;
}

function makeDeps(
  context: RunContext,
  data: { signatures: SignaturesFile; companies: CompaniesFile; queries: GitHubIdentityQueries },
): { deps: RunDeps; writes: Writes; logs: string[] } {
  const writes: Writes = { checks: 0, comments: 0, deletes: 0, appends: 0, locks: 0 };
  const logs: string[] = [];
  const deps: RunDeps = {
    context,
    config,
    dryRun: true,
    checks: {
      async setCheck() {
        writes.checks += 1;
      },
    },
    comments: {
      async listComments() {
        return [];
      },
      async createComment() {
        writes.comments += 1;
      },
      async deleteComment() {
        writes.deletes += 1;
      },
    },
    pulls: {
      async getPullRequest(prNumber) {
        return { number: prNumber, headSha: 'demo-sha', author: { githubId: 500, login: 'ext-dev' }, state: 'open', merged: false };
      },
      async listOpenPullRequests() {
        return [];
      },
      async lockPullRequest() {
        writes.locks += 1;
      },
    },
    signatureStore: {
      async read() {
        return data.signatures;
      },
      async append() {
        writes.appends += 1;
      },
    },
    companyStore: {
      async read() {
        return data.companies;
      },
    },
    queries: data.queries,
    log: {
      info: (message) => logs.push(message),
      warning: (message) => logs.push(message),
      notice: (message) => logs.push(message),
    },
    now: () => '2026-07-01T12:00:00Z',
  };
  return { deps, writes, logs };
}

function prOpened(login: string, githubId: number): RunContext {
  return {
    eventName: 'pull_request_target',
    action: 'opened',
    owner: 'decibri',
    repo: 'decibri',
    pullRequest: { number: 7, head: { sha: 'demo-sha' }, user: { id: githubId, login } },
  };
}

const emptySignatures: SignaturesFile = { schemaVersion: 1, signatures: [] };
const emptyCompanies: CompaniesFile = { schemaVersion: 1, companies: [] };

const notMember: GitHubIdentityQueries = {
  async isOrgMember() {
    return false;
  },
  async isPublicOrgMember() {
    return false;
  },
  async getPublicEmail() {
    return null;
  },
};

const orgMember: GitHubIdentityQueries = {
  async isOrgMember() {
    return true;
  },
  async isPublicOrgMember() {
    return false;
  },
  async getPublicEmail() {
    return null;
  },
};

async function scenario(
  title: string,
  context: RunContext,
  data: { signatures: SignaturesFile; companies: CompaniesFile; queries: GitHubIdentityQueries },
): Promise<void> {
  const { deps, writes, logs } = makeDeps(context, data);
  await runCla(deps);
  const totalWrites = writes.checks + writes.comments + writes.deletes + writes.appends + writes.locks;
  process.stdout.write(`\n### ${title}\n`);
  for (const line of logs) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write(`  writes performed: ${totalWrites} (checks=${writes.checks}, comments=${writes.comments}, deletes=${writes.deletes}, appends=${writes.appends}, locks=${writes.locks})\n`);
  if (totalWrites !== 0) {
    throw new Error(`Dry-run must not write, but ${totalWrites} write(s) occurred in scenario: ${title}`);
  }
}

async function main(): Promise<void> {
  process.stdout.write('decibri CLA mocked dry-run (no network, no writes)\n');

  await scenario('Unsigned external contributor opens a pull request', prOpened('ext-dev', 500), {
    signatures: emptySignatures,
    companies: emptyCompanies,
    queries: notMember,
  });

  await scenario('Organisation member opens a pull request', prOpened('core-dev', 42), {
    signatures: emptySignatures,
    companies: emptyCompanies,
    queries: orgMember,
  });

  await scenario('Contributor with a current signature opens a pull request', prOpened('ext-dev', 500), {
    signatures: {
      schemaVersion: 1,
      signatures: [
        {
          type: 'individual',
          githubId: 500,
          username: 'ext-dev',
          claVersionLabel: 'icla-v1',
          claVersionHash: ACTIVE_ICLA_HASH,
          assented: true,
          assentPhrase: config.assentPhraseIcla,
          signedAt: '2026-06-01T00:00:00Z',
          signedInRepo: 'decibri/decibri',
          prNumber: 3,
          commentUrl: 'https://github.com/decibri/decibri/pull/3#issuecomment-9',
        },
      ],
    },
    companies: emptyCompanies,
    queries: notMember,
  });

  process.stdout.write('\nAll scenarios completed with zero writes.\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
