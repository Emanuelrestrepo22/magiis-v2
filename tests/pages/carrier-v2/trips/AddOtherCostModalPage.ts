// tests/pages/carrier-v2/trips/AddOtherCostModalPage.ts
// Modal «Agregar Otro Costo» / «Add Other Cost» de Nuevo Viaje (ng-template `#otherCostsModal`,
// NgbModal `size:'md'`, `backdrop:'static'`, `keyboard:false` → Esc NO lo cierra).
//
// PROVENIENCIA DE SELECTORES: relevamiento
// docs/analysis/migration-evidence/new-trip-other-costs-2026-09-29.md §2 y §6, verificado contra
// `magiis-fe-carrier-v2` origin/release/v2.0.17 (commit 6e39104c),
// `src/app/pages/carrier/trips/new-trip/new-trip.component.html:1876-2008` y
// `new-trip.component.ts:7811-7936`.
//
// Accesibilidad (hallazgo H-2): la X, el combo y los labels del modal NO tienen nombre accesible
// ni `for`/`id`; se ancla todo bajo el dialog y por `formcontrolname`.
// Hallazgo H-1: el botón «Cancelar» del footer no hace nada (el footer no enlaza
// `cancelButtonEvent`). Por eso `close()` usa la X y este POM no expone un "cancelar por footer"
// como camino de cierre — sería codificar el defecto como flujo.
/**
 * @jira MG-995
 * @route /carrier/#/travel/create
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';

/** Escapa un texto literal para usarlo dentro de un RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class AddOtherCostModalPage extends BasePage {
  /**
   * Contenedor del modal. `ngb-modal-window` expone rol `dialog`; se filtra por el título para
   * no confundirlo con otros NgbModal de la pantalla (vuelo, notas, alerta de impuestos).
   * html:1879-1884 — título = `modal_other_costs.add` + `modal_other_costs.title`.
   */
  readonly dialog: Locator;
  /** X del header (`cancelOtherCostModal()`), único cierre real del modal. html:1884. */
  readonly closeButton: Locator;
  /** ng-select del concepto (`formControlName="id"`, `bindLabel="concept"`). html:1892-1901. */
  readonly conceptSelect: Locator;
  /** Input de búsqueda interno del ng-select de concepto. */
  readonly conceptSearchInput: Locator;
  /**
   * Opciones del panel del combo. El panel de ng-select se pinta FUERA del modal
   * (relevamiento §2), por eso se ancla a la página y no al dialog.
   */
  readonly conceptOptions: Locator;
  /**
   * Input de precio. Es el MISMO `formControlName="price"` para los cuatro tipos: editable en
   * VAR (`type=number min=0.01 step=0.01`, html:1976-1978) y `readonly` en QTY/FIX/PCT
   * (html:1914-1916, 1946-1948, 1993-1996). NO usa la máscara `currencyInput` (relevamiento §6).
   */
  readonly priceInput: Locator;
  /** Cantidad (QTY y FIX): `formControlName="quantity"`, `type=number min=1 step=1`. html:1923, 1955. */
  readonly quantityInput: Locator;
  /** Etiqueta del tope de un VAR: «Max. Value: 1500$» / «Valor Máximo: 1500$». html:1968-1971. */
  readonly maxValueLabel: Locator;
  /**
   * Errores de validación del modal (`.text-danger.small`): tope de VAR superado
   * (html:1980-1983) o cantidad no natural (html:1926-1929, 1958-1961).
   */
  readonly validationErrors: Locator;
  /** Aceptar. `[acceptDisabled]="!otherCostsForm.valid || !selectedConceptType"`. html:2003. */
  readonly acceptButton: Locator;

  constructor(page: Page) {
    super(page);

    this.dialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: /(add\s+other\s+cost|agregar\s+otro\s+costo)/i })
    });
    this.closeButton = this.dialog.locator('button.btn-close');
    this.conceptSelect = this.dialog.locator('ng-select[formcontrolname="id"]');
    this.conceptSearchInput = this.conceptSelect.locator('.ng-input input');
    this.conceptOptions = page.getByRole('option');
    this.priceInput = this.dialog.locator('input[formcontrolname="price"]');
    this.quantityInput = this.dialog.locator('input[formcontrolname="quantity"]');
    this.maxValueLabel = this.dialog.getByText(/(valor m[aá]ximo|max\.?\s*value)\s*:/i);
    this.validationErrors = this.dialog.locator('.text-danger.small');
    this.acceptButton = this.dialog.getByRole('button', { name: /^(aceptar|accept)$/i });
  }

  /** El modal debe estar abierto antes de operarlo (se usa desde NewTripPage al abrirlo). */
  async expectVisible(): Promise<void> {
    await expect(this.dialog, 'el modal «Agregar Otro Costo» debe abrirse').toBeVisible({
      timeout: 15_000
    });
  }

  /**
   * Opción del combo cuyo nombre accesible es EXACTAMENTE `name`. En el carrier compartido
   * puede haber conceptos homónimos por prefijo: nunca se elige por "contiene".
   */
  conceptOption(name: string): Locator {
    return this.conceptOptions.filter({
      hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`)
    });
  }

  /**
   * Elige un concepto por nombre exacto. El catálogo se carga asíncrono al abrir el modal
   * (`searchOtherCosts` dentro de `showModalOtherCosts`, ts:7824-7844), así que se tipea el
   * nombre para filtrar y se espera la opción. Efecto observable verificado: el ng-select queda
   * con el concepto como valor (`selectOtherCostConcept`, ts:7849-7876, setea el tipo y el precio).
   */
  async selectConcept(name: string): Promise<void> {
    await this.conceptSelect.click();
    await this.conceptSearchInput.fill(name);

    const option = this.conceptOption(name);
    await expect(
      option,
      `el combo de conceptos debe ofrecer exactamente "${name}" (apply debe incluir CARRIER y no estar ya agregado)`
    ).toHaveCount(1, { timeout: 20_000 });
    await option.click();

    // `.ng-value` también contiene el `.ng-value-icon` («×», aria-hidden) del render por
    // defecto; el nombre vive en `.ng-value-label` (mismo patrón que NewTripPage.tripTimeValue).
    await expect(
      this.conceptSelect.locator('.ng-value-label, .ng-value:not(:has(.ng-value-label))').first(),
      'el concepto elegido debe quedar fijado en el combo'
    ).toHaveText(new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`));
    await expect(
      this.priceInput,
      'elegir el concepto debe mostrar su campo de precio'
    ).toBeVisible();
  }

  /**
   * Carga la cantidad (QTY / FIX). `type=number`: `fill()` directo es fiable (relevamiento §6.5);
   * se verifica el valor leído de vuelta antes de seguir.
   */
  async setQuantity(quantity: number): Promise<void> {
    await this.quantityInput.fill(String(quantity));
    await expect(this.quantityInput).toHaveValue(String(quantity));
  }

  /**
   * Carga el importe de un VAR con teclado real: click → Ctrl+A → tipeo → lectura de vuelta.
   * El input es `type=number` sin máscara (relevamiento §6.5), pero se tipea en lugar de `fill`
   * para ejercitar el mismo camino que el operador (TM-1087 pide el importe tecleado).
   * No hace blur ni acepta: el llamador decide si aseverar el error de tope o aceptar.
   */
  async setAmount(amount: number | string): Promise<void> {
    const text = String(amount);
    await this.priceInput.click();
    await this.priceInput.press('Control+a');
    await this.priceInput.pressSequentially(text);
    await expect(this.priceInput, `el importe tipeado debe quedar en "${text}"`).toHaveValue(text);
  }

  /** Valor precargado del campo de precio (FIX/QTY: unitario; PCT: porcentaje; VAR: lo tipeado). */
  async readPrice(): Promise<string> {
    return this.priceInput.inputValue();
  }

  /**
   * Tope que muestra la etiqueta del VAR, como número. La etiqueta pinta el `maxValue` crudo del
   * concepto seguido del símbolo, sin separador de miles (relevamiento §2: «Max. Value: 10$»).
   */
  async readMaxValue(): Promise<number> {
    await expect(this.maxValueLabel, 'un concepto Variable debe mostrar su tope').toBeVisible();
    const text = (await this.maxValueLabel.textContent()) ?? '';
    const match = text.match(/:\s*(-?[\d.,]+)/);
    if (!match) {
      throw new Error(`no se pudo leer el tope de la etiqueta del Variable: "${text.trim()}"`);
    }
    return Number(match[1].replace(/,/g, ''));
  }

  /**
   * Acepta el modal. Efecto observable verificado: el modal se cierra (`saveOtherCost` hace
   * `dismiss`, ts:7892-7925). Si Aceptar está deshabilitado el click agota su espera y falla
   * explícito: para aseverar el bloqueo usar `acceptButton` + `toBeDisabled()` en el test.
   */
  async accept(): Promise<void> {
    await expect(this.acceptButton, 'Aceptar debe estar habilitado para confirmar').toBeEnabled();
    await this.acceptButton.click();
    await expect(this.dialog, 'aceptar debe cerrar el modal').toBeHidden({ timeout: 10_000 });
  }

  /** Cierra el modal por la X, sin agregar el concepto (el Cancelar del footer no cierra: H-1). */
  async close(): Promise<void> {
    await this.closeButton.click();
    await expect(this.dialog, 'la X debe cerrar el modal').toBeHidden({ timeout: 10_000 });
  }
}
