import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Command } from 'commander';
import { buildScene } from '../scene/build';
import type { Platform } from '../scene/types';
import type { Scene } from '../scene/types';
import { openRepo } from '../git/repo';
import { resolveCommits } from '../git/commits';
import { resolveEnvironment, type ResolvedEnvironment } from '../vscode/environment';
import { GrammarRegistry } from '../grammar/resolve';

export interface SceneCliOptions {
  commit?: string;
  range?: string;
  vscode?: string;
  theme?: string;
  editorFont?: string;
  uiFont?: string;
  titlebar?: string;
  title?: string;
  explorer?: boolean;
  scm?: boolean;
  maxFileLines?: string;
  maxTabs?: string;
  ignore?: string[];
  speed?: string;
  typing?: string;
  seed?: string;
  instant?: boolean;
  intro?: string;
  hold?: string;
  maxDuration?: string;
  maxTyped?: string;
}

export function addSceneOptions(command: Command): Command {
  return command
    .option('--commit <rev>', 'animate a single commit')
    .option('--range <range>', 'animate a git range, oldest first (e.g. A..B)')
    .option('--vscode <path>', 'path to the VS Code installation')
    .option('--theme <labelOrPath>', 'theme label or path to a theme JSON file')
    .option('--editor-font <family>', 'override the editor font family')
    .option('--ui-font <family>', 'override the window/UI font family')
    .option('--titlebar <platform>', 'windows, macos, or linux')
    .option('--title <text>', 'explicit window title')
    .option('--no-explorer', 'hide the Explorer sidebar')
    .option('--scm', 'show the Source Control commit flow')
    .option('--max-file-lines <n>', 'do not animate files longer than this', '4000')
    .option('--max-tabs <n>', 'maximum open editor tabs', '8')
    .option('--ignore <glob>', 'exclude paths from the animation (repeatable)', collect, [])
    .option('--speed <x>', 'timing multiplier (2 = twice as fast)', '1')
    .option('--typing <ms>', 'base milliseconds per typed character', '42')
    .option('--seed <n>', 'seed for deterministic typing jitter')
    .option('--instant', 'insert changes without per-character typing')
    .option('--intro <ms>', 'pause before the first action', '700')
    .option('--hold <ms>', 'pause on the final frame', '1400')
    .option('--max-duration <seconds>', 'compress the timeline if it runs longer than this', '180')
    .option('--max-typed <chars>', 'characters typed per commit before switching to bulk insert', '1200');
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function resolvePlatform(value: string | undefined): Platform {
  const requested = (value ?? process.platform).toLowerCase();
  if (requested === 'windows' || requested === 'win32') return 'windows';
  if (requested === 'macos' || requested === 'mac' || requested === 'darwin') return 'macos';
  if (requested === 'linux') return 'linux';
  throw new Error(`Unknown title bar platform "${value}". Use windows, macos, or linux.`);
}

export function parseSize(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid --size "${value}". Use WIDTHxHEIGHT, e.g. 1280x800.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 320 || height < 200 || width > 3840 || height > 2400) {
    throw new Error('--size must be between 320x200 and 3840x2400.');
  }
  return { width, height };
}

function positiveNumber(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number.`);
  return parsed;
}

export interface PreparedScene {
  scene: Scene;
  environment: ResolvedEnvironment;
  repoRoot: string;
  grammars: GrammarRegistry;
}

export interface DisplayOptions {
  width: number;
  height: number;
  dpr: number;
}

export async function prepareScene(
  repoArgument: string,
  options: SceneCliOptions,
  display: DisplayOptions = { width: 1280, height: 800, dpr: 1 },
): Promise<PreparedScene> {
  const repo = await openRepo(repoArgument);
  const commits = await resolveCommits(repo, {
    ...(options.commit ? { commit: options.commit } : {}),
    ...(options.range ? { range: options.range } : {}),
  });
  const environment = resolveEnvironment(repo.root, {
    ...(options.vscode ? { vscodePath: options.vscode } : {}),
    ...(options.theme ? { theme: options.theme } : {}),
  });

  if (options.editorFont) environment.resolvedSettings.fontFamily = options.editorFont;
  if (options.uiFont) environment.resolvedSettings.uiFontFamily = options.uiFont;

  const platform = resolvePlatform(options.titlebar);
  const baseMs = positiveNumber(options.typing, 42, '--typing');
  const speed = positiveNumber(options.speed, 1, '--speed');
  const introMs = positiveNumber(options.intro, 700, '--intro');
  const outroMs = positiveNumber(options.hold, 1400, '--hold');
  const maxFileLines = positiveNumber(options.maxFileLines, 4000, '--max-file-lines');
  const maxTabs = positiveNumber(options.maxTabs, 8, '--max-tabs');
  const maxDuration = positiveNumber(options.maxDuration, 180, '--max-duration');
  const maxTyped = positiveNumber(options.maxTyped, 1200, '--max-typed');

  const scene = await buildScene({
    repo,
    commits,
    environment,
    width: display.width,
    height: display.height,
    dpr: display.dpr,
    platform,
    showExplorer: options.explorer !== false,
    showScm: Boolean(options.scm),
    ...(options.title ? { title: options.title } : {}),
    maxFileLines,
    maxTabs,
    ignore: options.ignore ?? [],
    typing: {
      baseMs,
      jitterMs: Math.round(baseMs * 0.5),
      speed,
      ...(options.seed ? { seed: Number(options.seed) } : {}),
      noTyping: Boolean(options.instant),
      budget: maxTyped,
    },
    introMs,
    outroMs,
    maxDurationMs: maxDuration * 1000,
  });

  console.error(
    `[scene] ${commits.length} commit${commits.length === 1 ? '' : 's'}, ${(
      scene.durationMs / 1000
    ).toFixed(1)}s, ${scene.events.length} events${options.instant ? ' (instant mode)' : ''}`,
  );
  for (const warning of scene.meta.warnings) console.error(`[skip] ${warning}`);

  const grammars = new GrammarRegistry(
    environment.install,
    environment.install?.userExtensionsDir,
  );

  return { scene, environment, repoRoot: repo.root, grammars };
}

export function writeSceneDump(scene: Scene, path: string): void {
  writeFileSync(path, JSON.stringify(scene, null, 2), 'utf8');
}

export function defaultOutputPath(
  prepared: PreparedScene,
  extension = 'mp4',
): string {
  const repoName = basename(prepared.repoRoot.replace(/\\/g, '/'));
  const commits = prepared.scene.commits;
  const label =
    commits.length === 1
      ? commits[0]!.shortSha
      : `${commits[0]!.shortSha}-${commits[commits.length - 1]!.shortSha}`;
  return `out/${repoName}-${label}.${extension}`;
}
