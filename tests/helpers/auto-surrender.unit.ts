// tests/helpers/auto-surrender.unit.ts
// Unit de las piezas puras de la rendicion automatica FR. Los numeros salen de TEST 1901:
// rendicion automatica 13861 (cash 54: propietario 21.6, agencia 10.8, TDCV credito 10.8) y CC
// 13859 (3120.8 con city taxes 282.8: comision 40 % = 1248.32, agencia 20 % = 624.16).
/* eslint-disable playwright/expect-expect */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autoModeFromEnv,
  autoPhaseFromEnv,
  closedTrips,
  compareBatchIds,
  evaluateCcChargeOfTrip,
  expectedAutoSurrender,
  includedInCronRun,
  minutesToNextCron,
  movementAmount,
  openTrips,
  sumByCode,
  tddcFormula,
  type AutoHandoff,
  type AutoTrip
} from './auto-surrender.js';
import { classifyModal } from '../pages/carrier-v2/owners/OwnerEditPage.js';

const closed = (over: Partial<NonNullable<AutoTrip['closed']>>) => ({
  finalPrice: 0,
  cityTax: 0,
  tolls: 0,
  parking: 0,
  closedAt: '2026-10-22T12:00:00.000Z',
  ...over
});

const cashTrip = (finalPrice: number): AutoTrip => ({
  scenario: 'S5',
  travelId: 71511,
  paymentMethod: 'CASH',
  simulated: finalPrice,
  closedBy: 'admin',
  assigned: true,
  closed: closed({ finalPrice })
});

const ccTrip = (finalPrice: number, cityTax: number): AutoTrip => ({
  scenario: 'S4',
  travelId: 71512,
  paymentMethod: 'CHECKING_ACCOUNT',
  simulated: finalPrice,
  closedBy: 'app',
  assigned: true,
  closed: closed({ finalPrice, cityTax })
});

test('expectedAutoSurrender cash 54 reproduce la fila 13861', () => {
  const exp = expectedAutoSurrender([cashTrip(54)]);
  assert.equal(exp.row.TOTALBILLING, 54);
  assert.equal(exp.row.TOTALCASH, 54);
  assert.equal(exp.row.CASHCOMMISSION, 21.6);
  assert.equal(exp.row.OWNER_TOTALCOMMISSION, 21.6);
  assert.equal(exp.row.AGENCY_TOTALCOMMISSION, 10.8);
  assert.equal(exp.row.TOTALCHECKACCQTY, 0);
  assert.equal(exp.ownerBook.TDCV, 10.8);
});

test('expectedAutoSurrender CC con city taxes reproduce la fila 13859', () => {
  const exp = expectedAutoSurrender([ccTrip(3120.8, 282.8)]);
  assert.equal(exp.row.TOTALCHECKINGACCOUNT, 3120.8);
  assert.equal(exp.row.CHECKINGACCOUNTCOMMISSION, 1248.32);
  assert.equal(exp.row.AGENCY_TOTALCOMMISSION, 624.16);
  assert.equal(exp.row.TOTALOTHERCOST, 282.8);
  assert.equal(exp.ownerBook.TDCV, null);
});

test('expectedAutoSurrender lote mixto S4 + S5 suma ambos medios de pago', () => {
  const exp = expectedAutoSurrender([ccTrip(100, 10), cashTrip(50)]);
  assert.equal(exp.row.TOTALBILLING, 150);
  assert.equal(exp.row.TOTALCASHQTY, 1);
  assert.equal(exp.row.TOTALCHECKACCQTY, 1);
  assert.equal(exp.row.COMMISSIONSUM, 60);
  assert.equal(exp.row.AGENCY_TOTALCOMMISSION, 30);
  assert.equal(exp.ownerBook.TDCV, 10);
  assert.deepEqual(exp.travelIds, [71512, 71511]);
});

test('expectedAutoSurrender descuenta peaje y estacionamiento de la base', () => {
  const trip = cashTrip(100);
  trip.closed = closed({ finalPrice: 100, tolls: 5, parking: 5 });
  const exp = expectedAutoSurrender([trip]);
  assert.equal(exp.bases.cash, 90);
  assert.equal(exp.row.CASHCOMMISSION, 36);
});

test('expectedAutoSurrender rechaza viajes sin cerrar o lote vacio', () => {
  const open = cashTrip(10);
  delete open.closed;
  assert.throws(() => expectedAutoSurrender([open]), /sin cerrar/);
  assert.throws(() => expectedAutoSurrender([]), /sin viajes/);
});

test('compareBatchIds nombra ajenos, faltantes y duplicados', () => {
  assert.equal(compareBatchIds([1, 2], [2, 1]), null);
  assert.match(String(compareBatchIds([1, 2, 9], [1, 2])), /AJENOS.*9/);
  assert.match(String(compareBatchIds([1], [1, 2])), /ausentes: 2/);
  assert.match(String(compareBatchIds([1, 1], [1])), /duplicados: 1/);
});

