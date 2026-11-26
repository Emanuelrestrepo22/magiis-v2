// tests/pages/carrier-v2/settings/ReferencePointsPage.ts
// ABM de Configuración › Puntos de referencia (MG-1132 / MG-1763). Listado a la izquierda, mapa Leaflet
// `#waypointsListMap` a la derecha con un pin por fila. Textos de UI en EN (locale en-US).
// PROVENIENCIA: recon en TEST el 19/11/2026 (v2.0.22): filas con `.mg-wp-cell` (nombre, atributo
// `title` = nombre completo) y `.mg-wp-coords-cell`; botones de acción con `title` (sin nombre accesible por rol;
// «Show Location»/«Edit»/«Delete»); baja con SweetAlert2 («Delete reference
// point»); pie `.dataTables_info` «1 of 1 · Total: N». Sin reglas de negocio: solo estado de UI.
/**
 * @jira MG-1132
 * @route /carrier/#/settings/waypoints
 * @priority P1
 * @type functional
 */
import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';
import type { WaypointDto } from '../../../api/clients/waypoints.client.js';

export class ReferencePointsPage extends BaseListPage {
  readonly path = '/carrier/#/settings/waypoints';
  protected get headingRegex(): RegExp {
    return /reference points|puntos de referencia/i;
  }

