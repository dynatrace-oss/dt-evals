import { stringify as stringifyYaml } from 'yaml';
import type { NotificationConfig, NotificationChannel } from '../config/schema.js';
import { parseCondition, conditionToDql, describeCondition } from './condition.js';

const WORKFLOW_TITLE_PREFIX = '[dt-evals]';
const MARKER_TAG = 'dt-evals/alert';

export interface RenderContext {
  /** Eval config `name` — used in workflow title and message body. */
  configName: string;
  /** Fallback service.name if the notification doesn't override it. */
  defaultService?: string;
  /** Dynatrace environment URL — used to build deep links to AI Observability and the workflow run. */
  environmentUrl?: string;
}

/**
 * Build deep links into the Dynatrace tenant. The primary landing page is the
 * Prompts Explorer in the GenAI Observability app, filtered to Evaluations and
 * — when a specific service is being watched — to that service.name. The
 * workflow-run link is the secondary "what just ran" entry point.
 *
 * The fragment format replicates what the Prompts Explorer UI itself produces
 * when you click into Evaluations and filter by Service: spaces become `+`,
 * `=` becomes `%3D`, and double-quoted facet names stay quoted.
 */
function buildLinks(environmentUrl: string | undefined, service: string):
  { aiObservability: string; workflowRun: string } | null {
  if (!environmentUrl) return null;
  const base = environmentUrl.replace(/\/$/, '');
  const prefix = `${base}/ui/apps/dynatrace.genai.observability/prompts/prompts-explorer?perspective=Evaluations`;
  const scoped = service && service !== '*';
  const aiObservability = scoped
    ? `${prefix}#filtering="Evaluation+score"+%3D+Yes+Service+%3D+${encodeServiceForFilter(service)}`
    : `${prefix}#filtering="Evaluation+score"+%3D+Yes`;
  return {
    aiObservability,
    workflowRun: `${base}/ui/apps/dynatrace.automations/executions/{{ execution_id }}`,
  };
}

/** Match the Prompts Explorer fragment encoding: space → `+`, everything else → %XX. */
function encodeServiceForFilter(service: string): string {
  return encodeURIComponent(service).replace(/%20/g, '+');
}

export interface RenderedWorkflow {
  /** YAML body to pass to `dtctl apply -f`. */
  yaml: string;
  /** Title that will appear in the Dynatrace UI. */
  title: string;
  /** Notification name, copied for convenience. */
  name: string;
}

/**
 * Convert "5m" / "1h" / "30s" / "1d" into a cron expression for
 * Dynatrace workflow schedule triggers, plus a human label and the DQL `duration("…")` value.
 *
 * Note: seconds are not representable in cron. We clamp `<60s` up to 1m.
 */
export function parseWindow(window: string): { cron: string; humanText: string; dqlDuration: string } {
  const m = /^(\d+)([smhd])$/.exec(window);
  if (!m) throw new Error(`Invalid window "${window}" — expected like "5m", "1h", "24h"`);
  const n = parseInt(m[1]!, 10);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  if (n <= 0) throw new Error(`Window must be > 0 (got "${window}")`);

  const humanUnit: Record<typeof unit, string> = { s: 'second', m: 'minute', h: 'hour', d: 'day' };
  let cron: string;
  switch (unit) {
    case 's':
    case 'm': {
      const minutes = unit === 's' ? Math.max(1, Math.round(n / 60)) : n;
      cron = minutes >= 60 ? `0 */${Math.floor(minutes / 60)} * * *` : `*/${minutes} * * * *`;
      break;
    }
    case 'h':
      cron = `0 */${n} * * *`;
      break;
    case 'd':
      cron = `0 0 */${n} * *`;
      break;
  }
  return {
    cron,
    humanText: `${n} ${humanUnit[unit]}${n === 1 ? '' : 's'}`,
    dqlDuration: window,
  };
}

