import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Locate dist/renderer from either the bundled CLI or a src/... module. */
export function findRendererDir(startDir = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, 'dist', 'renderer');
    if (existsSync(join(candidate, 'index.html'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Renderer assets not found. Run `pnpm build` before previewing or rendering.',
  );
}
