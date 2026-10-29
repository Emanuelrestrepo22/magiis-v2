// tests/pages/carrier-v2/settings/OtherCostFormModalPage.ts
// Modal de alta / edición de un concepto del ABM de Otros Costos (Configuración › Otros Costos).
// ng-template `#addEditModal`, NgbModal `backdrop:'static'`, `keyboard:false` → Esc NO lo cierra.
//
// PROVENIENCIA DE SELECTORES: recon R2 en UAT (v2.0.17, 2026-09-29, snapshot del modal) y
// `magiis-fe-carrier-v2` origin/release/v2.0.17 (6e39104c),
// src/app/pages/carrier/settings/otherCosts/settings-otherCosts.component.html:181-376 y
// settings-otherCosts.component.ts:460-760. Documento:
// docs/analysis/migration-evidence/other-costs-abm-2026-09-29.md.
//
// Importes: los tres campos de importe usan la directiva `currencyInput`
// (src/app/shared/directives/currency-input/currency-input.directive.ts): `keydown` descarta toda
// tecla que no sea dígito o separador (:281-396) y el `focus` programa un `select()` diferido
// (`setTimeout(…, 0)`, :146) que, con tipeo rápido, selecciona el primer dígito y el siguiente lo
// reemplaza («12» → 2.00). `fill()` sobre un valor existente concatena (20.00 + «25» → 2025,
// TM-1007 manual). Por eso TODA entrada de importes pasa por `fillMoney` (tecla por tecla con
// confirmación, lectura tras el blur y reintento acotado).
/**
 * @jira MG-996
 * @route /carrier/#/settings/otherCosts
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import { parseMoney } from '../../../utils/money.js';

export type OtherCostFormType = 'FIX' | 'QTY' | 'PCT' | 'VAR';

/** Etiqueta del Tipo en el combo (es-ar / en-us, `carrier.configuration.other_costs.type.*`). */
const TYPE_LABELS: Record<OtherCostFormType, RegExp> = {
  FIX: /^\s*(fijo|fixed)\s*$/i,
  QTY: /^\s*(cantidad|quantity)\s*$/i,
  PCT: /^\s*(porcentaje|percentage)\s*$/i,
  VAR: /^\s*variable\s*$/i
};

/** Intentos de `fillMoney` antes de fallar (cada uno borra y vuelve a tipear). */
const MONEY_ATTEMPTS = 3;
/** Espera por carácter tipeado hasta que la máscara lo refleje en el campo. */
const KEY_ECHO_TIMEOUT_MS = 2_000;