/** Escape a string for safe embedding into a DQL double-quoted literal. */
function dqlString(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildDqlQuery(n: NotificationConfig, defaultService: string | undefined, window: string): string {
  const parsed = parseCondition(n.condition);
  const service = n.service ?? defaultService;
  const serviceFilter = service && service !== '*'
    ? `| filter dt.service.name == "${dqlString(service)}" or service.name == "${dqlString(service)}" or k8s.container.name == "${dqlString(service)}" or dt.entity.service.name == "${dqlString(service)}"\n`
    : '';
  return [
    `fetch bizevents, from: now() - duration("${window}")`,
    `| filter event.type == "gen_ai.evaluation.result"`,
    `| filter gen_ai.evaluation.name == "${dqlString(n.metric)}"`,
    serviceFilter.trimEnd(),
    conditionToDql(parsed),
  ].filter(Boolean).join('\n');
}

interface MessageFields {
  notificationName: string;
  configName: string;
  service: string;
  metric: string;
  threshold: string;     // human description, e.g. "avg > 2"
  windowText: string;    // e.g. "15 minutes"
  observedExpr: string;  // template expression for observed value at runtime
  links: { aiObservability: string; workflowRun: string } | null;
}

/** Slack mrkdwn body. `<url|text>` becomes a clickable link in Slack. */
function slackBody(f: MessageFields): string {
  const lines = [
    `:rotating_light: *dt-evals alert — ${f.notificationName}*`,
    '',
    `*Service:* \`${f.service}\``,
    `*Metric:* \`${f.metric}\``,
    `*Threshold breached:* \`${f.threshold}\`  _(window: ${f.windowText})_`,
    `*Observed:* \`${f.observedExpr}\``,
    `*Config:* \`${f.configName}\``,
  ];
  if (f.links) {
    lines.push('');
    lines.push(`<${f.links.aiObservability}|Open AI Observability →>   ·   <${f.links.workflowRun}|View workflow run →>`);
  }
  return lines.join('\n');
}

/** Plain-text email body. Keep it scannable on phones. */
function emailBody(f: MessageFields): string {
  const lines = [
    `dt-evals alert — ${f.notificationName}`,
    '─'.repeat(40),
    '',
    `Service:            ${f.service}`,
    `Metric:             ${f.metric}`,
    `Threshold breached: ${f.threshold}  (window: ${f.windowText})`,
    `Observed:           ${f.observedExpr}`,
    `Config:             ${f.configName}`,
  ];
  if (f.links) {
    lines.push('', 'Links:');
    lines.push(`  AI Observability: ${f.links.aiObservability}`);
    lines.push(`  Workflow run:     ${f.links.workflowRun}`);
  }
  lines.push('', '— Sent by dt-evals');
  return lines.join('\n');
}

/**
 * JSON body for generic / Slack-incoming-webhook POSTs. We send both a flat
 * `text` field (for Slack-style consumers) and a structured `alert` object so
 * other consumers (PagerDuty proxy, custom routers) can read fields directly.
 */
function webhookBody(f: MessageFields): string {
  return JSON.stringify({
    text: slackBody(f),
    alert: {
      notification: f.notificationName,
      config: f.configName,
      service: f.service,
      metric: f.metric,
      threshold: f.threshold,
      window: f.windowText,
      observed: f.observedExpr,
      links: f.links ?? undefined,
    },
  });
}

function buildSlackTask(channel: NotificationChannel, f: MessageFields): Record<string, unknown> {
  // type:slack always uses the Dynatrace Slack app action, which renders the proper
  // form UI (connection dropdown, channel picker, markdown message). Validation in
  // src/config/index.ts ensures connection is set and webhookUrl is not.
  return {
    action: 'dynatrace.slack:slack-send-message',
    name: 'notify',
    description: 'Send Slack message',
    input: {
      connection: channel.connection,
      channel: channel.channel ?? '#general',
      message: slackBody(f),
      reactions: [],
      reply_in_thread: false,
    },
  };
}

function buildEmailTask(channel: NotificationChannel, subject: string, f: MessageFields): Record<string, unknown> {
  // Field shape matches what the Dynatrace email action actually accepts:
  // flat to/cc/bcc/subject/content — no `connection` block, no `body: { body, contentType }` wrapper.
  return {
    action: 'dynatrace.email:send-email',
    name: 'notify',
    description: 'Send email notification',
    input: {
      subject: channel.subject ?? subject,
      to: channel.to ?? [],
      cc: [],
      bcc: [],
      content: emailBody(f),
    },
  };
}

function buildGenericWebhookTask(channel: NotificationChannel, f: MessageFields): Record<string, unknown> {
  return {
    action: 'dynatrace.automations:run-javascript',
    name: 'notify',
    description: 'POST to webhook',
    input: {
      script: webhookScript(channel.webhookUrl!, webhookBody(f)),
    },
  };
}

/**
 * Build a small JS module that POSTs the given JSON body to the URL.
 * Uses `dynatrace.automations:run-javascript`, which is a core action available
 * on every tenant — no extra app install required.
 *
 * The JSON body may contain Jinja placeholders like `{{ result(...) }}`;
 * AutomationEngine substitutes those across the entire `script` field at runtime.
 */
function webhookScript(url: string, body: string): string {
  // Escape characters that would break a JS backtick template literal.
  const safeBody = body
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    'export default async function () {',
    `  const response = await fetch("${safeUrl}", {`,
    '    method: "POST",',
    '    headers: { "Content-Type": "application/json" },',
    '    body: `' + safeBody + '`,',
    '  });',
    '  if (!response.ok) {',
    '    const text = await response.text();',
    '    throw new Error("Webhook failed: " + response.status + " " + text);',
    '  }',
    '  return { status: response.status };',
    '}',
    '',
  ].join('\n');
}

