// tests/specs/trips/f5-settlement.spec.ts
// Universal F5 (MG-1024 BE + MG-1027 FE) · Liquidaciones de CHOFER y PROPIETARIO por perfil de carrier (W4, TM-1701).
// Generaliza `fr-circuit-settlement.spec.ts` (que queda para 1901 TEST) a AR 1040 / US 1481 / FR 2021 en UAT y
// 1521 en TEST, con el par propio del perfil (`prep.settlement`).
//
//   SET-1  SOLO LECTURA  (sin gate) pendientes: GET withoutLiquidations == oraculo == vista previa de la UI.
//   SET-3  IRREVERSIBLE  liquidacion de CHOFER   (gate F5_CONFIRM_SETTLEMENT=1 + F5_SETTLEMENT_KIND=driver).
//   SET-4  IRREVERSIBLE  liquidacion de PROPIETARIO (gate F5_CONFIRM_SETTLEMENT=1 + F5_SETTLEMENT_KIND=owner).
//
// ORACULO (el total NUNCA se hardcodea; sale de las rendiciones):
//   chofer      = suma de la comision de las rendiciones MANUALES del chofer (sin NC, sin automaticas).
//   propietario = OWNER_TOTALCOMMISSION de las manuales + (OWNER + COMMISSIONSUM) de las automaticas
//                 (DRIVER_ID NULL; regla MX-4716). NOCOM (no comisionable en efectivo) queda fuera.
//   Fuente (en este orden): DB (TEST, capa `db`) · lista declarada `F5_SETTLEMENT_FACTS=<json>` (UAT: arreglo de
//   {id, driverId|null, commissionSum, ownerTotalCommission[, nocom, tips, expenses, ...]}; ver `SurrenderFact`) ·
//   solo chofer: componentes del propio GET (`driverCommission - totalFinancialCost + totalTip`). El propietario en
//   UAT SIN lista declarada no tiene oraculo independiente: la confirmacion se niega.
//
// IRREVERSIBLE: una liquidacion PAID consume TODO lo pendiente del chofer/propietario y bloquea la edicion de los
// viajes. Solo la corre el orquestador desde el hilo principal (nunca un subagente). Sin gate se omite ANTES de
// abrir el navegador. Orden: precondiciones y vista previa contra el oraculo (si algo no coincide NO se confirma) →
// Accept UNA sola vez (guarda de red: un unico POST de liquidacion del par) → verificacion posterior ACUMULADA.
//
// Env (confirmacion):
//   F5_CONFIRM_SETTLEMENT=1        gate (alias de lectura FR_CONFIRM_SETTLEMENT)
//   F5_TARGETS=<id>                exactamente UN target (UAT: 1040|1481|2021; TEST: 1521|1521b)
//   F5_SETTLEMENT_KIND=driver|owner
//   F5_EXPECT_DRIVER_TOTAL / F5_EXPECT_OWNER_TOTAL   total esperado en el formato de PANTALLA («173,04», «1.645,00»,
//                                  «1,645.00»); el spec aborta antes del Accept si «Settlement Total» difiere.
//   F5_SETTLEMENT_ACCOUNT=<DRIVER.ID>   obligatorio si el perfil tiene varios choferes (US 1481, 1521)
//   F5_SETTLEMENT_ACK_SHARED_OWNER=1    obligatorio para el propietario de una ficha COMPARTIDA (US 4287, 1521 3287):
//                                  la liquidacion incluye las rendiciones de todos los pares (aviso al carril + D-4)
//   F5_SETTLEMENT_FACTS=<ruta.json>     lista declarada de rendiciones (oraculo sin DB)
// El «fijo diario» de AR (122 a AGENCY) NO se lee del perfil: ya viene dentro de las rendiciones de la corrida.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, regionStorageStatePath } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { loadCarrierSession, type CarrierSession } from '../../api/clients/carrierSession.js';
import {
  SettlementClient,
  isSettlementGateOpen,
  todayParam,
  type DriverUnsettledRow
} from '../../api/clients/settlement.client.js';
import { prepSettlement, type CarrierProfile } from '../../config/carrier-profiles.js';
import { activeF5Targets, f5TargetProfile, type F5Target } from '../../config/f5-targets.js';
import { tryCreateOracleDb, type OracleDb } from '../../db/OracleDb.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { f5DbNotApplicable, f5LayerEnabled } from '../../helpers/f5-layers.js';
import { ownerSurrenderIds } from '../../helpers/fr-ac-eval-auto-settlement.js';
import { createF5sVerifier, f5sObservation } from '../../helpers/f5-settlement-acceptance.js';
import { installSettlementGuard } from '../../helpers/f5-settlement-guard.js';
import { formatMismatches } from '../../helpers/oracle-result.js';
import {
  extractPdfText,
  hasPdftotext,
  isPdfBuffer,
  textContainsAmount
} from '../../helpers/report-parse.js';
import {
  driverCreateTotal,
  driverOpenSurrenders,
  driverTotalFromGet,
  driverTotalFromList,
  evaluateAutoPlacement,
  evaluateCreatedLiquidation,
  evaluateDeclaredTotal,
  evaluateForeignSurrenders,
  evaluateNocomOutsideTotal,
  liquidationFromDb,
  nocomSumFromDb,
  nocomSumOf,
  ownerCreateTotal,
  ownerOpenSurrenders,
  ownerTotalFromList,
  parseSurrenderFacts,
  resolveSettlementAccount,
  surrendersByIds,
  type LiquidationKind,
  type SurrenderFact
} from '../../helpers/settlement-oracle.js';
import { SettlementPage } from '../../pages/carrier-v2/settlements/SettlementPage.js';
import { F5_SETTLEMENT_KEYS } from '../../data/xray/f5-settlement-keys.js';
import { parseMoney, round2 } from '../../utils/money.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE: Record<LiquidationKind, string> = {
  driver: '/carrier/#/liquidations/drivers/list',
  owner: '/carrier/#/liquidations/owners/list'
};
const asc = (a: number, b: number): number => a - b;
const attachJson = (testInfo: TestInfo, name: string, data: unknown): Promise<void> =>
  testInfo.attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });

// ───────────── configuracion (env) ─────────────

function assertNotProd(): void {
  const env = process.env.ENV?.trim().toLowerCase();
  if (env === 'prod' || env === 'production') {
    throw new Error('[F5 settlement] prohibido en produccion (ENV debe ser uat o test)');
  }
}

/** Perfil con `prep` del target, o null (1040 TEST historico y 1901 TEST no tienen: usan fr-circuit-settlement). */
function profileOrNull(target: F5Target): CarrierProfile | null {
  if (!target.profileId) return null;
  const profile = f5TargetProfile(target);
  return profile.prep ? profile : null;
}

/** Cuenta a liquidar del perfil (ver `resolveSettlementAccount`). */
const settlementAccount = (profile: CarrierProfile, kind: LiquidationKind): number =>
  resolveSettlementAccount(prepSettlement(profile), profile.id, kind);

function loadFacts(): SurrenderFact[] | null {
  const path = process.env.F5_SETTLEMENT_FACTS?.trim();
  if (!path) return null;
  return parseSurrenderFacts(JSON.parse(readFileSync(path, 'utf-8')) as unknown);
}

function declaredTotal(kind: LiquidationKind): number {
  const name = kind === 'driver' ? 'F5_EXPECT_DRIVER_TOTAL' : 'F5_EXPECT_OWNER_TOTAL';
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(
      `[F5 BLOCKED] ${name} no definido: declarar el total esperado en el formato de pantalla antes de liquidar`
    );
  }
  return parseMoney(raw);
}

// ───────────── lecturas (API / DB, solo lectura) ─────────────

type Pending = { ids: number[]; apiSum: number; driverRows: DriverUnsettledRow[] | null };

async function readPending(
  client: SettlementClient,
  kind: LiquidationKind,
  accountId: number
): Promise<Pending> {
  if (kind === 'driver') {
    const rows = await client.driverUnsettled({ driverAccountId: accountId, to: todayParam() });
    return {
      ids: rows.map((r) => r.id).sort(asc),
      apiSum: round2(rows.reduce((s, r) => s + Number(r.comNeta ?? 0), 0)),
      driverRows: rows
    };
  }
  const groups = await client.ownerUnsettled({ ownerId: accountId, to: todayParam() });
  return {
    ids: ownerSurrenderIds(groups),
    apiSum: round2(groups.reduce((s, g) => s + Number(g.comNeta ?? 0), 0)),
    driverRows: null
  };
}

