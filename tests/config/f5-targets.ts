// tests/config/f5-targets.ts
// Pares chofer/vehículo verificados en TEST para la rendición F5 (MG-1024 BE + MG-1027 FE). Solo hechos
// leídos de DB/UI el 2026-11-05 (oráculo manual en agentic-qa-boilerplate `.session/regression-testing/
// 2026-11-05-f5-rendicion-liquidacion/`). Sin credenciales: la sesión sale del storage state de la región.
// Selección: F5_TARGETS=1040[,1901,1521,1521b] (default `1040`). 1521/1521b exigen CIRCUIT_CARRIER=1521
// (la región '' resuelve el storage `state-carrier-circuit-1521-<env>.json`; ver getStorageStatePath).
// El LOTE pendiente NO vive aquí: se resuelve en runtime (GET driversSurrenderSummary/toSurrend + DB) porque
// un lote codificado se consume al confirmarse y deja la suite vencida. Aquí solo hay fixtures estables.
import type { CarrierRegion } from './runtime.js';
import type { F5MoneyFormat } from '../helpers/f5-surrender-oracle.js';
import { F5_FORMATS } from '../helpers/f5-surrender-oracle.js';
import { parsePairOverride, pickPendingPair } from '../helpers/f5-pending-pair.js';
import type { SurrenderSummaryRow } from '../api/clients/surrender.client.js';
import {
  loadCarrierProfileScoped,
  peekCarrierProfile,
  type CarrierProfile
} from './carrier-profiles.js';

export type F5Target = {
  id: '1040' | '1901' | '1521' | '1521b' | '1481' | '2021';
  label: string;
  /** Región del storage state (`storage/state-carrier-<región>-<env>.json`; '' = primaria). */
  region: CarrierRegion;
  carrierId: number;
  /**
   * DRIVER.ID. La query `driverUserId` de la rendición (toSurrend / toTravelsSurrender / POST) lleva
   * DRIVER.ID, no DRIVER.USER_ID: TRAVELSSURRENDER.DRIVER_ID = 5036 = DRIVER.ID (USER_ID 16351).
   */
  driverUserId: number;
  vehicleId: number;
  ownerId: number;
  /** Concepto no comisionable del carrier (CARRIER_OTHER_COSTS). */
  ncConcept: { id: number; name: string };
  /** Formato de importes en pantalla del carrier (AR es-AR · US · FR sin miles). */
  moneyFormat: F5MoneyFormat;
  /**
   * `runtime` = el par chofer/vehículo NO está fijado (UAT sin DB): `driverUserId`/`vehicleId` valen 0 y se
   * resuelven por API (`resolveF5Target`). Ausente = par fijo verificado (TEST).
   */
  pair?: 'runtime';
  /**
   * Par PROPIO de QA del perfil UAT (`prep.pairs[prep.defaultPair]`): con `pair: 'runtime'` es el par por defecto
   * (gana sobre la heuristica «menos viajes»; `F5_UAT_PAIR` lo pisa). Ausente = heuristica de la grilla.
   */
  defaultPair?: { driverUserId: number; vehicleId: number };
  /**
   * Perfil de carrier que gobierna este target (`CIRCUIT_CARRIER`): `<id>-uat` en UAT, `1521`/`1901` en TEST;
   * ausente = sin perfil (1040 TEST historico). Las olas W1/W3/W4/W5a leen del perfil propietario, liquidacion y app.
   */
  profileId?: string;
  /** Clave del par dentro de `prep.pairs` del perfil (p. ej. `1521b`); ausente = `prep.defaultPair`. */
  pairKey?: string;
};

