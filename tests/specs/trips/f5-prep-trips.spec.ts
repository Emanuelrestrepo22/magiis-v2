// tests/specs/trips/f5-prep-trips.spec.ts
// Universal F5 (MG-1027) · PREPARACION de datos del circuito administrativo multi-carrier (plan
// docs/qa/f5-admin-circuit-multicarrier-plan.md §4.2). Por cada escenario pedido: alta por UI con «Send Manual»
// (NUNCA «Send Service» ni el boton «A») -> cancelar -> «Administrative finalization» por API con el chofer del
// par PROPIO de QA -> viaje cerrado listo para la vista previa y la rendicion. NO rinde, NO confirma, NO liquida,
// NO edita propietario/vehiculo: la guarda de red aborta cualquier escritura fuera de la allowlist.
//
// Gate (valor exacto `1`; sin el se salta ANTES de abrir el navegador): CIRCUIT_PREP_CREATE_TRIPS=1. Los viajes
// quedan PERMANENTES (DONE) y anotados en el ledger `admin-circuit`; nada los barre.
// Seleccion: CIRCUIT_CARRIER=<1040-uat|1481-uat|2021-uat> · ENV=uat · F5_PREP_SCENARIOS=EF-NC-COM[,CC,...] ·
// F5_PREP_PAIR=<clave de par del perfil> (default: prep.defaultPair). EF-FARE0 exige ademas FR_EDIT_AFTER_SURRENDER=1.
// Sin retries (un reintento duplicaria viajes permanentes): el test lanza si testInfo.retry > 0.
// No acredita veredicto a ningun Test de Xray (D12): el veredicto lo da el spec de verificacion/confirmacion con
// su evidencia. Annotation `tc` sin `tms` (como fr-circuit-s3-prepare).
// Ejecucion: npx cross-env CIRCUIT_CARRIER=1040-uat ENV=uat CIRCUIT_PREP_CREATE_TRIPS=1 F5_PREP_SCENARIOS=EF-NC-COM npm run test:f5:prep
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import {
  isCircuitCarrierExplicit,
  loadCarrierProfile,
  type CarrierProfile
} from '../../config/carrier-profiles.js';
import { getCurrentEnv, isCircuitGateOpen, isFrGateOpen } from '../../config/runtime.js';
import {
  PREP_SCENARIOS,
  parseScenarioList,
  prepNote,
  scenarioCosts,
  type PrepScenarioId
} from '../../data/carrier-v2/trips/prep-scenarios.js';
import {
  assertEnvMatchesProfile,
  assertOwnPair,
  formatClosureMismatches,
  detailDriverId
} from '../../helpers/circuit-guards.js';
import { installWriteGuard } from '../../helpers/network-guard.js';
import { ADMIN_CIRCUIT_LEDGER_SCOPE, ledgerList } from '../../helpers/trip-ledger.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';

function skipReason(): string | null {
  if (!isCircuitGateOpen('CIRCUIT_PREP_CREATE_TRIPS')) {
    return 'requiere CIRCUIT_PREP_CREATE_TRIPS=1 (crea viajes permanentes)';
  }
  if (!isCircuitCarrierExplicit()) {
    return 'requiere CIRCUIT_CARRIER=<perfil UAT> explicito (1040-uat | 1481-uat | 2021-uat)';
  }
  return null;
}

const SKIP = skipReason();
// Con el gate abierto un escenario invalido FALLA al cargar (nunca se ignora en silencio).
const SCENARIOS: PrepScenarioId[] =
  SKIP === null ? parseScenarioList(process.env.F5_PREP_SCENARIOS) : [];
const NO_SCENARIOS = SKIP === null && SCENARIOS.length === 0;

