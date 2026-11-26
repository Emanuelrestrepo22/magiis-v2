// tests/config/carrier-profiles-uat.unit.ts
// Perfiles UAT del circuito administrativo multi-carrier (plan docs/qa/f5-admin-circuit-multicarrier-plan.md §6).
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  assertOwnerDedicatedForAuto,
  assertProfileEnv,
  cityTaxFraction,
  knownCircuitCarriers,
  loadCarrierProfile,
  loadCarrierProfileScoped,
  prepOwner,
  prepPair,
  prepSettlement,
  requirePrep,
  requirePrepApp,
  resolveCommissionSplit,
  todoFields,
  type CarrierProfile
} from './carrier-profiles.js';
import { getEnvFile, getStorageStatePath } from './runtime.js';

const SAVED = {
  CIRCUIT_CARRIER: process.env.CIRCUIT_CARRIER,
  ENV_FILE: process.env.ENV_FILE,
  ENV: process.env.ENV
};

function restore(): void {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const UAT_IDS = ['1040-uat', '1481-uat', '2021-uat'] as const;
const ACTIVE_IDS = ['1901', '1521', ...UAT_IDS] as const;

function uat(id: (typeof UAT_IDS)[number]): CarrierProfile {
  process.env.ENV = 'uat';
  process.env.CIRCUIT_CARRIER = id;
  return loadCarrierProfile(id);
}

describe('perfiles UAT: seleccion y rutas', () => {
  afterEach(restore);

  it('se resuelven por CIRCUIT_CARRIER con carrierId, region, sufijo y moneda esperados', () => {
    const expected = {
      '1040-uat': [1040, 'AR', 'ar', 'ARS'],
      '1481-uat': [1481, 'US', 'us', 'USD'],
      '2021-uat': [2021, 'FR', 'fr', 'EUR']
    } as const;
    for (const id of UAT_IDS) {
      const p = uat(id);
      assert.deepEqual(
        [p.carrierId, p.region, p.storageStateSuffix, p.currency.code],
        expected[id],
        id
      );
      assert.equal(p.env, 'uat');
      assert.deepEqual(todoFields(id), [], `${id} sin TODO`);
    }
  });

  it('storage state y env file de UAT por perfil', () => {
    const paths = { '1040-uat': 'ar', '1481-uat': 'us', '2021-uat': 'fr' } as const;
    for (const id of UAT_IDS) {
      process.env.CIRCUIT_CARRIER = id;
      delete process.env.ENV_FILE;
      assert.equal(getStorageStatePath('uat'), `storage/state-carrier-${paths[id]}-uat.json`);
      // .env.uat esta en .gitignore: los perfiles UAT NO nombran archivos .env.uat-<pais> (no ignorados).
      assert.equal(getEnvFile(), '.env.uat');
    }
  });

  it('un perfil UAT con ENV=test lanza (y 1521/1901 explicitos con ENV=uat tambien)', () => {
    process.env.ENV = 'test';
    process.env.CIRCUIT_CARRIER = '1040-uat';
    assert.throws(() => loadCarrierProfile('1040-uat'), /ambiente uat.*ENV=test/);
    process.env.ENV = 'uat';
    for (const id of ['1521', '1901']) {
      process.env.CIRCUIT_CARRIER = id;
      assert.throws(() => assertProfileEnv({ id, env: 'test' }), /ambiente test.*ENV=uat/);
    }
  });

  it('el default implicito 1901 con ENV=uat NO cambia de comportamiento (sin CIRCUIT_CARRIER)', () => {
    process.env.ENV = 'uat';
    delete process.env.CIRCUIT_CARRIER;
    assert.equal(loadCarrierProfile('1901').carrierId, 1901);
  });

  it('id desconocido lanza listando los perfiles disponibles (incluye los UAT)', () => {
    process.env.CIRCUIT_CARRIER = '9999';
    assert.throws(() => loadCarrierProfile(), /9999.*1040-uat.*1481-uat.*2021-uat/);
  });

  it('los perfiles activos no comparten storageStateSuffix + ambiente', () => {
    const keys = ACTIVE_IDS.map((id) => {
      process.env.ENV = id.endsWith('-uat') ? 'uat' : 'test';
      process.env.CIRCUIT_CARRIER = id;
      const p = id === '1521' ? null : loadCarrierProfile(id);
      return p ? `${p.storageStateSuffix}|${p.env}` : '1521: esqueleto';
    });
    assert.equal(new Set(keys).size, keys.length);
  });

  it('todos los perfiles registrados estan en la lista', () => {
    assert.deepEqual(
      [...knownCircuitCarriers()].sort(),
      ['1040-uat', '1481-uat', '1521', '1901', '2021-uat'].sort()
    );
  });
});

describe('perfiles UAT: pares, conceptos y comision', () => {
  afterEach(restore);

  it('cada par es propio (qaOwned) con ids enteros positivos y etiqueta no vacia (salvo no descubierta)', () => {
    for (const id of UAT_IDS) {
      const prep = requirePrep(uat(id));
      assert.ok(prep.pairs[prep.defaultPair], `${id}: defaultPair existe`);
      for (const [key, pair] of Object.entries(prep.pairs)) {
        assert.equal(pair.qaOwned, true, `${id}/${key}`);
        for (const n of [pair.driverId, pair.vehicleId, pair.ownerId]) {
          assert.ok(Number.isInteger(n) && n > 0, `${id}/${key} ids`);
        }
        if (pair.driverLabel !== null)
          assert.ok(pair.driverLabel.includes(','), `${id}/${key} label`);
      }
    }
  });

  it('driverId/vehicleId no se repiten entre perfiles distintos', () => {
    const seen = new Map<string, string>();
    for (const id of UAT_IDS) {
      for (const [key, pair] of Object.entries(requirePrep(uat(id)).pairs)) {
        for (const tag of [`driver:${pair.driverId}`, `vehicle:${pair.vehicleId}`]) {
          assert.equal(seen.has(tag), false, `${tag} repetido (${id}/${key} vs ${seen.get(tag)})`);
          seen.set(tag, `${id}/${key}`);
        }
      }
    }
  });

  it('pares conocidos: 1040 6441/5355, 1481 P1 6437/5352 · P2 6438/5353 · P3 6439/5354, 2021 6440/5356', () => {
    const pairs = (id: (typeof UAT_IDS)[number]) =>
      Object.fromEntries(
        Object.entries(requirePrep(uat(id)).pairs).map(([k, p]) => [k, [p.driverId, p.vehicleId]])
      );
    assert.deepEqual(pairs('1040-uat'), { default: [6441, 5355] });
    assert.deepEqual(pairs('1481-uat'), { P1: [6437, 5352], P2: [6438, 5353], P3: [6439, 5354] });
    assert.deepEqual(pairs('2021-uat'), { default: [6440, 5356] });
  });

  it('conceptos unicos por nombre dentro de un slot y byCost solo en slots de cuenta corriente', () => {
    for (const id of UAT_IDS) {
      const { otherCosts } = requirePrep(uat(id));
      for (const [slot, cost] of Object.entries(otherCosts)) {
        if (cost.byCost)
          assert.ok(slot.startsWith('account'), `${id}/${slot} byCost solo en cuenta`);
        assert.ok(
          (cost.fixed === undefined) !== (cost.percent === undefined),
          `${id}/${slot}: fijo XOR porcentaje`
        );
      }
      assert.notEqual(otherCosts.cashNc?.name, otherCosts.cashCom?.name, `${id}: NC != COM`);
    }
  });

  it('city tax: 2021 = 10 %; 1040 y 1481 = 0', () => {
    assert.equal(cityTaxFraction(uat('2021-uat')), 0.1);
    assert.equal(cityTaxFraction(uat('1040-uat')), 0);
    assert.equal(cityTaxFraction(uat('1481-uat')), 0);
  });

  it('reparto por par: 1040 -> chofer 0 / propietario 88 / agencia 12; 1481 P1 -> 40/40/20; P3 desde config', () => {
    const p1040 = uat('1040-uat');
    assert.deepEqual(resolveCommissionSplit(p1040), { driver: 0, owner: 0.88, agency: 0.12 });
    const p1481 = uat('1481-uat');
    assert.deepEqual(resolveCommissionSplit(p1481), { driver: 0.4, owner: 0.4, agency: 0.2 });
    assert.deepEqual(prepPair(p1481, 'P1').pair.commission, {
      kind: 'fixed',
      split: { driver: 0.4, owner: 0.4, agency: 0.2 }
    });
    assert.deepEqual(prepPair(p1481, 'P3').pair.commission, { kind: 'db' });
  });

  it('prepPair: par no declarado lanza listando los disponibles; sin clave usa defaultPair', () => {
    const p = uat('1481-uat');
    assert.equal(prepPair(p).key, 'P1');
    assert.throws(() => prepPair(p, 'P9'), /P9.*P1, P2, P3/);
  });

  it('requirePrep: un perfil sin prep (1901) lanza y recomienda los perfiles UAT', () => {
    process.env.ENV = 'test';
    assert.throws(
      () => requirePrep(loadCarrierProfile('1901')),
      /sin datos de preparacion.*1040-uat/
    );
  });

  it('fixtures UAT: clientCcId/vehicleDomain null = N/A en US y AR; FR conoce CC 6472', () => {
    assert.equal(uat('1481-uat').fixtures.clientCcId, null);
    assert.equal(uat('1040-uat').fixtures.clientCcId, null);
    assert.equal(uat('2021-uat').fixtures.clientCcId, 6472);
  });

  it('1521 completo: sin TODO pendientes; clientCcId null (N/A) y medio de pago de cuenta declarado', () => {
    assert.deepEqual(todoFields('1521'), []);
    const p = loadCarrierProfile('1521');
    assert.equal(p.fixtures.clientCcId, null);
    assert.equal(p.fixtures.ccPaymentMethod, 'Credit Account');
  });
});

describe('perfiles: propietario, liquidacion y app (fase 2, W0)', () => {
  afterEach(restore);

  it('prep.owner: ficha coherente con los pares (el vehiculo del par por defecto esta en la ficha)', () => {
    for (const id of UAT_IDS) {
      const p = uat(id);
      const prep = requirePrep(p);
      const owner = prepOwner(p);
      const def = prep.pairs[prep.defaultPair];
      assert.equal(owner.ownerId, def.ownerId, id);
      assert.ok(owner.vehicleIds.includes(def.vehicleId), `${id}: vehiculo del par en la ficha`);
      for (const pair of Object.values(prep.pairs)) {
        assert.equal(pair.ownerId, owner.ownerId, `${id}: un solo propietario`);
        assert.ok(owner.vehicleIds.includes(pair.vehicleId), `${id}: vehiculo ${pair.vehicleId}`);
      }
      assert.deepEqual(
        Object.keys(owner.vehicleCommissions).map(Number).sort(),
        [...owner.vehicleIds].sort(),
        `${id}: comision por cada vehiculo`
      );
      assert.equal(owner.collectsCash, 'COMPANY', `${id}: nunca armado entre corridas`);
      assert.ok(
        prep.otherCosts[owner.autoCosts.nc]?.commissionable === false,
        `${id}: NC no comisionable`
      );
      assert.ok(
        prep.otherCosts[owner.autoCosts.com]?.commissionable === true,
        `${id}: COM comisionable`
      );
    }
  });

  it('US 1481 (4287) aprobada por el usuario 11/11: approvedShared; AR y FR no la necesitan', () => {
    assert.equal(prepOwner(uat('1481-uat')).approvedShared, true);
    assert.equal(prepOwner(uat('2021-uat')).approvedShared, undefined);
    assert.doesNotThrow(() => assertOwnerDedicatedForAuto(uat('1481-uat')));
  });

  it('dedicatedForAuto: AR y FR si (un vehiculo); US 1481 no (4287 con 3 vehiculos, D-4)', () => {
    assert.deepEqual(
      [uat('1040-uat'), uat('2021-uat'), uat('1481-uat')].map((p) => [
        prepOwner(p).vehicleIds.length,
        prepOwner(p).dedicatedForAuto
      ]),
      [
        [1, true],
        [1, true],
        [3, false]
      ]
    );
    assert.equal(assertOwnerDedicatedForAuto(uat('1040-uat')).ownerId, 4288);
    // 1481 ya esta aprobada en el perfil: sin la marca (copia sin approvedShared) la guarda bloquea.
    const unapproved = uat('1481-uat');
    const stripped = {
      ...unapproved,
      prep: { ...unapproved.prep!, owner: { ...prepOwner(unapproved), approvedShared: undefined } }
    };
    assert.throws(() => assertOwnerDedicatedForAuto(stripped), /4287.*no es dedicado.*D-4/);
    assert.equal(
      assertOwnerDedicatedForAuto(uat('1481-uat'), { approvedShared: true }).ownerId,
      4287
    );
  });

  it('prep.settlement: choferes = los de los pares; el propietario cubre todos los vehiculos de la ficha', () => {
    for (const id of UAT_IDS) {
      const p = uat(id);
      const st = prepSettlement(p);
      const prep = requirePrep(p);
      assert.deepEqual(
        [...st.driverIds].sort(),
        Object.values(prep.pairs)
          .map((x) => x.driverId)
          .sort(),
        id
      );
      assert.equal(st.ownerId, prepOwner(p).ownerId, id);
      assert.deepEqual(st.ownerVehicleIds, prepOwner(p).vehicleIds, id);
      assert.equal(st.ownerSharedWithOtherPairs, st.driverIds.length > 1, id);
    }
  });

  it('prep.app: UAT es solo Playwright (null, requirePrepApp lanza); 1521 TEST declara emulator-5556 y build 2.6.17', () => {
    for (const id of UAT_IDS) {
      const p = uat(id);
      assert.equal(requirePrep(p).app, null, id);
      assert.throws(() => requirePrepApp(p), /sin app Chofer.*solo en TEST/);
    }
    process.env.ENV = 'test';
    process.env.CIRCUIT_CARRIER = '1521';
    const p = loadCarrierProfileScoped('1521', ['prep.app']);
    const app = requirePrepApp(p);
    assert.deepEqual(
      [app.package, app.version, app.udid],
      ['com.magiis.app.test.driver', '2.6.17', 'emulator-5556']
    );
    // Solo NOMBRES de variables: ningun valor de credencial vive en el perfil.
    assert.deepEqual(app.credentialEnv, { email: 'DRIVER_EMAIL', password: 'DRIVER_PASSWORD' });
    assert.equal(app.credentialsMatchPair, true);
    assert.equal(app.driverLabel, 'argentoinfoa, pepe');
  });

  it('1521: carga acotada lee propietario/liquidacion/pares sin el alta; loadCarrierProfile ya no lanza', () => {
    process.env.ENV = 'test';
    process.env.CIRCUIT_CARRIER = '1521';
    const p = loadCarrierProfileScoped('1521', ['prep.owner', 'prep.settlement', 'prep.pairs']);
    assert.equal(prepOwner(p).ownerId, 3287);
    assert.deepEqual(prepOwner(p).vehicleIds, [3849, 3869, 3870]);
    assert.equal(prepSettlement(p).ownerSharedWithOtherPairs, true);
    assert.equal(prepPair(p).key, '1521');
    assert.equal(prepPair(p, '1521-app').pair.driverId, 3727);
    assert.equal(prepPair(p, '1521b').pair.vehicleId, 3869);
    // El alta (cliente de efectivo y medios de pago) ya esta relevada el 11/11: la carga acotada no lanza.
    const alta = loadCarrierProfileScoped('1521', ['prep.customers', 'prep.paymentMethods']);
    assert.equal(alta.prep?.customers.cash.query, 'QUOTE, PAX');
    assert.equal(alta.prep?.paymentMethods.cash, 'Cash');
    assert.doesNotThrow(() => loadCarrierProfile('1521'));
  });

  it('carga acotada respeta el ambiente del perfil (un perfil UAT con ENV=test lanza)', () => {
    process.env.ENV = 'test';
    assert.throws(
      () => loadCarrierProfileScoped('1040-uat', ['prep.owner']),
      /ambiente uat.*ENV=test/
    );
  });

  it('1521: conceptos NC/COM de efectivo y de cuenta salen de CARRIER_OTHER_COSTS (ids 165/164 y 147/143)', () => {
    process.env.ENV = 'test';
    const { otherCosts } = requirePrep(loadCarrierProfileScoped('1521', ['prep.otherCosts']));
    assert.deepEqual(
      [
        otherCosts.cashNc?.id,
        otherCosts.cashCom?.id,
        otherCosts.accountNc?.id,
        otherCosts.accountCom?.id
      ],
      [165, 164, 147, 143]
    );
    assert.equal(otherCosts.accountNc?.byCost, true);
    assert.equal(cityTaxFraction(loadCarrierProfileScoped('1521', ['cityTax'])), 0);
  });
});
