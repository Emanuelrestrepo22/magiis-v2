// tests/helpers/f5-auto-guards.ts
// Guardas PURAS de la rendicion automatica F5 (fase 2, W3): gates separados armado/disparo, ventana prohibida del
// cron, guarda de propietario dedicado/compartido (D-4), pre-check del lote, decision de desarmado y diff de la
// ficha. Sin I/O: el spec lee (API/UI/DB) y llama a estas funciones; todo se prueba con unitarios.
//
// Mecanica (docs/qa/f5-phase2-surrender-automation-plan.md §3 W3): armar = «Collects Cash» = Vehicle Owner +
// Update (PUT vehicleOwners/{id}, REENVIA todos los vehiculos de la ficha); disparar = papelera del vehiculo >
// «Attention» > Accept (PUT vehicles/{v}/carrier/{c}/travelsSurrender, IRREVERSIBLE: rinde el lote); desarmar =
// «Collects Cash» = Company + Update. Desarmar con rendicion pendiente del propietario responde 400
// VEHICLE_OWNER_HAS_PENDING_SURRENDER: se reporta, NO se reintenta.
import { createHash } from 'node:crypto';
import type { PrepOwner } from '../config/carrier-profiles.js';
import type { SurrenderSummaryRow } from '../api/clients/surrender.client.js';
import type { Mismatch, OracleVerdict } from './oracle-result.js';

const verdict = (mismatches: Mismatch[]): OracleVerdict => ({
  ok: mismatches.length === 0,
  mismatches
});
const cents = (n: number): number => Math.round(n * 100);

// ───────────────────────────── Gates (separados, sin alias) ─────────────────────────────

export const F5_AUTO_ARM_GATE = 'F5_AUTO_ARM';
export const F5_AUTO_FIRE_GATE = 'F5_AUTO_FIRE';
/** Aprobacion EXPLICITA de un propietario compartido: el valor debe ser el id del propietario (no un booleano). */
export const F5_AUTO_APPROVED_SHARED_ENV = 'F5_AUTO_APPROVED_SHARED_OWNER';

/**
 * true solo si el gate vale exactamente `1` (tolera espacios en los extremos). Lee SOLO el nombre exacto: a
 * diferencia de `isGateOpen` (runtime.ts) NO acepta el alias historico `FR_TOGGLE_AUTO_SURRENDER`, que abriria a
 * la vez armado y disparo (el disparo es irreversible: los gates deben poder abrirse por separado).
 */
export function isAutoGateOpen(
  gate: typeof F5_AUTO_ARM_GATE | typeof F5_AUTO_FIRE_GATE,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[gate]?.trim() === '1';
}

export type F5AutoPhase = 'run' | 'arm' | 'fire' | 'verify' | 'disarm';
export const F5_AUTO_PHASES: readonly F5AutoPhase[] = ['run', 'arm', 'fire', 'verify', 'disarm'];

/** Fase pedida por `F5_AUTO_PHASE`; null si falta o es invalida (el spec se salta con el motivo). */
export function f5AutoPhaseFromEnv(env: NodeJS.ProcessEnv = process.env): F5AutoPhase | null {
  const raw = env.F5_AUTO_PHASE?.trim().toLowerCase();
  return F5_AUTO_PHASES.find((p) => p === raw) ?? null;
}

/** Gates que exige cada fase (`verify` es solo lectura; `disarm` escribe la ficha: gate de armado). */
export function requiredAutoGates(
  phase: F5AutoPhase
): ReadonlyArray<typeof F5_AUTO_ARM_GATE | typeof F5_AUTO_FIRE_GATE> {
  switch (phase) {
    case 'run':
      return [F5_AUTO_ARM_GATE, F5_AUTO_FIRE_GATE];
    case 'arm':
    case 'disarm':
      return [F5_AUTO_ARM_GATE];
    case 'fire':
      return [F5_AUTO_FIRE_GATE];
    case 'verify':
      return [];
  }
}

