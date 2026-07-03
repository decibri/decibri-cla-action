// SHA-256 hashing of agreement text and version comparison.
//
// The version hash pins coverage to the exact agreement text a contributor
// agreed to. When the text changes the hash changes, prior signatures become
// outdated, and contributors are asked to re-sign. The hash is written as
// "sha256:<hex>" so the algorithm travels with the value.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PREFIX = 'sha256:';

/** Compute the version hash of a string of agreement text. */
export function computeTextHash(text: string): string {
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  return `${PREFIX}${digest}`;
}

/**
 * Compute the version hash of an agreement file by reading its exact bytes.
 *
 * This is the only function that reads agreement file content, and it is only
 * invoked by the operator's recompute-hashes helper, never during enforcement.
 */
export function hashAgreementFile(filePath: string): string {
  const bytes = readFileSync(filePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `${PREFIX}${digest}`;
}

/**
 * True when both hashes are present and equal. A null or empty current hash (an
 * agreement with no active version) never matches.
 */
export function hashesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a === b;
}

/**
 * True when there is an active current version and the signature does not match
 * it. With no active current version there is nothing to be outdated against, so
 * this returns false.
 */
export function isOutdated(
  signatureHash: string | null | undefined,
  currentHash: string | null | undefined,
): boolean {
  if (!currentHash) return false;
  if (!signatureHash) return true;
  return signatureHash !== currentHash;
}
