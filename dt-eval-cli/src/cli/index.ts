import { createRequire } from 'node:module';
import { Command } from 'commander';
import { createConfigureCommand } from './commands/configure.js';
import { createRunCommand } from './commands/run.js';
import { createStatusCommand } from './commands/status.js';
import { createScheduleCommand } from './commands/schedule.js';
import { createEvaluatorsCommand } from './commands/evaluators.js';
import { createRunsCommand } from './commands/runs.js';
import { createValidateCommand } from './commands/validate.js';
import { createDoctorCommand } from './commands/doctor.js';
import { configureLogger } from '../logger/index.js';
import { printBanner } from '../ui/banner.js';

declare const __CLIENT_VERSION__: string | undefined;

// __CLIENT_VERSION__ is replaced at build time by tsup; fall back to package.json in dev/tsx.
function resolveVersion(): string {
  try {
    if (typeof __CLIENT_VERSION__ !== 'undefined') return __CLIENT_VERSION__;
  } catch { /* not defined in dev/tsx */ }
  try {
    const require = createRequire(import.meta.url);
    return (require('../../package.json') as { version: string }).version;
  } catch { return 'dev'; }
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('dt-evals')
    .description('Run evaluations on your GenAI traces in Dynatrace')
    .version(resolveVersion());

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

  program.addCommand(createDoctorCommand());
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
