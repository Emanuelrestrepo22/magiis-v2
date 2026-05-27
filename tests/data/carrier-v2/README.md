# tests/data/carrier-v2 — Datos deterministas (FW-010)

Fixtures de datos **estaticos y deterministas** por dominio, para casos donde
faker (datos aleatorios) no aplica: visual regression, smoke critico que asume
un dato fijo, o validaciones que comparan contra un valor conocido.

## Cuando usar esto vs factories

| Necesidad                                                | Usar                                 |
| -------------------------------------------------------- | ------------------------------------ |
| Dato unico por test, sin colision en paralelo            | `tests/fixtures/factories/` (faker)  |
| Dato fijo/reproducible (visual baseline, assert exacto)  | **este directorio** (JSON)           |
| Catalogo inmutable (paises, roles, opciones de dropdown) | este directorio o `tests/data/` raiz |

Ver `docs/architecture/BEST-PRACTICES.md` seccion "Capas de datos".

## Convencion

- Un archivo por dominio: `clients/`, `owners/`, `drivers/`, `trips/`, etc.
- Prefijo `qa_e2e_` en cualquier id/nombre/email que pudiera persistir en backend
  (permite limpieza con `DELETE ... WHERE x LIKE 'qa_e2e_%'`). Ver BEST-PRACTICES seccion 2.
- Archivos `*.example.json` son plantillas commiteadas; los `*.json` con datos
  reales sensibles NO se commitean (ver `.gitignore` si aplica).
- Importar con el alias `@data/*` (configurado en `tsconfig.json` -> `tests/data/*`).

## Ejemplo de uso

```ts
import clients from '@data/carrier-v2/clients/sample-clients.example.json' assert { type: 'json' };

test('lista muestra cliente fijo conocido', async ({ page }) => {
  const cliente = clients.clients[0];
  // ... usar cliente.name para un assert determinista
});
```

> `resolveJsonModule: true` ya esta activo en `tsconfig.json`, asi que los imports
> de JSON tipan correctamente.

## Estado FW-010

Scaffold inicial. Cada dominio agrega sus fixtures deterministas a medida que
un spec las necesite. No precargar datos especulativos.
