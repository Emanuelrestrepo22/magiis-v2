// playwright.mobile.config.ts
// Config aislada de la plataforma mobile (Appium + WebdriverIO). Independiente de playwright.config.ts:
// NO ejecuta el globalSetup web, NO llama a validateEnv() (no exige credenciales carrier) y solo ve
// tests/mobile. Las specs web nunca la usan y esta nunca recoge specs web.
// Debe ser el PRIMER import: toma el snapshot de las variables del shell antes de que otro modulo
// cargue dotenv en process.env (el shell siempre gana sobre el archivo de dispositivo).
import { loadDeviceEnv } from './tests/mobile/appium/config/deviceEnv.js';
import { defineConfig } from '@playwright/test';
import type { ReporterDescription } from '@playwright/test';
import { getCurrentEnv } from './tests/config/runtime.js';

loadDeviceEnv();

const env = getCurrentEnv();

export default defineConfig({
  testDir: './tests/mobile',
  testMatch: '**/*.spec.ts',

  // Un solo worker: un emulador/dispositivo por corrida, sin paralelismo entre specs.
  timeout: 240 * 1000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `evidence/${env}/mobile/report` }],
    ['json', { outputFile: `evidence/${env}/mobile/results.json` }],
    // TODO: cablear el reporter Xray cuando XRAY este activo (mismo wiring que playwright.config.ts);
    // el reporter se resuelve por ruta y no depende del globalSetup, pendiente de validar con una corrida real.
    ...(process.env.XRAY
      ? [
          [
            './tests/utils/reporters/xray-reporter.ts',
            {
              outputFile:
                process.env.XRAY_RESULTS_FILE ?? `evidence/${env}/mobile/xray-results.json`
            }
          ]
        ]
      : [])
  ] as ReporterDescription[],

  outputDir: `evidence/${env}/mobile/playwright-artifacts`,

  projects: [
    {
      name: 'mobile',
      use: { storageState: { cookies: [], origins: [] } }
    }
  ]
});
