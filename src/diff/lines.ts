import { diffArrays } from 'diff';

export interface LineBlock {
  /** 0-based index in the old document where this change starts. */
  oldStart: number;
  oldLines: string[];
  newLines: string[];
}

export function splitLines(text: string): string[] {
  return text.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}

export function lineBlocks(oldLines: string[], newLines: string[]): LineBlock[] {
  const changes = diffArrays(oldLines, newLines);
  const blocks: LineBlock[] = [];
  let oldIndex = 0;
  let current: LineBlock | undefined;

  const flush = (): void => {
    if (current) {
      blocks.push(current);
      current = undefined;
    }
  };

  for (const part of changes) {
    if (part.added || part.removed) {
      if (!current) {
        current = { oldStart: oldIndex, oldLines: [], newLines: [] };
      }
      if (part.removed) {
        current.oldLines.push(...part.value);
        oldIndex += part.value.length;
      } else {
        current.newLines.push(...part.value);
      }
    } else {
      flush();
      oldIndex += part.value.length;
    }
  }
  flush();
  return blocks;
}

export interface LineSpanChange {
  /** Column where the changed span starts. */
  col: number;
  oldText: string;
  newText: string;
}

/** Minimal contiguous replacement between two versions of a line. */
export function lineSpanChange(oldLine: string, newLine: string): LineSpanChange | undefined {
  if (oldLine === newLine) return undefined;
  let start = 0;
  const max = Math.min(oldLine.length, newLine.length);
  while (start < max && oldLine[start] === newLine[start]) start++;

  let oldEnd = oldLine.length;
  let newEnd = newLine.length;
  while (oldEnd > start && newEnd > start && oldLine[oldEnd - 1] === newLine[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    col: start,
    oldText: oldLine.slice(start, oldEnd),
    newText: newLine.slice(start, newEnd),
  };
}

export function leadingWhitespace(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : '';
}
