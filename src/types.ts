// Shared domain types for the decibri CLA system.
//
// Identity is kept deliberately minimal. Only the immutable GitHub numeric ID and
// the login are ever used for identity, and only those two are stored. No email,
// IP address, user agent, or session data appears in this shape or is written by
// any code path in this system.

/**
 * The minimal identity of a pull request author or commenter.
 */
export interface Author {
  /** Immutable numeric GitHub account ID. This is the identity key. */
  githubId: number;
  /** GitHub login. Stored for readability only, because logins can be renamed. */
  login: string;
  /** Account type as reported by the GitHub API, used for bot handling. Optional. */
  type?: 'User' | 'Bot' | 'Organization' | (string & {});
}

/**
 * Read only queries against GitHub that the coverage decision depends on.
 *
 * This interface is the seam that keeps the coverage logic pure and testable: the
 * real implementation in github.ts is backed by Octokit, and tests supply a fake.
 * Nothing here mutates state.
 */
export interface GitHubIdentityQueries {
  /**
   * True if the login is a member of the given org, at whatever visibility the
   * calling token can see. Used for the org member bypass.
   */
  isOrgMember(org: string, login: string): Promise<boolean>;

  /**
   * True if the login is a public member of the given org. Used for the
   * corporate approved list `github_org` criterion.
   */
  isPublicOrgMember(org: string, login: string): Promise<boolean>;

  /**
   * The account's public email if one is published on the profile, otherwise
   * null. Used for the corporate approved list `email_domain` criterion. When no
   * email is available the criterion simply cannot match; it is never guessed.
   */
  getPublicEmail(login: string): Promise<string | null>;
}
