// tests/fixtures/factories/vehicleFactory.ts
// Factory para vehiculos del carrier V2.
import { getFaker } from '../../utils/fakerSeed.js';
import { makeTestId } from '../../utils/testIdentity.js';
import type { CarrierRegion } from '../../config/runtime.js';

export type TestVehicle = {
  id: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  type: 'sedan' | 'suv' | 'van' | 'minibus';
  capacity: number;
};

export type VehicleFactoryOverrides = Partial<TestVehicle> & { region?: CarrierRegion };

const VEHICLE_TYPES: TestVehicle['type'][] = ['sedan', 'suv', 'van', 'minibus'];

export function makeVehicle(overrides: VehicleFactoryOverrides = {}): TestVehicle {
  const { region = '', ...explicit } = overrides;
  const f = getFaker(region);

  // Patente: formato generico alfanumerico de 6-7 chars. Si la region exige formato (ej. AAA000),
  // overridear desde el caller.
  const plate = explicit.plate ?? f.string.alphanumeric({ length: 7, casing: 'upper' });
  const type = explicit.type ?? f.helpers.arrayElement(VEHICLE_TYPES);

  return {
    id: explicit.id ?? makeTestId('veh'),
    plate,
    brand: explicit.brand ?? f.vehicle.manufacturer(),
    model: explicit.model ?? f.vehicle.model(),
    year: explicit.year ?? f.number.int({ min: 2015, max: 2026 }),
    color: explicit.color ?? f.vehicle.color(),
    type,
    capacity: explicit.capacity ?? (type === 'minibus' ? 16 : type === 'van' ? 8 : 4)
  };
}

export function makeVehicles(count: number, overrides: VehicleFactoryOverrides = {}): TestVehicle[] {
  return Array.from({ length: count }, () => makeVehicle(overrides));
}
