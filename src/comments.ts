// The CLA prompt comment: an internal marker so the Action only ever edits or
// deletes its own comments, the comment body, the helpers that recognise the
// assent phrase and the recheck command, and the Octokit backed comment gateway.

import type { ClaConfig } from './config';
import type { CommentGateway, IssueComment } from './gateways';
import type { Octokit } from './github';

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

function fileUrl(storeRepo: string, path: string): string {
  return `https://github.com/${storeRepo}/blob/main/${encodeURI(path)}`;
}

/** Build the signing prompt comment, tagged with the internal marker. */
export function buildPromptComment(config: ClaConfig, storeRepo: string): string {
  const iclaUrl = fileUrl(storeRepo, config.icla.file);
  const privacyUrl = fileUrl(storeRepo, 'PRIVACY.md');
  const contributionsUrl = fileUrl(storeRepo, 'CONTRIBUTIONS.md');
  return [
    CLA_COMMENT_MARKER,
    'Thanks for contributing to decibri. Before this pull request can be merged, we need a signed Contributor License Agreement from you.',
    '',
    'To sign the Individual CLA, add a comment to this pull request containing exactly this line, from your own account:',
    '',
    `> ${config.assentPhraseIcla}`,
    '',
    `By signing you confirm that you have read the [decibri Individual Contributor License Agreement](${iclaUrl}).`,
    '',
    `Contributing on behalf of an employer? Your employer may need a Corporate CLA on file. See [CONTRIBUTIONS](${contributionsUrl}).`,
    '',
    'We record only your GitHub account ID and username, the agreement version, the date and time, and a reference to this pull request. We do not store your email, IP address, or device information. See our ' +
      `[privacy notice](${privacyUrl}).`,
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
