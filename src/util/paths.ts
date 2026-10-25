import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const names =
    process.platform === 'win32'
      ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command]
      : [command];
  for (const dir of (env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return undefined;
}

export function findFfmpeg(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  return findOnPath('ffmpeg', env) ?? (env.FFMPEG_PATH && existsSync(env.FFMPEG_PATH) ? env.FFMPEG_PATH : undefined);
}

export function findFfprobe(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  return findOnPath('ffprobe', env);
}

/** Common install location used only for friendly diagnostics. */
export const COMMON_FONT_DIRS = [
  join(homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'),
  '/System/Library/Fonts',
  '/usr/share/fonts',
];
