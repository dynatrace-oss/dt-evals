/**
 * Runs the built dt-evals CLI as a subprocess, the way a user does.
 *
 * Ported in spirit from `internal/process/app.go` + `fixture_apps_test.go`,
 * including their environment discipline: the Go suite builds `install.Env`
 * explicitly rather than inheriting the parent's, and this does the same. That
 * is not tidiness — inheriting `process.env` would let the developer's real
 * `DT_API_TOKEN` / `OPENAI_API_KEY` reach the CLI, and every negative test that
 * asserts "no credentials configured" would pass for the wrong reason.
 *
 * Three constraints from the design doc are handled here:
 *   - the CLI is a black box, so it is driven via argv/env/files and judged by
 *     its output and exit code;
 *   - its state is global — `~/.dt-eval/runs.json` (via `homedir()` in
 *     `dt-eval-cli/src/runner/checkpoint.ts:25`) and `./.dt-eval.yaml` — so each
 *     invocation gets a private HOME and cwd;
 *   - `dt-eval-cli/src/index.ts:12` auto-loads `.env` from the working
 *     directory, which a shared cwd would turn into a credential leak.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertNoSecrets, redactSecrets } from './assert.js';
import { assertCliBuilt, cliEntryPoint } from './paths.js';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr, for assertions that don't care which stream a line landed on. */
  output: string;
  /** The argv the CLI was invoked with, for failure messages. */
  args: string[];
  /**
   * Contents of the files named in `captureHomeFiles`, read from the private
   * HOME just before it was deleted. A file that was never written maps to
   * `undefined`, which is itself assertable — a dry run must not create a run log.
   */
  homeFiles: Record<string, string | undefined>;
}

export interface RunCliOptions {
  /**
   * Extra environment for the CLI. Only PATH, HOME and NO_COLOR are provided by
   * default — pass credentials explicitly so each test states its own
   * preconditions.
   */
  env?: Record<string, string | undefined>;
  /** Written to `.dt-eval.yaml` in the private working directory before the run. */
  configYaml?: string;
  /** Additional files to create in the working directory, keyed by relative path. */
  files?: Record<string, string>;
  /**
   * Files to create inside the private HOME, keyed by path relative to it.
   * Parent directories are created as needed.
   *
   * The CLI reads `~/.config/dt-eval/custom-prompts.json` at startup
   * (`dt-eval-cli/src/prompts/fs-store.ts:6-18`), which is the only external
   * surface that can make evaluator loading fail — so a test needs to be able
   * to plant one without touching the developer's real home directory.
   */
  filesInHome?: Record<string, string>;
  /**
   * Paths, relative to the private HOME, to read back before it is deleted.
   *
   * The CLI's run log lives at `~/.dt-eval/runs.json`
   * (`dt-eval-cli/src/runner/checkpoint.ts:25`). Since each invocation gets a
   * throwaway HOME, asserting on that file means capturing it during the run
   * rather than looking for it afterwards.
   */
  captureHomeFiles?: string[];
  /** Kill the process after this many milliseconds. Default 120s. */
  timeoutMs?: number;
}

/**
 * Map the suite's environment names onto the ones the CLI reads.
 *
 * The suite follows the instrumentation-examples convention
 * (`DT_APPS_ENDPOINT` = the platform/apps host serving DQL), while the CLI reads
 * `DT_ENV_URL` (`dt-eval-cli/src/config/index.ts:84`). Both refer to the same
 * apps host. Keeping the translation in one place means tests never have to
 * remember which name belongs to which side.
 */
export function tenantCliEnv(appsEndpoint: string, apiToken: string): Record<string, string> {
  return { DT_ENV_URL: appsEndpoint, DT_API_TOKEN: apiToken };
}

/**
 * Build the child's environment from scratch.
 *
 * Exported so a test can assert the key set directly. That matters more than it
 * looks: the CLI never echoes its own environment, so inheriting `process.env`
 * produces *no* observable difference in stdout for a variable the CLI ignores.
 * A test that sets a canary and greps the output therefore passes either way —
 * it cannot distinguish an isolated child from an inheriting one. The only
 * reliable checks are this key set and a variable the CLI actually acts on.
 *
 * `PATH` is the single value taken from the parent, because the child needs to
 * find `node`; it cannot carry a credential.
 */
