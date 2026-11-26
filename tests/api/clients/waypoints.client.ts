// tests/api/clients/waypoints.client.ts
// Cliente de Puntos de referencia del carrier (MG-1132). Sirve de precondicion, limpieza y oraculo
// de los Tests de pantalla y es el objeto de los Tests de contrato (enmienda 2026-11-19 del ADR-0003).
// Endpoints medidos en TEST (base `apps-test.magiis.com/magiis-v0.2/`, 16-18/11/2026; plan
// MG-1132/automation-plan.md §1). `{carrierId}` = session.carrierId (userId del carrier):
// - list:   GET    carriers/{carrierId}/waypoint                      (solo activos)
// - create: POST   carriers/{carrierId}/waypoint   {name, reference, latitude, longitude}
//           -> 200 {waypoint, warnings}; el alta por API NO valida ruteabilidad (Q5)
// - update: PUT    carriers/{carrierId}/waypoint/{id}  (mover el pin sube la version del placeId)
// - usage:  GET    carriers/{carrierId}/waypoint/{id}/usage
// - remove: DELETE carriers/{carrierId}/waypoint/{id}  (baja logica; devuelve el objeto de uso)
// Guardas: solo crea/edita/borra puntos del run (nombre «QA AUTO <runId> …») y SIEMPRE relee la lista
// antes del DELETE (incidente 18/11, carrier 1040: borrado por posicion de puntos ajenos).
import type { APIRequestContext } from '@playwright/test';
import {
  readJson,
  redactApiText,
  sendGetOk,
  sendOk,
  type CarrierSession
} from './carrierSession.js';

export const WAYPOINT_NAME_PREFIX = 'QA AUTO ';
export const WAYPOINT_NAME_MAX_LENGTH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ninguna corrida de esta automatizacion es anterior al 01/11/2026 (inicio de MG-1132). */
const SWEEP_MIN_DATE_MS = Date.UTC(2026, 10, 1);
const RUN_ID_PATTERN = /^[0-9A-Z]{8}$/;
/** `QA AUTO <runId de 8 [0-9A-Z]>` seguido de espacio o fin: 6 caracteres de segundos epoch en base 36. */
const NAME_PARSE_PATTERN = /^QA AUTO ([0-9A-Z]{6})[0-9A-Z]{2}(?: |$)/;

export type WaypointDto = {
  id: number;
  name: string;
  reference: string | null;
  latitude: number;
  longitude: number;
  placeId: string;
  creationDate: string;
  updatedDate: string | null;
};
export type WaypointInput = {
  name: string;
  reference?: string | null;
  latitude: number;
  longitude: number;
};
export type WaypointWriteResult = { waypoint: WaypointDto; warnings: string[] };
export type WaypointUsage = {
  recurringTripIds: number[];
  frequentDestinations: number[];
  passengerAddressIds: number[];
  passengerFrequentDestinationIds: number[];
  scheduledTravelIds: number[];
  warning: string | null;
};

/** Nombre propio del run: `QA AUTO <runId> <etiqueta>`, <= 50 caracteres. */
export function waypointName(runId: string, label: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`[waypoints] runId invalido «${runId}» (8 caracteres [0-9A-Z])`);
  }
  const name = `${WAYPOINT_NAME_PREFIX}${runId} ${label}`;
  if (name.length > WAYPOINT_NAME_MAX_LENGTH) {
    throw new Error(
      `[waypoints] el nombre «${name}» supera ${WAYPOINT_NAME_MAX_LENGTH} caracteres`
    );
  }
  return name;
}

/** Instante (ms epoch) codificado en el runId del nombre, o null si el nombre no es de la automatizacion. */
export function parseWaypointNameTimestamp(name: string): number | null {
  const match = NAME_PARSE_PATTERN.exec(name);
  return match ? parseInt(match[1], 36) * 1000 : null;
}

