export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: {
    className?: string;
    text?: string;
    title?: string;
    style?: Partial<CSSStyleDeclaration>;
    attrs?: Record<string, string>;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.title) element.title = props.title;
  if (props.style) Object.assign(element.style, props.style);
  for (const [key, value] of Object.entries(props.attrs ?? {})) {
    element.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

export function clear(element: HTMLElement): void {
  element.replaceChildren();
}

export function icon(name: string, className = ''): HTMLElement {
  return h('span', {
    className: `codicon codicon-${name}${className ? ` ${className}` : ''}`,
    attrs: { 'aria-hidden': 'true' },
  });
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function extensionOf(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexLuminance(hex: string | undefined): number {
  if (!hex) return 0;
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return 0;
  const value = Number.parseInt(match[1]!, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const FILE_ICON_COLORS: Record<string, string> = {
  ts: '#519aba',
  tsx: '#61dafb',
  js: '#cbcb41',
  jsx: '#61dafb',
  json: '#cbcb41',
  md: '#519aba',
  css: '#42a5f5',
  scss: '#ea80fc',
  html: '#e44d26',
  py: '#3572a5',
  go: '#00add8',
  rs: '#dea584',
  java: '#b07219',
  c: '#555555',
  cpp: '#f34b7d',
  cs: '#178600',
  php: '#4f5d95',
  rb: '#701516',
  sh: '#89e051',
  yml: '#cb171e',
  yaml: '#cb171e',
  toml: '#9c4221',
  svg: '#ffb13b',
  png: '#a074c4',
  jpg: '#a074c4',
  lock: '#8c8c8c',
};

export function fileIconColor(path: string): string {
  const extension = extensionOf(path);
  return FILE_ICON_COLORS[extension] ?? 'var(--vscode-symbolIcon-fileForeground, #cccccc)';
}

export function progressiveText(text: string, at: number, until: number, now: number): string {
  if (now <= at) return '';
  if (until <= at || now >= until) return text;
  const ratio = (now - at) / (until - at);
  const count = Math.max(1, Math.ceil(text.length * ratio));
  return text.slice(0, count);
}
