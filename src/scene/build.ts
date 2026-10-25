import { posix } from 'node:path';
import type { CommitInfo } from '../git/commits';
import { changedFiles, type ChangedFile } from '../git/changes';
import { EMPTY_TREE } from '../git/commits';
import { listFiles, readFileAt, isSubmodule, isSymlink } from '../git/content';
import { currentBranch, type Repo } from '../git/repo';
import { GrammarRegistry } from '../grammar/resolve';
import { splitLines } from '../diff/lines';
import type { ResolvedEnvironment } from '../vscode/environment';
import type {
  CommitMeta,
  CursorPosition,
  Platform,
  Scene,
  SceneEvent,
  SceneEventInput,
  SceneMeta,
  ScmEntry,
  SidebarView,
} from './types';
import type { PlannedEdit } from './edits';
import { applyEdit, planFileEdits } from './edits';
import { matchesIgnore } from './ignore';
import { createRng, hashSeed, jitter } from './rng';

export interface TypingOptions {
  baseMs: number;
  jitterMs: number;
  speed: number;
  seed?: number;
  noTyping: boolean;
  /** Characters typed per commit before switching to bulk insertion. */
  budget: number;
}

export interface BuildSceneOptions {
  repo: Repo;
  commits: CommitInfo[];
  environment: ResolvedEnvironment;
  width: number;
  height: number;
  dpr: number;
  platform: Platform;
  showExplorer: boolean;
  showScm: boolean;
  title?: string;
  maxFileLines: number;
  maxTabs: number;
  ignore: string[];
  typing: TypingOptions;
  introMs: number;
  outroMs: number;
  /** Compress the finished timeline if it exceeds this length. */
  maxDurationMs?: number;
}

interface FileVersion {
  text: string;
  eol: 'lf' | 'crlf';
  binary: boolean;
  tooLarge: boolean;
  mode?: string;
}

const CHROME = {
  openFile: 380,
  quickOpenPerChar: 16,
  quickOpenMin: 160,
  quickOpenMax: 600,
  expand: 140,
  blockPause: 300,
  scroll: 220,
  cursor: 90,
  save: 220,
  structural: 420,
};

function advancePosition(position: CursorPosition, text: string): CursorPosition {
  const parts = text.split('\n');
  if (parts.length === 1) return { line: position.line, col: position.col + text.length };
  return { line: position.line + parts.length - 1, col: parts[parts.length - 1]!.length };
}

function ancestorsOf(path: string): string[] {
  const dirs: string[] = [];
  let dir = posix.dirname(path);
  while (dir && dir !== '.') {
    dirs.unshift(dir);
    dir = posix.dirname(dir);
  }
  return dirs;
}

function trashLabel(platform: Platform): string {
  if (platform === 'macos') return 'Move to Trash';
  if (platform === 'linux') return 'Move to Trash';
  return 'Move to Recycle Bin';
}

export async function buildScene(options: BuildSceneOptions): Promise<Scene> {
  const builder = new SceneBuilder(options);
  return builder.build();
}

class SceneBuilder {
  private readonly events: SceneEvent[] = [];
  private readonly warnings = new Set<string>();
  private readonly docs = new Map<string, string>();
  private readonly tabs: string[] = [];
  private readonly eols = new Map<string, 'lf' | 'crlf'>();
  private readonly grammarScopes = new Map<string, string>();
  private readonly languages = new Map<string, string>();
  private readonly grammars: GrammarRegistry;
  private readonly rng: () => number;
  private now = 0;
  private sidebar: SidebarView;
  private activeTab: string | null = null;
  private commitTypedChars = 0;
  private readonly speed: number;

  constructor(private readonly options: BuildSceneOptions) {
    this.grammars = new GrammarRegistry(
      options.environment.install,
      options.environment.install?.userExtensionsDir,
    );
    const seed =
      options.typing.seed ??
      hashSeed(
        `${options.commits.map((commit) => commit.sha).join(',')}:${options.typing.baseMs}:${options.typing.jitterMs}`,
      );
    this.rng = createRng(seed);
    this.sidebar = options.showExplorer ? 'explorer' : null;
    this.speed = Math.max(0.1, options.typing.speed);
  }

