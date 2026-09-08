import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { listPrompts, getPrompt, createCustomPrompt, deleteCustomPrompt, evaluate } from '@dynatrace-oss/dt-eval-lib';
import type { EvalConfig, Provider, PromptDefinition } from '@dynatrace-oss/dt-eval-lib';
import { loadConfig } from '../../config/index.js';
import { renderTable } from '../../ui/table.js';
import { Spinner } from '../../ui/spinner.js';
import { logger } from '../../logger/index.js';
import { buildCustomScoring } from './custom-scoring.js';

const REQUIRED_FIELD_VALUES = ['input', 'output', 'context', 'expectedOutput'];
const SCORING_TYPE_VALUES = ['binary', 'continuous', 'likert'];

/**
 * Validates a parsed custom evaluator definition before handing it to
 * `createCustomPrompt`, which performs no validation of its own.
 * Returns a list of human-readable problems; an empty list means the
 * definition is valid.
 */
export function validatePromptDefinition(def: unknown): string[] {
  const errors: string[] = [];

  if (typeof def !== 'object' || def === null) {
    return ['Evaluator definition must be a JSON object'];
  }

  const d = def as Record<string, unknown>;

  for (const field of ['id', 'name', 'version', 'description']) {
    if (typeof d[field] !== 'string' || d[field] === '') {
      errors.push(`"${field}" must be a non-empty string`);
    }
  }

  if (!Array.isArray(d['requiredFields']) || d['requiredFields'].length === 0) {
    errors.push('"requiredFields" must be a non-empty array');
  } else if (!d['requiredFields'].every((f) => REQUIRED_FIELD_VALUES.includes(f as string))) {
    errors.push(`"requiredFields" entries must be one of: ${REQUIRED_FIELD_VALUES.join(', ')}`);
  }

  const scoring = d['scoring'];
  if (typeof scoring !== 'object' || scoring === null) {
    errors.push('"scoring" must be an object');
  } else {
    const s = scoring as Record<string, unknown>;
    if (!SCORING_TYPE_VALUES.includes(s['type'] as string)) {
      errors.push(`"scoring.type" must be one of: ${SCORING_TYPE_VALUES.join(', ')}`);
    }
    if (typeof s['threshold'] !== 'number') {
      errors.push('"scoring.threshold" must be a number');
    }
    if (
      !Array.isArray(s['range']) ||
      s['range'].length !== 2 ||
      !s['range'].every((v) => typeof v === 'number')
    ) {
      errors.push('"scoring.range" must be a 2-element numeric array');
    }
  }

  const hasPrompt = typeof d['prompt'] === 'string' && d['prompt'] !== '';
  const hasMethod = typeof d['method'] === 'string' && d['method'] !== '';
  if (!hasPrompt && !hasMethod) {
    errors.push('Definition must have either "prompt" (LLM judge) or "method" (deterministic check)');
  }
  if (hasPrompt) {
    const prompt = d['prompt'] as string;
    if (!prompt.includes('{{input}}') && !prompt.includes('{{output}}')) {
      errors.push('"prompt" must contain at least one of the {{input}} or {{output}} placeholders');
    }
  }

  return errors;
}

