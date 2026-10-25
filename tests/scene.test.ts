import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRepo, type Repo } from '../src/git/repo';
import { resolveCommits } from '../src/git/commits';
import { readFileAt } from '../src/git/content';
import { resolveSettings } from '../src/vscode/settings';
import type { ResolvedEnvironment } from '../src/vscode/environment';
import { buildScene, type BuildSceneOptions } from '../src/scene/build';
import { applyEdit } from '../src/scene/edits';
import type { Scene, SceneEvent } from '../src/scene/types';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(cwd: string, path: string, content: string | Buffer): void {
  const target = join(cwd, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

interface Fixture {
  dir: string;
  repo: Repo;
  first: string;
  second: string;
  third: string;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'animate-commits-scene-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'Scene Tester');
  git(dir, 'config', 'user.email', 'scene@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');

  write(dir, 'src/a.ts', 'export const value = 1;\n');
  write(dir, 'src/old.ts', 'export const legacy = true;\n');
  write(dir, 'pnpm-lock.yaml', 'lockfile v1\n');
  const first = commit(dir, 'Initial project');

  write(dir, 'src/a.ts', 'export const value = 1;\nexport const doubled = value * 2;\n');
  write(dir, 'src/new.ts', 'export function added() {\n  return true;\n}\n');
  write(dir, 'src/temp.ts', 'export const temp = 1;\n');
  write(dir, 'pnpm-lock.yaml', 'lockfile v2\nextra: true\n');
  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  git(dir, 'mv', 'src/old.ts', 'src/lib/old.ts');
  const second = commit(dir, 'Add math helpers');

  write(dir, 'src/new.ts', 'export function added() {\n  return false;\n}\n');
  rmSync(join(dir, 'src/temp.ts'));
  const third = commit(dir, 'Tune helpers');
  write(dir, 'image.bin', Buffer.from([0, 1, 2, 3, 4]));
  commit(dir, 'Add binary asset');

  return { dir, repo: { root: dir }, first, second, third };
}

function fakeEnvironment(): ResolvedEnvironment {
  return {
    themes: [],
    theme: {
      label: 'Test Theme',
      kind: 'dark',
      uiTheme: 'vs-dark',
      themePath: '/tmp/theme.json',
      colors: {
        'editor.background': '#1f1f1f',
        'editor.foreground': '#cccccc',
      },
      tokenColors: [],
    },
    settings: {
      userPath: '',
      workspacePath: '',
      user: {},
      workspace: {},
      merged: {},
      hasUserFile: false,
      hasWorkspaceFile: false,
    },
    resolvedSettings: resolveSettings({}, 'win32'),
    platform: 'win32',
  };
}

function baseOptions(
  fixture: Fixture,
  commits: Awaited<ReturnType<typeof resolveCommits>>,
  overrides: Partial<BuildSceneOptions> = {},
): BuildSceneOptions {
  return {
    repo: fixture.repo,
    commits,
    environment: fakeEnvironment(),
    width: 1280,
    height: 800,
    dpr: 1,
    platform: 'windows',
    showExplorer: true,
    showScm: false,
    maxFileLines: 500,
    maxTabs: 8,
    ignore: ['pnpm-lock.yaml'],
    typing: { baseMs: 5, jitterMs: 0, speed: 1, seed: 42, noTyping: false, budget: 500 },
    introMs: 100,
    outroMs: 100,
    ...overrides,
  };
}

function replay(scene: Scene): Map<string, string> {
  const docs = new Map<string, string>();
  const lines = (text: string) => text.split('\n');
  for (const event of scene.events) {
    switch (event.type) {
      case 'file-content':
        docs.set(event.path, event.text);
        break;
      case 'create':
        if (!docs.has(event.path)) docs.set(event.path, '');
        break;
      case 'rename': {
        const text = docs.get(event.from);
        if (text !== undefined) {
          docs.set(event.to, text);
          docs.delete(event.from);
        }
        break;
      }
      case 'delete':
        docs.delete(event.path);
        break;
      case 'edit': {
        const current = docs.get(event.path) ?? '';
        docs.set(
          event.path,
          applyEdit(
            lines(current),
            event.line,
            event.col,
            event.deleteText ?? '',
            event.insertText ?? '',
          ).join('\n'),
        );
        break;
      }
      default:
        break;
    }
  }
  return docs;
}

describe('scene builder', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = makeFixture();
  });

  it('builds a single-commit scene and replays to the exact file contents', async () => {
    const commits = await resolveCommits(fixture.repo, { commit: fixture.second });
    const scene = await buildScene(baseOptions(fixture, commits, { showScm: true }));
    expect(scene.commits).toHaveLength(1);
    expect(scene.meta.initialFiles).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/old.ts', 'pnpm-lock.yaml']),
    );
    expect(scene.events.some((event) => event.type === 'create')).toBe(true);
    expect(scene.events.some((event) => event.type === 'rename')).toBe(true);
    expect(scene.events.some((event) => event.type === 'scm-set')).toBe(true);
    expect(scene.events.some((event) => event.type === 'commit')).toBe(true);
    expect(scene.events.some((event) => event.type === 'toast')).toBe(true);
    expect(scene.meta.warnings.length).toBeGreaterThan(0);

    const docs = replay(scene);
    for (const path of ['src/a.ts', 'src/new.ts']) {
      const expected = await readFileAt(fixture.repo, fixture.second, path);
      expect(docs.get(path)).toBe(expected?.text);
    }
    expect(docs.has('pnpm-lock.yaml')).toBe(false);
  });

  it('replays a range on shared workspace state', async () => {
    const commits = await resolveCommits(fixture.repo, { range: `${fixture.first}..${fixture.third}` });
    const scene = await buildScene(baseOptions(fixture, commits));
    expect(scene.commits.map((commit) => commit.subject)).toEqual([
      'Add math helpers',
      'Tune helpers',
    ]);
    const docs = replay(scene);
    const expected = await readFileAt(fixture.repo, fixture.third, 'src/new.ts');
    expect(docs.get('src/new.ts')).toBe(expected?.text);
    for (const event of scene.events) {
      expect(event.t).toBeGreaterThanOrEqual(0);
      if (event.until !== undefined) expect(event.until).toBeGreaterThanOrEqual(event.t);
    }
    const sorted = [...scene.events].sort((a, b) => a.t - b.t);
    expect(scene.events).toEqual(sorted);
  });

  it('opens files through quick open when the explorer is hidden', async () => {
    const commits = await resolveCommits(fixture.repo, { commit: fixture.first });
    const scene = await buildScene(
      baseOptions(fixture, commits, { showExplorer: false, showScm: false }),
    );
    expect(scene.meta.initialSidebar).toBeNull();
    const opens = scene.events.filter((event) => event.type === 'open-file');
    expect(opens.length).toBeGreaterThan(0);
    expect(opens.every((event) => event.type === 'open-file' && event.via === 'quickopen')).toBe(true);
    expect(scene.events.some((event) => event.type === 'quickopen')).toBe(true);
    const docs = replay(scene);
    const expected = await readFileAt(fixture.repo, fixture.first, 'src/a.ts');
    expect(docs.get('src/a.ts')).toBe(expected?.text);
  });

  it('temporarily reveals the explorer for structural file operations', async () => {
    const commits = await resolveCommits(fixture.repo, { commit: fixture.second });
    const scene = await buildScene(baseOptions(fixture, commits, { showExplorer: false }));
    const sidebarViews = scene.events
      .filter((event) => event.type === 'sidebar')
      .map((event) => (event.type === 'sidebar' ? event.view : null));
    expect(sidebarViews).toContain('explorer');
    const rename = scene.events.find((event) => event.type === 'rename');
    expect(rename).toBeDefined();
    if (rename?.type === 'rename') {
      expect(rename.via).toBe('drag');
      expect(rename.to).toBe('src/lib/old.ts');
    }
  });

  it('shows the delete flow for removed files', async () => {
    const commits = await resolveCommits(fixture.repo, { commit: fixture.third });
    const scene = await buildScene(baseOptions(fixture, commits));
    expect(scene.events.some((event) => event.type === 'contextmenu')).toBe(true);
    expect(scene.events.some((event) => event.type === 'dialog')).toBe(true);
    const del = scene.events.find((event) => event.type === 'delete');
    expect(del?.type === 'delete' ? del.path : undefined).toBe('src/temp.ts');
  });

  it('produces deterministic timing for the same seed', async () => {
    const commits = await resolveCommits(fixture.repo, { commit: fixture.second });
    const first = await buildScene(baseOptions(fixture, commits));
    const second = await buildScene(baseOptions(fixture, commits));
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
    expect(first.durationMs).toBe(second.durationMs);
  });

  it('scales timing and keeps events ordered', async () => {
    const commits = await resolveCommits(fixture.repo, { commit: fixture.first });
    const normal = await buildScene(baseOptions(fixture, commits));
    const fast = await buildScene(
      baseOptions(fixture, commits, {
        typing: { baseMs: 5, jitterMs: 0, speed: 2, seed: 42, noTyping: false, budget: 500 },
      }),
    );
    expect(fast.durationMs).toBeCloseTo(normal.durationMs / 2, -1);
    expect(fast.events[fast.events.length - 1]!.t).toBeLessThan(normal.events[normal.events.length - 1]!.t);
  });

  it('skips binary files but keeps them in source control', async () => {
    const head = git(fixture.dir, 'rev-parse', 'HEAD');
    const commits = await resolveCommits(fixture.repo, { commit: head });
    const scene = await buildScene(baseOptions(fixture, commits, { showScm: true }));
    expect(scene.meta.warnings.some((warning) => warning.includes('image.bin'))).toBe(true);
    expect(scene.events.some((event) => event.type === 'open-file')).toBe(false);
    const scm = scene.events.find(
      (event): event is Extract<SceneEvent, { type: 'scm-set' }> => event.type === 'scm-set',
    );
    expect(scm?.entries.some((entry) => entry.path === 'image.bin')).toBe(true);
  });

  afterAll(() => {
    if (fixture) rmSync(fixture.dir, { recursive: true, force: true });
  });
});
