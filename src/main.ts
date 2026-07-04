// Action entry point.
//
// This gathers the real inputs, event context, and Octokit backed gateways, then
// delegates all decision making and side effects to runCla in run.ts. It never
// checks out or executes untrusted pull request code, and never logs a token.

import * as core from '@actions/core';
import { context } from '@actions/github';
import { createCompanyStore } from './companies';
import { loadConfig } from './config';
import { actionPath } from './paths';
import { createCheckGateway } from './checks';
import { createCommentGateway } from './comments';
import {
  createIdentityQueries,
  createLocalClient,
  createPullRequestGateway,
  createStoreClient,
} from './github';
import { runCla, type RunContext } from './run';
import { createSignatureStore } from './signatures';

function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`store-repo must be in the form owner/repo, received "${fullName}".`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function toRunContext(): RunContext {
  const payload = context.payload as any;
  return {
    eventName: context.eventName,
    action: payload.action,
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullRequest: payload.pull_request
      ? {
          number: payload.pull_request.number,
          head: { sha: payload.pull_request.head?.sha },
          user: {
            id: payload.pull_request.user?.id,
            login: payload.pull_request.user?.login,
          },
          merged: payload.pull_request.merged,
          state: payload.pull_request.state,
        }
      : undefined,
    comment: payload.comment
      ? {
          id: payload.comment.id,
          body: payload.comment.body ?? '',
          user: { id: payload.comment.user?.id, login: payload.comment.user?.login },
          html_url: payload.comment.html_url,
        }
      : undefined,
    issue: payload.issue
      ? {
          number: payload.issue.number,
          pull_request: payload.issue.pull_request,
          user: payload.issue.user
            ? { id: payload.issue.user.id, login: payload.issue.user.login }
            : undefined,
        }
      : undefined,
    mergeGroup: payload.merge_group
      ? { headSha: payload.merge_group.head_sha }
      : undefined,
  };
}

async function run(): Promise<void> {
  const storeToken = core.getInput('store-token');
  const githubToken = core.getInput('github-token');
  // The config lives in this Action's own bundle, not the calling repository, so
  // resolve the config-path input against the Action root. An absolute override
  // passes through unchanged.
  const configPath = actionPath(core.getInput('config-path') || 'config/cla.config.json');
  const storeRepo = core.getInput('store-repo') || 'decibri/decibri-cla';
  const dryRun = core.getBooleanInput('dry-run');

  if (!storeToken) {
    core.setFailed(
      'The store-token input is missing. Set the CLA_STORE_TOKEN secret with Contents read and write on decibri/decibri-cla.',
    );
    return;
  }
  if (!githubToken) {
    core.setFailed('A github-token is required for the calling repository.');
    return;
  }

  const config = loadConfig(configPath);
  const { owner: storeOwner, repo: storeRepoName } = parseRepoFullName(storeRepo);

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const local = createLocalClient(githubToken);
  const store = createStoreClient(storeToken);

  await runCla({
    context: toRunContext(),
    config,
    dryRun,
    checks: createCheckGateway(local, owner, repo),
    comments: createCommentGateway(local, owner, repo),
    pulls: createPullRequestGateway(local, owner, repo),
    signatureStore: createSignatureStore(store, storeOwner, storeRepoName, 'data/signatures.json'),
    companyStore: createCompanyStore(store, storeOwner, storeRepoName, 'data/companies.json'),
    queries: createIdentityQueries(local),
    log: {
      info: (message: string) => core.info(message),
      warning: (message: string) => core.warning(message),
      notice: (message: string) => core.notice(message),
    },
    now: () => new Date().toISOString(),
  });
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