export function buildChildEnv(
  home: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  // Deliberately not `...process.env`. See the file header.
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    // Strip ANSI colour so assertions can match plain substrings, as
    // dt-eval-cli/tests/configure.integration.test.ts:25 already does.
    NO_COLOR: '1',
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export async function runCli(args: string[], options: RunCliOptions = {}): Promise<CliResult> {
  assertCliBuilt();

  const home = mkdtempSync(join(tmpdir(), 'dt-evals-e2e-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'dt-evals-e2e-cwd-'));

  try {
    if (options.configYaml !== undefined) {
      writeFileSync(join(cwd, '.dt-eval.yaml'), options.configYaml, 'utf-8');
    }
    for (const [name, content] of Object.entries(options.files ?? {})) {
      writeFileSync(join(cwd, name), content, 'utf-8');
    }
    for (const [name, content] of Object.entries(options.filesInHome ?? {})) {
      const target = join(home, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf-8');
    }

    const env = buildChildEnv(home, options.env);

    let result: CliResult;
    try {
      result = await spawnCli(args, cwd, env, options.timeoutMs ?? 120_000);
    } catch (err) {
      // A timeout or spawn failure would otherwise take the private HOME — and
      // with it the run log — to the grave, which is exactly the failure where
      // the run log explains what happened. Attach it to the error instead.
      throw new Error(`${(err as Error).message}${describeHome(home, options.captureHomeFiles)}`);
    }

    for (const relPath of options.captureHomeFiles ?? []) {
      const full = join(home, relPath);
      result.homeFiles[relPath] = existsSync(full) ? readFileSync(full, 'utf-8') : undefined;
    }

    // Scan here rather than leaving it to each test. Every caller used to end
    // with assertNoSecrets, which is the one position where it cannot help: any
    // assertion failing earlier in the test throws first, and vitest then prints
    // the whole captured output. Checking at the boundary means a leak fails the
    // run before any other assertion gets the chance to publish it.
    assertNoSecrets(result);

    return result;
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Read back whatever the doomed run managed to write, for a failure message.
 *
 * Redacted, because this is the one path where `assertNoSecrets` cannot help:
 * the spawn rejected, so there is no CliResult to scan, and the contents go
 * straight into an error message. `captureHomeFiles` is an arbitrary
 * caller-supplied list — today only the run log, which holds no credentials,
 * but the next caller to capture a config file should not inherit a raw print.
 */
function describeHome(home: string, captureHomeFiles?: string[]): string {
  const parts: string[] = [];
  for (const relPath of captureHomeFiles ?? []) {
    const full = join(home, relPath);
    const content = existsSync(full)
      ? redactSecrets(readFileSync(full, 'utf-8').trim())
      : '<not written>';
    parts.push(`${relPath}: ${content}`);
  }
  return parts.length ? `\n--- captured from HOME ---\n${parts.join('\n')}` : '';
}

function spawnCli(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    // Invoke via process.execPath rather than the `dt-evals` bin shim: the shim
    // only exists after an install, and this keeps the suite runnable straight
    // from a built checkout.
    const child = spawn(process.execPath, [cliEntryPoint(), ...args], { cwd, env });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      // argv redacted for the same reason describeResult and assertNoSecrets do
      // it: no test puts a real credential in argv today, but these two paths
      // are the only ones that would print it raw if one ever did.
      reject(
        new Error(`dt-evals ${redactSecrets(args.join(' '))} did not exit within ${timeoutMs}ms`),
      );
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // `close` rather than `exit`, so stdout/stderr are fully drained before the
    // result is handed to assertions.
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === null) {
        reject(
          new Error(`dt-evals ${redactSecrets(args.join(' '))} was killed by signal ${signal}`),
        );
        return;
      }
      resolve({ exitCode: code, stdout, stderr, output: stdout + stderr, args, homeFiles: {} });
    });
  });
}
