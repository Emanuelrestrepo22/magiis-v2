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
  driverTotalFromGet,
  driverTotalFromList,
  evaluateAutoPlacement,
  evaluateDeclaredTotal,
  evaluateForeignSurrenders,
  evaluateNocomOutsideTotal,
  nocomSumOf,
  ownerTotalFromList,
  parseSurrenderFacts,
  resolveSettlementAccount,
  type SurrenderFact,
  ownerOpenSurrenders,
  utcDay,
  type SettlementSurrenderRow
} from './settlement-oracle.js';
import { parseMoney } from '../utils/money.js';

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

// ───────────── modo «lista de rendiciones» (UAT sin DB): casos del 06 y 10/11, FR 2021 ─────────────
// 71564/71569 manuales del chofer 6440; 71566/71567 automaticas (sin chofer: OWNER 90,64 + COMMISSIONSUM 90,64).
const FR_FACTS: SurrenderFact[] = [
  { id: 71564, driverId: 6440, commissionSum: 82.4, ownerTotalCommission: 82.4 },
  { id: 71566, driverId: null, commissionSum: 90.64, ownerTotalCommission: 90.64 },
  { id: 71567, driverId: null, commissionSum: 90.64, ownerTotalCommission: 90.64 },
  { id: 71569, driverId: 6440, commissionSum: 90.64, ownerTotalCommission: 90.64 }
];

describe('oraculo desde lista de rendiciones (FR 2021 UAT)', () => {
  it('chofer 6440 = 82,40 + 90,64 = 173,04 y la automatica no entra', () => {
    const r = driverTotalFromList(FR_FACTS, 6440);
    assert.equal(r.total, 173.04);
    assert.deepEqual(r.surrenderIds, [71564, 71569]);
  });

  it('propietario 4289 = 82,40 + 90,64 + 2 x (90,64 + 90,64) = 535,60 (MX-4716)', () => {
    const r = ownerTotalFromList(FR_FACTS);
    assert.equal(r.total, 535.6);
    assert.deepEqual(r.autoIds, [71566, 71567]);
    assert.deepEqual(r.surrenderIds, [71564, 71566, 71567, 71569]);
  });

  it('acumulado del 06/11: 173,04 manual + (90,64 + 90,64) de la automatica = 354,32', () => {
    const facts: SurrenderFact[] = [
      { id: 71559, driverId: 6440, commissionSum: 173.04, ownerTotalCommission: 173.04 },
      { id: 71562, driverId: null, commissionSum: 90.64, ownerTotalCommission: 90.64 }
    ];
    assert.equal(ownerTotalFromList(facts).total, 354.32);
    assert.equal(driverTotalFromList(facts, 6440).total, 173.04);
  });

  it('un chofer sin rendiciones propias da total 0 (no toma las ajenas)', () => {
    assert.equal(driverTotalFromList(FR_FACTS, 9999).total, 0);
  });

  it('propinas y gastos de una manual suman al chofer, no al propietario; en la automatica van al propietario', () => {
    const facts: SurrenderFact[] = [
      { id: 1, driverId: 7, commissionSum: 100, ownerTotalCommission: 60, tips: 5, expenses: 3 },
      { id: 2, driverId: null, commissionSum: 20, ownerTotalCommission: 50, tips: 4, expenses: 2 }
    ];
    assert.equal(driverTotalFromList(facts, 7).total, 108);
    assert.equal(ownerTotalFromList(facts).total, 60 + (50 + 20) + 4 + 2);
  });

  it('NOCOM no suma al total: con NOCOM 15 el total sigue en 535,60 y queda probado', () => {
    const facts = FR_FACTS.map((f) => (f.id === 71566 ? { ...f, nocom: 15 } : f));
    assert.equal(ownerTotalFromList(facts).total, 535.6);
    assert.equal(nocomSumOf(facts), 15);
    const ok = evaluateNocomOutsideTotal({ total: 535.6, oracleTotal: 535.6, nocomSum: 15 });
    assert.deepEqual(ok, { mismatches: [], proven: true });
    const bad = evaluateNocomOutsideTotal({ total: 550.6, oracleTotal: 535.6, nocomSum: 15 });
    assert.equal(bad.mismatches.length, 2);
    assert.ok(bad.mismatches.some((m) => m.field === 'NOCOM incluido en el total'));
  });

  it('sin NOCOM la igualdad pasa pero NO queda probada', () => {
    const r = evaluateNocomOutsideTotal({ total: 173.04, oracleTotal: 173.04, nocomSum: 0 });
    assert.deepEqual(r, { mismatches: [], proven: false });
  });

  it('evaluateDeclaredTotal: igual en las cuatro fuentes = ok; una distinta se nombra', () => {
    assert.deepEqual(
      evaluateDeclaredTotal({ declared: 173.04, oracle: 173.04, shown: 173.04, apiSum: 173.04 }),
      []
    );
    const m = evaluateDeclaredTotal({
      declared: 535.6,
      oracle: 535.6,
      shown: 354.32,
      apiSum: 535.6
    });
    assert.equal(m.length, 1);
    assert.match(m[0].field, /pantalla/);
  });

  it('formatos de pantalla del total declarado: FR 173,04 / AR 1.645,00 / US 1,645.00 / FR con miles 1 645,00', () => {
    assert.equal(parseMoney('173,04'), 173.04);
    assert.equal(parseMoney('1.645,00'), 1645);
    assert.equal(parseMoney('1,645.00'), 1645);
    assert.equal(parseMoney('€ 1 645,00'), 1645);
    assert.equal(parseMoney('535,60'), 535.6);
  });

  it('automatica: debe estar en pendientes del propietario y no en los del chofer', () => {
    assert.deepEqual(
      evaluateAutoPlacement({
        autoIds: [71566, 71567],
        driverPendingIds: [71564, 71569],
        ownerPendingIds: [71564, 71566, 71567, 71569]
      }),
      []
    );
    const bad = evaluateAutoPlacement({
      autoIds: [71566],
      driverPendingIds: [71566],
      ownerPendingIds: []
    });
    assert.equal(bad.length, 2);
  });

  it('lote de terceros: un pendiente fuera de la lista propia es mismatch', () => {
    assert.deepEqual(
      evaluateForeignSurrenders({ pendingIds: [71564, 71569], ownIds: [71564, 71569, 71566] }),
      []
    );
    const bad = evaluateForeignSurrenders({ pendingIds: [71564, 80000], ownIds: [71564] });
    assert.deepEqual(bad[0].actual, [80000]);
  });

  it('parseSurrenderFacts valida forma, ids repetidos y automaticas (driverId null)', () => {
    const ok = parseSurrenderFacts([
      { id: 1, driverId: null, commissionSum: 1, ownerTotalCommission: 2, nocom: 3 }
    ]);
    assert.equal(ok[0].driverId, null);
    assert.equal(ok[0].nocom, 3);
    assert.throws(() => parseSurrenderFacts([]), /no vacio/);
    assert.throws(() => parseSurrenderFacts('x'), /no vacio/);
    assert.throws(
      () => parseSurrenderFacts([{ id: 1, driverId: 5, commissionSum: 1 }]),
      /obligatorios/
    );
    assert.throws(
      () =>
        parseSurrenderFacts([
          { id: 1, driverId: 5, commissionSum: 1, ownerTotalCommission: 1 },
          { id: 1, driverId: 5, commissionSum: 1, ownerTotalCommission: 1 }
        ]),
      /repetida/
    );
    assert.throws(
      () => parseSurrenderFacts([{ id: 1, commissionSum: 1, ownerTotalCommission: 1 }]),
      /driverId/
    );
  });
});

