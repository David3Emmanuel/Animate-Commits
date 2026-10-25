import { leadingWhitespace, lineBlocks, lineSpanChange, type LineBlock } from '../diff/lines';
import type { CursorPosition, SelectionRange } from './types';

export interface PlannedEdit {
  line: number;
  col: number;
  deleteText?: string;
  insertText?: string;
  cursorAfter: CursorPosition;
  selectionBefore?: SelectionRange;
}

export type BlockKind = 'insert' | 'delete' | 'replace';

export interface EditBlockPlan {
  /** Line to scroll into view before editing. */
  scrollLine: number;
  kind: BlockKind;
  edits: PlannedEdit[];
}

export interface PlanOptions {
  /** Replace whole lines above this many changed characters instead of editing a span. */
  wholeLineThreshold?: number;
}

export function positionAfter(edit: PlannedEdit): CursorPosition {
  return edit.cursorAfter;
}

export function selectionForDelete(start: CursorPosition, text: string): SelectionRange | undefined {
  if (!text) return undefined;
  const parts = text.split('\n');
  const end: CursorPosition =
    parts.length === 1
      ? { line: start.line, col: start.col + text.length }
      : { line: start.line + parts.length - 1, col: parts[parts.length - 1]!.length };
  return { anchor: start, active: end };
}

/** Apply one planned edit to a line array, returning the new lines. */
export function applyEdit(
  lines: string[],
  line: number,
  col: number,
  deleteText: string,
  insertText: string,
): string[] {
  const out = [...lines];
  if (deleteText) {
    const parts = deleteText.split('\n');
    const endLine = line + parts.length - 1;
    const endCol = parts.length === 1 ? col + deleteText.length : parts[parts.length - 1]!.length;
    const first = (out[line] ?? '').slice(0, col);
    const last = (out[endLine] ?? '').slice(endCol);
    out.splice(line, endLine - line + 1, first + last);
  }
  if (insertText) {
    const parts = insertText.split('\n');
    const target = out[line] ?? '';
    if (parts.length === 1) {
      out[line] = target.slice(0, col) + parts[0]! + target.slice(col);
    } else {
      const merged = target.slice(0, col) + parts[0]!;
      const tail = parts[parts.length - 1]! + target.slice(col);
      out.splice(line, 1, merged, ...parts.slice(1, -1), tail);
    }
  }
  return out;
}

function cursorAfterInsert(line: number, col: number, text: string): CursorPosition {
  const parts = text.split('\n');
  if (parts.length === 1) return { line, col: col + text.length };
  return { line: line + parts.length - 1, col: parts[parts.length - 1]!.length };
}

function pushInsert(
  lines: string[],
  line: number,
  col: number,
  text: string,
  edits: PlannedEdit[],
): string[] {
  if (!text) return lines;
  const cursorAfter = cursorAfterInsert(line, col, text);
  edits.push({ line, col, insertText: text, cursorAfter });
  return applyEdit(lines, line, col, '', text);
}

function insertLines(
  lines: string[],
  start: number,
  inserted: string[],
  edits: PlannedEdit[],
): string[] {
  let working = lines;
  if (inserted.length === 0) return working;

  // Empty file: the only line is the empty string; type directly on it.
  if (working.length === 1 && working[0] === '' && start === 1) {
    working = pushInsert(working, 0, 0, inserted[0]!, edits);
    for (let i = 1; i < inserted.length; i++) {
      const last = working.length - 1;
      working = pushInsert(working, last, working[last]!.length, '\n', edits);
      working = pushInsert(working, working.length - 1, 0, inserted[i]!, edits);
    }
    return working;
  }

  if (start < working.length) {
    for (let i = 0; i < inserted.length; i++) {
      const line = start + i;
      working = pushInsert(working, line, 0, inserted[i]!, edits);
      // The newline goes after the just-typed text and pushes the old content
      // down, leaving the cursor on a fresh line in front of it.
      working = pushInsert(working, line, inserted[i]!.length, '\n', edits);
    }
    return working;
  }

  for (let i = 0; i < inserted.length; i++) {
    const last = working.length - 1;
    working = pushInsert(working, last, working[last]!.length, '\n', edits);
    working = pushInsert(working, working.length - 1, 0, inserted[i]!, edits);
  }
  return working;
}

