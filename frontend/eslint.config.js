import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

// Architecture numbers (hidden size, MLP size, vocabulary size, context length, total
// parameters) must be read from the bundled model config, never written as literals.
const ARCH_LITERALS = [768, 3072, 50257, 1024, 124439808];

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'build/',
      'coverage/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '.lighthouseci/',
      'src/generated/',
      '**/*.min.js',
    ],
  },
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
  },
  {
    rules: {
      // Positional parameters that must exist but are unused (e.g. a Svelte snippet's error).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{ts,js,svelte}'],
    ignores: ['src/generated/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...ARCH_LITERALS.map((n) => ({
          selector: `Literal[value=${n}]`,
          message: 'Architecture numbers must come from the model config (Principle I)',
        })),
      ],
    },
  },
);
