// tests/utils/units.unit.ts
// Unit test de la utilidad de unidades (node:test -- sin runner de Playwright). Sufijo .unit.ts:
// Playwright no lo recoge como spec. Mismo patrón de redact.unit.ts (incluido el eslint-disable
// puntual por `playwright/expect-expect`, que confunde `test(titulo, fn)` de node:test con un spec).
// Run: npx tsx --test tests/utils/units.unit.ts
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import {
  KM_PER_MILE,
  containsUnit,
  expectedDistance,
  isWithin,
  kmToMiles,
  parseDistance,
  parseLocalizedNumber,
  unitLabel
} from './units.js';

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('el factor del producto es 1,60934', () => {
  assert.equal(KM_PER_MILE, 1.60934);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('kmToMiles convierte con los valores medidos en UAT (viaje 722269, rango de mayo)', () => {
  assert.equal(kmToMiles(10.26), 6.38);
  assert.equal(kmToMiles(48.9), 30.39);
  assert.equal(kmToMiles(14.73), 9.15);
  assert.equal(kmToMiles(0), 0);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('kmToMiles admite 3 decimales (Destino Abierto)', () => {
  assert.equal(kmToMiles(956625.992645, 3), 594421.311);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('expectedDistance: imperial convierte, métrico deja el crudo', () => {
  assert.equal(expectedDistance(34.07, 'imperial'), 21.17);
  assert.equal(expectedDistance(34.07, 'metric'), 34.07);
  assert.equal(unitLabel('imperial'), 'Mi');
  assert.equal(unitLabel('metric'), 'km');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('parseLocalizedNumber entiende en-US y es-AR', () => {
  assert.equal(parseLocalizedNumber('1,234.56'), 1234.56);
  assert.equal(parseLocalizedNumber('1.234,56'), 1234.56);
  assert.equal(parseLocalizedNumber('34,07'), 34.07);
  assert.equal(parseLocalizedNumber('6.38'), 6.38);
  assert.equal(parseLocalizedNumber('1,234,567.8'), 1234567.8);
  assert.equal(parseLocalizedNumber('1.234.567,8'), 1234567.8);
  assert.equal(parseLocalizedNumber('594421.311'), 594421.311);
  assert.ok(Number.isNaN(parseLocalizedNumber('abc')));
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('parseLocalizedNumber: el caso ambiguo de 3 dígitos se resuelve con el hint', () => {
  assert.equal(parseLocalizedNumber('1,234'), 1234);
  assert.equal(parseLocalizedNumber('1.234'), 1.234);
  assert.equal(parseLocalizedNumber('1.234', ','), 1234);
  assert.equal(parseLocalizedNumber('1,234', ','), 1.234);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('parseDistance lee número + unidad y respeta el borde de palabra', () => {
  assert.deepEqual(parseDistance('Distance: 6.38 Mi'), { value: 6.38, unit: 'Mi' });
  assert.deepEqual(parseDistance('Distancia: 34,07 km'), { value: 34.07, unit: 'km' });
  assert.deepEqual(parseDistance('7.16 Mi/ Driver'), { value: 7.16, unit: 'Mi' });
  assert.deepEqual(parseDistance('0.00Mi'), { value: 0, unit: 'Mi' });
  assert.equal(parseDistance('13.00 min'), null);
  assert.equal(parseDistance('sin distancia'), null);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('containsUnit: «Mi» no es «min» y «km» se detecta sin importar la capitalización', () => {
  assert.equal(containsUnit('0.45 Mi', 'Mi'), true);
  assert.equal(containsUnit('13.00 min', 'Mi'), false);
  assert.equal(containsUnit('Min/Trip', 'Mi'), false);
  assert.equal(containsUnit('$11.95 /Km', 'km'), true);
  assert.equal(containsUnit('100.00 Mi', 'km'), false);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('isWithin usa la tolerancia de visualización (±0,01)', () => {
  assert.equal(isWithin(6.38, 6.37), true);
  assert.equal(isWithin(6.38, 6.36), false);
});
