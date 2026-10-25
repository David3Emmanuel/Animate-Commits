import { Command } from 'commander';
import {
  addSceneOptions,
  defaultOutputPath,
  parseSize,
  prepareScene,
  writeSceneDump,
  type SceneCliOptions,
} from './common';
import { findRendererDir } from '../server/assets';
import { renderScene } from '../export/video';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface RenderOptions extends SceneCliOptions {
  out?: string;
  fps?: string;
  size?: string;
  scale?: string;
  frames?: string;
  ffmpeg?: string;
  browserExe?: string;
  dumpScene?: string;
  captureAll?: boolean;
}

export function registerRenderCommand(program: Command): void {
  const command = program
    .command('render <repo>')
    .description('Animate a commit or range and export an MP4 (or PNG frames).')
    .option('--out <file>', 'output MP4 path')
    .option('--fps <n>', 'frames per second', '20')
    .option('--size <WxH>', 'window size in CSS pixels', '1280x800')
    .option('--scale <n>', 'device pixel ratio for the capture', '1')
    .option('--frames <dir>', 'write PNG frames instead of an MP4')
    .option('--ffmpeg <path>', 'path to the ffmpeg executable')
    .option('--browser-exe <path>', 'path to a Chromium-based browser')
    .option('--capture-all', 'capture every frame even when nothing changed (debugging)')
    .option('--dump-scene <file>', 'write the generated scene JSON for debugging');
  addSceneOptions(command);

  command.action(async (repo: string, options: RenderOptions) => {
    const fps = Number(options.fps ?? 20);
    if (!Number.isFinite(fps) || fps < 1 || fps > 120) {
      throw new Error('--fps must be between 1 and 120.');
    }
    const scale = Number(options.scale ?? 1);
    if (!Number.isFinite(scale) || scale < 1 || scale > 3) {
      throw new Error('--scale must be between 1 and 3.');
    }
    const size = parseSize(options.size ?? '1280x800');

    const prepared = await prepareScene(repo, options, {
      width: size.width,
      height: size.height,
      dpr: scale,
    });

    if (options.dumpScene) {
      writeSceneDump(prepared.scene, options.dumpScene);
      console.error(`[scene] wrote ${options.dumpScene}`);
    }

    const outPath = options.out ?? defaultOutputPath(prepared);
    if (!options.frames) mkdirSync(dirname(outPath), { recursive: true });

    const controller = new AbortController();
    const onSignal = (): void => {
      console.error('\n[render] cancelling…');
      controller.abort();
    };
    process.once('SIGINT', onSignal);

    try {
      await renderScene({
        scene: prepared.scene,
        rendererDir: findRendererDir(),
        grammars: prepared.grammars,
        outPath,
        fps,
        width: size.width,
        height: size.height,
        dpr: scale,
        ...(options.frames ? { framesDir: options.frames } : {}),
        ...(options.browserExe ? { browserExe: options.browserExe } : {}),
        ...(options.ffmpeg ? { ffmpegPath: options.ffmpeg } : {}),
        dedupe: !options.captureAll,
        signal: controller.signal,
      });
    } finally {
      process.off('SIGINT', onSignal);
    }

    if (!options.frames) {
      console.log(`Rendered ${outPath}`);
    } else {
      console.log(`Rendered frames to ${options.frames}`);
    }
  });
}
