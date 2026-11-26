/**
 * TM-1099 · TC118 — Validar la carga de un concepto tipo Fijo por el chofer sobre el viaje en curso.
 * Smoke de Universal F1 · Otros Costos (MG-995 / MG-996). Migrado de V1
 * (`other-costs-driver-close-smoke.spec.ts`, rama `test/driver-core-specs` = `mobile/driver-otros-costos-tm1099`,
 * idénticas) a la plataforma mobile de V2: screens/PBO nuevos (`OtherCostsModalScreen`, `OtherCostsSummaryScreen`,
 * `OtherCostsPBO`) + clientes API de V2 (`OtherCostsClient`, `TravelsClient`, `CarrierSession`).
 *
 * QUÉ AFIRMA (cuando el gate está abierto): el modal ofrece el concepto Fijo (disponible Chofer), prefija el importe
 * del catálogo y no lo deja editar; el Resumen lo suma en «Otros costos»; con cuenta corriente el cierre es con firma
 * y el viaje persiste el concepto con ese importe (`GET carriers/{id}/travels/{id}`, mismo dato que el portal) y el
 * total es aditivo (amount = tarifa + otros costos). En efectivo se registra lo observado sin afirmarlo (H-UAT-01:
 * la app aplicaba el descuento del carrier también a los otros costos).
 *
 * GATE DE DATOS: TODO lo que crea datos o cierra un viaje (alta del concepto, aceptar/iniciar/finalizar/cerrar)
 * exige `OTHER_COSTS_CREATE_DATA=1` Y `{ confirmed: true }` en cada acción irreversible. Sin el gate el spec se saltea
 * con motivo y NO abre sesión Appium, NO llama a la API y NO crea nada. Solo corre con ENV=test (nunca UAT ni PROD).
 *
 * PLAN DE CORRIDA
 *   Comando (sin gate; verifica el skip):  npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/driver/specs/other-costs-driver-close-smoke.spec.ts
 *   Comando (con gate):  OTHER_COSTS_CREATE_DATA=1 OTHER_COSTS_TRAVEL_ID=<id> <el mismo comando>
 *   Claves de entorno (solo nombres): APPIUM_SERVER_URL, ENV=test, ANDROID_DRIVER_UDID (o ANDROID_UDID),
 *               MOBILE_CREDENTIALS_FILE, MOBILE_ENV_OVERLAY, OTHER_COSTS_CREATE_DATA, OTHER_COSTS_TRAVEL_ID
 *               (con gate), sesión del carrier en `storage/state-carrier-test.json` (`loadCarrierSession`).
 *   Precondición (gate abierto): chofer logueado en la app TEST sin viaje en curso, y un viaje YA creado en el portal
 *               y asignado a ese chofer (`OTHER_COSTS_TRAVEL_ID`). V2 NO tiene cliente de alta de viaje por API
 *               (V1 usaba `CarrierTravelsApi.create`): el viaje es un fixture externo, no se crea con HTTP crudo.
 *   Duración:   sin gate < 5 s; con gate ~5-8 min.
 *   Limpieza (con gate): borra el concepto por API, deja al chofer «No disponible». Un viaje que quedó en el Resumen
 *               se cierra desde la app con cuenta corriente (la API ya no permite cancelarlo ahí).
 *   NO VALIDADO EN VIVO con gate abierto: la rama con datos no se ejecutó nunca en V2 (no hay viaje fixture ni datos
 *               de TEST relevados; los de V1 son de UAT). GPS/km: no se simula (el cierre usa el km que mida la app).
 *   Xray: key TM-1099 (Test existente) vía `xrayKeyAnnotations`; `@smoke @other-costs`.
 */

import { test, expect, request } from '@playwright/test';
import { envFlagGate, evaluateGates } from '../../core/Gates.js';
import {
  attachEvidence,
  closeDriverSpec,
  credentialsSkipReason,
  environmentSkipReason,
  openDriverSpec,
  resolveDriverSpecProfile,
  xrayKeyAnnotations
} from '../../harness/DriverSpecKit.js';
import type { DriverSpecContext } from '../../harness/DriverSpecKit.js';
import { getDriverAppConfig } from '../../config/appiumRuntime.js';
import { OfferPBO } from '../../pbo/OfferPBO.js';
import { TripLifecyclePBO } from '../../pbo/TripLifecyclePBO.js';
import {
  OtherCostsPBO,
  buildOtherCostsComment,
  isAdditiveTotal,
  parseShownMoney,
  type OtherCostsMeasurement
} from '../../pbo/OtherCostsPBO.js';
import { loadCarrierSession } from '../../../../api/clients/carrierSession.js';
import { OtherCostsClient, type OtherCostItem } from '../../../../api/clients/otherCosts.client.js';
import { TravelsClient, type TravelDetail } from '../../../../api/clients/travels.client.js';
import {
  buildOtherCostName,
  fixedOtherCost,
  makeRunId
} from '../../../../fixtures/factories/otherCostFactory.js';

