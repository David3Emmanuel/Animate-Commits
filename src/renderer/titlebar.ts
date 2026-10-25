import type { RenderState } from './state';
import { h } from './dom';

let lastTitle = '';

export function renderTitlebar(shell: { title: HTMLElement }, state: RenderState): void {
  const { meta, activeTab } = state;
  const file = activeTab ? (activeTab.split('/').pop() ?? activeTab) : '';
  const suffix = meta.platform === 'macos' ? '' : ' - Visual Studio Code';
  const title = meta.windowTitle ?? `${file ? `${file} — ` : ''}${meta.repoName}${suffix}`;
  if (title === lastTitle) return;
  lastTitle = title;
  shell.title.textContent = title;
}
