import { exec, execBuffer } from '../util/exec';

export interface Repo {
  root: string;
}

const GIT_FLAGS = ['-c', 'core.quotepath=false', '-c', 'core.pager=cat', '--no-optional-locks'];

export async function git(repo: Repo | string, args: string[]): Promise<string> {
  const root = typeof repo === 'string' ? repo : repo.root;
  const { stdout } = await exec('git', [...GIT_FLAGS, ...args], { cwd: root });
  return stdout;
}

export async function gitBuffer(repo: Repo | string, args: string[]): Promise<Buffer> {
  const root = typeof repo === 'string' ? repo : repo.root;
  return execBuffer('git', [...GIT_FLAGS, ...args], { cwd: root });
}

export async function openRepo(input: string): Promise<Repo> {
  let root: string;
  try {
    root = (await git(input, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    throw new Error(
      `Not a git repository: ${input}\n` +
        (error instanceof Error ? error.message.split('\n')[0] : String(error)),
    );
  }
  if (!root) throw new Error(`Not a git working tree: ${input}`);
  return { root };
}

export async function currentBranch(repo: Repo): Promise<string> {
  try {
    const branch = (await git(repo, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
    return branch || 'HEAD';
  } catch {
    return 'HEAD';
  }
}
