// tests/helpers/f5-auto-guards.unit.ts
// Guardas de la automatica F5 (W3): gates separados sin alias, ventana del cron, propietario compartido, pre-check,
// desarmado, diff de la ficha.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrepOwner } from '../config/carrier-profiles.js';
import {
  autoGateSkipReason,
  classifyDisarmResponse,
  decideDisarm,
  diffFicha,
  diffFingerprints,
  fichaFingerprint,
  evaluateAutoPrecheck,
  evaluateOwnerGuard,
  evaluatePendingEmpty,
  f5AutoPhaseFromEnv,
  f5CronBlock,
  evaluatePendingUiRows,
  isAutoGateOpen,
  isAutoWriteAllowed,
  parseDeclaredBatch,
  requiredAutoGates
} from './f5-auto-guards.js';

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;
const at = (hhmm: string): Date => new Date(`2026-11-11T${hhmm}:00.000Z`);

const dedicated: PrepOwner = {
  ownerId: 4289,
  ownerLabel: 'QA F5 UAT FR Owner',
  collectsCash: 'COMPANY',
  vehicleIds: [5356],
  dedicatedForAuto: true,
  autoCosts: { nc: 'cashNc', com: 'cashCom' },
  vehicleCommissions: { 5356: { pct: 20, pctForCost: 0, payee: 'AGENCY', fixed: 0 } }
};
const shared: PrepOwner = {
  ...dedicated,
  ownerId: 3287,
  vehicleIds: [3849, 3869, 3870],
  dedicatedForAuto: false
};
const fresh = (
  o: Partial<{ ownerId: number; cashCollector: boolean | null; vehicleIds: number[] | null }> = {}
) => ({
  ownerId: 4289,
  cashCollector: false as boolean | null,
  vehicleIds: [5356] as number[] | null,
  ...o
});

describe('gates separados (sin alias)', () => {
  it('solo el valor exacto 1 abre y el alias historico FR_TOGGLE_AUTO_SURRENDER NO abre ni armado ni disparo', () => {
    assert.equal(isAutoGateOpen('F5_AUTO_ARM', env({})), false);
    for (const v of ['true', '0', '', 'yes', '11']) {
      assert.equal(isAutoGateOpen('F5_AUTO_FIRE', env({ F5_AUTO_FIRE: v })), false, v);
    }
    assert.equal(isAutoGateOpen('F5_AUTO_FIRE', env({ F5_AUTO_FIRE: '1' })), true);
    const legacy = env({ FR_TOGGLE_AUTO_SURRENDER: '1' });
    assert.equal(isAutoGateOpen('F5_AUTO_ARM', legacy), false);
    assert.equal(isAutoGateOpen('F5_AUTO_FIRE', legacy), false);
  });
  it('abrir el armado no abre el disparo y viceversa', () => {
    assert.equal(isAutoGateOpen('F5_AUTO_FIRE', env({ F5_AUTO_ARM: '1' })), false);
    assert.equal(isAutoGateOpen('F5_AUTO_ARM', env({ F5_AUTO_FIRE: '1' })), false);
  });
  it('fases: run exige ambos; arm/disarm el armado; fire el disparo; verify ninguno', () => {
    assert.deepEqual(requiredAutoGates('run'), ['F5_AUTO_ARM', 'F5_AUTO_FIRE']);
    assert.deepEqual(requiredAutoGates('arm'), ['F5_AUTO_ARM']);
    assert.deepEqual(requiredAutoGates('disarm'), ['F5_AUTO_ARM']);
    assert.deepEqual(requiredAutoGates('fire'), ['F5_AUTO_FIRE']);
    assert.deepEqual(requiredAutoGates('verify'), []);
  });
  it('skip antes de abrir navegador: sin fase, con gate faltante; verify sin gates no se salta', () => {
    assert.match(autoGateSkipReason(null, env({})) ?? '', /F5_AUTO_PHASE/);
    assert.match(autoGateSkipReason('run', env({ F5_AUTO_ARM: '1' })) ?? '', /F5_AUTO_FIRE=1/);
    assert.match(autoGateSkipReason('arm', env({})) ?? '', /F5_AUTO_ARM=1/);
    assert.equal(autoGateSkipReason('verify', env({})), null);
    assert.equal(autoGateSkipReason('run', env({ F5_AUTO_ARM: '1', F5_AUTO_FIRE: '1' })), null);
  });
  it('F5_AUTO_PHASE: valida y normaliza; invalida = null', () => {
    assert.equal(f5AutoPhaseFromEnv(env({ F5_AUTO_PHASE: ' Run ' })), 'run');
    assert.equal(f5AutoPhaseFromEnv(env({ F5_AUTO_PHASE: 'prepare' })), null);
    assert.equal(f5AutoPhaseFromEnv(env({})), null);
  });
});

