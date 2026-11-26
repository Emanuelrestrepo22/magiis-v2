import assert from 'node:assert/strict';
import { it } from 'node:test';
import { activeF5Targets, F5_TARGETS, f5TargetProfile, resolveF5Target } from './f5-targets.js';

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;
const rows = [{ driverId: 11, vehicleId: 22, travelsToSurrender: 3 }];

it('TEST: targets fijos sin cambios y resolveF5Target devuelve el mismo objeto', () => {
  const [t] = activeF5Targets(env({ ENV: 'test' }));
  assert.equal(t, F5_TARGETS['1040']);
  assert.equal(resolveF5Target(t, [], { env: env({}) }), t);
});
it('UAT: 1040/1481/2021 con región, formato y par en runtime', () => {
  const ts = activeF5Targets(env({ ENV: 'uat', F5_TARGETS: '1040,1481,2021' }));
  assert.deepEqual(
    ts.map((t) => [t.id, t.carrierId, t.region, t.pair]),
    [
      ['1040', 1040, 'AR', 'runtime'],
      ['1481', 1481, 'US', 'runtime'],
      ['2021', 2021, 'FR', 'runtime']
    ]
  );
  assert.deepEqual(
    ts.map((t) => t.moneyFormat.decimal),
    [',', '.', ',']
  );
  assert.equal(ts[2].moneyFormat.thousands, 'none');
});
it('UAT: ids solo-TEST se rechazan con mensaje claro', () => {
  for (const id of ['1521', '1521b', '1901']) {
    assert.throws(
      () => activeF5Targets(env({ ENV: 'uat', F5_TARGETS: id })),
      /no válido en ENV=uat.*solo TEST/
    );
  }
});
it('TEST: 1481/2021 no existen (solo UAT); 1901 sigue', () => {
  assert.throws(() => activeF5Targets(env({ ENV: 'test', F5_TARGETS: '1481' })), /no válido/);
  assert.equal(activeF5Targets(env({ ENV: 'test', F5_TARGETS: '1901' }))[0].carrierId, 1901);
});
it('UAT: sin override gana el par PROPIO del perfil (no la heurística «menos viajes»); sin pendientes → null', () => {
  const [t] = activeF5Targets(env({ ENV: 'uat' }));
  assert.deepEqual(t.defaultPair, { driverUserId: 6441, vehicleId: 5355 });
  const grid = [
    { driverId: 11, vehicleId: 22, travelsToSurrender: 1 },
    { driverId: 6441, vehicleId: 5355, travelsToSurrender: 5 }
  ];
  const r = resolveF5Target(t, grid, { env: env({ ENV: 'uat' }) });
  assert.equal(r?.driverUserId, 6441);
  assert.equal(r?.vehicleId, 5355);
  assert.equal(r?.carrierId, 1040);
  // El par del perfil no esta pendiente: null aunque haya otros pares (lotes de terceros).
  assert.equal(resolveF5Target(t, rows, { env: env({ ENV: 'uat' }) }), null);
  assert.equal(resolveF5Target(t, [], { env: env({ ENV: 'uat' }) }), null);
});
it('UAT: los defaultPair salen de los perfiles (1481 = P1, 2021 = 6440/5356)', () => {
  const ts = activeF5Targets(env({ ENV: 'uat', F5_TARGETS: '1481,2021' }));
  assert.deepEqual(ts[0].defaultPair, { driverUserId: 6437, vehicleId: 5352 });
  assert.deepEqual(ts[1].defaultPair, { driverUserId: 6440, vehicleId: 5356 });
});
it('UAT: 2001 se rechaza (sin alias)', () => {
  assert.throws(() => activeF5Targets(env({ ENV: 'uat', F5_TARGETS: '2001' })), /no válido/);
});
it('UAT: F5_UAT_PAIR gana sobre el par del perfil', () => {
  const [t] = activeF5Targets(env({ ENV: 'uat' }));
  const r = resolveF5Target(t, rows, { env: env({ ENV: 'uat', F5_UAT_PAIR: '11/22' }) });
  assert.equal(r?.driverUserId, 11);
});
it('UAT: confirmación exige F5_UAT_PAIR; con él usa ese par', () => {
  const [t] = activeF5Targets(env({ ENV: 'uat' }));
  assert.throws(
    () => resolveF5Target(t, rows, { requireExplicit: true, env: env({}) }),
    /F5_UAT_PAIR/
  );
  const r = resolveF5Target(t, rows, { requireExplicit: true, env: env({ F5_UAT_PAIR: '11/22' }) });
  assert.equal(r?.vehicleId, 22);
  assert.equal(
    resolveF5Target(t, rows, { requireExplicit: true, env: env({ F5_UAT_PAIR: '1/2' }) }),
    null
  );
});

it('TEST 1521/1521b: propietario 3287 y concepto NC del perfil; profileId y pairKey para leer el perfil', () => {
  assert.deepEqual(
    (['1521', '1521b'] as const).map((id) => [
      F5_TARGETS[id].ownerId,
      F5_TARGETS[id].ncConcept.id,
      F5_TARGETS[id].profileId,
      F5_TARGETS[id].pairKey
    ]),
    [
      [3287, 165, '1521', '1521'],
      [3287, 165, '1521', '1521b']
    ]
  );
  assert.equal(F5_TARGETS['1901'].profileId, '1901');
  assert.equal(F5_TARGETS['1040'].profileId, undefined);
});
it('UAT: cada target apunta a su perfil <id>-uat y al par por defecto', () => {
  const ts = activeF5Targets(env({ ENV: 'uat', F5_TARGETS: '1040,1481,2021' }));
  assert.deepEqual(
    ts.map((t) => [t.profileId, t.pairKey]),
    [
      ['1040-uat', 'default'],
      ['1481-uat', 'P1'],
      ['2021-uat', 'default']
    ]
  );
});
it('f5TargetProfile: propietario/liquidacion/app sin exigir el alta; 1040 TEST sin perfil lanza', () => {
  const saved = process.env.ENV;
  try {
    process.env.ENV = 'test';
    const p = f5TargetProfile(F5_TARGETS['1521']);
    assert.equal(p.prep?.owner.ownerId, F5_TARGETS['1521'].ownerId);
    assert.equal(
      p.prep?.pairs[F5_TARGETS['1521b'].pairKey ?? '']?.vehicleId,
      F5_TARGETS['1521b'].vehicleId
    );
    assert.throws(() => f5TargetProfile(F5_TARGETS['1040']), /sin perfil/);
    // El alta de 1521 (efectivo) ya esta relevada: pedirla no lanza.
    assert.equal(
      f5TargetProfile(F5_TARGETS['1521'], ['prep.customers']).prep?.customers.cash.query,
      'QUOTE, PAX'
    );
    process.env.ENV = 'uat';
    const uatT = activeF5Targets(env({ ENV: 'uat', F5_TARGETS: '1481' }))[0];
    assert.equal(f5TargetProfile(uatT).prep?.owner.ownerId, 4287);
  } finally {
    if (saved === undefined) delete process.env.ENV;
    else process.env.ENV = saved;
  }
});
