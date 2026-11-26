import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decidePdfModes,
  deliverContractCases,
  deliverQ9Question,
  expectedCcProfitDiff,
  matchedTotalCashDefinition,
  parseF5PdfMode,
  splitDeliverCases,
  totalCashOpenQuestion,
  evaluateCcNcRow,
  evaluateClearingNcRow,
  evaluateCommissionsAgainstGet,
  evaluateF5SurrenderRow,
  evaluateGetAgainstExpected,
  evaluateGetCcNc,
  evaluateOwnerTdoc,
  evaluateSurrenderPost,
  evaluateUiAgainstGet,
  evaluateUiFormats,
  expectedDeliverBalance,
  parseDeliverBase,
  expectedF5,
  expectedSurrenderPost,
  F5_FORMATS,
  getTaxesCash,
  matchesMoneyFormat,
  parseF5Ui,
  parseF5UiRaw,
  readNcField,
  type F5TripFacts
} from './f5-surrender-oracle.js';
import { evaluateAnchoredRows } from './f5-confirm-oracle.js';
import type { OracleVerdict } from './oracle-result.js';
import { expectedAutoSurrender, type AutoTrip } from './auto-surrender.js';
import { fixedCommissionDays } from './commission-settings.js';
import { expectedManualSurrender } from './fr-ac-eval-circuit.js';
import { expectedCommissions } from './db-oracle-eval.js';

// FR 1901, rendicion 14181 (oraculo manual 2026-11-05): A efectivo 3015,80 con NC 15; B CC 2743 con NC 15.
const FR: F5TripFacts[] = [
  {
    travelId: 72133,
    paymentMethod: 'CASH',
    finalPrice: 3015.8,
    toll: 0,
    parking: 0,
    noCom: 15,
    taxes: 0
  },
  {
    travelId: 72134,
    paymentMethod: 'CHECKING_ACCOUNT',
    finalPrice: 2743,
    toll: 0,
    parking: 0,
    noCom: 15,
    taxes: 0
  }
];
// AR 1040 lote A: 72136 efectivo 1545 con NC 450 e impuestos 100; 72137 CC 1000 con impuestos 100.
const AR: F5TripFacts[] = [
  {
    travelId: 72136,
    paymentMethod: 'CASH',
    finalPrice: 1545,
    toll: 0,
    parking: 0,
    noCom: 450,
    taxes: 100
  },
  {
    travelId: 72137,
    paymentMethod: 'CHECKING_ACCOUNT',
    finalPrice: 1000,
    toll: 0,
    parking: 0,
    noCom: 0,
    taxes: 100
  }
];

describe('expectedF5', () => {
  it('FR 14181: efectivo sin NC, NC efectivo aparte, CC sin NC', () => {
    const e = expectedF5(FR);
    assert.deepEqual(e.totalCash, { amount: 3000.8, quantity: 1 });
    assert.deepEqual(e.totalCheckingAccount, { amount: 2728, quantity: 1 });
    assert.deepEqual(e.ncCash, { amount: 15, quantity: 1 });
    assert.equal(e.totalBilling, 5728.8);
    assert.equal(e.totalCollected, 5743.8);
    assert.equal(e.cashToSurrender, 3015.8);
  });

  it('AR lote A: impuestos solo de efectivo, a rendir 1645, recaudado 2645', () => {
    const e = expectedF5(AR);
    assert.equal(e.totalCash.amount, 1095);
    assert.equal(e.totalCheckingAccount.amount, 1000);
    assert.deepEqual(e.ncCash, { amount: 450, quantity: 1 });
    assert.equal(e.taxesCash, 100);
    assert.equal(e.cashToSurrender, 1645);
    assert.equal(e.totalCollected, 2645);
  });

  it('sin NC: NC {0,0} y a rendir = efectivo + impuestos', () => {
    const e = expectedF5([{ ...AR[0], noCom: 0 }]);
    assert.deepEqual(e.ncCash, { amount: 0, quantity: 0 });
    assert.equal(e.cashToSurrender, 1645);
  });

  it('lote vacio lanza y medio de pago desconocido lanza', () => {
    assert.throws(() => expectedF5([]), /sin viajes/);
    assert.throws(() => expectedF5([{ ...FR[0], paymentMethod: 'BARTER' }]), /desconocido/);
  });
});

const FR_GET = {
  totalCash: { amount: 3000.8, quantity: 1 },
  totalCheckingAccount: { amount: 2728, quantity: 1 },
  totalCreditCard: { amount: 0, quantity: 0 },
  totalCashOtherCostNoCommissionable: { amount: 15, quantity: 1 },
  taxesCostCash: 0,
  fixConceptCostCash: 0,
  commissionSum: 2291.52,
  agencyTotalCommission: 1145.76,
  ownerTotalCommission: 2291.52
};

describe('evaluateGetAgainstExpected / readNcField', () => {
  it('GET real de 1901 coincide con el esperado derivado', () => {
    assert.equal(evaluateGetAgainstExpected(FR_GET, expectedF5(FR)).ok, true);
  });

  it('GET sin el campo NC falla nombrandolo', () => {
    const rest: Record<string, unknown> = { ...FR_GET };
    delete rest.totalCashOtherCostNoCommissionable;
    assert.equal(readNcField(rest).verdict.ok, false);
    const v = evaluateGetAgainstExpected(rest, expectedF5(FR));
    assert.ok(v.mismatches.some((m) => m.field.includes('totalCashOtherCostNoCommissionable')));
  });

  it('un totalCash que todavia incluye el NC (3015,80) se detecta', () => {
    const bad = { ...FR_GET, totalCash: { amount: 3015.8, quantity: 1 } };
    const v = evaluateGetAgainstExpected(bad, expectedF5(FR));
    assert.ok(v.mismatches.some((m) => m.field === 'GET totalCash.amount'));
  });

  it('impuestos = taxesCostCash + fixConceptCostCash, ausentes = 0', () => {
    assert.equal(getTaxesCash({ taxesCostCash: 100 }), 100);
    assert.equal(getTaxesCash({ taxesCostCash: 100, fixConceptCostCash: 5.5 }), 105.5);
    assert.equal(getTaxesCash({}), 0);
  });
});

