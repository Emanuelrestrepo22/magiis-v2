// tests/utils/leaflet.ts
// Lectura del radio REAL de los círculos del mapa (Leaflet) para MG-1147 / TM-1330.
//
// El círculo violeta del modal «Editar una sucursal» es un `L.Circle`; su radio en metros solo
// existe en memoria del navegador (no hay texto ni atributo en el DOM). Se lee con un hook
// aprobado por el owner (07/10/2026, Q8): un `addInitScript` que envuelve
// `L.Circle.prototype.onAdd` y acumula las instancias en `window.__circles`.
//
// NOTA DE ALCANCE (scope-rules §1): el hook observa estado interno del front, NO el backend: no
// emite requests, no mockea nada y no modifica el comportamiento (devuelve el `onAdd` original).
import type { Page } from '@playwright/test';

/** Instala el hook ANTES de navegar: se inyecta en cada documento nuevo del contexto. */
export async function installCircleHook(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    const w = window as unknown as {
      __circles?: unknown[];
      L?: {
        Circle?: { prototype: { onAdd: (...args: unknown[]) => unknown; __wrapped?: boolean } };
      };
    };
    w.__circles = [];
    // Leaflet se carga con el bundle del front: se espera a que `L.Circle` exista y se envuelve una vez.
    const timer = setInterval(() => {
      const proto = w.L?.Circle?.prototype;
      if (!proto || proto.__wrapped) return;
      const original = proto.onAdd;
      proto.onAdd = function (this: unknown, ...args: unknown[]) {
        w.__circles?.push(this);
        return original.apply(this, args);
      };
      proto.__wrapped = true;
      clearInterval(timer);
    }, 2);
  });
}

/** Olvida los círculos capturados hasta ahora (antes de abrir el siguiente modal). */
export async function clearCircles(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __circles?: unknown[] }).__circles = [];
  });
}

/** Radios (en metros) de los círculos capturados, en orden de alta. */
export async function readCircleRadii(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const circles =
      (window as unknown as { __circles?: { getRadius: () => number }[] }).__circles ?? [];
    return circles.map((circle) => circle.getRadius());
  });
}
