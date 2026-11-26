// eslint flat config - ESLint 9
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import playwright from 'eslint-plugin-playwright';

export default [
  {
    ignores: [
      'node_modules/**',
      'evidence/**',
      'storage/**',
      'refs/**',
      'playwright-report/**',
      'test-results/**',
      // Scratch de sesiones agenticas (ya ignorado por git, ver .gitignore): son scripts
      // descartables de diagnostico, no codigo de la suite. Sin esta exclusion `npm run lint`
      // falla por reglas de estilo sobre archivos que nadie mantiene.
      'tmp/**',
      '*.config.js',
      '*.config.mjs'
    ]
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      '@typescript-eslint': tseslint,
      playwright
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',

      // Playwright - aplica las recomendadas y agrega bans del CLAUDE.md
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-skipped-test': 'warn',
      'playwright/no-focused-test': 'error',
      // Considera helpers de POM (expectListReady / expectShellReady / expectMapReady)
      // como assertions validas; internamente todos llaman a expect().
      'playwright/expect-expect': [
        'error',
        {
          assertFunctionNames: [
            'expect',
            'expectListReady',
            'expectListReadyWithSearch',
            'expectPaginationReady',
            'expectShellReady',
            'expectSkeletonReady',
            'expectMapReady',
            'expectTabsReady',
            'expectMainSectionsReady'
          ]
        }
      ],
      'playwright/missing-playwright-await': 'error',
      'playwright/no-element-handle': 'error',
      'playwright/no-eval': 'error',
      'playwright/no-wait-for-selector': 'warn',
      'playwright/prefer-web-first-assertions': 'error',
      'playwright/valid-expect': 'error',

      // General
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always']
    }
  },
  {
    // Unit tests de la plataforma mobile usan node:test + node:assert, no Playwright.
    files: ['tests/mobile/**/*.unit.ts'],
    rules: {
      'playwright/expect-expect': 'off',
      'playwright/no-duplicate-hooks': 'off'
    }
  }
];
