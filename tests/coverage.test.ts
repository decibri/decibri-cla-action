import { describe, expect, it } from 'vitest';
import { decideCoverage } from '../src/coverage';
import { isRepoAllowed } from '../src/config';
import {
  CURRENT_ICLA_HASH,
  OLD_ICLA_HASH,
  addOldThenNew,
  companiesWith,
  emptyCompanies,
  emptySignatures,
  individualSignature,
  makeAuthor,
  makeCompany,
  makeConfig,
  makeQueries,
  signaturesWith,
} from './helpers';

describe('decideCoverage', () => {
  it('passes an org member via the bypass, and short circuits before other checks', async () => {
    const author = makeAuthor({ login: 'octocat' });
    const queries = makeQueries({ orgMembers: { decibri: ['octocat'] } });

    const decision = await decideCoverage({
      author,
      org: 'decibri',
      config: makeConfig(),
      signatures: emptySignatures(),
      companies: emptyCompanies(),
      queries,
    });

    expect(decision.covered).toBe(true);
    expect(decision.reason).toBe('org_member');
    // The org member bypass should not have needed to consult the CCLA queries.
    expect(queries.calls.isPublicOrgMember).toBe(0);
    expect(queries.calls.getPublicEmail).toBe(0);
  });

  it('does not bypass an org member when orgMembersBypass is false', async () => {
    const author = makeAuthor({ login: 'octocat' });
    const queries = makeQueries({ orgMembers: { decibri: ['octocat'] } });

    const decision = await decideCoverage({
      author,
      org: 'decibri',
      config: makeConfig({ orgMembersBypass: false }),
      signatures: emptySignatures(),
      companies: emptyCompanies(),
      queries,
    });

    expect(decision.covered).toBe(false);
    expect(decision.reason).toBe('unsigned');
  });

  it('passes when a current individual signature is present', async () => {
    const author = makeAuthor({ githubId: 1001 });
    const decision = await decideCoverage({
      author,
      org: 'decibri',
      config: makeConfig(),
      signatures: signaturesWith(individualSignature({ githubId: 1001, claVersionHash: CURRENT_ICLA_HASH })),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });

    expect(decision.covered).toBe(true);
    expect(decision.reason).toBe('individual_signature');
  });

  it('fails an outdated signature, then passes once the contributor re-signs', async () => {
    const author = makeAuthor({ githubId: 1001 });

    const outdated = await decideCoverage({
      author,
      org: 'decibri',
      config: makeConfig(),
      signatures: signaturesWith(individualSignature({ githubId: 1001, claVersionHash: OLD_ICLA_HASH })),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });
    expect(outdated.covered).toBe(false);
    expect(outdated.reason).toBe('outdated_signature');

    // Re-signing appends a new record carrying the current hash.
    const resigned = await decideCoverage({
      author,
      org: 'decibri',
      config: makeConfig(),
      signatures: addOldThenNew(1001),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });
    expect(resigned.covered).toBe(true);
    expect(resigned.reason).toBe('individual_signature');
  });

  it('fails an unsigned contributor when the ICLA is active', async () => {
    const decision = await decideCoverage({
      author: makeAuthor(),
      org: 'decibri',
      config: makeConfig(),
      signatures: emptySignatures(),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });
    expect(decision.covered).toBe(false);
    expect(decision.reason).toBe('unsigned');
  });

  it('treats enforcement as dormant while the ICLA has no active version', async () => {
    const decision = await decideCoverage({
      author: makeAuthor(),
      org: 'decibri',
      config: makeConfig({
        icla: { file: 'agreements/Individual-CLA-v1.md', versionLabel: null, versionHash: null },
      }),
      signatures: emptySignatures(),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });
    expect(decision.covered).toBe(true);
    expect(decision.reason).toBe('cla_not_active');
  });

  describe('corporate coverage by each criterion type', () => {
    it('passes on a github_id match', async () => {
      const decision = await decideCoverage({
        author: makeAuthor({ githubId: 333333, login: 'someone' }),
        org: 'decibri',
        config: makeConfig(),
        signatures: emptySignatures(),
        companies: companiesWith(
          makeCompany({ approvedList: [{ type: 'github_id', value: 333333 }] }),
        ),
        queries: makeQueries(),
      });
      expect(decision.covered).toBe(true);
      expect(decision.reason).toBe('ccla_github_id');
      expect(decision.company).toBe('Acme Pty Ltd');
    });

    it('passes on a case insensitive github_username match', async () => {
      const decision = await decideCoverage({
        author: makeAuthor({ githubId: 9, login: 'Dev-One' }),
        org: 'decibri',
        config: makeConfig(),
        signatures: emptySignatures(),
        companies: companiesWith(
          makeCompany({ approvedList: [{ type: 'github_username', value: 'dev-one' }] }),
        ),
        queries: makeQueries(),
      });
      expect(decision.covered).toBe(true);
      expect(decision.reason).toBe('ccla_github_username');
    });

    it('passes on a github_org public membership match', async () => {
      const decision = await decideCoverage({
        author: makeAuthor({ githubId: 9, login: 'dev-two' }),
        org: 'decibri',
        config: makeConfig(),
        signatures: emptySignatures(),
        companies: companiesWith(
          makeCompany({ approvedList: [{ type: 'github_org', value: 'acme-inc' }] }),
        ),
        queries: makeQueries({ publicOrgMembers: { 'acme-inc': ['dev-two'] } }),
      });
      expect(decision.covered).toBe(true);
      expect(decision.reason).toBe('ccla_github_org');
    });

    it('passes on an email_domain match against a verified public email', async () => {
      const decision = await decideCoverage({
        author: makeAuthor({ githubId: 9, login: 'dev-three' }),
        org: 'decibri',
        config: makeConfig(),
        signatures: emptySignatures(),
        companies: companiesWith(
          makeCompany({ approvedList: [{ type: 'email_domain', value: 'acme.example' }] }),
        ),
        queries: makeQueries({ emails: { 'dev-three': 'dev-three@acme.example' } }),
      });
      expect(decision.covered).toBe(true);
      expect(decision.reason).toBe('ccla_email_domain');
    });
  });

  it('does not grant coverage from an inactive CCLA', async () => {
    const company = makeCompany({
      approvedList: [{ type: 'github_id', value: 333333 }],
    });
    company.ccla.active = false;

    const decision = await decideCoverage({
      author: makeAuthor({ githubId: 333333, login: 'someone' }),
      org: 'decibri',
      config: makeConfig(),
      signatures: emptySignatures(),
      companies: companiesWith(company),
      queries: makeQueries(),
    });
    expect(decision.covered).toBe(false);
    expect(decision.reason).toBe('unsigned');
  });

  it('passes bots and apps on the bypass list, treating slug and slug[bot] as equal', async () => {
    const config = makeConfig({ botAndAppBypass: ['dependabot'] });
    const decision = await decideCoverage({
      author: makeAuthor({ login: 'dependabot[bot]', type: 'Bot' }),
      org: 'decibri',
      config,
      signatures: emptySignatures(),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });
    expect(decision.covered).toBe(true);
    expect(decision.reason).toBe('bot_or_app_bypass');
  });
});

describe('allowlist guard (drives the main.ts exit without writing)', () => {
  it('accepts a repo that is listed', () => {
    expect(isRepoAllowed(makeConfig(), 'decibri/decibri')).toBe(true);
    // Case insensitive on the full name.
    expect(isRepoAllowed(makeConfig(), 'Decibri/Decibri')).toBe(true);
  });

  it('rejects a repo that is not listed, so the Action exits without writing', () => {
    expect(isRepoAllowed(makeConfig(), 'decibri/other-repo')).toBe(false);
    expect(isRepoAllowed(makeConfig({ allowedRepos: [] }), 'decibri/decibri')).toBe(false);
  });
});
