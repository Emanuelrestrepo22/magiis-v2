// playwright.config.ts
// Config base del framework. Lee ENV={test|uat|prod} para resolver baseURL y credenciales.
import { defineConfig, devices } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test';
import { DEFAULT_LOCALE, getCurrentEnv, getStorageStatePath } from './tests/config/runtime.js';
import { VISUAL_DEFAULTS } from './tests/config/visualConfig.js';
import { validateEnv } from './tests/utils/envSchema.js';

// Valida el .env activo antes de inicializar Playwright.
// Si una variable falta o es invalida, falla con mensaje claro.
validateEnv();

const env = getCurrentEnv();

// Guardrail: prohibir mutaciones de baselines visuales contra produccion.
// Una regeneracion accidental de snapshots en prod sobreescribiria la verdad
// con datos volatiles (saldos, KPIs, fechas reales). Bloqueamos antes de que
// Playwright cargue cualquier spec.
if (env === 'prod') {
  const argv = process.argv.join(' ');
  const updatesSnapshots = /--update-snapshots|(?:^|\s)-u(?:$|\s)/.test(argv);
  if (updatesSnapshots) {
    throw new Error(
      '[playwright.config] ENV=prod no permite --update-snapshots. ' +
        'Regenera baselines en ENV=test (npm run test:visual:update) o via ' +
        'workflow_dispatch en visual.yml con update_baselines=true.'
    );
  }
}

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
    ['junit', { outputFile: `evidence/${env}/junit.xml` }],
    // JSON con annotations (incluye a11y_violation) consumido por
    // scripts/check-a11y-regression.cjs (FW-011) y dashboard (FW-015).
    ['json', { outputFile: `evidence/${env}/results.json` }],
    // Allure OPT-IN (ALLURE=1): el init de allure-playwright falla bajo npm + ruta OneDrive
    // (errno -4094 UNKNOWN); dejarlo condicional evita romper el runner default.
    ...(process.env.ALLURE
      ? [['allure-playwright', { resultsDir: 'allure-results', detail: true }]]
      : []),
    // Xray OPT-IN (XRAY=1) — emite evidence/<env>/xray-results.json para import a Xray (fase B/C).
    ...(process.env.XRAY
      ? [
          [
            './tests/utils/reporters/xray-reporter.ts',
            // XRAY_RESULTS_FILE: archivo propio por familia (scripts/run-xray-atr.ts `resultsFile`).
            { outputFile: process.env.XRAY_RESULTS_FILE ?? `evidence/${env}/xray-results.json` }
          ]
        ]
      : [])
  ] as ReporterDescription[],

  outputDir: `evidence/${env}/playwright-artifacts`,

  use: {
    baseURL: process.env.BASE_URL,
    // Locale fijo heredado por todos los projects (ver DEFAULT_LOCALE en runtime.ts).
    locale: DEFAULT_LOCALE,
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
      // Los specs visuales viven junto al resto de su dominio (tests/specs/<dominio>/), no en
      // una carpeta por tipo de suite: se seleccionan por el sufijo del archivo, no por ruta.
      // Con `testDir` apuntando a una carpeta este project se quedaba sin tests tras el reorg.
      testMatch: '**/*.visual.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        // Fija browser timezone en UTC para que date pickers/snapshots no cambien
        // entre runners locales y GitHub Actions.
        timezoneId: 'UTC',
        storageState: getStorageStatePath(env),
        // Determinismo de render de texto (MX-5531): elimina variacion sub-pixel
        // de fuentes/iconos entre runs del mismo runner Linux, causa del diff de
        // ~2% concentrado en bordes de texto del thead/barra de filtros.
        // - font-render-hinting=none: hinting deterministico, sin auto-hint.
        // - disable-lcd-text: AA en escala de grises (no subpixel RGB).
        // - force-color-profile=srgb: perfil de color fijo.
        launchOptions: {
          args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb']
        }
      }
    },
    {
      name: 'codegen',
      // Sesion limpia para "Record new". NO debe ejecutar la suite autenticada:
      // sin testMatch heredaba testDir './tests' y corria TODAS las specs sin login
      // (heading nunca visible -> goto() timeout), inflando regression con ~72 fallos
      // espurios bajo [codegen]. Lo acotamos a un dir propio (hoy vacio) -> 0 tests en CI.
      testMatch: 'tests/codegen/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] }
      }
    }
  ]
});
