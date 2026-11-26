// tests/specs/trips/f5-verify.ts
// Envoltorio del lado del spec (como helpers/acceptance.ts): reune las aserciones F5 (no comisionables
// en la rendicion) que comparten s1 / s3-verify (manual) y s5-auto (automatica). Las REGLAS de negocio
// se aseveran aqui, dentro de `verifyF5`; las lecturas viven en steps/trips/f5Surrender.steps.ts y los
// veredictos en helpers/f5-surrender-oracle.ts. SOLO LECTURA; se invoca DESPUES de confirmar/disparar la
// rendicion, detras de los gates FR_CONFIRM_SURRENDER / FR_TOGGLE_AUTO_SURRENDER del spec que lo llama.
import { expect, type TestInfo } from '@playwright/test';
import type { OracleDb } from '../../db/OracleDb.js';
import { surrenderIdsOfTrips } from '../../steps/trips/autoSurrender.steps.js';
import { f5Observation, verifyF5 } from '../../helpers/f5-acceptance.js';
import {
  evaluateCcNcRow,
  evaluateClearingNcRow,
  evaluateF5SurrenderRow,
  evaluateOwnerTdoc,
  evaluateSurrenderPost,
  expectedSurrenderPost,
  formatMismatches,
  type F5Expected,
  type F5OwnerBookRow
} from '../../helpers/f5-surrender-oracle.js';
import {
  clearingText,
  f5ExpectedOf,
  readF5CcNcColumns,
  readF5SurrenderColumns,
  readSurrenderDriverCommission
} from '../../steps/trips/f5Surrender.steps.js';

export type F5SurrenderCheck = {
  testInfo: TestInfo;
  oracle: OracleDb;
  /** Viajes del lote con su medio de pago (CASH / CHECKING_ACCOUNT / CREDIT_CARD). */
  trips: ReadonlyArray<{ travelId: number; paymentMethod: string }>;
  /** Id de la rendicion, o un viaje del lote para resolverlo (espera a que la rendicion exista). */
  surrender: { surrenderId: number } | { travelId: number };
  /** true = rendicion automatica (DRIVER_ID NULL): el NC efectivo se acredita como TDOC al propietario. */
  automatic: boolean;
  /** Filas del libro del propietario de ESTA rendicion. */
  ownerRows: readonly F5OwnerBookRow[];
  /** PDF del Clearing (respuesta del confirm o copia guardada); null = no disponible (se registra). */
  clearingPdf?: Buffer | null;
  /** Body del POST de confirmacion (solo manual); undefined = no aplica. */
  postBody?: Record<string, unknown> | null;
};

/**
 * AC-F5-09 columnas nuevas de TRAVELSSURRENDER, AC-F5-16 NC de viajes CC, AC-F5-10 TDOC, AC-F5-11 fila del Clearing y AC-F5-12
 * body del POST. Los viajes FR de hoy no llevan NC: el esperado es NC = 0 (columna presente y en 0,
 * sin TDOC); con NC > 0 el mismo codigo exige los importes del oraculo.
 */
export async function verifyF5Surrender(check: F5SurrenderCheck): Promise<F5Expected> {
  const { testInfo, oracle } = check;
  let surrenderId: number;
  if ('surrenderId' in check.surrender) {
    surrenderId = check.surrender.surrenderId;
  } else {
    const travelId = check.surrender.travelId;
    const holder: { id: number | null } = { id: null };
    await expect
      .poll(
        async () => {
          holder.id = (await surrenderIdsOfTrips(oracle, [travelId])).get(travelId) ?? null;
          return holder.id;
        },
        {
          timeout: 30_000,
          message: `el viaje ${travelId} no obtuvo TRAVELSSURRENDER_ID tras confirmar la rendicion (F5)`
        }
      )
      .not.toBeNull();
    surrenderId = holder.id as number;
  }
  const expected = await f5ExpectedOf(oracle, check.trips);

  await verifyF5(testInfo, 'AC-F5-09', async () => {
    const row = await readF5SurrenderColumns(oracle, surrenderId);
    const v = evaluateF5SurrenderRow(row, expected);
    expect(
      v.ok,
      formatMismatches(`columnas F5 de TRAVELSSURRENDER ${surrenderId}`, v.mismatches)
    ).toBe(true);
    return { surrenderId, row, expected };
  });

  await verifyF5(testInfo, 'AC-F5-16', async () => {
    const row = await readF5CcNcColumns(oracle, surrenderId);
    const v = evaluateCcNcRow(row, expected);
    expect(
      v.ok,
      formatMismatches(`NC de viajes CC en TRAVELSSURRENDER ${surrenderId}`, v.mismatches)
    ).toBe(true);
    return { surrenderId, row, ncCheckingAccount: expected.ncCheckingAccount };
  });

  await verifyF5(testInfo, 'AC-F5-10', () => {
    const v = evaluateOwnerTdoc({
      rows: check.ownerRows,
      automatic: check.automatic,
      ncCash: expected.ncCash.amount
    });
    expect(
      v.ok,
      formatMismatches(`libro del propietario (rendicion ${surrenderId})`, v.mismatches)
    ).toBe(true);
    return { automatic: check.automatic, tdocRows: v.tdocRows, tdocCredit: v.tdocCredit };
  });

  if (check.clearingPdf === undefined) {
    // Rendicion automatica: no hay Clearing en la respuesta del disparo.
  } else if (check.clearingPdf === null) {
    // Con NC > 0 el PDF ausente es FALLO de AC-F5-11; solo con NC = 0 (nada que buscar) es observacion.
    if (expected.ncCash.amount > 0) {
      await verifyF5(testInfo, 'AC-F5-11', () => {
        throw new Error('sin PDF del Clearing y NC efectivo > 0: no se puede verificar la fila NC');
      });
    } else {
      f5Observation(testInfo, 'AC-F5-11', 'sin PDF del Clearing disponible (lo juzga AC-FR-97)');
    }
  } else {
    const pdf = check.clearingPdf;
    await verifyF5(testInfo, 'AC-F5-11', () => {
      const text = clearingText(pdf);
      const v = evaluateClearingNcRow(text, { ncCash: expected.ncCash.amount });
      expect(v.ok, formatMismatches('Clearing PDF (fila NC)', v.mismatches)).toBe(true);
      return { ncCash: expected.ncCash.amount, labelPresent: v.labelPresent };
    });
  }

  if (check.postBody !== undefined) {
    const body = check.postBody;
    await verifyF5(testInfo, 'AC-F5-12', async () => {
      // 14181/14183 (neto >= 0): surrendered = efectivo a rendir, agencyNetPaid = neto. 14184 (saldo a favor
      // del chofer): surrendered 0, netPaid = comision − efectivo. Vouchers 0 salvo los del body declarados.
      const driverCommission = await readSurrenderDriverCommission(oracle, surrenderId);
      const bodyAmount = (k: string): number => {
        const v = body?.[k];
        const a = typeof v === 'object' && v !== null ? (v as { amount?: unknown }).amount : 0;
        return typeof a === 'number' ? a : 0;
      };
      const want = expectedSurrenderPost({
        cashToSurrender: expected.cashToSurrender,
        driverCommission,
        fuelVoucher: bodyAmount('fuelVoucher'),
        miscellanyVoucher: bodyAmount('miscellanyVoucher')
      });
      const v = evaluateSurrenderPost(body, want);
      expect(v.ok, formatMismatches('POST toTravelsSurrender (body)', v.mismatches)).toBe(true);
      return { body, want, driverCommission };
    });
  }
  return expected;
}
