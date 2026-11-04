// Smoke SOLO LECTURA de los oraculos DB (trifuerza) contra TEST con datos del circuito FR 1901.
// Requiere ORACLE_*_TEST en el env file; sin ellas falla de forma explicita (un skip se veria verde).
// @db: el CI de GitHub lo excluye por tag (el runner hosteado no llega a Oracle); corre local o interno.
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import {
  readSaleCostData,
  readSurrenderRow,
  movementOracle
} from '../../steps/trips/dbOracles.steps.js';
import {
  evaluateSaleCostPairs,
  evaluateSurrenderRow,
  formatMismatches
} from '../../helpers/db-oracle-eval.js';

const TRAVEL_ID = 71510;
const SURRENDER_ID = 13858;
const CC_ID = 5614;

test.describe('@db oraculos DB smoke (solo lectura)', () => {
  test.beforeEach(({ db }) => {
    expect(db, 'ORACLE_*_TEST ausentes: el oraculo DB no se puede verificar').not.toBeNull();
  });

  test('saleCostDbOracle viaje 71510: FINALPRICE = FINAL_COST_PRICE = 3273.1', async ({ db }) => {
    const data = await readSaleCostData(db!, TRAVEL_ID);
    const result = evaluateSaleCostPairs(data.travelId, data.row, data.items);
    expect(
      result.ok,
      formatMismatches(`pares costo=venta del viaje ${TRAVEL_ID}`, result.mismatches)
    ).toBe(true);
    expect(result.travelId).toBe(TRAVEL_ID);
    const rows = await db!.query<{ FINALPRICE: number; FINAL_COST_PRICE: number }>(
      `SELECT f.FINALPRICE, f.FINAL_COST_PRICE FROM (
         SELECT FINALPRICE_ID FROM TRAVEL WHERE ID = :id
         UNION ALL SELECT FINALPRICE_ID FROM TRAVEL_HISTORY WHERE ID = :id) t
       JOIN FINALPRICEI f ON f.ID = t.FINALPRICE_ID`,
      { id: TRAVEL_ID }
    );
    expect(Number(rows[0]?.FINALPRICE)).toBeCloseTo(3273.1, 2);
    expect(Number(rows[0]?.FINAL_COST_PRICE)).toBeCloseTo(3273.1, 2);
  });

  test('surrenderRowOracle rendicion 13858: TOTALCASH y comisiones', async ({ db }) => {
    const row = await readSurrenderRow(db!, SURRENDER_ID);
    const verdict = evaluateSurrenderRow(row, {
      TOTALCASH: 3273.1,
      OWNER_TOTALCOMMISSION: 1309.24,
      AGENCY_TOTALCOMMISSION: 654.62
    });
    expect(verdict.ok, formatMismatches(`rendicion ${SURRENDER_ID}`, verdict.mismatches)).toBe(
      true
    );
    expect(row.TOTALCASH).toBeCloseTo(3273.1, 2);
    expect(row.OWNER_TOTALCOMMISSION).toBeCloseTo(1309.24, 2);
    expect(row.AGENCY_TOTALCOMMISSION).toBeCloseTo(654.62, 2);
  });

  test('movementOracle CC 5614 desde 2026-10-20 devuelve movimientos', async ({ db }) => {
    const rows = await movementOracle(db!, CC_ID, new Date('2026-10-20T00:00:00'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.MOUNT === null || Number.isFinite(Number(r.MOUNT)))).toBe(true);
  });
});
