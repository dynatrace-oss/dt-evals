/**
 * Interactive "paste your Dynatrace platform token" flow.
 *
 * Why this exists:
 * dtctl 0.24+ redacts the OAuth Bearer header in its debug output, so the
 * old `getBearerToken()` trick can no longer extract a usable token. There's
 * no public dtctl command to print the access token either. The most
 * reliable replacement is to direct the user to the Dynatrace token UI,
 * have them generate a scoped platform token themselves, and paste it back.
 *
 * This module isolates that flow so both `dt-evals doctor` and
 * `dt-evals doctor create-token` can share it.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import pc from 'picocolors';

const execAsync = promisify(exec);

export const PLATFORM_TOKENS_URL = 'https://myaccount.dynatrace.com/platformTokens';

/**
 * Scopes that need to be selected when creating the platform token.
 * Mirrors what the runtime client needs end-to-end:
 *   - read GenAI traces, list buckets, read past eval bizevents (drift baseline)
 *   - write eval bizevents and (optionally) metrics
 *   - read logs for the `validate` connectivity probe
 */
export const REQUIRED_SCOPES: Array<{ scope: string; purpose: string; optional?: boolean }> = [
  { scope: 'openpipeline:bizevents:ingest', purpose: 'Write evaluation results back as bizevents' },
  { scope: 'storage:bizevents:read', purpose: 'Read past evaluation bizevents — drift baseline' },
  { scope: 'storage:buckets:read', purpose: 'List Grail buckets (prerequisite for any read)' },
  { scope: 'storage:logs:read', purpose: 'Connectivity probe used by `dt-evals validate`' },
  { scope: 'storage:metrics:write', purpose: 'Write evaluation metrics', optional: true },
  { scope: 'storage:spans:read', purpose: 'Read GenAI traces from Grail' },
];

/** Format the scopes block as a copy/paste-friendly bullet list.
 *  For classic *.apps.dynatrace.com tenants, `openpipeline:bizevents:ingest`
 *  is replaced with `storage:events:write` (OpenPipeline ingest not available). */
export function formatScopes(envUrl?: string): string {
  const isClassic = envUrl ? /\.apps\.dynatrace\.com(\/|$)/i.test(envUrl) : false;
  const scopes = isClassic
    ? REQUIRED_SCOPES.map(s =>
        s.scope === 'openpipeline:bizevents:ingest'
          ? { ...s, scope: 'storage:events:write' }
          : s,
      )
    : REQUIRED_SCOPES;
  const widest = Math.max(...scopes.map(s => s.scope.length));
  return scopes.map(s => {
    const pad = ' '.repeat(widest - s.scope.length);
    const tag = s.optional ? pc.dim('  (optional)') : '';
    return `    • ${pc.cyan(s.scope)}${pad}  — ${s.purpose}${tag}`;
  }).join('\n');
}

/** Open a URL in the user's default browser. Best-effort; falls back to no-op. */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  // Mac: `open`, Linux: `xdg-open`, Windows: `start`. Quote URL for safety.
  const cmd =
    platform === 'darwin' ? `open "${url}"`
    : platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  try {
    await execAsync(cmd, { timeout: 5_000 });
  } catch {
    // Best-effort. If the platform has no opener (CI, headless), the caller
    // will have already printed the URL — nothing to do.
  }
}

/**
 * Minimum heuristic for a Dynatrace platform token: the `dt0s16.` prefix.
 * We deliberately don't tighten this further — Dynatrace may issue other
 * prefixes in future, and a too-strict regex would block legitimate tokens.
 * Length floor catches obvious paste mistakes.
 */
export function looksLikePlatformToken(value: string): boolean {
  const v = value.trim();
  return /^dt0s\d+\./i.test(v) && v.length >= 32;
}
