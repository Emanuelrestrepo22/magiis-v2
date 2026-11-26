/**
 * NewTripScreen (POM) — formulario de nuevo viaje del home PAX: campos origen/destino, lista de predicciones de
 * direcciones y lectura (SOLO lectura) del CTA de continuar. Sin aserciones de negocio ni navegación.
 *
 * REGLA DE SEGURIDAD: esta screen NO expone ningún método que toque el CTA (`ion-col.travel-btn-confirm`), ni
 * pago, ni confirmación de viaje. El CTA solo se LEE (`readConfirmCta`). Confirmar es P-12/P-13, con compuerta.
 *
 * Relevado del código (develop) y V1; pendiente de validar en vivo (el login PAX está bloqueado en los emuladores
 * por FCM):
 *  - home.page.html:153 `<travel-destinations>` -> pages/components/travel-destinations (`*ngFor` de
 *    `<travel-edit-input>`, uno por waypoint: 1.º = origen, 2.º = destino) -> travel-edit-input.component.html.
 *  - Cada fila: `ion-row.search-row` > `div.input-form` > `<input name="input-from">`. El placeholder es
 *    `{{ label | translate }} {{ index }}` con claves `commons.label_from|label_to` (es «Origen»/«Destino»,
 *    en «From»/«To») y `index` vacío con 2 waypoints: de ahí el espacio final de V1 (`"Origen "`). Es i18n, por
 *    eso los locators son estructurales y el placeholder solo es respaldo.
 *  - El input queda `readonly` cuando ya tiene lugar elegido (`item.place.placeId != ''`). El origen suele venir
 *    auto-geolocalizado (MG-552): para cambiarlo hay que limpiarlo (papelera de la fila 1). El destino ya
 *    elegido no tiene control para limpiarse en un viaje de 2 puntos (la papelera solo existe en paradas
 *    intermedias).
 *  - Predicciones: `ion-list.prediction-list > ion-item.prediction-item` (`span.main` calle, `span.secondary`
 *    ciudad), máximo 3, desde 3 caracteres, debounce 300 ms (Google Places vía `GooglePlacesService`). El item se
 *    elige con `(mousedown)`, no con `(click)`: se usa un click real de WebdriverIO (genera mousedown).
 *  - CTA: `ion-col.travel-btn-confirm` («Seleccionar Vehículo» en develop; en versiones previas «Viajo Ahora»).
 *    Solo existe si `!isInputWaypointFocused`: con un campo enfocado no se renderiza.
 */

import { defineLocator, resolveWebSelectors, type Locator } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { normalizeForMatch } from './LoginScreen.js';
import { webDriver } from './passengerWeb.js';

export type TripField = 'origin' | 'destination';

/** Posición (1-based, `nth-of-type`) de la fila de cada campo dentro de `<travel-destinations>`. */
const ROW_INDEX: Record<TripField, number> = { origin: 1, destination: 2 };

const row = (field: TripField): string => `travel-edit-input:nth-of-type(${ROW_INDEX[field]})`;

