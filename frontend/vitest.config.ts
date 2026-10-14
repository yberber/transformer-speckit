import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Both projects reuse the Vite config (Svelte plugin, $contracts alias), so rune-based
// `.svelte.ts` modules compile. No DOM emulator: components are tested in Playwright only.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            include: ['tests/unit/**/*.test.ts'],
            environment: 'node',
          },
        },
        {
          extends: true,
          test: {
            name: 'contract',
            include: ['tests/contract/**/*.test.ts'],
            environment: 'node',
          },
        },
      ],
    },
  }),
);
