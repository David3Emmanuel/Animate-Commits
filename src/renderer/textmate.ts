import * as vsctm from 'vscode-textmate';
import * as onig from 'vscode-oniguruma';
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';
import type { TokenColorRule } from '../theme/resolve';

export interface TokenSpan {
  start: number;
  end: number;
  color?: string;
  background?: string;
  fontStyle: number;
}

export interface HighlightedLine {
  spans: TokenSpan[];
}

interface CachedFile {
  text: string;
  scope: string;
  lines: HighlightedLine[];
}

const FONT_ITALIC = 1;
const FONT_BOLD = 2;
const FONT_UNDERLINE = 4;
const FONT_STRIKETHROUGH = 8;

export function fontStyleClass(fontStyle: number): string {
  const classes: string[] = [];
  if (fontStyle & FONT_ITALIC) classes.push('italic');
  if (fontStyle & FONT_BOLD) classes.push('bold');
  if (fontStyle & FONT_UNDERLINE) classes.push('underline');
  if (fontStyle & FONT_STRIKETHROUGH) classes.push('strikethrough');
  return classes.join(' ');
}

function createOnigLib() {
  return {
    createOnigScanner: (patterns: string[]) => new onig.OnigScanner(patterns),
    createOnigString: (text: string) => new onig.OnigString(text),
  };
}

export class Highlighter {
  private registry: vsctm.Registry | undefined;
  private colorMap: string[] = [];
  private readonly grammars = new Map<string, vsctm.IGrammar | null>();
  private readonly cache = new Map<string, CachedFile>();
  private defaultForeground = '#CCCCCC';

  constructor(
    private readonly theme: { name: string; tokenColors: TokenColorRule[]; foreground: string; background: string },
  ) {}

  async initialize(scopes: string[]): Promise<void> {
    try {
      const response = await fetch(onigWasmUrl);
      const wasm = await response.arrayBuffer();
      await onig.loadWASM(wasm);
    } catch (error) {
      console.warn('TextMate wasm failed to load; falling back to plain text.', error);
      return;
    }

    this.registry = new vsctm.Registry({
      onigLib: Promise.resolve(createOnigLib()),
      loadGrammar: async (scopeName) => {
        try {
          const response = await fetch(`/api/grammar?scope=${encodeURIComponent(scopeName)}`);
          if (!response.ok) return null;
          const text = await response.text();
          return vsctm.parseRawGrammar(text, `${scopeName}.json`);
        } catch {
          return null;
        }
      },
    });

    const rules = this.theme.tokenColors
      .filter((rule) => rule.settings)
      .map((rule) => ({
        ...(rule.name ? { name: rule.name } : {}),
        ...(rule.scope !== undefined ? { scope: rule.scope } : {}),
        settings: rule.settings!,
      }));
    const hasDefault = rules.some(
      (rule) => !rule.scope || (Array.isArray(rule.scope) ? rule.scope.includes('') : rule.scope === ''),
    );
    if (!hasDefault) {
      rules.push({ scope: '', settings: { foreground: this.theme.foreground, background: this.theme.background } });
    }
    this.registry.setTheme({ name: this.theme.name, settings: rules });
    this.colorMap = this.registry.getColorMap();
    this.defaultForeground = this.theme.foreground;
    if (this.colorMap[0]) this.defaultForeground = this.colorMap[0]!;

    const unique = [...new Set(scopes.filter(Boolean))];
    await Promise.all(
      unique.map(async (scope) => {
        try {
          const grammar = await this.registry!.loadGrammar(scope);
          this.grammars.set(scope, grammar);
        } catch (error) {
          console.warn(`Grammar failed to load for ${scope}`, error);
          this.grammars.set(scope, null);
        }
      }),
    );
  }

  highlight(path: string, scopeName: string | undefined, text: string): HighlightedLine[] | undefined {
    if (!this.registry || !scopeName) return undefined;
    const cached = this.cache.get(path);
    if (cached && cached.text === text && cached.scope === scopeName) return cached.lines;

    let grammar = this.grammars.get(scopeName);
    if (grammar === undefined) {
      // A scope introduced by a renamed file may not have been preloaded.
      this.grammars.set(scopeName, null);
      grammar = null;
    }
    if (!grammar) return undefined;

    const lines = text.split('\n');
    const result: HighlightedLine[] = [];
    let ruleStack: vsctm.StateStack | null = null;
    try {
      for (const line of lines) {
        const tokenized = grammar.tokenizeLine2(line, ruleStack);
        ruleStack = tokenized.ruleStack;
        const binary = tokenized.tokens;
        const spans: TokenSpan[] = [];
        for (let index = 0; index < binary.length; index += 2) {
          const start = binary[index]!;
          const meta = binary[index + 1]!;
          const end = index + 2 < binary.length ? binary[index + 2]! : line.length;
          if (start >= line.length && line.length > 0) continue;
          const foregroundId = (meta & 0xff8000) >>> 15;
          const backgroundId = (meta & 0xff000000) >>> 24;
          const fontStyle = (meta & 0x7800) >>> 11;
          spans.push({
            start: Math.min(start, line.length),
            end: Math.min(end, line.length),
            ...(foregroundId ? { color: this.colorMap[foregroundId] } : {}),
            ...(backgroundId ? { background: this.colorMap[backgroundId] } : {}),
            fontStyle,
          });
        }
        result.push({ spans });
      }
    } catch (error) {
      console.warn(`Tokenization failed for ${path}`, error);
      return undefined;
    }

    this.cache.set(path, { text, scope: scopeName, lines: result });
    return result;
  }

  forget(path: string): void {
    this.cache.delete(path);
  }
}
