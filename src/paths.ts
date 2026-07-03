// Resolve paths that belong to this Action's own bundle rather than the caller's
// workspace.
//
// This project ships as a directly referenced Action (decibri/decibri-cla-action).
// When a caller runs "uses: decibri/decibri-cla-action@v1", the process working
// directory is the CALLING repository's checkout, not this Action's directory. So
// reading config/cla.config.json or the agreement texts with a path relative to
// the working directory would look inside the caller's repository and fail.
//
// GitHub sets GITHUB_ACTION_PATH to the directory this Action was checked out to,
// which is where config/ and agreements/ live. We resolve against that when it is
// present. For local runs, tests, and the operator scripts (where the variable is
// absent), we fall back to this file's own location: the sources live in src/ and
// the bundle is dist/index.js, so the Action root is always the parent directory
// of this compiled file.

import { resolve } from 'node:path';

/** The root directory of this Action's own files. */
export function actionRoot(): string {
  const fromEnv = process.env.GITHUB_ACTION_PATH;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return resolve(__dirname, '..');
}

/**
 * Resolve one or more path segments against the Action root. An absolute segment
 * is returned as is, matching node:path.resolve, so an explicit absolute
 * config-path override still works.
 */
export function actionPath(...segments: string[]): string {
  return resolve(actionRoot(), ...segments);
}
