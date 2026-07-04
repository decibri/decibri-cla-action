// Shared fixtures and fakes for the unit tests. Not a test file itself.

import type { ClaConfig } from '../src/config';
import type { CompaniesFile, Company } from '../src/companies';
import type { SignatureRecord, SignaturesFile } from '../src/signatures';
import type { Author, GitHubIdentityQueries } from '../src/types';

export const CURRENT_ICLA_HASH = 'sha256:current0000000000000000000000000000000000000000000000000000000000';
export const OLD_ICLA_HASH = 'sha256:old00000000000000000000000000000000000000000000000000000000000000';

/** A config with the ICLA active by default, so the coverage logic is exercised. */
export function makeConfig(overrides: Partial<ClaConfig> = {}): ClaConfig {
  return {
    icla: { file: 'agreements/Individual-CLA-v1.md', versionLabel: 'icla-v1', versionHash: CURRENT_ICLA_HASH },
    ccla: { file: 'agreements/Corporate-CLA-v1.md', versionLabel: 'ccla-v1', versionHash: 'sha256:ccla' },
    assentPhraseIcla: 'I have read the decibri Individual Contributor License Agreement and I hereby sign it.',
    checkName: 'CLA',
    orgMembersBypass: true,
    lockPrOnMerge: true,
    botAndAppBypass: [],
    allowedRepos: ['decibri'],
    ...overrides,
  };
}

export function makeAuthor(overrides: Partial<Author> = {}): Author {
  return { githubId: 1001, login: 'octocat', type: 'User', ...overrides };
}

export function emptySignatures(): SignaturesFile {
  return { schemaVersion: 1, signatures: [] };
}

export function signaturesWith(...records: SignatureRecord[]): SignaturesFile {
  return { schemaVersion: 1, signatures: records };
}

export function individualSignature(overrides: Partial<SignatureRecord> = {}): SignatureRecord {
  return {
    type: 'individual',
    githubId: 1001,
    username: 'octocat',
    claVersionLabel: 'icla-v1',
    claVersionHash: CURRENT_ICLA_HASH,
    assented: true,
    assentPhrase: 'I have read the decibri Individual Contributor License Agreement and I hereby sign it.',
    signedAt: '2026-07-01T12:00:00Z',
    signedInRepo: 'decibri/decibri',
    prNumber: 42,
    commentUrl: 'https://github.com/decibri/decibri/pull/42#issuecomment-1',
    ...overrides,
  };
}

/**
 * Signatures with an outdated record followed by a current one for the same id,
 * to prove that re-signing (an appended current record) supersedes the old one.
 */
export function addOldThenNew(githubId: number): SignaturesFile {
  return signaturesWith(
    individualSignature({ githubId, claVersionHash: OLD_ICLA_HASH }),
    individualSignature({ githubId, claVersionHash: CURRENT_ICLA_HASH }),
  );
}

export function emptyCompanies(): CompaniesFile {
  return { schemaVersion: 1, companies: [] };
}

export function companiesWith(...companies: Company[]): CompaniesFile {
  return { schemaVersion: 1, companies };
}

export function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    name: 'Acme Pty Ltd',
    ccla: {
      versionLabel: 'ccla-v1',
      versionHash: 'sha256:ccla',
      signatory: { name: 'Jane Smith', title: 'CTO' },
      signedAt: '2026-07-01T00:00:00Z',
      documentRef: 'acme-ccla-2026-07-01.pdf',
      active: true,
    },
    managers: [{ githubId: 222222, username: 'jane-acme' }],
    approvedList: [],
    ...overrides,
  };
}

/**
 * A fake GitHubIdentityQueries that answers from in memory maps and records the
 * calls it received, so tests can assert both results and access patterns.
 */
export interface FakeQueries extends GitHubIdentityQueries {
  calls: { isOrgMember: number; isPublicOrgMember: number; getPublicEmail: number };
}

export function makeQueries(options: {
  orgMembers?: Record<string, string[]>;
  publicOrgMembers?: Record<string, string[]>;
  emails?: Record<string, string | null>;
} = {}): FakeQueries {
  const calls = { isOrgMember: 0, isPublicOrgMember: 0, getPublicEmail: 0 };
  const orgMembers = options.orgMembers ?? {};
  const publicOrgMembers = options.publicOrgMembers ?? {};
  const emails = options.emails ?? {};
  return {
    calls,
    async isOrgMember(org, login) {
      calls.isOrgMember += 1;
      return (orgMembers[org] ?? []).map((l) => l.toLowerCase()).includes(login.toLowerCase());
    },
    async isPublicOrgMember(org, login) {
      calls.isPublicOrgMember += 1;
      return (publicOrgMembers[org] ?? []).map((l) => l.toLowerCase()).includes(login.toLowerCase());
    },
    async getPublicEmail(login) {
      calls.getPublicEmail += 1;
      return login in emails ? emails[login] : null;
    },
  };
}
