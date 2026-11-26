// tests/helpers/f5-app-handoff.unit.ts
// Contrato de handoff W5a <-> W5b (Appium) y oraculo del cierre por app. Sin red ni DB.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { loadCarrierProfileScoped, prepPair, requirePrepApp } from '../config/carrier-profiles.js';
import type { TravelDetail } from '../api/clients/travels.client.js';
import {
  archivedHandoffPath,
  assertAppDriverMatchesPair,
  buildPreparedHandoff,
  evaluateAppClosure,
  expectedRoute,
  f5AppHandoffPath,
  failedHandoff,
  parseAppScenario,
  parseF5AppHandoff,
  pickMeasuredKm,
  planHandoffWrite,
  readF5AppHandoff,
  resolveKmTolerancePct,
  writeF5AppHandoff,
  type F5AppHandoff
} from './f5-app-handoff.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));
const SAVED = { ENV: process.env.ENV, CIRCUIT_CARRIER: process.env.CIRCUIT_CARRIER };
const tmpDirs: string[] = [];

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const prepared = (): F5AppHandoff => parseF5AppHandoff(fixture('f5-app-handoff.prepared.json'));
const closed = (): F5AppHandoff => parseF5AppHandoff(fixture('f5-app-handoff.closed.json'));
const doneDetail = (over: Record<string, unknown> = {}): TravelDetail =>
  ({
    state: 'DONE',
    driverId: 5076,
    amount: 92.1,
    amountCost: 0,
    finalKm: 12.9,
    ...over
  }) as TravelDetail;

describe('contrato de handoff (replica del runner Appium, schemaVersion 1)', () => {
  it('los fixtures prepared/closed validan y conservan campos extra (route)', () => {
    const p = prepared();
    assert.equal(p.status, 'prepared');
    assert.equal(p.route?.gpsRoute, null);
    assert.deepEqual(Object.keys(p).sort(), [
      'app',
      'carrierId',
      'code',
      'currency',
      'driverId',
      'observations',
      'ownerId',
      'quoted',
      'route',
      'runId',
      'scenario',
      'schemaVersion',
      'status',
      'travelId',
      'vehicleId'
    ]);
    const c = closed();
    assert.equal(c.status, 'closed');
    assert.equal(c.measured?.kmSource, 'gps-fed');
  });

  it('rechaza con TODAS las violaciones', () => {
    assert.throws(() => parseF5AppHandoff(null), /objeto JSON/);
    assert.throws(
      () => parseF5AppHandoff({ schemaVersion: 2, status: 'x', carrierId: 0 }),
      (e: Error) =>
        /schemaVersion/.test(e.message) &&
        /status/.test(e.message) &&
        /carrierId/.test(e.message) &&
        /quoted/.test(e.message)
    );
    const base = fixture('f5-app-handoff.prepared.json') as object;
    assert.throws(() => parseF5AppHandoff({ ...base, status: 'closed' }), /closedAt/);
    assert.throws(() => parseF5AppHandoff({ ...base, status: 'failed' }), /failure/);
  });

  it('el handoff no tiene campos de credencial', () => {
    const text = JSON.stringify([
      fixture('f5-app-handoff.prepared.json'),
      fixture('f5-app-handoff.closed.json')
    ]);
    assert.doesNotMatch(text, /password|token|secret|email/i);
  });

  it('ruta canonica evidence/<env>/f5-app-handoff-<carrier>.json y saneo del carrier', () => {
    assert.ok(
      f5AppHandoffPath('test', 1521, '/r')
        .replaceAll('\\', '/')
        .endsWith('/r/evidence/test/f5-app-handoff-1521.json')
    );
    assert.throws(() => f5AppHandoffPath('test', '../'), /carrier invalido/);
  });

  it('escritura atomica + lectura round-trip; un handoff invalido no se escribe', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'f5app-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'evidence', 'test', 'f5-app-handoff-1521.json');
    writeF5AppHandoff(file, prepared());
    assert.deepEqual(readF5AppHandoff(file), prepared());
    assert.throws(
      () => writeF5AppHandoff(path.join(dir, 'x.json'), { ...prepared(), travelId: -1 }),
      /travelId/
    );
    assert.throws(() => readF5AppHandoff(path.join(dir, 'nada.json')), /No existe el handoff/);
    writeFileSync(path.join(dir, 'roto.json'), '{', 'utf8');
    assert.throws(() => readF5AppHandoff(path.join(dir, 'roto.json')), /ilegible/);
  });
});

