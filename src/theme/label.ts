import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const nlsCache = new Map<string, Record<string, string>>();

function loadNlsFiles(extensionRoot: string): Record<string, string> {
  const cached = nlsCache.get(extensionRoot);
  if (cached) return cached;

  const merged: Record<string, string> = {};
  const base = join(extensionRoot, 'package.nls.json');
  try {
    Object.assign(merged, JSON.parse(readFileSync(base, 'utf8')) as Record<string, string>);
  } catch {
    // no English nls bundle
  }

  // Locale bundles are not selected here — English is the reliable fallback, and
  // the theme file's own `name` field covers localized installs.
  nlsCache.set(extensionRoot, merged);
  return merged;
}

/**
 * VS Code built-in themes use localized label keys (`%darkModernThemeLabel%`).
 * Resolve them when possible; otherwise the raw label is kept and the theme
 * JSON's `name` field is used as a second chance during lookup.
 */
export function resolveThemeLabel(rawLabel: string, extensionRoot: string): string {
  const match = /^%(.*)%$/.exec(rawLabel);
  if (!match) return rawLabel;
  const key = match[1]!;
  const nls = loadNlsFiles(extensionRoot);
  return nls[key] ?? rawLabel;
}
