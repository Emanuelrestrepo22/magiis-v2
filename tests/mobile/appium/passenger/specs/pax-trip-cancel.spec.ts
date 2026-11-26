/**
 * PAX-TRIP-CANCEL — validar el estado «buscando conductor» de un viaje recién pedido (P-20) y su cancelación desde
 * la app Pasajero (P-21).
 *
 * QUÉ AFIRMA
 *   T1. Tras pedir UN viaje (formulario -> «Seleccionar Vehículo» -> «Viajo Ahora»), la app muestra el estado
 *       SEARCHING_DRIVER («Buscando servicio…» / «We are looking for vehicles») con el botón «Cancelar Viaje».
 *   T2. Cancelar desde la app («Cancelar Viaje» -> «Si»/«Yes») vuelve al home y el pre-chequeo de solo lectura ya no
 *       ve un viaje activo.
 *
 * PLAN DE CORRIDA
 *   Comando:    PAX_TRIP_CREATE=1 ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-trip-cancel.spec.ts
 *   Dispositivo: emulador/equipo con la app Pasajero instalada, Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (debe ser test),
 *               ANDROID_UDID, ANDROID_PASSENGER_APP_PACKAGE, las credenciales PAX (ver `pax-login.spec.ts`),
 *               PAX_NEWTRIP_REGION (opcional, AR|US|FR) y PAX_TRIP_CREATE=1 (compuerta; se lee SOLO acá).
 *   Precondición: el pasajero de las credenciales NO tiene un viaje activo (pre-chequeo de solo lectura con
 *               `ActiveTripPBO`) y tiene un método de pago ya elegido por defecto en `travel-info` (el spec no
 *               cambia el método de pago). Si ya hay un viaje activo, el spec se saltea: ese viaje es ajeno y
 *               NUNCA se cancela.
 *   Efectos:    CREA 1 viaje real en TEST (vía `TripRequestPBO.confirmTrip({ confirmed: true })`) y lo CANCELA
 *               (vía `TripCancelPBO.cancelActiveTrip({ confirmed: true })`). El `finally` intenta cancelarlo SIEMPRE
 *               que se haya llegado a pedir el viaje; si la cancelación falla, el spec falla con el código del
 *               viaje y pide cancelarlo MANUALMENTE desde Carrier web. Sin PAX_TRIP_CREATE=1, o con ENV distinto de
 *               test, se saltea con motivo y no se crea ningún viaje. Nunca se toca «Llamar» ni acciones de pago.
 *               Si el diálogo de cancelación trae un aviso de costo, se registra en el log (no se oculta).
 *   Bloqueo conocido (24/11/2026): en los emuladores el login PAX queda en `/login` por FIS_AUTH_ERROR de FCM
 *               (ver `pax-login.spec.ts`); locators y flujo relevados del código (develop) y de V1. Validación en
 *               vivo pendiente.
 *   Fuera de alcance: cancelar con conductor asignado (aviso de costo), estados posteriores (EN CURSO), viajes
 *               programados, cancelación desde Carrier.
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
import { ActiveTripPBO } from '../../pbo/ActiveTripPBO.js';
import { NewTripPBO } from '../../pbo/NewTripPBO.js';
import { TripCancelPBO, planTripCancelRun } from '../../pbo/TripCancelPBO.js';
import { TripRequestPBO } from '../../pbo/TripRequestPBO.js';

/** Compuerta explícita (opt-in). Solo se lee acá, nunca en screens/pbo. */
const CREATE_GATE_ENV = 'PAX_TRIP_CREATE';

