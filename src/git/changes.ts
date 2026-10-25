import { git, type Repo } from './repo';

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged';

export interface ChangedFile {
  /** Path after the commit. */
  path: string;
  /** Previous path for renames/copies. */
  oldPath?: string;
  status: FileStatus;
  score?: number;
}

const STATUS_MAP: Record<string, FileStatus | undefined> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged',
};

export function parseNameStatusNul(output: string): ChangedFile[] {
  const parts = output.split('\0');
  const files: ChangedFile[] = [];
  let index = 0;
  while (index < parts.length) {
    const token = parts[index++];
    if (!token) continue;
    const letter = token[0] ?? '';
    const status = STATUS_MAP[letter];
    if (!status) continue;
    const score = token.length > 1 ? Number.parseInt(token.slice(1), 10) : undefined;

    if (status === 'renamed' || status === 'copied') {
      const oldPath = parts[index++];
      const path = parts[index++];
      if (!oldPath || path === undefined) break;
      files.push({
        path,
        oldPath,
        status,
        ...(Number.isFinite(score) ? { score } : {}),
      });
    } else {
      const path = parts[index++];
      if (path === undefined) break;
      files.push({ path, status });
    }
  }
  return files;
}

export async function changedFiles(repo: Repo, sha: string, parents: string[]): Promise<ChangedFile[]> {
  const parent = parents[0];
  const args = parent
    ? ['diff', '--name-status', '-z', '-M', '--no-color', parent, sha]
    : ['diff-tree', '--root', '-r', '-M', '--no-commit-id', '--name-status', '-z', sha];
  const output = await git(repo, args);
  return parseNameStatusNul(output);
}

export function statusLetter(status: FileStatus): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'unmerged':
      return 'U';
    case 'type-changed':
      return 'T';
    default:
      return 'M';
  }
}
