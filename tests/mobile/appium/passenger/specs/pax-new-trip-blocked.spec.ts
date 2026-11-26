/**
 * PAX-NEW-TRIP-BLOCKED — validar que un pasajero que YA tiene un viaje activo no puede pedir uno nuevo desde la
 * app (TC-PAX-NEW-TRIP-BLOCKED de V1, PASO-4..6, reescrito para el comportamiento real de la app).
 *
 * QUÉ AFIRMA
 *   T1. Con un viaje activo creado antes desde Carrier, la app NO muestra el formulario de nuevo viaje: al entrar
 *       al home redirige a la pantalla del viaje en curso (`DriverAvailablePages` «Buscando servicio…» o
 *       `travel-in-progress`). Solo lectura.
 *   T2. El bloqueo persiste: una segunda lectura, sin tocar nada, sigue mostrando el viaje activo y no el
 *       formulario (equivale al «segundo intento» del PASO-6 de V1). Solo lectura.
 *   T3. (CON COMPUERTA) Si el formulario es alcanzable estando el pasajero con viaje activo, pedir el viaje muestra
 *       «Ya tiene un viaje creado» / «You already have a trip created» (`passenger_unavailable`) o «No se puede
 *       solicitar un nuevo Viaje en este momento» (`passenger_already_traveling`) y «Aceptar» lo cierra.
 *
 * COMPORTAMIENTO REAL DE LA APP (develop; ver ActiveTripScreen): al entrar al home `checkStatus()` consulta
 *   `GET /passengers/{id}/currentTrip` y, si hay viaje, navega fuera del home. Por eso en V1 el «modal tras Viajo
 *   Ahora» (PASO-4/5) solo se ve cuando `currentTrip` no devuelve el viaje; T3 queda como camino de bajo uso y,
 *   por diseño, se saltea salvo que se cumplan la compuerta Y el pre-chequeo positivo (ver «Efectos»).
 *
 * PLAN DE CORRIDA
 *   Comando:    ENV=test npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-new-trip-blocked.spec.ts
 *   Dispositivo: emulador/equipo con la app Pasajero instalada, Appium arriba.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (test|uat), ANDROID_UDID,
 *               ANDROID_PASSENGER_APP_PACKAGE, las credenciales PAX (ver `pax-login.spec.ts`),
 *               PAX_NEWTRIP_REGION (opcional, AR|US|FR) y PAX_TRIP_BLOCKED_PRECONDITION=1 (compuerta de T3).
 *   Precondición: el pasajero de las credenciales tiene un viaje ACTIVO creado ANTES desde el Carrier web, en
 *               estado SEARCHING_DRIVER (Por asignar), WITH_DRIVER_ASSIGNED, EN_CURSO o equivalente. Si la app
 *               no muestra un viaje activo, T1/T2/T3 se saltean con motivo (0 viajes creados).
 *   Efectos:    T1 y T2 son de solo lectura (no tocan «Cancelar Viaje» ni ningún CTA). T3 SOLO toca el CTA final si
 *               (a) PAX_TRIP_BLOCKED_PRECONDITION=1 y (b) el pre-chequeo de solo lectura vio el viaje activo en la
 *               app, y el formulario es alcanzable; el orden lo impone `BlockedTripPBO.planBlockedAttempt`. Si
 *               pese a ello la app CREA un viaje, T3 falla con el código y pide cancelarlo MANUALMENTE desde
 *               Carrier (nunca se cancela solo). Sin la precondición no se crea ningún viaje.
 *   Bloqueo conocido (24/11/2026): en los emuladores el login PAX queda en `/login` por FIS_AUTH_ERROR de FCM
 *               (ver `pax-login.spec.ts`); locators y comportamiento relevados del código (develop) y de V1.
 *               Validación en vivo pendiente.
 *   Fuera de alcance: estados sin `currentTrip` (NO_AUTORIZADO / En conflicto) sin viaje observable en la app,
 *               cancelar el viaje previo, viajes programados.
 *   Xray: `@no-xray` (aún sin Test asignado).
 */

import { test, expect } from '@playwright/test';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import { sleep } from '../../core/Waits.js';
import { passengerAddressesFor } from '../../data/passengerAddresses.js';
import { resolvePassengerCredentials } from '../../data/passengerCredentials.js';
import {
  attachEvidence,
  closePassengerSpec,
  environmentSkipReason,
  openPassengerSpec
} from '../../harness/PassengerSpecKit.js';
import type { PassengerSpecContext } from '../../harness/PassengerSpecKit.js';
import { ActiveTripPBO, type ActiveTripObservation } from '../../pbo/ActiveTripPBO.js';
import { BlockedTripPBO, planBlockedAttempt } from '../../pbo/BlockedTripPBO.js';
import { NewTripPBO } from '../../pbo/NewTripPBO.js';
import { TripRequestPBO } from '../../pbo/TripRequestPBO.js';

/** Compuerta explícita de T3 (opt-in). Solo se lee acá, nunca en screens/pbo. */
const PRECONDITION_GATE_ENV = 'PAX_TRIP_BLOCKED_PRECONDITION';

type Opened = {
  ctx: PassengerSpecContext;
  activeTrip: ActiveTripPBO;
  observation: ActiveTripObservation;
};