test.describe('@mobile @no-xray App Pasajero · estado del viaje y cancelación', () => {
  test.describe.configure({ timeout: 420_000 });

  test('PAX-TRIP-CANCEL · Validar que un viaje recién pedido muestra «Buscando servicio» y que al cancelarlo la app vuelve al home sin viaje activo', async ({}, testInfo) => {
    // Compuertas ANTES de abrir la sesión: sin ellas no se hace nada en el dispositivo.
    const gateOpen = process.env[CREATE_GATE_ENV] === '1';
    test.skip(
      !gateOpen,
      `Compuerta cerrada: definir ${CREATE_GATE_ENV}=1 para crear (y cancelar) UN viaje en TEST. No se creó ningún viaje.`
    );
    test.skip(
      !process.env.APPIUM_SERVER_URL,
      'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
    );
    const config = getPassengerAppConfig();
    const envReason = environmentSkipReason(config.environment);
    test.skip(envReason !== null, envReason ?? '');
    test.skip(
      config.environment !== 'test',
      `Este spec crea un viaje real: solo corre con ENV=test (entorno actual: ${config.environment}). No se creó ningún viaje.`
    );

    const ctx = await openPassengerSpec('pax-trip-cancel');
    const cancelPbo = TripCancelPBO.forSession(ctx.session, ctx.log);
    // `true` desde que se intenta confirmar: aunque el resultado sea desconocido, el viaje PUEDE existir.
    let tripMayExist = false;
    let cancelled = false;
    let tripCode: string | null = null;
    try {
      const { pbo } = ctx;
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
          throw error;
        }
        await pbo.loginOrFail(
          { email: credentials.email, password: credentials.password },
          { timeoutMs: 90_000 }
        );
        state = await pbo.waitForStableSessionState();
      }
      test.skip(
        state.kind === 'login' || state.kind === 'unknown',
        `Requiere sesión iniciada (estado: ${state.kind}).`
      );

      // Pre-chequeo de SOLO LECTURA: un viaje activo previo es ajeno; no se crea ni se cancela nada.
      const preCheck = await ActiveTripPBO.forSession(ctx.session).observeActiveTrip({
        timeoutMs: 20_000
      });
      await ctx.evidence.capture('01-estado-al-abrir');
      const plan = planTripCancelRun({
        gateOpen,
        environment: config.environment,
        preCheck
      });
      test.skip(!plan.proceed, plan.proceed ? '' : plan.reason);

      const newTrip = NewTripPBO.forSession(ctx.session, ctx.log);
      test.skip(
        !(await newTrip.isFormShown()),
        'El formulario de nuevo viaje no está disponible (la app no muestra el home de pedido). No se creó ningún viaje.'
      );
      await newTrip.prepareTrip(passengerAddressesFor(process.env.PAX_NEWTRIP_REGION), {
        timeoutMs: 45_000
      });
      await ctx.evidence.capture('02-formulario-preparado');

      const request = TripRequestPBO.forSession(ctx.session, { log: ctx.log });
      const proceed = await request.proceedToTripInfo({ confirmed: true });
      expect(proceed.outcome, 'la app llega a travel-info sin avisos de bloqueo').toBe('trip-info');
      await ctx.evidence.capture('03-travel-info');

      // T1 — pedir UN viaje y ver «Buscando servicio».
      tripMayExist = true;
      const created = await request.confirmTrip({ confirmed: true });
      if (created.outcome !== 'created') tripMayExist = false;
      expect(
        created.outcome,
        'el viaje se crea (no hay bloqueo por viaje activo ni por crédito)'
      ).toBe('created');
      if (created.outcome !== 'created') return;
      tripCode = created.tripCode;

      const searching = await cancelPbo.waitForState(['SEARCHING_DRIVER'], 20_000);
      tripCode = searching.tripCode ?? tripCode;
      await ctx.evidence.capture('04-buscando-conductor');
      expect(searching.state, 'T1: el estado del viaje es SEARCHING_DRIVER').toBe(
        'SEARCHING_DRIVER'
      );
      expect(searching.cancelCtaVisible, 'T1: se ofrece «Cancelar Viaje»').toBe(true);

      // T2 — cancelar y volver al home sin viaje activo.
      const result = await cancelPbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 30_000 });
      cancelled = true;
      await ctx.evidence.capture('05-tras-cancelar');
      expect(result.cancelled, 'T2: la cancelación se confirmó').toBe(true);
      expect(result.landedOnHome, 'T2: la app vuelve al home').toBe(true);
      if (result.cancellationCost) {
        ctx.log(`AVISO de costo de cancelación: ${result.cancellationCost.text}`);
      }
      const after = await ActiveTripPBO.forSession(ctx.session).observeActiveTrip({
        timeoutMs: 8_000
      });
      expect(after.active, 'T2: el pre-chequeo ya no ve un viaje activo').toBe(false);
    } finally {
      let cleanupError: Error | null = null;
      if (tripMayExist && !cancelled) {
        // Limpieza: solo si la app muestra un viaje activo (el pre-chequeo garantizó que no había uno ajeno).
        try {
          const status = await cancelPbo.readStatus();
          tripCode = status.tripCode ?? tripCode;
          if (status.state !== 'NONE') {
            await cancelPbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 30_000 });
            ctx.log(`Limpieza: viaje ${tripCode ?? 'n/d'} cancelado en el finally.`);
          }
        } catch (error) {
          cleanupError = new Error(
            `NO SE PUDO CANCELAR el viaje creado por este spec (código=${tripCode ?? 'n/d'}): ` +
              `${error instanceof Error ? error.message : String(error)} ` +
              'CANCELARLO MANUALMENTE desde Carrier web.'
          );
        }
      }
      await attachEvidence(testInfo, ctx.evidence);
      await closePassengerSpec(ctx);
      if (cleanupError) throw cleanupError;
    }
  });
});
