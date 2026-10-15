import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { prerender } from './prerender';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [
    react(),
    prerender(),
    {
      name: 'web-page-policy-and-ads',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler: (_html, context) => {
          // Google only supports strict CSP, not a changing ad-origin allowlist:
          // https://support.google.com/adsense/answer/16283098
          // Static hosting cannot provide fresh per-response nonces. Leave resource
          // directives unset for Auto ads and JSON-LD; retain non-network protections.
          // This trusts Google's page scripts, rather than providing network isolation.
          const policy = [
            "form-action 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "worker-src 'self' blob:",
          ].join('; ');

          const protections = {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: policy,
            },
            injectTo: 'head-prepend' as const,
          };
          if (context.path !== '/index.html') return [protections];

          return [
            protections,
            // Requires an approved AdSense Sites entry and Auto ads enabled in Ads.
            // Bottom overlays override the dashboard's anchor-position setting.
            {
              tag: 'script',
              attrs: {
                async: true,
                src: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6070999186513755',
                crossorigin: 'anonymous',
                'data-overlays': 'bottom',
              },
              injectTo: 'head',
            },
          ];
        },
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, '../dist-web'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        converter: resolve(__dirname, 'index.html'),
        privacy: resolve(__dirname, 'privacy/index.html'),
        support: resolve(__dirname, 'support/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../src'),
    },
  },
});