export function renderWorkflow(
  n: NotificationConfig,
  ctx: RenderContext,
  existingId?: string,
): RenderedWorkflow {
  const parsed = parseCondition(n.condition);
  const window = parseWindow(n.window);
  const service = n.service ?? ctx.defaultService ?? '*';
  const title = `${WORKFLOW_TITLE_PREFIX} ${ctx.configName}:${n.name}`;
  const dql = buildDqlQuery(n, ctx.defaultService, window.dqlDuration);
  const description = describeCondition(parsed, n.metric);
  const fields: MessageFields = {
    notificationName: n.name,
    configName: ctx.configName,
    service,
    metric: n.metric,
    threshold: description,
    windowText: window.humanText,
    observedExpr: '{{ result("query_scores").records[0].agg }}',
    links: buildLinks(ctx.environmentUrl, service),
  };
  const emailSubject = `[dt-evals] ${service} — ${description}`;

  let notifyTask: Record<string, unknown>;
  if (n.channel.type === 'slack') notifyTask = buildSlackTask(n.channel, fields);
  else if (n.channel.type === 'email') notifyTask = buildEmailTask(n.channel, emailSubject, fields);
  else notifyTask = buildGenericWebhookTask(n.channel, fields);

  const workflow: Record<string, unknown> = {
    ...(existingId ? { id: existingId } : {}),
    title,
    description: `dt-evals alert: ${description}. Auto-generated; do not edit by hand.`,
    isPrivate: false,
    tags: [MARKER_TAG, `config:${ctx.configName}`, `notification:${n.name}`, `metric:${n.metric}`],
    trigger: {
      schedule: {
        trigger: {
          type: 'cron',
          cron: window.cron,
        },
        isActive: true,
        isFaulty: false,
        timezone: 'UTC',
      },
    },
    tasks: {
      query_scores: {
        name: 'query_scores',
        description: 'Fetch eval bizevents in window and apply condition',
        action: 'dynatrace.automations:execute-dql-query',
        input: { query: dql },
        position: { x: 0, y: 1 },
        predecessors: [],
      },
      notify: {
        ...notifyTask,
        position: { x: 0, y: 2 },
        predecessors: ['query_scores'],
        conditions: {
          states: { query_scores: 'SUCCESS' },
          custom: '{{ result("query_scores").records | length > 0 }}',
        },
      },
    },
  };

  const yaml = stringifyYaml(workflow, { indent: 2, lineWidth: 0 });
  return { yaml, title, name: n.name };
}

export function workflowTitle(configName: string, notificationName: string): string {
  return `${WORKFLOW_TITLE_PREFIX} ${configName}:${notificationName}`;
}

export { MARKER_TAG };