// Texto de la pantalla de confirmacion de 1901 (captura 20-main-preconfirm-full.png), una linea por elemento.
const FR_LINES = [
  'Total Amount Collected',
  '# 2',
  '€ 5 743,80',
  'Cash Trips',
  '# 1',
  '€ 3 000,80',
  'Credit Card Trips',
  '€ 0,00',
  'Credit Account Trips',
  '# 1',
  '€ 2 728,00',
  'Other Costs No Commissionable (Cash Trips)',
  '€ 15,00',
  'Total Billed Items & Cash Advances',
  '€ 0,00',
  'Total Cash:',
  '€ 3 015,80',
  'Total Driver Commissions',
  '€ 2 291,52',
  'Total Company Commissions',
  '€ 1 145,76',
  'Total Owner Commissions',
  '€ 2 291,52'
];

describe('parseF5Ui / evaluateUiAgainstGet', () => {
  it('lee las lineas de 1901 saltando la cantidad «# N»', () => {
    const ui = parseF5Ui(FR_LINES);
    assert.equal(ui.ncLine, 15);
    assert.equal(ui.totalCash, 3015.8);
    assert.equal(ui.totalCollected, 5743.8);
    assert.equal(ui.cashTrips, 3000.8);
    assert.equal(ui.checkingAccountTrips, 2728);
    assert.equal(ui.driverCommissions, 2291.52);
    assert.equal(ui.companyCommissions, 1145.76);
  });

  it('pantalla de 1901 = GET (con NC)', () => {
    assert.equal(evaluateUiAgainstGet(parseF5Ui(FR_LINES), FR_GET).ok, true);
  });

  it('NC > 0 en el GET y sin linea en pantalla falla', () => {
    const lines = FR_LINES.filter((l) => !/Commissionable|€ 15,00/.test(l));
    const v = evaluateUiAgainstGet(parseF5Ui(lines), FR_GET);
    assert.ok(v.mismatches.some((m) => m.field === 'UI linea NC (efectivo)'));
  });

  it('formato AR (punto de miles, coma decimal) y NC = 0 sin linea', () => {
    const get = {
      ...FR_GET,
      totalCashOtherCostNoCommissionable: { amount: 0, quantity: 0 },
      totalCash: { amount: 1095, quantity: 1 },
      totalCheckingAccount: { amount: 1000, quantity: 1 },
      taxesCostCash: 100,
      commissionSum: 0,
      agencyTotalCommission: 251.4,
      ownerTotalCommission: 1843.6
    };
    const lines = [
      'Total Amount Collected',
      '$ 2.195,00',
      'Cash Trips',
      '$ 1.095,00',
      'Credit Account Trips',
      '$ 1.000,00',
      'Taxes and Fees (Cash Trips)',
      '$ 100,00',
      'Total Company Commissions',
      '$ 251,40',
      'Total Owner Commissions',
      '$ 1.843,60',
      'Total Cash:',
      '$ 1.195,00'
    ];
    const ui = parseF5Ui(lines);
    assert.equal(ui.ncLine, null);
    assert.equal(ui.totalCash, 1195);
    assert.equal(evaluateUiAgainstGet(ui, get).ok, true);
  });

  it('Total Cash que NO suma el NC falla', () => {
    const lines = FR_LINES.map((l) => (l === '€ 3 015,80' ? '€ 3 000,80' : l));
    const v = evaluateUiAgainstGet(parseF5Ui(lines), FR_GET);
    assert.ok(v.mismatches.some((m) => m.field.startsWith('UI Total Cash')));
  });
});

describe('evaluateF5SurrenderRow', () => {
  const row = {
    TOTALCASH: 3000.8,
    TOTALCASHOTHERCOST_NOCOM: 15,
    TOTALCASHOTHERCOSTQTY_NOCOM: 1,
    TAXES_COST_CASH: 0,
    TOTALCASHTOSURRENDER: 3015.8
  };
  it('fila 14181 = esperado', () => {
    assert.equal(evaluateF5SurrenderRow(row, expectedF5(FR)).ok, true);
  });
  it('NULL en las columnas NOCOM FALLA aunque se espere 0; solo TAXES_COST_CASH acepta NULL', () => {
    const nulls = { ...row, TOTALCASHOTHERCOST_NOCOM: null, TOTALCASHOTHERCOSTQTY_NOCOM: null };
    assert.equal(evaluateF5SurrenderRow(nulls, expectedF5(FR)).ok, false);
    const noNc = expectedF5([{ ...FR[0], finalPrice: 3000.8, noCom: 0 }]);
    const zeroRow = {
      ...row,
      TOTALCASHOTHERCOST_NOCOM: 0,
      TOTALCASHOTHERCOSTQTY_NOCOM: 0,
      TOTALCASHTOSURRENDER: 3000.8
    };
    assert.equal(evaluateF5SurrenderRow({ ...zeroRow, TAXES_COST_CASH: null }, noNc).ok, true);
    const v = evaluateF5SurrenderRow(
      { ...zeroRow, TOTALCASHOTHERCOST_NOCOM: null, TAXES_COST_CASH: null },
      noNc
    );
    assert.equal(v.ok, false, 'NOCOM NULL con NC = 0 debe fallar (la columna existe y vale 0)');
  });
  it('TOTALCASHTOSURRENDER sin NC se detecta', () => {
    const v = evaluateF5SurrenderRow({ ...row, TOTALCASHTOSURRENDER: 3000.8 }, expectedF5(FR));
    assert.deepEqual(
      v.mismatches.map((m) => m.field),
      ['TRAVELSSURRENDER.TOTALCASHTOSURRENDER']
    );
  });
});

