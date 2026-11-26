/**
 * Corredor común de los specs de pasarela PAX sin 3DS (personal / business). NO es un spec: lo importan
 * `pax-gateway-personal-no3ds.spec.ts` y `pax-gateway-business-no3ds.spec.ts`, que leen las variables de entorno y
 * las pasan acá como valores (acá NO se lee `process.env`). Compone `PassengerJourneyPBO`.
 */

import { test, expect } from '@playwright/test';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import {
  gatewayScenariosFor,
  parseGatewayCardLast4,
  type GatewayProfileMode
} from '../../data/gatewayScenarios.js';
import { passengerAddressesFor } from '../../data/passengerAddresses.js';
import { resolvePassengerCredentials } from '../../data/passengerCredentials.js';
import {
  attachEvidence,
  closePassengerSpec,
  environmentSkipReason,
  openPassengerSpec,
  type PassengerSpecContext
} from '../../harness/PassengerSpecKit.js';
import { PassengerJourneyPBO, planGatewayJourneyRun } from '../../pbo/PassengerJourneyPBO.js';
import { ProfileModeUnavailableError } from '../../pbo/PassengerHomePBO.js';

export type GatewaySpecEnv = {
  /** `GATEWAY_E2E === '1'`. */
  gatewayGateOpen: boolean;
  /** `PAX_TRIP_CREATE === '1'`. */
  tripGateOpen: boolean;
  /** Valor crudo de `PAX_GATEWAY_CARD_LAST4` (opcional). */
  cardLast4Raw: string | undefined;
  /** Valor crudo de `PAX_NEWTRIP_REGION` (opcional). */
  region: string | undefined;
  /** `Boolean(APPIUM_SERVER_URL)`. */
  appiumConfigured: boolean;
};

const TITLE_PREFIX = 'Validar que se puede';

