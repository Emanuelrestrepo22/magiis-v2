// tests/api/clients/vehicleOwners.client.ts
// Cliente de SOLO LECTURA de la ficha del propietario (F5 W3, rendicion automatica). No existe ningun metodo de escritura:
// armar/desarmar (`PUT vehicleOwners/{id}`) y disparar (`PUT vehicles/{v}/carrier/{c}/travelsSurrender`) se hacen por UI en
// `OwnerEditPage`, con firewall de red; este cliente solo verifica el resultado por GET.
//
// Contrato (magiis-be VehicleOwnerController, clase `/carriers/{carrierUserId}/vehicleOwners`):
//   GET {ownerId}  ficha del propietario; `cashCollector` (boolean: true = «Vehicle Owner», false = «Company»; el mismo campo que
//   el FE reenvia en el PUT). La lista de vehiculos de la ficha se busca en un arreglo cuyo nombre contenga «vehicle» (la forma
//   exacta NO esta confirmada: si no se encuentra, `vehicleIds` queda null y la guarda de armado falla CERRADA).
import type { APIRequestContext } from '@playwright/test';
import type { OwnerFichaReading } from '../../helpers/f5-auto-guards.js';
import { readJson, sendGetOk, type CarrierSession } from './carrierSession.js';

export type OwnerFicha = {
  reading: OwnerFichaReading;
  /** Cuerpo crudo: SOLO para `diffFicha` en memoria (trae datos del propietario: PII, no adjuntar ni loguear). */
  body: Record<string, unknown>;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ids de los vehiculos de la ficha: primer arreglo de objetos bajo una clave «vehicle» (nivel 1 o 2). null si no hay. */
export function extractVehicleIds(body: Record<string, unknown>): number[] | null {
  const fromArray = (arr: unknown[]): number[] | null => {
    const ids = arr.map((el) => {
      if (typeof el === 'number') return el;
      if (!isRecord(el)) return Number.NaN;
      const raw = el.vehicleId ?? el.id;
      return typeof raw === 'number' ? raw : Number.NaN;
    });
    return ids.every((n) => Number.isInteger(n) && n > 0) ? ids : null;
  };
  const scan = (obj: Record<string, unknown>): number[] | null => {
    for (const [key, value] of Object.entries(obj)) {
      if (/vehicle/i.test(key) && Array.isArray(value)) {
        const ids = fromArray(value);
        if (ids !== null) return ids;
      }
    }
    return null;
  };
  const top = scan(body);
  if (top !== null) return top;
  for (const value of Object.values(body)) {
    if (isRecord(value)) {
      const nested = scan(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}

export class VehicleOwnersClient {
  constructor(
    private readonly api: APIRequestContext,
    private readonly session: CarrierSession
  ) {}

  /** GET de la ficha. Lanza si el id es invalido o el cuerpo no es un objeto. */
  async read(ownerId: number): Promise<OwnerFicha> {
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      throw new Error(`[vehicleOwners] ownerId invalido: ${ownerId}`);
    }
    const response = await sendGetOk('vehicleOwners/{id}', () =>
      this.api.get(`carriers/${this.session.carrierId}/vehicleOwners/${ownerId}`)
    );
    const body = await readJson<Record<string, unknown>>(response);
    if (!isRecord(body)) throw new Error('[vehicleOwners] la ficha del propietario vino vacia');
    const flag = body.cashCollector;
    return {
      reading: {
        ownerId,
        cashCollector:
          typeof flag === 'boolean' ? flag : flag === 1 ? true : flag === 0 ? false : null,
        vehicleIds: extractVehicleIds(body)
      },
      body
    };
  }
}
