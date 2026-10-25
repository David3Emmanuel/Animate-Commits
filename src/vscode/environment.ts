import { locateVSCode, type VSCodeInstall } from './locate';
import { loadSettings, resolveSettings, type LoadedSettings, type ResolvedEditorSettings } from './settings';
import { discoverThemes, resolveTheme, type ResolvedTheme, type ThemeDefinition } from '../theme/resolve';

export interface ResolveEnvironmentOptions {
  vscodePath?: string;
  theme?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedEnvironment {
  install?: VSCodeInstall;
  themes: ThemeDefinition[];
  theme: ResolvedTheme;
  settings: LoadedSettings;
  resolvedSettings: ResolvedEditorSettings;
  platform: NodeJS.Platform;
}

export function resolveEnvironment(
  repoRoot: string,
  options: ResolveEnvironmentOptions = {},
): ResolvedEnvironment {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const install = locateVSCode({
    explicit: options.vscodePath,
    platform,
    env,
  });

  const settings = loadSettings(repoRoot, install);
  const resolvedSettings = resolveSettings(settings.merged, platform);
  const themes = install
    ? discoverThemes(install, install.userExtensionsDir)
    : [];

  const themeRequest = options.theme ?? resolvedSettings.themeLabel;
  const theme = resolveTheme({ definitions: themes, labelOrPath: themeRequest });

  return { install, themes, theme, settings, resolvedSettings, platform };
}