  readonly newButton: Locator;
  readonly dataRows: Locator;
  readonly totalLabel: Locator;
  readonly deleteDialog: Locator;
  readonly deleteAcceptButton: Locator;
  readonly deleteCancelButton: Locator;
  /** Cuerpo del diálogo de baja: «Are you sure…» y, si el punto está en uso, el aviso de uso. */
  readonly usageNotice: Locator;
  /** Aviso modal tras crear un punto con advertencia NO_CITY («Google cannot identify the city of this point»). */
  readonly noCityNotice: Locator;
  readonly noticeAcceptButton: Locator;
  readonly mapMarkers: Locator;
  /** Mapa Leaflet del listado (no es el del modal). */
  readonly listMap: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page
      .getByTestId('waypoint-search')
      .or(page.getByRole('textbox', { name: /^search by name|buscar por nombre/i }))
      .first();
    this.newButton = page.getByRole('button', {
      name: /new reference point|nuevo punto de referencia/i
    });
    this.dataRows = this.table.locator('tbody tr').filter({ has: page.locator('.mg-wp-cell') });
    this.totalLabel = page.locator('.dataTables_info');
    this.deleteDialog = page.getByRole('dialog', {
      name: /delete reference point|eliminar punto de referencia/i
    });
    this.deleteAcceptButton = this.deleteDialog.locator('.swal2-confirm');
    this.deleteCancelButton = this.deleteDialog.locator('.swal2-cancel');
    this.usageNotice = this.deleteDialog.locator('.swal2-html-container');
    this.noCityNotice = page
      .getByRole('dialog')
      .filter({ hasText: /cannot identify the city|no puede identificar la ciudad/i });
    this.noticeAcceptButton = this.noCityNotice.locator('.swal2-confirm');
    this.listMap = page.locator('#waypointsListMap');
    this.mapMarkers = this.listMap.locator('.leaflet-marker-icon');
  }

  /** Fila por nombre EXACTO (atributo `title` de la celda); nunca por posición. */
  rowByName(name: string): Locator {
    return this.dataRows.filter({
      has: this.page.locator(`.mg-wp-cell[title=${JSON.stringify(name)}]`)
    });
  }

  // Botones de acción: `title` = etiqueta de UI («Edit», «Delete», «Show Location»).
  editButtonFor(name: string): Locator {
    return this.rowByName(name).getByTitle('Edit', { exact: true });
  }

  deleteButtonFor(name: string): Locator {
    return this.rowByName(name).getByTitle('Delete', { exact: true });
  }

  locationButtonFor(name: string): Locator {
    return this.rowByName(name).getByTitle('Show Location', { exact: true });
  }

  /** Espera la respuesta del `GET carriers/{id}/waypoint` que pinta el listado (armarla ANTES de la acción). */
  listResponse(): Promise<Response> {
    const response = this.page.waitForResponse(
      (r) => r.request().method() === 'GET' && /\/carriers\/\d+\/waypoint$/.test(r.url()),
      { timeout: 90_000 } // TEST llega a tardar más de 60 s por pantalla
    );
    response.catch(() => undefined); // sin ruido si la acción falla antes
    // El cuerpo se lee apenas llega la respuesta: tras una recarga el navegador lo descarta enseguida.
    const body = response.then((r) => r.json() as Promise<WaypointDto[]>);
    body.catch(() => undefined);
    this.bodies.set(response, body);
    return response;
  }

  /** Puntos que sirvió el servicio a la pantalla (cuerpo de la respuesta del listado). */
  async served(response: Promise<Response>): Promise<WaypointDto[]> {
    const body = this.bodies.get(response);
    if (!body)
      throw new Error('[ReferencePointsPage] served() recibe la promesa de listResponse()');
    return body;
  }

  private readonly bodies = new WeakMap<Promise<Response>, Promise<WaypointDto[]>>();

  /** Abre el ABM por URL y devuelve lo que sirvió el listado. */
  async gotoServed(): Promise<WaypointDto[]> {
    const response = this.listResponse();
    // Sin `super.goto()`: espera el encabezado solo 30 s y con TEST lento vence antes que la pantalla.
    await this.navigate(this.path);
    await expect(this.heading).toBeVisible({ timeout: 90_000 });
    await expect(this.newButton).toBeVisible();
    return this.settled(response);
  }

  /** Espera el GET del listado y que el pie ya muestre su total (antes de cargar dice «Total: 0»). */
  private async settled(response: Promise<Response>): Promise<WaypointDto[]> {
    const served = await this.served(response);
    await expect(this.totalLabel).toContainText(this.totalPattern(served.length));
    return served;
  }

  /** Recarga la pantalla (mismo hash: `goto` no pediría nada) y devuelve lo que sirvió el listado. */
  async reloadServed(): Promise<WaypointDto[]> {
    const response = this.listResponse();
    await this.page.reload();
    return this.settled(response);
  }

  /** Entra por el menú y devuelve lo que sirvió el listado. */
  async openFromMenuServed(): Promise<WaypointDto[]> {
    const response = this.listResponse();
    await this.openFromMenu();
    return this.settled(response);
  }

  /** Arma la espera del toast ANTES de la acción (dura ~3 s) y la confirma después. */
  async expectToastAfter(text: RegExp | string, action: () => Promise<void>): Promise<void> {
    const seen = this.toast(text).first().waitFor({ state: 'visible', timeout: 15_000 });
    seen.catch(() => undefined);
    await action();
    await seen;
  }

  /** Aviso de éxito/error: SweetAlert2 en modo toast (`.swal2-popup`, se cierra solo a los ~3 s). */
  toast(text: RegExp | string): Locator {
    return this.page.locator('.swal2-popup').filter({ hasText: text });
  }

  /** Coordenadas visibles de la fila («25.774830, -80.188490»). */
  async rowCoordinates(name: string): Promise<string> {
    return (await this.rowByName(name).locator('.mg-wp-coords-cell').innerText()).trim();
  }

  /** Referencia visible de la fila (conserva saltos de línea). */
  async rowReference(name: string): Promise<string> {
    // Tercera celda de la fila (punto de color, nombre+coordenadas, referencia, acciones).
    return (await this.rowByName(name).locator('td').nth(2).innerText()).trim();
  }

  /** Abre el ABM por URL y espera encabezado, botón de alta y el pie ya pintado con el total. */
  async goto(): Promise<void> {
    await this.gotoServed();
  }

  /** Entra por el menú lateral Configuración › Waypoints (la etiqueta del menú en EN es «Waypoints»). */
  async openFromMenu(): Promise<void> {
    const settings = this.page.getByRole('link', { name: /^(settings|configuraci)/i }).first();
    await expect(settings).toBeVisible();
    const entry = this.page.getByRole('link', { name: /^(waypoints|puntos de referencia)$/i });
    if (!(await entry.isVisible())) await settings.click();
    await entry.click();
    await expect(this.heading).toBeVisible({ timeout: 90_000 });
    await expect(this.totalLabel).toContainText(/Total:\s*\d+/);
  }

  /** «Total: n» con límite de palabra: «Total: 1» no acepta «Total: 12». */
  totalPattern(n: number): RegExp {
    return new RegExp(`Total: ${n}\\b`);
  }

  /** Total del pie «1 of N · Total: T». */
  async readTotal(): Promise<number> {
    const text = await this.totalLabel.innerText();
    const match = /Total:\s*(\d+)/.exec(text);
    if (!match) throw new Error(`[ReferencePointsPage] el pie no informa el total: «${text}»`);
    return Number(match[1]);
  }

  async search(text: string): Promise<void> {
    await this.searchInput.fill(text);
  }
}