describe('evaluateOwnerTdoc', () => {
  const tdoc = { CHECKINGACCOUNTCODE: 'TDOC', DEBIT: 0, CREDIT: 15 };
  const tdcv = { CHECKINGACCOUNTCODE: 'TDCV', DEBIT: 0, CREDIT: 600.16 };
  it('automatica con NC 15: una fila TDOC credito 15', () => {
    assert.equal(evaluateOwnerTdoc({ rows: [tdcv, tdoc], automatic: true, ncCash: 15 }).ok, true);
  });
  it('automatica con NC 15 y sin TDOC falla', () => {
    assert.equal(evaluateOwnerTdoc({ rows: [tdcv], automatic: true, ncCash: 15 }).ok, false);
  });
  it('manual: cualquier TDOC falla; sin TDOC pasa', () => {
    assert.equal(evaluateOwnerTdoc({ rows: [tdoc], automatic: false, ncCash: 15 }).ok, false);
    assert.equal(evaluateOwnerTdoc({ rows: [tdcv], automatic: false, ncCash: 15 }).ok, true);
  });
  it('NC = 0: sin TDOC en ambas', () => {
    assert.equal(evaluateOwnerTdoc({ rows: [tdcv], automatic: true, ncCash: 0 }).ok, true);
    assert.equal(evaluateOwnerTdoc({ rows: [tdoc], automatic: true, ncCash: 0 }).ok, false);
  });
});

describe('evaluateClearingNcRow', () => {
  const text =
    'Cash Trips   #1   3000,80\nOther Cost NO Commission (Cash Trips)        15,00\nTOTAL  5743,80';
  it('rotulo + importe presentes', () => {
    const v = evaluateClearingNcRow(text, { ncCash: 15 });
    assert.equal(v.ok, true);
    assert.equal(v.labelPresent, true);
  });
  it('rotulo en español', () => {
    assert.equal(
      evaluateClearingNcRow('Otros Costos NO Comisionable (Viajes en efectivo) 450,00', {
        ncCash: 450
      }).ok,
      true
    );
  });
  it('sin rotulo falla aunque el importe aparezca', () => {
    assert.equal(evaluateClearingNcRow('Cash Trips 15,00', { ncCash: 15 }).ok, false);
  });
  it('con NC = 0 no se asevera', () => {
    assert.equal(evaluateClearingNcRow('Cash Trips 100,00', { ncCash: 0 }).ok, true);
  });
});

describe('parseF5Ui con el innerText real de 1040 (celdas separadas por tabulador)', () => {
  const REAL = [
    'Total Amount Collected',
    '# 2',
    '$ 2.645,00',
    'Cash Trips\t# 1\t$ 1.095,00',
    'Credit Card Trips\t\t$ 0,00',
    'Credit Account Trips\t# 1\t$ 1.000,00',
    'Other Costs No Commissionable (Cash Trips)\t\t$ 450,00',
    'Taxes and Fees (Cash Trips)\t\t$ 100,00',
    'Total Billed Items & Cash Advances',
    '$ 0,00',
    'Total Company Commissions',
    '$ 251,40',
    'Total Owner Commissions',
    '$ 1.755,60',
    ' Balance',
    'Total Cash:',
    '$ 1.645,00'
  ];
  const GET = {
    totalCash: { amount: 1095, quantity: 1 },
    totalCheckingAccount: { amount: 1000, quantity: 1 },
    totalCreditCard: { amount: 0, quantity: 0 },
    totalCashOtherCostNoCommissionable: { amount: 450, quantity: 1 },
    taxesCostCash: 100,
    commissionSum: 0,
    agencyTotalCommission: 251.4,
    ownerTotalCommission: 1843.6,
    ownerCheckingAccountFinancialCost: 88
  };

  it('lee NC 450, impuestos 100, efectivo a rendir 1645 y recaudado 2645', () => {
    const ui = parseF5Ui(REAL);
    assert.equal(ui.ncLine, 450);
    assert.equal(ui.taxesLine, 100);
    assert.equal(ui.totalCash, 1645);
    assert.equal(ui.totalCollected, 2645);
    assert.equal(ui.cashTrips, 1095);
    assert.equal(ui.checkingAccountTrips, 1000);
    assert.equal(ui.companyCommissions, 251.4);
    assert.equal(evaluateUiAgainstGet(ui, GET).ok, true);
  });

  it('una etiqueta sin importe no toma el importe de la fila siguiente', () => {
    const lines = REAL.map((l) =>
      l.startsWith('Other Costs No Commissionable')
        ? 'Other Costs No Commissionable (Cash Trips)'
        : l
    );
    assert.equal(parseF5Ui(lines).ncLine, null);
  });
});

describe('comision del propietario neta de costo financiero (1040)', () => {
  const lines = ['Total Cash:', '$ 1.095,00', 'Total Owner Commissions', '$ 1.755,60'];
  const get = {
    totalCash: { amount: 1095, quantity: 1 },
    totalCashOtherCostNoCommissionable: { amount: 0, quantity: 0 },
    ownerTotalCommission: 1843.6
  };
  it('con ownerCheckingAccountFinancialCost 88 la pantalla muestra 1.755,60', () => {
    const v = evaluateUiAgainstGet(parseF5Ui(lines), {
      ...get,
      ownerCheckingAccountFinancialCost: 88
    });
    assert.ok(!v.mismatches.some((x) => x.field.startsWith('UI ownerCommissions')));
  });
  it('sin costo financiero 1.755,60 no coincide con 1.843,60', () => {
    const v = evaluateUiAgainstGet(parseF5Ui(lines), get);
    assert.ok(v.mismatches.some((x) => x.field.startsWith('UI ownerCommissions')));
  });
});

// ───────────── Correcciones 06/11 (revision adversarial) ─────────────

const round = (n: number): number => Math.round(n * 100) / 100;

describe('M1: igualdad al centavo (sin tolerancia)', () => {
  it('un totalCash 0,01 por debajo FALLA en el GET', () => {
    const get = { ...FR_GET, totalCash: { amount: 3000.79, quantity: 1 } };
    const v = evaluateGetAgainstExpected(get, expectedF5(FR));
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.field === 'GET totalCash.amount'));
  });
  it('en pantalla: Total Cash 0,01 por debajo falla', () => {
    const lines = FR_LINES.map((l) => (l === '€ 3 015,80' ? '€ 3 015,79' : l));
    const v = evaluateUiAgainstGet(parseF5Ui(lines), FR_GET);
    assert.ok(v.mismatches.some((m) => m.field.startsWith('UI Total Cash')));
  });
});

