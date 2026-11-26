/**
 * OfferPBO — oferta del viaje asignado en la app Chofer: identificar la oferta en pantalla (SIN tocarla),
 * aceptarla e iniciar el viaje. Compone `TripConfirmScreen` y `TripToStartScreen`; NO tiene locators ni
 * lee el entorno del proceso.
 *
 * Gate de irreversibilidad EXPLÍCITO (V1 no lo tenía: `acceptAssignedTrip`/`startTrip` eran invocables
 * sin confirmación y el único guard vivía en `F5AppCloseFlow`):
 * - `acceptAssignedTrip` y `startTrip` exigen `{ confirmed: true }`; sin él lanzan
 *   `IrreversibleNotConfirmedError` ANTES de tocar la pantalla (cero efectos en el viaje).
 * - `peekOffer` y `assertOfferMatches` son de solo lectura y no requieren confirmación.
 *
 * Aceptar la oferta compromete un viaje real en TEST: no hay deshacer ni reintento.
 */

import type { I18n } from '../core/I18n.js';
import type { MobileSession } from '../core/MobileSession.js';
import { TripConfirmScreen } from '../screens/driver/TripConfirmScreen.js';
import { TripToStartScreen } from '../screens/driver/TripToStartScreen.js';

/** Token de confirmación explícita del llamador para acciones irreversibles. */
export type IrreversibleOptions = { confirmed: boolean };

export class IrreversibleNotConfirmedError extends Error {
  constructor(action: string) {
    super(`[Irreversible] ${action} es irreversible: pasar { confirmed: true } explícito.`);
    this.name = 'IrreversibleNotConfirmedError';
  }
}

export class OfferMismatchError extends Error {
  constructor(expected: number, seen: string | null) {
    super(
      `La oferta en pantalla es del viaje ${seen ?? 'n/d'}, no del esperado ${expected}; no se acepta nada.`
    );
    this.name = 'OfferMismatchError';
  }
}

/** Gate común: estricto (`=== true`) para que un llamador JS con un valor «truthy» tampoco pase. */
export function assertConfirmed(options: IrreversibleOptions | undefined, action: string): void {
  if (options?.confirmed !== true) throw new IrreversibleNotConfirmedError(action);
}

export type OfferExpectation = {
  /** Viaje que DEBE ser el de la oferta; `null` = no se exige. */
  travelId: number | null;
  /** Código visible (`<n>-<canal>`): la oferta no siempre expone el id en la URL. */
  travelCode?: string;
};

export type OfferMatch = {
  travelId: string | null;
  matchedBy: 'travelId' | 'travelCode' | 'not-required';
};

export type OfferPboDeps = {
  confirm: Pick<
    TripConfirmScreen,
    'waitUntilShown' | 'readTravelId' | 'readVisibleText' | 'acceptOffer' | 'waitUntilLeft'
  >;
  toStart: Pick<
    TripToStartScreen,
    'waitUntilShown' | 'tapStartTrip' | 'waitForConfirmModal' | 'confirmStart' | 'waitUntilLeft'
  >;
};

export type OfferPboRuntime = { log: (message: string) => void };

export class OfferPBO {
  private readonly log: (message: string) => void;

  constructor(
    private readonly deps: OfferPboDeps,
    out: Partial<OfferPboRuntime> = {}
  ) {
    this.log = out.log ?? ((m) => console.info(m));
  }

  static forSession(session: MobileSession, i18n: I18n, out?: Partial<OfferPboRuntime>): OfferPBO {
    return new OfferPBO(
      {
        confirm: new TripConfirmScreen(session, i18n.locale, i18n),
        toStart: new TripToStartScreen(session, i18n.locale, i18n)
      },
      out
    );
  }

  /** Lee el `travelId` de la oferta mostrada SIN aceptarla (reversible). */
  async peekOffer(): Promise<{ travelId: string | null }> {
    await this.deps.confirm.waitUntilShown();
    return { travelId: await this.deps.confirm.readTravelId() };
  }

  /**
   * Guard previo al irreversible (reversible): la oferta en pantalla debe ser la del viaje esperado, por
   * id de la URL o, si la URL no trae id, por el código visible. Si no coincide lanza `OfferMismatchError`.
   */
  async assertOfferMatches(expected: OfferExpectation): Promise<OfferMatch> {
    const { travelId: seen } = await this.peekOffer();
    if (expected.travelId === null) return { travelId: seen, matchedBy: 'not-required' };
    if (seen === String(expected.travelId)) return { travelId: seen, matchedBy: 'travelId' };
    const codeMatches =
      seen === null &&
      Boolean(expected.travelCode) &&
      (await this.deps.confirm.readVisibleText()).includes(expected.travelCode as string);
    if (!codeMatches) throw new OfferMismatchError(expected.travelId, seen);
    this.log(`[OfferPBO] oferta identificada por código visible «${expected.travelCode}».`);
    return { travelId: seen, matchedBy: 'travelCode' };
  }

  /** Acepta la oferta del viaje asignado (IRREVERSIBLE). Devuelve el `travelId` de la URL (null si no vino). */
  async acceptAssignedTrip(options: IrreversibleOptions): Promise<{ travelId: string | null }> {
    assertConfirmed(options, 'Aceptar la oferta del viaje');
    await this.deps.confirm.waitUntilShown();
    const travelId = await this.deps.confirm.readTravelId();
    await this.deps.confirm.acceptOffer();
    await this.deps.confirm.waitUntilLeft();
    this.log(`[OfferPBO] Oferta aceptada (travelId=${travelId ?? 'n/d'}).`);
    return { travelId };
  }

  /** «Empezar Viaje» + «Sí» (IRREVERSIBLE); espera a que la pantalla se vaya (viaje en curso). */
  async startTrip(options: IrreversibleOptions): Promise<void> {
    assertConfirmed(options, 'Iniciar el viaje');
    await this.deps.toStart.waitUntilShown();
    await this.deps.toStart.tapStartTrip();
    await this.deps.toStart.waitForConfirmModal();
    await this.deps.toStart.confirmStart();
    await this.deps.toStart.waitUntilLeft();
    this.log('[OfferPBO] Viaje iniciado.');
  }
}
