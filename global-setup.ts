// global-setup.ts
// Login carrier V2 + persistir storageState antes de correr los specs.
// Se invoca una sola vez por run (configurado en playwright.config.ts).
import { chromium, type Browser, type FullConfig } from '@playwright/test';
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

/**
 * Ejecuta un intento completo de login + persistencia de storageState.
 * Se lanza como funcion aparte para poder reintentarla desde globalSetup si
 * el backend de auth tiene un hiccup transient (visto en Visual run #65
 * 2026-07-08 14:19 UTC: waitForURL timeout 45s aislado, mientras que Smoke
 * y Regression del mismo dia a 13:01 y 13:15 UTC pasaron sin problema).
 */
async function attemptLogin(
  browser: Browser,
  baseURL: string,
  loginPath: string,
  username: string,
  password: string,
  dashboardPattern: string,
  storageStatePath: string
): Promise<void> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    // V2 usa hash routing (apps-test.magiis.com/carrier/#/auth/login).
    // domcontentloaded llega antes que SPA boot; el waitFor del input asegura UI lista.
    // Timeout 45s tolera latencia transitoria del backend (validado intermitente 2026-05-20).
    await page.goto(loginPath, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // Selectores validados contra refs/v2/src/app/account/login/carrier/login-carrier.component.html.
    // El submit lleva texto i18n `login.sign_in` que en EN renderiza "Sign In" y en ES "Iniciar sesion".
    const emailInput = page.locator('input#email, input[formcontrolname="email"]').first();
    const passwordInput = page
      .locator('input#password-input, input[formcontrolname="password"]')
      .first();
    await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await emailInput.fill(username);
    await passwordInput.fill(password);
    await page
      .getByRole('button', { name: /sign\s*in|iniciar|ingresar/i })
      .first()
      .click();

    // Esperar que el shell del carrier V2 este listo (hash routing-friendly).
    // Timeout 45s para tolerar latencia transitoria del backend de auth.
    await page.waitForURL((url) => url.toString().includes(dashboardPattern), { timeout: 45_000 });

    await context.storageState({ path: storageStatePath });
  } finally {
    // Siempre cerrar el context aunque el intento falle - evita leaks entre reintentos.
    await context.close();
  }
}

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

  // Retry con backoff exponencial (2s, 8s) para absorber hiccups transientes del
  // backend de auth. Total peor caso: 3 intentos = ~2 minutos antes de rendirse.
  // Los timeouts INTERNOS (45s por navegacion) siguen limitando cada intento.
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 2_000, 8_000];
  let lastError: unknown = null;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        const wait = BACKOFF_MS[attempt - 1];
        console.log(`[globalSetup] intento ${attempt}/${MAX_ATTEMPTS} tras ${wait}ms de espera`);
        await new Promise((r) => setTimeout(r, wait));
      }
      try {
        await attemptLogin(
          browser,
          baseURL,
          loginPath,
          username,
          password,
          dashboardPattern,
          storageStatePath
        );
        console.log(
          `[globalSetup] storageState guardado en ${storageStatePath} (intento ${attempt})`
        );
        return;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[globalSetup] intento ${attempt} fallo: ${msg.split('\n')[0]}`);
      }
    }
    // Todos los intentos fallaron.
    throw lastError instanceof Error
      ? lastError
      : new Error(`globalSetup: fallaron ${MAX_ATTEMPTS} intentos de login`);
  } finally {
    await browser.close();
  }
}

export default globalSetup;
