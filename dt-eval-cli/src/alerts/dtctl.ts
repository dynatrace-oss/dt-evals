import { execFile } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Required Dynatrace permissions for `dt-evals alerts`:
 *
 *   automation:workflows:read   list / get existing workflows (for list, diff, idempotent apply)
 *   automation:workflows:write  create, update, delete workflows
 *   automation:workflows:run    (optional) execute a workflow on demand from `alerts run`
 *   storage:events:read         the workflow body queries gen_ai.evaluation.result bizevents at runtime
 *
 * These are scoped to the OAuth user/principal that owns the dtctl context. We
 * surface them in errors and the README rather than checking up-front, because
 * dtctl handles auth — failures come back as 401/403 from the API.
 */
export const REQUIRED_SCOPES = [
  'automation:workflows:read',
  'automation:workflows:write',
  'storage:events:read',
] as const;

export const OPTIONAL_SCOPES = [
  'automation:workflows:run',
] as const;

export interface DtctlOpts {
  /** dtctl context name. */
  context?: string;
}

export class DtctlError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'DtctlError';
  }
}

/**
 * Inspect a dtctl error blob and classify it. Returns a richer error with
 * a hint pointing at the missing permission / auth problem.
 */
function classifyError(stderr: string, exitCode: number | null): DtctlError {
  const status = /status (\d{3})/.exec(stderr)?.[1];
  const httpStatus = status ? parseInt(status, 10) : undefined;

  if (httpStatus === 401 || /JWT|unauthor/i.test(stderr)) {
    return new DtctlError(
      'dtctl is not authenticated. Run `dtctl auth login` (or `dtctl auth refresh`) and retry.',
      stderr, exitCode, httpStatus,
    );
  }
  if (httpStatus === 403 || /forbidden|insufficient/i.test(stderr)) {
    return new DtctlError(
      'Permission denied. The dtctl context is missing one of the required scopes: ' +
      REQUIRED_SCOPES.join(', ') + '. ' +
      'Ask your Dynatrace admin to grant these to the OAuth client / user.',
      stderr, exitCode, httpStatus,
    );
  }
  if (httpStatus === 404) {
    return new DtctlError('Resource not found (404).', stderr, exitCode, httpStatus);
  }
  return new DtctlError(`dtctl failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${stderr.trim().split('\n')[0]}`, stderr, exitCode, httpStatus);
}

function withContext(args: string[], opts: DtctlOpts): string[] {
  return opts.context ? [...args, '--context', opts.context] : args;
}

/** Run dtctl with a YAML body. dtctl does not read stdin, so we stage a temp file. */
async function runDtctlWithFile(args: string[], yaml: string): Promise<string> {
  const path = join(tmpdir(), `dt-evals-workflow-${process.pid}-${Date.now()}.yaml`);
  writeFileSync(path, yaml, 'utf-8');
  try {
    return await runDtctl(args.map(a => a === '__FILE__' ? path : a));
  } finally {
    try { unlinkSync(path); } catch { /* best effort */ }
  }
}

async function runDtctl(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('dtctl', args, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; code?: number | null };
    const stderr = (e.stderr ?? '') + (e.stdout ?? '');
    throw classifyError(stderr, e.code ?? null);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface WorkflowSummary {
  id: string;
  title: string;
  isDeployed?: boolean;
  tags?: string[];
}

export async function listWorkflows(opts: DtctlOpts = {}): Promise<WorkflowSummary[]> {
  const out = await runDtctl(withContext(['get', 'workflows', '-o', 'json', '--plain'], opts));
  const trimmed = out.trim();
  if (!trimmed || trimmed === '[]') return [];
  const parsed = JSON.parse(trimmed) as unknown;
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as { result?: unknown[] })?.result ?? [];
  return (arr as Array<Record<string, unknown>>).map(w => ({
    id: String(w['id'] ?? ''),
    title: String(w['title'] ?? ''),
    isDeployed: typeof w['isDeployed'] === 'boolean' ? (w['isDeployed'] as boolean) : undefined,
    tags: Array.isArray(w['tags']) ? (w['tags'] as string[]) : undefined,
  }));
}

/** Apply a workflow YAML body (create or update by id). Returns the resulting workflow id. */
export async function applyWorkflow(yaml: string, opts: DtctlOpts = {}): Promise<string> {
  const args = withContext(['apply', '-f', '__FILE__', '-o', 'json', '--plain'], opts);
  const out = await runDtctlWithFile(args, yaml);
  // dtctl apply emits the resource (json envelope) or a status line. Try both.
  const trimmed = out.trim();
  if (!trimmed) throw new DtctlError('dtctl apply returned no output', '', null);
  try {
    const parsed = JSON.parse(trimmed) as { id?: string; result?: { id?: string } };
    const id = parsed.id ?? parsed.result?.id;
    if (!id) throw new Error('no id in response');
    return id;
  } catch {
    // Fallback: scan for a UUID in the output.
    const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(trimmed);
    if (m) return m[0];
    throw new DtctlError(`Could not parse workflow id from dtctl output: ${trimmed.slice(0, 200)}`, '', null);
  }
}

export async function deleteWorkflow(id: string, opts: DtctlOpts = {}): Promise<void> {
  await runDtctl(withContext(['delete', 'workflow', id, '-y'], opts));
}

export async function getWorkflowYaml(id: string, opts: DtctlOpts = {}): Promise<string> {
  return runDtctl(withContext(['get', 'workflow', id, '-o', 'yaml', '--plain'], opts));
}

export async function getWorkflowJson(id: string, opts: DtctlOpts = {}): Promise<Record<string, unknown>> {
  const out = await runDtctl(withContext(['get', 'workflow', id, '-o', 'json', '--plain'], opts));
  const parsed = JSON.parse(out.trim()) as unknown;
  // dtctl wraps single-resource get in {"ok":true,"result":{…}} when running in agent mode
  if (parsed && typeof parsed === 'object' && 'result' in parsed) {
    return ((parsed as { result: Record<string, unknown> }).result);
  }
  return parsed as Record<string, unknown>;
}

export async function executeWorkflow(id: string, opts: DtctlOpts = {}): Promise<void> {
  await runDtctl(withContext(['exec', 'workflow', id, '--wait'], opts));
}
