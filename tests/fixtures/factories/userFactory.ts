// tests/fixtures/factories/userFactory.ts
// Factory de usuarios de prueba con faker.
// Nunca se usa para autenticarse (los users reales viven en .env);
// se usa para crear/llenar usuarios secundarios en formularios del carrier V2.
import { getFaker } from '../../utils/fakerSeed.js';
import { makeTestId, TEST_DATA_PREFIX } from '../../utils/testIdentity.js';
import type { CarrierRegion } from '../../config/runtime.js';

export type TestUser = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  documentNumber: string;
  birthDate: string; // YYYY-MM-DD
};

export type UserFactoryOverrides = Partial<TestUser> & { region?: CarrierRegion };

/**
 * Genera un usuario de prueba con prefijo trazable.
 * @example const u = makeUser({ region: 'AR' });
 */
export function makeUser(overrides: UserFactoryOverrides = {}): TestUser {
  const { region = '', ...explicit } = overrides;
  const f = getFaker(region);

  const id = makeTestId('user');
  const firstName = explicit.firstName ?? f.person.firstName();
  const lastName = explicit.lastName ?? f.person.lastName();
  const fullName = explicit.fullName ?? `${TEST_DATA_PREFIX}${firstName} ${lastName}`;
  const email = explicit.email ?? `${id}@yopmail.com`;
  const phone = explicit.phone ?? f.phone.number({ style: 'international' });
  const documentNumber = explicit.documentNumber ?? f.string.numeric({ length: 8 });
  const birthDate =
    explicit.birthDate ??
    f.date.birthdate({ min: 25, max: 60, mode: 'age' }).toISOString().slice(0, 10);

  return { id, firstName, lastName, fullName, email, phone, documentNumber, birthDate };
}

/** Genera N usuarios. Util para tests de listados / paginacion. */
export function makeUsers(count: number, overrides: UserFactoryOverrides = {}): TestUser[] {
  return Array.from({ length: count }, () => makeUser(overrides));
}
