// The orchestrator: given a normalised event context and the gateway seams, run
// the CLA flow. This is where checks and comments are wired together with the
// coverage decision, the individual signing flow, the recheck command, and the
// lock on merge. It depends only on the interfaces in gateways.ts, so the whole
// dispatch (including the dry-run path) is exercised by tests with in memory
// fakes and no network access.
//
// The dry-run contract is simple and enforced structurally: every mutating
// gateway call lives past a `dryRun` guard, so a dry run only reads and logs.

import { isAgreementActive, isRepoAllowed, type ClaConfig } from './config';
import { checkConclusion, checkSummary, checkTitle } from './checks';
import {
  buildPromptComment,
  isAssentPhrase,
  isClaBotComment,
  isManagedPromptComment,
  isRecheckCommand,
} from './comments';
import { decideCoverage, type CoverageDecision } from './coverage';
import { buildSignatureRecord } from './signatures';
import type {
  CheckGateway,
  CommentGateway,
  CompanyStore,
  PullRequestGateway,
  PullRequestInfo,
  SignatureStore,
} from './gateways';
import type { Author, GitHubIdentityQueries } from './types';

// A minimal logger, satisfied by @actions/core in production and a capturing
// fake in tests. Errors are thrown and handled by the entry point.
export interface Logger {
  info(message: string): void;
  warning(message: string): void;
  notice(message: string): void;
}

export interface PullRequestPayload {
  number: number;
  head: { sha: string };
  user: { id: number; login: string };
  merged?: boolean;
  state?: string;
}

export interface CommentPayload {
  id: number;
  body: string;
  user: { id: number; login: string };
  html_url: string;
}

export interface IssuePayload {
  number: number;
  pull_request?: unknown;
  user?: { id: number; login: string };
}

export interface MergeGroupPayload {
  headSha: string;
}

export interface RunContext {
  eventName: string;
  action?: string;
  owner: string;
  repo: string;
  pullRequest?: PullRequestPayload;
  comment?: CommentPayload;
  issue?: IssuePayload;
  mergeGroup?: MergeGroupPayload;
}

export interface RunDeps {
  context: RunContext;
  config: ClaConfig;
  dryRun: boolean;
  checks: CheckGateway;
  comments: CommentGateway;
  pulls: PullRequestGateway;
  signatureStore: SignatureStore;
  companyStore: CompanyStore;
  queries: GitHubIdentityQueries;
  log: Logger;
  now: () => string;
}

interface PrRef {
  number: number;
  headSha: string;
}

export async function runCla(deps: RunDeps): Promise<void> {
  const { context, config, log } = deps;
  const repoFullName = `${context.owner}/${context.repo}`;

  // Multi repo guard: refuse to act on a repository that is not enrolled.
  if (!isRepoAllowed(config, repoFullName)) {
    log.info(`Repository ${repoFullName} is not in allowedRepos. Exiting without action.`);
    return;
  }

  switch (context.eventName) {
    case 'pull_request_target':
    case 'pull_request':
      await handlePullRequestEvent(deps);
      return;
    case 'issue_comment':
      await handleIssueCommentEvent(deps, repoFullName);
      return;
    case 'merge_group':
      await handleMergeGroupEvent(deps);
      return;
    default:
      log.info(`Event ${context.eventName} is not handled by the CLA system. Nothing to do.`);
  }
}

async function handleMergeGroupEvent(deps: RunDeps): Promise<void> {
  const { context, config, dryRun, log } = deps;
  const mergeGroup = context.mergeGroup;
  if (!mergeGroup) {
    log.warning('A merge_group event arrived without a merge_group payload; skipping.');
    return;
  }
  // Coverage was already decided on the original pull request. The merge queue
  // creates a fresh head commit that needs the check set, so pass it directly.
  log.info(
    `Merge queue head ${mergeGroup.headSha}: coverage was verified on the original pull request; passing the ${config.checkName} check.`,
  );
  if (dryRun) {
    log.info(`[dry-run] would set the ${config.checkName} check to success on ${mergeGroup.headSha}.`);
    return;
  }
  await deps.checks.setCheck({
    headSha: mergeGroup.headSha,
    name: config.checkName,
    conclusion: 'success',
    title: 'CLA satisfied',
    summary: 'Coverage was verified on the original pull request.',
  });
}

async function evaluate(deps: RunDeps, author: Author): Promise<CoverageDecision> {
  const [signatures, companies] = await Promise.all([
    deps.signatureStore.read(),
    deps.companyStore.read(),
  ]);
  return decideCoverage({
    author,
    org: deps.context.owner,
    config: deps.config,
    signatures,
    companies,
    queries: deps.queries,
  });
}

async function handlePullRequestEvent(deps: RunDeps): Promise<void> {
  const { context, config, dryRun, log } = deps;
  const pr = context.pullRequest;
  if (!pr) {
    log.warning('A pull_request event arrived without a pull_request payload; skipping.');
    return;
  }

  if (context.action === 'closed') {
    if (pr.merged && config.lockPrOnMerge) {
      if (dryRun) {
        log.info(`[dry-run] would lock merged pull request #${pr.number} to preserve the signing comment.`);
        return;
      }
      await deps.pulls.lockPullRequest(pr.number);
      log.info(`Locked merged pull request #${pr.number} to preserve the signing comment.`);
    }
    return;
  }

  const author: Author = { githubId: pr.user.id, login: pr.user.login };
  const decision = await evaluate(deps, author);
  log.info(
    `CLA decision for ${author.login} on #${pr.number}: covered=${decision.covered}, reason=${decision.reason}. ${decision.detail}`,
  );

  if (dryRun) {
    log.info(
      `[dry-run] would set the ${config.checkName} check to ${checkConclusion(decision)} on ${pr.head.sha} and ` +
        `${decision.covered ? 'remove any signing prompt' : 'post the signing prompt'}.`,
    );
    return;
  }

  await applyDecision(deps, { number: pr.number, headSha: pr.head.sha }, decision);
}