describe('driverTotalFromGet (oraculo del chofer desde los componentes del GET)', () => {
  it('FR 2021 UAT 10/11: filas 82,40 y 90,64 suman 173,04', () => {
    assert.equal(
      driverTotalFromGet([{ driverCommission: 82.4 }, { driverCommission: 90.64 }]),
      173.04
    );
  });

  it('resta costo financiero y suma propinas', () => {
    assert.equal(
      driverTotalFromGet([{ driverCommission: 100, totalFinancialCost: 4, totalTip: 6 }]),
      102
    );
  });

  it('sin driverCommission numerico no hay oraculo (null); sin filas = 0', () => {
    assert.equal(driverTotalFromGet([{ driverCommission: 10 }, {}]), null);
    assert.equal(driverTotalFromGet([]), 0);
  });
});

describe('resolveSettlementAccount', () => {
  const us = { driverIds: [6437, 6438, 6439], ownerId: 4287 };
  const fr = { driverIds: [6440], ownerId: 4289 };
  const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

  it('propietario = ownerId del perfil; chofer unico = ese chofer', () => {
    assert.equal(resolveSettlementAccount(us, '1481-uat', 'owner', env({})), 4287);
    assert.equal(resolveSettlementAccount(fr, '2021-uat', 'driver', env({})), 6440);
  });

  it('varios choferes exigen F5_SETTLEMENT_ACCOUNT y solo acepta uno propio', () => {
    assert.throws(
      () => resolveSettlementAccount(us, '1481-uat', 'driver', env({})),
      /F5_SETTLEMENT_ACCOUNT/
    );
    assert.equal(
      resolveSettlementAccount(us, '1481-uat', 'driver', env({ F5_SETTLEMENT_ACCOUNT: '6438' })),
      6438
    );
    assert.throws(
      () =>
        resolveSettlementAccount(us, '1481-uat', 'driver', env({ F5_SETTLEMENT_ACCOUNT: '9999' })),
      /no pertenece/
    );
  });
});
