import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { openRepo } from '../../src/git/repo';
import { resolveCommits } from '../../src/git/commits';
import { resolveSettings } from '../../src/vscode/settings';
import type { ResolvedEnvironment } from '../../src/vscode/environment';
import { buildScene } from '../../src/scene/build';
import { GrammarRegistry } from '../../src/grammar/resolve';
import { startSceneServer } from '../../src/server/serve';
import { findRendererDir } from '../../src/server/assets';
import { findBrowser } from '../../src/export/browser';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fakeEnvironment(): ResolvedEnvironment {
  return {
    themes: [],
    theme: {
      label: 'Smoke Theme',
      kind: 'dark',
      uiTheme: 'vs-dark',
      themePath: '/tmp/theme.json',
      colors: {
        'editor.background': '#1f1f1f',
        'editor.foreground': '#cccccc',
        'titleBar.activeBackground': '#181818',
        'titleBar.activeForeground': '#cccccc',
        'sideBar.background': '#181818',
        'statusBar.background': '#181818',
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
    resolvedSettings: resolveSettings({ 'editor.minimap.enabled': false }, 'win32'),
    platform: 'win32',
  };
}

function hexToRgb(hex: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})/i.exec(hex);
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

async function main(): Promise<void> {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.log('No Chromium-based browser found; skipping motion smoke test.');
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'animate-commits-motion-'));
  try {
    git(dir, 'init', '-b', 'main');
    git(dir, 'config', 'user.name', 'Motion Bot');
    git(dir, 'config', 'user.email', 'motion@example.com');
    git(dir, 'config', 'core.autocrlf', 'false');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src/hello.ts'),
      "export function hello(): string {\n  return 'hello';\n}\n",
    );
    writeFileSync(join(dir, 'README.md'), '# Motion\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'Say hello');

    const repo = await openRepo(dir);
    const commits = await resolveCommits(repo, { commit: 'HEAD' });
    const environment = fakeEnvironment();
    const scene = await buildScene({
      repo,
      commits,
      environment,
      width: 320,
      height: 200,
      dpr: 1,
      platform: 'windows',
      showExplorer: true,
      showScm: true,
      maxFileLines: 500,
      maxTabs: 4,
      ignore: [],
      typing: { baseMs: 5, jitterMs: 0, speed: 1, seed: 7, noTyping: true, budget: 0 },
      introMs: 100,
      outroMs: 200,
      maxDurationMs: 4000,
    });

    const server = await startSceneServer({
      scene,
      rendererDir: findRendererDir(),
      grammars: new GrammarRegistry(undefined),
    });
    const browser = await chromium.launch({
      executablePath: browserPath.path,
      headless: true,
      args: ['--force-color-profile=srgb', '--hide-scrollbars'],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
      page.on('pageerror', (error) => console.error('[renderer]', error.message));
      await page.goto(`${server.url}?capture=1`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => (window as { __ready?: boolean }).__ready === true || (window as { __error?: string }).__error,
        { timeout: 30_000 },
      );
      const pageError = await page.evaluate(() => (window as { __error?: string }).__error ?? null);
      if (pageError) throw new Error(`Renderer failed: ${pageError}`);

      await page.evaluate(() => (window as { __seek?: (time: number) => void }).__seek?.(0));
      const first = PNG.sync.read(await page.screenshot({ type: 'png' }));
      await page.evaluate(
        (time) => (window as { __seek?: (time: number) => void }).__seek?.(time),
        scene.durationMs - 1,
      );
      const last = PNG.sync.read(await page.screenshot({ type: 'png' }));

      if (first.width !== 320 || first.height !== 200) {
        throw new Error(`Unexpected screenshot size ${first.width}x${first.height}`);
      }
      let differing = 0;
      for (let index = 0; index < first.data.length; index += 4) {
        if (
          first.data[index] !== last.data[index] ||
          first.data[index + 1] !== last.data[index + 1] ||
          first.data[index + 2] !== last.data[index + 2]
        ) {
          differing++;
        }
      }
      if (differing < 1000) {
        throw new Error(`Only ${differing} pixels changed between the first and last frame.`);
      }

      const titleTarget = hexToRgb(scene.meta.colors['titleBar.activeBackground'] ?? '#181818');
      if (titleTarget) {
        const offset = (2 * 320 + 160) * 4;
        const actual: [number, number, number] = [
          last.data[offset]!,
          last.data[offset + 1]!,
          last.data[offset + 2]!,
        ];
        const close = actual.every((channel, index) => Math.abs(channel - titleTarget[index]!) <= 8);
        if (!close) {
          throw new Error(
            `Title bar color ${actual.join(',')} does not match theme ${titleTarget.join(',')}.`,
          );
        }
      }
      console.log(
        `Motion smoke test passed: ${differing} pixels changed, ${scene.events.length} events, ${(
          scene.durationMs / 1000
        ).toFixed(1)}s.`,
      );
    } finally {
      await browser.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error('Motion smoke test failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
