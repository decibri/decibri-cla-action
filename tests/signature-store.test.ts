import { describe, expect, it } from 'vitest';
import { createSignatureStore, MAX_APPEND_ATTEMPTS, type SignaturesFile } from '../src/signatures';
import type { Octokit } from '../src/github';
import { individualSignature } from './helpers';

// A fake of the store Octokit client that models the Contents API well enough to
// exercise the optimistic concurrency retry: getContent returns the current
// server state and blob SHA; createOrUpdateFileContents rejects with 409 when the
// supplied SHA is stale.

type Mode = 'ok' | 'conflict-once' | 'conflict-always' | 'error-403';

function base64(file: SignaturesFile): string {
  return Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8').toString('base64');
}

function conflict(): Error {
  return Object.assign(new Error('sha does not match'), { status: 409 });
}

function makeFakeClient(options: {
  initial: SignaturesFile;
  mode: Mode;
  concurrent?: SignaturesFile['signatures'][number];
}) {
  let state = options.initial;
  let sha = 'sha-0';
  let getCount = 0;
  let putCount = 0;

  const client = {
    rest: {
      repos: {
        async getContent() {
          getCount += 1;
          return { data: { type: 'file', content: base64(state), sha } };
        },
        async createOrUpdateFileContents(params: { content: string; sha: string }) {
          putCount += 1;
          if (options.mode === 'error-403') {
            throw Object.assign(new Error('forbidden'), { status: 403 });
          }
          if (options.mode === 'conflict-always') {
            throw conflict();
          }
          if (options.mode === 'conflict-once' && putCount === 1) {
            // Model a concurrent signing that landed first: apply it and bump the SHA,
            // then reject this write as stale.
            if (options.concurrent) {
              state = { schemaVersion: state.schemaVersion, signatures: [...state.signatures, options.concurrent] };
            }
            sha = 'sha-1';
            throw conflict();
          }
          if (params.sha !== sha) {
            throw conflict();
          }
          state = JSON.parse(Buffer.from(params.content, 'base64').toString('utf8')) as SignaturesFile;
          sha = `sha-${putCount + 1}`;
          return { data: {} };
        },
      },
    },
  };

  return {
    client: client as unknown as Octokit,
    getState: () => state,
    counts: () => ({ getCount, putCount }),
  };
}

const EMPTY: SignaturesFile = { schemaVersion: 1, signatures: [] };

describe('createSignatureStore append concurrency', () => {
  it('recovers from a stale-SHA 409 and keeps both signatures without duplication', async () => {
    const userA = individualSignature({ githubId: 1, username: 'a', commentUrl: 'https://x/a' });
    const userB = individualSignature({ githubId: 2, username: 'b', commentUrl: 'https://x/b' });

    const fake = makeFakeClient({ initial: EMPTY, mode: 'conflict-once', concurrent: userA });
    const store = createSignatureStore(fake.client, 'decibri', 'decibri-cla', 'data/signatures.json');

    await store.append(userB, 'chore(signatures): add b');

    const ids = fake.getState().signatures.map((s) => s.githubId);
    // userA (the concurrent writer) is preserved, and userB is added exactly once.
    expect(ids).toEqual([1, 2]);
    // One retry: two reads, two writes.
    expect(fake.counts()).toEqual({ getCount: 2, putCount: 2 });
  });

  it('fails clearly after exhausting attempts on persistent conflicts', async () => {
    const fake = makeFakeClient({ initial: EMPTY, mode: 'conflict-always' });
    const store = createSignatureStore(fake.client, 'decibri', 'decibri-cla', 'data/signatures.json');

    await expect(store.append(individualSignature(), 'msg')).rejects.toThrow(/concurrent updates/i);
    expect(fake.counts().putCount).toBe(MAX_APPEND_ATTEMPTS);
  });

  it('does not retry a non-conflict error', async () => {
    const fake = makeFakeClient({ initial: EMPTY, mode: 'error-403' });
    const store = createSignatureStore(fake.client, 'decibri', 'decibri-cla', 'data/signatures.json');

    await expect(store.append(individualSignature(), 'msg')).rejects.toThrow('forbidden');
    expect(fake.counts().putCount).toBe(1);
  });
});
