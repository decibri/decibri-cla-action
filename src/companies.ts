// The corporate agreement store: types, validation, and the approved list
// matching logic over data/companies.json.
//
// A contributor is covered by a corporate CLA when they match any criterion in an
// active company's approved list. The four criterion types mirror the industry
// standard model: email domain, GitHub org membership, GitHub username, and
// GitHub ID. Matching prefers the immutable GitHub ID, and never guesses an email.

import type { CompanyStore } from './gateways';
import type { Octokit } from './github';
import { readStoreFile } from './store-io';
import type { Author, GitHubIdentityQueries } from './types';

export type ApprovedCriterionType =
  | 'email_domain'
  | 'github_org'
  | 'github_username'
  | 'github_id';

export interface ApprovedListEntry {
  type: ApprovedCriterionType;
  value: string | number;
}

export interface CclaSignatory {
  name: string;
  title: string;
}

export interface Ccla {
  versionLabel: string | null;
  versionHash: string | null;
  signatory: CclaSignatory;
  signedAt: string;
  /** Reference to the signed PDF held in the operator's own records. */
  documentRef: string;
  /** Coverage applies only while this is true. */
  active: boolean;
}

export interface CompanyManager {
  githubId: number;
  username: string;
}

export interface Company {
  name: string;
  ccla: Ccla;
  managers: CompanyManager[];
  approvedList: ApprovedListEntry[];
}

export interface CompaniesFile {
  schemaVersion: number;
  companies: Company[];
}

// Validation. Malformed data throws a clear, specific error rather than being
// silently accepted, so a corrupt store cannot grant or deny coverage by accident.

function fail(message: string): never {
  throw new Error(`Invalid companies file: ${message}`);
}

function asNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non empty string.`);
  }
  return value as string;
}

function asStringOrNull(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    fail(`${path} must be a string or null.`);
  }
  return value as string;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(`${path} must be a boolean.`);
  }
  return value as boolean;
}

function asPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(`${path} must be a positive integer.`);
  }
  return value as number;
}

const CRITERION_TYPES: ReadonlySet<string> = new Set([
  'email_domain',
  'github_org',
  'github_username',
  'github_id',
]);

/**
 * Interpret an approved list github_id value as a positive integer, or null when
 * it is not a clean positive integer. This deliberately rejects hex ("0x1f"),
 * empty strings, floats, signs, and surrounding whitespace, so a malformed value
 * can never coerce (via Number()) into a false match against an author's id.
 */
export function parseGithubId(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseApprovedEntry(value: unknown, path: string): ApprovedListEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string' || !CRITERION_TYPES.has(raw.type)) {
    fail(`${path}.type must be one of email_domain, github_org, github_username, github_id.`);
  }
  const type = raw.type as ApprovedCriterionType;
  if (typeof raw.value !== 'string' && typeof raw.value !== 'number') {
    fail(`${path}.value must be a string or number.`);
  }
  const entryValue = raw.value as string | number;
  if (type === 'github_id') {
    if (parseGithubId(entryValue) === null) {
      fail(`${path}.value for github_id must be a positive integer.`);
    }
  } else if (typeof entryValue !== 'string' || entryValue.length === 0) {
    fail(`${path}.value for ${type} must be a non empty string.`);
  }
  return { type, value: entryValue };
}

function parseSignatory(value: unknown, path: string): CclaSignatory {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  return {
    name: asNonEmptyString(raw.name, `${path}.name`),
    title: asNonEmptyString(raw.title, `${path}.title`),
  };
}

function parseCcla(value: unknown, path: string): Ccla {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  return {
    versionLabel: asStringOrNull(raw.versionLabel, `${path}.versionLabel`),
    versionHash: asStringOrNull(raw.versionHash, `${path}.versionHash`),
    signatory: parseSignatory(raw.signatory, `${path}.signatory`),
    signedAt: asNonEmptyString(raw.signedAt, `${path}.signedAt`),
    documentRef: asNonEmptyString(raw.documentRef, `${path}.documentRef`),
    active: asBoolean(raw.active, `${path}.active`),
  };
}

function parseManager(value: unknown, path: string): CompanyManager {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  return {
    githubId: asPositiveInteger(raw.githubId, `${path}.githubId`),
    username: asNonEmptyString(raw.username, `${path}.username`),
  };
}

function parseCompany(value: unknown, index: number): Company {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`companies[${index}] must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const path = `companies[${index}]`;
  const name = asNonEmptyString(raw.name, `${path}.name`);
  const ccla = parseCcla(raw.ccla, `${path}.ccla`);
  if (!Array.isArray(raw.managers)) {
    fail(`${path}.managers must be an array.`);
  }
  const managers = raw.managers.map((manager, managerIndex) =>
    parseManager(manager, `${path}.managers[${managerIndex}]`),
  );
  if (!Array.isArray(raw.approvedList)) {
    fail(`${path}.approvedList must be an array.`);
  }
  const approvedList = raw.approvedList.map((entry, entryIndex) =>
    parseApprovedEntry(entry, `${path}.approvedList[${entryIndex}]`),
  );
  return { name, ccla, managers, approvedList };
}

/** Validate an already parsed value into a CompaniesFile, or throw. */
export function parseCompaniesFile(raw: unknown): CompaniesFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('root must be an object.');
  }
  const root = raw as Record<string, unknown>;
  if (typeof root.schemaVersion !== 'number') {
    fail('schemaVersion must be a number.');
  }
  if (!Array.isArray(root.companies)) {
    fail('companies must be an array.');
  }
  const companies = root.companies.map((entry, index) => parseCompany(entry, index));
  return { schemaVersion: root.schemaVersion, companies };
}

export interface CoveringMatch {
  company: string;
  criterionType: ApprovedCriterionType;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Find the first active company whose approved list covers the author, or null.
 *
 * The author's public email is fetched at most once, and only if an email_domain
 * criterion is actually reached. If no email is available that criterion cannot
 * match and is skipped without error.
 */
export async function findCoveringCompany(
  file: CompaniesFile,
  author: Author,
  queries: GitHubIdentityQueries,
): Promise<CoveringMatch | null> {
  // undefined means "not looked up yet"; null means "looked up, none published".
  let email: string | null | undefined;

  for (const company of file.companies) {
    if (!company.ccla || company.ccla.active !== true) continue;

    for (const entry of company.approvedList) {
      switch (entry.type) {
        case 'github_id': {
          const wanted = parseGithubId(entry.value);
          if (wanted !== null && author.githubId === wanted) {
            return { company: company.name, criterionType: 'github_id' };
          }
          break;
        }
        case 'github_username': {
          if (author.login.toLowerCase() === String(entry.value).toLowerCase()) {
            return { company: company.name, criterionType: 'github_username' };
          }
          break;
        }
        case 'github_org': {
          if (await queries.isPublicOrgMember(String(entry.value), author.login)) {
            return { company: company.name, criterionType: 'github_org' };
          }
          break;
        }
        case 'email_domain': {
          if (email === undefined) {
            email = await queries.getPublicEmail(author.login);
          }
          if (email) {
            const domain = domainOf(email);
            if (domain && domain === String(entry.value).toLowerCase()) {
              return { company: company.name, criterionType: 'email_domain' };
            }
          }
          break;
        }
      }
    }
  }

  return null;
}

/** Build the read only company store backed by the store repository. */
export function createCompanyStore(
  client: Octokit,
  owner: string,
  repo: string,
  path: string,
): CompanyStore {
  return {
    async read(): Promise<CompaniesFile> {
      const file = await readStoreFile(client, owner, repo, path);
      return parseCompaniesFile(JSON.parse(file.text));
    },
  };
}