export const F5_TARGETS: Readonly<Record<'1040' | '1901' | '1521' | '1521b', F5Target>> = {
  // Carrier compartido: datos propios «QA F5 1040»; NUNCA el botón «A» (autodispatch).
  '1040': {
    id: '1040',
    label: 'Argentina 1040 (TEST, ARS) — chofer 5036 «Igna Driver», vehículo 2565',
    region: 'AR',
    carrierId: 1040,
    driverUserId: 5036,
    vehicleId: 2565,
    ownerId: 1349,
    ncConcept: { id: 66, name: 'QA MG995 TC015' },
    moneyFormat: F5_FORMATS.AR
  },
  '1901': {
    id: '1901',
    label: 'Francia 1901 (TEST, EUR) — chofer 4965 «Senna», vehículo 3765',
    region: '',
    carrierId: 1901,
    driverUserId: 4965,
    vehicleId: 3765,
    ownerId: 2927,
    ncConcept: { id: 194, name: 'QA F5 1901 NC' },
    moneyFormat: F5_FORMATS.FR,
    profileId: '1901'
  },
  // Carrier USA (TEST, USD). Pares propiedad de QA («QA Fcinco Driver»). El lote pendiente (viajes de los
  // pares) se resuelve en runtime. ownerId/ncConcept: sin dato verificado (nada del spec de vista previa
  // los consume; solo la pata DB de otros specs), por eso 0/'' explícitos y no inventados.
  '1521': {
    id: '1521',
    label: 'USA 1521 (TEST, USD) — chofer 5076 «QA Fcinco Driver», vehículo 3849',
    region: '',
    carrierId: 1521,
    driverUserId: 5076,
    vehicleId: 3849,
    ownerId: 3287,
    // Concepto NC en efectivo del perfil 1521 (SELECT TEST 11/11: CARRIER_OTHER_COSTS 165, IS_COMMISIONABLE=0).
    ncConcept: { id: 165, name: 'QA F2 V Fijo No Comisionable' },
    moneyFormat: F5_FORMATS.US,
    profileId: '1521',
    pairKey: '1521'
  },
  '1521b': {
    id: '1521b',
    label: 'USA 1521 (TEST, USD) — chofer 5096, vehículo 3869',
    region: '',
    carrierId: 1521,
    driverUserId: 5096,
    vehicleId: 3869,
    ownerId: 3287,
    ncConcept: { id: 165, name: 'QA F2 V Fijo No Comisionable' },
    moneyFormat: F5_FORMATS.US,
    profileId: '1521',
    pairKey: '1521b'
  }
};

/** Ids aceptados en ENV=uat (carriers reales de UAT; 1521/1901 son TEST y no existen/son otro país en UAT). */
export type F5UatId = '1040' | '1481' | '2021';

const uatTarget = (
  id: F5UatId,
  label: string,
  region: CarrierRegion,
  moneyFormat: F5MoneyFormat
): F5Target => {
  const prep = (peekCarrierProfile(`${id}-uat`) as CarrierProfile).prep;
  const pair = prep?.pairs[prep.defaultPair];
  return {
    id,
    label,
    region,
    carrierId: Number(id),
    driverUserId: 0,
    vehicleId: 0,
    ownerId: 0,
    ncConcept: { id: 0, name: '' },
    moneyFormat,
    pair: 'runtime',
    profileId: `${id}-uat`,
    ...(prep ? { pairKey: prep.defaultPair } : {}),
    ...(pair ? { defaultPair: { driverUserId: pair.driverId, vehicleId: pair.vehicleId } } : {})
  };
};

/**
 * Targets de UAT (modo UI + API, sin DB): AR 1040, US 1481 (en-US, COMMA/POINT), FR 2021 (NONE/COMMA).
 * TEST 1521 no existe en UAT y TEST 1901 en UAT es un carrier argentino vacío (recon 06/11). SIN par fijado:
 * la grilla de pendientes (Daily Clearing › Pending) decide en runtime. 0/'' explícitos: solo los consume la
 * pata DB, que en UAT es N/A.
 * Sesión (login humano previo): 1040 → `state-carrier-ar-uat.json`; 1481 → `state-carrier-us-uat.json`
 * (también `state-carrier-circuit-1521-uat.json`); 2021 → `state-carrier-fr-uat.json` (también
 * `state-carrier-uat-fr.json`). El par por defecto sale del perfil UAT (`<id>-uat`, `prep.defaultPair`). Claves de entorno: USER/PASS_CARRIER_AR | _US | _FR.
 */