/** Candidato a sweep: nombre con el formato propio y mas viejo que `olderThanMs`. */
export function isWaypointSweepCandidate(name: string, now: number, olderThanMs: number): boolean {
  const createdAt = parseWaypointNameTimestamp(name);
  // Ventana plausible: un «QA AUTO PRUEBA01» humano decodifica a una fecha absurda y no se toca.
  return (
    createdAt !== null &&
    createdAt >= SWEEP_MIN_DATE_MS &&
    createdAt <= now &&
    now - createdAt > olderThanMs
  );
}

/** true si el punto lo referencia algun viaje, destino frecuente o direccion. */
export function hasUsage(usage: WaypointUsage): boolean {
  return (
    usage.recurringTripIds.length +
      usage.frequentDestinations.length +
      usage.passengerAddressIds.length +
      usage.passengerFrequentDestinationIds.length +
      usage.scheduledTravelIds.length >
    0
  );
}

export class WaypointsClient {
  /** id -> nombre registrado de los puntos creados por esta instancia. */
  readonly #own = new Map<number, string>();
  readonly #runPrefix: string;

  constructor(
    private readonly api: APIRequestContext,
    private readonly session: CarrierSession,
    runId: string
  ) {
    if (!RUN_ID_PATTERN.test(runId)) {
      throw new Error(`[waypoints] runId invalido «${runId}» (8 caracteres [0-9A-Z])`);
    }
    this.#runPrefix = `${WAYPOINT_NAME_PREFIX}${runId}`;
  }

  private path(suffix = ''): string {
    return `carriers/${this.session.carrierId}/waypoint${suffix}`;
  }

