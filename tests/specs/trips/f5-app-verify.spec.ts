// tests/specs/trips/f5-app-verify.spec.ts
// Universal F5 (MG-1027) · W5a VERIFICACION SOLO LECTURA del viaje que cerro la APP REAL del chofer (runner Appium W5b)
// y del lote de rendicion que forma. Plan docs/qa/f5-phase2-surrender-automation-plan.md §3 W5. Sin gates: no crea,
// no rinde, no confirma; la guarda de red + `SurrenderPage.blockWrites()` abortan cualquier escritura y el spec falla
// si hubo intentos. Lee `evidence/<env>/f5-app-handoff-<carrierId>.json` (lo que dejo f5-app-prepare + el runner).
// Verifica: espera DONE en backend (<= F5_APP_WAIT_MS, default 10 min) -> handoff `closed` -> chofer del handoff ->
// precio final > 0 SIN igualdad con la cotizacion (el cierre por app recalcula, regla QA lead 15/10) -> km del
// backend vs `measured.routeKm` con tolerancia (F5_APP_KM_TOLERANCE_PCT, default 15 %) -> costo 0 hasta F7 como
// observation `diferido-f7` -> lote del par = exactamente [travelId] (API + vista previa por UI).
// Pata DB (solo TEST con Oracle): FINALPRICEI.KM contra la ruta; sin Oracle queda anotada `ac-na`, nunca PASS silencioso.
// No acredita Xray: es el gate de entrada del lote R01 de origen app (W1).
// Ejecucion: npx cross-env ENV=test CIRCUIT_CARRIER=1521 playwright test tests/specs/trips/f5-app-verify.spec.ts
//   --project=carrier-v2-desktop --workers=1 --retries=0
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import {
  isCircuitCarrierExplicit,
  loadCarrierProfileScoped,
  peekCarrierProfile,
  resolveCircuitCarrierId
} from '../../config/carrier-profiles.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { evaluatePendingSet } from '../../helpers/f5-confirm-oracle.js';
import { readNcField } from '../../helpers/f5-surrender-oracle.js';
import {
  evaluateAppClosure,
  f5AppHandoffPath,
  formatAppClosureMismatches,
  readF5AppHandoff,
  resolveKmTolerancePct,
  type AppClosureMismatch,
  type F5AppHandoff
} from '../../helpers/f5-app-handoff.js';
import { f5AppNote, verifyF5App } from '../../helpers/f5-app-acceptance.js';
import { F5_NA_ANNOTATION, f5LayerEnabled, f5DbNotApplicable } from '../../helpers/f5-layers.js';
import { installWriteGuard } from '../../helpers/network-guard.js';
import { SurrenderPage } from '../../pages/carrier-v2/pay/SurrenderPage.js';
import { readSaleCostData } from '../../steps/trips/dbOracles.steps.js';

const STATE_DONE = /^(DONE|6)$/i;
const WAIT_MS = Number(process.env.F5_APP_WAIT_MS?.trim() || 10 * 60_000);
const HANDOFF_SETTLE_MS = 60_000;

function skipReason(): string | null {
  if (!isCircuitCarrierExplicit()) {
    return 'requiere CIRCUIT_CARRIER=<perfil con app Chofer> explicito (hoy 1521, TEST)';
  }
  const app = (peekCarrierProfile() as { prep?: { app?: unknown } }).prep?.app;
  if (app === null || app === undefined) {
    return `el perfil ${resolveCircuitCarrierId()} no declara app Chofer (prep.app)`;
  }
  return null;
}

const SKIP = skipReason();
const fieldsOf = (m: readonly AppClosureMismatch[], pick: (f: string) => boolean) =>
  m.filter((x) => pick(x.field));

