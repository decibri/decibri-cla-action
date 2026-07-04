import { describe, expect, it, vi } from 'vitest';
import { decideCoverage } from '../src/coverage';
import { isOrgOwnerAllowed, isRepoAllowed } from '../src/config';
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

  it('bypasses an app whose type is Bot even when its login has no [bot] suffix', async () => {
    // A GitHub App account can report type "Bot" while its login is a bare slug.
    const decision = await decideCoverage({
      author: makeAuthor({ githubId: 99, login: 'my-app', type: 'Bot' }),
      org: 'decibri',
      config: makeConfig({ botAndAppBypass: ['my-app'] }),
      signatures: emptySignatures(),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });
    expect(decision.covered).toBe(true);
    expect(decision.reason).toBe('bot_or_app_bypass');
  });

  it('does NOT bypass a non-bot human account whose login matches a bypass entry', async () => {
    // A human could register the login "dependabot"; the exact list match alone must
    // not be enough. The account must also be a bot or app (login ends in [bot], or
    // API type is Bot). This one is a plain User, so it is not bypassed.
    const decision = await decideCoverage({
      author: makeAuthor({ githubId: 1001, login: 'dependabot', type: 'User' }),
      org: 'decibri',
      config: makeConfig({ botAndAppBypass: ['dependabot'] }),
      signatures: emptySignatures(),
      companies: emptyCompanies(),
      queries: makeQueries(),
    });
    expect(decision.covered).toBe(false);
    expect(decision.reason).toBe('unsigned');
  });
});

describe('hard org-owner gate (drives the runCla exit without writing)', () => {
  it('accepts the decibri org owner, case insensitively', () => {
    expect(isOrgOwnerAllowed('decibri')).toBe(true);
    expect(isOrgOwnerAllowed('Decibri')).toBe(true);
    expect(isOrgOwnerAllowed('DECIBRI')).toBe(true);
  });

  it('rejects any non-decibri owner, so the Action exits without action', () => {
    expect(isOrgOwnerAllowed('attacker')).toBe(false);
    expect(isOrgOwnerAllowed('decibri-fork')).toBe(false);
    expect(isOrgOwnerAllowed('notdecibri')).toBe(false);
    expect(isOrgOwnerAllowed('')).toBe(false);
  });
});

describe('allowlist guard (drives the main.ts exit without writing)', () => {
  it('matches a bare-name entry against the org-prefixed full name, case insensitively', () => {
    // "decibri" is a bare repo name; it is compared as "decibri/decibri".
    expect(isRepoAllowed(makeConfig({ allowedRepos: ['decibri'] }), 'decibri/decibri')).toBe(true);
    expect(isRepoAllowed(makeConfig({ allowedRepos: ['decibri'] }), 'Decibri/Decibri')).toBe(true);
    expect(isRepoAllowed(makeConfig({ allowedRepos: ['decibri', 'decibri-aec'] }), 'decibri/decibri-aec')).toBe(true);
  });

  it('rejects a repo that is not listed, so the Action exits without writing', () => {
    expect(isRepoAllowed(makeConfig({ allowedRepos: ['decibri'] }), 'decibri/other-repo')).toBe(false);
    expect(isRepoAllowed(makeConfig({ allowedRepos: [] }), 'decibri/decibri')).toBe(false);
  });

  it('rejects (ignores) an entry containing a slash and warns, so a foreign owner cannot be smuggled in', () => {
    const warn = vi.fn();
    // An injected "attacker/evil" entry must never enroll the attacker/evil repo.
    expect(isRepoAllowed(makeConfig({ allowedRepos: ['attacker/evil'] }), 'attacker/evil', warn)).toBe(false);
    // Even the org's own full name is rejected when written with a slash: entries must be bare.
    expect(isRepoAllowed(makeConfig({ allowedRepos: ['decibri/decibri'] }), 'decibri/decibri', warn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/bare repository names/);
  });

  it('still matches a valid bare entry even when another entry is a rejected slash entry', () => {
    const warn = vi.fn();
    expect(
      isRepoAllowed(makeConfig({ allowedRepos: ['attacker/evil', 'decibri'] }), 'decibri/decibri', warn),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
