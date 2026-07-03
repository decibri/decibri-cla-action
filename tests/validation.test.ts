import { describe, expect, it } from 'vitest';
import {
  companiesWith,
  makeAuthor,
  makeCompany,
  makeQueries,
} from './helpers';
import { findCoveringCompany, parseCompaniesFile, parseGithubId } from '../src/companies';
import { parseSignaturesFile } from '../src/signatures';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const VALID_COMPANIES = {
  schemaVersion: 1,
  companies: [
    {
      name: 'Acme Pty Ltd',
      ccla: {
        versionLabel: 'ccla-v1',
        versionHash: 'sha256:abc',
        signatory: { name: 'Jane Smith', title: 'CTO' },
        signedAt: '2026-07-01T00:00:00Z',
        documentRef: 'acme-ccla.pdf',
        active: true,
      },
      managers: [{ githubId: 222222, username: 'jane-acme' }],
      approvedList: [{ type: 'github_id', value: 333333 }],
    },
  ],
};

const VALID_SIGNATURES = {
  schemaVersion: 1,
  signatures: [
    {
      type: 'individual',
      githubId: 1001,
      username: 'octocat',
      claVersionLabel: 'icla-v1',
      claVersionHash: 'sha256:abc',
      assented: true,
      assentPhrase: 'I hereby sign it.',
      signedAt: '2026-07-01T12:00:00Z',
      signedInRepo: 'decibri/decibri',
      prNumber: 42,
      commentUrl: 'https://github.com/decibri/decibri/pull/42#issuecomment-1',
    },
  ],
};

describe('parseGithubId', () => {
  it('accepts clean positive integers as number or decimal string', () => {
    expect(parseGithubId(333333)).toBe(333333);
    expect(parseGithubId('333333')).toBe(333333);
    expect(parseGithubId(' 333333 ')).toBe(333333);
  });

  it('rejects hex, empty, float, zero, negative, and non-digit strings', () => {
    expect(parseGithubId('0x123')).toBeNull();
    expect(parseGithubId('')).toBeNull();
    expect(parseGithubId('1e5')).toBeNull();
    expect(parseGithubId('123.456')).toBeNull();
    expect(parseGithubId(123.456)).toBeNull();
    expect(parseGithubId(0)).toBeNull();
    expect(parseGithubId(-5)).toBeNull();
    expect(parseGithubId('-5')).toBeNull();
  });
});

describe('parseCompaniesFile validation', () => {
  it('accepts a well formed file and the empty store', () => {
    expect(parseCompaniesFile(clone(VALID_COMPANIES)).companies).toHaveLength(1);
    expect(parseCompaniesFile({ schemaVersion: 1, companies: [] }).companies).toHaveLength(0);
  });

  it('rejects a github_id criterion that would coerce falsely', () => {
    const bad = clone(VALID_COMPANIES);
    bad.companies[0].approvedList[0].value = '0x123' as unknown as number;
    expect(() => parseCompaniesFile(bad)).toThrow(/github_id/);

    const empty = clone(VALID_COMPANIES);
    empty.companies[0].approvedList[0].value = '' as unknown as number;
    expect(() => parseCompaniesFile(empty)).toThrow(/github_id/);
  });

  it('rejects a non positive integer github_id', () => {
    const negative = clone(VALID_COMPANIES);
    negative.companies[0].approvedList[0].value = -1;
    expect(() => parseCompaniesFile(negative)).toThrow(/github_id/);
  });

  it('rejects missing required CCLA fields', () => {
    const noSignedAt = clone(VALID_COMPANIES) as any;
    delete noSignedAt.companies[0].ccla.signedAt;
    expect(() => parseCompaniesFile(noSignedAt)).toThrow(/signedAt/);

    const noTitle = clone(VALID_COMPANIES) as any;
    delete noTitle.companies[0].ccla.signatory.title;
    expect(() => parseCompaniesFile(noTitle)).toThrow(/title/);
  });

  it('rejects a manager without a valid githubId', () => {
    const bad = clone(VALID_COMPANIES) as any;
    bad.companies[0].managers[0].githubId = 'not-a-number';
    expect(() => parseCompaniesFile(bad)).toThrow(/githubId/);
  });
});

describe('findCoveringCompany rejects coercible github_id values (defense in depth)', () => {
  it('does not match a hex string value even if it bypassed validation', async () => {
    const company = makeCompany({ approvedList: [{ type: 'github_id', value: '0x123' }] });
    // 0x123 === 291; a naive Number() comparison would have matched this author.
    const match = await findCoveringCompany(
      companiesWith(company),
      makeAuthor({ githubId: 291 }),
      makeQueries(),
    );
    expect(match).toBeNull();
  });

  it('does not match an empty string value against githubId zero', async () => {
    const company = makeCompany({ approvedList: [{ type: 'github_id', value: '' }] });
    const match = await findCoveringCompany(
      companiesWith(company),
      makeAuthor({ githubId: 0 }),
      makeQueries(),
    );
    expect(match).toBeNull();
  });
});

describe('parseSignaturesFile validation', () => {
  it('accepts a well formed file and the empty store', () => {
    expect(parseSignaturesFile(clone(VALID_SIGNATURES)).signatures).toHaveLength(1);
    expect(parseSignaturesFile({ schemaVersion: 1, signatures: [] }).signatures).toHaveLength(0);
  });

  it('rejects a non positive githubId', () => {
    const bad = clone(VALID_SIGNATURES);
    bad.signatures[0].githubId = 0;
    expect(() => parseSignaturesFile(bad)).toThrow(/githubId/);
  });

  it('rejects a missing commentUrl', () => {
    const bad = clone(VALID_SIGNATURES) as any;
    delete bad.signatures[0].commentUrl;
    expect(() => parseSignaturesFile(bad)).toThrow(/commentUrl/);
  });

  it('rejects a non integer prNumber', () => {
    const bad = clone(VALID_SIGNATURES);
    bad.signatures[0].prNumber = 1.5;
    expect(() => parseSignaturesFile(bad)).toThrow(/prNumber/);
  });
});