/** Motivo de skip si falta algun gate de la fase (los gates se evaluan SIN abrir navegador); null = abierta. */
export function autoGateSkipReason(
  phase: F5AutoPhase | null,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (phase === null) return `requiere F5_AUTO_PHASE=${F5_AUTO_PHASES.join('|')}`;
  const missing = requiredAutoGates(phase).filter((g) => !isAutoGateOpen(g, env));
  return missing.length === 0
    ? null
    : `fase ${phase} requiere ${missing.map((g) => `${g}=1`).join(' y ')}`;
}

// ───────────────────────────── Ventana del cron ─────────────────────────────

/** Ventana PROHIBIDA para armar/disparar: 12:50–13:30 UTC (el cron barre a ~13:10 UTC con propietarios armados). */
export const F5_CRON_BLOCK_UTC = { startMin: 12 * 60 + 50, endMin: 13 * 60 + 30 } as const;

export type CronBlock = { blocked: boolean; minutesUntilFree: number; reason: string };

/**
 * Bloqueada si `now` cae en 12:50–13:30 UTC o si una corrida que dura `spanMinutes` desde `now` la tocaria
 * (armado a las 12:45 con 10 min de corrida = armado dentro de la ventana). Pura: recibe `now`.
 */
export function f5CronBlock(now: Date, spanMinutes = 10): CronBlock {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const { startMin, endMin } = F5_CRON_BLOCK_UTC;
  const touches = minuteOfDay + spanMinutes > startMin && minuteOfDay < endMin;
  if (!touches) return { blocked: false, minutesUntilFree: 0, reason: '' };
  const hhmm = now.toISOString().slice(11, 16);
  return {
    blocked: true,
    minutesUntilFree: endMin - minuteOfDay,
    reason:
      `ahora ${hhmm} UTC con corrida de ~${spanMinutes} min toca la ventana prohibida 12:50–13:30 UTC ` +
      `(cron de rendicion automatica ~13:10 UTC): esperar ${endMin - minuteOfDay} min`
  };
}

// ───────────────────────────── Guarda de propietario (D-4) ─────────────────────────────

/** Lectura FRESCA de la ficha del propietario (GET vehicleOwners/{id}); `vehicleIds = null` = no se pudo leer. */
export type OwnerFichaReading = {
  ownerId: number;
  cashCollector: boolean | null;
  vehicleIds: readonly number[] | null;
};

export type OwnerGuardMode = 'dedicated' | 'approved-shared';
export type OwnerGuardVerdict = OracleVerdict & { mode: OwnerGuardMode | null };

/**
 * Guarda de ARMADO. La ficha leida AHORA debe coincidir con el perfil: mismo propietario, MISMO conjunto de
 * vehiculos (un vehiculo ajeno = tercero que el PUT reenviaria) y `cashCollector` apagado (armado previo = estado
 * de otra sesion: se aborta, no se pisa). Propietario NO dedicado (compartido): bloqueado salvo que
 * `F5_AUTO_APPROVED_SHARED_OWNER` valga exactamente el id del propietario; incluso aprobado, todos los vehiculos
 * leidos deben ser los QA declarados en el perfil y el spec debe comparar la ficha antes/despues (`diffFicha`).
 */
