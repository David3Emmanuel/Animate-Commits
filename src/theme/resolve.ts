import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { VSCodeInstall } from '../vscode/locate';
import { parseJsonc } from './jsonc';
import { resolveThemeLabel } from './label';
import { fallbackColors } from './defaults';

export type ThemeKind = 'dark' | 'light' | 'hc-black' | 'hc-light';

export interface TokenColorRule {
  name?: string;
  scope?: string | string[];
  settings?: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

export interface ThemeDefinition {
  label: string;
  rawLabel: string;
  uiTheme: string;
  themePath: string;
  extensionRoot: string;
}

export interface ResolvedTheme {
  label: string;
  kind: ThemeKind;
  uiTheme: string;
  themePath: string;
  colors: Record<string, string>;
  tokenColors: TokenColorRule[];
}

interface RawTheme {
  name?: string;
  include?: string;
  type?: string;
  uiTheme?: string;
  colors?: Record<string, string>;
  tokenColors?: Array<TokenColorRule | string> | string;
  semanticHighlighting?: boolean;
}

interface LoadedTheme {
  name?: string;
  colors: Record<string, string>;
  tokenColors: TokenColorRule[];
  semanticHighlighting?: boolean;
}

function parseThemeFile(path: string): RawTheme {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read theme file: ${path}`);
  }
  const parsed = parseJsonc<RawTheme>(text, path);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Theme file is not a JSON object: ${path}`);
  }
  return parsed;
}

function normalizeRules(
  raw: Array<TokenColorRule | string> | string | undefined,
  themeFilePath: string,
): TokenColorRule[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    const path = resolve(dirname(themeFilePath), raw);
    const parsed = parseJsonc<RawTheme | TokenColorRule[]>(readFileSync(path, 'utf8'), path);
    if (Array.isArray(parsed)) return parsed;
    return normalizeRules(parsed.tokenColors, path);
  }
  const out: TokenColorRule[] = [];
  for (const rule of raw) {
    if (typeof rule === 'string') {
      const path = resolve(dirname(themeFilePath), rule);
      const parsed = parseJsonc<RawTheme | TokenColorRule[]>(readFileSync(path, 'utf8'), path);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(...normalizeRules(parsed.tokenColors, path));
      continue;
    }
    if (!rule || typeof rule !== 'object') continue;
    const ruleSettings =
      rule.settings && typeof rule.settings === 'object' ? rule.settings : undefined;
    out.push({
      ...(rule.name ? { name: rule.name } : {}),
      ...(rule.scope !== undefined ? { scope: rule.scope } : {}),
      ...(ruleSettings
        ? {
            settings: {
              ...(ruleSettings.foreground ? { foreground: ruleSettings.foreground } : {}),
              ...(ruleSettings.background ? { background: ruleSettings.background } : {}),
              ...(ruleSettings.fontStyle ? { fontStyle: ruleSettings.fontStyle } : {}),
            },
          }
        : {}),
    });
  }
  return out;
}

function loadThemeFile(path: string, chain: Set<string>): LoadedTheme {
  const absolute = resolve(path);
  if (chain.has(absolute)) {
    throw new Error(`Theme include cycle: ${[...chain, absolute].join(' -> ')}`);
  }
  const raw = parseThemeFile(absolute);
  const nextChain = new Set(chain).add(absolute);

  let base: LoadedTheme = { colors: {}, tokenColors: [] };
  if (raw.include) {
    let includePath = resolve(dirname(absolute), raw.include);
    if (!existsSync(includePath)) {
      // Some themes omit the leading `./`; retry against the extension root one
      // level up before failing.
      includePath = resolve(dirname(absolute), '..', raw.include);
      if (!existsSync(includePath)) {
        throw new Error(`Theme include not found: ${raw.include} (from ${absolute})`);
      }
    }
    base = loadThemeFile(includePath, nextChain);
  }

  const ownColors: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.colors ?? {})) {
    if (typeof value === 'string') ownColors[key] = value;
  }

  return {
    name: raw.name ?? base.name,
    colors: { ...base.colors, ...ownColors },
    tokenColors: [
      ...base.tokenColors,
      ...normalizeRules(raw.tokenColors, absolute),
    ],
    semanticHighlighting: raw.semanticHighlighting ?? base.semanticHighlighting,
  };
}

function kindFromUiTheme(uiTheme: string | undefined): ThemeKind | undefined {
  switch (uiTheme) {
    case 'vs-dark':
      return 'dark';
    case 'vs':
      return 'light';
    case 'hc-black':
      return 'hc-black';
    case 'hc-light':
      return 'hc-light';
    default:
      return undefined;
  }
}

