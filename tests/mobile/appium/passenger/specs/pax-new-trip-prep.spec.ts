/**
 * PAX-NEW-TRIP-PREP — validar que el pasajero puede preparar un viaje (origen + destino con predicciones de
 * dirección) y que el CTA de continuar queda habilitado, SIN confirmar el viaje.
 *
 * QUÉ AFIRMA
 *   T1. Desde el home con sesión iniciada, escribir origen y destino con teclado real, elegir una predicción en
 *       cada campo y comprobar que ambos quedan con valor y que el CTA de continuar está presente y habilitado.
 *
 * PLAN DE CORRIDA
 *   Comando:    ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-new-trip-prep.spec.ts
 *   Dispositivo: emulador/equipo con la app Pasajero instalada, Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (test|uat), ANDROID_UDID,
 *               ANDROID_PASSENGER_APP_PACKAGE, las credenciales PAX (ver `pax-login.spec.ts`) y, opcional,
 *               PAX_NEWTRIP_REGION (AR|US|FR; por defecto AR) para elegir el par de direcciones públicas.
 *   Precondición: sesión iniciada en el home y sin viaje activo. Si la app arranca en `/login` el spec inicia
 *               sesión con las credenciales de `resolvePassengerCredentials`; si tras eso no está en el home, no
 *               se ve el formulario o aparece «Ya tiene un viaje creado», se saltea con motivo.
 *   Efectos:    no crea viajes; no toca el CTA de confirmar (solo lo lee). Escribir direcciones consulta Google
 *               Places y geocodifica (sin efecto de negocio). En `finally` se quita el foco y se limpia el origen;
 *               el destino elegido no tiene control para limpiarse en la app y queda solo en memoria de la app.
 *   Bloqueo conocido (24/11/2026): en los emuladores el login PAX queda en `/login` por FIS_AUTH_ERROR de FCM
 *               (ver `pax-login.spec.ts` y docs/analysis/appium-migration/H-APP-PAX-01-login-fcm.md). Locators y
 *               comportamiento relevados del código (develop) y de V1; validación en vivo pendiente.
 *   Fuera de alcance: selección de vehículo, método de pago, confirmar el viaje, límite de crédito (P-12/P-13,
 *               con compuerta), viajes programados, paradas intermedias.
 *   Xray: `@no-xray` (aún sin Test asignado).
 */

import { test, expect } from '@playwright/test';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import { passengerAddressesFor } from '../../data/passengerAddresses.js';
import { resolvePassengerCredentials } from '../../data/passengerCredentials.js';
import {
  attachEvidence,
  closePassengerSpec,
  environmentSkipReason,
  openPassengerSpec
} from '../../harness/PassengerSpecKit.js';
import type { PassengerSpecContext } from '../../harness/PassengerSpecKit.js';
import { NewTripFormNotFoundError, NewTripPBO } from '../../pbo/NewTripPBO.js';

test.describe('@mobile @no-xray App Pasajero · preparar nuevo viaje', () => {
  test.describe.configure({ timeout: 300_000 });

  test('PAX-NEW-TRIP-PREP · Validar que origen y destino se completan con predicciones y el CTA de continuar queda habilitado sin confirmar el viaje', async ({}, testInfo) => {
    test.skip(
      !process.env.APPIUM_SERVER_URL,
      'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
    );
    const config = getPassengerAppConfig();
    const envReason = environmentSkipReason(config.environment);
    test.skip(envReason !== null, envReason ?? '');

    let ctx: PassengerSpecContext | null = null;
    let tripPbo: NewTripPBO | null = null;
    try {
      ctx = await openPassengerSpec('pax-new-trip-prep');
      const { pbo, evidence, session, log } = ctx;
      tripPbo = NewTripPBO.forSession(session, log);

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
      test.skip(
        await tripPbo.hasActiveTripBlock(),
        'La app muestra «Ya tiene un viaje creado»: hay un viaje activo.'
      );
      await evidence.capture('01-home');

      const pair = passengerAddressesFor(process.env.PAX_NEWTRIP_REGION);
      let prepared: Awaited<ReturnType<NewTripPBO['prepareTrip']>>;
      try {
        prepared = await tripPbo.prepareTrip(pair, { timeoutMs: 45_000 });
      } catch (error) {
        if (error instanceof NewTripFormNotFoundError) {
          test.skip(
            true,
            `El home no muestra el formulario de viaje (¿viaje activo?): ${error.message}`
          );
        }
        throw error;
      }
      await evidence.capture('02-origen-destino-preparados');

      expect(prepared.originValue, 'el origen queda con valor').not.toBe('');
      expect(prepared.destinationValue, 'el destino queda con valor').not.toBe('');
      expect(prepared.confirmEnabled, 'el CTA de continuar está presente y habilitado').toBe(true);
    } finally {
      if (tripPbo) await tripPbo.leaveWithoutConfirming().catch(() => undefined);
      if (ctx) {
        await ctx.evidence.capture('99-sin-confirmar').catch(() => undefined);
        await attachEvidence(testInfo, ctx.evidence);
        await closePassengerSpec(ctx);
      }
    }
  });
});
