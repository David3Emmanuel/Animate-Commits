import type { HighlightedLine, Highlighter } from './textmate';
import { fontStyleClass } from './textmate';
import type { DocState, RenderState } from './state';
import { activeDoc } from './state';
import type { Shell } from './shell';
import { basename, clamp, fileIconColor, h, icon } from './dom';

let lastTabsSignature = '';
let lastBreadcrumbSignature = '';
let minimapCache: { signature: string; element: HTMLElement } | null = null;

const DEFAULT_FOREGROUND = 'var(--vscode-editor-foreground, #cccccc)';

function dirtySignature(state: RenderState): string {
  return state.tabs
    .map((path) => `${path}:${state.docs.get(path)?.dirty ? 1 : 0}`)
    .join('|');
}

export function renderTabs(shell: Shell, state: RenderState): void {
  const signature = `${state.tabs.join('|')}::${state.activeTab ?? ''}::${state.previewTab ?? ''}::${dirtySignature(state)}`;
  if (signature === lastTabsSignature) return;
  lastTabsSignature = signature;

  shell.tabs.replaceChildren();
  for (const path of state.tabs) {
    const active = state.activeTab === path;
    const preview = state.previewTab === path;
    const dirty = state.docs.get(path)?.dirty ?? false;
    const tab = h('div', {
      className: `tab${active ? ' active' : ''}${preview ? ' preview' : ''}`,
      title: path,
    });
    tab.append(icon('file', 'file-icon'));
    const iconElement = tab.querySelector<HTMLElement>('.file-icon');
    if (iconElement) iconElement.style.color = fileIconColor(path);
    tab.append(h('span', { className: 'tab-label', text: basename(path) }));
    if (dirty) tab.append(h('span', { className: 'tab-dirty' }, icon('circle-filled')));
    else tab.append(icon('close', 'tab-close'));
    shell.tabs.append(tab);
  }
}

export function renderBreadcrumbs(shell: Shell, state: RenderState): void {
  const active = state.activeTab;
  const signature = active ?? '';
  if (signature === lastBreadcrumbSignature) return;
  lastBreadcrumbSignature = signature;
  shell.breadcrumbs.replaceChildren();
  if (!active) {
    shell.breadcrumbs.style.display = 'none';
    return;
  }
  shell.breadcrumbs.style.display = '';
  const parts = active.split('/');
  for (let index = 0; index < parts.length; index++) {
    const isLast = index === parts.length - 1;
    const label = parts[index]!;
    const item = h('span', { className: `breadcrumb${isLast ? ' last' : ''}`, text: label });
    if (isLast) {
      item.prepend(icon('file'));
      const iconElement = item.querySelector<HTMLElement>('.codicon-file');
      if (iconElement) iconElement.style.color = fileIconColor(active);
    }
    shell.breadcrumbs.append(item);
    if (!isLast) shell.breadcrumbs.append(icon('chevron-right', 'breadcrumb-separator'));
  }
}

interface Segment {
  start: number;
  end: number;
  color: string;
  background?: string;
  fontStyle: number;
}