test.describe('F5 preparacion de datos · circuito administrativo multi-carrier @data-prep @uat @irreversible', () => {
  test.skip(SKIP !== null, `F5 prep saltado: ${SKIP ?? ''}`);
  test.skip(NO_SCENARIOS, 'F5 prep saltado: F5_PREP_SCENARIOS vacio (ej. EF-NC-COM,CC)');
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  if (SCENARIOS.length === 0) {
    // Marcador para que el reporte muestre el MOTIVO del salto (sin esto Playwright dice «No tests found»).
    test('PREP: sin escenarios que preparar (gate cerrado o F5_PREP_SCENARIOS vacio)', () => {
      // saltado por los test.skip del describe: no abre navegador ni escribe
      expect(SCENARIOS, 'sin escenarios no se prepara ningun viaje').toHaveLength(0);
    });
  }

  for (const scenarioId of SCENARIOS) {
    test(`PREP-${scenarioId}: preparar viaje cerrado por circuito administrativo`, async ({
      page,
      travelsApi,
      checkingAccountApi,
      carrierApi,
      carrierSession,
      otherCostsApi
    }, testInfo) => {
      if (testInfo.retry > 0) {
        throw new Error('[F5 prep] sin retries: un reintento crearia otro viaje permanente');
      }
      const scenario = PREP_SCENARIOS[scenarioId];
      test.skip(
        scenario.payment === null,
        `${scenarioId} es verificacion: no crea viajes (ver f5-prep-verify)`
      );
      test.skip(
        scenario.editFinalFareToZero && !isFrGateOpen('FR_EDIT_AFTER_SURRENDER'),
        `${scenarioId} edita la tarifa final de un viaje cerrado: requiere FR_EDIT_AFTER_SURRENDER=1`
      );

      const env = getCurrentEnv();
      const profile: CarrierProfile = loadCarrierProfile();
      assertEnvMatchesProfile(profile);
      const { key: pairKey, pair } = assertOwnPair(profile, process.env.F5_PREP_PAIR);
      testInfo.annotations.push({
        type: 'tc',
        description: `PRE-F5-PREP-${profile.id}-${scenarioId}`
      });

      // Precondicion 2: la sesion guardada es del carrier del perfil (si no, aborta sin tocar nada).
      expect(
        carrierSession.carrierId,
        `la sesion guardada es del carrier ${carrierSession.carrierId}, el perfil ${profile.id} es ${profile.carrierId}`
      ).toBe(profile.carrierId);

      const outDir = `evidence/${env}/f5-prep`;
      mkdirSync(outDir, { recursive: true });
      const guard = await installWriteGuard(page.context(), {
        logPath: `${outDir}/network-writes.txt`
      });

      // Precondicion 3: el catalogo ofrece cada concepto por nombre exacto, con comisionable/por-costo coherentes.
      const costs = scenarioCosts(profile, scenario);
      const catalog = await otherCostsApi.search();
      for (const cost of costs) {
        const matches = catalog.filter((item) => item.concept === cost.name);
        expect(
          matches.length,
          `el catalogo debe ofrecer «${cost.name}» (carrier ${profile.carrierId})`
        ).toBeGreaterThan(0);
        expect(
          matches.some(
            (m) =>
              Boolean(m.isCommisionable) === cost.commissionable &&
              Boolean(m.isByCost) === Boolean(cost.byCost)
          ),
          `«${cost.name}»: comisionable=${cost.commissionable} por-costo=${Boolean(cost.byCost)} no coincide con el catalogo`
        ).toBe(true);
      }

      // Precondicion 4: el lote previo del par no tiene viajes ajenos al ledger (lote de terceros = FAIL).
      const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
      const pendingRows = await surrenderClient.pendingSummary();
      const pairRow = pendingRows.find(
        (r) => r.driverId === pair.driverId && r.vehicleId === pair.vehicleId
      );
      if (pairRow) {
        const batch = await surrenderClient.preview({
          driverUserId: pair.driverId,
          vehicleId: pair.vehicleId
        });
        const known = new Set(ledgerList(env, ADMIN_CIRCUIT_LEDGER_SCOPE).map((e) => e.travelId));
        const foreign = batch.rows
          .map((r) => r.travelId)
          .filter((id): id is number => typeof id === 'number' && !known.has(id));
        expect(
          foreign,
          `lote de terceros en el par ${pairKey} (${pair.driverId}/${pair.vehicleId}): no se crea nada`
        ).toEqual([]);
      }

      // Alta -> cancelar -> cierre administrativo con el chofer del par.
      const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
      const note = prepNote(scenarioId, flow.runId, env.toUpperCase());
      const handoff: Record<string, unknown> = {
        profileId: profile.id,
        env,
        carrierId: profile.carrierId,
        pairKey,
        driverId: pair.driverId,
        vehicleId: pair.vehicleId,
        scenario: scenarioId,
        runId: flow.runId,
        note,
        status: 'started',
        startedAt: new Date().toISOString()
      };
      const handoffPath = `${outDir}/${profile.id}-${pairKey}-${scenarioId}-${flow.runId}.json`;
      const persist = (): void =>
        writeFileSync(handoffPath, JSON.stringify(handoff, null, 2), 'utf-8');
      persist();

      try {
        const created = await flow.createFromProfile({
          page,
          profile,
          scenario,
          note,
          assertBeforeSubmit: (quote) => {
            // Anti-vacuidad ANTES de crear: cotizado > 0, ruta real y total = base + otros costos del escenario.
            expect(quote.simulatedAmount, 'la cotizacion debe ser > 0').toBeGreaterThan(0);
            expect(quote.resolvedOrigin, 'origen y destino deben diferir').not.toBe(
              quote.resolvedDestination
            );
            expect(
              quote.simulatedAmount,
              `total cotizado = base ${quote.baseAmount} + otros costos ${quote.expected.costsTotal}`
            ).toBeCloseTo(quote.expected.total, 2);
          }
        });
        handoff.travelId = created.travelId;
        handoff.quote = {
          base: created.baseAmount,
          total: created.simulatedAmount,
          expected: created.expected
        };
        handoff.status = 'created';
        persist();

        const before = await flow.readDetail({ travelId: created.travelId });
        expect(
          detailDriverId(before),
          'el viaje recien creado no debe tener chofer asignado'
        ).toBeNull();
        const stateBefore = String(before.state ?? '');

        await flow.cancel({ travelId: created.travelId, reason: note });
        handoff.status = 'cancelled';
        persist();
        await flow.finalizeAdmin({ travelId: created.travelId, driverId: pair.driverId });
        handoff.status = 'finalized';
        persist();

        const closed = await flow.assertClosedWithPair({
          travelId: created.travelId,
          pair,
          scenario,
          profile
        });
        expect(
          closed.mismatches,
          `cierre administrativo: ${formatClosureMismatches(closed.mismatches)}`
        ).toEqual([]);

        if (scenario.editFinalFareToZero) {
          const edit = await flow.editFinalFare({
            page,
            travelId: created.travelId,
            newAmount: 0,
            reason: note
          });
          expect(edit.putStatus).toBe(200);
          handoff.finalFareEditedTo = 0;
        }

        handoff.status = 'closed';
        handoff.closedAt = new Date().toISOString();
        persist();

        await flow.attachMeasurement({
          testInfo,
          measurement: {
            travelId: created.travelId,
            paymentMethod: String(closed.detail.paymentMethod ?? ''),
            simulatedAmount: created.simulatedAmount,
            states: [stateBefore, null, String(closed.detail.state ?? '')],
            finalizeAdminStatus: 'ok',
            detailAfter: {
              state: closed.detail.state ?? null,
              driverId: detailDriverId(closed.detail),
              paymentMethod: closed.detail.paymentMethod ?? null,
              otherCostNames: (closed.detail.otherCostList ?? []).map((c) => c.name ?? null)
            },
            driverId: detailDriverId(closed.detail),
            driverIdSource: 'detail',
            comment: `Preparacion ${profile.id} ${scenarioId} par ${pairKey}: viaje ${created.travelId} cerrado con el chofer ${pair.driverId}. ${note}`
          }
        });
      } finally {
        persist();
        testInfo.annotations.push({
          type: 'network-writes',
          description: `permitidas=${guard.allowedCount()} prohibidas=${guard.forbidden().length} desconocidas=${guard.unknown().length}`
        });
      }

      // Guarda de red: ninguna escritura prohibida ni desconocida (se abortaron y quedaron en el log).
      expect(guard.forbidden(), 'escrituras PROHIBIDAS intentadas (abortadas)').toEqual([]);
      expect(
        guard.unknown(),
        'escrituras DESCONOCIDAS intentadas (abortadas): revisar la allowlist'
      ).toEqual([]);
    });
  }
});
