import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareAmounts,
  driverCreateTotal,
  driverNet,
  driverToLiquidateColumn,
  evaluateBooksUntouched,
  evaluateCreatedLiquidation,
  ownerCreateTotal,
  ownerNet,
  ownerToLiquidateColumn,
  driverOpenSurrenders,
  ownerOpenSurrenders,
  utcDay,
  type SettlementSurrenderRow
} from './settlement-oracle.js';

const base: SettlementSurrenderRow = {
  ID: 1,
  IDFORCARRIER: 1,
  DRIVER_ID: 4965,
  VEHICLEOWNERID: 2927,
  VEHICLE_ID: 3765,
  COMMISSIONSUM: 0,
  OWNER_TOTALCOMMISSION: 0,
  AGENCY_TOTALCOMMISSION: 0,
  CHECKINGACCOUNTTIPS: 0,
  CREDITCARDTIPS: 0,
  DRIVER_CA_FINANCIAL_COST: 0,
  DRIVER_TC_FINANCIAL_COST: 0,
  OWNER_CA_FINANCIAL_COST: 0,
  OWNER_TC_FINANCIAL_COST: 0,
  TOTALROADTOLL: 0,
  TOTALPARKING: 0,
  FUELAMOUNT: 0,
  MISCELLANYAMOUNT: 0,
  AGENCY_FIXED_COMM: 0,
  OWNER_FIXED_COMM: 0,
  FIX_CONCEPT_COST_CASH: 0,
  TAXES_COST_CASH: 0,
  SETTLEMENT_DRIVER: 0,
  SETTLEMENT_OWNER: 0,
  FUELEXPENSEOWNER: 'OWNER',
  MISCELLANEOUSEXPENSEOWNER: 'OWNER'
};
const row = (over: Partial<SettlementSurrenderRow>): SettlementSurrenderRow => ({
  ...base,
  ...over
});

// Numeros reales de TEST 1901 (2026-10-21): rendiciones abiertas del chofer 4965.
const open1901 = [
  row({ ID: 13841, COMMISSIONSUM: 23.76, OWNER_TOTALCOMMISSION: 23.76 }),
  row({ ID: 13843, COMMISSIONSUM: 21.6, OWNER_TOTALCOMMISSION: 21.6 }),
  row({ ID: 13858, COMMISSIONSUM: 1309.24, OWNER_TOTALCOMMISSION: 1309.24 }),
  row({ ID: 13878, COMMISSIONSUM: 1304.4, OWNER_TOTALCOMMISSION: 1304.4 })
];

describe('settlement-oracle (chofer)', () => {
  it('total del create con datos reales de 1901 = 2659.00', () => {
    assert.equal(driverCreateTotal(open1901), 2659);
    assert.equal(driverToLiquidateColumn(open1901), 2659);
  });

  it('comNeta = comision - costos financieros + propinas + peajes/estacionamiento', () => {
    const r = row({
      COMMISSIONSUM: 100,
      DRIVER_CA_FINANCIAL_COST: 3,
      DRIVER_TC_FINANCIAL_COST: 2,
      CHECKINGACCOUNTTIPS: 4,
      CREDITCARDTIPS: 1,
      TOTALROADTOLL: 7,
      TOTALPARKING: 3
    });
    const n = driverNet(r);
    assert.equal(n.financialCost, 5);
    assert.equal(n.tips, 5);
    assert.equal(n.expenses, 10);
    assert.equal(n.net, 110);
  });

  it('la columna A liquidar NO incluye peajes: difiere del total del create', () => {
    const r = row({ COMMISSIONSUM: 100, TOTALROADTOLL: 7, TOTALPARKING: 3 });
    assert.equal(driverCreateTotal([r]), 110);
    assert.equal(driverToLiquidateColumn([r]), 100);
  });

  it('NULL cuenta como 0', () => {
    const r = row({ COMMISSIONSUM: null, DRIVER_CA_FINANCIAL_COST: null, TOTALROADTOLL: null });
    assert.equal(driverNet(r).net, 0);
  });
});