  async build(): Promise<Scene> {
    const { repo, commits } = this.options;
    const baseRev = commits[0]?.parents[0] ?? EMPTY_TREE;
    const initialFiles = await listFiles(repo, baseRev);
    const branch = await currentBranch(repo);
    const repoName = posix.basename(repo.root.replace(/\\/g, '/'));

    this.advance(this.options.introMs);

    for (const commit of commits) {
      await this.animateCommit(commit);
    }
    this.advance(this.options.outroMs);

    const maxDuration = this.options.maxDurationMs ?? 150_000;
    const requiredSpeed = maxDuration > 0 ? this.now / maxDuration : 0;
    const effectiveSpeed = Math.max(this.speed, requiredSpeed);
    const scaled = this.scaleEvents(effectiveSpeed);
    const durationMs = Math.round(this.now / effectiveSpeed);

    const meta: SceneMeta = {
      width: this.options.width,
      height: this.options.height,
      dpr: this.options.dpr,
      platform: this.options.platform,
      ...(this.options.title ? { windowTitle: this.options.title } : {}),
      repoName,
      branch,
      fonts: {
        ui: this.options.environment.resolvedSettings.uiFontFamily,
        editor: this.options.environment.resolvedSettings.fontFamily,
        editorSize: this.options.environment.resolvedSettings.fontSize,
        lineHeight: this.options.environment.resolvedSettings.lineHeight,
        ligatures: this.options.environment.resolvedSettings.fontLigatures,
      },
      colors: this.options.environment.theme.colors,
      tokenColors: this.options.environment.theme.tokenColors,
      showExplorer: this.options.showExplorer,
      showScm: this.options.showScm,
      minimap: this.options.environment.resolvedSettings.minimap,
      tabSize: this.options.environment.resolvedSettings.tabSize,
      wordWrap: this.options.environment.resolvedSettings.wordWrap,
      initialFiles,
      initialSidebar: this.options.showExplorer ? 'explorer' : null,
      initialTabs: [],
      initialExpanded: [],
      filesAtStart: {},
      eols: Object.fromEntries(this.eols),
      grammarScopes: Object.fromEntries(this.grammarScopes),
      languages: Object.fromEntries(this.languages),
      warnings: [...this.warnings],
    };

    return {
      version: 1,
      meta,
      commits: commits.map(
        (commit): CommitMeta => ({
          sha: commit.sha,
          shortSha: commit.shortSha,
          subject: commit.subject,
          author: commit.author,
          date: commit.date,
        }),
      ),
      events: scaled,
      durationMs,
    };
  }

  private scaleEvents(speed: number): SceneEvent[] {
    const scale = 1 / speed;
    const scaled = this.events.map((event) => {
      const next: SceneEvent = {
        ...event,
        t: Math.round(event.t * scale),
        ...(event.until !== undefined ? { until: Math.max(1, Math.round(event.until * scale)) } : {}),
      };
      return next;
    });
    scaled.sort((a, b) => a.t - b.t);
    return scaled;
  }

  private push(event: SceneEventInput): void {
    this.events.push({ ...event, t: this.now } as SceneEvent);
  }

  private pushFor(event: SceneEventInput, duration: number): void {
    this.events.push({ ...event, t: this.now, until: this.now + duration } as SceneEvent);
    this.advance(duration);
  }

  private advance(ms: number): void {
    this.now += Math.max(0, ms);
  }

  private warn(message: string): void {
    this.warnings.add(message);
  }

  private setSidebar(view: SidebarView): void {
    if (this.sidebar === view) return;
    this.sidebar = view;
    this.push({ type: 'sidebar', view });
    this.advance(260);
  }

  private async animateCommit(commit: CommitInfo): Promise<void> {
    this.commitTypedChars = 0;
    const files = await changedFiles(this.options.repo, commit.sha, commit.parents);
    const scmEntries: ScmEntry[] = files.map((file) => ({
      path: file.path,
      status: file.status,
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    }));

    if (this.options.showExplorer) this.setSidebar('explorer');
    else this.setSidebar(null);

    this.push({ type: 'scm-set', entries: scmEntries });
    this.advance(180);

    const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of ordered) {
      await this.animateFile(commit, file);
    }

