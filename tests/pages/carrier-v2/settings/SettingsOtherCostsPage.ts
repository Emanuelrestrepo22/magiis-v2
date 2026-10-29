// tests/pages/carrier-v2/settings/SettingsOtherCostsPage.ts
/**
 * @jira MX-5575
 * @route /carrier/#/settings/otherCosts
 * @priority P3
 * @type functional
 */
import type { Locator, Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

/** Celdas de una fila del ABM, como texto crudo (espacios normalizados), por encabezado. */
export type OtherCostGridRow = {
  description: string;
  type: string;
  costSale: string;
  currency: string;
  saleValue: string;
  costValue: string;
  availability: string;
  commissionable: string;
};

/** Encabezados del ABM (regex bilingüe ES/EN, textos de es-ar.json / en-us.json v2.0.17). */
export const OTHER_COSTS_GRID_HEADERS: Record<keyof OtherCostGridRow, RegExp> = {
  description: /^(descripci[oó]n|description)$/i,
  type: /^(tipo|type)$/i,
  costSale: /^(costo - venta|cost - sale)$/i,
  currency: /^(moneda|currency)$/i,
  saleValue: /^(valor venta|sale value)$/i,
  costValue: /^(valor costo|cost value)$/i,
  availability: /^(disponible para|availability)$/i,
  commissionable: /^(comisionable|commisionable|commissionable)$/i
};

/** Escapa un texto literal para usarlo dentro de un RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Texto de celda/encabezado sin el asa de arrastre «☰» y con espacios normalizados. */
function cleanCellText(text: string): string {
  return text.replace(/☰/g, '').replace(/\s+/g, ' ').trim();
}

export class SettingsOtherCostsPage extends BaseListPage {
  readonly path = '/carrier/#/settings/otherCosts';
  protected get headingRegex(): RegExp {
    return /other costs|otros costos/i;
  }
  constructor(page: Page) {
    super(page);
  }

  // === Smoke ABM (MG-995/MG-996, ATR TM-1281) — miembros agregados, sin tocar lo anterior ===
  // PROVENIENCIA: recon R2 en UAT (v2.0.17, 2026-09-29) + `magiis-fe-carrier-v2`
  // origin/release/v2.0.17 (6e39104c), src/app/pages/carrier/settings/otherCosts/
  // settings-otherCosts.component.html. Ver docs/analysis/migration-evidence/other-costs-abm-2026-09-29.md.

  /** «Nuevo Costo» / «New Cost» (html:35-38). */
  readonly newCostButton: Locator = this.page.getByRole('button', {
    name: /nuevo costo|new cost/i
  });
  /**
   * Tabla del ABM por CSS (`<table class="table">`, html:43), NO por rol: tras el aviso de éxito
   * de un alta/edición/baja la app deja `app-root` con `aria-hidden="true"` (carrera NgbModal ↔
   * SweetAlert2, reproducida en UAT v2.0.17 el 2026-09-29) y `getByRole('table')` deja de verla.
   * Es un defecto de accesibilidad de la app que se informa aparte; el oráculo funcional de la
   * grilla no depende de él.
   */
  readonly gridTable: Locator = this.page.locator('table.table').first();
  /** Encabezados de columna del ABM; incluye la columna final de configuración (html:49-71). */
  readonly columnHeaders: Locator = this.gridTable.locator('thead th');
  /** Filas de datos (html:75); el ABM no pinta filas placeholder. */
  readonly dataRows: Locator = this.gridTable.locator('tbody tr');
  /** Modal de baja: título «Eliminar - Otro Costo» / «Delete - Other Cost» (html:379-399). */
  readonly deleteDialog: Locator = this.page.getByRole('dialog').filter({
    has: this.page.getByRole('heading', {
      name: /(eliminar\s*-\s*otro costo|delete\s*-\s*other cost)/i
    })
  });
  /** «Aceptar» del modal de baja (html:394-397). */
  readonly deleteAcceptButton: Locator = this.deleteDialog.getByRole('button', {
    name: /^(aceptar|accept)$/i
  });
  /**
   * Toast del ABM: SweetAlert2 (`AlertService.toastSuccess`, services/components/alerts/
   * alert.service.ts:30-37, `timer: 3000`), NO el `.toast-message` de `BasePage.expectToast`.
   */
  readonly swalToast: Locator = this.page.locator('.swal2-popup');
  /** Footer de la app con «v2.x.y» (mismo criterio que NewTripPage.appFooter). */
  readonly appFooter: Locator = this.page.locator('footer.footer');

  /** Toast SweetAlert2 con el texto dado (se asevera en el test con `toBeVisible`). */
  toast(text: RegExp): Locator {
    return this.swalToast.filter({ hasText: text });
  }

  /** Fila cuya celda de descripción es EXACTAMENTE `name` (nunca por "contiene"). */
  rowByName(name: string): Locator {
    return this.dataRows.filter({
      has: this.page.locator('td').filter({
        hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`)
      })
    });
  }

  /**
   * Botón Editar de la fila (lápiz, html:122-126). Es un botón de ícono SIN nombre accesible
   * (solo `ngbTooltip`, que no aporta nombre): se ancla por el ícono `i.bx-pencil` dentro de la
   * fila del concepto. Hallazgo de accesibilidad: falta `aria-label`.
   */
  editButtonFor(name: string): Locator {
    return this.rowByName(name).locator('button:has(i.bx-pencil)');
  }

  /** Botón Eliminar de la fila (papelera, html:127-131), mismo criterio que `editButtonFor`. */
  deleteButtonFor(name: string): Locator {
    return this.rowByName(name).locator('button:has(i.bx-trash)');
  }

  /** Textos de los encabezados visibles, sin el asa «☰» (la última es la de configuración, vacía). */
  async headerTexts(): Promise<string[]> {
    return (await this.columnHeaders.allTextContents()).map(cleanCellText);
  }

  /**
   * Lee la fila del concepto mapeando cada celda por el texto de su encabezado: el orden de las
   * columnas es configurable por usuario (drag & drop + configuración guardada), así que no se
   * asume posición. Falla si falta un encabezado.
   */
  async readRow(name: string): Promise<OtherCostGridRow> {
    const headers = await this.headerTexts();
    const cells = (await this.rowByName(name).first().locator('td').allTextContents()).map(
      cleanCellText
    );
    const read = (key: keyof OtherCostGridRow): string => {
      const index = headers.findIndex((h) => OTHER_COSTS_GRID_HEADERS[key].test(h));
      if (index < 0 || index >= cells.length) {
        throw new Error(
          `la grilla de Otros Costos no muestra la columna «${key}» (encabezados: ${headers.join(' | ')})`
        );
      }
      return cells[index];
    };
    return {
      description: read('description'),
      type: read('type'),
      costSale: read('costSale'),
      currency: read('currency'),
      saleValue: read('saleValue'),
      costValue: read('costValue'),
      availability: read('availability'),
      commissionable: read('commissionable')
    };
  }

  /**
   * Valor de `aria-hidden` del contenedor raíz de la app (`app-root`). Tras el aviso de éxito
   * debería volver a null; `'true'` = la pantalla quedó oculta para tecnologías asistivas.
   */
  async appRootAriaHidden(): Promise<string | null> {
    return this.page.locator('app-root').getAttribute('aria-hidden');
  }

  /** Versión del front leída del footer («v2.0.17» → «2.0.17»), o null. */
  async appVersion(): Promise<string | null> {
    const text =
      (await this.appFooter
        .first()
        .textContent()
        .catch(() => null)) ?? '';
    return text.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? null;
  }
}
