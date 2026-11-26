// tests/helpers/waypoint-ui-cleanup.ts
// Limpieza de puntos creados DESDE LA UI (el cliente `WaypointsClient` solo borra los que creo por API).
// Reglas del incidente 18/11 (carrier 1040): se borra solo por id leido de la lista, con nombre EXACTO
// registrado por el test y prefijo `QA AUTO <runId>`; nada por posicion ni por nombre global.
import type { WaypointsClient } from '../api/clients/waypoints.client.js';

export class UiCreatedWaypoints {
  readonly #names = new Set<string>();

  constructor(
    private readonly api: WaypointsClient,
    private readonly carrierId: number,
    private readonly runId: string
  ) {}

  /** Registra el nombre exacto de un punto que la UI va a crear. */
  track(name: string): string {
    const prefix = `QA AUTO ${this.runId}`;
    if (!(name === prefix || name.startsWith(`${prefix} `))) {
      throw new Error(
        `[waypoints] «${name}» no empieza con «${prefix}»: no se registra para limpieza`
      );
    }
    this.#names.add(name);
    return name;
  }

  /** Ids vigentes de los nombres registrados. */
  async idsNow(): Promise<number[]> {
    const list = await this.api.list();
    return list.filter((w) => this.#names.has(w.name)).map((w) => w.id);
  }

  /** Da de baja los registrados que sigan vivos; falla nombrando los ids que no pudo borrar. */
  async cleanup(): Promise<void> {
    const failed: string[] = [];
    for (const id of await this.idsNow()) {
      const result = await this.api.attempt('DELETE', `carriers/${this.carrierId}/waypoint/${id}`);
      if (result.status !== 200) failed.push(`${id}: HTTP ${result.status}`);
    }
    this.#names.clear();
    if (failed.length > 0) {
      throw new Error(`[waypoints] limpieza de puntos de UI incompleta -> ${failed.join(' | ')}`);
    }
  }
}
