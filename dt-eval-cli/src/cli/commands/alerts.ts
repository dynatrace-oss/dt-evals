import { Command } from 'commander';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadConfig, validateConfig } from '../../config/index.js';
import type { DtEvalConfig, NotificationConfig } from '../../config/schema.js';
import { renderWorkflow, workflowTitle, type RenderContext } from '../../alerts/render.js';
import { resolveEndpoints } from '../../config/schema.js';
import { listContexts } from '../../dtctl/index.js';

const ALERT_TITLE_PREFIX = '[dt-evals]';
import { readIdMap, writeIdMap, setMapping, removeMapping, idMapPath } from '../../alerts/idmap.js';
import {
  applyWorkflow,
  listWorkflows,
  deleteWorkflow,
  getWorkflowJson,
  REQUIRED_SCOPES,
  OPTIONAL_SCOPES,
  DtctlError,
} from '../../alerts/dtctl.js';
import { logger } from '../../logger/index.js';
import { renderTable } from '../../ui/table.js';

interface CommonOpts {
  config?: string;
  context?: string;
}

interface LoadedConfig {
  config: DtEvalConfig;
  path: string;
}

function loadAndValidate(configArg: string | undefined, commonOpts: CommonOpts): LoadedConfig {
  const path = configArg ?? commonOpts.config;
  if (!path) {
    logger.error('No config file specified. Pass it as an argument: dt-evals alerts apply my.dt-eval.yaml');
    process.exit(1);
  }
  if (!existsSync(path)) {
    logger.error(`Config file not found: ${path}`);
    process.exit(1);
  }
  let config: DtEvalConfig;
  try {
    config = loadConfig({ projectFile: path });
    validateConfig(config);
  } catch (err) {
    logger.error(`Config error: ${(err as Error).message}`);
    process.exit(1);
  }
  return { config, path };
}

function getNotifications(config: DtEvalConfig): NotificationConfig[] {
  return config.alerts?.notifications ?? [];
}

/** Shared render context for all callsites: pulls configName, default service, and tenant URL. */
function renderContext(config: DtEvalConfig): RenderContext {
  const { origin } = resolveEndpoints(config.dynatrace);
  return {
    configName: config.name ?? 'unnamed',
    defaultService: config.scope?.service,
    environmentUrl: origin.environmentUrl || undefined,
  };
}

/**
 * Resolve the tenant URL we're actually talking to. When `--context X` is
 * passed, use the URL on the dtctl context; otherwise fall back to the eval
 * config's environmentUrl. This avoids printing a misleading review-link when
 * the user deploys to a different tenant than the YAML names.
 */
async function resolveTenantUrl(config: DtEvalConfig, contextName: string | undefined): Promise<string | null> {
  if (contextName) {
    try {
      const ctxs = await listContexts();
      const match = ctxs.find(c => c.name === contextName);
      if (match?.environmentUrl) return match.environmentUrl;
    } catch { /* fall through to config */ }
  }
  const { origin } = resolveEndpoints(config.dynatrace);
  return origin.environmentUrl || null;
}

