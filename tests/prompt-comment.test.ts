// The prompt comment's file links (the CLA text and the contributing guide) must
// point to the PUBLIC files in this action's repository, never to the private
// signature store repo (which 404s for non members), while the privacy link goes
// to the single canonical published policy at https://decibri.com/privacy, not to
// a PRIVACY.md file in any repository. These tests lock in the derived base so
// the file links cannot silently rot back to the private repo, pin the canonical
// privacy URL, and pin the restructured layout: signing action first, the assent
// phrase in a copyable code block, privacy and corporate detail in a collapsed
// section.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPromptComment,
  CLA_COMMENT_MARKER,
  isAssentPhrase,
  publicRepoBase,
} from '../src/comments';
import { makeConfig } from './helpers';

describe('publicRepoBase', () => {
  it('derives owner/repo and ref from the action runtime variables', () => {
    const base = publicRepoBase({
      GITHUB_ACTION_REPOSITORY: 'decibri/decibri-cla-action',
      GITHUB_ACTION_REF: 'v1',
    });
    expect(base).toBe('https://github.com/decibri/decibri-cla-action/blob/v1');
  });

  it('falls back to the public action repo and main when the variables are absent', () => {
    const base = publicRepoBase({});
    expect(base).toBe('https://github.com/decibri/decibri-cla-action/blob/main');
  });

  it('never points at the private store repo', () => {
    const base = publicRepoBase({ GITHUB_ACTION_REPOSITORY: 'decibri/decibri-cla-action' });
    expect(base).not.toContain('decibri-cla/blob');
  });
});

describe('buildPromptComment', () => {
  // Preserve and restore the two action runtime variables around each test so the
  // suite is deterministic regardless of the surrounding environment.
  const saved = {
    repo: process.env.GITHUB_ACTION_REPOSITORY,
    ref: process.env.GITHUB_ACTION_REF,
  };

  beforeEach(() => {
    delete process.env.GITHUB_ACTION_REPOSITORY;
    delete process.env.GITHUB_ACTION_REF;
  });

  afterEach(() => {
    if (saved.repo === undefined) delete process.env.GITHUB_ACTION_REPOSITORY;
    else process.env.GITHUB_ACTION_REPOSITORY = saved.repo;
    if (saved.ref === undefined) delete process.env.GITHUB_ACTION_REF;
    else process.env.GITHUB_ACTION_REF = saved.ref;
  });

  // Links

  it('links the individual CLA at the configured file path in the public repo', () => {
    const config = makeConfig();
    const body = buildPromptComment(config);
    expect(body).toContain(
      `https://github.com/decibri/decibri-cla-action/blob/main/${config.icla.file}`,
    );
  });

  it('links the privacy notice at exactly the canonical published policy URL', () => {
    const body = buildPromptComment(makeConfig());
    expect(body).toContain('[privacy notice](https://decibri.com/privacy)');
  });

  it('links the contributing guide in the public repo', () => {
    const body = buildPromptComment(makeConfig());
    expect(body).toContain(
      'https://github.com/decibri/decibri-cla-action/blob/main/CONTRIBUTING.md',
    );
  });

  it('contains no link to a PRIVACY.md file in any repository', () => {
    const body = buildPromptComment(makeConfig());
    expect(body).not.toContain('PRIVACY.md');
  });

  it('tracks the ref the caller pinned for file links, while the privacy link stays canonical', () => {
    process.env.GITHUB_ACTION_REPOSITORY = 'decibri/decibri-cla-action';
    process.env.GITHUB_ACTION_REF = 'v1';
    const body = buildPromptComment(makeConfig());
    expect(body).toContain(
      'https://github.com/decibri/decibri-cla-action/blob/v1/CONTRIBUTING.md',
    );
    expect(body).toContain('[privacy notice](https://decibri.com/privacy)');
  });

  it('contains no link to the private store repo and no stale CONTRIBUTIONS reference', () => {
    const body = buildPromptComment(makeConfig());
    expect(body).not.toContain('decibri-cla/blob');
    expect(body).not.toContain('CONTRIBUTIONS.md');
  });

  // Structure

  it('opens with the internal marker and then the signing heading', () => {
    const lines = buildPromptComment(makeConfig()).split('\n');
    expect(lines[0]).toBe(CLA_COMMENT_MARKER);
    expect(lines[1]).toBe('## Sign the Contributor License Agreement');
  });

  it('renders the assent phrase from config inside a fenced code block, in lockstep with the matcher', () => {
    // A distinctive phrase proves the fenced line is read FROM config, not a baked
    // in literal that merely happens to equal makeConfig()'s default: a hardcoded
    // phrase would not carry this sentinel and the test would fail.
    const sentinel = 'ASSENT SENTINEL: I hereby sign the decibri CLA for this test.';
    const config = makeConfig({ assentPhraseIcla: sentinel });
    const lines = buildPromptComment(config).split('\n');
    // Locate the code fence independently of the phrase text, then read the single
    // line inside it.
    const openFence = lines.indexOf('```');
    expect(openFence).toBeGreaterThan(-1);
    const copied = lines[openFence + 1];
    expect(lines[openFence + 2]).toBe('```');
    // That fenced line is exactly the configured phrase, so a clean copy yields the
    // bare phrase and the displayed line stays in lockstep with the line
    // isAssentPhrase compares against; they cannot drift.
    expect(copied).toBe(sentinel);
    expect(copied).toBe(config.assentPhraseIcla);
    expect(isAssentPhrase(copied, config.assentPhraseIcla)).toBe(true);
  });

  it('places the code block (the signing action) before the collapsed detail section', () => {
    const config = makeConfig();
    const body = buildPromptComment(config);
    expect(body.indexOf(config.assentPhraseIcla)).toBeLessThan(body.indexOf('<details>'));
  });

  it('carries a collapsed details section', () => {
    const body = buildPromptComment(makeConfig());
    expect(body).toContain('<details>');
    expect(body).toContain('<summary>');
    expect(body).toContain('</details>');
  });

  it('keeps the privacy and corporate lines inside the collapsed details block', () => {
    const body = buildPromptComment(makeConfig());
    const start = body.indexOf('<details>');
    const end = body.indexOf('</details>');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const collapsed = body.slice(start, end);
    // Both the privacy sentence (with its link) and the corporate sentence live
    // inside the collapsed section; a future edit that lifts them out is caught.
    expect(collapsed).toContain('We record only your GitHub account ID');
    expect(collapsed).toContain('https://decibri.com/privacy');
    expect(collapsed).toContain('Corporate CLA on file');
    expect(collapsed).toContain('CONTRIBUTING.md');
  });
});
