// tests/specs/trips/driver-circuit.spec.ts
// Automatic closure (the DRIVER finalizes) with a sale-only tariff: cost must equal sale for every
// pair (PLAN-REGRESION-COSTO-VENTA-2026-10-13, T5). Flow: UI create (Send Manual) -> carrier assign
// (API) -> driver confirm -> goingToDestination -> arriveToDestination -> finalize with the app's SALE
// fields and WITHOUT `*Cost` (old-app closure; backend rule F2-BE-04 resolves the pairs) -> detail -> grid row.
//
// - Oracle: `evaluateCostEqualsSale` over the detail once the trip is DONE; amount > 0 is asserted
//   first (a 0 km closure gave a vacuous 0/0, trip 70921).
// - finalKm = distance read from the quoted trip detail (never 0).
// - Gate AUTO_CLOSE_CREATE_TRIP=1: creates a PERMANENT trip (DONE), recorded in the `admin-circuit`
//   ledger so manual regression R-01 excludes it. No retries: a retry would create another one.
// - Precondition: the test driver (AUTO_CLOSE_DRIVER_ID = DRIVER.USER_ID) must have no open or
//   incoming trip. If blocked the test FAILS before creating anything (never skips, never touches
//   the other trip).
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import {
  assignTravelToDriver,
  type FinalizeTravelPayload
} from '../../api/clients/driverTravels.client.js';
import {
  COST_SALE_SCOPE_NOTE,
  evaluateCostEqualsSale,
  tariffEvidence
} from '../../helpers/cost-sale.js';
import { AdminCircuitFlow } from '../../steps/trips/adminCircuit.steps.js';
import { makeAnnotate } from '../../utils/traceability.js';
import type { TravelDetail } from '../../api/clients/travels.client.js';

const ROUTE = '/carrier/#/travel/create';
const TM_DRIVER_CLOSURE = 'TM-1406';

type Row = {
  label: string;
  tariff: number;
  client: string;
  authorizer?: string;
  paymentMethod: string;
};
// Row 1: tariff 2261 (client «Stripe, Cliente», quotes > 0 on the default route in TEST).
// Row 2: sale-only tariff 6204 «QA F2 Venta» (contractor «Alpine F1 Team», authorizer «Krief»), same
// customer/authorizer/payment as the TM-1402 6204 row of admin-circuit.spec.ts.
const ROWS: Row[] = [
  { label: 'tariff 2261', tariff: 2261, client: 'Stripe, Cliente', paymentMethod: 'Cash' },
  {
    label: 'tariff 6204',
    tariff: 6204,
    client: process.env.ADMIN_CIRCUIT_SALE_ONLY_CLIENT ?? 'Alpine',
    authorizer: process.env.ADMIN_CIRCUIT_SALE_ONLY_AUTHORIZER ?? 'Krief',
    paymentMethod: process.env.ADMIN_CIRCUIT_SALE_ONLY_PAYMENT ?? 'Cash'
  }
];

const STATE_DONE = /^DONE$/i;
const TERMINAL_STATE = /^(DONE|CANCELL?ED|LOST)$/i;
const ADMIN_CLOSED_LABEL = /^Adm\. Closed$/i;
const stateOf = (detail: TravelDetail): string => String(detail.state ?? '');