test.describe('F5 cierre por app · verificacion del viaje y del lote (solo lectura) @data-prep', () => {
  test.skip(SKIP !== null, `F5 app verify saltado: ${SKIP ?? ''}`);
  test.describe.configure({ mode: 'serial', timeout: WAIT_MS + HANDOFF_SETTLE_MS + 240_000 });

  test('APP-VERIFY: viaje cerrado por la app (DONE, precio, km) y lote exacto', async ({
    page,
    travelsApi,
    carrierApi,
    carrierSession,
    db
  }, testInfo) => {
    const env = getCurrentEnv();
    // Solo lectura: no exige el alta completa del perfil (1521 la tiene con TODO).
    const profile = loadCarrierProfileScoped(resolveCircuitCarrierId(), ['prep.app']);
    const handoffFile = f5AppHandoffPath(env, profile.carrierId);
    let handoff: F5AppHandoff = readF5AppHandoff(handoffFile);
    const { travelId } = handoff;
    testInfo.annotations.push({
      type: 'tc',
      description: `VERIFY-F5-APP-${profile.id}-${travelId}`
    });
    expect(
      carrierSession.carrierId,
      `la sesion guardada es del carrier ${carrierSession.carrierId}, el handoff es del ${handoff.carrierId}`
    ).toBe(handoff.carrierId);
    expect(handoff.carrierId, 'el handoff es del carrier del perfil').toBe(profile.carrierId);
    if (handoff.status === 'failed') {
      throw new Error(
        `handoff en "failed" (${handoff.failure?.stage}): ${handoff.failure?.message}. Revisar el estado real del viaje ${travelId}.`
      );
    }
    f5AppNote(
      testInfo,
      'known-issue',
      'AC-F5A-09',
      'AC-95 (App Driver 2.6.17 conserva la oferta de un viaje cancelado asignado a mano): solo se anota; la app real lo ejercita fuera de este spec'
    );

    const guard = await installWriteGuard(page.context(), {
      logPath: `evidence/${env}/f5-app/network-writes.txt`
    });
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);

    // ---- 1. Esperar el cierre por la app (DONE) y que el runner anexe el cierre al handoff ----
    await test.step(`1. esperar DONE del viaje ${travelId} (max ${Math.round(WAIT_MS / 60_000)} min)`, async () => {
      await expect
        .poll(async () => String((await travelsApi.getDetail(travelId)).state ?? ''), {
          timeout: WAIT_MS,
          intervals: [5_000, 10_000, 15_000],
          message:
            `el viaje ${travelId} no llego a DONE en ${Math.round(WAIT_MS / 60_000)} min: ` +
            `la app del chofer ${handoff.driverId} no lo cerro (o quedo en otro estado).`
        })
        .toMatch(STATE_DONE);
    });

    await expect
      .poll(
        () => {
          handoff = readF5AppHandoff(handoffFile);
          return handoff.status;
        },
        {
          timeout: HANDOFF_SETTLE_MS,
          intervals: [2_000, 5_000],
          message: `el viaje ${travelId} esta DONE pero el handoff no quedo "closed" (el runner debe anexar closedAt/measured/result)`
        }
      )
      .toBe('closed');

    const detail = await travelsApi.getDetail(travelId);
    let dbKm: number | null = null;
    if (!f5LayerEnabled('db')) {
      f5DbNotApplicable(testInfo, 'FINALPRICEI.KM del cierre por app', process.env);
    } else if (db === null) {
      testInfo.annotations.push({
        type: F5_NA_ANNOTATION,
        description: 'capa db pedida pero Oracle no disponible: pata DB sin ejecutar'
      });
    } else {
      dbKm = (await readSaleCostData(db, travelId)).row.KM ?? null;
    }
    const tolerancePct = resolveKmTolerancePct();
    const verdict = evaluateAppClosure({ handoff, detail, dbKm, tolerancePct });

    await verifyF5App(testInfo, 'AC-F5A-04', async () => {
      const own = fieldsOf(verdict.mismatches, (f) =>
        /^(handoff\.status|state|driver\.id)$/.test(f)
      );
      expect(own, formatAppClosureMismatches(own)).toEqual([]);
      return {
        state: detail.state ?? null,
        driverId: handoff.driverId,
        closedAt: handoff.closedAt
      };
    });
    await verifyF5App(testInfo, 'AC-F5A-05', async () => {
      const own = fieldsOf(verdict.mismatches, (f) => f.startsWith('precio final'));
      expect(own, formatAppClosureMismatches(own)).toEqual([]);
      // Se registra, no se asevera: el cierre por app recalcula total/tarifa con km/tiempo medidos.
      return {
        finalPrice: verdict.finalPrice,
        quotedTotal: handoff.quoted.total,
        differsFromQuote: verdict.differsFromQuote,
        quoteVsFinalDelta: verdict.quoteVsFinalDelta,
        appTotalText: handoff.result?.totalAmountText ?? null
      };
    });
    await verifyF5App(testInfo, 'AC-F5A-06', async () => {
      const own = fieldsOf(
        verdict.mismatches,
        (f) => f.startsWith('km backend') || f.startsWith('FINALPRICEI.KM')
      );
      expect(own, formatAppClosureMismatches(own)).toEqual([]);
      return {
        tolerancePct,
        measured: handoff.measured ?? null,
        kmChecked: verdict.kmChecked,
        dbKm
      };
    });
    for (const note of verdict.observations) {
      f5AppNote(
        testInfo,
        'observation',
        note.startsWith('diferido-f7') ? 'AC-F5A-07' : 'AC-F5A-05',
        note
      );
    }
    await testInfo.attach('f5-app-closure-verdict', {
      body: JSON.stringify(
        { travelId, code: handoff.code, verdict, observations: handoff.observations ?? [] },
        null,
        2
      ),
      contentType: 'application/json'
    });

    // ---- 2. Lote del par = exactamente [travelId] (API + vista previa por UI, solo lectura) ----
    await verifyF5App(testInfo, 'AC-F5A-08', async () => {
      const pair = { driverUserId: handoff.driverId, vehicleId: handoff.vehicleId };
      // Lote ajeno permitido en la preparacion (F5_APP_ALLOW_FOREIGN_LOT=1): el lote exacto no es verificable;
      // se exige que el viaje este en el lote y se deja constancia. Ese viaje no entra en rendicion automatizada.
      const foreignLot = (handoff.observations ?? []).find((o) =>
        o.startsWith('lote-ajeno-permitido')
      );
      if (foreignLot) {
        const lot = await surrenderClient.preview(pair);
        const lotIds = lot.rows
          .map((r) => r.travelId)
          .filter((id): id is number => typeof id === 'number');
        expect(lotIds, `el viaje ${travelId} cerrado debe estar en el lote del par`).toContain(
          travelId
        );
        f5AppNote(
          testInfo,
          'known-issue',
          'AC-F5A-08',
          `${foreignLot}: lote del par con ${lotIds.length} viajes; solo se verifica que incluya ${travelId}`
        );
        return { batchIds: lotIds.length, foreignLot };
      }
      const rows = await surrenderClient.pendingSummary();
      const pairRows = rows.filter(
        (r) => r.driverId === pair.driverUserId && r.vehicleId === pair.vehicleId
      );
      expect(pairRows, 'la grilla de pendientes tiene 1 fila para el par del viaje').toHaveLength(
        1
      );
      expect(pairRows[0].travelsToSurrender, 'viajes pendientes del par en la grilla').toBe(1);
      const batch = await surrenderClient.preview(pair);
      const ids = batch.rows
        .map((r) => r.travelId)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
      const exact = evaluatePendingSet(ids, [travelId]);
      expect(exact.ok, `lote != [${travelId}]: ${JSON.stringify(exact.mismatches)}`).toBe(true);
      const nc = readNcField(await surrenderClient.totals(pair));
      expect(
        nc.verdict.ok,
        `GET toTravelsSurrender: ${JSON.stringify(nc.verdict.mismatches)}`
      ).toBe(true);

      const surrender = new SurrenderPage(page);
      await surrender.blockWrites();
      await surrender.openPending();
      await surrender.selectBatch(pair);
      const preview = await surrender.readPreview();
      expect(
        [...preview.travelIds].sort((a, b) => a - b),
        'vista previa = [travelId]'
      ).toEqual([travelId]);
      expect(preview.uiTravelsCount, 'tarjeta «viajes» de la pantalla').toBe(1);
      expect(
        surrender.writeAttempts(),
        'intentos de escritura de rendicion en la vista previa'
      ).toBe(0);
      return { batchIds: ids, nc: nc.field ?? null, uiTravelsCount: preview.uiTravelsCount };
    });

    expect(guard.forbidden(), 'escrituras PROHIBIDAS intentadas (abortadas)').toEqual([]);
    expect(guard.unknown(), 'escrituras DESCONOCIDAS intentadas (abortadas)').toEqual([]);
    expect(
      guard.businessWrites(),
      'la verificacion es solo lectura: 0 escrituras de negocio'
    ).toEqual([]);
  });
});
