function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pick the first visible line so the requested scroll position is honoured but
 * the cursor never leaves the viewport (with a small margin) while typing.
 */
export function fitTopLine(
  requestedLine: number,
  cursorLine: number,
  totalLines: number,
  visibleCount: number,
): number {
  const maxTop = Math.max(0, totalLines - visibleCount);
  let top = clamp(requestedLine - Math.floor(visibleCount / 3), 0, maxTop);
  const margin = Math.min(3, Math.max(1, Math.floor(visibleCount / 4)));
  if (cursorLine < top + margin) {
    top = Math.max(0, Math.min(cursorLine - margin, maxTop));
  } else if (cursorLine > top + visibleCount - margin - 1) {
    top = Math.min(maxTop, cursorLine - visibleCount + margin + 1);
  }
  return clamp(top, 0, maxTop);
}
