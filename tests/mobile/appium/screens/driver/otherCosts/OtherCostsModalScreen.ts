/**
 * OtherCostsModalScreen — modal «Agregar otro costo» de la app Chofer (`ion-modal.add-other-modal`,
 * `app-travel-add-other`) y el botón «Otros costos» del Resumen que lo abre (TM-1099, Universal F1).
 * Portado de V1 (`DriverOtherCostsCloseScreen`, locators relevados el 29/09/2026 en UAT 2.6.14) y
 * contrastado contra `magiis-mobile-driver-v2@develop` (travel-add-other.html / travel-resume.html):
 *   - `cssClass: 'add-other-modal'` lo fija `travel-resume.ts` al abrir el modal.
 *   - selector de concepto: `ion-select interface="popover"` -> `ion-popover.select-popover ion-item.select-interface-option`.
 *   - importe: `ion-input[formControlName=costPrice]` (se deshabilita por código para FIX/QTY/PCT).
 *   - botones: `.buttons button.btn.primary` (Guardar) / `.buttons button.btn-outlined-red` (Cancelar).
 * POM puro: locators + acciones atómicas + estados observables; sin aserciones de negocio ni esperas fijas.
 * Clic = `element.click()` de WebDriver sobre el elemento visible y habilitado (el `el.click()` de DOM no
 * dispara todos los handlers de Ionic).
 */

import { defineLocator, resolveWebSelectors, type Locator } from '../../../core/Locator.js';
import type { MobileSession } from '../../../core/MobileSession.js';
import { Waits, type UntilOptions } from '../../../core/Waits.js';

const MODAL_CSS = 'ion-modal.add-other-modal.show-modal';
const POPOVER_CSS = 'ion-popover.select-popover';

export const OTHER_COSTS_MODAL_LOCATORS = {
  opener: defineLocator({
    id: 'driver.otherCosts.opener',
    web: 'app-travel-resume .travel-extras button:has(img[src*="addCost"])'
  }),
  modal: defineLocator({ id: 'driver.otherCosts.modal', web: MODAL_CSS }),
  select: defineLocator({ id: 'driver.otherCosts.select', web: `${MODAL_CSS} ion-select` }),
  option: defineLocator({
    id: 'driver.otherCosts.option',
    web: `${POPOVER_CSS} ion-item.select-interface-option`
  }),
  save: defineLocator({
    id: 'driver.otherCosts.save',
    web: `${MODAL_CSS} .buttons button.btn.primary`
  }),
  cancel: defineLocator({
    id: 'driver.otherCosts.cancel',
    web: `${MODAL_CSS} .buttons button.btn-outlined-red`
  })
} as const;

/** Estado del formulario del modal tal como lo ve el chofer. */
export type OtherCostFormState = {
  selectedConcept: string;
  /** Texto del input de importe (`''` si no hay). */
  amount: string;
  amountEditable: boolean;
  saveEnabled: boolean;
};

const DEFAULT_TIMEOUT = 30_000;

function css(locator: Locator): string {
  return resolveWebSelectors(locator)[0]!;
}

export class OtherCostsModalScreen {
  constructor(private readonly session: MobileSession) {}

  private async web() {
    if ((await this.session.context()) !== 'webview') await this.session.switchContext('webview');
    return this.session.driver;
  }

  /** Clic WebDriver sobre el primer elemento visible y habilitado (con texto exacto opcional); reintenta. */
  private async clickVisible(
    selector: string,
    opts: { text?: string; timeout?: number } = {}
  ): Promise<string> {
    const driver = await this.web();
    let clicked: string | null = null;
    await Waits.tryUntil(
      async () => {
        for (const el of await driver.$$(selector)) {
          if (!(await el.isDisplayed().catch(() => false))) continue;
          if (!(await el.isEnabled().catch(() => false))) continue;
          const text = (await el.getText().catch(() => '')).trim();
          if (opts.text !== undefined && text !== opts.text) continue;
          await el.click();
          clicked = text;
          return true;
        }
        return false;
      },
      { timeout: opts.timeout ?? DEFAULT_TIMEOUT, interval: 600, label: `clic en ${selector}` }
    );
    if (clicked === null) {
      throw new Error(
        `[OtherCostsModalScreen] no apareció un elemento visible y habilitado para «${selector}»${opts.text ? ` con texto «${opts.text}»` : ''}.`
      );
    }
    return clicked;
  }

  private async count(selector: string): Promise<number> {
    const driver = await this.web();
    return driver
      .execute<number, [string]>((s: string) => document.querySelectorAll(s).length, selector)
      .catch(() => 0);
  }

