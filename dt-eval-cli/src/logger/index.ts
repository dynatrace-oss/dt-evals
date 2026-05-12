import pc from 'picocolors';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface LoggerOptions {
  level?: LogLevel;   // default 'info'
  json?: boolean;     // structured JSON output (for --ci/--json)
  prefix?: string;    // e.g. '[dt-evals]'
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export class Logger {
  private level: LogLevel;
  private json: boolean;
  private prefix: string;

  constructor(options?: LoggerOptions) {
    this.level = options?.level ?? 'info';
    this.json = options?.json ?? false;
    this.prefix = options?.prefix ?? '';
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[this.level];
  }

  private formatJsonLine(level: string, msg: string, meta?: Record<string, unknown>): string {
    return JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...(meta ?? {}),
    });
  }

  private prefixMsg(msg: string): string {
    return this.prefix ? `${this.prefix} ${msg}` : msg;
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return;
    const full = this.prefixMsg(msg);
    if (this.json) {
      process.stdout.write(this.formatJsonLine('debug', full, meta) + '\n');
    } else {
      process.stderr.write(pc.dim(`[debug] ${full}`) + '\n');
    }
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    const full = this.prefixMsg(msg);
    if (this.json) {
      process.stdout.write(this.formatJsonLine('info', full, meta) + '\n');
    } else {
      process.stdout.write(full + '\n');
    }
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return;
    const full = this.prefixMsg(msg);
    if (this.json) {
      process.stdout.write(this.formatJsonLine('warn', full, meta) + '\n');
    } else {
      process.stderr.write(pc.yellow(`⚠ ${full}`) + '\n');
    }
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('error')) return;
    const full = this.prefixMsg(msg);
    if (this.json) {
      process.stdout.write(this.formatJsonLine('error', full, meta) + '\n');
    } else {
      process.stderr.write(pc.red(`✖ ${full}`) + '\n');
    }
  }

  success(msg: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    const full = this.prefixMsg(msg);
    if (this.json) {
      process.stdout.write(this.formatJsonLine('info', full, meta) + '\n');
    } else {
      process.stdout.write(pc.green(`✓ ${full}`) + '\n');
    }
  }

  timing(label: string, ms: number, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return;
    const full = this.prefixMsg(`⏱  ${label}: ${ms}ms`);
    if (this.json) {
      process.stdout.write(this.formatJsonLine('debug', full, { durationMs: ms, ...meta }) + '\n');
    } else {
      process.stderr.write(pc.dim(`[debug] ${full}`) + '\n');
    }
  }

  step(msg: string): void {
    if (!this.shouldLog('info')) return;
    const full = this.prefixMsg(msg);
    if (this.json) {
      process.stdout.write(this.formatJsonLine('info', full) + '\n');
    } else {
      process.stdout.write(pc.dim(`→ ${full}`) + '\n');
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setJson(json: boolean): void {
    this.json = json;
  }
}

// Global singleton
export const logger = new Logger();

export function configureLogger(options: LoggerOptions): void {
  if (options.level !== undefined) {
    logger.setLevel(options.level);
  }
  if (options.json !== undefined) {
    logger.setJson(options.json);
  }
}
