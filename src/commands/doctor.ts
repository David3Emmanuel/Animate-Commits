import { exec } from '../util/exec';
import { findFfmpeg } from '../util/paths';
import { findBrowser } from '../export/browser';
import { locateVSCode } from '../vscode/locate';
import { existsSync } from 'node:fs';

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
  required: boolean;
}

async function versionOf(file: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await exec(file, args);
    return (stdout || stderr).split(/\r?\n/)[0]?.trim();
  } catch {
    return undefined;
  }
}

export async function runDoctor(): Promise<boolean> {
  const checks: Check[] = [];

  checks.push({
    label: 'Node.js',
    ok: Number(process.versions.node.split('.')[0]) >= 20,
    detail: process.versions.node,
    required: true,
  });

  const git = await versionOf('git', ['--version']);
  checks.push({
    label: 'git',
    ok: Boolean(git),
    detail: git ?? 'not found on PATH',
    required: true,
  });

  const ffmpegPath = findFfmpeg();
  const ffmpeg = ffmpegPath
    ? await versionOf(ffmpegPath, ['-version']).then((v) => v?.split(' Copyright')[0])
    : undefined;
  checks.push({
    label: 'ffmpeg',
    ok: Boolean(ffmpeg),
    detail: ffmpeg ?? 'not found; pass --ffmpeg or use --frames',
    required: false,
  });

  const browser = findBrowser();
  checks.push({
    label: 'browser',
    ok: Boolean(browser),
    detail: browser ? `${browser.name} — ${browser.path}` : 'no Chrome/Edge/Chromium found; pass --browser-exe',
    required: false,
  });

  const vscode = locateVSCode();
  checks.push({
    label: 'VS Code',
    ok: Boolean(vscode),
    detail: vscode
      ? `${vscode.version ?? 'unknown version'} — ${vscode.appRoot}`
      : 'not found; pass --vscode <install path> or --theme <path>',
    required: true,
  });

  if (vscode) {
    checks.push({
      label: 'VS Code settings',
      ok: existsSync(vscode.userSettingsPath),
      detail: existsSync(vscode.userSettingsPath)
        ? vscode.userSettingsPath
        : `${vscode.userSettingsPath} (using defaults)`,
      required: false,
    });
    checks.push({
      label: 'VS Code extensions',
      ok: existsSync(vscode.userExtensionsDir),
      detail: `${vscode.extensionsDir} + ${vscode.userExtensionsDir}`,
      required: false,
    });
  }

  const width = Math.max(...checks.map((check) => check.label.length));
  for (const check of checks) {
    const mark = check.ok ? 'ok' : check.required ? 'missing' : 'warn';
    console.log(`${check.label.padEnd(width)}  ${mark.padEnd(8)}  ${check.detail ?? ''}`);
  }

  const failed = checks.filter((check) => check.required && !check.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} required check(s) failed.`);
    return false;
  }
  console.log('\nReady to animate commits.');
  return true;
}
