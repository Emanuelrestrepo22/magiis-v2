// tests/fixtures/factories/driverFactory.ts
// Factory para conductores (drivers) del carrier V2.
import { getFaker } from '../../utils/fakerSeed.js';
import { makeTestId } from '../../utils/testIdentity.js';
import { makeUser, type TestUser } from './userFactory.js';
import type { CarrierRegion } from '../../config/runtime.js';

export type TestDriver = TestUser & {
  driverId: string;
  licenseNumber: string;
  licenseExpiry: string; // YYYY-MM-DD
  status: 'active' | 'inactive' | 'suspended';
  rating: number;
};

export type DriverFactoryOverrides = Partial<TestDriver> & { region?: CarrierRegion };

export function makeDriver(overrides: DriverFactoryOverrides = {}): TestDriver {
  const { region = '', ...explicit } = overrides;
  const f = getFaker(region);
  const baseUser = makeUser({ region, ...explicit });

  return {
    ...baseUser,
    driverId: explicit.driverId ?? makeTestId('drv'),
    licenseNumber: explicit.licenseNumber ?? f.string.alphanumeric({ length: 10 }).toUpperCase(),
    licenseExpiry:
      explicit.licenseExpiry ??
      f.date.future({ years: 3 }).toISOString().slice(0, 10),
    status: explicit.status ?? 'active',
    rating: explicit.rating ?? Number(f.number.float({ min: 3.5, max: 5, fractionDigits: 1 }))
  };
}

export function makeDrivers(count: number, overrides: DriverFactoryOverrides = {}): TestDriver[] {
  return Array.from({ length: count }, () => makeDriver(overrides));
}
