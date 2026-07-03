// The GitHub operation seams the orchestrator depends on.
//
// Every side effect the Action performs (setting the check, listing/creating/
// deleting comments, reading pull requests, locking a merged pull request, and
// reading/appending the signature and company stores) is expressed as a narrow
// interface here. The Octokit backed implementations live in checks.ts,
// comments.ts, signatures.ts, companies.ts, and github.ts. The orchestrator in
// run.ts depends only on these interfaces, which is what lets the whole dispatch,
// including the dry-run path, be tested against in memory fakes with no network.

import type { Author } from './types';
import type { SignatureRecord, SignaturesFile } from './signatures';
import type { CompaniesFile } from './companies';

export type CheckConclusion = 'success' | 'failure';

/** The pull request facts the orchestrator needs, normalised from the API. */
export interface PullRequestInfo {
  number: number;
  headSha: string;
  author: Author;
  state: 'open' | 'closed';
  merged: boolean;
}

/** A single issue (pull request) comment, normalised from the API. */
export interface IssueComment {
  id: number;
  body: string;
  author: Author;
  htmlUrl: string;
}

export interface CheckGateway {
  setCheck(params: {
    headSha: string;
    name: string;
    conclusion: CheckConclusion;
    title: string;
    summary: string;
  }): Promise<void>;
}

export interface CommentGateway {
  listComments(prNumber: number): Promise<IssueComment[]>;
  createComment(prNumber: number, body: string): Promise<void>;
  deleteComment(commentId: number): Promise<void>;
}

export interface PullRequestGateway {
  getPullRequest(prNumber: number): Promise<PullRequestInfo>;
  listOpenPullRequests(): Promise<PullRequestInfo[]>;
  lockPullRequest(prNumber: number): Promise<void>;
}

/** Read and append the individual signature store in the store repository. */
export interface SignatureStore {
  read(): Promise<SignaturesFile>;
  append(record: SignatureRecord, commitMessage: string): Promise<void>;
}

/** Read the corporate agreement store in the store repository. */
export interface CompanyStore {
  read(): Promise<CompaniesFile>;
}
