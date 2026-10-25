import { git, type Repo } from './repo';

export interface CommitInfo {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
}

export interface CommitSelection {
  commit?: string;
  range?: string;
  includeMerges?: boolean;
}

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const RECORD = '\x1e';
const FIELD = '\x1f';

function parseCommitRecord(record: string): CommitInfo | undefined {
  const fields = record.split(FIELD);
  if (fields.length < 8) return undefined;
  const [sha, shortSha, parents, date, author, email, subject, ...body] = fields;
  return {
    sha: sha!,
    shortSha: shortSha!,
    parents: parents!.split(' ').filter(Boolean),
    date: date!,
    author: author!,
    email: email!,
    subject: subject!,
    body: body.join(FIELD).trim(),
  };
}

export async function getCommits(repo: Repo, shas: string[]): Promise<CommitInfo[]> {
  if (shas.length === 0) return [];
  const out = await git(repo, [
    'log',
    '--no-walk=unsorted',
    `--format=%H${FIELD}%h${FIELD}%P${FIELD}%aI${FIELD}%an${FIELD}%ae${FIELD}%s${FIELD}%b${RECORD}`,
    ...shas,
  ]);
  return out
    .split(RECORD)
    .map((record) => record.replace(/^\n+/, ''))
    .filter(Boolean)
    .map(parseCommitRecord)
    .filter((commit): commit is CommitInfo => Boolean(commit));
}

export async function getCommit(repo: Repo, rev: string): Promise<CommitInfo> {
  try {
    await git(repo, ['rev-parse', '--verify', `${rev}^{commit}`]);
  } catch {
    throw new Error(`Unknown commit or revision: ${rev}`);
  }
  const [commit] = await getCommits(repo, [rev]);
  if (!commit) throw new Error(`Could not read commit: ${rev}`);
  return commit;
}

export async function resolveCommits(
  repo: Repo,
  selection: CommitSelection,
): Promise<CommitInfo[]> {
  if (selection.commit && selection.range) {
    throw new Error('Pass either --commit or --range, not both.');
  }
  if (!selection.commit && !selection.range) {
    throw new Error('Pass --commit <rev> or --range <git-range>.');
  }

  if (selection.commit) {
    return [await getCommit(repo, selection.commit)];
  }

  const range = selection.range!;
  const args = ['rev-list', '--reverse'];
  if (!selection.includeMerges) args.push('--no-merges');
  args.push(range);
  let shas: string[];
  try {
    const out = await git(repo, args);
    shas = out.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    throw new Error(
      `Could not resolve range "${range}": ${error instanceof Error ? error.message.split('\n')[0] : error}`,
    );
  }
  if (shas.length === 0) {
    throw new Error(`Range "${range}" contains no${selection.includeMerges ? '' : ' non-merge'} commits.`);
  }
  const commits = await getCommits(repo, shas);
  if (commits.length !== shas.length) {
    throw new Error(
      `Could not read ${shas.length - commits.length} commit(s) in range "${range}".`,
    );
  }
  return commits;
}
