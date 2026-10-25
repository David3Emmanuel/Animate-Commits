import type {
  CursorPosition,
  DialogEvent,
  ContextMenuEvent,
  QuickOpenEvent,
  ScmEntry,
  Scene,
  SceneEvent,
  SceneMeta,
  SelectionRange,
  SidebarView,
  ToastEvent,
} from '../scene/types';
import { applyEdit } from '../scene/edits';

export interface DocState {
  path: string;
  text: string;
  lines: string[];
  cursor: CursorPosition;
  selection?: SelectionRange;
  scrollLine: number;
  dirty: boolean;
  version: number;
}

export interface Overlays {
  quickopen?: QuickOpenEvent;
  contextmenu?: ContextMenuEvent;
  dialog?: DialogEvent;
  toast?: ToastEvent;
  rename?: Extract<SceneEvent, { type: 'rename' }>;
}

export interface RenderState {
  meta: SceneMeta;
  time: number;
  docs: Map<string, DocState>;
  tabs: string[];
  previewTab: string | null;
  activeTab: string | null;
  files: Set<string>;
  expanded: Set<string>;
  sidebar: SidebarView;
  scm: ScmEntry[];
  scmMessage: { text: string; at: number; until: number } | null;
  overlays: Overlays;
  lastCursorActivity: number;
  lastEventIndex: number;
  events: SceneEvent[];
}

export function createDoc(path: string, text: string): DocState {
  return {
    path,
    text,
    lines: text.split('\n'),
    cursor: { line: 0, col: 0 },
    scrollLine: 0,
    dirty: false,
    version: 0,
  };
}

function ensureDoc(state: RenderState, path: string): DocState {
  let doc = state.docs.get(path);
  if (!doc) {
    doc = createDoc(path, state.meta.filesAtStart[path] ?? '');
    state.docs.set(path, doc);
  }
  return doc;
}

function setDocText(doc: DocState, text: string): void {
  if (doc.text === text) return;
  doc.text = text;
  doc.lines = text.split('\n');
  doc.version += 1;
  const lastLine = doc.lines.length - 1;
  if (doc.cursor.line > lastLine) doc.cursor = { line: lastLine, col: doc.lines[lastLine]!.length };
  else doc.cursor.col = Math.min(doc.cursor.col, doc.lines[doc.cursor.line]!.length);
  if (doc.selection) doc.selection = undefined;
}

function closeDocTab(state: RenderState, path: string): void {
  const index = state.tabs.indexOf(path);
  if (index >= 0) {
    state.tabs.splice(index, 1);
    if (state.previewTab === path) state.previewTab = null;
    if (state.activeTab === path) state.activeTab = state.tabs[state.tabs.length - 1] ?? null;
  }
}

function movePath(state: RenderState, from: string, to: string): void {
  const affected = [...state.files].filter((path) => path === from || path.startsWith(`${from}/`));
  for (const path of affected) {
    const moved = to + path.slice(from.length);
    state.files.delete(path);
    state.files.add(moved);
  }
  const doc = state.docs.get(from);
  if (doc) {
    state.docs.delete(from);
    doc.path = to;
    state.docs.set(to, doc);
  }
  for (let i = 0; i < state.tabs.length; i++) {
    if (state.tabs[i] === from) state.tabs[i] = to;
  }
  if (state.previewTab === from) state.previewTab = to;
  if (state.activeTab === from) state.activeTab = to;
  for (const dir of [...state.expanded]) {
    if (dir === from || dir.startsWith(`${from}/`)) {
      state.expanded.delete(dir);
      state.expanded.add(to + dir.slice(from.length));
    }
  }
  for (const entry of state.scm) {
    if (entry.path === from) entry.path = to;
    if (entry.oldPath === from) entry.oldPath = to;
  }
}

function openTab(state: RenderState, path: string, preview: boolean): void {
  ensureDoc(state, path);
  if (!state.tabs.includes(path)) {
    if (preview && state.previewTab && state.previewTab !== path) {
      closeDocTab(state, state.previewTab);
    }
    state.tabs.push(path);
  }
  if (preview) state.previewTab = path;
  else if (state.previewTab === path) state.previewTab = null;
  state.activeTab = path;
}

