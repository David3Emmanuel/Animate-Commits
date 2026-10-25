import type { SceneMeta } from '../scene/types';
import { h, icon } from './dom';

export interface Shell {
  root: HTMLElement;
  titlebar: HTMLElement;
  title: HTMLElement;
  activitybar: HTMLElement;
  sidebar: HTMLElement;
  editorArea: HTMLElement;
  tabs: HTMLElement;
  breadcrumbs: HTMLElement;
  editor: HTMLElement;
  statusbar: HTMLElement;
  overlayRoot: HTMLElement;
}

function windowControls(): HTMLElement {
  return h(
    'div',
    { className: 'window-controls' },
    h('button', { className: 'window-control', title: 'Minimize' }, icon('chrome-minimize')),
    h('button', { className: 'window-control', title: 'Maximize' }, icon('chrome-maximize')),
    h('button', { className: 'window-control close', title: 'Close' }, icon('chrome-close')),
  );
}

function menuBar(): HTMLElement {
  const menu = h('div', { className: 'menubar' });
  for (const label of ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help']) {
    menu.append(h('span', { className: 'menu-item', text: label }));
  }
  return menu;
}

function activityButton(name: string, title: string, badge = false): HTMLElement {
  const button = h('div', { className: `activity-item activity-${name}`, title }, icon(name));
  if (badge) button.append(h('span', { className: 'activity-badge' }));
  return button;
}

export function buildShell(meta: SceneMeta): Shell {
  const title = h('div', { className: 'titlebar-title' });
  const titlebar = h('div', { className: 'titlebar' });
  if (meta.platform === 'macos') {
    titlebar.append(
      h(
        'div',
        { className: 'traffic-lights' },
        h('span', { className: 'traffic close' }),
        h('span', { className: 'traffic minimize' }),
        h('span', { className: 'traffic maximize' }),
      ),
      title,
    );
  } else {
    titlebar.append(menuBar(), title, windowControls());
  }

  const activitybar = h(
    'div',
    { className: 'activitybar' },
    activityButton('files', 'Explorer'),
    activityButton('search', 'Search'),
    activityButton('source-control', 'Source Control', true),
    activityButton('debug-alt', 'Run and Debug'),
    activityButton('extensions', 'Extensions'),
  );

  const sidebar = h('div', { className: 'sidebar' });
  const tabs = h('div', { className: 'tabs' });
  const breadcrumbs = h('div', { className: 'breadcrumbs' });
  const editor = h('div', { className: 'editor' });
  const editorArea = h('div', { className: 'editor-area' }, tabs, breadcrumbs, editor);
  const statusbar = h('div', { className: 'statusbar' });
  const overlayRoot = h('div', { className: 'overlay-root' });

  const root = h(
    'div',
    { className: 'window' },
    titlebar,
    h('div', { className: 'workbench' }, activitybar, sidebar, editorArea),
    statusbar,
    overlayRoot,
  );

  document.body.append(root);

  return {
    root,
    titlebar,
    title,
    activitybar,
    sidebar,
    editorArea,
    tabs,
    breadcrumbs,
    editor,
    statusbar,
    overlayRoot,
  };
}
