// tests/data/carrier-v2/units/mg1189.ts
// Datos por ambiente de la familia de specs «unidades de medida» (épica MG-1189, ronda 1).
//
// Patrón de `tests/data/carrier-v2/trips/other-costs.ts`: una función por `getCurrentEnv()`,
// `[]` cuando el ambiente no tiene dato, y override por env var autoexplicativa. Todos los
// valores son histórico estable (DWH) o ids de datos de QA medidos el 07/10/2026; si el dato
// desaparece, el spec falla con un mensaje de PRECONDICIÓN, nunca pasa en vacío ni se saltea.
//
// Carriers (medidos en los storageState y en el footer de cada ambiente):
//   uat  → 1481 (US, imperial)         · sesión primaria
//   test → 1521 (US, imperial)         · sesión primaria
//   test → 1040 (AR, métrico)          · sesión de región `AR` (storage/state-carrier-ar-test.json)
import { getCurrentEnv, type CarrierRegion } from '../../../config/runtime.js';
import type { UnitSystem } from '../../../utils/units.js';

export interface UnitsCarrier {
  /** Id corto para títulos y adjuntos, p. ej. `us-1481`. */
  key: string;
  carrierId: number;
  /** Región de credenciales/sesión: '' = primaria. */
  region: CarrierRegion;
  system: UnitSystem;
  /** Día con ≥ 1 viaje y km > 0 (Reporte Diario / Owner Report de un solo día). */
  day: string;
  /**
   * Día del Reporte Diario con facturado > 0 y minutos > 0 (razones «$ /Mi» y «Min/Mi»): las
   * razones solo discriminan con ambos distintos de cero. Por defecto, `day`.
   */
  ratiosDay?: string;
  /**
   * Viajes finalizados con distancia > 0 para el detalle (TM-1305). Dato volátil: si el viaje ya
   * no existe el spec falla con la precondición (404 del GET), no pasa en vacío.
   */
  detailTripIds: string[];
  /** Rango (ISO) con ≥ 1 viaje y km > 0 (rankings y tablero gerencial). */
  range: { from: string; to: string };
  /** Sucursales (código) cuyo modal se abre en MG-1147; todas en la primera página del listado. */
  branchIds: number[];
  /** Apellido para el typeahead de cliente de Nuevo Viaje (override: MG19_CLIENT_QUERY). */
  clientQuery: string;
}

const UAT: UnitsCarrier[] = [
  {
    key: 'us-1481',
    carrierId: 1481,
    region: '',
    system: 'imperial',
    // 13 viajes finalizados, 14,73 km (uat-1193-results.md §1).
    day: '2026-05-06',
    // 722269: KM 10,26 → «6.38 Mi» (uat-1190-results.md). UAT caído el 08/10: sin re-verificar.
    detailTripIds: ['722269'],
    // Mayo/2026: 38 viajes, 48,9 km, 5 choferes, 5 vehículos.
    range: { from: '2026-05-01', to: '2026-05-31' },
    // 1752 «FL Air Port» (160,93 km → 100 Mi) y 2933 «Base USA» (1,61 km → 1 Mi).
    branchIds: [1752, 2933],
    // «TEST NO USAR»: cliente de prueba del carrier; nunca se envía el viaje.
    clientQuery: 'test'
  }
];

const TEST: UnitsCarrier[] = [
  {
    key: 'us-1521',
    carrierId: 1521,
    region: '',
    system: 'imperial',
    // 55 viajes, 153,3 km.
    day: '2026-08-21',
    // 05/10: facturado 4,64 · 3,73 km · 66 min → «$ /Mi» 2,00 · «Min/Mi» 28,47 (oráculo DB 08/10).
    ratiosDay: '2026-10-05',
    // 70667: 10,96 km → «6.81 Mi».
    detailTripIds: ['70667'],
    // Agosto/2026: 29 finalizados, 269,50 km, 4 choferes.
    range: { from: '2026-08-01', to: '2026-08-31' },
    // 1044 «CABOT» (3,22 km desde la deriva del 05/10) y 2184 «miramar» (1,61 km → 1 Mi).
    branchIds: [1044, 2184],
    // «Federico, Mauricio»: cliente que el equipo dio de alta a mano en TEST para crear viajes.
    clientQuery: 'federico'
  },
  {
    key: 'ar-1040',
    carrierId: 1040,
    region: 'AR',
    system: 'metric',
    // 14 viajes, 1 503,10 km: ejercita el separador de miles es-AR.
    day: '2026-09-21',
    // 69794: 34,07 km · 60003: 2,28 km (separador de coma es-AR).
    detailTripIds: ['69794', '60003'],
    // Septiembre/2026: 1 571,98 km, 5 choferes.
    range: { from: '2026-09-01', to: '2026-09-30' },
    // El carrier 1040 es un demo: MG-1147 no abre sus sucursales (TM-1325 lo excluye).
    branchIds: [],
    // «test dos, test imp» (41 coincidencias).
    clientQuery: 'test'
  }
];

/** Carriers con dato en el ambiente activo (ENV). Vacío en `prod`: el fix no está desplegado. */
export function unitsCarriers(): UnitsCarrier[] {
  const env = getCurrentEnv();
  const base = env === 'uat' ? UAT : env === 'test' ? TEST : [];
  const only = process.env.MG1189_ONLY_CARRIER?.trim();
  const carriers = only ? base.filter((c) => c.key === only) : base;
  // Override de las sucursales a abrir: MG1147_BRANCH_IDS="1752,2933" (solo carriers con ids).
  const override = process.env.MG1147_BRANCH_IDS?.trim();
  const ids = override ? override.split(',').map(Number).filter(Number.isFinite) : null;
  const clientQuery = process.env.MG19_CLIENT_QUERY?.trim();
  return carriers.map((c) => ({
    ...c,
    branchIds: ids && c.branchIds.length ? ids : c.branchIds,
    clientQuery: clientQuery || c.clientQuery
  }));
}
