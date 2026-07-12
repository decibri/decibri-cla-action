import { describe, expect, it } from 'vitest';
import { runCla, type RunContext, type RunDeps } from '../src/run';
import { emptyCompanies, emptySignatures, makeConfig, makeQueries } from './helpers';

// End-to-end proof of the two entry guards.
//
// The hard org-owner gate exits with no action at all: no store read, no check,
// no comment. The Action must never report into a repository outside the
// decibri org.
//
// The allowlist guard, which runs after the org-owner gate, fails closed: a
// decibri owned repository that is not enrolled gets exactly one failing check
// naming the cause, so a required CLA check resolves visibly instead of hanging
// forever, and nothing else is touched: no prompt comment, no store read or
// write. A positive control shows the same machinery does run once both guards
// pass, so the negatives are not a false exit somewhere else.

interface Calls {
  signaturesRead: number;
  companiesRead: number;
  setCheck: number;
  listComments: number;
  createComment: number;
  append: number;
  lock: number;
}

const NO_CALLS: Calls = {
  signaturesRead: 0,
  companiesRead: 0,
  setCheck: 0,
  listComments: 0,
  createComment: 0,
  append: 0,
  lock: 0,
};

interface CheckRecord {
  headSha: string;
  name: string;
  conclusion: string;
  title: string;
  summary: string;
}

function makeDeps(
  context: RunContext,
  options: { config?: ReturnType<typeof makeConfig>; dryRun?: boolean } = {},
): { deps: RunDeps; calls: Calls; checks: CheckRecord[]; logs: string[] } {
  const calls: Calls = { ...NO_CALLS };
  const checks: CheckRecord[] = [];
  const logs: string[] = [];
  const deps: RunDeps = {
    context,
    config: options.config ?? makeConfig(),
    dryRun: options.dryRun ?? false,
    checks: {
      async setCheck(params) {
        calls.setCheck += 1;
        checks.push({
          headSha: params.headSha,
          name: params.name,
          conclusion: params.conclusion,
          title: params.title,
          summary: params.summary,
        });
      },
    },
    comments: {
      async listComments() {
        calls.listComments += 1;
        return [];
      },
      async createComment() {
        calls.createComment += 1;
      },
      async deleteComment() {},
    },
    pulls: {
      async getPullRequest() {
        throw new Error('getPullRequest should not be called in these tests');
      },
      async listOpenPullRequests() {
        return [];
      },
      async lockPullRequest() {
        calls.lock += 1;
      },
    },
    signatureStore: {
      async read() {
        calls.signaturesRead += 1;
        return emptySignatures();
      },
      async append() {
        calls.append += 1;
      },
    },
    companyStore: {
      async read() {
        calls.companiesRead += 1;
        return emptyCompanies();
      },
    },
    queries: makeQueries(),
    log: {
      info: (message) => logs.push(message),
      warning: (message) => logs.push(message),
      notice: (message) => logs.push(message),
    },
    now: () => '2026-07-04T00:00:00Z',
  };
  return { deps, calls, checks, logs };
}

function prContext(owner: string, repo: string): RunContext {
  return {
    eventName: 'pull_request',
    action: 'opened',
    owner,
    repo,
    pullRequest: { number: 1, head: { sha: 'headsha' }, user: { id: 1001, login: 'octocat' } },
  };
}

describe('runCla org-owner gate', () => {
  it('takes no action when the repository owner is not the decibri org', async () => {
    // "decibri" is a listed repo name, but the owner is not the decibri org.
    const { deps, calls } = makeDeps(prContext('attacker', 'decibri'));
    await runCla(deps);
    expect(calls).toEqual(NO_CALLS);
  });

  it('takes no action for a foreign owner even when the repo is also not allowlisted', async () => {
    // The org-owner gate runs ahead of the allowlist guard, so a repository
    // outside the org never receives the not-allowlisted failing check either.
    const { deps, calls } = makeDeps(prContext('attacker', 'not-enrolled'));
    await runCla(deps);
    expect(calls).toEqual(NO_CALLS);
  });
});

describe('runCla allowlist guard fails closed', () => {
  it('posts exactly one failing check for a decibri repo not in the allowlist, and touches nothing else', async () => {
    const { deps, calls, checks } = makeDeps(prContext('decibri', 'not-enrolled'));
    await runCla(deps);
    expect(calls).toEqual({ ...NO_CALLS, setCheck: 1 });
    expect(checks).toHaveLength(1);
    expect(checks[0].conclusion).toBe('failure');
    expect(checks[0].name).toBe('CLA');
    expect(checks[0].headSha).toBe('headsha');
  });

  it('names the cause in the check title and summary so an operator knows what to do', async () => {
    const { deps, checks } = makeDeps(prContext('decibri', 'not-enrolled'));
    await runCla(deps);
    expect(checks[0].title).toBe('CLA enforcement not configured for this repository');
    expect(checks[0].summary).toContain('decibri/not-enrolled is not in the CLA allowlist');
    expect(checks[0].summary).toContain('not configured to enforce the CLA for this repository');
    expect(checks[0].summary).toContain('fails closed');
    expect(checks[0].summary).toContain('`allowedRepos`');
    expect(checks[0].summary).toContain('decibri/decibri-cla-action');
    expect(checks[0].summary).toContain('`v1` tag');
  });

  it('posts nothing on the not-allowlisted path in dry-run, only logs the decision', async () => {
    const { deps, calls, logs } = makeDeps(prContext('decibri', 'not-enrolled'), { dryRun: true });
    await runCla(deps);
    expect(calls).toEqual(NO_CALLS);
    expect(logs.some((l) => l.includes('[dry-run]'))).toBe(true);
    expect(logs.some((l) => l.includes('not in allowedRepos'))).toBe(true);
  });

  it('only logs on a not-allowlisted event that carries no head SHA (issue_comment)', async () => {
    const context: RunContext = {
      eventName: 'issue_comment',
      action: 'created',
      owner: 'decibri',
      repo: 'not-enrolled',
      comment: {
        id: 100,
        body: 'recheck',
        user: { id: 1001, login: 'octocat' },
        html_url: 'https://github.com/decibri/not-enrolled/pull/1#issuecomment-100',
      },
      issue: { number: 1, pull_request: {}, user: { id: 1001, login: 'octocat' } },
    };
    const { deps, calls, logs } = makeDeps(context);
    await runCla(deps);
    expect(calls).toEqual(NO_CALLS);
    expect(logs.some((l) => l.includes('not in allowedRepos'))).toBe(true);
  });

  it('fails the merge queue head of a not-allowlisted repo', async () => {
    const context: RunContext = {
      eventName: 'merge_group',
      action: 'checks_requested',
      owner: 'decibri',
      repo: 'not-enrolled',
      mergeGroup: { headSha: 'queue-sha' },
    };
    const { deps, calls, checks } = makeDeps(context);
    await runCla(deps);
    expect(calls).toEqual({ ...NO_CALLS, setCheck: 1 });
    expect(checks[0].conclusion).toBe('failure');
    expect(checks[0].headSha).toBe('queue-sha');
  });
});

describe('runCla guards positive control', () => {
  it('an enrolled decibri repo is evaluated and the check is set', async () => {
    const { deps, calls } = makeDeps(prContext('decibri', 'decibri'));
    await runCla(deps);
    // Both stores were read for the coverage decision and the check was set.
    expect(calls.signaturesRead).toBe(1);
    expect(calls.companiesRead).toBe(1);
    expect(calls.setCheck).toBe(1);
  });
});
