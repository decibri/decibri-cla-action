import { describe, expect, it } from 'vitest';
import { computeTextHash, hashesMatch, isOutdated } from '../src/hash';

const ICLA_TEXT = 'The decibri Individual Contributor License Agreement, version one.';

describe('computeTextHash', () => {
  it('is stable: the same text always produces the same hash', () => {
    expect(computeTextHash(ICLA_TEXT)).toBe(computeTextHash(ICLA_TEXT));
  });

  it('produces a sha256 prefixed 64 character hex digest', () => {
    const hash = computeTextHash(ICLA_TEXT);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when the text changes', () => {
    const a = computeTextHash(ICLA_TEXT);
    const b = computeTextHash(`${ICLA_TEXT} A single added sentence.`);
    expect(a).not.toBe(b);
  });

  it('is sensitive to trivial edits such as trailing whitespace', () => {
    expect(computeTextHash(ICLA_TEXT)).not.toBe(computeTextHash(`${ICLA_TEXT} `));
  });
});

describe('hashesMatch', () => {
  it('is true only when both hashes are present and equal', () => {
    const hash = computeTextHash(ICLA_TEXT);
    expect(hashesMatch(hash, hash)).toBe(true);
    expect(hashesMatch(hash, computeTextHash('other'))).toBe(false);
    expect(hashesMatch(hash, null)).toBe(false);
    expect(hashesMatch(null, hash)).toBe(false);
    expect(hashesMatch(null, null)).toBe(false);
  });
});

describe('isOutdated (version comparison)', () => {
  const current = computeTextHash('current version');
  const old = computeTextHash('older version');

  it('marks a signature that carries an old hash as outdated', () => {
    expect(isOutdated(old, current)).toBe(true);
  });

  it('does not mark a signature that carries the current hash as outdated', () => {
    expect(isOutdated(current, current)).toBe(false);
  });

  it('marks a missing signature hash as outdated when there is a current version', () => {
    expect(isOutdated(null, current)).toBe(true);
  });

  it('is never outdated when there is no active current version', () => {
    expect(isOutdated(old, null)).toBe(false);
    expect(isOutdated(null, null)).toBe(false);
  });
});
