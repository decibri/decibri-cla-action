// The coverage decision: given a pull request author and the current state, work
// out whether the author is covered by a valid CLA, and why.
//
// This is the heart of the system and is deliberately pure: it takes already
// loaded config and data plus a queries seam, and returns a decision. It performs
// no writes and no direct GitHub calls, which is what makes it fully unit
// testable. The evaluation order matches the enforcement flow in the README.

import { isAgreementActive, type ClaConfig } from './config';
import { findCoveringCompany, type ApprovedCriterionType, type CompaniesFile } from './companies';
import { findLatestSignature, isSignatureCurrent, type SignaturesFile } from './signatures';
import type { Author, GitHubIdentityQueries } from './types';

export type CoverageReason =
  | 'org_member'
  | 'bot_or_app_bypass'
  | 'individual_signature'
  | 'ccla_github_id'
  | 'ccla_github_username'
  | 'ccla_github_org'
  | 'ccla_email_domain'
  | 'cla_not_active'
  | 'outdated_signature'
  | 'unsigned';

export interface CoverageDecision {
  covered: boolean;
  reason: CoverageReason;
  /** Human readable detail for logs and comments. Contains no data beyond the login. */
  detail: string;
  /** Set when coverage came from a corporate CLA. */
  company?: string;
}

export interface CoverageInput {
  author: Author;
  /** The org that owns the repository, used for the org member bypass. */
  org: string;
  config: ClaConfig;
  signatures: SignaturesFile;
  companies: CompaniesFile;
  queries: GitHubIdentityQueries;
}

const BOT_SUFFIX = '[bot]';

/** Normalise a login so that a bare slug and its slug[bot] form compare equal. */
function normaliseLogin(login: string): string {
  const lower = login.toLowerCase();
  return lower.endsWith(BOT_SUFFIX) ? lower.slice(0, -BOT_SUFFIX.length) : lower;
}

/** True when the author matches an entry on the bot and app bypass list. */
export function isBypassedBotOrApp(author: Author, bypassList: string[]): boolean {
  if (!bypassList || bypassList.length === 0) return false;
  const target = normaliseLogin(author.login);
  return bypassList.some((entry) => normaliseLogin(entry) === target);
}

function cclaReason(criterionType: ApprovedCriterionType): CoverageReason {
  switch (criterionType) {
    case 'github_id':
      return 'ccla_github_id';
    case 'github_username':
      return 'ccla_github_username';
    case 'github_org':
      return 'ccla_github_org';
    case 'email_domain':
      return 'ccla_email_domain';
  }
}

/**
 * Decide whether the author is covered. Returns pass or fail with a machine
 * readable reason and a human readable detail. Never throws for the normal cases;
 * a thrown error means a query or data problem the caller should surface.
 */
export async function decideCoverage(input: CoverageInput): Promise<CoverageDecision> {
  const { author, org, config, signatures, companies, queries } = input;

  // 1. Org member bypass.
  if (config.orgMembersBypass && (await queries.isOrgMember(org, author.login))) {
    return {
      covered: true,
      reason: 'org_member',
      detail: `${author.login} is a member of the ${org} organisation.`,
    };
  }

  // 2. Bot or app bypass.
  if (isBypassedBotOrApp(author, config.botAndAppBypass)) {
    return {
      covered: true,
      reason: 'bot_or_app_bypass',
      detail: `${author.login} is on the bot and app bypass list.`,
    };
  }

  // 3. Current individual signature (only meaningful when the ICLA is active).
  const iclaActive = isAgreementActive(config.icla);
  const latest = findLatestSignature(signatures, author.githubId);
  if (iclaActive && latest && isSignatureCurrent(latest, config.icla.versionHash)) {
    return {
      covered: true,
      reason: 'individual_signature',
      detail: `${author.login} has a current individual CLA signature.`,
    };
  }

  // 4. Active corporate CLA coverage.
  const covering = await findCoveringCompany(companies, author, queries);
  if (covering) {
    return {
      covered: true,
      reason: cclaReason(covering.criterionType),
      detail: `${author.login} is covered by the corporate CLA for ${covering.company}.`,
      company: covering.company,
    };
  }

  // 5. Not covered.
  if (!iclaActive) {
    // The ICLA has no finalised version yet, so individual enforcement is dormant.
    // Contributors are not blocked until the operator activates the agreement.
    return {
      covered: true,
      reason: 'cla_not_active',
      detail: 'The individual CLA has no active version, so enforcement is dormant.',
    };
  }
  if (latest) {
    return {
      covered: false,
      reason: 'outdated_signature',
      detail: `${author.login} signed an earlier CLA version and needs to re-sign.`,
    };
  }
  return {
    covered: false,
    reason: 'unsigned',
    detail: `${author.login} has not signed the CLA.`,
  };
}