export function createEvaluatorsCommand(): Command {
  const cmd = new Command('evaluators');
  cmd.description('Manage evaluator definitions (built-in and custom)');

  // evaluators list
  const listCmd = new Command('list');
  listCmd.description('List all available evaluators');

  listCmd.action(async () => {
    const prompts = await listPrompts();
    if (prompts.length === 0) {
      logger.info('No evaluators available.');
      return;
    }

    const headers = ['ID', 'Name', 'Type', 'Scale', 'Required Fields'];
    const rows = prompts.map(p => {
      const isBuiltIn = !('custom' in p) || !(p as Record<string, unknown>)['custom'];
      return [
        p.id,
        p.name,
        isBuiltIn ? 'built-in' : 'custom',
        p.scoring.type,
        p.requiredFields.join(', '),
      ];
    });

    console.log(renderTable(headers, rows));
  });

  // evaluators show <id>
  const showCmd = new Command('show');
  showCmd.description('Show an evaluator definition');
  showCmd.argument('<id>', 'Evaluator ID');

  showCmd.action(async (id: string) => {
    try {
      const prompt = await getPrompt(id);
      console.log(`ID: ${prompt.id}`);
      console.log(`Name: ${prompt.name}`);
      console.log(`Version: ${prompt.version}`);
      console.log(`Description: ${prompt.description}`);
      console.log(`Required Fields: ${prompt.requiredFields.join(', ')}`);
      console.log(`Scoring Scale: ${prompt.scoring.type}`);
      console.log(`Pass Threshold: ${prompt.scoring.threshold}`);
      console.log(`\nPrompt Template:\n${prompt.prompt}`);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

  // evaluators add
  const addCmd = new Command('add');
  addCmd.description('Add a custom evaluator (interactive wizard)');
  addCmd.option('--from-file <path>', 'Create a custom evaluator from a JSON PromptDefinition file, skipping the interactive wizard');

  addCmd.action(async (opts: { fromFile?: string }) => {
    if (opts.fromFile) {
      let raw: string;
      try {
        raw = readFileSync(opts.fromFile, 'utf-8');
      } catch (err) {
        logger.error(`Failed to read file "${opts.fromFile}": ${(err as Error).message}`);
        process.exit(1);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        logger.error(`Failed to parse "${opts.fromFile}" as JSON: ${(err as Error).message}`);
        process.exit(1);
        return;
      }

      const errors = validatePromptDefinition(parsed);
      if (errors.length > 0) {
        logger.error(`Invalid evaluator definition in "${opts.fromFile}":\n  - ${errors.join('\n  - ')}`);
        process.exit(1);
        return;
      }

      const definition = parsed as PromptDefinition;
      try {
        await createCustomPrompt(definition);
        logger.success(`Custom evaluator "${definition.id}" created`);
      } catch (err) {
        logger.error(`Failed to create evaluator: ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }

    let input: typeof import('@inquirer/prompts');
    try {
      input = await import('@inquirer/prompts');
    } catch {
      logger.error('@inquirer/prompts is required for interactive mode');
      process.exit(1);
    }

    const { input: promptInput, password: _password, select, checkbox } = input;

    const name = await promptInput({ message: 'Evaluator name' });
    const template = await promptInput({ message: 'Prompt template ({{input}} and {{output}} are required placeholders)' });

    const requiredFieldChoices = [
      { name: 'input', value: 'input' as const, checked: true },
      { name: 'output', value: 'output' as const, checked: true },
      { name: 'context', value: 'context' as const, checked: false },
      { name: 'expectedOutput', value: 'expectedOutput' as const, checked: false },
    ];

    const requiredFields = await checkbox({
      message: 'Required fields',
      choices: requiredFieldChoices,
    });

    const scoringType = await select({
      message: 'Scoring scale',
      choices: [
        { name: 'continuous', value: 'continuous' },
        { name: 'binary', value: 'binary' },
        { name: 'likert', value: 'likert' },
      ],
    });

    const thresholdStr = await promptInput({ message: 'Pass threshold', default: '0.7' });
    const threshold = parseFloat(thresholdStr);

    const description = await promptInput({ message: 'Description (optional)', default: '' });

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
      await createCustomPrompt({
        id,
        version: '1',
        name,
        description: description || name,
        prompt: template,
        requiredFields: requiredFields as ('input' | 'output' | 'context' | 'expectedOutput')[],
        scoring: buildCustomScoring(
          scoringType as 'continuous' | 'binary' | 'likert',
          threshold,
        ),
      });
      logger.success(`Custom evaluator "${id}" created`);
    } catch (err) {
      logger.error(`Failed to create evaluator: ${(err as Error).message}`);
      process.exit(1);
    }
  });

  // evaluators delete <id>
  const deleteCmd = new Command('delete');
  deleteCmd.description('Delete a custom evaluator');
  deleteCmd.argument('<id>', 'Evaluator ID');

  deleteCmd.action(async (id: string) => {
    let inquirer: typeof import('@inquirer/prompts');
    try {
      inquirer = await import('@inquirer/prompts');
    } catch {
      logger.error('@inquirer/prompts is required for interactive mode');
      process.exit(1);
    }

    const { confirm } = inquirer;
    const confirmed = await confirm({ message: `Delete evaluator "${id}"? This cannot be undone.` });
    if (!confirmed) {
      logger.info('Aborted.');
      return;
    }

    try {
      await deleteCustomPrompt(id);
      logger.success(`Evaluator "${id}" deleted`);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

  // evaluators test <id>
  const testCmd = new Command('test');
  testCmd.description('Test an evaluator with sample input interactively');
  testCmd.argument('<id>', 'Evaluator ID');

  testCmd.action(async (id: string) => {
    let prompt;
    try {
      prompt = await getPrompt(id);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }

    let inquirer: typeof import('@inquirer/prompts');
    try {
      inquirer = await import('@inquirer/prompts');
    } catch {
      logger.error('@inquirer/prompts is required for interactive mode');
      process.exit(1);
    }

    const { input: promptInput } = inquirer;

    const inputText = await promptInput({ message: 'Input (user question)' });
    const outputText = await promptInput({ message: 'Output (LLM response)' });
    const contextText = await promptInput({ message: 'Context (optional, enter to skip)', default: '' });

    let config;
    try {
      config = loadConfig();
    } catch (err) {
      logger.error(`Config error: ${(err as Error).message}`);
      process.exit(1);
    }

    const libConfig: EvalConfig = {
      provider: {
        provider: config.judge.provider as Provider,
        apiKey: config.judge.apiKey,
        baseUrl: config.judge.baseUrl,
        apiVersion: config.judge.apiVersion,
        region: config.judge.region,
        secretKey: config.judge.secretKey,
        project: config.judge.project,
        location: config.judge.location,
        model: config.judge.model,
        timeout: config.judge.timeout,
        maxRetries: config.judge.maxRetries,
      },
    };

    const spinner = new Spinner(`Running evaluation with ${config.judge.provider}/${config.judge.model ?? 'default'}...`);
    spinner.start();

    try {
      const result = await evaluate(prompt, {
        input: inputText,
        output: outputText,
        context: contextText || undefined,
      }, libConfig);

      spinner.succeed(`Score: ${result.score.value.toFixed(2)} (${result.score.label})`);
      console.log(`  Summary: ${result.explanation.summary}`);
      if ('reasoning' in result.explanation) {
        console.log(`  Reasoning: ${result.explanation['reasoning']}`);
      }
    } catch (err) {
      spinner.fail(`Evaluation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

  cmd.addCommand(listCmd);
  cmd.addCommand(showCmd);
  cmd.addCommand(addCmd);
  cmd.addCommand(deleteCmd);
  cmd.addCommand(testCmd);

  return cmd;
}