describe('B2: una comision que no se lee es FALLO, no skip silencioso', () => {
  it('GET con comisiones y pantalla sin sus renglones falla nombrando cada una', () => {
    const lines = FR_LINES.slice(0, FR_LINES.indexOf('Total Driver Commissions'));
    const v = evaluateUiAgainstGet(parseF5Ui(lines), FR_GET);
    for (const k of ['driverCommissions', 'companyCommissions', 'ownerCommissions']) {
      assert.ok(
        v.mismatches.some((m) => m.field.startsWith(`UI ${k}`) && m.actual === 'ausente'),
        k
      );
    }
  });
  it('comision ausente del GET falla', () => {
    const get: Record<string, unknown> = { ...FR_GET };
    delete get.agencyTotalCommission;
    const v = evaluateUiAgainstGet(parseF5Ui(FR_LINES), get);
    assert.ok(v.mismatches.some((m) => m.field === 'GET agencyTotalCommission'));
  });
  it('unica ausencia tolerada: chofer con comision 0 en el GET (1040)', () => {
    const lines = ['Total Cash:', '€ 3 015,80', 'Total Company Commissions', '€ 1 145,76'];
    const get = { ...FR_GET, commissionSum: 0, ownerTotalCommission: 0 };
    const v = evaluateUiAgainstGet(parseF5Ui(lines), get);
    assert.ok(!v.mismatches.some((m) => m.field.startsWith('UI driverCommissions')));
  });
  it('chofer ausente con comision > 0 en el GET falla', () => {
    const lines = ['Total Cash:', '€ 3 015,80'];
    const v = evaluateUiAgainstGet(parseF5Ui(lines), FR_GET);
    assert.ok(v.mismatches.some((m) => m.field.startsWith('UI driverCommissions')));
  });
});

describe('M5: con NC = 0 la linea esta AUSENTE (14184), ni siquiera «0,00»', () => {
  const get = { ...FR_GET, totalCashOtherCostNoCommissionable: { amount: 0, quantity: 0 } };
  const lines = [
    'Other Costs No Commissionable (Cash Trips)',
    '€ 0,00',
    'Total Cash:',
    '€ 3 000,80'
  ];
  it('linea 0,00 con NC = 0 falla', () => {
    const v = evaluateUiAgainstGet(parseF5Ui(lines), get);
    assert.ok(v.mismatches.some((m) => m.field === 'UI linea NC con NC = 0'));
  });
  it('sin linea pasa ese chequeo', () => {
    const v = evaluateUiAgainstGet(parseF5Ui(lines.slice(2)), get);
    assert.ok(!v.mismatches.some((m) => m.field === 'UI linea NC con NC = 0'));
  });
});

describe('B3: comision = pct × base SIN NC (independiente del GET)', () => {
  const fr = { pctOwner: 0.4, pctDriver: 0.4, pctAgency: 0.2, ownerFixed: 0, agencyFixed: 0 };
  it('FR 14181: el GET de 1901 coincide', () => {
    assert.equal(evaluateCommissionsAgainstGet(FR_GET, expectedF5(FR), fr).ok, true);
  });
  it('un GET que calcula la comision sobre una base CON NC (+15) falla', () => {
    const get = {
      ...FR_GET,
      commissionSum: round(0.4 * (3015.8 + 2728)),
      ownerTotalCommission: round(0.4 * (3015.8 + 2728)),
      agencyTotalCommission: round(0.2 * (3015.8 + 2728))
    };
    const v = evaluateCommissionsAgainstGet(get, expectedF5(FR), fr);
    assert.equal(v.ok, false);
    assert.equal(v.mismatches.length, 3);
  });
  it('AR 14185 (lote A): propietario 1.843,60 y agencia 251,40 con fija 0', () => {
    const get = { commissionSum: 0, ownerTotalCommission: 1843.6, agencyTotalCommission: 251.4 };
    const ar = { pctOwner: 0.88, pctDriver: 0, pctAgency: 0.12, ownerFixed: 0, agencyFixed: 0 };
    assert.equal(evaluateCommissionsAgainstGet(get, expectedF5(AR), ar).ok, true);
  });
  it('comision ausente del GET falla', () => {
    assert.equal(evaluateCommissionsAgainstGet({}, expectedF5(FR), fr).mismatches.length, 3);
  });
});

describe('M6: comision fija de agencia por dia no cubierto por la ultima rendicion', () => {
  it('14185: viaje del 05/11 y ultima rendicion 05/11 -> 0 dias (fija 0)', () => {
    assert.equal(fixedCommissionDays(['2026-11-05'], '2026-11-05'), 0);
  });
  it('lote B: viaje del 06/11 y ultima rendicion 05/11 -> 1 dia (fija 122, agencia 242)', () => {
    assert.equal(fixedCommissionDays(['2026-11-06'], '2026-11-05'), 1);
    const c = expectedCommissions({
      cashBase: 1000,
      checkingAccountBase: 0,
      creditCardBase: 0,
      pctOwner: 0.88,
      pctAgency: 0.12,
      pctDriver: 0,
      agencyFixed: 122
    });
    assert.equal(c.AGENCY_TOTALCOMMISSION, 242);
    assert.equal(c.OWNER_TOTALCOMMISSION, 880);
  });
  it('por dia distinto, no por viaje; sin rendicion previa cuenta todos', () => {
    assert.equal(fixedCommissionDays(['2026-11-06', '2026-11-06', '2026-11-07'], null), 2);
    assert.equal(fixedCommissionDays(['2026-11-05', '2026-11-06'], '2026-11-05'), 1);
  });
});

