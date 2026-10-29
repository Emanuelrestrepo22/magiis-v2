// tests/steps/settings/otherCostsAbm.steps.ts
// Recorrido reusable del smoke automatizado del ABM de Otros Costos (MG-995/MG-996, ATR TM-1281).
// Plan MG-990-fase1/plan-automatizacion-smoke-abm.md §A.3 fila 5: precondición por API → acción
// en el ABM → captura de request/response → oráculo UI + API → evidencia → limpieza por API.
//
// Deuda anotada (plan §A.6, opción B): las utilidades de evidencia (`screenshot`,
// `attachMeasurement`, `comment`, `knownDefect`, cabecera) y la limpieza de conceptos duplican las
// de `tests/steps/trips/newTripWithOtherCosts.steps.ts`, que todavía no está commiteado. Una vez
// mergeados ambos, extraer `tests/steps/shared/evidence.ts` + un registro de conceptos común.
//
// Reglas:
// - Limpieza SIEMPRE (la dispara el fixture del spec aunque el test falle); solo toca conceptos de
//   ESTE test (ids registrados o nombres propios pendientes de resolver), nunca 27/34/38.
// - Evidencia sin token ni PII: lista blanca de campos; el `userId` del request de baja se informa
//   como coincidencia con la sesión, no como valor.
import type { Page, Request, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { SettingsOtherCostsPage } from '../../pages/carrier-v2/settings/SettingsOtherCostsPage.js';
import { OtherCostFormModalPage } from '../../pages/carrier-v2/settings/OtherCostFormModalPage.js';
import type { OtherCostItem, OtherCostsClient } from '../../api/clients/otherCosts.client.js';
import { SessionRejectedError, type CarrierSession } from '../../api/clients/carrierSession.js';
import {
  buildOtherCostName,
  makeRunId,
  type OtherCostContext,
  type OtherCostPayload
} from '../../fixtures/factories/otherCostFactory.js';
import type { OtherCostsEnvData } from '../../data/carrier-v2/trips/other-costs.js';
import type { OtherCostsAbmAmounts } from '../../data/carrier-v2/settings/other-costs-abm.js';

export type AbmAction = 'new' | 'update' | 'delete' | 'search';

/** Request del ABM capturado desde la página (cuerpo sin headers). */
export type CapturedAbmRequest = {
  action: AbmAction;
  method: string;
  body: Record<string, unknown> | null;
};

/** Resultado de un submit del ABM: request enviado y respuesta recibida. */
export type AbmSubmitResult = {
  method: string;
  status: number;
  body: Record<string, unknown>;
};

const ABM_URL = /\/otherCosts\/(new|update|delete|search)(?:\?|$)/;

function actionOf(url: string): AbmAction | null {
  const match = ABM_URL.exec(url);
  return match ? (match[1] as AbmAction) : null;
}

function requestBody(request: Request): Record<string, unknown> | null {
  try {
    const body = request.postDataJSON() as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Vista de un concepto apta para evidencia (sin datos de usuario). */
export function conceptView(item: OtherCostItem | null): Record<string, unknown> | null {
  if (!item) return null;
  return {
    id: item.id,
    concept: item.concept,
    conceptType: item.conceptType,
    conceptValue: item.conceptValue,
    maxValue: item.maxValue,
    apply: item.apply,
    isCommisionable: item.isCommisionable,
    isByCost: item.isByCost,
    conceptValueCost: item.conceptValueCost,
    maxCostValue: item.maxCostValue,
    currency: item.currency ?? null
  };
}

/**
 * Campos de negocio del concepto que una edición «aislada» no debe tocar (TM-1007). Excluye el
 * id, la venta (lo único que cambia) y cualquier campo extra del backend (fechas de auditoría).
 */
export function preservedFields(item: OtherCostItem): Record<string, unknown> {
  return {
    concept: item.concept,
    conceptType: item.conceptType,
    maxValue: item.maxValue,
    apply: [...item.apply].sort(),
    isCommisionable: item.isCommisionable,
    isByCost: item.isByCost,
    conceptValueCost: item.conceptValueCost,
    maxCostValue: item.maxCostValue,
    currency: item.currency ?? null
  };
}

/** Vista de un request del ABM apta para evidencia: sin `userId` (se informa su coincidencia). */
export function requestView(
  body: Record<string, unknown> | null,
  session: CarrierSession
): Record<string, unknown> | null {
  if (!body) return null;
  const { userId, ...rest } = body;
  return {
    ...rest,
    userIdMatchesSession: userId === undefined ? null : Number(userId) === session.subUserId
  };
}

/**
 * Estado y acciones de un test del smoke ABM. Una instancia por test (la crea el fixture del spec,
 * que llama `cleanup()` al terminar pase lo que pase).
 */
export class OtherCostsAbmFlow {
  readonly runId = makeRunId();
  readonly settings: SettingsOtherCostsPage;
  readonly modal: OtherCostFormModalPage;

  private readonly conceptIds: number[] = [];
  /** Nombres propios guardados por la UI cuyo id todavía no se resolvió (la limpieza los busca). */
  private readonly pendingNames = new Set<string>();
  private readonly captured: CapturedAbmRequest[] = [];
  private currencyId: number | null | undefined;
  /** `aria-hidden` de `app-root` medido tras cada aviso de éxito (hallazgo de accesibilidad). */
  private readonly ariaHiddenAfterSuccess: (string | null)[] = [];

  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
    readonly session: CarrierSession,
    private readonly otherCostsApi: OtherCostsClient,
    readonly data: OtherCostsEnvData,
    readonly amounts: OtherCostsAbmAmounts
  ) {
    this.settings = new SettingsOtherCostsPage(page);
    this.modal = new OtherCostFormModalPage(page);
    // Oráculo de red (TM-1002: «no debería llamarse al endpoint de alta»): registra TODO request
    // del ABM que sale de la página, con su cuerpo.
    page.on('request', (request) => {
      const action = actionOf(request.url());
      if (!action || !['POST', 'PUT'].includes(request.method())) return;
      this.captured.push({ action, method: request.method(), body: requestBody(request) });
    });
  }

  // === Nombres y conceptos (API) ===

  /** Nombre propio del test: «QA E2E OC SMK <runId>[ <label>]». */
  conceptName(label?: string): string {
    return buildOtherCostName('SMK', this.runId, label);
  }

  /**
   * Contexto de la factory con la etiqueta SMK. La moneda se DESCUBRE del catálogo (un concepto
   * existente en la moneda del carrier); si no hay ninguno queda null y el backend usa la del carrier.
   */
  async conceptContext(extra: Partial<OtherCostContext> = {}): Promise<OtherCostContext> {
    if (this.currencyId === undefined) {
      const catalog = await this.otherCostsApi.search();
      this.currencyId =
        catalog.find((item) => item.currency?.code === this.data.currencyCode)?.currency
          ?.currencyId ?? null;
    }
    return {
      carrierId: this.session.carrierId,
      userId: this.session.subUserId,
      currencyId: this.currencyId,
      runId: this.runId,
      nameTag: 'SMK',
      ...extra
    };
  }

  /** Crea un concepto por API (precondición) y lo registra para la limpieza. */
  async createConcept(payload: OtherCostPayload): Promise<OtherCostItem> {
    const item = await this.otherCostsApi.create(payload);
    this.conceptIds.push(item.id);
    return item;
  }

  /** Anota un nombre propio ANTES de guardarlo por la UI (si el test cae, la limpieza lo busca). */
  expectCreatedByUi(name: string): void {
    this.pendingNames.add(name);
  }

  /** Resuelve por nombre el id de un concepto creado por la UI y lo registra para la limpieza. */
  async trackByName(name: string): Promise<OtherCostItem | null> {
    const item = await this.otherCostsApi.findByName(name);
    if (item) {
      if (!this.conceptIds.includes(item.id)) this.conceptIds.push(item.id);
      this.pendingNames.delete(name);
    }
    return item;
  }

  /** Fila vigente del catálogo para un id (oráculo de persistencia por API). */
  async catalogItem(id: number): Promise<OtherCostItem | null> {
    return (await this.otherCostsApi.search()).find((item) => item.id === id) ?? null;
  }

  /** Catálogo completo por API (conteos y ausencias). */
  async catalog(): Promise<OtherCostItem[]> {
    return this.otherCostsApi.search();
  }

  // === ABM por UI ===

  /**
   * Abre Configuración › Otros Costos y devuelve la respuesta del `otherCosts/search` que hizo la
   * propia pantalla (lo que el front recibió). Sesión rechazada (login o 401/403) → STOP.
   */
  async openSettings(): Promise<{ items: OtherCostItem[]; status: number }> {
    const searchResponse = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && actionOf(r.url()) === 'search',
      { timeout: 45_000 }
    );
    searchResponse.catch(() => undefined);
    await this.settings.goto().catch((error: Error) => {
      if (/#\/auth\/login/.test(this.page.url())) {
        // La app redirigió al login: la sesión guardada no sirve (equivale a un 401) → STOP.
        throw new SessionRejectedError('Configuración › Otros Costos (redirección al login)', 401);
      }
      throw error;
    });
    const response = await searchResponse;
    if ([401, 403].includes(response.status())) {
      throw new SessionRejectedError('otherCosts/search (pantalla)', response.status());
    }
    await this.settings.expectListReady();
    const body = (await response.json().catch(() => null)) as unknown;
    return {
      items: Array.isArray(body) ? (body as OtherCostItem[]) : [],
      status: response.status()
    };
  }

  /** Abre «Nuevo Costo» y verifica que el modal sea el de alta. */
  async openNewCostModal(): Promise<void> {
    await this.settings.newCostButton.click();
    await this.modal.expectVisible();
    await expect(this.modal.title, 'debe abrirse el modal de ALTA').toHaveText(
      /nuevo concepto|new other costs concept/i
    );
  }

  /**
   * Abre la edición del concepto con el ícono lápiz de SU fila y verifica que el modal abierto sea
   * el de edición de ESE concepto (un botón equivocado falla ruidosamente).
   */
  async openEditModal(name: string): Promise<void> {
    await expect(this.settings.rowByName(name), `la fila «${name}» debe listarse`).toHaveCount(1, {
      timeout: 20_000
    });
    await this.settings.editButtonFor(name).click();
    await this.modal.expectVisible();
    await expect(this.modal.title, 'debe abrirse el modal de EDICIÓN').toHaveText(
      /editar concepto|edit other costs concept/i
    );
    await expect(
      this.modal.descriptionInput,
      'el modal debe ser el del concepto elegido'
    ).toHaveValue(name);
  }

  /** Abre la baja con el ícono papelera de SU fila y verifica que el diálogo nombre al concepto. */
  async openDeleteDialog(name: string): Promise<void> {
    await expect(this.settings.rowByName(name), `la fila «${name}» debe listarse`).toHaveCount(1, {
      timeout: 20_000
    });
    await this.settings.deleteButtonFor(name).click();
    await expect(this.settings.deleteDialog, 'debe abrirse «Eliminar - Otro Costo»').toBeVisible({
      timeout: 10_000
    });
    await expect(this.settings.deleteDialog, 'el diálogo debe nombrar al concepto').toContainText(
      name
    );
  }

  /** Acepta la baja; efecto observable: el diálogo se cierra. */
  async acceptDelete(): Promise<void> {
    await this.settings.deleteAcceptButton.click();
    await expect(this.settings.deleteDialog, 'Aceptar debe cerrar el diálogo de baja').toBeHidden({
      timeout: 15_000
    });
  }

  /**
   * Ejecuta un submit del ABM (Guardar / Aceptar) capturando el request y la respuesta del
   * endpoint `action`. Es la compuerta posterior de importes: el cuerpo trae el número exacto.
   */
  async submitCapturing(
    action: 'new' | 'update' | 'delete',
    submit: () => Promise<void>
  ): Promise<AbmSubmitResult> {
    // Tras un 200 la pantalla vuelve a pedir el catálogo (`getDataGrid`, ts:270-288): se espera
    // ese refresh para que la grilla que se lea después sea la posterior al submit.
    const refresh = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && actionOf(r.url()) === 'search',
      { timeout: 30_000 }
    );
    refresh.catch(() => undefined);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => actionOf(r.url()) === action && ['POST', 'PUT'].includes(r.request().method()),
        { timeout: 30_000 }
      ),
      submit()
    ]);
    if (response.ok()) await refresh;
    return {
      method: response.request().method(),
      status: response.status(),
      body: requestBody(response.request()) ?? {}
    };
  }

  /**
   * Aviso de éxito del ABM. Es un popup SweetAlert2 NO-toast (`AlertService.toastSuccess`, sin
   * `toast: true`, `timer: 3000`): mientras está abierto marca el resto de la página `aria-hidden`
   * y la grilla no es legible por rol (una ausencia de fila pasaría vacía). Se espera que aparezca
   * y que se cierre solo antes de leer la grilla.
   */
  async confirmSuccessToast(text: RegExp): Promise<void> {
    const toast = this.settings.toast(text);
    await expect(toast, 'debe verse el aviso de éxito').toBeVisible({ timeout: 10_000 });
    await expect(toast, 'el aviso de éxito debe cerrarse solo').toBeHidden({ timeout: 10_000 });
    // Hallazgo de accesibilidad (no se asevera: no es el objeto de estos Tests): la app deja
    // `app-root` aria-hidden tras el aviso. Se mide y se informa como known-defect una vez.
    const ariaHidden = await this.settings.appRootAriaHidden();
    this.ariaHiddenAfterSuccess.push(ariaHidden);
    if (
      ariaHidden === 'true' &&
      this.ariaHiddenAfterSuccess.filter((v) => v === 'true').length === 1
    ) {
      this.knownDefect(
        'A11Y (hallazgo de producto, no aseverado): tras el aviso de éxito del ABM, app-root queda ' +
          'con aria-hidden="true" (carrera NgbModal-SweetAlert2): la pantalla queda oculta para ' +
          'lectores de pantalla hasta recargar. La grilla se lee por CSS para no depender de esto.'
      );
    }
  }

  /** Marca de posición en los requests capturados (para contar desde un momento dado). */
  mark(): number {
    return this.captured.length;
  }

  /** Requests del ABM de una acción salidos desde `mark`. */
  requestsSince(action: AbmAction, mark: number): CapturedAbmRequest[] {
    return this.captured.slice(mark).filter((r) => r.action === action);
  }

  // === Evidencia ===

  /** Adjunta una captura de página completa (la lleva el reporter a Xray). */
  async screenshot(name: string): Promise<void> {
    await this.testInfo.attach(name, {
      body: await this.page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
  }

  /** Adjunta la medición JSON (lista blanca; nunca volcar cuerpos crudos con PII ni headers). */
  async attachMeasurement(tmKey: string, measurement: Record<string, unknown>): Promise<void> {
    const body = {
      tmKey,
      env: this.session.env,
      carrierId: this.session.carrierId,
      runId: this.runId,
      gitSha: process.env.GIT_SHA ?? null,
      measuredAt: new Date().toISOString(),
      appRootAriaHiddenAfterSuccess: this.ariaHiddenAfterSuccess,
      ...measurement
    };
    await this.testInfo.attach(`medicion-${tmKey}`, {
      body: JSON.stringify(body, null, 2),
      contentType: 'application/json'
    });
  }

  /** Vista de un request apta para evidencia. */
  requestView(body: Record<string, unknown> | null): Record<string, unknown> | null {
    return requestView(body, this.session);
  }

  /** Comentario de medición del run (annotation `xray_comment`, ver xray-reporter). */
  comment(text: string): void {
    this.testInfo.annotations.push({ type: 'xray_comment', description: text });
  }

  /** Hallazgo de producto conocido: se informa, nunca se asevera como esperado. */
  knownDefect(text: string): void {
    this.testInfo.annotations.push({ type: 'known-defect', description: text });
  }

  /** Encabezado común del comentario: ambiente, carrier, versión del front, commit y oráculo. */
  async commentHeader(): Promise<string> {
    const version = await this.settings.appVersion();
    return (
      `Ambiente ${this.session.env} · carrier ${this.session.carrierId} · front v${version ?? '?'} · ` +
      `commit ${process.env.GIT_SHA ?? 'sin GIT_SHA'} · corrida ${this.runId} · smoke ABM automatizado. ` +
      'Oráculo de persistencia: API (base de UAT no alcanzable, BL-046).'
    );
  }

  // === Limpieza ===

  /**
   * Da de baja por API los conceptos de ESTE test (ids registrados y nombres propios pendientes).
   * Intenta todo aunque algo falle, deja el resultado en el comentario del run y recién al final
   * lanza si hubo errores. `remove` es idempotente (false si ya no estaba, p. ej. TM-1014).
   */
  async cleanup(): Promise<void> {
    const done: string[] = [];
    const errors: string[] = [];
    for (const name of [...this.pendingNames]) {
      try {
        const item = await this.trackByName(name);
        if (!item) {
          this.pendingNames.delete(name);
          done.push(`«${name}» no quedó creado`);
        }
      } catch (error) {
        errors.push(`«${name}»: ${(error as Error).message}`);
      }
    }
    for (const id of this.conceptIds) {
      try {
        const removed = await this.otherCostsApi.remove(id);
        done.push(`concepto ${id} ${removed ? 'dado de baja' : 'ya no estaba'}`);
      } catch (error) {
        errors.push(`concepto ${id}: ${(error as Error).message}`);
      }
    }
    if (done.length > 0 || errors.length > 0) {
      this.comment(
        `Limpieza: ${done.join('; ') || 'nada'}${errors.length ? ` · ERRORES: ${errors.join('; ')}` : ''}.`
      );
    }
    if (errors.length > 0) {
      throw new Error(`[limpieza smoke ABM] ${errors.join(' | ')}`);
    }
  }
}
