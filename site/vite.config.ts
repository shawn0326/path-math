import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveApiDocs(): Plugin {
  const docsRoot = fileURLToPath(new URL('../docs/site/api/', import.meta.url));

  return {
    name: 'serve-api-docs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', async (request, response, next) => {
        try {
          const rawPath = decodeURIComponent((request.url ?? '/').split('?')[0]!);
          const relativePath = rawPath.replace(/^\/api(?=\/|$)/, '').replace(/^\/+/, '');
          let filename = resolve(docsRoot, relativePath || 'index.html');

          if (!filename.startsWith(docsRoot)) return next();
          if ((await stat(filename)).isDirectory()) filename = resolve(filename, 'index.html');

          response.statusCode = 200;
          response.setHeader('Content-Type', MIME_TYPES[extname(filename)] ?? 'application/octet-stream');
          response.end(await readFile(filename));
        } catch {
          next();
        }
      });
    }
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: command === 'serve' ? [serveApiDocs()] : [],
  build: {
    outDir: '../docs/site',
    emptyOutDir: true
  },
  resolve: {
    alias: command === 'serve'
      ? [{
          find: /^path-geometry$/,
          replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url))
        }]
      : []
  }
}));
