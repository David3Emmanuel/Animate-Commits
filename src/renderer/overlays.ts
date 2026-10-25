import type { SceneEvent } from '../scene/types';
import type { RenderState } from './state';
import { activeOverlays } from './state';
import { h, icon, progressiveText } from './dom';

function renameOverlay(event: Extract<SceneEvent, { type: 'rename' }>): HTMLElement {
  const rows = document.querySelectorAll<HTMLElement>('[data-path]');
  const target = [...rows].find((row) => row.dataset.path === event.to);
  const rect = target?.getBoundingClientRect();
  const box = h('div', { className: 'inline-rename' });
  if (event.via === 'f2') {
    box.textContent = event.to.split('/').pop() ?? event.to;
    box.classList.add('is-input');
  } else {
    box.append(icon('folder'), h('span', { text: event.to.split('/').pop() ?? event.to }));
  }
  if (rect) {
    box.style.left = `${rect.left + 12}px`;
    box.style.top = `${rect.top}px`;
    box.style.minWidth = `${Math.max(120, rect.width - 20)}px`;
  } else {
    box.style.left = '210px';
    box.style.top = '120px';
  }
  return box;
}

function quickOpen(event: Extract<SceneEvent, { type: 'quickopen' }>, state: RenderState): HTMLElement {
  const visibleText = progressiveText(event.text, event.t, event.until ?? event.t, state.time);
  const box = h('div', { className: 'quick-input' });
  const input = h('div', { className: 'quick-input-box' });
  input.append(h('span', { className: 'quick-input-text', text: visibleText }));
  if (!visibleText) {
    input.append(h('span', { className: 'quick-input-placeholder', text: 'Search files by name (append : to go to line)' }));
  }
  box.append(input);
  if (visibleText) {
    const row = h('div', { className: 'quick-input-row selected' });
    row.append(icon(event.action === 'create' ? 'new-file' : 'file'));
    row.append(
      h('span', {
        className: 'quick-input-label',
        text: event.action === 'create' ? `Create file '${visibleText}'` : visibleText,
      }),
    );
    row.append(h('span', { className: 'quick-input-hint', text: event.action === 'create' ? '' : 'file' }));
    box.append(row);
  }
  return box;
}

function contextMenu(
  event: Extract<SceneEvent, { type: 'contextmenu' }>,
  state: RenderState,
): HTMLElement {
  const menu = h('div', { className: 'context-menu' });
  for (let index = 0; index < event.items.length; index++) {
    const label = event.items[index]!;
    const row = h('div', {
      className: `context-item${index === event.select ? ' selected' : ''}`,
      text: label,
    });
    menu.append(row);
  }
  let top = 120;
  const rows = document.querySelectorAll<HTMLElement>('[data-path]');
  const target = [...rows].find((row) => row.dataset.path === event.target);
  if (target) {
    const rect = target.getBoundingClientRect();
    top = rect.bottom;
  }
  const left = state.sidebar ? 210 : 70;
  menu.style.top = `${Math.min(window.innerHeight - 300, top)}px`;
  menu.style.left = `${left}px`;
  return menu;
}

function dialog(event: Extract<SceneEvent, { type: 'dialog' }>): HTMLElement {
  const box = h('div', { className: 'dialog' });
  box.append(h('div', { className: 'dialog-title', text: event.title }));
  box.append(h('div', { className: 'dialog-message', text: event.message }));
  const buttons = h('div', { className: 'dialog-buttons' });
  event.buttons.forEach((label, index) => {
    buttons.append(
      h('button', {
        className: `dialog-button${index === event.select ? ' selected' : ''}`,
        text: label,
      }),
    );
  });
  box.append(buttons);
  return box;
}

function toast(event: Extract<SceneEvent, { type: 'toast' }>): HTMLElement {
  const item = h('div', { className: 'toast' });
  item.append(icon('git-commit', 'toast-icon'));
  const content = h('div', { className: 'toast-content' });
  content.append(h('div', { className: 'toast-title', text: event.text }));
  content.append(h('div', { className: 'toast-source', text: event.source ?? 'Git' }));
  item.append(content);
  item.append(icon('close', 'toast-close'));
  return item;
}

export function renderOverlays(container: HTMLElement, state: RenderState): void {
  const overlays = activeOverlays(state);
  container.replaceChildren();
  if (overlays.contextmenu) container.append(contextMenu(overlays.contextmenu, state));
  if (overlays.quickopen) container.append(quickOpen(overlays.quickopen, state));
  if (overlays.rename) container.append(renameOverlay(overlays.rename));
  if (overlays.dialog) container.append(dialog(overlays.dialog));
  if (overlays.toast) container.append(toast(overlays.toast));
}
