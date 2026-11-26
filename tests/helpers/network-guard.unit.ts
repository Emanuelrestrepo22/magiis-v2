// tests/helpers/network-guard.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyWrite, formatGuardLine, isBusinessWrite } from './network-guard.js';

const B = 'https://apps-uat.magiis.com/magiis-v0.2';

describe('classifyWrite: permitidas', () => {
  it('alta, cancelar, cierre administrativo y tarifa final', () => {
    assert.equal(classifyWrite('POST', `${B}/carriers/1040/travels`), 'allowed');
    assert.equal(classifyWrite('PUT', `${B}/carriers/1040/travels/723580/cancel`), 'allowed');
    assert.equal(
      classifyWrite('POST', `${B}/carriers/1040/travels/723580/finalizeAdmin`),
      'allowed'
    );
    assert.equal(classifyWrite('PUT', `${B}/carriers/1040/travels/723580/audit`), 'allowed');
    assert.equal(
      classifyWrite('PUT', `${B}/carriers/1040/travels/723580/updateFinalPrices`),
      'allowed'
    );
    assert.equal(
      classifyWrite('POST', `${B}/carriers/1040/travels/723580/updateFinalPricesProcess`),
      'allowed'
    );
  });
  it('POST de lectura de la pantalla (cotizacion, busquedas, grillas) son permitidos pero NO de negocio', () => {
    const reads = [
      `${B}/carriers/1040/paymentMethodsByPax`,
      `${B}/carriers/1040/travels/simulateAll`,
      `${B}/carriers/1040/otherCosts/search`,
      `${B}/data/genericReport/019/paginated`
    ];
    for (const url of reads) {
      assert.equal(classifyWrite('POST', url), 'allowed', url);
      assert.equal(isBusinessWrite('POST', url), false, url);
    }
    assert.equal(isBusinessWrite('POST', `${B}/carriers/1040/travels`), true);
  });
  it('la query nunca interviene en la clasificacion', () => {
    assert.equal(
      classifyWrite('POST', `${B}/carriers/1040/travels?x=toTravelsSurrender`),
      'allowed'
    );
  });
});

describe('classifyWrite: prohibidas', () => {
  it('rendicion, liquidaciones, propietario, autodispatch', () => {
    assert.equal(
      classifyWrite('POST', `${B}/carriers/1040/travels/toTravelsSurrender?driverUserId=1`),
      'forbidden'
    );
    assert.equal(
      classifyWrite('PUT', `${B}/vehicles/5356/carrier/2021/travelsSurrender`),
      'forbidden'
    );
    assert.equal(classifyWrite('PUT', `${B}/carriers/1481/vehicleOwners/4287`), 'forbidden');
    assert.equal(classifyWrite('POST', `${B}/carriers/1481/vehicleOwners`), 'forbidden');
    assert.equal(
      classifyWrite('POST', `${B}/carriers/1481/carrierDriverLiquidations/7`),
      'forbidden'
    );
    assert.equal(
      classifyWrite('POST', `${B}/carriers/1481/carrierOwnerLiquidations/7`),
      'forbidden'
    );
    assert.equal(classifyWrite('POST', `${B}/carriers/1481/travels/autoDispatch`), 'forbidden');
    assert.equal(classifyWrite('PUT', `${B}/carriers/1481/travels/9/autoDispatch`), 'forbidden');
  });
  it('todo DELETE, sea cual sea la ruta', () => {
    assert.equal(classifyWrite('DELETE', `${B}/carriers/1040/travels/1`), 'forbidden');
    assert.equal(classifyWrite('delete', `${B}/otherCosts/5`), 'forbidden');
  });
});

describe('classifyWrite: desconocidas y libres', () => {
  it('un POST/PUT no listado es unknown (falla el test, no pasa en silencio)', () => {
    assert.equal(classifyWrite('POST', `${B}/carriers/1040/drivers`), 'unknown');
    assert.equal(classifyWrite('PUT', `${B}/carriers/1040/travels/5/assign`), 'unknown');
  });
  it('GET/OPTIONS/HEAD siempre libres', () => {
    for (const m of ['GET', 'OPTIONS', 'HEAD']) {
      assert.equal(classifyWrite(m, `${B}/carriers/1040/travels/toTravelsSurrender`), 'free');
    }
  });
  it('hosts que no son del backend MAGIIS son libres', () => {
    assert.equal(classifyWrite('POST', 'https://maps.googleapis.com/maps/api/js/x'), 'free');
  });
});

describe('formatGuardLine', () => {
  it('registra clase, metodo y ruta SIN query ni host', () => {
    const line = formatGuardLine(
      new Date('2026-11-11T10:00:00Z'),
      'forbidden',
      'post',
      `${B}/carriers/1/travels/toTravelsSurrender?driverUserId=9&token=SECRET`
    );
    assert.equal(
      line,
      '2026-11-11T10:00:00.000Z FORBIDDEN POST /magiis-v0.2/carriers/1/travels/toTravelsSurrender'
    );
    assert.equal(line.includes('SECRET'), false);
  });
});