function requirePositiveEnv(name: string): number {
  const value = Number(process.env[name]?.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[driver-circuit] ${name} is not set or not a positive integer`);
  }
  return value;
}

/** Quoted distance: `simulationPrice.distance` of the detail (verified on trip 71203 = 19 km). */
function quotedDistance(detail: TravelDetail): number {
  const sim = (detail.simulationPrice ?? {}) as Record<string, unknown>;
  const n = Number(sim.distance);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `[driver-circuit] detail.simulationPrice.distance is not a positive number (${String(sim.distance)}); finalKm cannot be 0`
    );
  }
  return n;
}

/**
 * Finalize body as driver app 2.6.16 builds it (travel-resume.ts payTravel): the SALE amounts
 * (finalCost, totalCostPartial, tripAmountMagiis) come from the quote, plus destination/duration;
 * no `*Cost` fields (the backend must derive the cost pairs - that is the regression under test).
 * Without the sale amounts the backend persists 0 (trip 71215), unlike app trip 71106.
 */
function appFinalizePayload(
  quoted: TravelDetail,
  finalKm: number,
  paymentMethod: string,
  quotedSale: number
): FinalizeTravelPayload {
  // Before the close, detail.tourPrice/amount are 0: the quote is the UI «Trip Total».
  const sale = quotedSale;
  if (!Number.isFinite(sale) || sale <= 0) {
    throw new Error(`[driver-circuit] quoted sale amount is not positive (${String(sale)})`);
  }
  const dest = (quoted.destination ?? {}) as Record<string, unknown>;
  return {
    paymentMethod: paymentMethod.toUpperCase(),
    finalKm,
    finalCost: sale,
    totalCostPartial: sale,
    tripAmountMagiis: sale,
    tollPrice: 0,
    parking: 0,
    otherCost: 0,
    additionalStop: 0,
    waitTime: 0,
    waitTimePrice: 0,
    // Persisted by the backend when sent; omitting roundTrip nulls TRAVEL.ROUNDTRIP and the detail GET 500s.
    roundTrip: quoted.roundTrip === true,
    qrPayment: quoted.qrPayment === true,
    useDistanceMatrix: quoted.useDistanceMatrix === true,
    paxQty: Number(quoted.paxQty ?? 1),
    tip: 0,
    fixConceptsCost: 0,
    taxesCost: 0,
    waitDetailList: [],
    containSign: false,
    duration: Number(quoted.travelDuration ?? 0),
    destination: {
      id: (dest.id as number | null | undefined) ?? null,
      latitude: String(dest.latitude),
      longitude: String(dest.longitude),
      shortName: dest.shortName as string | undefined
    }
  };
}

test.describe('Driver circuit closure (cost == sale)', () => {
  test.skip(
    process.env.AUTO_CLOSE_CREATE_TRIP !== '1',
    'Creates a permanent trip closed by the driver (DONE): requires AUTO_CLOSE_CREATE_TRIP=1'
  );
  test.describe.configure({ timeout: 240_000 });

  // Trip created by the running test and not yet DONE; cancelled in afterEach if the flow fails midway.
  let pendingTripId: number | null = null;

  test.afterEach(async ({ travelsApi }, testInfo) => {
    const id = pendingTripId;
    pendingTripId = null;
    if (id === null || testInfo.status === 'passed') return;
    try {
      await travelsApi.cancel(id);
      console.log(`[driver-circuit] cleanup: trip ${id} cancelled after failed flow`);
    } catch (e) {
      console.log(
        `[driver-circuit] cleanup: cancel of trip ${id} failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`
      );
    }
  });

  for (const row of ROWS) {
    test(`${TM_DRIVER_CLOSURE}: validar-cierre-chofer cost equals sale on driver closure (${row.label})`, async ({
      page,
      carrierApi,
      carrierSession,
      travelsApi,
      checkingAccountApi,
      driverTravelsApi
    }, testInfo) => {
      makeAnnotate(TM_DRIVER_CLOSURE, ROUTE)('F-CH', 'HP');
      const driverUserId = requirePositiveEnv('AUTO_CLOSE_DRIVER_ID');

      const flow = new AdminCircuitFlow(travelsApi, checkingAccountApi);
      // Precondition (read-only): busy = a current trip, or an incoming trip that is not terminal.
      // incomingTripId keeps pointing to the last trip even when DONE, so its state is read; if
      // that read fails (5xx seen on 71215) we proceed and let the backend decide at assign.
      const status = await driverTravelsApi.getStatus(driverUserId);
      if (status.currentTrip !== null) {
        throw new Error(`[driver-circuit] BLOCKED: driver ${driverUserId} has a current trip`);
      }
      if (status.incomingTripId !== null) {
        const incomingState = await flow
          .readDetail({ travelId: status.incomingTripId })
          .then((d) => stateOf(d))
          .catch((e: unknown) => {
            console.log(
              `[driver-circuit] incoming trip ${status.incomingTripId} detail unreadable, deferring to assign: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`
            );
            return null;
          });
        if (incomingState !== null && !TERMINAL_STATE.test(incomingState)) {
          throw new Error(
            `[driver-circuit] BLOCKED: driver ${driverUserId} has an open incoming trip ${status.incomingTripId} (${incomingState})`
          );
        }
      }

      const { travelId, simulatedAmount } = await flow.createViaUi({
        page,
        client: row.client,
        ...(row.authorizer ? { authorizer: row.authorizer } : {}),
        paymentMethod: row.paymentMethod,
        assertBeforeSubmit: ({ simulatedAmount, resolvedOrigin, resolvedDestination }) => {
          expect(
            resolvedOrigin !== resolvedDestination,
            `precondicion: origen y destino resueltos deben diferir (ambos «${resolvedOrigin}» darian distancia 0 y precio 0)`
          ).toBe(true);
          expect(
            simulatedAmount,
            `precondicion: la cotizacion del cliente «${row.client}» debe ser > 0 (un total 0 haria pasar los oraculos en vacio)`
          ).toBeGreaterThan(0);
        }
      });
      pendingTripId = travelId;
      const quoted = await flow.readDetail({ travelId });
      const finalKm = quotedDistance(quoted);

      await assignTravelToDriver({ carrierApi, carrierSession, travelId, driverUserId }).catch(
        (e: unknown) => {
          throw new Error(
            `[driver-circuit] BLOCKED: backend rejected assign of trip ${travelId} to driver ${driverUserId}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      );
      await driverTravelsApi.confirm(travelId, driverUserId);
      await driverTravelsApi.goingToDestination({ travelId });
      await driverTravelsApi.arriveToDestination({ travelId });
      await driverTravelsApi.finalize({
        travelId,
        payload: appFinalizePayload(quoted, finalKm, row.paymentMethod, simulatedAmount)
      });

      await expect
        .poll(async () => stateOf(await flow.readDetail({ travelId })), {
          message: `trip ${travelId} must reach DONE after the driver finalizes`,
          timeout: 60_000
        })
        .toMatch(STATE_DONE);
      const done = await flow.readDetail({ travelId });
      pendingTripId = null;

      expect(Number(done.amount), 'amount must be > 0 before comparing pairs').toBeGreaterThan(0);
      const costSale = evaluateCostEqualsSale({
        detail: done,
        label: `${row.label} driver closure`
      });
      expect(costSale.ok, costSale.message).toBe(true);
      const { pairs } = costSale;
      testInfo.annotations.push({ type: 'xray_comment', description: COST_SALE_SCOPE_NOTE });

      const grid = await flow.readGridStatus({ page, travelId, tab: 'finalized' });
      expect(grid.statusText, 'driver closure must show a closed status').not.toBe('');
      expect(grid.statusText, 'driver closure must not be labeled administrative').not.toMatch(
        ADMIN_CLOSED_LABEL
      );

      await testInfo.attach(`medicion-${travelId}`, {
        body: JSON.stringify(
          {
            travelId,
            row: row.label,
            simulatedAmount,
            finalKm,
            state: stateOf(done),
            amount: done.amount ?? null,
            pairs,
            tariff: tariffEvidence(done, row.tariff),
            gridStatusText: grid.statusText,
            ledger: 'admin-circuit',
            measuredAt: new Date().toISOString()
          },
          null,
          2
        ),
        contentType: 'application/json'
      });
      await attachXrayEvidence(testInfo, page, {
        name: `driver-circuit-${travelId}`,
        locator: grid.row,
        comment:
          `Trip ${travelId} (${grid.tripCode}) ${row.label}: simulated ${simulatedAmount}, driver finalize finalKm ${finalKm} without cost fields -> ${stateOf(done)} amount ${done.amount}; ` +
          `grid «${grid.statusText}». Pairs: ${pairs.map((p) => `${p.pair} ${p.sale}/${p.cost}`).join(', ')}.`
      });
    });
  }
});
