import { describe, it, expect, vi, afterEach } from 'vitest';
import { Spinner } from '../../src/ui/spinner.js';

describe('Spinner', () => {
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalIsTTY) {
      Object.defineProperty(process.stderr, 'isTTY', originalIsTTY);
    } else {
      delete (process.stderr as { isTTY?: boolean }).isTTY;
    }
  });

  it('does not print live updates while running in non-TTY output', () => {
    Object.defineProperty(process.stderr, 'isTTY', {
      configurable: true,
      value: false,
    });
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const spinner = new Spinner('Fetching GenAI spans from Dynatrace...');
    spinner.start();
    spinner.update('Fetching GenAI spans from Dynatrace...');
    spinner.update('Evaluating 1/10 toxicity trace=trace-01...');
    spinner.succeed('Fetched 2 spans in 10ms');
    spinner.start('Sampling and masking spans...');
    spinner.start('Sampling and masking spans...');
    spinner.succeed('Evaluated 10 tasks in 1s');

    const output = stderrWrite.mock.calls.map(c => String(c[0])).join('');
    expect(output.match(/Fetching GenAI spans from Dynatrace/g)).toHaveLength(1);
    expect(output).not.toContain('Evaluating 1/10');
    expect(output.match(/Sampling and masking spans/g)).toHaveLength(1);
    expect(output).toContain('Fetched 2 spans in 10ms');
    expect(output).toContain('Evaluated 10 tasks in 1s');
  });
});
