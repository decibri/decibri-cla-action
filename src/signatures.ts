// The individual signature store: types, validation, and the pure query and
// append helpers over data/signatures.json.
//
// The file is append only in practice: signatures are never mutated or deleted
// in the normal flow, so the git history is a tamper evident record of who
// agreed to which version and when. The actual read and commit against the store
// repository is wired separately; the functions here operate on already parsed
// data so they stay pure and testable.

import type { SignatureStore } from './gateways';
import type { Octokit } from './github';
import { readStoreFile, writeStoreFile } from './store-io';
import type { Author } from './types';

export interface SignatureRecord {
  type: 'individual';
  /** Immutable numeric GitHub account ID. The identity key. */
  githubId: number;
  /** Login at signing time, for readability only. */
  username: string;
  /** Version label of the ICLA that was signed, for example "icla-v1". */
  claVersionLabel: string | null;
  /** Version hash of the ICLA that was signed, as "sha256:<hex>". */
  claVersionHash: string;
  /** Always true for a stored signature; recorded explicitly for auditability. */
  assented: boolean;
  /** The exact assent phrase the contributor posted. */
  assentPhrase: string;
  /** ISO 8601 timestamp of when the signature was recorded. */
  signedAt: string;
  /** Full name (owner/repo) of the repository where the signature was made. */
  signedInRepo: string;
  /** Pull request number the signing comment was posted on. */
  prNumber: number;
  /** Permalink to the signing comment on GitHub, the primary evidence. */
  commentUrl: string;
}

export interface SignaturesFile {
  schemaVersion: number;
  signatures: SignatureRecord[];
}

// Validation. Malformed data throws a clear error rather than being silently
// accepted, because a corrupt store must not be read as "nobody has signed".

function fail(message: string): never {
  throw new Error(`Invalid signatures file: ${message}`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non empty string.`);
  }
  return value as string;
}

function asRecord(value: unknown, index: number): SignatureRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`signatures[${index}] must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const path = `signatures[${index}]`;
  if (raw.type !== 'individual') {
    fail(`${path}.type must be "individual".`);
  }
  if (typeof raw.githubId !== 'number' || !Number.isInteger(raw.githubId) || raw.githubId <= 0) {
    fail(`${path}.githubId must be a positive integer.`);
  }
  if (raw.claVersionLabel !== null && typeof raw.claVersionLabel !== 'string') {
    fail(`${path}.claVersionLabel must be a string or null.`);
  }
  if (typeof raw.assented !== 'boolean') {
    fail(`${path}.assented must be a boolean.`);
  }
  if (typeof raw.prNumber !== 'number' || !Number.isInteger(raw.prNumber) || raw.prNumber <= 0) {
    fail(`${path}.prNumber must be a positive integer.`);
  }
  // Build an explicit record rather than casting the raw object, so every stored
  // field is validated and no unexpected field is carried through.
  return {
    type: 'individual',
    githubId: raw.githubId,
    username: nonEmptyString(raw.username, `${path}.username`),
    claVersionLabel: (raw.claVersionLabel as string | null) ?? null,
    claVersionHash: nonEmptyString(raw.claVersionHash, `${path}.claVersionHash`),
    assented: raw.assented,
    assentPhrase: nonEmptyString(raw.assentPhrase, `${path}.assentPhrase`),
    signedAt: nonEmptyString(raw.signedAt, `${path}.signedAt`),
    signedInRepo: nonEmptyString(raw.signedInRepo, `${path}.signedInRepo`),
    prNumber: raw.prNumber,
    commentUrl: nonEmptyString(raw.commentUrl, `${path}.commentUrl`),
  };
}

/** Validate an already parsed value into a SignaturesFile, or throw. */
export function parseSignaturesFile(raw: unknown): SignaturesFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('root must be an object.');
  }
  const root = raw as Record<string, unknown>;
  if (typeof root.schemaVersion !== 'number') {
    fail('schemaVersion must be a number.');
  }
  if (!Array.isArray(root.signatures)) {
    fail('signatures must be an array.');
  }
  const signatures = root.signatures.map((entry, index) => asRecord(entry, index));
  return { schemaVersion: root.schemaVersion, signatures };
}

