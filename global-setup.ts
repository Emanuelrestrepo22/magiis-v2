// global-setup.ts
// Login carrier V2 + persistir storageState antes de correr los specs.
// Se invoca una sola vez por run (configurado en playwright.config.ts).
import { chromium, type FullConfig } from '@playwright/test';
import dotenv from 'dotenv';
import {
  getCurrentEnv,
  getEnvFile,
  getStorageStatePath,
  resolveBaseURL,
  resolveCredentials,
  resolveLoginPath,
  resolveDashboardPattern
} from './tests/config/runtime.js';

async function globalSetup(_config: FullConfig): Promise<void> {
  // Cargar .env correcto antes de leer credenciales.
  dotenv.config({ path: getEnvFile() });

  const env = getCurrentEnv();
  const baseURL = resolveBaseURL();
  const { username, password } = resolveCredentials();
  const loginPath = resolveLoginPath();
  const dashboardPattern = resolveDashboardPattern();
  const storageStatePath = getStorageStatePath(env);

  console.log(`[globalSetup] ENV=${env} BASE_URL=${baseURL}`);
  console.log(`[globalSetup] login -> ${loginPath} (user=${username})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  // V2 usa hash routing (apps-test.magiis.com/carrier/#/auth/login).
  // domcontentloaded llega antes que SPA boot; el waitFor del input asegura UI lista.
  await page.goto(loginPath, { waitUntil: 'domcontentloaded', timeout: 20_000 });

  // TODO: validar estos selectores contra refs/v2/src/app cuando se clone el repo.
  // formcontrolname es estable en Angular ReactiveForms; ajustar si V2 usa getByLabel o data-testid.
  const emailInput = page.locator('input[formcontrolname="email"], input[type="email"]').first();
  const passwordInput = page.locator('input[formcontrolname="password"], input[type="password"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  await emailInput.fill(username);
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /iniciar|login|ingresar/i }).first().click();

  // Esperar que el shell del carrier V2 este listo (hash routing-friendly).
  await page.waitForURL((url) => url.toString().includes(dashboardPattern), { timeout: 20_000 });

  await context.storageState({ path: storageStatePath });
  console.log(`[globalSetup] storageState guardado en ${storageStatePath}`);

  await browser.close();
}

export default globalSetup;
