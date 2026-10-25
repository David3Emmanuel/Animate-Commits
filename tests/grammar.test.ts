import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrammarRegistry } from '../src/grammar/resolve';

function makeExtension(root: string): void {
  const extension = join(root, 'language-pack');
  mkdirSync(join(extension, 'syntaxes'), { recursive: true });
  writeFileSync(
    join(extension, 'package.json'),
    JSON.stringify({
      contributes: {
        languages: [
          { id: 'typescript', aliases: ['TypeScript'], extensions: ['.ts', '.mts'] },
          { id: 'typescriptreact', aliases: ['TypeScript JSX'], extensions: ['.tsx'] },
          { id: 'makefile', aliases: ['Makefile'], filenames: ['Makefile'] },
        ],
        grammars: [
          { language: 'typescript', scopeName: 'source.ts', path: './syntaxes/ts.json' },
          { language: 'typescriptreact', scopeName: 'source.tsx', path: './syntaxes/tsx.json' },
          { scopeName: 'source.makefile', path: './syntaxes/make.json' },
        ],
      },
    }),
  );
  writeFileSync(join(extension, 'syntaxes', 'ts.json'), '{}');
  writeFileSync(join(extension, 'syntaxes', 'tsx.json'), '{}');
  writeFileSync(join(extension, 'syntaxes', 'make.json'), '{}');
}

describe('grammar resolution', () => {
  it('maps file paths to languages and scope names', () => {
    const root = mkdtempSync(join(tmpdir(), 'animate-commits-grammar-'));
    makeExtension(root);
    const registry = new GrammarRegistry({ extensionsDir: root });
    expect(registry.resolve('src/app.ts')).toEqual(
      expect.objectContaining({ languageId: 'typescript', scopeName: 'source.ts' }),
    );
    expect(registry.resolve('src/App.tsx')).toEqual(
      expect.objectContaining({ languageId: 'typescriptreact', scopeName: 'source.tsx' }),
    );
    expect(registry.resolve('Makefile')).toEqual(
      expect.objectContaining({ languageId: 'makefile' }),
    );
    // A grammar without a language contribution still resolves by scope.
    expect(registry.grammarPathForScope('source.makefile')).toContain('make.json');
    expect(registry.resolve('notes.unknown').scopeName).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });
});