describe('ventana prohibida del cron 12:50–13:30 UTC', () => {
  it('dentro de la ventana bloquea con minutos hasta liberar', () => {
    const b = f5CronBlock(at('13:10'));
    assert.equal(b.blocked, true);
    assert.equal(b.minutesUntilFree, 20);
    assert.equal(f5CronBlock(at('12:50')).blocked, true);
    assert.equal(f5CronBlock(at('13:29')).blocked, true);
  });
  it('fuera: libre; 13:30 en punto ya es libre', () => {
    assert.equal(f5CronBlock(at('13:30')).blocked, false);
    assert.equal(f5CronBlock(at('12:30')).blocked, false);
    assert.equal(f5CronBlock(at('18:00')).blocked, false);
  });
  it('una corrida que termina dentro de la ventana tambien bloquea (12:45 + 10 min)', () => {
    assert.equal(f5CronBlock(at('12:45'), 10).blocked, true);
    assert.equal(f5CronBlock(at('12:39'), 10).blocked, false);
    assert.equal(f5CronBlock(at('12:45'), 0).blocked, false);
  });
});

describe('guarda de propietario (D-4)', () => {
  it('dedicado con la ficha esperada: ok, modo dedicated', () => {
    const v = evaluateOwnerGuard({ profileOwner: dedicated, fresh: fresh(), env: env({}) });
    assert.equal(v.ok, true);
    assert.equal(v.mode, 'dedicated');
  });
  it('ya armado: aborta (estado de otra sesion)', () => {
    const v = evaluateOwnerGuard({
      profileOwner: dedicated,
      fresh: fresh({ cashCollector: true }),
      env: env({})
    });
    assert.equal(v.ok, false);
    assert.match(v.mismatches[0].field, /cashCollector previo/);
  });
  it('vehiculo ajeno en la ficha (o ficha ilegible) bloquea aun siendo dedicado', () => {
    const foreign = evaluateOwnerGuard({
      profileOwner: dedicated,
      fresh: fresh({ vehicleIds: [5356, 9999] }),
      env: env({})
    });
    assert.equal(foreign.ok, false);
    assert.match(foreign.mismatches[0].field, /AJENOS/);
    assert.equal(
      evaluateOwnerGuard({
        profileOwner: dedicated,
        fresh: fresh({ vehicleIds: null }),
        env: env({})
      }).ok,
      false
    );
    assert.equal(
      evaluateOwnerGuard({ profileOwner: dedicated, fresh: fresh({ ownerId: 1 }), env: env({}) })
        .ok,
      false
    );
  });
  it('compartido sin aprobacion: bloqueado y el mensaje indica como habilitarlo', () => {
    const f = fresh({ ownerId: 3287, vehicleIds: [3849, 3869, 3870] });
    const v = evaluateOwnerGuard({ profileOwner: shared, fresh: f, env: env({}) });
    assert.equal(v.ok, false);
    assert.equal(v.mode, null);
    assert.match(JSON.stringify(v.mismatches), /F5_AUTO_APPROVED_SHARED_OWNER=3287/);
  });
  it('un booleano no aprueba: exige el id exacto del propietario', () => {
    const f = fresh({ ownerId: 3287, vehicleIds: [3849, 3869, 3870] });
    assert.equal(
      evaluateOwnerGuard({
        profileOwner: shared,
        fresh: f,
        env: env({ F5_AUTO_APPROVED_SHARED_OWNER: '1' })
      }).ok,
      false
    );
    assert.equal(
      evaluateOwnerGuard({
        profileOwner: shared,
        fresh: f,
        env: env({ F5_AUTO_APPROVED_SHARED_OWNER: '4287' })
      }).ok,
      false
    );
  });
  it('compartido aprobado con id exacto y ficha identica al perfil: ok, modo approved-shared', () => {
    const f = fresh({ ownerId: 3287, vehicleIds: [3870, 3849, 3869] });
    const v = evaluateOwnerGuard({
      profileOwner: shared,
      fresh: f,
      env: env({ F5_AUTO_APPROVED_SHARED_OWNER: '3287' })
    });
    assert.equal(v.ok, true);
    assert.equal(v.mode, 'approved-shared');
  });
  it('compartido con approvedShared en el perfil (aprobacion del usuario 11/11): permite; vehiculo no listado bloquea', () => {
    const approved = { ...shared, approvedShared: true };
    const ok = evaluateOwnerGuard({
      profileOwner: approved,
      fresh: fresh({ ownerId: 3287, vehicleIds: [3849, 3869, 3870] }),
      env: env({})
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.mode, 'approved-shared');
    const bad = evaluateOwnerGuard({
      profileOwner: approved,
      fresh: fresh({ ownerId: 3287, vehicleIds: [3849, 3869, 3870, 5] }),
      env: env({})
    });
    assert.equal(bad.ok, false);
    assert.match(bad.mismatches[0].field, /AJENOS/);
  });
  it('compartido aprobado pero con un vehiculo no QA en la ficha: sigue bloqueado', () => {
    const f = fresh({ ownerId: 3287, vehicleIds: [3849, 3869, 3870, 777] });
    const v = evaluateOwnerGuard({
      profileOwner: shared,
      fresh: f,
      env: env({ F5_AUTO_APPROVED_SHARED_OWNER: '3287' })
    });
    assert.equal(v.ok, false);
    assert.match(v.mismatches[0].field, /AJENOS/);
  });
});

describe('huella de la ficha', () => {
  it('no guarda valores (solo hashes) y detecta cambios', () => {
    const fp = fichaFingerprint({ name: 'Secreto', vehicles: [{ id: 1 }] });
    assert.ok(!JSON.stringify(fp).includes('Secreto'));
    assert.equal(
      diffFingerprints(fp, fichaFingerprint({ name: 'Secreto', vehicles: [{ id: 1 }] })).ok,
      true
    );
    assert.equal(
      diffFingerprints(fp, fichaFingerprint({ name: 'Otro', vehicles: [{ id: 1 }] })).ok,
      false
    );
  });
});

describe('diffFicha (los vehiculos reenviados quedan con sus valores)', () => {
  const ficha = (cc: boolean, pct = 20) => ({
    id: 3287,
    cashCollector: cc,
    updatedAt: String(cc),
    vehicles: [
      { id: 3849, commission: pct },
      { id: 3870, commission: 25 }
    ]
  });
  it('solo cambia cashCollector/updatedAt: sin diferencias', () => {
    assert.equal(diffFicha(ficha(false), ficha(false)).ok, true);
    assert.equal(diffFicha(ficha(false), ficha(true)).ok, true);
  });
  it('un valor de vehiculo distinto se reporta con su ruta', () => {
    const v = diffFicha(ficha(false), ficha(false, 21));
    assert.equal(v.ok, false);
    assert.equal(v.mismatches[0].field, 'ficha vehicles[0].commission');
  });
  it('vehiculo que desaparece es diferencia', () => {
    const after = { ...ficha(false), vehicles: [{ id: 3849, commission: 20 }] };
    assert.equal(diffFicha(ficha(false), after).ok, false);
  });
});

describe('pre-check del lote', () => {
  const row = (vehicleId: number, trips = 1, total = 241.6) => ({
    driverId: 6440,
    vehicleId,
    travelsToSurrender: trips,
    toSurrenderTotal: total
  });
  const base = { vehicleId: 5356, ownerVehicleIds: [5356], declared: { trips: 1, balance: 241.6 } };
  it('1 fila con viajes y saldo declarados: ok', () => {
    assert.equal(
      evaluateAutoPrecheck({ ...base, summaryRows: [row(5356), row(1, 5, 10)] }).ok,
      true
    );
  });
  it('0 o 2 filas del vehiculo, saldo o viajes distintos: falla', () => {
    assert.equal(evaluateAutoPrecheck({ ...base, summaryRows: [] }).ok, false);
    assert.equal(evaluateAutoPrecheck({ ...base, summaryRows: [row(5356), row(5356)] }).ok, false);
    assert.equal(evaluateAutoPrecheck({ ...base, summaryRows: [row(5356, 1, 226.6)] }).ok, false);
    assert.equal(evaluateAutoPrecheck({ ...base, summaryRows: [row(5356, 2)] }).ok, false);
  });
  it('sin declaracion solo exige 1 fila', () => {
    const v = evaluateAutoPrecheck({
      ...base,
      declared: { trips: null, balance: null },
      summaryRows: [row(5356, 7, 1)]
    });
    assert.equal(v.ok, true);
  });
  it('pendientes en otro vehiculo de la ficha bloquean (el desarmado daria 400)', () => {
    const v = evaluateAutoPrecheck({
      ...base,
      ownerVehicleIds: [5356, 5357],
      summaryRows: [row(5356), row(5357, 2, 50)]
    });
    assert.equal(v.ok, false);
    assert.match(v.mismatches[0].field, /otros vehiculos de la ficha/);
  });
  it('Pending vacio tras disparar: ok solo si no queda nada de la ficha', () => {
    assert.equal(
      evaluatePendingEmpty({ summaryRows: [row(1, 1, 1)], ownerVehicleIds: [5356] }).ok,
      true
    );
    assert.equal(
      evaluatePendingEmpty({ summaryRows: [row(5356)], ownerVehicleIds: [5356] }).ok,
      false
    );
  });
});

describe('desarmado', () => {
  it('decision: ya Company = nada; pendiente = bloqueado sin PUT; resto = PUT', () => {
    assert.equal(decideDisarm({ armedNow: false, pendingOwnerRows: 0 }), 'already-company');
    assert.equal(decideDisarm({ armedNow: false, pendingOwnerRows: 3 }), 'already-company');
    assert.equal(decideDisarm({ armedNow: true, pendingOwnerRows: 1 }), 'blocked-pending');
    assert.equal(decideDisarm({ armedNow: true, pendingOwnerRows: 0 }), 'put');
    assert.equal(decideDisarm({ armedNow: null, pendingOwnerRows: 0 }), 'put');
  });
  it('respuesta: 200 ok; 400 VEHICLE_OWNER_HAS_PENDING_SURRENDER = orden de operacion; otro error = error', () => {
    assert.equal(classifyDisarmResponse(200, '').kind, 'ok');
    const pend = classifyDisarmResponse(400, '{"code":"VEHICLE_OWNER_HAS_PENDING_SURRENDER"}');
    assert.equal(pend.kind, 'blocked-pending-backend');
    assert.equal(classifyDisarmResponse(400, 'otra cosa').kind, 'error');
    assert.equal(classifyDisarmResponse(500, 'boom').kind, 'error');
  });
});

describe('lote declarado y UI', () => {
  it('parseDeclaredBatch: ids y saldo; invalidos lanzan', () => {
    assert.deepEqual(
      parseDeclaredBatch(
        env({ F5_AUTO_TRIPS: '723597, 723598', F5_AUTO_EXPECT_BALANCE: '241.60' })
      ),
      { tripIds: [723597, 723598], balance: 241.6 }
    );
    assert.deepEqual(parseDeclaredBatch(env({})), { tripIds: null, balance: null });
    assert.throws(() => parseDeclaredBatch(env({ F5_AUTO_TRIPS: '1,1' })), /invalido/);
    assert.throws(() => parseDeclaredBatch(env({ F5_AUTO_EXPECT_BALANCE: '241,60' })), /invalido/);
  });
  it('Pending UI: sin la patente = ok', () => {
    assert.equal(evaluatePendingUiRows(['UAT FR QAF5UAT-FR1 Standard 1'], 'QAF5UAT-FR1').ok, false);
    assert.equal(evaluatePendingUiRows(['otra fila'], 'QAF5UAT-FR1').ok, true);
  });
});

describe('firewall de escrituras', () => {
  const scope = { ownerId: 4289, vehicleId: 5356 };
  const h = 'https://apps-uat.magiis.com/api';
  it('permite armar/desarmar el propietario del par y el disparo del vehiculo del par', () => {
    assert.equal(isAutoWriteAllowed('PUT', `${h}/carriers/2021/vehicleOwners/4289`, scope), true);
    assert.equal(
      isAutoWriteAllowed('PUT', `${h}/vehicles/5356/carrier/2021/travelsSurrender?x=1`, scope),
      true
    );
  });
  it('bloquea otro propietario/vehiculo, DELETE, confirmacion manual, liquidaciones y autodispatch', () => {
    assert.equal(isAutoWriteAllowed('PUT', `${h}/carriers/2021/vehicleOwners/1`, scope), false);
    assert.equal(
      isAutoWriteAllowed('PUT', `${h}/vehicles/9/carrier/2021/travelsSurrender`, scope),
      false
    );
    assert.equal(isAutoWriteAllowed('DELETE', `${h}/x`, scope), false);
    assert.equal(
      isAutoWriteAllowed('POST', `${h}/carriers/2021/travels/toTravelsSurrender`, scope),
      false
    );
    assert.equal(
      isAutoWriteAllowed('POST', `${h}/carrierOwnerLiquidations/2021/4289`, scope),
      false
    );
    assert.equal(isAutoWriteAllowed('PUT', `${h}/travels/1/autoDispatch`, scope), false);
  });
  it('lecturas y POST de pantalla pasan; hosts ajenos libres', () => {
    assert.equal(isAutoWriteAllowed('GET', `${h}/vehicleOwners/4289`, scope), true);
    assert.equal(isAutoWriteAllowed('POST', `${h}/usertrail/register`, scope), true);
    assert.equal(
      isAutoWriteAllowed('POST', 'https://analytics.example.com/vehicleOwners/1', scope),
      true
    );
  });
});
