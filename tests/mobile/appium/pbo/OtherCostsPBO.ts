/**
 * OtherCostsPBO — el chofer agrega un «Otro costo» desde el Resumen del viaje y verifica lo que ve la app
 * (TM-1099, Universal F1). Compone `OtherCostsModalScreen` + `OtherCostsSummaryScreen`; NO tiene locators
 * ni lee el entorno del proceso. El cierre del viaje (irreversible, con firma) es `TripLifecyclePBO.closeTrip`.
 *
 * Gate: `addConcept` guarda un costo en un viaje real; exige `{ confirmed: true }` como las demás acciones
 * del ciclo del viaje (lanza `IrreversibleNotConfirmedError` antes de tocar la pantalla).
 *
 * Piezas puras (sin dispositivo, con unit): `parseShownMoney`, `isAdditiveTotal`, `buildOtherCostsComment`.
 */

import type { MobileSession } from '../core/MobileSession.js';
import { assertConfirmed, type IrreversibleOptions } from './OfferPBO.js';
import {
  OtherCostsModalScreen,
  type OtherCostFormState
} from '../screens/driver/otherCosts/OtherCostsModalScreen.js';
import {
  OtherCostsSummaryScreen,
  type DriverPaymentMethodCode,
  type TripSummaryValues
} from '../screens/driver/otherCosts/OtherCostsSummaryScreen.js';

export class ConceptNotOfferedError extends Error {
  constructor(
    readonly concept: string,
    readonly offered: string[]
  ) {
    super(
      `[OtherCostsPBO] el concepto «${concept}» no se ofrece al chofer; ofrecidos: ${offered.length ? offered.join(' | ') : '(ninguno)'}.`
    );
    this.name = 'ConceptNotOfferedError';
  }
}

export class OtherCostSaveDisabledError extends Error {
  constructor(readonly form: OtherCostFormState) {
    super(
      `[OtherCostsPBO] «Guardar» quedó deshabilitado tras elegir «${form.selectedConcept}» (importe «${form.amount}»); no se guarda nada.`
    );
    this.name = 'OtherCostSaveDisabledError';
  }
}

/**
 * Importe numérico de un texto visible. Con símbolo `$` manda el importe que sigue al `$` (un ítem trae el
 * nombre del concepto delante y «E2E» tiene un dígito); sin símbolo (el input del modal) vale el texto
 * completo. `'AGREED'` u otro texto -> null. Coma o punto decimal.
 */
