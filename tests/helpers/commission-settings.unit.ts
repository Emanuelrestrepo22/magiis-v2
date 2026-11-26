import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  COMMISSION_FIXED,
  COMMISSION_SPLIT,
  loadCarrierProfile,
  registerCommissionSettings,
  resolveCommissionFixed,
  resolveCommissionSplit
} from '../config/carrier-profiles.js';
import {
  expectedCommissionsFromSettings,
  fixedPerDay,
  splitFromSettings,
  type CommissionSettings
} from './commission-settings.js';
import { expectedCommissions } from './db-oracle-eval.js';

// Filas reales de TEST (COMMISSIONSETTINGS + DRIVERSETTLPARAM) leidas el 2026-10-23.
const S_1901: CommissionSettings = {
  // COMMISSIONSETTINGS 3411 (vehiculo 3765) + DRIVERSETTLPARAM del chofer 4965 (40 %)
  percentage: 20,
  percentageForCost: 0,
  percentagePayee: 'AGENCY',
  fixed: 0,
  fixedPayee: 'AGENCY',
  driverTravelPct: 40,
  driverCostPct: null
};
const S_1521_2625: CommissionSettings = {
  // COMMISSIONSETTINGS 1589 (vehiculo 2625) + DRIVERSETTLPARAM 2728 (chofer 3727)
  percentage: 30,
  percentageForCost: 0,
  percentagePayee: 'AGENCY',
  fixed: 30,
  fixedPayee: 'AGENCY',
  driverTravelPct: 0,
  driverCostPct: 0
};
const S_1521_3247: CommissionSettings = {
  // COMMISSIONSETTINGS 2529 (vehiculo 3247) + chofer 4987 (20 %)
  percentage: 3,
  percentageForCost: 0,
  percentagePayee: 'AGENCY',
  fixed: 0,
  fixedPayee: 'AGENCY',
  driverTravelPct: 20,
  driverCostPct: null
};
const S_1521_3645: CommissionSettings = {
  // COMMISSIONSETTINGS 3230 (vehiculo 3645) + chofer 4785 (0 %): 50 % OWNER + 50 fijo OWNER
  percentage: 50,
  percentageForCost: 50,
  percentagePayee: 'OWNER',
  fixed: 50,
  fixedPayee: 'OWNER',
  driverTravelPct: 0,
  driverCostPct: 0
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

describe('commission-settings: reparto', () => {
  it('1901 = 40/40/20 (chofer 40, agencia 20 AGENCY, propietario el resto)', () => {
    assert.deepEqual(splitFromSettings(S_1901), { owner: 0.4, driver: 0.4, agency: 0.2 });
  });

  it('1521 vehiculo 2625 = propietario 70 / chofer 0 / agencia 30 + 30 fija a agencia', () => {
    assert.deepEqual(splitFromSettings(S_1521_2625), { owner: 0.7, driver: 0, agency: 0.3 });
    assert.deepEqual(fixedPerDay(S_1521_2625), { owner: 0, agency: 30 });
  });

  it('payee OWNER: propietario = pct, agencia = el resto', () => {
    assert.deepEqual(splitFromSettings(S_1521_3645), { owner: 0.5, driver: 0, agency: 0.5 });
    assert.deepEqual(fixedPerDay(S_1521_3645), { owner: 50, agency: 0 });
  });

  it('tarifador por costo usa los porcentajes *_FOR_COST y falla si son NULL', () => {
    assert.deepEqual(splitFromSettings(S_1521_3645, { byCost: true }), {
      owner: 0.5,
      driver: 0,
      agency: 0.5
    });
    assert.throws(() => splitFromSettings(S_1901, { byCost: true }), /COST_PERCENTAGE/);
  });
});

// Validacion contra TRAVELSSURRENDER reales (TEST). Base = TOTALCASH + TOTALCHECKINGACCOUNT.
describe('commission-settings: contra rendiciones reales', () => {
  const cases: Array<{
    id: number;
    settings: CommissionSettings;
    cash: number;
    cc: number;
    stored: { owner: number; agency: number; driverCash: number; driverCc: number };
  }> = [
    // 1901
    {
      id: 13843,
      settings: S_1901,
      cash: 54,
      cc: 0,
      stored: { owner: 21.6, agency: 10.8, driverCash: 21.6, driverCc: 0 }
    },
    {
      id: 13917,
      settings: S_1901,
      cash: 3251,
      cc: 0,
      stored: { owner: 1300.4, agency: 650.2, driverCash: 1300.4, driverCc: 0 }
    },
    {
      id: 13999,
      settings: S_1901,
      cash: 2828,
      cc: 0,
      stored: { owner: 1131.2, agency: 565.6, driverCash: 1131.2, driverCc: 0 }
    },
    // 1521 (OWNER_/AGENCY_TOTALCOMMISSION incluyen la fija: 13637 = 6.23 variable + 50 fija OWNER)
    {
      id: 13677,
      settings: S_1521_3247,
      cash: 28.33,
      cc: 43.66,
      stored: { owner: 55.43, agency: 2.16, driverCash: 5.67, driverCc: 8.73 }
    },
    {
      id: 13717,
      settings: S_1521_3247,
      cash: 128.33,
      cc: 1039.66,
      stored: { owner: 899.35, agency: 35.04, driverCash: 25.67, driverCc: 207.93 }
    },
    {
      id: 13637,
      settings: S_1521_3645,
      cash: 12.46,
      cc: 0,
      stored: { owner: 56.23, agency: 6.23, driverCash: 0, driverCc: 0 }
    }
  ];

  for (const c of cases) {
    it(`rendicion ${c.id}: esperado == almacenado`, () => {
      const e = expectedCommissionsFromSettings(c.settings, c.cash + c.cc, { fixedDays: 1 });
      assert.equal(e.ownerTotal, c.stored.owner, 'OWNER_TOTALCOMMISSION');
      assert.equal(e.agencyTotal, c.stored.agency, 'AGENCY_TOTALCOMMISSION');
      assert.equal(r2(e.split.driver * c.cash), c.stored.driverCash, 'CASHCOMMISSION');
      assert.equal(r2(e.split.driver * c.cc), c.stored.driverCc, 'CHECKINGACCOUNTCOMMISSION');
      // Mismo resultado por la ruta de las columnas de TRAVELSSURRENDER.
      const cols = expectedCommissions({
        cashBase: c.cash,
        checkingAccountBase: c.cc,
        creditCardBase: 0,
        pctOwner: e.split.owner,
        pctAgency: e.split.agency,
        pctDriver: e.split.driver,
        ownerFixed: e.ownerFixed,
        agencyFixed: e.agencyFixed
      });
      assert.equal(cols.OWNER_TOTALCOMMISSION, c.stored.owner);
      assert.equal(cols.AGENCY_TOTALCOMMISSION, c.stored.agency);
      assert.equal(cols.CASHCOMMISSION, c.stored.driverCash);
      assert.equal(cols.CHECKINGACCOUNTCOMMISSION, c.stored.driverCc);
    });
  }

  it('la fija entra por DIA de viaje, no por viaje (13617: 6 viajes en 4 dias, fija 50 OWNER = 200)', () => {
    const e = expectedCommissionsFromSettings(S_1521_3645, 0, { fixedDays: 4 });
    assert.equal(e.ownerFixed, 200);
    assert.equal(e.agencyFixed, 0);
  });

  it('1521 vehiculo 2625: base 100, un dia = agencia 30 + 30 fija, propietario 70, chofer 0', () => {
    const e = expectedCommissionsFromSettings(S_1521_2625, 100);
    assert.deepEqual(
      { o: e.owner, d: e.driver, a: e.agency, ot: e.ownerTotal, at: e.agencyTotal },
      { o: 70, d: 0, a: 30, ot: 70, at: 60 }
    );
  });
});

describe('commission-settings: resolucion por perfil', () => {
  const saved = process.env.CIRCUIT_CARRIER;

  afterEach(() => {
    registerCommissionSettings(null);
    if (saved === undefined) delete process.env.CIRCUIT_CARRIER;
    else process.env.CIRCUIT_CARRIER = saved;
  });

  it('1901 (fixed) no necesita DB: 40/40/20 y fija 0', () => {
    process.env.CIRCUIT_CARRIER = '1901';
    assert.deepEqual(
      { o: COMMISSION_SPLIT.owner, d: COMMISSION_SPLIT.driver, a: COMMISSION_SPLIT.agency },
      { o: 0.4, d: 0.4, a: 0.2 }
    );
    assert.deepEqual({ ...COMMISSION_FIXED }, { owner: 0, agency: 0 });
    assert.deepEqual(resolveCommissionFixed(loadCarrierProfile('1901')), { owner: 0, agency: 0 });
  });

  it('perfil db: sin configuracion registrada lanza nombrando ensureCommissionResolved', () => {
    const complete = {
      ...loadCarrierProfile('1901'),
      id: '1521',
      commission: { kind: 'db' as const }
    };
    assert.throws(() => resolveCommissionSplit(complete), /ensureCommissionResolved/);
    assert.deepEqual(resolveCommissionSplit(complete, S_1521_2625), {
      owner: 0.7,
      driver: 0,
      agency: 0.3
    });
    assert.deepEqual(resolveCommissionFixed(complete, S_1521_2625), { owner: 0, agency: 30 });
  });

  it('1521 completo: el reparto viene de DB y exige ensureCommissionResolved', () => {
    process.env.CIRCUIT_CARRIER = '1521';
    assert.throws(
      () => COMMISSION_SPLIT.owner,
      /Comision del carrier "1521" viene de DB.*ensureCommissionResolved/
    );
  });
});