/** Abre la sesión, inicia sesión si hace falta y observa (solo lectura) si la app muestra un viaje activo. */
async function openAndObserve(spec: string): Promise<Opened> {
  test.skip(
    !process.env.APPIUM_SERVER_URL,
    'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
  );
  const config = getPassengerAppConfig();
  const envReason = environmentSkipReason(config.environment);
  test.skip(envReason !== null, envReason ?? '');

  const ctx = await openPassengerSpec(spec);
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
    const activeTrip = ActiveTripPBO.forSession(ctx.session);
    const observation = await activeTrip.observeActiveTrip({ timeoutMs: 20_000 });
    return { ctx, activeTrip, observation };
  } catch (error) {
    await closePassengerSpec(ctx);
    throw error;
  }
}

const skipNoActiveTrip = (o: ActiveTripObservation): string =>
  `Precondición no cumplida: la app no muestra un viaje activo (url: ${o.url || 'n/d'}). ` +
  'Crear antes el viaje desde Carrier web para este pasajero. No se creó ningún viaje.';

test.describe('@mobile @no-xray App Pasajero · bloqueo de nuevo viaje con viaje activo', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('PAX-NEW-TRIP-BLOCKED-T1 · Validar que con un viaje activo la app muestra el viaje en curso y no el formulario de nuevo viaje', async ({}, testInfo) => {
    const { ctx, observation } = await openAndObserve('pax-new-trip-blocked-t1');
    try {
      await ctx.evidence.capture('01-estado-al-abrir');
      test.skip(!observation.active, skipNoActiveTrip(observation));

      const form = await NewTripPBO.forSession(ctx.session, ctx.log).isFormShown();
      expect(observation.kind, 'la app muestra la pantalla de un viaje activo').not.toBeNull();
      expect(form, 'el formulario de nuevo viaje no está disponible con un viaje activo').toBe(
        false
      );
    } finally {
      await attachEvidence(testInfo, ctx.evidence);
      await closePassengerSpec(ctx);
    }
  });

  test('PAX-NEW-TRIP-BLOCKED-T2 · Validar que el bloqueo persiste con el viaje activo en una segunda lectura sin tocar nada', async ({}, testInfo) => {
    const { ctx, activeTrip, observation } = await openAndObserve('pax-new-trip-blocked-t2');
    try {
      test.skip(!observation.active, skipNoActiveTrip(observation));
      await ctx.evidence.capture('01-primera-lectura');
      await sleep(5_000);
      const second = await activeTrip.observeActiveTrip({ timeoutMs: 10_000 });
      await ctx.evidence.capture('02-segunda-lectura');

      expect(second.active, 'la segunda lectura sigue mostrando el viaje activo').toBe(true);
      expect(second.kind, 'es el mismo tipo de pantalla que en la primera lectura').toBe(
        observation.kind
      );
      expect(
        await NewTripPBO.forSession(ctx.session, ctx.log).isFormShown(),
        'el formulario de nuevo viaje sigue sin estar disponible'
      ).toBe(false);
    } finally {
      await attachEvidence(testInfo, ctx.evidence);
      await closePassengerSpec(ctx);
    }
  });

  test('PAX-NEW-TRIP-BLOCKED-T3 · Validar que pedir un nuevo viaje con viaje activo muestra «Ya tiene un viaje creado» y «Aceptar» lo cierra', async ({}, testInfo) => {
    // Compuerta ANTES de abrir la sesión: sin opt-in no se hace nada en el dispositivo.
    const gateOpen = process.env[PRECONDITION_GATE_ENV] === '1';
    test.skip(
      !gateOpen,
      `Compuerta cerrada: definir ${PRECONDITION_GATE_ENV}=1 SOLO si el pasajero ya tiene un viaje activo creado desde Carrier. No se creó ningún viaje.`
    );

    const { ctx, observation } = await openAndObserve('pax-new-trip-blocked-t3');
    let tripPbo: NewTripPBO | null = null;
    try {
      const plan = planBlockedAttempt({ gateOpen, preCheck: observation });
      test.skip(!plan.proceed, plan.proceed ? '' : plan.reason);

      tripPbo = NewTripPBO.forSession(ctx.session, ctx.log);
      test.skip(
        !(await tripPbo.isFormShown()),
        'La app redirige al viaje activo y no ofrece el formulario: el aviso de bloqueo no es alcanzable (se cubre en T1/T2). No se creó ningún viaje.'
      );
      await ctx.evidence.capture('01-formulario-con-viaje-activo');
      await tripPbo.prepareTrip(passengerAddressesFor(process.env.PAX_NEWTRIP_REGION), {
        timeoutMs: 45_000
      });

      const request = TripRequestPBO.forSession(ctx.session, { log: ctx.log });
      const result = await new BlockedTripPBO({ trip: request }).attempt({
        gateOpen,
        preCheck: observation
      });
      await ctx.evidence.capture('02-resultado-del-intento');

      expect(result.status, 'la app bloquea el nuevo viaje (no lo crea ni hay otro bloqueo)').toBe(
        'blocked'
      );
      if (result.status !== 'blocked') return;
      expect(result.message, 'el aviso es el bloqueo por viaje activo').toMatch(
        /ya tiene un viaje creado|you already have a trip created|no se puede solicitar un nuevo viaje|cannot request a new travel/i
      );
      if (!result.dismissed) await request.dismissTripAlreadyCreatedModal();
      await ctx.evidence.capture('03-aviso-cerrado');
      expect(
        await request.detectBlockingDialog(),
        '«Aceptar» cerró el aviso de bloqueo'
      ).toBeNull();
    } finally {
      if (tripPbo) await tripPbo.leaveWithoutConfirming().catch(() => undefined);
      await attachEvidence(testInfo, ctx.evidence);
      await closePassengerSpec(ctx);
    }
  });
});
