import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { renderWorkflow, parseWindow } from '../../src/alerts/render.js';
import type { NotificationConfig } from '../../src/config/schema.js';

describe('parseWindow', () => {
  it('emits cron expressions for sub-hour intervals', () => {
    expect(parseWindow('5m').cron).toBe('*/5 * * * *');
    expect(parseWindow('15m').cron).toBe('*/15 * * * *');
    expect(parseWindow('30m').cron).toBe('*/30 * * * *');
  });
  it('emits cron expressions for hour intervals', () => {
    expect(parseWindow('1h').cron).toBe('0 */1 * * *');
    expect(parseWindow('6h').cron).toBe('0 */6 * * *');
  });
  it('clamps sub-minute windows up to one minute', () => {
    expect(parseWindow('30s').cron).toBe('*/1 * * * *');
  });
  it('rejects malformed windows', () => {
    expect(() => parseWindow('5kg')).toThrow();
    expect(() => parseWindow('0m')).toThrow();
  });
  it('reports duration string verbatim', () => {
    expect(parseWindow('15m').dqlDuration).toBe('15m');
  });
});

describe('renderWorkflow', () => {
  const n: NotificationConfig = {
    name: 'toxicity-spike',
    metric: 'toxicity',
    condition: 'avg > 2',
    window: '15m',
    channel: { type: 'slack', connection: 'my-slack', channel: '#alerts' },
  };

  it('produces a valid workflow YAML with cron trigger and query task', () => {
    const { yaml, title } = renderWorkflow(n, { configName: 'demo', defaultService: 'my-svc' });
    expect(title).toBe('[dt-evals] demo:toxicity-spike');
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed['title']).toBe(title);
    const trigger = parsed['trigger'] as { schedule: { trigger: { cron: string; type: string } } };
    expect(trigger.schedule.trigger.type).toBe('cron');
    expect(trigger.schedule.trigger.cron).toBe('*/15 * * * *');

    const tasks = parsed['tasks'] as Record<string, Record<string, unknown>>;
    expect(tasks['query_scores']?.['action']).toBe('dynatrace.automations:execute-dql-query');
    expect(tasks['notify']?.['action']).toBe('dynatrace.slack:slack-send-message');

    const query = (tasks['query_scores']?.['input'] as { query: string }).query;
    expect(query).toContain('event.type == "gen_ai.evaluation.result"');
    expect(query).toContain('gen_ai.evaluation.name == "toxicity"');
    expect(query).toContain('avg(toDouble(gen_ai.evaluation.score.value))');
    expect(query).toContain('my-svc');
  });

  it('drops the service filter when service is "*"', () => {
    const { yaml } = renderWorkflow({ ...n, service: '*' }, { configName: 'demo' });
    const parsed = parseYaml(yaml) as { tasks: Record<string, { input: { query: string } }> };
    expect(parsed.tasks['query_scores']!.input.query).not.toContain('service.name ==');
  });

  it('includes id when one is passed (for idempotent upsert)', () => {
    const { yaml } = renderWorkflow(n, { configName: 'demo' }, 'abc-123');
    const parsed = parseYaml(yaml) as { id?: string };
    expect(parsed.id).toBe('abc-123');
  });

  it('renders email channel as send-email with flat to/cc/bcc/subject/content', () => {
    const email: NotificationConfig = {
      ...n,
      channel: { type: 'email', to: ['a@b.com'] },
    };
    const { yaml } = renderWorkflow(email, { configName: 'demo' });
    const parsed = parseYaml(yaml) as { tasks: Record<string, { action: string; input: Record<string, unknown> }> };
    expect(parsed.tasks['notify']!.action).toBe('dynatrace.email:send-email');
    expect(parsed.tasks['notify']!.input['to']).toEqual(['a@b.com']);
    expect(parsed.tasks['notify']!.input['cc']).toEqual([]);
    expect(parsed.tasks['notify']!.input['bcc']).toEqual([]);
    expect(typeof parsed.tasks['notify']!.input['content']).toBe('string');
    // No `body: { contentType, body }` wrapper — that shape was wrong.
    expect(parsed.tasks['notify']!.input['body']).toBeUndefined();
  });

  it('renders type: webhook as a Run JavaScript task', () => {
    const wh: NotificationConfig = {
      ...n,
      channel: { type: 'webhook', webhookUrl: 'https://example.com/hook' },
    };
    const { yaml } = renderWorkflow(wh, { configName: 'demo' });
    const parsed = parseYaml(yaml) as { tasks: Record<string, { action: string; input: { script: string } }> };
    expect(parsed.tasks['notify']!.action).toBe('dynatrace.automations:run-javascript');
    expect(parsed.tasks['notify']!.input.script).toContain('https://example.com/hook');
  });

  describe('message body', () => {
    it('includes service, metric, threshold, observed and a config line', () => {
      const { yaml } = renderWorkflow(n, { configName: 'demo', defaultService: 'my-svc' });
      const parsed = parseYaml(yaml) as { tasks: Record<string, { input: { message: string } }> };
      const msg = parsed.tasks['notify']!.input.message;
      expect(msg).toContain('toxicity-spike');
      expect(msg).toContain('my-svc');
      expect(msg).toContain('toxicity');
      expect(msg).toContain('avg toxicity > 2');
      expect(msg).toContain('15 minutes');
      expect(msg).toContain('Observed:');
      expect(msg).toContain('demo');
    });

    it('embeds Prompts Explorer deep link filtered to Evaluations + this service', () => {
      const { yaml } = renderWorkflow(n, {
        configName: 'demo',
        defaultService: 'ai-travel-advisor-agent-test',
        environmentUrl: 'https://mho70695.apps.dynatrace.com',
      });
      const parsed = parseYaml(yaml) as { tasks: Record<string, { input: { message: string } }> };
      const msg = parsed.tasks['notify']!.input.message;
      expect(msg).toContain('/ui/apps/dynatrace.genai.observability/prompts/prompts-explorer?perspective=Evaluations');
      expect(msg).toContain('#filtering="Evaluation+score"+%3D+Yes+Service+%3D+ai-travel-advisor-agent-test');
      expect(msg).toContain('/ui/apps/dynatrace.automations/executions/');
    });

    it('drops the Service filter when service is "*" (watches all services)', () => {
      const { yaml } = renderWorkflow(
        { ...n, service: '*' },
        { configName: 'demo', environmentUrl: 'https://mho70695.apps.dynatrace.com' },
      );
      const parsed = parseYaml(yaml) as { tasks: Record<string, { input: { message: string } }> };
      const msg = parsed.tasks['notify']!.input.message;
      expect(msg).toContain('#filtering="Evaluation+score"+%3D+Yes');
      expect(msg).not.toContain('Service+%3D');
    });

    it('URL-encodes service names with spaces and reserved characters', () => {
      const { yaml } = renderWorkflow(n, {
        configName: 'demo',
        defaultService: 'my service / v2',
        environmentUrl: 'https://mho70695.apps.dynatrace.com',
      });
      const msg = (parseYaml(yaml) as { tasks: Record<string, { input: { message: string } }> })
        .tasks['notify']!.input.message;
      // Spaces become `+`, slash becomes %2F
      expect(msg).toContain('Service+%3D+my+service+%2F+v2');
    });

    it('omits link section when no environmentUrl is provided', () => {
      const { yaml } = renderWorkflow(n, { configName: 'demo' });
      const parsed = parseYaml(yaml) as { tasks: Record<string, { input: { message: string } }> };
      expect(parsed.tasks['notify']!.input.message).not.toContain('genai.observability');
    });

    it('writes a structured alert object in webhook body alongside the text', () => {
      const wh: NotificationConfig = {
        ...n,
        channel: { type: 'webhook', webhookUrl: 'https://example.com/hook' },
      };
      const { yaml } = renderWorkflow(wh, {
        configName: 'demo',
        defaultService: 'my-svc',
        environmentUrl: 'https://mho70695.apps.dynatrace.com',
      });
      const parsed = parseYaml(yaml) as { tasks: Record<string, { input: { script: string } }> };
      // The body is interpolated into a JS backtick template literal inside the script.
      const script = parsed.tasks['notify']!.input.script;
      const m = /body:\s*`([\s\S]*?)`,/m.exec(script);
      expect(m).not.toBeNull();
      // Undo JS-backtick escapes so the captured payload parses as JSON.
      const raw = m![1]!.replace(/\\\$\{/g, '${').replace(/\\`/g, '`').replace(/\\\\/g, '\\');
      const body = JSON.parse(raw) as { text: string; alert: Record<string, unknown> };
      expect(body.alert['service']).toBe('my-svc');
      expect(body.alert['metric']).toBe('toxicity');
      expect(body.alert['threshold']).toBe('avg toxicity > 2');
      expect(body.alert['window']).toBe('15 minutes');
      expect((body.alert['links'] as { aiObservability: string }).aiObservability).toContain('ai.observability');
    });

    it('renders email body with subject including the service and threshold', () => {
      const email: NotificationConfig = {
        ...n,
        channel: { type: 'email', to: ['a@b.com'] },
      };
      const { yaml } = renderWorkflow(email, { configName: 'demo', defaultService: 'my-svc' });
      const parsed = parseYaml(yaml) as { tasks: Record<string, { input: { subject: string; content: string } }> };
      expect(parsed.tasks['notify']!.input.subject).toContain('my-svc');
      expect(parsed.tasks['notify']!.input.subject).toContain('avg toxicity > 2');
      expect(parsed.tasks['notify']!.input.content).toContain('Service:');
      expect(parsed.tasks['notify']!.input.content).toContain('Threshold breached:');
    });
  });
});