/** «To Settle» del chofer/propietario (columna de la grilla); null si el chofer no figura en el resumen. */
async function readToSettle(
  client: SettlementClient,
  kind: LiquidationKind,
  accountId: number
): Promise<number | null> {
  if (kind === 'driver') {
    const row = ((await client.driversSummary()).content ?? []).find(
      (r) => r.driverAccountId === accountId
    );
    return row ? Number(row.toLiquidate ?? 0) : null;
  }
  return Number((await client.ownerDetail(accountId)).toLiquidate ?? 0);
}

type OracleSource = 'db' | 'facts' | 'get-components';
type Oracle = {
  source: OracleSource;
  total: number;
  /** Rendiciones que el oraculo espera pendientes de ESTA cuenta. */
  ids: number[];
  /** Rendiciones automaticas (DRIVER_ID NULL) del propietario. */
  autoIds: number[];
  nocomSum: number;
};

async function resolveOracle(input: {
  kind: LiquidationKind;
  accountId: number;
  carrierId: number;
  ownerId: number;
  pending: Pending;
  db: OracleDb | null;
  facts: SurrenderFact[] | null;
}): Promise<Oracle | null> {
  const { kind, accountId, carrierId, ownerId, pending, db, facts } = input;
  if (db !== null) {
    const rows =
      kind === 'driver'
        ? await driverOpenSurrenders(db, { carrierId, driverAccountId: accountId })
        : await ownerOpenSurrenders(db, { carrierId, ownerId: accountId });
    const ownerRows =
      kind === 'owner' ? rows : await ownerOpenSurrenders(db, { carrierId, ownerId });
    const ids = rows.map((r) => r.ID).sort(asc);
    return {
      source: 'db',
      total: kind === 'driver' ? driverCreateTotal(rows) : ownerCreateTotal(rows),
      ids,
      autoIds: ownerRows
        .filter((r) => r.DRIVER_ID === null)
        .map((r) => r.ID)
        .sort(asc),
      nocomSum: await nocomSumFromDb(db, carrierId, ids)
    };
  }
  if (facts !== null) {
    const autoIds = facts
      .filter((f) => f.driverId === null)
      .map((f) => f.id)
      .sort(asc);
    if (kind === 'driver') {
      const d = driverTotalFromList(facts, accountId);
      return {
        source: 'facts',
        total: d.total,
        ids: d.surrenderIds,
        autoIds,
        nocomSum: nocomSumOf(facts.filter((f) => f.driverId === accountId))
      };
    }
    const o = ownerTotalFromList(facts);
    return {
      source: 'facts',
      total: o.total,
      ids: o.surrenderIds,
      autoIds: o.autoIds,
      nocomSum: nocomSumOf(facts)
    };
  }
  if (kind === 'driver' && pending.driverRows !== null) {
    const total = driverTotalFromGet(pending.driverRows);
    if (total !== null) {
      return { source: 'get-components', total, ids: pending.ids, autoIds: [], nocomSum: 0 };
    }
  }
  return null;
}

type Ctx = {
  target: F5Target;
  profile: CarrierProfile;
  kind: LiquidationKind;
  accountId: number;
  ownerId: number;
  session: CarrierSession;
  client: SettlementClient;
  db: OracleDb | null;
  facts: SurrenderFact[] | null;
};

const oracleDb = (label: string): OracleDb | null =>
  f5LayerEnabled('db') ? requireOracle(tryCreateOracleDb(), label) : null;

// ───────────── SET-1 (solo lectura) y SET-3/SET-4 (irreversibles) ─────────────

const targets = activeF5Targets();