/** Registra un test por escenario del modo. Los inactivos se saltean con su motivo. */
export function defineGatewaySpec(mode: GatewayProfileMode, env: GatewaySpecEnv): void {
  for (const scenario of gatewayScenariosFor(mode)) {
    const suffix = scenario.active
      ? ': el viaje queda «Buscando servicio» con la tarjeta elegida y se cancela al terminar'
      : ' (inactivo: requiere al actor Chofer)';

    test(`${scenario.id} · ${TITLE_PREFIX} ${scenario.title}${suffix}`, async ({}, testInfo) => {
      // Compuertas ANTES de abrir la sesión: sin ellas no se toca el dispositivo.
      test.skip(
        !scenario.active,
        `Escenario inactivo: ${scenario.inactiveReason ?? 'sin motivo declarado'}.`
      );
      const early = planGatewayJourneyRun({
        gatewayGateOpen: env.gatewayGateOpen,
        tripGateOpen: env.tripGateOpen,
        environment: env.appiumConfigured ? getPassengerAppConfig().environment : 'n/d',
        activeTripExists: null,
        cardAvailable: null,
        scenarioActive: scenario.active
      });
      test.skip(
        !env.appiumConfigured,
        'Requiere APPIUM_SERVER_URL y el dispositivo conectado. No se creó ningún viaje.'
      );
      test.skip(!early.proceed, early.proceed ? '' : early.reason);
      const config = getPassengerAppConfig();
      const envReason = environmentSkipReason(config.environment);
      test.skip(envReason !== null, envReason ?? '');
      const last4 = parseGatewayCardLast4(env.cardLast4Raw);
      test.skip(
        last4 === null,
        'PAX_GATEWAY_CARD_LAST4 no tiene al menos 4 dígitos. No se creó ningún viaje.'
      );
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
      const cardLast4 = last4 as string;

      let ctx: PassengerSpecContext | null = null;
      let journey: PassengerJourneyPBO | null = null;
      let modeToRestore: GatewayProfileMode | null = null;
      let cleanupError: Error | null = null;
      try {
        ctx = await openPassengerSpec(`pax-gateway-${mode}`);
        journey = PassengerJourneyPBO.forSession(ctx.session, ctx.log);
        await journey.ensureSession(
          { email: credentials.email, password: credentials.password },
          { timeoutMs: 90_000 }
        );

        try {
          const switched = await journey.ensureProfileMode(mode);
          if (switched.changed) modeToRestore = switched.from;
        } catch (error) {
          if (error instanceof ProfileModeUnavailableError) {
            test.skip(true, `Modo ${mode} no disponible para esta cuenta: ${error.message}`);
          }
          throw error;
        }

        // Pre-chequeo de SOLO LECTURA: un viaje activo previo es ajeno; no se crea ni se cancela nada.
        const activeTripExists = await journey.hasActiveTrip(20_000);
        await ctx.evidence.capture('01-estado-al-abrir');
        const pre = planGatewayJourneyRun({
          gatewayGateOpen: env.gatewayGateOpen,
          tripGateOpen: env.tripGateOpen,
          environment: config.environment,
          activeTripExists,
          cardAvailable: null,
          scenarioActive: scenario.active
        });
        test.skip(!pre.proceed, pre.proceed ? '' : pre.reason);

        await journey.prepareTrip(passengerAddressesFor(env.region), 45_000);
        await ctx.evidence.capture('02-formulario-preparado');
        await journey.proceedToTripInfo({ confirmed: true });
        await ctx.evidence.capture('03-travel-info');

        // Tarjeta EXISTENTE por últimos 4 (nunca se agrega ni se elimina). Si no está, se saltea sin crear nada.
        const card = await journey.selectExistingCard(cardLast4);
        const finalPlan = planGatewayJourneyRun({
          gatewayGateOpen: env.gatewayGateOpen,
          tripGateOpen: env.tripGateOpen,
          environment: config.environment,
          activeTripExists,
          cardAvailable: card.selected,
          scenarioActive: scenario.active
        });
        test.skip(
          !finalPlan.proceed,
          finalPlan.proceed
            ? ''
            : `${finalPlan.reason}${card.selected ? '' : ` Detalle: ${card.reason}`}`
        );
        if (!card.selected) return;
        await ctx.evidence.capture('04-tarjeta-elegida');
        expect(card.selection.type, 'el método de pago elegido es tarjeta').toBe('credit-card');
        expect(card.selection.last4, 'la tarjeta elegida es la pedida (últimos 4)').toBe(cardLast4);

        const created = await journey.createTrip({ confirmed: true });
        expect(
          created.outcome,
          'el viaje se crea (sin bloqueo por viaje activo ni por crédito)'
        ).toBe('created');

        const searching = await journey.observeUntil('SEARCHING_DRIVER', 20_000);
        await ctx.evidence.capture('05-buscando-conductor');
        expect(searching.state, 'el viaje queda en SEARCHING_DRIVER').toBe('SEARCHING_DRIVER');
        expect(searching.cancelCtaVisible, 'se ofrece «Cancelar Viaje»').toBe(true);
      } finally {
        if (journey?.tripMayExist) {
          try {
            const result = await journey.cancelCreatedTrip({ confirmed: true });
            if (result.attempted && result.result?.cancellationCost) {
              ctx?.log(`AVISO de costo de cancelación: ${result.result.cancellationCost.text}`);
            }
            if (result.attempted && result.result) {
              expect
                .soft(result.result.landedOnHome, 'tras cancelar la app vuelve al home')
                .toBe(true);
            }
          } catch (error) {
            cleanupError = error instanceof Error ? error : new Error(String(error));
          }
        }
        if (journey && modeToRestore) {
          // Best effort: devolver el modo de perfil que tenía la cuenta (solo si el viaje ya no existe).
          if (!journey.tripMayExist) {
            await journey.ensureProfileMode(modeToRestore).catch((error: unknown) => {
              ctx?.log(
                `No se pudo restaurar el modo ${modeToRestore}: ${error instanceof Error ? error.message : String(error)}`
              );
            });
          }
        }
        if (ctx) await attachEvidence(testInfo, ctx.evidence);
        await closePassengerSpec(ctx);
        if (cleanupError) throw cleanupError;
      }
    });
  }
}
