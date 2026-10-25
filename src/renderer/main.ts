import './styles.css';
import '@vscode/codicons/dist/codicon.css';
import type { RendererWindow, Scene } from '../scene/types';
import { buildShell } from './shell';
import { createState, seek } from './state';
import { Highlighter } from './textmate';
import { renderTitlebar } from './titlebar';
import { renderActivityBar } from './activitybar';
import { renderSidebar } from './sidebar';
import { renderEditor } from './editor';
import { renderStatusBar } from './statusbar';
import { renderOverlays } from './overlays';
import { clamp, hexLuminance } from './dom';
import { frameSignature } from './signature';

const browserWindow = window as unknown as RendererWindow & { __error?: string };
const captureMode = new URLSearchParams(window.location.search).get('capture') === '1';

function applyTheme(meta: Scene['meta']): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(meta.colors)) {
    root.style.setProperty(`--vscode-${key.replace(/\./g, '-')}`, value);
  }
  root.style.setProperty('--ui-font', meta.fonts.ui);
  root.style.setProperty('--editor-font', meta.fonts.editor);
  root.style.setProperty('--editor-size', `${meta.fonts.editorSize}px`);
  root.style.setProperty('--line-height', `${meta.fonts.lineHeight}px`);
  root.style.setProperty('--tab-size', String(meta.tabSize));
  root.style.setProperty('--editor-ligatures', meta.fonts.ligatures ? 'common-ligatures' : 'none');
  const light = hexLuminance(meta.colors['editor.background']) > 0.5;
  document.body.className = `platform-${meta.platform} ${light ? 'theme-light' : 'theme-dark'}`;
  document.body.style.background = meta.colors['editor.background'] ?? '#1f1f1f';
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function setupControls(duration: number, seekTo: (time: number) => void): void {
  const controls = document.createElement('div');
  controls.className = 'preview-controls';

  const playButton = document.createElement('button');
  playButton.title = 'Play / pause (space)';
  playButton.textContent = '❚❚';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(duration);
  slider.step = '10';
  slider.value = '0';

  const timeLabel = document.createElement('div');
  timeLabel.className = 'preview-time';

  const speed = document.createElement('select');
  for (const value of [1, 2, 4, 0.5]) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}×`;
    speed.append(option);
  }

  controls.append(playButton, slider, timeLabel, speed);
  document.body.append(controls);

  let playing = true;
  let rate = 1;
  let time = 0;
  let originTime = 0;
  let originPerf = performance.now();

  const updateLabel = (): void => {
    timeLabel.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
    slider.value = String(Math.round(time));
    playButton.textContent = playing ? '❚❚' : '▶';
  };

  const pause = (): void => {
    if (!playing) return;
    time = originTime + (performance.now() - originPerf) * rate;
    playing = false;
    updateLabel();
  };

  const play = (): void => {
    if (playing) return;
    if (time >= duration) time = 0;
    originTime = time;
    originPerf = performance.now();
    playing = true;
    updateLabel();
  };

  playButton.addEventListener('click', () => {
    if (playing) pause();
    else play();
  });
  slider.addEventListener('input', () => {
    playing = false;
    time = Number(slider.value);
    seekTo(time);
    updateLabel();
  });
  speed.addEventListener('change', () => {
    time = playing ? originTime + (performance.now() - originPerf) * rate : Number(slider.value);
    originTime = time;
    originPerf = performance.now();
    rate = Number(speed.value);
  });
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      if (playing) pause();
      else play();
    } else if (event.code === 'ArrowRight') {
      pause();
      time = clamp(time + 1000, 0, duration);
      seekTo(time);
      updateLabel();
    } else if (event.code === 'ArrowLeft') {
      pause();
      time = clamp(time - 1000, 0, duration);
      seekTo(time);
      updateLabel();
    }
  });

  const tick = (now: number): void => {
    if (playing) {
      time = originTime + (now - originPerf) * rate;
      if (time >= duration) {
        time = duration;
        playing = false;
      }
      seekTo(time);
      updateLabel();
    }
    requestAnimationFrame(tick);
  };
  time = 0;
  originTime = 0;
  originPerf = performance.now();
  updateLabel();
  requestAnimationFrame(tick);
}

async function main(): Promise<void> {
  const response = await fetch('scene.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load scene.json (HTTP ${response.status})`);
  const scene = (await response.json()) as Scene;

  applyTheme(scene.meta);
  const shell = buildShell(scene.meta);

  const highlighter = new Highlighter({
    name: scene.meta.repoName,
    tokenColors: scene.meta.tokenColors,
    foreground: scene.meta.colors['editor.foreground'] ?? '#cccccc',
    background: scene.meta.colors['editor.background'] ?? '#1f1f1f',
  });
  await highlighter.initialize(Object.values(scene.meta.grammarScopes));
  await document.fonts.ready;

  const state = createState(scene);
  let lastSignature = '';

  const render = (): void => {
    renderTitlebar(shell, state);
    renderActivityBar(shell, state);
    renderSidebar(shell, state);
    renderEditor(shell, state, highlighter);
    renderStatusBar(shell.statusbar, state);
    renderOverlays(shell.overlayRoot, state);
  };

  const seekTo = (time: number): string => {
    seek(state, clamp(time, 0, scene.durationMs));
    const signature = frameSignature(state, Math.round(shell.editor.clientHeight));
    if (signature !== lastSignature) {
      lastSignature = signature;
      render();
    }
    return signature;
  };

  browserWindow.__seek = seekTo;
  browserWindow.__duration = scene.durationMs;
  browserWindow.__scene = scene;
  document.title = scene.meta.windowTitle ?? `${scene.meta.repoName} - Visual Studio Code`;

  window.addEventListener('resize', () => {
    lastSignature = '';
    seekTo(state.time);
  });

  seekTo(0);
  if (!captureMode) setupControls(scene.durationMs, seekTo);
  browserWindow.__ready = true;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  browserWindow.__error = message;
  console.error(error);
  const shell = document.querySelector<HTMLElement>('#app') ?? document.body;
  shell.textContent = `Failed to start the renderer: ${message}`;
  shell.style.cssText =
    'display:flex;align-items:center;justify-content:center;height:100vh;color:#f48771;background:#1f1f1f;font-family:monospace;padding:24px;text-align:center;';
});
