import { Command } from 'commander';
import { resolveEnvironment } from '../vscode/environment';
import { locateVSCode } from '../vscode/locate';

export interface ThemesOptions {
  vscode?: string;
  json?: boolean;
}

export function registerThemesCommand(program: Command): void {
  program
    .command('themes')
    .description('List installed VS Code color themes and show the active one.')
    .option('--vscode <path>', 'path to the VS Code installation')
    .option('--json', 'output JSON')
    .action((options: ThemesOptions) => {
      runThemes(options);
    });
}

export function runThemes(options: ThemesOptions = {}): void {
  const cwd = process.cwd();
  const install = locateVSCode({ explicit: options.vscode });
  const environment = resolveEnvironment(cwd, { vscodePath: options.vscode });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          install: install
            ? { appRoot: install.appRoot, version: install.version, quality: install.quality }
            : null,
          active: {
            label: environment.theme.label,
            kind: environment.theme.kind,
            path: environment.theme.themePath,
            colors: Object.keys(environment.theme.colors).length,
            tokenRules: environment.theme.tokenColors.length,
          },
          themes: environment.themes.map((theme) => ({
            label: theme.label,
            uiTheme: theme.uiTheme,
            path: theme.themePath,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!install) {
    console.log('No VS Code installation found. Pass --vscode <path> or use --theme <path>.');
  } else {
    console.log(`VS Code ${install.version ?? ''} at ${install.appRoot}`);
  }
  console.log(
    `Active theme: ${environment.theme.label} (${environment.theme.kind}) — ${environment.theme.themePath}`,
  );
  console.log('');
  for (const theme of environment.themes) {
    const active = theme.themePath === environment.theme.themePath ? '*' : ' ';
    console.log(`${active} ${theme.label}  [${theme.uiTheme}]  ${theme.themePath}`);
  }
}