function luminance(hex: string | undefined): number | undefined {
  if (!hex) return undefined;
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = parseInt(match[1]!, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function inferKind(raw: RawTheme, colors: Record<string, string>): ThemeKind {
  const fromType = kindFromUiTheme(raw.type ?? raw.uiTheme);
  if (fromType) return fromType;
  if (raw.type === 'dark') return 'dark';
  if (raw.type === 'light') return 'light';
  const lum = luminance(colors['editor.background']);
  return lum !== undefined && lum > 0.5 ? 'light' : 'dark';
}

export function discoverThemes(
  install: Pick<VSCodeInstall, 'extensionsDir'> | undefined,
  userExtensionsDir?: string,
): ThemeDefinition[] {
  const definitions: ThemeDefinition[] = [];
  const seenPaths = new Set<string>();
  const roots = new Set<string>();
  if (install) roots.add(install.extensionsDir);
  if (userExtensionsDir) roots.add(userExtensionsDir);

  const scanExtension = (extensionRoot: string): void => {
    const manifestPath = join(extensionRoot, 'package.json');
    if (!existsSync(manifestPath)) return;
    let manifest: {
      contributes?: { themes?: Array<{ label?: string; uiTheme?: string; path?: string }> | { label?: string; uiTheme?: string; path?: string } };
    };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      return;
    }
    const contributed = manifest.contributes?.themes;
    if (!contributed) return;
    const entries = Array.isArray(contributed) ? contributed : [contributed];
    for (const entry of entries) {
      if (!entry?.label || !entry.path) continue;
      const themePath = resolve(extensionRoot, entry.path);
      if (seenPaths.has(themePath)) continue;
      seenPaths.add(themePath);
      definitions.push({
        label: resolveThemeLabel(entry.label, extensionRoot),
        rawLabel: entry.label,
        uiTheme: entry.uiTheme ?? 'vs-dark',
        themePath,
        extensionRoot,
      });
    }
  };

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith('.json') || entry.startsWith('.')) continue;
      const extensionRoot = join(root, entry);
      try {
        if (!existsSync(join(extensionRoot, 'package.json'))) continue;
      } catch {
        continue;
      }
      scanExtension(extensionRoot);
    }
  }
  definitions.sort((a, b) => a.label.localeCompare(b.label));
  return definitions;
}

function themeNameOf(themePath: string): string | undefined {
  try {
    return parseThemeFile(themePath).name;
  } catch {
    return undefined;
  }
}

export function findThemeDefinition(
  definitions: ThemeDefinition[],
  label: string,
): ThemeDefinition | undefined {
  const wanted = label.trim();
  const lower = wanted.toLowerCase();
  const direct =
    definitions.find((definition) => definition.label === wanted) ??
    definitions.find((definition) => definition.rawLabel === wanted) ??
    definitions.find((definition) => definition.label.toLowerCase() === lower) ??
    definitions.find((definition) => {
      const file = basename(definition.themePath, extname(definition.themePath)).toLowerCase();
      return file === lower || file === lower.replace(/\.json$/i, '');
    });
  if (direct) return direct;

  return definitions.find((definition) => {
    const name = themeNameOf(definition.themePath);
    return name !== undefined && name.toLowerCase() === lower;
  });
}

export interface ResolveThemeOptions {
  definitions?: ThemeDefinition[];
  labelOrPath?: string;
  /** When no label is supplied, fall back to this VS Code default. */
  fallbackLabel?: string;
}

export function resolveTheme(options: ResolveThemeOptions = {}): ResolvedTheme {
  const definitions = options.definitions ?? [];
  const requested = options.labelOrPath?.trim();
  const fallbackLabel = options.fallbackLabel ?? 'Dark Modern';

  let definition: ThemeDefinition | undefined;
  let themePath: string | undefined;
  let label = requested || fallbackLabel;
  let uiTheme: string | undefined;

  if (requested && existsSync(requested) && !requested.endsWith('/')) {
    themePath = resolve(requested);
    label = basename(themePath, extname(themePath));
  } else {
    definition = findThemeDefinition(definitions, requested || fallbackLabel);
    if (!definition && requested) {
      const choices = definitions
        .slice(0, 12)
        .map((candidate) => candidate.label)
        .join(', ');
      throw new Error(
        `No installed VS Code theme matches "${requested}".` +
          (choices ? ` Try one of: ${choices}.` : ' Is VS Code installed?') +
          ' You can also pass --theme <path-to-theme.json>.',
      );
    }
    if (!definition && !requested) {
      // Try the VS Code default by name, then fall back to the first dark theme.
      definition =
        findThemeDefinition(definitions, fallbackLabel) ??
        definitions.find((candidate) => candidate.uiTheme === 'vs-dark');
      if (!definition) {
        throw new Error(
          'No VS Code themes found. Pass --theme <path-to-theme.json> or --vscode <install path>.',
        );
      }
    }
    if (definition) {
      themePath = definition.themePath;
      label = definition.label;
      uiTheme = definition.uiTheme;
    }
  }

  if (!themePath) {
    throw new Error('Could not determine a theme file to load.');
  }
  if (!isAbsolute(themePath)) themePath = resolve(themePath);

  const raw = parseThemeFile(themePath);
  const loaded = loadThemeFile(themePath, new Set());
  const kind = kindFromUiTheme(uiTheme) ?? inferKind(raw, loaded.colors);
  const colors = { ...fallbackColors(kind), ...loaded.colors };

  return {
    label: loaded.name ?? label,
    kind,
    uiTheme: uiTheme ?? (kind === 'light' ? 'vs' : kind === 'hc-black' ? 'hc-black' : kind === 'hc-light' ? 'hc-light' : 'vs-dark'),
    themePath,
    colors,
    tokenColors: loaded.tokenColors,
  };
}
