import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from a sub-path; set VITE_BASE=/<repo>/ when building for it.
  base: process.env.VITE_BASE ?? '/',
  plugins: [svelte()],
  resolve: {
    alias: {
      // Single authoritative contract set at the repo root (Principle IX).
      $contracts: fileURLToPath(new URL('../contracts', import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  build: {
    // Read by scripts/check-budgets.mjs to compute the initial-load set.
    manifest: true,
  },
});
