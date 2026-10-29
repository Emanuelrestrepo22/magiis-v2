import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookIntegrity,
  bookOutliers,
  clientCcApiBalanceFromDb,
  commissionSplitDiscrepancies,
  compareSurrenderTotals,
  compareSurrenders,
  compareTripsList,
  compareTripsListTotals,
  displayedState,
  expectedRealPrice,
  sumByMethod,
  type DbSurrender,
  type DbTrip,
  type SurrenderGridRow
} from './report-oracle.js';
import {
  detectCurrencyGlyphs,
  findAmountInText,
  isPdfBuffer,
  parseCsv,
  parseMoney,
  csvToObjects,
  textContainsAmount
} from './report-parse.js';

const trip = (over: Partial<DbTrip> = {}): DbTrip => ({
  ID: 1,
  STATE: 6,
  PAYMENTMETHOD: 'CASH',
  FINALPRICE: 54,
  FINALIZE_ADMIN: 0,
  ...over
});
const gridRow = (over: Record<string, string> = {}): Record<string, string> => ({
  Col1: '1',
  Col11: '54',
  Col12: 'DONE',
  Col13: 'CASH',
  ...over
});

describe('parseMoney / parseCsv', () => {
  it('importes en formato FR/AR/US y simbolos', () => {
    assert.equal(parseMoney('€ 3 120,80'), 3120.8);
    assert.equal(parseMoney('$ 2.728,00'), 2728);
    assert.equal(parseMoney('1,234.56'), 1234.56);
    assert.equal(parseMoney('-3091.94'), -3091.94);
    assert.equal(parseMoney('€ 1 234,5'), 1234.5);
    assert.equal(parseMoney('1.234'), 1234);
    assert.equal(parseMoney('abc'), null);
  });

  it('CSV con BOM, delimitador ; y comillas', () => {
    const text = '﻿"A";"B C";D\r\n"x;y";2,5;"he said ""hi"""\r\n';
    const m = parseCsv(text);
    assert.deepEqual(m, [
      ['A', 'B C', 'D'],
      ['x;y', '2,5', 'he said "hi"']
    ]);
    assert.deepEqual(csvToObjects(m), [{ a: 'x;y', 'b c': '2,5', d: 'he said "hi"' }]);
  });

  it('detecta simbolos de moneda y PDF', () => {
    assert.deepEqual(detectCurrencyGlyphs('€ 1,00 y $ 2'), ['€', '$']);
    assert.equal(isPdfBuffer(Buffer.from('%PDF-1.7 ....')), true);
    assert.equal(isPdfBuffer(Buffer.from('<html>')), false);
    assert.equal(textContainsAmount('Total  € 3 120,80', 3120.8), true);
    assert.equal(textContainsAmount('Total  € 3 120,80', 3120.7), false);
    // celda partida por el separador de miles tipo espacio: «2» / «828,00»
    assert.equal(
      findAmountInText('Budgeted  Actual  Done\n2  3  Admin\n828,00  261,00', 2828),
      'wrapped'
    );
    assert.equal(findAmountInText('Total  3 120,80', 3120.8), 'whole');
    assert.equal(findAmountInText('54,00', 54), 'whole');
    assert.equal(findAmountInText('Done  54,00  54,00  Admin', 54), 'whole');
    assert.equal(findAmountInText('Total  15968.30  9682.70', 15968.3), 'whole');
    assert.equal(findAmountInText('99,00', 54), null);
  });
});

describe('Trip List', () => {
  it('estado mostrado y real esperado', () => {
    assert.equal(displayedState({ STATE: 6, FINALIZE_ADMIN: 1 }), 'ADMIN_DONE');
    assert.equal(displayedState({ STATE: 6, FINALIZE_ADMIN: 0 }), 'DONE');
    assert.equal(expectedRealPrice(trip({ STATE: 7, FINALPRICE: null })), 0);
    assert.equal(expectedRealPrice(trip()), 54);
  });

  it('sin discrepancias cuando grilla y DB coinciden', () => {
    assert.deepEqual(compareTripsList([gridRow()], [trip()]), []);
  });

  it('nombra importe, metodo y viaje ausente en la grilla', () => {
    const d = compareTripsList(
      [gridRow({ Col11: '60', Col13: 'CHECKING_ACCOUNT' })],
      [trip(), trip({ ID: 2 }), trip({ ID: 0 })]
    );
    const fields = d.map((x) => `${x.key}:${x.field}`);
    assert.ok(fields.some((f) => f.startsWith('1:Actual')));
    assert.ok(fields.some((f) => f.startsWith('1:Payment Method')));
    // id 2 esta dentro del rango de la grilla (1..1)? no: rango = [1,1], el 2 queda fuera.
    assert.equal(fields.filter((f) => f.includes('ausente')).length, 0);
  });

  it('viaje de DB dentro del rango de ids pero ausente en la grilla', () => {
    const d = compareTripsList(
      [gridRow({ Col1: '1' }), gridRow({ Col1: '3' })],
      [trip(), trip({ ID: 2 }), trip({ ID: 3 })]
    );
    assert.ok(d.some((x) => x.key === '2' && x.field.includes('ausente')));
  });

  it('totales por metodo contra suma de filas', () => {
    const grid = [gridRow(), gridRow({ Col1: '2', Col11: '6', Col13: 'CHECKING_ACCOUNT' })];
    assert.deepEqual(sumByMethod(grid), { CASH: 54, CHECKING_ACCOUNT: 6 });
    assert.deepEqual(
      compareTripsListTotals(
        [
          { Col1: 'CASH', Col2: '54' },
          { Col1: 'CHECKING_ACCOUNT', Col2: '6' }
        ],
        grid
      ),
      []
    );
    const bad = compareTripsListTotals([{ Col1: 'CASH', Col2: '50' }], grid);
    assert.equal(bad.length, 2); // CASH difiere y CHECKING_ACCOUNT no figura en los totales
  });
});

