// tests/helpers/trip-cleanup.ts
// Limpieza de viajes creados por specs de UI: cancela por API (TravelsClient.cancel, body completo
// de CancelTravelRequestDTO; con `{}` el backend responde 400). Nunca lanza: un fallo se informa
// con status + cuerpo (ya redactados por sendOk) para no enmascarar el veredicto del test.
//
// Independiente del setup de los fixtures de API (carrierApi hace probe de sesion y exige >=20 min
// de vigencia): si el test no creo viaje, no se toca la sesion; si lo creo, el cliente se arma aca,
// de forma perezosa, solo con la sesion guardada. Si la cancelacion no puede correr, el viaje queda
// en el registro de viajes abiertos y lo barre `recoverLeakedTrips` en la proxima corrida.
import type { PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import { loadCarrierSession } from '../api/clients/carrierSession.js';
import { TravelsClient } from '../api/clients/travels.client.js';
import { getCurrentEnv } from '../config/runtime.js';
import { ledgerRemove, recordLeakedTrip, recoverLeakedTrips } from './trip-ledger.js';

/** Registro propio de los specs MG-682 (no se mezcla con el de Otros Costos). */
export const MG682_LEDGER_SCOPE = 'mg682';

/** Anota el viaje apenas se captura su id: si el proceso muere antes del afterEach queda rastro. */
export function recordCreatedTrip(travelId: number, logTag: string, testInfo: TestInfo): void {
  recordLeakedTrip(getCurrentEnv(), travelId, `${logTag}-${testInfo.testId}`, MG682_LEDGER_SCOPE);
}

type CancelCreatedTripArgs = {
  playwright: PlaywrightWorkerArgs['playwright'];
  travelId: number | undefined;
  testInfo: TestInfo;
  logTag: string;
};

/** Cancela `travelId` si existe; deja el resultado en consola y como anotacion del test. */
export async function cancelCreatedTrip({
  playwright,
  travelId,
  testInfo,
  logTag
}: CancelCreatedTripArgs): Promise<void> {
  if (travelId === undefined) return;
  let result: string;
  try {
    const session = loadCarrierSession();
    const api = await session.newApiContext(playwright.request);
    try {
      await new TravelsClient(api, session).cancel(travelId);
    } finally {
      await api.dispose();
    }
    ledgerRemove(getCurrentEnv(), travelId, MG682_LEDGER_SCOPE);
    result = `viaje ${travelId} cancelado por API`;
  } catch (error) {
    result = `FALLO al cancelar viaje ${travelId} (cancelar a mano): ${(error as Error).message}`;
    try {
      recordCreatedTrip(travelId, logTag, testInfo);
      result += '; anotado en el registro de viajes abiertos para el barrido de la proxima corrida';
    } catch (ledgerError) {
      result += `; tampoco se pudo anotar en el registro: ${(ledgerError as Error).message}`;
    }
  }
  // eslint-disable-next-line no-console -- resultado de limpieza visible en el log de la corrida
  console.log(`[${logTag}] ${result}`);
  testInfo.annotations.push({ type: 'cleanup', description: result });
}

/** beforeAll de los specs MG-682: cancela solo los viajes anotados en este registro (scope + ambiente activo). */
export async function sweepMg682Trips(travelsApi: TravelsClient): Promise<void> {
  const trips = await recoverLeakedTrips(travelsApi, getCurrentEnv(), MG682_LEDGER_SCOPE);
  if (trips.cancelled.length > 0 || trips.failed.length > 0) {
    console.warn(
      `[MG-682] barrido de viajes previos: cancelados=[${trips.cancelled.join(',')}]; sin poder cancelar (quedan anotados)=[${trips.failed.join(' | ')}]`
    );
  }
}
