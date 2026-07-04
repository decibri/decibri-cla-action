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

/**
 * The single org this system serves. Every allowlist entry is a bare repository
 * name under this org, and the hard org gate refuses any repository whose owner
 * is not this org. Defined once here so the prefix and the gate cannot drift.
 */
export const DECIBRI_ORG = 'decibri';

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
  /**
   * Bare repository names (no owner) this system will act on, each implicitly
   * under DECIBRI_ORG. An entry containing a `/` is rejected, so a foreign owner
   * can never be smuggled into the list.
   */
  allowedRepos: string[];
}

/** An agreement is active once it carries a non empty version hash. */
export function isAgreementActive(agreement: AgreementConfig): boolean {
  return typeof agreement.versionHash === 'string' && agreement.versionHash.length > 0;
}

/**
 * The hard org-owner gate: case insensitive check that the repository owner is
 * DECIBRI_ORG. This is structural and independent of allowedRepos, so no
 * repository outside the org can run the Action regardless of config.
 */
export function isOrgOwnerAllowed(owner: string): boolean {
  return owner.toLowerCase() === DECIBRI_ORG;
}

/**
 * Case insensitive check that a repository full name is enrolled. Allowlist
 * entries are bare repository names; each is prefixed with `${DECIBRI_ORG}/`
 * before comparison. An entry that already contains a `/` is rejected (never
 * matched) and reported through the optional warn callback, so a config injected
 * entry like "attacker/evil" cannot enroll a foreign owner.
 */
export function isRepoAllowed(
  config: ClaConfig,
  repoFullName: string,
  warn: (message: string) => void = () => {},
): boolean {
  const target = repoFullName.toLowerCase();
  let allowed = false;
  for (const repo of config.allowedRepos) {
    if (repo.includes('/')) {
      warn(
        `Ignoring allowedRepos entry "${repo}": entries must be bare repository names without an owner (for example "decibri").`,
      );
      continue;
    }
    if (`${DECIBRI_ORG}/${repo}`.toLowerCase() === target) {
      allowed = true;
    }
  }
  return allowed;
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
