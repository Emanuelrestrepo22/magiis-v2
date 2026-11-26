// tests/helpers/waypoint-delete-guard.ts
// Guarda de borrado de puntos de referencia por UI (MG-1132 PK-5; regla del incidente del 18/11 en el 1040): la
// pantalla solo puede borrar el id propio del test. Intercepta TODO `DELETE` cuyo path contenga `/waypoint` (con o
// sin query, con barra final o subruta) y deja pasar solo el que apunta al id propio; cualquier otro se aborta
// antes de salir.
import type { Page } from '@playwright/test';

/** `true` si la URL es exactamente `…/carriers/{n}/waypoint/{pointId}` (query y barra final toleradas). */
export function isOwnWaypointDelete(url: string, pointId: number): boolean {
  const path = new URL(url).pathname.replace(/\/+$/, '');
  return new RegExp(`/carriers/[0-9]+/waypoint/${pointId}$`).test(path);
}

/** Instala la guarda en la pagina (ver cabecera). */
export async function guardWaypointDeletes(page: Page, pointId: number): Promise<void> {
  await page.route(
    (url) => url.pathname.includes('/waypoint'),
    async (route) => {
      const request = route.request();
      if (request.method() === 'DELETE' && !isOwnWaypointDelete(request.url(), pointId)) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    }
  );
}
