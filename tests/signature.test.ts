import type { Scene, SceneMeta } from '../src/scene/types';
import { createState, seek } from '../src/renderer/state';
import { frameSignature, isCursorVisible } from '../src/renderer/signature';

function meta(): SceneMeta {
  return {
    width: 200,
    height: 120,
    dpr: 1,
    platform: 'windows',
    repoName: 'repo',
    branch: 'main',
    fonts: { ui: 'sans-serif', editor: 'monospace', editorSize: 14, lineHeight: 19, ligatures: false },
    colors: {},
    tokenColors: [],
    showExplorer: true,
    showScm: true,
    minimap: false,
    tabSize: 4,
    wordWrap: false,
    initialFiles: ['a.ts'],
    initialSidebar: 'explorer',
    initialTabs: [],
    initialExpanded: [],
    filesAtStart: {},
    eols: {},
    grammarScopes: {},
    languages: {},
    warnings: [],
  };
}

function scene(events: Scene['events']): Scene {
  return { version: 1, meta: meta(), commits: [], events, durationMs: 5000 };
}

describe('frame signature', () => {
  const events: Scene['events'] = [
    { t: 0, type: 'open-file', path: 'a.ts', via: 'explorer' },
    { t: 10, type: 'file-content', path: 'a.ts', text: 'const a = 1;\n' },
    { t: 20, type: 'cursor', path: 'a.ts', line: 0, col: 0 },
    {
      t: 30,
      type: 'edit',
      path: 'a.ts',
      line: 0,
      col: 11,
      insertText: '2',
      cursorAfter: { line: 0, col: 12 },
    },
    { t: 40, type: 'quickopen', text: 'src/a.ts', action: 'open', path: 'src/a.ts', until: 200 },
    { t: 300, type: 'scm-set', entries: [{ path: 'a.ts', status: 'modified' }] },
  ];

  it('changes when visible state changes and is stable otherwise', () => {
    const state = createState(scene(events));
    seek(state, 15);
    const initial = frameSignature(state);
    seek(state, 15);
    expect(frameSignature(state)).toBe(initial);

    seek(state, 35);
    expect(frameSignature(state)).not.toBe(initial);

    const afterEdit = frameSignature(state);
    seek(state, 50);
    const quickOpenVisible = frameSignature(state);
    expect(quickOpenVisible).not.toBe(afterEdit);
    seek(state, 200);
    expect(frameSignature(state)).not.toBe(afterEdit);
  });

  it('includes cursor blink and editor height', () => {
    const blinkEvents: Scene['events'] = [
      { t: 0, type: 'open-file', path: 'a.ts', via: 'explorer' },
      { t: 10, type: 'file-content', path: 'a.ts', text: 'const a = 1;\n' },
      { t: 20, type: 'cursor', path: 'a.ts', line: 0, col: 0 },
    ];
    const state = createState(scene(blinkEvents));
    seek(state, 25);
    expect(isCursorVisible(state)).toBe(true);
    const visible = frameSignature(state, 400);
    expect(frameSignature(state, 500)).not.toBe(visible);

    seek(state, 1000);
    expect(isCursorVisible(state)).toBe(false);
    expect(frameSignature(state, 400)).not.toBe(visible);
  });

  it('updates for quick-open typing and source-control changes', () => {
    const state = createState(scene(events));
    seek(state, 45);
    const early = frameSignature(state);
    seek(state, 120);
    expect(frameSignature(state)).not.toBe(early);

    seek(state, 320);
    const withChanges = frameSignature(state);
    seek(state, 320);
    expect(frameSignature(state)).toBe(withChanges);
  });
});
