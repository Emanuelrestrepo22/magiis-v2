// tests/specs/trips/f5-app-prepare.spec.ts
// Universal F5 (MG-1027) · W5a PREPARACION del viaje que cerrara la APP REAL del chofer (runner Appium W5b, otro
// repo). Plan docs/qa/f5-phase2-surrender-automation-plan.md §3 W5. Flujo: precondiciones -> alta por UI en efectivo
// («Send Manual», NUNCA «Send Service» ni el boton «A») -> asignacion DIRECTA por driverId al chofer del par (API del
// carrier, no difusion) -> handoff `evidence/<env>/f5-app-handoff-<carrierId>.json` con `status: "prepared"`.
// NO cancela, NO finaliza, NO rinde: el cierre lo hace la app; luego se corre f5-app-verify.
//
// Gate (valor exacto `1`; sin el se salta ANTES de abrir el navegador): CIRCUIT_PREP_CREATE_TRIPS=1. El viaje queda
// PERMANENTE y anotado en el ledger `admin-circuit`. Requiere CIRCUIT_CARRIER=<perfil con prep.app> (hoy `1521`, TEST).
// Opcionales: F5_PREP_PAIR (par del perfil; default prep.defaultPair, cuyo chofer debe ser el de la app),
// F5_APP_SCENARIO=EF-NC-COM|EF-PLAIN|EF-NC-ONLY (efectivo), F5_APP_HANDOFF_REPLACE=1 (pisar un handoff `prepared`),
// F5_APP_ALLOW_FOREIGN_LOT=1 (tolerar lote ajeno del par; queda en handoff.observations, fuera de rendicion).
// El perfil 1521 tiene TODO en customers/paymentMethods (alta): con el gate abierto este spec FALLA RAPIDO listando
// esos pendientes, sin tocar nada. Sin retries.
// Ejecucion: npx cross-env ENV=test CIRCUIT_CARRIER=1521 CIRCUIT_PREP_CREATE_TRIPS=1 playwright test
//   tests/specs/trips/f5-app-prepare.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import { copyFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { assignTravelToDriver } from '../../api/clients/driverTravels.client.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import {
  isCircuitCarrierExplicit,
  loadCarrierProfile,
  peekCarrierProfile,
  requirePrepApp
} from '../../config/carrier-profiles.js';
import { getCurrentEnv, isCircuitGateOpen } from '../../config/runtime.js';
import { PREP_SCENARIOS, scenarioCosts } from '../../data/carrier-v2/trips/prep-scenarios.js';
import {
  assertEnvMatchesProfile,
  assertOwnPair,
  detailDriverId
} from '../../helpers/circuit-guards.js';
import {
  archivedHandoffPath,
  assertAppDriverMatchesPair,
  buildPreparedHandoff,
  expectedRoute,
  f5AppHandoffPath,
  failedHandoff,
  parseAppScenario,
  planHandoffWrite,
  readF5AppHandoffIfExists,
  writeF5AppHandoff
} from '../../helpers/f5-app-handoff.js';
import { verifyF5App, f5AppNote } from '../../helpers/f5-app-acceptance.js';
import { installWriteGuard } from '../../helpers/network-guard.js';
import { ADMIN_CIRCUIT_LEDGER_SCOPE, ledgerList } from '../../helpers/trip-ledger.js';
import { TravelDetailPage } from '../../pages/carrier-v2/trips/TravelDetailPage.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';

function skipReason(): string | null {
  if (!isCircuitGateOpen('CIRCUIT_PREP_CREATE_TRIPS')) {
    return 'requiere CIRCUIT_PREP_CREATE_TRIPS=1 (crea un viaje permanente)';
  }
  if (!isCircuitCarrierExplicit()) {
    return 'requiere CIRCUIT_CARRIER=<perfil con app Chofer> explicito (hoy 1521, TEST)';
  }
  const peeked = peekCarrierProfile();
  const app = (peeked as { prep?: { app?: unknown } }).prep?.app;
  if (app === null || app === undefined || (app as { __todo?: boolean }).__todo === true) {
    return `el perfil ${peeked.id} no declara app Chofer (prep.app): la app real corre solo en TEST`;
  }
  return null;
}

const SKIP = skipReason();

