// Reading and writing a JSON file in the store repository through the store
// client. These helpers take an already built client, so this module has no
// runtime dependency on Octokit construction (only a type import), which keeps
// the pure data modules that use it free of network code in tests.

import type { Octokit } from './github';

export interface StoreFile {
  text: string;
  sha: string;
}

/** Read a file's decoded text and blob SHA from the store repository. */
export async function readStoreFile(
  client: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<StoreFile> {
  const response = await client.rest.repos.getContent({ owner, repo, path });
  const data = response.data;
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Expected a single file at ${owner}/${repo}/${path}.`);
  }
  const text = Buffer.from(data.content, 'base64').toString('utf8');
  return { text, sha: data.sha };
}

/** Create or update a file in the store repository, given its current blob SHA. */
export async function writeStoreFile(
  client: Octokit,
  owner: string,
  repo: string,
  path: string,
  text: string,
  sha: string,
  message: string,
): Promise<void> {
  await client.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(text, 'utf8').toString('base64'),
    sha,
  });
}