describe('M2: los oraculos manual/automatico restan el NC (14181 / 14182)', () => {
  it('manual cash 3015,80 con NC 15: TOTALCASH 3000,80 y comision del chofer sobre 3000,80', () => {
    const e = expectedManualSurrender('cash', 3015.8, { noCom: 15 });
    assert.equal(e.TOTALCASH, 3000.8);
    assert.equal(e.CASHCOMMISSION, round(0.4 * 3000.8));
  });
  it('manual sin NC no cambia (compatibilidad)', () => {
    assert.equal(expectedManualSurrender('cash', 100).TOTALCASH, 100);
  });
  it('manual: fixedDays 0 no suma la fija', () => {
    const none = expectedManualSurrender('cash', 100, { fixedDays: 0 });
    const one = expectedManualSurrender('cash', 100, { fixedDays: 1 });
    assert.ok(Number(one.AGENCY_TOTALCOMMISSION) >= Number(none.AGENCY_TOTALCOMMISSION));
  });
  it('automatica 14182: cash 3015,80 con NC 15 -> TOTALCASH 3000,80, billing 3000,80, base 3000,80', () => {
    const trip: AutoTrip = {
      scenario: 'S5',
      travelId: 72135,
      paymentMethod: 'CASH',
      simulated: 3015.8,
      closedBy: 'admin',
      assigned: true,
      closed: {
        finalPrice: 3015.8,
        cityTax: 0,
        tolls: 0,
        parking: 0,
        noCom: 15,
        closedAt: '2026-11-05T00:00:00Z'
      }
    };
    const e = expectedAutoSurrender([trip]);
    assert.equal(e.row.TOTALCASH, 3000.8);
    assert.equal(e.row.TOTALBILLING, 3000.8);
    assert.equal(e.bases.cash, 3000.8);
    assert.equal(e.row.TOTALOTHERCOST_NOCOM, 0);
  });
  it('14182: TDOC de la automatica = NC 15 al propietario', () => {
    const v = evaluateOwnerTdoc({
      rows: [{ CHECKINGACCOUNTCODE: 'TDOC', DEBIT: null, CREDIT: 15 }],
      automatic: true,
      ncCash: 15
    });
    assert.equal(v.ok, true);
  });
});

describe('M3: body del POST (14181, 14183, 14184, 14185)', () => {
  const body = (b: Record<string, unknown>) => ({
    fuelVoucher: { amount: 0 },
    miscellanyVoucher: { amount: 0 },
    ...b
  });
  it('14181 FR: surrendered 3015,80 y agencyNetPaid 724,28', () => {
    const want = expectedSurrenderPost({ cashToSurrender: 3015.8, driverCommission: 2291.52 });
    assert.equal(want.agencyNetPaid, 724.28);
    const b = body({ netPaid: 0, surrendered: 3015.8, agencyNetPaid: 724.28, ownerNetPaid: 0 });
    assert.equal(evaluateSurrenderPost(b, want).ok, true);
  });
  it('14183 US: surrendered 22,35 y agencyNetPaid 15,53', () => {
    const want = expectedSurrenderPost({ cashToSurrender: 22.35, driverCommission: 6.82 });
    const b = body({ netPaid: 0, surrendered: 22.35, agencyNetPaid: 15.53, ownerNetPaid: 0 });
    assert.equal(evaluateSurrenderPost(b, want).ok, true);
  });
  it('14184 saldo a favor del chofer: surrendered 0 y netPaid 0,47', () => {
    const want = expectedSurrenderPost({ cashToSurrender: 2.35, driverCommission: 2.82 });
    assert.deepEqual(
      { s: want.surrendered, n: want.netPaid, a: want.agencyNetPaid },
      { s: 0, n: 0.47, a: 0 }
    );
    const b = body({ netPaid: 0.47, surrendered: 0, agencyNetPaid: 0, ownerNetPaid: 0 });
    assert.equal(evaluateSurrenderPost(b, want).ok, true);
  });
  it('14185 AR: surrendered 1645 y agencyNetPaid 1645', () => {
    const want = expectedSurrenderPost({ cashToSurrender: 1645, driverCommission: 0 });
    assert.equal(want.surrendered, 1645);
    assert.equal(want.agencyNetPaid, 1645);
  });
  it('un body con surrendered = efectivo cuando el saldo es del chofer falla', () => {
    const want = expectedSurrenderPost({ cashToSurrender: 2.35, driverCommission: 2.82 });
    const b = body({ netPaid: 0, surrendered: 2.35, agencyNetPaid: 0, ownerNetPaid: 0 });
    assert.equal(evaluateSurrenderPost(b, want).ok, false);
  });
  it('sin body falla', () => {
    const want = expectedSurrenderPost({ cashToSurrender: 1, driverCommission: 0 });
    assert.equal(evaluateSurrenderPost(null, want).ok, false);
  });
});

describe('M13: la fila NC del Clearing se ancla al rotulo', () => {
  it('un «15» suelto (fecha, cantidad) no basta', () => {
    const text =
      'Fecha 15/11/2026   Cantidad 15,00\nOther Cost NO Commission (Cash Trips)\n\n\n\nTOTAL 5743,80';
    assert.equal(evaluateClearingNcRow(text, { ncCash: 15 }).ok, false);
  });
  it('importe en el renglon siguiente pasa', () => {
    const text = 'Other Cost NO Commission (Cash Trips)\n   15,00\nTOTAL';
    assert.equal(evaluateClearingNcRow(text, { ncCash: 15 }).ok, true);
  });
});