export const F5_UAT_TARGETS: Readonly<Record<F5UatId, F5Target>> = {
  '1040': uatTarget(
    '1040',
    'Argentina 1040 (UAT, ARS) — par resuelto por API',
    'AR',
    F5_FORMATS.AR
  ),
  '1481': uatTarget('1481', 'USA 1481 (UAT, USD) — par resuelto por API', 'US', F5_FORMATS.US),
  '2021': uatTarget('2021', 'Francia 2021 (UAT, EUR) — par resuelto por API', 'FR', F5_FORMATS.FR)
};

/** Secciones del perfil que leen W3 (propietario), W4 (liquidacion) y W5a (app); el alta (clientes) queda fuera. */
export const F5_TARGET_PROFILE_SCOPES = [
  'prep.owner',
  'prep.settlement',
  'prep.app',
  'prep.pairs'
] as const;

/**
 * Perfil de carrier del target (para leer `prep.owner`/`settlement`/`app`/`pairs`); lanza si el target no tiene
 * perfil o si esas secciones tienen pendientes. Los pendientes del alta de un esqueleto (1521) no bloquean aqui.
 */
export function f5TargetProfile(
  target: F5Target,
  scopes: readonly string[] = F5_TARGET_PROFILE_SCOPES
): CarrierProfile {
  if (!target.profileId) {
    throw new Error(
      `[F5 ${target.id}] target sin perfil de carrier (profileId): solo 1040 TEST historico`
    );
  }
  return loadCarrierProfileScoped(target.profileId, scopes);
}

/** Tabla de targets del ambiente: UAT usa los de par en runtime; TEST (y el resto) los verificados. */
export function f5TargetTable(
  env: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, F5Target>> {
  return env.ENV?.trim() === 'uat' ? F5_UAT_TARGETS : F5_TARGETS;
}

/** Targets activos según F5_TARGETS (default `1040`); un id desconocido (para el ambiente) lanza. */
export function activeF5Targets(env: NodeJS.ProcessEnv = process.env): F5Target[] {
  const table = f5TargetTable(env);
  const raw = env.F5_TARGETS?.trim() || '1040';
  return raw.split(',').map((id) => {
    const target = table[id.trim()];
    if (!target) {
      const uat = table === F5_UAT_TARGETS;
      throw new Error(
        `F5_TARGETS="${id.trim()}" no válido en ${uat ? 'ENV=uat' : 'este ambiente'}: disponibles ${Object.keys(table).join(', ')}` +
          (uat ? ' (1521/1901/1521b son solo TEST)' : '')
      );
    }
    return target;
  });
}

/**
 * Completa el par de un target `runtime` con la grilla de pendientes (GET driversSurrenderSummary). Un target
 * de par fijo (TEST) vuelve SIN cambios. Devuelve null si no hay par pendiente (el spec decide: falla con
 * «sin datos pendientes»). `requireExplicit` (confirmación irreversible) exige F5_UAT_PAIR y nunca infiere.
 */
export function resolveF5Target(
  target: F5Target,
  pendingRows: readonly SurrenderSummaryRow[],
  opts: { requireExplicit?: boolean; env?: NodeJS.ProcessEnv } = {}
): F5Target | null {
  if (target.pair !== 'runtime') return target;
  const override = parsePairOverride((opts.env ?? process.env).F5_UAT_PAIR);
  if (opts.requireExplicit && !override) {
    throw new Error(
      `[F5 ${target.id}] la confirmación irreversible no infiere el par: definir F5_UAT_PAIR=<driverUserId>/<vehicleId>`
    );
  }
  // Sin override gana el par propio del perfil (nunca la heuristica «menos viajes», que elige lotes de terceros).
  const pair = pickPendingPair(pendingRows, override ?? target.defaultPair ?? null);
  if (!pair) return null;
  return { ...target, driverUserId: pair.driverUserId, vehicleId: pair.vehicleId };
}
