import { git, gitBuffer, type Repo } from './repo';

export interface FileText {
  /** Normalized to LF. */
  text: string;
  eol: 'lf' | 'crlf';
  binary: boolean;
  tooLarge: boolean;
  size: number;
  mode?: string;
}

export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function decodeText(buffer: Buffer): { text: string; binary: boolean; eol: 'lf' | 'crlf' } {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  const binary = sample.includes(0);
  if (binary) return { text: '', binary: true, eol: 'lf' };
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = decoder.decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const eol: 'lf' | 'crlf' = text.includes('\r\n') ? 'crlf' : 'lf';
  return { text: text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), binary: false, eol };
}

export async function fileMode(repo: Repo, rev: string, path: string): Promise<string | undefined> {
  try {
    const output = await git(repo, ['ls-tree', '-z', rev, '--', path]);
    const entry = output.split('\0').find(Boolean);
    if (!entry) return undefined;
    return entry.split(/\s+/)[0];
  } catch {
    return undefined;
  }
}

export async function readFileAt(
  repo: Repo,
  rev: string,
  path: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<FileText | undefined> {
  let size: number;
  try {
    size = Number.parseInt((await git(repo, ['cat-file', '-s', `${rev}:${path}`])).trim(), 10);
  } catch {
    return undefined;
  }
  if (!Number.isFinite(size)) return undefined;
  if (size > maxBytes) {
    return { text: '', eol: 'lf', binary: false, tooLarge: true, size };
  }
  let buffer: Buffer;
  try {
    buffer = await gitBuffer(repo, ['cat-file', '-p', `${rev}:${path}`]);
  } catch {
    return undefined;
  }
  const decoded = decodeText(buffer);
  return {
    ...decoded,
    tooLarge: false,
    size: buffer.length,
    mode: await fileMode(repo, rev, path),
  };
}

export async function listFiles(repo: Repo, rev: string): Promise<string[]> {
  const output = await git(repo, ['ls-tree', '-r', '-z', '--name-only', rev]);
  return output
    .split('\0')
    .filter(Boolean)
    .filter((path) => !path.endsWith('/'));
}

export function isSubmodule(mode: string | undefined): boolean {
  return mode === '160000';
}

export function isSymlink(mode: string | undefined): boolean {
  return mode === '120000';
}
