// tests/specs/trips/f5-auto-surrender.spec.ts
// Universal F5 (MG-1024 BE + MG-1027 FE) · Rendicion AUTOMATICA con no comisionable (NC), multi-carrier · Xray TM-1700 (TC16).
// Armado (cashCollector del propietario) -> disparo (papelera del vehiculo > modal «automatic settlement» > Accept > PUT
// vehicles/{v}/carrier/{c}/travelsSurrender) -> verificacion -> desarmado SIEMPRE. Plan: docs/qa/f5-phase2-surrender-automation-plan.md §3 W3.
//
// IRREVERSIBLE (el disparo rinde el lote). Gates SEPARADOS, valor exacto `1`, sin alias (el historico FR_TOGGLE_AUTO_SURRENDER no abre):
//   F5_AUTO_ARM=1   arma y desarma la ficha (reversible; escribe PUT vehicleOwners, que reenvia TODOS los vehiculos de la ficha)
//   F5_AUTO_FIRE=1  dispara la rendicion (irreversible)
// Fase (F5_AUTO_PHASE): run (arm+fire+verify y desarmado en finally; exige ambos gates) | arm | fire | verify (solo lectura) | disarm.
// Ventana 12:50-13:30 UTC prohibida para arm/fire/run (el cron barre propietarios armados ~13:10 UTC); el desarmado siempre se permite.
// Solo hilo principal del orquestador (nunca un subagente), un target (F5_TARGETS=<id>), sin retries.
//
// Env: ENV=uat|test · F5_TARGETS=<1040|1481|2021 en UAT · 1521|1521b en TEST> · F5_AUTO_EXPECT_BALANCE=241.60 (saldo del pre-check; obligatorio sin
//   DB) · F5_AUTO_TRIPS=<ids csv> (obligatorio con DB) · F5_AUTO_VEHICLE_DOMAIN (si el perfil no declara la patente) · F5_AUTO_PCT=o/d/a (perfil
//   `db` sin DB) · F5_AUTO_PAIR (clave de par) · F5_AUTO_TOTALCASH_DEF=includeTollParking|excludeTollParking (H-04; default include) ·
//   F5_AUTO_APPROVED_SHARED_OWNER=<id> (alternativa al `approvedShared` del perfil para fichas compartidas).
// Capas: TEST ui+api+db (fila TRAVELSSURRENDER y libros por DB); UAT ui+api (sin DB: libro del propietario por API, AC-05/07 «N/A»).
// Lote: se prepara con f5-prep-trips (EF-NC-ONLY / EF-NC-COM para R18, sin NC para R19); este spec NO crea viajes.
import { test, expect, regionStorageStatePath } from '../../fixtures/carrierRegionFixture.js';
import type { Page } from '@playwright/test';
import { loadCarrierSession } from '../../api/clients/carrierSession.js';
import { CheckingAccountClient } from '../../api/clients/checkingAccount.client.js';
import { SettlementClient } from '../../api/clients/settlement.client.js';
import { SurrenderClient } from '../../api/clients/surrender.client.js';
import { VehicleOwnersClient } from '../../api/clients/vehicleOwners.client.js';
import { activeF5Targets } from '../../config/f5-targets.js';
import { tryCreateOracleDb } from '../../db/OracleDb.js';
import { F5_KEYS } from '../../data/xray/f5-keys.js';
import { compareBatchIds } from '../../helpers/auto-surrender.js';
import { requireOracle } from '../../helpers/db-gate.js';
import { evaluateGetInternal, expectedFromGet } from '../../helpers/f5-api-oracle.js';
import {
  verifyF5Auto,
  f5AutoNotApplicable,
  f5AutoObservation
} from '../../helpers/f5-auto-acceptance.js';
import {
  classifyDisarmResponse,
  decideDisarm,
  diffFingerprints,
  evaluateAutoPrecheck,
  evaluateOwnerGuard,
  evaluatePendingEmpty,
  evaluatePendingUiRows,
  f5AutoPhaseFromEnv,
  f5CronBlock,
  fichaFingerprint,
  isAutoGateOpen,
  isAutoWriteAllowed,
  autoGateSkipReason,
  parseDeclaredBatch,
  type DisarmOutcome
} from '../../helpers/f5-auto-guards.js';
import {
  classifySurrendered,
  evaluateAutoOwnerBook,
  evaluateAutoRow,
  evaluateNoNewDriverBookRows,
  evaluateToSettleDelta,
  expectedF5Auto,
  factsFromExpected,
  ownerBookApiToRows,
  resolveAutoCommission,
  type F5AutoExpected
} from '../../helpers/f5-auto-oracle.js';
import { f5LayerEnabled } from '../../helpers/f5-layers.js';
import { formatMismatches, type F5TotalCashDefinition } from '../../helpers/f5-surrender-oracle.js';
import { OwnerEditPage } from '../../pages/carrier-v2/owners/OwnerEditPage.js';
import { SurrenderPage } from '../../pages/carrier-v2/pay/SurrenderPage.js';
import {
  autoSnapshotPath,
  readAutoRowReading,
  readAutoSnapshot,
  resolveAutoContext,
  writeAutoSnapshot,
  type F5AutoSnapshot
} from '../../steps/trips/f5AutoSurrender.steps.js';
import {
  countDriverBookOfSurrender,
  readOwnerBookOfSurrender,
  surrenderIdsOfTrips,
  tripIdsOfSurrender
} from '../../steps/trips/autoSurrender.steps.js';
import { readF5CommissionInputs, readF5TripFacts } from '../../steps/trips/f5Surrender.steps.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/owner/edit';
const phase = f5AutoPhaseFromEnv();
const skipReason = autoGateSkipReason(phase);
const targets = activeF5Targets();
const gates = {
  arm: () => isAutoGateOpen('F5_AUTO_ARM'),
  fire: () => isAutoGateOpen('F5_AUTO_FIRE')
};

