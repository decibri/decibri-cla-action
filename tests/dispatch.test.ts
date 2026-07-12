import { describe, expect, it } from 'vitest';
import { runCla, type RunContext, type RunDeps } from '../src/run';
import { CLA_COMMENT_MARKER } from '../src/comments';
import type { IssueComment, PullRequestInfo } from '../src/gateways';
import type { SignatureRecord } from '../src/signatures';
import {
  companiesWith,
  emptyCompanies,
  emptySignatures,
  individualSignature,
  makeAuthor,
  makeCompany,
  makeConfig,
  makeQueries,
  signaturesWith,
  type FakeQueries,
} from './helpers';
import type { ClaConfig } from '../src/config';
import type { CompaniesFile } from '../src/companies';
import type { SignaturesFile } from '../src/signatures';
import type { Author } from '../src/types';

interface Recorder {
  checks: Array<{ headSha: string; conclusion: string; title: string; summary: string }>;
  created: Array<{ prNumber: number; body: string }>;
  deleted: number[];
  appended: SignatureRecord[];
  locked: number[];
  logs: string[];
}

interface DepsOptions {
  context: RunContext;
  config?: ClaConfig;
  dryRun?: boolean;
  signatures?: SignaturesFile;
  companies?: CompaniesFile;
  queries?: FakeQueries;
  commentsByPr?: Record<number, IssueComment[]>;
  pr?: PullRequestInfo;
  openPrs?: PullRequestInfo[];
}

function defaultPr(): PullRequestInfo {
  return { number: 7, headSha: 'sha7', author: makeAuthor(), state: 'open', merged: false };
}

function makeDeps(options: DepsOptions): { deps: RunDeps; rec: Recorder } {
  const rec: Recorder = { checks: [], created: [], deleted: [], appended: [], locked: [], logs: [] };
  const commentsByPr = options.commentsByPr ?? {};
  const deps: RunDeps = {
    context: options.context,
    config: options.config ?? makeConfig(),
    dryRun: options.dryRun ?? false,
    checks: {
      async setCheck(params) {
        rec.checks.push({
          headSha: params.headSha,
          conclusion: params.conclusion,
          title: params.title,
          summary: params.summary,
        });
      },
    },
    comments: {
      async listComments(prNumber) {
        return commentsByPr[prNumber] ?? [];
      },
      async createComment(prNumber, body) {
        rec.created.push({ prNumber, body });
      },
      async deleteComment(commentId) {
        rec.deleted.push(commentId);
      },
    },
    pulls: {
      async getPullRequest() {
        return options.pr ?? defaultPr();
      },
      async listOpenPullRequests() {
        return options.openPrs ?? [];
      },
      async lockPullRequest(prNumber) {
        rec.locked.push(prNumber);
      },
    },
    signatureStore: {
      async read() {
        return options.signatures ?? emptySignatures();
      },
      async append(record) {
        rec.appended.push(record);
      },
    },
    companyStore: {
      async read() {
        return options.companies ?? emptyCompanies();
      },
    },
    queries: options.queries ?? makeQueries(),
    log: {
      info: (message) => rec.logs.push(message),
      warning: (message) => rec.logs.push(message),
      notice: (message) => rec.logs.push(message),
    },
    now: () => '2026-07-01T12:00:00Z',
  };
  return { deps, rec };
}

function prOpened(author: Author, over: Partial<{ number: number; sha: string; action: string }> = {}): RunContext {
  return {
    eventName: 'pull_request_target',
    action: over.action ?? 'opened',
    owner: 'decibri',
    repo: 'decibri',
    pullRequest: {
      number: over.number ?? 7,
      head: { sha: over.sha ?? 'sha7' },
      user: { id: author.githubId, login: author.login },
    },
  };
}