export function applyEvent(state: RenderState, event: SceneEvent): void {
  switch (event.type) {
    case 'sidebar':
      state.sidebar = event.view;
      break;
    case 'open-file':
      openTab(state, event.path, true);
      break;
    case 'close-tab':
      closeDocTab(state, event.path);
      break;
    case 'expand':
      for (const dir of event.dirs) state.expanded.add(dir);
      break;
    case 'quickopen':
      state.overlays.quickopen = event;
      break;
    case 'contextmenu':
      state.overlays.contextmenu = event;
      break;
    case 'dialog':
      state.overlays.dialog = event;
      break;
    case 'toast':
      state.overlays.toast = event;
      break;
    case 'create':
      state.files.add(event.path);
      break;
    case 'delete': {
      for (const path of [...state.files]) {
        if (path === event.path || path.startsWith(`${event.path}/`)) state.files.delete(path);
      }
      state.docs.delete(event.path);
      closeDocTab(state, event.path);
      break;
    }
    case 'rename':
      movePath(state, event.from, event.to);
      if (event.until !== undefined) state.overlays.rename = event;
      break;
    case 'cursor': {
      const doc = ensureDoc(state, event.path);
      doc.cursor = { line: event.line, col: event.col };
      doc.selection = event.selection;
      state.activeTab = event.path;
      state.lastCursorActivity = event.t;
      break;
    }
    case 'scroll': {
      const doc = ensureDoc(state, event.path);
      doc.scrollLine = event.line;
      break;
    }
    case 'edit': {
      const doc = ensureDoc(state, event.path);
      const lines = applyEdit(
        doc.lines,
        event.line,
        event.col,
        event.deleteText ?? '',
        event.insertText ?? '',
      );
      doc.lines = lines;
      doc.text = lines.join('\n');
      doc.version += 1;
      doc.cursor = event.cursorAfter;
      doc.selection = undefined;
      doc.dirty = true;
      state.activeTab = event.path;
      if (state.previewTab === event.path) state.previewTab = null;
      state.lastCursorActivity = event.t;
      break;
    }
    case 'save': {
      const doc = state.docs.get(event.path);
      if (doc) doc.dirty = false;
      if (state.previewTab === event.path) state.previewTab = null;
      break;
    }
    case 'file-content': {
      const doc = ensureDoc(state, event.path);
      setDocText(doc, event.text);
      doc.dirty = false;
      break;
    }
    case 'scm-set':
      state.scm = event.entries.map((entry) => ({ ...entry }));
      break;
    case 'scm-message':
      state.scmMessage = { text: event.text, at: event.t, until: event.until ?? event.t };
      break;
    case 'commit':
      state.scm = [];
      state.scmMessage = null;
      break;
  }
}

export function resetState(state: RenderState): void {
  state.time = 0;
  state.docs.clear();
  state.tabs = [];
  state.previewTab = null;
  state.activeTab = null;
  state.files = new Set(state.meta.initialFiles);
  state.expanded = new Set(state.meta.initialExpanded);
  state.sidebar = state.meta.initialSidebar;
  state.scm = [];
  state.scmMessage = null;
  state.overlays = {};
  state.lastCursorActivity = 0;
  state.lastEventIndex = 0;
}

export function createState(scene: Scene): RenderState {
  const state: RenderState = {
    meta: scene.meta,
    time: 0,
    docs: new Map(),
    tabs: [],
    previewTab: null,
    activeTab: null,
    files: new Set(),
    expanded: new Set(),
    sidebar: null,
    scm: [],
    scmMessage: null,
    overlays: {},
    lastCursorActivity: 0,
    lastEventIndex: 0,
    events: scene.events,
  };
  resetState(state);
  return state;
}

export function seek(state: RenderState, timeMs: number): void {
  const target = Math.max(0, timeMs);
  if (target < state.time) {
    resetState(state);
  }
  for (; state.lastEventIndex < state.events.length; state.lastEventIndex++) {
    const event = state.events[state.lastEventIndex]!;
    if (event.t > target) break;
    applyEvent(state, event);
  }
  state.time = target;
}

export function activeDoc(state: RenderState): DocState | undefined {
  return state.activeTab ? state.docs.get(state.activeTab) : undefined;
}

export function activeOverlays(state: RenderState): Overlays {
  const out: Overlays = {};
  for (const [key, value] of Object.entries(state.overlays) as Array<[keyof Overlays, Overlays[keyof Overlays]]>) {
    if (!value) continue;
    if (value.until === undefined || value.until >= state.time) {
      out[key] = value as never;
    }
  }
  return out;
}
