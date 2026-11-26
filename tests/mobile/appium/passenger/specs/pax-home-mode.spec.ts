/**
 * PAX-HOME-MODE — validar el interruptor de modo de perfil del home de la app Pasajero (Personal ↔ Compañía).
 *
 * QUÉ AFIRMA
 *   T1. Con sesión iniciada, leer el modo inicial, cambiar al otro modo (la etiqueta del home pasa de
 *       «Modo Personal» a «Compañía: <nombre>» o viceversa) y volver: el modo inicial queda restaurado.
 *
 * PLAN DE CORRIDA
 *   Comando:    ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-home-mode.spec.ts
 *   Dispositivo: emulador/equipo con la app Pasajero instalada, Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (test|uat), ANDROID_UDID,
 *               ANDROID_PASSENGER_APP_PACKAGE y las credenciales PAX (ver `pax-login.spec.ts`).
 *   Precondición: sesión iniciada en el home. Si la app arranca en `/login` el spec inicia sesión con las
 *               credenciales resueltas por `resolvePassengerCredentials`; si tras eso no está en el home se saltea
 *               con motivo. Requiere un usuario con perfil corporativo: sin interruptor visible
 *               (`personalModeDisabled`) o deshabilitado (sin perfil corporativo) se saltea con motivo.
 *   Efectos:    cambiar de modo NO llama al backend ni muestra confirmación (develop `profileSelected()`,
 *               home.page.ts:2197): solo guarda el perfil actual en el storage de la app. El spec siempre restaura
 *               el modo inicial en `finally`. Si el spec inició sesión, la deja iniciada.
 *   Bloqueo conocido (24/11/2026): en los emuladores el login PAX queda en `/login` por FIS_AUTH_ERROR de FCM
 *               (ver `pax-login.spec.ts` y docs/analysis/appium-migration/H-APP-PAX-01-login-fcm.md). Locators y
 *               comportamiento relevados del código (develop) y de V1; validación en vivo pendiente.
 *   Fuera de alcance: viajes en cada modo, cambio de compañía por defecto (`canProfileChange`), persistencia tras
 *               relanzar la app.
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
import {
  PassengerHomePBO,
  ProfileModeUnavailableError,
  type PassengerProfileMode
} from '../../pbo/PassengerHomePBO.js';

test.describe('@mobile @no-xray App Pasajero · modo de perfil del home', () => {
  test.describe.configure({ timeout: 240_000 });

  test('PAX-HOME-MODE · Validar que el interruptor cambia el modo Personal ↔ Compañía y se restaura', async ({}, testInfo) => {
    test.skip(
      !process.env.APPIUM_SERVER_URL,
      'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
    );
    const config = getPassengerAppConfig();
    const envReason = environmentSkipReason(config.environment);
    test.skip(envReason !== null, envReason ?? '');

    let ctx: PassengerSpecContext | null = null;
    let homePbo: PassengerHomePBO | null = null;
    let initial: PassengerProfileMode | null = null;
    try {
      ctx = await openPassengerSpec('pax-home-mode');
      const { pbo, evidence, session, log } = ctx;
      homePbo = PassengerHomePBO.forSession(session, log);

      let state = await pbo.waitForStableSessionState();
      if (state.kind === 'login') {
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
        await pbo.loginOrFail(
          { email: credentials.email, password: credentials.password },
          { timeoutMs: 90_000 }
        );
        state = await pbo.sessionState();
      }
      test.skip(
        state.kind !== 'home',
        `Requiere sesión iniciada en el home (estado: ${state.kind}).`
      );

      const startMode = await homePbo.readMode();
      test.skip(startMode === 'none', 'El home no muestra la etiqueta de modo.');
      initial = startMode as PassengerProfileMode;
      const other: PassengerProfileMode = initial === 'personal' ? 'company' : 'personal';
      await evidence.capture(`01-modo-inicial-${initial}`);

      try {
        const toOther = await homePbo.ensureProfileMode(other);
        await evidence.capture(`02-modo-${other}`);
        expect(toOther, 'el interruptor cambia al otro modo').toEqual({
          changed: true,
          from: initial,
          to: other
        });
        expect(await homePbo.readMode(), 'la etiqueta del home refleja el nuevo modo').toBe(other);

        const back = await homePbo.ensureProfileMode(initial);
        await evidence.capture(`03-modo-restaurado-${initial}`);
        expect(back, 'el interruptor vuelve al modo inicial').toEqual({
          changed: true,
          from: other,
          to: initial
        });
        expect(await homePbo.readMode(), 'el modo inicial queda restaurado').toBe(initial);
      } catch (error) {
        if (error instanceof ProfileModeUnavailableError) {
          test.skip(true, error.message);
        }
        throw error;
      }
    } finally {
      if (homePbo && initial) {
        // Siempre restaurar el modo inicial (cambiar de modo solo persiste en el storage de la app).
        await homePbo.ensureProfileMode(initial).catch(() => undefined);
      }
      if (ctx) {
        await attachEvidence(testInfo, ctx.evidence);
        await closePassengerSpec(ctx);
      }
    }
  });
});
