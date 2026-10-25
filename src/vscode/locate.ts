import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface VSCodeInstall {
  /** Directory containing package.json, product.json and extensions/. */
  appRoot: string;
  extensionsDir: string;
  version?: string;
  quality: 'stable' | 'insiders';
  userSettingsPath: string;
  userExtensionsDir: string;
}

export interface LocateOptions {
  explicit?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readVersion(appRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version;
  } catch {
    return undefined;
  }
}

/** Find `resources/app` under an install root, including versioned resource folders. */
function appRootFrom(root: string): string | undefined {
  const candidates = [
    root,
    join(root, 'resources', 'app'),
    join(root, 'Contents', 'Resources', 'app'),
  ];
  for (const candidate of candidates) {
    if (isFile(join(candidate, 'product.json')) && existsSync(join(candidate, 'extensions'))) {
      return candidate;
    }
  }
  // Some installers nest app resources under a build id, e.g. Code/<hash>/resources/app.
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = join(root, entry.name, 'resources', 'app');
      if (isFile(join(nested, 'product.json'))) return nested;
    }
  } catch {
    // fall through
  }
  return undefined;
}

function userDataDir(
  platform: NodeJS.Platform,
  quality: 'stable' | 'insiders',
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  const folder = quality === 'insiders' ? 'Code - Insiders' : 'Code';
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), folder);
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', folder);
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), folder);
}

function initialRoots(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): Array<{ root: string; quality: 'stable' | 'insiders' }> {
  const stable: string[] = [];
  const insiders: string[] = [];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    stable.push(join(local, 'Programs', 'Microsoft VS Code'), join(env.ProgramFiles ?? '', 'Microsoft VS Code'));
    insiders.push(join(local, 'Programs', 'Microsoft VS Code Insiders'));
  } else if (platform === 'darwin') {
    stable.push(join('/Applications', 'Visual Studio Code.app'), join(home, 'Applications', 'Visual Studio Code.app'));
    insiders.push(
      join('/Applications', 'Visual Studio Code - Insiders.app'),
      join(home, 'Applications', 'Visual Studio Code - Insiders.app'),
    );
  } else {
    stable.push(
      '/usr/share/code',
      '/opt/visual-studio-code',
      '/usr/lib/code',
      '/snap/code/current/usr/share/code',
    );
    insiders.push('/usr/share/code-insiders', '/opt/visual-studio-code-insiders', '/snap/code-insiders/current/usr/share/code');
  }

  const fromPath: Array<{ root: string; quality: 'stable' | 'insiders' }> = [];
  const pathExts = platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
  for (const dir of (env.PATH ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const name of ['code', 'code-insiders']) {
      for (const ext of pathExts) {
        const shim = join(dir, name + ext);
        if (!isFile(shim)) continue;
        // <install>/bin/code.cmd, or a symlink/launcher in /usr/bin.
        const install = dirname(dirname(shim));
        fromPath.push({ root: install, quality: name === 'code-insiders' ? 'insiders' : 'stable' });
      }
    }
  }

  return [
    ...fromPath,
    ...stable.map((root) => ({ root, quality: 'stable' as const })),
    ...insiders.map((root) => ({ root, quality: 'insiders' as const })),
  ];
}

export function locateVSCode(options: LocateOptions = {}): VSCodeInstall | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();

  const candidates: Array<{ root: string; quality: 'stable' | 'insiders' }> = [];
  if (options.explicit) {
    const explicit = resolve(options.explicit);
    candidates.push({ root: explicit, quality: /insiders/i.test(explicit) ? 'insiders' : 'stable' });
  }
  if (env.VSCODE_PATH) {
    candidates.push({
      root: resolve(env.VSCODE_PATH),
      quality: /insiders/i.test(env.VSCODE_PATH) ? 'insiders' : 'stable',
    });
  }
  candidates.push(...initialRoots(platform, env, home));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.root || seen.has(candidate.root)) continue;
    seen.add(candidate.root);
    let appRoot: string | undefined;
    try {
      appRoot = appRootFrom(candidate.root);
    } catch {
      appRoot = undefined;
    }
    if (!appRoot) continue;
    return {
      appRoot,
      extensionsDir: join(appRoot, 'extensions'),
      version: readVersion(appRoot),
      quality: candidate.quality,
      userSettingsPath: join(
        userDataDir(platform, candidate.quality, env, home),
        'User',
        'settings.json',
      ),
      userExtensionsDir: join(
        home,
        candidate.quality === 'insiders' ? '.vscode-insiders' : '.vscode',
        'extensions',
      ),
    };
  }
  return undefined;
}
