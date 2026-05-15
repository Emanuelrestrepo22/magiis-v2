// tests/utils/fakerSeed.ts
// Seed reproducible para faker.
// Si FAKER_SEED esta en .env, se aplica al cargar - permite reproducir un test failed
// con exactamente los mismos datos generados.
import { faker } from '@faker-js/faker';
import { fakerES, fakerES_MX, fakerEN_US } from '@faker-js/faker';
import type { CarrierRegion } from '../config/runtime.js';

const FAKER_BY_REGION: Record<CarrierRegion, typeof faker> = {
  '': faker, // primario (es por defecto)
  AR: fakerES,
  US: fakerEN_US,
  MX: fakerES_MX
};

/**
 * Devuelve la instancia de faker localizada para la region.
 * Si FAKER_SEED esta seteado, aplica el seed para reproducibilidad.
 */
export function getFaker(region: CarrierRegion = ''): typeof faker {
  const f = FAKER_BY_REGION[region] ?? faker;
  const seed = process.env.FAKER_SEED;
  if (seed && /^\d+$/.test(seed)) {
    f.seed(Number(seed));
  }
  return f;
}

/** Re-export del faker default sin region para imports rapidos. */
export { faker };