  /** Ids creados por esta instancia y aun no borrados. */
  get ownIds(): number[] {
    return [...this.#own.keys()];
  }

  /** El prefijo del run se exige sobre el nombre sin espacios de los extremos (el backend los recorta, TM-1817). */
  private assertRunName(rawName: string): void {
    const name = rawName.trim();
    if (!(name === this.#runPrefix || name.startsWith(`${this.#runPrefix} `))) {
      throw new Error(
        `[waypoints] el nombre «${name}» no empieza con «${this.#runPrefix}»: no se toca`
      );
    }
  }

  private assertOwnId(id: number): void {
    if (!this.#own.has(id)) {
      throw new Error(`[waypoints] el id ${id} no fue creado por esta corrida: no se toca`);
    }
  }

  async list(): Promise<WaypointDto[]> {
    const response = await sendGetOk('waypoint/list', () => this.api.get(this.path()));
    const body = await readJson<unknown>(response);
    if (!Array.isArray(body)) throw new Error('[waypoints] list no devolvio un array');
    return body as WaypointDto[];
  }

  async create(input: WaypointInput): Promise<WaypointWriteResult> {
    this.assertRunName(input.name);
    const response = await sendOk('waypoint/create', () =>
      this.api.post(this.path(), { data: { reference: null, ...input } })
    );
    const body = await readJson<WaypointWriteResult>(response);
    if (!body?.waypoint || typeof body.waypoint.id !== 'number') {
      throw new Error('[waypoints] create respondio OK sin waypoint.id');
    }
    // Se registra el nombre que devolvio el servidor (recortado): es el que valida remove() contra la lista.
    this.#own.set(body.waypoint.id, body.waypoint.name ?? input.name);
    return { waypoint: body.waypoint, warnings: body.warnings ?? [] };
  }

  async update(id: number, input: WaypointInput): Promise<WaypointWriteResult> {
    this.assertOwnId(id);
    this.assertRunName(input.name);
    const response = await sendOk('waypoint/update', () =>
      this.api.put(this.path(`/${id}`), { data: { reference: null, ...input } })
    );
    const body = await readJson<WaypointWriteResult>(response);
    if (!body?.waypoint) throw new Error('[waypoints] update respondio OK sin waypoint');
    // El renombre cambia el nombre registrado: la verificacion previa al DELETE usa el vigente.
    this.#own.set(id, body.waypoint.name ?? input.name);
    return { waypoint: body.waypoint, warnings: body.warnings ?? [] };
  }

  async usage(id: number): Promise<WaypointUsage> {
    const response = await sendGetOk('waypoint/usage', () =>
      this.api.get(this.path(`/${id}/usage`))
    );
    const body = await readJson<WaypointUsage>(response);
    if (!body) throw new Error('[waypoints] usage respondio sin cuerpo');
    return body;
  }

  /**
   * Da de baja un punto propio. Relee la lista y exige que el id siga con el nombre registrado y el
   * prefijo del run; si ya no esta (baja previa) devuelve null sin llamar al DELETE.
   */
  async remove(id: number): Promise<WaypointUsage | null> {
    this.assertOwnId(id);
    const registered = this.#own.get(id) as string;
    const current = (await this.list()).find((w) => w.id === id);
    if (!current) {
      this.#own.delete(id);
      return null;
    }
    if (current.name !== registered) {
      throw new Error(
        `[waypoints] el id ${id} ya no tiene el nombre registrado (hoy «${current.name}»): no se borra`
      );
    }
    this.assertRunName(current.name);
    const usage = await this.#delete(id);
    this.#own.delete(id);
    return usage;
  }

  async #delete(id: number): Promise<WaypointUsage> {
    const response = await sendOk('waypoint/remove', () => this.api.delete(this.path(`/${id}`)));
    return (await readJson<WaypointUsage>(response)) as WaypointUsage;
  }

  /**
   * Request crudo para negativos (4xx/404) sin lanzar. Devuelve status y cuerpo redactado; el token
   * nunca sale en el resultado. Solo rutas bajo `carriers/{carrierId}/waypoint`.
   */
  async attempt(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown
  ): Promise<{ status: number; body: unknown }> {
    if (!path.startsWith(this.path())) {
      throw new Error('[waypoints] attempt solo admite rutas de waypoint del carrier de la sesion');
    }
    const options = data === undefined ? {} : { data };
    const response =
      method === 'POST'
        ? await this.api.post(path, options)
        : method === 'PUT'
          ? await this.api.put(path, options)
          : await this.api.delete(path, options);
    const text = redactApiText(await response.text().catch(() => ''));
    let body: unknown = text;
    try {
      body = text.trim() ? JSON.parse(text) : null;
    } catch {
      // cuerpo no JSON: se devuelve el texto redactado
    }
    return { status: response.status(), body };
  }

  /** Borra los puntos propios en orden inverso; tolera bajas previas. Falla nombrando los ids que no pudo. */
  async cleanup(): Promise<void> {
    const failed: string[] = [];
    for (const id of [...this.#own.keys()].reverse()) {
      try {
        await this.remove(id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`${id}: ${redactApiText(message).slice(0, 160)}`);
      }
    }
    if (failed.length > 0) {
      throw new Error(`[waypoints] limpieza incompleta, ids con falla -> ${failed.join(' | ')}`);
    }
  }

  /**
   * Borra puntos con el formato de la automatizacion y mas de `olderThanMs` (default 24 h), leyendo la
   * edad del runId del nombre. Nunca toca nombres sin el formato `QA AUTO <runId>`.
   */
  async sweep(olderThanMs: number = DAY_MS, now: number = Date.now()): Promise<number[]> {
    const stale = (await this.list()).filter((w) =>
      isWaypointSweepCandidate(w.name, now, olderThanMs)
    );
    const removed: number[] = [];
    for (const waypoint of stale) {
      // Relectura inmediata: el id debe seguir con el mismo nombre antes del DELETE.
      const again = (await this.list()).find((w) => w.id === waypoint.id);
      if (!again || again.name !== waypoint.name) continue;
      // Un punto en uso (viajes programados, destinos frecuentes…) nunca se barre.
      const usage = await this.usage(waypoint.id);
      if (hasUsage(usage)) {
        console.warn(`[waypoints] sweep: se salta el id ${waypoint.id} porque esta en uso`);
        continue;
      }
      await this.#delete(waypoint.id);
      removed.push(waypoint.id);
    }
    return removed;
  }
}