export function evaluateOwnerGuard(input: {
  profileOwner: PrepOwner;
  fresh: OwnerFichaReading;
  env?: NodeJS.ProcessEnv;
}): OwnerGuardVerdict {
  const { profileOwner, fresh } = input;
  const env = input.env ?? process.env;
  const m: Mismatch[] = [];
  if (fresh.ownerId !== profileOwner.ownerId) {
    m.push({
      field: 'propietario de la ficha',
      expected: profileOwner.ownerId,
      actual: fresh.ownerId
    });
  }
  if (fresh.cashCollector === null) {
    m.push({ field: 'cashCollector (ficha)', expected: 'booleano', actual: null });
  } else if (fresh.cashCollector) {
    m.push({
      field: 'cashCollector previo al armado',
      expected:
        'false (Company): si ya estaba armado es estado de otra sesion, no se pisa ni se desarma',
      actual: true
    });
  }
  if (fresh.vehicleIds === null) {
    m.push({
      field: 'vehiculos de la ficha',
      expected: 'lista legible (sin ella no se puede probar que todos son QA)',
      actual: 'no se pudo leer'
    });
  } else {
    const want = new Set(profileOwner.vehicleIds);
    const got = new Set(fresh.vehicleIds);
    const foreign = [...got].filter((id) => !want.has(id));
    const missing = [...want].filter((id) => !got.has(id));
    if (foreign.length > 0) {
      m.push({
        field: 'vehiculos AJENOS en la ficha (el PUT los reenviaria)',
        expected: `solo ${[...want].join(', ')}`,
        actual: foreign.join(', ')
      });
    }
    if (missing.length > 0) {
      m.push({
        field: 'vehiculos QA ausentes de la ficha',
        expected: [...want].join(', '),
        actual: [...got].join(', ') || 'ninguno'
      });
    }
  }
  let mode: OwnerGuardMode | null = null;
  if (profileOwner.dedicatedForAuto) {
    mode = 'dedicated';
  } else if (
    profileOwner.approvedShared === true ||
    env[F5_AUTO_APPROVED_SHARED_ENV]?.trim() === String(profileOwner.ownerId)
  ) {
    mode = 'approved-shared';
  } else {
    m.push({
      field: `propietario ${profileOwner.ownerId} compartido (vehiculos ${profileOwner.vehicleIds.join(', ')})`,
      expected: `aprobacion explicita: approvedShared en el perfil o ${F5_AUTO_APPROVED_SHARED_ENV}=${profileOwner.ownerId} (D-4)`,
      actual: env[F5_AUTO_APPROVED_SHARED_ENV]?.trim() || 'sin aprobar'
    });
  }
  return { ...verdict(m), mode };
}

// ───────────────────────────── Ficha antes/despues ─────────────────────────────

/** Claves que cambian solas o por el propio armado: no cuentan como «la ficha cambio». */
const VOLATILE_FICHA_KEY = /^(cashCollector|updated|modified|lastUpdate|lastModified|version)/i;

function flatten(path: string, value: unknown, out: Record<string, string>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) out[path || '(raiz)'] = hash('[]');
    value.forEach((v, i) => flatten(`${path}[${i}]`, v, out));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value as object).sort()) {
      if (VOLATILE_FICHA_KEY.test(k)) continue;
      flatten(path ? `${path}.${k}` : k, (value as Record<string, unknown>)[k], out);
    }
    return;
  }
  out[path || '(raiz)'] = hash(JSON.stringify(value ?? null));
}

const hash = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 12);

/**
 * Huella de la ficha: ruta de cada hoja → hash (sin `cashCollector` ni marcas de actualizacion). Se persiste en el snapshot en lugar
 * del cuerpo: la ficha trae datos del propietario (PII) y asi nada sensible llega a disco.
 */
export function fichaFingerprint(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  flatten('', body, out);
  return out;
}

/**
 * Rutas de la ficha que difieren entre las huellas previa al armado y posterior al desarmado. Vacio = «los vehiculos reenviados
 * quedaron con sus valores». Es la prueba que exige el override de propietario compartido: el PUT de armar/desarmar reenvia todos
 * los vehiculos de la ficha.
 */
export function diffFingerprints(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): OracleVerdict {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return verdict(
    paths
      .filter((p) => before[p] !== after[p])
      .map((p) => ({
        field: `ficha ${p}`,
        expected: 'sin cambios por armar/desarmar',
        actual:
          before[p] === undefined
            ? 'campo nuevo'
            : after[p] === undefined
              ? 'campo ausente'
              : 'valor distinto'
      }))
  );
}

/** Atajo sobre cuerpos crudos (unitarios y uso en memoria). */
export function diffFicha(before: unknown, after: unknown): OracleVerdict {
  return diffFingerprints(fichaFingerprint(before), fichaFingerprint(after));
}

// ───────────────────────────── Pre-check del lote ─────────────────────────────

export type AutoDeclaredBatch = {
  /** Cantidad de viajes pendientes esperada en la fila del vehiculo; null = no declarada (solo se exige 1 fila). */
  trips: number | null;
  /** Saldo pendiente esperado de la fila (`toSurrenderTotal`); null = no declarado. */
  balance: number | null;
};