/**
 * The most recent assented signature for a GitHub ID, or undefined. Because the
 * store is append only, the last matching entry is the most recent one.
 */
export function findLatestSignature(
  file: SignaturesFile,
  githubId: number,
): SignatureRecord | undefined {
  let latest: SignatureRecord | undefined;
  for (const signature of file.signatures) {
    if (
      signature.type === 'individual' &&
      signature.githubId === githubId &&
      signature.assented === true
    ) {
      latest = signature;
    }
  }
  return latest;
}

/**
 * True when the signature is a current, assented signature for the given active
 * ICLA hash. A null current hash (no active version) never counts as current.
 */
export function isSignatureCurrent(
  signature: SignatureRecord,
  currentHash: string | null,
): boolean {
  if (!currentHash) return false;
  return signature.assented === true && signature.claVersionHash === currentHash;
}

/** Return a new SignaturesFile with the record appended. Does not mutate input. */
export function addSignature(
  file: SignaturesFile,
  record: SignatureRecord,
): SignaturesFile {
  return {
    schemaVersion: file.schemaVersion,
    signatures: [...file.signatures, record],
  };
}

/**
 * Build a signature record from an author, the signing context, and the current
 * ICLA version. The timestamp is passed in rather than read from the clock so the
 * builder stays deterministic and testable; callers supply new Date().toISOString().
 */
export function buildSignatureRecord(params: {
  author: Author;
  claVersionLabel: string | null;
  claVersionHash: string;
  assentPhrase: string;
  signedAt: string;
  signedInRepo: string;
  prNumber: number;
  commentUrl: string;
}): SignatureRecord {
  return {
    type: 'individual',
    githubId: params.author.githubId,
    username: params.author.login,
    claVersionLabel: params.claVersionLabel,
    claVersionHash: params.claVersionHash,
    assented: true,
    assentPhrase: params.assentPhrase,
    signedAt: params.signedAt,
    signedInRepo: params.signedInRepo,
    prNumber: params.prNumber,
    commentUrl: params.commentUrl,
  };
}

/** How many times an append retries when it loses the optimistic write race. */
export const MAX_APPEND_ATTEMPTS = 5;

/**
 * The GitHub Contents API returns 409 when the blob SHA supplied on a write is
 * stale because another commit landed on the file first. That is exactly the
 * concurrent-signing case we retry.
 */
function isConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: number }).status === 409
  );
}

/**
 * Build the signature store backed by the store repository. `read` validates on
 * load; `append` performs a read, append, and commit under optimistic
 * concurrency.
 *
 * Two signings can land at once. The second write then supplies a stale blob SHA
 * and GitHub returns 409. When that happens we re-read the file, which now
 * already contains the other signature, append this record to that fresh content,
 * and retry. Because every attempt re-reads and re-appends, no signature is ever
 * dropped or duplicated. After a bounded number of attempts we fail clearly
 * rather than looping forever.
 */
export function createSignatureStore(
  client: Octokit,
  owner: string,
  repo: string,
  path: string,
): SignatureStore {
  return {
    async read(): Promise<SignaturesFile> {
      const file = await readStoreFile(client, owner, repo, path);
      return parseSignaturesFile(JSON.parse(file.text));
    },

    async append(record: SignatureRecord, commitMessage: string): Promise<void> {
      for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt += 1) {
        const file = await readStoreFile(client, owner, repo, path);
        const current = parseSignaturesFile(JSON.parse(file.text));
        const updated = addSignature(current, record);
        const text = `${JSON.stringify(updated, null, 2)}\n`;
        try {
          await writeStoreFile(client, owner, repo, path, text, file.sha, commitMessage);
          return;
        } catch (error) {
          if (!isConflictError(error)) {
            // A non-conflict failure (auth, network, validation) is not retryable.
            throw error;
          }
          // Conflict: another signing landed first. Loop to re-read the fresh SHA
          // and re-apply this record on top of the updated content.
        }
      }
      throw new Error(
        `Could not append the signature to ${path} after ${MAX_APPEND_ATTEMPTS} attempts because of concurrent updates. Please retry.`,
      );
    },
  };
}
