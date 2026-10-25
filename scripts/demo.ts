import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('out/demo-repo');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function write(path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

function commit(message: string): string {
  git('add', '-A');
  git('commit', '-m', message);
  return git('rev-parse', '--short', 'HEAD');
}

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
git('init', '-b', 'main');
git('config', 'user.name', 'Demo Author');
git('config', 'user.email', 'demo@example.com');
git('config', 'core.autocrlf', 'false');

write(
  'src/index.ts',
  `import { renderList } from './list';

const items = ['first', 'second'];

export function main(): void {
  console.log(renderList(items));
}

main();
`,
);
write(
  'src/list.ts',
  `export function renderList(items: string[]): string {
  return items.map((item) => \`- \${item}\`).join('\\n');
}
`,
);
write('src/legacy.ts', 'export const legacy = true;\n');
write(
  'README.md',
  `# Reading list

A tiny command-line reading list.
`,
);
write(
  'package.json',
  `{
  "name": "reading-list",
  "version": "0.1.0",
  "type": "module"
}
`,
);
const first = commit('Add the reading list');

git('mv', 'src/list.ts', 'src/render.ts');
write(
  'src/index.ts',
  `import { loadItems } from './storage';
import { renderList } from './render';

const items = loadItems();

export function main(): void {
  console.log(renderList(items));
}

main();
`,
);
write(
  'src/storage.ts',
  `import { readFileSync } from 'node:fs';

export function loadItems(): string[] {
  try {
    return readFileSync('items.txt', 'utf8').split('\\n').filter(Boolean);
  } catch {
    return [];
  }
}
`,
);
write(
  'src/legacy.ts',
  'export const legacy = true;\nexport const deprecated = true;\n',
);
const second = commit('Load items from disk');

write(
  'src/storage.ts',
  `import { readFileSync } from 'node:fs';

export function loadItems(): string[] {
  try {
    const text = readFileSync('items.txt', 'utf8');
    return text.split('\\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
`,
);
rmSync(join(root, 'src/legacy.ts'));
write(
  'src/theme.css',
  `:root {
  color-scheme: dark;
  font-family: system-ui, sans-serif;
}
`,
);
const third = commit('Handle empty input');

write(
  'README.md',
  `# Reading list

A tiny command-line reading list.

## Usage

Put one item per line in \`items.txt\`, then run:

\`\`\`bash
node src/index.ts
\`\`\`
`,
);
const fourth = commit('Document usage');

console.log(`Demo repository: ${root}`);
console.log(`Commits: ${first}..${fourth}`);
console.log('');
console.log('Try:');
console.log(
  `  pnpm exec tsx src/cli.ts render out/demo-repo --range ${first}..${fourth} --scm --out out/demo.mp4`,
);
console.log(
  `  pnpm exec tsx src/cli.ts preview out/demo-repo --range ${first}..${fourth} --scm --open`,
);
