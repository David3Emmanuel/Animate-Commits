import type { FileStatus } from '../git/changes';
import type { TokenColorRule } from '../theme/resolve';

export type Platform = 'windows' | 'macos' | 'linux';
export type SidebarView = 'explorer' | 'scm' | null;
export type OpenVia = 'explorer' | 'quickopen';
export type FileOpVia = 'f2' | 'drag';

export interface CursorPosition {
  /** 0-based. */
  line: number;
  /** 0-based UTF-16 column. */
  col: number;
}

export interface SelectionRange {
  anchor: CursorPosition;
  active: CursorPosition;
}

export interface SceneFonts {
  ui: string;
  editor: string;
  editorSize: number;
  lineHeight: number;
  ligatures: boolean;
}

export interface ScmEntry {
  path: string;
  status: FileStatus;
  oldPath?: string;
  staged?: boolean;
}

export interface CommitMeta {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
}

export interface SceneMeta {
  width: number;
  height: number;
  dpr: number;
  platform: Platform;
  /** Explicit window title; otherwise derived from the active file. */
  windowTitle?: string;
  repoName: string;
  branch: string;
  fonts: SceneFonts;
  colors: Record<string, string>;
  tokenColors: TokenColorRule[];
  showExplorer: boolean;
  showScm: boolean;
  minimap: boolean;
  tabSize: number;
  wordWrap: boolean;
  /** Every tracked path at the start of the range. */
  initialFiles: string[];
  initialSidebar: SidebarView;
  initialTabs: string[];
  initialExpanded: string[];
  /** Contents at the start revision for files the animation may open. */
  filesAtStart: Record<string, string>;
  eols: Record<string, 'lf' | 'crlf'>;
  grammarScopes: Record<string, string>;
  languages: Record<string, string>;
  warnings: string[];
}

interface EventBase {
  /** Milliseconds from the start of the animation. */
  t: number;
  /** Milliseconds at which a transient overlay disappears. */
  until?: number;
}

export interface SidebarEvent extends EventBase {
  type: 'sidebar';
  view: SidebarView;
}

export interface OpenFileEvent extends EventBase {
  type: 'open-file';
  path: string;
  via: OpenVia;
}

export interface CloseTabEvent extends EventBase {
  type: 'close-tab';
  path: string;
}

export interface ExpandEvent extends EventBase {
  type: 'expand';
  dirs: string[];
}

export interface QuickOpenEvent extends EventBase {
  type: 'quickopen';
  text: string;
  action: 'open' | 'create';
  path: string;
}

export interface ContextMenuEvent extends EventBase {
  type: 'contextmenu';
  target: string;
  items: string[];
  select: number;
}

export interface DialogEvent extends EventBase {
  type: 'dialog';
  title: string;
  message: string;
  buttons: string[];
  select: number;
}

export interface RenameEvent extends EventBase {
  type: 'rename';
  from: string;
  to: string;
  via: FileOpVia;
}

export interface CreateFileEvent extends EventBase {
  type: 'create';
  path: string;
}

export interface DeleteFileEvent extends EventBase {
  type: 'delete';
  path: string;
}

export interface ScrollEvent extends EventBase {
  type: 'scroll';
  path: string;
  line: number;
}

export interface CursorEvent extends EventBase {
  type: 'cursor';
  path: string;
  line: number;
  col: number;
  selection?: SelectionRange;
}

export interface EditEvent extends EventBase {
  type: 'edit';
  path: string;
  line: number;
  col: number;
  deleteText?: string;
  insertText?: string;
  cursorAfter: CursorPosition;
  selectionBefore?: SelectionRange;
}

export interface SaveEvent extends EventBase {
  type: 'save';
  path: string;
}

/** Instantly replace a document's contents (used to repair drift and for skipped files). */
export interface FileContentEvent extends EventBase {
  type: 'file-content';
  path: string;
  text: string;
}

export interface ScmSetEvent extends EventBase {
  type: 'scm-set';
  entries: ScmEntry[];
}

export interface ScmMessageEvent extends EventBase {
  type: 'scm-message';
  text: string;
}

export interface CommitEvent extends EventBase {
  type: 'commit';
  sha: string;
  subject: string;
  author: string;
}

export interface ToastEvent extends EventBase {
  type: 'toast';
  text: string;
  source?: string;
}

export type SceneEvent =
  | SidebarEvent
  | OpenFileEvent
  | CloseTabEvent
  | ExpandEvent
  | QuickOpenEvent
  | ContextMenuEvent
  | DialogEvent
  | RenameEvent
  | CreateFileEvent
  | DeleteFileEvent
  | ScrollEvent
  | CursorEvent
  | EditEvent
  | SaveEvent
  | FileContentEvent
  | ScmSetEvent
  | ScmMessageEvent
  | CommitEvent
  | ToastEvent;

export interface Scene {
  version: 1;
  meta: SceneMeta;
  commits: CommitMeta[];
  events: SceneEvent[];
  durationMs: number;
}

export type SceneEventInput = SceneEvent extends infer Event
  ? Event extends SceneEvent
    ? Omit<Event, 't'>
    : never
  : never;

export interface RendererWindow {
  __scene?: Scene;
  __seek?: (timeMs: number) => void;
  __ready?: boolean;
  __duration?: number;
}