describe('B1 / M14: contrato de «Entregar» y formatos por locale', () => {
  it('saldo esperado: 1645 − 1234,56 = 410,44 a la compania; 1100 − 1234,56 = 134,56 al chofer', () => {
    assert.deepEqual(expectedDeliverBalance(1645, 1234.56), { kind: 'Company', balance: 410.44 });
    assert.deepEqual(expectedDeliverBalance(1100, 1234.56), { kind: 'Driver', balance: 134.56 });
  });
  it('base del saldo US 1521 con comision del chofer: 22,35 − 6,82 = 15,53 (par A) y 22,35 − 4,94 = 17,41 (par B)', () => {
    const card = (comm: string, due: string): string =>
      `Total Cash: $ 22.35 Deductions & Expenses: (-) $ 0.00 Commissions & Tips: (-) $ ${comm} ` +
      `Financial Costs: (+)( 0.00%) $ 0.00 Amount due to: Company: $ ${due} Cash $ Due to Company: $ 0.00 Confirm`;
    const a = parseDeliverBase(card('6.82', '15.53'));
    assert.equal(a?.base, 15.53);
    assert.deepEqual([a?.dueKind, a?.dueAmount, a?.commissions], ['Company', 15.53, 6.82]);
    assert.equal(parseDeliverBase(card('4.94', '17.41'))?.base, 17.41);
    // Con «Total Cash» como base (el bug de spec) el saldo al entregar 0 seria 22,35, no 15,53.
    assert.deepEqual(expectedDeliverBalance(a?.base ?? NaN, 0), {
      kind: 'Company',
      balance: 15.53
    });
    assert.deepEqual(expectedDeliverBalance(a?.base ?? NaN, 15.54), {
      kind: 'Driver',
      balance: 0.01
    });
  });
  it('base del saldo AR 1040 (comision 0, miles con punto): coincide con «Total Cash»; costo financiero suma', () => {
    const card =
      'Total Cash: $ 1.645,00 Deductions & Expenses: (-) $ 0,00 Commissions & Tips: (-) $ 0,00 ' +
      'Financial Costs: (+)( 0.00%) $ 0,00 Amount due to: Company: $ 1.645,00 Confirm';
    const r = parseDeliverBase(card);
    assert.equal(r?.base, 1645);
    assert.equal(r?.totalCash, 1645);
    const withFin = parseDeliverBase(
      'Total Cash: $ 1.000,00 Deductions & Expenses: (-) $ 100,00 Commissions & Tips: (-) $ 50,00 ' +
        'Financial Costs: (+)( 2.00%) $ 20,00 Amount due to: Company: $ 870,00'
    );
    assert.equal(withFin?.base, 870);
  });
  it('tarjeta sin algun renglon de la formula: null (nunca adivina)', () => {
    assert.equal(parseDeliverBase('Total Cash: $ 22.35 Amount due to: Company: $ 15.53'), null);
  });
  it('casos HP-01: 1234,567 -> 1234,56 · -10 -> 10 · abc -> vacio y Confirmar deshabilitado', () => {
    assert.deepEqual(deliverContractCases(','), [
      { raw: '1234,567', shown: '1234,56', confirmDisabled: false, amount: 1234.56 },
      { raw: '-10', shown: '10', confirmDisabled: false, amount: 10 },
      { raw: 'abc', shown: '', confirmDisabled: true, amount: null }
    ]);
    assert.equal(deliverContractCases('.')[0].shown, '1234.56');
  });
  it('AR es-AR: 1.645,00 ok; 1,645.00 y miles mal agrupados fallan', () => {
    assert.equal(matchesMoneyFormat('$ 1.645,00', F5_FORMATS.AR), true);
    assert.equal(matchesMoneyFormat('$ 22,35', F5_FORMATS.AR), true);
    assert.equal(matchesMoneyFormat('$ 1,645.00', F5_FORMATS.AR), false);
    assert.equal(matchesMoneyFormat('$ 1.64,00', F5_FORMATS.AR), false);
  });
  it('US: 1,645.00 y 22.35 ok; coma decimal falla', () => {
    assert.equal(matchesMoneyFormat('$ 1,645.00', F5_FORMATS.US), true);
    assert.equal(matchesMoneyFormat('$ 22.35', F5_FORMATS.US), true);
    assert.equal(matchesMoneyFormat('$ 22,35', F5_FORMATS.US), false);
  });
  it('FR: 3015,80 ok; con espacio de miles falla', () => {
    assert.equal(matchesMoneyFormat('€ 3015,80', F5_FORMATS.FR), true);
    assert.equal(matchesMoneyFormat('€ 3 015,80', F5_FORMATS.FR), false);
  });
  it('evaluateUiFormats: ausente falla y el formato real de 1040 pasa', () => {
    const raw = parseF5UiRaw(['Total Cash:', '$ 1.645,00']);
    assert.equal(evaluateUiFormats(raw, F5_FORMATS.AR, ['totalCash']).ok, true);
    assert.equal(evaluateUiFormats(raw, F5_FORMATS.AR, ['totalCash', 'totalCollected']).ok, false);
    assert.equal(evaluateUiFormats(raw, F5_FORMATS.US, ['totalCash']).ok, false);
  });
});

// AC-F5-16: validado en DB TEST el 06/11 sobre las rendiciones 14181-14188 (TOTALOTHERCOST_NOCOM =
// CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF = suma NC de los viajes CHECKING_ACCOUNT, tambien la cantidad).
const trip = (paymentMethod: string, noCom: number): F5TripFacts => ({
  travelId: 1,
  paymentMethod,
  finalPrice: 1000,
  toll: 0,
  parking: 0,
  noCom,
  taxes: 0
});
const CC_NC_CASES: Array<{ id: number; trips: F5TripFacts[]; nc: number; qty: number }> = [
  { id: 14181, trips: [trip('CASH', 15), trip('CHECKING_ACCOUNT', 15)], nc: 15, qty: 1 },
  { id: 14182, trips: [trip('CASH', 15)], nc: 0, qty: 0 },
  { id: 14183, trips: [trip('CASH', 10), trip('CHECKING_ACCOUNT', 10)], nc: 10, qty: 1 },
  { id: 14184, trips: [trip('CASH', 0), trip('CHECKING_ACCOUNT', 0)], nc: 0, qty: 0 },
  { id: 14185, trips: [trip('CASH', 450), trip('CHECKING_ACCOUNT', 0)], nc: 0, qty: 0 },
  { id: 14186, trips: [trip('CASH', 0)], nc: 0, qty: 0 },
  { id: 14187, trips: [trip('CASH', 450)], nc: 0, qty: 0 },
  { id: 14188, trips: [trip('CASH', 450)], nc: 0, qty: 0 }
];

