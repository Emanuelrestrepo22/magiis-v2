/**
 * TripLifecyclePBO — ciclo de vida del viaje del chofer: aceptar oferta -> iniciar -> finalizar ->
 * leer resumen -> cerrar (con firma si el botón es «Firmar y Cerrar viaje»). Compone las screens de
 * `screens/driver/*`, `OfferPBO` (oferta/inicio) y `SignaturePBO`; NO tiene locators.
 *
 * Irreversibles: aceptar, iniciar, finalizar y cerrar afectan un viaje real (no hay reintento). TODOS
 * exigen `confirmed: true` explícito del llamador (V1 dejaba sin gate aceptar/iniciar). El gate de
 * ambiente/handoff vive en `F5CloseTripPlan`.
 *
 * TODO (sin confirmar contra dump): orden exacto tras `tapClose`. El código legado documenta «Firmar y
 * Cerrar» -> modal de firma y «requiere un segundo tap post-firma». Acá, tras `tapClose`: si el cierre
 * requiere firma -> firma; luego, si aparece un `app-confirm-modal`, se confirma (ventana corta). El
 * «segundo tap» post-firma NO está modelado hasta verificarlo en device.
 */

import type { I18n } from '../core/I18n.js';
import type { MobileSession } from '../core/MobileSession.js';
import { tryUntil } from '../core/Waits.js';
import { ConfirmModal } from '../screens/driver/ConfirmModal.js';
import { TripInProgressScreen } from '../screens/driver/TripInProgressScreen.js';
import { TripResumeScreen } from '../screens/driver/TripResumeScreen.js';
import {
  assertConfirmed,
  IrreversibleNotConfirmedError,
  OfferPBO,
  type IrreversibleOptions
} from './OfferPBO.js';
import { SignaturePBO } from './SignaturePBO.js';

// Se re-exportan para conservar la superficie de V1 (`TripLifecyclePBO` los exportaba).
export { IrreversibleNotConfirmedError };
export type { IrreversibleOptions };

export type TripSummary = { total: number | null; totalText: string; paymentMethod: string };
export type CloseResult = {
  closedTotal: number | null;
  paymentMethod: string;
  signed: boolean;
  closeLabel: string;
};

export type TripLifecycleDeps = {
  /** Oferta/inicio del viaje (con su propio gate de irreversibilidad). */
  offer: Pick<OfferPBO, 'acceptAssignedTrip' | 'startTrip'>;
  inProgress: Pick<
    TripInProgressScreen,
    'waitUntilShown' | 'tapEndTrip' | 'waitForConfirmModal' | 'confirmEnd' | 'waitUntilLeft'
  >;
  resume: Pick<
    TripResumeScreen,
    | 'waitUntilShown'
    | 'readTotal'
    | 'readTotalText'
    | 'readPaymentMethod'
    | 'closeRequiresSignature'
    | 'tapClose'
  >;
  modal: Pick<ConfirmModal, 'isShown' | 'confirm' | 'waitUntilClosed'>;
  signature: Pick<SignaturePBO, 'signAndConfirm'>;
};

export type TripLifecycleRuntime = {
  log: (message: string) => void;
  /** Ventana para detectar el modal opcional post-cierre (default 3 s). */
  closeModalDetectMs?: number;
};

export class TripLifecyclePBO {
  private readonly log: (message: string) => void;
  private readonly closeModalDetectMs: number;

  constructor(
    private readonly deps: TripLifecycleDeps,
    out: Partial<TripLifecycleRuntime> = {}
  ) {
    this.log = out.log ?? ((m) => console.info(m));
    this.closeModalDetectMs = out.closeModalDetectMs ?? 3_000;
  }

  static forSession(
    session: MobileSession,
    i18n: I18n,
    out?: Partial<TripLifecycleRuntime>
  ): TripLifecyclePBO {
    return new TripLifecyclePBO(
      {
        offer: OfferPBO.forSession(session, i18n, out),
        inProgress: new TripInProgressScreen(session, i18n.locale, i18n),
        resume: new TripResumeScreen(session, i18n),
        modal: new ConfirmModal(session, i18n),
        signature: SignaturePBO.forSession(session, out)
      },
      out
    );
  }

  /** Acepta la oferta del viaje asignado (IRREVERSIBLE). Devuelve el `travelId` de la URL (null si no vino). */
  async acceptAssignedTrip(options: IrreversibleOptions): Promise<{ travelId: string | null }> {
    assertConfirmed(options, 'Aceptar la oferta del viaje');
    return this.deps.offer.acceptAssignedTrip(options);
  }

  /** «Empezar Viaje» + «Sí» (IRREVERSIBLE); espera a que la pantalla se vaya (viaje en curso). */
  async startTrip(options: IrreversibleOptions): Promise<void> {
    assertConfirmed(options, 'Iniciar el viaje');
    await this.deps.offer.startTrip(options);
  }

  /** «Finalizar Viaje» + «Sí» (IRREVERSIBLE) y llega al resumen. */
  async finishTrip(options: IrreversibleOptions): Promise<TripSummary> {
    assertConfirmed(options, 'Finalizar el viaje');
    await this.deps.inProgress.waitUntilShown();
    await this.deps.inProgress.tapEndTrip();
    await this.deps.inProgress.waitForConfirmModal();
    await this.deps.inProgress.confirmEnd();
    await this.deps.inProgress.waitUntilLeft();
    this.log('[TripLifecyclePBO] Viaje finalizado; resumen visible.');
    return this.readSummary();
  }

  /** Lee total y medio de pago del resumen (sin tocar nada). */
  async readSummary(): Promise<TripSummary> {
    await this.deps.resume.waitUntilShown();
    return {
      total: await this.deps.resume.readTotal(),
      totalText: await this.deps.resume.readTotalText(),
      paymentMethod: await this.deps.resume.readPaymentMethod()
    };
  }

  /** Cierra el viaje desde el resumen (IRREVERSIBLE); con firma si el botón es «Firmar y Cerrar viaje». */
  async closeTrip(options: IrreversibleOptions): Promise<CloseResult> {
    assertConfirmed(options, 'Cerrar el viaje');
    const summary = await this.readSummary();
    const requiresSignature = await this.deps.resume.closeRequiresSignature();
    const closeLabel = await this.deps.resume.tapClose();
    if (requiresSignature) await this.deps.signature.signAndConfirm();
    const modalShown = await tryUntil(() => this.deps.modal.isShown(), {
      timeout: this.closeModalDetectMs,
      label: 'modal post-cierre'
    });
    if (modalShown) {
      await this.deps.modal.confirm();
      await this.deps.modal.waitUntilClosed();
    }
    this.log(
      `[TripLifecyclePBO] Viaje cerrado (firma=${requiresSignature}, medio=${summary.paymentMethod || 'n/d'}).`
    );
    return {
      closedTotal: summary.total,
      paymentMethod: summary.paymentMethod,
      signed: requiresSignature,
      closeLabel
    };
  }
}