function commentCreated(
  commenter: Author,
  body: string,
  over: Partial<{ prNumber: number; commentId: number; isPr: boolean }> = {},
): RunContext {
  return {
    eventName: 'issue_comment',
    action: 'created',
    owner: 'decibri',
    repo: 'decibri',
    comment: {
      id: over.commentId ?? 100,
      body,
      user: { id: commenter.githubId, login: commenter.login },
      html_url: 'https://github.com/decibri/decibri/pull/7#issuecomment-100',
    },
    issue: {
      number: over.prNumber ?? 7,
      pull_request: (over.isPr ?? true) ? {} : undefined,
      user: { id: commenter.githubId, login: commenter.login },
    },
  };
}

function promptComment(id: number): IssueComment {
  // The Action posts through the calling repo GITHUB_TOKEN, so its comments are
  // authored by a bot account.
  return {
    id,
    body: `${CLA_COMMENT_MARKER}\nPlease sign the CLA.`,
    author: makeAuthor({ githubId: 999999, login: 'github-actions[bot]' }),
    htmlUrl: 'https://github.com/decibri/decibri/pull/7#issuecomment-1',
  };
}

function contributorCommentQuotingMarker(id: number): IssueComment {
  // A human contributor whose comment happens to contain the marker string.
  return {
    id,
    body: `Heads up, the bot posts a hidden ${CLA_COMMENT_MARKER} marker in its comment.`,
    author: makeAuthor({ githubId: 500, login: 'ext-dev' }),
    htmlUrl: 'https://github.com/decibri/decibri/pull/7#issuecomment-2',
  };
}

const EXTERNAL = makeAuthor({ githubId: 500, login: 'ext-dev' });

describe('runCla pull request events', () => {
  it('fails an unsigned contributor: sets the check to failure and posts the prompt', async () => {
    const { deps, rec } = makeDeps({ context: prOpened(EXTERNAL) });
    await runCla(deps);
    expect(rec.checks).toHaveLength(1);
    expect(rec.checks[0].conclusion).toBe('failure');
    expect(rec.created).toHaveLength(1);
    expect(rec.created[0].body).toContain(CLA_COMMENT_MARKER);
    expect(rec.deleted).toHaveLength(0);
  });

  it('does not post a second prompt when one already exists', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      commentsByPr: { 7: [promptComment(1)] },
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('failure');
    expect(rec.created).toHaveLength(0);
  });

  it('passes an org member: sets success and removes any existing prompt', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      queries: makeQueries({ orgMembers: { decibri: ['ext-dev'] } }),
      commentsByPr: { 7: [promptComment(11)] },
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('success');
    expect(rec.created).toHaveLength(0);
    expect(rec.deleted).toEqual([11]);
  });

  it('never deletes a contributor comment that merely quotes the marker', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      queries: makeQueries({ orgMembers: { decibri: ['ext-dev'] } }),
      commentsByPr: { 7: [contributorCommentQuotingMarker(31), promptComment(12)] },
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('success');
    // Only the bot authored prompt (12) is removed; the contributor comment (31) is left alone.
    expect(rec.deleted).toEqual([12]);
  });

  it('still posts a prompt when only a spoofed contributor marker comment exists', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      commentsByPr: { 7: [contributorCommentQuotingMarker(31)] },
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('failure');
    // The spoofed comment is not treated as ours, so the real prompt is posted.
    expect(rec.created).toHaveLength(1);
  });

  it('passes a contributor with a current signature', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      signatures: signaturesWith(individualSignature({ githubId: 500, username: 'ext-dev' })),
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('success');
    expect(rec.created).toHaveLength(0);
  });

  it('stays dormant (success, no prompt) when the ICLA has no active version', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      config: makeConfig({ icla: { file: 'agreements/Individual-CLA-v1.md', versionLabel: null, versionHash: null } }),
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('success');
    expect(rec.created).toHaveLength(0);
  });

  it('bypasses a bot on the bot and app bypass list (slug matches slug[bot]), e.g. Dependabot', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(makeAuthor({ githubId: 77, login: 'dependabot[bot]', type: 'Bot' })),
      config: makeConfig({ botAndAppBypass: ['dependabot'] }),
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('success');
    // No prompt comment is posted and nothing is written to the signature store:
    // Dependabot's dependency-update PRs pass the CLA check via the bypass alone.
    expect(rec.created).toHaveLength(0);
    expect(rec.appended).toHaveLength(0);
  });

  it('locks a merged pull request when lockPrOnMerge is set', async () => {
    const { deps, rec } = makeDeps({
      context: {
        eventName: 'pull_request_target',
        action: 'closed',
        owner: 'decibri',
        repo: 'decibri',
        pullRequest: { number: 7, head: { sha: 'sha7' }, user: { id: 500, login: 'ext-dev' }, merged: true },
      },
    });
    await runCla(deps);
    expect(rec.locked).toEqual([7]);
    expect(rec.checks).toHaveLength(0);
  });

  it('fails closed with a single check and no comment when the repo is not in allowedRepos', async () => {
    const { deps, rec } = makeDeps({
      context: { ...prOpened(EXTERNAL), repo: 'not-enrolled' },
    });
    await runCla(deps);
    expect(rec.checks).toHaveLength(1);
    expect(rec.checks[0].conclusion).toBe('failure');
    expect(rec.checks[0].title).toBe('CLA enforcement not configured for this repository');
    expect(rec.checks[0].summary).toContain('not in the CLA allowlist');
    expect(rec.created).toHaveLength(0);
    expect(rec.appended).toHaveLength(0);
  });
});