  private async waitForGone(selector: string, options: UntilOptions = {}): Promise<void> {
    await Waits.until(async () => (await this.count(selector)) === 0, {
      label: `${selector} cerrado`,
      timeout: 15_000,
      ...options
    });
  }

  /** Estado observable: el modal está abierto. */
  async isOpen(): Promise<boolean> {
    return (await this.count(css(OTHER_COSTS_MODAL_LOCATORS.modal))) > 0;
  }

  /** Estado observable: el botón «Otros costos» del Resumen está habilitado (null = no se ve). */
  async isOpenerEnabled(): Promise<boolean | null> {
    const driver = await this.web();
    return driver
      .execute<boolean | null, [string]>((sel: string) => {
        const b = document.querySelector(sel) as HTMLButtonElement | null;
        if (!b) return null;
        return !(b.disabled || b.classList.contains('button-other-cost-disabled'));
      }, css(OTHER_COSTS_MODAL_LOCATORS.opener))
      .catch(() => null);
  }

  /** Abre el modal desde el Resumen y espera al selector de concepto (lo toca: abre el popover). */
  async open(): Promise<void> {
    await this.clickVisible(css(OTHER_COSTS_MODAL_LOCATORS.opener));
    try {
      await this.clickVisible(css(OTHER_COSTS_MODAL_LOCATORS.select), { timeout: 15_000 });
    } catch (error) {
      throw new Error(
        `[OtherCostsModalScreen] el modal de Otros costos no abrió: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** Conceptos que ofrece el selector (con el popover abierto por `open`). */
  async listOfferedConcepts(): Promise<string[]> {
    const optionSel = css(OTHER_COSTS_MODAL_LOCATORS.option);
    await Waits.until(async () => (await this.count(optionSel)) > 0, {
      label: 'opciones del selector de conceptos',
      timeout: 15_000
    });
    const driver = await this.web();
    return driver.execute<string[], [string]>(
      (s: string) =>
        Array.from(document.querySelectorAll(s)).map((e) =>
          (e.textContent ?? '').replace(/\s+/g, ' ').trim()
        ),
      optionSel
    );
  }

  /** Elige el concepto por nombre exacto y espera a que el popover cierre. */
  async selectConcept(name: string, timeoutMs = 15_000): Promise<void> {
    await this.clickVisible(css(OTHER_COSTS_MODAL_LOCATORS.option), {
      text: name,
      timeout: timeoutMs
    });
    await this.waitForGone(POPOVER_CSS, { timeout: 10_000 });
    // El form valida en el `ionChange`: margen para que «Guardar» se habilite. No falla acá; la aserción
    // del llamador lo dice con el estado leído.
    await Waits.tryUntil(async () => (await this.readForm()).saveEnabled, {
      timeout: 5_000,
      label: 'Guardar habilitado'
    });
  }

  async readForm(): Promise<OtherCostFormState> {
    const driver = await this.web();
    const state = await driver.execute<OtherCostFormState | null, [string]>((modalSel: string) => {
      const modal = document.querySelector(modalSel);
      if (!modal) return null;
      const select = modal.querySelector('ion-select') as
        | (HTMLElement & { value?: unknown })
        | null;
      const ionInput = modal.querySelector('ion-input') as
        | (HTMLElement & { disabled?: boolean })
        | null;
      const input = modal.querySelector('ion-input input') as HTMLInputElement | null;
      const save = modal.querySelector('.buttons button.btn.primary') as HTMLButtonElement | null;
      return {
        selectedConcept: String(select?.value ?? ''),
        amount: input?.value ?? '',
        amountEditable: Boolean(input && !input.disabled && !input.readOnly && !ionInput?.disabled),
        saveEnabled: Boolean(save && !save.disabled)
      };
    }, MODAL_CSS);
    if (!state)
      throw new Error('[OtherCostsModalScreen] el modal de Otros costos no está abierto.');
    return state;
  }

  /** Toca «Guardar» y espera a que el modal cierre. */
  async save(): Promise<void> {
    await this.clickVisible(css(OTHER_COSTS_MODAL_LOCATORS.save));
    await this.waitForGone(MODAL_CSS);
  }

  /** Cierra el modal con «Cancelar» si quedó abierto (limpieza). Devuelve si hizo falta. */
  async cancelIfOpen(): Promise<boolean> {
    if (!(await this.isOpen())) return false;
    await this.clickVisible(css(OTHER_COSTS_MODAL_LOCATORS.cancel));
    await this.waitForGone(MODAL_CSS, { timeout: 10_000 });
    return true;
  }
}