async function workflowsAppUrl(config: DtEvalConfig, contextName: string | undefined): Promise<string | null> {
  const base = await resolveTenantUrl(config, contextName);
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/ui/apps/dynatrace.automations/workflows?search=dt-evals&owner=all`;
}

/**
 * If any of the applied notifications use `connection:`, explain that the
 * connection must exist in Dynatrace before the workflow can actually deliver.
 * Slack and SMTP connections are NOT auto-provisioned by `apply`.
 */
function printConnectionCallout(notifications: NotificationConfig[]): void {
  const slackConns = new Set<string>();
  let hasEmail = false;
  for (const n of notifications) {
    if (n.channel.type === 'slack' && n.channel.connection) slackConns.add(n.channel.connection);
    if (n.channel.type === 'email') hasEmail = true;
  }
  if (slackConns.size === 0 && !hasEmail) return;

  logger.info('');
  logger.info('⚠  Setup required for notifications to actually deliver:');
  if (slackConns.size > 0) {
    logger.info(`  Slack: workflows reference connection(s) ${[...slackConns].map(c => `"${c}"`).join(', ')}.`);
    logger.info('    Set them up in Dynatrace → Settings → Connections → Slack (OAuth).');
    logger.info('    Until the connection exists with the same name, the Slack notify task will fail.');
  }
  if (hasEmail) {
    logger.info('  Email: the Dynatrace email action uses your tenant default mail config —');
    logger.info('    configure it under Dynatrace → Settings → Notifications. No per-workflow');
    logger.info('    connection name is needed.');
  }
}

function logPermissionHint(): void {
  logger.info('');
  logger.info('Required permissions on the dtctl OAuth principal:');
  for (const s of REQUIRED_SCOPES) logger.info(`  • ${s}`);
  logger.info(`  • (optional) ${OPTIONAL_SCOPES.join(', ')}`);
}

function handleDtctlError(action: string, err: unknown): never {
  if (err instanceof DtctlError) {
    logger.error(`${action} failed: ${err.message}`);
    if (err.httpStatus === 401 || err.httpStatus === 403) logPermissionHint();
    if (err.stderr && process.env['DT_EVAL_DEBUG']) logger.error(err.stderr);
  } else {
    logger.error(`${action} failed: ${(err as Error).message}`);
  }
  process.exit(1);
}

// ── Subcommands ──────────────────────────────────────────────────────────────

function createRenderCommand(): Command {
  const cmd = new Command('render');
  cmd.description('Print rendered workflow YAML for each notification (no API calls)');
  cmd.argument('[config]', 'Path to eval config file');
  cmd.option('--config <path>', 'Path to eval config file');
  cmd.option('--name <name>', 'Render only this notification by name');
  cmd.option('--out <dir>', 'Write each workflow to <dir>/<name>.workflow.yaml instead of stdout');

  cmd.action(async (configArg: string | undefined, opts: CommonOpts & { name?: string; out?: string }) => {
    const { config, path } = loadAndValidate(configArg, opts);
    const notifications = getNotifications(config);
    if (notifications.length === 0) {
      logger.warn(`No alerts.notifications defined in ${path}`);
      logger.info('Add a `notifications:` block under `alerts:` to get started — see docs/alerts-design.md');
      return;
    }
    const idMap = readIdMap(path);
    const filtered = opts.name ? notifications.filter(n => n.name === opts.name) : notifications;
    if (filtered.length === 0) {
      logger.error(`Notification not found: ${opts.name}`);
      process.exit(1);
    }
    for (const n of filtered) {
      try {
        const rendered = renderWorkflow(n, renderContext(config), idMap.ids[n.name]);
        if (opts.out) {
          const outPath = join(opts.out, `${n.name}.workflow.yaml`);
          writeFileSync(outPath, rendered.yaml, 'utf-8');
          logger.success(`Wrote ${outPath}`);
        } else {
          console.log(`# ── ${rendered.title} ──`);
          console.log(rendered.yaml);
          console.log('');
        }
      } catch (err) {
        logger.error(`Failed to render "${n.name}": ${(err as Error).message}`);
        process.exit(1);
      }
    }
  });

  return cmd;
}

function createApplyCommand(): Command {
  const cmd = new Command('apply');
  cmd.description('Deploy notifications as Dynatrace Workflows (create or update). Idempotent.');
  cmd.argument('[config]', 'Path to eval config file');
  cmd.option('--config <path>', 'Path to eval config file');
  cmd.option('--context <name>', 'dtctl context to use');
  cmd.option('--dry-run', 'Render workflows and print what would happen, without calling dtctl');
  cmd.option('--name <name>', 'Apply only this notification by name');

  cmd.action(async (configArg: string | undefined, opts: CommonOpts & { dryRun?: boolean; name?: string }) => {
    const { config, path } = loadAndValidate(configArg, opts);
    const notifications = getNotifications(config);
    if (notifications.length === 0) {
      logger.warn(`No alerts.notifications defined in ${path} — nothing to apply.`);
      return;
    }
    const idMap = readIdMap(path);
    idMap.configName = config.name;
    const filtered = opts.name ? notifications.filter(n => n.name === opts.name) : notifications;
    if (filtered.length === 0) {
      logger.error(`Notification not found: ${opts.name}`);
      process.exit(1);
    }

    logger.info(`Applying ${filtered.length} notification(s) to dtctl context: ${opts.context ?? '(current)'}`);

    const rows: string[][] = [];
    let updated = idMap;

    for (const n of filtered) {
      const existingId = updated.ids[n.name];
      let rendered;
      try {
        rendered = renderWorkflow(n, renderContext(config), existingId);
      } catch (err) {
        logger.error(`Render failed for "${n.name}": ${(err as Error).message}`);
        process.exit(1);
      }

      if (opts.dryRun) {
        const tmp = join(tmpdir(), `dt-evals-alert-${n.name}-${Date.now()}.yaml`);
        writeFileSync(tmp, rendered.yaml, 'utf-8');
        rows.push([n.name, existingId ? 'would update' : 'would create', existingId ?? '-', tmp]);
        continue;
      }

      try {
        logger.step(`apply ${n.name}${existingId ? ` (update ${existingId})` : ' (create)'}`);
        const id = await applyWorkflow(rendered.yaml, { context: opts.context });
        updated = setMapping(updated, n.name, id);
        writeIdMap(updated);
        rows.push([n.name, existingId ? 'updated' : 'created', id, rendered.title]);
      } catch (err) {
        handleDtctlError(`apply "${n.name}"`, err);
      }
    }

    console.log(renderTable(['Name', 'Action', 'Workflow ID', opts.dryRun ? 'Rendered to' : 'Title'], rows));
    if (opts.dryRun) {
      logger.info('Dry run — no workflows were created or updated.');
    } else {
      logger.success(`Done. State stored at ${idMapPath(path)}`);
      const url = await workflowsAppUrl(config, opts.context);
      if (url) logger.info(`Review in Dynatrace: ${url}`);
      printConnectionCallout(filtered);
    }
  });

  return cmd;
}

