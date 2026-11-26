/**
 * HomeScreen (POM) — home de la app chofer (`/navigator/home`, componente `page-home`): control de
 * disponibilidad `#availability` (ONLINE <-> OFFLINE). Solo locators + acciones atómicas + estado observable.
 * Migrado de `driver/DriverHomeScreen.{isDriverOnline,goOnline}`.
 *
 * GOTCHA medido en device: Ionic mantiene montadas las páginas anteriores, así que puede haber MÁS de un
 * `#availability` en el documento y el primero por orden de DOM puede ser una instancia vieja y oculta (rect 0x0).
 * Siempre se elige la instancia con rect visible (la última), nunca la primera a secas.
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { I18n } from '../../core/I18n.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { isHomeUrl, webDriver, webUrl } from './driverWeb.js';

export const HOME_LOCATORS = {
  availability: defineLocator({ id: 'driver.home.availability', web: '#availability' }),
  /** Etiqueta dentro del control: `.available-label` (fallback: primer `span`). */
  availabilityLabel: defineLocator({
    id: 'driver.home.availabilityLabel',
    web: ['.available-label', 'span']
  })
} as const;

export type AvailabilityState = 'available' | 'notAvailable' | 'unknown';

export type AvailabilityControl = {
  /** Existe algún `#availability` en el DOM. */
  present: boolean;
  /** Hay una instancia con rect visible. */
  visible: boolean;
  /** La instancia visible está deshabilitada (cambio de estado en curso o bloqueo). */
  disabled: boolean;
  /** Texto visible de la etiqueta ('' si no hay). */
  label: string;
};

export type AvailabilitySnapshot = AvailabilityControl & { state: AvailabilityState };

/**
 * Pura: estado a partir del texto de la etiqueta, por coincidencia exacta con las variantes i18n
 * (`driver.home.notAvailable` / `driver.home.available`). Texto vacío o desconocido = `unknown`.
 * Una key pendiente (`TODO-verificar`) hace fallar: no se adivina el texto del locale.
 */
export function classifyAvailability(
  label: string,
  i18n: Pick<I18n, 'matches'>
): AvailabilityState {
  if (i18n.matches(label, 'driver.home.notAvailable')) return 'notAvailable';
  if (i18n.matches(label, 'driver.home.available')) return 'available';
  return 'unknown';
}

export class HomeScreen {
  constructor(
    private readonly session: MobileSession,
    private readonly i18n: I18n
  ) {}

  /** URL actual del WebView. */
  async readUrl(): Promise<string> {
    return webUrl(this.session);
  }

  async isShown(): Promise<boolean> {
    return isHomeUrl(await this.readUrl());
  }

  /** Lee el control de disponibilidad (instancia visible) sin tocarlo. */
  async readControl(): Promise<AvailabilityControl> {
    const driver = await webDriver(this.session);
    return driver
      .execute<AvailabilityControl, [string[], string[]]>(
        (controlSels: string[], labelSels: string[]) => {
          const onScreen = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const all = controlSels.flatMap((s) => Array.from(document.querySelectorAll(s)));
          const alive = all.filter(onScreen);
          const btn = (alive[alive.length - 1] as HTMLElement | undefined) ?? null;
          let label = '';
          if (btn) {
            for (const s of labelSels) {
              const el = btn.querySelector(s);
              const text = String(el?.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim();
              if (text) {
                label = text;
                break;
              }
            }
            if (!label) {
              label = String(btn.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim();
            }
          }
          return {
            present: all.length > 0,
            visible: !!btn,
            disabled: btn
              ? (btn as HTMLButtonElement).disabled === true ||
                btn.getAttribute('disabled') !== null
              : false,
            label
          };
        },
        resolveWebSelectors(HOME_LOCATORS.availability),
        resolveWebSelectors(HOME_LOCATORS.availabilityLabel)
      )
      .catch(() => ({ present: false, visible: false, disabled: false, label: '' }));
  }

  /** Control + estado clasificado por i18n. */
  async readAvailability(): Promise<AvailabilitySnapshot> {
    const control = await this.readControl();
    return {
      ...control,
      state: control.visible ? classifyAvailability(control.label, this.i18n) : 'unknown'
    };
  }

  /**
   * Toca `#availability` (JS click sobre la instancia visible y habilitada). Devuelve false si no hay nada
   * tocable (ausente, oculto o deshabilitado).
   */
  async tapAvailability(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string[]]>((sels: string[]) => {
        const alive = sels
          .flatMap((s) => Array.from(document.querySelectorAll(s)) as HTMLElement[])
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
        const btn = alive[alive.length - 1];
        if (!btn || (btn as HTMLButtonElement).disabled || btn.getAttribute('disabled') !== null)
          return false;
        btn.click();
        return true;
      }, resolveWebSelectors(HOME_LOCATORS.availability))
      .catch(() => false);
  }
}
