import figlet from 'figlet';

const RESET = '\x1b[0m';

// Pink → purple horizontal gradient
const START = { r: 255, g: 80, b: 180 };  // hot pink
const END   = { r: 110, g: 20, b: 240 };  // deep purple

function colorAt(t: number): string {
  const r = Math.round(START.r + (END.r - START.r) * t);
  const g = Math.round(START.g + (END.g - START.g) * t);
  const b = Math.round(START.b + (END.b - START.b) * t);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function applyGradient(text: string): string {
  const lines = text.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length), 1);

  return lines.map(line => {
    if (!line.trim()) return line;
    return (
      line
        .split('')
        .map((ch, i) => colorAt(i / (maxLen - 1)) + ch)
        .join('') + RESET
    );
  }).join('\n');
}

export function printBanner(): void {
  if (!process.stdout.isTTY) return;

  const banner = figlet.textSync('DT-EVALS', { font: 'ANSI Shadow' });

  process.stdout.write('\n' + applyGradient(banner) + '\n');
  process.stdout.write('  Welcome to dt-evals\n');
  process.stdout.write('  Evaluate production LLM & agent interactions with Dynatrace AI Observability.\n\n');
}

export function printDoctorBanner(): void {
  if (!process.stdout.isTTY) return;

  const banner = figlet.textSync('DT-EVALS-DOCTOR', { font: 'ANSI Shadow' });

  process.stdout.write('\n' + applyGradient(banner) + '\n');
  process.stdout.write('  Environment health check & guided setup\n\n');
}
