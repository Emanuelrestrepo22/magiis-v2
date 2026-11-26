// tests/data/carrier-v2/waypoints/waypoints.env.ts
// Datos por ambiente del feature Puntos de referencia (MG-1132, ATP TM-1841). Hoy solo TEST (decision
// D2 del 19/11/2026: el ambiente sigue el estado del ticket); `uat` y `prod` valen null y el spec se
// salta con motivo cuando el feature pase a UAT se agrega su entrada.
import type { AppEnv } from '../../../config/runtime.js';

export type WaypointsProfile = {
  carrierId: number;
  /** Atajo del carrier en el selector de cuenta del portal (Master Access / cambio de cuenta). */
  shortcut: string;
};

export type WaypointsData = {
  /** Perfil por defecto de la sesion (viajes, ABM y buscador). */
  primary: WaypointsProfile;
  /** Segunda sesion, solo para aislamiento entre carriers (TM-1750, TM-1826). Region AR. */
  secondary: WaypointsProfile;
};

export function waypointsDataFor(env: AppEnv): WaypointsData | null {
  if (env === 'test') {
    return {
      primary: { carrierId: 1521, shortcut: 'Marcela Usa' },
      secondary: { carrierId: 1040, shortcut: 'Sebastian' }
    };
  }
  return null;
}