for (const target of targets) {
  test.describe(`@P1 @functional F5 liquidaciones · carrier ${target.id}`, () => {
    test.describe.configure({ mode: 'serial', timeout: 300_000 });

    test(`SET-1: debería coincidir lo pendiente de liquidar (API, oráculo y vista previa) para chofer y propietario (${target.id})`, async ({
      carrierPage,
      playwright
    }, testInfo) => {
      assertNotProd();
      const profile = profileOrNull(target);
      test.skip(
        profile === null,
        `[${target.id}] sin datos de liquidación en el perfil (prep): usar fr-circuit-settlement.spec.ts`
      );
      const prof = profile as CarrierProfile;
      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath(target.region)
      });
      expect(session.carrierId, `la sesión de región debe ser del carrier ${target.id}`).toBe(
        target.carrierId
      );
      const api = await session.newApiContext(playwright.request);
      try {
        const settle = prepSettlement(prof);
        const client = new SettlementClient(api, session);
        const facts = loadFacts();
        const db = oracleDb(`F5 ${target.id} liquidaciones (SET-1)`);
        if (db === null) f5DbNotApplicable(testInfo, 'AC-F5S-06 (cabecera y detalle desde DB)');
        const page = await carrierPage(target.region);
        // Solo lectura: la guarda NUNCA se arma (ningun POST de liquidacion sale desde este test).
        const guard = await installSettlementGuard(page.context(), {
          kind: 'driver',
          carrierId: target.carrierId,
          accountId: 0
        });
        const v = createF5sVerifier(testInfo);
        const summary: Record<string, unknown> = {};
        const accounts: Array<{ kind: LiquidationKind; accountId: number }> = [
          ...settle.driverIds.map((id) => ({ kind: 'driver' as const, accountId: id })),
          { kind: 'owner' as const, accountId: settle.ownerId }
        ];
        for (const { kind, accountId } of accounts) {
          const label = `${kind} ${accountId}`;
          const pending = await readPending(client, kind, accountId);
          const oracle = await resolveOracle({
            kind,
            accountId,
            carrierId: target.carrierId,
            ownerId: settle.ownerId,
            pending,
            db,
            facts
          });
          let uiTotal: number | null = null;
          if (pending.ids.length > 0) {
            const settlementPage = new SettlementPage(page, kind);
            await settlementPage.gotoCreate(accountId);
            uiTotal = (await settlementPage.readPreview()).total;
          }
          await v.verify('AC-F5S-01', () => {
            expect(
              uiTotal === null ? 0 : uiTotal,
              `${label}: vista previa == suma de comNeta del GET`
            ).toBeCloseTo(pending.apiSum, 2);
            if (oracle === null) {
              f5sObservation(
                testInfo,
                'AC-F5S-01',
                `${label}: sin oráculo independiente (declarar F5_SETTLEMENT_FACTS); solo se verificó GET == pantalla`
              );
            } else {
              expect(
                oracle.total,
                `${label}: oráculo (${oracle.source}) == suma de comNeta del GET`
              ).toBeCloseTo(pending.apiSum, 2);
            }
            return { account: label, apiSum: pending.apiSum, uiTotal, oracle };
          });
          await v.verify('AC-F5S-02', () => {
            if (oracle === null) return { account: label, skipped: 'sin oráculo' };
            const foreign = evaluateForeignSurrenders({
              pendingIds: pending.ids,
              ownIds: oracle.ids
            });
            expect(foreign.length === 0, formatMismatches(`${label}: lote ajeno`, foreign)).toBe(
              true
            );
            expect(pending.ids, `${label}: pendientes API == lote del oráculo`).toEqual(oracle.ids);
            const placement = evaluateAutoPlacement({
              autoIds: oracle.autoIds,
              driverPendingIds: kind === 'driver' ? pending.ids : [],
              ownerPendingIds: kind === 'owner' ? pending.ids : oracle.autoIds
            });
            expect(
              placement.length === 0,
              formatMismatches(`${label}: automática en el pendiente correcto`, placement)
            ).toBe(true);
            return { account: label, pending: pending.ids, auto: oracle.autoIds };
          });
          summary[label] = { pending: pending.ids, apiSum: pending.apiSum, uiTotal, oracle };
        }
        await v.verify('AC-F5S-03', () => {
          expect(guard.confirmAttempts(), 'solo lectura: ningún POST de liquidación').toBe(0);
          expect(guard.blocked(), 'solo lectura: ninguna escritura intentada').toEqual([]);
          return { blocked: guard.blocked().length };
        });
        await attachJson(testInfo, '1-pending-vs-oracle', summary);
        await attachXrayEvidence(testInfo, page, {
          name: `f5-settlement-preview-${target.id}`,
          comment: `F5 liquidaciones ${target.id}: pendientes por cuenta ${JSON.stringify(summary)}`
        });
        v.assertNoFailures();
      } finally {
        await api.dispose();
      }
    });

    for (const kind of ['driver', 'owner'] as const) {
      test(`TM-1701: debería liquidar al ${kind === 'driver' ? 'chofer' : 'propietario'} una sola vez con el total del oráculo y dejar pendiente 0 (${target.id})`, async ({
        carrierPage,
        playwright
      }, testInfo) => {
        test.skip(
          !isSettlementGateOpen(),
          'F5_CONFIRM_SETTLEMENT=1 requerido: la liquidación es irreversible (PAID, bloquea los viajes)'
        );
        const wanted = process.env.F5_SETTLEMENT_KIND?.trim();
        if (wanted !== 'driver' && wanted !== 'owner') {
          throw new Error(
            '[F5 settlement] con el gate abierto definir F5_SETTLEMENT_KIND=driver|owner (una liquidación por corrida)'
          );
        }
        test.skip(wanted !== kind, `F5_SETTLEMENT_KIND=${wanted}: este caso es ${kind}`);
        assertNotProd();
        if (targets.length !== 1) {
          throw new Error(
            `[F5 settlement] una liquidación irreversible exige UN solo target en F5_TARGETS (hay ${targets.length})`
          );
        }
        const profile = profileOrNull(target);
        if (profile === null) {
          throw new Error(
            `[F5 settlement] target ${target.id} sin datos de liquidación (prep): usar fr-circuit-settlement.spec.ts`
          );
        }
        makeAnnotate(F5_SETTLEMENT_KEYS.TC17_LIQUIDACIONES, ROUTE[kind])(`SET-${kind}`, 'POS');
        const settle = prepSettlement(profile);
        const accountId = settlementAccount(profile, kind);
        if (
          kind === 'owner' &&
          settle.ownerSharedWithOtherPairs &&
          process.env.F5_SETTLEMENT_ACK_SHARED_OWNER !== '1'
        ) {
          throw new Error(
            `[F5 settlement] propietario ${accountId} compartido con otros pares (vehículos ${settle.ownerVehicleIds.join(', ')}): ` +
              'la liquidación incluye las rendiciones de todos; avisar al carril y definir F5_SETTLEMENT_ACK_SHARED_OWNER=1 (D-4)'
          );
        }
        const declared = declaredTotal(kind);
        const facts = loadFacts();

        const session = loadCarrierSession({
          storageStatePath: regionStorageStatePath(target.region)
        });
        expect(session.carrierId, `la sesión de región debe ser del carrier ${target.id}`).toBe(
          target.carrierId
        );
        const api = await session.newApiContext(playwright.request);
        try {
          const ctx: Ctx = {
            target,
            profile,
            kind,
            accountId,
            ownerId: settle.ownerId,
            session,
            client: new SettlementClient(api, session),
            db: oracleDb(`F5 ${target.id} liquidación ${kind}`),
            facts
          };
          await runConfirmation(ctx, declared, carrierPage, testInfo);
        } finally {
          await api.dispose();
        }
      });
    }
  });
}