describe('runCla dry-run', () => {
  it('writes nothing on a pull request event, only logs the decision', async () => {
    const { deps, rec } = makeDeps({ context: prOpened(EXTERNAL), dryRun: true });
    await runCla(deps);
    expect(rec.checks).toHaveLength(0);
    expect(rec.created).toHaveLength(0);
    expect(rec.deleted).toHaveLength(0);
    expect(rec.logs.some((l) => l.includes('covered=false'))).toBe(true);
    expect(rec.logs.some((l) => l.includes('[dry-run]'))).toBe(true);
  });

  it('writes nothing on a signing comment, only logs the intent', async () => {
    const { deps, rec } = makeDeps({
      context: commentCreated(EXTERNAL, makeConfig().assentPhraseIcla),
      pr: { number: 7, headSha: 'sha7', author: EXTERNAL, state: 'open', merged: false },
      dryRun: true,
    });
    await runCla(deps);
    expect(rec.appended).toHaveLength(0);
    expect(rec.checks).toHaveLength(0);
    expect(rec.logs.some((l) => l.includes('[dry-run]'))).toBe(true);
  });
});

describe('runCla signing', () => {
  const phrase = makeConfig().assentPhraseIcla;

  it('records a signature by the PR author, passes the check, and clears the prompt', async () => {
    const { deps, rec } = makeDeps({
      context: commentCreated(EXTERNAL, phrase),
      pr: { number: 7, headSha: 'sha7', author: EXTERNAL, state: 'open', merged: false },
      commentsByPr: { 7: [promptComment(21)] },
    });
    await runCla(deps);
    expect(rec.appended).toHaveLength(1);
    expect(rec.appended[0].githubId).toBe(500);
    expect(rec.appended[0].claVersionHash).toBe(makeConfig().icla.versionHash);
    // Minimisation: the stored record carries no email/IP/device fields.
    expect('email' in rec.appended[0]).toBe(false);
    expect(rec.checks[0].conclusion).toBe('success');
    expect(rec.deleted).toEqual([21]);
  });

  it('ignores an assent phrase from someone who is not the PR author', async () => {
    const stranger = makeAuthor({ githubId: 999, login: 'stranger' });
    const { deps, rec } = makeDeps({
      context: commentCreated(stranger, phrase),
      pr: { number: 7, headSha: 'sha7', author: EXTERNAL, state: 'open', merged: false },
    });
    await runCla(deps);
    expect(rec.appended).toHaveLength(0);
    expect(rec.logs.some((l) => l.includes('not the pull request author'))).toBe(true);
  });

  it('does not record a signature while the ICLA is not active', async () => {
    const { deps, rec } = makeDeps({
      context: commentCreated(EXTERNAL, phrase),
      config: makeConfig({ icla: { file: 'agreements/Individual-CLA-v1.md', versionLabel: null, versionHash: null } }),
      pr: { number: 7, headSha: 'sha7', author: EXTERNAL, state: 'open', merged: false },
    });
    await runCla(deps);
    expect(rec.appended).toHaveLength(0);
  });

  it('ignores its own bot comments', async () => {
    const { deps, rec } = makeDeps({
      context: commentCreated(EXTERNAL, `${CLA_COMMENT_MARKER}\n${phrase}`),
      pr: { number: 7, headSha: 'sha7', author: EXTERNAL, state: 'open', merged: false },
    });
    await runCla(deps);
    expect(rec.appended).toHaveLength(0);
    expect(rec.checks).toHaveLength(0);
  });
});

