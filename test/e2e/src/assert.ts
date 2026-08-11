/** Named assertions for CLI results. Ported from `fixture_assert_test.go`. */

import { expect } from 'vitest';
import type { CliResult } from './cli.js';
import { envOrUndefined } from './env.js';

/** Every environment variable the suite treats as a secret, for {@link assertNoSecrets}. */
const SECRET_ENV_VARS = [
  'DT_API_TOKEN',
  // Detection for these two only works because they happen to reuse DT_API_TOKEN's value.
  'DT_ORIGIN_API_TOKEN',
  'DT_DESTINATION_API_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

/** Redacted but not treated as a leak — the tenant hostname isn't a credential, but this repo is public. */
const REDACT_ONLY_VARS = ['DT_APPS_ENDPOINT', 'DT_ENV_URL'] as const;

/** Cap on how much captured output is inlined into a failure message. */
const OUTPUT_EXCERPT = 4_000;

/** Below this length a value is skipped, to avoid false leak-detection matches. */
const MIN_SECRET_LENGTH = 12;

/** Names already warned about, so the notice prints once rather than per assertion. */
const shortSecretsWarned = new Set<string>();

function warnAboutShortSecrets(name: string, value: string): void {
  if (value.length >= MIN_SECRET_LENGTH || shortSecretsWarned.has(name)) return;
  shortSecretsWarned.add(name);
  console.warn(
    `dt-evals E2E: ${name} is set but shorter than ${MIN_SECRET_LENGTH} characters, so it is ` +
      `excluded from redaction AND from leak detection. If it is a real credential, this ` +
      `suite cannot protect it — see test/e2e/README.md.`,
  );
}

/** Every spelling of `value` that could appear in output: raw, slash-stripped, percent- and JSON-encoded. */
function secretSpellings(value: string): string[] {
  return [
    value,
    value.replace(/\/+$/, ''),
    encodeURIComponent(value),
    JSON.stringify(value).slice(1, -1),
  ]
    .filter((s, i, all) => s.length >= MIN_SECRET_LENGTH && all.indexOf(s) === i)
    .sort((a, b) => b.length - a.length);
}

/** Not credentials, but shouldn't reach a public log — e.g. an AWS ARN/account id in a denial error. */
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/arn:aws[a-z-]*:[^\s"']+/g, '<redacted:aws-arn>'],
  [/\b\d{12}\b/g, '<redacted:aws-account>'],
];

/** Replace any configured secret value with a placeholder in a failure message. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const name of [...SECRET_ENV_VARS, ...REDACT_ONLY_VARS]) {
    const value = envOrUndefined(name);
    if (!value) continue;
    warnAboutShortSecrets(name, value);
    for (const spelling of secretSpellings(value)) {
      out = out.split(spelling).join(`<redacted:${name}>`);
    }
  }
  for (const [pattern, placeholder] of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, placeholder);
  }
  return out;
}

function describeResult(result: CliResult): string {
  // Redact before truncating, or a sliced secret can print half unredacted.
  return [
    `command: dt-evals ${redactSecrets(result.args.join(' '))}`,
    `exit code: ${result.exitCode}`,
    `--- output ---`,
    redactSecrets(result.output).slice(0, OUTPUT_EXCERPT) || '<empty>',
  ].join('\n');
}

/** Assert the CLI exited with `expected`, showing what it printed when it did not. */
export function assertExitCode(result: CliResult, expected: number): void {
  if (result.exitCode !== expected) {
    throw new Error(
      `expected exit code ${expected}, got ${result.exitCode}\n${describeResult(result)}`,
    );
  }
}

/** Assert the output contains `needle`. Prefer a short, stable fragment over full text. */
export function assertOutputContains(result: CliResult, needle: string): void {
  if (!result.output.includes(needle)) {
    throw new Error(`expected output to contain ${JSON.stringify(needle)}\n${describeResult(result)}`);
  }
}

/** Assert the output lacks `needle`; refuses to pass on empty output, which proves nothing. */
export function assertOutputLacks(result: CliResult, needle: string): void {
  if (result.output.trim().length === 0) {
    throw new Error(
      `expected output NOT to contain ${JSON.stringify(needle)}, but the CLI printed nothing at all` +
        ` — an absence check against empty output proves nothing\n${describeResult(result)}`,
    );
  }
  if (result.output.includes(needle)) {
    throw new Error(
      `expected output NOT to contain ${JSON.stringify(needle)}\n${describeResult(result)}`,
    );
  }
}

/** Assert no configured secret appears in the CLI's captured output. Called at the boundary in `runCli`. */
export function assertNoSecrets(result: CliResult, extraSecrets: string[] = []): void {
  const candidates = [
    ...SECRET_ENV_VARS.map((name) => ({ name, value: envOrUndefined(name) })),
    ...extraSecrets.map((value, i) => ({ name: `extraSecrets[${i}]`, value })),
  ];

  // Captured HOME files are scanned too, not just the streams.
  const haystacks = [
    result.output,
    ...Object.values(result.homeFiles).filter((v): v is string => v !== undefined),
  ];

  for (const { name, value } of candidates) {
    if (!value) continue;
    warnAboutShortSecrets(name, value);
    const spellings = secretSpellings(value);
    if (spellings.some((spelling) => haystacks.some((haystack) => haystack.includes(spelling)))) {
      // Never echoes the value itself — this is the leak-reporting path.
      throw new Error(
        `secret from ${name} leaked into the output of: dt-evals ${redactSecrets(result.args.join(' '))}`,
      );
    }
  }
}

/** Parse the CLI's structured output as the *last* complete JSON object on stdout. */
export function parseJsonStdout(result: CliResult): unknown {
  const { stdout } = result;
  const end = stdout.lastIndexOf('}');

  if (end !== -1) {
    for (let start = stdout.lastIndexOf('{', end); start !== -1; start = stdout.lastIndexOf('{', start - 1)) {
      try {
        return JSON.parse(stdout.slice(start, end + 1));
      } catch {
        // Not a complete object at this offset — widen to the next `{` left.
      }
      if (start === 0) break;
    }
  }

  throw new Error(`expected a JSON object on stdout\n${describeResult(result)}`);
}

/** Assert a DQL result set is non-empty (Grail returns zero records, not an error, on a scope-missing token). */
export function assertRecords<T>(records: T[], what: string): void {
  expect(
    records.length,
    `no records for ${what} — either the data is absent or the token lacks the bucket read scope`,
  ).toBeGreaterThan(0);
}
