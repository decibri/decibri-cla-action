// The CLA prompt comment: an internal marker so the Action only ever edits or
// deletes its own comments, the comment body, the helpers that recognise the
// assent phrase and the recheck command, and the Octokit backed comment gateway.

import type { ClaConfig } from './config';
import type { CommentGateway, IssueComment } from './gateways';
import type { Octokit } from './github';

/**
 * The single canonical privacy notice for CLA processing. The prompt comment
 * links here directly; the duplicate privacy file that used to live in this
 * repository has been retired so two notices cannot drift apart.
 */
export const PRIVACY_POLICY_URL = 'https://decibri.com/privacy';

/**
 * Hidden marker embedded in every comment the Action posts. The Action only ever
 * edits or deletes comments carrying this marker, so it can never touch a
 * contributor's own comments (including their signing comment).
 */
export const CLA_COMMENT_MARKER = '<!-- decibri-cla -->';

/** True when a comment body carries the internal marker. */
export function isClaBotComment(body: string): boolean {
  return body.includes(CLA_COMMENT_MARKER);
}

/**
 * True when a comment is a prompt the Action itself posted: it carries the marker
 * AND was authored by a bot or app account. The Action posts through the calling
 * repository's GITHUB_TOKEN, so its comments are authored by github-actions[bot]
 * (or the app account, if an App is used). Requiring a bot author means a
 * contributor who merely quotes the marker in their own comment is never treated
 * as the Action's comment, so their comment can never be edited or deleted.
 */
export function isManagedPromptComment(comment: {
  body: string;
  author: { login: string };
}): boolean {
  return isClaBotComment(comment.body) && comment.author.login.toLowerCase().endsWith('[bot]');
}

/** True when the trimmed comment body is exactly the assent phrase. */
export function isAssentPhrase(body: string, assentPhrase: string): boolean {
  return body.trim() === assentPhrase.trim();
}

/** True when the trimmed comment body is the recheck command. */
export function isRecheckCommand(body: string): boolean {
  return body.trim().toLowerCase() === 'recheck';
}

// File links in the prompt comment (the CLA text and the contributing guide)
// must point at the PUBLIC files in this repository, never at the private
// signature store repo, which returns 404 for contributors who are not members.
// The default repo below is a fallback for local and test runs; at runtime the
// values come from the action's own coordinates.
const DEFAULT_ACTION_REPO = 'decibri/decibri-cla-action';

/**
 * Public base URL for links in the prompt comment, of the form
 * `https://github.com/{owner}/{repo}/blob/{ref}`. The owner/repo comes from
 * GITHUB_ACTION_REPOSITORY and the ref from GITHUB_ACTION_REF, which GitHub sets
 * to this action's own coordinates and the ref the caller pinned (for example
 * `v1`). Deriving the base this way keeps the links pointed at exactly the
 * version that is running, and stops them silently drifting back to the private
 * store repo. Both fall back to sensible defaults when the variables are absent.
 */
export function publicRepoBase(env: NodeJS.ProcessEnv = process.env): string {
  const repo = env.GITHUB_ACTION_REPOSITORY || DEFAULT_ACTION_REPO;
  const ref = env.GITHUB_ACTION_REF || 'main';
  return `https://github.com/${repo}/blob/${ref}`;
}

function fileUrl(base: string, path: string): string {
  return `${base}/${encodeURI(path)}`;
}

/** Build the signing prompt comment, tagged with the internal marker. */
export function buildPromptComment(config: ClaConfig): string {
  const base = publicRepoBase();
  const iclaUrl = fileUrl(base, config.icla.file);
  const contributingUrl = fileUrl(base, 'CONTRIBUTING.md');
  return [
    CLA_COMMENT_MARKER,
    '## Sign the Contributor License Agreement',
    '',
    'Before this pull request can be merged, we need you to sign the Contributor License Agreement. It is one step.',
    '',
    '**Copy the line below and paste it as a new comment on this pull request, from your own account:**',
    '',
    '```',
    config.assentPhraseIcla,
    '```',
    '',
    `The CLA check turns green as soon as you post that comment. By posting it you confirm that you have read the [decibri Individual Contributor License Agreement](${iclaUrl}).`,
    '',
    '<details>',
    '<summary>What you are agreeing to, and what we store</summary>',
    '',
    'We record only your GitHub account ID and username, the agreement version, the date and time, and a reference to this pull request. We do not store your email, IP address, or device information. See our ' +
      `[privacy notice](${PRIVACY_POLICY_URL}).`,
    '',
    `Contributing on behalf of an employer? Your employer may need a Corporate CLA on file. See the [contributing guide](${contributingUrl}).`,
    '',
    '</details>',
  ].join('\n');
}

/** Build the Octokit backed comment gateway for the calling repository. */
export function createCommentGateway(client: Octokit, owner: string, repo: string): CommentGateway {
  return {
    async listComments(prNumber: number): Promise<IssueComment[]> {
      const comments = await client.paginate(client.rest.issues.listComments, {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      });
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body ?? '',
        author: {
          githubId: comment.user?.id ?? 0,
          login: comment.user?.login ?? '',
        },
        htmlUrl: comment.html_url,
      }));
    },

    async createComment(prNumber: number, body: string): Promise<void> {
      await client.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
    },

    async deleteComment(commentId: number): Promise<void> {
      await client.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: commentId,
      });
    },
  };
}
