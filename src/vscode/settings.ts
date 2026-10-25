import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VSCodeInstall } from './locate';
import { parseJsonc } from '../theme/jsonc';
import { defaultEditorFont, defaultUiFont } from '../theme/defaults';

export type SettingsObject = Record<string, unknown>;

export interface LoadedSettings {
  userPath: string;
  workspacePath: string;
  user: SettingsObject;
  workspace: SettingsObject;
  merged: SettingsObject;
  hasUserFile: boolean;
  hasWorkspaceFile: boolean;
}

export interface ResolvedEditorSettings {
  themeLabel: string;
  titleBarStyle: string;
  zoomLevel: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontLigatures: boolean;
  minimap: boolean;
  cursorBlinking: string;
  cursorStyle: string;
  wordWrap: boolean;
  tabSize: number;
  treeIndent: number;
  sortOrder: string;
  activityBarLocation: string;
  uiFontFamily: string;
}

function readSettingsFile(path: string): SettingsObject {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return {};
  const parsed = parseJsonc<SettingsObject>(raw, path);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed;
}

function isPlainObject(value: unknown): value is SettingsObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge(base: SettingsObject, override: SettingsObject): SettingsObject {
  const out: SettingsObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

export function loadSettings(repoRoot: string, install?: Pick<VSCodeInstall, 'userSettingsPath'>): LoadedSettings {
  const userPath = install?.userSettingsPath ?? '';
  const workspacePath = join(repoRoot, '.vscode', 'settings.json');
  const hasUserFile = Boolean(userPath) && existsSync(userPath);
  const hasWorkspaceFile = existsSync(workspacePath);
  const user = hasUserFile ? readSettingsFile(userPath) : {};
  const workspace = hasWorkspaceFile ? readSettingsFile(workspacePath) : {};
  return {
    userPath,
    workspacePath,
    user,
    workspace,
    merged: deepMerge(user, workspace),
    hasUserFile,
    hasWorkspaceFile,
  };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/** Keys that can be scoped per language with `"[typescript]": { ... }` blocks. */
export function languageScopedSettings(
  settings: SettingsObject,
  languageIds: string[],
): SettingsObject {
  let scoped: SettingsObject = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith('[') || !isPlainObject(value)) continue;
    const scopes = [...key.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]!.toLowerCase());
    if (scopes.length === 0) continue;
    if (scopes.some((scope) => languageIds.includes(scope))) {
      scoped = deepMerge(scoped, value);
    }
  }
  return scoped;
}

export function resolveSettings(
  settings: SettingsObject,
  platform: NodeJS.Platform = process.platform,
): ResolvedEditorSettings {
  const fontSize = asNumber(settings['editor.fontSize'], 14);
  const rawLineHeight = asNumber(settings['editor.lineHeight'], 0);
  const fontLigaturesValue = settings['editor.fontLigatures'];
  const fontLigatures =
    fontLigaturesValue === true ||
    (typeof fontLigaturesValue === 'string' && fontLigaturesValue.trim().length > 0);
  const minimapSetting = settings['editor.minimap.enabled'];
  const wordWrapValue = asString(settings['editor.wordWrap'], 'off');

  return {
    themeLabel: asString(settings['workbench.colorTheme'], 'Dark Modern'),
    titleBarStyle: asString(settings['window.titleBarStyle'], platform === 'darwin' ? 'native' : 'custom'),
    zoomLevel: asNumber(settings['window.zoomLevel'], 0),
    fontFamily: asString(settings['editor.fontFamily'], defaultEditorFont(platform)),
    fontSize,
    lineHeight: rawLineHeight > 0 ? rawLineHeight : Math.round(fontSize * 1.35),
    fontLigatures,
    minimap: asBoolean(minimapSetting, true),
    cursorBlinking: asString(settings['editor.cursorBlinking'], 'blink'),
    cursorStyle: asString(settings['editor.cursorStyle'], 'line'),
    wordWrap: wordWrapValue !== 'off',
    tabSize: asNumber(settings['editor.tabSize'], 4),
    treeIndent: asNumber(settings['workbench.tree.indent'], 8),
    sortOrder: asString(settings['explorer.sortOrder'], 'default'),
    activityBarLocation: asString(settings['workbench.activityBar.location'], 'default'),
    uiFontFamily: defaultUiFont(platform),
  };
}

export function scopedEditorSettings(
  merged: SettingsObject,
  resolved: ResolvedEditorSettings,
  languageIds: string[],
): ResolvedEditorSettings {
  if (languageIds.length === 0) return resolved;
  const scoped = languageScopedSettings(merged, languageIds);
  if (Object.keys(scoped).length === 0) return resolved;
  const fontSize = asNumber(scoped['editor.fontSize'], resolved.fontSize);
  const rawLineHeight = asNumber(scoped['editor.lineHeight'], 0);
  return {
    ...resolved,
    fontFamily: asString(scoped['editor.fontFamily'], resolved.fontFamily),
    fontSize,
    lineHeight: rawLineHeight > 0 ? rawLineHeight : Math.round(fontSize * 1.35),
    tabSize: asNumber(scoped['editor.tabSize'], resolved.tabSize),
    wordWrap:
      scoped['editor.wordWrap'] !== undefined
        ? asString(scoped['editor.wordWrap'], 'off') !== 'off'
        : resolved.wordWrap,
  };
}
