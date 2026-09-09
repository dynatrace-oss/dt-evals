import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../../src/logger/index.js';

// `add --from-file` calls createCustomPrompt from @dynatrace-oss/dt-eval-lib
// directly. Mocking it here means we never touch the real prompt store on
// disk (~/.config/dt-eval/custom-prompts.json).
const createCustomPrompt = vi.fn();

vi.mock('@dynatrace-oss/dt-eval-lib', async () => {
  const actual = await vi.importActual<typeof import('@dynatrace-oss/dt-eval-lib')>('@dynatrace-oss/dt-eval-lib');
  return {
    ...actual,
    createCustomPrompt,
  };
});

const { createEvaluatorsCommand } = await import('../../../src/cli/commands/evaluators.js');

function writeTempJson(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dt-eval-cli-test-'));
  const path = join(dir, 'evaluator.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf-8');
  return path;
}

const VALID_DEFINITION = {
  id: 'routing-accuracy',
  name: 'Routing Accuracy',
  version: '1',
  description: 'Judges whether the orchestrator routed a query to the correct agent.',
  requiredFields: ['input', 'output'],
  scoring: { type: 'binary', range: [0, 1], threshold: 1 },
  prompt: 'Did we route correctly?\n{{input}}\n{{output}}',
};

async function runAdd(args: string[]): Promise<void> {
  const cmd = createEvaluatorsCommand();
  await cmd.parseAsync(['node', 'dt-evals', 'add', ...args]);
}

describe('evaluators add --from-file', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let successSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createCustomPrompt.mockReset();
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    successSpy = vi.spyOn(logger, 'success').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    successSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('installs a valid definition by calling createCustomPrompt with the parsed object', async () => {
    const path = writeTempJson(VALID_DEFINITION);
    await runAdd(['--from-file', path]);

    expect(createCustomPrompt).toHaveBeenCalledTimes(1);
    expect(createCustomPrompt).toHaveBeenCalledWith(VALID_DEFINITION);
    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('routing-accuracy'));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts an output-only prompt', async () => {
    const path = writeTempJson({ ...VALID_DEFINITION, prompt: 'Judge this: {{output}}' });

    await runAdd(['--from-file', path]);
    expect(createCustomPrompt).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('rejects a prompt with no placeholder at all', async () => {
    const path = writeTempJson({ ...VALID_DEFINITION, prompt: 'No placeholders here' });

    await expect(runAdd(['--from-file', path])).rejects.toThrow('process.exit(1)');
    expect(createCustomPrompt).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('placeholder'));
  });

  it('rejects invalid JSON with a readable error, not a raw stack trace', async () => {
    const path = writeTempJson('{ not valid json');

    await expect(runAdd(['--from-file', path])).rejects.toThrow('process.exit(1)');
    expect(createCustomPrompt).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
  });

  it('rejects a definition with a bad scoring.type', async () => {
    const path = writeTempJson({
      ...VALID_DEFINITION,
      scoring: { type: 'not-a-real-scale', range: [0, 1], threshold: 1 },
    });

    await expect(runAdd(['--from-file', path])).rejects.toThrow('process.exit(1)');
    expect(createCustomPrompt).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('scoring.type'));
  });
});

describe('shipped routing-accuracy examples', () => {
  it.each(['routing-accuracy', 'session-routing-accuracy'])(
    '%s.evaluator.json passes validation',
    async (name) => {
      const { validatePromptDefinition } = await import('../../../src/cli/commands/evaluators.js');
      const raw = readFileSync(
        join(__dirname, `../../../examples/routing-accuracy/${name}.evaluator.json`),
        'utf-8',
      );
      expect(validatePromptDefinition(JSON.parse(raw))).toEqual([]);
    },
  );
});
