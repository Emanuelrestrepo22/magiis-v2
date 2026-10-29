// tests/pages/carrier-v2/trips/TravelDetailPage.ts
// Detalle de viaje NATIVO de la V2 (`TravelDetailNativeComponent`, ruta `travel/detail/:id`,
// carrier.routing.ts:243). No hay iframe V1 en esta ruta: el componente iframe
// (`travel-detail.component.html`) no esta enrutado aca.
//
// PROVENIENCIA DE SELECTORES: relevamiento
// docs/analysis/migration-evidence/new-trip-other-costs-2026-09-29.md §5, verificado contra
// magiis-fe-carrier-v2 origin/release/v2.0.17 (commit 6e39104c), rutas relativas a
// `src/app/pages/carrier/trips/travel-detail/native/`:
// - `travel-detail-native.component.html:1-44` (breadcrumb, h2 «Trip detail», subtitulo con codigo)
// - `components/budgeted-form/travel-detail-budgeted-form.component.html:5-8, 382-412`
// Card «Datos Finales»: se modela solo la métrica «Distancia» (`readFinalDistance`, MG-1190 TC1).
// Rediseño del build `main.4d47650bd0fa6da3` (08/10/2026): tarjetas `.fd-metric` con rótulo,
// valor y unidad en nodos separados, sin «:» (antes «Distancia: 6.81 Mi»).
// El POM soporta las DOS disposiciones y declara cuál detectó (`finalDistanceLayout`): `cards`
// (TEST, build 4d47650b…) e `inline` (UAT, build adabeaba…: «Distance: 6.38 Mi» dentro de
// `app-travel-detail-final-data-form`). Si no hay ninguna, falla; no hay lectura de reserva.
//
// HALLAZGO D1 (NO ES ORACULO): el widget «Datos Presupuestados» recalcula cada linea como
// `quantity * price` (travel-detail-native.component.ts:1522-1532), pero el alta manda
// `price = total de la linea` (new-trip.component.ts:6086-6092). Con un concepto Cantidad y
// cantidad > 1 el widget multiplica de mas. `readBudgetedOtherCosts()` expone ese valor SOLO para
// registrarlo como medicion (annotation `known-defect: D1`); la persistencia se asevera contra la
// API (`simulationPrice.otherCosts`) o el listado, nunca contra este widget.
/**
 * @jira MG-995
 * @route /carrier/#/travel/detail/:id
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';
import { parseLocalizedNumber, type DistanceReading } from '../../../utils/units.js';

export class TravelDetailPage extends BaseDetailPage {
  /** h2 `.detail-header__name` = `detail_edit_travel.title_detail` (native html:23-28). */
  protected get headingRegex(): RegExp {
    return /^\s*(trip detail|detalle de viaje)\s*$/i;
  }

  /**
   * Subtitulo con el codigo del viaje `{{travelIdForCarrier}}-{{channel}}` (native html:41-43).
   * Solo se pinta con `*ngIf="travelDetail"`: es la señal observable de que el GET del detalle
   * respondio y la pantalla tiene datos.
   */
  readonly tripCode: Locator;

  // === Card «Datos Presupuestados» / «Budgeted Trip» (widget con D1) ===
  /** Card completa (`app-travel-detail-budgeted-form`). */
  readonly budgetedCard: Locator;
  /**
   * Fila «Otros Costos» presupuestada (budgeted html:382-412). OCULTA en modo lectura si
   * `totalOtherCosts === 0` y siempre con `FARM_IN` / `OFFERER`: su ausencia NO prueba "0 conceptos"
   * por si sola (usar la API para eso).
   */
  readonly budgetedOtherCostsRow: Locator;

  // === Card «Datos Finales» (tarjetas `.fd-metric`, build 08/10/2026) ===
  /** Tarjeta «Distance» / «Distancia» de «Datos Finales» (rótulo exacto, EN/ES). */
  readonly finalDistanceCard: Locator;
  /**
   * Disposición ANTERIOR (UAT, build adabeaba…): renglón en línea dentro de «Final Information» /
   * «Datos Finales»: `<span><span.fw-medium>Distance:</span><span> 6.38 Mi</span></span>`. Se
   * acota al componente de datos finales: otro bloque de la pantalla también dice «Distance:».
   */
  readonly finalDistanceInline: Locator;

  constructor(page: Page) {
    super(page);

    this.finalDistanceCard = page.locator('.fd-metric').filter({
      has: page.locator('.fd-metric-label', { hasText: /^\s*(distance|distancia)\s*$/i })
    });
    this.finalDistanceInline = page
      .locator('app-travel-detail-final-data-form span')
      .filter({
        has: page.locator(':scope > span.fw-medium', {
          hasText: /^\s*(distance|distancia)\s*:\s*$/i
        })
      })
      .first();

    this.tripCode = page.locator('p.detail-header__subtitle');

    this.budgetedCard = page.locator('app-travel-detail-budgeted-form');
    this.budgetedOtherCostsRow = this.budgetedCard
      .locator('div.d-flex.justify-content-between.align-items-center.mb-1')
      .filter({ has: page.getByText(/^\s*(otros costos|other costs)\s*$/i) });
  }

  /**
   * Abre el detalle de un viaje. Entra por `about:blank` y un `goto` absoluto (plan §10): desde
   * Nuevo Viaje un cambio de hash dejaria actuar al `pendingChangesGuard` y al router sobre la vista
   * vieja. Espera el heading y el codigo del viaje (datos cargados), no solo la URL.
   */
  async goto(travelId: string | number): Promise<void> {
    await this.page.goto('about:blank');
    await this.navigate(`/carrier/#/travel/detail/${travelId}`);
    await expect(this.heading, 'el detalle nativo de la V2 debe renderizarse').toBeVisible({
      timeout: 30_000
    });
    await expect(
      this.tripCode,
      `el detalle debe cargar los datos del viaje ${travelId} (GET travels/{id})`
    ).toBeVisible({ timeout: 30_000 });
    await expect(this.budgetedCard).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Importe crudo de la fila «Otros Costos» del widget «Datos Presupuestados». **NO ES ORACULO
   * (D1)** para conceptos Cantidad: con cantidad > 1 muestra `quantity × total`.
   * - `expectRow: true` (el test asevera la fila): espera a que la fila sea visible (retry de
   *   Playwright) antes de leer; si no aparece, falla con el mensaje de la expectativa.
   * - `expectRow: false` (solo medicion D1): lectura puntual; `null` si la fila no esta (oculta
   *   en lectura con total 0, o FARM_IN / OFFERER) o todavia no se pinto. Nunca prueba "0 conceptos".
   */
  async readBudgetedOtherCosts(options: { expectRow: boolean }): Promise<string | null> {
    const row = this.budgetedOtherCostsRow;
    if (options.expectRow) {
      await expect(row, 'el widget presupuestado debe mostrar la fila Otros Costos').toBeVisible({
        timeout: 15_000
      });
    } else if ((await row.count()) === 0) {
      return null;
    }
    // Segundo <span> de la fila: importe (+ lapiz solo en modo edicion, sin texto).
    return ((await row.locator(':scope > span').nth(1).textContent()) ?? '').trim();
  }

  /**
   * Disposición de «Datos Finales» que está en pantalla: `cards` (rediseño) o `inline` (anterior).
   * `null` si no hay ninguna de las dos (todavía no cargó o el DOM cambió): el llamador decide
   * esperar o fallar; no hay lectura de reserva.
   */
  async finalDistanceLayout(): Promise<FinalDistanceLayout | null> {
    if ((await this.finalDistanceCard.count()) > 0) return 'cards';
    if ((await this.finalDistanceInline.count()) > 0) return 'inline';
    return null;
  }

  private async requireLayout(): Promise<FinalDistanceLayout> {
    const layout = await this.finalDistanceLayout();
    if (layout === null) {
      throw new Error(
        '«Datos Finales › Distancia» no aparece en ninguna de las dos disposiciones conocidas: ' +
          'tarjeta `.fd-metric` (rediseño) ni renglón «Distance:/Distancia:» en ' +
          '`app-travel-detail-final-data-form` (anterior)'
      );
    }
    return layout;
  }

  /**
   * Texto completo del bloque «Distancia» de «Datos Finales» (rótulo + valor + unidad), para
   * buscar la unidad equivocada. Falla si no hay ninguna disposición.
   */
  async finalDistanceText(): Promise<string> {
    const layout = await this.requireLayout();
    const block = layout === 'cards' ? this.finalDistanceCard : this.finalDistanceInline;
    return (await block.innerText()).replace(/\s+/g, ' ').trim();
  }

  /**
   * Lectura «número + unidad» de «Datos Finales › Distancia» y la disposición de la que salió.
   * `decimalHint` = separador decimal del carrier ('.' US, ',' AR). Lanza si no hay ninguna
   * disposición; `null` solo si el bloque existe pero no trae «número + unidad».
   */
  async readFinalDistance(decimalHint: '.' | ','): Promise<FinalDistanceReading | null> {
    const layout = await this.requireLayout();
    let value: string;
    let unit: string;
    if (layout === 'cards') {
      value = await this.finalDistanceCard.locator('.fd-metric-value').innerText();
      unit = await this.finalDistanceCard.locator('.fd-metric-unit').innerText();
    } else {
      // «<valor> <unidad>» en el segundo <span> del renglón, p. ej. « 6.38 Mi».
      const text = (await this.finalDistanceInline.locator(':scope > span').nth(1).innerText())
        .replace(/\s+/g, ' ')
        .trim();
      const match = /^(-?\d[\d.,]*)\s*(\S+)$/.exec(text);
      if (!match) return null;
      [, value, unit] = match;
    }
    const parsed = parseLocalizedNumber(value.trim(), decimalHint);
    const cleanUnit = unit.trim();
    if (Number.isNaN(parsed) || !/^(mi|km)$/i.test(cleanUnit)) return null;
    return {
      value: parsed,
      unit: cleanUnit.toLowerCase() === 'mi' ? 'Mi' : 'km',
      layout
    };
  }
}

/** Disposición de «Datos Finales»: tarjetas `.fd-metric` (rediseño) o renglón en línea (anterior). */
export type FinalDistanceLayout = 'cards' | 'inline';

export interface FinalDistanceReading extends DistanceReading {
  layout: FinalDistanceLayout;
}
