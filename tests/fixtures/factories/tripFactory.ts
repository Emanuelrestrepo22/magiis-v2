// tests/fixtures/factories/tripFactory.ts
// Factory para viajes del carrier V2.
import { getFaker } from '../../utils/fakerSeed.js';
import { makeTestId } from '../../utils/testIdentity.js';
import { makeAddress, type TestAddress } from './addressFactory.js';
import { makeDriver, type TestDriver } from './driverFactory.js';
import { makeVehicle, type TestVehicle } from './vehicleFactory.js';
import type { CarrierRegion } from '../../config/runtime.js';

export type TripStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TestTrip = {
  id: string;
  reference: string;
  origin: TestAddress;
  destination: TestAddress;
  pickupDate: string; // ISO
  passengerCount: number;
  status: TripStatus;
  driver: TestDriver | null;
  vehicle: TestVehicle | null;
  notes: string;
};

export type TripFactoryOverrides = Partial<TestTrip> & { region?: CarrierRegion };

export function makeTrip(overrides: TripFactoryOverrides = {}): TestTrip {
  const { region = '', ...explicit } = overrides;
  const f = getFaker(region);

  const id = explicit.id ?? makeTestId('trip');
  const reference = explicit.reference ?? `TRIP-${f.string.numeric({ length: 8 })}`;
  const origin = explicit.origin ?? makeAddress({ region });
  const destination = explicit.destination ?? makeAddress({ region });
  const pickupDate =
    explicit.pickupDate ?? f.date.soon({ days: 30 }).toISOString();
  const passengerCount = explicit.passengerCount ?? f.number.int({ min: 1, max: 6 });
  const status = explicit.status ?? 'pending';
  const driver = explicit.driver === undefined ? null : explicit.driver;
  const vehicle = explicit.vehicle === undefined ? null : explicit.vehicle;
  const notes = explicit.notes ?? f.lorem.sentence();

  return {
    id,
    reference,
    origin,
    destination,
    pickupDate,
    passengerCount,
    status,
    driver,
    vehicle,
    notes
  };
}

/** Trip completo (con driver + vehicle asignados) - util para tests de detalle. */
export function makeAssignedTrip(overrides: TripFactoryOverrides = {}): TestTrip {
  const { region = '' } = overrides;
  return makeTrip({
    region,
    status: 'in_progress',
    driver: makeDriver({ region }),
    vehicle: makeVehicle({ region }),
    ...overrides
  });
}

export function makeTrips(count: number, overrides: TripFactoryOverrides = {}): TestTrip[] {
  return Array.from({ length: count }, () => makeTrip(overrides));
}