function createListCommand(): Command {
  const cmd = new Command('list');
  cmd.description('List deployed alert workflows owned by this config');
  cmd.argument('[config]', 'Path to eval config file');
  cmd.option('--config <path>', 'Path to eval config file');
  cmd.option('--context <name>', 'dtctl context to use');
  cmd.option('--all', 'Show every workflow tagged dt-evals/alert, not just this config');

  cmd.action(async (configArg: string | undefined, opts: CommonOpts & { all?: boolean }) => {
    const path = configArg ?? opts.config;
    let allowed: Set<string> | null = null;
    let resolvedConfig: DtEvalConfig | undefined;
    if (path) {
      const loaded = loadAndValidate(configArg, opts);
      resolvedConfig = loaded.config;
      if (!opts.all) {
        const notifications = getNotifications(loaded.config);
        const idMap = readIdMap(path);
        allowed = new Set(notifications.map(n => workflowTitle(loaded.config.name ?? 'unnamed', n.name)));
        for (const id of Object.values(idMap.ids)) allowed.add(id);
      }
    }

    let workflows;
    try {
      workflows = await listWorkflows({ context: opts.context });
    } catch (err) {
      handleDtctlError('list workflows', err);
    }

    const filtered = workflows.filter(w => {
      const isDtEvals = w.title.startsWith(ALERT_TITLE_PREFIX);
      if (!isDtEvals) return false;
      if (allowed && !(allowed.has(w.title) || allowed.has(w.id))) return false;
      return true;
    });

    if (filtered.length === 0) {
      logger.info('No alert workflows found.');
    } else {
      console.log(renderTable(
        ['Workflow ID', 'Title', 'Deployed'],
        filtered.map(w => [w.id, w.title, w.isDeployed ? 'yes' : 'no']),
      ));
    }
    const url = resolvedConfig ? await workflowsAppUrl(resolvedConfig, opts.context) : null;
    if (url) logger.info(`Review in Dynatrace: ${url}`);
  });

  return cmd;
}

function createDeleteCommand(): Command {
  const cmd = new Command('delete');
  cmd.description('Delete one or all alert workflows for a config');
  cmd.argument('[config]', 'Path to eval config file');
  cmd.option('--config <path>', 'Path to eval config file');
  cmd.option('--context <name>', 'dtctl context to use');
  cmd.option('--name <name>', 'Delete only this notification');
  cmd.option('--all', 'Delete every notification owned by this config');

  cmd.action(async (configArg: string | undefined, opts: CommonOpts & { name?: string; all?: boolean }) => {
    if (!opts.name && !opts.all) {
      logger.error('Specify either --name <name> or --all');
      process.exit(1);
    }
    const { path } = loadAndValidate(configArg, opts);
    let map = readIdMap(path);
    const targets = opts.all
      ? Object.entries(map.ids)
      : Object.entries(map.ids).filter(([n]) => n === opts.name);

    if (targets.length === 0) {
      logger.warn(opts.all ? 'No alert workflows tracked for this config.' : `No workflow tracked for "${opts.name}"`);
      return;
    }

    for (const [name, id] of targets) {
      try {
        await deleteWorkflow(id, { context: opts.context });
        map = removeMapping(map, name);
        writeIdMap(map);
        logger.success(`Deleted "${name}" (${id})`);
      } catch (err) {
        if (err instanceof DtctlError && err.httpStatus === 404) {
          logger.warn(`"${name}" (${id}) already gone — clearing local mapping`);
          map = removeMapping(map, name);
          writeIdMap(map);
          continue;
        }
        handleDtctlError(`delete "${name}"`, err);
      }
    }
  });

  return cmd;
}

