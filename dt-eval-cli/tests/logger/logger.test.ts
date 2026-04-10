import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Logger', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let Logger: typeof import('../../src/logger/index.js').Logger;
  let loggerModule: typeof import('../../src/logger/index.js');

  beforeEach(async () => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    loggerModule = await import('../../src/logger/index.js');
    Logger = loggerModule.Logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('info writes to stdout', () => {
    const log = new Logger({ level: 'info' });
    log.info('hello world');
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('hello world'));
  });

  it('error writes to stderr', () => {
    const log = new Logger({ level: 'info' });
    log.error('something went wrong');
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('something went wrong'));
  });

  it('warn writes to stderr', () => {
    const log = new Logger({ level: 'info' });
    log.warn('careful here');
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('careful here'));
  });

  it('debug not emitted at info level', () => {
    const log = new Logger({ level: 'info' });
    log.debug('hidden debug message');
    const allCalls = [
      ...stdoutWrite.mock.calls.map(c => String(c[0])),
      ...stderrWrite.mock.calls.map(c => String(c[0])),
    ];
    expect(allCalls.some(s => s.includes('hidden debug message'))).toBe(false);
  });

  it('debug emitted at debug level', () => {
    const log = new Logger({ level: 'debug' });
    log.debug('visible debug message');
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('visible debug message'));
  });

  it('success writes to stdout with check mark', () => {
    const log = new Logger({ level: 'info' });
    log.success('operation succeeded');
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('operation succeeded'));
    const call = stdoutWrite.mock.calls[0]?.[0] as string;
    expect(call).toContain('✓');
  });

  it('json mode emits valid JSON lines', () => {
    const log = new Logger({ level: 'info', json: true });
    log.info('test message');
    const call = stdoutWrite.mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(call.trim())).not.toThrow();
  });

  it('json mode includes level and msg fields', () => {
    const log = new Logger({ level: 'info', json: true });
    log.info('json msg test');
    const call = stdoutWrite.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(call.trim()) as Record<string, unknown>;
    expect(parsed['level']).toBe('info');
    expect(parsed['msg']).toContain('json msg test');
  });

  it('setLevel changes level at runtime', () => {
    const log = new Logger({ level: 'info' });
    log.debug('should not appear');
    expect(stderrWrite).not.toHaveBeenCalled();

    log.setLevel('debug');
    log.debug('should appear now');
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('should appear now'));
  });

  it('logger singleton is shared instance', async () => {
    const mod1 = await import('../../src/logger/index.js');
    const mod2 = await import('../../src/logger/index.js');
    expect(mod1.logger).toBe(mod2.logger);
  });
});