export const NEW_TRIP_LOCATORS = {
  // relevado del código (develop) y V1, pendiente de validar en vivo
  originInput: defineLocator({
    id: 'passenger.newTrip.originInput',
    web: [
      `${row('origin')} div.input-form input`,
      'input[placeholder^="Origen"]',
      'input[placeholder^="From"]'
    ]
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo
  destinationInput: defineLocator({
    id: 'passenger.newTrip.destinationInput',
    web: [
      `${row('destination')} div.input-form input`,
      'input[placeholder^="Destino"]',
      'input[placeholder^="To"]'
    ]
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo
  originPredictions: defineLocator({
    id: 'passenger.newTrip.originPredictions',
    web: `${row('origin')} ion-list.prediction-list ion-item.prediction-item`
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo
  destinationPredictions: defineLocator({
    id: 'passenger.newTrip.destinationPredictions',
    web: `${row('destination')} ion-list.prediction-list ion-item.prediction-item`
  }),
  // relevado del código (develop), pendiente de validar en vivo: papelera del origen ya resuelto (limpia el waypoint 0)
  originClear: defineLocator({
    id: 'passenger.newTrip.originClear',
    web: `${row('origin')} button ion-icon[name="trash"]`
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo. Solo lectura: NUNCA se toca.
  confirmCta: defineLocator({
    id: 'passenger.newTrip.confirmCta',
    web: ['ion-col.travel-btn-confirm', '.travel-confirm ion-col.travel-btn-confirm']
  }),
  // relevado de V1, pendiente de validar en vivo: modal «Ya tiene un viaje creado» (viaje activo)
  tripBlockModal: defineLocator({
    id: 'passenger.newTrip.tripBlockModal',
    web: 'app-confirm-modal'
  })
} as const satisfies Record<string, Locator>;

export type AddressPrediction = { index: number; main: string; secondary: string; text: string };
export type ConfirmCtaState = {
  present: boolean;
  visible: boolean;
  enabled: boolean;
  text: string;
};

const inputLocator = (field: TripField): Locator =>
  field === 'origin' ? NEW_TRIP_LOCATORS.originInput : NEW_TRIP_LOCATORS.destinationInput;
const predictionsLocator = (field: TripField): Locator =>
  field === 'origin'
    ? NEW_TRIP_LOCATORS.originPredictions
    : NEW_TRIP_LOCATORS.destinationPredictions;

/**
 * Pura: índice de la predicción a elegir. `pick` numérico = índice (si existe); texto = primera predicción que lo
 * contiene (sin acentos/mayúsculas); sin coincidencia o sin `pick` = la primera. `-1` si no hay predicciones (o el
 * índice pedido no existe).
 */
export function pickPredictionIndex(
  predictions: readonly Pick<AddressPrediction, 'text'>[],
  pick?: string | number
): number {
  if (predictions.length === 0) return -1;
  if (typeof pick === 'number') return pick >= 0 && pick < predictions.length ? pick : -1;
  if (pick) {
    const wanted = normalizeForMatch(pick);
    const hit = predictions.findIndex((p) => normalizeForMatch(p.text).includes(wanted));
    if (hit >= 0) return hit;
  }
  return 0;
}

export class NewTripScreen {
  constructor(private readonly session: MobileSession) {}

  /** Elementos visibles entre los selectores del locator, en orden (vacío si no hay). */
  private async visibleElements(locator: Locator): Promise<WebdriverIO.Element[]> {
    const driver = await webDriver(this.session);
    for (const selector of resolveWebSelectors(locator)) {
      let found: WebdriverIO.Element[] = [];
      try {
        found = Array.from((await driver.$$(selector)) as Iterable<WebdriverIO.Element>);
      } catch {
        found = [];
      }
      const visible: WebdriverIO.Element[] = [];
      for (const el of found) if (await el.isDisplayed().catch(() => false)) visible.push(el);
      if (visible.length > 0) return visible;
    }
    return [];
  }

  /** `true` si los dos campos (origen y destino) están visibles. */
  async isFormShown(): Promise<boolean> {
    return (
      (await this.visibleElements(NEW_TRIP_LOCATORS.originInput)).length > 0 &&
      (await this.visibleElements(NEW_TRIP_LOCATORS.destinationInput)).length > 0
    );
  }

  /** `true` si el campo tiene lugar ya resuelto (input `readonly`) y no admite tipeo. */
  async isFieldReadonly(field: TripField): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string[]]>(
        (sels: string[]) => {
          for (const s of sels) {
            const el = document.querySelector(s) as HTMLInputElement | null;
            if (el) return el.readOnly || el.hasAttribute('readonly');
          }
          return false;
        },
        resolveWebSelectors(inputLocator(field))
      )
      .catch(() => false);
  }

  /** Valor actual del input ('' si no existe). */
  async readFieldValue(field: TripField): Promise<string> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string, [string[]]>(
        (sels: string[]) => {
          for (const s of sels) {
            const el = document.querySelector(s) as HTMLInputElement | null;
            if (el) return String(el.value ?? '');
          }
          return '';
        },
        resolveWebSelectors(inputLocator(field))
      )
      .catch(() => '');
  }

  /**
   * Escribe `text` con teclado real (`setValue` de WebdriverIO: enfoca, limpia y envía teclas; NO asigna
   * `value` por JS, que no dispara el `ngModelChange` ni las predicciones). `false` si el campo no existe o es
   * `readonly` (hay que limpiarlo antes).
   */
  async typeAddress(field: TripField, text: string): Promise<boolean> {
    const [input] = await this.visibleElements(inputLocator(field));
    if (!input) return false;
    if (await this.isFieldReadonly(field)) return false;
    try {
      await input.click();
      await input.setValue(text);
      return true;
    } catch {
      return false;
    }
  }

  /** Limpia el origen ya resuelto con su papelera. `false` si no hay papelera (origen vacío o no resuelto). */
  async clearOrigin(): Promise<boolean> {
    const [trash] = await this.visibleElements(NEW_TRIP_LOCATORS.originClear);
    if (!trash) return false;
    try {
      await trash.click();
      return true;
    } catch {
      return false;
    }
  }

  /** Predicciones visibles del campo, en orden (máx. 3 en la app). */
  async readPredictions(field: TripField): Promise<AddressPrediction[]> {
    const driver = await webDriver(this.session);
    const raw = await driver
      .execute<{ main: string; secondary: string }[], [string[]]>(
        (sels: string[]) => {
          const visible = (el: Element): boolean => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const txt = (el: Element | null): string =>
            String((el as HTMLElement | null)?.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim();
          for (const s of sels) {
            const items = Array.from(document.querySelectorAll(s)).filter(visible);
            if (items.length > 0) {
              return items.map((it) => ({
                main: txt(it.querySelector('span.main')),
                secondary: txt(it.querySelector('span.secondary'))
              }));
            }
          }
          return [];
        },
        resolveWebSelectors(predictionsLocator(field))
      )
      .catch(() => []);
    return raw.map((p, index) => ({
      index,
      main: p.main,
      secondary: p.secondary,
      text: `${p.main} ${p.secondary}`.trim()
    }));
  }

  /** Elige la predicción `index` (click real: la app escucha `mousedown`). `false` si no existe. */
  async selectPrediction(field: TripField, index: number): Promise<boolean> {
    const target = (await this.visibleElements(predictionsLocator(field)))[index];
    if (!target) return false;
    try {
      await target.click();
      return true;
    } catch {
      return false;
    }
  }

  /** Quita el foco del campo activo (el CTA no se renderiza con un campo enfocado). No toca nada más. */
  async dismissKeyboard(): Promise<void> {
    const driver = await webDriver(this.session);
    await driver
      .execute<void, []>(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
      })
      .catch(() => undefined);
  }

  /**
   * SOLO LECTURA del CTA de continuar: si existe, si es visible y si está habilitado (sin clase/atributo
   * `disabled` ni `pointer-events: none`). Nunca lo toca.
   */
  async readConfirmCta(): Promise<ConfirmCtaState> {
    const driver = await webDriver(this.session);
    return driver
      .execute<ConfirmCtaState, [string[]]>((sels: string[]) => {
        for (const s of sels) {
          const el = document.querySelector(s) as HTMLElement | null;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
          const disabled =
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            /(^|\s)(disabled|btn-disabled)(\s|$)/.test(el.className) ||
            style.pointerEvents === 'none';
          return {
            present: true,
            visible,
            enabled: visible && !disabled,
            text: String(el.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim()
          };
        }
        return { present: false, visible: false, enabled: false, text: '' };
      }, resolveWebSelectors(NEW_TRIP_LOCATORS.confirmCta))
      .catch(() => ({ present: false, visible: false, enabled: false, text: '' }));
  }

  /** `true` si hay un modal visible «Ya tiene un viaje creado» (viaje activo; relevado de V1). */
  async isTripBlockModalShown(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string[]]>((sels: string[]) => {
        const norm = (t: string): string =>
          t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase();
        for (const s of sels) {
          for (const el of Array.from(document.querySelectorAll(s)) as HTMLElement[]) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && norm(el.innerText || '').includes('viaje creado')) {
              return true;
            }
          }
        }
        return false;
      }, resolveWebSelectors(NEW_TRIP_LOCATORS.tripBlockModal))
      .catch(() => false);
  }
}
