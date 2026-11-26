// tests/channels/ApiDriverChannel.ts
// Canal chofer por API: reproduce lo que hace la app driver v2 contra el backend, sin dispositivo.
// Endpoints y cuerpos en DriverTravelsClient (fuente: TravelController.java y magiis-mobile-driver-v2).
// No ejerce la UI de la app ni el recálculo por km GPS: para eso está AppDriverChannel (fase 2).
import type { DriverTravelsClient } from '../api/clients/driverTravels.client.js';
import {
  driverIdleVerdict,
  type DriverChannel,
  type TripClosure,
  type TripToClose
} from './DriverChannel.js';

/** Subconjunto de DriverTravelsClient que usa el canal (permite un doble en los unit tests). */
export type DriverTravelsPort = Pick<
  DriverTravelsClient,
  'getStatus' | 'confirm' | 'goingToDestination' | 'arriveToDestination' | 'finalize'
>;

export class ApiDriverChannel implements DriverChannel {
  readonly kind = 'api' as const;

  constructor(
    private readonly driverTravels: DriverTravelsPort,
    /** Estado del viaje (`detail.state`) leído con la sesión del CARRIER: el chofer no ve viajes ajenos. */
    private readonly readTripState: (travelId: number) => Promise<string>
  ) {}

  async ensureIdle(driverId: number): Promise<void> {
    const status = await this.driverTravels.getStatus(driverId);
    const incomingState =
      status.incomingTripId === null
        ? null
        : await this.readTripState(status.incomingTripId).catch(() => null);
    const verdict = driverIdleVerdict(status, incomingState);
    if (verdict.idle === false) {
      throw new Error(`[ApiDriverChannel] BLOCKED: el chofer ${driverId} ${verdict.reason}`);
    }
    if (verdict.idle === 'unknown') console.info(`[ApiDriverChannel] ${verdict.reason}`);
  }

  async completeTrip(trip: TripToClose): Promise<TripClosure> {
    const { travelId, driverId, finalize } = trip;
    const checkpoints: string[] = [];
    await this.driverTravels.confirm(travelId, driverId);
    checkpoints.push('confirm');
    await this.driverTravels.goingToDestination({ travelId });
    checkpoints.push('goingToDestination');
    await this.driverTravels.arriveToDestination({ travelId });
    checkpoints.push('arriveToDestination');
    await this.driverTravels.finalize({ travelId, payload: finalize });
    checkpoints.push('finalize');
    return { channel: this.kind, travelId, checkpoints, closedAt: new Date().toISOString() };
  }
}
