import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { Scene } from '../scene/types';
import type { GrammarRegistry } from '../grammar/resolve';
import { findBrowser } from './browser';
import { startSceneServer } from '../server/serve';
import { startFfmpeg, writeToStream, type FfmpegEncoder } from './ffmpeg';

export interface RenderSceneOptions {
  scene: Scene;
  rendererDir: string;
  grammars: GrammarRegistry;
  outPath: string;
  fps: number;
  width: number;
  height: number;
  dpr: number;
  framesDir?: string;
  browserExe?: string;
  ffmpegPath?: string;
  /** Reuse the previous capture when the visible state is unchanged. */
  dedupe?: boolean;
  signal?: AbortSignal;
  onProgress?: (frame: number, total: number) => void;
}

function formatEta(startedAt: number, done: number, total: number): string {
  if (done <= 0) return '—';
  const elapsed = Date.now() - startedAt;
  const remaining = (elapsed / done) * (total - done);
  return `${Math.ceil(remaining / 1000)}s`;
}

export async function renderScene(options: RenderSceneOptions): Promise<void> {
  const browserPath = findBrowser(options.browserExe);
  if (!browserPath) {
    throw new Error(
      'No Chrome/Edge/Chromium browser found. Install one, pass --browser-exe <path>, or run `pnpm exec playwright install chromium`.',
    );
  }

  const server = await startSceneServer({
    scene: options.scene,
    rendererDir: options.rendererDir,
    grammars: options.grammars,
  });

  let browser: Browser | undefined;
  let encoder: FfmpegEncoder | undefined;
  try {
    browser = await chromium.launch({
      executablePath: browserPath.path,
      headless: true,
      args: [
        '--force-color-profile=srgb',
        '--disable-lcd-text',
        '--hide-scrollbars',
        '--disable-gpu-vsync',
      ],
    });
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.dpr,
    });
    const page: Page = await context.newPage();
    page.on('pageerror', (error) => console.error('[renderer]', error.message));
    await page.goto(`${server.url}?capture=1`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => (window as { __ready?: boolean }).__ready === true || (window as { __error?: string }).__error,
      { timeout: 60_000 },
    );
    const pageError = await page.evaluate(
      () => (window as { __error?: string }).__error ?? null,
    );
    if (pageError) throw new Error(`Renderer failed: ${pageError}`);
    await page.evaluate(() => document.fonts.ready);

    if (options.framesDir) {
      mkdirSync(options.framesDir, { recursive: true });
    } else {
      mkdirSync(dirname(options.outPath), { recursive: true });
      encoder = startFfmpeg({
        outPath: options.outPath,
        fps: options.fps,
        width: options.width * options.dpr,
        height: options.height * options.dpr,
        ...(options.ffmpegPath ? { explicitPath: options.ffmpegPath } : {}),
      });
    }

    const totalFrames = Math.max(1, Math.ceil((options.scene.durationMs / 1000) * options.fps) + 1);
    const startedAt = Date.now();
    let lastSignature = '';
    let lastPng: Buffer | undefined;
    let capturedFrames = 0;
    for (let frame = 0; frame < totalFrames; frame++) {
      if (options.signal?.aborted) throw new Error('Rendering cancelled.');
      const time = Math.min((frame / options.fps) * 1000, Math.max(0, options.scene.durationMs - 1));
      const signature = await page.evaluate((value) => {
        const api = window as { __seek?: (time: number) => string };
        if (!api.__seek) throw new Error('Renderer is not ready.');
        return api.__seek(value);
      }, time);
      let png: Buffer;
      if (options.dedupe !== false && signature && signature === lastSignature && lastPng) {
        png = lastPng;
      } else {
        png = await page.screenshot({ type: 'png' });
        lastPng = png;
        lastSignature = signature;
        capturedFrames++;
      }
      if (options.framesDir) {
        const name = `frame-${String(frame + 1).padStart(5, '0')}.png`;
        writeFileSync(join(options.framesDir, name), png);
      } else if (encoder) {
        await writeToStream(encoder.stdin, png);
      }
      options.onProgress?.(frame + 1, totalFrames);
      if ((frame + 1) % 25 === 0 || frame + 1 === totalFrames) {
        const percent = Math.round(((frame + 1) / totalFrames) * 100);
        console.error(
          `[render] frame ${frame + 1}/${totalFrames} (${percent}%) ETA ${formatEta(startedAt, frame + 1, totalFrames)}`,
        );
      }
    }

    if (options.framesDir) {
      console.error(
        `[render] wrote ${totalFrames} PNG frames (${capturedFrames} captures) to ${options.framesDir}`,
      );
    } else if (encoder) {
      encoder.stdin.end();
      await encoder.done;
      console.error(`[render] captured ${capturedFrames}/${totalFrames} frames`);
    }
  } finally {
    if (encoder) encoder.kill();
    if (browser) await browser.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
