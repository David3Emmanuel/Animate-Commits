import { formatDuration, shortenPath } from '../src/util/format';

describe('format helpers', () => {
  it('formats durations into minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(61_000)).toBe('1m 1s');
  });

  it('shortens long paths from the end', () => {
    expect(shortenPath('src/app.ts', 20)).toBe('src/app.ts');
    const shortened = shortenPath('C:/projects/very/deep/folder/file.ts', 20);
    expect(shortened.length).toBeLessThanOrEqual(21);
    expect(shortened.endsWith('file.ts')).toBe(true);
  });
});
