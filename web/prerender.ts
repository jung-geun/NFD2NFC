import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
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
          plugins: [react()],
          resolve: { alias: { '@core': resolve(__dirname, '../src') } },
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
