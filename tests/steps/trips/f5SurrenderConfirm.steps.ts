// tests/steps/trips/f5SurrenderConfirm.steps.ts
// Pasos de la CONFIRMACION irreversible F5 (gate F5_CONFIRM_SURRENDER=1): guardia de red que deja pasar UN
// solo POST toTravelsSurrender del par declarado, confirmacion por la pantalla (clic simple o doble),
// captura de body/respuesta/PDF y lecturas DB (solo SELECT). Sin aserciones de negocio: las ejecuta el spec.
// Columnas verificadas con SELECT en TEST el 2026-11-06 (TRAVELSSURRENDER, CHECKINGACCOUNTFOROWNER, TRAVEL).
import { readFileSync } from 'node:fs';
import type { Locator, Page, Request, Route } from '@playwright/test';
import { expect } from '@playwright/test';
import { isGateOpen } from '../../config/runtime.js';
import { f5TargetProfile, type F5Target } from '../../config/f5-targets.js';
import { prepOwner } from '../../config/carrier-profiles.js';
import type { OracleDb } from '../../db/OracleDb.js';
import { confirmEnvOf, type ConfirmEnv } from '../../data/carrier-v2/trips/f5-confirm-cases.js';
import type { DueState } from '../../helpers/f5-confirm-oracle.js';
import { parseMoney } from '../../utils/money.js';
import { F5_CONFIRM_COLUMNS, type F5ConfirmRow } from '../../helpers/f5-confirm-oracle.js';
import { isPdfBuffer } from '../../helpers/report-parse.js';
import type { SurrenderPage } from '../../pages/carrier-v2/pay/SurrenderPage.js';

const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Nombre del gate de la confirmacion F5 (solo el valor exacto `1` lo abre). */
export const F5_CONFIRM_GATE = 'F5_CONFIRM_SURRENDER';
export function isF5ConfirmGateOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  // Valor exacto `1`; ademas del nombre por dominio acepta el alias historico FR_CONFIRM_SURRENDER (W0).
  return isGateOpen(F5_CONFIRM_GATE, env);
}

/** H-08: una confirmacion irreversible NUNCA corre con ENV=prod (ni con un ENV desconocido). Lanza si no es uat/test. */
export function assertConfirmEnvAllowed(env: NodeJS.ProcessEnv = process.env): ConfirmEnv {
  return confirmEnvOf(env.ENV);
}

