// tests/utils/money.unit.ts
// Unit test de parseMoney / round2 (node:test — sin runner de Playwright).
// Sufijo .unit.ts: Playwright (testDir ./tests, testMatch por defecto) no lo recoge como spec.
// `test` se importa como `nodeTest` y se desactiva expect-expect por archivo: la regla de
// eslint-plugin-playwright toma cualquier test(titulo, fn) como spec aunque use node:assert
// (mismo criterio que xray-consolidate.unit.ts; no se toca eslint.config.js).
// Run: npx tsx --test tests/utils/money.unit.ts
/* eslint-disable playwright/expect-expect */
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, round2 } from './money.js';

nodeTest('parseMoney lee formato US con miles y decimales', () => {
  assert.equal(parseMoney('$ 1,234.56'), 1234.56);
  assert.equal(parseMoney('$ 0.41'), 0.41);
  assert.equal(parseMoney('$ 12,345,678.90'), 12345678.9);
});

nodeTest('parseMoney lee formato AR con miles y decimales', () => {
  assert.equal(parseMoney('$ 1.234,56'), 1234.56);
  assert.equal(parseMoney('$ 5,01'), 5.01);
  assert.equal(parseMoney('$ 12.345.678,90'), 12345678.9);
});

nodeTest('parseMoney lee negativos con el signo antes o despues del simbolo', () => {
  assert.equal(parseMoney('-$ 5.00'), -5);
  assert.equal(parseMoney('$ -5.00'), -5);
  assert.equal(parseMoney('-$ 1.234,50'), -1234.5);
});

nodeTest('parseMoney toma como miles un separador seguido de 3 digitos', () => {
  assert.equal(parseMoney('$ 1,234'), 1234);
  assert.equal(parseMoney('$ 1.234'), 1234);
  assert.equal(parseMoney('25'), 25);
  assert.equal(parseMoney(' 1500 $ '), 1500);
});

nodeTest('parseMoney rechaza textos sin importe o con separadores ambiguos', () => {
  assert.throws(() => parseMoney('Trip Total'), /no se reconoce/);
  assert.throws(() => parseMoney('$ '), /no se reconoce/);
  assert.throws(() => parseMoney('1.5'), /ambiguos/);
  assert.throws(() => parseMoney('12,34,567.00'), /ambiguos/);
});

nodeTest('round2 redondea mitad hacia arriba en valor absoluto', () => {
  assert.equal(round2(1.002), 1);
  assert.equal(round2(5.01 * 0.2), 1);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(1234.56), 1234.56);
  assert.equal(round2(-0.001), 0);
  assert.throws(() => round2(Number.NaN), /no finito/);
});

nodeTest('parseMoney lee euros con coma decimal y simbolo antes o despues', () => {
  assert.equal(parseMoney('€ 1.234,56'), 1234.56);
  assert.equal(parseMoney('1.234,56 €'), 1234.56);
  assert.equal(parseMoney('€12,50'), 12.5);
  assert.equal(parseMoney('-€ 10,00'), -10);
  assert.equal(parseMoney('1 234,56 €'), 1234.56);
});
