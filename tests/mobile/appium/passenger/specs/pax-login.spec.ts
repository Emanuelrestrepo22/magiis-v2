/**
 * PAX-LOGIN — validar el login de la app Pasajero: aviso con credenciales inválidas, login válido al home y
 * persistencia de la sesión al cerrar y reabrir la app.
 *
 * QUÉ AFIRMA
 *   T1. Credenciales FALSAS (nunca una cuenta real, evita bloqueos): modal «Usuario o Contraseña Inválidos»
 *       y la app sigue en `/login` tras aceptar el aviso.
 *   T2. Credenciales válidas: sale de `/login`, llega a `/navigator/HomePage` y el home muestra un marcador
 *       de modo («Modo Personal» o «Compañía»).
 *   T3. Con sesión iniciada, `terminateApp` + `activateApp`: la app vuelve al home (no a `/login`).
 *
 * PLAN DE CORRIDA
 *   Comando:    ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-login.spec.ts
 *   Dispositivo: emulador con la app Pasajero instalada (p. ej. com.magiis.app.test.passenger en TEST), Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (test|uat),
 *               ANDROID_UDID (p. ej. emulator-5554), ANDROID_PASSENGER_APP_PACKAGE (si el paquete por defecto no
 *               es el del ambiente), y las credenciales PAX en `.env.<ENV>` de V2 o en MOBILE_CREDENTIALS_FILE
 *               (V1): PASSENGER_EMAIL_<ENV> / USER_PASSENGER_<ENV> / PASSENGER_EMAIL / USER_PASSENGER y
 *               PASSENGER_PASSWORD_<ENV> / PASS_PASSENGER_<ENV> / PASSENGER_PASSWORD / PASS_PASSENGER.
 *   Precondición: T3 requiere sesión iniciada (home). T1 y T2 llaman a `ensureLoggedOut()`: si la app arranca con
 *               sesión cierran sesión por el menú lateral («Salir»); con un viaje en curso la app no deja cerrar
 *               sesión y se saltean con motivo. El logout está relevado del código (develop); su validación en
 *               vivo está pendiente (login bloqueado por FCM en los emuladores).
 *   Efectos:    T2 deja la sesión INICIADA (insumo de T3). T1 no cambia estado.
 *   Bloqueo conocido (24/11/2026): en los emuladores T2 se queda en `/login`. Tras autenticar, la app espera
 *               `getFirebaseToken()` (src/app/services/firebase.service.ts: `fcm.getToken().then` sin catch ni timeout)
 *               y en emulator-5554 y emulator-5556 el token falla con FIS_AUTH_ERROR, también para procesos de
 *               Google Play Services (GnpSdk): es del entorno, no del build. Correr T2/T3 en un dispositivo físico.
 *               Detalle: docs/analysis/appium-migration/H-APP-PAX-01-login-fcm.md.
 *   Fuera de alcance: recuperar contraseña, crear cuenta, login social, sesión vencida, logout.
 *   Xray: `@no-xray` (aún sin Test asignado).
 */

import { test, expect } from '@playwright/test';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import { resolvePassengerCredentials } from '../../data/passengerCredentials.js';
import {
  attachEvidence,
  closePassengerSpec,
  environmentSkipReason,
  openPassengerSpec
} from '../../harness/PassengerSpecKit.js';
import type { PassengerSpecContext } from '../../harness/PassengerSpecKit.js';
import { normalizeForMatch } from '../../screens/passenger/LoginScreen.js';
import { PassengerSessionBusyError } from '../../pbo/PassengerSessionPBO.js';

const FAKE_EMAIL = 'qa_e2e_invalido@example.test';
const FAKE_PASSWORD = 'Invalida-No-Existe-1!';

/** Guardas comunes: Appium disponible y ambiente distinto de PROD. Devuelve la config del actor. */
function guards() {
  test.skip(
    !process.env.APPIUM_SERVER_URL,
    'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
  );
  const config = getPassengerAppConfig();
  const envReason = environmentSkipReason(config.environment);
  test.skip(envReason !== null, envReason ?? '');
  return config;
}