describe('AC-F5-16: NC de viajes CC (rendiciones 14181-14188)', () => {
  for (const c of CC_NC_CASES) {
    it(`rendicion ${c.id}: NOCOM = DIFF = ${c.nc}, qty ${c.qty}`, () => {
      const e = expectedF5(c.trips);
      assert.deepEqual(e.ncCheckingAccount, { amount: c.nc, quantity: c.qty });
      const row = {
        TOTALOTHERCOST_NOCOM: c.nc,
        TOTALOTHERCOSTQTY_NOCOM: c.qty,
        CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: c.nc
      };
      assert.equal(evaluateCcNcRow(row, e).ok, true);
      assert.equal(evaluateGetCcNc({ checkingAccountAgencyProfitDiff: c.nc }, e).ok, true);
    });
  }
  it('el NC de viajes en efectivo NO suma a TOTALOTHERCOST_NOCOM (14182: 0 con NC efectivo 15)', () => {
    const e = expectedF5([trip('CASH', 15)]);
    assert.equal(e.ncCash.amount, 15);
    const bad = {
      TOTALOTHERCOST_NOCOM: 15,
      TOTALOTHERCOSTQTY_NOCOM: 1,
      CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: 0
    };
    assert.equal(evaluateCcNcRow(bad, e).ok, false);
  });
  it('NULL, DIFF distinto o GET ausente/erroneo FALLAN', () => {
    const e = expectedF5(CC_NC_CASES[0].trips);
    const ok = {
      TOTALOTHERCOST_NOCOM: 15,
      TOTALOTHERCOSTQTY_NOCOM: 1,
      CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: 15
    };
    assert.equal(evaluateCcNcRow({ ...ok, TOTALOTHERCOST_NOCOM: null }, e).ok, false);
    assert.equal(evaluateCcNcRow({ ...ok, CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: 0 }, e).ok, false);
    assert.equal(evaluateCcNcRow({ ...ok, TOTALOTHERCOSTQTY_NOCOM: 0 }, e).ok, false);
    assert.equal(evaluateGetCcNc({}, e).ok, false);
    assert.equal(evaluateGetCcNc({ checkingAccountAgencyProfitDiff: 0 }, e).ok, false);
  });
});

// ───────────────────────────── W2: H-01..H-04 ─────────────────────────────

const t2 = (f: Partial<F5TripFacts> & { travelId: number }): F5TripFacts => ({
  paymentMethod: 'CASH',
  finalPrice: 0,
  toll: 0,
  parking: 0,
  noCom: 0,
  taxes: 0,
  ...f
});

describe('H-01: modo de pdftotext fijo, sin rescate por otro modo', () => {
  // PDF desalineado sintético: en `layout` el importe del Cash Trips quedó en el renglón de OTRO rótulo; en `table`
  // cada importe está en su renglón (UAT 06/11).
  const rows = [
    { field: 'Cash Trips', label: /^\s*Cash Trips\b/i, amount: 1095 },
    { field: 'TOTAL', label: /^\s*TOTAL\b/, amount: 2645 }
  ];
  const layout = 'Cash Trips        # 1\n   $ 2.645,00\nTOTAL             # 2    $ 1.095,00';
  const table = 'Cash Trips        # 1    $ 1.095,00\nTOTAL             # 2    $ 2.645,00';
  const read = (text: string): OracleVerdict => evaluateAnchoredRows(text, rows);
  const readings = [
    { mode: 'layout' as const, verdict: read(layout) },
    { mode: 'table' as const, verdict: read(table) }
  ];
  it('premisa: layout desalineado no ancla y table sí', () => {
    assert.equal(readings[0].verdict.ok, false);
    assert.equal(readings[1].verdict.ok, true);
  });
  it('modo fijo layout: FALLA aunque table ancle (el desalineado debe fallar) y table queda como diagnóstico', () => {
    const d = decidePdfModes(readings, 'layout');
    assert.equal(d.verdict.ok, false);
    assert.equal(d.mode, 'layout');
    assert.equal(d.decidedBy, 'fixed');
    assert.equal(d.modesDisagree, true);
    assert.deepEqual(
      d.diagnostics.map((x) => [x.mode, x.ok]),
      [
        ['layout', false],
        ['table', true]
      ]
    );
  });
  it('modo fijo table: pasa y registra el modo', () => {
    const d = decidePdfModes(readings, 'table');
    assert.deepEqual(
      [d.verdict.ok, d.mode, d.decidedBy, d.modesDisagree],
      [true, 'table', 'fixed', true]
    );
  });
  it('sin modo fijo (compatibilidad): acepta el primero que ancla pero lo declara fallback-any con desacuerdo', () => {
    const d = decidePdfModes(readings, null);
    assert.deepEqual(
      [d.verdict.ok, d.mode, d.decidedBy, d.modesDisagree],
      [true, 'table', 'fallback-any', true]
    );
  });
  it('sin modo fijo y ninguno ancla: devuelve el primer modo legible (diagnóstico original)', () => {
    const d = decidePdfModes([readings[0]], null);
    assert.deepEqual([d.verdict.ok, d.mode, d.modesDisagree], [false, 'layout', false]);
  });
  it('modo fijo no legible o sin lecturas lanzan', () => {
    assert.throws(() => decidePdfModes([readings[0]], 'table'), /no pudo leer/);
    assert.throws(() => decidePdfModes([], null), /ningún modo/);
  });
  it('F5_PDF_MODE: vacío = sin modo fijo; válido se normaliza; inválido lanza', () => {
    assert.equal(parseF5PdfMode(undefined), null);
    assert.equal(parseF5PdfMode(' '), null);
    assert.equal(parseF5PdfMode(' Table '), 'table');
    assert.throws(() => parseF5PdfMode('xyz'), /F5_PDF_MODE/);
  });
});

