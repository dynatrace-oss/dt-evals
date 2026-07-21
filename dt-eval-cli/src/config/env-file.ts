import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Upsert `key=value` pairs into a dotenv-style file, preserving existing lines
 * and comments. Existing keys are updated in place; new keys are appended.
 *
 * Secrets live here (gitignored) rather than in the YAML config, and are loaded
 * into `process.env` at startup (see src/index.ts). Real environment variables
 * always take precedence over `.env`, so CI/CD pipeline secrets win.
 */
export function updateEnvFile(filePath: string, updates: Record<string, string>): void {
  const lines: string[] = existsSync(filePath)
    ? readFileSync(filePath, 'utf-8').split('\n')
    : [];

  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`) || l.startsWith(`${key} =`));
    const newLine = `${key}=${value}`;
    if (idx !== -1) {
      lines[idx] = newLine;
    } else {
      lines.push(newLine);
    }
  }

  // Remove trailing empty lines then add exactly one
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}
