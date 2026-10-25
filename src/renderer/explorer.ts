import type { FileStatus } from '../git/changes';
import type { RenderState } from './state';
import { fileIconColor, h, icon } from './dom';
import { statusColor, statusLetter } from './decorations';

interface TreeNode {
  name: string;
  path: string;
  dirs: TreeNode[];
  files: string[];
}

function buildTree(files: Iterable<string>): TreeNode {
  const root: TreeNode = { name: '', path: '', dirs: [], files: [] };
  for (const file of files) {
    const parts = file.split('/');
    let node = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index]!;
      let child = node.dirs.find((dir) => dir.name === name);
      if (!child) {
        child = { name, path: parts.slice(0, index + 1).join('/'), dirs: [], files: [] };
        node.dirs.push(child);
      }
      node = child;
    }
    node.files.push(parts[parts.length - 1]!);
  }
  const sortNode = (node: TreeNode): void => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.localeCompare(b));
    node.dirs.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function treeSignature(state: RenderState): string {
  const files = [...state.files].sort().join('\n');
  const expanded = [...state.expanded].sort().join('\n');
  const scm = state.scm.map((entry) => `${entry.path}:${entry.status}`).join('\n');
  return `${state.sidebar}|${files}|${expanded}|${state.activeTab ?? ''}|${scm}`;
}

let lastSignature = '';
let lastSidebarScroll = 0;

function fileRow(
  state: RenderState,
  path: string,
  name: string,
  depth: number,
  status: FileStatus | undefined,
): HTMLElement {
  const active = state.activeTab === path;
  const row = h('div', {
    className: `tree-row file-row${active ? ' active' : ''}`,
    title: path,
    style: { paddingLeft: `${depth * 8 + 12}px` },
    attrs: { 'data-path': path },
  });
  row.append(icon('file', 'file-icon'));
  const iconElement = row.querySelector<HTMLElement>('.file-icon');
  if (iconElement) iconElement.style.color = fileIconColor(path);
  row.append(h('span', { className: 'tree-label', text: name }));
  if (status) {
    row.append(
      h('span', {
        className: 'decoration',
        text: statusLetter(status),
        style: { color: statusColor(status) },
      }),
    );
  }
  return row;
}

export function renderExplorer(container: HTMLElement, state: RenderState): void {
  const signature = treeSignature(state);
  if (signature === lastSignature) return;
  lastSignature = signature;

  const scrollTop = container.scrollTop || lastSidebarScroll;
  container.replaceChildren();

  const header = h('div', { className: 'sidebar-header' }, h('span', { text: 'EXPLORER' }));
  const actions = h(
    'div',
    { className: 'sidebar-actions' },
    icon('ellipsis'),
  );
  header.append(actions);
  container.append(header);

  const section = h(
    'div',
    { className: 'explorer-section' },
    h(
      'div',
      { className: 'section-title' },
      icon('chevron-down'),
      h('span', { text: state.meta.repoName.toUpperCase() }),
    ),
  );
  const tree = h('div', { className: 'tree' });
  const root = buildTree(state.files);

  const statusByPath = new Map(state.scm.map((entry) => [entry.path, entry.status]));

  const renderNode = (node: TreeNode, depth: number): void => {
    for (const dir of node.dirs) {
      const expanded = state.expanded.has(dir.path);
      const row = h('div', {
        className: 'tree-row dir-row',
        title: dir.path,
        style: { paddingLeft: `${depth * 8 + 8}px` },
      });
      row.append(icon(expanded ? 'chevron-down' : 'chevron-right', 'chevron'));
      row.append(icon(expanded ? 'folder-opened' : 'folder', 'folder-icon'));
      row.append(h('span', { className: 'tree-label', text: dir.name }));
      tree.append(row);
      if (expanded) renderNode(dir, depth + 1);
    }
    for (const name of node.files) {
      const path = node.path ? `${node.path}/${name}` : name;
      tree.append(fileRow(state, path, name, depth, statusByPath.get(path)));
    }
  };

  renderNode(root, 0);
  if (state.files.size === 0) {
    tree.append(h('div', { className: 'tree-empty', text: 'No files' }));
  }
  section.append(tree);
  container.append(section);

  const activeRow = tree.querySelector<HTMLElement>('.file-row.active');
  if (activeRow) {
    const containerRect = container.getBoundingClientRect();
    const rowRect = activeRow.getBoundingClientRect();
    if (rowRect.top < containerRect.top) {
      container.scrollTop = Math.max(0, scrollTop - (containerRect.top - rowRect.top) - 40);
    } else if (rowRect.bottom > containerRect.bottom) {
      container.scrollTop = scrollTop + (rowRect.bottom - containerRect.bottom) + 40;
    } else {
      container.scrollTop = scrollTop;
    }
  } else {
    container.scrollTop = scrollTop;
  }
  lastSidebarScroll = container.scrollTop;
}

export function resetExplorerCache(): void {
  lastSignature = '';
  lastSidebarScroll = 0;
}