const totalCashDefinition = (): F5TotalCashDefinition => {
  const raw = process.env.F5_AUTO_TOTALCASH_DEF?.trim();
  if (!raw) return 'includeTollParking';
  if (raw === 'includeTollParking' || raw === 'excludeTollParking') return raw;
  throw new Error(`F5_AUTO_TOTALCASH_DEF invalido: "${raw}"`);
};

for (const target of targets) {
  test.describe(`@P1 @functional @irreversible F5 rendición automática con NC · carrier ${target.id}`, () => {
    test(`TM-1700: debería rendir automáticamente el lote del propietario y dejar NC fuera de comisiones, con TDOC solo si hay NC (${target.id})`, async ({
      carrierPage,
      playwright
    }, testInfo) => {
      test.skip(skipReason !== null, `F5 automática: ${skipReason ?? ''}`);
      test.setTimeout(480_000);
      if (phase === null) throw new Error('unreachable');
      if (targets.length !== 1) {
        throw new Error(`[F5 auto] exige UN solo target en F5_TARGETS (hay ${targets.length})`);
      }
      if (testInfo.retry > 0)
        throw new Error('[F5 auto] sin retries: un reintento repetiria escrituras');
      makeAnnotate(F5_KEYS.TC16_AUTOMATICA, ROUTE)('TC16-auto', 'E2E');

      const env = process.env.ENV?.trim() || 'test';
      const ctx = resolveAutoContext(target);
      const declared = parseDeclaredBatch();
      const dbLayer = f5LayerEnabled('db');
      const writesArm = phase === 'run' || phase === 'arm';
      const writesFire = phase === 'run' || phase === 'fire';
      if (writesArm || writesFire) {
        const block = f5CronBlock(new Date(), phase === 'run' ? 10 : 3);
        if (block.blocked) throw new Error(`[F5 auto] ${block.reason}`);
        if (!dbLayer && declared.balance === null) {
          throw new Error(
            '[F5 auto] sin capa db el pre-check exige F5_AUTO_EXPECT_BALANCE (saldo de la fila en Pending, p. ej. 241.60)'
          );
        }
      }
      if (dbLayer && declared.tripIds === null) {
        throw new Error('[F5 auto] con la capa db F5_AUTO_TRIPS (ids del lote) es obligatorio');
      }

      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath(target.region)
      });
      expect(session.carrierId, `la sesión de región debe ser del carrier ${target.id}`).toBe(
        ctx.carrierId
      );
      const api = await session.newApiContext(playwright.request);
      try {
        const surrender = new SurrenderClient(api, session);
        const owners = new VehicleOwnersClient(api, session);
        const settlement = new SettlementClient(api, session);
        const checking = new CheckingAccountClient(api, session);
        const oracle = dbLayer ? requireOracle(tryCreateOracleDb(), `F5 auto ${target.id}`) : null;
        const snapPath = autoSnapshotPath(env, target.id);
        const page: Page = await carrierPage(target.region);

        // Firewall: solo PUT del propietario del par y PUT travelsSurrender del vehiculo del par; el resto de escrituras de rendicion se aborta.
        const blocked: string[] = [];
        await page.route('**/*', async (route, request) => {
          if (
            isAutoWriteAllowed(request.method(), request.url(), {
              ownerId: ctx.ownerId,
              vehicleId: ctx.vehicleId
            })
          ) {
            await route.fallback();
            return;
          }
          blocked.push(`${request.method()} ${request.url().split('?')[0]}`);
          await route.abort('blockedbyclient');
        });

        const editPage = () => new OwnerEditPage(page, gates);
        const ownerVehicleIds = ctx.owner.vehicleIds;

        // ───────────── lecturas ─────────────
        const readBook = async () =>
          (await checking.ownerMovements({ ownerId: ctx.ownerId, size: 200, sort: 'DESC' })).rows;
        const readToSettle = async (): Promise<number | null> => {
          const d = await settlement.ownerDetail(ctx.ownerId);
          return typeof d.toLiquidate === 'number' ? d.toLiquidate : null;
        };
        const pendingRows = () => surrender.pendingSummary();

        const buildExpected = async (): Promise<F5AutoExpected> => {
          const batch = { driverUserId: ctx.driverId, vehicleId: ctx.vehicleId };
          const [totals, preview] = await Promise.all([
            surrender.totals(batch),
            surrender.preview(batch)
          ]);
          let facts;
          let dbInputs = null;
          if (oracle) {
            const lote = preview.rows.map((r) => ({
              travelId: Number(r.travelId),
              paymentMethod: String(r.paymentMethod)
            }));
            const idsVerdict = compareBatchIds(
              lote.map((l) => l.travelId),
              declared.tripIds ?? []
            );
            expect(idsVerdict, `lote pendiente vs F5_AUTO_TRIPS: ${idsVerdict ?? ''}`).toBeNull();
            facts = await readF5TripFacts(oracle, lote);
            dbInputs = await readF5CommissionInputs(oracle, {
              travelIds: lote.map((l) => l.travelId),
              driverId: ctx.driverId,
              vehicleId: ctx.vehicleId
            });
          } else {
            const internal = evaluateGetInternal(totals, preview.rows);
            expect(
              internal.ok,
              formatMismatches(
                'GET toTravelsSurrender internamente inconsistente',
                internal.mismatches
              )
            ).toBe(true);
            facts = factsFromExpected(expectedFromGet(totals));
          }
          const commission = resolveAutoCommission({
            source: ctx.pair.commission,
            dbInputs,
            override: process.env.F5_AUTO_PCT
          });
          const expected = expectedF5Auto(facts, {
            pct: commission.pct,
            fixed: commission.fixed,
            fixedDays: 1,
            totalCashDefinition: totalCashDefinition()
          });
          await testInfo.attach('f5-auto-expected', {
            body: JSON.stringify(
              { expected, commissionOrigin: commission.origin, totals },
              null,
              2
            ),
            contentType: 'application/json'
          });
          return expected;
        };

        // ───────────── fases ─────────────
        let snapshot: F5AutoSnapshot | null = readAutoSnapshot(snapPath);
        let armAttempted = false;
        let outcome:
          | DisarmOutcome
          | { kind: 'not-needed' }
          | { kind: 'aborted-ficha'; detail: string } = { kind: 'not-needed' };

        const preArm = async (): Promise<void> => {
          await verifyF5Auto(testInfo, 'AC-F5A-01', async () => {
            const first = await owners.read(ctx.ownerId);
            const guard = evaluateOwnerGuard({ profileOwner: ctx.owner, fresh: first.reading });
            expect(
              guard.ok,
              formatMismatches(
                `[F5 auto BLOCKED] ficha del propietario ${ctx.ownerId}`,
                guard.mismatches
              )
            ).toBe(true);
            const pre = evaluateAutoPrecheck({
              summaryRows: await pendingRows(),
              vehicleId: ctx.vehicleId,
              ownerVehicleIds,
              declared: { trips: declared.tripIds?.length ?? null, balance: declared.balance }
            });
            expect(
              pre.ok,
              formatMismatches(
                '[F5 auto BLOCKED] pre-check del lote exacto (filas y saldo)',
                pre.mismatches
              )
            ).toBe(true);
            const expected = await buildExpected();
            for (const o of expected.observations) f5AutoObservation(testInfo, 'H-04', o);
            if (guard.mode === 'approved-shared') {
              f5AutoObservation(
                testInfo,
                'D-4',
                `propietario compartido aprobado (${ownerVehicleIds.join(', ')}): se compara la ficha antes/despues`
              );
            }
            snapshot = {
              version: 1,
              env,
              target: target.id,
              ownerId: ctx.ownerId,
              vehicleId: ctx.vehicleId,
              createdAt: new Date().toISOString(),
              armedByUs: false,
              fichaFingerprintBefore: fichaFingerprint(first.body),
              ficha: {
                vehicleIds: first.reading.vehicleIds ? [...first.reading.vehicleIds] : null
              },
              toSettleBefore: await readToSettle(),
              ownerBookIdsBefore: (await readBook()).map((r) => r.id),
              expected,
              declared
            };
            writeAutoSnapshot(snapPath, snapshot);
            return {
              mode: guard.mode,
              scenario: expected.scenario,
              vehicles: first.reading.vehicleIds
            };
          });
        };

        const arm = async (): Promise<void> => {
          if (snapshot === null)
            throw new Error('[F5 auto] sin snapshot: el pre-check debe correr antes de armar');
          await verifyF5Auto(testInfo, 'AC-F5A-02', async () => {
            const edit = editPage();
            await edit.goto(ctx.ownerId);
            // Relectura inmediata antes del PUT: la ficha no debe haber cambiado desde el pre-check (el PUT reenvia todos los vehiculos).
            const again = await owners.read(ctx.ownerId);
            const guard = evaluateOwnerGuard({ profileOwner: ctx.owner, fresh: again.reading });
            expect(
              guard.ok,
              formatMismatches('[F5 auto ABORT] ficha cambio antes de armar', guard.mismatches)
            ).toBe(true);
            const drift = diffFingerprints(
              snapshot!.fichaFingerprintBefore,
              fichaFingerprint(again.body)
            );
            expect(
              drift.ok,
              formatMismatches(
                '[F5 auto ABORT] vehiculos con valores distintos entre la lectura y el PUT',
                drift.mismatches
              )
            ).toBe(true);
            expect(
              await edit.readCollectsCash(),
              'la pantalla debe mostrar Company antes de armar'
            ).toBe('company');
            armAttempted = true;
            const res = await edit.setCollectsCash('owner', {
              persist: true,
              ownerId: ctx.ownerId
            });
            expect(res.saveStatus, 'PUT vehicleOwners debe responder 2xx').toBeLessThan(300);
            const after = await owners.read(ctx.ownerId);
            expect(after.reading.cashCollector, 'GET cashCollector tras armar').toBe(true);
            snapshot = { ...snapshot!, armedByUs: true, armedAt: new Date().toISOString() };
            writeAutoSnapshot(snapPath, snapshot);
            return { putStatus: res.saveStatus };
          });
        };

        const fire = async (): Promise<void> => {
          if (snapshot?.armedByUs !== true)
            throw new Error(
              '[F5 auto] sin armado propio registrado en el snapshot: correr arm antes de fire'
            );
          await verifyF5Auto(testInfo, 'AC-F5A-03', async () => {
            const flag = await owners.read(ctx.ownerId);
            expect(
              flag.reading.cashCollector,
              'el propietario debe estar armado (GET) antes de disparar'
            ).toBe(true);
            const pre = evaluateAutoPrecheck({
              summaryRows: await pendingRows(),
              vehicleId: ctx.vehicleId,
              ownerVehicleIds,
              declared: { trips: declared.tripIds?.length ?? null, balance: declared.balance }
            });
            expect(
              pre.ok,
              formatMismatches(
                '[F5 auto BLOCKED] pre-check del lote antes de disparar',
                pre.mismatches
              )
            ).toBe(true);
            const edit = editPage();
            // La ficha navega tras «Update»: el disparo va en una segunda carga (receta UAT 10/11).
            await edit.goto(ctx.ownerId);
            expect(
              await edit.readCollectsCash(),
              'la ficha recargada debe mostrar Vehicle Owner'
            ).toBe('owner');
            const res = await edit.triggerVehicleSurrender({
              vehicleId: ctx.vehicleId,
              carrierId: ctx.carrierId,
              domain: ctx.domain,
              requireAutoModal: true
            });
            expect(res.putStatus, 'PUT travelsSurrender').toBe(200);
            expect(res.putBody, 'cuerpo del PUT travelsSurrender').toBe(true);
            expect(res.blocked, 'travelsSurrender fuera de la allowlist').toEqual([]);
            expect(blocked, 'escrituras abortadas por el firewall').toEqual([]);
            snapshot = {
              ...snapshot!,
              firedAt: new Date().toISOString(),
              firePutStatus: res.putStatus
            };
            writeAutoSnapshot(snapPath, snapshot);
            return {
              modal: res.modalVariant,
              putStatus: res.putStatus,
              driversModalShown: res.driversModalShown
            };
          });
        };

        const verify = async (): Promise<void> => {
          if (snapshot === null)
            throw new Error(
              '[F5 auto] verify exige el snapshot de la corrida (corrido arm/run antes)'
            );
          const snap = snapshot;
          const expected = snap.expected;
          await verifyF5Auto(testInfo, 'AC-F5A-04', async () => {
            await expect
              .poll(
                async () =>
                  evaluatePendingEmpty({ summaryRows: await pendingRows(), ownerVehicleIds }).ok,
                {
                  timeout: 45_000,
                  message: 'Pending del propietario no quedó vacío (API)'
                }
              )
              .toBe(true);
            const surrenderPage = new SurrenderPage(page);
            await surrenderPage.openPending();
            const ui = evaluatePendingUiRows(
              await surrenderPage.pendingRows.allInnerTexts(),
              ctx.domain
            );
            expect(ui.ok, formatMismatches('Pending (UI) tras disparar', ui.mismatches)).toBe(true);
          });

          let surrenderId: number | null = null;
          if (oracle) {
            const db = oracle;
            const tripIds = snap.declared.tripIds ?? [];
            await verifyF5Auto(testInfo, 'AC-F5A-05', async () => {
              await expect
                .poll(
                  async () => {
                    const m = await surrenderIdsOfTrips(db, tripIds);
                    const ids = new Set(tripIds.map((t) => m.get(t) ?? null));
                    surrenderId = ids.size === 1 ? ([...ids][0] as number | null) : null;
                    return surrenderId;
                  },
                  {
                    timeout: 60_000,
                    message: 'los viajes del lote no apuntan a UNA rendición (TRAVELSSURRENDER_ID)'
                  }
                )
                .not.toBeNull();
              const id = surrenderId as unknown as number;
              const lote = compareBatchIds(await tripIdsOfSurrender(db, id), tripIds);
              expect(lote, `lote exacto de la rendición ${id}: ${lote ?? ''}`).toBeNull();
              const read = await readAutoRowReading(db, id);
              const v = evaluateAutoRow(read.row, expected, {
                ownerId: ctx.ownerId,
                vehicleId: ctx.vehicleId
              });
              expect(
                v.ok,
                formatMismatches(`TRAVELSSURRENDER ${id} (automática)`, v.mismatches)
              ).toBe(true);
              const sur = classifySurrendered(read.surrendered, expected.surrendered);
              expect(
                sur.kind,
                `SURRENDERED ${read.surrendered} vs TOTALCASH ${expected.surrendered.base}`
              ).not.toBe('distinto');
              if (sur.observation) f5AutoObservation(testInfo, 'C2', sur.observation);
              f5AutoObservation(
                testInfo,
                'H-AUTO-03',
                'AGENCY_NETPAID = 0 en automática (en manuales = TOTAL_COLLECTED): regla del PO abierta; se asevera el valor medido'
              );
              return {
                surrenderId: id,
                surrendered: read.surrendered,
                operativeDifference: read.operativeDifference
              };
            });
          } else {
            f5AutoNotApplicable(
              testInfo,
              'AC-F5A-05',
              'N/A en UAT (decisión: solo UI+API; sin DB)'
            );
          }

          await verifyF5Auto(testInfo, 'AC-F5A-06', async () => {
            const rows = oracle
              ? await readOwnerBookOfSurrender(oracle, surrenderId as unknown as number)
              : ownerBookApiToRows(
                  (await readBook()).filter((r) => !snap.ownerBookIdsBefore.includes(r.id))
                );
            expect(
              rows.length,
              'el libro del propietario debe tener movimientos nuevos de la rendición'
            ).toBeGreaterThan(0);
            const v = evaluateAutoOwnerBook(rows, expected);
            expect(v.ok, formatMismatches('libro del propietario (TDCV/TDOC)', v.mismatches)).toBe(
              true
            );
            f5AutoObservation(
              testInfo,
              'OBS-FR-02',
              'TDCV es CRÉDITO del propietario (comisión de agencia); se asevera el signo medido'
            );
            f5AutoObservation(
              testInfo,
              'OBS-FR-01',
              'Closed no lista rendiciones automáticas (PREEXISTENTE en PROD): no se asevera su presencia en Closed'
            );
            return { tdcvCredit: v.tdcvCredit, tdocCredit: v.tdocCredit, rows: rows.length };
          });

          if (oracle) {
            await verifyF5Auto(testInfo, 'AC-F5A-07', async () => {
              const n = await countDriverBookOfSurrender(oracle, surrenderId as unknown as number);
              const v = evaluateNoNewDriverBookRows(n);
              expect(v.ok, formatMismatches('libro del chofer', v.mismatches)).toBe(true);
            });
          } else {
            f5AutoNotApplicable(
              testInfo,
              'AC-F5A-07',
              'N/A en UAT (sin DB; el libro del chofer por API exige DRIVER.USER_ID no declarado)'
            );
          }

          if (snap.toSettleBefore === null) {
            f5AutoNotApplicable(testInfo, 'AC-F5A-08', 'sin «To Settle» previo en el snapshot');
          } else {
            await verifyF5Auto(testInfo, 'AC-F5A-08', async () => {
              const after = await readToSettle();
              const v = evaluateToSettleDelta(
                snap.toSettleBefore,
                after,
                expected.ownerToSettleDelta
              );
              expect(v.ok, formatMismatches('To Settle del propietario', v.mismatches)).toBe(true);
              return { before: snap.toSettleBefore, after };
            });
          }
        };

        /** Desarma si corresponde. NUNCA lanza: devuelve el resultado; nunca con rendicion pendiente; sin reintentos en bucle. */
        const disarm = async (): Promise<void> => {
          try {
            const cur = await owners.read(ctx.ownerId);
            const armedNow = cur.reading.cashCollector;
            const decision = decideDisarm({
              armedNow,
              pendingOwnerRows: (await pendingRows()).filter((r) =>
                ownerVehicleIds.includes(r.vehicleId)
              ).length
            });
            if (decision === 'already-company') {
              outcome = { kind: 'not-needed' };
              return;
            }
            if (decision === 'blocked-pending') {
              outcome = {
                kind: 'error',
                status: 0,
                detail:
                  'rendición pendiente del propietario: NO se desarma (400 VEHICLE_OWNER_HAS_PENDING_SURRENDER). El propietario QUEDA ARMADO'
              };
              return;
            }
            // Relectura antes de desarmar: un vehiculo no QA o valores cambiados abortan (el PUT los reenviaria).
            const guard = evaluateOwnerGuard({
              profileOwner: { ...ctx.owner },
              fresh: { ...cur.reading, cashCollector: false },
              env: process.env
            });
            const drift = snapshot
              ? diffFingerprints(snapshot.fichaFingerprintBefore, fichaFingerprint(cur.body))
              : { ok: true, mismatches: [] };
            if (!guard.ok || !drift.ok) {
              outcome = {
                kind: 'aborted-ficha',
                detail: formatMismatches(
                  'ficha cambió antes de desarmar; el propietario QUEDA ARMADO, desarmar a mano',
                  [...guard.mismatches, ...drift.mismatches]
                )
              };
              return;
            }
            const edit = editPage();
            await edit.goto(ctx.ownerId);
            const res = await edit.setCollectsCash('company', {
              persist: true,
              ownerId: ctx.ownerId
            });
            outcome =
              res.saveStatus === null
                ? { kind: 'ok' }
                : classifyDisarmResponse(res.saveStatus, res.saveBody ?? '');
          } catch (error) {
            outcome = {
              kind: 'error',
              status: 0,
              detail: error instanceof Error ? error.message : String(error)
            };
          }
        };

        const assertDisarmed = async (): Promise<void> => {
          await verifyF5Auto(testInfo, 'AC-F5A-09', async () => {
            expect(['ok', 'not-needed'], `desarmado: ${JSON.stringify(outcome)}`).toContain(
              outcome.kind
            );
            const after = await owners.read(ctx.ownerId);
            expect(after.reading.cashCollector, 'GET cashCollector tras desarmar').toBe(false);
            const v = snapshot
              ? diffFingerprints(snapshot.fichaFingerprintBefore, fichaFingerprint(after.body))
              : { ok: true, mismatches: [] };
            expect(
              v.ok,
              formatMismatches(
                'ficha tras desarmar (todos los vehículos con sus valores)',
                v.mismatches
              )
            ).toBe(true);
            const guard = evaluateOwnerGuard({ profileOwner: ctx.owner, fresh: after.reading });
            expect(
              guard.ok,
              formatMismatches('vehículos de la ficha tras desarmar', guard.mismatches)
            ).toBe(true);
            return { outcome: outcome.kind };
          });
        };

        // ───────────── ejecucion ─────────────
        let primary: unknown;
        try {
          if (phase === 'run' || phase === 'arm') {
            if (
              readAutoSnapshot(snapPath)?.armedByUs === true &&
              (await owners.read(ctx.ownerId)).reading.cashCollector === true
            ) {
              throw new Error(
                `[F5 auto] el snapshot ${snapPath} registra un armado previo sin desarmar: correr F5_AUTO_PHASE=disarm antes`
              );
            }
            await preArm();
            await arm();
          } else {
            snapshot = readAutoSnapshot(snapPath);
          }
          if (phase === 'run' || phase === 'fire') await fire();
          if (phase === 'run' || phase === 'verify') await verify();
        } catch (error) {
          primary = error;
        }
        // Desarmado SIEMPRE si esta corrida (o el snapshot) armo: se evalua con GET, aun ante falla, y nunca antes de que el disparo termine.
        const mustDisarm =
          phase === 'disarm' || armAttempted || (phase === 'fire' && snapshot?.armedByUs === true);
        let secondary: unknown;
        if (mustDisarm && (phase === 'run' || phase === 'disarm' || primary !== undefined)) {
          if (phase === 'disarm' && snapshot?.armedByUs !== true) {
            throw new Error(
              '[F5 auto] disarm exige un snapshot con armado propio (armedByUs): no se desarma estado ajeno'
            );
          }
          await disarm();
          try {
            await assertDisarmed();
          } catch (error) {
            secondary = error;
          }
          if (snapshot && ['ok', 'not-needed'].includes(outcome.kind)) {
            writeAutoSnapshot(snapPath, { ...snapshot, armedByUs: false });
          }
        }
        if (primary !== undefined) throw primary;
        if (secondary !== undefined) throw secondary;
      } finally {
        await api.dispose();
      }
    });
  });
}
