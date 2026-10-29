// global-setup.ts
// Login carrier V2 + persistir storageState antes de correr los specs.
// Se invoca una sola vez por run (configurado en playwright.config.ts).
import { existsSync, rmSync } from 'node:fs';
import { chromium, type Browser, type FullConfig } from '@playwright/test';
import dotenv from 'dotenv';
import {
  DEFAULT_LOCALE,
  getCurrentEnv,
  getEnvFile,
  getStorageStatePath,
  resolveBaseURL,
  resolveCredentials,
  resolveLoginPath,
  resolveDashboardPattern
} from './tests/config/runtime.js';
import { normalizeStorageStateLanguage } from './tests/config/storage-state-locale.js';
import {
  loadCarrierSession,
  SUITE_MIN_SESSION_VALIDITY_MS
} from './tests/api/clients/carrierSession.js';
import {
  availabilityUrls,
  ENV_DOWN_FLAG,
  EnvironmentUnavailableError,
  probeEnvironment
} from './tests/utils/envAvailability.js';

/**
 * Gate de disponibilidad (capa 1 del plan de remediacion de flaky, 2026-10-08): antes de loguear
 * o reutilizar la sesion, comprueba que el shell del carrier y la API responden. Si no, la suite
 * no corre y no queda resultado publicable en Xray. ENV_GATE=0 lo desactiva.
 *
 * El borrado del archivo de resultados vive aca y no en el reporter: si globalSetup falla,
 * Playwright no llama a onEnd (verificado 2026-10-08), y un xray-results.json de una corrida
 * anterior quedaria listo para importarse como si fuera de esta. Misma ruta que playwright.config.
 */
async function assertEnvironmentAvailable(baseURL: string, env: string): Promise<void> {
  if (process.env.ENV_GATE?.trim() === '0') {
    console.info('[globalSetup] ENV_GATE=0: gate de disponibilidad desactivado');
    return;
  }
  const apiPrefix = process.env.MAGIIS_API_PREFIX?.trim() || 'magiis-v0.2';
  const result = await probeEnvironment({ urls: availabilityUrls(baseURL, apiPrefix) });
  for (const a of result.attempts) {
    console.info(`[globalSetup] gate intento ${a.attempt}: ${a.url} -> ${a.outcome}`);
  }
  if (!result.ok) {
    process.env[ENV_DOWN_FLAG] = '1';
    const xrayResults = process.env.XRAY_RESULTS_FILE ?? `evidence/${env}/xray-results.json`;
    rmSync(xrayResults, { force: true });
    console.warn(`[globalSetup] ENVIRONMENT_DOWN: ${xrayResults} eliminado (nada para importar)`);
    throw new EnvironmentUnavailableError(baseURL, result.attempts);
  }
}

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
  // locale explicito: este contexto NO hereda el 'use' de playwright.config.ts, y el
  // idioma que resuelva aca queda grabado en el storageState (localStorage carrier-31).
  const context = await browser.newContext({ baseURL, locale: DEFAULT_LOCALE });
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

/**
 * Guard REUSE_STORAGE_STATE=1 (uso local): reutiliza la sesion guardada sin
 * llamar al login. Valida EL token de sesion (`carrier-0` del origin de BASE_URL,
 * el mismo que usa la capa API) y exige que siga vigente al menos
 * SUITE_MIN_SESSION_VALIDITY_MS, para que no venza a mitad de una suite que ya
 * creo datos. Si no existe, no cuadra o vence antes, falla pidiendo login humano.
 * Nunca imprime el token.
 */
function assertReusableStorageState(storageStatePath: string): void {
  const loginHint =
    'Hace falta un login humano: inicia sesion manualmente y vuelve a guardar el ' +
    `storageState en ${storageStatePath}, o corre con REUSE_STORAGE_STATE=0.`;
  if (!existsSync(storageStatePath)) {
    throw new Error(
      `[globalSetup] REUSE_STORAGE_STATE=1 pero no existe ${storageStatePath}. ${loginHint}`
    );
  }
  let expiresAt: Date;
  try {
    expiresAt = loadCarrierSession({
      storageStatePath,
      minValidityMs: SUITE_MIN_SESSION_VALIDITY_MS
    }).tokenExpiresAt;
  } catch (error) {
    throw new Error(
      `[globalSetup] REUSE_STORAGE_STATE=1 pero la sesion guardada no sirve para la suite ` +
        `(vigencia minima ${SUITE_MIN_SESSION_VALIDITY_MS / 60_000} min): ${(error as Error).message}. ${loginHint}`
    );
  }
  console.info(
    `[globalSetup] REUSE_STORAGE_STATE=1: se reutiliza ${storageStatePath} (token de sesion vigente hasta ${expiresAt.toISOString()}); no se llama al login`
  );
}

/** Fuerza EN en el storageState (reusado o recien logueado) y deja rastro si lo altero. */
function ensureEnglishStorageState(storageStatePath: string): void {
  const { changed, previous } = normalizeStorageStateLanguage(storageStatePath, 'en');
  if (changed) {
    console.info(`[globalSetup] idioma del storageState: ${previous} -> en-us`);
  }
}

async function globalSetup(_config: FullConfig): Promise<void> {
  // Cargar .env correcto antes de leer credenciales.
  dotenv.config({ path: getEnvFile() });

  const env = getCurrentEnv();
  const storageStatePath = getStorageStatePath(env);

  // Primero el ambiente: un servidor caido no es un fallo de login ni de ningun test.
  await assertEnvironmentAvailable(resolveBaseURL(), env);

  // Uso local: reutilizar la sesion guardada y no loguear. Sin la variable (CI),
  // el flujo de login de abajo no cambia.
  if (process.env.REUSE_STORAGE_STATE?.trim() === '1') {
    assertReusableStorageState(storageStatePath);
    ensureEnglishStorageState(storageStatePath);
    return;
  }

  const baseURL = resolveBaseURL();
  const { username, password } = resolveCredentials();
  const loginPath = resolveLoginPath();
  const dashboardPattern = resolveDashboardPattern();

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
        ensureEnglishStorageState(storageStatePath);
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
