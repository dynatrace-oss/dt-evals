import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRagasBizevents } from '../../src/ragas/ingest.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function writeResult(content: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dt-evals-ragas-'));
  directories.push(directory);
  const path = join(directory, 'result.json');
  await writeFile(path, JSON.stringify(content), 'utf-8');
  return path;
}

describe('buildRagasBizevents', () => {
  it('maps row-oriented Ragas metrics and omits inputs by default', async () => {
    const file = await writeResult([{
      trace_id: 'trace-123',
      user_input: 'Where is Paris?',
      response: 'Paris is in France.',
      faithfulness: 0.8,
      answer_relevancy: 0.4,
    }]);

    const result = await buildRagasBizevents(file, {
      runId: 'ragas-test',
      storeEvaluatedInput: false,
    });

    expect(result).toMatchObject({ rowsRead: 1, metricsRead: 2 });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trace_id: 'trace-123',
        'gen_ai.evaluation.name': 'faithfulness',
        'gen_ai.evaluation.spec_id': 'ragas.faithfulness',
        'gen_ai.evaluation.score.value': 0.8,
        'gen_ai.evaluation.score.label': 'pass',
        'dt.eval.run_id': 'ragas-test',
      }),
      expect.objectContaining({
        'gen_ai.evaluation.name': 'answer_relevancy',
        'gen_ai.evaluation.score.label': 'fail',
      }),
    ]));
    expect(result.events[0]).not.toHaveProperty('gen_ai.evaluation.input.question');
  });

  it('accepts scores nested in a Ragas result document', async () => {
    const file = await writeResult({
      scores: [{ user_input: 'Question', response: 'Answer', scores: { custom_metric: 1 } }],
    });

    const result = await buildRagasBizevents(file, {
      runId: 'ragas-test',
      storeEvaluatedInput: true,
    });

    expect(result.events).toEqual([
      expect.objectContaining({
        trace_id: 'ragas-ragas-test-0',
        'gen_ai.evaluation.name': 'custom_metric',
        'gen_ai.evaluation.input.question': 'Question',
        'gen_ai.evaluation.input.answer': 'Answer',
      }),
    ]);
  });
});