/** Modo SOLO VERIFICACION: `F5_VERIFY_SURRENDER_ID=<TRAVELSSURRENDER.ID>` re-verifica una rendicion YA confirmada. */
export const F5_VERIFY_ENV = 'F5_VERIFY_SURRENDER_ID';
/** Id de la rendicion a re-verificar, o null si el modo no esta activo. Un valor no numerico lanza. */
export function f5VerifySurrenderId(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[F5_VERIFY_ENV]?.trim();
  if (!raw) return null;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${F5_VERIFY_ENV} invalido: "${raw}"`);
  return Number(raw);
}

const TOTALS_URL = /\/travels\/toTravelsSurrender(\?|$)/;
/** Otras escrituras que esta confirmacion NUNCA debe disparar (defensa en profundidad). */
const FOREIGN_WRITE_URL =
  /\/vehicles\/\d+\/carrier\/\d+\/travelsSurrender|\/liquidations?\b|\/vehicleOwners\b|auto[-_]?dispatch/i;

export type ConfirmResult = {
  status: number;
  /** Body que el front mando (sin headers ni token). */
  requestBody: Record<string, unknown> | null;
  /** Cuerpo JSON de la respuesta sin el PDF (`file`). */
  responseSummary: Record<string, unknown> | null;
  /** PDF del Clearing (campo `file` base64 de la respuesta); null si no vino. */
  clearingPdf: Buffer | null;
};

/**
 * Guardia + captura de la confirmacion. `arm` se invoca ANTES de navegar. El POST toTravelsSurrender solo
 * continua si es el primero y su query trae el chofer/vehiculo declarados; todo POST adicional (doble envio) o
 * ajeno se aborta y CUENTA. Escrituras ajenas a la rendicion tambien se abortan y cuentan.
 */
export class F5ConfirmSession {
  private postAttempts = 0;
  private foreignWrites = 0;
  private continued = 0;

  private constructor(private readonly page: Page) {}

  static async arm(
    page: Page,
    pair: { driverUserId: number; vehicleId: number }
  ): Promise<F5ConfirmSession> {
    const session = new F5ConfirmSession(page);
    await page.route(TOTALS_URL, async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.continue();
        return;
      }
      session.postAttempts += 1;
      const url = new URL(request.url());
      const samePair =
        url.searchParams.get('driverUserId') === String(pair.driverUserId) &&
        url.searchParams.get('vehicleId') === String(pair.vehicleId);
      if (samePair && session.continued === 0) {
        session.continued += 1;
        await route.continue();
      } else {
        await route.abort('blockedbyclient');
      }
    });
    await page.route(FOREIGN_WRITE_URL, async (route) => {
      if (route.request().method() === 'GET') {
        await route.continue();
        return;
      }
      session.foreignWrites += 1;
      await route.abort('blockedbyclient');
    });
    return session;
  }

  /** POST toTravelsSurrender intentados desde la pantalla (incluye los abortados). */
  postCount(): number {
    return this.postAttempts;
  }

  /** Escrituras ajenas a la confirmacion abortadas por la guardia. */
  foreignWriteCount(): number {
    return this.foreignWrites;
  }

  /**
   * IRREVERSIBLE: pulsa «Confirm» (`clicks` 1 = clic simple; 2 = doble clic rapido, TC12) y espera la respuesta
   * del primer POST. Lanza SIN tocar la pantalla si el gate no esta abierto. Solo el orquestador.
   */
  async confirm(
    surrender: SurrenderPage,
    clicks: 1 | 2 = 1,
    /** Ventana de escucha de POST adicionales tras la respuesta (doble clic: 10 s; clic simple: 0). */
    observeExtraPostsMs: number = clicks === 2 ? 10_000 : 0
  ): Promise<ConfirmResult> {
    if (!isF5ConfirmGateOpen()) {
      throw new Error(
        `[F5 confirm] bloqueado: la rendicion es irreversible; requiere ${F5_CONFIRM_GATE}=1`
      );
    }
    assertConfirmEnvAllowed();
    const responded = this.page.waitForResponse(
      (r) => TOTALS_URL.test(r.url()) && r.request().method() === 'POST',
      { timeout: 60_000 }
    );
    if (clicks === 2) await surrender.confirmButton.dblclick({ delay: 30 });
    else await surrender.confirmButton.click();
    const response = await responded;
    // Ausencia observable: un segundo POST (doble envio) puede llegar DESPUES de la primera respuesta; la guardia
    // lo aborta y lo cuenta. Se espera que NO pase: ventana acotada que corta apenas aparece (el timeout es el
    // camino feliz y se descarta; la aserción del conteo la hace el spec con `evaluatePostAttempts`).
    if (observeExtraPostsMs > 0) {
      await expect
        .poll(() => this.postAttempts, { timeout: observeExtraPostsMs, intervals: [250, 500] })
        .toBeGreaterThan(1)
        .catch(() => undefined);
    }
    const request: Request = response.request();
    const requestBody = (() => {
      try {
        return JSON.parse(request.postData() ?? 'null') as Record<string, unknown> | null;
      } catch {
        return null;
      }
    })();
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const file = typeof json?.file === 'string' ? json.file : null;
    const responseSummary =
      json === null
        ? null
        : { ...json, file: file === null ? null : `<base64 ${file.length} chars>` };
    return {
      status: response.status(),
      requestBody,
      responseSummary,
      clearingPdf: file === null ? null : Buffer.from(file, 'base64')
    };
  }
}

/**
 * Guardia del modo SOLO VERIFICACION: aborta y cuenta TODA escritura (POST toTravelsSurrender o cualquier otra
 * de rendicion/liquidacion). Esta clase no tiene metodo de confirmacion: la pantalla de confirmar ni se abre.
 */
export class F5VerifyGuard {
  private blocked = 0;

  private constructor() {}

  static async arm(page: Page): Promise<F5VerifyGuard> {
    const guard = new F5VerifyGuard();
    const block = async (route: Route): Promise<void> => {
      if (route.request().method() === 'GET') {
        await route.continue();
        return;
      }
      guard.blocked += 1;
      await route.abort('blockedbyclient');
    };
    await page.route(TOTALS_URL, block);
    await page.route(FOREIGN_WRITE_URL, block);
    return guard;
  }

  /** Escrituras de rendicion abortadas (en verificacion debe ser 0: nadie debe intentarlas). */
  blockedCount(): number {
    return this.blocked;
  }
}

/** Medio de pago (FINALPRICEI.PAYMENTMETHOD) de cada viaje: reemplaza la fila de toSurrend cuando ya no hay pendientes. */
export async function readTripPaymentMethods(
  db: OracleDb,
  travelIds: readonly number[]
): Promise<Array<{ travelId: number; paymentMethod: string }>> {
  if (travelIds.length === 0 || travelIds.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`[F5 verify] ids de viaje invalidos: ${travelIds.join(', ') || 'vacio'}`);
  }
  const binds: Record<string, number> = {};
  const clause = travelIds
    .map((id, i) => {
      binds[`t${i}`] = id;
      return `:t${i}`;
    })
    .join(', ');
  const rows = await db.query<{ ID: number; PM: string | null }>(
    `SELECT t.ID, fp.PAYMENTMETHOD PM FROM TRAVEL t JOIN FINALPRICEI fp ON fp.ID = t.FINALPRICE_ID WHERE t.ID IN (${clause})
     UNION ALL
     SELECT t.ID, fp.PAYMENTMETHOD FROM TRAVEL_HISTORY t JOIN FINALPRICEI fp ON fp.ID = t.FINALPRICE_ID WHERE t.ID IN (${clause})`,
    binds
  );
  const byId = new Map<number, string>();
  for (const r of rows) if (typeof r.PM === 'string') byId.set(Number(r.ID), r.PM);
  return travelIds.map((travelId) => {
    const paymentMethod = byId.get(travelId);
    if (paymentMethod === undefined) {
      throw new Error(`[F5 verify] viaje ${travelId} sin FINALPRICEI.PAYMENTMETHOD`);
    }
    return { travelId, paymentMethod };
  });
}

/**
 * Re-descarga SOLO LECTURA de los PDF de una rendicion cerrada desde Daily Clearing > Closed
 * (`#/pay/surrenders-report`): «Generate pdf» (Clearing del servidor) y «Driver Report» (Reporte Chofer).
 * Ubica la fila por `TRAVELSSURRENDER.ID` en la respuesta `surrendersReports/paginated` (no por texto).
 * Lanza si la fila no esta en la pagina leida o si un boton no entrega un PDF.
 */
export async function downloadClosedSurrenderPdfs(
  page: Page,
  surrenderId: number
): Promise<{ clearing: Buffer; driverReport: Buffer; idForCarrier: number | null }> {
  const paged = page.waitForResponse(
    (r) => r.url().includes('/surrendersReports/paginated') && r.request().method() === 'GET',
    { timeout: 45_000 }
  );
  await page.goto('about:blank');
  await page.goto('/carrier/#/pay/surrenders-report');
  const body = (await (await paged).json()) as {
    content?: Array<{ id: number; idForCarrier?: number }>;
  };
  const rows = body.content ?? [];
  const index = rows.findIndex((r) => r.id === surrenderId);
  if (index < 0) {
    throw new Error(
      `[F5 verify] la rendicion ${surrenderId} no esta en la pagina 1 de Daily Clearing > Closed (ids ${rows.map((r) => r.id).join(', ')})`
    );
  }
  const tableRows = page.locator('tbody tr');
  await expect(tableRows).toHaveCount(rows.length, { timeout: 15_000 });
  const row = tableRows.nth(index);
  const grab = async (button: Locator, label: string): Promise<Buffer> => {
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await button.first().click({ timeout: 15_000 });
    const path = await (await download).path();
    if (!path) throw new Error(`[F5 verify] ${label}: descarga sin ruta`);
    const pdf = readFileSync(path);
    if (!isPdfBuffer(pdf)) throw new Error(`[F5 verify] ${label}: la descarga no es un PDF`);
    return pdf;
  };
  const clearing = await grab(
    row.locator('button[ng-reflect-ngb-tooltip="Generate pdf"], button:has(i.mdi-file-pdf-box)'),
    'Generate pdf (Clearing)'
  );
  const driverReport = await grab(
    row.locator(
      'button[ng-reflect-ngb-tooltip="Driver Report"], button:has(i.mdi-file-document-outline)'
    ),
    'Driver Report'
  );
  return { clearing, driverReport, idForCarrier: rows[index].idForCarrier ?? null };
}

/**
 * Ids de rendiciones de la pagina 1 de Daily Clearing > Closed (`surrendersReports/paginated`). SOLO LECTURA.
 * Camino SIN DB (UAT): se toma la lista ANTES de confirmar y DESPUES; la diferencia es la rendicion nueva.
 */
export async function listClosedSurrenderIds(page: Page): Promise<number[]> {
  const paged = page.waitForResponse(
    (r) => r.url().includes('/surrendersReports/paginated') && r.request().method() === 'GET',
    { timeout: 45_000 }
  );
  await page.goto('about:blank');
  await page.goto('/carrier/#/pay/surrenders-report');
  const body = (await (await paged).json()) as { content?: Array<{ id: number }> };
  return (body.content ?? []).map((r) => r.id);
}

/** true si «Confirm» ya no es accionable (oculto o deshabilitado). 14185: tras el 200 quedan solo «Download», «Clearing Report» y «Back». */
export async function isConfirmRetired(surrender: SurrenderPage): Promise<boolean> {
  const visible = await surrender.confirmButton.isVisible().catch(() => false);
  return !visible || (await surrender.confirmButton.isDisabled().catch(() => false));
}

/**
 * Reporte Chofer (`#print_surrender_driver`): si el boton existe se pulsa y se espera el PDF por descarga o por
 * respuesta HTTP (20 s). null = no disponible o no capturable (el spec lo registra como observacion).
 */
export async function downloadDriverReport(page: Page): Promise<Buffer | null> {
  const button = page.locator('#print_surrender_driver');
  if (
    (await button.count()) === 0 ||
    !(await button
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    return null;
  }
  const byDownload = page.waitForEvent('download', { timeout: 20_000 }).then(async (d) => {
    const path = await d.path();
    if (!path) throw new Error('descarga sin ruta');
    return readFileSync(path);
  });
  const byResponse = page
    .waitForResponse((r) => /pdf|octet-stream/i.test(r.headers()['content-type'] ?? ''), {
      timeout: 20_000
    })
    .then((r) => r.body());
  await button.first().click();
  try {
    const pdf = await Promise.any([byDownload, byResponse]);
    return isPdfBuffer(pdf) ? pdf : null;
  } catch {
    return null;
  }
}

/** Viajes pendientes del par chofer/vehiculo (DONE/CANCELLED sin rendir con precio final > 0). SOLO LECTURA. */
export async function readPendingTripsOfPair(
  db: OracleDb,
  pair: { driverId: number; vehicleId: number }
): Promise<number[]> {
  const rows = await db.query<{ ID: number }>(
    `SELECT t.ID FROM TRAVEL t JOIN FINALPRICEI fp ON fp.ID = t.FINALPRICE_ID
     WHERE t.DRIVER_ID = :driverId AND fp.VEHICLE_ID = :vehicleId AND t.STATE IN (6, 7)
       AND t.SURRENDERED = 0 AND fp.FINALPRICE > 0 AND fp.PAYMENTMETHOD IS NOT NULL
     ORDER BY t.ID`,
    pair
  );
  return rows.map((r) => Number(r.ID));
}

/** SURRENDERED y TRAVELSSURRENDER_ID de cada viaje (TRAVEL o TRAVEL_HISTORY). */
export async function readTripsSurrendered(
  db: OracleDb,
  travelIds: readonly number[]
): Promise<Array<{ id: number; surrendered: number | null; surrenderId: number | null }>> {
  if (travelIds.length === 0 || travelIds.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`[F5 confirm] ids de viaje invalidos: ${travelIds.join(', ') || 'vacio'}`);
  }
  const binds: Record<string, number> = {};
  const clause = travelIds
    .map((id, i) => {
      binds[`t${i}`] = id;
      return `:t${i}`;
    })
    .join(', ');
  const rows = await db.query<Record<string, unknown>>(
    `SELECT ID, SURRENDERED, TRAVELSSURRENDER_ID FROM TRAVEL WHERE ID IN (${clause})
     UNION ALL
     SELECT ID, SURRENDERED, TRAVELSSURRENDER_ID FROM TRAVEL_HISTORY WHERE ID IN (${clause})`,
    binds
  );
  // Un viaje en TRAVEL y TRAVEL_HISTORY a la vez: gana el SURRENDERED mas alto y el id no nulo.
  const byId = new Map<
    number,
    { id: number; surrendered: number | null; surrenderId: number | null }
  >();
  for (const r of rows) {
    const id = Number(r.ID);
    const cur = byId.get(id);
    const surrendered = asNum(r.SURRENDERED);
    const surrenderId = asNum(r.TRAVELSSURRENDER_ID);
    byId.set(id, {
      id,
      surrendered: Math.max(cur?.surrendered ?? 0, surrendered ?? 0),
      surrenderId: cur?.surrenderId ?? surrenderId
    });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const F5_CONFIRM_SQL = `SELECT ${F5_CONFIRM_COLUMNS.join(', ')} FROM TRAVELSSURRENDER WHERE ID = :surrenderId`;

/** Columnas de la confirmacion (comisiones por actor, netos, fija). Lanza si la fila no existe. */
export async function readF5ConfirmRow(db: OracleDb, surrenderId: number): Promise<F5ConfirmRow> {
  const rows = await db.query<Record<string, unknown>>(F5_CONFIRM_SQL, { surrenderId });
  const raw = rows[0];
  if (!raw) throw new Error(`[F5 confirm] TRAVELSSURRENDER ${surrenderId} no existe`);
  return Object.fromEntries(F5_CONFIRM_COLUMNS.map((c) => [c, asNum(raw[c])])) as F5ConfirmRow;
}

// ───────────────────────────── Acciones del operador antes del clic ─────────────────────────────

/** Gasto varios («Other Expenses»; `formcontrolname`, verificado en UAT 10/11). */
const miscellanyInput = (page: Page): Locator =>
  page.locator('input[formcontrolname="otherExpenses"]');
/** Simbolo de moneda junto a «Cash» (xpath probado en UAT 10/11): un clic entrega todo lo adeudado. */
const payDueSymbol = (page: Page): Locator =>
  page
    .locator(
      'xpath=//*[normalize-space(text())="Cash"]/following::span[contains(@class,"input-group-text")][1]'
    )
    .first();

/** «Amount due to Company|Driver» de la tarjeta de balance; sin renglon = {null,null}. Solo lectura. */
export async function readDueState(page: Page): Promise<DueState> {
  const card = page.locator('.card', { hasText: 'Amount due to' }).first();
  const text = ((await card.innerText()) ?? '').replace(/\s+/g, ' ');
  const m = /Due to (Company|Driver):\s*([^\s\d]{0,3}\s*\d[\d.,]*)/.exec(text);
  return m
    ? { kind: m[1] as 'Company' | 'Driver', amount: parseMoney(m[2]) }
    : { kind: null, amount: null };
}

/**
 * Teclea gasto varios (borra antes, sale con Tab). SOLO el campo `otherExpenses`: nunca combustible. El campo
 * debe estar habilitado (lo habilita el GET: `miscellaneousExpenseOwner` OWNER/AGENCY); si no, lanza.
 */
export async function typeMiscellany(page: Page, raw: string): Promise<void> {
  const input = miscellanyInput(page);
  await expect(
    input,
    'Other Expenses debe estar habilitado para teclear gasto varios'
  ).toBeEnabled();
  await input.click();
  await input.press('Control+A');
  await input.press('Delete');
  await input.pressSequentially(raw, { delay: 40 });
  await input.press('Tab');
}

/** Clic en «$» junto a «Cash»: «Entregar» pasa a ser todo lo adeudado a la empresa (TC12). No confirma nada. */
export async function clickPayDue(page: Page): Promise<void> {
  await payDueSymbol(page).click();
}

/** Lo que dejo escrito el operador en los campos de gastos (lectura; sin tocar). */
export async function readExpenseInputs(page: Page): Promise<{ miscellany: string; fuel: string }> {
  return {
    miscellany: await miscellanyInput(page).inputValue(),
    fuel: await page.locator('input[formcontrolname="fuelExpenses"]').inputValue()
  };
}

/**
 * `ccByCost` del vehiculo del target segun el PERFIL del carrier (`prep.owner.vehicleCommissions[v].pctForCost > 0`:
 * el viaje en cuenta corriente se comisiona por costo). undefined = sin perfil o sin dato del vehiculo (TEST 1040
 * historico): el oraculo no asume. Supuesto declarado: % costo del vehiculo > 0 <=> CC por costo (decision-table C7).
 */
export function ccByCostOfTarget(target: F5Target): boolean | undefined {
  if (!target.profileId) return undefined;
  const profile = f5TargetProfile(target, ['prep.owner', 'prep.pairs']);
  const facts = prepOwner(profile).vehicleCommissions[target.vehicleId];
  return facts === undefined ? undefined : facts.pctForCost > 0;
}