function deleteLines(
  lines: string[],
  start: number,
  count: number,
  edits: PlannedEdit[],
): string[] {
  if (count <= 0) return lines;
  let working = lines;
  if (start + count < working.length) {
    const deleted = working.slice(start, start + count);
    const text = deleted.join('\n') + '\n';
    const cursor: CursorPosition = { line: start, col: 0 };
    edits.push({
      line: start,
      col: 0,
      deleteText: text,
      cursorAfter: cursor,
      selectionBefore: selectionForDelete({ line: start, col: 0 }, text),
    });
    working = applyEdit(working, start, 0, text, '');
    return working;
  }

  if (start > 0) {
    const previous = working[start - 1]!;
    const text = '\n' + working.slice(start).join('\n');
    const cursor: CursorPosition = { line: start - 1, col: previous.length };
    edits.push({
      line: start - 1,
      col: previous.length,
      deleteText: text,
      cursorAfter: cursor,
      selectionBefore: selectionForDelete({ line: start - 1, col: previous.length }, text),
    });
    working = applyEdit(working, start - 1, previous.length, text, '');
    return working;
  }

  const text = working.join('\n');
  if (!text) return working;
  const cursor: CursorPosition = { line: 0, col: 0 };
  edits.push({
    line: 0,
    col: 0,
    deleteText: text,
    cursorAfter: cursor,
    selectionBefore: selectionForDelete({ line: 0, col: 0 }, text),
  });
  return applyEdit(working, 0, 0, text, '');
}

function replaceLines(
  lines: string[],
  start: number,
  block: LineBlock,
  edits: PlannedEdit[],
  options: PlanOptions,
): string[] {
  let working = lines;
  const threshold = options.wholeLineThreshold ?? 120;

  for (let i = 0; i < block.oldLines.length; i++) {
    const line = start + i;
    const oldLine = working[line] ?? '';
    const newLine = block.newLines[i]!;
    const span = lineSpanChange(oldLine, newLine);
    if (!span) continue;

    const wholeLine = span.oldText.length + span.newText.length > threshold;
    if (wholeLine && oldLine.length > 0) {
      const cursor: CursorPosition = { line, col: 0 };
      edits.push({
        line,
        col: 0,
        deleteText: oldLine,
        cursorAfter: cursor,
        selectionBefore: selectionForDelete({ line, col: 0 }, oldLine),
      });
      working = applyEdit(working, line, 0, oldLine, '');
      working = pushInsert(working, line, 0, newLine, edits);
      continue;
    }

    if (span.oldText) {
      const cursor: CursorPosition = { line, col: span.col };
      edits.push({
        line,
        col: span.col,
        deleteText: span.oldText,
        cursorAfter: cursor,
        selectionBefore: selectionForDelete({ line, col: span.col }, span.oldText),
      });
      working = applyEdit(working, line, span.col, span.oldText, '');
    }
    if (span.newText) {
      working = pushInsert(working, line, span.col, span.newText, edits);
    }
  }
  return working;
}

/**
 * Turn two revisions of a file into explicit cursor edits. The result is
 * verified against the target text; an inconsistent plan is a bug, not a
 * rendering problem.
 */
export function planFileEdits(
  oldLines: string[],
  newLines: string[],
  options: PlanOptions = {},
): EditBlockPlan[] {
  const plans: EditBlockPlan[] = [];
  let working = [...oldLines];
  let shift = 0;

  for (const block of lineBlocks(oldLines, newLines)) {
    const liveStart = block.oldStart + shift;
    const edits: PlannedEdit[] = [];
    const plan: EditBlockPlan = {
      scrollLine: Math.max(0, Math.min(liveStart, working.length - 1)),
      kind: block.oldLines.length === 0 ? 'insert' : block.newLines.length === 0 ? 'delete' : 'replace',
      edits,
    };

    if (block.oldLines.length === 0) {
      working = insertLines(working, liveStart, block.newLines, edits);
    } else if (block.newLines.length === 0) {
      working = deleteLines(working, liveStart, block.oldLines.length, edits);
    } else if (block.oldLines.length === block.newLines.length) {
      working = replaceLines(working, liveStart, block, edits, options);
    } else {
      working = deleteLines(working, liveStart, block.oldLines.length, edits);
      working = insertLines(working, liveStart, block.newLines, edits);
    }

    shift += block.newLines.length - block.oldLines.length;
    plans.push(plan);
  }

  const actual = working.join('\n');
  const expected = newLines.join('\n');
  if (actual !== expected) {
    let index = 0;
    while (index < actual.length && index < expected.length && actual[index] === expected[index]) {
      index++;
    }
    throw new Error(
      `Edit planning diverged at character ${index}: expected ${JSON.stringify(
        expected.slice(index, index + 40),
      )} but produced ${JSON.stringify(actual.slice(index, index + 40))}.`,
    );
  }
  return plans;
}

/** Split text into indentation and the content typed after it. */
export function splitIndentText(text: string): { indent: string; content: string } {
  const indent = leadingWhitespace(text);
  return { indent, content: text.slice(indent.length) };
}
