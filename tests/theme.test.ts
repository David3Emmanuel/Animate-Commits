import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverThemes,
  findThemeDefinition,
  resolveTheme,
} from '../src/theme/resolve';
import { loadSettings, resolveSettings, scopedEditorSettings } from '../src/vscode/settings';
import { locateVSCode } from '../src/vscode/locate';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'animate-commits-'));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function makeExtension(
  extensionsDir: string,
  name: string,
  manifest: unknown,
  files: Record<string, unknown>,
): string {
  const root = join(extensionsDir, name);
  writeJson(join(root, 'package.json'), manifest);
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    if (typeof contents === 'string') {
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, contents);
    } else {
      writeJson(target, contents);
    }
  }
  return root;
}

describe('theme discovery and resolution', () => {
  it('resolves localized labels and merges included themes', () => {
    const root = tempDir();
    const extensionsDir = join(root, 'extensions');
    makeExtension(
      extensionsDir,
      'theme-pack',
      {
        contributes: {
          themes: [{ label: '%myThemeLabel%', uiTheme: 'vs-dark', path: './themes/main.json' }],
        },
      },
      {
        'package.nls.json': JSON.stringify({ myThemeLabel: 'My Theme' }),
        'themes/base.json': {
          name: 'Base',
          colors: { 'editor.background': '#111111', 'editor.foreground': '#EEEEEE' },
          tokenColors: [{ scope: 'comment', settings: { foreground: '#666666' } }],
        },
        'themes/main.json': {
          name: 'My Theme',
          include: './base.json',
          colors: { 'editor.background': '#222222' },
          tokenColors: [{ scope: 'keyword', settings: { foreground: '#C586C0' } }],
        },
      },
    );

    const definitions = discoverThemes({ extensionsDir });
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.label).toBe('My Theme');

    const theme = resolveTheme({ definitions, labelOrPath: 'my theme' });
    expect(theme.label).toBe('My Theme');
    expect(theme.kind).toBe('dark');
    expect(theme.colors['editor.background']).toBe('#222222');
    expect(theme.colors['editor.foreground']).toBe('#EEEEEE');
    // Included rules come first, then the theme's own rules.
    expect(theme.tokenColors.map((rule) => rule.scope)).toEqual(['comment', 'keyword']);
    // Missing workbench keys fall back to the built-in palette.
    expect(theme.colors['statusBar.background']).toBeDefined();
  });

  it('loads tokenColors from a referenced file', () => {
    const root = tempDir();
    const extensionsDir = join(root, 'extensions');
    makeExtension(
      extensionsDir,
      'theme-pack',
      { contributes: { themes: [{ label: 'File Rules', uiTheme: 'vs', path: './theme.json' }] } },
      {
        'theme.json': {
          name: 'File Rules',
          colors: { 'editor.background': '#FFFFFF' },
          tokenColors: './rules.json',
        },
        'rules.json': [{ scope: 'string', settings: { foreground: '#A31515' } }],
      },
    );
    const definitions = discoverThemes({ extensionsDir });
    const theme = resolveTheme({ definitions, labelOrPath: 'File Rules' });
    expect(theme.kind).toBe('light');
    expect(theme.tokenColors[0]?.scope).toBe('string');
  });

  it('fails clearly for unknown themes and include cycles', () => {
    const root = tempDir();
    const extensionsDir = join(root, 'extensions');
    makeExtension(
      extensionsDir,
      'broken',
      { contributes: { themes: [{ label: 'Broken', uiTheme: 'vs-dark', path: './broken.json' }] } },
      { 'broken.json': { name: 'Broken', include: './broken.json' } },
    );
    const definitions = discoverThemes({ extensionsDir });
    expect(() => resolveTheme({ definitions, labelOrPath: 'Broken' })).toThrow(/cycle/i);
    expect(() => resolveTheme({ definitions, labelOrPath: 'Nope' })).toThrow(/No installed VS Code theme/i);
  });

  it('matches themes by their JSON name when labels differ', () => {
    const root = tempDir();
    const extensionsDir = join(root, 'extensions');
    makeExtension(
      extensionsDir,
      'named',
      { contributes: { themes: [{ label: 'Fancy Label', uiTheme: 'vs-dark', path: './t.json' }] } },
      { 't.json': { name: 'Actual Name', colors: { 'editor.background': '#101010' } } },
    );
    const definitions = discoverThemes({ extensionsDir });
    expect(findThemeDefinition(definitions, 'Actual Name')?.label).toBe('Fancy Label');
  });
});

describe('settings resolution', () => {
  it('merges user and workspace JSONC settings and scopes language keys', () => {
    const root = tempDir();
    const userPath = join(root, 'User', 'settings.json');
    mkdirSync(join(root, 'User'), { recursive: true });
    writeFileSync(
      userPath,
      `{
        // comment
        "workbench.colorTheme": "Dark Modern",
        "editor.fontSize": 14,
        "editor.fontFamily": "Consolas, monospace",
        "[typescript]": { "editor.tabSize": 2, "editor.fontSize": 13, },
        "[typescript][javascript]": { "editor.tabSize": 3 },
      }`,
    );
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.vscode'), { recursive: true });
    writeFileSync(
      join(repo, '.vscode', 'settings.json'),
      `{ "editor.minimap.enabled": false, "window.titleBarStyle": "native", }`,
    );

    const loaded = loadSettings(repo, { userSettingsPath: userPath });
    const resolved = resolveSettings(loaded.merged, 'win32');
    expect(resolved.themeLabel).toBe('Dark Modern');
    expect(resolved.fontSize).toBe(14);
    expect(resolved.minimap).toBe(false);
    expect(resolved.titleBarStyle).toBe('native');
    expect(resolved.lineHeight).toBe(19);

    const scoped = scopedEditorSettings(loaded.merged, resolved, ['typescript']);
    expect(scoped.tabSize).toBe(3);
    expect(scoped.fontSize).toBe(13);
  });

  it('uses platform font defaults', () => {
    const resolved = resolveSettings({}, 'darwin');
    expect(resolved.fontFamily).toContain('Menlo');
    expect(resolved.uiFontFamily).toContain('-apple-system');
    expect(resolved.minimap).toBe(true);
  });
});

describe.runIf(locateVSCode() !== undefined)('the installed VS Code', () => {
  it('resolves the active built-in theme', () => {
    const install = locateVSCode()!;
    const definitions = discoverThemes(install, install.userExtensionsDir);
    expect(definitions.length).toBeGreaterThan(0);
    const theme = resolveTheme({ definitions, labelOrPath: 'Dark Modern' });
    expect(theme.kind).toBe('dark');
    expect(theme.colors['editor.background']).toMatch(/^#/);
    expect(theme.tokenColors.length).toBeGreaterThan(10);
  });
});