describe('settlement-oracle (propietario)', () => {
  it('rendicion con chofer: solo OWNER_TOTALCOMMISSION', () => {
    assert.equal(ownerNet(row({ COMMISSIONSUM: 21.6, OWNER_TOTALCOMMISSION: 21.6 })).net, 21.6);
  });

  it('rendicion SIN chofer suma comision de chofer, propinas, gastos y descuenta cargos fijos', () => {
    // Caso real 13861: sin chofer, owner 21.6 + commissionSum 21.6 = 43.2 (parte del total 6310.04 de la liq. 2681).
    const r = row({ ID: 13861, DRIVER_ID: null, COMMISSIONSUM: 21.6, OWNER_TOTALCOMMISSION: 21.6 });
    assert.equal(ownerNet(r).net, 43.2);
    const full = row({
      DRIVER_ID: null,
      COMMISSIONSUM: 10,
      OWNER_TOTALCOMMISSION: 20,
      OWNER_CA_FINANCIAL_COST: 1,
      DRIVER_CA_FINANCIAL_COST: 2,
      OWNER_TC_FINANCIAL_COST: 0.5,
      DRIVER_TC_FINANCIAL_COST: 0.5,
      CHECKINGACCOUNTTIPS: 3,
      TOTALROADTOLL: 4,
      TOTALPARKING: 1,
      AGENCY_FIXED_COMM: 2,
      FIX_CONCEPT_COST_CASH: 1,
      TAXES_COST_CASH: 1
    });
    // 30 - (1+2+0.5+0.5) + 3 + 5 - 2 - 2 = 30
    assert.equal(ownerNet(full).net, 30);
  });

  it('combustible/varios solo descuentan si los asume el propietario', () => {
    const r = row({ OWNER_TOTALCOMMISSION: 100, FUELAMOUNT: 10, MISCELLANYAMOUNT: 5 });
    assert.equal(ownerNet(r).net, 85);
    assert.equal(
      ownerNet({ ...r, FUELEXPENSEOWNER: 'DRIVER', MISCELLANEOUSEXPENSEOWNER: null }).net,
      100
    );
  });

  it('suma por rendicion == total del create; la columna difiere con rendiciones sin chofer', () => {
    const rows = [
      row({ ID: 1, OWNER_TOTALCOMMISSION: 1091.2, COMMISSIONSUM: 1091.2 }),
      row({ ID: 13861, DRIVER_ID: null, OWNER_TOTALCOMMISSION: 21.6, COMMISSIONSUM: 21.6 })
    ];
    assert.equal(ownerCreateTotal(rows), 1091.2 + 43.2);
    assert.equal(ownerToLiquidateColumn(rows), 1091.2 + 21.6);
  });
});

describe('settlement-oracle (evaluacion)', () => {
  const chosen = [row({ ID: 10, SETTLEMENT_DRIVER: 1 }), row({ ID: 11, SETTLEMENT_DRIVER: 1 })];
  const head = { ID: 99, STATUS: 1, TOTAL: 50, CARRIER_ID: 1901 };
  const details = [
    { LIQUIDATION_ID: 99, TRAVELSSURRENDER_ID: 11 },
    { LIQUIDATION_ID: 99, TRAVELSSURRENDER_ID: 10 }
  ];

  it('liquidacion correcta no tiene diferencias', () => {
    assert.deepEqual(
      evaluateCreatedLiquidation({
        kind: 'driver',
        liquidation: head,
        details,
        chosen,
        untouched: [],
        expectedTotal: 50
      }),
      []
    );
  });

  it('detecta total, estado, detalle y flags incorrectos', () => {
    const out = evaluateCreatedLiquidation({
      kind: 'driver',
      liquidation: { ...head, STATUS: 0, TOTAL: 49 },
      details: details.slice(0, 1),
      chosen: [row({ ID: 10, SETTLEMENT_DRIVER: 1 }), row({ ID: 11, SETTLEMENT_DRIVER: 0 })],
      untouched: [row({ ID: 12, SETTLEMENT_DRIVER: 1 })],
      expectedTotal: 50
    });
    assert.deepEqual(
      out.map((m) => m.field),
      [
        'STATUS de la liquidacion',
        'TOTAL de la liquidacion',
        'rendiciones del detalle',
        'SETTLEMENT_DRIVER de la rendicion 11',
        'SETTLEMENT_DRIVER de la rendicion NO elegida 12'
      ]
    );
  });

  it('libros: cualquier fila o saldo nuevo es diferencia', () => {
    assert.deepEqual(
      evaluateBooksUntouched({
        label: 'chofer',
        before: { rows: 23, balance: 6.4 },
        after: { rows: 23, balance: 6.4 }
      }),
      []
    );
    assert.equal(
      evaluateBooksUntouched({
        label: 'chofer',
        before: { rows: 23, balance: 6.4 },
        after: { rows: 24, balance: 0 }
      }).length,
      2
    );
  });

  it('compareAmounts tolera medio centavo y rechaza ausentes', () => {
    assert.deepEqual(compareAmounts([{ what: 'a', expected: 1, actual: 1.004 }]), []);
    assert.equal(compareAmounts([{ what: 'a', expected: 1, actual: undefined }]).length, 1);
  });
});

describe('settlement-oracle (alcance por dia UTC)', () => {
  it('utcDay usa el dia UTC, no el local', () => {
    assert.equal(utcDay(new Date('2026-10-21T23:30:00-03:00')), '2026-10-22');
    assert.equal(utcDay(new Date('2026-10-21T15:40:00-03:00')), '2026-10-21');
  });

  it('las consultas pasan el dia UTC y comparan < dia+1 (lo creado hoy no es futuro)', async () => {
    const calls: { sql: string; binds: unknown }[] = [];
    const db = {
      query: async (sql: string, binds: unknown) => {
        calls.push({ sql, binds });
        return [];
      }
    } as unknown as Parameters<typeof driverOpenSurrenders>[0];
    const toDate = new Date('2026-10-21T15:40:00-03:00');
    await driverOpenSurrenders(db, { carrierId: 1, driverAccountId: 2, toDate });
    await ownerOpenSurrenders(db, { carrierId: 1, ownerId: 3, toDate });
    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.match(c.sql, /CREATIONDATE < TO_DATE\(:toDay, 'YYYY-MM-DD'\) \+ 1/);
      assert.equal((c.binds as { toDay: string }).toDay, '2026-10-21');
    }
  });
});
