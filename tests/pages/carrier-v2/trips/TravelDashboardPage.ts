// tests/pages/carrier-v2/trips/TravelDashboardPage.ts
/**
 * @jira MX-5529
 * @route /carrier/#/travel/dashboard
 * @priority P1
 * @type functional
 * @note Listado de Viajes - panel principal con tabs por estado + asignacion automatica.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export type TravelTab =
  | 'assign'
  | 'in-progress'
  | 'programmed'
  | 'in-conflict'
  | 'lost'
  | 'cancelled'
  | 'finalized';

export class TravelDashboardPage extends BaseListPage {
  readonly path = '/carrier/#/travel/dashboard';

  protected get headingRegex(): RegExp {
    // El portal V2 renderiza solo "Trips Management" como h4 (no h2). Aceptamos
    // varias variantes para tolerar futuros refactors.
    return /trips? management|gesti[oó]n de viajes|stable trips|trips? dashboard|asignaci[oó]n/i;
  }

  readonly automaticAssignmentCheckbox: Locator;
  readonly vipCheckbox: Locator;
  readonly tabAssign: Locator;
  readonly tabInProgress: Locator;
  readonly tabProgrammed: Locator;
  readonly tabInConflict: Locator;
  readonly tabLost: Locator;
  readonly tabCancelled: Locator;
  readonly tabFinalized: Locator;

  constructor(page: Page) {
    super(page);
    this.automaticAssignmentCheckbox = page.getByRole('checkbox', {
      name: /automatic assignment|asignaci[oó]n autom/i
    });
    this.vipCheckbox = page.getByRole('checkbox', { name: /^vip$/i });
    this.tabAssign = page.getByRole('tab', { name: /assign\s*\(\d+\)/i });
    this.tabInProgress = page.getByRole('tab', {
      name: /in progress\s*\(\d+\)|en curso\s*\(\d+\)/i
    });
    this.tabProgrammed = page.getByRole('tab', {
      name: /programmed\s*\(\d+\)|programados?\s*\(\d+\)/i
    });
    this.tabInConflict = page.getByRole('tab', {
      name: /in conflict\s*\(\d+\)|en conflicto\s*\(\d+\)/i
    });
    this.tabLost = page.getByRole('tab', { name: /^lost\s*\(\d+\)|perdidos?\s*\(\d+\)/i });
    this.tabCancelled = page.getByRole('tab', {
      name: /cancelled\s*\(\d+\)|cancelados?\s*\(\d+\)/i
    });
    this.tabFinalized = page.getByRole('tab', {
      name: /finalized\s*\(\d+\)|finalizados?\s*\(\d+\)/i
    });
  }

  async selectTab(tab: TravelTab): Promise<void> {
    const map: Record<TravelTab, Locator> = {
      assign: this.tabAssign,
      'in-progress': this.tabInProgress,
      programmed: this.tabProgrammed,
      'in-conflict': this.tabInConflict,
      lost: this.tabLost,
      cancelled: this.tabCancelled,
      finalized: this.tabFinalized
    };
    await map[tab].click();
  }

  /**
   * Fila del listado que corresponde a un viaje, identificada por los datos con los
   * que se creo. La grilla NO expone el travelId ni un data-testid: la columna Code
   * muestra un correlativo por carrier (ej. "1-W"), asi que la unica forma estable de
   * ubicar la fila desde el test es por su contenido.
   *
   * Verificado contra el row real de un viaje recien creado (estado Searching Driver).
   */
  rowByTrip(datos: { passenger: string; origin: string; destination: string }): Locator {
    return this.table
      .locator('tbody tr')
      .filter({ hasText: datos.passenger })
      .filter({ hasText: datos.origin })
      .filter({ hasText: datos.destination });
  }

  /**
   * Cantidad que muestra el contador del tab, ej. "Assign (1)" -> 1.
   * Sirve para verificar el delta al crear un viaje.
   */
  async getTabCount(tab: TravelTab): Promise<number> {
    const map: Record<TravelTab, Locator> = {
      assign: this.tabAssign,
      'in-progress': this.tabInProgress,
      programmed: this.tabProgrammed,
      'in-conflict': this.tabInConflict,
      lost: this.tabLost,
      cancelled: this.tabCancelled,
      finalized: this.tabFinalized
    };
    const label = await map[tab].innerText();
    const match = label.match(/\((\d+)\)/);
    if (!match) {
      throw new Error(`El tab "${tab}" no expone un contador: "${label}"`);
    }
    return Number(match[1]);
  }

  async expectTabsReady(): Promise<void> {
    await expect(this.tabAssign).toBeVisible();
    await expect(this.tabInProgress).toBeVisible();
    await expect(this.tabFinalized).toBeVisible();
  }

  // === MG-995/MG-996 fase 1: Otros Costos (TM-1085, TM-1090) ===
  // Fuente: magiis-fe-carrier-v2 origin/release/v2.0.17 (commit 6e39104c),
  // `src/app/pages/carrier/trips/dashboard/trips-dashboard.component.html` y `.ts`.

  /**
   * Fila del listado por su codigo de viaje (columna Code = `item | travelChannel`, es decir
   * `travelIdForCarrier-<canal>`, p. ej. «1234-W»). La celda pinta el codigo en
   * `span.fw-semibold.text-nowrap` (html:342-350); se matchea EXACTO para que «12-W» no tome «112-W».
   */
  rowByCode(code: string): Locator {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.table.locator('tbody tr').filter({
      has: this.page.locator('td span.fw-semibold.text-nowrap', {
        hasText: new RegExp(`^\\s*${escaped}\\s*$`)
      })
    });
  }

  /**
   * Celda «Presup.» / «Budgeted» (`simPrice` = `item.simulatePrice`, html:531-539) de la fila con
   * ese codigo. Las columnas son configurables por el usuario (`columns[].visible`, ts:327-335), asi
   * que el indice se resuelve por el texto del encabezado visible en cada llamada, nunca fijo: `th` y
   * `td` salen del mismo `*ngFor` de columnas visibles (html:250-285 y 333-334), en el mismo orden.
   */
  async budgetCellByCode(code: string): Promise<Locator> {
    // Cada `th` suma el `span.drag-handle` «☰» (&#9776;, html:265 y 280): se quita antes de comparar.
    const headers = (await this.table.locator('thead th').allTextContents()).map((t) =>
      t.replace(/☰/g, '').trim()
    );
    const index = headers.findIndex((t) => /^(presup\.?|budgeted)$/i.test(t));
    if (index < 0) {
      throw new Error(
        `el listado no muestra la columna «Presup./Budgeted» (encabezados: ${headers.join(' | ')})`
      );
    }
    return this.rowByCode(code).locator('td').nth(index);
  }

  /**
   * Celda «Status» / «Estado» de la fila con ese codigo. Mismo criterio que `budgetCellByCode`:
   * el indice sale del encabezado visible en cada llamada (columnas configurables). Etiquetas
   * observadas en TEST (2026-10-13): tab Cancelled -> «Canceled» (una sola «l»), tab Finalized ->
   * «Completed». Los cierres administrativos no tenian filas en esa fecha: etiqueta sin confirmar.
   */
  async rowStatusByCode(code: string): Promise<Locator> {
    const headers = (await this.table.locator('thead th').allTextContents()).map((t) =>
      t.replace(/☰/g, '').trim()
    );
    const index = headers.findIndex((t) => /^(status|estado)$/i.test(t));
    if (index < 0) {
      throw new Error(
        `el listado no muestra la columna «Status/Estado» (encabezados: ${headers.join(' | ')})`
      );
    }
    const row = this.rowByCode(code);
    await expect(row).toHaveCount(1);
    return row.locator('td').nth(index);
  }

  /**
   * Filtra la grilla de la pestaña activa por el codigo de viaje (buscador + Enter) para que la
   * fila no dependa de la paginacion. Falla cerrado si no hay buscador: sin filtro no se puede
   * garantizar que la fila evaluada sea la del viaje (pestañas con muchas filas la paginan).
   */
  async filterByCode(code: string): Promise<void> {
    const search = this.page.getByRole('textbox', { name: /^(Buscar|Search)\.{3}$/ });
    await expect(
      search,
      'la grilla debe exponer el buscador ("Buscar..." / "Search...") para anclar la fila'
    ).toBeVisible({ timeout: 10_000 });
    // El buscador consulta `find=` en el servidor y solo matchea el id numerico: con el sufijo
    // «-W» devuelve «No data» (medido en TEST 2026-10-13), asi que se busca por el id.
    const idMatch = /^\d+/.exec(code);
    if (!idMatch) throw new Error(`codigo de viaje sin id numerico: «${code}»`);
    await search.fill(idMatch[0]);
    await search.press('Enter');
    // Unica espera: la fila del codigo EXACTO (rowByCode) debe quedar como unica coincidencia;
    // el id 234 puede traer tambien 1234-W, pero rowByCode no lo confunde.
    await expect(this.rowByCode(code)).toHaveCount(1, { timeout: 30_000 });
  }

  /** Abre la pestaña Cancelled y espera a que quede seleccionada. */
  async openCancelledTab(): Promise<void> {
    await this.selectTab('cancelled');
    await expect(this.tabCancelled).toHaveAttribute('aria-selected', 'true');
  }

  /** Abre la pestaña Finalized y espera a que quede seleccionada. */
  async openFinalizedTab(): Promise<void> {
    await this.selectTab('finalized');
    await expect(this.tabFinalized).toHaveAttribute('aria-selected', 'true');
  }

  // === Cancelacion por UI (limpieza de datos G5, TM-538) ===
  // Fuente: trips-dashboard.component.html:733-745 y 916-957 / .ts:1558-1599, 2573-2590
  // (magiis-fe-carrier-v2, origin/release/v2.0.14). Los locators se declaran como inicializadores
  // de campo (corren tras super()) para no tocar el constructor existente.

  /** Modal de confirmacion "Are you sure?" del cancelado. */
  readonly cancelModal: Locator = this.page
    .locator('ngb-modal-window')
    .filter({ hasText: /are you sure|est[aá]s? segur/i });
  /** Textarea de motivo del modal de cancelacion (maxlength 150). */
  readonly cancelMotiveTextarea: Locator = this.cancelModal.locator('textarea');
  /** Boton "Confirm" / "Confirmar" del footer del modal. */
  readonly cancelConfirmButton: Locator = this.cancelModal.getByRole('button', {
    name: /^(confirm|confirmar)$/i
  });

  /**
   * Icono de cancelar dentro de una fila. La fila de un viaje en busqueda de chofer trae DOS
   * `button.btn-danger.btn-icon` ("Stop Assignment" y "Cancel", medido 2026-09-30): "Cancel" es el
   * ultimo de la celda de acciones. Un boton equivocado falla en la validacion del modal de
   * `cancelTripByPassenger` y no cancela nada.
   */
  cancelTripButtonInRow(row: Locator): Locator {
    return row.locator('button.btn-danger.btn-icon').last();
  }

  /**
   * Cancela por UI el viaje cuya fila contiene `passengerName`. Devuelve `true` si la fila
   * desaparece de la pestana actual tras confirmar, `false` si algun paso no se pudo completar
   * (el llamador decide como reportarlo).
   */
  async cancelTripByPassenger(passengerName: string, motive: string): Promise<boolean> {
    const row = this.table.locator('tbody tr').filter({ hasText: passengerName }).first();
    const rowVisible = await row
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!rowVisible) return false;

    await this.cancelTripButtonInRow(row).click();
    const modalVisible = await this.cancelModal
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!modalVisible) return false;

    await this.cancelMotiveTextarea.fill(motive);
    await this.cancelConfirmButton.click();

    return row
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
  }
  // === MG-1190 TC3 (TM-1307): columna «Distancia al Pasajero» en la unidad del carrier ===
  // Observación PASIVA de `GET carriers/{id}/travels/paginated?size=20&state=…` (respuesta
  // `page.content[]` con `travelIdForCarrier`, `channel` y `distanceToPPUP` en km). Solo lectura:
  // no se toca ningún botón de fila («A» dispara asignación automática) ni el interruptor.

  /** Prefijo del parámetro `state` que dispara cada pestaña con datos de distancia al pasajero. */
  static readonly TAB_STATE_PREFIX: Partial<Record<TravelTab, string>> = {
    assign: 'SEARCHING_DRIVER',
    programmed: 'SCHEDULED',
    'in-conflict': 'NO_AUTH'
  };

  private waitForTabRows(tab: TravelTab): Promise<DashboardRow[]> {
    const prefix = TravelDashboardPage.TAB_STATE_PREFIX[tab];
    if (prefix === undefined) throw new Error(`la pestaña «${tab}» no tiene estado mapeado`);
    return this.page
      .waitForResponse(
        (r) => {
          const url = new URL(r.url());
          return (
            r.request().method() === 'GET' &&
            url.pathname.endsWith('/travels/paginated') &&
            url.searchParams.get('size') === '20' &&
            (url.searchParams.get('state') ?? '').startsWith(prefix)
          );
        },
        { timeout: 30_000 }
      )
      .then(async (response) => {
        const body = (await response.json()) as {
          page?: {
            content?: {
              travelIdForCarrier: number;
              channel: string;
              distanceToPPUP: number | null;
            }[];
          };
        };
        return (body.page?.content ?? []).map((item) => ({
          code: `${item.travelIdForCarrier}-${item.channel}`,
          // Sufijo de canal opcional: el pipe travelChannel solo lo pinta para canales de
          // TravelChannelEnum (+ ERS→ER); p. ej. canal «S» se ve «15515» a secas (medido 2026-10-30).
          codePattern: new RegExp(String.raw`^\s*${item.travelIdForCarrier}(/\d+)?(-[A-Z]+)?\s*$`),
          distanceToPPUP: item.distanceToPPUP
        }));
      });
  }

  /**
   * Navega al tablero y devuelve las filas de la pestaña `tab` según la API: Asignar es la
   * inicial (su consulta sale con la carga); las demás se abren con un clic en la pestaña.
   */
  async gotoAndCapture(tab: TravelTab): Promise<DashboardRow[]> {
    const initial = this.waitForTabRows('assign');
    await this.goto();
    const assignRows = await initial;
    return tab === 'assign' ? assignRows : this.openTabAndCapture(tab);
  }

  /** Abre una pestaña y devuelve sus filas (primera página) según la API. */
  async openTabAndCapture(tab: TravelTab): Promise<DashboardRow[]> {
    const rows = this.waitForTabRows(tab);
    await this.selectTab(tab);
    return rows;
  }

  /**
   * Celda «Distancia al Pasajero» / «Distance to Passenger» de la fila en la posición `position`
   * (0 = primera) y el código visible de esa fila. Se empareja por POSICIÓN porque la grilla puede
   * pintar un subíndice en el código («4598/1-W» para `travelIdForCarrier` 4598); el llamador
   * verifica el código con `DashboardRow.codePattern`. El índice de columna se resuelve por el
   * encabezado visible en cada llamada (columnas configurables), nunca fijo.
   */
  async distanceToPassengerCellAt(position: number): Promise<{ cell: Locator; code: Locator }> {
    const headers = (await this.table.locator('thead th').allTextContents()).map((t) =>
      t.replace(/☰/g, '').trim()
    );
    const index = headers.findIndex((t) =>
      /^(distance to passenger|distancia al pasajero)$/i.test(t)
    );
    if (index < 0) {
      throw new Error(
        `el listado no muestra la columna «Distancia al Pasajero» (encabezados: ${headers.join(' | ')})`
      );
    }
    const row = this.table.locator('tbody tr').nth(position);
    return {
      cell: row.locator('td').nth(index),
      code: row.locator('td span.fw-semibold.text-nowrap').first()
    };
  }
}

/** Fila del listado de viajes según la API (primera página de una pestaña). */
export interface DashboardRow {
  /** Código esperado `travelIdForCarrier-channel`. */
  code: string;
  /** Código visible esperado: subíndice opcional («4598/1-W») y canal que la grilla puede abreviar («ERS» se ve «ER») u omitir (canal fuera de TravelChannelEnum), por eso solo se fija el id. */
  codePattern: RegExp;
  /** Crudo en km (`distanceToPPUP`). */
  distanceToPPUP: number | null;
}