test.describe('F5 cierre por app · preparacion (alta + asignacion directa) @data-prep @irreversible', () => {
  test.skip(SKIP !== null, `F5 app prepare saltado: ${SKIP ?? ''}`);
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('APP-PREP: preparar viaje asignado por driverId para cierre por app', async ({
    page,
    travelsApi,
    checkingAccountApi,
    carrierApi,
    carrierSession,
    otherCostsApi
  }, testInfo) => {
    if (testInfo.retry > 0) {
      throw new Error('[F5 app prepare] sin retries: un reintento crearia otro viaje permanente');
    }
    const env = getCurrentEnv();
    // Falla rapido (sin tocar nada) si el perfil tiene TODO en el alta (1521: customers/paymentMethods).
    const profile = loadCarrierProfile();
    assertEnvMatchesProfile(profile);
    const app = requirePrepApp(profile);
    const { key: pairKey, pair } = assertOwnPair(profile, process.env.F5_PREP_PAIR);
    assertAppDriverMatchesPair(app, pair);
    const scenarioId = parseAppScenario(process.env.F5_APP_SCENARIO);
    const scenario = PREP_SCENARIOS[scenarioId];
    testInfo.annotations.push({
      type: 'tc',
      description: `PRE-F5-APP-${profile.id}-${scenarioId}`
    });
    expect(
      carrierSession.carrierId,
      `la sesion guardada es del carrier ${carrierSession.carrierId}, el perfil ${profile.id} es ${profile.carrierId}`
    ).toBe(profile.carrierId);

    // Handoff previo: un `prepared` sin cerrar no se pisa (dejaria un viaje asignado huerfano).
    const handoffFile = f5AppHandoffPath(env, profile.carrierId);
    const existing = readF5AppHandoffIfExists(handoffFile);
    const plan = planHandoffWrite(existing, {
      replacePrepared: process.env.F5_APP_HANDOFF_REPLACE?.trim() === '1'
    });

    const outDir = `evidence/${env}/f5-app`;
    mkdirSync(outDir, { recursive: true });
    const guard = await installWriteGuard(page.context(), {
      logPath: `${outDir}/network-writes.txt`
    });

    // Precondicion: el catalogo ofrece cada concepto por nombre exacto con comisionable coherente.
    const costs = scenarioCosts(profile, scenario);
    const catalog = await otherCostsApi.search();
    for (const cost of costs) {
      expect(
        catalog.some(
          (m) => m.concept === cost.name && Boolean(m.isCommisionable) === cost.commissionable
        ),
        `el catalogo debe ofrecer «${cost.name}» (comisionable=${cost.commissionable}) en el carrier ${profile.carrierId}`
      ).toBe(true);
    }

    // Precondicion: el lote previo del par no tiene viajes ajenos al ledger (lote de terceros = FAIL).
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
    const batchOf = async (): Promise<number[]> => {
      const rows = await surrenderClient.pendingSummary();
      const row = rows.find((r) => r.driverId === pair.driverId && r.vehicleId === pair.vehicleId);
      if (!row) return [];
      const batch = await surrenderClient.preview({
        driverUserId: pair.driverId,
        vehicleId: pair.vehicleId
      });
      return batch.rows.map((r) => r.travelId).filter((id): id is number => typeof id === 'number');
    };
    const known = new Set(ledgerList(env, ADMIN_CIRCUIT_LEDGER_SCOPE).map((e) => e.travelId));
    const foreign = (await batchOf()).filter((id) => !known.has(id));
    // F5_APP_ALLOW_FOREIGN_LOT=1 (opt-in del usuario, solo cierre por app): se tolera el lote ajeno y se deja
    // constancia en el handoff; ese viaje NO debe entrar en rendicion/liquidacion automatizada.
    const allowForeignLot = process.env.F5_APP_ALLOW_FOREIGN_LOT?.trim() === '1';
    if (!allowForeignLot) {
      expect(
        foreign,
        `lote de terceros en el par ${pairKey} (${pair.driverId}/${pair.vehicleId}): no se crea nada`
      ).toEqual([]);
    } else if (foreign.length > 0) {
      testInfo.annotations.push({
        type: 'lote-ajeno-permitido',
        description: `${foreign.length} viajes ajenos pendientes en ${pair.driverId}/${pair.vehicleId}`
      });
    }
    const foreignLotObservations =
      allowForeignLot && foreign.length > 0 ? [`lote-ajeno-permitido:${foreign.length}`] : [];

    // ---- Alta por UI (efectivo, «Send Manual») ----
    const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
    const note = `QA F5 APP ${scenarioId} ${flow.runId}`;
    let travelId = 0;
    let created: Awaited<ReturnType<AdminCircuitFlow['createFromProfile']>> | null = null;
    await verifyF5App(testInfo, 'AC-F5A-01', async () => {
      created = await flow.createFromProfile({
        page,
        profile,
        scenario,
        note,
        assertBeforeSubmit: (quote) => {
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
      travelId = created.travelId;
      return {
        travelId,
        scenario: scenarioId,
        simulatedAmount: created.simulatedAmount,
        baseAmount: created.baseAmount,
        otherCosts: created.expected.costsTotal
      };
    });
    if (created === null) throw new Error('[F5 app prepare] alta sin resultado');
    const quote = created as Awaited<ReturnType<AdminCircuitFlow['createFromProfile']>>;

    // Codigo visible del viaje (`<id>-<canal>`), solo lectura.
    const detailPage = new TravelDetailPage(page);
    await detailPage.goto(travelId);
    const code = ((await detailPage.tripCode.textContent()) ?? '').trim() || String(travelId);

    const base = buildPreparedHandoff({
      runId: flow.runId,
      carrierId: profile.carrierId,
      travelId,
      code,
      pair,
      scenario: scenarioId,
      currency: profile.currency.code,
      quoted: { total: quote.simulatedAmount, otherCosts: quote.expected.costsTotal },
      app,
      observations: foreignLotObservations,
      route: expectedRoute({
        region: profile.region,
        origin: quote.resolvedOrigin,
        destination: quote.resolvedDestination
      })
    });

    try {
      // ---- Asignacion DIRECTA por driverId (nunca difusion ni «A») ----
      await verifyF5App(testInfo, 'AC-F5A-02', async () => {
        const before = await flow.readDetail({ travelId });
        expect(detailDriverId(before), 'el viaje recien creado no debe tener chofer').toBeNull();
        await assignTravelToDriver({
          carrierApi,
          carrierSession,
          travelId,
          driverUserId: pair.driverId
        });
        const after = await flow.readDetail({ travelId });
        expect(
          detailDriverId(after),
          `el viaje ${travelId} debe quedar con el chofer del par`
        ).toBe(pair.driverId);
        expect(
          String(after.state ?? ''),
          `tras asignar, el viaje ${travelId} no debe estar cancelado ni finalizado`
        ).not.toMatch(/^(CANCELL?ED|7|DONE|6)$/i);
        return { driverId: pair.driverId, stateAfter: after.state ?? null };
      });
      await verifyF5App(testInfo, 'AC-F5A-03', async () => {
        const ids = await batchOf();
        expect(ids, `el viaje ${travelId} abierto no debe estar en el lote del par`).not.toContain(
          travelId
        );
        return { batchIds: ids };
      });
      f5AppNote(
        testInfo,
        'known-issue',
        'AC-F5A-09',
        `viaje ${travelId} asignado a mano: si se cancela antes de cerrarlo, App Driver 2.6.17 conserva la oferta (Firebase huerfano); el cierre por app no lo ejercita`
      );
    } catch (error) {
      // El viaje ya existe: se deja constancia (`failed`) para que el runner no lo tome ni se cree otro a ciegas.
      const failed = failedHandoff(
        base,
        'assign',
        error instanceof Error ? error.message : String(error),
        new Date().toISOString()
      );
      if (plan === 'archive' && existing) {
        copyFileSync(handoffFile, archivedHandoffPath(handoffFile, existing));
      }
      writeF5AppHandoff(handoffFile, failed);
      throw error;
    }

    if (plan === 'archive' && existing) {
      copyFileSync(handoffFile, archivedHandoffPath(handoffFile, existing));
    }
    writeF5AppHandoff(handoffFile, base);
    testInfo.annotations.push({
      type: 'network-writes',
      description: `permitidas=${guard.allowedCount()} prohibidas=${guard.forbidden().length} desconocidas=${guard.unknown().length}`
    });
    console.info(
      `F5_APP_PREPARED ${JSON.stringify({ travelId, code, handoffFile, driverId: pair.driverId, vehicleId: pair.vehicleId })}`
    );
    await testInfo.attach('f5-app-handoff', {
      body: JSON.stringify(base, null, 2),
      contentType: 'application/json'
    });
    expect(guard.forbidden(), 'escrituras PROHIBIDAS intentadas (abortadas)').toEqual([]);
    expect(guard.unknown(), 'escrituras DESCONOCIDAS intentadas (abortadas)').toEqual([]);
  });
});
