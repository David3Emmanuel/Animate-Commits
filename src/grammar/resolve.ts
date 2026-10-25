import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { VSCodeInstall } from '../vscode/locate';

export interface GrammarResolution {
  languageId?: string;
  languageName?: string;
  scopeName?: string;
  grammarPath?: string;
}

interface GrammarContribution {
  language?: string;
  scopeName: string;
  path: string;
  injectTo?: string[];
}

interface LanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
}

interface ManifestShape {
  contributes?: {
    languages?: LanguageContribution[];
    grammars?: GrammarContribution[];
  };
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export class GrammarRegistry {
  private readonly languages: LanguageContribution[] = [];
  private readonly grammars = new Map<string, string>();
  private readonly grammarByLanguage = new Map<string, string>();
  private readonly scopeByGrammarPath = new Map<string, string>();
  private readonly fileNameMatchers: Array<{ regex: RegExp; languageId: string }> = [];
  private readonly extensionMap = new Map<string, string>();
  private readonly languageById = new Map<string, LanguageContribution>();
  private scanned = false;

  constructor(
    private readonly install?: Pick<VSCodeInstall, 'extensionsDir'>,
    private readonly userExtensionsDir?: string,
  ) {}

  private scan(): void {
    if (this.scanned) return;
    this.scanned = true;
    const roots = new Set<string>();
    if (this.install) roots.add(this.install.extensionsDir);
    if (this.userExtensionsDir) roots.add(this.userExtensionsDir);

    for (const root of roots) {
      if (!existsSync(root)) continue;
      let entries: string[] = [];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const extensionRoot = join(root, entry);
        const manifestPath = join(extensionRoot, 'package.json');
        if (!existsSync(manifestPath)) continue;
        let manifest: ManifestShape;
        try {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestShape;
        } catch {
          continue;
        }
        for (const language of manifest.contributes?.languages ?? []) {
          if (!language?.id) continue;
          this.languageById.set(language.id, language);
          this.languages.push(language);
          for (const extension of language.extensions ?? []) {
            const key = extension.toLowerCase();
            if (!this.extensionMap.has(key)) this.extensionMap.set(key, language.id);
          }
          for (const filename of language.filenames ?? []) {
            this.fileNameMatchers.push({
              regex: new RegExp(`^${filename.replace(/[.+^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
              languageId: language.id,
            });
          }
          for (const pattern of language.filenamePatterns ?? []) {
            try {
              this.fileNameMatchers.push({ regex: wildcardToRegExp(pattern), languageId: language.id });
            } catch {
              // Ignore patterns we cannot translate.
            }
          }
        }
        for (const grammar of manifest.contributes?.grammars ?? []) {
          if (!grammar?.scopeName || !grammar.path) continue;
          const grammarPath = resolve(extensionRoot, grammar.path);
          this.grammars.set(grammar.scopeName, grammarPath);
          this.scopeByGrammarPath.set(grammarPath, grammar.scopeName);
          if (grammar.language && !this.grammarByLanguage.has(grammar.language)) {
            this.grammarByLanguage.set(grammar.language, grammarPath);
          }
        }
      }
    }
  }

  resolveLanguage(path: string): string | undefined {
    this.scan();
    const fileName = path.split('/').pop() ?? path;
    const lower = fileName.toLowerCase();
    for (const matcher of this.fileNameMatchers) {
      if (matcher.regex.test(fileName)) return matcher.languageId;
    }
    const lowerPath = path.toLowerCase();
    let best: { extension: string; languageId: string } | undefined;
    for (const [extension, languageId] of this.extensionMap) {
      if (lower.endsWith(extension) || lowerPath.endsWith(extension)) {
        if (!best || extension.length > best.extension.length) {
          best = { extension, languageId };
        }
      }
    }
    return best?.languageId ?? this.extensionMap.get(extname(lower));
  }

  resolve(path: string): GrammarResolution {
    this.scan();
    const languageId = this.resolveLanguage(path);
    if (!languageId) return {};
    const language = this.languageById.get(languageId);
    const grammarPath = this.grammarByLanguage.get(languageId);
    const scopeName = grammarPath ? this.scopeByGrammarPath.get(grammarPath) : undefined;
    return {
      languageId,
      languageName: language?.aliases?.[0] ?? languageId,
      ...(scopeName ? { scopeName } : {}),
      ...(grammarPath ? { grammarPath } : {}),
    };
  }

  grammarPathForScope(scopeName: string): string | undefined {
    this.scan();
    return this.grammars.get(scopeName);
  }

  listScopes(): string[] {
    this.scan();
    return [...this.grammars.keys()];
  }

  languageIds(): string[] {
    this.scan();
    return this.languages.map((language) => language.id);
  }
}
