/**
 * ActiveTripPBO — pre-chequeo de SOLO LECTURA: ¿la app muestra que el pasajero tiene un viaje activo? Compone
 * `screens/passenger/ActiveTripScreen`; NO tiene locators, NO toca ningún control (ni «Cancelar Viaje») y NO lee
 * `process.env`. La señal es la pantalla del viaje en curso a la que la app redirige al entrar al home
 * (`DriverAvailablePages` / `travel-in-progress`, ver `ActiveTripScreen`). Validación en vivo pendiente.
 */

import type { MobileSession } from '../core/MobileSession.js';
import { tryUntil } from '../core/Waits.js';
import {
  ActiveTripScreen,
  classifyActiveTrip,
  type ActiveTripKind
} from '../screens/passenger/ActiveTripScreen.js';

export type { ActiveTripKind } from '../screens/passenger/ActiveTripScreen.js';

export type ActiveTripObservation = {
  /** `true` solo si la app mostró la pantalla de viaje activo en lecturas consecutivas. */
  active: boolean;
  kind: ActiveTripKind | null;
  url: string;
};

export type ActiveTripPboDeps = { screen: Pick<ActiveTripScreen, 'readSnapshot'> };

export class ActiveTripPBO {
  private readonly pollIntervalMs: number;

  constructor(
    private readonly deps: ActiveTripPboDeps,
    options: { pollIntervalMs?: number } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  static forSession(session: MobileSession): ActiveTripPBO {
    return new ActiveTripPBO({ screen: new ActiveTripScreen(session) });
  }

  /** Una lectura puntual (sin esperar). */
  async readOnce(): Promise<ActiveTripObservation> {
    const snap = await this.deps.screen.readSnapshot();
    const kind = classifyActiveTrip(snap.url, snap.text);
    return { active: kind !== null, kind, url: snap.url };
  }

  /**
   * Espera hasta `timeoutMs` a que la app muestre un viaje activo, exigiendo `stableReads` lecturas seguidas del
   * mismo tipo (el home puede verse un instante antes de que la app redirija). Si no lo ve, `active: false` con la
   * última URL leída.
   */
  async observeActiveTrip(
    options: { timeoutMs?: number; stableReads?: number } = {}
  ): Promise<ActiveTripObservation> {
    const stableReads = Math.max(1, options.stableReads ?? 2);
    let last: ActiveTripObservation = { active: false, kind: null, url: '' };
    let streak = 0;
    const hit = await tryUntil(
      async () => {
        const now = await this.readOnce().catch(
          (): ActiveTripObservation => ({ active: false, kind: null, url: last.url })
        );
        streak = now.active && now.kind === last.kind ? streak + 1 : now.active ? 1 : 0;
        last = now;
        return streak >= stableReads ? now : null;
      },
      {
        timeout: options.timeoutMs ?? 20_000,
        interval: this.pollIntervalMs,
        label: 'pantalla de viaje activo'
      }
    );
    return hit ? hit : { ...last, active: false };
  }
}