/** Deja la app en `/login`; con un viaje en curso la app no permite cerrar sesión y el test se saltea. */
async function logoutOrSkip(pbo: PassengerSpecContext['pbo']): Promise<void> {
  try {
    await pbo.ensureLoggedOut();
  } catch (error) {
    if (error instanceof PassengerSessionBusyError) {
      test.skip(true, 'viaje en curso: la app no permite cerrar sesión');
    }
    throw error;
  }
}

test.describe('@mobile @no-xray App Pasajero · login', () => {
  test.describe.configure({ timeout: 240_000 });

  test('PAX-LOGIN · Validar que credenciales inválidas muestran el aviso «Usuario o Contraseña Inválidos» y la app sigue en el login', async ({}, testInfo) => {
    guards();
    let ctx: PassengerSpecContext | null = null;
    try {
      ctx = await openPassengerSpec('pax-login-invalid');
      const { pbo, evidence } = ctx;
      await pbo.waitForStableSessionState();
      await logoutOrSkip(pbo);
      await evidence.capture('01-login-form');

      const outcome = await pbo.attemptInvalidLogin(FAKE_EMAIL, FAKE_PASSWORD);
      await evidence.capture('02-tras-aviso');

      expect(normalizeForMatch(outcome.modalText)).toContain(
        normalizeForMatch('Usuario o Contraseña Inválidos')
      );
      expect(outcome.stayedOnLogin, 'tras aceptar el aviso la app sigue en /login').toBe(true);
    } finally {
      if (ctx) {
        await attachEvidence(testInfo, ctx.evidence);
        await closePassengerSpec(ctx);
      }
    }
  });

  test('PAX-LOGIN · Validar que el login con credenciales válidas lleva al home del pasajero', async ({}, testInfo) => {
    const config = guards();
    let credentials: ReturnType<typeof resolvePassengerCredentials>;
    try {
      credentials = resolvePassengerCredentials(config.environment);
    } catch (error) {
      test.skip(
        true,
        `Credenciales PAX no legibles: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    console.info(
      `[pax-login] credenciales PAX leídas de: ${credentials.source ?? 'n/d'} · ${credentials.file ?? 'n/d'}`
    );

    let ctx: PassengerSpecContext | null = null;
    try {
      ctx = await openPassengerSpec('pax-login-valid');
      const { pbo, evidence } = ctx;
      await pbo.waitForStableSessionState();
      await logoutOrSkip(pbo);
      await evidence.capture('01-login-form');

      const outcome = await pbo.loginOrFail(
        { email: credentials.email, password: credentials.password },
        { timeoutMs: 90_000 }
      );
      await evidence.capture('02-home');

      expect(outcome.homeUrl).toMatch(/\/navigator\/HomePage/i);
      expect(
        ['personal', 'company'],
        'el home debe mostrar «Modo Personal» o «Compañía»'
      ).toContain(outcome.mode);
    } finally {
      if (ctx) {
        await attachEvidence(testInfo, ctx.evidence);
        await closePassengerSpec(ctx);
      }
    }
  });

  test('PAX-LOGIN · Validar que la sesión persiste al cerrar y reabrir la app', async ({}, testInfo) => {
    const config = guards();
    let ctx: PassengerSpecContext | null = null;
    try {
      ctx = await openPassengerSpec('pax-login-persist');
      const { pbo, evidence, session } = ctx;
      const before = await pbo.waitForStableSessionState();
      test.skip(before.kind !== 'home', `Requiere sesión iniciada (estado: ${before.kind}).`);
      await evidence.capture('01-home-antes');

      const pkg = config.appPackage ?? '';
      expect(pkg, 'paquete de la app PAX').not.toBe('');
      await session.driver.terminateApp(pkg);
      await session.driver.activateApp(pkg);
      const web = await session.reattachWebview();
      expect(web, 'el WebView debe re-engancharse tras relanzar la app').not.toBeNull();

      const after = await pbo.waitForStableSessionState();
      await evidence.capture('02-tras-reabrir');
      expect(after.kind, 'tras reabrir la app la sesión sigue en el home').toBe('home');
      expect(after.url).not.toMatch(/\/login/i);
    } finally {
      if (ctx) {
        await attachEvidence(testInfo, ctx.evidence);
        await closePassengerSpec(ctx);
      }
    }
  });
});
