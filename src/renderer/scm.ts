import type { RenderState } from './state';
import { basename, dirname, fileIconColor, h, icon, progressiveText } from './dom';
import { statusColor, statusLetter } from './decorations';

let lastSignature = '';
let lastScroll = 0;

function scmSignature(state: RenderState): string {
  const message = state.scmMessage
    ? progressiveText(state.scmMessage.text, state.scmMessage.at, state.scmMessage.until, state.time)
    : '';
  const entries = state.scm
    .map((entry) => `${entry.path}:${entry.status}:${entry.staged ? 1 : 0}`)
    .join('\n');
  return `${state.sidebar}|${state.meta.branch}|${entries}|${message}|${state.time >= 0 ? 'live' : ''}`;
}

function entryRow(entry: RenderState['scm'][number]): HTMLElement {
  const row = h('div', { className: 'scm-row', title: entry.path });
  row.append(icon('file', 'file-icon'));
  const iconElement = row.querySelector<HTMLElement>('.file-icon');
  if (iconElement) iconElement.style.color = fileIconColor(entry.path);
  row.append(h('span', { className: 'scm-name', text: basename(entry.path) }));
  const directory = dirname(entry.path);
  if (directory) row.append(h('span', { className: 'scm-dir', text: directory }));
  row.append(
    h('span', {
      className: 'scm-status',
      text: statusLetter(entry.status),
      style: { color: statusColor(entry.status) },
    }),
  );
  return row;
}

export function renderScm(container: HTMLElement, state: RenderState): void {
  const message = state.scmMessage
    ? progressiveText(state.scmMessage.text, state.scmMessage.at, state.scmMessage.until, state.time)
    : '';
  const signature = scmSignature(state);
  if (signature === lastSignature) return;
  lastSignature = signature;

  const scrollTop = container.scrollTop || lastScroll;
  container.replaceChildren();

  const header = h('div', { className: 'sidebar-header' }, h('span', { text: 'SOURCE CONTROL' }));
  header.append(
    h('div', { className: 'sidebar-actions' }, icon('refresh'), icon('ellipsis')),
  );
  container.append(header);

  const staged = state.scm.filter((entry) => entry.staged);
  const unstaged = state.scm.filter((entry) => !entry.staged);
  const count = state.scm.length;

  const repo = h('div', { className: 'scm-repo' });
  repo.append(icon('chevron-down'), icon('repo'), h('span', { text: state.meta.repoName }));
  repo.append(
    h('span', {
      className: 'scm-count',
      text: count > 0 ? String(count) : '',
    }),
  );
  repo.append(h('div', { className: 'scm-repo-actions' }, icon('ellipsis')));
  container.append(repo);

  const messageBox = h('div', { className: 'scm-input' });
  if (message) messageBox.textContent = message;
  else messageBox.append(h('span', { className: 'placeholder', text: `Message (press Ctrl+Enter to commit on '${state.meta.branch}')` }));
  container.append(messageBox);

  const actions = h('div', { className: 'scm-actions' });
  actions.append(
    h(
      'button',
      {
        className: `scm-commit${message.trim() ? '' : ' disabled'}${count === 0 ? ' disabled' : ''}`,
        text: 'Commit',
      },
    ),
    h('button', { className: 'scm-commit-chevron' }, icon('chevron-down')),
    h('button', { className: 'scm-more' }, icon('ellipsis')),
  );
  container.append(actions);

  const section = (title: string, entries: RenderState['scm'], collapsed = false): void => {
    if (entries.length === 0) return;
    const group = h('div', { className: 'scm-group' });
    const titleRow = h(
      'div',
      { className: 'scm-group-title' },
      icon(collapsed ? 'chevron-right' : 'chevron-down'),
      h('span', { text: title }),
      h('span', { className: 'scm-group-count', text: String(entries.length) }),
    );
    titleRow.append(h('div', { className: 'scm-group-actions' }, icon('check'), icon('plus')));
    group.append(titleRow);
    if (!collapsed) {
      for (const entry of entries) group.append(entryRow(entry));
    }
    container.append(group);
  };

  section('Staged Changes', staged);
  section('Changes', unstaged);

  if (count === 0 && !message) {
    container.append(
      h(
        'div',
        { className: 'scm-empty' },
        icon('check'),
        h('span', { text: 'No changes' }),
      ),
    );
  }

  container.scrollTop = scrollTop;
  lastScroll = container.scrollTop;
}
