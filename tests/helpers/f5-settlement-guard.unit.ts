// tests/helpers/f5-settlement-guard.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifySettlementRequest, type SettlementScope } from './f5-settlement-guard.js';

const HOST = 'https://apps-uat.magiis.com/magiis-v0.2';
const driver: SettlementScope = { kind: 'driver', carrierId: 2021, accountId: 6440 };
const owner: SettlementScope = { kind: 'owner', carrierId: 2021, accountId: 4289 };

describe('classifySettlementRequest', () => {
  it('GET/OPTIONS/HEAD son libres y hosts ajenos a MAGIIS tambien', () => {
    assert.equal(
      classifySettlementRequest(
        'GET',
        `${HOST}/carrierDriverLiquidations/surrenders/withoutLiquidations/2021/6440/2026-11-11`,
        driver
      ),
      'free'
    );
    assert.equal(classifySettlementRequest('OPTIONS', `${HOST}/x`, driver), 'free');
    assert.equal(classifySettlementRequest('POST', 'https://cdn.example.com/a', driver), 'free');
  });

  it('el POST de la liquidacion del par es «confirm»; de otro chofer, carrier o tipo es «blocked»', () => {
    assert.equal(
      classifySettlementRequest('POST', `${HOST}/carrierDriverLiquidations/2021/6440`, driver),
      'confirm'
    );
    assert.equal(
      classifySettlementRequest('POST', `${HOST}/carrierOwnerLiquidations/2021/4289`, owner),
      'confirm'
    );
    assert.equal(
      classifySettlementRequest('POST', `${HOST}/carrierDriverLiquidations/2021/6441`, driver),
      'blocked'
    );
    assert.equal(
      classifySettlementRequest('POST', `${HOST}/carrierDriverLiquidations/1040/6440`, driver),
      'blocked'
    );
    assert.equal(
      classifySettlementRequest('POST', `${HOST}/carrierOwnerLiquidations/2021/4289`, driver),
      'blocked'
    );
  });

  it('el comprobante PDF (POST de lectura) se permite en chofer y propietario, con query', () => {
    assert.equal(
      classifySettlementRequest(
        'POST',
        `${HOST}/carrierDriverLiquidations/getLiquidationTravelsDetails/report/1850?sort=ASC&column=id&languageCode=ES&hideAmount=f`,
        driver
      ),
      'read'
    );
    assert.equal(
      classifySettlementRequest(
        'POST',
        `${HOST}/carrierOwnerLiquidations/getLiquidationTravelsDetails/report/7054?hideAmount=t`,
        owner
      ),
      'read'
    );
  });

  it('cualquier otra escritura (PUT/DELETE de liquidacion, rendicion, viaje, propietario) se bloquea', () => {
    for (const [m, p] of [
      ['PUT', '/carrierDriverLiquidations/2021/6440'],
      ['DELETE', '/carrierDriverLiquidations/1850'],
      ['PUT', '/carrierOwnerLiquidations/cancel/7054'],
      ['POST', '/carriers/2021/travels/toTravelsSurrender'],
      ['PUT', '/vehicles/5356/carrier/2021/travelsSurrender'],
      ['PUT', '/vehicleOwners/4289'],
      ['PUT', '/travels/723600/updateFinalPrices']
    ] as const) {
      assert.equal(classifySettlementRequest(m, `${HOST}${p}`, driver), 'blocked', `${m} ${p}`);
    }
  });

  it('los POST de lectura de pantalla ya conocidos (usertrail, genericReport) pasan como lectura', () => {
    assert.equal(classifySettlementRequest('POST', `${HOST}/usertrail/register`, driver), 'read');
    assert.equal(
      classifySettlementRequest('POST', `${HOST}/data/genericReport/abc/paginated`, driver),
      'read'
    );
  });
});
