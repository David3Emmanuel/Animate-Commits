import { spawn } from 'node:child_process';
import { findFfmpeg } from '../util/paths';

export interface FfmpegEncoder {
  stdin: NodeJS.WritableStream;
  done: Promise<void>;
  kill: () => void;
  lastError: () => string;
}

export function startFfmpeg(options: {
  outPath: string;
  fps: number;
  width: number;
  height: number;
  explicitPath?: string;
}): FfmpegEncoder {
  const ffmpegPath = findFfmpeg(options.explicitPath);
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg was not found. Install ffmpeg, pass --ffmpeg <path>, or use --frames <dir> to write PNGs.',
    );
  }
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(options.fps),
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-movflags',
    '+faststart',
    options.outPath,
  ];
  const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  const stdin = child.stdin;
  if (!stdin) throw new Error('Could not open a pipe to ffmpeg.');
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8000);
  });

  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}${stderr ? `\n${stderr}` : ''}`));
    });
  });

  return {
    stdin,
    done,
    kill: () => {
      if (!child.killed) child.kill('SIGKILL');
    },
    lastError: () => stderr,
  };
}

export async function writeToStream(
  stream: NodeJS.WritableStream,
  buffer: Buffer,
): Promise<void> {
  if (stream.write(buffer)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = (): void => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (error: Error): void => {
      stream.off('drain', onDrain);
      reject(error);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}
