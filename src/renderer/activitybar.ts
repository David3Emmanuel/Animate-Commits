import type { RenderState } from './state';
import type { Shell } from './shell';

let lastSignature = '';

export function renderActivityBar(shell: Shell, state: RenderState): void {
  const { meta, scm, sidebar } = state;
  const pending = scm.filter((entry) => !entry.staged).length;
  const signature = `${sidebar}:${pending}:${meta.showScm}`;
  if (signature === lastSignature) return;
  lastSignature = signature;

  const items = shell.activitybar.querySelectorAll<HTMLElement>('.activity-item');
  const names = ['files', 'search', 'source-control', 'debug-alt', 'extensions'];
  const activeName = sidebar === 'explorer' ? 'files' : sidebar === 'scm' ? 'source-control' : null;
  items.forEach((item, index) => {
    const name = names[index]!;
    item.classList.toggle('active', name === activeName);
    if (name === 'source-control') {
      item.style.display = meta.showScm ? '' : 'none';
      const badge = item.querySelector<HTMLElement>('.activity-badge');
      if (badge) {
        badge.textContent = pending > 0 ? String(pending) : '';
        badge.style.display = pending > 0 ? '' : 'none';
      }
    }
  });
}
