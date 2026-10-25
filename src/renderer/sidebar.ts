import type { RenderState } from './state';
import type { Shell } from './shell';
import { clear } from './dom';
import { renderExplorer } from './explorer';
import { renderScm } from './scm';

let lastView: string | null = null;

export function renderSidebar(shell: Shell, state: RenderState): void {
  if (state.sidebar === null) {
    shell.sidebar.style.display = 'none';
    shell.root.classList.add('no-sidebar');
    lastView = null;
    return;
  }
  shell.sidebar.style.display = '';
  shell.root.classList.remove('no-sidebar');
  if (lastView !== state.sidebar) {
    clear(shell.sidebar);
    lastView = state.sidebar;
  }
  if (state.sidebar === 'explorer') renderExplorer(shell.sidebar, state);
  else renderScm(shell.sidebar, state);
}
