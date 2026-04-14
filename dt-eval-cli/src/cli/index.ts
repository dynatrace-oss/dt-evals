import { Command } from 'commander';
import { createConfigureCommand } from './commands/configure.js';
import { createRunCommand } from './commands/run.js';
import { createStatusCommand } from './commands/status.js';
import { createScheduleCommand } from './commands/schedule.js';
import { createEvaluatorsCommand } from './commands/evaluators.js';
import { createRunsCommand } from './commands/runs.js';
import { createValidateCommand } from './commands/validate.js';
import { configureLogger } from '../logger/index.js';
import { printBanner } from '../ui/banner.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('dt-eval-cli')
    .description('Run evaluations on your GenAI traces in Dynatrace')
    .version('0.1.0');

  // Show banner before the help text
  program.addHelpText('beforeAll', () => {
    printBanner();
    return '';
  });

  program.option('--verbose', 'Enable verbose debug output');
  program.option('--json', 'Output structured JSON (for CI/scripts)');

  program.hook('preAction', (_thisCommand, _actionCommand) => {
    const opts = program.opts<{ verbose?: boolean; json?: boolean }>();
    if (opts.verbose) configureLogger({ level: 'debug' });
    if (opts.json) configureLogger({ json: true });
  });

  program.addCommand(createConfigureCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createValidateCommand());
  program.addCommand(createEvaluatorsCommand());
  program.addCommand(createRunsCommand());
  program.addCommand(createScheduleCommand());

  return program;
}

export async function runCli(argv?: string[]): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv ?? process.argv);
}
