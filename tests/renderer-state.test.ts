import type { Scene, SceneEvent, SceneMeta } from '../src/scene/types';
import {
  activeDoc,
  activeOverlays,
  createState,
  seek,
} from '../src/renderer/state';

function makeMeta(overrides: Partial<SceneMeta> = {}): SceneMeta {
  return {
    width: 200,
    height: 120,
    dpr: 1,
    platform: 'windows',
    repoName: 'repo',
    branch: 'main',
    fonts: {
      ui: 'sans-serif',
      editor: 'monospace',
      editorSize: 14,
      lineHeight: 19,
      ligatures: false,
    },
    colors: {},
    tokenColors: [],
    showExplorer: true,
    showScm: true,
    minimap: false,
    tabSize: 4,
    wordWrap: false,
    initialFiles: ['a.ts', 'dir/b.ts'],
    initialSidebar: 'explorer',
    initialTabs: [],
    initialExpanded: [],
    filesAtStart: {},
    eols: {},
    grammarScopes: {},
    languages: {},
    warnings: [],
    ...overrides,
  };
}

function makeScene(events: SceneEvent[], meta = makeMeta()): Scene {
  return { version: 1, meta, commits: [], events, durationMs: 1000 };
}

describe('renderer state', () => {
  it('tracks documents, preview tabs, dirty state, and saves', () => {
    const events: SceneEvent[] = [
      { t: 0, type: 'open-file', path: 'a.ts', via: 'explorer' },
      { t: 5, type: 'file-content', path: 'a.ts', text: 'hello' },
      {
        t: 10,
        type: 'edit',
        path: 'a.ts',
        line: 0,
        col: 0,
        insertText: 'x',
        cursorAfter: { line: 0, col: 1 },
      },
      { t: 20, type: 'save', path: 'a.ts' },
    ];
    const state = createState(makeScene(events));
    seek(state, 6);
    expect(state.tabs).toEqual(['a.ts']);
    expect(state.previewTab).toBe('a.ts');
    expect(activeDoc(state)?.text).toBe('hello');

    seek(state, 15);
    expect(activeDoc(state)?.text).toBe('xhello');
    expect(activeDoc(state)?.dirty).toBe(true);
    expect(state.previewTab).toBeNull();

    seek(state, 25);
    expect(activeDoc(state)?.dirty).toBe(false);

    seek(state, 1);
    // Seeking backwards rebuilds from the start; only events at or before t=1
    // have been applied.
    expect(state.tabs).toEqual(['a.ts']);
    expect(activeDoc(state)?.text).toBe('');
    expect(state.sidebar).toBe('explorer');
  });

  it('applies renames, create/delete events, and document edits', () => {
    const events: SceneEvent[] = [
      { t: 0, type: 'open-file', path: 'dir/b.ts', via: 'explorer' },
      { t: 5, type: 'file-content', path: 'dir/b.ts', text: 'const b = 1;\n' },
      { t: 10, type: 'create', path: 'dir/new.ts' },
      { t: 15, type: 'rename', from: 'dir/b.ts', to: 'dir/c.ts', via: 'f2', until: 500 },
      {
        t: 20,
        type: 'file-content',
        path: 'dir/new.ts',
        text: 'first\nsecond\n',
      },
      {
        t: 30,
        type: 'edit',
        path: 'dir/new.ts',
        line: 1,
        col: 6,
        deleteText: '\n',
        cursorAfter: { line: 1, col: 6 },
      },
    ];
    const state = createState(makeScene(events));
    seek(state, 35);
    expect(state.files.has('dir/c.ts')).toBe(true);
    expect(state.files.has('dir/b.ts')).toBe(false);
    expect(state.files.has('dir/new.ts')).toBe(true);
    expect(state.tabs).toEqual(['dir/c.ts']);
    expect(state.docs.get('dir/c.ts')?.text).toBe('const b = 1;\n');
    expect(state.docs.get('dir/new.ts')?.text).toBe('first\nsecond');
    expect(state.overlays.rename?.to).toBe('dir/c.ts');
    expect(activeOverlays(state).rename).toBeDefined();

    seek(state, 600);
    expect(activeOverlays(state).rename).toBeUndefined();

    const deleteEvents: SceneEvent[] = [{ t: 0, type: 'delete', path: 'dir/new.ts' }];
    const deleted = createState(makeScene(deleteEvents));
    seek(deleted, 1);
    expect(deleted.files.has('dir/new.ts')).toBe(false);
    expect(deleted.docs.has('dir/new.ts')).toBe(false);
  });

  it('expires transient overlays and tracks source control changes', () => {
    const events: SceneEvent[] = [
      {
        t: 0,
        type: 'quickopen',
        text: 'src/a.ts',
        action: 'open',
        path: 'src/a.ts',
        until: 100,
      },
      {
        t: 10,
        type: 'scm-set',
        entries: [{ path: 'a.ts', status: 'modified' }],
      },
      { t: 20, type: 'scm-message', text: 'Fix it', until: 80 },
      {
        t: 30,
        type: 'toast',
        text: 'Committed abc1234 — Fix it',
        source: 'Git',
        until: 90,
      },
      { t: 70, type: 'commit', sha: 'abc', subject: 'Fix it', author: 'A' },
    ];
    const state = createState(makeScene(events, makeMeta({ minimap: true })));
    seek(state, 50);
    expect(activeOverlays(state).quickopen).toBeDefined();
    expect(state.scm).toHaveLength(1);
    expect(state.scmMessage?.text).toBe('Fix it');

    seek(state, 75);
    expect(state.scm).toHaveLength(0);
    expect(state.scmMessage).toBeNull();
    expect(activeOverlays(state).quickopen).toBeDefined();
    expect(activeOverlays(state).toast).toBeDefined();

    seek(state, 120);
    expect(activeOverlays(state).quickopen).toBeUndefined();
    expect(activeOverlays(state).toast).toBeUndefined();
  });

  it('closes the active tab and falls back to the remaining tab', () => {
    const events: SceneEvent[] = [
      { t: 0, type: 'open-file', path: 'a.ts', via: 'explorer' },
      { t: 1, type: 'file-content', path: 'a.ts', text: 'a' },
      { t: 2, type: 'save', path: 'a.ts' },
      { t: 3, type: 'open-file', path: 'dir/b.ts', via: 'explorer' },
      { t: 4, type: 'close-tab', path: 'dir/b.ts' },
    ];
    const state = createState(makeScene(events));
    seek(state, 5);
    expect(state.tabs).toEqual(['a.ts']);
    expect(state.activeTab).toBe('a.ts');
  });
});