/** Cuerpo de la liquidacion irreversible (ver cabecera del archivo). */
async function runConfirmation(
  ctx: Ctx,
  declared: number,
  carrierPage: (region: F5Target['region']) => Promise<Page>,
  testInfo: TestInfo
): Promise<void> {
  const { target, kind, accountId, client, db } = ctx;
  const v = createF5sVerifier(testInfo);
  if (db === null) f5DbNotApplicable(testInfo, 'AC-F5S-06 (cabecera, detalle y flags desde DB)');

  // ---- 1. Precondiciones por API (sin navegador): pendientes + oraculo + total declarado ----
  const pending = await readPending(client, kind, accountId);
  if (pending.ids.length === 0) {
    throw new Error(
      `[F5 BLOCKED] ${kind} ${accountId} sin rendiciones pendientes: no hay nada que liquidar`
    );
  }
  const oracle = await resolveOracle({
    kind,
    accountId,
    carrierId: target.carrierId,
    ownerId: ctx.ownerId,
    pending,
    db,
    facts: ctx.facts
  });
  if (oracle === null) {
    throw new Error(
      `[F5 BLOCKED] sin oráculo independiente para ${kind} ${accountId} en ${target.id}: ` +
        'declarar F5_SETTLEMENT_FACTS (lista de rendiciones) o usar un ambiente con DB'
    );
  }

  // ---- 2. Vista previa de la UI (guarda armada SOLO despues de pasar el oraculo) ----
  const page = await carrierPage(target.region);
  const guard = await installSettlementGuard(page.context(), {
    kind,
    carrierId: target.carrierId,
    accountId
  });
  const settlementPage = new SettlementPage(page, kind);
  await settlementPage.gotoCreate(accountId);
  expect(page.url(), 'la pantalla de creación debe ser de la cuenta esperada').toContain(
    `/create/${accountId}`
  );
  const preview = await settlementPage.readPreview();

  await v.verify('AC-F5S-01', () => {
    const chain = evaluateDeclaredTotal({
      declared,
      oracle: oracle.total,
      shown: preview.total,
      apiSum: pending.apiSum
    });
    expect(
      chain.length === 0,
      formatMismatches(`${kind} ${accountId}: total antes del Accept`, chain)
    ).toBe(true);
    return { declared, oracle, uiTotal: preview.total, apiSum: pending.apiSum, rows: preview.rows };
  });
  await v.verify('AC-F5S-02', () => {
    const foreign = evaluateForeignSurrenders({ pendingIds: pending.ids, ownIds: oracle.ids });
    expect(foreign.length === 0, formatMismatches('lote de terceros', foreign)).toBe(true);
    expect(pending.ids, 'pendientes API == lote del oráculo').toEqual(oracle.ids);
    const placement = evaluateAutoPlacement({
      autoIds: oracle.autoIds,
      driverPendingIds: kind === 'driver' ? pending.ids : [],
      ownerPendingIds: kind === 'owner' ? pending.ids : oracle.autoIds
    });
    expect(placement.length === 0, formatMismatches('automática en su pendiente', placement)).toBe(
      true
    );
    return { pending: pending.ids, auto: oracle.autoIds };
  });
  // Fail-fast ANTES de confirmar: cualquier diferencia aborta y no se crea nada.
  if (v.failures().length > 0) v.assertNoFailures();

  const beforeToSettle = await readToSettle(client, kind, accountId);
  await attachJson(testInfo, '1-preconditions', {
    kind,
    accountId,
    declared,
    oracle,
    pending: pending.ids,
    toSettleBefore: beforeToSettle,
    uiPreview: preview
  });

  // ---- 3. Accept UNA sola vez ----
  guard.arm();
  let result: Awaited<ReturnType<SettlementPage['confirm']>> | null = null;
  try {
    result = await settlementPage.confirm({
      expectedTotal: declared,
      observations: `QA F5 ${kind} ${new Date().toISOString().slice(0, 10)}`
    });
  } catch (error) {
    await v.verify('AC-F5S-03', () => {
      throw error;
    });
  }
  await v.verify('AC-F5S-03', () => {
    expect(guard.confirmAttempts(), 'un único intento de POST de liquidación').toBe(1);
    expect(guard.confirmSent(), 'un único POST de liquidación enviado').toBe(1);
    expect(guard.blocked(), 'ninguna otra escritura intentada').toEqual([]);
    expect(result, 'el Accept debe devolver la liquidación creada').not.toBeNull();
    const posted = result?.postPayload as {
      total?: number;
      details?: Array<{ travelSurrenderId?: string | number }>;
    } | null;
    expect(result?.postStatus, 'POST de la liquidación responde 201').toBe(201);
    expect(Number(posted?.total), 'total enviado == total declarado').toBeCloseTo(declared, 2);
    const sentIds = (posted?.details ?? [])
      .flatMap((d) => String(d.travelSurrenderId ?? '').split(','))
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort(asc);
    expect(sentIds, 'el detalle enviado == rendiciones pendientes').toEqual(pending.ids);
    expect(result?.totalShownAfter, 'el detalle posterior muestra el total liquidado').toBeCloseTo(
      declared,
      2
    );
    return { liquidationId: result?.liquidationId, sentIds, posted };
  });
  if (result === null) v.assertNoFailures();
  const created = result as NonNullable<typeof result>;

  // ---- 4. Verificacion posterior ACUMULADA ----
  await v.verify('AC-F5S-04', async () => {
    const after = await readPending(client, kind, accountId);
    expect(after.ids, 'withoutLiquidations vacío tras el Accept').toEqual([]);
    const toSettle = await readToSettle(client, kind, accountId);
    expect(Number(toSettle ?? 0), '«To Settle» queda en 0').toBe(0);
    return { pendingAfter: after.ids, toSettleBefore: beforeToSettle, toSettleAfter: toSettle };
  });

  await v.verify('AC-F5S-05', async () => {
    const pdf = await client.liquidationReportPdf(kind, created.liquidationId);
    expect(pdf.status, 'el comprobante PDF debe generarse (200)').toBe(200);
    expect(isPdfBuffer(pdf.body), 'la respuesta del comprobante debe ser un PDF').toBe(true);
    const name = `comprobante-${kind}-${created.liquidationId}.pdf`;
    const path = testInfo.outputPath(name);
    writeFileSync(path, pdf.body);
    await testInfo.attach(name, { path, contentType: 'application/pdf' });
    if (!hasPdftotext()) {
      f5sObservation(
        testInfo,
        'AC-F5S-05',
        'pdftotext no está instalado: se verificó que el PDF existe, no su contenido'
      );
      return { bytes: pdf.body.length, text: 'N/A (sin pdftotext)' };
    }
    const text = extractPdfText(path);
    expect(text, 'el PDF debe tener texto legible').not.toBeNull();
    expect(
      textContainsAmount(text as string, created.totalShownAfter),
      `el comprobante debe contener el total de la pantalla (${created.totalShownAfter})`
    ).toBe(true);
    return { bytes: pdf.body.length, total: created.totalShownAfter };
  });

  let dbTotal: number | null = null;
  if (db !== null) {
    await v.verify('AC-F5S-06', async () => {
      const { liquidation, details } = await liquidationFromDb(db, kind, created.liquidationId);
      expect(liquidation, `liquidación ${created.liquidationId} debe existir en DB`).not.toBeNull();
      dbTotal = liquidation?.TOTAL ?? null;
      const chosen = await surrendersByIds(db, target.carrierId, pending.ids);
      const mismatches = evaluateCreatedLiquidation({
        kind,
        liquidation: liquidation as NonNullable<typeof liquidation>,
        details,
        chosen,
        untouched: [],
        expectedTotal: oracle.total
      });
      expect(
        mismatches.length === 0,
        formatMismatches(`liquidación ${kind} ${created.liquidationId} (DB)`, mismatches)
      ).toBe(true);
      expect(liquidation?.CARRIER_ID, 'la liquidación pertenece al carrier de la sesión').toBe(
        target.carrierId
      );
      return {
        status: liquidation?.STATUS ?? null,
        total: dbTotal,
        detail: details.map((d) => d.TRAVELSSURRENDER_ID)
      };
    });
  }

  await v.verify('AC-F5S-07', () => {
    const r = evaluateNocomOutsideTotal({
      total: dbTotal ?? created.totalShownAfter,
      oracleTotal: oracle.total,
      nocomSum: oracle.nocomSum
    });
    expect(r.mismatches.length === 0, formatMismatches('NOCOM fuera del total', r.mismatches)).toBe(
      true
    );
    if (!r.proven) {
      f5sObservation(
        testInfo,
        'AC-F5S-07',
        'el lote no tiene NOCOM > 0: la igualdad se cumple en vacío, no queda probada'
      );
    }
    return { nocomSum: oracle.nocomSum, proven: r.proven };
  });

  if (kind === 'owner') {
    // Paridad V1→V2 (no es FAILED): la columna «Deductions» de V2 muestra la agencia sin restarla (MX-4716).
    f5sObservation(
      testInfo,
      'AC-F5S-04',
      'paridad: la columna «Deductions» de la liquidación de propietario V2 muestra la comisión de la agencia sin restarla del neto (V1 muestra costo financiero + fijo de agencia + impuestos)'
    );
  }

  await attachJson(testInfo, '3-confirmed', {
    kind,
    accountId,
    liquidationId: created.liquidationId,
    declared,
    oracleSource: oracle.source,
    postPayload: created.postPayload,
    dbTotal,
    guard: {
      attempts: guard.confirmAttempts(),
      sent: guard.confirmSent(),
      blocked: guard.blocked()
    }
  });
  console.info(
    `F5_SETTLEMENT_SUMMARY ${JSON.stringify({ target: target.id, kind, accountId, liquidationId: created.liquidationId, declared })}`
  );
  await attachXrayEvidence(testInfo, page, {
    name: `f5-settlement-${kind}-${created.liquidationId}`,
    comment:
      `F5 liquidación ${kind} ${created.liquidationId} (${target.id}, cuenta ${accountId}): total ${declared} ` +
      `== oráculo (${oracle.source}), ${pending.ids.length} rendiciones, un solo POST, pendiente y To Settle en 0.`
  });
  v.assertNoFailures();
}
