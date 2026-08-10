/**
 * Named assertions for CLI results.
 *
 * Ported from `fixture_assert_test.go`, whose value is less in the code than in
 * each helper documenting *why* its bound or scope is what it is. Failure
 * messages include the captured output, because an E2E failure with no output is
 * a re-run rather than a diagnosis — the design doc asks for enough detail to
 * debug without one.
 */

import { expect } from 'vitest';
import type { CliResult } from './cli.js';
import { envOrUndefined } from './env.js';

/**
 * Every environment variable the suite treats as a secret.
 *
 * Used by {@link assertNoSecrets}. Kept as a list of *names* so the values are
 * only read at assertion time and never stored anywhere the test could print.
 */
const SECRET_ENV_VARS = [
  'DT_API_TOKEN',
  // DT_ORIGIN_API_TOKEN / DT_DESTINATION_API_TOKEN: the runner process never
  // sets env vars under these literal names, so detection for the
  // destination-probe test only works today because it happens to reuse the
  // same string value as DT_API_TOKEN. Kept for whenever that changes.
  'DT_ORIGIN_API_TOKEN',
  'DT_DESTINATION_API_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  // A real, valid tenant token (just missing storage:spans:read) — leaking it
  // is exactly as bad as leaking DT_API_TOKEN. Without this entry it lived
  // under a name absent from this list, so a leak would sail through
  // undetected. See validate.e2e.test.ts's misscoped-token probe.
  'E2E_DT_MISSCOPED_TOKEN',
] as const;

/**
 * Values redacted from messages but *not* treated as leaks.
 *
 * The tenant hostname is not a credential — the CLI prints it on every
 * connection probe, so failing a run over it would be absurd. But this repo is
 * public and the hostname names internal infrastructure, which is why
 * `.env.sample` ships it blank and CI takes it from a secret. Redacting it in
 * anything the suite writes keeps that consistent.
 *
 * The runner's own masking is not enough here: it matches the registered secret
 * string exactly, and `tenant()` strips a trailing slash before use — so a
 * secret stored as `https://host/` would sail through unmasked in its stripped
 * form. {@link redactSecrets} therefore matches both spellings.
 */
const REDACT_ONLY_VARS = ['DT_APPS_ENDPOINT', 'DT_ENV_URL'] as const;

/** Cap on how much captured output is inlined into a failure message. */
const OUTPUT_EXCERPT = 4_000;

/**
 * Below this length a value is ignored by both {@link redactSecrets} and
 * {@link assertNoSecrets}: a short token matches by coincidence and turns the
 * leak scanner into a source of false failures.
 *
 * The cost is that a genuinely short credential silently disables *both*
 * mechanisms, which is the worst possible failure mode for a safety net — so
 * {@link warnAboutShortSecrets} makes it audible instead.
 */
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

/**
 * Every spelling of `value` that could plausibly appear in captured output.
 *
 * Exact-substring matching alone is not enough. The CLI is known to place a key
 * in a request URL (`dt-eval-cli/src/probe/provider.ts:115`), where it is
 * percent-encoded — and AWS secret access keys are base64, so `+` and `/` become
 * `%2B` and `%2F` and the raw value no longer matches. Provider errors are also
 * echoed as JSON, which escapes its own set of characters.
 *
 * Longest first, so stripping the trailing slash cannot leave a dangling one
 * behind after the shorter form has already matched.
 */
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

/**
 * Identifiers that are not credentials but still should not reach a public log.
 *
 * `validate.e2e.test.ts` deliberately provokes the CLI into echoing raw provider
 * error bodies. Bedrock and STS denials embed the caller ARN — which carries the
 * 12-digit AWS account id — and that value is in no secret list, is not a
 * registered GitHub secret, and so prints verbatim into a world-readable Actions
 * log. Matched by shape rather than by value, since there is nothing to compare against.
 */
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/arn:aws[a-z-]*:[^\s"']+/g, '<redacted:aws-arn>'],
  [/\b\d{12}\b/g, '<redacted:aws-account>'],
];

/**
 * Replace any configured secret value with a placeholder.
 *
 * Every failure message goes through this. The runner masks registered secrets
 * in the Actions log, but only exact matches, and this repo is public — so the
 * cost of a miss is a world-readable credential. Without redaction the leak
 * case is exactly the case that publishes the secret: `assertNoSecrets` refuses
 * to echo a value, but an unrelated assertion failing on the *same* result
 * would inline the raw output, secret and all, into its message — which vitest
 * then prints in full.
 *
 * Redaction is not a substitute for {@link assertNoSecrets}; that still fails
 * the test. This only ensures the report of a leak is not itself a leak.
 */
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
  // Redact first, then truncate. The other order lets a secret that straddles
  // the cut survive as a fragment: the tail is sliced off, so the full value no
  // longer matches and the leading half is printed verbatim.
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