async function handleIssueCommentEvent(deps: RunDeps, repoFullName: string): Promise<void> {
  const { context, config, dryRun, log } = deps;
  if (context.action !== 'created') {
    log.info(`Ignoring issue_comment action ${context.action ?? '(none)'}.`);
    return;
  }
  const comment = context.comment;
  const issue = context.issue;
  if (!comment || !issue) {
    log.warning('An issue_comment event arrived without the expected payload; skipping.');
    return;
  }
  if (!issue.pull_request) {
    log.info('Comment is not on a pull request; ignoring.');
    return;
  }

  const body = comment.body ?? '';
  // Never react to our own comments.
  if (isClaBotComment(body)) {
    return;
  }

  const commenter: Author = { githubId: comment.user.id, login: comment.user.login };
  const prNumber = issue.number;

  if (isRecheckCommand(body)) {
    log.info(`Recheck requested on #${prNumber} by ${commenter.login}.`);
    const pr = await deps.pulls.getPullRequest(prNumber);
    const decision = await evaluate(deps, pr.author);
    log.info(
      `Recheck decision for ${pr.author.login} on #${prNumber}: covered=${decision.covered}, reason=${decision.reason}.`,
    );
    if (dryRun) {
      log.info(`[dry-run] would update the ${config.checkName} check on #${prNumber}.`);
      return;
    }
    await applyDecision(deps, { number: pr.number, headSha: pr.headSha }, decision);
    return;
  }

  if (isAssentPhrase(body, config.assentPhraseIcla)) {
    await handleSigning(deps, repoFullName, prNumber, commenter, comment.html_url);
  }
}

async function handleSigning(
  deps: RunDeps,
  repoFullName: string,
  prNumber: number,
  commenter: Author,
  commentUrl: string,
): Promise<void> {
  const { config, dryRun, log } = deps;

  const pr = await deps.pulls.getPullRequest(prNumber);
  if (commenter.githubId !== pr.author.githubId) {
    log.info(
      `Comment from ${commenter.login} is not the pull request author (${pr.author.login}); not recording a signature.`,
    );
    return;
  }

  if (!isAgreementActive(config.icla)) {
    log.warning('The ICLA has no active version yet, so signing is not enabled. No signature recorded.');
    return;
  }

  if (dryRun) {
    log.info(
      `[dry-run] would record an individual signature for ${commenter.login} (id ${commenter.githubId}) and pass the ${config.checkName} check.`,
    );
    return;
  }

  const record = buildSignatureRecord({
    author: commenter,
    claVersionLabel: config.icla.versionLabel,
    // Guaranteed non null because the agreement is active.
    claVersionHash: config.icla.versionHash as string,
    assentPhrase: config.assentPhraseIcla,
    signedAt: deps.now(),
    signedInRepo: repoFullName,
    prNumber,
    commentUrl,
  });
  await deps.signatureStore.append(
    record,
    `chore(signatures): record CLA signature for ${commenter.login} (${repoFullName}#${prNumber})`,
  );
  log.info(`Recorded individual signature for ${commenter.login}.`);

  // Pass the check and clear the prompt on the signer's open pull requests. If
  // none are listed (for example in a minimal test), fall back to this one.
  const open = await deps.pulls.listOpenPullRequests();
  const authored = open.filter((candidate) => candidate.author.githubId === commenter.githubId);
  const targets: PullRequestInfo[] = authored.length > 0 ? authored : [pr];
  for (const target of targets) {
    await deps.checks.setCheck({
      headSha: target.headSha,
      name: config.checkName,
      conclusion: 'success',
      title: 'CLA satisfied',
      summary: `${commenter.login} has signed the decibri Individual CLA.`,
    });
    await removePromptComments(deps, target.number);
  }
}

async function applyDecision(
  deps: RunDeps,
  pr: PrRef,
  decision: CoverageDecision,
): Promise<void> {
  await deps.checks.setCheck({
    headSha: pr.headSha,
    name: deps.config.checkName,
    conclusion: checkConclusion(decision),
    title: checkTitle(decision),
    summary: checkSummary(decision, deps.config.assentPhraseIcla),
  });

  if (decision.covered) {
    await removePromptComments(deps, pr.number);
  } else {
    await ensurePromptComment(deps, pr.number);
  }
}

async function ensurePromptComment(deps: RunDeps, prNumber: number): Promise<void> {
  const existing = await deps.comments.listComments(prNumber);
  if (existing.some((comment) => isManagedPromptComment(comment))) {
    // Our prompt is already posted; do not add another.
    return;
  }
  await deps.comments.createComment(prNumber, buildPromptComment(deps.config));
}

async function removePromptComments(deps: RunDeps, prNumber: number): Promise<void> {
  const existing = await deps.comments.listComments(prNumber);
  for (const comment of existing) {
    // Only ever delete the Action's own prompt comments, never a contributor's.
    if (isManagedPromptComment(comment)) {
      await deps.comments.deleteComment(comment.id);
    }
  }
}
