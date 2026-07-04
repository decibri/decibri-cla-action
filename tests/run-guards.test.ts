import { describe, expect, it } from 'vitest';
import { runCla, type RunContext, type RunDeps } from '../src/run';
import { emptyCompanies, emptySignatures, makeConfig, makeQueries } from './helpers';

// End-to-end proof that the hard org-owner gate and the allowlist guard exit
// "with no action": when either fails, no store is read, no check is set, and no
// comment is posted. A positive control shows the same machinery does run once
// both guards pass, so the negatives are not a false exit somewhere else.

interface Calls {
  signaturesRead: number;
  companiesRead: number;
  setCheck: number;
  listComments: number;
  createComment: number;
  append: number;
  lock: number;
}

function makeDeps(context: RunContext, config = makeConfig()): { deps: RunDeps; calls: Calls } {
  const calls: Calls = {
    signaturesRead: 0,
    companiesRead: 0,
    setCheck: 0,
    listComments: 0,
    createComment: 0,
    append: 0,
    lock: 0,
  };
  const deps: RunDeps = {
    context,
    config,
    dryRun: false,
    checks: {
      async setCheck() {
        calls.setCheck += 1;
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
    log: { info() {}, warning() {}, notice() {} },
    now: () => '2026-07-04T00:00:00Z',
  };
  return { deps, calls };
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

describe('runCla guards exit without action', () => {
  it('takes no action when the repository owner is not the decibri org', async () => {
    // "decibri" is a listed repo name, but the owner is not the decibri org.
    const { deps, calls } = makeDeps(prContext('attacker', 'decibri'));
    await runCla(deps);
    expect(calls).toEqual({
      signaturesRead: 0,
      companiesRead: 0,
      setCheck: 0,
      listComments: 0,
      createComment: 0,
      append: 0,
      lock: 0,
    });
  });

  it('takes no action when the decibri repo is not in the allowlist', async () => {
    const { deps, calls } = makeDeps(prContext('decibri', 'not-enrolled'));
    await runCla(deps);
    expect(calls).toEqual({
      signaturesRead: 0,
      companiesRead: 0,
      setCheck: 0,
      listComments: 0,
      createComment: 0,
      append: 0,
      lock: 0,
    });
  });

  it('positive control: an enrolled decibri repo is evaluated and the check is set', async () => {
    const { deps, calls } = makeDeps(prContext('decibri', 'decibri'));
    await runCla(deps);
    // Both stores were read for the coverage decision and the check was set.
    expect(calls.signaturesRead).toBe(1);
    expect(calls.companiesRead).toBe(1);
    expect(calls.setCheck).toBe(1);
  });
});
