import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expectedEditEffects, type EditDiffs } from './edit-matrix.js';

const zero: EditDiffs = {
  fare: 0,
  wait: 0,
  otherCom: 0,
  otherNoCom: 0,
  toll: 0,
  parking: 0,
  total: 0
};

describe('edit-matrix expectedEditEffects', () => {
  it('CC tarifa +10 (S2 observado 2026-10-20): owner 4 TDEA, chofer 4 TCEA, agencia +2', () => {
    const e = expectedEditEffects('cc', { ...zero, fare: 10, total: 10 });
    assert.equal(e.surrender.TOTALCHECKINGACCOUNT, 10);
    assert.equal(e.surrender.OWNER_TOTALCOMMISSION, 4);
    assert.equal(e.surrender.AGENCY_TOTALCOMMISSION, 2);
    assert.deepEqual(
      e.ownerRows.map((r) => [r.code, r.amount]),
      [['TDEA', 4]]
    );
    assert.deepEqual(
      e.driverRows.map((r) => [r.code, r.amount]),
      [['TCEA', 4]]
    );
    assert.equal(e.ccMovementDelta, 10);
  });

  it('tarifa a la baja invierte a creditos TCES/TDES', () => {
    const e = expectedEditEffects('cash', { ...zero, fare: -10, total: -10 });
    assert.equal(e.driverRows[0].code, 'TCES');
    assert.equal(e.ownerRows[0].code, 'TDES');
    assert.equal(e.surrender.TOTALCASH, -10);
    assert.equal(e.surrender.CASHCOMMISSION, -4);
    assert.equal(e.ccMovementDelta, null);
  });

  it('peaje en efectivo: sin comision, fila (NC) al chofer, a rendir sube', () => {
    const e = expectedEditEffects('cash', { ...zero, toll: 5, total: 5 });
    assert.equal(e.commissionable, 0);
    assert.equal(e.ownerRows.length, 0);
    assert.deepEqual(
      e.driverRows.map((r) => [r.code, r.amount]),
      [['TCEA', 5]]
    );
    assert.equal(e.surrender.TOTALCASH, 0);
    assert.equal(e.surrender.TOTALCASHROADTOLL, 5);
    assert.equal(e.surrender.TOTALCASHTOSURRENDER, 5);
    assert.equal(e.surrender.SURRENDERDIFFERENCE, 0);
  });

  it('otro costo NO comisionable: sin filas de libros ni columnas de rendicion', () => {
    const e = expectedEditEffects('cc', { ...zero, otherNoCom: 5, total: 5 });
    assert.equal(e.driverRows.length + e.ownerRows.length, 0);
    assert.equal(e.surrender.TOTALCHECKINGACCOUNT, 0);
    assert.equal(e.surrender.TOTALOTHERCOST_NOCOM, 0);
    assert.equal(e.ccMovementDelta, 5);
  });
});
