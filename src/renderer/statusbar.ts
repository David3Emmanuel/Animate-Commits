import type { RenderState } from './state';
import { h, icon } from './dom';

export function renderStatusBar(container: HTMLElement, state: RenderState): void {
  const doc = state.activeTab ? state.docs.get(state.activeTab) : undefined;
  const cursor = doc?.cursor ?? { line: 0, col: 0 };
  const language = state.activeTab ? state.meta.languages[state.activeTab] ?? 'Plain Text' : 'Plain Text';
  const eol = state.activeTab ? state.meta.eols[state.activeTab] ?? 'lf' : 'lf';

  container.replaceChildren(
    h(
      'div',
      { className: 'status-left' },
      h(
        'div',
        { className: 'status-item status-branch' },
        icon('source-control'),
        h('span', { text: state.meta.branch }),
        h('span', { className: 'status-sync' }, icon('sync'), '0', icon('arrow-down'), '0', icon('arrow-up')),
      ),
    ),
    h(
      'div',
      { className: 'status-right' },
      h(
        'div',
        { className: 'status-item' },
        h('span', { text: `Ln ${cursor.line + 1}, Col ${cursor.col + 1}` }),
      ),
      h('div', { className: 'status-item', text: `Spaces: ${state.meta.tabSize}` }),
      h('div', { className: 'status-item', text: 'UTF-8' }),
      h('div', { className: 'status-item', text: eol === 'crlf' ? 'CRLF' : 'LF' }),
      h('div', { className: 'status-item status-language', text: language }),
      h('div', { className: 'status-item status-bell' }, icon('bell')),
    ),
  );
}