describe('plan de escritura del handoff', () => {
  it('sin previo escribe; closed/failed se archivan; prepared pendiente lanza salvo reemplazo', () => {
    assert.equal(planHandoffWrite(null), 'write');
    assert.equal(planHandoffWrite(closed()), 'archive');
    assert.equal(
      planHandoffWrite(failedHandoff(prepared(), 'assign', 'x', '2026-11-11T00:00:00Z')),
      'archive'
    );
    assert.throws(() => planHandoffWrite(prepared()), /sin cerrar[\s\S]*F5_APP_HANDOFF_REPLACE/);
    assert.equal(planHandoffWrite(prepared(), { replacePrepared: true }), 'archive');
  });

  it('el archivo del previo incluye viaje y run', () => {
    assert.equal(
      archivedHandoffPath('/e/f5-app-handoff-1521.json', prepared()),
      '/e/f5-app-handoff-1521.prev-72001-20261111-abc123.json'
    );
  });
});

describe('preparacion desde el perfil 1521 (TEST)', () => {
  const profile1521 = () => {
    process.env.ENV = 'test';
    return loadCarrierProfileScoped('1521', ['prep.app', 'prep.pairs']);
  };

  it('el par 1521-app es el chofer de la app; 1521 y 1521b no (guarda)', () => {
    const profile = profile1521();
    const app = requirePrepApp(profile);
    assert.doesNotThrow(() => assertAppDriverMatchesPair(app, prepPair(profile, '1521-app').pair));
    for (const key of ['1521', '1521b']) {
      assert.throws(
        () => assertAppDriverMatchesPair(app, prepPair(profile, key).pair),
        /no es el del par/,
        key
      );
    }
  });

  it('buildPreparedHandoff valida el contrato, declara la ruta US pendiente y ya no avisa credenciales (verificadas para el par 1521-app)', () => {
    const profile = profile1521();
    const { pair } = prepPair(profile, '1521-app');
    const h = buildPreparedHandoff({
      runId: 'r1',
      carrierId: profile.carrierId,
      travelId: 72002,
      code: '5124-W',
      pair,
      scenario: 'EF-NC-COM',
      currency: profile.currency.code,
      quoted: { total: 85.5, otherCosts: 20 },
      app: requirePrepApp(profile),
      route: expectedRoute({ region: profile.region, origin: 'A', destination: 'B' })
    });
    assert.equal(h.status, 'prepared');
    assert.equal(h.driverId, 3727);
    assert.equal(h.vehicleId, 2625);
    assert.equal(h.ownerId, 1806);
    assert.equal(h.app.package, 'com.magiis.app.test.driver');
    assert.equal(h.route?.gpsRoute, null);
    assert.match(h.route?.note ?? '', /TODO runner[\s\S]*US/);
    assert.deepEqual(h.observations, ['ruta-gps-pendiente-en-runner']);
  });

  it('FR tiene ruta GPS disponible (Cannes-Niza): sin TODO', () => {
    assert.equal(
      expectedRoute({ region: 'FR', origin: 'a', destination: 'b' }).gpsRoute,
      'cannes-niza'
    );
  });

  it('escenario del cierre por app: solo efectivo; EF-FARE0/CC/PAIR-EMPTY se rechazan', () => {
    assert.equal(parseAppScenario(undefined), 'EF-NC-COM');
    assert.equal(parseAppScenario(' EF-PLAIN '), 'EF-PLAIN');
    for (const bad of ['CC', 'EF-FARE0', 'PAIR-EMPTY', 'x']) {
      assert.throws(() => parseAppScenario(bad), /solo efectivo/);
    }
  });

  it('un perfil sin app (UAT) no sirve para el cierre por app', () => {
    process.env.ENV = 'uat';
    const p = loadCarrierProfileScoped('1040-uat', ['prep.app']);
    assert.throws(() => requirePrepApp(p), /sin app Chofer/);
  });
});