function createDiffCommand(): Command {
  const cmd = new Command('diff');
  cmd.description('Show diff between local (rendered) and remote workflow body');
  cmd.argument('[config]', 'Path to eval config file');
  cmd.option('--config <path>', 'Path to eval config file');
  cmd.option('--context <name>', 'dtctl context to use');
  cmd.option('--name <name>', 'Limit to one notification');

  cmd.action(async (configArg: string | undefined, opts: CommonOpts & { name?: string }) => {
    const { config, path } = loadAndValidate(configArg, opts);
    const notifications = getNotifications(config);
    const idMap = readIdMap(path);
    const filtered = opts.name ? notifications.filter(n => n.name === opts.name) : notifications;

    for (const n of filtered) {
      const id = idMap.ids[n.name];
      if (!id) {
        logger.info(`"${n.name}": not yet applied (no remote to diff against). Run \`dt-evals alerts apply\` first.`);
        continue;
      }
      let remote;
      try {
        remote = await getWorkflowJson(id, { context: opts.context });
      } catch (err) {
        handleDtctlError(`fetch remote "${n.name}"`, err);
      }
      const rendered = renderWorkflow(n, renderContext(config), id);
      const localObj = parseYaml(rendered.yaml) as Record<string, unknown>;

      console.log(`# ── diff: ${n.name} (workflow ${id}) ──`);
      const remoteNorm = normalizeWorkflowObject(remote);
      const localNorm = normalizeWorkflowObject(localObj);
      if (remoteNorm === localNorm) {
        console.log('  (in sync)');
      } else {
        printUnifiedDiff(remoteNorm, localNorm);
      }
      console.log('');
    }
  });

  return cmd;
}

/**
 * Strip server-injected fields and re-emit YAML with deterministic key ordering
 * so the diff shows only meaningful drift. Operates on parsed objects so it works
 * for either the JSON or YAML shape dtctl returns.
 */
function normalizeWorkflowObject(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return String(doc);
  const SERVER_KEYS = new Set([
    'owner', 'ownerType', 'isDeployed', 'isPrivate', 'lastExecution',
    'modificationInfo', 'usages', 'throttle', 'schemaVersion',
    'taskDefaults', 'actor',
    // server-side trigger metadata that varies between create-time and runtime
    'filterParameters', 'inputs', 'nextExecution', 'isFaulty',
    // we set tags on submit but the API discards them — drop on both sides to keep
    // the diff focused on fields the server actually persists
    'tags',
  ]);
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (SERVER_KEYS.has(k)) continue;
        if (val === null) continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return stringifyYaml(strip(doc), { indent: 2, lineWidth: 0, sortMapEntries: true });
}

function printUnifiedDiff(remote: string, local: string): void {
  const remoteLines = remote.split('\n');
  const localLines = local.split('\n');
  const max = Math.max(remoteLines.length, localLines.length);
  for (let i = 0; i < max; i++) {
    const r = remoteLines[i];
    const l = localLines[i];
    if (r === l) continue;
    if (r !== undefined) console.log(`- ${r}`);
    if (l !== undefined) console.log(`+ ${l}`);
  }
}

// ── Top-level ────────────────────────────────────────────────────────────────

export function createAlertsCommand(): Command {
  const cmd = new Command('alerts');
  cmd.description(
    'Manage server-side eval alerts as Dynatrace Workflows. ' +
    `Requires dtctl scopes: ${REQUIRED_SCOPES.join(', ')}.`,
  );
  cmd.addCommand(createApplyCommand());
  cmd.addCommand(createRenderCommand());
  cmd.addCommand(createListCommand());
  cmd.addCommand(createDiffCommand());
  cmd.addCommand(createDeleteCommand());
  return cmd;
}
