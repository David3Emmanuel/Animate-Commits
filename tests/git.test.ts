import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRepo, type Repo } from '../src/git/repo';
import { getCommit, resolveCommits, EMPTY_TREE } from '../src/git/commits';
import { changedFiles } from '../src/git/changes';
import { listFiles, readFileAt } from '../src/git/content';
import { splitLines } from '../src/diff/lines';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function write(cwd: string, path: string, content: string): void {
  const target = join(cwd, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

function makeRepo(): { dir: string; repo: Repo; shas: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'animate-commits-git-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test User');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, 'src/a.ts', 'const one = 1;\nconst two = 2;\n');
  write(dir, 'README.md', '# demo\n');
  const first = commit(dir, 'Initial commit');
  write(dir, 'src/a.ts', 'const one = 1;\nconst two = 2;\nconst three = 3;\n');
  write(dir, 'src/b.ts', 'export const b = true;\n');
  const second = commit(dir, 'Add features');
  git(dir, 'mv', 'src/b.ts', 'src/c.ts');
  const third = commit(dir, 'Rename module');
  rmSync(join(dir, 'README.md'));
  const fourth = commit(dir, 'Remove readme');
  return { dir, repo: { root: dir }, shas: { first, second, third, fourth } };
}

describe('git history reader', () => {
  let fixture: ReturnType<typeof makeRepo>;

  beforeAll(() => {
    fixture = makeRepo();
  });

  it('opens a repository and reads commit metadata', async () => {
    const repo = await openRepo(fixture.dir);
    const commit = await getCommit(repo, 'HEAD');
    expect(commit.subject).toBe('Remove readme');
    expect(commit.sha).toBe(fixture.shas.fourth);
    expect(commit.parents).toHaveLength(1);
    expect(commit.author).toBe('Test User');
  });

  it('resolves ranges oldest first and skips merges', async () => {
    const repo = await openRepo(fixture.dir);
    const commits = await resolveCommits(repo, { range: `${fixture.shas.first}..HEAD` });
    expect(commits.map((commit) => commit.subject)).toEqual([
      'Add features',
      'Rename module',
      'Remove readme',
    ]);
  });

  it('detects adds, edits, renames, and deletions', async () => {
    const repo = await openRepo(fixture.dir);
    const second = await getCommit(repo, fixture.shas.second);
    const secondChanges = await changedFiles(repo, second.sha, second.parents);
    expect(secondChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/a.ts', status: 'modified' }),
        expect.objectContaining({ path: 'src/b.ts', status: 'added' }),
      ]),
    );

    const third = await getCommit(repo, fixture.shas.third);
    const thirdChanges = await changedFiles(repo, third.sha, third.parents);
    expect(thirdChanges).toEqual([
      expect.objectContaining({ path: 'src/c.ts', oldPath: 'src/b.ts', status: 'renamed' }),
    ]);

    const fourth = await getCommit(repo, fixture.shas.fourth);
    const fourthChanges = await changedFiles(repo, fourth.sha, fourth.parents);
    expect(fourthChanges).toEqual([expect.objectContaining({ path: 'README.md', status: 'deleted' })]);
  });

  it('reads content at revisions and handles the root commit', async () => {
    const repo = await openRepo(fixture.dir);
    const first = await getCommit(repo, fixture.shas.first);
    const rootChanges = await changedFiles(repo, first.sha, first.parents);
    expect(rootChanges.every((file) => file.status === 'added')).toBe(true);

    const content = await readFileAt(repo, first.sha, 'src/a.ts');
    expect(content?.text).toBe('const one = 1;\nconst two = 2;\n');

    const files = await listFiles(repo, fixture.shas.second);
    expect(files).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts', 'README.md']));
    expect(files).not.toContain('src/c.ts');
  });

  it('normalizes CRLF and flags binary files', async () => {
    const repo = await openRepo(fixture.dir);
    write(fixture.dir, 'crlf.txt', 'a\r\nb\r\n');
    writeFileSync(join(fixture.dir, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    const sha = commit(fixture.dir, 'Add binary and crlf');
    const text = await readFileAt(repo, sha, 'crlf.txt');
    expect(text?.eol).toBe('crlf');
    expect(text?.text).toBe('a\nb\n');
    const binary = await readFileAt(repo, sha, 'blob.bin');
    expect(binary?.binary).toBe(true);
  });

  it('exposes the empty tree constant for root diffs', async () => {
    const repo = await openRepo(fixture.dir);
    const first = await getCommit(repo, fixture.shas.first);
    expect(EMPTY_TREE).toMatch(/^4b825dc/);
    const content = await readFileAt(repo, first.sha, 'README.md');
    expect(splitLines(content!.text)[0]).toBe('# demo');
  });

  afterAll(() => {
    if (fixture) rmSync(fixture.dir, { recursive: true, force: true });
  });
});