function lineSegments(line: string, highlighted: HighlightedLine | undefined): Segment[] {
  if (!highlighted || highlighted.spans.length === 0) {
    return [{ start: 0, end: line.length, color: DEFAULT_FOREGROUND, fontStyle: 0 }];
  }
  const segments: Segment[] = [];
  let cursor = 0;
  for (const span of highlighted.spans) {
    if (span.start > cursor) {
      segments.push({ start: cursor, end: span.start, color: DEFAULT_FOREGROUND, fontStyle: 0 });
    }
    const start = Math.max(cursor, span.start);
    const end = Math.max(start, span.end);
    if (end > start) {
      segments.push({
        start,
        end,
        color: span.color ?? DEFAULT_FOREGROUND,
        ...(span.background ? { background: span.background } : {}),
        fontStyle: span.fontStyle,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < line.length) {
    segments.push({ start: cursor, end: line.length, color: DEFAULT_FOREGROUND, fontStyle: 0 });
  }
  return segments;
}

function normalizedSelection(doc: DocState): { start: { line: number; col: number }; end: { line: number; col: number } } | null {
  if (!doc.selection) return null;
  const { anchor, active } = doc.selection;
  if (anchor.line === active.line && anchor.col === active.col) return null;
  const a = { line: anchor.line, col: anchor.col };
  const b = { line: active.line, col: active.col };
  const before = a.line < b.line || (a.line === b.line && a.col <= b.col);
  return before ? { start: a, end: b } : { start: b, end: a };
}

function renderLine(
  line: string,
  lineIndex: number,
  doc: DocState,
  highlighted: HighlightedLine | undefined,
  cursorVisible: boolean,
  selection: ReturnType<typeof normalizedSelection>,
  lineHeight: number,
): HTMLElement {
  const row = h('div', {
    className: `editor-line${doc.cursor.line === lineIndex ? ' active-line' : ''}`,
    style: { height: `${lineHeight}px` },
  });
  const content = h('span', { className: 'line-content' });

  let selectionStart = -1;
  let selectionEnd = -1;
  let cursorCol: number | null = null;
  if (selection && lineIndex >= selection.start.line && lineIndex <= selection.end.line) {
    selectionStart = lineIndex === selection.start.line ? selection.start.col : 0;
    selectionEnd = lineIndex === selection.end.line ? selection.end.col : line.length;
    if (selectionEnd < selectionStart) selectionEnd = selectionStart;
    if (lineIndex === selection.end.line && selection.end.col === 0 && lineIndex !== selection.start.line) {
      selectionEnd = 0;
    }
  }
  if (doc.cursor.line === lineIndex) cursorCol = clamp(doc.cursor.col, 0, line.length);

  const segments = lineSegments(line, highlighted);
  const boundaries = new Set<number>([0, line.length]);
  for (const segment of segments) {
    boundaries.add(clamp(segment.start, 0, line.length));
    boundaries.add(clamp(segment.end, 0, line.length));
  }
  if (cursorCol !== null) boundaries.add(cursorCol);
  if (selectionStart >= 0) boundaries.add(clamp(selectionStart, 0, line.length));
  if (selectionEnd >= 0) boundaries.add(clamp(selectionEnd, 0, line.length));
  const points = [...boundaries].sort((a, b) => a - b);

  let cursorInserted = false;
  const appendCursor = (): void => {
    const cursor = h('span', {
      className: `cursor${cursorVisible ? '' : ' cursor-off'}`,
      style: { height: `${lineHeight}px` },
    });
    content.append(cursor);
    cursorInserted = true;
  };

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (cursorCol === start && !cursorInserted) appendCursor();
    if (end <= start) continue;
    const segment =
      segments.find((candidate) => candidate.start <= start && candidate.end >= end) ??
      segments[segments.length - 1]!;
    const selected = selectionStart >= 0 && start >= selectionStart && end <= selectionEnd;
    const span = h('span', {
      className: [
        selected ? 'selected' : '',
        fontStyleClass(segment.fontStyle),
        segment.background ? 'has-background' : '',
      ]
        .filter(Boolean)
        .join(' '),
      text: line.slice(start, end),
      style: {
        color: segment.color,
        ...(segment.background ? { backgroundColor: segment.background } : {}),
      },
    });
    content.append(span);
  }
  if (cursorCol !== null && !cursorInserted) appendCursor();
  if (line.length === 0 && cursorCol === null) content.append(h('span', { text: ' ' }));
  row.append(content);
  return row;
}

function minimap(
  doc: DocState,
  highlighted: HighlightedLine[] | undefined,
  lineHeight: number,
  viewportHeight: number,
): HTMLElement {
  const container = h('div', { className: 'minimap' });
  if (doc.lines.length === 0 || viewportHeight <= 0) return container;
  const barHeight = 2;
  const maxRows = Math.max(1, Math.floor(viewportHeight / barHeight));
  const step = Math.max(1, Math.ceil(doc.lines.length / maxRows));
  for (let index = 0; index < doc.lines.length; index += step) {
    const line = doc.lines[index]!;
    if (!line.trim()) continue;
    const bar = h('div', { className: 'minimap-line' });
    const segments = lineSegments(line, highlighted?.[index]);
    const width = Math.min(1, line.length / 120) * 100;
    const color = segments.find((segment) => segment.color !== DEFAULT_FOREGROUND)?.color ?? DEFAULT_FOREGROUND;
    bar.style.width = `${Math.max(6, width)}%`;
    bar.style.backgroundColor = color;
    bar.style.opacity = '0.55';
    container.append(bar);
  }
  container.style.height = `${Math.min(viewportHeight, Math.ceil(doc.lines.length / step) * barHeight)}px`;
  return container;
}

export function renderEditor(shell: Shell, state: RenderState, highlighter: Highlighter): void {
  renderTabs(shell, state);
  renderBreadcrumbs(shell, state);

  const doc = activeDoc(state);
  if (!doc) {
    shell.editor.replaceChildren();
    return;
  }

  const { meta } = state;
  const lineHeight = meta.fonts.lineHeight;
  const height = shell.editor.clientHeight || 500;
  const visibleCount = Math.max(1, Math.ceil(height / lineHeight) + 2);
  const topLine = clamp(doc.scrollLine - Math.floor(visibleCount / 3), 0, Math.max(0, doc.lines.length - 1));
  const scope = meta.grammarScopes[doc.path];
  const highlighted = highlighter.highlight(doc.path, scope, doc.text);
  const selection = normalizedSelection(doc);

  const cursorAge = state.time - state.lastCursorActivity;
  const cursorVisible = cursorAge < 450 || Math.floor((cursorAge - 450) / 530) % 2 === 0;

  const body = h('div', { className: 'editor-body' });
  const gutter = h('div', { className: 'gutter' });
  const lines = h('div', { className: 'lines' });
  const digits = String(doc.lines.length).length;
  gutter.style.width = `${Math.max(34, digits * 9 + 18)}px`;

  for (let index = topLine; index < Math.min(doc.lines.length, topLine + visibleCount); index++) {
    gutter.append(
      h('div', {
        className: `line-number${doc.cursor.line === index ? ' active-number' : ''}`,
        text: String(index + 1),
        style: { height: `${lineHeight}px`, lineHeight: `${lineHeight}px` },
      }),
    );
    lines.append(
      renderLine(doc.lines[index] ?? '', index, doc, highlighted?.[index], cursorVisible, selection, lineHeight),
    );
  }

  const scroller = h('div', { className: 'editor-scroller' }, gutter, lines);
  body.append(scroller);

  if (meta.minimap) {
    const signature = `${doc.path}:${doc.version}`;
    if (!minimapCache || minimapCache.signature !== signature) {
      minimapCache = { signature, element: minimap(doc, highlighted, lineHeight, height) };
    }
    body.append(minimapCache.element);
  } else {
    minimapCache = null;
  }

  const total = Math.max(1, doc.lines.length);
  const thumbHeight = Math.max(20, (visibleCount / total) * height);
  const thumbTop = (topLine / total) * height;
  body.append(
    h(
      'div',
      { className: 'scrollbar' },
      h('div', {
        className: 'scrollbar-thumb',
        style: {
          height: `${Math.min(height, thumbHeight)}px`,
          top: `${Math.min(height - thumbHeight, thumbTop)}px`,
        },
      }),
    ),
  );

  shell.editor.replaceChildren(body);
}
