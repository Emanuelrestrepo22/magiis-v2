// tests/helpers/f5-app-handoff.ts
// Universal F5 (MG-1027) · W5a: contrato de handoff Playwright (este repo) <-> Appium (magiis-playwright, W5b) para el
// cierre de un viaje desde la app Chofer y su posterior rendicion. Plan docs/qa/f5-phase2-surrender-automation-plan.md §3 W5.
//
// Los tipos y `parseF5AppHandoff` REPLICAN el contrato del runner (`tests/mobile/appium/contracts/f5AppHandoff.ts`
// del repo Appium, schemaVersion 1); no se importa cross-repo. La compatibilidad se cubre con los fixtures
// `tests/helpers/fixtures/f5-app-handoff.{prepared,closed}.json`, que el repo Appium puede copiar y validar con su
// propio parser. Si el contrato cambia, subir `F5_APP_HANDOFF_SCHEMA_VERSION` en ambos lados.
//
// Archivo unico por carrier y ambiente: `evidence/<env>/f5-app-handoff-<carrier>.json`.
//  - W5a (f5-app-prepare) escribe `status: "prepared"` (o `failed` si la asignacion se corto tras el alta).
//  - El runner Appium cierra el viaje y ANEXA `closedAt`, `measured` y `result` (`status: "closed"`).
//  - W5a (f5-app-verify) relee el mismo archivo.
// Sin credenciales ni tokens: solo ids y datos del viaje. El cierre por app RECALCULA total/tarifa con los km medidos y
// el costo queda en 0 hasta F7: `quoted` es referencia y NUNCA se compara por igualdad con el total final.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PrepApp, PrepPair } from '../config/carrier-profiles.js';
import type { TravelDetail } from '../api/clients/travels.client.js';
import { detailDriverId } from './circuit-guards.js';

export const F5_APP_HANDOFF_SCHEMA_VERSION = 1;

export type F5AppHandoffStatus = 'prepared' | 'closed' | 'failed';

export type F5AppMeasured = {
  /** Km medidos. Hoy provienen de la ruta GPS alimentada (`gps-fed`): la app no expone el km. */
  km: number;
  minutes: number;
  kmSource: 'gps-fed' | 'app-summary';
  /** Distancia teorica de la ruta completa, en km (para contrastar con el km final del backend). */
  routeKm: number;
};

export type F5AppResult = {
  /** Texto tal cual lo muestra la app en el resumen (p. ej. `$1,645.00`). */
  totalAmountText: string;
  /** Monto parseado; `null` si el formato no se pudo interpretar (no se inventa). */
  totalAmount: number | null;
  paymentMethod: string;
  /** Texto del boton de cierre (`Cerrar Viaje` / `Firmar y Cerrar viaje`). */
  closeButtonText: string;
  checkpoints: Array<{ stage: string; matchedBy: string; observedAt: string }>;
  startedAt: string;
  finishedAt: string;
};

/** Ruta esperada declarada por W5a (campo EXTRA del contrato: el runner lo preserva y lo lee si lo necesita). */
export type F5AppRoute = {
  region: string;
  origin: string;
  destination: string;
  /** Id de la ruta GPS a alimentar. `null` = el runner debe resolverla (hoy solo existe Cannes–Niza, FR). */
  gpsRoute: string | null;
  note: string;
};

export type F5AppHandoff = {
  schemaVersion: number;
  status: F5AppHandoffStatus;
  runId: string;
  carrierId: number;
  travelId: number;
  /** Codigo visible del viaje (el que muestra Carrier, `<id>-<canal>`). */
  code: string;
  driverId: number;
  vehicleId: number;
  ownerId: number;
  /** Escenario de alta, p. ej. `EF-NC-COM`. */
  scenario: string;
  /** Moneda del carrier (ISO 4217). */
  currency?: string;
  /** Cotizacion de alta. Referencia: el cierre por app la recalcula. */
  quoted: { total: number; otherCosts: number };
  app: { package: string; version?: string; udid: string };
  /** ISO-8601 UTC del cierre en la app. Solo lo escribe el runner. */
  closedAt?: string;
  measured?: F5AppMeasured;
  result?: F5AppResult;
  failure?: { stage: string; message: string; at: string };
  /** Notas no bloqueantes (p. ej. `diferido-f7`). */
  observations?: string[];
  /** Extra W5a (no esta en el contrato del runner). */
  route?: F5AppRoute;
};

