import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const STORAGE_DIR = join(homedir(), '.dt-eval');

/**
 * Map of notification-name -> workflow-id for a single eval config file.
 * Stored at ~/.dt-eval/alerts-<config-hash>.json so:
 *   - the same config on different machines produces different files (no collisions),
 *   - a renamed config file detaches from its old workflows (intentional — user can clean up).
 */
export interface AlertIdMap {
  configPath: string;
  configName?: string;
  ids: Record<string, string>;
}

function hashPath(configPath: string): string {
  return createHash('sha256').update(resolve(configPath)).digest('hex').slice(0, 16);
}

export function idMapPath(configPath: string): string {
  return join(STORAGE_DIR, `alerts-${hashPath(configPath)}.json`);
}

export function readIdMap(configPath: string): AlertIdMap {
  const path = idMapPath(configPath);
  if (!existsSync(path)) {
    return { configPath: resolve(configPath), ids: {} };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as AlertIdMap;
    return { ...parsed, ids: parsed.ids ?? {} };
  } catch {
    return { configPath: resolve(configPath), ids: {} };
  }
}

export function writeIdMap(map: AlertIdMap): void {
  const path = idMapPath(map.configPath);
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(map, null, 2), 'utf-8');
}

export function setMapping(map: AlertIdMap, name: string, id: string): AlertIdMap {
  return { ...map, ids: { ...map.ids, [name]: id } };
}

export function removeMapping(map: AlertIdMap, name: string): AlertIdMap {
  const { [name]: _, ...rest } = map.ids;
  return { ...map, ids: rest };
}