const TEST_KEY = 'TM-1099';
/** Concepto Fijo del caso (valores del plan TM-1116 §4): venta 10, costo 4, disponible Chofer. */
const SALE_VALUE = 10;
const COST_VALUE = 4;

/** Motivo para saltear por perfil no resoluble o credenciales ilegibles (null = se puede correr). */
function profileSkipReason(): string | null {
  try {
    return credentialsSkipReason(resolveDriverSpecProfile(process.env));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

test.describe('@mobile @smoke @other-costs App Chofer · Otros costos al cierre', () => {
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  test(
    `[${TEST_KEY}] TC118 · Validar la carga de un concepto tipo Fijo por el chofer sobre el viaje en curso`,
    { annotation: xrayKeyAnnotations(TEST_KEY) },
    async ({}, testInfo) => {
      // 1) Gate de datos: lo PRIMERO, antes de tocar dispositivo, API o archivos.
      const gate = evaluateGates([envFlagGate('OTHER_COSTS_CREATE_DATA', process.env)]);
      test.skip(
        !gate.open,
        `Crea datos reales (concepto) y cierra un viaje: requiere ${gate.missing.join(' y ')}.`
      );
      test.skip(
        !process.env.APPIUM_SERVER_URL,
        'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
      );
      const config = getDriverAppConfig();
      test.skip(
        config.environment !== 'test',
        `Este spec solo corre contra ENV=test (ENV=${config.environment}).`
      );
      const envReason = environmentSkipReason(config.environment);
      test.skip(envReason !== null, envReason ?? '');
      const profileReason = profileSkipReason();
      test.skip(profileReason !== null, `Perfil del chofer no utilizable: ${profileReason ?? ''}`);
      const travelId = Number(process.env.OTHER_COSTS_TRAVEL_ID);
      test.skip(
        !Number.isInteger(travelId) || travelId <= 0,
        'Con el gate abierto requiere OTHER_COSTS_TRAVEL_ID: un viaje del portal ya asignado al chofer (V2 no crea viajes por API).'
      );

      const runId = makeRunId();
      const conceptName = buildOtherCostName('FIX', runId);
      const session = loadCarrierSession({ minValidityMs: 30 * 60_000 });
      const apiContext = await session.newApiContext(request);
      const otherCostsApi = new OtherCostsClient(apiContext, session);
      const travelsApi = new TravelsClient(apiContext, session);

      let ctx: DriverSpecContext | null = null;
      let concept: OtherCostItem | null = null;
      let initialAvailability: 'available' | 'notAvailable' | 'unknown' = 'unknown';
      const measurement: OtherCostsMeasurement = {
        env: config.environment,
        appPackage: config.appPackage,
        udid: config.udid,
        runId
      };
      const cleanup: Record<string, string> = {};

      try {
        ctx = await openDriverSpec('other-costs-driver-close');
        const live = ctx;
        const snap = async (label: string): Promise<void> => {
          await live.evidence.capture(label);
        };
        const lifecycle = TripLifecyclePBO.forSession(live.session, live.i18n, { log: live.log });
        const offer = OfferPBO.forSession(live.session, live.i18n, { log: live.log });
        const otherCosts = OtherCostsPBO.forSession(live.session, { log: live.log });

        await test.step('Precondiciones: chofer logueado en la app TEST, sin viaje en curso', async () => {
          const identity = await live.pbo.ensureLoggedIn(live.expectation);
          expect(identity.appPackage).toBe(config.appPackage);
          const state = await live.pbo.sessionState();
          if (state.kind === 'home')
            initialAvailability = (await live.pbo.readAvailability()).state;
        });

        await test.step('Dado un concepto Fijo con costo, disponible para el Chofer, en el catálogo', async () => {
          concept = await otherCostsApi.create(
            fixedOtherCost(
              {
                carrierId: session.carrierId,
                userId: session.subUserId,
                currencyId: null,
                runId,
                apply: ['DRIVER'],
                isCommisionable: true
              },
              SALE_VALUE,
              { cost: COST_VALUE }
            )
          );
          const row = (await otherCostsApi.search()).find((item) => item.id === concept!.id);
          expect(row, 'el concepto creado debe figurar en el catálogo').toBeDefined();
          expect(row!.conceptType).toBe('FIX');
          expect(row!.apply).toContain('DRIVER');
          measurement.concept = { name: conceptName, saleValue: SALE_VALUE };
        });

        await test.step('Y el chofer disponible acepta e inicia el viaje del portal', async () => {
          await live.pbo.setAvailability('available');
          await offer.assertOfferMatches({ travelId });
          await lifecycle.acceptAssignedTrip({ confirmed: true });
          await lifecycle.startTrip({ confirmed: true });
        });

        await test.step('Cuando finaliza el recorrido y llega al Resumen con «Otros costos» habilitado', async () => {
          await lifecycle.finishTrip({ confirmed: true });
          const before = await otherCosts.readSummary();
          expect(
            before.otherFees,
            'sin concepto cargado aún no hay línea de otros costos'
          ).toBeNull();
          await snap('01-resumen-sin-concepto');
        });

        await test.step('Y agrega el concepto Fijo desde «Otros costos»: importe del catálogo, no editable', async () => {
          const { form } = await otherCosts.addConcept(conceptName, { confirmed: true });
          measurement.form = form;
          expect(form.selectedConcept).toBe(conceptName);
          expect(parseShownMoney(form.amount), 'importe prefijado = venta del catálogo').toBe(
            SALE_VALUE
          );
          expect(form.amountEditable, 'un concepto Fijo no admite editar el importe').toBe(false);
          await snap('02-concepto-agregado');
        });

        await test.step('Entonces el Resumen suma el concepto con el importe del catálogo (cuenta corriente)', async () => {
          await otherCosts.selectPaymentMethod('CHECKING_ACCOUNT');
          const view = await otherCosts.readSummary();
          measurement.summary = view;
          expect(parseShownMoney(view.otherFees), 'Otros costos con cuenta corriente').toBe(
            SALE_VALUE
          );
          expect(view.otherFeeItems).toContainEqual(expect.stringContaining(conceptName));
          expect(
            parseShownMoney(view.otherFeeItems.find((i) => i.includes(conceptName))),
            'importe del ítem en el detalle de Otros costos'
          ).toBe(SALE_VALUE);
          await snap('03-resumen-con-concepto-cuenta-corriente');
        });

        await test.step('Y el viaje se cierra con firma (cuenta corriente)', async () => {
          const closed = await lifecycle.closeTrip({ confirmed: true });
          expect(closed.signed, 'cuenta corriente cierra con «Firmar y Cerrar viaje»').toBe(true);
          await snap('04-tras-cierre');
        });

        await test.step('Y el viaje persiste el concepto con la venta del catálogo y el total es aditivo', async () => {
          let detail: TravelDetail = await travelsApi.getDetail(travelId);
          const deadline = Date.now() + 20_000;
          while (detail.state !== 'DONE' && Date.now() < deadline) {
            detail = await travelsApi.getDetail(travelId);
          }
          measurement.apiDetail = {
            state: detail.state,
            paymentMethod: detail.paymentMethod,
            otherCost: detail.otherCost,
            amount: detail.amount
          };
          expect(detail.state).toBe('DONE');
          expect(detail.paymentMethod).toBe('CHECKING_ACCOUNT');
          const rows = (detail.otherCostList ?? []).filter((row) => row.name === conceptName);
          expect(rows, 'una fila del concepto en otherCostList').toHaveLength(1);
          expect(rows[0]!.price, 'precio del concepto en el viaje = venta del catálogo').toBe(
            SALE_VALUE
          );
          expect(detail.otherCost).toBe(SALE_VALUE);
          expect(
            isAdditiveTotal(detail.tourPrice, detail.otherCost, detail.amount),
            'amount = tarifa + otros costos (cuenta corriente)'
          ).toBe(true);
        });
      } finally {
        const attempt = async (label: string, fn: () => Promise<string>): Promise<void> => {
          try {
            cleanup[label] = await fn();
          } catch (error) {
            cleanup[label] = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
          }
        };

        await test.step('Limpieza', async () => {
          if (ctx) {
            const live = ctx;
            const otherCosts = OtherCostsPBO.forSession(live.session, { log: live.log });
            await attempt('modal', async () =>
              (await otherCosts.cancelModalIfOpen()) ? 'cancelado' : 'sin modal'
            );
            await attempt('chofer', async () => {
              const state = await live.pbo.sessionState();
              if (state.kind !== 'home')
                return `no está en el home (${state.kind}); revisar a mano`;
              if (initialAvailability !== 'available')
                await live.pbo.setAvailability('notAvailable');
              return initialAvailability === 'available'
                ? 'sin cambio (disponible)'
                : 'No disponible';
            });
          }
          const toDelete = concept as OtherCostItem | null;
          if (toDelete) {
            await attempt('concepto', async () =>
              (await otherCostsApi.remove(toDelete.id))
                ? `borrado (${toDelete.id})`
                : 'ya no estaba'
            );
          }
        });

        measurement.cleanup = cleanup;
        if (ctx) await attachEvidence(testInfo, ctx.evidence);
        testInfo.annotations.push({
          type: 'xray_comment',
          description: buildOtherCostsComment(measurement)
        });
        await apiContext.dispose();
        await closeDriverSpec(ctx);
      }
    }
  );
});