export class OtherCostFormModalPage extends BasePage {
  /**
   * Contenedor del modal, anclado por su título (sirve en alta y edición):
   * «Nuevo/Editar concepto de Otros Costos» · «New/Edit Other Costs concept» (html:183-186).
   * No se ancla por `#otherCostSaleValue`: en el alta ese campo recién aparece al elegir el Tipo.
   */
  readonly dialog: Locator;
  /** Título del modal (h5). */
  readonly title: Locator;
  /** Descripción: `<input id="otherCostConcept">` con `<label for>` (html:193-201). */
  readonly descriptionInput: Locator;
  /** ng-select del Tipo (html:214-221); se excluye el selector de moneda (`.other-costs-currency`). */
  readonly typeSelect: Locator;
  /** Valor elegido en el combo de Tipo. */
  readonly typeValue: Locator;
  /** Valor de venta / unitario / Tope de venta (VAR): mismo id en los dos inputs (html:246-263). */
  readonly saleInput: Locator;
  /** Interruptor Costo: `#otherCostIsByCost`, `role="switch"` (html:280-286). */
  readonly costSwitch: Locator;
  /** Valor de costo (no-VAR con Costo encendido): `#otherCostConceptValueCost` (html:292-299). */
  readonly costInput: Locator;
  /** Disponible para: checkboxes `#otherCostApply-<CODE>` (html:345-352). */
  readonly driverCheckbox: Locator;
  readonly carrierCheckbox: Locator;
  readonly paxCheckbox: Locator;
  /** Interruptor Comisiona: `#otherCostIsCommisionable`, `role="switch"` (html:356-362). */
  readonly commissionableSwitch: Locator;
  /**
   * Aviso de validación cruzada (`.alert.alert-info`, html:330-337): «Debe cargarse al menos uno
   * entre Valor de venta y Tope de venta distinto de cero.» (Costo OFF) o el de ambos topes.
   */
  readonly crossValidationAlert: Locator;
  /** Guardar: `[disabled]="!isFormValid || onRequest"` (html:370-374). */
  readonly saveButton: Locator;
  /** Cancelar del footer (`cancelModal()`, html:367-369). */
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', {
        name: /((nuevo|editar) concepto de otros costos|(new|edit) other costs concept)/i
      })
    });
    this.title = this.dialog.getByRole('heading', { level: 5 });
    this.descriptionInput = this.dialog.locator('#otherCostConcept');
    this.typeSelect = this.dialog.locator('ng-select:not(.other-costs-currency)');
    this.typeValue = this.typeSelect.locator('.ng-value-label');
    this.saleInput = this.dialog.locator('#otherCostSaleValue');
    this.costSwitch = this.dialog.locator('#otherCostIsByCost');
    this.costInput = this.dialog.locator('#otherCostConceptValueCost');
    this.driverCheckbox = this.dialog.locator('#otherCostApply-DRIVER');
    this.carrierCheckbox = this.dialog.locator('#otherCostApply-CARRIER');
    this.paxCheckbox = this.dialog.locator('#otherCostApply-PAX');
    this.commissionableSwitch = this.dialog.locator('#otherCostIsCommisionable');
    this.crossValidationAlert = this.dialog.locator('.alert.alert-info');
    this.saveButton = this.dialog.getByRole('button', { name: /^\s*(guardar|save)\s*$/i });
    this.cancelButton = this.dialog.getByRole('button', { name: /^\s*(cancelar|cancel)\s*$/i });
  }

  /** El modal debe estar abierto antes de operarlo. */
  async expectVisible(): Promise<void> {
    await expect(this.dialog, 'el modal de concepto de Otros Costos debe abrirse').toBeVisible({
      timeout: 15_000
    });
  }

  /** Descripción (input de texto plano con ngModel: `fill` es fiable) con lectura de vuelta. */
  async fillDescription(text: string): Promise<void> {
    await this.descriptionInput.fill(text);
    await expect(this.descriptionInput).toHaveValue(text);
  }

  /**
   * Elige el Tipo. El panel de ng-select se pinta fuera del modal, por eso la opción se ancla a
   * `ng-dropdown-panel` de la página. Efecto observable: el combo queda con esa etiqueta.
   */
  async selectType(type: OtherCostFormType): Promise<void> {
    await this.typeSelect.click();
    const option = this.page
      .locator('ng-dropdown-panel')
      .getByRole('option', { name: TYPE_LABELS[type] });
    await expect(option, `el combo Tipo debe ofrecer ${type}`).toHaveCount(1, { timeout: 10_000 });
    await option.click();
    await expect(this.typeValue, `el Tipo debe quedar en ${type}`).toHaveText(TYPE_LABELS[type]);
  }

  /** Valor de venta (o Tope de venta en VAR). */
  async setSaleValue(amount: number): Promise<void> {
    await expect(this.saleInput, 'el campo de venta aparece al elegir el Tipo').toBeVisible();
    await this.fillMoney(this.saleInput, amount);
  }

  /** Enciende/apaga el interruptor Costo y verifica el estado resultante. */
  async setCostToggle(on: boolean): Promise<void> {
    await this.costSwitch.setChecked(on);
    await expect(this.costSwitch).toBeChecked({ checked: on });
  }

  /** Valor de costo (requiere Costo encendido en un no-VAR). */
  async setCost(amount: number): Promise<void> {
    await expect(this.costInput, 'con Costo encendido debe verse el valor de costo').toBeVisible();
    await this.fillMoney(this.costInput, amount);
  }

  /** Marca/desmarca las opciones de «Disponible para» indicadas (las omitidas no se tocan). */
  async setAvailability(options: {
    driver?: boolean;
    carrier?: boolean;
    pax?: boolean;
  }): Promise<void> {
    const targets: [Locator, boolean | undefined][] = [
      [this.driverCheckbox, options.driver],
      [this.carrierCheckbox, options.carrier],
      [this.paxCheckbox, options.pax]
    ];
    for (const [checkbox, value] of targets) {
      if (value === undefined) continue;
      await checkbox.setChecked(value);
      await expect(checkbox).toBeChecked({ checked: value });
    }
  }

  /** Enciende/apaga Comisiona y verifica el estado resultante. */
  async setCommissionable(on: boolean): Promise<void> {
    await this.commissionableSwitch.setChecked(on);
    await expect(this.commissionableSwitch).toBeChecked({ checked: on });
  }

  /** Importe del campo de venta, parseado (compuerta previa a Guardar). */
  async readSaleValue(): Promise<number> {
    return parseMoney(await this.saleInput.inputValue());
  }

  /** Importe del campo de costo, parseado. */
  async readCostValue(): Promise<number> {
    return parseMoney(await this.costInput.inputValue());
  }

  /**
   * Guarda. Efecto observable: el modal se cierra (`saveOtherCost` cierra al recibir 200,
   * ts:701-730). Si Guardar está deshabilitado falla explícito: para aseverar el bloqueo usar
   * `saveButton` + `toBeDisabled()` en el test.
   */
  async save(): Promise<void> {
    await expect(this.saveButton, 'Guardar debe estar habilitado para guardar').toBeEnabled();
    await this.saveButton.click();
    await expect(this.dialog, 'guardar debe cerrar el modal').toBeHidden({ timeout: 15_000 });
  }

  /** Cierra sin guardar por el Cancelar del footer. */
  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.dialog, 'Cancelar debe cerrar el modal').toBeHidden({ timeout: 10_000 });
  }

  /**
   * Entrada confiable de importes en un campo `currencyInput` (plan smoke ABM §A.4):
   * 1. click + Ctrl/Cmd+A + Delete y confirmar el campo vacío;
   * 2. una tecla real por carácter, esperando (poll) que los dígitos del campo sean los tipeados:
   *    detecta en el acto el primer dígito perdido por el `select()` diferido del focus;
   * 3. Tab (blur: el campo formatea a 2 decimales);
   * 4. releer y comparar con `parseMoney`; si difiere, reintentar desde 1 (máx. 3) y, agotados,
   *    lanzar «la máscara no aceptó el importe» (falla de automatización, no bug de producto).
   * Soporta enteros y decimales con «.» (la directiva acepta el separador de miles como decimal
   * alternativo si todavía no hay separador decimal).
   */
  async fillMoney(input: Locator, amount: number): Promise<void> {
    const text = String(amount);
    let lastRead = '';
    let lastProblem = '';
    for (let attempt = 1; attempt <= MONEY_ATTEMPTS; attempt += 1) {
      await input.click();
      await input.press('ControlOrMeta+A');
      await input.press('Delete');
      await expect(input, 'el campo de importe debe quedar vacío antes de tipear').toHaveValue('');

      let typed = '';
      let echoed = true;
      for (const char of text) {
        await input.press(char);
        typed += char;
        const expectedDigits = typed.replace(/\D/g, '');
        echoed = await expect
          .poll(async () => (await input.inputValue()).replace(/\D/g, ''), {
            timeout: KEY_ECHO_TIMEOUT_MS
          })
          .toBe(expectedDigits)
          .then(() => true)
          .catch(() => false);
        if (!echoed) {
          lastProblem = `tras tipear «${typed}» el campo mostraba «${await input.inputValue()}»`;
          break;
        }
      }
      if (!echoed) continue;

      await input.press('Tab');
      lastRead = await input.inputValue();
      let parsed: number | null = null;
      try {
        parsed = parseMoney(lastRead);
      } catch {
        parsed = null;
      }
      if (parsed === amount) return;
      lastProblem = `tras el blur el campo mostraba «${lastRead}»`;
    }
    throw new Error(
      `la máscara no aceptó el importe ${text} en ${MONEY_ATTEMPTS} intentos (${lastProblem}; último leído «${lastRead}»)`
    );
  }
}
