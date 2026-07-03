// Loading and validation for config/cla.config.json.
//
// The config carries the version labels and hashes for each agreement, the
// enforcement switches, the bot and app bypass list, and the repository
// allowlist. Version fields are null until the operator finalises an agreement
// and runs the hash helper; while they are null that agreement is treated as not
// yet active (see isAgreementActive).

import { readFileSync } from 'node:fs';
import { actionPath } from './paths';

export interface AgreementConfig {
  /** Path to the agreement markdown file, relative to the repository root. */
  file: string;
  /** Human readable version label, for example "icla-v1". Null until assigned. */
  versionLabel: string | null;
  /** SHA-256 of the agreement text as "sha256:<hex>". Null until computed. */
  versionHash: string | null;
}

export interface ClaConfig {
  icla: AgreementConfig;
  ccla: AgreementConfig;
  /** The exact phrase an individual comments to sign the ICLA. */
  assentPhraseIcla: string;
  /** The name of the status check the Action sets, for example "CLA". */
  checkName: string;
  /** When true, members of the repository owner org bypass the CLA. */
  orgMembersBypass: boolean;
  /** When true, merged pull requests are locked to preserve signing comments. */
  lockPrOnMerge: boolean;
  /** Logins (bare slug or slug[bot]) that bypass the CLA. */
  botAndAppBypass: string[];
  /** Full names (owner/repo) of repositories this system will act on. */
  allowedRepos: string[];
}

/** An agreement is active once it carries a non empty version hash. */
export function isAgreementActive(agreement: AgreementConfig): boolean {
  return typeof agreement.versionHash === 'string' && agreement.versionHash.length > 0;
}

/** Case insensitive check that a repository full name is in the allowlist. */
export function isRepoAllowed(config: ClaConfig, repoFullName: string): boolean {
  const target = repoFullName.toLowerCase();
  return config.allowedRepos.some((repo) => repo.toLowerCase() === target);
}

// Validation helpers. Each throws a clear, specific error on malformed data so a
// misconfigured file fails loudly rather than silently misbehaving.

function fail(message: string): never {
  throw new Error(`Invalid CLA config: ${message}`);
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non empty string.`);
  }
  return value as string;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(`${path} must be a boolean.`);
  }
  return value as boolean;
}

function asStringOrNull(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    fail(`${path} must be a string or null.`);
  }
  return value as string;
}

function asStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(`${path} must be an array of strings.`);
  }
  return value as string[];
}

function parseAgreement(value: unknown, path: string): AgreementConfig {
  const raw = asObject(value, path);
  return {
    file: asString(raw.file, `${path}.file`),
    versionLabel: asStringOrNull(raw.versionLabel, `${path}.versionLabel`),
    versionHash: asStringOrNull(raw.versionHash, `${path}.versionHash`),
  };
}

/** Validate an already parsed value into a ClaConfig, or throw. */
export function parseConfig(raw: unknown): ClaConfig {
  const root = asObject(raw, 'config');
  return {
    icla: parseAgreement(root.icla, 'icla'),
    ccla: parseAgreement(root.ccla, 'ccla'),
    assentPhraseIcla: asString(root.assentPhraseIcla, 'assentPhraseIcla'),
    checkName: asString(root.checkName, 'checkName'),
    orgMembersBypass: asBoolean(root.orgMembersBypass, 'orgMembersBypass'),
    lockPrOnMerge: asBoolean(root.lockPrOnMerge, 'lockPrOnMerge'),
    botAndAppBypass: asStringArray(root.botAndAppBypass, 'botAndAppBypass'),
    allowedRepos: asStringArray(root.allowedRepos, 'allowedRepos'),
  };
}

/**
 * Read and validate the config file from disk. The default path is resolved
 * against this Action's own root (see paths.ts), so it is read from the Action's
 * bundle and not from the calling repository's working directory.
 */
export function loadConfig(path = actionPath('config/cla.config.json')): ClaConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Unable to read CLA config at ${path}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`CLA config at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}