export function parseShownMoney(text: string | null | undefined): number | null {
  const compact = (text ?? '').replace(/\s/g, '');
  const match = compact.includes('$')
    ? /\$(-?\d+(?:[.,]\d+)?)/.exec(compact)
    : /^(-?\d+(?:[.,]\d+)?)$/.exec(compact);
  return match ? Number(match[1]!.replace(',', '.')) : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Con cuenta corriente el total es aditivo: `amount = tarifa + otros costos` (a 2 decimales). */
export function isAdditiveTotal(
  tourPrice: number | null | undefined,
  otherCost: number | null | undefined,
  amount: number | null | undefined
): boolean {
  if (![tourPrice, otherCost, amount].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return false;
  }
  return round2(amount as number) === round2((tourPrice as number) + (otherCost as number));
}

export type OtherCostsMeasurement = {
  env: string;
  appPackage: string | null;
  udid: string | null;
  runId: string;
  concept?: { name: string; saleValue: number };
  form?: OtherCostFormState;
  summary?: Pick<
    TripSummaryValues,
    'fare' | 'otherFees' | 'otherFeeItems' | 'total' | 'commission'
  >;
  apiDetail?: {
    state?: string;
    paymentMethod?: string | null;
    otherCost?: number | null;
    amount?: number | null;
  };
  cleanup?: Record<string, string>;
};

/** Comentario del run (≤ 1500 caracteres): qué se ejecutó y qué devolvió. Solo lo medido; sin PII ni tokens. */
export function buildOtherCostsComment(m: OtherCostsMeasurement): string {
  const lines = [
    `Ejecución automatizada (Appium + API) · ${m.env.toUpperCase()} · ${m.appPackage ?? 'n/d'} en ${m.udid ?? 'n/d'} · run ${m.runId}`,
    m.concept &&
      `Concepto «${m.concept.name}»: Fijo, venta ${m.concept.saleValue}, disponible Chofer.`,
    m.form && `App: modal con importe ${m.form.amount} (editable: ${m.form.amountEditable}).`,
    m.summary &&
      `App Resumen (cuenta corriente): «Otros costos» ${m.summary.otherFees} (${m.summary.otherFeeItems.join('; ')}); tarifa/total: ${m.summary.fare}/${m.summary.total}; comisión ${m.summary.commission}.`,
    m.apiDetail &&
      `API del viaje: state ${m.apiDetail.state} · ${m.apiDetail.paymentMethod} · otherCost ${m.apiDetail.otherCost} · amount ${m.apiDetail.amount}.`,
    m.cleanup &&
      Object.keys(m.cleanup).length > 0 &&
      `Limpieza: ${Object.entries(m.cleanup)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')}.`
  ].filter((line): line is string => typeof line === 'string');
  return lines.join('\n').slice(0, 1500);
}

export type OtherCostsPboDeps = {
  modal: Pick<
    OtherCostsModalScreen,
    'open' | 'listOfferedConcepts' | 'selectConcept' | 'readForm' | 'save' | 'cancelIfOpen'
  >;
  summary: Pick<OtherCostsSummaryScreen, 'waitUntilRendered' | 'read' | 'selectPaymentMethod'>;
};

export type OtherCostsPboRuntime = { log: (message: string) => void };

export type AddConceptResult = { offered: string[]; form: OtherCostFormState };

export class OtherCostsPBO {
  private readonly log: (message: string) => void;

  constructor(
    private readonly deps: OtherCostsPboDeps,
    out: Partial<OtherCostsPboRuntime> = {}
  ) {
    this.log = out.log ?? ((m) => console.info(m));
  }

  static forSession(session: MobileSession, out?: Partial<OtherCostsPboRuntime>): OtherCostsPBO {
    return new OtherCostsPBO(
      { modal: new OtherCostsModalScreen(session), summary: new OtherCostsSummaryScreen(session) },
      out
    );
  }

  /** Espera a que el Resumen termine de pintar y lo lee. */
  async readSummary(): Promise<TripSummaryValues> {
    await this.deps.summary.waitUntilRendered();
    return this.deps.summary.read();
  }

  /**
   * Abre «Otros costos», verifica que el concepto se ofrece, lo elige, confirma que «Guardar» quedó habilitado y
   * guarda. Si el concepto no se ofrece o «Guardar» no se habilita, cierra el modal con «Cancelar» y lanza.
   */
  async addConcept(name: string, options: IrreversibleOptions): Promise<AddConceptResult> {
    assertConfirmed(options, 'Agregar el otro costo al viaje');
    await this.deps.modal.open();
    try {
      const offered = await this.deps.modal.listOfferedConcepts();
      if (!offered.includes(name)) throw new ConceptNotOfferedError(name, offered);
      await this.deps.modal.selectConcept(name);
      const form = await this.deps.modal.readForm();
      if (!form.saveEnabled) throw new OtherCostSaveDisabledError(form);
      await this.deps.modal.save();
      this.log(`[OtherCostsPBO] Concepto «${name}» agregado (importe ${form.amount}).`);
      return { offered, form };
    } catch (error) {
      await this.deps.modal.cancelIfOpen().catch(() => undefined);
      throw error;
    }
  }

  /** Elige el medio de pago del cierre (no cierra el viaje). */
  async selectPaymentMethod(code: DriverPaymentMethodCode): Promise<void> {
    await this.deps.summary.selectPaymentMethod(code);
  }

  /** Limpieza: cierra el modal si quedó abierto. */
  async cancelModalIfOpen(): Promise<boolean> {
    return this.deps.modal.cancelIfOpen();
  }
}
