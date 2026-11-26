import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { F5_FORMATS } from '../../../helpers/f5-surrender-oracle.js';
import { F5_KEYS, F5_WEAK_KEYS } from '../../xray/f5-keys.js';
import {
  CONFIRM_CASES,
  CONFIRM_MATRIX,
  CONFIRM_RULES,
  assertCaseAllowed,
  catalogScenariosAreValid,
  confirmCaseKeys,
  confirmEnvOf,
  formatTypedAmount,
  miscellanyAmount,
  parseConfirmCase,
  partialDeliverAmount
} from './f5-confirm-cases.js';

describe('catálogo de casos de confirmación', () => {
  it('una entrada por regla, escenarios de prep válidos y primarias Xray con forma TM-nnnn', () => {
    assert.deepEqual(Object.keys(CONFIRM_CASES).sort(), [...CONFIRM_RULES].sort());
    assert.equal(catalogScenariosAreValid(), true);
    for (const rule of CONFIRM_RULES) {
      assert.match(CONFIRM_CASES[rule].primaryKey, /^TM-\d+$/, rule);
    }
  });
  it('mapeo Xray contrastado con Jira (D-8): primarias y secundarias débiles', () => {
    assert.equal(CONFIRM_CASES.R01.primaryKey, F5_KEYS.TC10_CIRCUITO);
    assert.equal(CONFIRM_CASES.R03.primaryKey, 'TM-1656');
    assert.equal(CONFIRM_CASES.R04.primaryKey, 'TM-1657');
    assert.equal(CONFIRM_CASES.R05.primaryKey, 'TM-1660');
    assert.equal(CONFIRM_CASES.R06.primaryKey, 'TM-1654');
    // TM-1648 (TC3) es solo-vista (línea base): NO es una key de la confirmación de R03.
    assert.ok(!confirmCaseKeys('R03').includes('TM-1648'));
    assert.deepEqual(confirmCaseKeys('R06').slice(1), [
      F5_WEAK_KEYS.FILA_PERSISTIDA,
      F5_WEAK_KEYS.CONSERVACION_TOTALES
    ]);
  });
  it('R04 es la única regla con doble clic y gasto varios; R06 la única con saldo del chofer; R05 tarifa 0', () => {
    assert.deepEqual(
      CONFIRM_RULES.filter((r) => CONFIRM_CASES[r].doubleClick),
      ['R04']
    );
    assert.deepEqual(
      CONFIRM_RULES.filter((r) => CONFIRM_CASES[r].miscellany),
      ['R04']
    );
    assert.deepEqual(
      CONFIRM_RULES.filter((r) => CONFIRM_CASES[r].driverBalance),
      ['R06']
    );
    assert.deepEqual(
      CONFIRM_RULES.filter((r) => CONFIRM_CASES[r].zeroFare),
      ['R05']
    );
    assert.deepEqual(
      CONFIRM_RULES.filter((r) => CONFIRM_CASES[r].deliver.kind === 'ratio'),
      ['R03']
    );
  });
});

describe('matriz regla × carrier × ambiente', () => {
  it('UAT: R01×3, R03×3, R04×3, R05 solo AR, R06 solo US y FR (12 confirmaciones)', () => {
    const uat = CONFIRM_MATRIX.uat;
    const count = (rule: string): string[] =>
      Object.entries(uat)
        .filter(([, rules]) => (rules as readonly string[]).includes(rule))
        .map(([id]) => id);
    assert.deepEqual(count('R01'), ['1040', '1481', '2021']);
    assert.deepEqual(count('R03'), ['1040', '1481', '2021']);
    assert.deepEqual(count('R04'), ['1040', '1481', '2021']);
    assert.deepEqual(count('R05'), ['1040']);
    assert.deepEqual(count('R06'), ['1481', '2021']);
    assert.equal(
      Object.values(uat).reduce((n, rules) => n + rules.length, 0),
      12
    );
  });
  it('TEST: 1521 R01 y 1901 R04 (más 1040 histórico)', () => {
    assert.deepEqual(CONFIRM_MATRIX.test['1521'], ['R01']);
    assert.deepEqual(CONFIRM_MATRIX.test['1901'], ['R04']);
  });
  it('una combinación fuera de la matriz lanza; una dentro no', () => {
    assert.doesNotThrow(() => assertCaseAllowed('uat', '1040', 'R05'));
    assert.throws(() => assertCaseAllowed('uat', '1481', 'R05'), /no está en la matriz/);
    assert.throws(() => assertCaseAllowed('uat', '1901', 'R01'), /no tiene casos/);
    assert.throws(() => assertCaseAllowed('test', '1901', 'R01'), /no está en la matriz/);
  });
});

describe('parseConfirmCase / confirmEnvOf (H-08)', () => {
  it('parsea sin importar mayúsculas; vacío = null; desconocido lanza', () => {
    assert.equal(parseConfirmCase('r04'), 'R04');
    assert.equal(parseConfirmCase(undefined), null);
    assert.equal(parseConfirmCase('  '), null);
    assert.throws(() => parseConfirmCase('R07'), /validos/);
  });
  it('solo uat y test confirman; prod y cualquier otro valor lanzan', () => {
    assert.equal(confirmEnvOf('uat'), 'uat');
    assert.equal(confirmEnvOf(' TEST '), 'test');
    assert.throws(() => confirmEnvOf('prod'), /nunca prod/);
    assert.throws(() => confirmEnvOf(undefined));
    assert.throws(() => confirmEnvOf('staging'));
  });
});

describe('formatTypedAmount / partialDeliverAmount / miscellanyAmount', () => {
  it('importe tecleable por locale: sin miles y con el decimal del carrier', () => {
    assert.equal(formatTypedAmount(28350, F5_FORMATS.AR), '28350');
    assert.equal(formatTypedAmount(10.53, F5_FORMATS.US), '10.53');
    assert.equal(formatTypedAmount(10.53, F5_FORMATS.FR), '10,53');
    assert.throws(() => formatTypedAmount(-1, F5_FORMATS.AR));
    assert.throws(() => formatTypedAmount(Number.NaN, F5_FORMATS.AR));
  });
  it('R03 AR: 60 % de 47.250 = 28.350; US 17,55 -> 10,53; ratio o resultado fuera de rango lanza', () => {
    assert.equal(partialDeliverAmount(47250, 0.6), 28350);
    assert.equal(partialDeliverAmount(17.55, 0.6), 10.53);
    assert.throws(() => partialDeliverAmount(47250, 1));
    assert.throws(() => partialDeliverAmount(47250, 0));
    assert.throws(() => partialDeliverAmount(0.01, 0.6), /fuera de/);
  });
  it('gasto varios: default 100 solo en AR 1040; el resto exige F5_CONFIRM_MISC; inválido lanza', () => {
    assert.equal(miscellanyAmount('1040', undefined), 100);
    assert.equal(miscellanyAmount('1481', '1.5'), 1.5);
    assert.throws(() => miscellanyAmount('1481', undefined), /F5_CONFIRM_MISC/);
    assert.throws(() => miscellanyAmount('1040', '-3'));
    assert.throws(() => miscellanyAmount('1040', 'abc'));
  });
});
