import { Command } from 'commander';
import open from 'open';
import { addSceneOptions, prepareScene, type SceneCliOptions } from './common';
import { findRendererDir } from '../server/assets';
import { startSceneServer } from '../server/serve';

interface PreviewOptions extends SceneCliOptions {
  open?: boolean;
}

export function registerPreviewCommand(program: Command): void {
  const command = program
    .command('preview <repo>')
    .description('Serve the animation in a browser with playback controls.')
    .option('--open', 'open the preview in the default browser');
  addSceneOptions(command);

  command.action(async (repo: string, options: PreviewOptions) => {
    const prepared = await prepareScene(repo, options);
    const server = await startSceneServer({
      scene: prepared.scene,
      rendererDir: findRendererDir(),
      grammars: prepared.grammars,
    });

    console.log(`Preview: ${server.url}`);
    console.log('Press Ctrl+C to stop.');
    if (options.open) await open(server.url);

    const stop = (): void => {
      void server.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await new Promise<void>(() => {
      // Keep the process alive until interrupted.
    });
  });
}
