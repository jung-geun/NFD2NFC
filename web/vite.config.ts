import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [react()],
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
