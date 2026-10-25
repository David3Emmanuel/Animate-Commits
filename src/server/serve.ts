import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Scene } from '../scene/types';
import type { GrammarRegistry } from '../grammar/resolve';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

export interface SceneServerOptions {
  scene: Scene;
  rendererDir: string;
  grammars: GrammarRegistry;
}

export interface SceneServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export function startSceneServer(options: SceneServerOptions): Promise<SceneServer> {
  const rendererDir = resolve(options.rendererDir);
  const sceneJson = JSON.stringify(options.scene);

  const handleRequest = (requestUrl: string | undefined): { status: number; type: string; body: Buffer | string } => {
    const url = new URL(requestUrl ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/scene.json') {
      return { status: 200, type: MIME['.json']!, body: sceneJson };
    }
    if (url.pathname === '/api/grammar') {
      const scope = url.searchParams.get('scope') ?? '';
      const grammarPath = options.grammars.grammarPathForScope(scope);
      if (!grammarPath || !existsSync(grammarPath)) {
        return { status: 404, type: 'text/plain', body: 'grammar not found' };
      }
      return {
        status: 200,
        type: MIME['.json']!,
        body: readFileSync(grammarPath),
      };
    }

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const candidate = normalize(join(rendererDir, pathname));
    if (!candidate.startsWith(rendererDir)) {
      return { status: 403, type: 'text/plain', body: 'forbidden' };
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return {
        status: 200,
        type: MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
        body: readFileSync(candidate),
      };
    }
    if (pathname === '/index.html') {
      return { status: 404, type: 'text/plain', body: 'renderer not built' };
    }
    return { status: 404, type: 'text/plain', body: 'not found' };
  };

  return new Promise((resolvePromise, reject) => {
    const server: Server = createServer((request, response) => {
      try {
        const result = handleRequest(request.url);
        response.writeHead(result.status, {
          'Content-Type': result.type,
          'Cache-Control': result.type.includes('json') ? 'no-store' : 'public, max-age=60',
        });
        response.end(result.body);
      } catch (error) {
        console.error('Scene server error:', error);
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('internal error');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/`,
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
