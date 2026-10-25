import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly code: number | string | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export function exec(
  file: string,
  args: string[],
  options: { cwd?: string; input?: string; maxBuffer?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new CommandError(
              `${file} ${args.join(' ')} failed: ${error.message}`,
              `${file} ${args.join(' ')}`,
              error.code ?? null,
              stderr?.toString() ?? '',
            ),
          );
          return;
        }
        resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      },
    );
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await exec(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}