const STATUSES: readonly F5AppHandoffStatus[] = ['prepared', 'closed', 'failed'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valida y devuelve el handoff; lanza con TODAS las violaciones encontradas (sin valores sensibles). */
export function parseF5AppHandoff(raw: unknown): F5AppHandoff {
  if (!isRecord(raw)) throw new Error('Handoff invalido: se esperaba un objeto JSON.');
  const errors: string[] = [];

  const str = (from: Record<string, unknown>, key: string, label = key): string => {
    const v = from[key];
    if (typeof v !== 'string' || !v.trim()) errors.push(`${label}: texto requerido`);
    return typeof v === 'string' ? v : '';
  };
  const id = (key: string): number => {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      errors.push(`${key}: entero positivo requerido`);
    }
    return typeof v === 'number' ? v : 0;
  };
  const amount = (from: Record<string, unknown>, key: string, label: string): number => {
    const v = from[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      errors.push(`${label}: numero >= 0 requerido`);
    }
    return typeof v === 'number' ? v : 0;
  };

  const schemaVersion = raw.schemaVersion ?? F5_APP_HANDOFF_SCHEMA_VERSION;
  if (schemaVersion !== F5_APP_HANDOFF_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion: se soporta ${F5_APP_HANDOFF_SCHEMA_VERSION}, llego ${String(schemaVersion)}`
    );
  }
  const status = (raw.status ?? 'prepared') as F5AppHandoffStatus;
  if (!STATUSES.includes(status)) errors.push(`status: debe ser ${STATUSES.join(' | ')}`);

  const runId = str(raw, 'runId');
  const carrierId = id('carrierId');
  const travelId = id('travelId');
  const code = str(raw, 'code');
  const driverId = id('driverId');
  const vehicleId = id('vehicleId');
  const ownerId = id('ownerId');
  const scenario = str(raw, 'scenario');

  let quoted = { total: 0, otherCosts: 0 };
  if (!isRecord(raw.quoted)) errors.push('quoted: objeto {total, otherCosts} requerido');
  else {
    quoted = {
      total: amount(raw.quoted, 'total', 'quoted.total'),
      otherCosts: amount(raw.quoted, 'otherCosts', 'quoted.otherCosts')
    };
  }

  let app: F5AppHandoff['app'] = { package: '', udid: '' };
  if (!isRecord(raw.app)) errors.push('app: objeto {package, udid} requerido');
  else {
    app = {
      package: str(raw.app, 'package', 'app.package'),
      udid: str(raw.app, 'udid', 'app.udid')
    };
    if (raw.app.version !== undefined) {
      if (typeof raw.app.version === 'string') app.version = raw.app.version;
      else errors.push('app.version: texto');
    }
  }

  if (
    raw.currency !== undefined &&
    (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency))
  ) {
    errors.push('currency: codigo ISO de 3 letras mayusculas');
  }
  if (
    raw.closedAt !== undefined &&
    (typeof raw.closedAt !== 'string' || Number.isNaN(Date.parse(raw.closedAt)))
  ) {
    errors.push('closedAt: fecha ISO-8601');
  }
  if (raw.measured !== undefined) {
    const m = raw.measured;
    if (!isRecord(m)) errors.push('measured: objeto');
    else {
      amount(m, 'km', 'measured.km');
      amount(m, 'minutes', 'measured.minutes');
      amount(m, 'routeKm', 'measured.routeKm');
      if (m.kmSource !== 'gps-fed' && m.kmSource !== 'app-summary') {
        errors.push('measured.kmSource: gps-fed | app-summary');
      }
    }
  }
  if (status === 'closed') {
    if (raw.closedAt === undefined) errors.push('closedAt: requerido cuando status="closed"');
    if (raw.measured === undefined) errors.push('measured: requerido cuando status="closed"');
    if (!isRecord(raw.result)) errors.push('result: requerido cuando status="closed"');
  }
  if (status === 'failed' && !isRecord(raw.failure)) {
    errors.push('failure: requerido cuando status="failed"');
  }
  if (
    raw.observations !== undefined &&
    !(Array.isArray(raw.observations) && raw.observations.every((o) => typeof o === 'string'))
  ) {
    errors.push('observations: lista de textos');
  }

  if (errors.length > 0) throw new Error(`Handoff invalido:\n- ${errors.join('\n- ')}`);

  return {
    ...(raw as Record<string, unknown>),
    schemaVersion: F5_APP_HANDOFF_SCHEMA_VERSION,
    status,
    runId,
    carrierId,
    travelId,
    code,
    driverId,
    vehicleId,
    ownerId,
    scenario,
    quoted,
    app
  } as F5AppHandoff;
}

/** Ruta canonica: `evidence/<env>/f5-app-handoff-<carrier>.json` (carrier = id numerico o alias). */
export function f5AppHandoffPath(
  env: string,
  carrier: string | number,
  root = process.cwd()
): string {
  const safe = String(carrier).replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe) throw new Error('carrier invalido para el nombre del handoff.');
  return path.resolve(root, 'evidence', env, `f5-app-handoff-${safe}.json`);
}

export function readF5AppHandoff(file: string): F5AppHandoff {
  if (!existsSync(file)) {
    throw new Error(`No existe el handoff: ${file}. Lo genera f5-app-prepare (W5a).`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Handoff ilegible (${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseF5AppHandoff(raw);
}

/** Lectura tolerante: `null` si el archivo no existe; lanza si existe y es invalido. */
export function readF5AppHandoffIfExists(file: string): F5AppHandoff | null {
  return existsSync(file) ? readF5AppHandoff(file) : null;
}

/** Escritura atomica (tmp + rename): el runner puede leer en cualquier momento sin ver JSON a medias. */
export function writeF5AppHandoff(file: string, handoff: F5AppHandoff): void {
  parseF5AppHandoff(handoff);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/**
 * Decide que hacer con un handoff previo al preparar uno nuevo. Un `prepared` pendiente es un viaje asignado sin
 * cerrar: pisarlo lo dejaria huerfano, por eso lanza (salvo `replacePrepared` explicito). `closed`/`failed` se
 * archivan (`archive`) antes de escribir; sin previo, `write`.
 */
export function planHandoffWrite(
  existing: F5AppHandoff | null,
  opts: { replacePrepared?: boolean } = {}
): 'write' | 'archive' {
  if (existing === null) return 'write';
  if (existing.status === 'prepared' && opts.replacePrepared !== true) {
    throw new Error(
      `Ya hay un handoff "prepared" (viaje ${existing.travelId}, run ${existing.runId}) sin cerrar: cerrarlo con el ` +
        'runner Appium o declarar F5_APP_HANDOFF_REPLACE=1 si el viaje ya no se va a usar. No se crea otro viaje.'
    );
  }
  return 'archive';
}

/** Nombre del archivo de archivo del handoff previo (`...-1521.prev-<travelId>-<runId>.json`). */
export function archivedHandoffPath(file: string, previous: F5AppHandoff): string {
  const safeRun = previous.runId.replace(/[^A-Za-z0-9_-]/g, '');
  return file.replace(/\.json$/, `.prev-${previous.travelId}-${safeRun}.json`);
}

// ───────────────────────────── Preparacion (alta + asignacion) ─────────────────────────────

/** Escenarios en efectivo que no dependen de clientCcId/ccPaymentMethod y no editan la tarifa final. */
export const APP_PREP_SCENARIOS = ['EF-NC-COM', 'EF-PLAIN', 'EF-NC-ONLY'] as const;
export type AppPrepScenarioId = (typeof APP_PREP_SCENARIOS)[number];

export function parseAppScenario(raw: string | undefined): AppPrepScenarioId {
  const id = raw?.trim() || 'EF-NC-COM';
  if (!(APP_PREP_SCENARIOS as readonly string[]).includes(id)) {
    throw new Error(
      `F5_APP_SCENARIO="${id}" invalido para el cierre por app: validos ${APP_PREP_SCENARIOS.join(', ')} (solo efectivo)`
    );
  }
  return id as AppPrepScenarioId;
}

/** Ruta GPS disponible hoy en el runner (FR). */
export const APP_GPS_ROUTES_AVAILABLE: Readonly<Record<string, string>> = { FR: 'cannes-niza' };

export function expectedRoute(input: {
  region: string;
  origin: string;
  destination: string;
}): F5AppRoute {
  const gpsRoute = APP_GPS_ROUTES_AVAILABLE[input.region] ?? null;
  return {
    region: input.region,
    origin: input.origin,
    destination: input.destination,
    gpsRoute,
    note:
      gpsRoute === null
        ? `TODO runner: no hay ruta GPS para la region ${input.region} (solo ${Object.values(APP_GPS_ROUTES_AVAILABLE).join(', ')}); ` +
          'definir una ruta US que cubra origen->destino del alta antes de cerrar por app.'
        : `ruta GPS ${gpsRoute}`
  };
}

export function buildPreparedHandoff(input: {
  runId: string;
  carrierId: number;
  travelId: number;
  code: string;
  pair: PrepPair;
  scenario: string;
  currency: string;
  quoted: { total: number; otherCosts: number };
  app: PrepApp;
  route: F5AppRoute;
  observations?: string[];
}): F5AppHandoff {
  const observations = [...(input.observations ?? [])];
  if (input.route.gpsRoute === null) observations.push('ruta-gps-pendiente-en-runner');
  if (!input.app.credentialsMatchPair) {
    observations.push('credenciales-app-sin-verificar-para-el-chofer-del-par');
  }
  const handoff: F5AppHandoff = {
    schemaVersion: F5_APP_HANDOFF_SCHEMA_VERSION,
    status: 'prepared',
    runId: input.runId,
    carrierId: input.carrierId,
    travelId: input.travelId,
    code: input.code,
    driverId: input.pair.driverId,
    vehicleId: input.pair.vehicleId,
    ownerId: input.pair.ownerId,
    scenario: input.scenario,
    currency: input.currency,
    quoted: input.quoted,
    app: { package: input.app.package, version: input.app.version, udid: input.app.udid },
    route: input.route,
    ...(observations.length > 0 ? { observations } : {})
  };
  return parseF5AppHandoff(handoff);
}

export function failedHandoff(
  base: F5AppHandoff,
  stage: string,
  message: string,
  at: string
): F5AppHandoff {
  return { ...base, status: 'failed', failure: { stage, message: message.slice(0, 500), at } };
}

// ───────────────────────────── Verificacion del cierre por app ─────────────────────────────

const STATE_DONE = /^(DONE|6)$/i;

/** Tolerancia relativa del km del backend contra la ruta (default 15 %; `F5_APP_KM_TOLERANCE_PCT` la pisa). */
export const DEFAULT_KM_TOLERANCE_PCT = 15;

export function resolveKmTolerancePct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.F5_APP_KM_TOLERANCE_PCT?.trim();
  if (!raw) return DEFAULT_KM_TOLERANCE_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    throw new Error(`F5_APP_KM_TOLERANCE_PCT="${raw}" invalido: numero en (0, 100]`);
  }
  return n;
}

/**
 * Km final del detalle. Los nombres de campo NO estan verificados contra el detalle real: se prueban en orden y se
 * ignoran los que sugieren dinero. Devuelve `null` si ninguno es numerico > 0 (no se inventa: queda observation).
 */
export function pickMeasuredKm(detail: TravelDetail): { field: string; km: number } | null {
  const preferred = ['finalKm', 'km', 'realKm', 'totalKm', 'distance'];
  for (const field of preferred) {
    const v = detail[field];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return { field, km: v };
  }
  for (const [field, v] of Object.entries(detail)) {
    if (
      typeof v === 'number' &&
      Number.isFinite(v) &&
      v > 0 &&
      /km|distance/i.test(field) &&
      !/price|cost|amount|rate/i.test(field)
    ) {
      return { field, km: v };
    }
  }
  return null;
}

export type AppClosureMismatch = { field: string; expected: unknown; actual: unknown };

export type AppClosureVerdict = {
  ok: boolean;
  mismatches: AppClosureMismatch[];
  /** Notas no bloqueantes: `diferido-f7`, km no expuesto, recalculo vs cotizacion, etc. */
  observations: string[];
  finalPrice: number | null;
  differsFromQuote: boolean;
  quoteVsFinalDelta: number | null;
  kmChecked: { backendKm: number; source: string; routeKm: number; deltaPct: number } | null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Oraculo PURO del cierre por app: estado DONE, chofer = del handoff, precio final > 0, km del backend dentro de la
 * tolerancia de la ruta medida. NUNCA exige total final = cotizacion (el cierre por app recalcula; regla QA lead
 * 15/10): solo lo registra. Costo 0 (o ausente) hasta F7 = observation `diferido-f7`, nunca falla.
 */
export function evaluateAppClosure(input: {
  handoff: F5AppHandoff;
  detail: TravelDetail;
  /** Km leido de DB (TEST) si hay capa db; contrasta con el del detalle. */
  dbKm?: number | null;
  tolerancePct?: number;
}): AppClosureVerdict {
  const { handoff, detail } = input;
  const tol = input.tolerancePct ?? DEFAULT_KM_TOLERANCE_PCT;
  const mismatches: AppClosureMismatch[] = [];
  const observations: string[] = [];

  if (handoff.status !== 'closed') {
    mismatches.push({ field: 'handoff.status', expected: 'closed', actual: handoff.status });
  }
  const state = String(detail.state ?? '');
  if (!STATE_DONE.test(state)) mismatches.push({ field: 'state', expected: 'DONE', actual: state });

  const driverId = detailDriverId(detail);
  if (driverId !== handoff.driverId) {
    mismatches.push({ field: 'driver.id', expected: handoff.driverId, actual: driverId });
  }

  const amount = typeof detail.amount === 'number' ? round2(detail.amount) : null;
  if (amount === null || !(amount > 0)) {
    mismatches.push({ field: 'precio final (detail.amount)', expected: '> 0', actual: amount });
  }

  const differsFromQuote = amount !== null && round2(amount) !== round2(handoff.quoted.total);
  const quoteVsFinalDelta = amount === null ? null : round2(amount - handoff.quoted.total);
  if (amount !== null && !differsFromQuote) {
    observations.push(
      'total final == cotizacion: coincidencia, no es contrato (el cierre por app recalcula con km/tiempo medidos)'
    );
  }

  // Costo: hasta F7 queda en 0 (o ausente). Se registra, no falla; un costo > 0 tambien se registra.
  const cost = typeof detail.amountCost === 'number' ? detail.amountCost : null;
  if (cost === null || cost === 0)
    observations.push('diferido-f7: costo 0/ausente en cierre por app');
  else
    observations.push(
      `costo ${cost} > 0 en cierre por app (esperado 0 hasta F7): revisar con QA lead`
    );

  // App vs backend: informativo (el texto de la app puede no ser parseable).
  const appTotal = handoff.result?.totalAmount;
  if (typeof appTotal === 'number' && amount !== null && round2(appTotal) !== amount) {
    observations.push(
      `total de la app ${appTotal} != detail.amount ${amount}: registrar (regla no definida, no se asevera)`
    );
  }

  // Km: backend vs ruta medida.
  let kmChecked: AppClosureVerdict['kmChecked'] = null;
  const picked = pickMeasuredKm(detail);
  const routeKm = handoff.measured?.routeKm;
  if (picked === null) {
    observations.push(
      'km final no expuesto en el detalle (campo no verificado): sin contraste de km por API'
    );
  } else if (typeof routeKm === 'number' && routeKm > 0) {
    const deltaPct = round2((Math.abs(picked.km - routeKm) / routeKm) * 100);
    kmChecked = { backendKm: picked.km, source: picked.field, routeKm, deltaPct };
    if (deltaPct > tol) {
      mismatches.push({
        field: `km backend (${picked.field}) vs measured.routeKm`,
        expected: `${routeKm} +/- ${tol} %`,
        actual: picked.km
      });
    }
  }
  if (typeof input.dbKm === 'number' && typeof routeKm === 'number' && routeKm > 0) {
    const deltaPct = round2((Math.abs(input.dbKm - routeKm) / routeKm) * 100);
    if (deltaPct > tol) {
      mismatches.push({
        field: 'FINALPRICEI.KM (DB) vs measured.routeKm',
        expected: `${routeKm} +/- ${tol} %`,
        actual: input.dbKm
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    observations,
    finalPrice: amount,
    differsFromQuote,
    quoteVsFinalDelta,
    kmChecked
  };
}

export function formatAppClosureMismatches(m: readonly AppClosureMismatch[]): string {
  return m
    .map(
      (x) =>
        `${x.field}: esperado ${JSON.stringify(x.expected)}, obtenido ${JSON.stringify(x.actual)}`
    )
    .join('; ');
}

/**
 * Guarda de preparacion: el chofer que usa la app (`prep.app.driverLabel`) debe ser el del par con el que se asigna el
 * viaje; si no, la app nunca vera la oferta. Lanza con el motivo (nunca imprime credenciales: solo etiquetas).
 */
export function assertAppDriverMatchesPair(app: PrepApp, pair: PrepPair): void {
  if (app.driverLabel.trim().toLowerCase() !== (pair.driverLabel ?? '').trim().toLowerCase()) {
    throw new Error(
      `[f5-app] el chofer de la app («${app.driverLabel}») no es el del par («${pair.driverLabel ?? 'sin etiqueta'}», DRIVER.ID ${pair.driverId}): ` +
        'elegir con F5_PREP_PAIR el par cuyo chofer tiene sesion en la app.'
    );
  }
}
