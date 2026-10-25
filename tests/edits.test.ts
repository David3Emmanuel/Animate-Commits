import { applyEdit, planFileEdits } from '../src/scene/edits';
import { splitLines } from '../src/diff/lines';

function replay(oldText: string, newText: string): string[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const plans = planFileEdits(oldLines, newLines);
  let lines = [...oldLines];
  for (const plan of plans) {
    for (const edit of plan.edits) {
      lines = applyEdit(lines, edit.line, edit.col, edit.deleteText ?? '', edit.insertText ?? '');
    }
  }
  expect(lines.join('\n')).toBe(newLines.join('\n'));
  return lines;
}

describe('diff-to-edit planning', () => {
  const cases: Array<[string, string, string]> = [
    ['append a line', 'one\ntwo\n', 'one\ntwo\nthree\n'],
    ['append without trailing newline', 'one\ntwo', 'one\ntwo\nthree'],
    ['append a blank line', 'one\n', 'one\n\n'],
    ['append the first trailing newline', 'one\ntwo', 'one\ntwo\n'],
    ['insert at the start', 'two\n', 'one\ntwo\n'],
    ['insert in the middle', 'one\nthree\n', 'one\ntwo\nthree\n'],
    ['delete a middle line', 'one\ntwo\nthree\n', 'one\nthree\n'],
    ['delete the last line', 'one\ntwo\n', 'one\n'],
    ['delete the trailing newline', 'one\ntwo\n', 'one\ntwo'],
    ['modify a word', 'const  value = 1;\n', 'const value = 2;\n'],
    ['replace two lines with three', 'a\nb\nc\n', 'a\nx\ny\nz\nc\n'],
    ['create a file', '', 'hello\nworld\n'],
    ['empty a file', 'hello\nworld\n', ''],
    ['no change', 'same\ntext\n', 'same\ntext\n'],
    ['indented block', 'function f() {\n  return 1;\n}\n', 'function f() {\n  // note\n  const x = 2;\n  return x;\n}\n'],
    ['windows newlines are normalized before planning', 'a\r\nb\r\n', 'a\r\nc\r\n'],
  ];

  for (const [name, oldText, newText] of cases) {
    it(`handles: ${name}`, () => {
      replay(oldText.replace(/\r\n/g, '\n'), newText.replace(/\r\n/g, '\n'));
    });
  }

  it('marks the block kinds', () => {
    const plans = planFileEdits(['a', 'b', 'c'], ['a', 'x', 'y', 'z', 'c']);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.kind).toBe('replace');
    expect(plans[0]?.scrollLine).toBe(1);
  });

  it('produces a selection for deleted text', () => {
    const plans = planFileEdits(['a', 'b', 'c'], ['a', 'c']);
    const edit = plans[0]?.edits[0];
    expect(edit?.deleteText).toBe('b\n');
    expect(edit?.selectionBefore?.anchor).toEqual({ line: 1, col: 0 });
    expect(edit?.selectionBefore?.active).toEqual({ line: 2, col: 0 });
  });
});
