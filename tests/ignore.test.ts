import { matchesIgnore } from '../src/scene/ignore';

describe('--ignore matching', () => {
  it('matches bare names at any depth and globs with directories', () => {
    const patterns = ['pnpm-lock.yaml', '*.lock', 'dist/**', 'docs/generated/*'];
    expect(matchesIgnore('pnpm-lock.yaml', patterns)).toBe(true);
    expect(matchesIgnore('nested/pnpm-lock.yaml', patterns)).toBe(true);
    expect(matchesIgnore('package-lock.lock', patterns)).toBe(true);
    expect(matchesIgnore('dist/app.js', patterns)).toBe(true);
    expect(matchesIgnore('dist/nested/app.js', patterns)).toBe(true);
    expect(matchesIgnore('docs/generated/api.md', patterns)).toBe(true);
    expect(matchesIgnore('src/index.ts', patterns)).toBe(false);
    expect(matchesIgnore('docs/readme.md', patterns)).toBe(false);
  });

  it('is case-insensitive like VS Code path matching', () => {
    expect(matchesIgnore('PNPM-LOCK.YAML', ['pnpm-lock.yaml'])).toBe(true);
    expect(matchesIgnore('src/Schema.Graphql', ['*.graphql'])).toBe(true);
  });
});
