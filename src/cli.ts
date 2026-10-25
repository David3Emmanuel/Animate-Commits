#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { runDoctor } from './commands/doctor';
import { registerThemesCommand } from './commands/themes';
import { registerRenderCommand } from './commands/render';
import { registerPreviewCommand } from './commands/preview';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const program = new Command();

program
  .name('animate-commits')
  .description(
    'Animate a git commit — or a range of commits — as if it were being written in VS Code.',
  )
  .version(pkg.version);

program
  .command('doctor')
  .description('Check that git, ffmpeg, a browser, and VS Code can be found.')
  .action(async () => {
    const ok = await runDoctor();
    if (!ok) process.exitCode = 1;
  });

registerThemesCommand(program);
registerRenderCommand(program);
registerPreviewCommand(program);

await program.parseAsync(process.argv);
