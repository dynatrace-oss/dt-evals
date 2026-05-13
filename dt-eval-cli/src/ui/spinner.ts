import pc from 'picocolors';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export class Spinner {
  private text: string;
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private isTTY: boolean;
  private running = false;

  constructor(text: string) {
    this.text = text;
    this.isTTY = process.stderr.isTTY === true;
  }

  start(text?: string): this {
    if (text !== undefined) {
      this.text = text;
    }
    if (this.running) {
      return this;
    }
    this.running = true;
    if (this.isTTY) {
      this.interval = setInterval(() => {
        const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
        this.frameIndex++;
        process.stderr.write(`\r${frame} ${this.text}`);
      }, INTERVAL_MS);
    } else {
      process.stderr.write(`${this.text}...\n`);
    }
    return this;
  }

  update(text: string): this {
    this.text = text;
    if (!this.isTTY && !this.running) {
      process.stderr.write(`${text}...\n`);
    }
    return this;
  }

  succeed(text?: string): this {
    this.stop();
    const msg = text ?? this.text;
    if (this.isTTY) {
      process.stderr.write(`\r${pc.green('✓')} ${msg}\n`);
    } else {
      process.stderr.write(`✓ ${msg}\n`);
    }
    return this;
  }

  fail(text?: string): this {
    this.stop();
    const msg = text ?? this.text;
    if (this.isTTY) {
      process.stderr.write(`\r${pc.red('✗')} ${msg}\n`);
    } else {
      process.stderr.write(`✗ ${msg}\n`);
    }
    return this;
  }

  stop(): this {
    this.running = false;
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
      if (this.isTTY) {
        process.stderr.write('\r\x1b[K'); // clear line
      }
    }
    return this;
  }
}