/**
 * Assert the output contains `needle`.
 *
 * Prefer a short, stable fragment of a message over its full text: these
 * assertions should survive copy edits to the CLI's human-readable output and
 * only break when the *behaviour* changes.
 */
export function assertOutputContains(result: CliResult, needle: string): void {
  if (!result.output.includes(needle)) {
    throw new Error(`expected output to contain ${JSON.stringify(needle)}\n${describeResult(result)}`);
  }
}

/**
 * Assert the output does *not* contain `needle`.
 *
 * Refuses to pass on empty output. "The CLI printed nothing" satisfies every
 * absence check trivially, so without this guard a command that died before
 * producing a single line would look like it behaved correctly — and in tests
 * where this is the only assertion, that is the whole test passing on silence.
 */
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


/**
 * Assert no configured secret appears in the CLI's captured output.
 *
 * The design doc names two known leak paths in the CLI today: the Gemini key is
 * placed in the request URL on the probe path
 * (`dt-eval-cli/src/probe/provider.ts:115`), and raw provider/tenant error
 * bodies are printed verbatim. `runCli` calls this on every invocation rather
 * than leaving it to the cases that look risky — and calls it at the boundary,
 * because a test that ends with it has already had every earlier assertion's
 * chance to print the output first.
 *
 * Short values are skipped: a 4-character token would match by coincidence and
 * turn this into a source of false failures.
 */
export function assertNoSecrets(result: CliResult, extraSecrets: string[] = []): void {
  const candidates = [
    ...SECRET_ENV_VARS.map((name) => ({ name, value: envOrUndefined(name) })),
    ...extraSecrets.map((value, i) => ({ name: `extraSecrets[${i}]`, value })),
  ];

  // Captured HOME files are scanned too. They are populated before this runs and
  // do get read back into assertions (run.e2e.test.ts parses the run log), so
  // "checked at the boundary" has to mean everything the result carries, not
  // just the streams.
  const haystacks = [
    result.output,
    ...Object.values(result.homeFiles).filter((v): v is string => v !== undefined),
  ];

  for (const { name, value } of candidates) {
    if (!value) continue;
    warnAboutShortSecrets(name, value);
    // Same spellings redactSecrets covers: a percent-encoded or JSON-escaped key
    // is just as leaked as a raw one, and the CLI produces both.
    const spellings = secretSpellings(value);
    if (spellings.some((spelling) => haystacks.some((haystack) => haystack.includes(spelling)))) {
      // Deliberately does not echo the value, only which variable leaked and
      // the command that leaked it. argv is redacted for the same reason: this
      // is the leak-reporting path, so it must not become a leak itself.
      throw new Error(
        `secret from ${name} leaked into the output of: dt-evals ${redactSecrets(result.args.join(' '))}`,
      );
    }
  }
}

/**
 * Parse the CLI's structured output as the *last* complete JSON object on stdout.
 *
 * `run --ci` prints one object (`dt-eval-cli/src/runner/index.ts:414`);
 * `--dry-run` prints a pretty-printed, multi-line one (`:221`); and on the error
 * path `run` prints `{"error": …}` — which can follow the result object, since a
 * throw from `appendRunRecord` is caught after the result has already been
 * printed (`cli/commands/run.ts:210-214`).
 *
 * Both shapes rule out the obvious approaches. Slicing the first `{` to the last
 * `}` spans two objects and yields invalid JSON whenever both are printed;
 * parsing the last line fails on the pretty-printed payload. So candidate start
 * positions are tried right-to-left and the first that parses wins, which is by
 * construction the last complete object regardless of formatting.
 */
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

/**
 * Assert a DQL result set is non-empty, with a message that says what to check.
 *
 * Grail answers a query whose token lacks the bucket scope with
 * SUCCEEDED-and-zero-records rather than an error, so "no records" is ambiguous
 * between "no data" and "no permission". The hint keeps that ambiguity from
 * being rediscovered every time.
 */
export function assertRecords<T>(records: T[], what: string): void {
  expect(
    records.length,
    `no records for ${what} — either the data is absent or the token lacks the bucket read scope`,
  ).toBeGreaterThan(0);
}