/**
 * Pre-check del lote EXACTO antes de armar (grilla Daily Clearing › Pending por API): exactamente UNA fila para el
 * vehiculo del par, con los viajes y el saldo declarados, y NINGUNA fila pendiente en los otros vehiculos de la
 * ficha del propietario (la rendicion pendiente de cualquiera de ellos haria fallar el desarmado con 400).
 */
export function evaluateAutoPrecheck(input: {
  summaryRows: readonly SurrenderSummaryRow[];
  vehicleId: number;
  ownerVehicleIds: readonly number[];
  declared: AutoDeclaredBatch;
}): OracleVerdict {
  const { summaryRows, vehicleId, ownerVehicleIds, declared } = input;
  const m: Mismatch[] = [];
  const mine = summaryRows.filter((r) => r.vehicleId === vehicleId);
  if (mine.length !== 1) {
    m.push({
      field: `filas pendientes del vehiculo ${vehicleId}`,
      expected: 1,
      actual: mine.length
    });
  } else {
    const row = mine[0];
    if (declared.trips !== null && row.travelsToSurrender !== declared.trips) {
      m.push({
        field: 'viajes pendientes del vehiculo',
        expected: declared.trips,
        actual: row.travelsToSurrender ?? 'ausente'
      });
    }
    if (
      declared.balance !== null &&
      (typeof row.toSurrenderTotal !== 'number' ||
        cents(row.toSurrenderTotal) !== cents(declared.balance))
    ) {
      m.push({
        field: 'saldo pendiente del vehiculo',
        expected: declared.balance,
        actual: row.toSurrenderTotal ?? 'ausente'
      });
    }
  }
  const others = new Set(ownerVehicleIds.filter((v) => v !== vehicleId));
  const foreign = summaryRows.filter((r) => others.has(r.vehicleId));
  if (foreign.length > 0) {
    m.push({
      field: 'pendientes en otros vehiculos de la ficha (bloquean el desarmado)',
      expected: 0,
      actual: foreign
        .map((r) => `${r.vehicleId}: ${r.travelsToSurrender ?? '?'} viaje(s)`)
        .join('; ')
    });
  }
  return verdict(m);
}

/** Verificacion posterior al disparo: ninguna fila pendiente del propietario (vehiculo del par y los de la ficha). */
export function evaluatePendingEmpty(input: {
  summaryRows: readonly SurrenderSummaryRow[];
  ownerVehicleIds: readonly number[];
}): OracleVerdict {
  const ids = new Set(input.ownerVehicleIds);
  const left = input.summaryRows.filter((r) => ids.has(r.vehicleId));
  return verdict(
    left.length === 0
      ? []
      : [
          {
            field: 'Pending (Daily Clearing) del propietario tras disparar',
            expected: 'vacio',
            actual: left
              .map((r) => `${r.vehicleId}: ${r.travelsToSurrender ?? '?'} viaje(s)`)
              .join('; ')
          }
        ]
  );
}

// ───────────────────────────── Desarmado ─────────────────────────────

export type DisarmDecision = 'put' | 'already-company' | 'blocked-pending';

/**
 * Antes de desarmar: ya en Company = nada que hacer; con rendicion pendiente del propietario NO se envia el PUT
 * (el backend lo rechazaria con 400 VEHICLE_OWNER_HAS_PENDING_SURRENDER y el propietario seguiria armado: se
 * reporta, nunca se reintenta en bucle).
 */
export function decideDisarm(input: {
  armedNow: boolean | null;
  pendingOwnerRows: number;
}): DisarmDecision {
  if (input.armedNow === false) return 'already-company';
  if (input.pendingOwnerRows > 0) return 'blocked-pending';
  return 'put';
}

export type DisarmOutcome =
  | { kind: 'ok' }
  | { kind: 'blocked-pending-backend'; detail: string }
  | { kind: 'error'; status: number; detail: string };

