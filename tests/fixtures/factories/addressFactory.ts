// tests/fixtures/factories/addressFactory.ts
// Factory para direcciones (origen/destino de viajes).
import { getFaker } from '../../utils/fakerSeed.js';
import { makeTestId } from '../../utils/testIdentity.js';
import type { CarrierRegion } from '../../config/runtime.js';

export type TestAddress = {
  id: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  latitude: number;
  longitude: number;
  formatted: string;
};

export type AddressFactoryOverrides = Partial<TestAddress> & { region?: CarrierRegion };

export function makeAddress(overrides: AddressFactoryOverrides = {}): TestAddress {
  const { region = '', ...explicit } = overrides;
  const f = getFaker(region);

  const street = explicit.street ?? f.location.streetAddress();
  const city = explicit.city ?? f.location.city();
  const state = explicit.state ?? f.location.state();
  const zipCode = explicit.zipCode ?? f.location.zipCode();
  const country = explicit.country ?? f.location.country();

  return {
    id: explicit.id ?? makeTestId('addr'),
    street,
    city,
    state,
    zipCode,
    country,
    latitude: explicit.latitude ?? f.location.latitude(),
    longitude: explicit.longitude ?? f.location.longitude(),
    formatted: explicit.formatted ?? `${street}, ${city}, ${state} ${zipCode}, ${country}`
  };
}