describe('oraculo del cierre por app', () => {
  it('cierre sano: DONE, chofer, precio > 0, km en tolerancia; costo 0 = observation diferido-f7', () => {
    const v = evaluateAppClosure({ handoff: closed(), detail: doneDetail() });
    assert.deepEqual(v.mismatches, []);
    assert.equal(v.ok, true);
    assert.equal(v.finalPrice, 92.1);
    assert.equal(v.differsFromQuote, true);
    assert.equal(v.quoteVsFinalDelta, 6.6);
    assert.equal(v.kmChecked?.source, 'finalKm');
    assert.ok(v.observations.some((o) => o.startsWith('diferido-f7')));
  });

  it('NUNCA exige total = cotizacion: igualarla tampoco falla (solo se registra)', () => {
    const v = evaluateAppClosure({ handoff: closed(), detail: doneDetail({ amount: 85.5 }) });
    assert.equal(v.ok, true);
    assert.equal(v.differsFromQuote, false);
    assert.ok(v.observations.some((o) => /coincidencia/.test(o)));
  });

  it('falla: handoff no cerrado, estado, chofer ajeno, precio 0', () => {
    const v = evaluateAppClosure({
      handoff: prepared(),
      detail: doneDetail({ state: 'ASSIGNED', driverId: 6013, amount: 0 })
    });
    assert.deepEqual(
      v.mismatches.map((m) => m.field),
      ['handoff.status', 'state', 'driver.id', 'precio final (detail.amount)']
    );
  });

  it('km: fuera de tolerancia falla (backend y DB); dentro pasa; tolerancia configurable', () => {
    assert.equal(
      evaluateAppClosure({ handoff: closed(), detail: doneDetail({ finalKm: 20 }) }).ok,
      false
    );
    assert.equal(
      evaluateAppClosure({
        handoff: closed(),
        detail: doneDetail({ finalKm: 20 }),
        tolerancePct: 70
      }).ok,
      true
    );
    const db = evaluateAppClosure({ handoff: closed(), detail: doneDetail(), dbKm: 30 });
    assert.deepEqual(
      db.mismatches.map((m) => m.field),
      ['FINALPRICEI.KM (DB) vs measured.routeKm']
    );
  });

  it('km no expuesto por el detalle: observation, no falla', () => {
    const v = evaluateAppClosure({
      handoff: closed(),
      detail: doneDetail({ finalKm: undefined })
    });
    assert.equal(v.ok, true);
    assert.equal(v.kmChecked, null);
    assert.ok(v.observations.some((o) => /km final no expuesto/.test(o)));
  });

  it('costo > 0 y total de la app distinto del backend se registran sin fallar', () => {
    const v = evaluateAppClosure({
      handoff: closed(),
      detail: doneDetail({ amountCost: 5, amount: 95 })
    });
    assert.equal(v.ok, true);
    assert.ok(v.observations.some((o) => /costo 5 > 0/.test(o)));
    assert.ok(v.observations.some((o) => /total de la app 92.1 != detail.amount 95/.test(o)));
  });

  it('pickMeasuredKm: orden preferido, ignora campos de dinero, null si no hay', () => {
    assert.deepEqual(pickMeasuredKm({ km: 3, finalKm: 4 } as TravelDetail), {
      field: 'finalKm',
      km: 4
    });
    assert.deepEqual(pickMeasuredKm({ extraDistanceKm: 7 } as TravelDetail), {
      field: 'extraDistanceKm',
      km: 7
    });
    assert.equal(pickMeasuredKm({ pricePerKm: 2, kmRate: 3 } as TravelDetail), null);
    assert.equal(pickMeasuredKm({} as TravelDetail), null);
  });

  it('resolveKmTolerancePct: default 15, override valido, invalido lanza', () => {
    assert.equal(resolveKmTolerancePct({}), 15);
    assert.equal(resolveKmTolerancePct({ F5_APP_KM_TOLERANCE_PCT: '25' }), 25);
    assert.throws(() => resolveKmTolerancePct({ F5_APP_KM_TOLERANCE_PCT: '0' }), /invalido/);
    assert.throws(() => resolveKmTolerancePct({ F5_APP_KM_TOLERANCE_PCT: 'x' }), /invalido/);
  });
});
