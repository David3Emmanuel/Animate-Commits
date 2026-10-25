import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

/** Parse VS Code JSON/JSONC (comments and trailing commas are welcome). */
export function parseJsonc<T>(text: string, source: string): T {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: true,
  }) as T;
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(
      `${source}: ${printParseErrorCode(first.error)} at offset ${first.offset}`,
    );
  }
  return value;
}
