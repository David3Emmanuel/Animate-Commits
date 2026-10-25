import type { RenderState } from './state';
import { activeDoc, activeOverlays } from './state';
import { progressiveText } from './dom';

/** Cursor blink state, derived from scene time only. */
export function isCursorVisible(state: RenderState): boolean {
  const age = state.time - state.lastCursorActivity;
  return age < 450 || Math.floor((age - 450) / 530) % 2 === 0;
}

/**
 * A compact fingerprint of everything the renderer shows. The exporter skips
 * the screenshot when this is unchanged, which saves most of the capture cost
 * during holds, pauses between hunks, and frames with no new keystroke.
 */
export function frameSignature(state: RenderState, editorHeight = 0): string {
  const doc = activeDoc(state);
  const overlays = activeOverlays(state);
  const parts: string[] = [
    String(editorHeight),
    state.activeTab ?? '',
    state.tabs.join('\u0001'),
    state.previewTab ?? '',
    state.tabs.map((path) => (state.docs.get(path)?.dirty ? '1' : '0')).join(''),
    state.sidebar ?? '',
    String(state.treeVersion),
    state.scm
      .map((entry) => `${entry.path}:${entry.status}:${entry.staged ? 1 : 0}`)
      .join('\u0001'),
    state.scmMessage
      ? progressiveText(state.scmMessage.text, state.scmMessage.at, state.scmMessage.until, state.time)
      : '',
    isCursorVisible(state) ? '1' : '0',
  ];

  if (doc) {
    parts.push(
      doc.path,
      String(doc.version),
      `${doc.cursor.line}:${doc.cursor.col}`,
      String(doc.scrollLine),
      doc.dirty ? '1' : '0',
    );
    if (doc.selection) {
      parts.push(
        [
          doc.selection.anchor.line,
          doc.selection.anchor.col,
          doc.selection.active.line,
          doc.selection.active.col,
        ].join(':'),
      );
    }
  }

  if (overlays.quickopen) {
    parts.push(
      'quickopen',
      overlays.quickopen.action,
      progressiveText(
        overlays.quickopen.text,
        overlays.quickopen.t,
        overlays.quickopen.until ?? overlays.quickopen.t,
        state.time,
      ),
    );
  }
  if (overlays.contextmenu) {
    parts.push(
      'contextmenu',
      overlays.contextmenu.target,
      String(overlays.contextmenu.select),
      overlays.contextmenu.items.join('\u0001'),
    );
  }
  if (overlays.dialog) {
    parts.push(
      'dialog',
      overlays.dialog.title,
      overlays.dialog.message,
      overlays.dialog.buttons.join('\u0001'),
      String(overlays.dialog.select),
    );
  }
  if (overlays.toast) {
    parts.push('toast', overlays.toast.text, overlays.toast.source ?? '');
  }
  if (overlays.rename) {
    parts.push('rename', overlays.rename.from, overlays.rename.to, overlays.rename.via);
  }

  return parts.join('\u0002');
}
