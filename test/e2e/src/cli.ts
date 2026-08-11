/**
 * Runs the built dt-evals CLI as a subprocess, the way a user does. The
 * child's env is built explicitly rather than inherited, so a developer's real
 * credentials can't reach the CLI. Each invocation gets a private HOME and
 * cwd, since the CLI's state (`~/.dt-eval/runs.json`, `./.dt-eval.yaml`,
 * auto-loaded `.env`) is otherwise global.
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
  /** Contents of the `captureHomeFiles` files, read before HOME was deleted. Unwritten maps to `undefined`. */
  homeFiles: Record<string, string | undefined>;
}

export interface RunCliOptions {
  /** Extra environment for the CLI — only PATH, HOME, NO_COLOR are set by default. */
  env?: Record<string, string | undefined>;
  /** Written to `.dt-eval.yaml` in the private working directory before the run. */
  configYaml?: string;
  /** Additional files to create in the working directory, keyed by relative path. */
  files?: Record<string, string>;
  /** Files to create inside the private HOME, keyed by path relative to it. */
  filesInHome?: Record<string, string>;
  /** Paths, relative to the private HOME, to read back before it is deleted (e.g. the run log). */
  captureHomeFiles?: string[];
  /** Kill the process after this many milliseconds. Default 120s. */
  timeoutMs?: number;
}

/** Map the suite's `DT_APPS_ENDPOINT` convention onto `DT_ENV_URL`, the name the CLI reads. */
export function tenantCliEnv(appsEndpoint: string, apiToken: string): Record<string, string> {
  return { DT_ENV_URL: appsEndpoint, DT_API_TOKEN: apiToken };
}

/**
 * Build the child's environment from scratch. Exported so a test can assert
 * the key set directly, since the CLI never echoes its own environment.
 */
export function buildChildEnv(
  home: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  // Deliberately not `...process.env` — see the file header.
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
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
      // A timeout/spawn failure would otherwise delete HOME before the run log can explain it.
      throw new Error(`${(err as Error).message}${describeHome(home, options.captureHomeFiles)}`);
    }

    for (const relPath of options.captureHomeFiles ?? []) {
      const full = join(home, relPath);
      result.homeFiles[relPath] = existsSync(full) ? readFileSync(full, 'utf-8') : undefined;
    }

    // Scanned here, at the boundary, so no earlier-throwing assertion can bypass it.
    assertNoSecrets(result);

    return result;
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** Read back whatever the doomed run managed to write, for a failure message. */
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
    // process.execPath, not the `dt-evals` bin shim, which only exists after an install.
    const child = spawn(process.execPath, [cliEntryPoint(), ...args], { cwd, env });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`dt-evals ${redactSecrets(args.join(' '))} did not exit within ${timeoutMs}ms`),
      );
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // `close` rather than `exit`, so stdout/stderr are fully drained first.
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
