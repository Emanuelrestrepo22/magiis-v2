// playwright.config.ts
// Config base del framework. Lee ENV={test|uat|prod} para resolver baseURL y credenciales.
import { defineConfig, devices } from '@playwright/test';
import { getCurrentEnv, getStorageStatePath } from './tests/config/runtime.js';
import { VISUAL_DEFAULTS } from './tests/config/visualConfig.js';
import { validateEnv } from './tests/utils/envSchema.js';

// Valida el .env activo antes de inicializar Playwright.
// Si una variable falta o es invalida, falla con mensaje claro.
validateEnv();

const env = getCurrentEnv();

export default defineConfig({
  testDir: './tests',

  // Timeouts equilibrados entre estabilidad y feedback rapido.
  timeout: 60 * 1000,
  expect: {
    timeout: 5000,
    toHaveScreenshot: {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret
    }
  },

  fullyParallel: true,
  workers: Number(process.env.WORKERS ?? 4),
  retries: Number(process.env.RETRIES ?? 0),
  forbidOnly: !!process.env.CI,

  globalSetup: './global-setup.ts',

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `evidence/${env}/report` }],
    ['junit', { outputFile: `evidence/${env}/junit.xml` }]
  ],

  outputDir: `evidence/${env}/playwright-artifacts`,

  use: {
    baseURL: process.env.BASE_URL,
    headless: process.env.HEADLESS !== 'false',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },

  // Projects:
  // - carrier-v2-desktop: principal, sesion autenticada en 1920x1080
  // - carrier-v2-laptop:  cobertura de viewport secundario
  // - codegen:            sesion limpia para Record new (sin storageState)
  // - visual:             dedicado a regresion visual con masking estricto
  projects: [
    {
      name: 'carrier-v2-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        storageState: getStorageStatePath(env)
      }
    },
    {
      name: 'carrier-v2-laptop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
        storageState: getStorageStatePath(env)
      }
    },
    {
      name: 'visual',
      testDir: './tests/specs/visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        storageState: getStorageStatePath(env)
      }
    },
    {
      name: 'codegen',
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] }
      }
    }
  ]
});
