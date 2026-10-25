import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface FoundBrowser {
  path: string;
  name: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function playwrightCacheDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  }
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

const SYSTEM_CANDIDATES = (platform: NodeJS.Platform): string[] => {
  if (platform === 'win32') {
    return [
      join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      join(process.env.ProgramFiles ?? 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
};

export function findBrowser(
  explicit?: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): FoundBrowser | undefined {
  if (explicit) {
    return isFile(explicit) ? { path: explicit, name: 'explicit browser' } : undefined;
  }

  // Prefer a system Chrome/Edge: it is version-independent and already installed.
  for (const candidate of SYSTEM_CANDIDATES(platform)) {
    if (candidate && isFile(candidate)) {
      return { path: candidate, name: /edge/i.test(candidate) ? 'Microsoft Edge' : 'Google Chrome' };
    }
  }

  // Fall back to whatever Playwright downloaded previously.
  const cache = playwrightCacheDir(platform, env);
  try {
    const entries = readdirSync(cache)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const entry of entries) {
      const candidates =
        platform === 'win32'
          ? [
              join(cache, entry, 'chrome-win64', 'chrome.exe'),
              join(cache, entry, 'chrome-win', 'chrome.exe'),
            ]
          : platform === 'darwin'
            ? [
                join(cache, entry, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
                join(cache, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
              ]
            : [join(cache, entry, 'chrome-linux64', 'chrome'), join(cache, entry, 'chrome-linux', 'chrome')];
      for (const candidate of candidates) {
        if (existsSync(candidate) && isFile(candidate)) {
          return { path: candidate, name: `Playwright Chromium (${entry})` };
        }
      }
    }
  } catch {
    // No Playwright cache.
  }
  return undefined;
}