    await this.commitMoment(commit, scmEntries);
    this.advance(500);
  }

  private async animateFile(commit: CommitInfo, file: ChangedFile): Promise<void> {
    const { repo } = this.options;
    const parentRev = commit.parents[0] ?? EMPTY_TREE;
    const oldPath = file.oldPath ?? file.path;
    const oldFile =
      file.status === 'added' ? undefined : await this.readVersion(parentRev, oldPath);
    const newFile =
      file.status === 'deleted' ? undefined : await this.readVersion(commit.sha, file.path);

    const skipReason = this.skipReason(file, oldFile, newFile);
    const isStructural = file.status !== 'modified' && file.status !== 'type-changed';

    if (skipReason) {
      this.warn(`${commit.shortSha} ${file.path}: ${skipReason}`);
      await this.animateSkipped(file, skipReason);
      return;
    }

    if (file.status === 'deleted') {
      await this.deleteFile(file.path);
      this.docs.delete(file.path);
      this.eols.delete(file.path);
      return;
    }

    if (file.status === 'renamed') {
      await this.renameFile(oldPath, file.path, this.renameVia(oldPath, file.path));
      this.moveDoc(oldPath, file.path);
    } else if (file.status === 'copied') {
      await this.createFile(file.path);
      this.docs.set(file.path, '');
      if (newFile) this.eols.set(file.path, newFile.eol);
    }

    if (oldFile?.text === newFile?.text) {
      if (!isStructural) this.advance(CHROME.structural);
      return;
    }

    const oldText = file.status === 'copied' ? '' : oldFile?.text ?? '';
    const newText = newFile?.text ?? '';
    if (file.status === 'added') {
      await this.createFile(file.path);
      this.docs.set(file.path, '');
      if (newFile) this.eols.set(file.path, newFile.eol);
    } else if (newFile) {
      this.eols.set(file.path, newFile.eol);
    }
    await this.animateContent(file.path, oldText, newText, commit);
  }

  private skipReason(
    file: ChangedFile,
    oldFile: FileVersion | undefined,
    newFile: FileVersion | undefined,
  ): string | undefined {
    if (matchesIgnore(file.path, this.options.ignore)) return 'excluded by --ignore';
    if (file.status !== 'added' && !oldFile) return 'missing content at parent revision';
    if (file.status !== 'deleted' && !newFile) return 'missing content at commit';
    for (const [version, label] of [
      [oldFile, 'previous version'],
      [newFile, 'new version'],
    ] as const) {
      if (!version) continue;
      if (version.binary) return `${label} is binary`;
      if (version.tooLarge) return `${label} is too large to animate`;
      if (isSubmodule(version.mode)) return 'submodule';
      if (isSymlink(version.mode)) return 'symlink';
      if (splitLines(version.text).length > this.options.maxFileLines) {
        return `${label} has more than ${this.options.maxFileLines} lines`;
      }
    }
    return undefined;
  }

  private async animateSkipped(file: ChangedFile, reason: string): Promise<void> {
    const ignored = reason.includes('--ignore');
    this.registerFile(file.path);
    if (file.oldPath) this.registerFile(file.oldPath);

    if (file.status === 'added') {
      this.push({ type: 'create', path: file.path });
      this.advance(ignored ? 160 : 380);
      return;
    }
    if (file.status === 'deleted') {
      this.closeTab(file.path);
      this.push({ type: 'delete', path: file.path });
      this.advance(ignored ? 160 : 380);
      return;
    }
    if (file.status === 'renamed' || file.status === 'copied') {
      const from = file.oldPath ?? file.path;
      this.push({ type: 'rename', from, to: file.path, via: this.renameVia(from, file.path) });
      this.moveDoc(from, file.path);
      this.advance(ignored ? 160 : 380);
    }
  }

  private renameVia(from: string, to: string): 'f2' | 'drag' {
    return posix.dirname(from) === posix.dirname(to) ? 'f2' : 'drag';
  }

  private async readVersion(rev: string, path: string): Promise<FileVersion | undefined> {
    const file = await readFileAt(this.options.repo, rev, path);
    if (!file) return undefined;
    return {
      text: file.text,
      eol: file.eol,
      binary: file.binary,
      tooLarge: file.tooLarge,
      ...(file.mode ? { mode: file.mode } : {}),
    };
  }

  private registerFile(path: string): void {
    const grammar = this.grammars.resolve(path);
    if (grammar.scopeName) this.grammarScopes.set(path, grammar.scopeName);
    this.languages.set(path, grammar.languageName ?? grammar.languageId ?? 'Plain Text');
  }

  private moveDoc(from: string, to: string): void {
    if (this.docs.has(from)) {
      this.docs.set(to, this.docs.get(from)!);
      this.docs.delete(from);
    }
    for (let i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i] === from) this.tabs[i] = to;
    }
    if (this.activeTab === from) this.activeTab = to;
    const eol = this.eols.get(from);
    if (eol) {
      this.eols.set(to, eol);
      this.eols.delete(from);
    }
    if (this.grammarScopes.has(from)) {
      this.grammarScopes.set(to, this.grammarScopes.get(from)!);
      this.grammarScopes.delete(from);
    }
    if (this.languages.has(from)) {
      this.languages.set(to, this.languages.get(from)!);
      this.languages.delete(from);
    }
    this.registerFile(to);
  }

  private ensureTabCapacity(upcoming: string): void {
    while (this.tabs.length >= this.options.maxTabs) {
      const candidate = this.tabs.find((path) => path !== this.activeTab && path !== upcoming);
      if (!candidate) break;
      this.closeTab(candidate);
    }
  }

  private closeTab(path: string): void {
    const index = this.tabs.indexOf(path);
    if (index === -1) {
      if (this.activeTab === path) this.activeTab = null;
      return;
    }
    this.tabs.splice(index, 1);
    if (this.activeTab === path) this.activeTab = this.tabs[this.tabs.length - 1] ?? null;
    this.push({ type: 'close-tab', path });
    this.advance(180);
  }

  private async openFile(path: string): Promise<void> {
    this.registerFile(path);
    const alreadyOpen = this.tabs.includes(path);
    if (!alreadyOpen) {
      this.ensureTabCapacity(path);
      if (this.options.showExplorer) {
        await this.ensureExplorer();
        this.expandDirs(ancestorsOf(path));
        this.push({ type: 'open-file', path, via: 'explorer' });
      } else {
        this.quickOpen(path, 'open');
        this.push({ type: 'open-file', path, via: 'quickopen' });
      }
      this.tabs.push(path);
      this.advance(CHROME.openFile);
    } else {
      this.tabs.splice(this.tabs.indexOf(path), 1);
      this.tabs.push(path);
      this.push({ type: 'open-file', path, via: this.options.showExplorer ? 'explorer' : 'quickopen' });
      this.advance(160);
    }
    this.activeTab = path;
  }

  private async animateContent(
    path: string,
    oldText: string,
    newText: string,
    commit: CommitInfo,
  ): Promise<void> {
    const wasOpen = this.tabs.includes(path);
    const previous = this.docs.get(path);
    const plans = planFileEdits(splitLines(oldText), splitLines(newText));
    if (plans.length === 0) return;

    // Load the base contents before the tab is created so the first painted
    // frame of the file is never empty.
    if (!wasOpen || previous !== oldText) {
      this.push({ type: 'file-content', path, text: oldText });
    }
    this.docs.set(path, oldText);

    await this.openFile(path);
    this.registerFile(path);

    for (const block of plans) {
      this.push({ type: 'scroll', path, line: block.scrollLine });
      this.advance(CHROME.scroll);
      const first = block.edits[0];
      if (first) {
        this.push({ type: 'cursor', path, line: first.line, col: first.col });
        this.advance(CHROME.cursor);
      }
      for (const edit of block.edits) {
        if (edit.deleteText) this.animateDelete(path, edit);
        if (edit.insertText) this.animateInsert(path, edit);
      }
      this.advance(CHROME.blockPause);
    }

    this.push({ type: 'save', path });
    this.advance(CHROME.save);

    let doc = this.docs.get(path)!;
    for (const block of plans) {
      for (const edit of block.edits) {
        doc = applyEdit(
          doc.split('\n'),
          edit.line,
          edit.col,
          edit.deleteText ?? '',
          edit.insertText ?? '',
        ).join('\n');
      }
    }
    this.docs.set(path, doc);
    if (doc !== newText) {
      this.warn(`${commit.shortSha} ${path}: content drifted after animation; repairing`);
      this.push({ type: 'file-content', path, text: newText });
      this.docs.set(path, newText);
    }
  }

  private animateDelete(path: string, edit: PlannedEdit): void {
    const text = edit.deleteText!;
    const multiline = text.includes('\n');
    if (edit.selectionBefore) {
      this.push({
        type: 'cursor',
        path,
        line: edit.selectionBefore.anchor.line,
        col: edit.selectionBefore.anchor.col,
        selection: edit.selectionBefore,
      });
      this.advance(220);
    }

    if (!multiline && text.length <= 28) {
      let col = edit.col + text.length;
      for (const char of [...text].reverse()) {
        col -= char.length;
        const cursor: CursorPosition = { line: edit.line, col };
        this.push({ type: 'edit', path, line: edit.line, col, deleteText: char, cursorAfter: cursor });
        this.advance(jitter(this.rng, 24, 18));
      }
      return;
    }

    this.push({
      type: 'edit',
      path,
      line: edit.line,
      col: edit.col,
      deleteText: text,
      cursorAfter: edit.cursorAfter,
      ...(edit.selectionBefore ? { selectionBefore: edit.selectionBefore } : {}),
    });
    this.advance(220);
  }

  private animateInsert(path: string, edit: PlannedEdit): void {
    const text = edit.insertText!;
    const budgetExhausted =
      this.options.typing.noTyping || this.commitTypedChars >= this.options.typing.budget;

    if (budgetExhausted) {
      this.push({
        type: 'edit',
        path,
        line: edit.line,
        col: edit.col,
        insertText: text,
        cursorAfter: edit.cursorAfter,
      });
      this.advance(60);
      return;
    }

    let line = edit.line;
    let col = edit.col;
    const segments = text.split('\n');
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      let segment = segments[segmentIndex]!;
      let chars = Array.from(segment);

      if (col === 0 && chars.length > 2) {
        const indent = /^[ \t]+/.exec(segment)?.[0] ?? '';
        if (indent.length > 1) {
          const cursor: CursorPosition = { line, col: indent.length };
          this.push({ type: 'edit', path, line, col: 0, insertText: indent, cursorAfter: cursor });
          col += indent.length;
          segment = segment.slice(indent.length);
          chars = Array.from(segment);
          this.advance(15);
        }
      }

      for (let index = 0; index < chars.length; index++) {
        if (this.commitTypedChars >= this.options.typing.budget) {
          const remaining = chars.slice(index).join('') + (segmentIndex < segments.length - 1 ? '\n' + segments.slice(segmentIndex + 1).join('\n') : '');
          const cursorAfter = advancePosition({ line, col }, remaining);
          this.push({ type: 'edit', path, line, col, insertText: remaining, cursorAfter });
          this.advance(10);
          return;
        }
        const char = chars[index]!;
        const cursor: CursorPosition = { line, col: col + char.length };
        this.push({ type: 'edit', path, line, col, insertText: char, cursorAfter: cursor });
        col += char.length;
        this.commitTypedChars += char.length;
        this.advance(jitter(this.rng, this.options.typing.baseMs, this.options.typing.jitterMs));
      }

      if (segmentIndex < segments.length - 1) {
        const cursor: CursorPosition = { line: line + 1, col: 0 };
        this.push({ type: 'edit', path, line, col, insertText: '\n', cursorAfter: cursor });
        line += 1;
        col = 0;
        this.advance(jitter(this.rng, 30, 25));
      }
    }
  }

  private async ensureExplorer(): Promise<void> {
    if (this.sidebar === 'explorer') return;
    this.setSidebar('explorer');
  }

  private expandDirs(dirs: string[]): void {
    if (dirs.length === 0) return;
    this.push({ type: 'expand', dirs });
    this.advance(CHROME.expand);
  }

  private quickOpen(text: string, action: 'open' | 'create'): void {
    const duration = Math.min(
      CHROME.quickOpenMax,
      Math.max(CHROME.quickOpenMin, text.length * CHROME.quickOpenPerChar),
    );
    this.pushFor({ type: 'quickopen', text, action, path: text }, duration);
    this.advance(180);
  }

  private async createFile(path: string): Promise<void> {
    this.registerFile(path);
    this.quickOpen(path, 'create');
    if (this.options.showExplorer) {
      await this.ensureExplorer();
      this.expandDirs(ancestorsOf(path));
    }
    this.push({ type: 'create', path });
    this.advance(CHROME.structural);
  }

  private async renameFile(from: string, to: string, via: 'f2' | 'drag'): Promise<void> {
    this.registerFile(from);
    this.registerFile(to);
    const previous = this.sidebar;
    await this.ensureExplorer();
    this.expandDirs(ancestorsOf(from));
    this.expandDirs(ancestorsOf(to));
    this.push({
      type: 'rename',
      from,
      to,
      via,
      until: this.now + 420,
    });
    this.advance(450);
    if (previous !== 'explorer' && previous !== null) {
      this.setSidebar(previous);
    } else if (previous === null) {
      this.setSidebar(null);
    }
  }

  private async deleteFile(path: string): Promise<void> {
    this.registerFile(path);
    this.closeTab(path);
    const previous = this.sidebar;
    await this.ensureExplorer();
    this.expandDirs(ancestorsOf(path));
    this.pushFor(
      {
        type: 'contextmenu',
        target: path,
        items: [
          'Open to the Side',
          'Reveal in File Explorer',
          'Open Timeline',
          'Cut',
          'Copy',
          'Paste',
          'Copy Path',
          'Copy Relative Path',
          'Rename...',
          'Delete',
        ],
        select: 9,
      },
      420,
    );
    const button = trashLabel(this.options.platform);
    this.pushFor(
      {
        type: 'dialog',
        title: 'Delete',
        message: `Are you sure you want to delete '${posix.basename(path)}'?`,
        buttons: [button, 'Cancel'],
        select: 0,
      },
      650,
    );
    this.advance(120);
    this.push({ type: 'delete', path });
    this.advance(CHROME.structural);
    if (previous === null) this.setSidebar(null);
    else if (previous !== 'explorer') this.setSidebar(previous);
  }

  private async commitMoment(commit: CommitInfo, entries: ScmEntry[]): Promise<void> {
    if (!this.options.showScm) {
      this.push({
        type: 'commit',
        sha: commit.sha,
        subject: commit.subject,
        author: commit.author,
      });
      this.advance(350);
      this.toast(`Committed ${commit.shortSha} — ${commit.subject}`, 1800);
      return;
    }

    this.setSidebar('scm');
    this.push({
      type: 'scm-set',
      entries: entries.map((entry) => ({ ...entry, staged: true })),
    });
    this.advance(550);

    const duration = Math.min(1100, Math.max(320, commit.subject.length * 22));
    this.pushFor({ type: 'scm-message', text: commit.subject }, duration);
    this.advance(220);
    this.push({
      type: 'commit',
      sha: commit.sha,
      subject: commit.subject,
      author: commit.author,
    });
    this.advance(650);
    this.toast(`Committed ${commit.shortSha} — ${commit.subject}`, 2400);
    this.advance(600);

    if (this.options.showExplorer) this.setSidebar('explorer');
  }

  private toast(text: string, duration: number): void {
    this.pushFor({ type: 'toast', text, source: 'Git' }, duration);
  }
}