describe('Closed surrenders', () => {
  const dbS = (over: Partial<DbSurrender> = {}): DbSurrender => ({
    ID: 10,
    DRIVER_ID: 4965,
    TOTALBILLING: 100,
    TOTALBILLINGQTY: 1,
    TOTALCASH: 100,
    TOTALCHECKINGACCOUNT: 0,
    TOTALCREDITCARD: 0,
    AGENCY_TOTALCOMMISSION: 20,
    OWNER_TOTALCOMMISSION: 40,
    COMMISSIONSUM: 40,
    TOTAL_COLLECTED: 60,
    ...over
  });
  const gridS = (over: Partial<SurrenderGridRow> = {}): SurrenderGridRow => ({
    id: 10,
    totalTravelsQty: 1,
    totalBilling: 100,
    agencyCommission: 20,
    ownerCommission: 40,
    driverCommission: 40,
    totalCash: 100,
    totalCheckingAccount: 0,
    totalCreditCard: 0,
    totalCollected: 60,
    ...over
  });

  it('coincide y respeta 40/40/20', () => {
    assert.deepEqual(compareSurrenders([gridS()], [dbS()]), []);
  });

  it('detecta comision distinta de la DB y del 40/40/20', () => {
    const d = compareSurrenders([gridS({ driverCommission: 35 })], [dbS()]);
    assert.ok(d.some((x) => x.field.startsWith('Driver commission')));
    assert.ok(d.some((x) => x.field.startsWith('chofer = 40%')));
  });

  it('Driver commission de la grilla incluye propinas/peajes/estacionamiento (13913: 1091.2 + 5)', () => {
    const db = dbS({ COMMISSIONSUM: 40, TOTALROADTOLL: 5, TOTALPARKING: 2, CREDITCARDTIPS: 1 });
    assert.deepEqual(compareSurrenders([gridS({ driverCommission: 48 })], [db]), []);
    const d = compareSurrenders([gridS({ driverCommission: 40 })], [db]);
    assert.ok(d.some((x) => x.field.startsWith('Driver commission')));
  });

  it('rendicion de DB ausente en la grilla (DRIVER_ID NULL) lleva nota', () => {
    const d = compareSurrenders([gridS()], [dbS(), dbS({ ID: 11, DRIVER_ID: null })]);
    assert.equal(d.length, 1);
    assert.match(d[0].note ?? '', /DRIVER_ID es NULL/);
  });

  it('totales vs suma de filas', () => {
    assert.deepEqual(
      compareSurrenderTotals(
        {
          sumTotalBilling: 100,
          sumAgencyCommission: 20,
          sumOwnerCommission: 40,
          sumDriverCommission: 40,
          sumTotalCash: 100,
          sumTotalCheckingAccount: 0,
          sumTotalCreditCard: 0,
          sumTotalTravelsQty: 1
        },
        [gridS()]
      ),
      []
    );
    const d = compareSurrenderTotals({ sumTotalBilling: 154 }, [gridS()]);
    assert.ok(d.some((x) => x.field.startsWith('sumTotalBilling')));
  });

  it('split suelto', () => {
    assert.deepEqual(
      commissionSplitDiscrepancies('r', 'k', {
        totalBilling: 3120.8,
        agencyCommission: 624.16,
        ownerCommission: 1248.32,
        driverCommission: 1248.32
      }),
      []
    );
  });
});

describe('Libros de cuenta corriente', () => {
  it('saldo de CC de cliente en convencion API', () => {
    assert.equal(
      clientCcApiBalanceFromDb({ CHECKINGACCOUNTLIMIT: 100000, BALANCE: 93714.4 }),
      6285.6
    );
  });

  it('detecta una fila con credito absurdo', () => {
    const rows = [
      { ID: 1, DEBIT: 0, CREDIT: 0, BALANCE: 100 },
      { ID: 2, DEBIT: 0, CREDIT: 10, BALANCE: 90 },
      { ID: 3, DEBIT: 0, CREDIT: 11312004, BALANCE: 80 }
    ];
    const d = bookIntegrity('owner-book', rows);
    assert.equal(d.length, 1);
    assert.equal(d[0].key, 'libro#3');
  });

  it('detecta un par debito/credito espurio aunque el saldo cierre', () => {
    const rows = [
      { ID: 1, DEBIT: 100, CREDIT: 0, BALANCE: 100 },
      { ID: 2, DEBIT: 11312004, CREDIT: 0, BALANCE: 11312104, CODE: 'TDEA', COMMENTS: 'W-13' },
      { ID: 3, DEBIT: 0, CREDIT: 11312004, BALANCE: 100, CODE: 'TDES' }
    ];
    assert.deepEqual(bookIntegrity('b', rows), []);
    const d = bookOutliers('b', rows, 32000);
    assert.equal(d.length, 2);
    assert.match(d[0].note ?? '', /TDEA/);
  });
});
