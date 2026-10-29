# Cost/sale regression: T0 data findings (TEST, 2026-10-13, read-only)

## 1. Driver 3727 (pepe argentoinfoa, USER_ID 10804)

- Carrier account 1521, current vehicle 2625, ENABLED=1, vehicle belongs to carrier 1521: OK.
- BLOCKER: the driver is NOT free. `DRIVER.INCOMING_TRAVEL_ID` = 69801, trip 69801 is in
  state `WITH_DRIVER_ASSIGNED` (TRAVEL.STATE=1, carrier 1521, CREDIT_CARD, simulated 300). It is the
  only open trip of the driver (282 others in STATE 6). It must be cancelled/closed (by its owner)
  before the driver can take a new trip for automatic closure.

## 2. Client with effective tariff 6204 "QA F2 Venta" (carrier 1521)

- CARRIERRATE 6204: ACTIVE=1, DELETED=0, RATE_BY_COST=0, PRICEPERKM 2.48549, COST_PRICE 0.82021.
- PASSENGERACCOUNT 10327 -> PASSENGER 10551 (Philippe Krief), OPERABILITY=1, DELETED=0,
  IDFORCARRIER 58. Search in New Trip: `Krief` (to be confirmed in the UI picker; not exercised).
- Companions: 6203 "QA F2 Costo y Venta" -> PASSENGERACCOUNT 10326 (PASSENGER 10550, Zak Brown);
  6202 "QA F2 Bimonetario ARS" has no client assigned.
- Risk to watch: 6204 has RATE_BY_COST=0 but COST_PRICE (0.82021) differs from PRICEPERKM
  (2.48549), although the column comment says they match when the tariff is not by cost. The
  cost = sale oracle may expose this (candidate finding, not asserted yet).

## 3. Detail field names (`GET carriers/1521/travels/{id}`, TEST)

Trips 71124 (admin, MEET AND GREET 10, finalizeAdmin) and 71106 (driver-closed) both DONE, CASH, USD.

| Pair                  | Sale field       | Cost field                | 71124         | 71106       |
| --------------------- | ---------------- | ------------------------- | ------------- | ----------- |
| total                 | `amount`         | `amountCost`              | 57.22 / 57.22 | 5.21 / 5.21 |
| tour                  | `tourPrice`      | `tourPriceCost`           | 47.22 / 47.22 | 5.21 / 5.21 |
| wait time             | `waitTimePrice`  | `waitTotalPriceCost`      | 0 / 0         | 0 / 0       |
| other costs           | `otherCost`      | `otherCostPriceCost`      | 10 / 10       | 0 / 0       |
| other costs (non-com) | `otherCostNoCom` | `otherCostPriceCostNoCom` | 0 / 0         | 0 / 0       |

Extra: `otherCostCom` (10 in 71124), `simulationPrice.pricePointToPoint` /
`pricePointToPointCost` (47.22/47.22 and 7.45/7.45), `otherCostList[].price` / `priceCost`.
Observations: in 71106 `amount` (5.21) is below the simulated 7.45 (driver-closed, real km);
`otherCostList` is `null` when there are no other costs; both trips used a non-sale-only tariff,
so equality here does not yet prove the 6204 behaviour.
