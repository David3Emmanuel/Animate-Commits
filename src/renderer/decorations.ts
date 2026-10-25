import type { FileStatus } from '../git/changes';

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
      return '!';
    default:
      return 'M';
  }
}

export function statusColor(status: FileStatus): string {
  switch (status) {
    case 'added':
      return 'var(--vscode-gitDecoration-addedResourceForeground, #81b88b)';
    case 'deleted':
      return 'var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)';
    case 'renamed':
      return 'var(--vscode-gitDecoration-renamedResourceForeground, #73c991)';
    case 'unmerged':
      return 'var(--vscode-gitDecoration-conflictingResourceForeground, #e4676b)';
    default:
      return 'var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)';
  }
}
