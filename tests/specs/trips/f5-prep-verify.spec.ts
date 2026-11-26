// tests/specs/trips/f5-prep-verify.spec.ts
// Universal F5 (MG-1027) · VERIFICACION SOLO LECTURA del lote preparado por f5-prep-trips (plan
// docs/qa/f5-admin-circuit-multicarrier-plan.md §4.3). Sin gates: no puede crear, rendir ni confirmar. La guarda de
// red + `SurrenderPage.blockWrites()` abortan cualquier escritura y el spec falla si hubo intentos.
// Por el par PROPIO del perfil (CIRCUIT_CARRIER + F5_PREP_PAIR o el par por defecto):
//  - con handoff (evidence/<env>/f5-prep/<perfil>-<par>-*.json, el ultimo cerrado) o F5_VERIFY_TRIPS=id,id:
//    cada viaje cerrado con el chofer del par; lote EXACTO (Daily Clearing › Pending = 1 fila con N viajes,
//    toSurrend = ids declarados); NC del GET toTravelsSurrender = esperado del escenario; vista previa por UI
//    coherente con el GET y 0 intentos de escritura de rendicion.
//  - sin handoff: linea base del par (cuales viajes pendientes hay y que ninguno es ajeno al ledger).
// Pata DB: N/A (UAT sin DB), anotada `ac-na`, nunca PASS silencioso. No acredita Xray: es el gate de entrada de la
// fase siguiente (confirmacion).
// Ejecucion: npx cross-env CIRCUIT_CARRIER=1040-uat ENV=uat npm run test:f5:prep:verify
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import { isCircuitCarrierExplicit, loadCarrierProfile } from '../../config/carrier-profiles.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { PREP_SCENARIOS, scenarioCosts } from '../../data/carrier-v2/trips/prep-scenarios.js';
import {
  assertEnvMatchesProfile,
  assertOwnPair,
  detailDriverId,
  evaluatePrepClosure,
  formatClosureMismatches
} from '../../helpers/circuit-guards.js';
import { evaluatePendingSet } from '../../helpers/f5-confirm-oracle.js';
import { readNcField } from '../../helpers/f5-surrender-oracle.js';
import { F5_NA_ANNOTATION } from '../../helpers/f5-layers.js';
import { installWriteGuard } from '../../helpers/network-guard.js';
import { ADMIN_CIRCUIT_LEDGER_SCOPE, ledgerList } from '../../helpers/trip-ledger.js';
import { SurrenderPage } from '../../pages/carrier-v2/pay/SurrenderPage.js';

type Handoff = {
  profileId: string;
  pairKey: string;
  scenario: keyof typeof PREP_SCENARIOS;
  status: string;
  travelId?: number;
  closedAt?: string;
  quote?: { expected?: { nonCommissionable?: number } };
};

/** Ultimo handoff CERRADO del perfil y par (por `closedAt`); null si no hay. */
function latestHandoff(dir: string, profileId: string, pairKey: string): Handoff | null {
  if (!existsSync(dir)) return null;
  const found: Handoff[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`${profileId}-${pairKey}-`) || !name.endsWith('.json')) continue;
    try {
      const h = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as Handoff;
      if (h.status === 'closed' && typeof h.travelId === 'number') found.push(h);
    } catch {
      // handoff ilegible: se ignora (no es un lote declarado)
    }
  }
  found.sort((a, b) => String(b.closedAt ?? '').localeCompare(String(a.closedAt ?? '')));
  return found[0] ?? null;
}

function overrideTrips(raw: string | undefined): number[] | null {
  const text = raw?.trim();
  if (!text) return null;
  const ids = text.split(',').map((s) => Number(s.trim()));
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`F5_VERIFY_TRIPS="${text}" invalido: ids enteros positivos separados por coma`);
  }
  return ids.sort((a, b) => a - b);
}