describe('H-02: profitDiff de la CC = NC (por venta) o venta − costo (por costo)', () => {
  // R02 US 71563: CC por costo, venta 100, costo 42,1 → profitDiff 57,9 con NC 4 (la igualdad con NC NO vale).
  const byCost = expectedF5([
    t2({
      travelId: 71563,
      paymentMethod: 'CHECKING_ACCOUNT',
      finalPrice: 100,
      noCom: 4,
      costPrice: 42.1,
      ccByCost: true
    })
  ]);
  it('con CC por costo: NC = 4 y profitDiff esperado = 57,9', () => {
    assert.equal(byCost.ncCheckingAccount.amount, 4);
    assert.deepEqual(expectedCcProfitDiff(byCost), { amount: 57.9, basis: 'cost' });
  });
  it('GET con 57,9 pasa y con el NC (4) FALLA; fila DB: NOCOM = NC y DIFF = 57,9', () => {
    assert.equal(evaluateGetCcNc({ checkingAccountAgencyProfitDiff: 57.9 }, byCost).ok, true);
    assert.equal(evaluateGetCcNc({ checkingAccountAgencyProfitDiff: 4 }, byCost).ok, false);
    const row = {
      TOTALOTHERCOST_NOCOM: 4,
      TOTALOTHERCOSTQTY_NOCOM: 1,
      CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: 57.9
    };
    assert.equal(evaluateCcNcRow(row, byCost).ok, true);
    assert.equal(
      evaluateCcNcRow({ ...row, CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: 4 }, byCost).ok,
      false
    );
    assert.equal(evaluateCcNcRow({ ...row, TOTALOTHERCOST_NOCOM: 57.9 }, byCost).ok, false);
  });
  it('con CC por venta (default, TEST) la igualdad con NC se conserva', () => {
    const bySale = expectedF5([
      t2({
        travelId: 1,
        paymentMethod: 'CHECKING_ACCOUNT',
        finalPrice: 100,
        noCom: 4,
        costPrice: 42.1
      })
    ]);
    assert.deepEqual(expectedCcProfitDiff(bySale), { amount: 4, basis: 'sale' });
    assert.equal(evaluateGetCcNc({ checkingAccountAgencyProfitDiff: 4 }, bySale).ok, true);
  });
  it('CC por costo sin costo conocido: indeterminado, solo exige número presente', () => {
    const e = expectedF5([
      t2({
        travelId: 1,
        paymentMethod: 'CHECKING_ACCOUNT',
        finalPrice: 100,
        noCom: 4,
        costPrice: null,
        ccByCost: true
      })
    ]);
    assert.deepEqual(expectedCcProfitDiff(e), { amount: null, basis: 'indeterminate' });
    assert.equal(evaluateGetCcNc({ checkingAccountAgencyProfitDiff: 12.34 }, e).ok, true);
    assert.equal(evaluateGetCcNc({}, e).ok, false);
    const row = {
      TOTALOTHERCOST_NOCOM: 4,
      TOTALOTHERCOSTQTY_NOCOM: 1,
      CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: null
    };
    assert.equal(evaluateCcNcRow(row, e).ok, false);
  });
  it('lote mixto (una CC por venta + una por costo) suma NC de la primera + venta − costo de la segunda', () => {
    const e = expectedF5([
      t2({ travelId: 1, paymentMethod: 'CHECKING_ACCOUNT', finalPrice: 100, noCom: 4 }),
      t2({
        travelId: 2,
        paymentMethod: 'CHECKING_ACCOUNT',
        finalPrice: 100,
        costPrice: 42.1,
        ccByCost: true
      })
    ]);
    assert.deepEqual(expectedCcProfitDiff(e), { amount: 61.9, basis: 'mixed' });
  });
  it('esperado derivado del GET (sin hechos): cae al NC como antes', () => {
    const e = expectedF5([t2({ travelId: 1, finalPrice: 10 })]);
    delete e.checkingAccountProfitDiff;
    assert.deepEqual(expectedCcProfitDiff(e), { amount: 0, basis: 'sale' });
  });
});

describe('H-03: Q9 es observación, no contrato', () => {
  it('«−10 → 10» sale del contrato y va a observación; el resto del contrato queda', () => {
    const { contract, observation } = splitDeliverCases(',');
    assert.deepEqual(
      contract.map((c) => c.raw),
      ['1234,567', 'abc']
    );
    assert.deepEqual(
      observation.map((c) => c.raw),
      ['-10']
    );
  });
  it('deliverContractCases conserva su forma (consumidores existentes)', () => {
    assert.equal(deliverContractCases(',').length, 3);
  });
  it('la pregunta abierta nombra Q9, el valor y que no es PASS/FAIL', () => {
    for (const kind of ['zero', 'overDue', 'negativeSign'] as const) {
      const q = deliverQ9Question('0', kind);
      assert.match(q, /Q9/);
      assert.match(q, /no es PASS\/FAIL/);
    }
  });
});

describe('H-04: definición de TOTALCASH con peaje/estacionamiento (regla abierta, D-6)', () => {
  const trips = [t2({ travelId: 9, finalPrice: 1000, toll: 30, parking: 20, noCom: 15 })];
  it('por defecto excluye peaje y estacionamiento (F5): 1000 − 50 − 15 = 935', () => {
    const e = expectedF5(trips);
    assert.equal(e.totalCash.amount, 935);
    assert.equal(e.totalCashDefinition, 'excludeTollParking');
  });
  it('definición alternativa (automática FR) los incluye: 1000 − 15 = 985', () => {
    const e = expectedF5(trips, { totalCashDefinition: 'includeTollParking' });
    assert.equal(e.totalCash.amount, 985);
    assert.equal(e.totalCashDefinition, 'includeTollParking');
  });
  it('declara observation con peaje/estacionamiento > 0 en efectivo y no sin ellos ni en CC', () => {
    assert.match(expectedF5(trips).observations?.[0] ?? '', /H-04/);
    assert.equal(expectedF5([t2({ travelId: 1, finalPrice: 10 })]).observations, undefined);
    assert.equal(
      totalCashOpenQuestion([
        t2({ travelId: 2, paymentMethod: 'CHECKING_ACCOUNT', finalPrice: 10, toll: 3 })
      ]),
      null
    );
  });
  it('detecta con qué definición coincide el GET (o ninguna)', () => {
    const get = (amount: number): Record<string, unknown> => ({
      totalCash: { amount, quantity: 1 }
    });
    assert.equal(matchedTotalCashDefinition(get(935), trips), 'excludeTollParking');
    assert.equal(matchedTotalCashDefinition(get(985), trips), 'includeTollParking');
    assert.equal(matchedTotalCashDefinition(get(900), trips), 'ninguna');
    assert.equal(matchedTotalCashDefinition({}, trips), 'ninguna');
  });
  it('sin peaje/estacionamiento ambas definiciones coinciden (no hay ambigüedad)', () => {
    const plain = [t2({ travelId: 3, finalPrice: 500, noCom: 5 })];
    assert.equal(
      expectedF5(plain).totalCash.amount,
      expectedF5(plain, { totalCashDefinition: 'includeTollParking' }).totalCash.amount
    );
  });
});