describe('runCla recheck', () => {
  it('re-evaluates coverage and updates the check on a recheck comment', async () => {
    const { deps, rec } = makeDeps({
      context: commentCreated(EXTERNAL, 'recheck'),
      pr: { number: 7, headSha: 'sha7', author: EXTERNAL, state: 'open', merged: false },
    });
    await runCla(deps);
    // Author is unsigned, so recheck sets failure and posts the prompt.
    expect(rec.checks[0].conclusion).toBe('failure');
    expect(rec.created).toHaveLength(1);
  });
});

describe('runCla corporate coverage (end to end through dispatch)', () => {
  it('passes a contributor covered by an active CCLA on github_id, clearing any prompt', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      companies: companiesWith(makeCompany({ approvedList: [{ type: 'github_id', value: 500 }] })),
      commentsByPr: { 7: [promptComment(41)] },
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('success');
    expect(rec.created).toHaveLength(0);
    expect(rec.deleted).toEqual([41]);
  });

  it('passes a contributor covered by an active CCLA on a verified email domain', async () => {
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      companies: companiesWith(makeCompany({ approvedList: [{ type: 'email_domain', value: 'acme.example' }] })),
      queries: makeQueries({ emails: { 'ext-dev': 'ext-dev@acme.example' } }),
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('success');
    expect(rec.created).toHaveLength(0);
  });

  it('does not cover a contributor whose company CCLA is inactive', async () => {
    const company = makeCompany({ approvedList: [{ type: 'github_id', value: 500 }] });
    company.ccla.active = false;
    const { deps, rec } = makeDeps({
      context: prOpened(EXTERNAL),
      companies: companiesWith(company),
    });
    await runCla(deps);
    expect(rec.checks[0].conclusion).toBe('failure');
    expect(rec.created).toHaveLength(1);
  });
});

describe('runCla merge queue', () => {
  function mergeGroup(headSha = 'queue-sha'): RunContext {
    return {
      eventName: 'merge_group',
      action: 'checks_requested',
      owner: 'decibri',
      repo: 'decibri',
      mergeGroup: { headSha },
    };
  }

  it('passes the check on the merge queue head without re-evaluating coverage', async () => {
    const { deps, rec } = makeDeps({ context: mergeGroup('queue-sha') });
    await runCla(deps);
    expect(rec.checks).toHaveLength(1);
    expect(rec.checks[0].conclusion).toBe('success');
    expect(rec.checks[0].headSha).toBe('queue-sha');
    expect(rec.created).toHaveLength(0);
  });

  it('writes nothing for a merge group in dry-run', async () => {
    const { deps, rec } = makeDeps({ context: mergeGroup(), dryRun: true });
    await runCla(deps);
    expect(rec.checks).toHaveLength(0);
  });
});