test('movementAmount y sumByCode son agnosticos del signo', () => {
  assert.equal(movementAmount({ CHECKINGACCOUNTCODE: 'TDCV', DEBIT: 0, CREDIT: 10.8 }), 10.8);
  assert.equal(movementAmount({ CHECKINGACCOUNTCODE: 'TDDV', DEBIT: 21.6, CREDIT: 0 }), 21.6);
  assert.deepEqual(
    sumByCode([
      { CHECKINGACCOUNTCODE: 'TDCV', DEBIT: 0, CREDIT: 5 },
      { CHECKINGACCOUNTCODE: 'TDCV', DEBIT: 0, CREDIT: 5.5 },
      { CHECKINGACCOUNTCODE: null, DEBIT: 1, CREDIT: 0 }
    ]),
    { TDCV: 10.5, NULL: 1 }
  );
});

test('tddcFormula marca sospecha de conteo doble cuando las dos comisiones coinciden', () => {
  const same = tddcFormula({
    OWNER_CHECK_ACC_COMM: 21.6,
    CHECKINGACCOUNTCOMMISSION: 21.6,
    OWNER_CA_FINANCIAL_COST: null,
    DRIVER_CA_FINANCIAL_COST: null
  });
  assert.equal(same.expected, 43.2);
  assert.equal(same.doubleCountSuspect, true);
  const differ = tddcFormula({
    OWNER_CHECK_ACC_COMM: 20,
    CHECKINGACCOUNTCOMMISSION: 10,
    OWNER_CA_FINANCIAL_COST: 1,
    DRIVER_CA_FINANCIAL_COST: 2
  });
  assert.equal(differ.expected, 27);
  assert.equal(differ.doubleCountSuspect, false);
});

test('autoPhaseFromEnv y autoModeFromEnv validan el entorno', () => {
  assert.equal(autoPhaseFromEnv({ FR_AUTO_PHASE: ' Verify ' }), 'verify');
  assert.equal(autoPhaseFromEnv({ FR_AUTO_PHASE: 'otra' }), null);
  assert.equal(autoPhaseFromEnv({}), null);
  assert.equal(autoModeFromEnv({}), 'desvincular');
  assert.equal(autoModeFromEnv({ FR_AUTO_MODE: 'CRON' }), 'cron');
  assert.throws(() => autoModeFromEnv({ FR_AUTO_MODE: 'manual' }), /invalido/);
});

test('minutesToNextCron e includedInCronRun respetan 13:10 / 13:00 UTC', () => {
  assert.equal(minutesToNextCron(new Date('2026-10-22T13:00:00Z')), 10);
  assert.equal(minutesToNextCron(new Date('2026-10-22T13:10:00Z')), 24 * 60);
  assert.equal(minutesToNextCron(new Date('2026-10-22T09:10:00Z')), 240);
  const day = new Date('2026-10-22T13:10:00Z');
  assert.equal(includedInCronRun(new Date('2026-10-22T12:59:59Z'), day), true);
  assert.equal(includedInCronRun(new Date('2026-10-22T13:00:01Z'), day), false);
});

test('closedTrips y openTrips separan el handoff', () => {
  const open: AutoTrip = { ...cashTrip(1), scenario: 'S4', travelId: 7 };
  delete open.closed;
  const handoff = {
    trips: { S5: cashTrip(54), S4: open }
  } as unknown as AutoHandoff;
  assert.deepEqual(
    closedTrips(handoff).map((t) => t.scenario),
    ['S5']
  );
  assert.deepEqual(
    openTrips(handoff).map((t) => t.scenario),
    ['S4']
  );
});

test('classifyModal distingue el modal automatico del manual (en-US/es-AR)', () => {
  assert.equal(
    classifyModal(
      'The vehicle has pending settlements. An automatic settlement will be processed. Do you confirm?'
    ),
    'auto'
  );
  assert.equal(
    classifyModal(
      'The vehicle has pending settlements. You must process them manually before unassigning the vehicle.'
    ),
    'manual'
  );
  assert.equal(
    classifyModal(
      'El vehículo tiene rendiciones pendientes. Se procesará una rendición automática. ¿Confirma la operación?'
    ),
    'auto'
  );
  assert.equal(classifyModal('otro texto'), 'unknown');
});

test('evaluateCcChargeOfTrip devuelve veredicto (sin lanzar): 1 cobro por el precio final', () => {
  const trip: AutoTrip = {
    ...cashTrip(100),
    scenario: 'S4',
    paymentMethod: 'CHECKING_ACCOUNT',
    closedBy: 'app',
    closed: closed({ finalPrice: 100 })
  };
  const mv = (over: Record<string, unknown>) => ({
    ID: 1,
    TRAVEL_ID: trip.travelId,
    MOVEMENT_CODE: 'TIVR',
    MOVEMENT_TYPE: 'AUTOMATIC',
    MOUNT: 100,
    CURRENCY_ID: null,
    MOVEMENTSTATUS: 1,
    CREATIONDATE: null,
    ...over
  });
  const ok = evaluateCcChargeOfTrip([mv({})], trip);
  assert.equal(ok.ok, true);
  assert.equal(ok.movement?.ID, 1);
  const wrong = evaluateCcChargeOfTrip([mv({ MOUNT: 90 })], trip);
  assert.equal(wrong.ok, false);
  assert.match(wrong.mismatches[0]?.field ?? '', /MOVEMENT\.MOUNT/);
  const dup = evaluateCcChargeOfTrip([mv({}), mv({ ID: 2 })], trip);
  assert.equal(dup.ok, false);
  assert.equal(dup.movement, null);
  const open = evaluateCcChargeOfTrip([mv({})], { ...trip, closed: undefined });
  assert.equal(open.ok, false);
  assert.equal(open.movement, null);
});
