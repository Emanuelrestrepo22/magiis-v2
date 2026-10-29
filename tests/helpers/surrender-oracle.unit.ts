// tests/helpers/surrender-oracle.unit.ts
// Unit test del oraculo del lote de rendicion (node:test).
// Run: npx tsx --test tests/helpers/surrender-oracle.unit.ts
/* eslint-disable playwright/expect-expect */
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBatchExactly, previewTravelIds } from './surrender-oracle.js';

nodeTest('lote exacto pasa sin importar el orden', () => {
  const v = evaluateBatchExactly([{ travelId: 3 }, { travelId: 1 }, { travelId: 2 }], [1, 2, 3]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.mismatches, []);
});

nodeTest('viaje ajeno se reporta nombrando el id (sin lanzar)', () => {
  const v = evaluateBatchExactly([{ travelId: 1 }, { travelId: 99 }], [1]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.foreign, [99]);
  assert.match(v.message, /AJENOS en el lote: obtenido \[99\]/);
});

nodeTest('viaje esperado ausente se reporta nombrando el id', () => {
  const v = evaluateBatchExactly([{ travelId: 1 }], [1, 2]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, [2]);
  assert.match(v.message, /ausentes: obtenido \[\] vs esperado \[2\]/);
});

nodeTest('duplicado se reporta', () => {
  const v = evaluateBatchExactly([{ travelId: 1 }, { travelId: 1 }], [1]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.duplicated, [1]);
  assert.match(v.message, /duplicados/);
});

nodeTest('fila sin travelId y esperado vacio: previewTravelIds lanza, el evaluador reporta', () => {
  assert.throws(() => previewTravelIds([{}]), /no trae travelId/);
  const noId = evaluateBatchExactly([{}], [1]);
  assert.equal(noId.ok, false);
  assert.match(noId.message, /fila 0 de la vista previa: travelId/);
  const empty = evaluateBatchExactly([{ travelId: 1 }], []);
  assert.equal(empty.ok, false);
  assert.match(empty.message, /expectedTravelIds.*vacio/);
});
