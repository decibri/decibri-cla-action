// Operator helper: recompute the agreement version hashes and write them into
// config/cla.config.json.
//
// Run this once an agreement text is final and you have chosen a version label.
// It reads the `file` path in each config entry, computes the SHA-256 of the
// exact text, and writes `versionHash` (and, when you pass a label, `versionLabel`)
// back into the config. It is the ONLY tool that reads agreement file content.
//
// Usage:
//   npm run recompute-hashes -- --icla-label icla-v1 --ccla-label ccla-v1
//
// Pass only the labels for the agreements you are changing. Omit a flag to leave
// that agreement's label unchanged while still refreshing its hash. Pass
// --config <path> to point at a non default config location.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashAgreementFile } from '../src/hash';
import { actionPath } from '../src/paths';

interface Args {
  configPath: string;
  iclaLabel?: string;
  cclaLabel?: string;
}

function parseArgs(argv: string[]): Args {
  // Default to the config in this Action's own bundle, resolved so the script
  // works regardless of the current working directory. Agreement texts are then
  // resolved relative to that config's directory (see main below), which lands in
  // the same bundle. An explicit --config still overrides both.
  const args: Args = { configPath: actionPath('config/cla.config.json') };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--icla-label':
        args.iclaLabel = requireValue(flag, value);
        i += 1;
        break;
      case '--ccla-label':
        args.cclaLabel = requireValue(flag, value);
        i += 1;
        break;
      case '--config':
        args.configPath = requireValue(flag, value);
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(args.configPath, 'utf8')) as Record<string, any>;
  const configDir = dirname(resolve(args.configPath));

  for (const [key, label] of [
    ['icla', args.iclaLabel],
    ['ccla', args.cclaLabel],
  ] as const) {
    const entry = raw[key];
    if (!entry || typeof entry.file !== 'string') {
      throw new Error(`config.${key}.file is missing; cannot compute a hash.`);
    }
    // Agreement paths in config are relative to the repository root, which is the
    // parent of the config directory.
    const agreementPath = resolve(configDir, '..', entry.file);
    const hash = hashAgreementFile(agreementPath);
    entry.versionHash = hash;
    if (label !== undefined) {
      entry.versionLabel = label;
    }
    const shownLabel = entry.versionLabel ?? '(label unchanged)';
    process.stdout.write(`${key}: ${entry.file} -> ${hash} [${shownLabel}]\n`);
  }

  writeFileSync(args.configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote updated hashes to ${args.configPath}\n`);
}

main();
