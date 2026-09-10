import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, validateConfig } from '../src/config/index.js';

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');

// Every shipped example must load and pass the same validation a user's run
// would — this catches a broken config (e.g. a ReDoS-unsafe regex, an unknown
// deterministic method, an invalid scope.level) before it ships.
const shippedConfigs = [
  'code-evals/code-evals.dt-eval.yaml',
  'agent-session/agent-session.dt-eval.yaml',
];

describe('shipped example configs', () => {
  it.each(shippedConfigs)('%s loads and validates', (relPath) => {
    const configPath = join(examplesDir, relPath);
    expect(existsSync(configPath)).toBe(true);
    const config = loadConfig({ projectFile: configPath, globalFile: join(examplesDir, '__no_global__.yaml') });
    expect(() => validateConfig(config)).not.toThrow();
  });
});
