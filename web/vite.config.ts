import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [
    react(),
    {
      name: 'local-file-processing-policy',
      apply: 'build',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: "default-src 'self'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:",
          },
          injectTo: 'head-prepend',
        }],
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, '../dist-web'),
    emptyOutDir: true,
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../src'),
    },
  },
});
