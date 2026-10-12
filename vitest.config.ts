import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@core': resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'web/src/**/__tests__/**/*.test.ts'],
    globals: true,
  },
});
