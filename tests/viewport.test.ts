import { fitTopLine } from '../src/renderer/viewport';

describe('editor scroll follow', () => {
  it('centres a requested jump while the cursor is visible', () => {
    expect(fitTopLine(60, 60, 200, 30)).toBe(50);
  });

  it('follows the cursor when typing moves below the viewport', () => {
    const visible = 20;
    const top = fitTopLine(0, 40, 200, visible);
    expect(top).toBe(40 - visible + 4);
    expect(40).toBeGreaterThanOrEqual(top);
    expect(40).toBeLessThan(top + visible);
  });

  it('follows the cursor when it moves above the viewport', () => {
    const top = fitTopLine(100, 20, 200, 20);
    expect(top).toBeLessThanOrEqual(20);
    expect(20).toBeLessThan(top + 20);
  });

  it('never scrolls past the end or before the first line', () => {
    expect(fitTopLine(0, 0, 5, 20)).toBe(0);
    expect(fitTopLine(200, 199, 200, 20)).toBe(180);
    expect(fitTopLine(0, 199, 200, 20)).toBe(180);
    expect(fitTopLine(0, 0, 0, 20)).toBe(0);
  });
});