/** Clasifica la respuesta del PUT de desarmado. El 400 de pendiente NO es falla del producto: es orden de operacion. */
export function classifyDisarmResponse(status: number, body: string): DisarmOutcome {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 400 && /VEHICLE_OWNER_HAS_PENDING_SURRENDER/.test(body)) {
    return { kind: 'blocked-pending-backend', detail: body.slice(0, 300) };
  }
  return { kind: 'error', status, detail: body.slice(0, 300) };
}

// ───────────────────────────── Lote declarado y UI ─────────────────────────────

export type DeclaredAutoBatch = { tripIds: number[] | null; balance: number | null };

/**
 * `F5_AUTO_TRIPS` (ids csv, opcional en UAT, obligatorio donde hay DB) y `F5_AUTO_EXPECT_BALANCE` (decimal con punto, p. ej.
 * `241.60`). Valores invalidos o ids repetidos lanzan: un lote mal declarado nunca se corrige en silencio.
 */
export function parseDeclaredBatch(env: NodeJS.ProcessEnv = process.env): DeclaredAutoBatch {
  const rawIds = env.F5_AUTO_TRIPS?.trim();
  let tripIds: number[] | null = null;
  if (rawIds) {
    tripIds = rawIds.split(',').map((t) => Number(t.trim()));
    if (
      tripIds.some((n) => !Number.isInteger(n) || n <= 0) ||
      new Set(tripIds).size !== tripIds.length
    ) {
      throw new Error(`F5_AUTO_TRIPS invalido: "${rawIds}" (ids positivos, sin repetir)`);
    }
  }
  const rawBal = env.F5_AUTO_EXPECT_BALANCE?.trim();
  let balance: number | null = null;
  if (rawBal) {
    if (!/^\d+(\.\d{1,2})?$/.test(rawBal)) {
      throw new Error(
        `F5_AUTO_EXPECT_BALANCE invalido: "${rawBal}" (decimal con punto, p. ej. 241.60)`
      );
    }
    balance = Number(rawBal);
  }
  return { tripIds, balance };
}

/** UI: ninguna fila de Pending (Daily Clearing) menciona la patente del vehiculo del par tras disparar. */
export function evaluatePendingUiRows(rowTexts: readonly string[], domain: string): OracleVerdict {
  const hits = rowTexts.filter((t) => t.toUpperCase().includes(domain.toUpperCase()));
  return verdict(
    hits.length === 0
      ? []
      : [
          {
            field: `Pending (UI) con filas del vehiculo ${domain}`,
            expected: 0,
            actual: hits.length
          }
        ]
  );
}

// ───────────────────────────── Firewall de escrituras ─────────────────────────────

/**
 * Escrituras que la automatica puede emitir: `PUT vehicleOwners/{ownerId}` (armar/desarmar) y `PUT
 * vehicles/{vehicleId}/carrier/{c}/travelsSurrender` (disparo). Nada de rendicion manual, liquidaciones, DELETE, autodispatch ni
 * otro propietario/vehiculo. Las demas escrituras son POST de lectura de la propia pantalla (grillas, trail) y pasan.
 */
export function isAutoWriteAllowed(
  method: string,
  url: string,
  scope: { ownerId: number; vehicleId: number }
): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return true;
  let host = '';
  let path = url.split('?')[0];
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname;
  } catch {
    /* ruta relativa */
  }
  if (host && !/magiis/i.test(host)) return true;
  if (m === 'PUT' && new RegExp(`/vehicleOwners/${scope.ownerId}$`).test(path)) return true;
  if (
    m === 'PUT' &&
    new RegExp(`/vehicles/${scope.vehicleId}/carrier/[0-9]+/travelsSurrender$`).test(path)
  )
    return true;
  if (m === 'DELETE') return false;
  if (/\/vehicleOwners(\/|$)/i.test(path)) return false;
  if (/\/(toTravelsSurrender|travelsSurrender)$/i.test(path)) return false;
  if (/\/(carrierDriverLiquidations|carrierOwnerLiquidations)(\/|$)/i.test(path)) return false;
  if (/autoDispatch/i.test(path)) return false;
  return true;
}