test.describe('F5 verificacion del lote preparado (solo lectura) @data-prep @uat', () => {
  test.skip(
    !isCircuitCarrierExplicit(),
    'requiere CIRCUIT_CARRIER=<perfil UAT> explicito (1040-uat | 1481-uat | 2021-uat)'
  );
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('VERIFY: lote pendiente del par propio por UI + API (sin escrituras)', async ({
    page,
    travelsApi,
    carrierApi,
    carrierSession
  }, testInfo) => {
    const env = getCurrentEnv();
    const profile = loadCarrierProfile();
    assertEnvMatchesProfile(profile);
    const { key: pairKey, pair } = assertOwnPair(profile, process.env.F5_PREP_PAIR);
    testInfo.annotations.push({
      type: 'tc',
      description: `VERIFY-F5-PREP-${profile.id}-${pairKey}`
    });
    expect(
      carrierSession.carrierId,
      `la sesion guardada es del carrier ${carrierSession.carrierId}, el perfil ${profile.id} es ${profile.carrierId}`
    ).toBe(profile.carrierId);
    testInfo.annotations.push({
      type: F5_NA_ANNOTATION,
      description: 'pata DB de la verificacion de preparacion: N/A (UAT sin DB; solo UI + API)'
    });

    const guard = await installWriteGuard(page.context(), {
      logPath: `evidence/${env}/f5-prep/network-writes.txt`
    });
    const surrenderClient = new SurrenderClient(carrierApi, carrierSession);
    const handoff = latestHandoff(`evidence/${env}/f5-prep`, profile.id, pairKey);
    const override = overrideTrips(process.env.F5_VERIFY_TRIPS);
    const declared =
      override ?? (handoff && typeof handoff.travelId === 'number' ? [handoff.travelId] : null);

    const rows = await surrenderClient.pendingSummary();
    const pairRows = rows.filter(
      (r) => r.driverId === pair.driverId && r.vehicleId === pair.vehicleId
    );
    expect(
      pairRows.length,
      'la grilla de pendientes tiene como maximo 1 fila por par'
    ).toBeLessThanOrEqual(1);

    const batch = pairRows.length
      ? await surrenderClient.preview({ driverUserId: pair.driverId, vehicleId: pair.vehicleId })
      : null;
    const pendingIds = (batch?.rows ?? [])
      .map((r) => r.travelId)
      .filter((id): id is number => typeof id === 'number')
      .sort((a, b) => a - b);

    if (declared === null) {
      // Linea base: ningun pendiente del par es ajeno al ledger del circuito (o el par esta vacio = R21).
      const known = new Set(ledgerList(env, ADMIN_CIRCUIT_LEDGER_SCOPE).map((e) => e.travelId));
      const foreign = pendingIds.filter((id) => !known.has(id));
      testInfo.annotations.push({
        type: 'xray_comment',
        description: `Linea base ${profile.id} par ${pairKey} (${pair.driverId}/${pair.vehicleId}): ${pendingIds.length} viajes pendientes ${JSON.stringify(pendingIds)}; ajenos al ledger: ${JSON.stringify(foreign)}`
      });
      expect(
        foreign,
        'pendientes del par ajenos al ledger del circuito (lote de terceros)'
      ).toEqual([]);
    } else {
      // 1) cada viaje declarado: cerrado con el chofer del par y medio de pago/conceptos del escenario.
      const scenario = PREP_SCENARIOS[handoff?.scenario ?? 'EF-PLAIN'];
      for (const travelId of declared) {
        const detail = await travelsApi.getDetail(travelId);
        expect(detailDriverId(detail), `viaje ${travelId}: chofer del par`).toBe(pair.driverId);
        if (handoff && !override) {
          const mismatches = evaluatePrepClosure(detail, {
            pair,
            scenario,
            costs: scenarioCosts(profile, scenario)
          });
          expect(mismatches, `viaje ${travelId}: ${formatClosureMismatches(mismatches)}`).toEqual(
            []
          );
        }
      }

      // 2) lote EXACTO: 1 fila del par con N viajes y toSurrend = ids declarados.
      expect(pairRows, `el par ${pairKey} debe tener pendientes`).toHaveLength(1);
      expect(pairRows[0].travelsToSurrender, 'viajes pendientes del par en la grilla').toBe(
        declared.length
      );
      const exact = evaluatePendingSet(pendingIds, declared);
      expect(exact.ok, `lote pendiente != declarado: ${JSON.stringify(exact.mismatches)}`).toBe(
        true
      );

      // 3) GET toTravelsSurrender: NC de efectivo = esperado del escenario (identidad con lo preparado).
      const totals = await surrenderClient.totals({
        driverUserId: pair.driverId,
        vehicleId: pair.vehicleId
      });
      const nc = readNcField(totals);
      expect(
        nc.verdict.ok,
        `GET sin totalCashOtherCostNoCommissionable valido: ${JSON.stringify(nc.verdict.mismatches)}`
      ).toBe(true);
      if (handoff && !override) {
        const wantNc =
          scenario.payment === 'cash' ? (handoff.quote?.expected?.nonCommissionable ?? 0) : 0;
        expect(nc.field?.amount, 'totalCashOtherCostNoCommissionable.amount del GET').toBeCloseTo(
          wantNc,
          2
        );
        expect(nc.field?.quantity, 'totalCashOtherCostNoCommissionable.quantity del GET').toBe(
          wantNc > 0 ? declared.length : 0
        );
      }

      // 4) Vista previa por UI (solo lectura): mismos viajes y mismo total que el GET.
      const surrender = new SurrenderPage(page);
      await surrender.blockWrites();
      await surrender.openPending();
      await surrender.selectBatch({ driverUserId: pair.driverId, vehicleId: pair.vehicleId });
      const preview = await surrender.readPreview();
      expect(
        [...preview.travelIds].sort((a, b) => a - b),
        'viajes de la vista previa = declarados'
      ).toEqual(declared);
      expect(preview.uiTravelsCount, 'tarjeta «viajes» de la pantalla').toBe(declared.length);
      expect(
        surrender.writeAttempts(),
        'intentos de escritura de rendicion en la vista previa'
      ).toBe(0);
    }

    expect(guard.forbidden(), 'escrituras PROHIBIDAS intentadas (abortadas)').toEqual([]);
    expect(guard.unknown(), 'escrituras DESCONOCIDAS intentadas (abortadas)').toEqual([]);
    expect(
      guard.businessWrites(),
      'la verificacion es solo lectura: 0 escrituras de negocio'
    ).toEqual([]);
  });
});
