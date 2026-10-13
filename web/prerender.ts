import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer, type Plugin } from 'vite';
import { resolve } from 'path';

export function prerender(): Plugin {
  return {
    name: 'prerender-converter-page',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        const server = await createServer({
          configFile: false,
          root: __dirname,
          esbuild: { jsx: 'automatic' },
          resolve: { alias: { '@core': resolve(__dirname, '../src') } },
          // SSR loading needs no client pre-bundle that could race server.close().
          optimizeDeps: { noDiscovery: true, include: [] },
          server: { middlewareMode: true, hmr: false },
          appType: 'custom',
        });
        try {
          const { App } = await server.ssrLoadModule('/src/App.tsx');
          return html.replace('<div id="root"></div>', `<div id="root">${renderToString(createElement(App))}</div>`);
        } finally {
          await server.close();
        }
      },
    },
  };
}
